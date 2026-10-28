import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url = 'http://127.0.0.1:41730/', out = 'go.jpg', w = '1280', h = '720', play = '#play'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, hasTouch: Number(w) <= 480 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url);
await page.waitForTimeout(1200);
await page.click(play);
// Do nothing: three boosters crash and the game ends.
await page.waitForSelector('#gameover:not(.hidden)', { timeout: 150000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/${out}`, type: 'jpeg', quality: 85 });
console.log('share href:', await page.getAttribute('#share', 'href'));
await browser.close();
