// Screenshots the title-screen scene with overlays hidden. Usage: node title-shot.mjs <url> <out.jpg> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, out, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => !!window.__view, null, { timeout: 120000 });
await page.waitForLoadState('networkidle', { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(4000);
await page.addStyleTag({ content: '.overlay, #hud, .disclaimer, #sound { visibility: hidden !important; }' });
await page.waitForTimeout(500);
await page.screenshot({ path: out, type: 'jpeg', quality: 88 });
console.log('wrote', out);
await browser.close();
