import * as THREE from 'three';
import { DT } from '../sim.js';
import { SITE_X, R, MOUNT_TOP, DOOR_Y, local } from '../flight.js';
import { CENTER } from './flight-world.js';

const DIP_IN = 0.36;
const DIP_OUT = 0.34;
// Shots entered and left through a dip to black: the ones that move the camera somewhere else entirely.
const CUTS = new Set(['booster', 'site']);
// Fixed ground cameras: one tracks the booster home to the tower, one the ship's final approach.
const TOWER_CAM = new THREE.Vector3(SITE_X - 160, 14, 330);
const SITE_CAM = new THREE.Vector3(SITE_X - 300, 16, 520);
const GROUND_CAM = new THREE.Vector3(SITE_X + 8 + Math.sin(-0.25) * 235, 8, Math.cos(-0.25) * 235);
const Z = new THREE.Vector3(0, 0, 1);
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = THREE.MathUtils.smoothstep;

/** World point d meters along a body's axis from its sim point. */
export const alongAxis = (out, o, d) => out.set(o.x + Math.cos(o.ang) * d, o.y + Math.sin(o.ang) * d, 0);
export const stackMid = (out, b) => alongAxis(out, b, -2.2);
export const boosterMid = (out, b) => alongAxis(out, b, -26);
export const shipMid = (out, s) => alongAxis(out, s, 24);

/** Local east and up at a world point (z is the third axis). */
function frame(p, E, U) {
  U.subVectors(p, CENTER).setZ(0).normalize();
  E.set(U.y, -U.x, 0);
}

/**
 * Free flight's camera. Each shot names a focus point on a vehicle and offsets from it in the focus's local
 * frame (east, up, z), so the camera keeps up at orbital speed and the horizon stays level around the planet.
 * Advanced once per sim step; the view interpolates pos/tgt/fov between steps and adds shake.
 */
export class FlightDirector {
  constructor() {
    this.shot = null;
    this.next = null;
    this.dipT = -1;
    this.dip = 0;
    this.snapped = true;
    this.fo = new THREE.Vector3();
    this.eye = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.fov = 40;
    this.focus = new THREE.Vector3();
    this.pos = new THREE.Vector3();
    this.tgt = new THREE.Vector3();
    this.aspect = 16 / 9;
    this.want = { F: new THREE.Vector3(), eye: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40, k: 0.04 };
    this._E = new THREE.Vector3();
    this._U = new THREE.Vector3();
    this._a = new THREE.Vector3();
  }

  choose(f) {
    const s = f.ship;
    if (f.cut && f.real < f.cut.end) return 'booster';
    if (f.phase === 'pad') return 'pad';
    if (f.phase === 'over') return f.outcome?.ok ? 'landed' : f.outcome?.lost ? 'orbit' : 'crash';
    if (s.mode === 'stacked') return 'ascent';
    if (s.mode !== 'free') {
      const L = local(s.x, s.y);
      return this.shot === 'site' || (L.alt < 2500 && Math.abs(L.phi * R) < 12000) ? 'site' : 'reentry';
    }
    if (f.t - f.marks.stage < 5) return 'stage';
    if (s.door > 0 || s.ejectT != null) return 'deploy';
    return f.marks.orbit != null ? 'orbit' : 'ship';
  }

  /** Eye offset (local frame) for a chase camera d meters out, raised with altitude so the curved limb shows. */
  chase(out, F, d, back = 0.22) {
    const alt = Math.max(0, local(F.x, F.y).alt);
    const beta = clamp(Math.acos(R / (R + alt)) - 0.21, 0, 0.35);
    return out.set(-back * d * Math.cos(beta), d * Math.sin(beta), d * Math.cos(beta));
  }

