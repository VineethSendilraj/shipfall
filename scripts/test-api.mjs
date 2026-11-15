import assert from 'node:assert/strict';
import { GET, POST, checkRun, normalizeHandle } from '../api/leaderboard.js';

// In-memory stand-in for the Upstash REST pipeline endpoint.
function fakeUpstash() {
  const z = new Map();
  const h = new Map();
  const kv = new Map();
  const run = ([cmd, ...a]) => {
    switch (cmd) {
      case 'INCR': kv.set(a[0], (kv.get(a[0]) || 0) + 1); return kv.get(a[0]);
      case 'EXPIRE': return 1;
      case 'ZADD': {
        const [, , , score, member] = a;
        const prev = z.get(member);
        if (prev === undefined || score > prev) { z.set(member, score); return 1; }
        return 0;
      }
      case 'ZREVRANGE': {
        const sorted = [...z.entries()].sort((x, y) => y[1] - x[1]).slice(a[1], a[2] + 1);
        return sorted.flatMap(([m, s]) => [m, String(s)]);
      }
      case 'ZREVRANK': {
        const i = [...z.entries()].sort((x, y) => y[1] - x[1]).findIndex(([m]) => m === a[1]);
        return i < 0 ? null : i;
      }
      case 'ZCARD': return z.size;
      case 'ZSCORE': return String(z.get(a[1]));
      case 'HGET': return h.get(a[1]) ?? null;
      case 'HSET': h.set(a[1], a[2]); return 1;
      case 'HMGET': return a.slice(1).map((k) => h.get(k) ?? null);
      default: throw new Error(`unexpected ${cmd}`);
    }
  };
  return async (url, init) => ({ ok: true, json: async () => JSON.parse(init.body).map((c) => ({ result: run(c) })) });
}

const post = (body, ip = '1.2.3.4') =>
  POST(new Request('http://x/api/leaderboard', { method: 'POST', body: JSON.stringify(body), headers: { 'x-forwarded-for': ip } }));
const run = (score, catches = 3) => ({ score, catches, perfects: 1, rounds: 3 });

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

delete process.env.KV_REST_API_URL;
await test('unconfigured backend answers 503 so the game falls back to the local board', async () => {
  assert.equal((await GET()).status, 503);
});

process.env.KV_REST_API_URL = 'https://fake.upstash.io';
process.env.KV_REST_API_TOKEN = 't';
globalThis.fetch = fakeUpstash();

await test('handles follow X rules, with or without @', async () => {
  assert.equal(normalizeHandle('@cool_name1'), 'cool_name1');
  assert.equal(normalizeHandle('has space'), null);
  assert.equal(normalizeHandle('waytoolonghandle1'), null);
  assert.equal((await post({ handle: 'bad-handle!', ...run(3500) })).status, 400);
});

await test('scores the game cannot produce are rejected', async () => {
  assert.equal(checkRun(run(3500)), null);
  assert.ok(checkRun(run(99999)));
  assert.ok(checkRun({ score: 1000, catches: 7, perfects: 0, rounds: 3 }));
  assert.equal((await post({ handle: 'cheater', ...run(1e9) })).status, 400);
});

await test('a submit returns the rank and the board', async () => {
  const res = await (await post({ handle: '@Alice', ...run(4200) })).json();
  assert.equal(res.rank, 1);
  assert.equal(res.entries[0].handle, 'Alice');
});

await test('each handle keeps its best score, shown as typed most recently', async () => {
  await post({ handle: 'bob', ...run(3600) }, '5.6.7.8');
  const res = await (await post({ handle: 'alice', ...run(3100) })).json();
  assert.equal(res.best, 4200);
  assert.deepEqual(res.entries.map((e) => [e.handle, e.score]), [['alice', 4200], ['bob', 3600]]);
});

await test('a player below the top 10 gets their rank, the field size and their neighbors', async () => {
  for (let i = 0; i < 12; i++) await post({ handle: `pilot${i}`, ...run(5000 + i * 100) }, `10.0.0.${i}`);
  const res = await (await post({ handle: 'rookie', ...run(3050) }, '10.0.1.1')).json();
  // 12 pilots, then alice (4,200), bob (3,600), rookie (3,050).
  assert.equal(res.total, 15);
  assert.equal(res.rank, 15);
  assert.equal(res.entries.length, 10);
  assert.deepEqual(res.around.map((r) => [r.rank, r.handle]), [[14, 'bob'], [15, 'rookie']]);
  const got = await (await GET(new Request('http://x/api/leaderboard?handle=@ROOKIE'))).json();
  assert.equal(got.me.rank, 15);
  assert.equal(got.me.handle, 'rookie');
});

await test('one IP is rate limited', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await post({ handle: 'spam', ...run(3000) }, '9.9.9.9');
  assert.equal(last.status, 429);
});

console.log(`\n${passed} api tests passed`);
