// Short hop and land on the mount, then the result card. Usage: node ff-card.mjs <base> <tag> <w> <h> [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, tag, w, h, embed] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: !!embed, isMobile: !!embed && +w < 480 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}${embed ? '/embed/' : '/'}?mode=flight&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });
const run = (fnSrc, frames, untilSrc = null) =>
  page.evaluate(([a, b, c]) => window.__flight.run(new Function('f', `return (${a});`), b, c ? new Function('f', `return (${c});`) : null), [fnSrc, frames, untilSrc]);
await run('({})', 30);
await page.screenshot({ path: `${D}/ff-${tag}-ready.png`, timeout: 180000 });
await run('({ climb: 1 })', 60 * 20, 'f.lowY > 70');
await run('({})', 60 * 8, 'Math.abs(f.vel.y) < 0.2');
await run('({ climb: -1 })', 60 * 60, "f.phase !== 'flying'");
await run('({})', 60 * 5, "!document.getElementById('flight-over').classList.contains('hidden')");
await run('({})', 20);
await page.screenshot({ path: `${D}/ff-${tag}-card.png`, timeout: 180000 });
const layout = await page.evaluate(() => {
  const cardEl = document.querySelector('#flight-over .card');
  const card = cardEl.getBoundingClientRect();
  const s = document.getElementById('sound').getBoundingClientRect();
  const btns = [...document.querySelectorAll('#flight-over .actions > *')].map((b) => ({ t: b.textContent.trim(), h: Math.round(b.getBoundingClientRect().height) }));
  return {
    cardBottom: Math.round(card.bottom),
    soundClear: s.top >= card.bottom || s.bottom <= card.top || s.left >= card.right || s.right <= card.left,
    btns,
    scrolls: cardEl.scrollHeight > cardEl.clientHeight + 1,
    h: innerHeight,
  };
});
console.log(JSON.stringify(layout), 'errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
