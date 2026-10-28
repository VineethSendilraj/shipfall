// Turntable clip of explore mode (headless, frame-stepped like the repo's scripts/record.mjs): 30 fps, each video
// frame two 1/60 s Explore steps, piped as PNG screenshots into ffmpeg.
// Usage: node explore-clip.mjs <base-url> [size] [seconds] [out.mp4]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
import ffmpegPath from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/ffmpeg-static/index.js';
import { spawn } from 'node:child_process';

const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const [base = 'http://127.0.0.1:41830', size = '1080', secs = '15', out = `${D}/explore-turntable.mp4`] = process.argv.slice(2);
const S = Number(size);
const FPS = 30;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: S, height: S } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.addInitScript(() => {
  const raf = window.requestAnimationFrame.bind(window);
  window.__hold = false;
  const wrap = (cb) => raf((t) => (window.__hold ? wrap(cb) : cb(t)));
  window.requestAnimationFrame = wrap;
});
await page.goto(`${base}/?explore=1&quality=high`, { timeout: 120000 });
await page.waitForFunction(() => window.__explore?.shapes?.length && !window.__explore.flight, null, { polling: 100, timeout: 120000 });
// The first-entry hint fades after 6 s.
await page.waitForTimeout(7000);
await page.evaluate(() => {
  window.__hold = true;
  window.__explore.idle = 9;
});
const ff = spawn(
  ffmpegPath,
  ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', '-',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', out],
  { stdio: ['pipe', 'inherit', 'inherit'] },
);
const t0 = Date.now();
for (let i = 0; i < FPS * Number(secs); i++) {
  const st = await page.evaluate(() => {
    const e = window.__explore;
    e.frame(1 / 60);
    e.frame(1 / 60);
    return { auto: e.controls.autoRotate, q: window.__quality.level };
  });
  if (i % 90 === 0) console.log(`frame ${i}`, JSON.stringify(st));
  ff.stdin.write(await page.screenshot({ type: 'png' }));
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
console.log(`wrote ${out} in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
await browser.close();
