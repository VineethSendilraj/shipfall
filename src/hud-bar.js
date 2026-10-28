const NS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);
const GAUGE_C = 2 * Math.PI * 28;
const GAUGE_SWEEP = 0.75;
const BOOSTER_RINGS = [
  { n: 3, r: 6, d: 3.3 },
  { n: 10, r: 15.2, d: 3.1 },
  { n: 20, r: 25, d: 2.6 },
];
const SHIP_RINGS = [
  { n: 3, r: 7.2, d: 4.4, a0: -90 },
  { n: 3, r: 19.5, d: 8, a0: -30 },
];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function svg(tag, attrs, parent) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  parent?.append(el);
  return el;
}

/** Engine-ring icon like a launch webcast's: one dot per engine, lit while it fires. */
function engineIcon(host, rings) {
  const root = host.querySelector('svg');
  svg('circle', { cx: 32, cy: 32, r: 30.5, class: 'rim' }, root);
  return rings.map(({ n, r, d, a0 = -90 }) =>
    Array.from({ length: n }, (_, i) => {
      const a = ((a0 + (360 * i) / n) * Math.PI) / 180;
      return svg('circle', { cx: (32 + Math.cos(a) * r).toFixed(2), cy: (32 + Math.sin(a) * r).toFixed(2), r: d, class: 'dot' }, root);
    }),
  );
}

