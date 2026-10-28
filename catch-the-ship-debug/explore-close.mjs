// Close-orbit shots with the inspection lights on (the page's own light()) and off: zooms from the Grid fins preset
// toward a fin, and from the Nose and tiles preset toward the tiles.
// Usage: node explore-close.mjs <base-url> <prefix> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { lampVariant } from './explore-lamp-variant.mjs';

const [base, prefix, w = '1280', h = '720'] = process.argv.slice(2);
const [W, H] = [Number(w), Number(h)];
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && window.__explore.shapes.length && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await settled();
await page.waitForTimeout(1000);
await page.evaluate(() => {
  const e = window.__explore;
  e.ownLight = e.light;
});
for (const [key, id, x, y, steps] of [['3', 'fin', 0.78, 0.54, 10], ['5', 'tiles', 0.45, 0.55, 14]]) {
  await page.keyboard.press(key);
  await settled();
  await page.mouse.move(W * x, H * y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1500);
  for (const [name, off] of [['on', false], ['off', true]]) {
    if (off) await page.evaluate(lampVariant, { lux: 0, fill: 0 });
    else await page.evaluate(() => (window.__explore.light = window.__explore.ownLight));
    await page.evaluate(() => (window.__explore.idle = 0));
    await page.waitForTimeout(400);
    const file = `${D}/${prefix}-${id}-${name}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    const at = await page.evaluate(() => {
      const e = window.__explore;
      const p = e.view.camera.position;
      return { toModel: +e.toModel(p).toFixed(2), pivot: +p.distanceTo(e.controls.target).toFixed(2), lamp: Math.round(e.lamp.intensity) };
    });
    console.log(id, name, JSON.stringify(at), file);
  }
  await page.evaluate(() => (window.__explore.light = window.__explore.ownLight));
}
await browser.close();
