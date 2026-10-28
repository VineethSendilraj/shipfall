import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url = 'http://127.0.0.1:41730/', w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(url);
await page.waitForTimeout(1200);
await page.click('#play');
const t0 = Date.now();
let shot = 0;
while (Date.now() - t0 < 16000 && shot < 4) {
  await page.waitForTimeout(250);
  const txt = await page.evaluate(() => [...document.querySelectorAll('#popups .popup')].map((e) => e.textContent).join(' | '));
  if (/RUD|MISS/.test(txt)) {
    await page.waitForTimeout(shot === 0 ? 150 : 500);
    await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/fail-${shot}.jpg`, type: 'jpeg', quality: 85 });
    console.log('popups:', txt);
    shot++;
  }
}
await browser.close();
