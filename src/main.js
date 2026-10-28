import { Game, DT, NO_INPUT } from './sim.js';
import { View } from './three/view.js';
import { loadModels } from './three/models.js';
import { createDemoRunner, DEMO } from './demo.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { loadBoard, addEntry, renderBoard, fetchGlobal, submitGlobal, normalizeHandle, savedHandle, boardRows, localRows } from './leaderboard.js';
import { AutoQuality } from './quality.js';

const params = new URLSearchParams(location.search);
const DEMO_MODE = params.get('demo') === '1';
const CAPTURE = DEMO_MODE && params.get('capture') === '1';
const EMBED = document.body.classList.contains('embed');
const SITE_URL = __SITE_URL__;
const SOUND_KEY = 'catch-the-booster.sound';
const WORLD_W = 1280;
const $ = (id) => document.getElementById(id);

const canvas = $('gl');
const DEMO_MODEL_WAIT_MS = 6000;
let view;
let ui;

function fit() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  view.resize(w, h);
  ui.setScale(Math.max(0.62, Math.min(1.25, Math.min(w / 1280, h / 720))));
  document.body.classList.toggle('compact', Math.min(w, h) < 600 || w < 700);
  document.body.classList.toggle('tall', w / h < 0.8);
}

function readSoundPref() {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off';
  } catch {
    return true;
  }
}

function writeSoundPref(on) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off');
  } catch {
    // Storage can be blocked in third-party iframes; the toggle still works for this session.
  }
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
  await Promise.all([document.fonts.load('500 40px "Barlow"'), document.fonts.load('600 20px "Barlow"')]).catch(() => {});
}

// ------------------------------------------------------------------ demo

