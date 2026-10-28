// The flash scan's amplitude for one frame from three saved PNGs (frame before, the frame, frame after): 16x9 block
// luma of the 640x360 downscale and the jump-and-return rule. Usage: node flight-orbit-glint-amp.mjs <tag> <frame>
// Reads /tmp/glint/<tag>-<frame-1|frame|frame+1>.png.
import { readFileSync } from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [tag, f] = process.argv.slice(2);
const c = Number(f);
const urls = [c - 1, c, c + 1].map((n) => 'data:image/png;base64,' + readFileSync(`/tmp/glint/${tag}-${n}.png`).toString('base64'));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
const r = await page.evaluate(async (urls) => {
  const small = new OffscreenCanvas(640, 360).getContext('2d', { willReadFrequently: true });
  const lums = [];
  for (const u of urls) {
    const img = new Image();
    img.src = u;
    await img.decode();
    small.drawImage(img, 0, 0, 640, 360);
    const px = small.getImageData(0, 0, 640, 360).data;
    const sum = new Float64Array(144);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
      const o = (y * 640 + x) * 4;
      sum[Math.floor(y / 40) * 16 + Math.floor(x / 40)] += 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
    }
    lums.push(Array.from(sum, (v) => v / (1600 * 255)));
  }
  const [a, b, d] = lums;
  let amp = 0, cell = -1;
  for (let i = 0; i < 144; i++) {
    const d1 = b[i] - a[i], d2 = d[i] - b[i];
    if (Math.sign(d1) !== Math.sign(d2) && Math.abs(d[i] - a[i]) < 0.5 * Math.min(Math.abs(d1), Math.abs(d2))) {
      const m = Math.min(Math.abs(d1), Math.abs(d2));
      if (m > amp) { amp = m; cell = i; }
    }
  }
  return { amp: +amp.toFixed(3), cell: cell < 0 ? null : [cell % 16, Math.floor(cell / 16)], abc: cell < 0 ? null : [a[cell], b[cell], d[cell]].map((v) => +v.toFixed(4)) };
}, urls);
console.log(tag, c, JSON.stringify(r));
await browser.close();
