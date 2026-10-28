import { HudBar } from './hud-bar.js';

const $ = (id) => document.getElementById(id);
const easeOutBack = (x) => 1 + 2.4 * (x - 1) ** 3 + 1.4 * (x - 1) ** 2;

/** DOM overlay renderer (HUD, popups, banners, demo cards). Everything is derived from sim state. */
export class UI {
  constructor(view) {
    this.view = view;
    this.el = {
      hud: $('hud'),
      status: $('h-status'),
      gust: $('h-gust'),
      score: $('h-score'),
      round: $('h-round'),
      lives: $('h-lives'),
      tower: $('h-tower'),
      coach: $('h-coach'),
      popups: $('popups'),
      banner: $('banner'),
      bannerTitle: document.querySelector('#banner .banner-title'),
      bannerSub: document.querySelector('#banner .banner-sub'),
      demoTitle: $('demo-title'),
      demoEnd: $('demo-end'),
      demoScore: $('demo-score'),
      demoStats: $('demo-stats'),
    };
    this.bar = new HudBar();
    this.popupEls = new Map();
    this.shownScore = 0;
    this.cache = {};
    this.scale = 1;
    this.safe = null;
    this.safeDirty = true;
    this.cut = new Set();
    this.popupMax = 0;
    this.popupExit = 1;
    this.bannerRef = null;
    this.bannerIn = 0;
    this.bannerT = 0;
    this.coachOn = false;
  }

  /** First-round coach: one line at a time until the player's first catch. */
  enableCoach() {
    try {
      this.coachOn = localStorage.getItem('ctb-coached') !== '1';
    } catch {
      this.coachOn = true;
    }
  }

  finishCoach() {
    if (!this.coachOn) return;
    this.coachOn = false;
    try {
      localStorage.setItem('ctb-coached', '1');
    } catch {}
  }

  coachLine(game, h) {
    const b = h.booster;
    if (!this.coachOn || game.phase !== 'live' || game.round > 1 || !b || b.waiting) return '';
    const touch = document.body.classList.contains('touch-ui');
    if (h.ready) return touch ? 'tap CATCH now' : 'press SPACE to catch';
    if (Math.abs(b.latPx) > 15) return touch ? '◀ ▶ steer over the tower' : '← → steer over the tower';
    if (Math.abs(b.armDy) > 3) return touch ? '▲ ▼ move the arms to the pins' : '↑ ↓ move the arms to the pins';
    return 'hold steady, wait for the catch window';
  }

  setScale(s) {
    this.scale = s;
    this.safeDirty = true;
    document.documentElement.style.setProperty('--ui', s.toFixed(3));
  }

