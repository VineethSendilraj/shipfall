// Map round trip through the title's map picker: Starbase -> Explore -> Back -> Mars -> Explore -> Back -> Starbase ->
// Explore -> Back. Each visit prints where the mount's steel and legs sit against the stack's foot, which concrete meshes
// show, the farm chip's label and the renderer's geometry and texture counts. The engines close-up of the first and the
// last Starbase visit must match pixel for pixel (freed vertex buffers would change or blank the mount).
// Usage: node explore-maptrip.mjs <base-url> [maps, default starbase,mars,starbase]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, seq = 'starbase,mars,starbase'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.setDefaultTimeout(240000);
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${m.type()}: ${m.text()}`));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?quality=high`, { timeout: 240000 });
await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(500);

const out = await page.evaluate(async (seq) => {
  window.__hold = true;
  const x = window.__explore;
  const v = window.__view;
  const click = (sel) => document.querySelector(sel).click();
  const mem = () => ({ ...v.renderer.info.memory });
  const center = (o) => {
    o.updateWorldMatrix(true, false);
    o.geometry.computeBoundingBox();
    return o.geometry.boundingBox.getCenter(new x.foot.constructor()).applyMatrix4(o.matrixWorld);
  };
  const grab = () => {
    const gl = v.renderer.domElement;
    const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(gl, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const visit = async (label) => {
    click('#title-screen .open-explore');
    await x.ready;
    x.enter('engines');
    await x.ready;
    x.idle = -1e9;
    x.game.t = 0;
    for (let k = 0; k < 4; k++) x.frame(1 / 60);
    const pixels = grab();
    const steel = v.scene.getObjectByName('props_mountSteel');
    const concretes = [];
    v.scene.traverse((o) => o.isMesh && o.name === 'props_concrete' && concretes.push(o));
    // The original comes first in the tree; the legs are the clone shifted under the stack.
    const legs = concretes.slice(1).find((o) => !o.position.equals(concretes[0].position));
    const d = (p) => +Math.hypot(p.x - x.foot.x, p.z - x.foot.z).toFixed(2);
    const row = {
      label,
      map: v.world.map,
      steelFromFoot: steel ? d(center(steel)) : null,
      legsFromFoot: legs ? d(center(legs)) : null,
      concretes: concretes.map((o) => `${o.visible ? 'shown' : 'hidden'}:${o.geometry.attributes.position.count}${o.geometry.index ? 'i' : ''}`).join(' '),
      farmChip: x.chips[8].textContent,
      memInExplore: mem(),
    };
    click('#explore-back');
    row.memOnTitle = mem();
    row.stateTitle = !document.getElementById('title-screen').classList.contains('hidden');
    return { row, pixels };
  };
  const pick = (map) => click(`#title-screen .map-pick button[data-map="${map}"]`);
  const visits = [];
  for (const [i, map] of seq.split(',').entries()) {
    pick(map);
    visits.push(await visit(`${map} ${i + 1}`));
  }
  const [a, c] = [visits[0], visits.findLast((w) => w.row.map === visits[0].row.map)];
  let diff = 0;
  for (let i = 0; i < a.pixels.length; i += 4) {
    if (a.pixels[i] !== c.pixels[i] || a.pixels[i + 1] !== c.pixels[i + 1] || a.pixels[i + 2] !== c.pixels[i + 2]) diff++;
  }
  return { rows: visits.map((w) => w.row), diffPixels: diff, pixels: a.pixels.length / 4 };
}, seq);
for (const r of out.rows) console.log(JSON.stringify(r));
console.log(`engines close-up, first vs last visit to the first map: ${out.diffPixels} of ${out.pixels} pixels differ`);
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
