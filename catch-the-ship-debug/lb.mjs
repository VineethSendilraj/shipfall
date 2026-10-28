import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';
const [url = 'http://127.0.0.1:41730/', tag = 'desk', w = '1280', h = '720', play = '#play'] = process.argv.slice(2);
const names = ['orbitalsam', 'hotstage', 'chopsticks_fan', 'tankfarm', 'ringweld', 'gridfin', 'raptorvac', 'deluge', 'olm_crew', 'qd_arm', 'bellyflop', 'methalox'];
const board = Array.from({ length: 40 }, (_, i) => ({ handle: i < names.length ? names[i] : `pilot_${i}`, score: Math.round(9840 - i * 160) }));
const view = (list, handle) => {
  const ranked = list.map((e, i) => ({ ...e, rank: i + 1 }));
  const me = handle ? ranked.find((e) => e.handle.toLowerCase() === handle.toLowerCase()) : null;
  return { entries: ranked.slice(0, 10), total: ranked.length, me, around: me ? ranked.slice(Math.max(0, me.rank - 2), me.rank + 1) : undefined };
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) }, hasTouch: Number(w) <= 480 });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.route('**/api/leaderboard**', async (route) => {
  const req = route.request();
  if (req.method() === 'POST') {
    const b = JSON.parse(req.postData());
    const list = [...board, { handle: b.handle, score: b.score }].sort((x, y) => y.score - x.score);
    const v = view(list, b.handle);
    await route.fulfill({ json: { rank: v.me.rank, best: b.score, ...v } });
  } else await route.fulfill({ json: view(board, new URL(req.url()).searchParams.get('handle')) });
});
await page.goto(url);
await page.waitForTimeout(1500);
if (play === '#play') await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/lb-title-${tag}.jpg`, type: 'jpeg', quality: 85 });
await page.click(play);
await page.waitForTimeout(500);
await page.evaluate(() => { const g = window.__game; g.stats.catches = 3; g.stats.perfects = 1; g.score = 5600; });
await page.waitForSelector('#gameover:not(.hidden)', { timeout: 150000 });
await page.waitForTimeout(1200);
await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/lb-over-${tag}.jpg`, type: 'jpeg', quality: 85 });
await page.fill('#initials', '@vineeth_test');
await page.click('#initials-form button[type=submit]');
await page.waitForTimeout(800);
await page.screenshot({ path: `/Users/vsendilraj/dev/scratch/catch-the-ship-debug/lb-done-${tag}.jpg`, type: 'jpeg', quality: 85 });
console.log(tag, 'note:', await page.textContent('#initials-note'), '| share:', decodeURIComponent((await page.getAttribute('#share', 'href')).split('text=')[1].split('&')[0]));
await browser.close();
