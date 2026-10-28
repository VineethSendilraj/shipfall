// Scripted pilot for free flight: the input a player would give at each step, read from the flight state. It
// flies the whole mission: liftoff, gravity turn, staging, orbit insertion, ten deploys, a timed deorbit burn,
// a steered reentry and the landing burn onto the mount. Tests, captures and the attract loop use it.
import { AOA, GM, R, SHIP_SPEC, local, speeds, wrap, predictLanding, siteAhead } from './flight.js';

const KICK_ALT = 500;
const KICK = 0.5;
const ORBIT_ALT = 14000;
const PRESS_GAP = 84;
const DEORBIT_DV = 200;
const DEORBIT_THROTTLE = 1;
const CUT_AT = 3000; // predicted overshoot (m) where the deorbit burn starts to throttle down
const SHORT = 15; // the glide aims this far short of the site

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function createFlightPilot({ skipCountdown = true } = {}) {
  let wait = 0;
  let deorbit = 'wait'; // 'wait' | 'burn' | 'done'
  return (f) => {
    const input = { left: false, right: false, up: false, down: false, close: false };
    const s = f.ship;
    if (wait > 0) wait--;
    const press = () => {
      if (wait > 0) return;
      input.close = true;
      wait = PRESS_GAP;
    };
    const tiltTo = (target) => {
      const d = wrap(target - f.tilt);
      input.right = d > 0.005;
      input.left = d < -0.005;
    };
    const throttleTo = (target) => {
      input.up = target > f.throttle + 0.01;
      input.down = target < f.throttle - 0.01;
    };
    if (f.phase === 'pad') {
      if (skipCountdown && f.action() === 'START') press();
      return input;
    }
    if (f.phase !== 'flight') return input;
    const L = local(s.x, s.y);
    const { vr, vh } = speeds(s, L);
    switch (s.mode) {
      case 'stacked':
        tiltTo(L.alt < KICK_ALT ? 0 : Math.max(KICK, Math.atan2(vh, vr)));
        break;
      case 'free': {
        if (f.marks.orbit == null) {
          // Reach the target altitude with no vertical speed just as the horizontal speed reaches circular:
          // the vertical acceleration of the minimum-effort path there, plus gravity less the centrifugal lift.
          // The time to go depends on the thrust left for horizontal speed, so solve the two together.
          const a = SHIP_SPEC.thrust / f.shipMass();
          const g = GM / (L.r * L.r) - (vh * vh) / L.r;
          const dv = Math.sqrt(GM / (R + ORBIT_ALT)) - vh;
          let ar = 0;
          for (let i = 0; i < 4; i++) {
            const T = Math.max(4, dv / Math.sqrt(a * a - ar * ar));
            ar = clamp((6 * (ORBIT_ALT - L.alt)) / (T * T) - (4 * vr) / T + g, -0.9 * a, 0.9 * a);
          }
          tiltTo(Math.acos(ar / a));
          break;
        }
        if (s.sats > 0) {
          tiltTo(Math.PI / 2);
          if (!f.cut && f.action() === 'DEPLOY') press();
          break;
        }
        tiltTo(-Math.PI / 2);
        const retro = Math.abs(wrap(f.tilt + Math.PI / 2)) < 0.02;
        if (deorbit === 'wait' && retro && wait === 0 && siteAhead(L.phi) < 3) {
          const k = 1 - DEORBIT_DV / Math.hypot(s.vx, s.vy);
          const p = predictLanding({ x: s.x, y: s.y, vx: s.vx * k, vy: s.vy * k }, AOA.start, f.shipMass());
          if (p && p.dist > 0) deorbit = 'burn';
        }
        if (deorbit === 'burn') {
          const p = f.throttle > 0 ? predictLanding(s, AOA.start, f.shipMass()) : null;
          if (p && p.dist < CUT_AT) deorbit = 'done';
        }
        throttleTo(deorbit === 'burn' ? DEORBIT_THROTTLE : 0);
        break;
      }
      case 'aero': {
        // Steer until the predicted touchdown sits on the site: right moves it east. The glide aims a little
        // short, so the landing burn closes the rest moving away from the tower rather than toward it.
        const p = f.prediction;
        if (!p) break;
        const east = -(p.dist + SHORT) * p.dir;
        input.right = east > SHORT;
        input.left = east < -SHORT;
        break;
      }
      case 'landing': {
        // Hold a sideways speed that closes the distance to the center and slows as it gets there.
        const want = clamp((-L.phi * R) / 2.5, -12, 12);
        input.right = vh < want - 0.5;
        input.left = vh > want + 0.5;
        break;
      }
      default:
        break;
    }
    return input;
  };
}
