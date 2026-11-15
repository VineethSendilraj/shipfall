import { svg, clock } from './hud-bar.js';
import { GM, LAND, R, SATS, ATM_TOP, BOOSTER_BASE, MOUNT_TOP, local, orbitOf, siteAhead, wrap } from './flight.js';

const $ = (id) => document.getElementById(id);
const MARKS = [
  ['liftoff', 'LIFTOFF'],
  ['maxq', 'MAX-Q'],
  ['stage', 'STAGE SEP'],
  ['orbit', 'ORBIT'],
  ['deploy', 'DEPLOY'],
  ['catch', 'BOOSTER CATCH'],
  ['deorbit', 'DEORBIT'],
  ['reentry', 'REENTRY'],
  ['landing', 'LANDING'],
];
// Lit engines per ring for each engine count the vehicles burn with.
const BOOSTER_LIT = { 33: [3, 10, 20], 13: [3, 10, 0], 3: [3, 0, 0] };
const SHIP_LIT = { 6: [3, 3], 3: [3, 0] };
const ON_FOR = 4; // seconds a newly reached event stays highlighted
const ALT_FULL = 15000;
const ON_TARGET = 300;
const RETRO_R = 23;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const deg = (a) => ((a * 180) / Math.PI).toFixed(1);
const km = (m) => (Math.max(0, m) / 1000).toFixed(m < 99950 ? 1 : 0);
const kmh = (v) => Math.round(v * 3.6).toLocaleString('en-US');
const dist = (m) => (m < 1000 ? `${Math.round(m)} M` : `${(m / 1000).toFixed(m < 99950 ? 1 : 0)} KM`);

/** Satellites, landing and booster lines for the mission report, plus the post text. */
export function report(f) {
  const o = f.outcome;
  const n = f.stats.deployed;
  const sats = `${n} satellite${n === 1 ? '' : 's'}`;
  const landed = o.ok;
  const lost = !!o.lost;
  const reason = o.reason ? o.reason[0].toUpperCase() + o.reason.slice(1) : '';
  const booster = f.stats.boosterCaught ? 'caught by the tower' : f.booster.state === 'lost' ? 'lost' : 'still flying';
  let post;
  if (landed) post = `I ${n ? `launched ${sats}` : f.marks.orbit != null ? 'flew around the world' : 'flew a rocket'} and landed the ship back at the tower.${f.stats.boosterCaught ? ' The tower caught the booster too.' : ''} Your turn:`;
  else if (lost) post = `I ${n ? `launched ${sats}` : 'flew to space'} and lost the ship up there. Your turn:`;
  else post = n ? `I launched ${sats}, then crashed the ship coming home. Your turn:` : 'I tried to fly a rocket around the world and land it back at the tower. It did not go well. Your turn:';
  return {
    title: landed ? 'Ship landed' : 'Ship lost',
    lede: landed ? `Touchdown ${o.dist.toFixed(1)} m from the center of the mount at ${o.speed.toFixed(1)} m/s.` : `${reason}.`,
    sats: `${n} of ${SATS}`,
    landing: landed ? `${o.dist.toFixed(1)} m from center · ${o.speed.toFixed(1)} m/s` : lost ? 'none' : `crashed ${dist(o.dist).toLowerCase()} from center · ${o.speed.toFixed(1)} m/s`,
    booster,
    time: `T+${clock(f.t)}`,
    post,
  };
}

/**
 * Drives the catch game's webcast HUD for a free flight: booster telemetry on the left, the ship's on the right,
 * mission events on the timeline, satellites in the score box, the landing prediction in the status line.
 */
export class FlightHud {
  constructor(ui) {
    this.ui = ui;
    const bar = (this.bar = ui.bar);
    const fuel = $('g-fuel');
    for (const [k, from, label] of [
      ['sspd', 'g-spd', 'SPEED'],
      ['salt', 'g-alt', 'ALTITUDE'],
    ]) {
      const g = $(from).cloneNode(true);
      g.id = `g-${k}`;
      g.querySelector('.g-lbl').textContent = label;
      fuel.before(g);
      bar.addGauge(k, g);
    }
    // Spaced by label length, so neighbouring labels never overlap.
    const w = MARKS.map(([, l]) => l.length + 3);
    const gaps = w.slice(1).map((n, i) => (n + w[i]) / 2);
    const span = gaps.reduce((a, b) => a + b, 0);
    let at = 0;
    this.frac = MARKS.map((_, i) => 0.04 + (0.92 * (at += i ? gaps[i - 1] : 0)) / span);
    MARKS.forEach(([k, label], i) => {
      bar.addMark(`fl-${k}`, label, 'fl');
      bar.placeMark(`fl-${k}`, this.frac[i]);
    });
    this.retro = svg('g', { class: 'retro' }, $('h-align').querySelector('svg'));
    svg('circle', { r: 4.4 }, this.retro);
    svg('path', { d: 'M-3.1,-3.1L3.1,3.1M3.1,-3.1L-3.1,3.1' }, this.retro);
    this.units = ['g-alt', 'g-spd', 'g-salt', 'g-sspd'].map((id) => $(id).querySelector('.g-unit'));
    this.tplus = document.querySelector('#hud .tplus');
    this.scoreLbl = document.querySelector('.scorebox .lbl');
    this.act = document.querySelector('#touch [data-k="close"]');
  }

