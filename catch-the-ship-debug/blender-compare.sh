#!/usr/bin/env bash
# Side-by-side crop: blender-compare.sh <before.jpg> <after.jpg> <out.jpg> [crop w:h:x:y] [scale]
set -euo pipefail
before=$1 after=$2 out=$3 crop=${4:-iw:ih:0:0} scale=${5:-1}
ffmpeg -loglevel error -y -i "$before" -i "$after" -filter_complex \
  "[0]crop=$crop,scale=iw*$scale:ih*$scale:flags=lanczos[a];[1]crop=$crop,scale=iw*$scale:ih*$scale:flags=lanczos[b];[a][b]hstack" \
  -q:v 3 "$out"
echo "$out"
