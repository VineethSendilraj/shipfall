import { chromium } from 'playwright';
const [port, tag] = process.argv.slice(2);
const dir = process.env.HOME + '/dev/scratch/catch-the-ship-plume-shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?flight=1&capture=1`);
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
let last = '';
let n = 0;
for (let i = 0; i < 400 && n < 9; i++) {
  const r = await page.evaluate(() => window.__advance(60, false));
  const key = `${r.phase}/${r.mode}/${r.booster}`;
  const want = i === 3 || i === 12 || key !== last;
  if (want) {
    await page.evaluate(() => window.__advance(1, true));
    await page.screenshot({ path: `${dir}/${tag}-flight-${String(i).padStart(3, '0')}.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
    console.log(i, key);
    n++;
  }
  last = key;
  if (r.done) break;
}
await browser.close();
