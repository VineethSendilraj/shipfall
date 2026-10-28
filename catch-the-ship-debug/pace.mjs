// Wall-clock length of the live ?demo=1 showcase with rAF capped at 60 Hz (vsync) vs uncapped.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url] = process.argv.slice(2);
for (const [label, extra] of [['60 Hz', []], ['uncapped', ['--disable-gpu-vsync', '--disable-frame-rate-limit']]]) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', ...extra] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.goto(url);
  const r = await page.evaluate(() => new Promise((done) => {
    const t0 = performance.now();
    let frames = 0;
    const f = () => { frames++; if (window.__demoDone) done({ secs: ((performance.now() - t0) / 1000).toFixed(1), fps: Math.round(frames / ((performance.now() - t0) / 1000)) }); else requestAnimationFrame(f); };
    requestAnimationFrame(f);
  }));
  console.log(label.padEnd(9), `showcase took ${r.secs}s at ~${r.fps} fps`);
  await browser.close();
}
