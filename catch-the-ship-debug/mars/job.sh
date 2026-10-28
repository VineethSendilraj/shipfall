#!/bin/bash
# Runs the given shell lines one after another, logging to the named log; used from a detached tmux.
log="$1"; shift
cd ~/dev/scratch/catch-the-ship-debug || exit 1
: > "$log"
for cmd in "$@"; do
  echo "### $cmd" >> "$log"
  bash -c "$cmd" >> "$log" 2>&1
done
echo "### done" >> "$log"
