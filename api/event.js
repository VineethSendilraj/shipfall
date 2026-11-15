// Anonymous gameplay counters in the leaderboard's Upstash Redis: no names, handles or IPs are stored.
// POST /api/event {e, m?, t?, x?, u?}  counts one event for today (UTC), also split by map, target and X-embed.
// GET  /api/event[?days=N]            -> { days: [{ date, uniques, counts: { event: n, 'event|map:mars': n, ... } }] }
import { redis, store } from './leaderboard.js';

const EVENTS = new Set(['visit', 'play', 'catch', 'perfect', 'over', 'submit', 'share', 'mission', 'simulate', 'replay']);
const MAPS = new Set(['starbase', 'mars']);
const TARGETS = new Set(['ship', 'booster', 'random']);
const KEEP_DAYS = 120;
const day = (d = new Date()) => d.toISOString().slice(0, 10);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export async function POST(request) {
  const db = store();
  if (!db) return json({ ok: false }, 503);
  let b;
  try {
    b = await request.json();
  } catch {
    return json({ ok: false }, 400);
  }
  if (!EVENTS.has(b?.e)) return json({ ok: false }, 400);
  const ip = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
  const key = `ctb:ev:${day()}`;
  const fields = [b.e];
  if (MAPS.has(b.m)) fields.push(`${b.e}|map:${b.m}`);
  if (TARGETS.has(b.t)) fields.push(`${b.e}|target:${b.t}`);
  if (b.x === 1) fields.push(`${b.e}|embed`);
  const cmds = [['INCR', `ctb:erl:${ip}`], ['EXPIRE', `ctb:erl:${ip}`, 60, 'NX']];
  try {
    const [hits] = await redis(db, cmds);
    if (hits > 120) return json({ ok: false }, 429);
    const writes = fields.map((f) => ['HINCRBY', key, f, 1]);
    writes.push(['EXPIRE', key, KEEP_DAYS * 86400]);
    // Unique players per day: a random ID the browser made up, counted in a HyperLogLog (it can't be read back).
    if (typeof b.u === 'string' && /^[\w-]{8,64}$/.test(b.u)) writes.push(['PFADD', `ctb:uv:${day()}`, b.u], ['EXPIRE', `ctb:uv:${day()}`, KEEP_DAYS * 86400]);
    await redis(db, writes);
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 502);
  }
}

export async function GET(request) {
  const db = store();
  if (!db) return json({ error: 'not configured' }, 503);
  const n = Math.max(1, Math.min(60, Number(new URL(request.url).searchParams.get('days')) || 7));
  const dates = Array.from({ length: n }, (_, i) => day(new Date(Date.now() - i * 86400000)));
  try {
    const out = await redis(db, dates.flatMap((d) => [['HGETALL', `ctb:ev:${d}`], ['PFCOUNT', `ctb:uv:${d}`]]));
    const days = dates.map((date, i) => {
      const flat = out[i * 2] || [];
      const counts = {};
      for (let j = 0; j < flat.length; j += 2) counts[flat[j]] = Number(flat[j + 1]);
      return { date, uniques: out[i * 2 + 1] || 0, counts };
    });
    return json({ days });
  } catch {
    return json({ error: 'unavailable' }, 502);
  }
}
