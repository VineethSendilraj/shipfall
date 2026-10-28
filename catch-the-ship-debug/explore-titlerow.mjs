// Title card and embed quick-start button rows at several sizes: each button's box, the rows they fall into, and
// whether any label is cut off (scrollWidth over clientWidth) or a button leaves the card. One page at a time.
// Usage: node explore-titlerow.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const SIZES = [
  ['/', 1280, 720, '#title-screen', '.title-actions .btn'],
  ['/', 390, 844, '#title-screen', '.title-actions .btn'],
  ['/', 360, 780, '#title-screen', '.title-actions .btn'],
  ['/', 360, 640, '#title-screen', '.title-actions .btn'],
  ['/embed/', 480, 480, '#quick-start', '.quick-links .ext'],
  ['/embed/', 400, 400, '#quick-start', '.quick-links .ext'],
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const [path, w, h, card, sel] of SIZES) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => console.log('pageerror:', e.message));
  await page.goto(`${base}${path}`, { timeout: 240000 });
  await page.waitForSelector(`${card} ${sel}`, { state: 'visible', timeout: 240000 });
  await page.waitForTimeout(1500);
  const r = await page.evaluate(({ card, sel }) => {
    const c = document.querySelector(card).querySelector('.card') ?? document.querySelector(card);
    const cb = c.getBoundingClientRect();
    const btns = [...document.querySelector(card).querySelectorAll(sel)].map((b) => {
      const r = b.getBoundingClientRect();
      return { text: b.textContent.trim().replace(/\s+/g, ' '), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), cut: b.scrollWidth > b.clientWidth + 1, out: r.left < cb.left - 1 || r.right > cb.right + 1 };
    });
    const rows = [...new Set(btns.map((b) => b.y))].length;
    return { card: { x: Math.round(cb.left), y: Math.round(cb.top), w: Math.round(cb.width), h: Math.round(cb.height), scroll: c.scrollHeight > c.clientHeight + 1 }, rows, btns, body: document.body.className };
  }, { card, sel });
  console.log(`${path} ${w}x${h}`, JSON.stringify(r));
  await page.close();
}
await browser.close();
