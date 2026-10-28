// Reads the baked near site map from the live ground material and counts texels at or above the waterline
// near the launch pad and in total. Usage: node texas-sitemap.mjs <base>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(2500);
const res = await page.evaluate(() => {
  const v = window.__view;
  let found = null;
  v.scene.traverse((o) => {
    if (found || !o.isMesh) return;
    const u = v.renderer.properties.get(o.material)?.uniforms;
    if (u?.uSiteNear) found = u;
  });
  if (!found) return 'no ground uniforms';
  const img = found.uSiteNear.value.image;
  const { data, width: n } = img;
  const [X0, Z0, S] = [-900, -1500, 1800];
  let wet = 0;
  let nearPad = 0;
  let nearPadAbove45 = 0;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const a = data[(j * n + i) * 4 + 3];
      const x = X0 + ((i + 0.5) / n) * S;
      const z = Z0 + ((j + 0.5) / n) * S;
      const d = Math.hypot(Math.max(-150 - x, 0, x - 95), Math.max(-108 - z, 0, z - 40));
      if (a >= 128) wet++;
      if (d < 45 && a >= 128) nearPad++;
      if (d < 45 && a >= 115) nearPadAbove45++;
    }
  return { n, wet, nearPad, nearPadAbove45 };
});
console.log(res);
await browser.close();
