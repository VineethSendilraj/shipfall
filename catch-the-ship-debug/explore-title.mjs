// Title card and embed quick-start with the Explore entry points: screenshots, then clicks Explore and checks that
// explore mode opens and that Esc returns to the card.
// Usage: node explore-title.mjs <base-url> <prefix> <w> <h> <path>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, w, h, path = '/'] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(m.type(), m.text()));
await page.goto(`${base}${path}`, { timeout: 240000 });
const card = path.includes('embed') ? '#quick-start' : '#title-screen';
await page.waitForSelector(`${card} .open-explore`, { state: 'visible', timeout: 240000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: `${D}/${prefix}-card.jpg`, type: 'jpeg', quality: 88 });
const box = await page.locator(`${card} .open-explore`).boundingBox();
console.log('explore button', JSON.stringify(box), 'viewport', w, h);
await page.locator(`${card} .open-explore`).click();
await page.waitForFunction(() => window.__explore?.active && window.__explore.stack && !window.__explore.flight, null, { timeout: 240000, polling: 100 });
await page.waitForTimeout(400);
const state = await page.evaluate(() => ({
  active: window.__explore.active,
  map: window.__view.world.map,
  bodyClass: document.body.className,
  exploreHidden: document.getElementById('explore').classList.contains('hidden'),
  cardHidden: getComputedStyle(document.querySelector('.overlay:not(.hidden)') ?? document.body).display,
  chipsScroll: (() => {
    const c = document.getElementById('explore-chips');
    return { scrollWidth: c.scrollWidth, clientWidth: c.clientWidth, overflowX: getComputedStyle(c).overflowX };
  })(),
  photoVisible: getComputedStyle(document.getElementById('explore-photo')).display !== 'none',
  disclaimers: [...document.querySelectorAll('body *')]
    .filter((n) => /not affiliated with SpaceX/i.test(n.textContent) && n.children.length === 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { id: el.id || el.className, visible: r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden', top: Math.round(r.top), bottom: Math.round(r.bottom) };
    }),
  ui: ['explore-chips', 'explore-back', 'explore-hint'].map((id) => {
    const r = document.getElementById(id).getBoundingClientRect();
    return { id, top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right) };
  }),
}));
console.log('after click', JSON.stringify(state));
await page.screenshot({ path: `${D}/${prefix}-entered.jpg`, type: 'jpeg', quality: 88 });
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
const back = await page.evaluate((card) => ({
  active: window.__explore.active,
  map: window.__view.world.map,
  cardVisible: !document.querySelector(card).classList.contains('hidden') && getComputedStyle(document.querySelector(card)).display !== 'none',
  exploreHidden: document.getElementById('explore').classList.contains('hidden'),
}), card);
console.log('after Esc', JSON.stringify(back));
await browser.close();
