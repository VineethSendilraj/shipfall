// Diffs same-named PNG pairs <dir>/<labelA>-<rest>.png and <dir>/<labelB>-<rest>.png in a blank headless page.
// Prints, per pair, how many pixels differ, the largest channel difference and the mean.
// Usage: node explore-png-cmp.mjs <dir> <labelA> <labelB>
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [dir, a, b] = process.argv.slice(2);
const rests = fs
  .readdirSync(dir)
  .filter((f) => f.startsWith(`${a}-`) && f.endsWith('.png'))
  .map((f) => f.slice(a.length + 1))
  .filter((rest) => fs.existsSync(`${dir}/${b}-${rest}`))
  .sort();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
let bad = 0;
for (const rest of rests) {
  const [x, y] = [a, b].map((l) => fs.readFileSync(`${dir}/${l}-${rest}`).toString('base64'));
  const r = await page.evaluate(async ({ x, y }) => {
    const load = async (s) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
    };
    const [p, q] = await Promise.all([load(x), load(y)]);
    if (p.w !== q.w || p.h !== q.h) return { size: [p.w, p.h, q.w, q.h] };
    let n = 0;
    let max = 0;
    let sum = 0;
    for (let i = 0; i < p.d.length; i += 4) {
      const d = Math.max(Math.abs(p.d[i] - q.d[i]), Math.abs(p.d[i + 1] - q.d[i + 1]), Math.abs(p.d[i + 2] - q.d[i + 2]));
      if (d) n++;
      if (d > max) max = d;
      sum += d;
    }
    return { pixels: p.d.length / 4, differing: n, max, mean: +(sum / (p.d.length / 4)).toFixed(4) };
  }, { x, y });
  if (r.differing || r.size) bad++;
  console.log(rest.replace('.png', ''), JSON.stringify(r));
}
console.log(`${rests.length} pairs, ${bad} differ`);
await browser.close();
