#!/usr/bin/env bash
# Sets up BusinessPilot on a fresh Ubuntu 24.04 server (any provider):
#   curl -fsSL https://raw.githubusercontent.com/totorioIT/BusinessPilot-Claude/main/deploy/install.sh | sudo bash
# Asks for the owner login, installs Docker, starts Postgres + app + HTTPS, and installs a
# timer that pulls new commits from GitHub every 5 minutes. Set DOMAIN=app.example.de to use
# your own domain; without it the server gets <ip>.sslip.io, which works with HTTPS right away.
set -euo pipefail

REPO=https://github.com/totorioIT/BusinessPilot-Claude.git
DIR=/opt/businesspilot

main() {
  [ "$(id -u)" = 0 ] || { echo "Bitte mit sudo oder als root ausführen."; exit 1; }
  exec </dev/tty # read answers from the keyboard even when piped through curl

  if [ -f "$DIR/.env" ]; then
    echo "BusinessPilot ist hier schon eingerichtet ($DIR/.env). Updates laufen automatisch."
    exit 0
  fi

  echo "== BusinessPilot einrichten =="
  until [[ "${OWNER_EMAIL:-}" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]]; do
    read -rp "Deine E-Mail für den Login: " OWNER_EMAIL
  done
  read -rp "Dein Name: " OWNER_NAME
  OWNER_NAME=${OWNER_NAME//\'/}
  while true; do
    read -rsp "Passwort (mind. 10 Zeichen): " OWNER_PASSWORD; echo
    read -rsp "Passwort wiederholen: " again; echo
    if [ "$OWNER_PASSWORD" != "$again" ]; then echo "Die Passwörter stimmen nicht überein."
    elif [ ${#OWNER_PASSWORD} -lt 10 ]; then echo "Bitte mindestens 10 Zeichen."
    elif [[ "$OWNER_PASSWORD" == *"'"* ]]; then echo "Bitte ohne Apostroph (')."
    else break; fi
  done

  echo "== Pakete und Docker installieren =="
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  apt-get install -yq git curl ufw openssl
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

  # Builds need more memory than the app; add swap on small servers.
  if [ "$(swapon --show | wc -l)" = 0 ] && [ "$(free -m | awk '/Mem:/ {print $2}')" -lt 6000 ]; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi

  ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

  git clone -q "$REPO" "$DIR"
  cd "$DIR"
  if [ -z "${DOMAIN:-}" ]; then
    ip=$(curl -4fsS https://api.ipify.org)
    DOMAIN="${ip//./-}.sslip.io"
  fi
  umask 077
  cat > .env <<EOF
DOMAIN=$DOMAIN
POSTGRES_PASSWORD=$(openssl rand -hex 24)
APP_SECRET=$(openssl rand -hex 32)
GIT_COMMIT=$(git rev-parse --short HEAD)
OWNER_EMAIL=$OWNER_EMAIL
OWNER_NAME='$OWNER_NAME'
OWNER_PASSWORD='$OWNER_PASSWORD'
EOF

  echo "== App bauen und starten (dauert beim ersten Mal einige Minuten) =="
  docker compose up -d --build
  healthy=
  for _ in $(seq 60); do
    if docker compose exec -T app wget -qO- http://127.0.0.1:3001/api/health >/dev/null 2>&1; then healthy=1; break; fi
    sleep 5
  done
  if [ -n "$healthy" ]; then
    # The login now lives in the database; don't keep the password on disk or in the container.
    sed -i '/^OWNER_PASSWORD=/d' .env
    docker compose up -d
  else
    echo "Warnung: Die App meldet sich noch nicht. Log ansehen mit: cd $DIR && docker compose logs app"
  fi

  cat > /etc/systemd/system/businesspilot-update.service <<EOF
[Unit]
Description=BusinessPilot: neue Version von GitHub holen
[Service]
Type=oneshot
ExecStart=$DIR/deploy/update.sh
EOF
  cat > /etc/systemd/system/businesspilot-update.timer <<'EOF'
[Unit]
Description=BusinessPilot alle 5 Minuten aktualisieren
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now businesspilot-update.timer

  echo
  echo "Fertig. BusinessPilot läuft unter: https://$DOMAIN"
  echo "Login: $OWNER_EMAIL mit deinem Passwort."
}

main "$@"
