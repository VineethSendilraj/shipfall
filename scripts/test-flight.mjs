// Tests for the free-flight model: liftoff, the flight computer, touchdown rules, fuel and determinism.
// Usage: npm test
import assert from 'node:assert/strict';
import { Flight, FLIGHT, DEFAULT_MOUNT, landingVerdict, towerColliders, NO_FLIGHT_INPUT } from '../src/flight.js';
import { towerPositions, PX_PER_M } from '../src/sim.js';
import { pilot } from './flight-pilot.mjs';

const DEG = Math.PI / 180;
const CLIMB = Object.freeze({ climb: 1, yaw: 0, fwd: 0, right: 0 });
const SINK = Object.freeze({ climb: -1, yaw: 0, fwd: 0, right: 0 });
const towerX = (px) => (px - 640) / PX_PER_M;

function siteColliders() {
  const { a, b } = towerPositions(1280);
  return [...towerColliders(towerX(a), -1, 90), ...towerColliders(towerX(b), 1, 90)];
}

/** Steps until done(f) or the frame limit; returns the frames taken. */
function run(f, input, done, limit = 60 * 600) {
  for (let i = 0; i < limit; i++) {
    if (done(f)) return i;
    f.step(typeof input === 'function' ? input(f) : input);
  }
  throw new Error(`still not done after ${limit} frames (phase ${f.phase}, y ${f.lowY.toFixed(1)})`);
}

const flying = (f) => f.phase !== 'flying' && f.phase !== 'ready';

/** Lifts off and climbs to a base height of `alt`, then hovers there for a moment. */
function liftTo(f, alt) {
  run(f, CLIMB, (x) => x.lowY >= alt);
  run(f, NO_FLIGHT_INPUT, (x) => Math.abs(x.vel.y) < 0.3 && x.frame > 0, 60 * 30);
  return f;
}

let n = 0;
const test = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

test('the stack waits on the launch mount until W lights the engines', () => {
  const f = new Flight();
  const y = f.pos.y;
  for (let i = 0; i < 300; i++) f.step(NO_FLIGHT_INPUT);
  assert.equal(f.phase, 'ready');
  assert.equal(f.pos.y, y);
  assert.equal(f.throttle, 0);
  assert.equal(f.fuel, 100);
  assert.ok(Math.abs(f.lowY - DEFAULT_MOUNT.top) < 1e-9, 'skirt rests on the ring top');
});

test('liftoff needs thrust: the engines spool up and the clamps hold until thrust beats the weight', () => {
  const f = new Flight();
  f.step(CLIMB);
  assert.equal(f.engines, true);
  assert.ok(f.throttle > 0 && f.throttle < 0.05, `throttle spools, not snaps (${f.throttle})`);
  assert.equal(f.airborne, false);
  let liftoffFrame = -1;
  for (let i = 1; i < 240 && liftoffFrame < 0; i++) {
    f.step(CLIMB);
    if (f.events.some((e) => e.type === 'liftoff')) liftoffFrame = i;
  }
  assert.ok(liftoffFrame > 30, `held on the clamps while spooling (${liftoffFrame} frames)`);
  const thrustToWeight = f.throttle * FLIGHT.twr;
  assert.ok(thrustToWeight > FLIGHT.holdDown, `released above the hold-down (${thrustToWeight.toFixed(2)})`);
  for (let i = 0; i < 180; i++) f.step(CLIMB);
  assert.ok(f.lowY > DEFAULT_MOUNT.top + 10, `climbing (${f.lowY.toFixed(1)} m)`);
  assert.ok(f.vel.y > 5);
});

test('letting go of W before liftoff aborts and shuts the engines down', () => {
  const f = new Flight();
  for (let i = 0; i < 10; i++) f.step(CLIMB);
  for (let i = 0; i < 200; i++) f.step(NO_FLIGHT_INPUT);
  assert.equal(f.phase, 'ready');
  assert.equal(f.engines, false);
  assert.equal(f.airborne, false);
});

test('no input holds altitude; tilt never passes 20 degrees', () => {
  const f = liftTo(new Flight(), 120);
  const y = f.pos.y;
  let maxTilt = 0;
  for (let i = 0; i < 600; i++) {
    f.step(NO_FLIGHT_INPUT);
    maxTilt = Math.max(maxTilt, f.tilt);
  }
  assert.ok(Math.abs(f.pos.y - y) < 1, `altitude hold drift ${(f.pos.y - y).toFixed(2)} m`);
  for (let i = 0; i < 60 * 20; i++) {
    f.step({ climb: 0, yaw: 0.6, fwd: 1, right: 1 });
    maxTilt = Math.max(maxTilt, f.tilt);
  }
  assert.ok(maxTilt <= FLIGHT.tiltMax + 1e-6, `max tilt ${(maxTilt / DEG).toFixed(2)} deg`);
});

