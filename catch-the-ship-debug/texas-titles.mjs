// Title-screen screenshots at several sizes in one headless Chrome: full site and embed, Starbase and Mars.
// Usage: node texas-titles.mjs <base> <prefix> [waitMs] [only]
// Writes <prefix>-<name>.jpg for each config below (only: comma list of names).
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, waitMs = '4000', only = ''] = process.argv.slice(2);
const CONFIGS = [
  { name: '1280', w: 1280, h: 720, path: '/' },
  { name: '480-embed', w: 480, h: 480, path: '/embed/' },
  { name: '390x844', w: 390, h: 844, path: '/' },
  { name: '390x844-embed', w: 390, h: 844, path: '/embed/' },
  { name: 'mars-1280', w: 1280, h: 720, path: '/', q: 'map=mars' },
  { name: 'mars-480-embed', w: 480, h: 480, path: '/embed/', q: 'map=mars' },
  { name: 'mars-390x844', w: 390, h: 844, path: '/', q: 'map=mars' },
];
const pick = only ? CONFIGS.filter((c) => only.split(',').includes(c.name)) : CONFIGS;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const c of pick) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  page.on('pageerror', (e) => console.log(`${c.name} pageerror:`, e.message));
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`${c.name} console.${m.type()}:`, m.text()));
  await page.goto(`${base}${c.path}${c.q ? `?${c.q}` : ''}`);
  await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
  await page.waitForTimeout(Number(waitMs));
  await page.screenshot({ path: `${prefix}-${c.name}.jpg`, type: 'jpeg', quality: 88 });
  await page.close();
  console.log('shot', c.name);
}
await browser.close();
