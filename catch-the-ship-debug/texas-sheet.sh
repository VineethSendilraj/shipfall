#!/bin/zsh
# Contact sheet: texas-sheet.sh <out.jpg> <cols> <cellWidth> <img>...  (all images scaled to cellWidth, same aspect)
set -e
out=$1; cols=$2; cw=$3; shift 3
n=$#
inputs=()
for f in "$@"; do inputs+=(-i "$f"); done
filter=""
layout=""
for ((i = 0; i < n; i++)); do
  filter+="[${i}:v]scale=${cw}:-2[s${i}];"
  c=$((i % cols)); r=$((i / cols))
  xs="0"; ys="0"
  for ((k = 0; k < c; k++)); do xs+="+w0"; done
  for ((k = 0; k < r; k++)); do ys+="+h0"; done
  layout+="${xs}_${ys}|"
done
layout=${layout%|}
stack=""
for ((i = 0; i < n; i++)); do stack+="[s${i}]"; done
if (( n == 1 )); then
  ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "${filter}[s0]null[o]" -map "[o]" -q:v 3 "$out"
else
  ffmpeg -loglevel error -y "${inputs[@]}" -filter_complex "${filter}${stack}xstack=inputs=${n}:layout=${layout}:fill=black[o]" -map "[o]" -q:v 3 "$out"
fi
