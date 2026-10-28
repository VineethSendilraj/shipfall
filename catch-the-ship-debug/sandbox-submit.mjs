// Plays /embed/ inside an iframe sandboxed like X's player frame, reaches game over and submits a handle.
// Usage: node sandbox-submit.mjs <origin> <tag> <enter|click>
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [origin, tag, mode] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const SANDBOX = 'allow-popups allow-same-origin allow-scripts allow-presentation';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 600 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
const board = Array.from({ length: 40 }, (_, i) => ({ handle: `pilot_${i}`, score: 9840 - i * 160 }));
const view = (list, handle) => {
  const ranked = list.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = handle ? ranked.find((e) => e.handle === handle) : null;
  return { entries: ranked.slice(0, 10), total: ranked.length, me, around: me ? ranked.slice(Math.max(0, me.rank - 2), me.rank + 1) : undefined };
};
let posts = 0;
await page.route('**/api/leaderboard**', async (route) => {
  const req = route.request();
  if (req.method() !== 'POST') return route.fulfill({ json: view(board) });
  posts++;
  const b = JSON.parse(req.postData());
  const v = view([...board, { handle: b.handle, score: b.score }].sort((x, y) => y.score - x.score), b.handle);
  await route.fulfill({ json: { rank: v.me.rank, best: b.score, ...v } });
});
await page.goto(`${origin}/`, { timeout: 120000 });
await page.setContent(`<iframe id="f" sandbox="${SANDBOX}" src="${origin}/embed/" width="480" height="480" style="border:0"></iframe>`);
const frameEl = await page.waitForSelector('#f');
const frame = await frameEl.contentFrame();
await frame.waitForFunction(() => !!window.__game, null, { timeout: 120000 });
const sandboxed = await page.evaluate(() => document.getElementById('f').sandbox.value);
await frame.click('#quick-play');
await frame.evaluate(() => { const g = window.__game; g.stats.catches = 3; g.stats.perfects = 1; g.score = 5600; g.lives = 1; });
await frame.waitForSelector('#gameover:not(.hidden)', { timeout: 150000 });
await frame.waitForTimeout(800);
await frame.fill('#initials', 'sandbox_test');
if (mode === 'enter') await frame.press('#initials', 'Enter');
else await frame.click('#initials-form button[type=submit]');
await frame.waitForTimeout(1500);
const note = await frame.textContent('#initials-note');
const me = await frame.$$eval('#board-over li.me', (lis) => lis.map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
const url = frame.url();
await page.screenshot({ path: `${D}/sandbox-${tag}-${mode}.jpg`, type: 'jpeg', quality: 85 });
console.log(JSON.stringify({ tag, mode, sandboxed, posts, note, me, frameUrl: url }));
await browser.close();
