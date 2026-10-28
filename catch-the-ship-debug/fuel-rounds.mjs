// No-steer catch window per round, over every catch height and entry speed the sim can roll.
// The booster spawns over the tower in calm air: spawn offset, drift and wind only change how much a pilot must
// steer. The window is the time inside the catch tolerance with the arms at the best fixed height they can reach.
// Usage: node fuel-rounds.mjs <path to sim.js> [last round=8] [height steps=32] [speed steps=9] [--detail]
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const detail = args.includes('--detail');
// Flies the vehicle as the ship (its geometry, ignition altitude and crash height) instead of the booster.
const ship = args.includes('--ship');
const [simPath, lastArg = '8', hsArg = '32', vsArg = '9'] = args.filter((a) => !a.startsWith('--'));
const sim = await import(pathToFileURL(simPath).href);
const { Game, NO_INPUT, DT, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, CATCH_MAX_VY, ARM_MIN, ARM_MAX } = sim;
const MIN_WINDOW = 1.2;

/** Round `round` with its first two random draws (entry speed jitter, then catch height) pinned to fractions of their ranges. */
function setup(round, uSpeed, uHeight) {
  const g = new Game({ width: 1280, seed: 7, overrides: { [round]: { boosters: [{ spawnDx: 0, vx0: 0 }], wind: { base: 0, gusts: [] } } } });
  const draws = [uSpeed, uHeight];
  const range = g.rng.range;
  g.rng.range = (lo, hi) => (draws.length ? lo + draws.shift() * (hi - lo) : range(lo, hi));
  g.round = round - 1;
  g.beginRound();
  g.rng.range = range;
  while (g.phase !== 'live') g.step(NO_INPUT);
  if (ship) g.boosters[0].kind = 'ship';
  return g;
}

function fly(g) {
  const b = g.boosters[0];
  const tw = g.towers[0];
  const p = { vy0: b.vy, zeroY: b.zeroY, vHover: b.vHover, hoverLen: b.hoverLen };
  const tr = [];
  let ignY = null;
  let vZero = null;
  let reason = null;
  let fuelCut = null;
  let fuelSlow = null;
  while (b.state === 'falling' && tr.length < 4000) {
    const was = b.burning;
    const yPrev = b.y;
    g.step(NO_INPUT);
    // The ignition check reads the position from before this frame's move.
    if (!was && b.burning) ignY = yPrev;
    if (fuelSlow === null && b.burning && b.vy < CATCH_MAX_VY * PX_PER_M) fuelSlow = b.fuel;
    if (vZero === null && yPrev < b.zeroY && b.y >= b.zeroY) vZero = b.vy / PX_PER_M;
    if (was && !b.burning && reason === null) {
      reason = g.popups.find((q) => q.text === 'ENGINE CUTOFF' || q.text === 'FUEL DEPLETED')?.text ?? '?';
      fuelCut = b.fuel;
    }
    if (b.state !== 'falling') break;
    tr.push({ y: b.y, vy: b.vy / PX_PER_M, dx: b.x - tw.cx });
  }
  // Best fixed arm height: the most slow, aligned frames inside a +-CATCH_TOL_Y band whose centre the arms can reach.
  const ys = tr.filter((f) => f.vy < CATCH_MAX_VY && Math.abs(f.dx) < CATCH_TOL_X).map((f) => f.y).sort((a, c) => a - c);
  let best = 0;
  for (let i = 0, j = 0; i < ys.length; i++) {
    const arm = Math.min(ARM_MAX, Math.max(ARM_MIN, ys[i] + CATCH_TOL_Y));
    while (j < ys.length && ys[j] <= arm + CATCH_TOL_Y) j++;
    let n = 0;
    for (let k = i; k < j; k++) if (Math.abs(ys[k] - arm) <= CATCH_TOL_Y) n++;
    best = Math.max(best, n);
  }
  return { ...p, win: best * DT, ignY, vZero, reason, fuelCut, fuelSlow, end: b.state };
}

const pct = (xs, q) => xs[Math.min(xs.length - 1, Math.floor(q * (xs.length - 1) + 0.5))];
const f2 = (v) => (v === null || v === undefined || Number.isNaN(v) ? '   - ' : v.toFixed(2).padStart(5));
const last = Number(lastArg);
const hs = Number(hsArg);
const vs = Number(vsArg);
console.log(`round |   n   min  median  max | zero  <${MIN_WINDOW} | worst spawn (vy0 m/s, catch y px) | hover px @ m/s | cutoffs`);
const rows = [];
for (let round = 1; round <= last; round++) {
  const rs = [];
  for (let i = 0; i < vs; i++) for (let k = 0; k < hs; k++) rs.push(fly(setup(round, i / (vs - 1), k / (hs - 1))));
  const wins = rs.map((r) => r.win).sort((a, c) => a - c);
  const worst = rs.reduce((w, r) => (r.win < w.win ? r : w), rs[0]);
  const reasons = {};
  for (const r of rs) reasons[r.reason] = (reasons[r.reason] || 0) + 1;
  const zero = rs.filter((r) => r.win === 0).length;
  const under = rs.filter((r) => r.win < MIN_WINDOW).length;
  const fuelSlowMax = Math.max(...rs.map((r) => r.fuelSlow ?? 0));
  // Normal ignition is the first frame at or below BURN_ALT_M, which is y >= -22.
  const early = rs.filter((r) => r.ignY !== null && r.ignY < -22).length;
  rows.push({ round, n: rs.length, min: wins[0], median: pct(wins, 0.5), max: wins.at(-1), zero, under, early, fuelMin: Math.min(...rs.map((r) => r.fuelCut ?? 100)), fuelSlowMax, wins: rs.map((r) => r.win) });
  console.log(
    `${String(round).padStart(5)} | ${String(rs.length).padStart(3)} ${f2(wins[0])}  ${f2(pct(wins, 0.5))}  ${f2(wins.at(-1))} | ${String(zero).padStart(4)} ${String(under).padStart(5)} | ${f2(worst.vy0 / PX_PER_M)} ${worst.zeroY.toFixed(0).padStart(4)} win ${f2(worst.win)} | ${worst.hoverLen.toFixed(1).padStart(4)} @ ${(worst.vHover / PX_PER_M).toFixed(2)} | ${JSON.stringify(reasons)} fuel@cut min ${Math.min(...rs.map((r) => r.fuelCut ?? 100)).toFixed(1)} fuel@slow max ${fuelSlowMax.toFixed(1)} early ign ${early}`,
  );
  if (detail) {
    for (const r of rs.filter((x) => x.win < MIN_WINDOW).slice(0, 6)) {
      console.log(`        vy0 ${f2(r.vy0 / PX_PER_M)} zeroY ${r.zeroY.toFixed(0)} ign y ${f2(r.ignY)} v at zeroY ${f2(r.vZero)} m/s win ${f2(r.win)} ${r.reason} ${r.end}`);
    }
  }
}
console.log(`JSON ${JSON.stringify(rows)}`);
