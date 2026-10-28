// Difference image of one showcase frame between two servers: |A - B| times `gain`, plus mean change per region.
// Usage: node texas-diffimg.mjs <baseA> <baseB> <w> <h> <frame> <out.png> [extraQuery] [gain]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [A, B, w, h, frame, out, extra = '', gain = '8'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function grab(base) {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/?demo=1&capture=1${extra}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
  const f = Number(frame);
  const cur = await page.evaluate(() => window.__demoFrame);
  if (f - cur > 3) await page.evaluate((n) => window.__advance(n, false), f - cur - 3);
  while ((await page.evaluate(() => window.__demoFrame)) < f) await page.evaluate(() => window.__advance(1, true));
  const png = (await page.screenshot({ type: 'png' })).toString('base64');
  await page.close();
  return png;
}

const a = await grab(A);
const b = await grab(B);
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ x, y, gain }) => {
    const load = async (s) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return [g.getImageData(0, 0, bmp.width, bmp.height), bmp.width, bmp.height];
    };
    const [p, W, H] = await load(x);
    const [q] = await load(y);
    const c = new OffscreenCanvas(W, H);
    const g = c.getContext('2d');
    const img = g.createImageData(W, H);
    let n = 0;
    for (let i = 0; i < p.data.length; i += 4) {
      let m = 0;
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(p.data[i + k] - q.data[i + k]);
        img.data[i + k] = Math.min(255, d * gain);
        m = Math.max(m, d);
      }
      img.data[i + 3] = 255;
      if (m) n++;
    }
    g.putImageData(img, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { png: btoa(s), differing: n };
  },
  { x: a, y: b, gain: Number(gain) },
);
const fs = await import('node:fs');
fs.writeFileSync(out, Buffer.from(res.png, 'base64'));
console.log(`frame ${frame}: differing ${res.differing}`);
await browser.close();
