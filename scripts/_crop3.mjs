import { chromium } from 'playwright';
const [port, f0, x, y, w, h] = process.argv.slice(2).map((v, i) => (i ? +v : v));
const dir = process.env.HOME + '/dev/scratch/catch-the-ship-plume-shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
await page.evaluate((f) => window.__advance(f - 1 - window.__demoFrame, false), f0);
for (let i = 0; i < 3; i++) {
  await page.evaluate(() => window.__advance(1, true));
  await page.screenshot({ path: `${dir}/c3-${f0 + i}.jpg`, type: 'jpeg', quality: 92, clip: { x, y, width: w, height: h }, timeout: 120000 });
}
await browser.close();
