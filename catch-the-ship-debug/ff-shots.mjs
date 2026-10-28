// Scripted free flights through window.__flight (deterministic), screenshotting every state.
// Usage: node ff-shots.mjs <base url> <tag> <w> <h> [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const [base, tag, w, h, embed] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const pilotSrc = readFileSync('/Users/vsendilraj/dev/scratch/catch-the-ship-flight/scripts/flight-pilot.mjs', 'utf8').replace(/export function/g, 'function');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: !!embed });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const url = `${base}${embed ? '/embed/' : '/'}?mode=flight&capture=1`;
await page.goto(url, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 60000 });
await page.addScriptTag({ content: `${pilotSrc}\nwindow.__pilot = pilot;` });
const shot = async (name) => {
  await page.waitForTimeout(150);
  await page.screenshot({ path: `${D}/ff-${tag}-${name}.png`, timeout: 180000 });
  const s = await page.evaluate(() => {
    const f = window.__flight.flight;
    return { frame: f.frame, phase: f.phase, y: +f.lowY.toFixed(1), agl: +f.agl.toFixed(1), x: +f.base.x.toFixed(1), z: +f.base.z.toFixed(1), v: +Math.hypot(f.vel.x, f.vel.y, f.vel.z).toFixed(1), thr: +f.throttle.toFixed(2), fuel: +f.fuel.toFixed(1), yaw: +f.yaw.toFixed(2), fx: window.__flight.view.fx.count };
  });
  console.log(name, JSON.stringify(s));
};
const run = (fnSrc, frames, untilSrc = null) => page.evaluate(([fnSrc, frames, untilSrc]) => {
  const fn = new Function('f', `return (${fnSrc});`);
  const until = untilSrc ? new Function('f', `return (${untilSrc});`) : null;
  return window.__flight.run(fn, frames, until);
}, [fnSrc, frames, untilSrc]);

// 1. On the mount, engines off.
await run('({})', 40);
await shot('1-mount');
// 2. Liftoff: plume and steam.
await run('({ climb: 1 })', 105);
await shot('2-liftoff');
await run('({ climb: 1 })', 150);
await shot('2b-clear');
// 3. Turn toward +x and fly past tower A on its far side.
await run('({ climb: f.lowY < 75 ? 0.5 : 0, yaw: 1 })', 60 * 8, 'f.yaw < -Math.PI / 2 + 0.02');
await run("window.__pilot(f, { x: 40, z: -48, alt: 80, yawTo: -Math.PI / 2 })", 60 * 40, 'f.base.x > -12');
await shot('3-tower');
await run("window.__pilot(f, { x: 220, z: -48, alt: 80, yawTo: -Math.PI / 2 })", 60 * 3);
await shot('3b-tower-past');
// 4. High above the site.
await run("window.__pilot(f, { x: 260, z: -60, alt: 650, yawTo: Math.PI / 2 })", 60 * 60, 'f.lowY > 600 && Math.abs(f.yaw - Math.PI / 2) < 0.05');
await shot('4-high');
// 5. Back to the mount and down to the landing approach.
await run("window.__pilot(f, { x: f.mount.x, z: f.mount.z + 160, alt: 140, yawTo: 0 })", 60 * 90, 'Math.hypot(f.base.x - f.mount.x, f.base.z - f.mount.z - 160) < 8 && f.lowY < 150');
await run("window.__pilot(f, { x: f.mount.x, z: f.mount.z, alt: 85, yawTo: 0 })", 60 * 60, 'f.mountDist < 45');
await shot('5-approach');
await run("window.__pilot(f, { x: f.mount.x, z: f.mount.z, alt: 85, land: true })", 60 * 120, "f.phase !== 'flying'");
await shot('6-touchdown');
await run('({})', 60 * 4, "window.__flight.flight && document.getElementById('flight-over').classList.contains('hidden') === false");
await run('({})', 30);
await shot('7-landed-card');
// 8. Crash into the tower.
await page.evaluate(() => window.__flight.start());
await run('({ climb: 1 })', 60 * 4);
await run('({ climb: f.lowY < 90 ? 0.6 : 0, yaw: 1 })', 60 * 8, 'f.yaw < -Math.PI / 2 + 0.02');
await run("window.__pilot(f, { x: 60, z: 0, alt: 95, yawTo: -Math.PI / 2 })", 60 * 60, "f.phase !== 'flying'");
await run('({})', 24);
await shot('8-crash');
await run('({})', 60);
await shot('8b-crash-smoke');
await run('({})', 60 * 4, "document.getElementById('flight-over').classList.contains('hidden') === false");
await run('({})', 30);
await shot('9-crash-card');
console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
