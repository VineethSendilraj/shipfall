// Renders every demo frame in order (like flicker-det.mjs) and screenshots the listed frames, also logging which
// pool slot each vehicle uses. Usage: node ship-seqframes.mjs <base> <prefix> <w> <h> f1,f2,...
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, prefix, w, h, list] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1`, { timeout: 600000 });
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 600000 });
const want = list.split(',').map(Number).sort((a, b) => a - b);
let frame = await page.evaluate(() => window.__demoFrame);
for (const f of want) {
  frame = await page.evaluate((target) => {
    let r = { frame: window.__demoFrame };
    while (r.frame < target) r = window.__advance(1, true);
    return r.frame;
  }, f);
  const slots = await page.evaluate(() => window.__view.pool.map((s, i) => `${i}:${s.kind ?? 'b'}:${s.id ?? '-'}:${s.root.visible ? 'v' : 'h'}`).join(' '));
  await page.screenshot({ path: `${D}/${prefix}-f${f}.png` });
  console.log(f, slots);
}
await browser.close();
