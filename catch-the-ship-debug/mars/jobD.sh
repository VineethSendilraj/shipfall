#!/bin/bash
# Final checks after the rebase onto main bdf3ea2 (PR #12: ship + baked AO models).
cd ~/dev/scratch/catch-the-ship-debug || exit 1
W=~/dev/scratch/catch-the-ship-mars
B=http://localhost:41772
M=http://localhost:41773
mkdir -p mars/pr2
run() { echo "### $*"; "$@" 2>&1 | grep -v '^frame [0-9]*: {"differing":0' ; }
run bash -c "cd $W && npm test 2>&1 | tail -25"
run bash -c "cd $W && npm run check:card 2>&1 | tail -6"
echo "### ident main vs branch (Starbase showcase)"
node ident.mjs $M $B 1280 720 130,366,700,1000,1300,1500 2>&1
echo "### ident branch fresh vs branch after Mars round trip"
node ident.mjs $B $B 1280 720 130,366,700,1000,1300,1500 '' roundtrip 2>&1
run node switch-leak.mjs $B 3
run node crash-scan.mjs $B 1280 720 starbase mars/pr2/sb1280 0,1,2,3,6,12,25,45,70,100,150
run node crash-scan.mjs $B 1280 720 mars mars/pr2/mars1280 0,1,2,3,6,12,25,45,70,100,150
run node crash-scan.mjs $B 480 480 starbase mars/pr2/sb480 6,12,25,45,70,100 embed
run node crash-scan.mjs $B 480 480 mars mars/pr2/mars480 6,12,25,45,70,100 embed
echo "### ship crash (SHIP=1)"
SHIP=1 node crash-scan.mjs $B 1280 720 starbase mars/pr2/ship-sb1280 6,25,70 2>&1
SHIP=1 node crash-scan.mjs $B 1280 720 mars mars/pr2/ship-mars1280 6,25,70 2>&1
run node mars-shots.mjs $B 1280 720 mars mars/pr2/mars1280 366,408
run node mars-shots.mjs $B 480 480 mars mars/pr2/mars480 366,408 embed
run node mars-shots.mjs $B 1280 720 starbase mars/pr2/sb1280 366
run node flicker-det.mjs $B 1280 720
run node flicker-det.mjs $M 1280 720
run node flicker-det.mjs $B 480 480
run node flicker-det.mjs $M 480 480
echo "### done"
