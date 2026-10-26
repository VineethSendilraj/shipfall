import * as THREE from 'three';
import { DT, GROUND_Y, PX_PER_M } from '../sim.js';

export const toX = (px) => (px - 640) / PX_PER_M;
export const toY = (py) => (GROUND_Y - py) / PX_PER_M;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DIP_IN = 0.36;
const DIP_OUT = 0.34;

/**
 * Cinematic camera. Advanced once per fixed sim step so the demo is frame-exact; the render
 * only reads the resulting pose.
 */
export class Director {
  constructor({ cinematic = false } = {}) {
    this.cinematic = cinematic;
    this.pos = new THREE.Vector3(-60, 10, 200);
    this.tgt = new THREE.Vector3(30, 80, 0);
    this.fov = 38;
    this.aspect = 16 / 9;
    this.seen = new Set();
    this.closeT = -1;
    this.close = null;
    this.dipStart = -1;
    this.dip = 0;
    this.snapPending = false;
    this.initialized = false;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
  }

  reset() {
    this.seen.clear();
    this.closeT = -1;
    this.close = null;
    this.dipStart = -1;
    this.dip = 0;
    this.snapPending = false;
  }

  desired(game) {
    const P = this._p;
    const T = this._t;
    const t = game.t;
    const A = game.towers[0];
    const widen = Math.pow(Math.max(1, 16 / 9 / this.aspect), 0.85);
    let fov = 38;
    let k = 0.03;

    for (const b of game.boosters) {
      if (b.state === 'caught' && !this.seen.has(b.id)) {
        this.seen.add(b.id);
        const tw = game.towers[b.tower];
        this.closeT = 0;
        this.close = { x: toX(tw.cx), y: toY(tw.armY), side: tw.side };
      }
    }
    const otherFalling = game.boosters.some((b) => b.state === 'falling' || b.state === 'waiting');
    const closeDur = this.cinematic ? (otherFalling ? 1.05 : 1.7) : otherFalling ? 0 : 1.3;
    const inClose = this.closeT >= 0 && this.closeT < closeDur && game.phase !== 'over';

    if (game.phase === 'ready') {
      const c = toX(A.x) - 8;
      const a = -0.1 + t * 0.03;
      const r = 165 * widen;
      P.set(c + Math.sin(a) * r, 6, Math.cos(a) * r);
      T.set(c - 14, 72, 0);
      fov = 46;
    } else if (game.phase === 'over' || game.phase === 'unlock') {
      const xs = game.towers.map((tw) => toX(tw.cx));
      const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
      const span = Math.max(...xs) - Math.min(...xs);
      const tt = game.phaseT;
      const dist = (150 + span * 1.05) * widen + tt * 3;
      P.set(mid - 0.22 * dist, 12 + tt * 0.6, dist);
      T.set(mid + 6, 72, 0);
      fov = 36;
      k = 0.04;
    } else if (inClose) {
      const c = this.close;
      const s = c.side;
      const u = this.closeT;
      P.set(c.x + s * (27 - u * 3), c.y - 11 + u * 1.5, (60 - u * 5) * widen);
      T.set(c.x - s * 3, c.y + 9, 0);
      fov = 34;
      k = 0.075;
    } else {
      const b = game.activeBooster();
      const tw = b ? game.towers[b.tower] : A;
      const lane = toX(tw.cx);
      const arm = toY(tw.armY);
      let bx = lane;
      let catchY = arm + 40;
      if (b && b.state === 'falling') {
        bx = toX(b.x);
        catchY = toY(b.y);
      } else if (b) {
        catchY = 230;
      }
      const top = catchY + 14;
      const bottom = Math.min(arm - 6, catchY - 68);
      const span = top - bottom + 18;
      const halfFov = THREE.MathUtils.degToRad(fov / 2);
      const dist = clamp(span / (2 * Math.tan(halfFov)) * 1.08, 110, 290) * widen;
      const fx = lane + (bx - lane) * 0.5;
      const fy = (top + bottom) / 2;
      P.set(fx - 0.3 * dist, clamp(fy * 0.3, 7, 42), dist * 0.95);
      T.set(fx + 4, fy, 0);
      k = 0.032;
    }
    if (this.closeT >= 0) this.closeT += DT;
    return { fov, k };
  }

  step(game, aspect = this.aspect) {
    this.aspect = aspect;
    const { fov, k } = this.desired(game);

    const leaving = game.boosters.some((b) => b.state === 'leaving');
    if (leaving && this.dipStart < 0) this.dipStart = game.frame;
    if (this.dipStart >= 0) {
      const u = (game.frame - this.dipStart) * DT;
      if (u < DIP_IN) this.dip = u / DIP_IN;
      else {
        if (!this.snapPending) {
          this.snapPending = true;
          this.pos.copy(this._p);
          this.tgt.copy(this._t);
          this.fov = fov;
          this.closeT = -1;
        }
        this.dip = Math.max(0, 1 - (u - DIP_IN) / DIP_OUT);
        if (u >= DIP_IN + DIP_OUT) {
          this.dipStart = -1;
          this.snapPending = false;
          this.dip = 0;
        }
      }
    }

    if (!this.initialized) {
      this.pos.copy(this._p);
      this.tgt.copy(this._t);
      this.fov = fov;
      this.initialized = true;
    } else {
      this.pos.lerp(this._p, k);
      this.tgt.lerp(this._t, k * 1.4);
      this.fov += (fov - this.fov) * k;
    }
  }

  apply(camera, game) {
    const t = game.t;
    const sh = game.shake * 0.09;
    camera.position.set(
      this.pos.x + Math.sin(t * 0.63) * 0.5 + Math.sin(t * 37.1) * sh,
      this.pos.y + Math.sin(t * 0.47 + 1) * 0.35 + Math.sin(t * 41.7 + 2) * sh,
      this.pos.z + Math.sin(t * 29.3 + 4) * sh,
    );
    camera.lookAt(this.tgt.x + Math.sin(t * 0.31) * 0.4, this.tgt.y + Math.sin(t * 0.37) * 0.3, this.tgt.z);
    if (Math.abs(camera.fov - this.fov) > 1e-3) {
      camera.fov = this.fov;
      camera.updateProjectionMatrix();
    }
  }
}
