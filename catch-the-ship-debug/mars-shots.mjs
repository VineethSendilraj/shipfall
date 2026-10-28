// Real-GPU screenshots for the Mars map work: title card (full game) or quick-start card (embed), then
// showcase frames (?demo=1&capture=1). Headless only.
// Usage: node mars-shots.mjs <base> <w> <h> <map|-> <prefix> [demoFramesCsv] [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, map, prefix, framesCsv = '', embed = ''] = process.argv.slice(2);
const frames = framesCsv ? framesCsv.split(',').map(Number).sort((a, b) => a - b) : [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
const mq = map === '-' ? '' : `map=${map}`;
const path = embed ? '/embed/' : '/';
await page.goto(`${base}${path}${mq ? `?${mq}` : ''}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 30000 });
await page.waitForTimeout(3500);
await page.screenshot({ path: `${prefix}-title.jpg`, type: 'jpeg', quality: 90 });
const hide = await page.addStyleTag({ content: '.overlay, .disclaimer, #sound { visibility: hidden !important; }' });
await page.waitForTimeout(100);
await page.screenshot({ path: `${prefix}-scene.jpg`, type: 'jpeg', quality: 90 });
await hide.evaluate((el) => el.remove());
if (frames.length) {
  await page.goto(`${base}${path}?demo=1&capture=1${mq ? `&${mq}` : ''}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 60000 });
  for (const f of frames) {
    const cur = await page.evaluate(() => window.__demoFrame);
    if (f - cur > 3) await page.evaluate((n) => window.__advance(n, false), f - cur - 3);
    while ((await page.evaluate(() => window.__demoFrame)) < f) await page.evaluate(() => window.__advance(1, true));
    await page.screenshot({ path: `${prefix}-f${f}.jpg`, type: 'jpeg', quality: 90 });
  }
}
await browser.close();
