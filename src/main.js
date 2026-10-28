import { Game, DT, NO_INPUT } from './sim.js';
import { View } from './three/view.js';
import { loadModels } from './three/models.js';
import { createDemoRunner, DEMO } from './demo.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { loadBoard, addEntry, renderBoard, fetchGlobal, submitGlobal, normalizeHandle, savedHandle, boardRows, localRows, clipRows } from './leaderboard.js';
import { AutoQuality } from './quality.js';
import { initialMap, bindMapPicker } from './maps.js';

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
  await Promise.all([document.fonts.load('400 40px "D-DIN"'), document.fonts.load('700 20px "D-DIN"')]).catch(() => {});
}

// ------------------------------------------------------------------ demo

async function runDemo() {
  document.body.classList.add('demo');
  view = createView({ pixelRatio: 1, cinematic: true, titleTime: DEMO.titleFrames * DT, samples: 4, preserve: CAPTURE, map: initialMap(params, { remember: false }) });
  if (!view) return;
  ui = new UI(view);
  fit();
  window.addEventListener('resize', fit);
  const models = loadModels();
  await loadFonts();

  const runner = createDemoRunner();
  const draw = (alpha = 1) => {
    const g = runner.game;
    const hudOpacity = ui.demoCards(runner.frame, DEMO.titleFrames, runner.overAt, DEMO.endFrames, g);
    ui.update(g, { hudOpacity: runner.frame < DEMO.titleFrames ? 0 : hudOpacity, dip: view.director.dip });
    view.render(g, { alpha });
    window.__demoFrame = runner.frame;
    window.__demoInfo = { frame: runner.frame, score: g.score, stats: g.stats, overAt: runner.overAt };
    if (runner.done) window.__demoDone = true;
  };
  const advance = () => {
    if (runner.done) return;
    view.snapshot(runner.game);
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
    draw(Math.min(1, acc / DT));
    if (!runner.done) requestAnimationFrame(tick);
  };
  draw();
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ play

function runGame() {
  view = createView({ pixelRatio: 1, cinematic: false, samples: 4, map: initialMap(params) });
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
  // Map picker on the title and quick-start cards: applied at once on the title screen, and at takeoff.
  const mapPicker = bindMapPicker(view, view.world.map, () => state === 'title');
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
  const boardEl = $('leaderboard');
  const pauseEl = $('pause');

  // At most this many rows. Under the game over score the board stays short, and in small embeds it clears the sound button.
  const compact = () => document.body.classList.contains('compact');
  const boards = {
    full: { ol: $('board'), heading: $('board-h'), size: () => (compact() ? 8 : 10), shown: () => !boardEl.classList.contains('hidden') },
    over: { ol: $('board-over'), heading: $('board-over-h'), size: () => (compact() ? 4 : 6), shown: () => !overEl.classList.contains('hidden') },
  };
  let worldwide = null;
  let boardReq = 0;
  let mine = -1;
  let boardOpener = null;

  /** Fills a board: worldwide with the player's place when we have it, otherwise this device's best runs. */
  function paintBoard(b) {
    if (worldwide) b.heading.textContent = worldwide.total ? `Worldwide · ${worldwide.total.toLocaleString('en-US')} player${worldwide.total === 1 ? '' : 's'}` : 'Worldwide';
    else b.heading.textContent = 'Your best catches';
    // Short windows get fewer rows, so the card's buttons stay on screen without scrolling.
    const card = b.ol.closest('.card');
    for (let size = b.size(); ; size--) {
      const rows = worldwide ? boardRows(worldwide, size) : clipRows(localRows(loadBoard(), mine), size);
      renderBoard(b.ol, rows);
      // Right after a run, an empty board's "no catches yet" would be wrong.
      b.ol.parentElement.classList.toggle('hidden', b === boards.over && !rows.length);
      if (size <= 3 || card.scrollHeight <= card.clientHeight) break;
    }
  }

  async function refreshBoard(b) {
    paintBoard(b);
    // A submit bumps boardReq, so a fetch that finishes after it can't hide the player's new rank.
    const req = ++boardReq;
    const data = await fetchGlobal(savedHandle());
    if (!data || req !== boardReq) return;
    worldwide = data;
    if (b.shown()) paintBoard(b);
  }

  function openBoard(ev) {
    boardOpener = ev.currentTarget;
    boardOpener.closest('.overlay').classList.add('hidden');
    boardEl.classList.remove('hidden');
    $('board-back').focus({ preventScroll: true });
    refreshBoard(boards.full);
  }

  function closeBoard() {
    boardEl.classList.add('hidden');
    boardOpener.closest('.overlay').classList.remove('hidden');
    boardOpener.focus({ preventScroll: true });
  }

  const isTouch = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  // The embed always shows on-screen buttons: they are the mouse controls inside an X post.
  const showButtons = EMBED || isTouch;
  Object.defineProperty(window, '__game', { get: () => game });
  window.__view = view;
  Object.defineProperty(window, '__quality', { get: () => ({ level: quality.name, fps: quality.fps, dpr: view.pixelRatio }) });

  function setPaused(on) {
    paused = on;
    pauseEl.classList.toggle('hidden', !on);
    document.body.classList.toggle('paused', on);
    for (const k in held) held[k] = false;
    closeLatch = false;
    if (!on) {
      if (pauseEl.contains(document.activeElement)) document.activeElement.blur();
      return;
    }
    const s = game.stats;
    $('pause-score').textContent = game.score.toLocaleString('en-US');
    $('pause-stats').textContent = `Round ${game.round} · ${s.catches} catch${s.catches === 1 ? '' : 'es'} · ${game.lives} booster${game.lives === 1 ? '' : 's'} left`;
    $('resume').focus({ preventScroll: true });
  }

  function startGame() {
    setPaused(false);
    mapPicker.apply();
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
    setPaused(false);
    state = 'title';
    game = new Game({ width: WORLD_W, seed: 1 });
    view.director.reset();
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
    mine = -1;
    overEl.classList.remove('hidden');
    refreshBoard(boards.over);
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

  // X frames the embed without allow-forms, so a submit event never fires there. Enter in the field still clicks this button.
  form.querySelector('button[type=submit]').addEventListener('click', async (ev) => {
    ev.preventDefault();
    const handle = normalizeHandle(handleInput.value);
    if (!handle) {
      formNote.textContent = 'X handles are 1 to 15 letters, numbers or _';
      return;
    }
    const s = game.stats;
    formNote.textContent = 'Submitting…';
    boardReq++;
    const res = await submitGlobal({ handle, score: game.score, catches: s.catches, perfects: s.perfects, rounds: game.round });
    const { index } = addEntry(handle, game.score, game.round);
    if (res?.rank) {
      worldwide = res;
      paintBoard(boards.over);
      const place = `#${res.rank.toLocaleString('en-US')} of ${res.total.toLocaleString('en-US')}`;
      formNote.textContent = res.best > game.score ? `Your best is still ${res.best.toLocaleString('en-US')} (${place})` : `You're ${place}`;
      formNote.classList.add('placed');
      setShareText(res.best > game.score ? 0 : res.rank);
    } else if (res?.error) {
      formNote.textContent = res.error;
      return;
    } else {
      mine = index;
      paintBoard(boards.over);
      formNote.textContent = 'Saved on this device';
    }
    form.querySelector('.initials-row').classList.add('hidden');
    form.querySelector('label').classList.add('hidden');
    handleInput.blur();
    $('again').focus({ preventScroll: true });
  });

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
  $('again').addEventListener('click', showTitle);
  for (const b of document.querySelectorAll('.open-board')) b.addEventListener('click', openBoard);
  $('board-back').addEventListener('click', closeBoard);
  $('pause-btn').addEventListener('click', () => state === 'playing' && setPaused(true));
  $('resume').addEventListener('click', () => setPaused(false));
  $('restart').addEventListener('click', startGame);
  $('home').addEventListener('click', showTitle);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') setPaused(true);
  });
  soundBtn.addEventListener('click', () => {
    unlocked = true;
    setSound(!sound.enabled);
  });

  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (ev) => {
    if (ev.target instanceof HTMLInputElement) return;
    if (!boardEl.classList.contains('hidden')) {
      if (ev.code === 'Escape') closeBoard();
      return;
    }
    if (paused) {
      if (ev.code === 'Escape' || ev.code === 'KeyP') setPaused(false);
      else if (ev.code === 'KeyM') setSound(!sound.enabled);
      return;
    }
    const k = KEYMAP[ev.code];
    if (k) {
      held[k] = true;
      ev.preventDefault();
    }
    // Outside a flight, Space and Enter press a focused menu button instead of acting as shortcuts.
    const focused = document.activeElement;
    const onMenuButton = state !== 'playing' && (focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement) && !!focused.closest('.overlay');
    if (ev.code === 'Space' && !onMenuButton) {
      ev.preventDefault();
      if (state === 'playing' && !ev.repeat) closeLatch = true;
      else if (state === 'title' && !ev.repeat) startGame();
    }
    if (ev.code === 'Enter' && !ev.repeat && !onMenuButton) {
      if (state === 'title') {
        ev.preventDefault();
        startGame();
      } else if (state === 'over') showTitle();
    }
    if (ev.code === 'KeyM') {
      unlocked = true;
      setSound(!sound.enabled);
    }
    if ((ev.code === 'KeyP' || ev.code === 'Escape') && state === 'playing') setPaused(true);
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
    view.snapshot(game);
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
    sound.update(paused ? 0 : Math.max(0, ...game.boosters.map((x) => x.throttle)), !paused && state === 'playing' && b && b.rcs !== 0);
    ui.update(game, { dip: view.director.dip });
    view.render(game, { alpha: Math.min(1, acc / DT) });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

if (DEMO_MODE) runDemo();
else runGame();
