// Highlights clip of the scripted free flight, frame-stepped like scripts/record.mjs: each video frame advances the
// sim two 1/60 s steps, so the clip plays at real speed at 30 fps. Only the listed windows (real seconds) are kept.
// Usage: node flight-orbit-clip.mjs <base-url> [size, e.g. 1080x1080] [out.mp4]
import { spawn } from 'node:child_process';
import ffmpegPath from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/ffmpeg-static/index.js';
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, size = '1080x1080', out = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug/flight-orbit-clip.mp4'] = process.argv.slice(2);
const [W, H] = size.split('x').map(Number);
const WINDOWS = [
  [1, 5.5], // ignition and liftoff
  [44.5, 48.5], // hot staging
  [83, 89], // orbit and the first deploys
  [124.5, 127.5], // the tower catches the booster
  [186, 190], // reentry
  [248.5, 255], // flip, landing burn and touchdown
];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?flight=1&capture=1`, { timeout: 120000 });
await page.waitForFunction(() => window.__flightReady === true, null, { timeout: 120000 });

const ff = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'png', '-i', '-',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
const done = new Promise((ok, fail) => ff.on('close', (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));
let frames = 0;
for (const [a, b] of WINDOWS) {
  await page.evaluate((t) => { while (window.__flight.real < t) window.__advance(1, false); }, a);
  for (;;) {
    const r = await page.evaluate(() => window.__advance(2, true));
    const png = await page.screenshot({ type: 'png' });
    if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once('drain', ok));
    frames++;
    if (r.real >= b || r.done) break;
  }
  console.log(`window ${a}-${b}: ${frames} frames so far`);
}
ff.stdin.end();
await done;
await browser.close();
console.log(out, `${frames} frames, ${(frames / 30).toFixed(1)} s`);
