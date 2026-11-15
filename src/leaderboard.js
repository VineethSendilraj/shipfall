const KEY = 'catch-the-booster.top5.v1';
const HANDLE_KEY = 'catch-the-booster.handle';
const API = '/api/leaderboard';
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

/** One row per handle (its best score), highest first. */
function dedupe(list) {
  const seen = new Set();
  return [...list]
    .sort((a, b) => b.score - a.score)
    .filter((e) => {
      const k = (e.handle || e.initials || '').toLowerCase();
      if (!k) return true;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export function loadBoard() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? dedupe(list.filter((e) => e && typeof e.score === 'number')).slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function normalizeHandle(raw) {
  const h = String(raw ?? '').trim().replace(/^@/, '');
  return HANDLE.test(h) ? h : null;
}

export function savedHandle() {
  try {
    return normalizeHandle(localStorage.getItem(HANDLE_KEY)) || '';
  } catch {
    return '';
  }
}

/** Inserts an entry into the on-device board, persists, and returns { list, index }. */
export function addEntry(handle, score, round) {
  const entry = { handle, score, round, at: new Date().toISOString().slice(0, 10) };
  const list = dedupe([...loadBoard(), entry]).slice(0, 5);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // Storage can be unavailable (private mode); the board still renders for this session.
  }
  // A lower score than the handle's best still points at that handle's row.
  return { list, index: list.findIndex((e) => (e.handle || '').toLowerCase() === handle.toLowerCase()) };
}

/** Worldwide board ({ entries, total, me, around }), or null when the backend isn't reachable (local dev, not configured). */
export async function fetchGlobal(handle = '', limit = 0) {
  try {
    const p = new URLSearchParams();
    if (normalizeHandle(handle)) p.set('handle', handle);
    if (limit) p.set('limit', String(limit));
    const q = p.size ? `?${p}` : '';
    const res = await fetch(`${API}${q}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.entries) ? data : null;
  } catch {
    return null;
  }
}

/** Rows to show: the top `size`, or when the player ranks below that, the top few, a gap, and their neighborhood. */
export function boardRows({ entries = [], me = null, around = [] }, size) {
  const mark = (e) => ({ ...e, me: !!me && e.rank === me.rank });
  if (!me || me.rank <= size) return entries.slice(0, size).map(mark);
  const head = entries.slice(0, Math.max(2, size - 4)).filter((e) => e.rank < around[0].rank - 1);
  return [...head.map(mark), { gap: true }, ...around.map(mark)];
}

/** The on-device board as rows, optionally marking one entry as the player's. */
export function localRows(list = loadBoard(), mine = -1) {
  return list.map((e, i) => ({ ...e, rank: i + 1, me: i === mine }));
}

/** At most `size` rows, keeping the player's row. */
export function clipRows(rows, size) {
  if (rows.length <= size) return rows;
  const me = rows.findIndex((e) => e.me);
  return me < size ? rows.slice(0, size) : [...rows.slice(0, size - 1), rows[me]];
}

/** Submits a run. Resolves to { rank, best, entries } on success, { error } on a rejected run, or null if offline. */
export async function submitGlobal(run) {
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status >= 500 || res.status === 404) return null;
    return { error: data.error || 'could not submit' };
  } catch {
    return null;
  }
}

/** Renders board rows ({ rank, handle | initials, score, me } or { gap }). Handles link to the X profile. */
export function renderBoard(ol, rows = localRows(), emptyText = 'No catches yet. Be the first.') {
  ol.replaceChildren();
  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = emptyText;
    ol.append(li);
    return;
  }
  for (const e of rows) {
    const li = document.createElement('li');
    if (e.gap) {
      li.className = 'gap';
      li.textContent = '⋯';
      ol.append(li);
      continue;
    }
    if (e.me) li.className = 'me';
    const rank = document.createElement('span');
    rank.className = 'rk';
    rank.textContent = e.rank.toLocaleString('en-US');
    let name;
    const handle = normalizeHandle(e.handle);
    if (handle) {
      name = document.createElement('a');
      name.href = `https://x.com/${handle}`;
      name.target = '_blank';
      name.rel = 'noopener noreferrer';
      name.textContent = `@${handle}`;
    } else {
      name = document.createElement('span');
      name.textContent = e.initials || '???';
    }
    const pts = document.createElement('span');
    pts.textContent = e.score.toLocaleString('en-US');
    li.append(rank, name, pts);
    ol.append(li);
  }
}
