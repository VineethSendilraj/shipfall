// Saves a lossless frame of each Explore preset on each map from one server (a cut to the preset with the explore
// clock at 0 and the turntable off, as in explore-maptrip.mjs), so two servers run one after the other on the same
// port can be diffed with explore-png-cmp.mjs. Writes <out>/<label>-<map>-<preset>.png.
// Usage: node explore-presets-png.mjs <base-url> <out-dir> <label> [maps, default starbase,mars] [w] [h]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, dir, label, maps = 'starbase,mars', w = '1280', h = '720'] = process.argv.slice(2);
const PRESETS = ['stack', 'engines', 'fins', 'ring', 'nose', 'flaps', 'chopsticks', 'tower', 'farm'];
fs.mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const problems = [];
for (const map of maps.split(',')) {
  const page = await browser.newPage({ viewport: { width: +w, height: +h } });
  page.setDefaultTimeout(240000);
  page.on('pageerror', (e) => problems.push(`${map}: pageerror: ${e.message}`));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && problems.push(`${map}: ${m.type()}: ${m.text()}`));
  await page.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    window.__hold = false;
    const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
    window.requestAnimationFrame = wrap;
  });
  await page.goto(`${base}/?quality=high&map=${map}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    window.__hold = true;
    await new Promise((res) => setTimeout(res, 100));
    document.querySelector('#title-screen .open-explore').click();
    await window.__explore.ready;
  });
  for (const id of PRESETS) {
    const r = await page.evaluate(async (id) => {
      const x = window.__explore;
      x.enter(id);
      await x.ready;
      x.idle = -1e9;
      x.game.t = 0;
      for (let k = 0; k < 4; k++) x.frame(1 / 60);
      const gl = window.__view.renderer.domElement;
      const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
      c.getContext('2d').drawImage(gl, 0, 0);
      return { lamp: +x.lamp.intensity.toFixed(2), png: c.toDataURL('image/png') };
    }, id);
    fs.writeFileSync(`${dir}/${label}-${map}-${id}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
    console.log(label, map, id, 'lamp', r.lamp);
  }
  await page.close();
}
console.log(problems.length ? problems.join('\n') : 'no console errors or warnings');
await browser.close();