  enter() {
    for (const [i, u] of this.units.entries()) u.textContent = i % 2 ? 'KM/H' : 'KM';
    this.scoreLbl.textContent = 'SATELLITES';
  }

  exit() {
    const [alt, spd] = this.units;
    alt.textContent = 'M';
    spd.textContent = 'M/S';
    this.scoreLbl.textContent = 'SCORE';
    this.tplus.textContent = 'T+';
    this.act.textContent = 'CATCH';
    this.act.classList.remove('idle');
    delete this.bar.cache.act;
    delete this.bar.cache.tplus;
    this.ui.updatePopups({ popups: [] });
  }

  update(f, { show = true, dip = 0 } = {}) {
    const { ui, bar } = this;
    const e = ui.el;
    ui.dip = dip;
    ui.set('hudHidden', e.hud, 'class', show ? 'hud' : 'hud hidden');
    ui.set('hudOpacity', e.hud, 'opacity', '1');
    if (show && ui.safeDirty) ui.measureSafe();
    ui.updatePopups(f.fx);
    if (!show) return;

    const b = f.booster;
    const s = f.ship;
    const compact = document.body.classList.contains('compact');
    const touch = document.body.classList.contains('touch-ui');
    const bl = local(b.x, b.y);
    const sl = local(s.x, s.y);
    const sv = Math.hypot(s.vx, s.vy);
    const o = orbitOf(s.x, s.y, s.vx, s.vy);
    const inOrbit = s.mode === 'free' && o.pe > ATM_TOP;

    const gone = b.state === 'lost';
    const stacked = s.mode === 'stacked';
    // Heights of the vehicles' bases above the mount, so both read zero on the pad.
    const ba = bl.alt - BOOSTER_BASE - MOUNT_TOP;
    const sa = stacked ? ba : sl.alt - MOUNT_TOP;
    bar.gauge('alt', ba / ALT_FULL, gone ? '—' : km(ba));
    bar.gauge('spd', Math.hypot(b.vx, b.vy) / Math.sqrt(GM / bl.r), gone ? '—' : kmh(Math.hypot(b.vx, b.vy)));
    bar.gauge('salt', sa / ALT_FULL, s.mode === 'crashed' ? '—' : km(sa));
    bar.gauge('sspd', sv / Math.sqrt(GM / sl.r), s.mode === 'crashed' ? '—' : kmh(sv), inOrbit ? 'ok' : '');
    const fuel = f.fuel();
    bar.gauge('fuel', fuel, String(Math.round(fuel * 100)), fuel < 0.1 ? 'bad' : fuel < 0.25 ? 'warn' : '');
    bar.light('a', bar.boosterDots, b.throttle > 0.02 ? (BOOSTER_LIT[b.engines] ?? [0, 0, 0]) : [0, 0, 0]);
    bar.set('shipOn', true, (v) => bar.el.engB.classList.toggle('hidden', !v));
    bar.light('b', bar.shipDots, s.throttle > 0.02 ? (SHIP_LIT[s.engines] ?? [0, 0]) : [0, 0]);

    // Attitude of the flying vehicle against the local horizon, and the retrograde marker once in orbit.
    const tilt = wrap((stacked ? bl : sl).up - (stacked ? b : s).ang);
    bar.set('sil', `translate(32 33) rotate(${deg(tilt)})`, (v) => bar.el.sil.setAttribute('transform', v));
    const retroOn = s.mode === 'free' && f.marks.orbit != null;
    const rt = wrap(sl.up - Math.atan2(-s.vy, -s.vx));
    bar.set('retro', retroOn ? `translate(${(32 + RETRO_R * Math.sin(rt)).toFixed(1)} ${(32 - RETRO_R * Math.cos(rt)).toFixed(1)})` : 'none', (v) => {
      this.retro.style.display = v === 'none' ? 'none' : '';
      if (v !== 'none') this.retro.setAttribute('transform', v);
    });
    bar.set('ready', retroOn && Math.abs(wrap(tilt - rt)) < 0.03 ? 'align ready' : 'align', (v) => (bar.el.align.className = v));

    this.timeline(f);
    bar.set('tplus', f.t < 0 ? 'T−' : 'T+', (v) => (this.tplus.textContent = v));
    bar.set('clock', clock(f.t < 0 ? Math.ceil(-f.t) : f.t), (v) => (bar.el.clock.textContent = v));
    const n = f.stats.deployed;
    bar.set('flight', compact ? `SATS ${n}/${SATS}` : 'FREE FLIGHT', (v) => (bar.el.flight.textContent = v));
    bar.set('mscore', clock(Math.abs(f.t)).slice(3), (v) => (bar.el.mscore.textContent = v));
    ui.set('score', e.score, 'text', `${n}/${SATS}`);
    ui.set('tower', e.tower, 'text', inOrbit ? `SITE ${dist(siteAhead(sl.phi) * R)} AHEAD` : '');

    const [status, cls] = this.status(f, sl, inOrbit);
    ui.set('status', e.status, 'text', status);
    ui.set('statusC', e.status, 'class', cls ? `status ${cls}` : 'status');
    const warp = f.warp > 1.5;
    ui.set('gust', e.gust, 'text', warp ? `TIME WARP ×${Math.round(f.warp)}` : '');
    ui.set('gustC', e.gust, 'class', warp ? 'gust on' : 'gust');
    const coach = this.coach(f, touch, inOrbit);
    ui.set('coach', e.coach, 'text', coach);
    ui.set('coachC', e.coach, 'class', coach ? 'coach on' : 'coach');
    const act = f.action();
    bar.set('act', act ?? '', (v) => {
      this.act.textContent = v || '—';
      this.act.classList.toggle('idle', !v);
    });
  }

