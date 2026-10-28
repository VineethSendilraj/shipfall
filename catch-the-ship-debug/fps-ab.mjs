// Alternating uncapped fps comparison of several URLs in one headless browser, one page at a time, with the
// order rotated each round (the machine is shared, so a single run per URL means little). Reports each run and
// the median / min / max per URL. Usage: node fps-ab.mjs <rounds> <secs> <mode title|flight|boom> <url>...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [rounds, secs, mode, ...urls] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const runs = Object.fromEntries(urls.map((u) => [u, []]));
for (let r = 0; r < +rounds; r++) {
  const order = urls.map((_, i) => urls[(i + r) % urls.length]);
  for (const url of order) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
    await page.addInitScript(() => {
      try {
        localStorage.setItem('ctb-coached', '1');
      } catch {}
    });
    await page.goto(url);
    await page.waitForFunction(() => !!window.__view, null, { timeout: 90000 });
    await page.waitForTimeout(3500);
    if (mode === 'flight' || mode === 'boom') await page.evaluate(() => document.getElementById('play').click());
    // boom: measure from the first crash on, i.e. the explosion itself.
    if (mode === 'boom') await page.waitForFunction(() => window.__game?.stats?.misses > 0, null, { timeout: 60000, polling: 50 });
    const fps = await page.evaluate(
      (secs) =>
        new Promise((done) => {
          let n = 0;
          const t0 = performance.now();
          const tick = (t) => {
            n++;
            if (t - t0 < secs * 1000) requestAnimationFrame(tick);
            else done(+((n * 1000) / (t - t0)).toFixed(1));
          };
          requestAnimationFrame(tick);
        }),
      +secs,
    );
    runs[url].push(fps);
    console.log(`round ${r + 1} ${url} ${fps}`);
    await page.close();
  }
}
for (const [url, v] of Object.entries(runs)) {
  const s = [...v].sort((a, b) => a - b);
  console.log(JSON.stringify({ url, median: s[Math.floor((s.length - 1) / 2)], min: s[0], max: s[s.length - 1], runs: v }));
}
await browser.close();
