// Free-flight input: keys and two on-screen sticks folded into the flight model's analog axes.
// Left stick: up/down climbs and descends, left/right turns. Right stick: flies in that direction.
const KEYS = {
  KeyW: ['climb', 1],
  KeyS: ['climb', -1],
  KeyA: ['yaw', -1],
  KeyD: ['yaw', 1],
  ArrowUp: ['fwd', 1],
  ArrowDown: ['fwd', -1],
  ArrowLeft: ['right', -1],
  ArrowRight: ['right', 1],
};
const DEAD = 0.12;
const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

export class FlightInput {
  constructor(sticksEl) {
    this.held = new Set();
    this.out = { climb: 0, yaw: 0, fwd: 0, right: 0, heading: 0 };
    this.sticks = {};
    for (const el of sticksEl.querySelectorAll('.stick')) this.bindStick(el);
  }

  /** Returns true if the key is a flight control. */
  key(code, down) {
    if (!KEYS[code]) return false;
    if (down) this.held.add(code);
    else this.held.delete(code);
    return true;
  }

  clear() {
    this.held.clear();
    for (const s of Object.values(this.sticks)) s.reset();
  }

  get active() {
    return this.held.size > 0 || Object.values(this.sticks).some((s) => s.id !== null);
  }

  bindStick(el) {
    const knob = el.querySelector('.knob');
    const s = { x: 0, y: 0, id: null };
    s.reset = () => {
      s.x = 0;
      s.y = 0;
      s.id = null;
      el.classList.remove('on');
      knob.style.transform = '';
    };
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      const travel = r.width * 0.32;
      let dx = (ev.clientX - (r.left + r.width / 2)) / travel;
      let dy = (ev.clientY - (r.top + r.height / 2)) / travel;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      knob.style.transform = `translate(${(dx * travel).toFixed(1)}px, ${(dy * travel).toFixed(1)}px)`;
      const live = Math.max(0, Math.min(1, m) - DEAD) / (1 - DEAD);
      const k = m > 1e-6 ? live / Math.min(1, m) : 0;
      s.x = dx * k;
      s.y = dy * k;
    };
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      try {
        el.setPointerCapture(ev.pointerId);
      } catch {
        // Synthetic pointers can't always be captured; the drag still works while over the stick.
      }
      s.id = ev.pointerId;
      el.classList.add('on');
      move(ev);
    });
    el.addEventListener('pointermove', (ev) => {
      if (ev.pointerId === s.id) move(ev);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      el.addEventListener(type, (ev) => {
        if (ev.pointerId === s.id) s.reset();
      });
    }
    el.addEventListener('contextmenu', (ev) => ev.preventDefault());
    this.sticks[el.dataset.stick] = s;
  }

  /** Current axes; heading is the camera heading the arrows fly relative to. */
  read(heading) {
    const o = this.out;
    const h = this.held;
    const l = this.sticks.l ?? { x: 0, y: 0 };
    const r = this.sticks.r ?? { x: 0, y: 0 };
    o.climb = clamp1((h.has('KeyW') ? 1 : 0) - (h.has('KeyS') ? 1 : 0) - l.y);
    o.yaw = clamp1((h.has('KeyD') ? 1 : 0) - (h.has('KeyA') ? 1 : 0) + l.x);
    o.fwd = clamp1((h.has('ArrowUp') ? 1 : 0) - (h.has('ArrowDown') ? 1 : 0) - r.y);
    o.right = clamp1((h.has('ArrowRight') ? 1 : 0) - (h.has('ArrowLeft') ? 1 : 0) + r.x);
    o.heading = heading;
    return o;
  }
}
