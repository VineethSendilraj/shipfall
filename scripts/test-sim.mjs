// Sanity tests for the catch rules, scoring and determinism. Usage: npm test
import assert from 'node:assert/strict';
import { Game, DT, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, CATCH_MAX_VY, DOUBLE_UNLOCK_SCORE, NO_INPUT, BOOSTER, SHIP } from '../src/sim.js';
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
test('single rounds are boosters; double rounds add the ship at tower B', () => {
  assert.deepEqual(liveGame().boosters.map((b) => b.kind), ['booster']);
  const g = doubleRound();
  assert.deepEqual(g.boosters.map((b) => [b.kind, b.tower]), [['booster', 0], ['ship', 1]]);
  assert.match(g.banner.sub, /ship/);
});
test('the ship is caught at tower B with the booster tolerances', () => {
  const r = attemptShip({ dy: 0, dx: 0, vy: 1 });
  assert.equal(r.caught, true);
  assert.equal(r.pts, 1000 + 500 + Math.round(r.g.boosters[1].fuel * 6.5) + 500, 'catch + double bonus');
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
