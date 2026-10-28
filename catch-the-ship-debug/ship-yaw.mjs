// Look test: renders demo frames with the ship model yawed by each angle (pins move too; this is only a look test).
// Usage: node ship-yaw.mjs <base-url> <prefix> deg1,deg2,... f1,f2,...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, degs, frames] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const deg of degs.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}/?demo=1&capture=1`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 60000 });
  await page.evaluate((d) => {
    for (const s of window.__view.pool) if (s.kind === 'ship') s.root.children[0].rotation.y = (d * Math.PI) / 180;
  }, deg);
  let frame = await page.evaluate(() => window.__demoFrame);
  for (const f of frames.split(',').map(Number)) {
    frame = (await page.evaluate((n) => window.__advance(n, true), f - frame)).frame;
    await page.screenshot({ path: `${D}/${prefix}-y${deg}-f${f}.jpg`, type: 'jpeg', quality: 85 });
  }
  await page.close();
}
await browser.close();
