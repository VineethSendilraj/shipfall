// Free flight against Explore, both ways, on one server.
//   Explore after a flight: the Engines close-up (a cut with the explore clock at 0, as in explore-maptrip.mjs) on a
//   page that flew a piloted free flight until the catch scene was gone (fog density 0), then pressed Fly again (to
//   the title), against a page that never flew: <out>/plain-<case>.png and <out>/flown-<case>.png.
//   Free flight after Explore: the flight's first frame on a page that visited Explore (glide in, Engines, Back)
//   against a page that never did: <out>/fresh-<case>.png and <out>/explored-<case>.png.
// A second plain page and a second fresh page (again-*, refresh-*) must match first. Pair with explore-png-cmp.mjs.
// Usage: node explore-flight-ab.mjs <base-url> <out-dir> [w] [h]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, dir, w = '1280', h = '720'] = process.argv.slice(2);
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const problems = [];

async function open(label, query) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => problems.push(`${label}: pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${label}: ${m.type()}: ${m.text()}`));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__hold = false;
    const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
    window.requestAnimationFrame = wrap;
    window.__grab = () => {
      const gl = window.__view.renderer.domElement;
      const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
      c.getContext('2d').drawImage(gl, 0, 0);
      return c.toDataURL('image/png');
    };
  });
  await page.goto(`${base}/?quality=high&${query}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
  await page.waitForTimeout(800);
  return page;
}

function save(label, name, r) {
  fs.writeFileSync(`${dir}/${label}-${name}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(label, name, JSON.stringify(r.info));
}

// Explore after a flight. picks: map picks on the title before Explore opens.
async function exploreAfter(label, name, map, picks, fly) {
  const page = await open(label, `map=${map}${fly ? '&flight=1&pilot=1' : ''}`);
  if (fly) {
    const t0 = Date.now();
    let gone = true;
    try {
      await page.waitForFunction(() => window.__view.scene.fog.density === 0, null, { polling: 250, timeout: 240000 });
    } catch {
      gone = false;
    }
    const f = await page.evaluate(() => ({ real: +window.__flight.real.toFixed(1), phase: window.__flight.phase, mode: window.__flight.ship.mode }));
    console.log(label, name, `catch scene gone: ${gone} after ${((Date.now() - t0) / 1000).toFixed(0)} s`, JSON.stringify(f));
    await page.evaluate(() => document.getElementById('fo-again').click());
    await page.waitForTimeout(500);
  }
  const r = await page.evaluate(async (picks) => {
    for (const m of picks) {
      document.querySelector(`#title-screen .map-pick button[data-map="${m}"]`).click();
      await new Promise((res) => setTimeout(res, 300));
    }
    window.__hold = true;
    await new Promise((res) => setTimeout(res, 100));
    const x = window.__explore;
    const v = window.__view;
    const title = !document.getElementById('title-screen').classList.contains('hidden');
    document.querySelector('#title-screen .open-explore').click();
    await x.ready;
    x.enter('engines');
    await x.ready;
    x.idle = -1e9;
    x.game.t = 0;
    for (let k = 0; k < 4; k++) x.frame(1 / 60);
    const info = {
      titleBefore: title,
      map: v.world.map,
      lamp: +x.lamp.intensity.toFixed(2),
      fill: +x.fill.intensity.toFixed(1),
      fog: v.scene.fog.density,
      envI: v.scene.environmentIntensity,
      env: !!v.scene.environment,
      near: v.camera.near,
      far: v.camera.far,
      up: v.camera.up.toArray(),
      sky: v.world.sky.visible,
      key: +v.world.keyLight.intensity.toFixed(3),
      flightBody: document.body.classList.contains('free-flight'),
    };
    return { png: window.__grab(), info };
  }, picks);
  save(label, name, r);
  await page.close();
}

// Free flight after Explore: the flight's first frame.
async function flightAfter(label, name, map, explore) {
  const page = await open(label, `map=${map}`);
  const r = await page.evaluate(async (explore) => {
    window.__hold = true;
    await new Promise((res) => setTimeout(res, 100));
    const x = window.__explore;
    const v = window.__view;
    if (explore) {
      document.querySelector('#title-screen .open-explore').click();
      await x.ready;
      await new Promise((res) => setTimeout(res, 0));
      for (let k = 0; k < 400 && x.flight; k++) x.frame(1 / 60);
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true }));
      for (let k = 0; k < 400 && x.flight; k++) x.frame(1 / 60);
      for (let k = 0; k < 10; k++) x.frame(1 / 60);
      document.getElementById('explore-back').click();
    }
    document.getElementById('fly').click();
    const f = window.__flight;
    window.__flightView.render(f, { alpha: 1 });
    window.__flightView.render(f, { alpha: 1 });
    const info = {
      map: v.world.map,
      free: v.free,
      stackShown: x.stack ? x.stack.root.visible : null,
      lightsShown: x.lights ? x.lights.visible : null,
      exploreHidden: document.getElementById('explore').classList.contains('hidden'),
      flightFrame: f.frame,
    };
    return { png: window.__grab(), info };
  }, explore);
  save(label, name, r);
  await page.close();
}

const only = process.env.ONLY ?? 'explore,flight';
if (only.includes('explore')) {
  for (const [name, map, picks] of [
    ['sb', 'starbase', []],
    ['sb2mars', 'starbase', ['mars']],
    ['mars', 'mars', []],
  ]) {
    await exploreAfter('plain', name, map, picks, false);
    await exploreAfter('flown', name, map, picks, true);
  }
  await exploreAfter('again', 'sb', 'starbase', [], false);
}
if (only.includes('flight')) {
  for (const [name, map] of [
    ['sb', 'starbase'],
    ['mars', 'mars'],
  ]) {
    await flightAfter('fresh', name, map, false);
    await flightAfter('explored', name, map, true);
  }
  await flightAfter('refresh', 'sb', 'starbase', false);
}
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
