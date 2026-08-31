#!/usr/bin/env bash
# Build and (re)start the stack with docker compose. Run from the repo root.
#
# Local:   ./scripts/deploy.sh
# Remote:  set DEPLOY_HOST=user@host and it streams the tree over ssh and builds
#          there, leaving the server's .env and ./data untouched.
set -euo pipefail

if [ -n "${DEPLOY_HOST:-}" ]; then
  KEY_OPT=""; [ -n "${DEPLOY_KEY:-}" ] && KEY_OPT="-i $DEPLOY_KEY"
  SSH=(ssh $KEY_OPT -o StrictHostKeyChecking=accept-new "$DEPLOY_HOST")
  DIR="${DEPLOY_DIR:-/srv/tempshell}"
  echo "==> syncing source to $DEPLOY_HOST:$DIR"
  tar czf - --exclude=.git --exclude=node_modules --exclude=dist --exclude=data --exclude=.env . \
    | "${SSH[@]}" "mkdir -p '$DIR' && tar xzf - -C '$DIR'"
  echo "==> building and restarting"
  "${SSH[@]}" "cd '$DIR' && docker compose up -d --build"
  echo "==> health"
  "${SSH[@]}" "sleep 3; cd '$DIR' && docker compose ps"
else
  docker compose up -d --build
  sleep 3
  docker compose ps
fi
echo "done"
