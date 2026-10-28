// The round-window test's own measure (arms at zeroY + 10, 5 x 17 spawns per round), printed per round.
// Usage: node fuel-testmeasure.mjs <path to sim.js>
import { pathToFileURL } from 'node:url';

const { Game, DT, NO_INPUT } = await import(pathToFileURL(process.argv[2]).href);

function calmSpawn(round, u, v) {
  const g = new Game({ width: 1280, seed: 7, overrides: { [round]: { boosters: [{ spawnDx: 0, vx0: 0 }], wind: { base: 0, gusts: [] } } } });
  const { range } = g.rng;
  const draws = [u, v];
  g.rng.range = (lo, hi) => (draws.length ? lo + draws.shift() * (hi - lo) : range(lo, hi));
  g.round = round - 1;
  g.start();
  g.rng.range = range;
  while (g.phase !== 'live') g.step(NO_INPUT);
  return g;
}

function window(g) {
  const b = g.boosters[0];
  const tw = g.towers[0];
  tw.armY = b.zeroY + 10;
  let open = 0;
  while (b.state === 'falling') {
    g.step(NO_INPUT);
    if (tw.ready) open++;
  }
  return open * DT;
}

const shortest = [];
for (let round = 1; round <= 10; round++) {
  let secs = Infinity;
  for (let i = 0; i <= 4; i++) for (let k = 0; k <= 16; k++) secs = Math.min(secs, window(calmSpawn(round, i / 4, k / 16)));
  shortest.push(secs.toFixed(2));
}
console.log(`shortest window per round: ${shortest.join(', ')} s`);
