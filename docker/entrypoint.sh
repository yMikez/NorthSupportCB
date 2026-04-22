#!/bin/sh
set -e

echo "[entrypoint] running prisma migrate deploy..."
./node_modules/.bin/prisma migrate deploy || {
  echo "[entrypoint] WARNING: migrate deploy failed — continuing anyway"
}

echo "[entrypoint] starting app: $@"
exec "$@"
