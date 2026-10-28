// Steps the whole capture showcase one rendered frame at a time and reports the frames that took long on the
// main thread or added shader programs (with the new programs' names), to find mid-run compiles.
// Usage: node texas-hitch.mjs <base> [w] [h] [extraQuery] [thresholdMs]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', extra = '', thr = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
const r = await page.evaluate((thr) => {
  const info = window.__view.renderer.info;
  const seen = new Set(info.programs.map((p) => p.id));
  const events = [];
  for (let k = 0; k < 4000; k++) {
    const t0 = performance.now();
    const res = window.__advance(1, true);
    const dt = performance.now() - t0;
    const fresh = info.programs.filter((p) => !seen.has(p.id));
    for (const p of fresh) seen.add(p.id);
    if (dt > thr || fresh.length) events.push({ frame: res.frame, ms: +dt.toFixed(1), programs: fresh.map((p) => p.name) });
    if (res.done) break;
  }
  return { start: info.programs.length - events.reduce((n, e) => n + e.programs.length, 0), end: info.programs.length, events };
}, +thr);
console.log(JSON.stringify({ base, extra, ...r }, null, 1));
await browser.close();
