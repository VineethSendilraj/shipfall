#!/bin/zsh
# Flash scans for the lamp variants, one headless Chrome at a time.
cd /Users/vsendilraj/dev/scratch/catch-the-ship-debug
B=http://127.0.0.1:41830
NOLAMP=1 TAG=r2-nolamp node explore-flash.mjs $B 1280 720 high > flash-r2-nolamp.log 2>&1
TAG=r2-cur node explore-flash.mjs $B 1280 720 high > flash-r2-cur.log 2>&1
LAMP='{"K":1.5,"off":"clear"}' TAG=r2-k15c node explore-flash.mjs $B 1280 720 high > flash-r2-k15c.log 2>&1
LAMP='{"K":2,"off":"clear"}' TAG=r2-k2c node explore-flash.mjs $B 1280 720 high > flash-r2-k2c.log 2>&1
LAMP='{"K":1.5,"off":"reach"}' TAG=r2-k15r node explore-flash.mjs $B 1280 720 high > flash-r2-k15r.log 2>&1
LAMP='{"K":1,"off":"reach"}' TAG=r2-k1r node explore-flash.mjs $B 1280 720 high > flash-r2-k1r.log 2>&1
echo LAMPSCANS_DONE