test('arrows fly relative to the heading, with a sane top speed, and letting go brakes to a hover', () => {
  const f = liftTo(new Flight(), 200);
  const z0 = f.pos.z;
  for (let i = 0; i < 60 * 40; i++) f.step({ climb: 0, yaw: 0, fwd: 1, right: 0 });
  const vh = Math.hypot(f.vel.x, f.vel.z);
  assert.ok(vh > 34 && vh <= FLIGHT.vMax + 0.5, `top speed ${vh.toFixed(1)} m/s`);
  assert.ok(f.pos.z < z0 - 800, 'yaw 0 flies toward -z');
  assert.ok(Math.abs(f.vel.x) < 0.5, 'no sideways drift');
  for (let i = 0; i < 60 * 25; i++) f.step(NO_FLIGHT_INPUT);
  assert.ok(Math.hypot(f.vel.x, f.vel.z) < 0.5, 'brakes to a hover');
  assert.ok(f.tilt < 1 * DEG, 'levels itself');
});

test('A and D turn the heading; right then flies along the new right vector', () => {
  const f = liftTo(new Flight(), 150);
  for (let i = 0; i < 60 * 3; i++) f.step({ climb: 0, yaw: -1, fwd: 0, right: 0 });
  assert.ok(f.yaw > 1.5, `A turns left (yaw ${f.yaw.toFixed(2)})`);
  const x0 = f.pos.x;
  const z0 = f.pos.z;
  for (let i = 0; i < 60 * 8; i++) f.step({ climb: 0, yaw: 0, fwd: 0, right: 1 });
  const dx = f.pos.x - x0;
  const dz = f.pos.z - z0;
  const rx = Math.cos(f.yaw);
  const rz = -Math.sin(f.yaw);
  assert.ok((dx * rx + dz * rz) / Math.hypot(dx, dz) > 0.98, 'moved along the right vector');
});

test('touchdown limits: under 3 m/s down, 2 m/s sideways and 5 degrees of tilt', () => {
  assert.equal(landingVerdict(2.99, 1.99, 4.99 * DEG), null);
  assert.equal(landingVerdict(3, 0, 0), 'hard');
  assert.equal(landingVerdict(0.5, 2, 0), 'slide');
  assert.equal(landingVerdict(0.5, 0, 5 * DEG), 'tilt');
});

test('holding S from a hover lands softly back on the launch mount', () => {
  const f = liftTo(new Flight(), 90);
  run(f, SINK, flying);
  assert.equal(f.phase, 'landed');
  assert.equal(f.result.onMount, true);
  assert.equal(f.result.title, 'Landed back on the launch mount');
  assert.ok(f.stats.touchdown < 2, `touchdown ${f.stats.touchdown.toFixed(2)} m/s`);
  assert.ok(f.stats.offset < 1, `offset ${f.stats.offset.toFixed(2)} m`);
  assert.ok(Math.abs(f.lowY - DEFAULT_MOUNT.top) < 1e-6, 'resting on the ring top');
  assert.ok(f.events.some((e) => e.type === 'land' && e.onMount));
  const t = f.clock;
  for (let i = 0; i < 120; i++) f.step(CLIMB);
  assert.equal(f.phase, 'landed', 'a landing ends the flight');
  assert.equal(f.clock, t, 'clock stops at touchdown');
});

test('fly out over the site, come back and land on the mount', () => {
  const f = liftTo(new Flight({ colliders: siteColliders() }), 120);
  run(f, (x) => pilot(x, { x: 250, z: -350, alt: 140 }), (x) => Math.hypot(x.base.x - 250, x.base.z + 350) < 5);
  run(f, (x) => pilot(x, { x: DEFAULT_MOUNT.x, z: DEFAULT_MOUNT.z, alt: 80, land: true }), flying);
  assert.equal(f.phase, 'landed', f.result?.reason);
  assert.equal(f.result.onMount, true);
  assert.ok(f.stats.dist > 900, `distance flown ${f.stats.dist.toFixed(0)} m`);
  assert.ok(f.stats.maxAlt > 135);
});

test('a landing on open ground counts, but not as a landing on the mount', () => {
  const f = liftTo(new Flight({ colliders: siteColliders() }), 80);
  run(f, (x) => pilot(x, { x: -150, z: -170, alt: 80, land: true }), flying);
  assert.equal(f.phase, 'landed', f.result?.reason);
  assert.equal(f.result.onMount, false);
  assert.equal(f.result.title, 'Landed');
  assert.ok(f.lowY < 1e-6);
});

