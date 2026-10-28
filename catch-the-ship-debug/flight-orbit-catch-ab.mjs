// Pixel A/B of the catch game's demo between two servers, at the same frame-stepped frames.
// Usage: node flight-orbit-catch-ab.mjs <base A> <base B> [frames, e.g. 200,600,1200]
import { writeFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [a, b, list = '200,600,1200'] = process.argv.slice(2);
const frames = list.split(',').map(Number);
const DIR = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function grab(base) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/?demo=1&capture=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  const out = [];
  let at = 0;
  for (const fr of frames) {
    out.push(await page.evaluate((n) => {
      window.__advance(n, true);
      return document.querySelector('canvas').toDataURL('image/png');
    }, fr - at));
    at = fr;
  }
  await page.close();
  return out;
}

const A = await grab(a);
const B = await grab(b);
const page = await browser.newPage();
for (let i = 0; i < frames.length; i++) {
  const r = await page.evaluate(async ([x, y]) => {
    const load = async (src) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = new OffscreenCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, img.width, img.height).data;
    };
    const [p, q] = await Promise.all([load(x), load(y)]);
    let sum = 0, max = 0, over8 = 0;
    for (let k = 0; k < p.length; k += 4) {
      const d = Math.max(Math.abs(p[k] - q[k]), Math.abs(p[k + 1] - q[k + 1]), Math.abs(p[k + 2] - q[k + 2]));
      sum += d;
      if (d > max) max = d;
      if (d > 8) over8++;
    }
    return { mean: +(sum / (p.length / 4)).toFixed(4), max, over8 };
  }, [A[i], B[i]]);
  console.log(`frame ${frames[i]}`, JSON.stringify(r));
  writeFileSync(`${DIR}/flight-orbit-ab-${frames[i]}-a.png`, Buffer.from(A[i].split(',')[1], 'base64'));
  writeFileSync(`${DIR}/flight-orbit-ab-${frames[i]}-b.png`, Buffer.from(B[i].split(',')[1], 'base64'));
}
await browser.close();
