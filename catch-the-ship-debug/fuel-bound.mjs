// Fine sweep over the round parameters the game can roll: the most fuel a booster can have at the first frame it is
// catchable, and the best points a single catch could score (1000 + precision + fuel bonus) for a fuel multiplier.
// Usage: node fuel-bound.mjs <path to sim.js> [fuel bonus per %]
import { pathToFileURL } from 'node:url';

const [simPath, kArg = '6.5'] = process.argv.slice(2);
const K = Number(kArg);
const { Game, NO_INPUT, PX_PER_M, CATCH_MAX_VY, ARM_MIN, ARM_MAX } = await import(pathToFileURL(simPath).href);

let maxFuel = { v: -1 };
let maxPts = { v: -1 };
let minCut = { v: 1e9 };
for (let d = 0; d <= 9; d++) {
  for (let zeroY = ARM_MIN + 30; zeroY < ARM_MAX - 15; zeroY += 5) {
    for (let jit = -8; jit < 8; jit += 1) {
      const booster = { zeroY, spawnDx: 0, vx0: 0, vy0: (44 + d * 3.5) * PX_PER_M + jit };
      const g = new Game({ width: 1280, seed: 7, overrides: { [d + 1]: { boosters: [booster], wind: { base: 0, gusts: [] } } } });
      g.round = d;
      g.beginRound();
      while (g.phase !== 'live') g.step(NO_INPUT);
      const b = g.boosters[0];
      let first = true;
      while (b.state === 'falling') {
        const was = b.burning;
        g.step(NO_INPUT);
        const vy = b.vy / PX_PER_M;
        if (b.burning && vy < CATCH_MAX_VY) {
          if (first && b.fuel > maxFuel.v) maxFuel = { v: b.fuel, d, zeroY, jit };
          first = false;
          // Best case at this frame: pins dead on the arms, so precision only loses the descent-rate term.
          const ev = Math.max(0, vy - 1) / (CATCH_MAX_VY - 1);
          const pts = 1000 + Math.round(500 * (1 - 0.2 * ev)) + Math.round(b.fuel * K);
          if (pts > maxPts.v) maxPts = { v: pts, d, zeroY, jit, fuel: b.fuel, vy };
        }
        if (was && !b.burning && b.fuel < minCut.v) minCut = { v: b.fuel, d, zeroY, jit };
      }
    }
  }
}
console.log(`most fuel at the first catchable frame: ${maxFuel.v.toFixed(2)}% (d=${maxFuel.d} zeroY=${maxFuel.zeroY} jit=${maxFuel.jit}) -> fuel bonus ${Math.round(maxFuel.v * K)} at ${K} per %`);
console.log(`best single catch: ${maxPts.v} pts (d=${maxPts.d} zeroY=${maxPts.zeroY} jit=${maxPts.jit} fuel=${maxPts.fuel.toFixed(1)} vy=${maxPts.vy.toFixed(2)})`);
console.log(`least fuel left at a no-steer cutoff: ${minCut.v.toFixed(2)}% (d=${minCut.d} zeroY=${minCut.zeroY} jit=${minCut.jit})`);