test('setting down on the rim of the mount is a crash', () => {
  const f = liftTo(new Flight(), 60);
  run(f, (x) => pilot(x, { x: DEFAULT_MOUNT.x + 12, z: DEFAULT_MOUNT.z, alt: 60, land: true }), flying);
  assert.equal(f.phase, 'crashed');
  assert.equal(f.result.kind, 'edge');
});

test('sinking onto the ground while flying fast is a crash', () => {
  const f = liftTo(new Flight(), 60);
  run(f, { climb: 0, yaw: 0, fwd: 1, right: 0 }, (x) => Math.hypot(x.vel.x, x.vel.z) > 25);
  run(f, { climb: -1, yaw: 0, fwd: 1, right: 0 }, flying);
  assert.equal(f.phase, 'crashed');
  assert.ok(['slide', 'tilt'].includes(f.result.kind), f.result.kind);
  assert.equal(f.result.title, 'Rapid unscheduled disassembly');
});

test('flying into the tower is a crash', () => {
  const f = liftTo(new Flight({ colliders: siteColliders() }), 70);
  const tx = towerX(towerPositions(1280).a);
  run(f, (x) => pilot(x, { x: tx, z: 0, alt: 70 }), flying);
  assert.equal(f.phase, 'crashed');
  assert.equal(f.result.kind, 'tower');
  assert.ok(f.events.some((e) => e.type === 'crash' && e.kind === 'tower'));
});

test('an empty tank shuts the engines down, then the stack falls and crashes', () => {
  const f = liftTo(new Flight(), 150);
  f.fuel = 1;
  let out = -1;
  run(
    f,
    (x) => {
      if (out < 0 && x.events.some((e) => e.type === 'enginesOut')) out = x.frame;
      return NO_FLIGHT_INPUT;
    },
    flying,
  );
  assert.ok(out > 0, 'engines out event');
  assert.equal(f.engines, false);
  assert.equal(f.phase, 'crashed');
  assert.equal(f.result.kind, 'hard');
  assert.match(f.result.reason, /^out of fuel/);
  assert.equal(f.stats.fuel, 0);
});

test('a full tank hovers for about three minutes', () => {
  const f = liftTo(new Flight(), 60);
  const fuel0 = f.fuel;
  for (let i = 0; i < 60 * 60; i++) f.step(NO_FLIGHT_INPUT);
  const perMin = fuel0 - f.fuel;
  assert.ok(Math.abs(perMin - 100 / 3) < 1.5, `${perMin.toFixed(2)} % per minute at hover`);
});

test('the flight computer warns, then turns back at the edge of the site', () => {
  const f = liftTo(new Flight(), 120);
  let warned = false;
  let maxD = 0;
  for (let i = 0; i < 60 * 110; i++) {
    f.step({ climb: 0, yaw: 0, fwd: 1, right: 0 });
    warned ||= f.warn === 'fence';
    maxD = Math.max(maxD, Math.hypot(f.pos.x - DEFAULT_MOUNT.x, f.pos.z - DEFAULT_MOUNT.z));
  }
  assert.ok(warned, 'RETURN TO THE SITE warning');
  assert.ok(maxD < FLIGHT.fence + 80, `stayed inside the fence (${maxD.toFixed(0)} m)`);
});

test('the flight computer stops climbing at the ceiling', () => {
  const f = new Flight();
  for (let i = 0; i < 60 * 100; i++) f.step(CLIMB);
  assert.ok(f.pos.y <= FLIGHT.ceiling + 2, `ceiling ${f.pos.y.toFixed(1)}`);
  assert.ok(f.pos.y > FLIGHT.ceiling - 10);
});

test('free flight is deterministic for the same inputs', () => {
  const fly = () => {
    const f = liftTo(new Flight({ colliders: siteColliders() }), 100);
    run(f, (x) => pilot(x, { x: -200, z: 120, alt: 160, yawTo: 1.2 }), (x) => x.frame > 60 * 40);
    run(f, (x) => pilot(x, { x: DEFAULT_MOUNT.x, z: DEFAULT_MOUNT.z, alt: 70, land: true }), flying);
    return JSON.stringify({ pos: f.pos, vel: f.vel, lean: f.lean, yaw: f.yaw, stats: f.stats, result: f.result, frame: f.frame, fuel: f.fuel });
  };
  assert.equal(fly(), fly());
});

console.log(`\n${n} tests passed`);
