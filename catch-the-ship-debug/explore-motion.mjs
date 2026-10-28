// Per-frame motion of selected explore glides: camera step per 1/60 s frame (m) and the clamp's correction, to see
// lurches at the start or end of a bent glide. Glide specs: "<from>[:<dTheta>,<scale>]><to>" with preset numbers,
// e.g. "4:80,1>5" (Ring orbited 80 degrees, then Nose) or "9>2".
// Usage: node explore-motion.mjs <base-url> <spec> [<spec> ...]
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
    key(to);
    const clamp = e.clamp;
    let corr = 0;
    e.clamp = function () {
      const before = cam.clone();
      clamp.call(this);
      before.y = Math.max(1.5, before.y);
      corr = before.distanceTo(cam);
    };
    const steps = [];
    const path = [cam.clone()];
    for (let k = 0; k < 900 && e.flight; k++) {
      e.frame(1 / 60);
      steps.push([+path.at(-1).distanceTo(cam).toFixed(2), +corr.toFixed(2), +e.toModel(cam).toFixed(2)]);
      path.push(cam.clone());
    }
    // Jerk: how much the step vector changes from one frame to the next (m per frame per frame).
    let jerk = 0;
    let jerkAt = 0;
    for (let k = 1; k + 1 < path.length; k++) {
      const a = path[k + 1].clone().sub(path[k]).sub(path[k].clone().sub(path[k - 1])).length();
      if (a > jerk) [jerk, jerkAt] = [a, k];
    }
    e.clamp = clamp;
    e.view.render = render;
    return { steps, jerk: +jerk.toFixed(3), jerkAt };
  }, { from: +from, dTheta: +dTheta, scale: +scale, to: +to });
  const { steps, jerk, jerkAt } = r;
  const peak = Math.max(...steps.map((s) => s[0]));
  const head = steps.slice(0, 16).map((s) => `${s[0]}${s[1] > 0.005 ? `(c${s[1]})` : ''}`).join(' ');
  const tail = steps.slice(-12).map((s) => `${s[0]}${s[1] > 0.005 ? `(c${s[1]})` : ''}`).join(' ');
  const mid = steps.map((s) => s[0]);
  const third = Math.floor(mid.length / 3);
  console.log(`${spec}: ${steps.length} frames, peak step ${peak} m, jerk ${jerk} at frame ${jerkAt}, min clearance ${Math.min(...steps.map((s) => s[2]))}`);
  console.log(`  first 16 steps: ${head}`);
  console.log(`  middle max: ${Math.max(...mid.slice(third, 2 * third))}`);
  console.log(`  last 12 steps: ${tail}`);
}
await browser.close();
