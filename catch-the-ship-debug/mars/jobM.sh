#!/bin/bash
# Catch-window flicker vs the Mars key light's elevation and intensity (page tweaks, no code change).
cd ~/dev/scratch/catch-the-ship-debug || exit 1
B=http://localhost:41772
el() { # elevation degrees, intensity
  echo "const l = window.__view.world.keyLight; const V = l.position.constructor; const e = $1 * Math.PI / 180; const d = new V(0.259, 0, -0.966).multiplyScalar(Math.cos(e)); d.y = Math.sin(e); l.position.copy(l.target.position).addScaledVector(d, 700); l.intensity = $2;"
}
for cfg in "7 2.7" "7 1.6" "12 2.7" "15 2.7" "20 2.7" "15 2.2"; do
  set -- $cfg
  echo "### elevation $1 intensity $2"
  node flk-window.mjs $B 1280 720 '&map=mars' 440-520,880-930 "$(el $1 $2)" 2>&1
done
echo "### done"
