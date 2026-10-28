// Sizes of the props meshes Explore's mount mover touches, on one map.
// Usage: node explore-concrete.mjs <base-url> [query]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, query = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(240000);
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?quality=high${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__view?.scene.getObjectByName('props_concrete'), null, { polling: 200 });
console.log(
  JSON.stringify(
    await page.evaluate(() => {
      const out = {};
      for (const name of ['props_concrete', 'props_mountSteel', 'props_dark']) {
        const m = window.__view.scene.getObjectByName(name);
        const g = m.geometry;
        out[name] = {
          verts: g.attributes.position.count,
          tris: (g.index ? g.index.count : g.attributes.position.count) / 3,
          attrs: Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, `${a.itemSize}x${a.array.constructor.name}`])),
          bytes: Object.values(g.attributes).reduce((s, a) => s + a.array.byteLength, 0) + (g.index?.array.byteLength ?? 0),
          parent: m.parent.name,
          pos: m.position.toArray().map((v) => +v.toFixed(2)),
        };
      }
      return out;
    }),
  ),
);
await browser.close();
