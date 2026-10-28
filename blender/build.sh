#!/usr/bin/env bash
# Rebuilds public/models/*.glb: Blender runs blender/build_models.py and exports raw GLBs, then
# gltf-transform quantizes them and applies meshopt compression. Extra arguments go to the Blender
# script, e.g. `blender/build.sh --render /tmp/previews` for preview renders.
set -euo pipefail
cd "$(dirname "$0")/.."
BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
WORK="${WORK:-$(mktemp -d)}"
"$BLENDER" -b --factory-startup --python blender/build_models.py -- --out "$WORK" "$@"
mkdir -p public/models
for m in booster ship tower props; do
  npx -y @gltf-transform/cli@4.5.1 meshopt "$WORK/$m.glb" "public/models/$m.glb" --level high
done
ls -l public/models
