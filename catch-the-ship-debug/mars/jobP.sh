#!/bin/bash
# Final checks on the committed branch (ee9ba37 on main bdf3ea2).
cd ~/dev/scratch/catch-the-ship-debug || exit 1
W=~/dev/scratch/catch-the-ship-mars
B=http://localhost:41772
M=http://localhost:41773
echo "### npm test"
(cd $W && npm test 2>&1 | grep -E "passed|failed|not ok" | head -10)
echo "### check:card"
(cd $W && npm run check:card 2>&1 | tail -3)
echo "### ident main vs branch"
node ident.mjs $M $B 1280 720 130,366,700,1000,1300,1500 2>&1
echo "### fps title"
node fps-ab.mjs 3 6 title $M/ $B/ "$B/?map=mars" 2>&1 | grep '^{'
echo "### fps flight"
node fps-ab.mjs 3 10 flight $M/ $B/ "$B/?map=mars" 2>&1 | grep '^{'
echo "### done"
