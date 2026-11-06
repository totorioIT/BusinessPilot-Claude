#!/usr/bin/env bash
# Pulls new commits from GitHub and rebuilds the app when main has moved.
# Run by businesspilot-update.timer; FORCE=1 rebuilds even without new commits.
set -euo pipefail

# Server logs (app requests incl. IP addresses, Caddy, Postgres) go to journald via
# docker-compose.yml; journald deletes entries older than 14 days (Datenschutzerklärung,
# "Server-Log-Dateien"). Idempotent: only writes and restarts journald when the file differs.
ensure_log_retention() {
  local conf=/etc/systemd/journald.conf.d/businesspilot-retention.conf
  local want=$'[Journal]\nMaxRetentionSec=14day\nMaxFileSec=1day\n'
  if [ "$(cat "$conf" 2>/dev/null)"$'\n' != "$want" ]; then
    mkdir -p "$(dirname "$conf")"
    printf '%s' "$want" > "$conf"
    systemctl restart systemd-journald
  fi
}

# Daily database backup at 03:30 via deploy/backup.sh (kept 14 days). Idempotent like above.
ensure_backup_timer() {
  local svc=/etc/systemd/system/businesspilot-backup.service
  local tmr=/etc/systemd/system/businesspilot-backup.timer
  local want_svc=$'[Unit]\nDescription=Rufanna Datenbank-Backup\n\n[Service]\nType=oneshot\nExecStart=/opt/businesspilot/deploy/backup.sh\n'
  local want_tmr=$'[Unit]\nDescription=Rufanna Datenbank-Backup taeglich\n\n[Timer]\nOnCalendar=*-*-* 03:30:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n'
  if [ "$(cat "$svc" 2>/dev/null)"$'\n' != "$want_svc" ] || [ "$(cat "$tmr" 2>/dev/null)"$'\n' != "$want_tmr" ]; then
    printf '%s' "$want_svc" > "$svc"
    printf '%s' "$want_tmr" > "$tmr"
    systemctl daemon-reload
    systemctl enable --now businesspilot-backup.timer
  fi
}

main() {
  ensure_log_retention
  ensure_backup_timer
  cd /opt/businesspilot
  # .env holds the database password and APP_SECRET: only root may read it.
  chmod 600 .env
  exec 9>/run/businesspilot-update.lock
  flock -n 9 || exit 0

  # Servers installed before APP_SECRET existed get one now; the containers must restart to see it.
  if ! grep -q '^APP_SECRET=' .env; then
    echo "APP_SECRET=$(openssl rand -hex 32)" >> .env
    FORCE=1
  fi

  git fetch -q origin main
  if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && [ -z "${FORCE:-}" ]; then exit 0; fi

  git reset -q --hard origin/main
  sed -i "s/^GIT_COMMIT=.*/GIT_COMMIT=$(git rev-parse --short HEAD)/" .env
  echo "Aktualisiere auf $(git log -1 --format='%h %s')"
  docker compose up -d --build --remove-orphans
  docker image prune -f >/dev/null

  # An install whose first health check failed leaves the owner password in .env; drop it
  # once the app answers, since the login lives in the database by then.
  if grep -q '^OWNER_PASSWORD=' .env; then
    for _ in $(seq 30); do
      if docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then
        sed -i '/^OWNER_PASSWORD=/d' .env
        docker compose up -d
        break
      fi
      sleep 5
    done
  fi
}

main "$@"
