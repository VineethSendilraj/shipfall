// Free flight: the whole launch mission on a small planet. The stack lifts off the mount beside the tower and
// stages; the booster flies itself back to the tower's arms while the ship goes to orbit, deploys satellites,
// reenters belly first and lands back on the mount. Planar physics around the planet center in the catch game's
// world frame (meters, y up, the z = 0 plane), deterministic at the fixed step DT for a given input sequence with
// the catch game's input shape. The catch game's Game runs the particles and popups near the ground.
import { DT, PX_PER_M, GROUND_Y, NO_INPUT, ARM_REACH, TOWER_HALF, VEHICLES, towerPositions, Game } from './sim.js';

const WORLD_W = 1280;
const TOWER_PX = towerPositions(WORLD_W).a;
/** The launch mount sits on the catch lane, so the booster comes home to the arms right above it. */
export const SITE_X = (TOWER_PX - ARM_REACH - WORLD_W / 2) / PX_PER_M;
export const TOWER_X = (TOWER_PX - WORLD_W / 2) / PX_PER_M;
const TOWER_TOP = 148.5; // TOWER_H in three/tower.js
const TOWER_REACH = TOWER_HALF / PX_PER_M + 4.5;

export const R = 100000;
export const GM = 9.81 * R * R;
export const ATM_TOP = 8000;
/** The HUD calls it an orbit once the lowest point clears the air by this margin. */
export const ORBIT_PE = ATM_TOP + 1500;
const SCALE_H = 1000;
const RHO0 = 1.6;

export const MOUNT_TOP = 22.25;
export const BOOSTER_TOP = 12; // hot-stage ring above the booster's catch point
export const BOOSTER_BASE = 64.8; // aft skirt below the catch point
const BOOSTER_BELLS = 67.6;
export const SHIP_H = 50;
const BODY_R = 4.5;
export const ARM_Y = 100; // catch point height between the arms
export const SATS = 10;
export const DOOR_Y = 27;
export const COUNTDOWN = 6;
const IGNITE_AT = -1.6;
const SPOOL = 1.3;

const BOOSTER_SPEC = { dry: 120e3, prop: 720e3, reserve: 200e3, c: 1500, thrust: 18e6 };
// A low exhaust speed gives the ship a real mass ratio at game scale, so a straight-up burn still falls back.
// Six engines push it to orbit (`thrust`); three sea-level engines flip it and land it (`land`).
export const SHIP_SPEC = { dry: 50e3, prop: 230e3, c: 650, thrust: 3e6, land: 2.4e6, sat: 2e3 };
const T13 = (BOOSTER_SPEC.thrust * 13) / 33;
const T3 = (BOOSTER_SPEC.thrust * 3) / 33;
// Drag areas (area times coefficient) along the axis and across it.
const STACK_AERO = { front: 22, side: 1560 };
const BOOSTER_AERO = { front: 110, side: 770 };
const SHIP_AERO = { front: 19, side: 600 };
const FIN_AREA = 40;

const TURN_RATE = 0.5;
const THROTTLE_RATE = 1.5;
export const AOA = { min: 0.9, max: 1.57, start: 1.35, rate: 0.45 };
const AERO_TURN = 0.35;
const FLIP_RATE = 0.9;
const FLIP_MAX_ALT = 3000;
const BOOSTER_TURN = 0.6;
// Time warp at the parking orbit; higher up it grows with the orbital period, so a lap always takes about as long.
const WARP_MAX = 16;
const WARP_R = R + 12000;
// Landing: the auto throttle flies a braking profile; up/down shift its target sink rate, left/right steer.
export const LAND = { r: 9.5, edge: 18.5, vtd: 1.5, sink: 6, steer: 4, tilt: 0.35, turn: 0.8, maxVs: 4, maxVh: 2.5, maxTilt: 0.15 };
const CATCH = { h: 3, d: 3.75, v: 3, close: 0.1 };
// The booster comes home on the side away from the tower and slides into the arms on its landing burn.
const BOOSTER_AIM = -120;

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const wrap = (a) => a - TAU * Math.round(a / TAU);
const turnToward = (a, target, max) => a + clamp(wrap(target - a), -max, max);

/** Local frame at a point: radius, altitude, the up unit vector, its angle, and phi, the downrange angle from the site (clockwise). */
export function local(x, y) {
  const rx = x - SITE_X;
  const ry = y + R;
  const r = Math.hypot(rx, ry);
  const ux = rx / r;
  const uy = ry / r;
  return { r, alt: r - R, ux, uy, up: Math.atan2(uy, ux), phi: Math.atan2(ux, uy) };
}

/** Radial (up) and horizontal (downrange) speed of a body in its local frame. */
export function speeds(b, L) {
  return { vr: b.vx * L.ux + b.vy * L.uy, vh: b.vx * L.uy - b.vy * L.ux };
}

export function density(alt) {
  if (alt >= ATM_TOP) return 0;
  return RHO0 * Math.exp(-Math.max(0, alt) / SCALE_H) * Math.min(1, (ATM_TOP - alt) / 2500);
}

/** Orbit through a state: eccentricity, specific energy, periapsis and apoapsis altitudes, period. */
export function orbitOf(x, y, vx, vy) {
  const rx = x - SITE_X;
  const ry = y + R;
  const r = Math.hypot(rx, ry);
  const eps = (vx * vx + vy * vy) / 2 - GM / r;
  const h = rx * vy - ry * vx;
  const e = Math.sqrt(Math.max(0, 1 + (2 * eps * h * h) / (GM * GM)));
  const p = (h * h) / GM;
  const a = -GM / (2 * eps);
  return { e, eps, pe: p / (1 + e) - R, ap: e < 1 ? p / (1 - e) - R : Infinity, period: eps < 0 ? TAU * Math.sqrt((a * a * a) / GM) : Infinity };
}

