// Close-up of the real game scene: steps the deterministic demo (capture mode) to a frame, then re-aims the
// camera at a booster and renders. Usage:
//   node blender-closeup.mjs <base-url> <out-prefix> [frame=330] [shots=catch,fins,engines,arm,tower,wide]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41740', prefix = 'blender-close', frame = '330', shotList = 'catch,fins,engines,arm,tower,wide'] = process.argv.slice(2);
const SHOTS = {
  // [offset from the booster's catch point, look-at offset, fov]
  catch: [[14, 4, 30], [0, 2, 0], 38],
  fins: [[8, -3, 13], [0, 3.6, 0], 40],
  engines: [[10, -78, 16], [0, -66, 0], 42],
  arm: [[-6, 9, 26], [4, 0, 0], 40],
  tower: [[40, 30, 120], [20, 10, 0], 40],
  wide: [[30, -40, 160], [10, -30, 0], 40],
  // Absolute world positions (camera, target) for the site props.
  olm: [[10, 14, -25], [-30, 14, -70], 42, true],
  farm: [[-120, 20, -190], [-160, 12, -270], 40, true],
};
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 30000 });
await page.evaluate((n) => window.__advance(n, true), Number(frame));
for (const name of shotList.split(',')) {
  const [off, look, fov, absolute = false] = SHOTS[name];
  const info = await page.evaluate(
    ({ off, look, fov, absolute }) => {
      const v = window.__view;
      const slot = v.pool.find((s) => s.root.visible) ?? v.pool[0];
      const p = absolute ? { x: 0, y: 0, z: 0 } : slot.root.position;
      v.camera.fov = fov;
      v.camera.position.set(p.x + off[0], p.y + off[1], p.z + off[2]);
      v.camera.lookAt(p.x + look[0], p.y + look[1], p.z + look[2]);
      v.camera.updateProjectionMatrix();
      v.composer.render();
      return { booster: [p.x.toFixed(2), p.y.toFixed(2)], frame: window.__demoFrame };
    },
    { off, look, fov, absolute },
  );
  const path = `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/${prefix}-${name}.jpg`;
  await page.screenshot({ path, type: 'jpeg', quality: 85 });
  console.log(name, JSON.stringify(info), path);
}
await browser.close();
