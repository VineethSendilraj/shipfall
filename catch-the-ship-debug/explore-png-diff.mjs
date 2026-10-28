// Where two same-size PNGs differ: prints the bounding box of differing pixels and a 16x9 grid of counts, and writes
// a map (image A dimmed, differing pixels in red, brighter for larger differences).
// Usage: node explore-png-diff.mjs <a.png> <b.png> <out.jpg>
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [a, b, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const r = await page.evaluate(
  async ({ x, y }) => {
    const load = async (s) => {
      const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${s}`)).blob());
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const g = c.getContext('2d');
      g.drawImage(bmp, 0, 0);
      return { w: bmp.width, h: bmp.height, d: g.getImageData(0, 0, bmp.width, bmp.height).data };
    };
    const [p, q] = await Promise.all([load(x), load(y)]);
    const { w, h } = p;
    const c = new OffscreenCanvas(w, h);
    const g = c.getContext('2d');
    const img = g.createImageData(w, h);
    const grid = Array.from({ length: 9 }, () => new Array(16).fill(0));
    const box = [w, h, -1, -1];
    for (let i = 0; i < p.d.length; i += 4) {
      const d = Math.max(Math.abs(p.d[i] - q.d[i]), Math.abs(p.d[i + 1] - q.d[i + 1]), Math.abs(p.d[i + 2] - q.d[i + 2]));
      const l = (0.2126 * p.d[i] + 0.7152 * p.d[i + 1] + 0.0722 * p.d[i + 2]) * 0.35;
      img.data[i] = d ? Math.min(255, 90 + d * 8) : l;
      img.data[i + 1] = d ? 0 : l;
      img.data[i + 2] = d ? 0 : l;
      img.data[i + 3] = 255;
      if (!d) continue;
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      grid[Math.floor((py * 9) / h)][Math.floor((px * 16) / w)]++;
      box[0] = Math.min(box[0], px);
      box[1] = Math.min(box[1], py);
      box[2] = Math.max(box[2], px);
      box[3] = Math.max(box[3], py);
    }
    g.putImageData(img, 0, 0);
    const buf = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { box, grid, jpg: btoa(bin) };
  },
  { x: fs.readFileSync(a).toString('base64'), y: fs.readFileSync(b).toString('base64') },
);
fs.writeFileSync(out, Buffer.from(r.jpg, 'base64'));
console.log('box', JSON.stringify(r.box));
for (const row of r.grid) console.log(row.map((n) => String(n).padStart(5)).join(''));
await browser.close();