  set(key, el, prop, value) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'class') el.className = value;
    else el.style[prop] = value;
  }

  resetScore() {
    this.shownScore = 0;
  }

  update(game, { hudOpacity = 1, dip = 0 } = {}) {
    this.dip = dip;
    const e = this.el;
    const h = game.hud();
    const showHud = game.phase !== 'ready' && game.phase !== 'over' && hudOpacity > 0;
    this.set('hudHidden', e.hud, 'class', showHud ? 'hud' : 'hud hidden');
    this.set('hudOpacity', e.hud, 'opacity', String(hudOpacity));
    if (showHud && this.safeDirty) this.measureSafe();
    this.bar.track(game, h);
    if (showHud) {
      if (game.boosters.some((x) => x.state === 'crashed' || x.state === 'tumbling')) this.lostRound = `${game.seed}:${game.round}`;
      const lost = !h.booster && this.lostRound === `${game.seed}:${game.round}`;
      this.bar.update(game, h, { lost, compact: document.body.classList.contains('compact') });
      this.set('status', e.status, 'text', h.ready ? 'CATCH WINDOW' : '');
      this.set('statusC', e.status, 'class', h.ready ? 'status on' : 'status');
      this.set('gust', e.gust, 'text', h.gust ? `WIND GUST ${h.gust > 0 ? '→' : '←'}` : '');
      this.set('gustC', e.gust, 'class', h.gust ? 'gust on' : 'gust');
      const coach = this.coachLine(game, h);
      this.set('coach', e.coach, 'text', coach);
      this.set('coachC', e.coach, 'class', coach ? 'coach on' : 'coach');
      this.shownScore += (h.score - this.shownScore) * 0.2;
      if (Math.abs(h.score - this.shownScore) < 1) this.shownScore = h.score;
      this.set('score', e.score, 'text', Math.round(this.shownScore).toLocaleString('en-US'));
      this.set('round', e.round, 'text', String(Math.max(1, h.round)));
      const lives = '●'.repeat(h.lives) + '○'.repeat(Math.max(0, 3 - h.lives));
      this.set('livesT', e.lives, 'text', lives);
      this.set('tower', e.tower, 'text', h.double ? (h.booster ? `DOUBLE CATCH · TOWER ${h.towerIdx === 0 ? 'A' : 'B'}` : 'DOUBLE CATCH') : '');
    }
    this.updatePopups(game);
    this.updateBanner(game);
  }

  /** Screen band between the HUD panels and the on-screen buttons; only used where they crowd the popups. */
  measureSafe() {
    this.safeDirty = false;
    const { w, h } = this.view.size;
    // Popups are centred, so only panels over the middle of the screen can collide with them.
    const rects = [...this.el.hud.querySelectorAll('.panel')]
      .map((p) => p.getBoundingClientRect())
      .filter((r) => r.height > 0 && r.left < w * 0.65 && r.right > w * 0.35);
    const tops = rects.filter((r) => r.top < h / 2).map((r) => r.bottom);
    const bottoms = rects.filter((r) => r.top >= h / 2).map((r) => r.top);
    const touch = document.getElementById('touch');
    if (!touch.classList.contains('hidden')) bottoms.push(touch.getBoundingClientRect().top);
    this.safe = { top: Math.max(0, ...tops) + 8, bottom: Math.min(h - 26, ...bottoms) - 8 };
  }

  popupShift(sy) {
    if (!this.safe) return 0;
    const h = this.view.size.h;
    const s = this.scale;
    // Shift each group as a block so the lines inside it keep their spacing.
    if (sy < 0.5) return Math.max(0, this.safe.top - (0.17 * h - 52 * s * 1.2 * 0.6));
    return Math.min(0, this.safe.bottom - (0.905 * h + 26 * s * 0.6));
  }

  updatePopups(game) {
    const live = new Set();
    let maxO = 0;
    const { w, h } = this.view.size;
    for (const p of game.popups) {
      if (p.t < 0) continue;
      live.add(p.id);
      let el = this.popupEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = p.big ? 'popup big' : 'popup';
        el.textContent = p.text;
        el.style.color = p.color;
        el.style.fontSize = `${Math.round(p.size * this.scale * (p.big ? 1.2 : 1))}px`;
        this.el.popups.append(el);
        this.popupEls.set(p.id, el);
      }
      const life = p.dur;
      const appear = Math.min(1, p.t / 0.28);
      const s = p.big ? easeOutBack(appear) : 0.85 + 0.15 * appear;
      const fade = Math.min(1, appear * 2, (life - p.t) / 0.4);
      let x;
      let y;
      if (p.sy !== null) {
        x = w / 2;
        y = p.sy * h + this.popupShift(p.sy) - p.t * 10 * this.scale;
      } else {
        const q = this.view.project(p.x, p.y);
        x = q.x;
        // Near the ground the anchor sits behind the HUD bar or the touch buttons, so the text starts above them.
        const floor = this.safe ? this.safe.bottom - p.size * this.scale * 0.6 : Infinity;
        y = Math.min(q.y, floor) - p.t * 24 * this.scale;
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%) scale(${s.toFixed(3)})`;
      // A fade-to-black or the end card ends a popup for good, so it can't linger into the next shot.
      if (this.dip >= 0.25 || this.popupExit <= 0) this.cut.add(p.id);
      const exit = this.cut.has(p.id) ? 0 : Math.min(1 - this.dip * 4, this.popupExit);
      const o = Math.max(0, fade * exit);
      if (o > maxO) maxO = o;
      el.style.opacity = o.toFixed(3);
    }
    for (const [id, el] of this.popupEls) {
      if (!live.has(id)) {
        el.remove();
        this.popupEls.delete(id);
        this.cut.delete(id);
      }
    }
    this.popupMax = maxO;
  }

  updateBanner(game) {
    const b = game.banner;
    const e = this.el;
    if (!b) {
      e.banner.style.opacity = '0';
      this.bannerRef = null;
      return;
    }
    if (b !== this.bannerRef) {
      this.bannerRef = b;
      this.bannerIn = 0;
      this.bannerT = game.t;
    }
    // The banner only starts fading in once no popup is visible, so the two never share the screen.
    if (this.popupMax < 0.02) this.bannerIn += Math.max(0, game.t - this.bannerT);
    this.bannerT = game.t;
    this.set('bannerT', e.bannerTitle, 'text', b.text);
    this.set('bannerS', e.bannerSub, 'text', b.sub || '');
    this.set('bannerC', e.banner, 'class', b.gold ? 'banner gold' : 'banner');
    const fin = Math.min(1, this.bannerIn / 0.25);
    const fout = Math.min(1, (b.dur - b.t) / 0.45);
    const o = Math.max(0, Math.min(fin, fout)) * (1 - this.dip);
    e.banner.style.opacity = o.toFixed(3);
    e.banner.style.transform = `translate(-50%, -50%) scale(${(1.06 - 0.06 * fin).toFixed(3)})`;
    e.bannerTitle.style.letterSpacing = `${(0.3 - 0.14 * fin).toFixed(3)}em`;
  }

  demoCards(frame, titleFrames, overAt, endFrames, game) {
    const e = this.el;
    if (frame < titleFrames + 2) {
      const o = Math.min(1, frame / 8, (titleFrames - frame) / 22);
      e.demoTitle.classList.remove('hidden');
      e.demoTitle.style.opacity = Math.max(0, o).toFixed(3);
      e.demoTitle.style.transform = `scale(${(1 + frame * 0.0004).toFixed(4)})`;
    } else {
      e.demoTitle.classList.add('hidden');
    }
    // Popups clear within 8 frames of game over; the end card only starts fading in after that.
    this.popupExit = overAt >= 0 ? Math.max(0, 1 - (frame - overAt) / 8) : 1;
    if (overAt >= 0) {
      const u = (frame - overAt - 10) / 26;
      e.demoEnd.classList.remove('hidden');
      document.body.classList.add('demo-end');
      e.demoEnd.style.opacity = Math.min(1, Math.max(0, u)).toFixed(3);
      e.demoScore.textContent = game.score.toLocaleString('en-US');
      const s = game.stats;
      e.demoStats.textContent = `${game.round} rounds · ${s.catches} catches · ${s.perfects} perfect · ${s.doubles} double`;
      return Math.min(1, Math.max(0, 1 - u));
    }
    e.demoEnd.classList.add('hidden');
    return 1;
  }
}
