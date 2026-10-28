// Free flight: the full stack lifts off the launch mount, flies around the site under an arcade flight
// computer, and lands back. Pure simulation (no DOM, no three.js) at the fixed step DT, deterministic for a
// given input sequence. Units are meters and seconds, y up, the same world frame as the 3D view.
import { DT } from './sim.js';

const DEG = Math.PI / 180;

export const FLIGHT = {
  g: 9.81,
  twr: 1.5, // thrust-to-weight at full throttle
  minThrottle: 0.15, // lowest throttle while the engines run (only the center engines lit)
  hoverSecs: 180, // the tank lasts this long at hover throttle
  drag: 6e-4, // quadratic drag: a = drag * |v| * v
  vUp: 25, // climb rate at full W, m/s
  vDown: 18, // descent rate at full S, m/s
  vMax: 40, // horizontal speed at full arrow input, m/s
  tiltMax: 20 * DEG,
  yawRate: 42 * DEG, // rad/s at full A/D
  spoolUp: 0.85, // throttle change per second
  spoolDown: 1.6,
  holdDown: 1.2, // the clamps let go once thrust exceeds this many times the weight
  comH: 50, // center of mass above the engine plane
  baseR: 4.6, // aft skirt radius, for touchdown
  bodyR: 5, // collision radius along the stack
  landVy: 3, // touchdown limits: descent rate, sideways speed, tilt
  landVh: 2,
  landTilt: 5 * DEG,
  mountLandR: 9.5, // the base sits fully on the ring when its center is this close to the mount axis
  lowFuel: 20,
  bingo: 8,
  ceiling: 1500, // the flight computer stops climbing here
  fenceWarn: 1800, // horizontal distance from the mount: warning, then no further outward flight
  fence: 2400,
};

// Procedural launch mount (world.js / props.glb): ring table top and radius around its axis.
export const DEFAULT_MOUNT = Object.freeze({ x: -30, z: -70, top: 22.25, r: 14.25 });
export const NO_FLIGHT_INPUT = Object.freeze({ climb: 0, yaw: 0, fwd: 0, right: 0 });

const TAN_MAX = Math.tan(FLIGHT.tiltMax);
const LEAN_KP = 7;
const LEAN_KD = 2 * Math.sqrt(LEAN_KP);
const LEAN_RATE = 0.3; // tan units per second, about 17 deg/s
const YAW_EASE = 1 - Math.exp(-DT / 0.35);
const KV_Y = 1.6;
const KV_H = 0.55;
// Descent protection: the sink rate is capped at BRAKE_K * sqrt(2 * BRAKE_ACC * height), a profile flown
// at a constant BRAKE_K^2 * BRAKE_ACC deceleration, which is fed forward so the touchdown stays soft.
const BRAKE_ACC = 2.5;
const BRAKE_K = 0.8;
const BRAKE_FF = BRAKE_K * BRAKE_K * BRAKE_ACC;
const SINK_MIN = 1.2;
const PAD_ABORT = 2.5; // engines shut down if the stack is still clamped this long after W is released
const SAMPLE_STEP = 4; // meters between collision samples along the stack

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Why a touchdown fails, or null if it's a landing. vy: descent rate, vh: sideways speed (m/s), tilt (rad). */
export function landingVerdict(vy, vh, tilt) {
  if (vy >= FLIGHT.landVy) return 'hard';
  if (tilt >= FLIGHT.landTilt) return 'tilt';
  if (vh >= FLIGHT.landVh) return 'slide';
  return null;
}

const CRASH_REASON = {
  hard: (f) => `hard landing · ${f.impact.vy.toFixed(1)} m/s`,
  tilt: (f) => `touched down tilted · ${(f.impact.tilt / DEG).toFixed(0)}°`,
  slide: (f) => `touched down sliding · ${f.impact.vh.toFixed(1)} m/s sideways`,
  edge: () => 'caught the edge of the launch mount',
  mount: () => 'hit the launch mount',
  tower: () => 'hit the tower',
  tanks: () => 'hit the tank farm',
  building: () => 'hit a building',
  mast: () => 'hit a floodlight mast',
};