async function runDemo() {
  document.body.classList.add('demo');
  view = createView({ pixelRatio: 1, cinematic: true, samples: 4, preserve: CAPTURE });
  if (!view) return;
  ui = new UI(view);
  fit();
  window.addEventListener('resize', fit);
  const models = loadModels();
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

  // One frame with the procedural models so the canvas isn't blank, then every demo frame uses the same
  // assets: the Blender models if they load in time, otherwise the procedural ones for the whole run.
  draw();
  view.useModels(await Promise.race([models, new Promise((done) => setTimeout(done, DEMO_MODEL_WAIT_MS, null))]));

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
  // Fixed step, so the showcase plays at the same speed at any refresh rate.
  let last = performance.now();
  let acc = 0;
  const tick = (now) => {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    for (let n = 0; acc >= DT && n < 6; n++) {
      advance();
      acc -= DT;
    }
    draw();
    if (!runner.done) requestAnimationFrame(tick);
  };
  draw();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ play

function runGame() {
  view = createView({ pixelRatio: 1, cinematic: false, samples: 4 });
  if (!view) return;
  ui = new UI(view);
  const quality = new AutoQuality(view, { forced: params.get('quality') });
  fit();
  window.addEventListener('resize', fit);
  loadFonts();
  loadModels().then((models) => view.useModels(models));

  const sound = new Sound();
  let game = new Game({ width: WORLD_W, seed: 1 });
  let state = 'title';
  let overTimer = -1;
  let paused = false;
  const held = { left: false, right: false, up: false, down: false };
  let closeLatch = false;

  const titleEl = EMBED ? $('quick-start') : $('title-screen');
  const overEl = $('gameover');
  const touchEl = $('touch');
  const soundBtn = $('sound');
  const shareLink = $('share');
  const form = $('initials-form');
  const handleInput = $('initials');
  const formNote = $('initials-note');

  // Small embeds show fewer rows so the game over actions stay on screen.
  const overRows = () => (document.body.classList.contains('compact') ? 6 : 10);

  /** Shows the worldwide board (with the player's place if they're on it), otherwise this device's best runs. */
  async function showBoard(ol, heading, size, data = null) {
    if (!data) {
      renderBoard(ol, localRows());
      heading.textContent = 'Your best catches';
      data = await fetchGlobal(savedHandle());
    }
    if (data) {
      renderBoard(ol, boardRows(data, size));
      heading.textContent = data.total ? `Worldwide · ${data.total.toLocaleString('en-US')} player${data.total === 1 ? '' : 's'}` : 'Worldwide';
    }
  }
  showBoard($('board-title'), $('board-title-h'), 5);

  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  // The embed always shows on-screen buttons: they are the mouse controls inside an X post.
  const showButtons = EMBED || isTouch;
  Object.defineProperty(window, '__game', { get: () => game });
  window.__view = view;
  Object.defineProperty(window, '__quality', { get: () => ({ level: quality.name, fps: quality.fps, dpr: view.pixelRatio }) });

  function startGame() {
    game = new Game({ width: WORLD_W, seed: (Math.random() * 2 ** 32) >>> 0 });
    game.start();
    view.director.reset();
    ui.resetScore();
    ui.enableCoach();
    state = 'playing';
    overTimer = -1;
    closeLatch = false;
    titleEl.classList.add('hidden');
    overEl.classList.add('hidden');
    touchEl.classList.toggle('hidden', !showButtons);
    document.body.classList.toggle('touch-ui', showButtons);
    document.body.classList.add('playing');
    ui.safeDirty = true;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  }

  function showTitle() {
    state = 'title';
    game = new Game({ width: WORLD_W, seed: 1 });
    view.director.reset();
    showBoard($('board-title'), $('board-title-h'), 5);
    overEl.classList.add('hidden');
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui', 'playing');
    titleEl.classList.remove('hidden');
  }

  function showGameOver() {
    state = 'over';
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui', 'playing');
    const s = game.stats;
    $('go-kicker').textContent = game.lives > 0 ? 'mission report' : 'out of boosters';
    const best = loadBoard()[0]?.score ?? 0;
    if (game.score > best && s.catches > 0) $('go-kicker').textContent = 'new personal best';
    $('go-score').textContent = game.score.toLocaleString('en-US');
    $('go-stats').textContent = `${game.round} round${game.round === 1 ? '' : 's'} · ${s.catches} catch${s.catches === 1 ? '' : 'es'} · ${s.perfects} perfect · ${s.doubles} double`;
    setShareText();
    const canSubmit = s.catches > 0;
    form.classList.toggle('hidden', !canSubmit);
    handleInput.value = savedHandle();
    formNote.textContent = '';
    formNote.classList.remove('placed');
    form.querySelector('.initials-row').classList.remove('hidden');
    form.querySelector('label').classList.remove('hidden');
    showBoard($('board-over'), $('board-over-h'), overRows());
    overEl.classList.remove('hidden');
    // Focusing the input on a phone pops the keyboard over the card, so only desktop gets autofocus.
    if (canSubmit && !isTouch) setTimeout(() => handleInput.focus(), 50);
    else if (!canSubmit) $('again').focus({ preventScroll: true });
  }

  function setShareText(rank = 0) {
    const s = game.stats;
    const pts = game.score.toLocaleString('en-US');
    const text =
      s.catches === 0
        ? 'I tried to catch a falling rocket booster with a launch tower and it did not go well. Your turn:'
        : `I caught ${s.catches} rocket booster${s.catches === 1 ? '' : 's'} with a launch tower${s.perfects ? ` (${s.perfects} perfect)` : ''} for ${pts} pts${rank ? `, #${rank} worldwide` : ''}. Beat that:`;
    shareLink.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${SITE_URL}/`)}`;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const handle = normalizeHandle(handleInput.value);
    if (!handle) {
      formNote.textContent = 'X handles are 1 to 15 letters, numbers or _';
      return;
    }
    const s = game.stats;
    formNote.textContent = 'Submitting…';
    const res = await submitGlobal({ handle, score: game.score, catches: s.catches, perfects: s.perfects, rounds: game.round });
    const { list, index } = addEntry(handle, game.score, game.round);
    if (res?.rank) {
      await showBoard($('board-over'), $('board-over-h'), overRows(), res);
      const place = `#${res.rank.toLocaleString('en-US')} of ${res.total.toLocaleString('en-US')}`;
      formNote.textContent = res.best > game.score ? `Your best is still ${res.best.toLocaleString('en-US')} (${place})` : `You're ${place}`;
      formNote.classList.add('placed');
      setShareText(res.best > game.score ? 0 : res.rank);
    } else if (res?.error) {
      formNote.textContent = res.error;
      return;
    } else {
      renderBoard($('board-over'), localRows(list, index));
      $('board-over-h').textContent = 'Your best catches';
      formNote.textContent = 'Saved on this device';
    }
    form.querySelector('.initials-row').classList.add('hidden');
    form.querySelector('label').classList.add('hidden');
    handleInput.blur();
    $('again').focus({ preventScroll: true });
  });

  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 2200);
  }

  function setSound(on, remember = true) {
    sound.setEnabled(on);
    soundBtn.setAttribute('aria-pressed', String(on));
    if (remember) writeSoundPref(on);
  }

  // Browsers only allow audio after a user gesture, so the AudioContext is created on the first one.
  let unlocked = false;
  const unlockAudio = (ev) => {
    if (unlocked || soundBtn.contains(ev.target)) return;
    unlocked = true;
    if (readSoundPref()) setSound(true, false);
  };
  window.addEventListener('pointerdown', unlockAudio, { capture: true });
  window.addEventListener('keydown', unlockAudio, { capture: true });

  $('play').addEventListener('click', startGame);
  $('quick-play').addEventListener('click', startGame);
  $('again').addEventListener('click', startGame);
  $('to-title').addEventListener('click', showTitle);
  soundBtn.addEventListener('click', () => {
    unlocked = true;
    setSound(!sound.enabled);
  });

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
      if (state === 'title' || (state === 'over' && !(document.activeElement instanceof HTMLButtonElement || document.activeElement instanceof HTMLAnchorElement))) startGame();
    }
    if (ev.code === 'KeyM') {
      unlocked = true;
      setSound(!sound.enabled);
    }
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
      try {
        btn.setPointerCapture(ev.pointerId);
      } catch {
        // Synthetic or already-released pointers can't be captured; the press still counts.
      }
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
    btn.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }

  function step() {
    game.events.length = 0;
    const input = state === 'playing' ? { ...held, close: closeLatch } : NO_INPUT;
    closeLatch = false;
    game.step(input);
    view.stepCamera(game);
    for (const ev of game.events) {
      if (ev.type === 'catch') {
        ui.finishCoach();
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
    const idle = paused || document.hidden;
    if (idle) acc = 0;
    quality.frame(now, !idle);
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
