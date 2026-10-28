// Measures how long the demo takes to start stepping after navigation (demo frame counter > 0), and the
// model fetch timings, for a given base URL.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const base = process.argv[2] ?? 'http://127.0.0.1:41740';
const runs = Number(process.argv[3] ?? 3);
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--use-angle=metal'] });
for (let i = 0; i < runs; i++) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => m.type() !== 'debug' && console.log(`  console.${m.type()}:`, m.text()));
  const t0 = Date.now();
  await page.goto(`${base}/?demo=1`);
  await page.waitForFunction(() => (window.__demoFrame ?? 0) > 1, null, { timeout: 20000, polling: 20 });
  const started = Date.now() - t0;
  const timing = await page.evaluate(() =>
    performance
      .getEntriesByType('resource')
      .filter((e) => /\/models\/|meshopt|GLTFLoader/.test(e.name))
      .map((e) => `${e.name.split('/').pop()} start ${e.startTime.toFixed(0)} dur ${e.duration.toFixed(0)} ms`),
  );
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType('navigation')[0];
    return `domContentLoaded ${n.domContentLoadedEventEnd.toFixed(0)} ms, load ${n.loadEventEnd.toFixed(0)} ms`;
  });
  console.log(`run ${i + 1}: demo stepping ${started} ms after goto; ${nav}`);
  for (const t of timing) console.log('   ', t);
  await page.close();
}
await browser.close();
