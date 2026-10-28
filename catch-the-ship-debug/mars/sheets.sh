#!/bin/bash
# Contact sheets from the PR screenshots. Usage: sheets.sh [shot dir under mars/, default pr] [ship]
set -u
dir=${1:-pr}
cd "$(dirname "$0")/$dir" || exit 1
FF=/Users/vsendilraj/dev/scratch/catch-the-ship-blender/node_modules/ffmpeg-static/ffmpeg

# grid OUT W H COLS FILE...
grid() {
  local out=$1 w=$2 h=$3 cols=$4
  shift 4
  local args=() f="" i=0 row="" rows=()
  for file in "$@"; do
    args+=(-i "$file")
    f="${f}[${i}]scale=${w}:${h}[s${i}];"
    row="${row}[s${i}]"
    i=$((i + 1))
    if (( i % cols == 0 )); then rows+=("$row"); row=""; fi
  done
  local r=0 stack=""
  for rw in "${rows[@]}"; do
    f="${f}${rw}hstack=${cols}[r${r}];"
    stack="${stack}[r${r}]"
    r=$((r + 1))
  done
  if (( r > 1 )); then f="${f}${stack}vstack=${r}"; else f="${f%;}"; f="${f%\[r0\]}"; fi
  "$FF" -loglevel error -y "${args[@]}" -filter_complex "$f" -q:v 3 "$out"
}

c() { local p=$1; shift; for o in "$@"; do printf '%s-c%s.jpg\n' "$p" "$o"; done; }

# File names have no spaces, so plain word splitting is safe (macOS bash 3.2 has no mapfile).
grid sheet-mars1280-crash.jpg 480 270 4 $(c mars1280 003 006 012 025 045 070 100 150)
grid sheet-sb1280-crash.jpg 480 270 4 $(c sb1280 003 006 012 025 045 070 100 150)
grid sheet-480-crash.jpg 240 240 6 $(c sb480 006 012 025 045 070 100) $(c mars480 006 012 025 045 070 100)
grid sheet-1280-scenes.jpg 480 270 3 \
  sb1280-title.jpg mars1280-title.jpg mars1280-scene.jpg \
  sb1280-f366.jpg mars1280-f366.jpg mars1280-f408.jpg
grid sheet-480-scenes.jpg 240 240 4 \
  mars480-title.jpg mars480-scene.jpg mars480-f366.jpg mars480-f408.jpg
if [ "${2:-}" = ship ]; then
  grid sheet-ship-crash.jpg 480 270 3 $(c ship-starbase 006 025 070) $(c ship-mars 006 025 070)
fi
echo ok
