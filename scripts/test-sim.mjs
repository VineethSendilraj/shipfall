// Sanity tests for the catch rules, scoring and determinism. Usage: npm test
import assert from 'node:assert/strict';
import { Game, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, DOUBLE_UNLOCK_SCORE, NO_INPUT } from '../src/sim.js';
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
  assert.equal(r.pts, 1000 + 500 + Math.round(r.g.boosters[0].fuel * 3));
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
