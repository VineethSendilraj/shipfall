// Flips the title-card map picker Starbase <-> Mars repeatedly and records three.js GPU resource counts
// (renderer.info.memory geometries/textures, programs) after each switch. Counts for the same map must not
// grow from round to round. Headless only.
// Usage: node switch-leak.mjs <base> [rounds] [w] [h] [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, rounds = '6', w = '1280', h = '720', embed = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console:', m.text()));
await page.goto(`${base}${embed ? '/embed/' : '/'}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(5000);
const card = embed ? '#quick-start' : '#title-screen';
const info = () =>
  page.evaluate(() => {
    const r = window.__view.renderer.info;
    return { map: window.__view.world.map, geo: r.memory.geometries, tex: r.memory.textures, prog: r.programs.length, heapMB: +(performance.memory?.usedJSHeapSize / 1048576).toFixed(1) };
  });
const rows = [await info()];
for (let i = 0; i < +rounds; i++) {
  for (const m of ['mars', 'starbase']) {
    const t0 = Date.now();
    await page.click(`${card} .map-pick button[data-map="${m}"]`);
    const ms = Date.now() - t0;
    await page.waitForTimeout(1200);
    rows.push({ ...(await info()), clickMs: ms });
  }
}
for (const r of rows) console.log(JSON.stringify(r));
const sb = rows.filter((r) => r.map === 'starbase');
const ma = rows.filter((r) => r.map === 'mars');
const grew = (list, k) => list.length > 2 && list[list.length - 1][k] > list[1][k];
console.log(JSON.stringify({ starbaseGrowth: { geo: grew(sb, 'geo'), tex: grew(sb, 'tex'), prog: grew(sb, 'prog') }, marsGrowth: { geo: grew(ma, 'geo'), tex: grew(ma, 'tex'), prog: grew(ma, 'prog') } }));
await browser.close();
