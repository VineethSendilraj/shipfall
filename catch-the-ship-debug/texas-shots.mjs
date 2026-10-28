// Real-GPU screenshots for the Starbase day map: title card, then showcase frames (?demo=1&capture=1),
// and optional fixed camera poses ("x,y,z>tx,ty,tz@fov" with ';' between poses) drawn at one demo frame.
// Usage: node texas-shots.mjs <base> <w> <h> <prefix> [framesCsv] [extraQuery] [poses] [poseFrame] [embed]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, prefix, framesCsv = '', extra = '', poses = '', poseFrame = '200', embed = ''] = process.argv.slice(2);
const frames = framesCsv ? framesCsv.split(',').filter(Boolean).map(Number).sort((a, b) => a - b) : [];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && console.log(`console.${m.type()}:`, m.text()));
const path = embed ? '/embed/' : '/';
const q = extra.replace(/^&/, '');
if (!frames.length && !poses) {
  await page.goto(`${base}${path}${q ? `?${q}` : ''}`);
  await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${prefix}-title.jpg`, type: 'jpeg', quality: 90 });
}
const seek = async (f) => {
  const cur = await page.evaluate(() => window.__demoFrame);
  if (f - cur > 3) await page.evaluate((n) => window.__advance(n, false), f - cur - 3);
  while ((await page.evaluate(() => window.__demoFrame)) < f) await page.evaluate(() => window.__advance(1, true));
};
if (frames.length || poses) {
  await page.goto(`${base}${path}?demo=1&capture=1${q ? `&${q}` : ''}`);
  await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
  for (const f of frames) {
    await seek(f);
    await page.screenshot({ path: `${prefix}-f${f}.jpg`, type: 'jpeg', quality: 90 });
  }
  if (poses) {
    await seek(Number(poseFrame));
    // TWEAK='js': runs in the page before the poses (A/B a suspected cause).
    if (process.env.TWEAK) await page.evaluate(process.env.TWEAK);
    await page.addStyleTag({ content: '#hud, .overlay, .disclaimer, #sound, .demo-card, #banner, #popups, #toast, #touch { visibility: hidden !important; }' });
    let i = 0;
    for (const p of poses.split(';')) {
      const [pos, rest] = p.split('>');
      const [tgt, fov = '40'] = rest.split('@');
      await page.evaluate(
        ({ pos, tgt, fov }) => {
          const v = window.__view;
          v.director.apply = (camera) => {
            camera.position.set(...pos);
            camera.lookAt(...tgt);
            camera.fov = fov;
            camera.updateProjectionMatrix();
          };
          window.__advance(0, true);
        },
        { pos: pos.split(',').map(Number), tgt: tgt.split(',').map(Number), fov: Number(fov) },
      );
      await page.screenshot({ path: `${prefix}-pose${i++}.jpg`, type: 'jpeg', quality: 90 });
    }
  }
}
await browser.close();
