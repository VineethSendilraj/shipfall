// Lighting lab: injects a camera lamp and an under-mount fill into a running Explore page and shoots presets.
// Usage: node explore-lab.mjs <base-url> <tag> <presets comma list> '<json array of configs>'
// Config: { name, E (lux at the pivot), ox, oy, oz (lamp offset in pivot distances: right, up, back), color,
//           near, far (fade by camera distance to the stack box), F (fill cd), fy, fangle, fpen, spot (bool) }
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, tag, presets, cfgJson, w = '1280', h = '720'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const cfgs = JSON.parse(cfgJson);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text()));
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
const settled = () => page.waitForFunction(() => window.__explore?.stack && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await settled();
await page.evaluate(() => {
  const ex = window.__explore;
  const { view } = ex;
  const lamp = view.crashLight.clone();
  const fill = view.crashLight.clone();
  const spot = view.world.floods[0].clone();
  spot.intensity = 0;
  view.scene.add(lamp, fill, spot, spot.target);
  const V = view.camera.position.constructor;
  const right = new V();
  const up = new V();
  const back = new V();
  const ss = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };
  window.__lab = { lamp, fill, cfg: null };
  const render = view.render.bind(view);
  view.render = (g, o) => {
    const c = window.__lab.cfg;
    if (c) {
      const cam = view.camera;
      cam.updateMatrixWorld();
      const d = cam.position.distanceTo(ex.controls.target);
      right.setFromMatrixColumn(cam.matrixWorld, 0);
      up.setFromMatrixColumn(cam.matrixWorld, 1);
      back.setFromMatrixColumn(cam.matrixWorld, 2);
      lamp.position.copy(cam.position).addScaledVector(right, (c.ox ?? 0) * d).addScaledVector(up, (c.oy ?? 0) * d).addScaledVector(back, (c.oz ?? 0) * d);
      const box = ex.walls?.[0];
      const near = box ? box.distanceToPoint(cam.position) : 0;
      const fade = ss(c.far ?? 40, c.near ?? 25, near);
      lamp.color.setHex(c.color ?? 0xfff2e2);
      lamp.intensity = (c.E ?? 0) * d * d * fade;
      fill.color.setHex(c.fcolor ?? 0xfff2e2);
      fill.position.set(ex.foot.x, c.fy ?? 12, ex.foot.z);
      fill.intensity = c.spot ? 0 : (c.F ?? 0);
      spot.color.setHex(c.fcolor ?? 0xfff2e2);
      spot.position.set(ex.foot.x, c.fy ?? 6, ex.foot.z);
      spot.target.position.set(ex.foot.x, 40, ex.foot.z);
      spot.angle = ((c.fangle ?? 22) * Math.PI) / 180;
      spot.penumbra = c.fpen ?? 0.6;
      spot.decay = 2;
      spot.distance = 0;
      spot.intensity = c.spot ? (c.F ?? 0) : 0;
      ex.stack.booster.throatMat.visible = !c.nothroat;
      window.__lab.state = { d, near, fade, lamp: lamp.intensity };
    }
    render(g, o);
  };
});
for (const id of presets.split(',')) {
  const i = IDS.indexOf(id);
  await page.keyboard.press(String(i + 1));
  await settled();
  for (const c of cfgs) {
    await page.evaluate((c) => {
      window.__lab.cfg = c;
      window.__explore.idle = 0;
    }, c);
    await page.waitForTimeout(350);
    const file = `${D}/explore-lab-${tag}-${id}-${c.name}.jpg`;
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    const st = await page.evaluate(() => window.__lab.state);
    console.log(id, c.name, JSON.stringify(st), file);
  }
}
await browser.close();
