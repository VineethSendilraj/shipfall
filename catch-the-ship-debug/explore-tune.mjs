// Lighting tune: shoots presets with the lamp and fill scaled by multipliers, full frame plus an optional crop.
// Usage: node explore-tune.mjs <base> <tag> <presets> '<json [{name, lamp, fill}]>' [clip x,y,w,h] [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, tag, presets, cfgJson, clipArg = '', w = '1280', h = '720'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const cfgs = JSON.parse(cfgJson);
const clip = clipArg ? Object.fromEntries(clipArg.split(',').map((n, i) => [['x', 'y', 'width', 'height'][i], Number(n)])) : null;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await settled();
await page.evaluate(() => {
  const ex = window.__explore;
  const light = ex.light.bind(ex);
  window.__k = { lamp: 1, fill: 1 };
  ex.light = () => {
    light();
    ex.lamp.intensity *= window.__k.lamp;
    ex.fill.intensity *= window.__k.fill;
    window.__lit = { lamp: Math.round(ex.lamp.intensity), fill: Math.round(ex.fill.intensity), near: +ex.toModel(ex.view.camera.position).toFixed(2) };
  };
});
for (const id of presets.split(',')) {
  await page.keyboard.press(String(IDS.indexOf(id) + 1));
  await settled();
  for (const c of cfgs) {
    await page.evaluate((c) => {
      window.__k = { lamp: c.lamp ?? 1, fill: c.fill ?? 1 };
      window.__explore.idle = 0;
    }, c);
    await page.waitForTimeout(400);
    const file = `${D}/explore-tune-${tag}-${id}-${c.name}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    if (clip) await page.screenshot({ path: file.replace('.jpg', '-crop.jpg'), type: 'jpeg', quality: 92, clip });
    console.log(id, c.name, JSON.stringify(await page.evaluate(() => window.__lit)), file);
  }
}
await browser.close();
