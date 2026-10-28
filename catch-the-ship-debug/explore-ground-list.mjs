// Lists the meshes of the current world wider than 800 m (world space): name, vertex count, box, flags.
// Usage: node explore-ground-list.mjs <base-url> <query>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, query = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.setDefaultTimeout(240000);
await page.goto(`${base}/?explore=1&quality=low${query ? `&${query}` : ''}`, { timeout: 240000 });
await page.waitForFunction(() => window.__explore?.shapes?.length, null, { polling: 100, timeout: 240000 });
console.log(await page.evaluate(() => {
  const { view } = window.__explore;
  const root = view.scene.getObjectByName(`world-${view.world.map}`);
  const rows = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
    const wide = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
    if (wide < 800) return;
    const f = (v) => v.toArray().map(Math.round).join(',');
    rows.push(`${(o.name || o.parent?.name || '-').padEnd(14)} verts ${String(o.geometry.attributes.position.count).padStart(6)} box [${f(b.min)}]..[${f(b.max)}] inst ${!!o.isInstancedMesh} shadow ${o.receiveShadow} mat ${o.material.type}`);
  });
  return rows.join('\n');
}));
await browser.close();
