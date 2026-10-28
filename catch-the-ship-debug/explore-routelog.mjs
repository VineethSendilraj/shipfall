// Prints the router's per-axis costs for one glide spec (needs the temporary window.__routeLog hook in explore.js).
// Usage: node explore-routelog.mjs <base-url> <spec>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', spec] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(500);
const [, from, dTheta = '0', scale = '1', to] = spec.match(/^(\d)(?::([-\d.]+),([\d.]+))?>(\d)$/);
const log = await page.evaluate(({ from, dTheta, scale, to }) => {
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
  window.__routeLog = [];
  key(to);
  const out = window.__routeLog;
  window.__routeLog = null;
  return out;
}, { from: +from, dTheta: +dTheta, scale: +scale, to: +to });
for (const r of log) console.log(JSON.stringify(r));
await browser.close();