  /** Lights each event as it happens and moves the now dot along the ship's events, creeping toward the next. */
  timeline(f) {
    const bar = this.bar;
    let last = -1;
    MARKS.forEach(([k], i) => {
      if (k !== 'catch' && f.marks[k] != null) last = i;
    });
    let next = last + 1;
    if (MARKS[next]?.[0] === 'catch') next++;
    let p;
    if (last < 0) p = this.frac[0] * clamp(1 + f.t / 6, 0, 1);
    else if (next >= MARKS.length || f.phase === 'over') p = this.frac[last];
    else p = this.frac[last] + (this.frac[next] - this.frac[last]) * 0.6 * (1 - Math.exp(-(f.t - f.marks[MARKS[last][0]]) / 20));
    bar.setProgress(p);

    for (const [k, label] of MARKS) {
      const m = bar.marks[`fl-${k}`];
      const at = f.marks[k];
      let cls = at == null ? '' : f.t - at < ON_FOR ? 'on' : 'past';
      let text = label;
      if (k === 'catch' && f.booster.state === 'lost') [text, cls] = ['BOOSTER LOST', 'bad'];
      if (k === 'landing' && f.outcome) [text, cls] = f.outcome.ok ? [label, 'ok'] : [f.outcome.lost ? 'SHIP LOST' : 'CRASH', 'bad'];
      bar.set(`fl-${k}L`, text, (v) => (m.label.textContent = v));
      bar.set(`fl-${k}C`, cls, (v) => {
        m.label.setAttribute('class', `fl ${v}`);
        m.dot.setAttribute('class', `mark fl ${v}`);
      });
    }
  }

  /** The status line: orbit, then where the ship comes down relative to the launch site. */
  status(f, L, inOrbit) {
    const s = f.ship;
    if (f.phase === 'over') return ['', ''];
    if (f.marks.maxq != null && f.t - f.marks.maxq < 6) return ['MAX-Q', 'on'];
    if (inOrbit) return ['ORBIT', 'on'];
    if (s.mode === 'landing' || s.mode === 'flip') {
      const d = Math.abs(L.phi * R);
      return [`${dist(d)} TO THE MOUNT`, d < LAND.r ? 'on' : 'warn'];
    }
    const p = f.prediction;
    if (!p || f.marks.orbit == null) return ['', ''];
    const d = Math.abs(p.dist);
    return d < ON_TARGET ? ['LANDING ON TARGET', 'on'] : [`LANDING ${dist(d)} ${p.dist > 0 ? 'LONG' : 'SHORT'}`, 'warn'];
  }

  /** One hint at a time: the controls first, then what to do next. */
  coach(f, touch, inOrbit) {
    const s = f.ship;
    const act = touch ? 'tap' : 'SPACE';
    if (f.phase === 'pad' && f.action()) return touch ? 'tap START to skip the countdown · drag to look around' : 'SPACE skips the countdown · drag to look around';
    if (f.phase === 'pad' || (f.phase === 'flight' && f.t - f.marks.liftoff < 12)) {
      if (!f.clearOfTower()) return touch ? '◀ ▶ pitch once clear of the tower · ▲ ▼ throttle' : '← → pitch once clear of the tower · ↑ ↓ throttle';
      return touch ? '◀ ▶ pitch · ▲ ▼ throttle · action button' : '← → pitch · ↑ ↓ throttle · SPACE action';
    }
    if (f.phase !== 'flight') return '';
    switch (s.mode) {
      case 'stacked':
        return f.fuel() < 0.15 ? `${act} STAGE to separate the ship` : 'pitch toward the horizon to build speed';
      case 'free':
        if (f.marks.orbit == null) return 'keep the nose near the horizon until ORBIT';
        if (s.sats > 0 && inOrbit) return `${act} DEPLOY for the next satellite`;
        if (inOrbit) return `point at the ⊗ marker and burn to come home`;
        return f.throttle > 0 ? 'cut the engine when the landing is on target' : '';
      case 'aero':
        return `← → stretch or shorten the glide${f.action() === 'FLIP' ? ` · ${act} FLIP` : ''}`;
      case 'landing':
        return touch ? '◀ ▶ slide onto the mount · ▲ ▼ sink rate' : '← → slide onto the mount · ↑ ↓ sink rate';
      default:
        return '';
    }
  }
}
