// Vertical-axis model of the landing burn (mirrors Game.updateFalling): time to ignition, burn time, throttle integral.
// Usage: node fuel-model.mjs [worktree]
const wt = process.argv[2] || '/Users/vsendilraj/dev/scratch/catch-the-ship-hud';
const { G, DT, PX_PER_M, GROUND_Y, BOOSTER, BURN_ALT_M, ARM_MIN, ARM_MAX } = await import(`${wt}/src/sim.js`);
const A_BURN = 85;
const A_MAX = 135;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function burn({ vy0, zeroY, vHover, hoverLen }) {
  let y = -270, vy = vy0, burning = false, thr = 0, integ = 0, tBurn = 0, t = 0, tIgn = 0, integHover = 0;
  while (t < 30) {
    const alt = (GROUND_Y - (y + BOOSTER.bottom)) / PX_PER_M;
    let ay = G;
    if (!burning && alt <= BURN_ALT_M) { burning = true; tIgn = t; }
    if (burning && y > zeroY + hoverLen) break;
    if (burning) {
      const d = zeroY - y;
      const profile = d > 0 ? Math.sqrt(2 * A_BURN * d) : 0;
      const vt = Math.max(vHover, profile);
      const ff = profile > vHover ? A_BURN : 0;
      const acc = clamp(G + ff + 8 * (vy - vt), G * 0.3, G + A_MAX);
      thr += (acc / (G + A_MAX) - thr) * 0.35;
      ay = G - acc;
      integ += thr * DT;
      tBurn += DT;
      if (y < zeroY) integHover = integ;
    } else thr *= 0.8;
    vy += ay * DT;
    y += vy * DT;
    t += DT;
  }
  return { tIgn, tBurn, integ, integToZero: integHover };
}

console.log('d  zeroY  tIgn  tBurn  thr·s(full)  thr·s(to catch height)');
for (let d = 0; d <= 9; d++) {
  for (const zeroY of [ARM_MIN + 30, (ARM_MIN + ARM_MAX) / 2, ARM_MAX - 15]) {
    const p = { vy0: (44 + d * 3.5) * PX_PER_M, vHover: Math.min(2.6, 1.3 + d * 0.17) * PX_PER_M, hoverLen: Math.max(7, 22 - d * 2.2), zeroY };
    const r = burn(p);
    console.log(`${d}  ${zeroY.toFixed(0).padStart(5)}  ${r.tIgn.toFixed(2)}  ${r.tBurn.toFixed(2)}  ${r.integ.toFixed(3).padStart(10)}  ${r.integToZero.toFixed(3).padStart(10)}`);
  }
}
