// Which objects use the shader programs first compiled at a given showcase frame (capture mode).
// Usage: node texas-progs.mjs <base> <frame> [extraQuery]
import { chromium } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/playwright/index.mjs';

const [base, frame, extra = ''] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('pageerror:', e.message));
await page.goto(`${base}/?demo=1&capture=1${extra}`);
await page.waitForFunction(() => window.__demoReady === true, null, { timeout: 90000 });
const r = await page.evaluate((target) => {
  const v = window.__view;
  const info = v.renderer.info;
  while (window.__demoFrame < target - 1) window.__advance(1, true);
  const before = new Set(info.programs.map((p) => p.id));
  const t0 = performance.now();
  window.__advance(1, true);
  const ms = performance.now() - t0;
  const fresh = info.programs.filter((p) => !before.has(p.id)); const diffs = []; for (const m of new Set((() => { const a = []; v.scene.traverse((o) => [o.material].flat().forEach((x) => x && a.push(x))); return a; })())) { const pr = v.renderer.properties.get(m); const list = [...(pr.programs?.values() ?? [])]; if (list.length > 1 && list.some((p) => fresh.includes(p))) { const A = list[0].cacheKey.split(","), B = list.at(-1).cacheKey.split(","); const d = []; for (let i = 0; i < Math.max(A.length, B.length); i++) if (A[i] !== B[i]) d.push(i + ":" + A[i] + "->" + B[i]); diffs.push(m.type + (m.onBeforeCompile.toString().length > 30 ? "(custom)" : "") + " " + d.join(" ")); } } window.__diffs = [...new Set(diffs)];
  const users = Object.fromEntries(fresh.map((p) => [p.id, []]));
  const props = v.renderer.properties;
  v.scene.traverse((o) => {
    for (const m of [o.material].flat()) {
      if (!m) continue;
      const pr = props.get(m);
      for (const [, prog] of pr.programs ?? []) {
        if (users[prog.id]) users[prog.id].push(`${o.type}:${o.name || o.parent?.name || '?'} ${m.type}${m.name ? '(' + m.name + ')' : ''} vis=${o.visible}`);
      }
    }
  });
  return { diffs: window.__diffs,
    frame: window.__demoFrame,
    ms: +ms.toFixed(1),
    fresh: fresh.map((p) => ({ id: p.id, key: p.cacheKey.slice(0, 90), users: [...new Set(users[p.id])].slice(0, 6) })),
  };
}, +frame);
console.log(JSON.stringify({ base, ...r }, null, 1));
await browser.close();
