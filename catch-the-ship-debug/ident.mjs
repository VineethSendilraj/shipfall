// Pixel comparison of the ?demo=1&capture=1 showcase between two servers (e.g. final-preview vs a branch).
// Screenshots the same sim frames on both, then decodes and diffs them in a blank page.
// Usage: node ident.mjs <baseA> <baseB> <w> <h> <framesCsv> [extraQueryForB] [roundtrip]
// With "roundtrip", page B switches the map to Mars and back to Starbase (view.setMap) before it advances.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [A, B, w, h, framesCsv, extraB = '', roundtrip = ''] = process.argv.slice(2);
const frames = framesCsv.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });

async function grab(base, extra, flip = false) {
  const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/?demo=1&capture=1${extra}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 60000 });
  if (flip) {
    await page.evaluate(() => window.__view.setMap('mars'));
    await page.evaluate(() => window.__advance(1, true));
    await page.evaluate(() => window.__view.setMap('starbase'));
    console.log('B: map round trip done, frame', await page.evaluate(() => window.__demoFrame));
  }
  const out = {};
  for (const f of frames) {
    const cur = await page.evaluate(() => window.__demoFrame);
    if (f - cur > 3) await page.evaluate((n) => window.__advance(n, false), f - cur - 3);
    while ((await page.evaluate(() => window.__demoFrame)) < f) await page.evaluate(() => window.__advance(1, true));
    out[f] = (await page.screenshot({ type: 'png' })).toString('base64');
  }
  await page.close();
  return out;
}

const a = await grab(A, '');
const b = await grab(B, extraB, roundtrip === 'roundtrip');
const page = await browser.newPage();
for (const f of frames) {
  const r = await page.evaluate(
    async ({ x, y }) => {
      const load = async (s) => {
        const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
        const c = new OffscreenCanvas(bmp.width, bmp.height);
        const g = c.getContext('2d');
        g.drawImage(bmp, 0, 0);
        return g.getImageData(0, 0, bmp.width, bmp.height).data;
      };
      const p = await load(x), q = await load(y);
      let n = 0, max = 0, sum = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        if (d) n++;
        if (d > max) max = d;
        sum += d;
      }
      return { differing: n, max, mean: +(sum / (p.length / 4)).toFixed(4) };
    },
    { x: a[f], y: b[f] },
  );
  console.log(`frame ${f}: ${JSON.stringify(r)}`);
}
await browser.close();
