// Title -> leaderboard -> keyboard checks -> flight -> game over -> submit handle -> leaderboard -> Fly again.
// Usage: node lb2.mjs <url> <tag> <w> <h> <playSelector>
// OFFLINE=1: the API answers 503, so boards fall back to this device. SLOWGET=<ms>: delays leaderboard reads.
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url, tag, w, h, play] = process.argv.slice(2);
const D = '/Users/vsendilraj/dev/scratch/catch-the-ship-debug';
const names = ['orbitalsam', 'hotstage', 'chopsticks_fan', 'tankfarm', 'ringweld', 'gridfin', 'raptorvac', 'deluge', 'olm_crew', 'qd_arm', 'bellyflop', 'methalox'];
const board = Array.from({ length: 40 }, (_, i) => ({ handle: i < names.length ? names[i] : `pilot_${i}`, score: Math.round(9840 - i * 160) }));
const view = (list, handle) => {
  const ranked = list.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = handle ? ranked.find((e) => e.handle.toLowerCase() === handle.toLowerCase()) : null;
  return { entries: ranked.slice(0, 10), total: ranked.length, me, around: me ? ranked.slice(Math.max(0, me.rank - 2), me.rank + 1) : undefined };
};
let live = [...board];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, hasTouch: Number(w) <= 480 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.route('**/api/leaderboard**', async (route) => {
  const req = route.request();
  if (process.env.OFFLINE) return route.fulfill({ status: 503, json: { error: 'not configured' } });
  if (req.method() === 'POST') {
    const b = JSON.parse(req.postData());
    live = [...board, { handle: b.handle, score: b.score }].sort((x, y) => y.score - x.score);
    const v = view(live, b.handle);
    await route.fulfill({ json: { rank: v.me.rank, best: b.score, ...v } });
  } else {
    // Built before the delay, so a slow read returns the board as it was when the read started.
    const body = view(live, new URL(req.url()).searchParams.get('handle'));
    if (process.env.SLOWGET) await new Promise((r) => setTimeout(r, Number(process.env.SLOWGET)));
    await route.fulfill({ json: body });
  }
});
const shot = (name) => page.screenshot({ path: `${D}/lb2-${tag}-${name}.jpg`, type: 'jpeg', quality: 85 });
const layout = () =>
  page.evaluate(() => {
    const card = document.querySelector('#gameover .card');
    const c = card.getBoundingClientRect();
    const a = document.getElementById('again').getBoundingClientRect();
    const s = document.getElementById('sound').getBoundingClientRect();
    return {
      boardShown: !document.getElementById('board-over').parentElement.classList.contains('hidden'),
      rows: document.querySelectorAll('#board-over li').length,
      cardScrolls: card.scrollHeight > card.clientHeight + 1,
      againOnScreen: a.top >= Math.max(0, c.top) && a.bottom <= Math.min(innerHeight, c.bottom),
      soundClear: !s.width || s.top >= c.bottom || s.left >= c.right || s.bottom <= c.top || s.right <= c.left,
    };
  });
const vis = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return !!el && !el.classList.contains('hidden'); }, sel);
const title = play === '#play' ? '#title-screen' : '#quick-start';
await page.goto(url, { timeout: 120000 });
await page.waitForTimeout(1500);
await shot('1-title');
await page.click(`${title} .open-board`);
await page.waitForTimeout(400);
await shot('2-board-from-title');
await page.keyboard.press('Escape');
await page.waitForTimeout(100);
const afterEsc = { board: await vis('#leaderboard'), focus: await page.evaluate(() => document.activeElement?.textContent.trim()) };
await page.keyboard.press('Enter');
await page.waitForTimeout(200);
const enterOnFocusedButton = { board: await vis('#leaderboard'), title: await vis(title) };
await page.click('#board-back');
await page.click(play);
await page.waitForTimeout(500);
await page.evaluate(() => { const g = window.__game; g.stats.catches = 3; g.stats.perfects = 1; g.score = 5600; g.lives = 1; });
await page.waitForSelector('#gameover:not(.hidden)', { timeout: 150000 });
await page.waitForTimeout(1200);
await shot('3-gameover');
const before = await layout();
await page.fill('#initials', '@vineeth_test');
await page.click('#initials-form button[type=submit]');
await page.waitForTimeout(800 + Number(process.env.SLOWGET || 0));
const note = await page.textContent('#initials-note');
await shot('4-submitted');
const after = await layout();
const rows = await page.$$eval('#board-over li', (lis) => lis.map((li) => (li.classList.contains('me') ? '*' : '') + li.textContent.replace(/\s+/g, ' ').trim()));
const overButtons = await page.$$eval('#gameover .actions > *', (els) => els.map((e) => e.textContent.trim()));
await page.click('#again');
await page.waitForTimeout(300);
const flyAgain = { title: await vis(title), over: await vis('#gameover') };
await shot('6-after-fly-again');
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
const enterStarts = { titleHidden: !(await vis(title)), playing: await page.evaluate(() => document.body.classList.contains('playing')) };
console.log(JSON.stringify({ tag, afterEsc, enterOnFocusedButton, before, after, note, rows, overButtons, flyAgain, enterStarts }));
await browser.close();