/** One symplectic Euler step under gravity, thrust along `ang` and cross-flow drag. Returns the air density. */
function integrate(b, dt, mass, thrust, ang, aero, ex = 0, ey = 0) {
  const L = local(b.x, b.y);
  const g = GM / (L.r * L.r);
  const rho = density(L.alt);
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  let fx = thrust * c;
  let fy = thrust * s;
  if (rho > 0) {
    const va = b.vx * c + b.vy * s;
    const vn = b.vy * c - b.vx * s;
    const fa = -0.5 * rho * Math.abs(va) * va * aero.front;
    const fn = -0.5 * rho * Math.abs(vn) * vn * aero.side;
    fx += fa * c - fn * s;
    fy += fa * s + fn * c;
  }
  b.vx += (fx / mass - g * L.ux + ex) * dt;
  b.vy += (fy / mass - g * L.uy + ey) * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  return rho;
}

/** Downrange angle from a point to the site pass that matters: just behind it, or the next one ahead. */
export function siteAhead(phi) {
  const a = ((phi % TAU) + TAU) % TAU;
  return a < 0.1 ? -a : TAU - a;
}

/** +1 when a body moves clockwise around the planet (east, +x over the site), -1 when it moves the other way. */
export function direction(b) {
  return speeds(b, local(b.x, b.y)).vh < 0 ? -1 : 1;
}

/** Attitude for flying belly first: the nose `aoa` above the velocity, on the side away from the planet. */
export const bellyAngle = (b, aoa, dir) => Math.atan2(b.vy, b.vx) + dir * aoa;

/** The ship flips upright high enough to finish turning and still stop with margin on the landing burn. */
function flipAltitude(b, L, mass) {
  const { vr } = speeds(b, L);
  const brake = 0.4 * (SHIP_SPEC.land / mass - GM / (L.r * L.r));
  return (vr * vr) / (2 * brake) - vr * 2 + 250;
}

/**
 * Landing burn thrust and attitude: the auto throttle flies a braking profile to touchdown (onto the mount near
 * the site), its sink rate shifted by `sink` (-1..1); `steer` (-1..1) is sideways thrust, and none damps the drift.
 */
function landingThrust(b, L, mass, steer, sink) {
  const g = GM / (L.r * L.r);
  const { vr, vh } = speeds(b, L);
  const h = L.alt - (Math.abs(L.phi * R) < 100 ? MOUNT_TOP : 0);
  const aMax = SHIP_SPEC.land / mass;
  const ap = 0.6 * (aMax - g);
  const vt = Math.max(0, Math.max(LAND.vtd, Math.sqrt(2 * ap * Math.max(0, h - 1.5))) + sink * LAND.sink);
  const acc = clamp(g + (h > 1.5 && -vr > LAND.vtd ? ap : 0) + 3 * (-vr - vt), 0, aMax);
  const want = steer ? steer * LAND.steer : clamp(-0.8 * vh, -LAND.steer, LAND.steer);
  // No lean while the engines barely push: a tilted body falling fast is pushed the other way by the air.
  const tilt = clamp(Math.atan2(want, Math.max(acc, 1)), -LAND.tilt, LAND.tilt) * Math.min(1, acc / g);
  return { thrust: acc * mass, ang: L.up - tilt };
}

/**
 * Where a ship touches down with no more input: belly first at `aoa` once in the air, then the flip and the
 * landing burn (from the start if `upright`). Returns the surface distance from the site along the direction of
 * travel `dir` (+ means past it) and seconds until touchdown, or null while the orbit stays above the air.
 */
export function predictLanding(st, aoa, mass = SHIP_SPEC.dry, upright = false) {
  if (orbitOf(st.x, st.y, st.vx, st.vy).pe > ATM_TOP) return null;
  const p = { x: st.x, y: st.y, vx: st.vx, vy: st.vy };
  const dir = direction(p);
  let L = local(p.x, p.y);
  const ahead = siteAhead(dir * L.phi);
  let prev = L.phi;
  let travel = 0;
  for (let t = 0; t < 2400; ) {
    const dt = L.alt > ATM_TOP + 2000 ? 1 : 0.1;
    upright ||= L.alt < flipAltitude(p, L, mass);
    const c = upright ? landingThrust(p, L, mass, 0, 0) : { thrust: 0, ang: bellyAngle(p, aoa, dir) };
    integrate(p, dt, mass, c.thrust, c.ang, SHIP_AERO);
    t += dt;
    L = local(p.x, p.y);
    travel += wrap(L.phi - prev);
    prev = L.phi;
    if (L.alt <= groundAt(L.phi * R)) return { dist: (dir * travel - ahead) * R, t, dir };
  }
  return null;
}

/** A falling booster braking from now on with `share` of its landing thrust, drag included: its frame once it stops. */
function brake(b, mass, share) {
  const p = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  let L = local(p.x, p.y);
  for (let t = 0; t < 60 && speeds(p, L).vr < -2; t += 0.2) {
    integrate(p, 0.2, mass, share * T13, Math.atan2(-p.vy, -p.vx), BOOSTER_AERO);
    L = local(p.x, p.y);
  }
  return L;
}