/**
 * Colliders for one catch tower whose base center is at (x, 0, 0). side: -1 if its arms reach toward -x.
 * Sized from tower.glb: lattice, top boom and mast, the carriage at armY and both catch arms (open).
 */
export function towerColliders(x, side, armY) {
  const s = -side; // the structure is modeled for side -1 and mirrored
  const boomA = x + s * 9;
  const boomB = x + s * 18.7;
  const out = [
    { type: 'box', kind: 'tower', min: [x - 8.6, 0, -8.6], max: [x + 8.6, 154, 8.6] },
    { type: 'box', kind: 'tower', min: [x - 6, 154, -3.7], max: [x + 6, 175, 3.7] },
    { type: 'box', kind: 'tower', min: [Math.min(boomA, boomB), 151, -3.8], max: [Math.max(boomA, boomB), 155, -2.2] },
    { type: 'box', kind: 'tower', min: [x - 10, armY - 8, -9], max: [x + 10, armY + 2.6, 9] },
  ];
  // Open arms: 31 m long, swung 30 deg away from the lane's centerline, from pivots beside the carriage.
  for (const zs of [1, -1]) {
    const px = x + side * 8.4;
    const pz = zs * 6.1;
    out.push({ type: 'seg', kind: 'tower', a: [px, armY - 1.4, pz], b: [px + side * 31 * Math.cos(30 * DEG), armY - 1.4, pz + zs * 31 * Math.sin(30 * DEG)], r: 2 });
  }
  return out;
}

/** Adds an axis-aligned bounding box (bx0..bz1) to each collider for the broad phase. */
export function prepareColliders(list) {
  return list.map((c) => {
    const o = { ...c };
    if (c.type === 'box') [o.bx0, o.by0, o.bz0, o.bx1, o.by1, o.bz1] = [...c.min, ...c.max];
    else if (c.type === 'cyl') [o.bx0, o.by0, o.bz0, o.bx1, o.by1, o.bz1] = [c.x - c.r, c.y0, c.z - c.r, c.x + c.r, c.y1, c.z + c.r];
    else {
      [o.bx0, o.by0, o.bz0] = c.a.map((v, i) => Math.min(v, c.b[i]) - c.r);
      [o.bx1, o.by1, o.bz1] = c.a.map((v, i) => Math.max(v, c.b[i]) + c.r);
    }
    return o;
  });
}

/** Squared distance from a point to a collider's solid (0 inside). */
function dist2(c, x, y, z) {
  if (c.type === 'box') {
    const dx = x < c.bx0 ? c.bx0 - x : x > c.bx1 ? x - c.bx1 : 0;
    const dy = y < c.by0 ? c.by0 - y : y > c.by1 ? y - c.by1 : 0;
    const dz = z < c.bz0 ? c.bz0 - z : z > c.bz1 ? z - c.bz1 : 0;
    return dx * dx + dy * dy + dz * dz;
  }
  if (c.type === 'cyl') {
    const dr = Math.max(0, Math.hypot(x - c.x, z - c.z) - c.r);
    const dy = y < c.y0 ? c.y0 - y : y > c.y1 ? y - c.y1 : 0;
    return dr * dr + dy * dy;
  }
  const [ax, ay, az] = c.a;
  const ex = c.b[0] - ax;
  const ey = c.b[1] - ay;
  const ez = c.b[2] - az;
  const t = clamp(((x - ax) * ex + (y - ay) * ey + (z - az) * ez) / (ex * ex + ey * ey + ez * ez), 0, 1);
  const dx = x - ax - ex * t;
  const dy = y - ay - ey * t;
  const dz = z - az - ez * t;
  const d = Math.max(0, Math.sqrt(dx * dx + dy * dy + dz * dz) - c.r);
  return d * d;
}

