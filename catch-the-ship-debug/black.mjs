import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const url = process.argv[2] ?? 'https://catch-the-ship.vercel.app/?demo=1';
const secs = Number(process.argv[3] ?? 40);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1024, height: 680 } });
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto(url);
await page.waitForTimeout(1500);
await page.mouse.click(512, 340);
let worst = 0;
for (let i = 0; i < secs * 2; i++) {
  await page.waitForTimeout(500);
  const shot = await page.screenshot();
  const r = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const tmp = new OffscreenCanvas(128, Math.round((128 * img.height) / img.width));
    const x = tmp.getContext('2d');
    x.drawImage(img, 0, 0, tmp.width, tmp.height);
    const d = x.getImageData(0, 0, tmp.width, tmp.height).data;
    let black = 0;
    for (let j = 0; j < d.length; j += 4) if (d[j] + d[j + 1] + d[j + 2] < 3) black++;
    return { black: black / (d.length / 4), q: window.__quality ?? null };
  }, shot.toString('base64'));
  if (r.black > worst) {
    worst = r.black;
    writeFileSync(`/Users/vsendilraj/dev/scratch/catch-the-ship-debug/worst.png`, await page.screenshot());
  }
  if (i % 4 === 0 || r.black > 0.05) console.log(i / 2, 's black', r.black.toFixed(3), JSON.stringify(r.q));
}
console.log('worst black fraction', worst.toFixed(3));
await browser.close();
