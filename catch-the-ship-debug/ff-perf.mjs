// Frame cost, catch game vs free flight, same browser, viewport and quality, measured the rcost.mjs / perf.mjs
// way: (1) GPU cost of a full frame (render N times, then readPixels so the GPU finishes); (2) real-time uncapped
// rAF: JS time per frame and frame gaps. Usage: node ff-perf.mjs <base> [w] [h] [dpr] [secs] [rounds]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, w = '1512', h = '982', dpr = '2', secs = '8', rounds = '2'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });

const instrument = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const log = (window.__perf = { js: [], gaps: [], last: 0, on: false });
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      const t0 = performance.now();
      cb(t);
      if (log.on) {
        log.js.push(performance.now() - t0);
        if (log.last) log.gaps.push(t - log.last);
      }
      log.last = t;
    });
};
const summarize = () => {
  const { js, gaps } = window.__perf;
  const q = (a, p) => {
    const s = [...a].sort((x, y) => x - y);
    return +s[Math.floor(p * (s.length - 1))].toFixed(2);
  };
  return { frames: gaps.length, fps: +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1), gap: { p50: q(gaps, 0.5), p95: q(gaps, 0.95) }, js: { p50: q(js, 0.5), p95: q(js, 0.95) } };
};
// GPU cost of one frame through the given draw function.
const gpuCost = (drawSrc) =>
  new Function(`
    const v = window.__view, gl = v.renderer.getContext(), px = new Uint8Array(4);
    const draw = ${drawSrc};
    const run = (n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return (performance.now() - t0) / n; };
    run(5);
    const s = [run(20), run(20), run(20)].sort((a, b) => a - b);
    const info = v.renderer.info.render;
    return { ms: +s[1].toFixed(2), spread: s.map((x) => +x.toFixed(2)), calls: info.calls, tris: info.triangles, quality: v.quality.name, dpr: v.pixelRatio };
  `);

async function measureCatch() {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript(instrument);
  await page.goto(`${base}/`);
  await page.waitForTimeout(3000);
  await page.click('#play');
  await page.waitForTimeout(3500);
  const gpu = await page.evaluate(`(${gpuCost('() => v.render(window.__game)').toString()})()`);
  await page.evaluate(() => {
    window.__perf.on = true;
    window.__perf.last = 0;
  });
  await page.waitForTimeout(+secs * 1000);
  const rt = await page.evaluate(summarize);
  await page.close();
  return { gpu, rt };
}

async function measureFlight() {
  const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.addInitScript(instrument);
  // GPU cost on the capture build: liftoff (plume, steam, heat haze) and cruising past the tower.
  await page.goto(`${base}/?mode=flight&capture=1`);
  await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__flight.step({ climb: 1 }, 150));
  const gpuLiftoff = await page.evaluate(`(${gpuCost('() => window.__flight.draw()').toString()})()`);
  await page.evaluate(() => window.__flight.step({ climb: 0.3, fwd: 1 }, 60 * 12));
  const gpuCruise = await page.evaluate(`(${gpuCost('() => window.__flight.draw()').toString()})()`);
  await page.close();
  // Real-time play with keys held: lift off and fly.
  const live = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
  await live.addInitScript(instrument);
  await live.goto(`${base}/?mode=flight`);
  await live.waitForTimeout(3000);
  await live.keyboard.down('KeyW');
  await live.waitForTimeout(2500);
  await live.evaluate(() => {
    window.__perf.on = true;
    window.__perf.last = 0;
  });
  await live.waitForTimeout(2500);
  await live.keyboard.up('KeyW');
  await live.keyboard.down('ArrowUp');
  await live.waitForTimeout(+secs * 1000 - 2500);
  const rt = await live.evaluate(summarize);
  await live.close();
  return { gpuLiftoff, gpuCruise, rt };
}

for (let r = 0; r < +rounds; r++) {
  const c = await measureCatch();
  console.log(JSON.stringify({ round: r, mode: 'catch', size: `${w}x${h}@${dpr}`, ...c }));
  const f = await measureFlight();
  console.log(JSON.stringify({ round: r, mode: 'flight', size: `${w}x${h}@${dpr}`, ...f }));
}
await browser.close();
