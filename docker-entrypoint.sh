#!/bin/sh
set -e

# The app runs unprivileged as the `node` user (uid 1000). The persistent data directory is a
# Core-managed mount that may be created root-owned, so we start as root only to fix its
# ownership, then drop privileges with gosu before exec'ing the app. This keeps SQLite writes
# working regardless of how the /app/data volume was provisioned.
DATA_DIR="${HOSTY_APP_DATA_DIR:-/app/data}"
mkdir -p "$DATA_DIR"
chown -R node:node "$DATA_DIR" 2>/dev/null || true

exec gosu node "$@"
