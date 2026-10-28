// Walkthrough: title (Free flight button), F into flight and Esc back, a catch game with inputs, the deterministic
// demo against the node runner, the embed quick-start and touch sticks, and a tall phone layout.
// Usage: node ff-walk.mjs <base>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { createDemoRunner } from '/Users/vsendilraj/dev/scratch/catch-the-ship-flight/src/demo.js';
const [base] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const out = {};
const errors = [];
const watch = (page, tag) => {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`${tag}: ${m.text()}`));
};
const shot = (page, name) => page.screenshot({ path: `${D}/ff-walk-${name}.png`, timeout: 180000 });
const vis = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none'; }, sel);

// 1. Desktop: title, F into free flight, Esc back, then the catch game.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, 'desktop');
  await page.goto(`${base}/`, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await shot(page, '1-title');
  out.titleButtons = await page.$$eval('#title-screen .title-actions > *', (els) => els.map((e) => e.textContent.trim()));
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1500);
  out.flightFromF = { flightMode: await page.evaluate(() => document.body.classList.contains('flight-mode')), title: await vis(page, '#title-screen'), sticks: await vis(page, '#sticks') };
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  await shot(page, '2-flight-live');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  out.backHome = { flightMode: await page.evaluate(() => document.body.classList.contains('flight-mode')), title: await vis(page, '#title-screen'), flightGroupVisible: await page.evaluate(() => window.__view.scene.getObjectByName('free-flight')?.visible), near: await page.evaluate(() => window.__view.camera.near), fog: await page.evaluate(() => window.__view.scene.fog.density) };
  await shot(page, '3-title-after-flight');
  await page.click('#play');
  await page.waitForTimeout(2500);
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(700);
  await page.keyboard.up('ArrowRight');
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(500);
  await page.keyboard.up('ArrowUp');
  await page.waitForTimeout(1200);
  await shot(page, '4-catch-playing');
  out.catchState = await page.evaluate(() => ({ phase: window.__game.phase, round: window.__game.round, boosters: window.__game.boosters.map((b) => b.state), flightMode: document.body.classList.contains('flight-mode') }));
  await page.waitForTimeout(6000);
  await shot(page, '5-catch-later');
  await page.close();
}

// 2. The demo in the browser must match the node runner exactly.
{
  const r = createDemoRunner();
  while (!r.done) r.step();
  out.demoNode = { score: r.game.score, frame: r.frame, stats: r.game.stats };
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  watch(page, 'demo');
  await page.goto(`${base}/?demo=1&capture=1`, { timeout: 120000 });
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  await page.evaluate(() => window.__advance(900, false));
  await page.evaluate(() => window.__advance(1, true));
  await shot(page, '6-demo-f901');
  out.demoBrowser = await page.evaluate(() => {
    let guard = 0;
    while (!window.__demoDone && guard++ < 10000) window.__advance(1, false);
    window.__advance(1, true);
    return window.__demoInfo;
  });
  await page.close();
}

// 3. Embed: quick start with Free flight, then the touch sticks light the engines.
{
  const page = await browser.newPage({ viewport: { width: 480, height: 480 }, hasTouch: true });
  watch(page, 'embed');
  await page.goto(`${base}/embed/`, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await shot(page, '7-embed-quick');
  out.quickButtons = await page.$$eval('#quick-start button', (els) => els.map((e) => e.textContent.trim()));
  out.quickFits = await page.evaluate(() => { const r = document.querySelector('.quick-card').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
  await page.click('#quick-flight');
  await page.waitForTimeout(1200);
  const stick = await page.$('.stick[data-stick="l"]');
  const b = await stick.boundingBox();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - b.height * 0.45, { steps: 6 });
  await page.waitForTimeout(3500);
  out.stickFlight = await page.evaluate(() => { const f = window.__flightSim; return f && { phase: f.phase, airborne: f.airborne, throttle: +f.throttle.toFixed(2), y: +f.lowY.toFixed(1) }; });
  await shot(page, '8-embed-stick-liftoff');
  await page.mouse.up();
  out.embedHud = await page.evaluate(() => {
    const hud = document.querySelector('.hud-bar').getBoundingClientRect();
    const sticks = [...document.querySelectorAll('.stick')].map((s) => s.getBoundingClientRect());
    return { hudBottom: hud.bottom, stickTops: sticks.map((s) => Math.round(s.top)), overlap: sticks.some((s) => s.top < hud.bottom) };
  });
  await page.close();
}

// 4. A tall phone sheet: sticks above the bottom 30%, HUD on top.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  watch(page, 'phone');
  await page.goto(`${base}/embed/?mode=flight`, { timeout: 120000 });
  await page.waitForTimeout(5000);
  await shot(page, '9-phone-flight');
  out.phone = await page.evaluate(() => {
    const sticks = [...document.querySelectorAll('.stick')].map((s) => s.getBoundingClientRect());
    return { stickBottoms: sticks.map((s) => Math.round(s.bottom)), aboveSheet: sticks.every((s) => s.bottom <= innerHeight * 0.7 + 1), body: document.body.className };
  });
  await page.close();
}

console.log(JSON.stringify(out, null, 1));
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
