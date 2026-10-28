// Steps the showcase to the same frames on two builds and measures the 3D canvas: mean luma and the share of
// near-white pixels. Usage: node cmp-shine.mjs <tag>=<origin> [...] -- <frame,frame,...>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const sep = process.argv.indexOf('--');
const builds = process.argv.slice(2, sep).map((a) => a.split('='));
const frames = process.argv[sep + 1].split(',').map(Number);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const [tag, origin] of builds) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(tag, 'pageerror:', e.message));
  await page.goto(`${origin}/?demo=1&capture=1&quality=high${process.env.Q || ''}`, { timeout: 120000 });
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  for (const f of frames) {
    let cur = (await page.evaluate(() => window.__advance(0, false))).frame;
    while (f - cur > 4) cur = (await page.evaluate((n) => window.__advance(n, false), Math.min(120, f - cur - 4))).frame;
    while (cur < f) cur = (await page.evaluate(() => window.__advance(1, true))).frame;
    const s = await page.evaluate(() => {
      const src = document.querySelector('canvas');
      const c = document.createElement('canvas');
      c.width = src.width;
      c.height = src.height;
      const g = c.getContext('2d');
      g.drawImage(src, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      let bright = 0;
      let clip = 0;
      const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) {
        const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        sum += y;
        if (y >= 200) bright++;
        if (y >= 245) clip++;
      }
      return { mean: +(sum / n).toFixed(1), brightPct: +((100 * bright) / n).toFixed(2), clipPct: +((100 * clip) / n).toFixed(3) };
    });
    await page.screenshot({ path: `${D}/shine-${tag}-f${f}.jpg`, type: 'jpeg', quality: 85 });
    console.log(JSON.stringify({ tag, f, ...s }));
  }
  await page.close();
}
await browser.close();
