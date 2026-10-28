// Title card button row on a tall phone viewport: each button's box and the card's bottom edge.
// Usage: node explore-cardrow.mjs <url> <prefix> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [url, prefix, w = '390', h = '844'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
await page.goto(url, { timeout: 120000 });
await page.waitForSelector('#title-screen .title-actions button', { state: 'visible', timeout: 120000 });
await page.waitForTimeout(2500);
const r = await page.evaluate(() => {
  const box = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  const card = document.querySelector('#title-screen .card') ?? document.querySelector('#title-screen > *');
  return {
    card: box(card),
    buttons: [...document.querySelectorAll('#title-screen .title-actions button')].map((b) => [b.textContent.trim().replace(/\s+/g, ' '), ...box(b)]),
    tall: document.body.classList.contains('tall'),
  };
});
console.log(JSON.stringify(r));
await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/${prefix}.jpg`, type: 'jpeg', quality: 85 });
await browser.close();
