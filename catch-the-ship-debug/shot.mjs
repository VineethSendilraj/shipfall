import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, out, w = '1280', h = '720', wait = '2500'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(url);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out, type: 'jpeg', quality: 82 });
await browser.close();
