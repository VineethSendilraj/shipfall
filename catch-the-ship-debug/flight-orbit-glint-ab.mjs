// Pixel A/B through saved PNGs, so the reference can be captured before the code changes.
// Usage: node flight-orbit-glint-ab.mjs capture <base> <tag> [frames] [demo|flight]
//        node flight-orbit-glint-ab.mjs compare <tagA> <tagB> [frames]
// PNGs go to /tmp/glint/<tag>-<frame>.png.
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const DIR = '/tmp/glint';
const [mode, x, y, list = '352,398,823,1380,1466', scene = 'demo'] = process.argv.slice(2);
const frames = list.split(',').map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

if (mode === 'capture') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${x}/?${scene}=1&capture=1`, { timeout: 180000 });
  await page.waitForFunction((s) => window[s === 'demo' ? '__demoReady' : '__flightReady'] === true, scene, { timeout: 180000 });
  let at = 0;
  for (const fr of frames) {
    const { url, frame } = await page.evaluate((n) => {
      const r = window.__advance(n, true);
      return { url: document.getElementById('gl').toDataURL('image/png'), frame: r.frame };
    }, fr - at);
    at = fr;
    writeFileSync(`${DIR}/${y}-${fr}.png`, Buffer.from(url.split(',')[1], 'base64'));
    console.log('saved', `${DIR}/${y}-${fr}.png`, 'at frame', frame);
  }
} else {
  const page = await browser.newPage();
  for (const fr of frames) {
    const a = 'data:image/png;base64,' + readFileSync(`${DIR}/${x}-${fr}.png`).toString('base64');
    const b = 'data:image/png;base64,' + readFileSync(`${DIR}/${y}-${fr}.png`).toString('base64');
    const r = await page.evaluate(async ([pa, pb]) => {
      const load = async (src) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = new OffscreenCanvas(img.width, img.height);
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return { w: img.width, d: g.getImageData(0, 0, img.width, img.height).data };
      };
      const [p, q] = await Promise.all([load(pa), load(pb)]);
      let max = 0, at = null, changed = 0, over8 = 0, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let k = 0; k < p.d.length; k += 4) {
        const d = Math.max(Math.abs(p.d[k] - q.d[k]), Math.abs(p.d[k + 1] - q.d[k + 1]), Math.abs(p.d[k + 2] - q.d[k + 2]));
        if (!d) continue;
        changed++;
        if (d > 8) over8++;
        const i = k / 4, px = i % p.w, py = Math.floor(i / p.w);
        if (d > max) {
          max = d;
          at = [px, py];
        }
        x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
      }
      return { changed, over8, max, at, bbox: changed ? [x0, y0, x1, y1] : null };
    }, [a, b]);
    console.log(`frame ${fr}`, JSON.stringify(r));
  }
}
await browser.close();
