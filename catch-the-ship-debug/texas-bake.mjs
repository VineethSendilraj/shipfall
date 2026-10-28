// Times buildWorld for each map through view.setMap (world build, site-map bake, shader compile on first draw).
// Usage: node texas-bake.mjs <base>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1&map=mars`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const v = window.__view;
  const out = [];
  for (let i = 0; i < 4; i++) {
    for (const m of ['starbase', 'mars']) {
      const t0 = performance.now();
      v.setMap(m);
      const t1 = performance.now();
      window.__advance(1, true);
      v.renderer.getContext().finish();
      out.push(`${m} build ${(t1 - t0).toFixed(0)} ms, first frame ${(performance.now() - t1).toFixed(0)} ms`);
    }
  }
  return out;
});
console.log(r.join('\n'));
await browser.close();
