import { Game, DT, NO_INPUT } from './sim.js';
import { View } from './three/view.js';
import { createDemoRunner, DEMO } from './demo.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { loadBoard, qualifies, addEntry, renderBoard } from './leaderboard.js';

const params = new URLSearchParams(location.search);
const DEMO_MODE = params.get('demo') === '1';
const CAPTURE = DEMO_MODE && params.get('capture') === '1';
const WORLD_W = 1280;
const $ = (id) => document.getElementById(id);

const canvas = $('gl');
let view;
let ui;

function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  view.resize(w, h);
  ui.setScale(Math.max(0.62, Math.min(1.25, Math.min(w / 1280, h / 720))));
}

function createView(opts) {
  try {
    return new View(canvas, opts);
  } catch (err) {
    console.error(err);
    $('error').classList.remove('hidden');
    return null;
  }
}

async function loadFonts() {
  await Promise.all([document.fonts.load('700 40px "Space Grotesk"'), document.fonts.load('700 20px "JetBrains Mono"')]).catch(() => {});
}

// ------------------------------------------------------------------ demo

async function runDemo() {
  document.body.classList.add('demo');
  view = createView({ pixelRatio: 1, cinematic: true, samples: 4, preserve: CAPTURE });
  if (!view) return;
  ui = new UI(view);
  fit();
  window.addEventListener('resize', fit);
  await loadFonts();

  const runner = createDemoRunner();
  const draw = () => {
    const g = runner.game;
    const hudOpacity = ui.demoCards(runner.frame, DEMO.titleFrames, runner.overAt, DEMO.endFrames, g);
    ui.update(g, { hudOpacity: runner.frame < DEMO.titleFrames ? 0 : hudOpacity, dip: view.director.dip });
    view.render(g);
    window.__demoFrame = runner.frame;
    window.__demoInfo = { frame: runner.frame, score: g.score, stats: g.stats, overAt: runner.overAt };
    if (runner.done) window.__demoDone = true;
  };
  const advance = () => {
    if (runner.done) return;
    runner.step();
    view.stepCamera(runner.game);
  };

  if (CAPTURE) {
    window.__advance = (n = 1, render = true) => {
      for (let i = 0; i < n; i++) advance();
      if (render) draw();
      return { frame: runner.frame, done: runner.done, score: runner.game.score };
    };
    draw();
    window.__view = view;
    window.__demoReady = true;
    return;
  }
  const tick = () => {
    advance();
    draw();
    if (!runner.done) requestAnimationFrame(tick);
  };
  draw();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ play

function runGame() {
  view = createView({ pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), cinematic: false, samples: 4 });
  if (!view) return;
  ui = new UI(view);
  fit();
  window.addEventListener('resize', fit);
  loadFonts();

  const sound = new Sound();
  let game = new Game({ width: WORLD_W, seed: 1 });
  let state = 'title';
  let overTimer = -1;
  let paused = false;
  const held = { left: false, right: false, up: false, down: false };
  let closeLatch = false;

  const titleEl = $('title-screen');
  const overEl = $('gameover');
  const touchEl = $('touch');
  const soundBtn = $('sound');
  const form = $('initials-form');
  const initialsInput = $('initials');
  renderBoard($('board-title'));

  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  Object.defineProperty(window, '__game', { get: () => game });

  function startGame() {
    game = new Game({ width: WORLD_W, seed: (Math.random() * 2 ** 32) >>> 0 });
    game.start();
    view.director.reset();
    ui.resetScore();
    state = 'playing';
    overTimer = -1;
    closeLatch = false;
    titleEl.classList.add('hidden');
    overEl.classList.add('hidden');
    touchEl.classList.toggle('hidden', !isTouch);
    document.body.classList.toggle('touch-ui', isTouch);
    canvas.focus?.();
  }

  function showTitle() {
    state = 'title';
    game = new Game({ width: WORLD_W, seed: 1 });
    view.director.reset();
    renderBoard($('board-title'));
    overEl.classList.add('hidden');
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui');
    titleEl.classList.remove('hidden');
  }

  function showGameOver() {
    state = 'over';
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui');
    const s = game.stats;
    $('go-kicker').textContent = game.lives > 0 ? 'mission report' : 'out of boosters';
    $('go-score').textContent = `${game.score.toLocaleString('en-US')} pts`;
    $('go-stats').textContent = `${game.round} round${game.round === 1 ? '' : 's'} · ${s.catches} catch${s.catches === 1 ? '' : 'es'} · ${s.perfects} perfect · ${s.doubles} double`;
    const q = qualifies(game.score);
    form.classList.toggle('hidden', !q);
    renderBoard($('board-over'), loadBoard());
    overEl.classList.remove('hidden');
    if (q) {
      initialsInput.value = '';
      setTimeout(() => initialsInput.focus(), 50);
    } else {
      $('again').focus();
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const { list, index } = addEntry(initialsInput.value, game.score, game.round);
    renderBoard($('board-over'), list, index);
    form.classList.add('hidden');
    $('again').focus();
  });

  async function share() {
    const url = location.origin + location.pathname;
    const text = `i caught the booster: ${game.score.toLocaleString('en-US')} pts — ${url}`;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) toast('Copied to clipboard — paste it anywhere');
    else window.prompt('Copy your score:', text);
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  function setSound(on) {
    sound.setEnabled(on);
    soundBtn.setAttribute('aria-pressed', String(on));
  }

  $('play').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('to-title').addEventListener('click', showTitle);
  $('share').addEventListener('click', share);
  soundBtn.addEventListener('click', () => setSound(!sound.enabled));

  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    const k = KEYMAP[ev.code];
    if (k) {
      held[k] = true;
      ev.preventDefault();
    }
    if (ev.code === 'Space') {
      ev.preventDefault();
      if (state === 'playing' && !ev.repeat) closeLatch = true;
      else if (state === 'title' && !ev.repeat) startGame();
    }
    if (ev.code === 'Enter' && !ev.repeat) {
      if (state === 'title' || (state === 'over' && document.activeElement?.tagName !== 'BUTTON')) startGame();
    }
    if (ev.code === 'KeyM') setSound(!sound.enabled);
    if ((ev.code === 'KeyP' || ev.code === 'Escape') && state === 'playing') {
      paused = !paused;
      toast(paused ? 'Paused — press P to resume' : 'Resumed');
    }
  });
  window.addEventListener('keyup', (ev) => {
    const k = KEYMAP[ev.code];
    if (k) held[k] = false;
  });
  window.addEventListener('blur', () => {
    for (const k in held) held[k] = false;
  });

  for (const btn of touchEl.querySelectorAll('button')) {
    const k = btn.dataset.k;
    const down = (ev) => {
      ev.preventDefault();
      btn.setPointerCapture?.(ev.pointerId);
      btn.classList.add('on');
      if (k === 'close') closeLatch = true;
      else held[k] = true;
    };
    const up = () => {
      btn.classList.remove('on');
      if (k !== 'close') held[k] = false;
    };
    btn.addEventListener('pointerdown', down);
    btn.addEventListener('pointerup', up);
    btn.addEventListener('pointercancel', up);
    btn.addEventListener('lostpointercapture', up);
  }

  function step() {
    game.events.length = 0;
    const input = state === 'playing' ? { ...held, close: closeLatch } : NO_INPUT;
    closeLatch = false;
    game.step(input);
    view.stepCamera(game);
    for (const ev of game.events) {
      if (ev.type === 'catch') {
        sound.play('catch');
        if (ev.perfect) sound.play('perfect');
      } else if (ev.type === 'gameover') {
        overTimer = 1.4;
      } else sound.play(ev.type);
    }
    if (overTimer > 0) {
      overTimer -= DT;
      if (overTimer <= 0 && state === 'playing') showGameOver();
    }
  }

  let last = performance.now();
  let acc = 0;
  const frame = (now) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (paused || document.hidden) acc = 0;
    let n = 0;
    while (acc >= DT && n < 6) {
      step();
      acc -= DT;
      n++;
    }
    const b = game.activeBooster();
    sound.update(Math.max(0, ...game.boosters.map((x) => x.throttle)), state === 'playing' && b && b.rcs !== 0);
    ui.update(game, { dip: view.director.dip });
    view.render(game);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (DEMO_MODE) runDemo();
else runGame();
