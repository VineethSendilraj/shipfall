/** Visual themes for the launch site. A map only changes the world around the towers, never the sim. */
export const MAPS = ['starbase', 'mars'];
export const DEFAULT_MAP = 'mars';
const KEY = 'catch-the-booster.map';

export const isMap = (name) => MAPS.includes(name);

/** `?map=` wins; otherwise the player's last choice (if `remember`), otherwise Mars. */
export function initialMap(params, { remember = true } = {}) {
  const asked = params.get('map');
  if (isMap(asked)) return asked;
  if (remember) {
    try {
      const saved = localStorage.getItem(KEY);
      if (isMap(saved)) return saved;
    } catch {
      // Storage can be blocked in third-party iframes; fall back to the default.
    }
  }
  return DEFAULT_MAP;
}

/**
 * Wires every `.map-pick` segmented control (title card and quick-start card) to the view. A choice is
 * remembered and applied straight away while `canApply()` (the title screen is up); `apply()` applies the
 * current choice later, e.g. when a flight starts. `applied()` runs after a picker applies a map straight away.
 */
export function bindMapPicker(view, initial, canApply, applied = () => {}) {
  let current = initial;
  const buttons = [...document.querySelectorAll('.map-pick button[data-map]')];
  const show = () => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.map === current));
  };
  const apply = () => view.setMap(current);
  for (const b of buttons) {
    b.addEventListener('click', (ev) => {
      // After a mouse or touch pick, Space and Enter should still start the flight, not re-press the picker.
      if (ev.detail > 0) b.blur();
      if (!isMap(b.dataset.map) || b.dataset.map === current) return;
      current = b.dataset.map;
      try {
        localStorage.setItem(KEY, current);
      } catch {
        // Not remembered in this frame; the choice still applies for this session.
      }
      show();
      if (canApply()) {
        apply();
        applied();
      }
    });
  }
  show();
  return {
    apply,
    get map() {
      return current;
    },
  };
}
