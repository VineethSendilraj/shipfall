import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
const r = await page.evaluate(() => new Promise((done) => {
  const hist = {};
  let prev = window.__demoFrame ?? 0;
  const f = () => {
    const cur = window.__demoFrame ?? 0;
    const d = cur - prev;
    prev = cur;
    hist[d] = (hist[d] || 0) + 1;
    if (d !== 1) (hist.at ||= []).push(`${d}@${cur}`);
    if (window.__demoDone) done(hist); else requestAnimationFrame(f);
  };
  requestAnimationFrame(f);
}));
console.log('sim steps per displayed frame at 60 Hz:', JSON.stringify(r));
await browser.close();
