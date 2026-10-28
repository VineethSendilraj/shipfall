// Loads a page headless and prints console errors/page errors and timing. Usage: node probe-err.mjs <url> [w] [h]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, w = '1280', h = '720'] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('pageerror', (e) => console.log('pageerror:', e.message, e.stack?.split('\n').slice(0, 4).join(' | ')));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`console.${m.type()}:`, m.text().slice(0, 400)));
const t0 = Date.now();
await page.goto(url);
await page.waitForTimeout(6000);
const info = await page.evaluate(() => ({ view: !!window.__view, demo: window.__demoReady, frame: window.__demoFrame, info: window.__view?.renderer.info.render, mem: window.__view?.renderer.info.memory }));
console.log(JSON.stringify(info), `${Date.now() - t0} ms`);
await browser.close();
