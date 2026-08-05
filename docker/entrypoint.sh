#!/bin/sh
set -e

# Container starts as root so it can align the app user's UID/GID with
# whatever owns the NAS shares mounted at /app/data and /downloads, then
# drops privileges before running the app. This is what fixes the
# ownership-mismatch problems v2 had on Synology: set PUID/PGID in your
# .env to match the Synology user that owns your books share
# (run `id <user>` over SSH on the NAS to find them).
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

CURRENT_UID=$(id -u appuser)
CURRENT_GID=$(id -g appuser)

if [ "$CURRENT_GID" != "$PGID" ]; then
  groupmod -o -g "$PGID" appuser
fi

if [ "$CURRENT_UID" != "$PUID" ]; then
  usermod -o -u "$PUID" appuser
fi

# Only chown the small SQLite data directory, not /downloads -- recursively
# chowning a large book library on every container start would be slow and
# is unnecessary as long as PUID/PGID already match the share's owner.
mkdir -p /app/data
chown -R appuser:appuser /app/data

exec gosu appuser:appuser "$@"
