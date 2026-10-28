import { chromium } from 'playwright';
const [port, tag, query = ''] = process.argv.slice(2);
const dir = process.env.HOME + '/dev/scratch/catch-the-ship-plume-shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?demo=1&capture=1${query}`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
for (const [f, clip] of [[360, { x: 440, y: 400, width: 400, height: 320 }], [1450, { x: 440, y: 300, width: 400, height: 380 }]]) {
  await page.evaluate((f) => window.__advance(f - window.__demoFrame, true), f);
  const info = await page.evaluate(() => window.__view.pool.filter((s) => s.plume.group.visible).map((s) => ({ kind: s.kind, sy: s.plume.group.children.map((m) => +m.scale.y.toFixed(1)), sx: +s.plume.group.children[0].scale.x.toFixed(2), splash: s.plume.group.children[3]?.visible })));
  console.log(f, JSON.stringify(info));
  await page.screenshot({ path: `${dir}/${tag}-crop${query.replace(/[&=]/g, '')}-${f}.jpg`, type: 'jpeg', quality: 90, clip, timeout: 120000 });
}
await browser.close();