export class Flight {
  /**
   * mount: launch mount ring { x, z, top, r }. colliders: obstacles (towerColliders() and the site's boxes and
   * cylinders); touching one is a crash. stackH: engine plane to tip. yaw: starting heading (0 faces -z).
   */
  constructor({ mount = DEFAULT_MOUNT, colliders = [], stackH = 128, comH = FLIGHT.comH, yaw = 0 } = {}) {
    this.mount = { ...mount };
    this.colliders = prepareColliders(colliders);
    this.stackH = stackH;
    this.comH = comH;
    this.frame = 0;
    this.t = 0;
    this.phase = 'ready'; // ready (on the mount, engines off) → flying → landed | crashed
    this.pos = { x: mount.x, y: mount.top + comH, z: mount.z }; // center of mass
    this.vel = { x: 0, y: 0, z: 0 };
    // Lean: tan(tilt) along the tilt direction, so the stack's axis is normalize(lean.x, 1, lean.z).
    this.lean = { x: 0, z: 0 };
    this.leanVel = { x: 0, z: 0 };
    this.yaw = yaw;
    this.yawRate = 0;
    this.throttle = 0;
    this.throttleCmd = 0;
    this.engines = false;
    this.fuel = 100;
    this.outOfFuel = false;
    this.padIdle = 0;
    this.airborne = false;
    this.liftoffT = -1;
    this.endT = -1;
    this.stats = { aloft: 0, maxAlt: 0, dist: 0, touchdown: 0, offset: 0, fuel: 100 };
    this.result = null;
    this.impact = { x: 0, y: 0, z: 0, vy: 0, vh: 0, tilt: 0, speed: 0, ax: 0, az: 0 };
    this.warn = '';
    this.events = [];
    this.popups = [];
    this.banner = null;
    this.nextId = 1;
    this.shake = 0;
    this.flash = 0;
    this.axis = { x: 0, y: 1, z: 0 };
    this.base = { x: 0, y: 0, z: 0 };
    this.sinTilt = 0;
    this.agl = 0; // radar altitude: base to the surface right below it
    this.surface = 'mount';
    this.mountDist = 0;
    this.lowY = 0;
    this.derive();
  }

  emit(type, data) {
    this.events.push(data ? { type, ...data } : { type });
  }

  addPopup(text, sy, opts = {}) {
    const delay = opts.delay || 0;
    this.popups.push({ text, x: 0, y: 0, sy, t: -delay, dur: (opts.dur || 1.6) + delay, color: opts.color || '#fff', size: opts.size || 24, big: !!opts.big, id: this.nextId++ });
  }

  get tilt() {
    return Math.atan(Math.hypot(this.lean.x, this.lean.z));
  }

  /** Mount ring top if (x, z) is over the ring, else the ground. */
  surfaceAt(x, z) {
    const d = Math.hypot(x - this.mount.x, z - this.mount.z);
    return d <= this.mount.r ? this.mount.top : 0;
  }

  /** Axis, engine-plane center, lowest point of the skirt and radar altitude from pos and lean. */
  derive() {
    const { lean, pos, axis, base, mount } = this;
    const l2 = lean.x * lean.x + lean.z * lean.z;
    const inv = 1 / Math.sqrt(1 + l2);
    axis.x = lean.x * inv;
    axis.y = inv;
    axis.z = lean.z * inv;
    this.sinTilt = Math.sqrt(l2) * inv;
    base.x = pos.x - axis.x * this.comH;
    base.y = pos.y - axis.y * this.comH;
    base.z = pos.z - axis.z * this.comH;
    this.lowY = base.y - FLIGHT.baseR * this.sinTilt;
    this.mountDist = Math.hypot(base.x - mount.x, base.z - mount.z);
    const onMount = this.mountDist <= mount.r;
    this.surface = onMount ? 'mount' : 'ground';
    this.agl = this.lowY - (onMount ? mount.top : 0);
  }

  ignite() {
    this.engines = true;
    this.phase = 'flying';
    this.emit('ignite');
  }

