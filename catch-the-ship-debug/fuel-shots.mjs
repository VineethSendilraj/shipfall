// Stages a round 1 flight in the live game and screenshots fuel states. The page's own loop keeps rendering
// while its sim step is a no-op; this script steps the sim (with the view's camera) to each requested frame.
// Usage: node fuel-shots.mjs <base url> <tag> <w> <h> <embed 0|1> <still|typical|hover> <steps:name,...>
// Frames count sim steps after the round goes live, as in fuel-plan.mjs.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, tag, w, h, embed, mode, shotsCsv] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const shots = shotsCsv.split(',').map((s) => s.split(':')).map(([f, name]) => ({ f: Number(f), name }));
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()));
await page.addInitScript(() => localStorage.setItem('ctb-coached', '1'));
await page.goto(`${base}${embed === '1' ? '/embed/' : '/'}?quality=high`, { timeout: 120000 });
await page.waitForFunction(() => !!window.__game && !!window.__view, null, { timeout: 120000 });
await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => console.log('networkidle timed out'));
const models = await page
  .waitForFunction(() => window.__view.world?.dressing?.mount?.visible === false, null, { timeout: 90000 })
  .then(() => 'blender')
  .catch(() => 'procedural');
const renderer = await page.evaluate(() => {
  const gl = window.__view.renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
});
console.log(JSON.stringify({ tag, models, renderer }));

await page.evaluate(
  ({ embed, mode }) => {
    document.getElementById(embed ? 'quick-play' : 'play').click();
    const g = window.__game;
    const view = window.__view;
    const real = g.step.bind(g);
    g.step = () => {};
    g.overrides = { 1: { boosters: [{ spawnDx: 0, vx0: 0, vy0: 176, zeroY: 300 }], wind: { base: 0, gusts: [] } } };
    g.round = 0;
    g.start();
    const NO = { left: false, right: false, up: false, down: false, close: false };
    const pulse = (f) => [-1, 1, 1, -1][Math.floor(f / 6) % 4];
    const steer = {
      still: () => 0,
      typical: (f) => (f >= 60 && f < 156 ? pulse(f) : 0),
      hover: (f, b) => (b.burning && b.vy < 3 * 4 ? pulse(f) : 0),
    }[mode];
    const one = (input) => {
      view.snapshot(g);
      real(input);
      view.stepCamera(g);
    };
    let f = -1;
    window.__flyTo = (target) => {
      if (f < 0) {
        while (g.phase !== 'live') one(NO);
        g.towers[0].armY = g.boosters[0].zeroY + 10;
        f = 0;
      }
      const b = g.boosters[0];
      while (f < target) {
        const dir = steer(f, b);
        one({ ...NO, left: dir < 0, right: dir > 0 });
        f++;
      }
      return { f, fuel: +b.fuel.toFixed(1), burning: b.burning, cutoff: b.cutoff, state: b.state, vy: +(b.vy / 4).toFixed(1), ready: g.towers[0].ready, popups: g.popups.map((p) => p.text) };
    };
  },
  { embed: embed === '1', mode },
);
const frames = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
// The HUD reads peak altitude and the burn mark once per drawn frame, so draw just after spawn and just after ignition.
for (const f of [1, 75]) {
  await page.evaluate((f) => window.__flyTo(f), f);
  await frames();
}
for (const s of shots) {
  const st = await page.evaluate((f) => window.__flyTo(f), s.f);
  await frames();
  const hud = await page.evaluate(() => {
    const g = document.getElementById('g-fuel');
    const r = g.getBoundingClientRect();
    return {
      fuelGauge: g.className,
      fuelText: g.querySelector('.g-val').textContent,
      fuelVisible: r.width > 0 && r.height > 0,
      arc: g.querySelector('.arc').style.strokeDasharray,
      burnLabel: document.querySelector('#h-timeline .l-burn').textContent,
      status: document.getElementById('h-status')?.textContent ?? null,
    };
  });
  const out = `${D}/fuel-${tag}-${s.name}.jpg`;
  await page.screenshot({ path: out, type: 'jpeg', quality: 85, timeout: 120000 });
  console.log(JSON.stringify({ shot: out, ...st, hud }));
}
await browser.close();
