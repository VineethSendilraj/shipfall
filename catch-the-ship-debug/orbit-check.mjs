// Drags and zooms the camera in the catch game and free flight at three sizes. Usage: node orbit-check.mjs <base> <out>
import { chromium } from 'playwright';

const [base, out] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const fails = [];
const check = (ok, msg) => { console.log(`${ok ? 'ok' : 'FAIL'} - ${msg}`); if (!ok) fails.push(msg); };
const cam = (page) => page.evaluate(() => { const c = window.__view.camera; return [c.position.x, c.position.y, c.position.z]; });
const orbit = (page) => page.evaluate(() => { const o = window.__view.orbit; return { yaw: o.yaw, pitch: o.pitch, zoom: o.zoom }; });
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });

async function drag(page, c, dx, dy) {
  const x = c.w / 2, y = c.h * 0.4;
  if (c.touch) {
    const cdp = await page.context().newCDPSession(page);
    const pt = (px, py) => [{ x: px, y: py, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x, y) });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x + (dx * i) / 10, y + (dy * i) / 10) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 10 });
    await page.mouse.up();
  }
}

const cases = [
  { name: 'desktop', path: '/', w: 1280, h: 720, touch: false, play: '#play', fly: '#fly' },
  { name: 'embed480', path: '/embed/', w: 480, h: 480, touch: false, play: '#quick-play', fly: '#quick-fly' },
  { name: 'phone', path: '/', w: 390, h: 844, touch: true, play: '#play', fly: '#fly' },
];
for (const c of cases) {
  for (const mode of ['catch', 'flight']) {
    const ctx = await browser.newContext({ viewport: { width: c.w, height: c.h }, hasTouch: c.touch, isMobile: c.touch, deviceScaleFactor: c.touch ? 3 : 1 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push(`${c.name} ${mode} pageerror ${e.message}`));
    await page.goto(base + c.path);
    await page.waitForTimeout(1500);
    // Title screen: a drag must not move the orbit.
    await drag(page, c, 200, 0);
    check((await orbit(page)).yaw === 0, `${c.name} ${mode}: title screen ignores drags`);
    const btn = mode === 'catch' ? c.play : c.fly;
    if (!(await page.$(btn)) || !(await page.isVisible(btn))) { console.log(`  skip ${c.name} ${mode}: ${btn} not visible`); await ctx.close(); continue; }
    await page.click(btn);
    await page.waitForTimeout(2500);
    await shot(page, `${c.name}-${mode}-0`);
    await drag(page, c, -220, -60);
    await page.waitForTimeout(600);
    const o1 = await orbit(page);
    check(Math.abs(o1.yaw) > 0.8, `${c.name} ${mode}: drag orbits (yaw ${o1.yaw.toFixed(2)}, pitch ${o1.pitch.toFixed(2)})`);
    await shot(page, `${c.name}-${mode}-1-drag`);
    if (!c.touch) {
      await page.mouse.move(c.w / 2, c.h / 2);
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(600);
      const o2 = await orbit(page);
      check(o2.zoom > 1.5, `${c.name} ${mode}: wheel zooms out (${o2.zoom.toFixed(2)})`);
      await shot(page, `${c.name}-${mode}-2-zoom`);
      await page.mouse.dblclick(c.w / 2, c.h / 2);
      await page.waitForTimeout(800);
      const o3 = await orbit(page);
      check(Math.abs(o3.yaw) < 0.05 && Math.abs(o3.zoom - 1) < 0.05, `${c.name} ${mode}: double-click resets`);
    }
    if (mode === 'flight' && !c.touch) {
      await page.keyboard.press('Space');
      await page.waitForTimeout(9000);
      await drag(page, c, 260, 40);
      await page.waitForTimeout(700);
      await shot(page, `${c.name}-flight-3-ascent-drag`);
    }
    const p = await cam(page);
    check(p.every(Number.isFinite), `${c.name} ${mode}: camera finite`);
    if (mode === 'catch') check(p[1] >= 6.9, `${c.name} catch: camera above ground (y ${p[1].toFixed(1)})`);
    // Pausing blocks drags.
    await drag(page, c, 0, 0);
    await page.click('#pause-btn').catch(() => {});
    await page.waitForTimeout(300);
    if (await page.isVisible('#pause')) {
      const want = () => page.evaluate(() => window.__view.orbit.want.yaw);
      const before = await want();
      await page.dispatchEvent('#gl', 'pointerdown', { pointerId: 9, clientX: 100, clientY: 100, button: 0, pointerType: 'mouse' });
      await page.dispatchEvent('#gl', 'pointermove', { pointerId: 9, clientX: 300, clientY: 100, pointerType: 'mouse' });
      await page.dispatchEvent('#gl', 'pointerup', { pointerId: 9, pointerType: 'mouse' });
      check((await want()) === before, `${c.name} ${mode}: paused ignores drags`);
      await page.click('#resume');
    }
    if (c.touch && mode === 'catch') {
      const t = await page.isVisible('#touch');
      check(t, `${c.name}: touch buttons still shown`);
    }
    await ctx.close();
  }
}
// Explore keeps its own controls.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push(`explore pageerror ${e.message}`));
  await page.goto(base + '/?explore=1');
  await page.waitForTimeout(2500);
  const p0 = await cam(page);
  await drag(page, { w: 1280, h: 720 }, 200, 0);
  await page.waitForTimeout(500);
  const p1 = await cam(page);
  check((await orbit(page)).yaw === 0, 'explore: game orbit untouched');
  check(Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 1, 'explore: its own drag still moves the camera');
  await ctx.close();
}
await browser.close();
console.log(fails.length ? `${fails.length} FAIL` : 'all ok');
process.exit(fails.length ? 1 : 0);
