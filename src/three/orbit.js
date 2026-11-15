import * as THREE from 'three';

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const YAW_PER_PX = 0.006;
const PITCH_PER_PX = 0.005;
const ZOOM_MIN = 0.35;
const ZOOM_MAX = 3;
// In flight the camera pulls back much further and swings right under the vehicle, so the planet fits around it.
const FLIGHT_ZOOM_MAX = 20;
const FLIGHT_ELEV = 1.5;
// Lowest and highest elevation (radians above the horizon) a drag can take the camera to.
const ELEV_MIN = -0.3;
const ELEV_MAX = 1.45;

/**
 * The player's look-around offset on top of a director's shot: drag to orbit the shot's target, wheel or pinch to
 * zoom, double-click to reset. Takes input only while a game or flight is being played and not paused.
 * In 'flight' mode the orbit swings further above and below the vehicle and the wheel pulls back further.
 */
export class Orbit {
  constructor(el) {
    this.mode = 'orbit';
    this.want = { yaw: 0, pitch: 0, zoom: 1 };
    this.yaw = 0;
    this.pitch = 0;
    this.zoom = 1;
    this.last = 0;
    this.pointers = new Map();
    this.pinch = 0;
    this._h = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    if (el) this.listen(el);
  }

  get active() {
    const c = document.body.classList;
    if (c.contains('playing')) return !c.contains('paused');
    // The home screen can be looked around too, unless How to play covers it.
    const home = document.getElementById('title-screen');
    return !!home && !home.classList.contains('hidden') && !home.classList.contains('helping');
  }

  reset(snap = false) {
    Object.assign(this.want, { yaw: 0, pitch: 0, zoom: 1 });
    if (snap) Object.assign(this, { yaw: 0, pitch: 0, zoom: 1 });
  }

  listen(el) {
    const ps = this.pointers;
    const spread = () => {
      const [a, b] = [...ps.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };
    el.addEventListener('pointerdown', (e) => {
      if (!this.active || (e.pointerType === 'mouse' && e.button !== 0)) return;
      ps.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ps.size === 2) this.pinch = spread();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      const p = ps.get(e.pointerId);
      if (!p) return;
      if (ps.size === 1) {
        this.want.yaw -= (e.clientX - p.x) * YAW_PER_PX;
        this.want.pitch = clamp(this.want.pitch + (e.clientY - p.y) * PITCH_PER_PX, -1.6, 1.6);
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (ps.size === 2) {
        const d = spread();
        if (this.pinch > 0 && d > 0) this.zoomBy(this.pinch / d);
        this.pinch = d;
      }
    });
    const up = (e) => {
      ps.delete(e.pointerId);
      this.pinch = 0;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        e.preventDefault();
        this.zoomBy(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
      },
      { passive: false },
    );
    el.addEventListener('dblclick', () => this.active && this.reset());
  }

  zoomBy(f) {
    this.want.zoom = clamp(this.want.zoom * f, ZOOM_MIN, this.mode === 'flight' ? FLIGHT_ZOOM_MAX : ZOOM_MAX);
  }

  /** 'orbit' for the catch game and home screen, 'flight' for free flight; resets the offset. */
  setMode(mode) {
    this.mode = mode;
    this.reset(true);
  }

  /** Moves pos about tgt by the current offset, with up as the vertical; eases toward the input once per frame. */
  apply(pos, tgt, up) {
    const now = performance.now();
    const k = 1 - Math.exp(-Math.min(0.1, (now - this.last) / 1000) * 12);
    this.last = now;
    const w = this.want;
    this.yaw += (w.yaw - this.yaw) * k;
    this.pitch += (w.pitch - this.pitch) * k;
    this.zoom += (w.zoom - this.zoom) * k;
    if (Math.abs(this.yaw) < 1e-4 && Math.abs(this.pitch) < 1e-4 && Math.abs(this.zoom - 1) < 1e-4) return pos;
    const rel = pos.sub(tgt);
    const r = rel.length();
    const y = rel.dot(up);
    const h = this._h.copy(rel).addScaledVector(up, -y);
    const hl = h.length();
    if (hl < 1e-6 * r) return pos.add(tgt);
    h.divideScalar(hl).applyQuaternion(this._q.setFromAxisAngle(up, this.yaw));
    const e = Math.atan2(y, hl);
    const [lo, hi] = this.mode === 'flight' ? [-FLIGHT_ELEV, FLIGHT_ELEV] : [ELEV_MIN, ELEV_MAX];
    const e2 = clamp(e + this.pitch, Math.min(e, lo), Math.max(e, hi));
    const d = r * this.zoom;
    return pos.copy(tgt).addScaledVector(h, Math.cos(e2) * d).addScaledVector(up, Math.sin(e2) * d);
  }
}
