import { TARGETS } from './sim.js';

const MODE_KEY = 'catch-the-booster.mode';
const TARGET_KEY = 'catch-the-booster.target';
const TARGET_INFO = {
  booster: { name: 'Booster', note: 'The tall one. Pins sit just under the grid fins' },
  ship: { name: 'Ship', note: 'Shorter and lighter. Pins under the forward flaps' },
  random: { name: 'Random', note: 'Booster or ship, drawn fresh every round' },
};
const SWIPE_PX = 40;

function load(key, valid, fallback) {
  try {
    const v = localStorage.getItem(key);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be blocked in third-party iframes; the pick still holds for this session.
  }
}

/**
 * The home screen's pickers: the game mode (one tab per entry of `modes`, shown once there are two) and what
 * to catch (cycled with the arrows, the ← → keys or a swipe). The view holds the pick in the tower's arms;
 * a mode without `targets` shows the full stack. Each mode is { id, label, blurb, targets?, start() }.
 */
export function bindHome({ root, modes, view }) {
  let mode = modes.find((m) => m.id === load(MODE_KEY, Boolean, null)) ?? modes[0];
  let target = load(TARGET_KEY, (v) => TARGETS.includes(v), TARGETS[0]);
  const $ = (sel) => root.querySelector(sel);
  const tabs = $('.modes');
  const pick = $('.pick');
  const name = $('.pick-name');
  const note = $('.pick-note');
  const dots = TARGETS.map(() => $('.pick-dots').appendChild(document.createElement('i')));
  const help = $('.how');
  const helpBtn = $('.open-how');

  tabs.classList.toggle('hidden', modes.length < 2);
  const tabEls = modes.map((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m.label;
    b.addEventListener('click', (ev) => {
      if (ev.detail > 0) b.blur();
      mode = m;
      save(MODE_KEY, m.id);
      show();
    });
    return tabs.appendChild(b);
  });

  function show() {
    tabEls.forEach((b, i) => b.setAttribute('aria-pressed', String(modes[i] === mode)));
    pick.classList.toggle('fixed', !mode.targets);
    const info = mode.targets ? TARGET_INFO[target] : { name: mode.label, note: mode.blurb };
    name.textContent = info.name;
    note.textContent = info.note;
    dots.forEach((d, i) => d.classList.toggle('on', TARGETS[i] === target));
    view.setShowcase(mode.targets ? target : 'random');
    for (const el of help.querySelectorAll('[data-mode]')) el.hidden = el.dataset.mode !== mode.id;
  }

  function cycle(step) {
    if (!mode.targets) return;
    target = TARGETS[(TARGETS.indexOf(target) + step + TARGETS.length) % TARGETS.length];
    save(TARGET_KEY, target);
    show();
  }

  function setHelp(open) {
    help.classList.toggle('hidden', !open);
    root.classList.toggle('helping', open);
    helpBtn.setAttribute('aria-expanded', String(open));
  }

  for (const b of root.querySelectorAll('.pick-arrow')) {
    b.addEventListener('click', (ev) => {
      if (ev.detail > 0) b.blur();
      cycle(Number(b.dataset.step));
    });
  }
  helpBtn.addEventListener('click', (ev) => {
    if (ev.detail > 0) helpBtn.blur();
    setHelp(help.classList.contains('hidden'));
  });
  $('.close-how').addEventListener('click', (ev) => {
    setHelp(false);
    if (ev.detail === 0) helpBtn.focus({ preventScroll: true });
  });

  let swipe = null;
  root.addEventListener('pointerdown', (ev) => {
    swipe = ev.target.closest('button, a, .how') ? null : { x: ev.clientX, y: ev.clientY };
  });
  root.addEventListener('pointerup', (ev) => {
    if (!swipe) return;
    const dx = ev.clientX - swipe.x;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(ev.clientY - swipe.y)) cycle(dx < 0 ? 1 : -1);
    swipe = null;
  });

  show();
  return {
    show,
    cycle,
    start: () => mode.start(),
    get mode() {
      return mode;
    },
    get target() {
      return target;
    },
    /** Closes the how-to-play panel; false if it was not open. */
    closeHelp() {
      if (help.classList.contains('hidden')) return false;
      setHelp(false);
      return true;
    },
  };
}