  step(input = NO_FLIGHT_INPUT) {
    this.events.length = 0;
    this.frame++;
    this.t += DT;
    this.tickUi();
    if (this.phase === 'landed' || this.phase === 'crashed') {
      this.settle();
      return;
    }
    const climb = clamp(input.climb || 0, -1, 1);
    if (this.phase === 'ready') {
      if (climb <= 0.25) {
        this.throttle = Math.max(0, this.throttle - FLIGHT.spoolDown * DT);
        return;
      }
      this.ignite();
    }
    // Lit but still clamped with W released: the computer aborts and shuts the engines down.
    if (!this.airborne) {
      this.padIdle = climb > 0.25 ? 0 : this.padIdle + DT;
      if (this.padIdle >= PAD_ABORT) {
        this.engines = false;
        this.phase = 'ready';
        this.padIdle = 0;
        this.emit('abort');
        return;
      }
    }
    const F = FLIGHT;
    const g = F.g;
    const { pos, vel, lean, leanVel } = this;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);
    const dragX = -F.drag * speed * vel.x;
    const dragY = -F.drag * speed * vel.y;
    const dragZ = -F.drag * speed * vel.z;
    const nrm = Math.sqrt(1 + lean.x * lean.x + lean.z * lean.z); // 1 / cos(tilt)

    // Flight computer: W/S command a climb rate (no input holds altitude), arrows a ground velocity.
    let ltx = 0;
    let ltz = 0;
    if (this.engines) {
      let vyCmd = climb >= 0 ? climb * F.vUp : climb * F.vDown;
      // Descent protection: never sink faster than the computer can stop before the surface below.
      const brake = BRAKE_K * Math.sqrt(2 * BRAKE_ACC * Math.max(0, this.agl - 0.3));
      let ff = 0;
      if (vyCmd < -Math.max(SINK_MIN, brake)) {
        vyCmd = -Math.max(SINK_MIN, brake);
        if (brake > SINK_MIN) ff = BRAKE_FF;
      }
      if (pos.y > F.ceiling - 60 && vyCmd > 0) vyCmd = Math.min(vyCmd, Math.max(0, (F.ceiling - pos.y) * 0.4));
      if (pos.y > F.ceiling) vyCmd = Math.min(vyCmd, (F.ceiling - pos.y) * 0.4);
      const support = Math.max(0.35 * g, KV_Y * (vyCmd - vel.y) + ff + g - dragY);
      this.throttleCmd = clamp((support * nrm) / (F.twr * g), F.minThrottle, 1);

      if (this.airborne) {
        const heading = typeof input.heading === 'number' ? input.heading : this.yaw;
        let fwd = clamp(input.fwd || 0, -1, 1);
        let right = clamp(input.right || 0, -1, 1);
        const m = Math.hypot(fwd, right);
        if (m > 1) {
          fwd /= m;
          right /= m;
        }
        const s = Math.sin(heading);
        const c = Math.cos(heading);
        // forward = (-sin h, 0, -cos h), right = (cos h, 0, -sin h)
        let vcx = (-s * fwd + c * right) * F.vMax;
        let vcz = (-c * fwd - s * right) * F.vMax;
        const ox = pos.x - this.mount.x;
        const oz = pos.z - this.mount.z;
        const od = Math.hypot(ox, oz);
        if (od > F.fence) {
          const out = (vcx * ox + vcz * oz) / od;
          if (out > 0) {
            vcx -= (out * ox) / od;
            vcz -= (out * oz) / od;
          }
          const back = Math.min(8, (od - F.fence) * 0.5);
          vcx -= (back * ox) / od;
          vcz -= (back * oz) / od;
        }
        const ax = KV_H * (vcx - vel.x) - dragX;
        const az = KV_H * (vcz - vel.z) - dragZ;
        ltx = ax / support;
        ltz = az / support;
        const lm = Math.hypot(ltx, ltz);
        if (lm > TAN_MAX) {
          ltx *= TAN_MAX / lm;
          ltz *= TAN_MAX / lm;
        }
      }
    } else {
      this.throttleCmd = 0;
    }

    // Engines spool toward the command instead of snapping.
    const dThr = this.throttleCmd - this.throttle;
    this.throttle += dThr > 0 ? Math.min(dThr, F.spoolUp * DT) : Math.max(dThr, -F.spoolDown * DT);