/** The landing burn lights as late as it can stop above the arms on 80% thrust. Braking without drag bounds it first. */
function burnDue(b, L, mass) {
  if (speeds(b, L).vr >= 0) return false;
  const vacuum = (b.vx * b.vx + b.vy * b.vy) / (2 * ((0.8 * T13) / mass - GM / (L.r * L.r)));
  return L.alt - ARM_Y < vacuum + 100 && brake(b, mass, 0.8).alt < ARM_Y + 40;
}

/** Where a coasting booster comes to rest, falling engines first and braking at the last moment: surface distance from the site. */
function predictBooster(b, mass) {
  const p = { x: b.x, y: b.y, vx: b.vx, vy: b.vy };
  for (let t = 0; t < 600; t += 0.25) {
    integrate(p, 0.25, mass, 0, Math.atan2(-p.vy, -p.vx), BOOSTER_AERO);
    const L = local(p.x, p.y);
    if (L.alt <= ARM_Y || burnDue(p, L, mass)) return brake(p, mass, 0.8).phi * R;
  }
  return Infinity;
}

/** Lowest altitude of a body along axis `ang`, from `below` under its reference point to `len` above it. */
function lowest(b, ang, below, len) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const a = local(b.x - c * below, b.y - s * below);
  const z = local(b.x + c * len, b.y + s * len);
  return Math.min(a.alt, z.alt) - BODY_R * Math.abs(Math.sin(wrap(a.up - ang)));
}

/** True if any part of a body along its axis is inside the tower. */
function hitsTower(b, ang, below, len) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  for (let u = -below; u <= len; u += 8) {
    const x = b.x + c * u;
    const y = b.y + s * u;
    if (y > 0 && y < TOWER_TOP && Math.abs(x - TOWER_X) < TOWER_REACH) return true;
  }
  return false;
}

const groundAt = (d) => (Math.abs(d) < LAND.edge ? MOUNT_TOP : 0);

