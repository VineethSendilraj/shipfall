import * as THREE from 'three';
import { DT, GROUND_Y, PX_PER_M } from '../sim.js';

export const toX = (px) => (px - 640) / PX_PER_M;
export const toY = (py) => (GROUND_Y - py) / PX_PER_M;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smoothstep = (a, b, x) => {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
};
const DIP_IN = 0.36;
const DIP_OUT = 0.34;
// Seconds into a game for the establishing shot to give way to the play camera.
const ESTABLISH_OUT = 1.2;
const UP = new THREE.Vector3(0, 1, 0);
// How much further back the play shot sits than a tight frame, so the tower and the incoming vehicle have room.
const PLAY_ZOOM = 1.35;

/**
 * Cinematic camera. Advanced once per fixed sim step so the demo is frame-exact; the render
 * only reads the resulting pose.
 */
export class Director {
  /** titleTime: seconds of showcase title before play starts; the establishing shot is gone by then. */
  constructor({ cinematic = false, titleTime = 0, orbit = null } = {}) {
    this.cinematic = cinematic;
    this.orbit = orbit;
    this.titleTime = titleTime;
    this.clock = 0;
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
    this._ep = new THREE.Vector3();
    this._et = new THREE.Vector3();
    this._op = new THREE.Vector3();
  }

  reset() {
    this.orbit?.reset(true);
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
      if (b.state === 'crashed' && !this.seen.has(`crash${b.id}`)) {
        this.seen.add(`crash${b.id}`);
        const tw = game.towers[b.tower];
        this.closeT = 0;
        this.close = { x: toX(b.x), y: 0, side: b.x >= tw.cx ? 1 : -1, crash: true };
      }
    }
    const otherFalling = game.boosters.some((b) => b.state === 'falling' || b.state === 'waiting');
    const closeDur = otherFalling ? 0 : this.close?.crash ? 1.6 : this.cinematic ? 1.7 : 1.3;
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
    } else if (inClose && this.close.crash) {
      const c = this.close;
      const s = c.side;
      const u = this.closeT;
      P.set(c.x + s * (64 - u * 6), 9 + u * 2, (125 - u * 8) * widen);
      T.set(c.x - s * 5, 17 + u * 3, 0);
      fov = 40;
      k = 0.06;
    } else if (inClose) {
      const c = this.close;
      const s = c.side;
      const u = this.closeT;
      P.set(c.x + s * (27 - u * 3), c.y - 11 + u * 1.5, (60 - u * 5) * widen);
      T.set(c.x - s * 3, c.y + 9, 0);
      fov = 34;
      k = 0.048;
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
      // While the engines burn, extend the frame down to show the flame and its ground blast.
      const burn = b && b.state === 'falling' ? b.throttle : 0;
      const bottom = Math.max(-4, Math.min(arm - 6, catchY - 68 - 30 * burn));
      const span = top - bottom + 18;
      const halfFov = THREE.MathUtils.degToRad(fov / 2);
      const dist = clamp((span / (2 * Math.tan(halfFov))) * 1.08 * PLAY_ZOOM, 110 * PLAY_ZOOM, 290 * PLAY_ZOOM) * widen;
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
    this.clock += DT;
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

  /**
   * How much of the map's establishing shot shows at game time t: all of it on the title screen, then the
   * play camera takes over in the first seconds of a game (in the showcase, before its play starts).
   */
  establishWeight(game, t) {
    if (game.phase === 'ready') return this.cinematic ? 1 - smoothstep(this.titleTime - 1, this.titleTime, t) : 1;
    return this.cinematic ? 0 : 1 - smoothstep(0, ESTABLISH_OUT, t);
  }

  /**
   * Puts the establishing shot ({ pos, tgt, focus, fov }, framed for 16:9) in _ep and _et and returns its fov.
   * It drifts slowly round the focus (the tower's foot). Narrower screens back away from the focus at the same
   * height, so the horizon stays in view, and turn toward it.
   */
  establishPose(shot, clock) {
    const narrow = Math.max(1, 16 / 9 / this.aspect);
    const [fx, fy, fz] = shot.focus;
    const a = 0.08 * Math.sin(clock * 0.07);
    const c = Math.cos(a);
    const s = Math.sin(a);
    const place = (out, [x, , z], scale, y) => {
      const dx = (x - fx) * scale;
      const dz = (z - fz) * scale;
      return out.set(fx + dx * c + dz * s, y, fz - dx * s + dz * c);
    };
    place(this._ep, shot.pos, narrow ** 0.4, shot.pos[1]);
    place(this._et, shot.tgt, 1 / narrow, fy + (shot.tgt[1] - fy) / narrow);
    return shot.fov * narrow ** 0.15;
  }

  /**
   * alpha: how far the frame is between the last two sim steps; establish: the map's establishing shot;
   * hero: a ready-made pose ({ pos, tgt, fov }) that takes the establishing shot's place as is.
   */
  apply(camera, game, { establish = null, hero = null, alpha = 1 } = {}) {
    const t = game.t;
    const sh = game.shake * 0.09;
    let pos = this.pos;
    let tgt = this.tgt;
    let fov = this.fov;
    const w = establish || hero ? this.establishWeight(game, t - (1 - alpha) * DT) : 0;
    if (w > 0) {
      let shotFov = hero?.fov;
      if (hero) {
        this._ep.copy(hero.pos);
        this._et.copy(hero.tgt);
      } else shotFov = this.establishPose(establish, this.clock - (1 - alpha) * DT);
      pos = this._ep.lerpVectors(pos, this._ep, w);
      tgt = this._et.lerpVectors(tgt, this._et, w);
      fov += (shotFov - fov) * w;
    }
    if (this.orbit) {
      pos = this.orbit.apply(this._op.copy(pos), tgt, UP);
      pos.y = Math.max(pos.y, 7);
    }
    camera.position.set(
      pos.x + Math.sin(t * 0.63) * 0.5 + Math.sin(t * 37.1) * sh,
      pos.y + Math.sin(t * 0.47 + 1) * 0.35 + Math.sin(t * 41.7 + 2) * sh,
      pos.z + Math.sin(t * 29.3 + 4) * sh,
    );
    camera.lookAt(tgt.x + Math.sin(t * 0.31) * 0.4, tgt.y + Math.sin(t * 0.37) * 0.3, tgt.z);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
