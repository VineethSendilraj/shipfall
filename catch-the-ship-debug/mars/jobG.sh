#!/bin/bash
# Re-check crashes after spreading the impact sparks over their first frames.
cd ~/dev/scratch/catch-the-ship-debug || exit 1
W=~/dev/scratch/catch-the-ship-mars
B=http://localhost:41772
echo "### npm test"
(cd $W && npm test 2>&1 | grep -E "passed|failed|not ok|Error" | head -10)
for m in mars starbase; do
  echo "### ship $m 1280"
  SHIP=1 node crash-scan.mjs $B 1280 720 $m mars/pr2/ship-$m 0,1,2,3,6,25,70 2>&1 | grep -v "^ship hack"
done
echo "### booster mars 1280"
node crash-scan.mjs $B 1280 720 mars mars/pr2/mars1280 0,1,2,3,6,12,25,45,70,100,150 2>&1
echo "### booster starbase 1280"
node crash-scan.mjs $B 1280 720 starbase mars/pr2/sb1280 0,1,2,3,6,12,25,45,70,100,150 2>&1
echo "### booster starbase 480"
node crash-scan.mjs $B 480 480 starbase mars/pr2/sb480 6,12,25,45,70,100 embed 2>&1
echo "### booster mars 480"
node crash-scan.mjs $B 480 480 mars mars/pr2/mars480 6,12,25,45,70,100 embed 2>&1
echo "### ship mars 480"
SHIP=1 node crash-scan.mjs $B 480 480 mars mars/pr2/ship-mars480 6,25 embed 2>&1 | grep -v "^ship hack"
echo "### done"
