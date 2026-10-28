const KEY = 'catch-the-booster.top5.v1';
const HANDLE_KEY = 'catch-the-booster.handle';
const API = '/api/leaderboard';
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

export function loadBoard() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.score === 'number').slice(0, 5) : [];
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
  const list = [...loadBoard(), entry].sort((a, b) => b.score - a.score).slice(0, 5);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    localStorage.setItem(HANDLE_KEY, handle);
  } catch {
    // Storage can be unavailable (private mode); the board still renders for this session.
  }
  return { list, index: list.indexOf(entry) };
}

/** Worldwide top 10, or null when the leaderboard backend isn't reachable (local dev, not configured). */
export async function fetchGlobal() {
  try {
    const res = await fetch(API, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.entries) ? data.entries : null;
  } catch {
    return null;
  }
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

/** Renders a board. Entries carry a handle (linked to the X profile) or legacy initials. */
export function renderBoard(ol, list = loadBoard(), highlight = -1, emptyText = 'No catches yet. Be the first.') {
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = emptyText;
    ol.append(li);
    return;
  }
  list.forEach((e, i) => {
    const li = document.createElement('li');
    if (i === highlight) li.className = 'me';
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
    li.append(name, pts);
    ol.append(li);
  });
}
