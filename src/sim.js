import { createRng } from './rng.js';

// World units are CSS-ish pixels in a 720 px tall world. Width varies with the viewport aspect.
export const DT = 1 / 60;
export const PX_PER_M = 4;
export const WORLD_H = 720;
export const GROUND_Y = 690;
export const TOWER_TOP = 96;
export const G = 9.81 * PX_PER_M;

export const ARM_MIN = 210;
export const ARM_MAX = 410;
export const ARM_DEFAULT = 330;
export const ARM_SPEED = 150;
export const ARM_REACH = 104;
export const ARM_PIVOT = 36;
export const ARM_LEN = 132;
export const TOWER_HALF = 30;

export const CATCH_TOL_Y = 12;
export const CATCH_TOL_X = 15;
export const CATCH_MAX_VY = 3;

/** Booster geometry relative to its catch point (the hardpoints just below the grid fins). */
export const BOOSTER = { halfW: 18, top: -48, bottom: 264, center: 108 };
export const BURN_ALT_M = 112;
export const DOUBLE_UNLOCK_SCORE = 3000;
export const START_LIVES = 3;
export const CLOSE_TIME = 0.1;

const A_BURN = 85;
const A_MAX = 135;
const THRUST_ACC = 85;
const FUEL_RATE = 26;
const REOPEN_DELAY = 0.35;
const SECOND_BOOSTER_DELAY = 2.2;
const SPAWN_Y = -270;
const INTRO_TIME = 0.8;
const OUTRO_TIME = 1.3;
const UNLOCK_TIME = 1.8;
const MAX_PARTICLES = 900;

export const NO_INPUT = Object.freeze({ left: false, right: false, up: false, down: false, close: false });

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function towerPositions(W) {
  const a = Math.round(Math.min(W * 0.64, W - 96));
  const b = Math.round(Math.max(W * 0.17, 72));
  return { a, b };
}

function makeTower(idx, side, x) {
  return {
    idx,
    side, // -1: arms reach left of the tower, +1: arms reach right
    x,
    cx: x + side * ARM_REACH,
    armY: ARM_DEFAULT,
    armVel: 0,
    open: 1,
    closing: false,
    reopenT: 0,
    holding: null,
    bounce: 0,
    bounceV: 0,
    rise: 1,
    ready: false,
  };
}

export class Game {
  constructor({ width = 1280, seed = 1, maxRounds = Infinity, overrides = null } = {}) {
    this.W = width;
    this.seed = seed >>> 0;
    this.maxRounds = maxRounds;
    this.overrides = overrides || {};
    this.rng = createRng(this.seed);
    this.fx = createRng((this.seed ^ 0x9e3779b9) >>> 0);
    this.frame = 0;
    this.t = 0;
    this.phase = 'ready';
    this.phaseT = 0;
    this.score = 0;
    this.round = 0;
    this.lives = START_LIVES;
    this.doubleUnlocked = false;
    this.roundDouble = false;
    const pos = towerPositions(width);
    this.towers = [makeTower(0, -1, pos.a)];
    this.boosters = [];
    this.particles = [];
    this.popups = [];
    this.banner = null;
    this.shake = 0;
    this.flash = 0;
    this.flashColor = '255,255,255';
    this.wind = { base: 0, gusts: [] };
    this.roundT = 0;
    this.gust = 0;
    this.events = [];
    this.stats = { catches: 0, perfects: 0, misses: 0, doubles: 0 };
    this.nextId = 1;
    this.pid = 1;
  }

  start() {
    this.beginRound();
  }

