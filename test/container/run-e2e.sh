#!/usr/bin/env bash
# Runs inside the container: copies the project from /src, installs its
# dependencies for Linux, starts a virtual display and runs the e2e tests.
set -euo pipefail

mkdir -p /work /cache/obsidian /cache/bun
tar -C /src \
  --exclude=./node_modules --exclude=./.obsidian-cache --exclude=./.git \
  --exclude=./.jj --exclude=./main.js -cf - . | tar -C /work -xf -
cd /work

# wdio.conf.mts keeps Obsidian downloads in ./.obsidian-cache.
ln -s /cache/obsidian .obsidian-cache
export BUN_INSTALL_CACHE_DIR=/cache/bun
bun install --frozen-lockfile

Xvfb :99 -screen 0 1280x1024x24 +extension GLX -noreset &
export DISPLAY=:99
sleep 1
herbstluftwm &
sleep 1

export WDIO_MAX_INSTANCES=1
exec bun run test:e2e "$@"
