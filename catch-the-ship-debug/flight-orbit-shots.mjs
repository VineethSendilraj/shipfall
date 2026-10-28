// Screenshots of the scripted free flight at each mission phase, from the frame-stepped capture mode.
// Usage: node flight-orbit-shots.mjs <base-url> [w] [h] [prefix] [path, e.g. /embed/] [only, e.g. pad,orbit]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w = '1280', h = '720', prefix = 'flight-orbit', path = '/', only = ''] = process.argv.slice(2);
const DIR = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const alt = 'Math.hypot(f.ship.x - 18.75, f.ship.y + 1e5) - 1e5';
const SHOTS = [
  ['pad', 'true'],
  ['liftoff', 'f.marks.liftoff != null && f.t - f.marks.liftoff > 2.5'],
  ['maxq', 'f.marks.maxq != null'],
  ['staging', 'f.marks.stage != null && f.t - f.marks.stage > 0.25'],
  ['orbit', 'f.marks.orbit != null && f.t - f.marks.orbit > 1.5'],
  ['deploy', 'f.stats.deployed >= 5'],
  ['catch', 'f.marks.catch != null && f.t - f.marks.catch > 0.6'],
  ['coast', 'f.stats.deployed === 10 && f.warp > 10'],
  ['reentry', "f.ship.mode === 'aero' && f.ship.heat > 0.55"],
  ['landing', `f.ship.mode === 'landing' && ${alt} < 120`],
  ['end', 'r && r.done && f.real - f.endT > 3.4'],
].filter(([n]) => !only || only.split(',').includes(n));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(m.type(), m.text().slice(0, 400)));
await page.goto(`${base}${path}?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
for (const [name, cond] of SHOTS) {
  const info = await page.evaluate((cond) => {
    const test = new Function('f', 'r', `return ${cond};`);
    let r = null;
    for (let i = 0; i < 60000 && !test(window.__flight, r); i++) r = window.__advance(1, false);
    r = window.__advance(0, true);
    const f = window.__flight;
    return { ...r, warp: +f.warp.toFixed(2), deployed: f.stats.deployed, met: test(f, r) };
  }, cond);
  await page.screenshot({ path: `${DIR}/${prefix}-${name}.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
  console.log(name, JSON.stringify(info));
}
await browser.close();
