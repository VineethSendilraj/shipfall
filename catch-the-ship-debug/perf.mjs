// Real-game frame cost, headless real GPU, uncapped rAF. Usage: node perf.mjs <url> [w] [h] [dpr] [secs] [exp]
// exp: comma list applied after start: dpr=<n> | noshadow | nobloom | nomsaa | quality=<idx>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, w = '1512', h = '982', dpr = '2', secs = '20', exp = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: +dpr });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  const log = (window.__perf = { js: [], gaps: [], last: 0, on: false });
  window.requestAnimationFrame = (cb) => raf((t) => {
    const t0 = performance.now();
    cb(t);
    if (log.on) { log.js.push(performance.now() - t0); if (log.last) log.gaps.push(t - log.last); }
    log.last = t;
  });
});
await page.goto(url);
await page.waitForTimeout(1500);
await page.click('#play');
await page.waitForTimeout(800);
const applied = await page.evaluate((exp) => {
  const v = window.__view, out = [];
  for (const e of exp.split(',').filter(Boolean)) {
    const [k, val] = e.split('=');
    const q = { ...v.quality };
    if (k === 'dpr') { q.maxDpr = +val; v.setQuality(q); }
    if (k === 'noshadow') { q.shadows = false; v.setQuality(q); }
    if (k === 'nobloom') { q.bloom = 0; v.setQuality(q); }
    if (k === 'nomsaa') { q.msaa = 0; v.setQuality(q); }
    out.push(e);
  }
  return { exp: out, quality: v.quality, dpr: v.pixelRatio, canvas: [v.renderer.domElement.width, v.renderer.domElement.height] };
}, exp);
await page.waitForTimeout(1500);
await page.evaluate(() => { window.__perf.on = true; window.__perf.last = 0; });
await page.waitForTimeout(+secs * 1000);
const r = await page.evaluate(() => {
  const { js, gaps } = window.__perf;
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(p * (s.length - 1))].toFixed(2); };
  const info = window.__view.renderer.info.render;
  return { frames: gaps.length, fps: +(1000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)).toFixed(1), gap: { p50: q(gaps, 0.5), p95: q(gaps, 0.95), p99: q(gaps, 0.99), max: q(gaps, 1) }, js: { p50: q(js, 0.5), p95: q(js, 0.95), max: q(js, 1) }, over8ms: gaps.filter((g) => g > 8.4).length, over17ms: gaps.filter((g) => g > 16.8).length, calls: info.calls, tris: info.triangles, quality: window.__quality };
});
console.log(JSON.stringify({ url, size: `${w}x${h}@${dpr}`, ...applied, ...r }));
await browser.close();
