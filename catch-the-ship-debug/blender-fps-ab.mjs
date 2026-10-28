// Frame-time A/B of the model change alone: same server and code, once normally (Blender GLBs) and once
// with /models/*.glb requests aborted so the game falls back to its procedural models. Same measurement as
// fps.mjs; pass "capped" to use the headed, vsync-capped settings of the original fps.mjs.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url = 'http://127.0.0.1:41740/?demo=1&quality=high', mode = 'uncapped', rounds = '2'] = process.argv.slice(2);
const args =
  mode === 'capped'
    ? { headless: false, args: ['--use-angle=metal'] }
    : { headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] };

async function measure(blockModels) {
  const browser = await chromium.launch({ channel: 'chrome', ...args });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
  let glbs = 0;
  if (blockModels) await page.route('**/models/*.glb', (route) => route.abort());
  page.on('response', (r) => r.url().endsWith('.glb') && r.status() === 200 && glbs++);
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.mouse.click(640, 360);
  const r = await page.evaluate(
    () =>
      new Promise((done) => {
        const times = [];
        let last = performance.now();
        const end = last + 15000;
        const tick = (t) => {
          times.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else {
            times.sort((a, b) => a - b);
            const p = (q) => times[Math.floor(q * (times.length - 1))];
            done({ frames: times.length, fps: (times.length / 15).toFixed(1), p50: p(0.5).toFixed(1), p95: p(0.95).toFixed(1), p99: p(0.99).toFixed(1) });
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  await browser.close();
  return { models: blockModels ? 'procedural (GLBs blocked)' : `blender GLBs (${glbs} loaded)`, ...r };
}

for (let i = 0; i < Number(rounds); i++) {
  for (const block of [true, false]) console.log(mode, JSON.stringify(await measure(block)));
}
