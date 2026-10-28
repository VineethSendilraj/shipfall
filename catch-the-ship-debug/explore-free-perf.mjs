// Frame times of glides from user poses (headless, real GPU, vsync-capped): the glides whose route() took longest
// in explore-clear-f2.log. Each pose orbits a preset by dTheta degrees and scales its distance, as explore-clear.mjs.
// Usage: node explore-free-perf.mjs <base-url> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', w = '1280', h = '720'] = process.argv.slice(2);
const IDS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
const CASES = [
  ['nose', 80, 1, 'flaps'], ['nose', 80, 1, 'ring'], ['nose', 80, 1, 'fins'], ['nose', 80, 1, 'engines'],
  ['engines', 160, 1, 'ring'], ['engines', 160, 1, 'fins'], ['engines', 80, 1, 'tower'], ['nose', 80, 1, 'tower'],
  ['engines', 80, 1, 'ring'], ['engines', 80, 1, 'flaps'], ['engines', 80, 1, 'fins'], ['engines', 160, 1, 'nose'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const P = (window.__p = { frames: [], focus: [], on: false, last: 0 });
  window.requestAnimationFrame = (cb) => raf((t) => {
    const s = performance.now();
    cb(t);
    if (P.on) P.frames.push({ t, gap: P.last ? t - P.last : 0, js: performance.now() - s });
    P.last = t;
  });
});
await page.goto(`${base}/?explore=1`, { timeout: 120000 });
const landed = () => page.waitForFunction(() => window.__explore?.stack && window.__explore.shapes.length && !window.__explore.flight, null, { timeout: 120000, polling: 100 });
await landed();
await page.waitForTimeout(4000);
await page.evaluate(() => {
  const ex = window.__explore;
  const focus = ex.focus.bind(ex);
  ex.focus = (p, instant) => {
    const s = performance.now();
    focus(p, instant);
    window.__p.focus.push({ at: s, ms: performance.now() - s });
  };
});
let missedAll = 0;
for (const [from, dTheta, scale, to] of CASES) {
  await page.keyboard.press(String(IDS.indexOf(from) + 1));
  await landed();
  await page.evaluate(({ dTheta, scale }) => {
    const e = window.__explore;
    const cam = e.view.camera.position;
    const t = e.controls.target;
    const o = cam.clone().sub(t);
    const rad = o.length();
    const theta = Math.atan2(o.x, o.z) + (dTheta * Math.PI) / 180;
    const phi = Math.acos(o.y / rad);
    cam.set(t.x + rad * scale * Math.sin(phi) * Math.sin(theta), t.y + rad * scale * Math.cos(phi), t.z + rad * scale * Math.sin(phi) * Math.cos(theta));
  }, { dTheta, scale });
  await page.waitForTimeout(300);
  await page.evaluate(() => Object.assign(window.__p, { frames: [], focus: [], on: true, last: 0 }));
  await page.keyboard.press(String(IDS.indexOf(to) + 1));
  await landed();
  const r = await page.evaluate(() => {
    const P = window.__p;
    P.on = false;
    const f = P.frames.slice(1);
    return { frames: f.length, maxGap: +Math.max(...f.map((x) => x.gap)).toFixed(1), missed: f.filter((x) => x.gap > 25).length, focusMs: +(P.focus[0]?.ms ?? 0).toFixed(1) };
  });
  missedAll += r.missed;
  console.log(`${from}(${dTheta},${scale}) -> ${to}`, JSON.stringify(r));
}
console.log('missed frames in all', missedAll, 'quality', JSON.stringify(await page.evaluate(() => window.__quality)));
await browser.close();
