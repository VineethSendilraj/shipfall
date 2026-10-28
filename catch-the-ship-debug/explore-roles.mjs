// Lists the explore stack's meshes by role with their y extents (relative to the foot) and triangle counts.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const base = process.argv[2] ?? 'http://127.0.0.1:41830';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.walls, null, { polling: 100, timeout: 120000 });
console.log(JSON.stringify(await page.evaluate(() => {
  const e = window.__explore;
  const Box = e.walls[0].constructor;
  const out = {};
  for (const [name, root] of [['booster', e.stack.booster.root], ['ship', e.stack.ship.root]]) {
    root.updateWorldMatrix(true, true);
    root.traverse((m) => {
      if (!m.isMesh) return;
      const key = `${name}:${m.userData.role ?? '?'}:${m.material.type}`;
      const b = new Box().setFromObject(m);
      const tris = (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
      const o = (out[key] ??= { n: 0, tris: 0, y0: Infinity, y1: -Infinity, r: 0, names: [] });
      o.n++;
      o.tris += tris;
      o.y0 = Math.min(o.y0, Math.round(b.min.y * 100) / 100);
      o.y1 = Math.max(o.y1, Math.round(b.max.y * 100) / 100);
      o.r = Math.max(o.r, Math.round(Math.max(Math.abs(b.min.x - e.foot.x), Math.abs(b.max.x - e.foot.x), Math.abs(b.min.z), Math.abs(b.max.z)) * 100) / 100);
      if (o.names.length < 4) o.names.push(m.name);
    });
  }
  return out;
}), null, 1));
await browser.close();
