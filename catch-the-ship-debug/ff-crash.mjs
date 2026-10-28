// Crash sequence only: fly into tower A (or the ground with CRASH=ground) and screenshot the explosion over time.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [base, tag, w, h, embed] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const pilotSrc = readFileSync('/Users/vsendilraj/dev/scratch/catch-the-ship-flight/scripts/flight-pilot.mjs', 'utf8').replace(/export function/g, 'function');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: !!embed });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}${embed ? '/embed/' : '/'}?mode=flight&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 60000 });
await page.addScriptTag({ content: `${pilotSrc}\nwindow.__pilot = pilot;` });
const run = (fnSrc, frames, untilSrc = null) => page.evaluate(([fnSrc, frames, untilSrc]) => window.__flight.run(new Function('f', `return (${fnSrc});`), frames, untilSrc ? new Function('f', `return (${untilSrc});`) : null), [fnSrc, frames, untilSrc]);
const shot = async (name) => { await page.waitForTimeout(120); await page.screenshot({ path: `${D}/ff-${tag}-${name}.png` }); };
await run('({ climb: 1 })', 60 * 4);
if (process.env.CRASH === 'ground') {
  await run("window.__pilot(f, { x: 120, z: 200, alt: 60 })", 60 * 12);
  await run("({ climb: -1, fwd: 1 })", 60 * 30, "f.phase !== 'flying'");
} else {
  await run('({ climb: f.lowY < 90 ? 0.6 : 0, yaw: 1 })', 60 * 8, 'f.yaw < -Math.PI / 2 + 0.02');
  await run("window.__pilot(f, { x: 60, z: 0, alt: 95, yawTo: -Math.PI / 2 })", 60 * 60, "f.phase !== 'flying'");
}
const info = await page.evaluate(() => ({ ...window.__flight.flight.result, impact: window.__flight.flight.impact }));
console.log(JSON.stringify(info));
for (const [n, frames] of [['a', 10], ['b', 20], ['c', 30], ['d', 60], ['e', 90]]) {
  await run('({})', frames);
  await shot(`crash-${n}`);
}
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
