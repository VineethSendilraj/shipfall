#!/bin/bash
# Mars re-check with the key light raised to 12 degrees.
cd ~/dev/scratch/catch-the-ship-debug || exit 1
B=http://localhost:41772
echo "### window scan"
node flk-window.mjs $B 1280 720 '&map=mars' 440-520,880-930 2>&1
echo "### ship mars 1280"
SHIP=1 node crash-scan.mjs $B 1280 720 mars mars/pr2/ship-mars 0,1,2,3,6,25,70 2>&1 | grep -v "^ship hack"
echo "### ship mars 480"
SHIP=1 node crash-scan.mjs $B 480 480 mars mars/pr2/ship-mars480 6,25 embed 2>&1 | grep -v "^ship hack"
echo "### booster mars 1280"
node crash-scan.mjs $B 1280 720 mars mars/pr2/mars1280 0,1,2,3,6,12,25,45,70,100,150 2>&1
echo "### booster mars 480"
node crash-scan.mjs $B 480 480 mars mars/pr2/mars480 6,12,25,45,70,100 embed 2>&1
echo "### mars showcase flicker 1280"
node flicker-det.mjs $B 1280 720 mars/flk-mars1280.json '&map=mars' 2>&1
echo "### mars showcase flicker 480"
node flicker-det.mjs $B 480 480 mars/flk-mars480.json '&map=mars' 2>&1
echo "### shots"
node mars-shots.mjs $B 1280 720 mars mars/pr2/mars1280 366,408 2>&1
node mars-shots.mjs $B 480 480 mars mars/pr2/mars480 366,408 embed 2>&1
echo "### done"
