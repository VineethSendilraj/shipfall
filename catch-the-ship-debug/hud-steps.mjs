// Steps the showcase one frame at a time with a draw each frame (like the recorder), screenshotting given frames.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, w, h, framesCsv, prefix] = process.argv.slice(2);
const frames = framesCsv.split(',').map(Number).sort((a, b) => a - b);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
for (const f of frames) {
  await page.evaluate((f) => { while (window.__demoFrame < f) window.__advance(1, true); }, f);
  await page.screenshot({ path: `${prefix}-f${f}.png`, timeout: 120000 });
}
await browser.close();
