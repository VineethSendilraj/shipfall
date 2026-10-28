// Close-ups of the real game scene (headless, real GPU): steps the deterministic demo to a frame, re-aims the
// camera relative to the visible booster or ship (or at absolute points) and renders each shot.
// Usage: node ship-closeups.mjs <base-url> <prefix> <frame> <shot,shot,...> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, frame, list, w = '1280', h = '720'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
// name: [target ('ship' | 'booster' | 'abs'), camera offset, look-at offset, fov]
const SHOTS = {
  shipNose: ['ship', [20, 4, 22], [0, 7, 0], 34],
  shipNoseLow: ['ship', [-14, -2, 24], [0, 6, 0], 34],
  shipTiles: ['ship', [16, -12, 18], [0, -10, 0], 36],
  shipAft: ['ship', [24, -30, 24], [0, -27, 0], 38],
  shipEngines: ['ship', [9, -46, 12], [0, -34.5, 0], 42],
  shipSide: ['ship', [-40, -10, 95], [0, -9, 0], 36],
  shipWide: ['ship', [30, -15, 140], [10, -10, 0], 38],
  boosterEngines: ['booster', [9, -78, 12], [0, -66, 0], 42],
  boosterFins: ['booster', [10, -4, 14], [0, 3.4, 0], 40],
  boosterAft: ['booster', [13, -64, 16], [0, -60, 0], 40],
  arm: ['booster', [-6, 9, 26], [4, 0, 0], 40],
  lattice: ['booster', [44, 10, 36], [30, 8, 0], 40],
  farm: ['abs', [-120, 20, -190], [-160, 12, -270], 40],
  mount: ['abs', [10, 14, -25], [-30, 14, -70], 42],
  towerBase: ['abs', [70, 14, 40], [44, 6, 0], 40],
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
await page.evaluate((n) => window.__advance(n, true), Number(frame));
await page.addStyleTag({ content: '#popups, #banner, #hud, .disclaimer, .demo-card { visibility: hidden !important; }' });
for (const name of list.split(',')) {
  const [target, off, look, fov] = SHOTS[name];
  const info = await page.evaluate(
    ({ target, off, look, fov }) => {
      const v = window.__view;
      const slot = target === 'abs' ? null : v.pool.find((s) => s.root.visible && (s.kind ?? 'booster') === target);
      if (target !== 'abs' && !slot) return { missing: target };
      const p = slot ? slot.root.position : { x: 0, y: 0, z: 0 };
      v.camera.fov = fov;
      v.camera.clearViewOffset();
      v.camera.position.set(p.x + off[0], p.y + off[1], p.z + off[2]);
      v.camera.lookAt(p.x + look[0], p.y + look[1], p.z + look[2]);
      v.camera.updateProjectionMatrix();
      v.composer.render();
      return { at: [p.x.toFixed(1), p.y.toFixed(1)] };
    },
    { target, off, look, fov },
  );
  const path = `${D}/${prefix}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 88 });
  console.log(name, JSON.stringify(info), path);
}
await browser.close();
