// Sanity tests for the catch rules, scoring and determinism. Usage: npm test
import assert from 'node:assert/strict';
import { Game, DT, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, CATCH_MAX_VY, DOUBLE_UNLOCK_SCORE, NO_INPUT } from '../src/sim.js';
import { createDemoRunner } from '../src/demo.js';

function liveGame(seed = 7) {
  const g = new Game({ width: 1280, seed });
  g.start();
  while (g.phase !== 'live') g.step(NO_INPUT);
  return g;
}

function attempt({ dy, dx, vy }) {
  const g = liveGame();
  const b = g.boosters[0];
  const tw = g.towers[0];
  tw.armY = 300;
  b.y = tw.armY + dy;
  b.x = tw.cx + dx;
  b.vy = vy * PX_PER_M;
  b.vx = 0;
  const before = g.score;
  g.evaluateCatch(tw);
  return { caught: b.state === 'caught', state: b.state, pts: g.score - before, g };
}

function calmRound1(booster) {
  const g = new Game({ width: 1280, seed: 7, overrides: { 1: { boosters: [{ spawnDx: 0, vx0: 0, ...booster }], wind: { base: 0, gusts: [] } } } });
  g.start();
  while (g.phase !== 'live') g.step(NO_INPUT);
  return g;
}

/** Flies round 1 from over the tower with the arms parked across the hover; steer(frame, booster) returns -1, 0 or 1. */
function approach(steer, fuel = 100) {
  const g = calmRound1({ zeroY: 300 });
  const b = g.boosters[0];
  const tw = g.towers[0];
  b.fuel = fuel;
  tw.armY = b.zeroY + 10;
  let open = 0;
  let cutoff = null;
  for (let f = 0; b.state === 'falling'; f++) {
    const dir = steer(f, b);
    g.step({ ...NO_INPUT, left: dir < 0, right: dir > 0 });
    if (tw.ready) open++;
    if (b.cutoff && !cutoff) cutoff = { text: g.popups.find((p) => /CUTOFF|DEPLETED/.test(p.text)).text, early: b.y < b.zeroY + b.hoverLen };
  }
  return { secs: open * DT, cutoff, g };
}
const still = () => 0;
// Left, right, right, left: spends fuel without drifting off the tower.
const pulse = (f) => [-1, 1, 1, -1][Math.floor(f / 6) % 4];
const hoverSteer = (f, b) => (b.burning && b.vy < CATCH_MAX_VY * PX_PER_M ? pulse(f) : 0);

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

