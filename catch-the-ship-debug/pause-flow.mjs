// Clicks through the pause menu at three sizes and checks the sim freezes while paused.
// Usage: node pause-flow.mjs <base url> <out dir>
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const cases = [
  { name: 'desktop', path: '/', w: 1280, h: 720, touch: false },
  { name: 'embed480', path: '/embed/', w: 480, h: 480, touch: false },
  { name: 'phone', path: '/', w: 390, h: 844, touch: true },
];
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok' : 'FAIL'} - ${msg}`); if (!ok) fails.push(msg); };
const visible = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return !e.classList.contains('hidden') && getComputedStyle(e).display !== 'none' && r.width > 0; });
const simT = (page) => page.evaluate(() => window.__game.time ?? window.__game.t ?? window.__game.frame ?? JSON.stringify(window.__game.activeBooster()?.y));

for (const c of cases) {
  const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, hasTouch: c.touch, isMobile: c.touch, deviceScaleFactor: c.touch ? 3 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`${c.name} pageerror ${e.message}`));
  await page.goto(base + c.path);
  await page.waitForTimeout(1500);
  await page.click(c.path === '/embed/' ? '#quick-play' : '#play');
  await page.waitForTimeout(1500);
  check(await visible(page, '#pause-btn'), `${c.name}: pause button shows in flight`);
  const btn = await page.$eval('#pause-btn', (e) => e.getBoundingClientRect().toJSON());
  check(btn.bottom <= c.h && btn.right <= c.w && btn.top >= 0, `${c.name}: pause button on screen ${JSON.stringify(btn)}`);
  if (c.touch) check(btn.bottom < c.h * 0.7, `${c.name}: pause button clear of the bottom 30%`);
  await page.screenshot({ path: `${out}/${c.name}-flight.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });

  await page.click('#pause-btn');
  await page.waitForTimeout(300);
  check(await visible(page, '#pause'), `${c.name}: pause card opens`);
  const t0 = await simT(page);
  await page.waitForTimeout(800);
  const t1 = await simT(page);
  check(t0 === t1, `${c.name}: sim frozen while paused (${t0} → ${t1})`);
  const card = await page.$eval('#pause .card', (e) => e.getBoundingClientRect().toJSON());
  check(card.bottom <= c.h && card.top >= 0, `${c.name}: pause card fits`);
  if (c.touch) check(card.bottom <= c.h * 0.7 + 1, `${c.name}: pause card above the bottom 30%`);
  check(!(await visible(page, '#touch')), `${c.name}: touch buttons hidden while paused`);
  await page.screenshot({ path: `${out}/${c.name}-paused.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });

  await page.click('#resume');
  await page.waitForTimeout(600);
  const t2 = await simT(page);
  check(!(await visible(page, '#pause')) && t2 !== t1, `${c.name}: resume closes the card and the sim runs`);

  console.log(`  ${c.name}: state before keys ${await page.evaluate(() => [window.__game.lives, window.__game.t.toFixed(1)].join(' '))}`);
  if (!c.touch) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(await visible(page, '#pause'), `${c.name}: Esc pauses`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    check(!(await visible(page, '#pause')), `${c.name}: Esc resumes`);
  }

  await page.click('#pause-btn');
  await page.click('#restart');
  await page.waitForTimeout(400);
  check(!(await visible(page, '#pause')) && (await page.evaluate(() => window.__game.score === 0)), `${c.name}: restart starts a fresh run`);

  await page.click('#pause-btn');
  await page.click('#home');
  await page.waitForTimeout(400);
  const title = c.path === '/embed/' ? '#quick-start' : '#title-screen';
  check((await visible(page, title)) && !(await visible(page, '#pause-btn')), `${c.name}: home returns to the title`);
  await page.screenshot({ path: `${out}/${c.name}-home.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `${fails.length} failed` : 'all passed');
process.exit(fails.length ? 1 : 0);
