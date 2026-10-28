// The committed Explore.light() (863f834) for page.evaluate(lampSpeedFade, cfg), with the camera lamp dimmed while
// nearby surfaces sweep past fast. cfg.by: 'omega' (camera speed over its distance to the model, rad/s) or 'speed'
// (m/s); cfg.range: [full below, off above], or none to only measure. Steps are 1/60 s, as explore-flash.mjs runs.
// Leaves window.__fade with the largest rate per segment (window.__seg) while the lamp is on.
export function lampSpeedFade(cfg) {
  const e = window.__explore;
  const cam = e.view.camera;
  const ss = (x, a, b) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  let prev = null;
  window.__fade = {};
  e.light = () => {
    const p = cam.position;
    const stack = Math.min(...e.hull.map((h) => h(p)));
    const fade = 1 - ss(stack, 25, 40);
    const near = Math.min(stack, e.toModel(p));
    const speed = prev ? prev.distanceTo(p) * 60 : 0;
    prev = p.clone();
    const rate = cfg.by === 'omega' ? speed / Math.max(near, 0.1) : speed;
    const still = cfg.range ? 1 - ss(rate, ...cfg.range) : 1;
    if (fade > 0.01) window.__fade[window.__seg] = Math.max(window.__fade[window.__seg] ?? 0, +rate.toFixed(1));
    e.lamp.position.set(0.2 * near, 0.3 * near, 0).applyQuaternion(cam.quaternion).add(p);
    e.lamp.intensity = 4.5 * near * near * fade * still;
    e.fill.intensity = 800 * fade;
  };
}
