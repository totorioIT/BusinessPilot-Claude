#!/usr/bin/env bash
# Daily database backup, run by businesspilot-backup.timer (set up by deploy/update.sh).
# Writes a compressed pg_dump to /var/backups/rufanna, readable only by root, and deletes
# backups older than 14 days. Restore: see README ("Backup wiederherstellen").
set -euo pipefail

DIR=/var/backups/rufanna
KEEP_DAYS=14

cd /opt/businesspilot
umask 077
mkdir -p "$DIR"
chmod 700 "$DIR"

file="$DIR/rufanna-$(date +%Y-%m-%d_%H%M).sql.gz"
# Write to a temporary name first so a failed dump never looks like a good backup.
docker compose exec -T db pg_dump -U bp --clean --if-exists businesspilot | gzip > "$file.part"
mv "$file.part" "$file"
echo "Backup geschrieben: $file ($(du -h "$file" | cut -f1))"

find "$DIR" -name 'rufanna-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -name '*.part' -mmin +60 -delete
