// Real-time round trip with the keyboard: title -> Free flight -> fly it into the ground -> mission report ->
// Fly again -> Start mission -> the catch game plays as before.
// Usage: node flight-orbit-roundtrip.mjs <base-url>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base] = process.argv.slice(2);
const DIR = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && console.log(m.type(), m.text().slice(0, 300)));
const flight = () => page.evaluate(() => {
  const f = window.__flight;
  return f && { phase: f.phase, t: +f.t.toFixed(2), mode: f.ship.mode, ang: +f.booster.ang.toFixed(3), thr: +f.throttle.toFixed(2), alt: Math.round(Math.hypot(f.booster.x - 18.75, f.booster.y + 1e5) - 1e5) };
});
const visible = (sel) => page.evaluate((s) => !document.querySelector(s).classList.contains('hidden'), sel);

await page.goto(base, { timeout: 120000 });
await page.waitForTimeout(3000);
await page.click('#fly');
await page.waitForTimeout(500);
console.log('after Free flight click', JSON.stringify(await flight()), 'body.free-flight', await page.evaluate(() => document.body.classList.contains('free-flight')));
await page.keyboard.press('Space');
await page.waitForTimeout(3000);
console.log('3 s after Space', JSON.stringify(await flight()));
await page.keyboard.down('ArrowLeft');
await page.waitForTimeout(1500);
await page.keyboard.up('ArrowLeft');
console.log('after 1.5 s of left', JSON.stringify(await flight()));
await page.waitForTimeout(1000);
console.log('1 s after release (attitude hold)', JSON.stringify(await flight()));
await page.keyboard.down('ArrowDown');
await page.waitForTimeout(2500);
await page.keyboard.up('ArrowDown');
console.log('after 2.5 s of down', JSON.stringify(await flight()));
await page.waitForFunction(() => !document.querySelector('#flight-over').classList.contains('hidden'), null, { timeout: 120000, polling: 250 });
console.log('report shown', JSON.stringify(await flight()), 'title:', await page.textContent('#fo-title'), '|', await page.textContent('#fo-lede'));
await page.screenshot({ path: `${DIR}/flight-orbit-crash-report.jpg`, type: 'jpeg', quality: 85 });
await page.click('#fo-again');
await page.waitForTimeout(800);
console.log('after Fly again: title shown', await visible('#title-screen'), 'report hidden', !(await visible('#flight-over')), 'flight', JSON.stringify(await flight()), 'body.free-flight', await page.evaluate(() => document.body.classList.contains('free-flight')));
await page.click('#play');
await page.waitForTimeout(4500);
console.log('catch game', JSON.stringify(await page.evaluate(() => ({ boosters: window.__game.boosters.length, y: Math.round(window.__game.boosters[0]?.y ?? -1), score: window.__game.score }))));
await page.screenshot({ path: `${DIR}/flight-orbit-roundtrip-catch.jpg`, type: 'jpeg', quality: 85 });
await browser.close();
