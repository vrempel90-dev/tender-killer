#!/bin/sh
# Correct Railway/Docker root-owned mount permissions, then run Node unprivileged.
set -eu
if [ "$(id -u)" -eq 0 ]; then
  if [ ! -d /app/storage ]; then mkdir -p /app/storage; fi
  chown 1001:1001 /app/storage
  exec su-exec 1001:1001 "$@"
fi
exec "$@"