test('centered, slow catch succeeds with full precision', () => {
  const r = attempt({ dy: 0, dx: 0, vy: 1 });
  assert.equal(r.caught, true);
  assert.ok(r.pts >= 1500);
});
test('vertical tolerance is ±12 px inclusive', () => {
  assert.equal(attempt({ dy: CATCH_TOL_Y, dx: 0, vy: 1 }).caught, true);
  assert.equal(attempt({ dy: -CATCH_TOL_Y, dx: 0, vy: 1 }).caught, true);
  assert.equal(attempt({ dy: CATCH_TOL_Y + 0.5, dx: 0, vy: 1 }).caught, false);
});
test('lateral offset must be < 15 px', () => {
  assert.equal(attempt({ dy: 0, dx: CATCH_TOL_X - 0.5, vy: 1 }).caught, true);
  assert.equal(attempt({ dy: 0, dx: -CATCH_TOL_X, vy: 1 }).caught, false);
});
test('vertical speed must be < 3 m/s', () => {
  assert.equal(attempt({ dy: 0, dx: 0, vy: 2.95 }).caught, true);
  assert.equal(attempt({ dy: 0, dx: 0, vy: 3 }).caught, false);
});
test('closing on the body is a clang miss and costs a life', () => {
  const r = attempt({ dy: -80, dx: 0, vy: 1 });
  assert.equal(r.state, 'tumbling');
  assert.equal(r.g.lives, 2);
});
test('closing on empty air is a harmless whiff', () => {
  const r = attempt({ dy: 400, dx: 0, vy: 1 });
  assert.equal(r.state, 'falling');
  assert.equal(r.g.lives, 3);
});
test('score = 1000 + precision (<=500) + fuel bonus', () => {
  const r = attempt({ dy: 0, dx: 0, vy: 1 });
  assert.equal(r.pts, 1000 + 500 + Math.round(r.g.boosters[0].fuel * 6.5));
});
test('the fuel bonus tops out near +300, inside the leaderboard bound of 1,800 per catch', () => {
  // The most fuel a catch can have: round 1, highest catch height, slowest entry, no steering, caught at once.
  const g = calmRound1({ zeroY: 240, vy0: 168 });
  const b = g.boosters[0];
  const tw = g.towers[0];
  while (!(b.burning && b.vy < CATCH_MAX_VY * PX_PER_M)) g.step(NO_INPUT);
  tw.armY = b.y;
  g.evaluateCatch(tw);
  const fuelBonus = Number(/fuel \+(\d+)/.exec(g.popups.at(-1).text)[1]);
  assert.ok(fuelBonus > 250 && fuelBonus <= 300, `fuel +${fuelBonus}`);
  assert.ok(g.score <= 1800);
});
test('a pilot who never steers keeps the full catch window', () => {
  const unlimited = approach(still, Infinity).secs;
  const r = approach(still);
  assert.ok(unlimited > 4 && r.secs >= unlimited - 0.05, `${r.secs} s of ${unlimited} s`);
  assert.deepEqual(r.cutoff, { text: 'ENGINE CUTOFF', early: false });
});
test('3.85 s of lateral thrust leaves about half the window', () => {
  const unlimited = approach(still, Infinity).secs;
  const r = approach((f) => (f < 231 ? pulse(f) : 0));
  assert.ok(r.secs > 0.35 * unlimited && r.secs < 0.7 * unlimited, `${r.secs} s of ${unlimited} s`);
});
test('steering through the hover empties the tank: early cutoff, then the booster falls', () => {
  const r = approach(hoverSteer);
  assert.deepEqual(r.cutoff, { text: 'FUEL DEPLETED', early: true });
  assert.equal(r.g.boosters[0].state, 'crashed');
  assert.equal(r.g.lives, 2);
});
test('the same inputs give the same flight, fuel and score', () => {
  const run = () => {
    const { g } = approach(hoverSteer);
    const b = g.boosters[0];
    return [g.frame, b.x, b.y, b.fuel, g.score];
  };
  assert.deepEqual(run(), run());
});
test('an unattended booster crashes into the pad', () => {
  const g = liveGame(3);
  let guard = 0;
  while (g.boosters[0].state === 'falling' && guard++ < 6000) g.step(NO_INPUT);
  assert.equal(g.boosters[0].state, 'crashed');
  assert.equal(g.lives, 2);
});
test('double catch unlocks at 3000 points', () => {
  const g = liveGame();
  g.score = DOUBLE_UNLOCK_SCORE;
  g.boosters.length = 0;
  g.setPhase('outro');
  for (let i = 0; i < 200; i++) g.step(NO_INPUT);
  assert.equal(g.doubleUnlocked, true);
  assert.equal(g.towers.length, 2);
});
test('demo is deterministic and catches everything', () => {
  const runs = [0, 1].map(() => {
    const r = createDemoRunner();
    while (!r.done) r.step();
    return { score: r.game.score, frame: r.frame, stats: JSON.stringify(r.game.stats) };
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.equal(runs[0].stats, JSON.stringify({ catches: 4, perfects: 3, misses: 0, doubles: 1 }));
  const secs = runs[0].frame / 60;
  assert.ok(secs > 20 && secs < 40, `demo length ${secs}s`);
});
console.log(`\n${n} tests passed`);
