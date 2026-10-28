// Which part of an Explore visit leaves a trace in the catch game: renders the explore-play-ab.mjs frame (fresh Game,
// seed 1, 240 steps, fresh Director) on fresh pages after different partial visits, and diffs each against the same
// frame on a page that never opened Explore. One map, no map switches.
// Usage: node explore-trace.mjs <base-url> [query, e.g. map=mars] [variant,variant,...] [out-dir]
import fs from 'node:fs';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const ALL = ['plain', 'enter-back', 'entry-glide', 'engines', 'engines-nolamp', 'engines-nomount', 'engines-nostack'];
const [base, query = 'map=starbase', list = ALL.join(','), out = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
let ref = null;

async function run(variant) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  await page.goto(`${base}/?quality=high&${query}`, { timeout: 240000 });
  await page.waitForFunction(() => window.__view?.models && window.__explore, null, { polling: 100, timeout: 240000 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(
    async ({ variant, ref, twice }) => {
      window.__hold = true;
      await new Promise((res) => setTimeout(res, 100));
      const x = window.__explore;
      const v = window.__view;
      const key = (k) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: `Digit${k}`, bubbles: true }));
      const settle = () => {
        for (let k = 0; k < 600 && x.flight; k++) x.frame(1 / 60);
      };
      const info = {};
      // No Explore: the title game rendered 150 more times, by the director or from the Engines close-up.
      if (variant === 'render-title' || variant === 'render-closeup') {
        const close = variant === 'render-closeup';
        v.free = close;
        for (let k = 0; k < 150; k++) {
          if (close) {
            v.camera.position.set(18.75, 10, 6.3);
            v.camera.lookAt(18.75, 22.25 + 64.6 - 66, 0);
          }
          v.render(window.__game);
        }
        v.free = false;
      } else if (variant === 'glide-norender') {
        document.querySelector('.overlay:not(.hidden) .open-explore').click();
        await x.ready;
        await new Promise((res) => setTimeout(res, 0));
        const render = v.render;
        v.render = () => {};
        settle();
        key('2');
        settle();
        v.render = render;
        document.getElementById('explore-back').click();
      } else if (variant !== 'plain') {
        if (variant === 'engines-nomount') {
          await x.models;
          x.world = v.world;
          x.moveMount = () => {};
          x.pickables = [];
        }
        if (variant === 'engines-nolamp') {
          const light = x.light;
          x.light = function () {
            light.call(this);
            this.lamp.intensity = 0;
            this.fill.intensity = 0;
          };
        }
        document.querySelector('.overlay:not(.hidden) .open-explore').click();
        await x.ready;
        await new Promise((res) => setTimeout(res, 0));
        if (variant === 'engines-nostack') x.stack.root.visible = false;
        if (variant !== 'enter-back') settle();
        if (variant.startsWith('engines')) {
          key('2');
          settle();
          for (let k = 0; k < 10; k++) x.frame(1 / 60);
        }
        info.lamp = +(x.lamp?.intensity ?? 0).toFixed(1);
        document.getElementById('explore-back').click();
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
      // director moves the camera), so with TWICE the measured frame follows a game frame, as in play.
      if (twice) v.render(g, { alpha: 1 });
      v.render(g, { alpha: 1 });
      const gl = v.renderer.domElement;
      const c = Object.assign(document.createElement('canvas'), { width: gl.width, height: gl.height });
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(gl, 0, 0);
      const png = c.toDataURL('image/png');
      if (!ref) return { info, png };
      const bmp = await createImageBitmap(await (await fetch(ref)).blob());
      const c2 = new OffscreenCanvas(bmp.width, bmp.height);
      const g2 = c2.getContext('2d');
      g2.drawImage(bmp, 0, 0);
      const p = ctx.getImageData(0, 0, c.width, c.height).data;
      const q = g2.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      let max = 0;
      for (let i = 0; i < p.length; i += 4) {
        const d = Math.max(Math.abs(p[i] - q[i]), Math.abs(p[i + 1] - q[i + 1]), Math.abs(p[i + 2] - q[i + 2]));
        if (d) n++;
        if (d > max) max = d;
      }
      return { info, png, differing: n, max };
    },
    { variant, ref, twice: !!process.env.TWICE },
  );
  if (!ref) ref = r.png;
  if (out) fs.writeFileSync(`${out}/trace-${variant}.png`, Buffer.from(r.png.split(',')[1], 'base64'));
  console.log(variant.padEnd(16), JSON.stringify({ ...r.info, differing: r.differing, max: r.max }), problems.length ? problems.join(' | ') : '');
  await page.close();
}

for (const variant of ['plain', ...list.split(',')]) await run(variant);
await browser.close();
