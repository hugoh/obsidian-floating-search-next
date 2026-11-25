#!/usr/bin/env bash
# Runs the e2e tests in a Linux container under a virtual display, so no Obsidian
# window opens on this machine. Arguments go to wdio (for example --spec <file>);
# OBSIDIAN_VERSIONS is passed through.
set -euo pipefail

cd "$(dirname "$0")/.."

image=search-open-e2e
cache=$PWD/.obsidian-cache/container

runtime=
for candidate in container docker podman; do
  if command -v "$candidate" >/dev/null; then
    runtime=$candidate
    break
  fi
done
if [ "$runtime" = "" ]; then
  echo "test:e2e:container needs Apple's container CLI, Docker or Podman" >&2
  exit 1
fi

if [ "$runtime" = container ]; then
  container system status >/dev/null 2>&1 || container system start --enable-kernel-install
fi

mkdir -p "$cache"
"$runtime" build --tag "$image" --file test/container/Containerfile test/container

args=(
  --rm --cpus 4 --memory 4G
  --volume "$PWD:/src:ro"
  --volume "$cache:/cache"
)
if [ "${OBSIDIAN_VERSIONS:-}" != "" ]; then
  args+=(--env "OBSIDIAN_VERSIONS=$OBSIDIAN_VERSIONS")
fi

"$runtime" run "${args[@]}" "$image" "$@"