function clock(t) {
  const s = Math.max(0, Math.floor(t));
  const pad = (v) => String(v).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

/** The webcast-style instrument bar: engine rings, round gauges, mission timeline, clock and alignment. */
export class HudBar {
  constructor() {
    this.el = {
      flight: $('h-flight'),
      clock: $('h-clock'),
      mscore: $('h-mscore'),
      engB: $('h-eng-b'),
      align: $('h-align'),
      sil: document.querySelector('#h-align .sil'),
      track: document.querySelector('#h-timeline .tl-track'),
      done: document.querySelector('#h-timeline .tl-done'),
      now: document.querySelector('#h-timeline .tl-now'),
    };
    this.boosterDots = engineIcon($('h-eng-a'), BOOSTER_RINGS);
    this.shipDots = engineIcon(this.el.engB, SHIP_RINGS);
    this.gauges = Object.fromEntries(
      ['alt', 'spd', 'fuel'].map((k) => {
        const host = $(`g-${k}`);
        return [k, { host, arc: host.querySelector('.arc'), val: host.querySelector('.g-val') }];
      }),
    );
    this.len = this.el.track.getTotalLength();
    this.marks = Object.fromEntries(
      ['burn', 'catch'].map((k) => [k, { dot: document.querySelector(`#h-timeline .m-${k}`), label: document.querySelector(`#h-timeline .l-${k}`) }]),
    );
    this.placeMark('catch', 1);
    this.cache = {};
    this.lit = new Map();
    this.roundKey = '';
  }

  set(key, value, apply) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply(value);
  }

  placeMark(k, f) {
    const p = this.el.track.getPointAtLength(f * this.len);
    const m = this.marks[k];
    m.dot.setAttribute('cx', p.x.toFixed(1));
    m.dot.setAttribute('cy', p.y.toFixed(1));
    m.label.setAttribute('x', p.x.toFixed(1));
    m.label.setAttribute('y', (p.y - 9).toFixed(1));
  }

  light(key, rings, counts) {
    rings.forEach((dots, ri) => {
      const n = counts[ri] ?? 0;
      if (this.lit.get(`${key}${ri}`) === n) return;
      this.lit.set(`${key}${ri}`, n);
      dots.forEach((d, i) => d.classList.toggle('on', i < n));
    });
  }

  gauge(k, frac, text, cls = '') {
    const g = this.gauges[k];
    this.set(`${k}a`, (GAUGE_SWEEP * GAUGE_C * clamp(frac, 0, 1)).toFixed(1), (v) => (g.arc.style.strokeDasharray = `${v} ${GAUGE_C.toFixed(1)}`));
    this.set(`${k}v`, text, (v) => (g.val.textContent = v));
    this.set(`${k}c`, cls, (v) => (g.host.className = `gauge ${v}`));
  }

  /** Call every frame, even while the bar is hidden, so the timeline knows where the descent started. */
  track(game, h) {
    const key = `${game.seed}:${game.round}`;
    if (key !== this.roundKey) {
      this.roundKey = key;
      this.altMax = 0;
      this.burnF = -1;
      this.placeMark('burn', 0.6);
    }
    const b = h.booster;
    if (!b || b.waiting) return;
    const alt = Math.max(0, b.alt);
    this.altMax = Math.max(this.altMax, alt);
    this.progress = this.altMax > 0 ? clamp(1 - alt / this.altMax, 0, 1) : 0;
    if (b.burning && this.burnF < 0) {
      this.burnF = clamp(this.progress, 0.05, 0.95);
      this.placeMark('burn', this.burnF);
    }
  }

  update(game, h, { lost, compact }) {
    const e = this.el;
    const round = Math.max(1, h.round);
    const lives = '●'.repeat(h.lives) + '○'.repeat(Math.max(0, 3 - h.lives));
    const tower = h.double && h.booster ? ` · TOWER ${h.towerIdx === 0 ? 'A' : 'B'}` : '';
    this.set('flight', compact ? `FLIGHT ${round}${tower} · ${lives}` : `CATCH THE BOOSTER · FLIGHT ${round}`, (v) => (e.flight.textContent = v));
    this.set('clock', clock(game.t), (v) => (e.clock.textContent = v));
    this.set('mscore', h.score.toLocaleString('en-US'), (v) => (e.mscore.textContent = v));

    const b = h.booster;
    const sim = game.activeBooster();
    const thr = b && !b.waiting && sim ? sim.throttle : 0;
    this.light('a', this.boosterDots, thr > 0.02 ? [3, thr > 0.55 ? 10 : 0, 0] : [0, 0, 0]);
    const ship = game.boosters.find((x) => x.kind === 'ship' && x.state !== 'waiting');
    this.set('shipOn', !!ship, (v) => e.engB.classList.toggle('hidden', !v));
    if (ship) this.light('b', this.shipDots, ship.throttle > 0.02 ? [3, 0] : [0, 0]);

    let progress = 0;
    let sil = 'translate(32 44)';
    if (b) {
      const alt = Math.max(0, b.alt);
      progress = b.waiting ? 0 : this.progress;
      const vs = Math.abs(b.vs);
      this.gauge('alt', this.altMax > 0 ? alt / this.altMax : 1, alt >= 100 ? alt.toFixed(0) : alt.toFixed(1));
      this.gauge('spd', vs / 80, b.waiting ? '—' : vs.toFixed(1), b.waiting ? '' : vs < 3 ? 'ok' : vs < 10 ? 'warn' : '');
      this.gauge('fuel', b.fuel / 100, b.fuel.toFixed(0), b.fuel < 10 ? 'bad' : b.fuel < 25 ? 'warn' : '');
      const tilt = sim ? (sim.tilt * 180) / Math.PI : 0;
      const lx = clamp(b.lat * 2.4, -22, 22);
      const ly = clamp(-b.armDy * 1.2, -20, 20);
      sil = `translate(${(32 + lx).toFixed(1)} ${(44 + ly).toFixed(1)}) rotate(${tilt.toFixed(1)})`;
    } else {
      progress = game.phase === 'outro' ? 1 : 0;
      this.gauge('alt', 0, '—');
      this.gauge('spd', 0, '—');
    }
    this.set('sil', sil, (v) => e.sil.setAttribute('transform', v));
    this.set('ready', h.ready ? 'align ready' : 'align', (v) => (e.align.className = v));
    this.set('progress', progress.toFixed(3), (v) => {
      e.done.style.strokeDasharray = `${(v * this.len).toFixed(1)} ${this.len.toFixed(1)}`;
      const p = e.track.getPointAtLength(v * this.len);
      e.now.setAttribute('cx', p.x.toFixed(1));
      e.now.setAttribute('cy', p.y.toFixed(1));
    });
    const burnLabel = b?.cutoff ? 'ENGINE CUTOFF' : 'LANDING BURN';
    this.set('burnL', burnLabel, (v) => (this.marks.burn.label.textContent = v));
    this.set('burnC', b?.burning ? 'on' : this.burnF >= 0 ? 'past' : '', (v) => this.marks.burn.label.setAttribute('class', `l-burn ${v}`));
    const catchState = lost ? ['BOOSTER LOST', 'bad'] : h.ready ? ['CATCH', 'ok'] : game.phase === 'outro' ? ['SECURED', 'ok'] : ['CATCH', ''];
    this.set('catchL', catchState[0], (v) => (this.marks.catch.label.textContent = v));
    this.set('catchC', catchState[1], (v) => this.marks.catch.label.setAttribute('class', `l-catch ${v}`));
  }
}
