// Replays the flash scan's engine close-up (zoom, orbit, tilt, unzoom), then probes the glide to Nose: the route
// it took and the alternatives (curve short and long way round, line), with bend size and how close each comes to
// the model and to the tower lattice.
// Usage: node explore-probe.mjs <base> [presetKey=5]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base = 'http://127.0.0.1:41830', key = '5'] = process.argv.slice(2);
const W = 1280;
const H = 720;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 120000 });
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.__hold = true;
  window.__run = (n, untilLanded = false) => {
    const e = window.__explore;
    for (let k = 0; k < n; k++) {
      e.frame(1 / 60);
      if (untilLanded && !e.flight) return k;
    }
    return n;
  };
  window.__key = (n) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: String(n), code: `Digit${n}`, bubbles: true }));
});
const run = (n) => page.evaluate((n) => window.__run(n), n);
const drag = async (x0, y0, dx, dy, frames, button = 'left') => {
  await page.mouse.move(x0, y0);
  await page.mouse.down({ button });
  for (let i = 1; i <= frames; i++) {
    await page.mouse.move(x0 + (dx * i) / frames, y0 + (dy * i) / frames);
    await run(1);
  }
  await page.mouse.up({ button });
  await run(30);
};
const zoom = async (x, y, steps, dir) => {
  await page.mouse.move(x, y);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, dir * 100);
    await run(2);
  }
  await run(30);
};
await page.evaluate(() => { window.__key(2); window.__run(400, true); window.__run(20); });
await zoom(W / 2, H * 0.42, 14, -1);
await drag(W * 0.35, H * 0.5, W * 0.3, 0, 60);
await drag(W * 0.5, H * 0.5, 0, -H * 0.15, 30);
await zoom(W / 2, H / 2, 14, 1);

const out = await page.evaluate((key) => {
  const e = window.__explore;
  const V = e.view.camera.position.constructor;
  const rel = (p) => [p.x - e.foot.x, p.y, p.z - e.foot.z].map((n) => Math.round(n * 10) / 10);
  const tw = e.view.towers[0].root.position;
  // Distance to the lattice box only.
  const lattice = (p) => {
    const qx = Math.abs(p.x - tw.x) - 8.5, qy = Math.abs(p.y - (tw.y + 70)) - 80, qz = Math.abs(p.z - tw.z) - 8.5;
    return Math.min(Math.max(qx, qy, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  };
  const start = { cam: rel(e.view.camera.position), tgt: rel(e.controls.target) };
  window.__key(Number(key));
  const f = e.flight;
  const most = (bend) => Math.max(...bend.map((b) => b.length()));
  const describe = (g, bend) => {
    const pos = new V(), tgt = new V(), b = new V();
    let minModel = Infinity, minLattice = Infinity, near10 = 0, path = [];
    for (let i = 0; i <= 200; i++) {
      e.glideAt(g, i / 200, tgt, pos);
      if (bend) pos.add(bend[i]);
      const d = e.toModel(pos);
      minModel = Math.min(minModel, d);
      minLattice = Math.min(minLattice, lattice(pos));
      if (d < 10) near10++;
      if (i % 20 === 0) path.push(rel(pos));
    }
    return { line: !!g.line, turnDeg: Math.round((g.turn * 180) / Math.PI), maxBend: bend ? +most(bend).toFixed(2) : 0, minModel: +minModel.toFixed(2), minLattice: +minLattice.toFixed(2), samplesWithin10m: near10, path };
  };
  const chosen = describe(f, f.bend);
  const long = { ...f, line: false, turn: f.turn - Math.sign(f.turn) * 2 * Math.PI };
  const cands = {
    curveUnbent: describe({ ...f, line: false }, null),
    curveBent: describe({ ...f, line: false }, e.bendAround({ ...f, line: false })),
    lineUnbent: describe({ ...f, line: true }, null),
    lineBent: describe({ ...f, line: true }, e.bendAround({ ...f, line: true })),
    longUnbent: describe(long, null),
    longBent: describe(long, e.bendAround(long)),
  };
  return { start, end: { cam: rel(f.to.position), tgt: rel(f.to.target) }, hop: +f.hop.toFixed(1), seconds: +f.seconds.toFixed(2), chosen, cands };
}, key);
console.log(JSON.stringify({ start: out.start, end: out.end, hop: out.hop, seconds: out.seconds }));
console.log('chosen', JSON.stringify(out.chosen));
for (const [k, v] of Object.entries(out.cands)) console.log(k.padEnd(12), JSON.stringify(v));
await browser.close();
