#!/bin/sh
set -e

echo "[entrypoint] running prisma migrate deploy..."
node ./node_modules/prisma/build/index.js migrate deploy || {
  echo "[entrypoint] WARNING: migrate deploy failed — continuing anyway"
}

echo "[entrypoint] starting app: $@"
exec "$@"
