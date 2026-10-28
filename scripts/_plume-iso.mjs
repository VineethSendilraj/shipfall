import { chromium } from 'playwright';
const [port, tag, hide] = process.argv.slice(2);
const dir = process.env.HOME + '/dev/scratch/catch-the-ship-plume-shots';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`http://localhost:${port}/?demo=1&capture=1`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 120000 });
await page.evaluate(() => window.__advance(360 - window.__demoFrame, true));
await page.evaluate((hide) => {
  const v = window.__view;
  const H = hide.split(',');
  const g = v.pool[0].plume.group;
  if (H.includes('outer')) g.children[0].material.uniforms.uAmp.value = 0;
  if (H.includes('mid')) g.children[1].material.uniforms.uAmp.value = 0;
  if (H.includes('parts')) v.particles.group.visible = false;
  if (H.includes('haze')) { v.final.uniforms.uHaze.value.z = 0; v.final.uniforms.uHaze2.value.z = 0; }
  if (H.includes('bloom')) v.bloom.enabled = false;
  v.composer.render();
}, hide);
await page.screenshot({ path: `${dir}/${tag}.jpg`, type: 'jpeg', quality: 90, clip: { x: 440, y: 400, width: 400, height: 320 }, timeout: 120000 });
await browser.close();
