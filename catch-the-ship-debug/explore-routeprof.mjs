// Profiles route() for glide specs: total time, time inside escape(), and toModel() calls inside and outside escape().
// Usage: node explore-routeprof.mjs <base-url> <spec> [<spec> ...]
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
    const toModel = e.toModel;
    const escape = e.escape;
    let calls = 0;
    let escCalls = 0;
    let escMs = 0;
    let inEscape = false;
    e.toModel = function (p) {
      if (inEscape) escCalls++;
      else calls++;
      return toModel.call(this, p);
    };
    e.escape = function (p, dir, limit) {
      inEscape = true;
      const t0 = performance.now();
      const v = escape.call(this, p, dir, limit);
      escMs += performance.now() - t0;
      inEscape = false;
      return v;
    };
    const t0 = performance.now();
    key(to);
    const ms = performance.now() - t0;
    e.toModel = toModel;
    e.escape = escape;
    return { ms: +ms.toFixed(1), escMs: +escMs.toFixed(1), escCalls, otherCalls: calls, line: !!e.flight?.line };
  }, { from: +from, dTheta: +dTheta, scale: +scale, to: +to });
  console.log(`${spec}: ${JSON.stringify(r)}`);
}
await browser.close();
