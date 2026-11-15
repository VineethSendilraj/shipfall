import { Game, DT, NO_INPUT, LIVE_SPAWN_Y } from './sim.js';
import { View } from './three/view.js';
import { loadModels } from './three/models.js';
import { createDemoRunner, DEMO } from './demo.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { loadBoard, addEntry, renderBoard, fetchGlobal, submitGlobal, normalizeHandle, savedHandle, boardRows, localRows, clipRows } from './leaderboard.js';
import { AutoQuality } from './quality.js';
import { Flight } from './flight.js';
import { createFlightPilot } from './flight-pilot.js';
import { FlightView } from './three/flight-view.js';
import { FlightHud, report } from './flight-hud.js';
import { initialMap, bindMapPicker } from './maps.js';
import { bindHome } from './home.js';
import { Explore } from './explore.js';

const params = new URLSearchParams(location.search);
const DEMO_MODE = params.get('demo') === '1';
// ?flight=1 opens free flight; &pilot=1 lets the scripted pilot fly it; &capture=1 also steps it frame by frame.
const FLIGHT = params.get('flight') === '1';
const CAPTURE = (DEMO_MODE || FLIGHT) && params.get('capture') === '1';
const PILOT = FLIGHT && (CAPTURE || params.get('pilot') === '1');
// ?explore=1&capture=1: Explore is stepped by window.__exploreFrame(dt) instead of the clock, for recordings.
const EXPLORE_CAPTURE = params.get('explore') === '1' && params.get('capture') === '1';
const FLIGHT_SOUNDS = { ignite: 'ignite', stage: 'ignite', close: 'close', catch: 'catch', boosterLost: 'crash', orbit: 'unlock', deploy: 'close', flip: 'ignite', landingBurn: 'ignite', landed: 'catch' };
const EMBED = document.body.classList.contains('embed');
const SITE_URL = __SITE_URL__;
// The launch post on X (https://x.com/<handle>/status/<id>). When set, Post on X quotes it instead of linking the site.
const SHARE_POST = import.meta.env.VITE_SHARE_POST || '';
// Saved mute preference; sound starts on.
const SOUND_KEY = 'shipfall.sound';
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
  view = createView({ pixelRatio: 1, cinematic: false, samples: 4, preserve: CAPTURE, map: initialMap(params) });
  if (!view) return;
  ui = new UI(view);
  const quality = new AutoQuality(view, { forced: params.get('quality') });
  fit();
  window.addEventListener('resize', fit);
  loadFonts();
  const models = loadModels();
  // A capture applies the models once before its first frame, so a late load can't change frames mid-run.
  if (!CAPTURE) models.then((m) => view.useModels(m));

  const sound = new Sound();
  let game = new Game({ width: WORLD_W, seed: 1 });
  let state = 'title';
  // Map picker on the home screen: applied at once there, and at takeoff.
  // Explore has its own picker; after a swap there it re-stages the stack on the new world's mount.
  const mapPicker = bindMapPicker(view, view.world.map, () => state === 'title' || state === 'explore', () => (state === 'explore' ? explore.stage(true) : state === 'title' && explore.mountUnderTower(true)));
  let overTimer = -1;
  let paused = false;
  const held = { left: false, right: false, up: false, down: false };
  let closeLatch = false;
  let flight = null;
  let flightView = null;
  let flightHud = null;
  let pilot = null;

  const titleEl = $('title-screen');
  const overEl = $('gameover');
  const flightOverEl = $('flight-over');
  const touchEl = $('touch');
  const soundBtn = $('sound');
  // Sound is on unless the player turned it off; browsers only start it on the first tap, so show it on from the start.
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
    // The full leaderboard lists everyone it has and scrolls.
    if (b === boards.full) {
      renderBoard(b.ol, worldwide ? boardRows(worldwide, worldwide.entries.length) : localRows(loadBoard(), mine));
      return;
    }
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
    const data = await fetchGlobal(savedHandle(), b === boards.full ? 100 : 0);
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
  // On-screen buttons on every device: touch, the X embed, and desktop too, where they work with the mouse beside the keys.
  const showButtons = true;
  Object.defineProperty(window, '__game', { get: () => game });
  Object.defineProperty(window, '__flight', { get: () => flight });
  Object.defineProperty(window, '__flightView', { get: () => flightView });
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
    if (flight) {
      const t = Math.max(0, Math.floor(flight.t));
      $('pause-score').textContent = `T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      const n = flight.ship.sats ?? 0;
      $('pause-meta').textContent = `Mission · ${n} satellite${n === 1 ? '' : 's'} aboard`;
    } else {
      $('pause-score').textContent = game.score.toLocaleString('en-US');
      $('pause-meta').textContent = `Round ${game.round} · ${game.lives} ${game.lives === 1 ? 'try' : 'tries'} left`;
    }
    setPauseHelp(false);
    $('resume').focus({ preventScroll: true });
  }

  // The pause card's how-to-play: the home screen's panel for the mode being played.
  function setPauseHelp(open) {
    const panel = $('pause-how-panel');
    if (open) {
      const src = document.querySelector(`#title-screen .how [data-mode="${flight ? 'flight' : 'catch'}"]`);
      panel.innerHTML = src ? src.innerHTML : '';
    }
    panel.classList.toggle('hidden', !open);
    $('pause-how').setAttribute('aria-expanded', String(open));
  }
  $('pause-how').addEventListener('click', () => setPauseHelp($('pause-how-panel').classList.contains('hidden')));

  function startGame() {
    // The handle field keeps focus after a game over; the arrow keys belong to the game again.
    if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
    setPaused(false);
    explore.resetMounts();
    mapPicker.apply();
    game = new Game({ width: WORLD_W, seed: (Math.random() * 2 ** 32) >>> 0, target: home.target, spawnY: LIVE_SPAWN_Y, live: true });
    game.start();
    view.director.reset();
    ui.resetScore();
    ui.enableCoach();
    play();
  }

  function restartFlight() {
    setPaused(false);
    flightView.exit();
    flightHud.exit();
    startFlight();
  }

  function startFlight() {
    explore.resetMounts();
    mapPicker.apply();
    flightView ??= new FlightView(view);
    flightHud ??= new FlightHud(ui);
    flightHud.onSkip = skipTo;
    warp = null;
    document.body.classList.remove('warping');
    flight = new Flight({ seed: 1 });
    pilot = PILOT ? createFlightPilot() : null;
    flightView.enter(flight);
    flightHud.enter();
    document.body.classList.add('free-flight');
    play();
  }

  function play() {
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
    if (flight) {
      flightView.exit();
      flightHud.exit();
      flight = null;
      document.body.classList.remove('free-flight');
      flightOverEl.classList.add('hidden');
    }
    state = 'title';
    game = new Game({ width: WORLD_W, seed: 1 });
    view.director.reset();
    overEl.classList.add('hidden');
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui', 'playing');
    titleEl.classList.remove('hidden');
    home.show();
    // The home screen shows the launch mount under the tower, as Explore does (after the models, which split it off).
    Promise.resolve()
      .then(() => explore.models)
      .then(() => state === 'title' && explore.mountUnderTower(true));
  }

  const explore = new Explore({ view, models, game: new Game({ width: WORLD_W, seed: 1 }), onExit: showTitle });
  window.__explore = explore;
  if (EXPLORE_CAPTURE) window.__exploreFrame = (dt) => explore.frame(dt);

  function startExplore(focus = null, opts = {}) {
    state = 'explore';
    titleEl.classList.add('hidden');
    // Explore draws its own stack through View, which would also hold the hero vehicle in the arms.
    view.setShowcase(null);
    explore.enter(focus, opts);
  }

  // Home screen modes, in picker order. `targets`: the player picks what to catch.
  const MODES = [
    { id: 'catch', label: 'Catch', targets: true, start: startGame },
    { id: 'flight', label: 'Mission', title: 'Mission', blurb: 'Launch to orbit, deploy satellites, land', start: startFlight },
    { id: 'explore', label: 'Explore', title: 'Explore', blurb: 'The stack up close and catch replays', instant: true, start: () => startExplore() },
  ];
  const home = bindHome({ root: titleEl, modes: MODES, view });

  function showGameOver() {
    state = 'over';
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui', 'playing');
    const s = game.stats;
    $('go-kicker').textContent = game.lives > 0 ? 'mission report' : 'out of boosters';
    const best = loadBoard()[0]?.score ?? 0;
    if (game.score > best && s.catches > 0) $('go-kicker').textContent = 'new personal best';
    $('go-score').textContent = game.score.toLocaleString('en-US');
    $('go-stats').textContent = [
      `${game.round} round${game.round === 1 ? '' : 's'}`,
      `${s.catches} catch${s.catches === 1 ? '' : 'es'}`,
      s.perfects && `${s.perfects} perfect`,
      s.doubles && `${s.doubles} double${s.doubles === 1 ? '' : 's'}`,
    ]
      .filter(Boolean)
      .join(' · ');
    setShareText();
    // Every run can go on the board, a zero included.
    const canSubmit = true;
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

  function showFlightOver() {
    state = 'over';
    touchEl.classList.add('hidden');
    document.body.classList.remove('touch-ui', 'playing');
    const r = report(flight);
    $('fo-title').textContent = r.title;
    $('fo-lede').textContent = r.lede;
    $('fo-sats').textContent = r.sats;
    $('fo-landing').textContent = r.landing;
    $('fo-booster').textContent = r.booster;
    $('fo-time').textContent = r.time;
    $('fo-share').href = postUrl(r.post);
    flightOverEl.classList.remove('hidden');
    $('fo-again').focus({ preventScroll: true });
  }

  function setShareText(rank = 0) {
    const s = game.stats;
    const pts = game.score.toLocaleString('en-US');
    const text =
      s.catches === 0
        ? 'I tried to catch a falling rocket booster with a launch tower and it did not go well. Your turn:'
        : `I caught ${s.catches} rocket booster${s.catches === 1 ? '' : 's'} with a launch tower${s.perfects ? ` (${s.perfects} perfect)` : ''} for ${pts} pts${rank ? `, #${rank} worldwide` : ''}. Beat that:`;
    shareLink.href = postUrl(text);
  }

  function postUrl(text) {
    return `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(SHARE_POST || `${SITE_URL}/`)}`;
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
    $('pause-sound').setAttribute('aria-pressed', String(on));
    $('pause-sound').title = on ? 'Sound on' : 'Sound off';
    if (remember) writeSoundPref(on);
  }

  // Browsers only start audio inside a user gesture (iOS: a touch end or click), so any gesture restarts it while it
  // isn't running: on first load, and after coming back to a page iOS suspended in the background.
  const unlockAudio = (ev) => {
    if (soundBtn.contains(ev.target) || $('pause-sound').contains(ev.target)) return;
    if (sound.enabled && !sound.running && !document.hidden) sound.unlock();
  };
  for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(t, unlockAudio, { capture: true });
  // Sound is on unless the player muted it. The context starts suspended until a gesture where the browser requires one.
  setSound(readSoundPref(), false);

  $('play').addEventListener('click', () => home.start());
  $('again').addEventListener('click', showTitle);
  $('fo-again').addEventListener('click', showTitle);
  for (const b of document.querySelectorAll('.open-board')) b.addEventListener('click', openBoard);
  $('board-back').addEventListener('click', closeBoard);
  $('pause-btn').addEventListener('click', () => state === 'playing' && setPaused(true));
  $('pause-sound').addEventListener('click', () => {
    setSound(!sound.enabled);
  });
  $('resume').addEventListener('click', () => setPaused(false));
  $('restart').addEventListener('click', () => (flight ? restartFlight() : startGame()));
  $('home').addEventListener('click', showTitle);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') setPaused(true);
    // The engine drone would otherwise keep going after switching apps or closing the in-app browser.
    sound.setBackground(document.hidden);
  });
  window.addEventListener('pagehide', () => sound.setBackground(true));
  if (params.get('explore') === '1') startExplore(params.get('focus'));
  // Opening the game plays a short ship catch, then the home screen (?intro=0 skips it).
  else if (!FLIGHT && params.get('intro') !== '0') startExplore('catch', { intro: true });
  else if (state === 'title') explore.models.then(() => state === 'title' && explore.mountUnderTower(true));
  // Once the first screen is up, the other map is built in idle time so switching to it doesn't stall.
  explore.models.then(() => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
    idle(() => view.prebuildMap(view.world.map === 'mars' ? 'starbase' : 'mars'), { timeout: 6000 });
  });
  // The home screen stays hidden until here, so a reload never flashes it before the intro takes over.
  document.documentElement.classList.add('booted');
  soundBtn.addEventListener('click', () => {
    setSound(!sound.enabled);
  });

  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', (ev) => {
    // Typing a handle swallows keys, but not once a round is running (the field can keep focus after a game over).
    if (ev.target instanceof HTMLInputElement && state !== 'playing') return;
    if (state === 'title' && ev.code === 'Escape' && home.closeHelp()) return;
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
    if (state === 'title' && !ev.repeat && (k === 'left' || k === 'right')) home.cycle(k === 'left' ? -1 : 1);
    if (k) {
      held[k] = true;
      ev.preventDefault();
    }
    // Outside a flight, Space and Enter press a focused menu button instead of acting as shortcuts.
    const focused = document.activeElement;
    const onMenuButton = state !== 'playing' && (focused instanceof HTMLButtonElement || focused instanceof HTMLAnchorElement) && !!focused.closest('.overlay, #explore');
    if (ev.code === 'Space' && !onMenuButton) {
      ev.preventDefault();
      if (state === 'playing' && !ev.repeat) closeLatch = true;
      else if (state === 'title' && !ev.repeat) home.start();
    }
    if (ev.code === 'Enter' && !ev.repeat && !onMenuButton) {
      if (state === 'title') {
        ev.preventDefault();
        home.start();
      } else if (state === 'over') showTitle();
    }
    if (ev.code === 'KeyM') {
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

  // iOS shows Copy / Paste / Look Up on a long press anywhere it thinks there's text. Cancelling the touch start
  // stops that; pointer events (the controls, drags, swipes) still arrive. Buttons, links and fields keep their taps.
  document.addEventListener('touchstart', (ev) => {
    if (!ev.target.closest('button, a, input, label, .how, .board')) ev.preventDefault();
  }, { passive: false });
  touchEl.addEventListener('touchstart', (ev) => ev.preventDefault(), { passive: false });
  document.addEventListener('selectstart', (ev) => {
    if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
  });
  document.addEventListener('contextmenu', (ev) => {
    if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
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
    if (flight) return stepFlight();
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

  // Fast-forward to a timeline event: the autopilot flies WARP_STEPS sim steps a frame until the event happens.
  let warp = null;
  const WARP_STEPS = 40;
  function skipTo(mark) {
    if (state !== 'playing' || !flight || flight.marks[mark] != null) return;
    warp = { mark, pilot: createFlightPilot() };
    document.body.classList.add('warping');
  }
  function stepWarp() {
    flightView.snapshot(flight);
    for (let i = 0; i < WARP_STEPS && warp; i++) {
      flight.step(warp.pilot(flight));
      flightView.step(flight);
      if (flight.marks[warp.mark] != null || flight.phase === 'over') {
        warp = null;
        document.body.classList.remove('warping');
      }
    }
    if (flight.phase === 'over' && overTimer < 0) overTimer = 2.6;
  }

  function stepFlight() {
    if (warp && state === 'playing') return stepWarp();
    const input = state !== 'playing' ? NO_INPUT : pilot ? pilot(flight) : { ...held, close: closeLatch };
    closeLatch = false;
    flightView.snapshot(flight);
    flight.step(input);
    flightView.step(flight);
    for (const ev of flight.events) {
      if (FLIGHT_SOUNDS[ev.type]) sound.play(FLIGHT_SOUNDS[ev.type]);
      if (ev.type === 'landed') sound.play('perfect');
      if (ev.type === 'over') {
        overTimer = 2.6;
        if (flight.ship.mode === 'crashed') sound.play('crash');
      }
    }
    if (overTimer > 0) {
      overTimer -= DT;
      if (overTimer <= 0 && state === 'playing') showFlightOver();
    }
  }

  function draw(alpha) {
    if (flight) {
      const f = flight;
      sound.update(Math.max(f.ship.mode === 'stacked' || f.cut ? f.booster.throttle : 0, f.ship.throttle), false);
      flightHud.update(f, { show: state === 'playing', dip: flightView.director.dip });
      flightView.render(f, { alpha });
      return;
    }
    const b = game.activeBooster();
    sound.update(paused ? 0 : Math.max(0, ...game.boosters.map((x) => x.throttle)), !paused && state === 'playing' && b && b.rcs !== 0);
    ui.update(game, { dip: view.director.dip });
    view.render(game, { alpha });
  }

  let last = performance.now();
  let acc = 0;
  let shown = false;
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    acc += dt;
    last = now;
    const idle = paused || document.hidden;
    if (idle) acc = 0;
    quality.frame(now, !idle);
    // The loading screen lifts once there's something to show: the intro's first frame, or any other screen.
    if (!shown && (state !== 'explore' || !explore.intro || explore.replay)) {
      shown = true;
      document.documentElement.classList.add('shown');
    }
    if (state === 'explore') {
      // The sim stays stopped, so it doesn't fast-forward through the time spent exploring.
      acc = 0;
      if (!EXPLORE_CAPTURE) explore.frame(dt);
      // Catch replays (and the intro) roar with the vehicle's engines.
      sound.update(explore.replay ? explore.replay.thr : 0, false);
      requestAnimationFrame(frame);
      return;
    }
    let n = 0;
    while (acc >= DT && n < 6) {
      step();
      acc -= DT;
      n++;
    }
    draw(Math.min(1, acc / DT));
    requestAnimationFrame(frame);
  };

  /** Frame-stepped free flight flown by the scripted pilot, for screenshots and scans: window.__advance(n, render). */
  async function captureFlight() {
    document.documentElement.classList.add('shown');
    view.useModels(await Promise.race([models, new Promise((done) => setTimeout(done, DEMO_MODEL_WAIT_MS, null))]));
    await loadFonts();
    startFlight();
    window.__advance = (n = 1, render = true) => {
      for (let i = 0; i < n; i++) step();
      if (render) draw(1);
      const f = flight;
      return { frame: f.frame, done: state === 'over', t: f.t, real: f.real, phase: f.phase, mode: f.ship.mode, booster: f.booster.state };
    };
    draw(1);
    window.__flightReady = true;
  }

  if (CAPTURE) captureFlight();
  else {
    if (FLIGHT) startFlight();
    requestAnimationFrame(frame);
  }
}

if (DEMO_MODE) runDemo();
else runGame();
