// Free flight: the scripted pilot flies the whole mission, bad flying fails, and runs replay exactly. Usage: npm test
import assert from 'node:assert/strict';
import { Flight, SATS, LAND, SITE_X, MOUNT_TOP, R, local } from '../src/flight.js';
import { createFlightPilot } from '../src/flight-pilot.js';

const NONE = { left: false, right: false, up: false, down: false, close: false };

/** Flies to the end with `pilot(f)` as the input; returns the flight and its events with real time. */
function fly(pilot, maxReal = 1200) {
  const f = new Flight({ seed: 1 });
  const log = [];
  while (f.phase !== 'over' && f.real < maxReal) {
    f.step(pilot(f));
    for (const e of f.events) log.push({ type: e.type, real: f.real });
  }
  return { f, log };
}

/** A flight that starts in the landing burn, `h` meters over the ground `d` meters from the site. */
function landing({ h = 400, d = 0, vr = -45 } = {}) {
  const f = new Flight({ seed: 1 });
  f.phase = 'flight';
  f.t = 900;
  f.marks.orbit = 80;
  f.booster.state = 'parked';
  Object.assign(f.ship, { x: SITE_X + d, y: h + (Math.abs(d) < LAND.edge ? MOUNT_TOP : 0), vx: 0, vy: vr, ang: Math.PI / 2, mode: 'landing', sats: 0, prop: 20e3 });
  return f;
}

function land(f, input = () => NONE) {
  while (f.phase !== 'over' && f.real < 120) f.step(input(f));
  return f.outcome;
}

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

const mission = fly(createFlightPilot());
const at = (type) => mission.log.find((e) => e.type === type);

test('the scripted pilot reaches orbit 60 to 90 s after liftoff', () => {
  const t = mission.f.marks.orbit;
  assert.ok(t > 60 && t < 90, `orbit at T+${t}`);
});
test('the pilot deploys all ten satellites', () => {
  assert.equal(mission.f.stats.deployed, SATS);
  assert.equal(mission.log.filter((e) => e.type === 'deploy').length, SATS);
});
test('the booster flies home and the tower catches it', () => {
  assert.equal(mission.f.stats.boosterCaught, true);
});
test('the ship lands on the mount within tolerance', () => {
  const o = mission.f.outcome;
  assert.equal(o.ok, true, o.reason);
  assert.ok(o.dist < LAND.r, `${o.dist} m from center`);
  assert.ok(o.speed < LAND.maxVs, `${o.speed} m/s`);
});
test('mission events come in order', () => {
  const order = ['liftoff', 'maxq', 'stage', 'catch', 'deorbit', 'reentry', 'flip', 'landed'].map((t) => mission.log.findIndex((e) => e.type === t));
  assert.ok(order.every((i) => i >= 0), JSON.stringify(order));
  const orbit = mission.log.findIndex((e) => e.type === 'orbit');
  const firstDeploy = mission.log.findIndex((e) => e.type === 'deploy');
  assert.ok(order[2] < orbit && orbit < firstDeploy && firstDeploy < order[4], 'stage, orbit, deploy, deorbit');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test('deorbit to touchdown takes about 60 to 90 s of real time', () => {
  const secs = at('landed').real - at('deorbit').real;
  assert.ok(secs > 60 && secs < 95, `${secs.toFixed(1)} s`);
});
test('full throttle straight up never reaches orbit and comes back down', () => {
  let first = true;
  const { f } = fly(() => {
    const input = { ...NONE, up: true, close: first };
    first = false;
    return input;
  });
  assert.equal(f.marks.orbit, undefined);
  assert.equal(f.phase, 'over');
  assert.equal(f.outcome.ok, false);
  assert.ok(!f.outcome.lost, f.outcome.reason);
  assert.ok(f.stats.maxAlt > 100e3, `apex ${f.stats.maxAlt}`);
  assert.ok(local(f.ship.x, f.ship.y).alt < 100, 'the wreck is on the ground');
});
test('a hands-off landing burn over the mount touches down softly', () => {
  const o = land(landing());
  assert.equal(o.ok, true, o.reason);
});
test('holding down through the landing burn is a hard landing and a crash', () => {
  const f = landing();
  const o = land(f, () => ({ ...NONE, down: true }));
  assert.equal(o.ok, false);
  assert.match(o.reason, /hard landing/);
  assert.equal(f.ship.mode, 'crashed');
});
test('touching down beside the mount is a miss', () => {
  const o = land(landing({ d: -200 }));
  assert.equal(o.ok, false);
  assert.match(o.reason, /missed the mount/);
});
test('steering moves the touchdown point: right is east', () => {
  // Steer for the first second of thrust, then let the auto damping stop the drift.
  const touchdown = (key) => {
    const f = landing();
    let n = 0;
    land(f, (f) => (f.ship.throttle > 0 && n++ < 60 ? { ...NONE, [key]: true } : NONE));
    return local(f.ship.x, f.ship.y).phi * R;
  };
  const right = touchdown('right');
  const left = touchdown('left');
  assert.ok(right > 1 && left < -1, `right ${right} m, left ${left} m`);
});
test('same inputs give the same flight', () => {
  const again = fly(createFlightPilot());
  const state = ({ f, log }) => JSON.stringify({ frame: f.frame, t: f.t, ship: f.ship, booster: f.booster, outcome: f.outcome, marks: f.marks, log });
  assert.equal(state(again), state(mission));
});
console.log(`\n${n} tests passed`);
