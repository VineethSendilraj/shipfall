// Routed-path detail for explore glides: for each of the 201 route samples, the bend length and the clearance of the
// unbent and the bent sample (before the per-frame clamp), plus every frame's step and clamp correction.
// Glide specs as in explore-motion.mjs, e.g. "4:80,1>5".
// Usage: node explore-route.mjs <base-url> <spec> [<spec> ...]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', ...specs] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
for (const spec of specs) {
  const [, from, dTheta = '0', scale = '1', to] = spec.match(/^(\d)(?::([-\d.]+),([\d.]+))?>(\d)$/);
  const r = await page.evaluate(({ from, dTheta, scale, to }) => {
    const e = window.__explore;
    const key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
    const render = e.view.render;
    e.view.render = () => {};
    const cam = e.view.camera.position;
    key(from);
    for (let k = 0; k < 900 && e.flight; k++) e.frame(1 / 60);
    const t = e.controls.target;
    const o = cam.clone().sub(t);
    const rad = o.length();
    const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
    const phi = Math.acos(o.y / rad);
    cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
    e.frame(1 / 60);
    const foot = e.foot;
    const rel = (p) => [p.x - foot.x, p.y, p.z - foot.z].map((n) => +n.toFixed(1));
    const start = rel(cam);
    key(to);
    const f = e.flight;
    const V = cam.constructor;
    const samples = [];
    for (let i = 0; i <= 200; i++) {
      const q = e.glideAt(f, i / 200, new V(), new V());
      const raw = e.toModel(q);
      const b = f.bend[i];
      q.add(b);
      samples.push({ i, raw: +raw.toFixed(2), bent: +e.toModel(q).toFixed(2), bend: [b.x, b.y, b.z].map((n) => +n.toFixed(2)), at: rel(q) });
    }
    const clamp = e.clamp;
    let corr = 0;
    let pre = 0;
    e.clamp = function () {
      const before = cam.clone();
      before.y = Math.max(1.5, before.y);
      pre = e.toModel(before);
      clamp.call(this);
      corr = before.distanceTo(cam);
    };
    const frames = [];
    let prev = cam.clone();
    for (let k = 0; k < 900 && e.flight; k++) {
      e.frame(1 / 60);
      const tt = e.flight?.t ?? 1;
      frames.push({ k, step: +prev.distanceTo(cam).toFixed(2), corr: +corr.toFixed(2), pre: +pre.toFixed(2), e: +(tt * tt * (3 - 2 * tt)).toFixed(4), at: rel(cam) });
      prev = cam.clone();
    }
    e.clamp = clamp;
    e.view.render = render;
    return { start, samples, frames };
  }, { from: +from, dTheta: +dTheta, scale: +scale, to: +to });
  console.log(`== ${spec}: start ${JSON.stringify(r.start)}`);
  console.log('samples (i raw bent |bend| bend at):');
  for (const s of r.samples) {
    const len = Math.hypot(...s.bend);
    if (s.raw < 2.5 || s.bent < 2.5 || len > 0.01) console.log(`  ${s.i} raw ${s.raw} bent ${s.bent} |bend| ${len.toFixed(2)} ${JSON.stringify(s.bend)} ${JSON.stringify(s.at)}`);
  }
  console.log('frames (k e step corr pre at):');
  for (const fr of r.frames) console.log(`  ${fr.k} e ${fr.e} step ${fr.step} corr ${fr.corr} pre ${fr.pre} ${JSON.stringify(fr.at)}`);
}
await browser.close();
