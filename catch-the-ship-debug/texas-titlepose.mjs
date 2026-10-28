// Title screen (card visible) drawn from fixed camera poses, to compose an establishing shot.
// Usage: node texas-titlepose.mjs <base> <w> <h> <embed|full> <prefix> <poses "x,y,z>tx,ty,tz@fov;..."> [query]
// Prints where tower A's top and foot land on screen for each pose.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, w, h, kind, prefix, poses, q = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}${kind === 'embed' ? '/embed/' : '/'}${q ? `?${q}` : ''}`);
await page.waitForFunction(() => !!window.__view, null, { timeout: 60000 });
await page.waitForTimeout(2500);
let i = 0;
for (const p of poses.split(';')) {
  const [pos, rest] = p.split('>');
  const [tgt, fov = '40'] = rest.split('@');
  const info = await page.evaluate(
    async ({ pos, tgt, fov }) => {
      const v = window.__view;
      v.director.apply = (camera) => {
        camera.position.set(...pos);
        camera.lookAt(...tgt);
        camera.fov = fov;
        camera.updateProjectionMatrix();
      };
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const tx = window.__game.towers[0].x;
      const top = v.project(tx, 96);
      const foot = v.project(tx, 690);
      return { top: [Math.round(top.x), Math.round(top.y)], foot: [Math.round(foot.x), Math.round(foot.y)] };
    },
    { pos: pos.split(',').map(Number), tgt: tgt.split(',').map(Number), fov: Number(fov) },
  );
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${prefix}-p${i}.jpg`, type: 'jpeg', quality: 85 });
  console.log(`p${i} ${p} tower top ${info.top} foot ${info.foot}`);
  i++;
}
await browser.close();
