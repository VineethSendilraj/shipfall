// How smoothly the booster moves on screen when frames outnumber sim steps (uncapped rAF, ~200+ fps).
// Reports the share of drawn frames where the booster's projected position actually changed, and the
// largest jump relative to the median motion per frame.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(url);
await page.waitForTimeout(2500);
await page.click('#play');
await page.waitForTimeout(2500);
const r = await page.evaluate(() => new Promise((done) => {
  const v = window.__view, ys = [];
  const t0 = performance.now();
  const f = () => {
    const b = window.__game.boosters.find((x) => x.state === 'falling');
    if (b) {
      const p = new v.camera.position.constructor();
      const root = v.pool.find((s) => s.id === b.id)?.root;
      if (root) { p.setFromMatrixPosition(root.matrixWorld).project(v.camera); ys.push(p.y); }
    }
    if (performance.now() - t0 < 3000) requestAnimationFrame(f);
    else {
      const d = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
      const moved = d.filter((x) => x > 1e-6).length;
      const sorted = [...d].sort((a, b) => a - b);
      done({ frames: ys.length, movedShare: +(moved / d.length).toFixed(2), maxOverMedianNonzero: +(sorted.at(-1) / sorted.filter((x) => x > 1e-6)[Math.floor(moved / 2)]).toFixed(1) });
    }
  };
  requestAnimationFrame(f);
}));
console.log(url, JSON.stringify(r));
await browser.close();
