// Explore's entry from the title: the camera pose on the last title frame, then on every Explore frame of the glide.
// Prints the jump from the title to the first Explore frame, the largest per-frame step after it, and how far out
// the glide goes from the site's middle. With a drag frame, a real mouse drag starts on the canvas at that frame and
// moves 4 px before each later frame, for 60 frames, so the steps also cover a drag during and after the glide.
// Saves JPEGs of the title, the first Explore frames, every 40th frame and the end when OUT is set.
// Usage: node explore-entry.mjs <base-url> <map> [w] [h] [drag-frame]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, map, w = '1280', h = '720', drag = ''] = process.argv.slice(2);
const out = process.env.OUT;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
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
await page.goto(`${base}/?quality=high&map=${map}`, { timeout: 240000 });
await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
await page.waitForTimeout(1500);
if (out) {
  fs.mkdirSync(out, { recursive: true });
  await page.screenshot({ path: `${out}/${map}-${w}x${h}-title.jpg`, type: 'jpeg', quality: 80 });
}

await page.evaluate(async (shots) => {
  window.__hold = true;
  await new Promise((r) => setTimeout(r, 100));
  const x = window.__explore;
  const v = window.__view;
  const cam = v.camera;
  const pose = () => ({ p: cam.position.clone(), d: cam.getWorldDirection(cam.position.clone()), fov: cam.fov });
  const probe = { title: pose(), poses: [], images: {}, flying: [] };
  probe.step = (n) => {
    for (let i = 0; i < n; i++) {
      const k = probe.poses.length;
      x.frame(1 / 60);
      probe.poses.push(pose());
      probe.flying.push(!!x.flight);
      if (shots && (k < 2 || k % 40 === 0)) probe.images[`f${String(k + 1).padStart(3, '0')}`] = v.renderer.domElement.toDataURL('image/jpeg', 0.8);
    }
    return { frames: probe.poses.length, flying: !!x.flight };
  };
  window.__probe = probe;
  document.querySelector('.open-explore').click();
  await x.ready;
  await new Promise((r) => setTimeout(r, 0));
}, !!out);

const step = (n) => page.evaluate((n) => window.__probe.step(n), n);
let state;
if (drag) {
  state = await step(+drag);
  const box = await page.locator('#gl').boundingBox();
  let mx = box.x + box.width / 2;
  const my = box.y + box.height / 2;
  await page.mouse.move(mx, my);
  await page.mouse.down();
  for (let i = 0; i < 60; i++) {
    mx += 4;
    await page.mouse.move(mx, my);
    state = await step(1);
  }
  await page.mouse.up();
}
state = await step(3);
while (state.flying && state.frames < 600) state = await step(10);
state = await step(20);

const res = await page.evaluate((drag) => {
  const pr = window.__probe;
  const step = (a, b) => ({
    move: +a.p.distanceTo(b.p).toFixed(2),
    turn: +((Math.acos(Math.min(1, a.d.dot(b.d))) * 180) / Math.PI).toFixed(2),
    fov: +(b.fov - a.fov).toFixed(2),
  });
  const fmt = (q) => ({ p: q.p.toArray().map((n) => +n.toFixed(1)), fov: +q.fov.toFixed(1) });
  const fromSite = (q) => Math.hypot(q.p.x, q.p.z + 60);
  const { poses, title } = pr;
  const steps = poses.map((q, i) => step(i ? poses[i - 1] : title, q));
  const worst = (key) => steps.slice(1).reduce((m, s, i) => (s[key] > m.v ? { v: s[key], frame: i + 2 } : m), { v: 0, frame: 0 });
  const glideFrames = pr.flying.indexOf(false) + 1;
  return {
    map: window.__view.world.map,
    frames: poses.length,
    glideFrames,
    title: fmt(title),
    first: fmt(poses[0]),
    end: fmt(poses.at(-1)),
    titleToFirst: steps[0],
    largestMove: worst('move'),
    largestTurn: worst('turn'),
    farthestFromSite: +Math.max(...poses.map(fromSite)).toFixed(1),
    titleFromSite: +fromSite(title).toFixed(1),
    lowest: +Math.min(...poses.map((q) => q.p.y)).toFixed(2),
    drag: drag ? { from: +drag, stepAtPress: steps[+drag], turnAfterGlide: +steps.slice(glideFrames).reduce((s, x) => s + x.turn, 0).toFixed(1) } : null,
    images: pr.images,
  };
}, drag);

if (out) {
  fs.writeFileSync(`${out}/${res.map}-${w}x${h}-end.jpg`, await page.locator('#gl').screenshot({ type: 'jpeg', quality: 80 }));
  for (const [k, uri] of Object.entries(res.images)) fs.writeFileSync(`${out}/${res.map}-${w}x${h}-${k}.jpg`, Buffer.from(uri.split(',')[1], 'base64'));
}
delete res.images;
console.log(JSON.stringify(res));
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
