// Play-mode check on one server: the same catch-game frame (a fresh Game, seed 1, 240 steps into a flight, with a
// fresh Director, quality high) rendered on a page that never opened Explore ("plain") and on a page that opened it
// on both maps, with its entry glide and the engines close-up ("visited"). Both pages make the same map switches
// first. Saves <out>/plain-<map>.png, <out>/visited-<map>.png and <out>/again-starbase.png (a second plain page) for
// explore-png-cmp.mjs.
// Usage: node explore-play-ab.mjs <base-url> <out-dir> [w] [h]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, dir, w = '1280', h = '720'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const problems = [];

// Map sequences after the page opens on Starbase; the last entry is the map the frame is rendered on.
const CASES = [
  ['starbase', ['mars', 'starbase']],
  ['mars', ['mars']],
];

async function run(label, picks) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => problems.push(`${label}: pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${label}: ${m.type()}: ${m.text()}`));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__hold = false;
    const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
    window.requestAnimationFrame = wrap;
  });
  await page.goto(`${base}/?quality=high&map=starbase`, { timeout: 240000 });
  await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
  await page.waitForTimeout(800);
  const visit = label === 'visited';
  const r = await page.evaluate(async ({ picks, visit }) => {
    window.__hold = true;
    await new Promise((res) => setTimeout(res, 100));
    const x = window.__explore;
    const v = window.__view;
    const explore = async () => {
      document.querySelector('#title-screen .open-explore').click();
      await x.ready;
      await new Promise((res) => setTimeout(res, 0));
      for (let k = 0; k < 400 && x.flight; k++) x.frame(1 / 60);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true }));
      for (let k = 0; k < 400 && x.flight; k++) x.frame(1 / 60);
      for (let k = 0; k < 10; k++) x.frame(1 / 60);
      const lamp = x.lamp.intensity;
      document.getElementById('explore-back').click();
      return lamp;
    };
    const lamps = [];
    if (visit) lamps.push(await explore());
    for (const map of picks) {
      document.querySelector(`#title-screen .map-pick button[data-map="${map}"]`).click();
      await new Promise((res) => setTimeout(res, 300));
      if (visit) lamps.push(await explore());
    }
    const { Game, NO_INPUT } = await import('/src/sim.js');
    const { Director } = await import('/src/three/director.js');
    const g = new Game({ width: 1280, seed: 1 });
    g.start();
    v.director = new Director({ cinematic: false });
    for (let i = 0; i < 240; i++) {
      g.events.length = 0;
      v.snapshot(g);
      g.step(NO_INPUT);
      v.stepCamera(g);
    }
    // The view places the engines' heat haze with the camera of the frame before (view.draw projects it before the
    // director moves the camera), so the measured frame follows a game frame, as in play.
    v.render(g, { alpha: 1 });
    v.render(g, { alpha: 1 });
    const gl = v.renderer.domElement;
    const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
    c.getContext('2d').drawImage(gl, 0, 0);
    return { map: v.world.map, lamps: lamps.map((n) => +n.toFixed(1)), title: !document.getElementById('title-screen').classList.contains('hidden'), png: c.toDataURL('image/png') };
  }, { picks, visit });
  fs.writeFileSync(`${dir}/${label}-${r.map}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(label, r.map, 'lamp intensity in each close-up:', JSON.stringify(r.lamps), 'title shown after:', r.title);
  await page.close();
}

for (const [, picks] of CASES) {
  await run('plain', picks);
  await run('visited', picks);
}
// A second page that never opens Explore: plain and again must match before plain and visited can mean anything.
await run('again', CASES[0][1]);
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
