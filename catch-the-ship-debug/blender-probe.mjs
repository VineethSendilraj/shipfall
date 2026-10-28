// Prints every console message and whether the Blender models were swapped in (blender-models worktree).
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const url = process.argv[2] ?? 'http://127.0.0.1:41740/';
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log(`console.${m.type()}:`, m.text()));
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('requestfailed', (r) => console.log('requestfailed:', r.url(), r.failure()?.errorText));
page.on('response', (r) => r.url().includes('/models/') && console.log('response:', r.status(), r.url()));
await page.goto(url);
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const v = window.__view;
  if (!v) return 'no __view';
  const names = (root) => {
    const out = [];
    root.traverse((o) => o.userData?.role && out.push(o.userData.role));
    return out.join(',');
  };
  return {
    booster: names(v.pool[0].root),
    tower: names(v.towers[0].root),
    tanksVisible: v.world.dressing.tanks.visible,
    calls: v.renderer.info.render.calls,
    triangles: v.renderer.info.render.triangles,
  };
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
