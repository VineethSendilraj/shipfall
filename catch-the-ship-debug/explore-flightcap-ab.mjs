// Saves lossless frames of the piloted free flight (?flight=1&capture=1, frame-stepped) from one server, so main and
// a branch, run one after the other on the same port, can be diffed with explore-png-cmp.mjs.
// Writes <out>/<label>-flight-<map>-<frame>.png.
// Usage: node explore-flightcap-ab.mjs <base-url> <out-dir> <label> [maps, default starbase,mars] [frames] [w] [h]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, dir, label, maps = 'starbase,mars', list = '30,240,900,2400', w = '1280', h = '720'] = process.argv.slice(2);
const frames = list.split(',').map(Number);
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const map of maps.split(',')) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.goto(`${base}/?flight=1&capture=1&map=${map}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__flightReady === true, null, { polling: 100, timeout: 240000 });
  let at = await page.evaluate(() => window.__flight.frame);
  for (const fr of frames) {
    const r = await page.evaluate((n) => {
      const s = window.__advance(n, true);
      return { ...s, png: document.getElementById('gl').toDataURL('image/png') };
    }, fr - at);
    at = r.frame;
    fs.writeFileSync(`${dir}/${label}-flight-${map}-${fr}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(label, map, 'frame', r.frame, r.phase, r.mode, r.booster, r.done ? 'done' : '');
  }
  await page.close();
}
await browser.close();
