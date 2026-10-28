// Probes the booster steel mesh: material twin vs base, attributes, and renders the arm close-up with the
// twin's vertexColors toggled off, to isolate what changed the steel. Usage: node ship-matprobe.mjs <base>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41760'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 60000 });
await page.evaluate(() => window.__advance(330, true));
const info = await page.evaluate(() => {
  const v = window.__view;
  const slot = v.pool.find((s) => s.root.visible);
  let steel = null;
  slot.root.traverse((o) => {
    if (o.isMesh && o.userData.role === 'steel') steel = o;
  });
  const g = steel.geometry;
  const m = steel.material;
  const attrs = Object.fromEntries(Object.entries(g.attributes).map(([k, a]) => [k, { itemSize: a.itemSize, normalized: a.normalized, type: a.array.constructor.name, count: a.count }]));
  const col = g.attributes.color;
  let mn = 1, mx = 0, sum = 0;
  for (let i = 0; i < col.count; i++) {
    const c = col.getX(i);
    mn = Math.min(mn, c);
    mx = Math.max(mx, c);
    sum += c;
  }
  const t = g.attributes.tangent;
  return {
    attrs,
    color: { min: mn, max: mx, mean: sum / col.count, a0: col.itemSize === 4 ? col.getW(0) : null },
    tangent0: t ? [t.getX(0), t.getY(0), t.getZ(0), t.getW(0)] : null,
    mat: { type: m.type, vertexColors: m.vertexColors, anisotropy: m.anisotropy, envMapIntensity: m.envMapIntensity, roughness: m.roughness, metalness: m.metalness, map: !!m.map, bump: !!m.bumpMap, same: m === v.boosterMats.steel },
    base: { anisotropy: v.boosterMats.steel.anisotropy, envMapIntensity: v.boosterMats.steel.envMapIntensity },
    nodeScale: steel.matrixWorld.elements.slice(0, 3).map((x) => +x.toFixed(4)),
  };
});
console.log(JSON.stringify(info, null, 1));
const shoot = async (name) => {
  await page.evaluate(() => {
    const v = window.__view;
    const slot = v.pool.find((s) => s.root.visible);
    const p = slot.root.position;
    v.camera.fov = 40;
    v.camera.position.set(p.x - 6, p.y + 9, p.z + 26);
    v.camera.lookAt(p.x + 4, p.y, p.z);
    v.camera.updateProjectionMatrix();
    v.composer.render();
  });
  await page.screenshot({ path: `${D}/matprobe-${name}.jpg`, type: 'jpeg', quality: 85 });
};
await shoot('twin');
await page.evaluate(() => {
  const v = window.__view;
  const slot = v.pool.find((s) => s.root.visible);
  slot.root.traverse((o) => {
    if (o.isMesh && o.userData.role === 'steel') o.material = v.boosterMats.steel;
  });
});
await shoot('base');
await browser.close();
