import * as THREE from 'three';
import { DT } from '../sim.js';

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const HEADING_EASE = 1 - Math.exp(-DT * 2.0);
const ORBIT_RETURN = 1 - Math.exp(-DT * 1.2);

/**
 * Free-flight camera, stepped with the simulation like the catch game's Director: a low shot from the pad
 * that looks up at the stack, a chase camera behind and above it that pulls back with speed and altitude,
 * a slow orbit after a landing, and a hold on the explosion after a crash. Pointer drags orbit it.
 */
export class FlightCamera {
  constructor() {
    this.pos = new THREE.Vector3();
    this.tgt = new THREE.Vector3();
    this.fov = 46;
    this.heading = 0;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.dragging = false;
    this.idle = 0;
    this.launched = false;
    this.initialized = false;
    this.endT = -1;
    this.lift = 0;
    this._p = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._d = new THREE.Vector3();
  }

  reset(f, lift = 0) {
    this.heading = f.yaw;
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.launched = false;
    this.initialized = false;
    this.endT = -1;
    this.phase = f.phase;
    this.step(f, lift);
  }

  /** Heading the arrow keys fly relative to: where the camera looks. */
  get viewHeading() {
    return this.heading + this.orbitYaw;
  }

  drag(dx, dy) {
    this.orbitYaw -= dx * 0.006;
    this.orbitPitch = Math.max(-0.25, Math.min(0.6, this.orbitPitch + dy * 0.003));
    this.idle = 0;
  }

  desired(f) {
    const P = this._p;
    const T = this._t;
    const { pos: com, vel, mount } = f;
    // Tall embeds lift the view (a phone sheet covers the bottom 30%), which narrows what's visible: pull
    // back and aim at the middle of the stack there.
    const zoom = 1 + this.lift * 2.6;
    const mid = this.lift * 0.4;
    const h = Math.max(0, f.lowY);
    const speed = Math.hypot(vel.x, vel.y, vel.z);
    if (f.phase === 'flying' || f.phase === 'ready') this.heading += wrap(f.yaw - this.heading) * HEADING_EASE;
    const hd = this.heading + this.orbitYaw;
    const bx = Math.sin(hd);
    const bz = Math.cos(hd);

    if (f.phase === 'crashed') {
      // A wide shot of the fireball, drifting back as it burns. After hitting something, the camera swings
      // round to the side the stack bounced off, so whatever it hit stands behind the explosion.
      const u = f.t - f.endT;
      const im = f.impact;
      T.set(im.x, Math.max(26, im.y * 0.6 + 22), im.z);
      const d = this._d;
      if (!this.initialized) {
        d.subVectors(this.pos, T);
        d.y = 0;
        d.normalize();
        d.x += im.ax * 2.5;
        d.z += im.az * 2.5;
        d.normalize();
      }
      const dist = (215 + u * 8) * zoom;
      P.set(T.x + d.x * dist, Math.max(14, f.impact.y * 0.5 + 34 + u * 2), T.z + d.z * dist);
      return 46;
    }
    if (f.phase === 'landed') {
      const u = f.t - f.endT;
      const a = hd + u * 0.12;
      const H = f.stackH;
      T.set(com.x, f.base.y + H * (0.4 + mid), com.z);
      P.set(com.x + Math.sin(a) * 1.75 * H * zoom, f.base.y + 16 + this.orbitPitch * 120, com.z + Math.cos(a) * 1.75 * H * zoom);
      return 44;
    }

    // Chase: behind and above, framed on the whole stack with its skirt clear of the HUD bar, further back
    // the faster and higher it goes, and looking down on the site from up high.
    const H = f.stackH;
    const high = smooth(30, 650, h);
    // Close to whatever is below, pull back and aim lower so the skirt and the landing spot stay in frame.
    const low = 1 - smooth(25, 130, f.agl);
    const dist = ((1.75 + 0.25 * low) * H + 1.3 * speed + 0.15 * Math.min(h, 1000)) * zoom;
    const lift = (0.1 + 0.36 * high - 0.04 * low + this.orbitPitch) * dist;
    T.set(com.x + vel.x * 0.4, f.base.y + H * (0.36 + mid - 0.05 * low) + vel.y * 0.25 - high * 35, com.z + vel.z * 0.4);
    P.set(T.x + bx * dist, T.y + lift, T.z + bz * dist);
    let fov = 44 + Math.min(6, speed * 0.12);

    // From the pad: low and looking up between the towers, handing over to the chase as the stack climbs away.
    if (!this.launched) {
      const k = Math.max(smooth(4, 90, f.lowY - mount.top), smooth(20, 70, Math.hypot(f.base.x - mount.x, f.base.z - mount.z)));
      if (k >= 1) this.launched = true;
      else {
        const a = hd - 0.32 + Math.sin(f.t * 0.11) * 0.05;
        const px = mount.x + Math.sin(a) * 1.4 * f.stackH * zoom;
        const pz = mount.z + Math.cos(a) * 1.4 * f.stackH * zoom;
        const py = 9;
        const ty = f.base.y + f.stackH * (0.36 + mid);
        P.set(px + (P.x - px) * k, py + (P.y - py) * k, pz + (P.z - pz) * k);
        T.set(com.x + (T.x - com.x) * k, ty + (T.y - ty) * k, com.z + (T.z - com.z) * k);
        fov = 54 + (fov - 54) * k;
      }
    }
    return fov;
  }

  /** lift: the view's tall-embed offset (View.lift). */
  step(f, lift = this.lift) {
    this.lift = lift;
    // Cut straight to the wide shot when the stack blows up: the first half second is the best part.
    if (f.phase === 'crashed' && this.phase !== 'crashed') this.initialized = false;
    this.phase = f.phase;
    if (!this.dragging) {
      this.idle += DT;
      if (this.idle > 1.2) {
        this.orbitYaw *= 1 - ORBIT_RETURN;
        this.orbitPitch *= 1 - ORBIT_RETURN;
      }
    }
    const fov = this.desired(f);
    const P = this._p;
    // Keep the camera above whatever is under it.
    const floor = Math.hypot(P.x - f.mount.x, P.z - f.mount.z) < f.mount.r + 6 ? f.mount.top + 4 : 3;
    if (P.y < floor) P.y = floor;
    if (!this.initialized) {
      this.pos.copy(P);
      this.tgt.copy(this._t);
      this.fov = fov;
      this.initialized = true;
      return;
    }
    const k = f.phase === 'crashed' ? 0.045 : this.launched ? 0.07 : 0.05;
    this.pos.lerp(P, k);
    this.tgt.lerp(this._t, 0.14);
    this.fov += (fov - this.fov) * 0.05;
  }

  /** Places the three.js camera; shake comes from the explosion and from the engines near the ground. */
  apply(camera, f, pos = this.pos, tgt = this.tgt, fov = this.fov) {
    const t = f.t;
    const rumble = f.engines ? f.throttle * Math.max(0, 1 - f.agl / 70) * 0.7 : 0;
    const sh = f.shake * 0.11 + rumble;
    camera.position.set(pos.x + Math.sin(t * 0.63) * 0.6 + Math.sin(t * 37.1) * sh, pos.y + Math.sin(t * 0.47 + 1) * 0.4 + Math.sin(t * 41.7 + 2) * sh, pos.z + Math.sin(t * 29.3 + 4) * sh);
    camera.lookAt(tgt.x + Math.sin(t * 0.31) * 0.4, tgt.y + Math.sin(t * 0.37) * 0.3, tgt.z);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
}
