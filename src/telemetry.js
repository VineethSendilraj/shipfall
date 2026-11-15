// Anonymous gameplay counters (api/event.js) and Vercel Web Analytics page views. The only ID is a random one this
// browser makes up, so returning players count once a day; nothing identifies a person.
const ID_KEY = 'shipfall.anon';
const params = new URLSearchParams(location.search);
// Captures, the demo and local development don't count.
const OFF = params.has('capture') || params.get('demo') === '1' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

function anonId() {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return '';
  }
}

/** Counts one event: e is the event name, props may carry m (map) and t (target). */
export function track(e, props = {}) {
  if (OFF) return;
  const body = JSON.stringify({ e, ...props, u: anonId(), x: document.body.classList.contains('embed') ? 1 : 0 });
  try {
    if (navigator.sendBeacon?.('/api/event', new Blob([body], { type: 'application/json' }))) return;
    fetch('/api/event', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
  } catch {
    // Counting is best effort.
  }
}
