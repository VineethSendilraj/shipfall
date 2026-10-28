import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base = 'http://127.0.0.1:41760'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
await page.evaluate(() => window.__advance(330, true));
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
  await page.screenshot({ path: `${D}/bisect-oldglb-${name}.jpg`, type: 'jpeg', quality: 85 });
};
const n = await page.evaluate(() => { let c = 0; window.__view.scene.traverse((o) => { if (o.isLight) c++; }); return c; });
console.log('lights', n);
await shoot('all');
await page.evaluate(() => { const v = window.__view; for (const s of v.pool) if (s.kind === 'ship') v.scene.remove(s.light); });
await shoot('noShipLights');
await browser.close();