    // Attitude: a damped lean toward the target, rate limited so the stack moves like something massive.
    if (this.engines && this.airborne) {
      leanVel.x += (LEAN_KP * (ltx - lean.x) - LEAN_KD * leanVel.x) * DT;
      leanVel.z += (LEAN_KP * (ltz - lean.z) - LEAN_KD * leanVel.z) * DT;
      const lv = Math.hypot(leanVel.x, leanVel.z);
      if (lv > LEAN_RATE) {
        leanVel.x *= LEAN_RATE / lv;
        leanVel.z *= LEAN_RATE / lv;
      }
    } else {
      leanVel.x *= 0.98;
      leanVel.z *= 0.98;
    }
    lean.x += leanVel.x * DT;
    lean.z += leanVel.z * DT;

    if (this.airborne) {
      const yawCmd = -clamp(input.yaw || 0, -1, 1) * F.yawRate;
      this.yawRate += (yawCmd - this.yawRate) * YAW_EASE;
      this.yaw += this.yawRate * DT;
    }

    // Forces: thrust along the axis, gravity, drag. On the clamps until thrust beats the hold-down.
    const thrust = this.throttle * F.twr * g;
    if (!this.airborne) {
      if (thrust / nrm <= F.holdDown * g) {
        this.burn();
        return;
      }
      this.airborne = true;
      this.liftoffT = this.t;
      this.emit('liftoff');
      this.banner = { text: 'LIFTOFF', sub: 'free flight · land back on the launch mount', t: 0, dur: 2.2 };
    }
    vel.x += ((thrust * lean.x) / nrm + dragX) * DT;
    vel.y += (thrust / nrm - g + dragY) * DT;
    vel.z += ((thrust * lean.z) / nrm + dragZ) * DT;
    const prevLow = this.lowY;
    pos.x += vel.x * DT;
    pos.y += vel.y * DT;
    pos.z += vel.z * DT;
    this.burn();
    this.derive();

    const st = this.stats;
    st.aloft += DT;
    st.dist += speed * DT;
    if (this.lowY > st.maxAlt) st.maxAlt = this.lowY;
    this.updateWarn();

