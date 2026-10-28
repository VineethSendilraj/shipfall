// Close-up shots per lamp variant: node explore-lamp.mjs <base> <tag> <presets> '<json {name: cfg}>' [w] [h]
// Each cfg goes to lampVariant (explore-lamp-variant.mjs); {} keeps the page's own light().
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { lampVariant } from './explore-lamp-variant.mjs';

const [base, tag, presets, cfgJson, w = '1280', h = '720'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await settled();
await page.evaluate(() => {
  const e = window.__explore;
  const light = e.light.bind(e);
  window.__own = () => {
    e.light = () => {
      light();
      window.__lit = { lamp: Math.round(e.lamp.intensity), lampClear: +e.toModel(e.lamp.position).toFixed(2) };
    };
  };
});
for (const id of presets.split(',')) {
  await page.keyboard.press(String(IDS.indexOf(id) + 1));
  await settled();
  for (const [name, cfg] of Object.entries(JSON.parse(cfgJson))) {
    if (Object.keys(cfg).length) await page.evaluate(lampVariant, cfg);
    else await page.evaluate(() => window.__own());
    await page.evaluate(() => (window.__explore.idle = 0));
    await page.waitForTimeout(400);
    const file = `${D}/explore-lamp-${tag}-${name}-${id}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 90 });
    console.log(id, name, JSON.stringify(await page.evaluate(() => window.__lit)), file);
  }
}
await browser.close();