export class Flight {
  constructor({ seed = 1 } = {}) {
    this.fx = new Game({ width: WORLD_W, seed });
    this.frame = 0;
    this.real = 0;
    this.t = -COUNTDOWN;
    this.phase = 'pad'; // 'pad' | 'flight' | 'over'
    this.events = [];
    this.marks = {};
    this.warp = 1;
    this.calm = 0;
    this.tilt = 0;
    this.throttle = 0;
    this.aoa = AOA.start;
    this.steer = 0;
    this.sink = 0;
    this.qMax = 0;
    this.qMaxT = 0;
    this.cut = null;
    this.anchor = 0;
    this.anchorLift = 0;
    this.prediction = null;
    this.outcome = null;
    this.endT = 0;
    this.strandT = 0;
    const y = MOUNT_TOP + BOOSTER_BASE;
    this.booster = { x: SITE_X, y, vx: 0, vy: 0, ang: Math.PI / 2, prop: BOOSTER_SPEC.prop, throttle: 0, engines: 0, state: 'stacked', stateT: 0, snapT: 0, from: null, bbSign: 1, cutSeen: false };
    this.ship = { x: SITE_X, y: y + BOOSTER_TOP, vx: 0, vy: 0, ang: Math.PI / 2, prop: SHIP_SPEC.prop, sats: SATS, mode: 'stacked', dir: 1, throttle: 0, engines: 0, heat: 0, flap: 0, door: 0, doorOpen: false, doorClose: 0, ejectT: null, deployCool: 0 };
    this.sats = [];
    this.arms = { open: 1, closing: false, holding: false, bounce: 0, bounceV: 0 };
    this.stats = { deployed: 0, boosterCaught: false, maxAlt: 0 };
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  mark(key) {
    if (this.marks[key] == null) this.marks[key] = this.t;
  }

  /** A message in the middle of the screen; it replaces any still showing there. */
  popup(text, sub, color = '#f2f4f7') {
    this.fx.popups.length = 0;
    this.fx.addPopup(text, 0, 0, { color, size: 40, dur: 2.2, big: true, sy: 0.24 });
    if (sub) this.fx.addPopup(sub, 0, 0, { color: '#cfd6df', size: 17, dur: 2.2, delay: 0.1, sy: 0.31 });
  }

  // ---------------------------------------------------------------- queries

  shipMass() {
    const s = this.ship;
    return SHIP_SPEC.dry + s.prop + s.sats * SHIP_SPEC.sat;
  }

  /** The context action the CATCH button runs now, or null. */
  action() {
    const s = this.ship;
    if (this.phase === 'pad') return this.t < IGNITE_AT ? 'START' : null;
    if (this.phase !== 'flight') return null;
    if (s.mode === 'stacked') return 'STAGE';
    const L = local(s.x, s.y);
    if (s.mode === 'aero' && L.alt < FLIP_MAX_ALT) return 'FLIP';
    if (s.mode === 'free' && this.marks.orbit != null && s.sats > 0 && L.alt > ATM_TOP) return 'DEPLOY';
    return null;
  }

  /** Propellant left in the active vehicle, 0..1. */
  fuel() {
    const s = this.ship;
    if (s.mode === 'stacked') return (this.booster.prop - BOOSTER_SPEC.reserve) / (BOOSTER_SPEC.prop - BOOSTER_SPEC.reserve);
    return s.prop / SHIP_SPEC.prop;
  }

  boosterFuel() {
    return this.booster.prop / BOOSTER_SPEC.prop;
  }

  /** The ship's orbit right now (see orbitOf). */
  orbit() {
    const s = this.ship;
    return orbitOf(s.x, s.y, s.vx, s.vy);
  }

  // ---------------------------------------------------------------- step

  step(input = NO_INPUT) {
    this.frame++;
    this.real += DT;
    this.events.length = 0;
    this.fx.events.length = 0;
    if (input.close && this.phase !== 'over') this.act();
    if (this.phase === 'flight') this.control(input);
    this.updateWarp();
    const n = Math.ceil(this.warp - 1e-9);
    const dt = (this.warp * DT) / n;
    for (let i = 0; i < n; i++) this.physics(dt);
    this.tick();
    this.effects();
  }

  act() {
    switch (this.action()) {
      case 'START':
        this.t = IGNITE_AT;
        break;
      case 'STAGE':
        this.stage();
        break;
      case 'DEPLOY':
        this.deploy();
        break;
      case 'FLIP':
        this.flip();
        break;
      default:
        break;
    }
  }

  /** Stick input, applied once per real frame so the time warp never speeds up the controls. */
  control(input) {
    const lr = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    const ud = (input.up ? 1 : 0) - (input.down ? 1 : 0);
    const mode = this.ship.mode;
    if (mode === 'stacked' || mode === 'free') {
      if (this.clearOfTower()) this.tilt = wrap(this.tilt + lr * TURN_RATE * DT);
      this.throttle = clamp(this.throttle + ud * THROTTLE_RATE * DT, 0, 1);
    } else if (mode === 'aero') {
      // Right always moves the landing point east: less angle of attack is more lift and a longer glide.
      this.aoa = clamp(this.aoa - lr * this.ship.dir * AOA.rate * DT, AOA.min, AOA.max);
    } else if (mode === 'landing') {
      this.steer = lr;
      this.sink = -ud;
    }
  }

  /** The stack climbs straight until its engines are above the tower: a turn pivots it and swings them sideways. */
  clearOfTower() {
    const b = this.booster;
    return this.ship.mode !== 'stacked' || local(b.x, b.y).alt - BOOSTER_BELLS > TOWER_TOP;
  }

  /** Time runs faster while the ship coasts in vacuum and nothing needs watching. */
  updateWarp() {
    const s = this.ship;
    const L = local(s.x, s.y);
    const quiet =
      this.phase === 'flight' &&
      s.mode === 'free' &&
      (this.throttle === 0 || s.prop <= 0) &&
      this.calm <= 0 &&
      !this.cut &&
      s.ejectT == null &&
      L.alt > ATM_TOP + 300;
    const max = Math.min(512, WARP_MAX * Math.max(1, L.r / WARP_R) ** 1.5);
    this.warp = quiet ? Math.min(max, this.warp * 1.04 + 0.02) : 1;
  }

  physics(dt) {
    if (this.phase !== 'over') this.t += dt;
    if (this.phase === 'pad') {
      this.throttle = clamp((this.t - IGNITE_AT) / SPOOL, 0, 1);
      this.booster.throttle = this.throttle;
      this.booster.engines = this.throttle > 0 ? 33 : 0;
      if (this.throttle > 0 && this.marks.ignite == null) {
        this.mark('ignite');
        this.emit('ignite');
      }
      if (this.t < 0) return;
      this.phase = 'flight';
      this.mark('liftoff');
      this.emit('liftoff');
    }
    if (this.ship.mode === 'stacked') {
      if (this.phase === 'flight') this.moveStack(dt);
    } else {
      this.moveBooster(dt);
      if (this.phase === 'flight') this.moveShip(dt);
    }
    this.moveSats(dt);
    this.moveArms(dt);
  }

  // ---------------------------------------------------------------- stack

  moveStack(dt) {
    const b = this.booster;
    const s = this.ship;
    const L = local(b.x, b.y);
    b.ang = L.up - this.tilt;
    const fuel = b.prop > BOOSTER_SPEC.reserve;
    const thrust = fuel ? this.throttle * BOOSTER_SPEC.thrust : 0;
    const mass = BOOSTER_SPEC.dry + b.prop + this.shipMass();
    const rho = integrate(b, dt, mass, thrust, b.ang, STACK_AERO);
    b.prop -= (thrust / BOOSTER_SPEC.c) * dt;
    this.trackQ(rho, b);
    s.x = b.x + Math.cos(b.ang) * BOOSTER_TOP;
    s.y = b.y + Math.sin(b.ang) * BOOSTER_TOP;
    s.vx = b.vx;
    s.vy = b.vy;
    s.ang = b.ang;
    // Before the throttle update, so the plume never blanks for a frame between full thrust and the separation burn.
    if (!fuel) return this.stage();
    b.throttle = this.throttle;
    b.engines = b.throttle > 0 ? 33 : 0;
    if (hitsTower(b, b.ang, BOOSTER_BELLS, BOOSTER_TOP + SHIP_H)) return this.crashStack('hit the tower');
    if (lowest(b, b.ang, BOOSTER_BASE, BOOSTER_TOP + SHIP_H) < groundAt(L.phi * R) - 0.5) this.crashStack(this.t < 20 ? 'fell back onto the pad' : 'came down');
  }

  /** MAX-Q goes on the timeline once dynamic pressure has clearly peaked. */
  trackQ(rho, b) {
    const q = 0.5 * rho * (b.vx * b.vx + b.vy * b.vy);
    if (q > this.qMax) {
      this.qMax = q;
      this.qMaxT = this.t;
    } else if (this.marks.maxq == null && this.qMax > 1500 && q < 0.97 * this.qMax) {
      this.marks.maxq = this.qMaxT;
      this.emit('maxq');
    }
  }

  /** Hot staging: the ship lights its engines on top of the booster and pushes off. */
  stage() {
    const b = this.booster;
    const s = this.ship;
    s.mode = 'free';
    const ax = Math.cos(b.ang);
    const ay = Math.sin(b.ang);
    s.vx += ax * 1.5;
    s.vy += ay * 1.5;
    b.vx -= ax * 1.5;
    b.vy -= ay * 1.5;
    this.throttle = 1;
    this.setBooster('sep');
    this.mark('stage');
    this.emit('stage');
  }

  crashStack(reason) {
    this.booster.state = 'lost';
    this.booster.throttle = 0;
    this.crashShip(reason);
  }

  // ---------------------------------------------------------------- booster autopilot

  setBooster(state) {
    const b = this.booster;
    b.state = state;
    b.stateT = 0;
    if (state === 'boostback') this.emit('boostback');
  }

  /** Thrust back toward the site and a little up. */
  boostbackAngle(L) {
    return L.up + this.booster.bbSign * (Math.PI / 2 - 0.1);
  }

  moveBooster(dt) {
    const b = this.booster;
    if (b.state === 'parked' || b.state === 'lost') return;
    b.stateT += dt;
    if (b.state === 'caught') return this.snapBooster(dt);
    const L = local(b.x, b.y);
    const mass = BOOSTER_SPEC.dry + b.prop;
    let thrust = 0;
    let fin = 0;
    switch (b.state) {
      case 'sep':
        thrust = T3 * 0.5;
        if (b.stateT > 0.6) {
          b.bbSign = predictBooster(b, mass) > BOOSTER_AIM ? 1 : -1;
          this.setBooster('flip');
        }
        break;
      case 'flip': {
        const target = this.boostbackAngle(L);
        b.ang = turnToward(b.ang, target, BOOSTER_TURN * dt);
        if (Math.abs(wrap(target - b.ang)) < 0.05) this.setBooster(Math.abs(predictBooster(b, mass) - BOOSTER_AIM) > 1500 ? 'boostback' : 'coast');
        break;
      }
      case 'boostback':
        b.ang = this.boostbackAngle(L);
        thrust = b.prop > 0 ? T13 : 0;
        if (!thrust || (this.frame % 4 === 0 && b.bbSign * (predictBooster(b, mass) - BOOSTER_AIM) <= 0)) this.setBooster('coast');
        break;
      case 'coast':
        b.ang = turnToward(b.ang, Math.atan2(-b.vy, -b.vx), BOOSTER_TURN * dt);
        fin = this.gridFins(b, L, mass);
        if (burnDue(b, L, mass)) this.setBooster('landing');
        break;
      default: {
        const c = this.boosterLanding(b, L, mass);
        thrust = c.thrust;
        b.ang = c.ang;
      }
    }
    if (b.prop <= 0) thrust = 0;
    const max = b.state === 'boostback' || b.state === 'landing' || b.state === 'closing' ? T13 : T3;
    b.throttle = thrust / max;
    b.engines = thrust ? (max === T3 || thrust <= T3 ? 3 : 13) : 0;
    integrate(b, dt, mass, thrust, b.ang, BOOSTER_AERO, fin * L.uy, -fin * L.ux);
    b.prop = Math.max(0, b.prop - (thrust / BOOSTER_SPEC.c) * dt);
    this.boosterContact();
  }

  /** Grid fins steer the falling booster toward its aim point, with authority from dynamic pressure. */
  gridFins(b, L, mass) {
    const rho = density(L.alt);
    if (!rho) return 0;
    const { vr, vh } = speeds(b, L);
    const tGo = Math.max(2, (L.alt - ARM_Y) / Math.max(40, -vr));
    const want = (BOOSTER_AIM - L.phi * R) / tGo;
    const max = (0.5 * rho * (b.vx * b.vx + b.vy * b.vy) * FIN_AREA) / mass;
    return clamp((want - vh) * 0.4, -max, max);
  }

  /** Landing burn onto the catch point between the arms, steering out the miss distance. */
  boosterLanding(b, L, mass) {
    const g = GM / (L.r * L.r);
    const { vr, vh } = speeds(b, L);
    const d = L.phi * R;
    const h = L.alt - ARM_Y;
    const aMax = T13 / mass;
    const ap = 0.8 * aMax - g;
    const vt = Math.max(1.5, Math.sqrt(2 * ap * Math.max(0, h - 6)));
    const acc = clamp(g + (h > 6 && -vr > 3 ? ap : 0) + 4 * (-vr - vt), 0, aMax);
    // Side thrust on the minimum-effort path that comes to rest over the arms when the descent does.
    const tGo = Math.max(1.5, (2 * Math.max(0, h)) / Math.max(3, -vr));
    const lat = (-6 * d) / (tGo * tGo) - (4 * vh) / tGo;
    const tilt = clamp(Math.atan2(lat, Math.max(acc, 1)), -0.4, 0.4);
    if (b.state === 'landing' && Math.abs(h) <= CATCH.h && Math.abs(d) < CATCH.d && Math.abs(vr) < CATCH.v) {
      b.state = 'closing';
      this.arms.closing = true;
      this.emit('close');
    }
    return { thrust: acc * mass, ang: L.up - tilt };
  }

  evaluateCatch() {
    const b = this.booster;
    if (b.state !== 'closing') return;
    const L = local(b.x, b.y);
    const { vr } = speeds(b, L);
    if (Math.abs(L.alt - ARM_Y) <= CATCH.h && Math.abs(L.phi * R) < CATCH.d && Math.abs(vr) < CATCH.v) {
      b.state = 'caught';
      b.stateT = 0;
      b.snapT = 0;
      b.from = { x: b.x, y: b.y };
      b.vx = 0;
      b.vy = 0;
      this.arms.holding = true;
      this.arms.bounceV = -5;
      this.stats.boosterCaught = true;
      this.mark('catch');
      this.emit('catch');
      const p = this.fxPoint(SITE_X, ARM_Y);
      this.fx.spawnSparks(p.px, p.py, 34, 0, true);
      this.fx.spawnClampVapor(p.px, p.py, VEHICLES.booster.halfW);
      if (this.cut) this.popup('BOOSTER CAUGHT', 'back on the tower, ready to fly again');
    } else {
      b.state = 'landing';
    }
  }

  snapBooster(dt) {
    const b = this.booster;
    b.snapT = Math.min(1, b.snapT + dt / 0.22);
    const e = 1 - (1 - b.snapT) ** 3;
    b.x = b.from.x + (SITE_X - b.from.x) * e;
    b.y = b.from.y + (ARM_Y + this.arms.bounce - b.from.y) * e;
    b.ang += (Math.PI / 2 - b.ang) * 0.15;
    b.throttle *= 0.8;
    if (b.throttle < 0.02) {
      b.throttle = 0;
      b.engines = 0;
    }
  }

  boosterContact() {
    const b = this.booster;
    const L = local(b.x, b.y);
    const hit = hitsTower(b, b.ang, BOOSTER_BELLS, BOOSTER_TOP);
    if (!hit && lowest(b, b.ang, BOOSTER_BASE, BOOSTER_TOP) > groundAt(L.phi * R)) return;
    b.state = 'lost';
    b.throttle = 0;
    b.engines = 0;
    this.emit('boosterLost');
    if (this.phase === 'flight') this.explode(b, L);
  }

  // ---------------------------------------------------------------- ship

  moveShip(dt) {
    const s = this.ship;
    const L = local(s.x, s.y);
    const mass = this.shipMass();
    let thrust = 0;
    switch (s.mode) {
      case 'free':
        s.ang = L.up - this.tilt;
        s.engines = 6;
        thrust = this.throttle * SHIP_SPEC.thrust;
        break;
      case 'aero':
        s.ang = turnToward(s.ang, bellyAngle(s, this.aoa, s.dir), AERO_TURN * dt);
        s.engines = 0;
        if (L.alt < flipAltitude(s, L, mass)) this.flip();
        break;
      case 'flip':
        s.ang = turnToward(s.ang, L.up, FLIP_RATE * dt);
        // The engines light once the nose is well up, so the flip burn pushes up rather than sideways.
        s.engines = Math.abs(wrap(L.up - s.ang)) < 0.8 ? 3 : 0;
        thrust = s.engines ? 0.4 * SHIP_SPEC.land : 0;
        if (Math.abs(wrap(L.up - s.ang)) < 0.03) {
          s.mode = 'landing';
          this.emit('landingBurn');
        }
        break;
      default: {
        const c = landingThrust(s, L, mass, this.steer, this.sink);
        s.ang = turnToward(s.ang, c.ang, LAND.turn * dt);
        s.engines = 3;
        thrust = c.thrust;
      }
    }
    if (s.prop <= 0) {
      thrust = 0;
      s.engines = 0;
    }
    s.throttle = s.engines ? thrust / (s.engines === 6 ? SHIP_SPEC.thrust : SHIP_SPEC.land) : 0;
    const rho = integrate(s, dt, mass, thrust, s.ang, SHIP_AERO);
    s.prop = Math.max(0, s.prop - (thrust / SHIP_SPEC.c) * dt);
    const v = Math.hypot(s.vx, s.vy);
    s.heat = Math.min(1.5, Math.sqrt(rho / RHO0) * (v / 900) ** 3 * 14);
    s.flap = s.mode === 'aero' ? (this.aoa - AOA.start) / (AOA.max - AOA.min) : 0;
    if (L.alt > this.stats.maxAlt) this.stats.maxAlt = L.alt;
    this.shipEvents(L);
    this.collideShip();
  }

  shipEvents(L) {
    const s = this.ship;
    if (s.mode !== 'free') return;
    const o = orbitOf(s.x, s.y, s.vx, s.vy);
    if (this.marks.orbit == null && o.pe > ORBIT_PE) {
      this.mark('orbit');
      this.throttle = 0;
      this.calm = 2.5;
      this.emit('orbit');
      this.popup('ORBIT', 'engine cutoff · free to fly around the world');
    }
    if (this.marks.orbit != null && this.marks.deorbit == null && this.throttle > 0 && o.pe < ATM_TOP - 2500) {
      this.mark('deorbit');
      this.emit('deorbit');
    }
    const { vr } = speeds(s, L);
    if (L.alt < ATM_TOP && vr < -30 && (this.throttle === 0 || s.prop <= 0) && this.t > 20) {
      s.mode = 'aero';
      s.dir = direction(s);
      this.aoa = AOA.start;
      this.mark('reentry');
      this.emit('reentry');
    }
  }

  flip() {
    const s = this.ship;
    if (s.mode !== 'aero') return;
    s.mode = 'flip';
    this.emit('flip');
  }

  collideShip() {
    const s = this.ship;
    if (hitsTower(s, s.ang, 0, SHIP_H)) return this.crashShip('hit the tower');
    const L = local(s.x, s.y);
    const d = L.phi * R;
    if (lowest(s, s.ang, 0, SHIP_H) > groundAt(d)) return;
    const { vr, vh } = speeds(s, L);
    const tilt = Math.abs(wrap(L.up - s.ang));
    const far = Math.abs(d);
    let reason = null;
    if (far > LAND.r) reason = far < 1000 ? `missed the mount by ${Math.round(far - LAND.r)} m` : `came down ${(far / 1000).toFixed(1)} km from the tower`;
    else if (-vr > LAND.maxVs) reason = `hard landing · ${(-vr).toFixed(1)} m/s`;
    else if (Math.abs(vh) > LAND.maxVh) reason = `sliding · ${Math.abs(vh).toFixed(1)} m/s sideways`;
    else if (tilt > LAND.maxTilt) reason = 'tipped over';
    this.outcome = { ok: !reason, reason, dist: far, speed: Math.hypot(vr, vh) };
    if (reason) this.crashShip(reason);
    else this.land(L);
  }

  land(L) {
    const s = this.ship;
    s.mode = 'landed';
    s.x = SITE_X + L.ux * (R + MOUNT_TOP);
    s.y = L.uy * (R + MOUNT_TOP) - R;
    s.vx = 0;
    s.vy = 0;
    s.ang = L.up;
    s.throttle = 0;
    s.engines = 0;
    this.mark('landing');
    this.end();
    this.emit('landed');
    this.popup('TOUCHDOWN', `the ship is home · ${this.outcome.dist.toFixed(1)} m from center`, '#7ee0a1');
  }

  /** Mission over with the ship destroyed: the catch game's crash effects at the impact point. */
  crashShip(reason) {
    const s = this.ship;
    if (!this.outcome) this.outcome = { ok: false, reason, dist: Math.abs(local(s.x, s.y).phi * R), speed: Math.hypot(s.vx, s.vy) };
    s.mode = 'crashed';
    s.throttle = 0;
    s.engines = 0;
    this.explode(s, local(s.x, s.y));
    s.vx = 0;
    s.vy = 0;
    this.end();
  }

  /** Explosion on the ground under a body, wherever on the planet it is. */
  explode(b, L) {
    this.anchor = L.phi;
    this.anchorLift = groundAt(L.phi * R);
    const p = this.fxPoint(b.x, b.y);
    this.fx.popups.length = 0;
    this.fx.crash({ x: p.px, y: 0, vy: 0, rot: 0, state: 'falling', lifeLost: true });
  }

  end() {
    this.phase = 'over';
    this.endT = this.real;
    this.throttle = 0;
    this.emit('over');
  }

  // ---------------------------------------------------------------- satellites

  deploy() {
    const s = this.ship;
    if (s.deployCool > 0 || s.ejectT != null) return;
    s.ejectT = s.door >= 1 ? 0.15 : 0.7;
    s.doorOpen = true;
    s.deployCool = 1.1;
    this.calm = Math.max(this.calm, 3.5);
  }

  eject() {
    const s = this.ship;
    s.ejectT = null;
    if (s.sats <= 0 || s.mode !== 'free') return;
    const ax = Math.cos(s.ang);
    const ay = Math.sin(s.ang);
    const i = SATS - s.sats;
    s.sats--;
    this.sats.push({
      x: s.x + ax * DOOR_Y - ay * (BODY_R + 1),
      y: s.y + ay * DOOR_Y + ax * (BODY_R + 1),
      vx: s.vx - ay * 0.9 + ax * 0.3,
      vy: s.vy + ax * 0.9 + ay * 0.3,
      z: 0,
      vz: (i % 2 ? 1 : -1) * (0.12 + 0.03 * i),
      spin: (i * 0.37) % 1,
      age: 0,
      gone: false,
    });
    s.doorClose = 2.5;
    this.stats.deployed++;
    this.mark('deploy');
    this.calm = Math.max(this.calm, 3.5);
    this.emit('deploy', { n: this.stats.deployed });
    this.popup(`SATELLITE ${this.stats.deployed}/${SATS}`, this.stats.deployed === SATS ? 'all satellites deployed' : null, '#9fd3ff');
  }

  moveSats(dt) {
    for (const p of this.sats) {
      if (p.gone) continue;
      const L = local(p.x, p.y);
      const g = GM / (L.r * L.r);
      p.vx -= g * L.ux * dt;
      p.vy -= g * L.uy * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.age += dt;
      if (L.alt < ATM_TOP) p.gone = true;
    }
  }

  moveArms(dt) {
    const a = this.arms;
    if (a.closing) {
      a.open = Math.max(0, a.open - dt / CATCH.close);
      if (a.open <= 0) {
        a.closing = false;
        this.evaluateCatch();
      }
    } else if (!a.holding) {
      a.open = Math.min(1, a.open + dt / 0.6);
    }
    a.bounceV += (-220 * a.bounce - 9 * a.bounceV) * dt;
    a.bounce += a.bounceV * dt;
  }

  // ---------------------------------------------------------------- per frame

  tick() {
    const s = this.ship;
    const b = this.booster;
    this.calm = Math.max(0, this.calm - DT);
    s.deployCool = Math.max(0, s.deployCool - DT);
    if (s.ejectT != null) {
      s.ejectT -= DT;
      if (s.ejectT <= 0) this.eject();
    }
    if (s.doorClose > 0) {
      s.doorClose -= DT;
      if (s.doorClose <= 0) s.doorOpen = false;
    }
    s.door = clamp(s.door + (s.doorOpen ? DT : -DT) / 0.6, 0, 1);

    // Cut away to the tower for the booster catch while the ship coasts.
    const L = local(s.x, s.y);
    if (!this.cut && !b.cutSeen && b.state === 'landing' && s.mode === 'free' && this.throttle === 0 && L.alt > ATM_TOP) {
      this.cut = { start: this.real, end: Infinity };
      b.cutSeen = true;
    }
    if (this.cut) {
      if (this.throttle > 0) this.cut.end = Math.min(this.cut.end, this.real);
      if ((b.state === 'caught' || b.state === 'lost') && this.cut.end === Infinity) this.cut.end = this.real + 2.6;
      if (this.real > this.cut.end + 0.7) this.cut = null;
    }
    if (b.state === 'caught' && !this.cut && b.stateT > 1 && Math.hypot(s.x - SITE_X, s.y) > 20000) {
      b.state = 'parked';
      this.arms.holding = false;
    }

    if (this.phase === 'flight' && this.marks.orbit != null) {
      const upright = s.mode === 'flip' || s.mode === 'landing';
      const busy = this.throttle > 0 || s.mode !== 'free';
      if (this.frame % (busy ? 2 : 6) === 0) this.prediction = predictLanding(s, this.aoa, this.shipMass(), upright);
    }

    if (this.phase === 'flight' && s.mode === 'free') {
      const o = orbitOf(s.x, s.y, s.vx, s.vy);
      if (o.eps >= 0 && L.r > 3 * R) {
        this.outcome = { ok: false, reason: 'escaped the planet', dist: Infinity, speed: Math.hypot(s.vx, s.vy), lost: true };
        this.end();
      }
      this.strandT = s.prop <= 0 && o.pe > ATM_TOP ? this.strandT + DT : 0;
      if (this.strandT > 4) {
        this.outcome = { ok: false, reason: 'out of propellant in orbit', dist: Infinity, speed: Math.hypot(s.vx, s.vy), lost: true };
        this.end();
      }
    }
  }

  // ---------------------------------------------------------------- ground effects

  /** A world point in catch-game pixels, in the frame that brings the effects anchor to the launch site. */
  fxPoint(x, y) {
    const c = Math.cos(this.anchor);
    const s = Math.sin(this.anchor);
    const rx = x - SITE_X;
    const ry = y + R;
    return { px: WORLD_W / 2 + (rx * c - ry * s + SITE_X) * PX_PER_M, py: GROUND_Y - (rx * s + ry * c - R - this.anchorLift) * PX_PER_M };
  }

  /** Feeds the catch game's exhaust and ground blast with a `kind` vehicle's engines at (ex, ey) firing along -ang. */
  exhaust(kind, ex, ey, ang, vx, vy, throttle) {
    const tilt = Math.PI / 2 - (ang + this.anchor);
    const p = this.fxPoint(ex, ey);
    const c = Math.cos(this.anchor);
    const s = Math.sin(this.anchor);
    const bottom = VEHICLES[kind].bottom;
    const proxy = {
      kind,
      x: p.px + Math.sin(tilt) * bottom,
      y: p.py - Math.cos(tilt) * bottom,
      tilt,
      throttle,
      vx: (vx * c - vy * s) * PX_PER_M,
      vy: -(vx * s + vy * c) * PX_PER_M,
    };
    this.fx.spawnExhaust(proxy);
    this.fx.spawnGroundBlast(proxy);
  }

  effects() {
    const fx = this.fx;
    const b = this.booster;
    const s = this.ship;
    fx.step(NO_INPUT);
    fx.events.length = 0;
    if (this.anchor === 0 || s.mode === 'landing' || s.mode === 'flip') {
      // Ground effects only where the camera can see them: near the site, low over the pad or the landing spot.
      if (s.mode === 'stacked' && b.throttle > 0) {
        const c = Math.cos(b.ang);
        const sn = Math.sin(b.ang);
        this.exhaust('booster', b.x - c * BOOSTER_BELLS, b.y - sn * BOOSTER_BELLS, b.ang, b.vx, b.vy, b.throttle);
        if (this.t < 6) this.deluge();
      }
      if (b.throttle > 0 && b.state !== 'stacked' && local(b.x, b.y).alt < 400 && this.anchor === 0) {
        const c = Math.cos(b.ang);
        const sn = Math.sin(b.ang);
        this.exhaust('booster', b.x - c * BOOSTER_BELLS, b.y - sn * BOOSTER_BELLS, b.ang, b.vx, b.vy, b.throttle);
      }
    }
    if (s.mode === 'landing' && s.throttle > 0) {
      const L = local(s.x, s.y);
      if (L.alt < 400) {
        if (this.anchor !== L.phi && Math.abs(L.phi * R) > 300 && fx.particles.length === 0) {
          this.anchor = L.phi;
          this.anchorLift = groundAt(L.phi * R);
        }
        this.exhaust('ship', s.x, s.y, s.ang, s.vx, s.vy, s.throttle);
      }
    }
  }

  /** Steam off the water deluge under the mount at ignition and liftoff. */
  deluge() {
    const fx = this.fx;
    const r = fx.fx;
    const p = this.fxPoint(SITE_X, 2);
    const k = clamp((this.t - IGNITE_AT) / 3, 0, 1) * (1 - clamp((this.t - 2) / 4, 0, 1));
    for (let i = 0; i < 3; i++) {
      if (!r.chance(0.3 + 0.6 * k)) continue;
      const side = r.chance(0.5) ? 1 : -1;
      fx.pushParticle({ k: 3, x: p.px + side * r.range(10, 70), y: p.py - r.range(0, 30), vx: side * r.range(120, 520), vy: -r.range(10, 90), t: 0, life: r.range(1.8, 3.6), size: r.range(40, 90), grow: 70 });
    }
  }
}
