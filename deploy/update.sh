#!/usr/bin/env bash
# Pulls new commits from GitHub and rebuilds the app when main has moved.
# Run by businesspilot-update.timer; FORCE=1 rebuilds even without new commits.
set -euo pipefail

main() {
  cd /opt/businesspilot
  exec 9>/run/businesspilot-update.lock
  flock -n 9 || exit 0

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
