import { chromium } from 'playwright';
const [port] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__advance(1535 - window.__demoFrame, false));
const rows = [];
for (let i = 0; i < 45; i++) {
  rows.push(await page.evaluate(() => {
    window.__advance(1, true);
    const hud = document.getElementById('hud');
    const end = document.getElementById('demo-end');
    const bar = hud.querySelector('.hud-bar');
    const vis = getComputedStyle(hud).display !== 'none';
    return `${window.__demoFrame}:${vis ? (+getComputedStyle(hud).opacity).toFixed(2) : 'hidden'}/${(+getComputedStyle(end).opacity).toFixed(2)}${bar.getBoundingClientRect().height ? '' : '!'}`;
  }));
}
console.log(rows.join(' '));
await browser.close();
