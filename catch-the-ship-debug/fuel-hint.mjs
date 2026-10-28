// Screenshots the title card and reports how many lines the steering copy wraps to.
// Usage: node fuel-hint.mjs <base url> <tag> <w> <h> <embed 0|1>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [base, tag, w, h, embed] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}${embed === '1' ? '/embed/' : '/'}?quality=high`, { timeout: 120000 });
await page.waitForFunction(() => document.fonts.status === 'loaded' && !!window.__view, null, { timeout: 120000 });
await page.waitForTimeout(1500);
const lines = await page.evaluate((embed) => {
  const count = (el) => {
    const r = document.createRange();
    r.selectNodeContents(el);
    return new Set([...r.getClientRects()].filter((q) => q.width > 0).map((q) => Math.round(q.top))).size;
  };
  const visible = (el) => el.getBoundingClientRect().width > 0;
  const els = embed
    ? [...document.querySelectorAll('#quick-start .hint')]
    : [...document.querySelectorAll('#title-screen .controls span')];
  return els.filter(visible).map((el) => ({ text: el.textContent, lines: count(el), width: Math.round(el.getBoundingClientRect().width) }));
}, embed === '1');
console.log(JSON.stringify({ tag, lines }));
await page.screenshot({ path: `${D}/fuel-${tag}-title.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
await browser.close();
