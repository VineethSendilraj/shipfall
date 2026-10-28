// Saves lossless frames of the catch game's ?demo=1&capture=1 showcase from one server, so two servers (main and a
// branch, run one after the other on the same port) can be diffed with explore-png-cmp.mjs.
// Usage: node explore-catch-ab.mjs <base-url> <out-dir> <label> [maps, default starbase,mars] [frames] [w] [h]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, dir, label, maps = 'starbase,mars', list = '60,150,400,900,1500,2200', w = '1280', h = '720'] = process.argv.slice(2);
const frames = list.split(',').map(Number);
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const map of maps.split(',')) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
  await page.goto(`${base}/?demo=1&capture=1&map=${map}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__demoReady === true, null, { polling: 100, timeout: 240000 });
  let at = await page.evaluate(() => window.__demoFrame);
  for (const fr of frames) {
    const r = await page.evaluate((n) => {
      const s = window.__advance(n, true);
      return { ...s, png: document.getElementById('gl').toDataURL('image/png') };
    }, fr - at);
    at = r.frame;
    fs.writeFileSync(`${dir}/${label}-${map}-${fr}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(label, map, 'frame', r.frame, 'score', r.score, r.done ? 'done' : '');
  }
  await page.close();
}
await browser.close();
