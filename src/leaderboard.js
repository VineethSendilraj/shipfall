const KEY = 'catch-the-booster.top5.v1';

export function loadBoard() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((e) => e && typeof e.score === 'number').slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function qualifies(score) {
  if (score <= 0) return false;
  const list = loadBoard();
  return list.length < 5 || score > list[list.length - 1].score;
}

/** Inserts an entry, persists, and returns { list, index } where index is the new entry's rank. */
export function addEntry(initials, score, round) {
  const entry = { initials: initials.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3) || '???', score, round, at: new Date().toISOString().slice(0, 10) };
  const list = [...loadBoard(), entry].sort((a, b) => b.score - a.score).slice(0, 5);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage can be unavailable (private mode); the board still renders for this session.
  }
  return { list, index: list.indexOf(entry) };
}

export function renderBoard(ol, list = loadBoard(), highlight = -1) {
  ol.replaceChildren();
  if (!list.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No catches yet. Be the first.';
    ol.append(li);
    return;
  }
  list.forEach((e, i) => {
    const li = document.createElement('li');
    if (i === highlight) li.className = 'me';
    const name = document.createElement('span');
    name.textContent = e.initials;
    const pts = document.createElement('span');
    pts.textContent = `${e.score.toLocaleString('en-US')} · R${e.round}`;
    li.append(name, pts);
    ol.append(li);
  });
}