  /** Sets this.want for a shot: focus F, eye and look offsets in F's local frame, fov, and smoothing k. */
  desired(f, shot) {
    const w = this.want;
    const { F, eye, look } = w;
    const E = this._E;
    const U = this._U;
    const a = this._a;
    const s = f.ship;
    const b = f.booster;
    const widen = Math.pow(Math.max(1, 16 / 9 / this.aspect), 0.85);
    look.set(0, 0, 0);
    w.fov = 38;
    w.k = 0.04;
    w.fixed = false;
    const fixedAt = (P, halfH, minFov) => {
      frame(F, E, U);
      a.subVectors(P, F);
      eye.set(a.dot(E), a.dot(U), a.z);
      w.fov = clamp(THREE.MathUtils.radToDeg(2 * Math.atan(halfH / a.length())), minFov, 40);
      w.fixed = true;
    };
    switch (shot) {
      case 'pad': {
        F.set(SITE_X + 8, 74, 0);
        const ang = -0.32 + f.real * 0.012;
        const d = 235 * widen;
        eye.set(Math.sin(ang) * d, -66, Math.cos(ang) * d);
        w.fov = 40;
        break;
      }
      case 'ascent': {
        stackMid(F, b);
        const alt = local(F.x, F.y).alt;
        frame(F, E, U);
        a.subVectors(GROUND_CAM, F);
        this.chase(eye, F, (250 + Math.min(alt, 12000) * 0.004) * widen);
        const low = 1 - smooth(alt, 300, 1500);
        eye.lerp(a.set(a.dot(E), a.dot(U), a.z), low);
        // From the ground camera, aim below the stack's middle so the plume and the steam stay in the shot.
        look.set(0, -27 * low, 0);
        w.fov = 38 + 6 * low;
        w.k = 0.08;
        break;
      }
      case 'stage': {
        const age = f.t - f.marks.stage;
        alongAxis(F, b, 12).lerp(alongAxis(a, s, 24), smooth(age, 0.5, 4));
        const d = (110 + 25 * age) * widen;
        eye.set(-0.45 * d, 0.2 * d, 0.85 * d);
        w.fov = 36;
        w.k = 0.08;
        break;
      }
      case 'deploy': {
        alongAxis(F, s, DOOR_Y);
        frame(F, E, U);
        const c = Math.cos(s.ang);
        const sn = Math.sin(s.ang);
        a.set(-sn * s.dir * 75 - c * 25, c * s.dir * 75 - sn * 25, 95 * widen);
        eye.set(a.dot(E), a.dot(U), a.z);
        w.fov = 36;
        w.k = 0.035;
        break;
      }
      case 'orbit': {
        shipMid(F, s);
        const ang = 0.5 * Math.sin(f.real * 0.045);
        this.chase(eye, F, 270 * widen, 0);
        eye.set(Math.sin(ang) * eye.z, eye.y, Math.cos(ang) * eye.z);
        w.k = 0.03;
        break;
      }
      case 'reentry': {
        shipMid(F, s);
        frame(F, E, U);
        const v = Math.hypot(s.vx, s.vy) || 1;
        const d = 230 * widen;
        a.set((s.vx / v) * d * 0.35, (s.vy / v) * d * 0.35, d * 0.9).addScaledVector(U, d * 0.15);
        eye.set(a.dot(E), a.dot(U), a.z);
        w.k = 0.04;
        break;
      }
      case 'site':
        shipMid(F, s);
        fixedAt(SITE_CAM, 95 * widen, 4);
        break;
      case 'booster':
        boosterMid(F, b);
        fixedAt(TOWER_CAM, 62 * widen, 3);
        break;
      case 'landed': {
        F.set(SITE_X, MOUNT_TOP + 24, 0);
        const ang = 0.4 + 0.05 * (f.real - f.endT);
        const d = 190 * widen;
        eye.set(Math.sin(ang) * d, 14 - F.y, Math.cos(ang) * d);
        w.k = 0.03;
        break;
      }
      case 'crash': {
        U.set(Math.sin(f.anchor), Math.cos(f.anchor), 0);
        F.copy(CENTER).addScaledVector(U, R + f.anchorLift + 25);
        const d = 300 * widen;
        eye.set(-0.3 * d, 30, d);
        w.fov = 40;
        break;
      }
      default: {
        shipMid(F, s);
        this.chase(eye, F, 220 * widen);
      }
    }
  }

  step(f, aspect) {
    this.aspect = aspect;
    const want = this.choose(f);
    this.snapped = false;
    if (this.shot === null) this.cut(want, f);
    else if (want !== this.shot && (CUTS.has(want) || CUTS.has(this.shot))) {
      if (this.dipT < 0) this.dipT = 0;
      this.next = want;
    } else if (want !== this.shot) {
      this.desired(f, this.shot);
      this.fo.add(this.want.F);
      this.shot = want;
      this.desired(f, want);
      this.fo.sub(this.want.F);
    }
    if (this.dipT >= 0) {
      this.dipT += DT;
      if (this.dipT < DIP_IN) this.dip = this.dipT / DIP_IN;
      else {
        if (this.next !== null) {
          this.cut(this.next, f);
          this.next = null;
        }
        this.dip = Math.max(0, 1 - (this.dipT - DIP_IN) / DIP_OUT);
        if (this.dipT >= DIP_IN + DIP_OUT) this.dipT = -1;
      }
    }

    const w = this.want;
    this.desired(f, this.shot);
    this.fo.multiplyScalar(0.97);
    const k = this.snapped || w.fixed ? 1 : w.k;
    this.eye.lerp(w.eye, k);
    this.look.lerp(w.look, k);
    this.fov += (w.fov - this.fov) * (this.snapped ? 1 : w.fixed ? 0.25 : k);
    this.focus.addVectors(w.F, this.fo);
    const E = this._E;
    const U = this._U;
    frame(this.focus, E, U);
    this.pos.copy(this.focus).addScaledVector(E, this.eye.x).addScaledVector(U, this.eye.y).addScaledVector(Z, this.eye.z);
    this.tgt.copy(this.focus).addScaledVector(E, this.look.x).addScaledVector(U, this.look.y).addScaledVector(Z, this.look.z);
  }

  cut(shot, f) {
    this.cuts = (this.cuts ?? 0) + 1;
    this.shot = shot;
    this.desired(f, shot);
    this.fo.set(0, 0, 0);
    this.eye.copy(this.want.eye);
    this.look.copy(this.want.look);
    this.fov = this.want.fov;
    this.snapped = true;
  }
}
