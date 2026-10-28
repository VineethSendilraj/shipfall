// Crash screenshot with the live HUD: starts a real game (seeded Math.random, coach skipped), gives no input so
// the booster falls onto the pad, and screenshots the given delays (ms) after the crash.
// Usage: node texas-crash.mjs <base> <w> <h> <prefix> [delaysCsv] [embed] [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, prefix, delaysCsv = '250', embed = '', extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  try {
    localStorage.setItem('ctb-coached', '1');
  } catch {}
});
const q = extra.replace(/^&/, '');
await page.goto(`${base}${embed ? '/embed/' : '/'}${q ? `?${q}` : ''}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 90000 });
await page.waitForTimeout(4000);
await page.evaluate(() => {
  let a = 1234567;
  Math.random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
});
await page.click(embed ? '#quick-play' : '#play');
await page.waitForFunction(() => window.__game?.boosters.some((b) => b.state === 'crashed') || window.__game?.stats.misses > 0, null, { timeout: 120000, polling: 'raf' });
let waited = 0;
for (const d of delaysCsv.split(',').map(Number).sort((x, y) => x - y)) {
  await page.waitForTimeout(d - waited);
  waited = d;
  await page.screenshot({ path: `${prefix}-crash${d}.jpg`, type: 'jpeg', quality: 90 });
}
console.log('frame', await page.evaluate(() => window.__game.frame));
await browser.close();
