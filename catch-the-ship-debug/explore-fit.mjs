// Phone fit probe (headless, real GPU): for each FOV exponent, overrides Explore.fovFor for Engines and Flaps only,
// glides Stack -> preset, takes a shot, and projects the subject's outline to screen pixels.
// Usage: node explore-fit.mjs <base-url> <prefix> <w> <h> <exp,exp,...> [own]   ("own" = the page's fovFor, no override)
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, w, h, exps = '0.6', own = ''] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
// Subjects in meters from the foot of the stack: the booster's aft skirt (HULL[0] bottom), and the two aft flaps (PARTS 8, 9).
const skirt = Array.from({ length: 72 }, (_, i) => [5.17 * Math.cos((i * Math.PI) / 36), 19.2, 5.17 * Math.sin((i * Math.PI) / 36)]);
const flapBox = (a, [u0, u1], [s0, s1], [y0, y1]) =>
  [u0, u1].flatMap((u) => [s0, s1].flatMap((s) => [y0, y1].map((y) => [u * Math.cos(a) - s * Math.sin(a), y, u * Math.sin(a) + s * Math.cos(a)])));
const flaps = [...flapBox(0, [5.3, 8.6], [-3.2, -1.6], [100.4, 111]), ...flapBox(Math.PI, [5.4, 8.85], [-2.5, -1.4], [100.4, 111])];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await settled();
await page.waitForTimeout(600);
console.log(
  'squeeze',
  JSON.stringify(
    await page.evaluate(() => {
      const { camera, size, lift } = window.__view;
      const e = camera.projectionMatrix.elements;
      // Undistorted when (frustum width / height) equals the viewport's w / h.
      return { w: size.w, h: size.h, lift, viewport: +(size.w / size.h).toFixed(4), frustum: +(e[5] / e[0]).toFixed(4), squeeze: +(e[5] / e[0] / (size.w / size.h)).toFixed(4) };
    }),
  ),
);
const extent = (pts) =>
  page.evaluate((pts) => {
    const ex = window.__explore;
    const cam = window.__view.camera;
    const V = ex.foot.constructor;
    const { w, h } = window.__view.size;
    let [x0, x1, y0, y1] = [Infinity, -Infinity, Infinity, -Infinity];
    for (const [x, y, z] of pts) {
      const v = new V(x, y, z).add(ex.foot).project(cam);
      const px = ((v.x + 1) / 2) * w;
      const py = ((1 - v.y) / 2) * h;
      [x0, x1, y0, y1] = [Math.min(x0, px), Math.max(x1, px), Math.min(y0, py), Math.max(y1, py)];
    }
    const r = (n) => Math.round(n);
    return { fov: +cam.fov.toFixed(1), x: [r(x0), r(x1)], y: [r(y0), r(y1)], margin: [r(x0), r(w - x1)] };
  }, pts);
for (const k of exps.split(',').map(Number)) {
  if (!own)
    await page.evaluate((k) => {
      const ex = window.__explore;
      ex.fovFor = function (p) {
        const { size, lift } = this.view;
        const narrow = Math.max(1, (size.h * (1 + lift)) / size.w) ** (['engines', 'flaps'].includes(p.id) ? k : 0.6);
        return (2 * Math.atan(Math.tan(((p.fov / 2) * Math.PI) / 180) * narrow) * 180) / Math.PI;
      };
    }, k);
  for (const [key, id, pts] of [['2', 'engines', skirt], ['6', 'flaps', flaps]]) {
    await page.keyboard.press('1');
    await settled();
    await page.keyboard.press(key);
    await settled();
    await page.waitForTimeout(500);
    const file = `${D}/${prefix}-${own ? 'own' : `e${k}`}-${id}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    console.log(own ? 'own' : `e${k}`, id, JSON.stringify(await extent(pts)), file);
  }
}
await browser.close();
