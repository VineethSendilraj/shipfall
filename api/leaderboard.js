// Global leaderboard: best score per X handle, stored in Upstash Redis (Vercel Marketplace).
// GET  /api/leaderboard          -> { entries: [{ handle, score, catches, perfects, rounds }] }
// POST /api/leaderboard {handle, score, catches, perfects, rounds} -> { rank, best, entries }

const BOARD = 'ctb:board';
const WHO = 'ctb:who';
const TOP = 10;
const MAX_PER_CATCH = 1800;
const MAX_DOUBLE_BONUS = 500;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

function store() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function redis(db, commands) {
  const res = await fetch(`${db.url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${db.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  const out = await res.json();
  const failed = out.find((r) => r.error);
  if (failed) throw new Error(`redis ${failed.error}`);
  return out.map((r) => r.result);
}

export function normalizeHandle(raw) {
  const h = String(raw ?? '').trim().replace(/^@/, '');
  return HANDLE.test(h) ? h : null;
}

const int = (v) => (Number.isInteger(v) ? v : NaN);

/** Rejects scores the game cannot produce for the reported run. Returns an error string or null. */
export function checkRun({ score, catches, perfects, rounds }) {
  if (![score, catches, perfects, rounds].every((v) => Number.isFinite(int(v)))) return 'bad numbers';
  if (catches < 1 || rounds < 1 || perfects < 0 || perfects > catches) return 'bad counts';
  if (catches > rounds * 2) return 'too many catches';
  if (score < 1000 * catches || score > catches * MAX_PER_CATCH + rounds * MAX_DOUBLE_BONUS) return 'score out of range';
  return null;
}

async function top(db) {
  const [flat] = await redis(db, [['ZREVRANGE', BOARD, 0, TOP - 1, 'WITHSCORES']]);
  const keys = [];
  for (let i = 0; i < flat.length; i += 2) keys.push([flat[i], Number(flat[i + 1])]);
  if (!keys.length) return [];
  const [meta] = await redis(db, [['HMGET', WHO, ...keys.map(([k]) => k)]]);
  return keys.map(([key, score], i) => {
    let m = {};
    try {
      m = JSON.parse(meta[i] || '{}');
    } catch {}
    return { handle: m.h || key, score, catches: m.c ?? null, perfects: m.p ?? null, rounds: m.r ?? null };
  });
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function GET() {
  const db = store();
  if (!db) return json({ error: 'leaderboard not configured' }, 503);
  try {
    return json({ entries: await top(db) });
  } catch {
    return json({ error: 'leaderboard unavailable' }, 502);
  }
}

export async function POST(request) {
  const db = store();
  if (!db) return json({ error: 'leaderboard not configured' }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const handle = normalizeHandle(body?.handle);
  if (!handle) return json({ error: 'X handles are 1-15 letters, numbers or _' }, 400);
  const run = { score: body.score, catches: body.catches, perfects: body.perfects, rounds: body.rounds };
  const bad = checkRun(run);
  if (bad) return json({ error: bad }, 400);

  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const key = handle.toLowerCase();
  try {
    const [hits] = await redis(db, [['INCR', `ctb:rl:${ip}`], ['EXPIRE', `ctb:rl:${ip}`, 60, 'NX']]);
    if (hits > 10) return json({ error: 'slow down' }, 429);
    // GT keeps each handle's best score; the details are only replaced when the score improves.
    const [changed] = await redis(db, [['ZADD', BOARD, 'GT', 'CH', run.score, key]]);
    const [prev] = await redis(db, [['HGET', WHO, key]]);
    if (changed || !prev) {
      const meta = JSON.stringify({ h: handle, c: run.catches, p: run.perfects, r: run.rounds, t: Date.now() });
      await redis(db, [['HSET', WHO, key, meta]]);
    }
    const [rank, best] = await redis(db, [['ZREVRANK', BOARD, key], ['ZSCORE', BOARD, key]]);
    return json({ rank: rank + 1, best: Number(best), entries: await top(db) });
  } catch {
    return json({ error: 'leaderboard unavailable' }, 502);
  }
}