    // Touchdown on the ring top (from above) or the ground; anything else the stack touches is a crash.
    if (this.surface === 'mount' && this.lowY <= this.mount.top) {
      if (prevLow < this.mount.top - 0.5) return this.crash('mount');
      return this.touchdown(this.mount.top);
    }
    if (this.lowY <= 0) return this.touchdown(0);
    this.collide();
  }

  /** Fuel use, warnings and engine cutoff on an empty tank. */
  burn() {
    if (!this.engines) return;
    const before = this.fuel;
    this.fuel = Math.max(0, this.fuel - ((this.throttle * FLIGHT.twr * 100) / FLIGHT.hoverSecs) * DT);
    if (before > FLIGHT.lowFuel && this.fuel <= FLIGHT.lowFuel) {
      this.emit('lowfuel');
      this.addPopup('LOW FUEL', 0.26, { color: '#f2b84b', size: 26, dur: 1.6 });
    }
    if (before > FLIGHT.bingo && this.fuel <= FLIGHT.bingo) {
      this.emit('bingo');
      this.addPopup('BINGO FUEL · LAND NOW', 0.26, { color: '#f0605a', size: 24, dur: 1.8 });
    }
    if (this.fuel <= 0) {
      this.engines = false;
      this.outOfFuel = true;
      this.emit('enginesOut');
      this.addPopup('ENGINES OUT', 0.26, { color: '#f0605a', size: 30, dur: 2, big: true });
    }
  }

  updateWarn() {
    const od = Math.hypot(this.pos.x - this.mount.x, this.pos.z - this.mount.z);
    const w = !this.engines ? 'out' : this.fuel <= FLIGHT.bingo ? 'bingo' : this.fuel <= FLIGHT.lowFuel ? 'lowfuel' : od > FLIGHT.fenceWarn ? 'fence' : this.pos.y > FLIGHT.ceiling - 60 ? 'ceiling' : '';
    this.warn = w;
  }

  collide() {
    const { base, axis, colliders } = this;
    const R = FLIGHT.bodyR;
    const R2 = R * R;
    const tx = base.x + axis.x * this.stackH;
    const ty = base.y + axis.y * this.stackH;
    const tz = base.z + axis.z * this.stackH;
    const x0 = Math.min(base.x, tx) - R;
    const x1 = Math.max(base.x, tx) + R;
    const y0 = Math.min(base.y, ty) - R;
    const y1 = Math.max(base.y, ty) + R;
    const z0 = Math.min(base.z, tz) - R;
    const z1 = Math.max(base.z, tz) + R;
    const n = Math.ceil(this.stackH / SAMPLE_STEP);
    // The mount below its ring top: the skirt catching the rim on the way down, or flying into its side.
    const m = this.mount;
    if (y0 < m.top - 0.6 && Math.abs(base.x - m.x) < m.r + this.stackH && Math.abs(base.z - m.z) < m.r + this.stackH) {
      for (let i = 0; i <= n; i++) {
        const s = Math.min(this.stackH, i * SAMPLE_STEP);
        const py = base.y + axis.y * s;
        if (py >= m.top - 0.6) break;
        const d = Math.hypot(base.x + axis.x * s - m.x, base.z + axis.z * s - m.z);
        if (d < m.r + (i === 0 ? FLIGHT.baseR : R)) return this.crash(py > m.top - 4 ? 'edge' : 'mount', base.x + axis.x * s, py, base.z + axis.z * s);
      }
    }
    for (const c of colliders) {
      if (c.bx1 < x0 || c.bx0 > x1 || c.by1 < y0 || c.by0 > y1 || c.bz1 < z0 || c.bz0 > z1) continue;
      for (let i = 0; i <= n; i++) {
        const s = Math.min(this.stackH, i * SAMPLE_STEP);
        const px = base.x + axis.x * s;
        const py = base.y + axis.y * s;
        const pz = base.z + axis.z * s;
        if (dist2(c, px, py, pz) < R2) {
          this.crash(c.kind, px, py, pz);
          // Which way is away from the obstacle, for a camera that wants it behind the explosion.
          let cx;
          let cz;
          if (c.type === 'cyl') {
            cx = c.x;
            cz = c.z;
          } else if (c.type === 'box') {
            cx = clamp(px, c.bx0, c.bx1);
            cz = clamp(pz, c.bz0, c.bz1);
            if (cx === px && cz === pz) {
              cx = (c.bx0 + c.bx1) / 2;
              cz = (c.bz0 + c.bz1) / 2;
            }
          } else {
            const ex = c.b[0] - c.a[0];
            const ez = c.b[2] - c.a[2];
            const t = clamp(((px - c.a[0]) * ex + (pz - c.a[2]) * ez) / (ex * ex + ez * ez), 0, 1);
            cx = c.a[0] + ex * t;
            cz = c.a[2] + ez * t;
          }
          const al = Math.hypot(px - cx, pz - cz) || 1;
          this.impact.ax = (px - cx) / al;
          this.impact.az = (pz - cz) / al;
          return;
        }
      }
    }
  }

  touchdown(surfaceY) {
    this.setImpact(this.base.x, surfaceY, this.base.z);
    const { vy, vh, tilt } = this.impact;
    if (this.surface === 'mount' && this.mountDist > FLIGHT.mountLandR) return this.crash('edge', this.base.x, surfaceY, this.base.z);
    const bad = landingVerdict(vy, vh, tilt);
    if (bad) return this.crash(bad, this.base.x, surfaceY, this.base.z);
    this.land(surfaceY);
  }

  /** Records where and how fast the stack met something. */
  setImpact(x, y, z) {
    const im = this.impact;
    im.x = x;
    im.y = y;
    im.z = z;
    im.ax = 0;
    im.az = 0;
    im.vy = -this.vel.y;
    im.vh = Math.hypot(this.vel.x, this.vel.z);
    im.tilt = this.tilt;
    im.speed = Math.hypot(im.vy, im.vh);
  }

  finish() {
    this.airborne = false;
    this.engines = false;
    this.throttleCmd = 0;
    this.endT = this.t;
    this.stats.fuel = this.fuel;
    this.stats.touchdown = this.impact.vy;
    this.warn = '';
  }

  land(surfaceY) {
    const onMount = this.surface === 'mount';
    this.phase = 'landed';
    this.pos.y += surfaceY - this.lowY;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.leanVel.x = this.leanVel.z = 0;
    this.finish();
    this.stats.offset = this.mountDist;
    this.result = { landed: true, onMount, kind: null, reason: '', title: onMount ? 'Landed back on the launch mount' : 'Landed' };
    this.derive();
    this.emit('land', { onMount, offset: this.mountDist, vy: this.impact.vy });
    const vy = this.impact.vy.toFixed(1);
    if (onMount) {
      const off = this.mountDist;
      this.addPopup(off < 1.5 ? 'BULLSEYE!' : 'ON THE MOUNT!', 0.17, { color: off < 1.5 ? '#f2b84b' : '#5fd38d', size: 52, dur: 2.4, big: true });
      this.addPopup(`${vy} m/s · ${off.toFixed(1)} m from center`, 0.245, { color: '#f1f2f4', size: 20, dur: 2.4, delay: 0.12 });
    } else {
      this.addPopup('LANDED', 0.17, { color: '#f1f2f4', size: 50, dur: 2.4, big: true });
      this.addPopup(`${vy} m/s · ${Math.round(this.mountDist)} m from the launch mount`, 0.245, { color: '#c9cdd3', size: 18, dur: 2.4, delay: 0.12 });
    }
  }

  crash(kind, x = this.base.x, y = this.lowY, z = this.base.z) {
    this.setImpact(x, y, z);
    this.phase = 'crashed';
    this.throttle = 0;
    this.finish();
    this.stats.touchdown = this.impact.speed;
    this.stats.offset = this.mountDist;
    const reason = CRASH_REASON[kind](this);
    this.result = { landed: false, onMount: false, kind, reason: this.outOfFuel ? `out of fuel · ${reason}` : reason, title: 'Rapid unscheduled disassembly' };
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.emit('crash', { kind, x, y, z, speed: this.impact.speed });
    this.shake = 18;
    this.flash = 0.7;
    this.addPopup('RUD!', 0.24, { color: '#f0605a', size: 56, dur: 2.2, big: true });
    this.addPopup(this.result.reason, 0.31, { color: '#f3d2cc', size: 18, dur: 2.2, delay: 0.1 });
  }

  /** After touchdown: engines spool down and a landed stack eases upright on its skirt. */
  settle() {
    this.throttle = Math.max(0, this.throttle - FLIGHT.spoolDown * DT);
    if (this.phase !== 'landed') return;
    const { lean } = this;
    if (lean.x === 0 && lean.z === 0) return;
    lean.x *= 0.9;
    lean.z *= 0.9;
    if (Math.abs(lean.x) + Math.abs(lean.z) < 1e-4) lean.x = lean.z = 0;
    const low = this.lowY;
    this.derive();
    this.pos.y += low - this.lowY;
    this.derive();
  }

  tickUi() {
    const ps = this.popups;
    let k = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.t += DT;
      if (p.t < p.dur) ps[k++] = p;
    }
    ps.length = k;
    if (this.banner) {
      this.banner.t += DT;
      if (this.banner.t >= this.banner.dur) this.banner = null;
    }
    this.shake = Math.max(0, this.shake - DT * 22);
    this.flash = Math.max(0, this.flash - DT * 1.6);
  }

  /**
   * 0: not lined up; 1: over the mount's landing ring on the way back down; 2: also slow and level enough to
   * set down right now.
   */
  get landingZone() {
    if (this.phase !== 'flying' || !this.airborne || this.clock < 4 || this.vel.y > 1.5) return 0;
    if (this.mountDist > FLIGHT.mountLandR || this.agl > 160) return 0;
    return Math.hypot(this.vel.x, this.vel.z) < FLIGHT.landVh && this.tilt < FLIGHT.landTilt ? 2 : 1;
  }

  /** Seconds since liftoff (frozen at touchdown), for the T+ clock and the result card. */
  get clock() {
    if (this.liftoffT < 0) return 0;
    return (this.endT >= 0 ? this.endT : this.t) - this.liftoffT;
  }
}