  setPhase(p) {
    this.phase = p;
    this.phaseT = 0;
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  // ---------------------------------------------------------------- rounds

  difficulty() {
    return Math.min(this.round - 1, 9);
  }

  makeBoosterParams(towerIdx, slot) {
    const r = this.rng;
    const d = this.difficulty();
    const tw = this.towers[towerIdx];
    const toward = -tw.side;
    const towardTower = r.chance(0.3);
    const p = {
      vy0: (44 + d * 3.5) * PX_PER_M + r.range(-8, 8),
      vHover: Math.min(2.6, 1.3 + d * 0.17) * PX_PER_M,
      hoverLen: Math.max(7, 22 - d * 2.2),
      zeroY: r.range(ARM_MIN + 30, ARM_MAX - 15),
      spawnDx: towardTower ? toward * r.range(15, 42) : -toward * r.range(60 + d * 10, 110 + d * 16),
      vx0: r.range(-12 - d * 4, 12 + d * 4),
    };
    const o = this.overrides[this.round]?.boosters?.[slot];
    return o ? { ...p, ...o } : p;
  }

  makeWind() {
    const r = this.rng;
    const d = this.difficulty();
    const base = r.sign() * r.range(3, 6 + d * 3);
    const n = d >= 1 ? 1 + (d >= 3 ? 1 : 0) + (d >= 5 ? 1 : 0) : 0;
    const gusts = [];
    for (let i = 0; i < 3; i++) {
      const g = { t0: r.range(1.0, 4.2), dur: r.range(0.7, 1.3), amp: r.sign() * r.range(35 + d * 6, 55 + d * 8) };
      if (i < n) gusts.push(g);
    }
    const o = this.overrides[this.round]?.wind;
    return o ? { base, gusts, ...o } : { base, gusts };
  }

  beginRound() {
    this.round++;
    for (const b of this.boosters) if (b.state !== 'gone') b.state = 'leaving';
    for (const tw of this.towers) {
      tw.holding = null;
      tw.closing = false;
      tw.reopenT = 0.25;
    }
    this.roundDouble = this.doubleUnlocked && this.towers.length > 1;
    this.params = [this.makeBoosterParams(0, 0)];
    if (this.roundDouble) this.params.push(this.makeBoosterParams(1, 1));
    this.wind = this.makeWind();
    this.roundT = 0;
    this.roundCatches = 0;
    const windKt = Math.round((Math.abs(this.wind.base) / PX_PER_M) * 1.94 * 2);
    this.banner = {
      text: `ROUND ${this.round}`,
      sub: this.roundDouble ? 'double catch · two boosters inbound' : `wind ${windKt} kt ${this.wind.base > 0 ? '→' : '←'}`,
      t: 0,
      dur: 1.6,
    };
    this.setPhase('intro');
    this.emit('round', { round: this.round });
  }

  spawnRound() {
    this.params.forEach((p, i) => {
      const tw = this.towers[i];
      this.boosters.push({
        id: this.nextId++,
        tower: i,
        slot: i,
        x: clamp(tw.cx + p.spawnDx, 40, this.W - 40),
        y: SPAWN_Y,
        vx: p.vx0,
        vy: p.vy0,
        fuel: 100,
        state: i === 0 ? 'falling' : 'waiting',
        delay: i * SECOND_BOOSTER_DELAY,
        throttle: 0,
        burning: false,
        cutoff: false,
        tilt: 0,
        rcs: 0,
        zeroY: p.zeroY,
        vHover: p.vHover,
        hoverLen: p.hoverLen,
        rot: 0,
        rotV: 0,
        alpha: 1,
        snapT: 0,
        from: null,
        lifeLost: false,
      });
    });
  }

  endRound() {
    if (this.lives <= 0 || this.round >= this.maxRounds) {
      this.setPhase('over');
      this.emit('gameover', { score: this.score });
      return;
    }
    if (!this.doubleUnlocked && this.score >= DOUBLE_UNLOCK_SCORE) {
      this.doubleUnlocked = true;
      for (const b of this.boosters) if (b.state !== 'gone') b.state = 'leaving';
      for (const tw of this.towers) {
        tw.holding = null;
        tw.reopenT = 0.3;
      }
      const t = makeTower(1, 1, towerPositions(this.W).b);
      t.rise = 0;
      this.towers.push(t);
      this.banner = { text: 'DOUBLE CATCH UNLOCKED', sub: 'second tower online · two boosters per round', t: 0, dur: UNLOCK_TIME, gold: true };
      this.setPhase('unlock');
      this.emit('unlock');
      return;
    }
    this.beginRound();
  }

  // ---------------------------------------------------------------- queries

  activeBooster() {
    let best = null;
    for (const b of this.boosters) {
      if (b.state === 'falling') return b;
      if (b.state === 'waiting' && !best) best = b;
    }
    return best;
  }

  activeTower() {
    const b = this.activeBooster();
    return b ? this.towers[b.tower] : this.towers[0];
  }

  altitudeM(b) {
    return (GROUND_Y - (b.y + BOOSTER.bottom)) / PX_PER_M;
  }

  windAt(t) {
    let g = 0;
    for (const gu of this.wind.gusts) {
      const u = (t - gu.t0) / gu.dur;
      if (u > 0 && u < 1) g += gu.amp * Math.sin(Math.PI * u) ** 2;
    }
    this.gust = g;
    return this.wind.base + g;
  }

  roundResolved() {
    return this.boosters.every((b) => b.state !== 'waiting' && b.state !== 'falling' && b.state !== 'tumbling');
  }

  hud() {
    const b = this.activeBooster();
    const tw = this.activeTower();
    const out = {
      score: this.score,
      round: this.round,
      lives: this.lives,
      phase: this.phase,
      gust: Math.abs(this.gust) > 12 ? Math.sign(this.gust) : 0,
      ready: tw.ready,
      booster: null,
      towerIdx: tw.idx,
      double: this.roundDouble,
    };
    if (b && (b.state === 'falling' || b.state === 'waiting')) {
      out.booster = {
        alt: this.altitudeM(b),
        vs: b.vy / PX_PER_M,
        lat: (b.x - tw.cx) / PX_PER_M,
        latPx: b.x - tw.cx,
        fuel: b.fuel,
        burning: b.burning,
        cutoff: b.cutoff,
        waiting: b.state === 'waiting',
      };
    }
    return out;
  }

  // ---------------------------------------------------------------- step

  step(input = NO_INPUT) {
    this.frame++;
    this.t += DT;
    this.phaseT += DT;
    const live = this.phase === 'live';

    switch (this.phase) {
      case 'intro':
        if (this.phaseT >= INTRO_TIME) {
          this.spawnRound();
          this.setPhase('live');
        }
        break;
      case 'live':
        this.roundT += DT;
        break;
      case 'outro':
        if (this.phaseT >= OUTRO_TIME) this.endRound();
        break;
      case 'unlock': {
        const tw = this.towers[1];
        const prev = tw.rise;
        tw.rise = clamp((this.phaseT - 0.2) / 1.2, 0, 1);
        if (tw.rise > 0 && tw.rise < 1) this.spawnDust(tw.x, 5);
        if (prev < 1 && tw.rise >= 1) {
          this.shake = Math.max(this.shake, 5);
          this.emit('towerUp');
        }
        if (this.phaseT >= UNLOCK_TIME) this.beginRound();
        break;
      }
      default:
        break;
    }

    if (live) this.windAt(this.roundT);
    else this.gust *= 0.9;

    this.updateTowers(live ? input : NO_INPUT, live || this.phase === 'intro');
    this.updateBoosters(live ? input : NO_INPUT, live);
    if (live && this.roundResolved()) this.setPhase('outro');
    this.updateParticles();

    for (const p of this.popups) p.t += DT;
    this.popups = this.popups.filter((p) => p.t < p.dur);
    if (this.banner) {
      this.banner.t += DT;
      if (this.banner.t >= this.banner.dur) this.banner = null;
    }
    this.shake = Math.max(0, this.shake - DT * 28);
    this.flash = Math.max(0, this.flash - DT * 2.2);
  }

  updateTowers(input, armsLive) {
    const active = this.activeTower();
    const ab = this.activeBooster();
    for (const tw of this.towers) {
      const isActive = tw === active && armsLive && !tw.holding;
      const dir = isActive ? (input.down ? 1 : 0) - (input.up ? 1 : 0) : 0;
      tw.armVel += (dir * ARM_SPEED - tw.armVel) * Math.min(1, DT * 16);
      tw.armY += tw.armVel * DT;
      if (tw.armY < ARM_MIN || tw.armY > ARM_MAX) {
        tw.armY = clamp(tw.armY, ARM_MIN, ARM_MAX);
        tw.armVel = 0;
      }

      if (tw === active && input.close && tw.open >= 1 && !tw.closing && !tw.holding && tw.reopenT <= 0) {
        tw.closing = true;
        this.emit('close');
      }
      if (tw.closing) {
        tw.open = Math.max(0, tw.open - DT / CLOSE_TIME);
        if (tw.open <= 0) {
          tw.closing = false;
          this.evaluateCatch(tw);
        }
      } else if (!tw.holding) {
        if (tw.reopenT > 0) tw.reopenT -= DT;
        else tw.open = Math.min(1, tw.open + DT / 0.25);
      }

      tw.bounceV += (-220 * tw.bounce - 9 * tw.bounceV) * DT;
      tw.bounce += tw.bounceV * DT;

      tw.ready = false;
      if (tw === active && ab && ab.state === 'falling' && !tw.holding) {
        const dy = ab.y - tw.armY;
        const dx = ab.x - tw.cx;
        tw.ready = Math.abs(dy) <= CATCH_TOL_Y && Math.abs(dx) < CATCH_TOL_X && ab.vy / PX_PER_M < CATCH_MAX_VY;
      }
    }
  }

  updateBoosters(input, live) {
    const active = this.activeBooster();
    for (const b of this.boosters) {
      switch (b.state) {
        case 'waiting':
          b.delay -= DT;
          if (b.delay <= 0) {
            b.state = 'falling';
            this.emit('inbound');
          }
          break;
        case 'falling':
          this.updateFalling(b, live && b === active ? input : NO_INPUT);
          break;
        case 'caught': {
          const tw = this.towers[b.tower];
          b.snapT = Math.min(1, b.snapT + DT / 0.22);
          const e = 1 - (1 - b.snapT) ** 3;
          b.x = b.from.x + (tw.cx - b.from.x) * e;
          b.y = b.from.y + (tw.armY + tw.bounce - b.from.y) * e;
          b.tilt *= 0.85;
          b.throttle *= 0.8;
          break;
        }
        case 'tumbling':
          b.vy += G * DT;
          b.vx *= 0.995;
          b.x += b.vx * DT;
          b.y += b.vy * DT;
          b.rot += b.rotV * DT;
          b.throttle *= 0.85;
          if (b.y + BOOSTER.center + 70 >= GROUND_Y) this.crash(b);
          break;
        case 'crashed':
          b.alpha -= DT * 1.6;
          b.vy += G * DT * 0.3;
          b.y += b.vy * DT * 0.2;
          if (b.alpha <= 0) b.state = 'gone';
          break;
        case 'leaving':
          b.alpha -= DT * 2.4;
          if (b.alpha <= 0) b.state = 'gone';
          break;
        default:
          break;
      }
    }
    this.boosters = this.boosters.filter((b) => b.state !== 'gone');
  }

  updateFalling(b, input) {
    const alt = this.altitudeM(b);
    let ay = G;

    if (!b.burning && !b.cutoff && alt <= BURN_ALT_M) {
      b.burning = true;
      this.emit('ignite');
    }
    if (b.burning && b.y > b.zeroY + b.hoverLen) {
      b.burning = false;
      b.cutoff = true;
      this.addPopup('ENGINE CUTOFF', b.x, b.y + BOOSTER.bottom + 30, { color: '#f2b84b', size: 18, dur: 1.2 });
      this.emit('cutoff');
    }
    if (b.burning) {
      const d = b.zeroY - b.y;
      const profile = d > 0 ? Math.sqrt(2 * A_BURN * d) : 0;
      const vt = Math.max(b.vHover, profile);
      const ff = profile > b.vHover ? A_BURN : 0;
      const acc = clamp(G + ff + 8 * (b.vy - vt), G * 0.3, G + A_MAX);
      b.throttle += (acc / (G + A_MAX) - b.throttle) * 0.35;
      ay = G - acc;
    } else {
      b.throttle *= 0.8;
    }

    const wind = this.windAt(this.roundT);
    const stabilized = b.burning;
    let ax = wind * (stabilized ? 0.5 : 1) - b.vx * (stabilized ? 1.6 : 0.5);
    let thrust = 0;
    if (b.fuel > 0) {
      if (input.left && !input.right) thrust = -1;
      else if (input.right && !input.left) thrust = 1;
    }
    if (thrust) {
      ax += thrust * THRUST_ACC;
      b.fuel = Math.max(0, b.fuel - FUEL_RATE * DT);
      this.spawnRcs(b, thrust);
    }
    b.rcs = thrust;

    b.vx += ax * DT;
    b.vy += ay * DT;
    b.x += b.vx * DT;
    b.y += b.vy * DT;

    const targetTilt = clamp(b.vx * 0.0028 + thrust * 0.035 + wind * 0.0006, -0.14, 0.14);
    b.tilt += (targetTilt - b.tilt) * 0.08;

    this.collideTowers(b);
    if (b.x < 26 || b.x > this.W - 26) {
      b.x = clamp(b.x, 26, this.W - 26);
      b.vx *= -0.4;
    }
    if (b.burning) {
      this.spawnExhaust(b);
      this.spawnGroundBlast(b);
    }
    if (b.y + BOOSTER.bottom >= GROUND_Y) this.crash(b);
  }

  collideTowers(b) {
    for (const tw of this.towers) {
      if (tw.rise < 0.6) continue;
      const lo = tw.x - TOWER_HALF - 6;
      const hi = tw.x + TOWER_HALF + 6;
      const bl = b.x - BOOSTER.halfW;
      const br = b.x + BOOSTER.halfW;
      if (br > lo && bl < hi) {
        const pushLeft = b.x < tw.x;
        b.x = pushLeft ? lo - BOOSTER.halfW : hi + BOOSTER.halfW;
        const impact = Math.abs(b.vx);
        b.vx = (pushLeft ? -1 : 1) * Math.max(18, impact * 0.5);
        const cy = clamp(tw.armY, b.y + BOOSTER.top + 20, b.y + BOOSTER.bottom - 20);
        this.spawnSparks(pushLeft ? lo : hi, cy, 22, pushLeft ? -1 : 1);
        this.shake = Math.max(this.shake, 7);
        this.addPopup('CLANG!', pushLeft ? lo - 40 : hi + 40, cy - 30, { color: '#f2b84b', size: 22, dur: 0.9 });
        this.emit('clang');
      }
    }
  }

  // ---------------------------------------------------------------- catch logic

  evaluateCatch(tw) {
    const b = this.boosters.find((x) => x.tower === tw.idx && x.state === 'falling');
    if (!b) return this.whiff(tw);
    const dy = b.y - tw.armY;
    const dx = b.x - tw.cx;
    const vy = b.vy / PX_PER_M;
    if (Math.abs(dy) <= CATCH_TOL_Y && Math.abs(dx) < CATCH_TOL_X && vy < CATCH_MAX_VY) {
      return this.catchBooster(tw, b, dy, dx, vy);
    }
    const top = b.y + BOOSTER.top;
    const bottom = b.y + BOOSTER.bottom;
    if (Math.abs(dx) < 70 && tw.armY > top - 4 && tw.armY < bottom + 4) {
      let reason = 'missed the hardpoints';
      if (vy >= CATCH_MAX_VY) reason = `too fast · ${vy.toFixed(1)} m/s`;
      else if (Math.abs(dx) >= CATCH_TOL_X) reason = 'off center';
      else if (dy < 0) reason = 'arms too low';
      else reason = 'arms too high';
      return this.clang(tw, b, reason);
    }
    return this.whiff(tw);
  }

  catchBooster(tw, b, dy, dx, vy) {
    const ey = Math.abs(dy) / CATCH_TOL_Y;
    const ex = Math.abs(dx) / CATCH_TOL_X;
    const ev = Math.max(0, vy - 1) / (CATCH_MAX_VY - 1);
    const precision = clamp(1 - (0.4 * ey + 0.4 * ex + 0.2 * ev), 0, 1);
    const perfect = Math.abs(dy) <= 3 && Math.abs(dx) <= 4 && vy <= 2.2;
    const bonus = Math.round(500 * precision);
    const fuelBonus = Math.round(b.fuel * 3);
    const pts = 1000 + bonus + fuelBonus;
    this.score += pts;
    this.stats.catches++;
    if (perfect) this.stats.perfects++;
    this.roundCatches++;

    b.state = 'caught';
    b.from = { x: b.x, y: b.y };
    b.snapT = 0;
    b.burning = false;
    tw.holding = b;
    tw.bounceV = 70;

    const px = tw.cx;
    const py = tw.armY - 8;
    this.spawnSparks(px - BOOSTER.halfW - 3, py, 22, -1);
    this.spawnSparks(px + BOOSTER.halfW + 3, py, 22, 1);
    this.spawnClampVapor(px, py);
    this.shake = Math.max(this.shake, perfect ? 9 : 6);
    this.flash = perfect ? 0.5 : 0.3;
    this.flashColor = perfect ? '255,206,130' : '255,236,214';
    const labelX = clamp(px, 170, this.W - 170);
    this.addPopup(perfect ? 'PERFECT!' : 'NICE CATCH!', labelX, py - 120, {
      color: perfect ? '#f2b84b' : '#f1f2f4',
      size: perfect ? 56 : 44,
      dur: 1.6,
      big: true,
      sy: 0.17,
    });
    this.addPopup(`+${pts.toLocaleString('en-US')}`, labelX, py - 74, { color: '#ffffff', size: 28, dur: 1.6, delay: 0.12, sy: 0.245 });
    this.addPopup(`precision +${bonus} · fuel +${fuelBonus}`, labelX, py - 46, { color: '#c9cdd3', size: 17, dur: 1.6, delay: 0.2, sy: 0.29 });
    this.emit('catch', { perfect, pts });

    if (this.roundDouble && this.roundCatches === 2) {
      this.score += 500;
      this.stats.doubles++;
      this.addPopup('DOUBLE CATCH!', this.W / 2, 200, { color: '#f2b84b', size: 52, dur: 2.0, big: true, delay: 0.35, sy: 0.84 });
      this.addPopup('+500', this.W / 2, 246, { color: '#ffffff', size: 26, dur: 2.0, delay: 0.45, sy: 0.905 });
      this.emit('double');
    }
  }

  loseLife(b) {
    if (b.lifeLost) return;
    b.lifeLost = true;
    this.lives = Math.max(0, this.lives - 1);
    this.stats.misses++;
  }

  clang(tw, b, reason) {
    const side = b.x >= tw.cx ? 1 : -1;
    b.state = 'tumbling';
    b.burning = false;
    b.rotV = side * this.fx.range(1.1, 1.8);
    b.vx += side * 70;
    b.vy = Math.max(b.vy, 30);
    tw.reopenT = 0.6;
    this.loseLife(b);
    this.spawnSparks(b.x, tw.armY, 46, 0);
    this.shake = Math.max(this.shake, 13);
    this.flash = 0.35;
    this.flashColor = '255,120,90';
    const lx = clamp(tw.cx, 150, this.W - 150);
    this.addPopup('MISS', lx, tw.armY - 110, { color: '#f0605a', size: 50, dur: 1.6, big: true, sy: 0.24 });
    this.addPopup(reason, lx, tw.armY - 70, { color: '#f3d2cc', size: 18, dur: 1.6, delay: 0.1, sy: 0.31 });
    this.emit('miss', { reason });
  }

  whiff(tw) {
    tw.reopenT = REOPEN_DELAY;
    this.addPopup('whiff', tw.cx, tw.armY - 40, { color: '#a2a7af', size: 18, dur: 0.8 });
    this.emit('whiff');
  }

  crash(b) {
    const wasFalling = b.state === 'falling';
    b.state = 'crashed';
    b.burning = false;
    b.vy = 0;
    const gx = b.x + (b.rot ? Math.sin(-b.rot) * 60 : 0);
    this.spawnSparks(gx, GROUND_Y - 6, 70, 0);
    for (let i = 0; i < 26; i++) this.spawnFire(gx + this.fx.range(-40, 40), GROUND_Y - this.fx.range(4, 60), this.fx.range(-160, 160), this.fx.range(-260, -40), 0.9);
    this.spawnDust(gx, 18);
    this.shake = Math.max(this.shake, 18);
    this.flash = 0.6;
    this.flashColor = '255,150,80';
    if (wasFalling) {
      this.loseLife(b);
      const lx = clamp(gx, 170, this.W - 170);
      this.addPopup('RUD!', lx, GROUND_Y - 200, { color: '#f0605a', size: 56, dur: 1.8, big: true, sy: 0.24 });
      this.addPopup('rapid unscheduled disassembly', lx, GROUND_Y - 156, { color: '#f3d2cc', size: 17, dur: 1.8, delay: 0.1, sy: 0.31 });
      this.emit('crash');
    } else {
      this.emit('thud');
    }
  }

  addPopup(text, x, y, opts = {}) {
    this.popups.push({ text, x, y, t: -(opts.delay || 0), dur: (opts.dur || 1.4) + (opts.delay || 0), color: opts.color || '#fff', size: opts.size || 24, big: !!opts.big, sy: opts.sy ?? null, id: this.nextId++ });
  }

  // ---------------------------------------------------------------- particles (seeded fx stream)

  pushParticle(p) {
    if (this.particles.length < MAX_PARTICLES) {
      p.id = this.pid++;
      this.particles.push(p);
    }
  }

  spawnFire(x, y, vx, vy, life) {
    this.pushParticle({ k: 0, x, y, vx, vy, t: 0, life: life * this.fx.range(0.6, 1.1), size: this.fx.range(10, 22), grow: 30 });
  }

  spawnExhaust(b) {
    const f = this.fx;
    const n = 2 + Math.round(b.throttle * 5);
    const ex = b.x - Math.sin(b.tilt) * BOOSTER.bottom;
    const ey = b.y + Math.cos(b.tilt) * BOOSTER.bottom;
    const sx = -Math.sin(b.tilt);
    for (let i = 0; i < n; i++) {
      const speed = 240 + b.throttle * 300 + f.range(-50, 50);
      this.pushParticle({
        k: 0,
        x: ex + f.range(-13, 13),
        y: ey + f.range(0, 12),
        vx: b.vx * 0.5 + sx * speed + f.range(-35, 35),
        vy: b.vy * 0.5 + speed,
        t: 0,
        life: f.range(0.22, 0.5),
        size: f.range(9, 17),
        grow: 26,
      });
    }
    if (f.chance(0.35)) {
      this.pushParticle({ k: 1, x: ex + f.range(-10, 10), y: ey + f.range(30, 80), vx: f.range(-20, 20), vy: 120 + f.range(0, 60), t: 0, life: f.range(1.0, 1.8), size: f.range(14, 24), grow: 40 });
    }
  }

  spawnRcs(b, dir) {
    const f = this.fx;
    if (!f.chance(0.7)) return;
    const y = b.y - 34 + f.range(-3, 3);
    this.pushParticle({ k: 3, x: b.x - dir * (BOOSTER.halfW + 2), y, vx: -dir * f.range(150, 230) + b.vx, vy: b.vy * 0.8 + f.range(-25, 25), t: 0, life: f.range(0.25, 0.45), size: f.range(4, 7), grow: 34 });
  }

  spawnSparks(x, y, n, dir, cool = false) {
    const f = this.fx;
    for (let i = 0; i < n; i++) {
      const a = dir === 0 ? f.range(-Math.PI, 0) : dir > 0 ? f.range(-1.3, 0.4) : f.range(Math.PI - 0.4, Math.PI + 1.3);
      const sp = f.range(140, cool ? 320 : 520);
      this.pushParticle({ k: cool ? 6 : 2, x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, life: f.range(0.35, cool ? 0.7 : 1.1), size: 1, grow: 0 });
    }
  }

  /** Exhaust hitting the pad: dust and steam blown out sideways, stronger the closer the engines get. */
  spawnGroundBlast(b) {
    const alt = this.altitudeM(b);
    if (alt > 55) return;
    const f = this.fx;
    const k = (1 - alt / 55) * b.throttle;
    if (!f.chance(0.35 + k * 0.65)) return;
    const ex = b.x - Math.sin(b.tilt) * BOOSTER.bottom;
    const n = 1 + Math.round(k * 3);
    for (let i = 0; i < n; i++) {
      const side = f.chance(0.5) ? 1 : -1;
      this.pushParticle({ k: 4, x: ex + side * f.range(4, 30), y: GROUND_Y - f.range(0, 6), vx: side * f.range(160, 420) * (0.4 + k), vy: f.range(-90, -15), t: 0, life: f.range(0.9, 1.9), size: f.range(14, 30), grow: 46 });
    }
  }

  /** A ring of vented vapor where the arms clamp the booster. */
  spawnClampVapor(x, y) {
    const f = this.fx;
    for (let i = 0; i < 18; i++) {
      const side = i % 2 ? 1 : -1;
      this.pushParticle({ k: 3, x: x + side * (BOOSTER.halfW + f.range(0, 8)), y: y + f.range(-10, 10), vx: side * f.range(60, 190), vy: f.range(-70, 20), t: 0, life: f.range(0.7, 1.4), size: f.range(8, 15), grow: 40 });
    }
  }

  spawnDust(x, n) {
    const f = this.fx;
    for (let i = 0; i < n; i++) {
      this.pushParticle({ k: 4, x: x + f.range(-50, 50), y: GROUND_Y - f.range(0, 10), vx: f.range(-90, 90), vy: f.range(-50, -5), t: 0, life: f.range(0.9, 1.8), size: f.range(12, 26), grow: 34 });
    }
  }

  updateParticles() {
    const f = this.fx;
    const gust = this.gust;
    if (Math.abs(gust) > 14 && f.chance(Math.min(0.9, Math.abs(gust) / 70))) {
      const dir = Math.sign(gust);
      this.pushParticle({ k: 5, x: dir > 0 ? -60 : this.W + 60, y: f.range(30, 620), vx: dir * f.range(700, 1100), vy: f.range(-15, 15), t: 0, life: 1.6, size: f.range(40, 110), grow: 0 });
    }
    const out = [];
    for (const p of this.particles) {
      p.t += DT;
      if (p.t >= p.life) continue;
      switch (p.k) {
        case 0:
          p.vx *= 0.97;
          p.vy *= 0.965;
          p.vy -= 30 * DT;
          if (p.y > GROUND_Y - 6 && p.vy > 0) {
            p.y = GROUND_Y - 6;
            const s = p.vy * 0.85;
            p.vx = (p.vx >= 0 ? 1 : -1) * (Math.abs(p.vx) + s) * f.range(0.6, 1.2);
            p.vy = -s * 0.08;
            if (f.chance(0.08)) this.pushParticle({ k: 1, x: p.x, y: GROUND_Y - 12, vx: p.vx * 0.25, vy: -f.range(15, 50), t: 0, life: f.range(1.4, 2.6), size: f.range(18, 30), grow: 46 });
          }
          break;
        case 1:
        case 4:
          p.vx *= 0.985;
          p.vy *= 0.985;
          if (p.k === 1) p.vy -= 12 * DT;
          if (p.y > GROUND_Y - 8) {
            p.y = GROUND_Y - 8;
            p.vy = -Math.abs(p.vy) * 0.2;
            p.vx *= 1.02;
          }
          break;
        case 2:
        case 6:
          p.vy += G * 4 * DT;
          if (p.y > GROUND_Y - 2 && p.vy > 0) {
            p.y = GROUND_Y - 2;
            p.vy *= -0.35;
            p.vx *= 0.7;
          }
          break;
        case 3:
          p.vx *= 0.9;
          p.vy *= 0.9;
          break;
        default:
          break;
      }
      p.x += p.vx * DT;
      p.y += p.vy * DT;
      out.push(p);
    }
    this.particles = out;
  }
}
