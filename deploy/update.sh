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
}

main "$@"
