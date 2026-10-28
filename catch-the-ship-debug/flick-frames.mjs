// Screenshot demo frames k-1, k, k+1 for each target k (deterministic capture mode).
// Usage: node flick-frames.mjs <base-url> <prefix> k1,k2,...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, prefix, list] = process.argv.slice(2);
const targets = list.split(',').map(Number).sort((a, b) => a - b);
const want = new Set(targets.flatMap((k) => [k - 1, k, k + 1]));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true);
let frame = await page.evaluate(() => window.__demoFrame);
for (const f of [...want].sort((a, b) => a - b)) {
  if (f > frame) frame = (await page.evaluate((n) => window.__advance(n, true), f - frame)).frame;
  await page.screenshot({ path: `${prefix}-f${f}.png` });
}
await browser.close();
