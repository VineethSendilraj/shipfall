// A candidate Explore.light() for page.evaluate(lampVariant, cfg). The lamp lights the stack as if it were no
// farther than reach = min(distance to the hull, K * distance to the nearest keep-out shape). Its offset from the
// camera scales with: 'near' (the hull distance, as the committed code), 'reach', or 'clear' (min of the hull and
// nearest-shape distances). Leaves window.__lit with the numbers of the last frame.
export function lampVariant(cfg) {
  const e = window.__explore;
  const cam = e.view.camera;
  e.light = () => {
    const p = cam.position;
    const near = Math.max(1, Math.min(...e.hull.map((h) => h(p))));
    const t = Math.min(1, Math.max(0, (near - 25) / 15));
    const fade = 1 - t * t * (3 - 2 * t);
    const clear = e.toModel(p);
    const reach = Math.min(near, (cfg.K ?? Infinity) * clear);
    const off = { near, reach, clear: Math.min(near, clear) }[cfg.off ?? 'near'];
    e.lamp.position.set(0.2 * off, 0.3 * off, 0).applyQuaternion(cam.quaternion).add(p);
    e.lamp.intensity = (cfg.lux ?? 4.5) * reach * reach * fade;
    e.fill.intensity = (cfg.fill ?? 800) * fade;
    window.__lit = { near: +near.toFixed(2), clear: +clear.toFixed(2), reach: +reach.toFixed(2), lamp: Math.round(e.lamp.intensity), lampClear: +e.toModel(e.lamp.position).toFixed(2), fade: +fade.toFixed(2) };
  };
}
