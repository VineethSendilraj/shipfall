#!/bin/zsh
# PR #16 v5 screenshots, one headless Chrome at a time, against the branch server on 41830.
cd /Users/vsendilraj/dev/scratch/catch-the-ship-debug
B=http://127.0.0.1:41830
run() {
  local log=$1
  shift
  "$@" > /tmp/$log.log 2>&1
  echo "EXIT=$?" >> /tmp/$log.log
  echo "$log done $(date +%T)" >> /tmp/explore-v5-progress.log
}
: > /tmp/explore-v5-progress.log
run explore-v5-shots-sb node explore-shots.mjs $B explore-v5-sb 1280 720 /
run explore-v5-shots-mars node explore-shots.mjs $B explore-v5-mars 1280 720 '/?map=mars'
run explore-v5-maps-sb env FULL=both node explore-maps.mjs $B v5-sb '' 1280 720 engines,nose,fins
run explore-v5-maps-mars env FULL=both node explore-maps.mjs $B v5-mars map=mars 1280 720 engines,nose,fins
run explore-v5-shots-390 node explore-shots.mjs $B explore-v5-390 390 844 / engines,flaps
run explore-v5-shots-480 node explore-shots.mjs $B explore-v5-480 480 480 /embed/ engines
run explore-v5-title-sb node explore-title.mjs $B explore-v5-title-sb 1280 720 /
run explore-v5-title-mars node explore-title.mjs $B explore-v5-title-mars 1280 720 '/?map=mars'
run explore-v5-title-390 node explore-title.mjs $B explore-v5-title-390 390 844 /
run explore-v5-title-480 node explore-title.mjs $B explore-v5-title-480 480 480 /embed/
echo ALL_DONE >> /tmp/explore-v5-progress.log
