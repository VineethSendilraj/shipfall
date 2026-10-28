// Sanity tests for the catch rules, scoring and determinism. Usage: npm test
import assert from 'node:assert/strict';
import { Game, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, DOUBLE_UNLOCK_SCORE, NO_INPUT, BOOSTER, SHIP } from '../src/sim.js';
import { createDemoRunner } from '../src/demo.js';

function liveGame(seed = 7) {
  const g = new Game({ width: 1280, seed });
  g.start();
  while (g.phase !== 'live') g.step(NO_INPUT);
  return g;
}

/** A live double-catch round: the booster falling toward tower A, the ship waiting for tower B. */
function doubleRound(seed = 7) {
  const g = new Game({ width: 1280, seed });
  g.start();
  g.score = DOUBLE_UNLOCK_SCORE;
  g.boosters.length = 0;
  g.setPhase('outro');
  while (!(g.phase === 'live' && g.roundDouble)) g.step(NO_INPUT);
  return g;
}

function place(g, b, tw, { dy, dx, vy }) {
  tw.armY = 300;
  b.y = tw.armY + dy;
  b.x = tw.cx + dx;
  b.vy = vy * PX_PER_M;
  b.vx = 0;
}

function attempt(pos) {
  const g = liveGame();
  const b = g.boosters[0];
  const tw = g.towers[0];
  place(g, b, tw, pos);
  const before = g.score;
  g.evaluateCatch(tw);
  return { caught: b.state === 'caught', state: b.state, pts: g.score - before, g };
}

/** The same attempt on the ship at tower B, after a clean catch of the booster at tower A. */
function attemptShip(pos) {
  const g = doubleRound();
  const [booster, ship] = g.boosters;
  place(g, booster, g.towers[0], { dy: 0, dx: 0, vy: 1 });
  g.evaluateCatch(g.towers[0]);
  assert.equal(booster.state, 'caught');
  ship.state = 'falling';
  const tw = g.towers[1];
  place(g, ship, tw, pos);
  const before = g.score;
  g.evaluateCatch(tw);
  return { caught: ship.state === 'caught', state: ship.state, pts: g.score - before, g };
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
test('single rounds are boosters; double rounds add the ship at tower B', () => {
  assert.deepEqual(liveGame().boosters.map((b) => b.kind), ['booster']);
  const g = doubleRound();
  assert.deepEqual(g.boosters.map((b) => [b.kind, b.tower]), [['booster', 0], ['ship', 1]]);
  assert.match(g.banner.sub, /ship/);
});
test('the ship is caught at tower B with the booster tolerances', () => {
  const r = attemptShip({ dy: 0, dx: 0, vy: 1 });
  assert.equal(r.caught, true);
  assert.equal(r.pts, 1000 + 500 + Math.round(r.g.boosters[1].fuel * 3) + 500, 'catch + double bonus');
  assert.equal(r.g.stats.doubles, 1);
  assert.equal(attemptShip({ dy: CATCH_TOL_Y, dx: 0, vy: 1 }).caught, true);
  assert.equal(attemptShip({ dy: -CATCH_TOL_Y - 0.5, dx: 0, vy: 1 }).caught, false);
  assert.equal(attemptShip({ dy: 0, dx: CATCH_TOL_X, vy: 1 }).caught, false);
  assert.equal(attemptShip({ dy: 0, dx: 0, vy: 3 }).caught, false);
});
test("arms below the ship's engines whiff where a booster would clang", () => {
  const dy = -(SHIP.bottom + 40);
  assert.ok(-dy < BOOSTER.bottom);
  assert.equal(attempt({ dy, dx: 0, vy: 1 }).state, 'tumbling');
  const r = attemptShip({ dy, dx: 0, vy: 1 });
  assert.equal(r.state, 'falling');
  assert.equal(r.g.lives, 3);
  assert.equal(attemptShip({ dy: -(SHIP.bottom - 20), dx: 0, vy: 1 }).state, 'tumbling');
});
test('the ship lights its landing burn with its pins where a booster does', () => {
  const ignitionY = (kind) => {
    const g = doubleRound();
    const b = g.boosters.find((x) => x.kind === kind);
    g.boosters = [b];
    Object.assign(b, { state: 'falling', tower: kind === 'ship' ? 1 : 0, y: -270, vy: 180, vx: 0, burning: false });
    while (!b.burning) g.step(NO_INPUT);
    return { y: b.y, alt: g.altitudeM(b) };
  };
  const booster = ignitionY('booster');
  const ship = ignitionY('ship');
  assert.equal(ship.y, booster.y);
  assert.ok(ship.alt > booster.alt + 25, 'the ship is shorter below its pins');
});
test('an unattended ship crashes into the pad and costs a life', () => {
  const g = doubleRound(5);
  const ship = g.boosters[1];
  g.boosters = [ship];
  ship.state = 'falling';
  let guard = 0;
  while (ship.state === 'falling' && guard++ < 6000) g.step(NO_INPUT);
  assert.equal(ship.state, 'crashed');
  assert.ok(ship.y + SHIP.bottom >= 690 - 1);
  assert.equal(g.lives, 2);
});
test('demo is deterministic and catches everything, the ship last', () => {
  const runs = [0, 1].map(() => {
    const r = createDemoRunner();
    const caught = [];
    while (!r.done) {
      r.step();
      for (const e of r.game.events) if (e.type === 'catch') caught.push(e.kind);
    }
    return { score: r.game.score, frame: r.frame, stats: JSON.stringify(r.game.stats), caught: caught.join() };
  });
  assert.deepEqual(runs[0], runs[1]);
  assert.equal(runs[0].stats, JSON.stringify({ catches: 4, perfects: 3, misses: 0, doubles: 1 }));
  assert.equal(runs[0].caught, 'booster,booster,booster,ship');
  const secs = runs[0].frame / 60;
  assert.ok(secs > 20 && secs < 40, `demo length ${secs}s`);
});
console.log(`\n${n} tests passed`);
