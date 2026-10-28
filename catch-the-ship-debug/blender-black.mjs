// Same measurement as black.mjs, but saves the exact screenshot that was measured (black.mjs saves a second,
// later screenshot) for every sample above 0.005, so a transient black frame can be seen.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';

const url = process.argv[2];
const secs = Number(process.argv[3] ?? 30);
const headless = process.argv[4] !== 'headed';
const browser = await chromium.launch({ channel: 'chrome', headless, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
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
    return { black: black / (d.length / 4), frame: window.__demoFrame ?? null };
  }, shot.toString('base64'));
  worst = Math.max(worst, r.black);
  if (r.black > 0.005) {
    const out = `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/blender-black-${String(i / 2).replace('.', '_')}s.png`;
    writeFileSync(out, shot);
    console.log(`${i / 2} s black ${r.black.toFixed(3)} frame ${r.frame} -> ${out}`);
  }
}
console.log(url, headless ? 'headless' : 'headed', 'worst black fraction', worst.toFixed(3));
await browser.close();
