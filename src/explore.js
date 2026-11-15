import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARM_REACH, GROUND_Y, PX_PER_M, VEHICLES, towerPositions } from './sim.js';
import { toX } from './three/director.js';
import { ENGINE_Y, createBooster } from './three/booster.js';
import { createPlume } from './three/effects.js';
import { createStack, SHIELD_Y, SHIP_Y } from './three/stack.js';
import { SPIN, SHIP_ENGINE_Y, createShip, createShipPlume, faceTower } from './three/ship.js';

const $ = (id) => document.getElementById(id);
const { lerp } = THREE.MathUtils;

// The launch mount's ring table top (blender/build_models.py; world.js matches it). The stack stands on it.
const MOUNT_TOP = 22.25;
const BOOSTER_Y = MOUNT_TOP - SHIELD_Y;
const SHIP_PINS = BOOSTER_Y + SHIP_Y;
const TOWER_DX = ARM_REACH / PX_PER_M;
// Middle of the pad and the tank farm: the camera stays within SITE_R of it and the orbit pivot within PIVOT_R.
const SITE = new THREE.Vector3(0, 0, -60);
const SITE_R = 560;
const PIVOT_R = 330;
const FLOOR_Y = 1.5; // over the ground: low enough to look up at the engines from under the mount, above its ground plate
// The camera's near plane is 1 m out and its corners about 1.4 m, so this keeps the model out of the picture.
const CLEAR = 1.6;
const ROUTE_N = 200; // samples per glide when bending it around the model
const BEND_MAX = 40; // longer than any bend needs, since no part of the model is more than about 30 m across
const SLOPE = 0.5; // how fast a bend may grow or shrink, in meters per meter of glide
const END_SLOPE = 3; // the same near the ends, where the camera moves slowly
// A bend also eases in and out over at least SMOOTH samples (about four frames mid-glide), with these weights.
const SMOOTH = 10;
const KERNEL = Array.from({ length: 2 * SMOOTH + 1 }, (_, m) => (SMOOTH + 1 - Math.abs(m - SMOOTH)) / (SMOOTH + 1) ** 2);
const IDLE_S = 8;
const GLIDE_S = 1.2; // a short glide; one across the site takes about twice as long
const AIM_MS = 150;
// The inspection lights fade in from LIGHT_FAR meters off the stack and are full from LIGHT_NEAR.
const LIGHT_FAR = 40;
const LIGHT_NEAR = 25;
const LAMP_LUX = 4.5; // what the camera lamp puts on the nearest part of the model
const FILL_CD = 800;

/**
 * Focus presets in chip and key (1-9) order. Positions are relative to the foot of the stack unless `world`. A `wide`
 * subject keeps its whole width on narrow screens. `labels` names the chip differently on a map.
 */
const PRESETS = [
  { id: 'stack', label: 'Stack', target: [0, 76, 0], camera: [62, 10, 200], fov: 44 },
  // Not framings: replay a catch (see CATCHES below) with the corner cameras.
  { id: 'catch', label: 'Ship catch', replay: 'ship' },
  { id: 'boostercatch', label: 'Booster catch', replay: 'booster' },
  // From below, between two of the mount's legs.
  { id: 'engines', label: 'Engines', target: [0, BOOSTER_Y + ENGINE_Y + 0.35, 0], camera: [0, 10, 6.3], fov: 52, wide: true },
  { id: 'fins', label: 'Grid fins', target: [0, BOOSTER_Y + 4.5, 0], camera: [11, BOOSTER_Y + 12, 14], fov: 40 },
  { id: 'ring', label: 'Hot-stage ring', target: [0, BOOSTER_Y + 10, 0], camera: [10, BOOSTER_Y + 12.5, 14], fov: 36 },
  { id: 'nose', label: 'Nose and tiles', target: [0, SHIP_PINS + 8, 0], camera: [-8, SHIP_PINS + 11, 25.5], fov: 40 },
  { id: 'flaps', label: 'Flaps', target: [0, SHIP_PINS - 25, 0], camera: [-30, SHIP_PINS - 21, 9], fov: 44, wide: true },
  { id: 'chopsticks', label: 'Chopsticks', target: [10, SHIP_PINS - 1, 0], camera: [-6, SHIP_PINS + 8, 40], fov: 46 },
  { id: 'tower', label: 'Tower top', target: [TOWER_DX, 148, 0], camera: [TOWER_DX + 34, 160, 30], fov: 42 },
  { id: 'farm', label: 'Tank farm', labels: { mars: 'Habitat' }, world: true, target: [-170, 14, -268], camera: [-122, 30, -190], fov: 40 },
];

// The stack's outline, measured from its models in meters from the foot. The hull is upright cylinders
// [radius, bottom, top]. The parts that stick out are boxes [angle from +x toward +z, [out from, to],
// [sideways from, to], [bottom, top]]: the catch pins, the grid fins, then the aft and forward flaps, which turn with
// the ship's hull (SPIN) while its pins stay put.
const HULL = [[5.17, 19.2, 142], [3.55, 142, 143], [2.7, 143, 145], [1.8, 145, 147.35]];
const PARTS = [
  ...[0.5, 1.5].flatMap((k) => [86.8, 131.3].map((y) => [k * Math.PI, [4.8, 5.85], [-0.7, 0.7], [y, y + 1.4]])),
  ...[0.25, 0.75, 1.25, 1.75].map((k) => [k * Math.PI, [4.8, 8.95], [-1.85, 1.85], [89.6, 91.3]]),
  [-SPIN, [5.3, 8.6], [-3.2, -1.6], [100.4, 111]],
  [Math.PI - SPIN, [5.4, 8.85], [-2.5, -1.4], [100.4, 111]],
  [-SPIN, [4.8, 7.1], [-2.6, -1.5], [134.9, 140.8]],
  [Math.PI - SPIN, [4.9, 7.25], [-2.1, -1.3], [134.9, 140.8]],
];
// The ship catch replay, after the real one: the ship falls belly first from high over the far side, level with its
// tiles down and its nose away from the tower, relights its three sea-level engines, swings upright leaning slightly
// in, eases into the open arms and they close on its pins. Keys: [seconds, meters out on the far side, meters above
// the catch, rotation about z (pi/2 level, 0 upright, negative leaning toward the tower), throttle].
const CATCH = [
  [0, 300, 1150, Math.PI / 2, 0],
  [6.5, 150, 430, Math.PI * 0.485, 0],
  [7.2, 135, 360, Math.PI * 0.45, 0.9],
  [9.6, 70, 190, -0.14, 1],
  [13.5, 8, 25, -0.05, 0.75],
  [15.2, 0, 0, 0, 0.55],
  [15.6, 0, 0, 0, 0],
];
const CATCH_CLOSE = [15.0, 15.8]; // the arms close on the pins between these times
// The booster's replay, after the real catches: it comes back engines first, slightly tilted, from high over the far
// side, lights its landing burn, brakes and slides sideways into the open arms.
const BOOSTER_CATCH = [
  [0, 260, 1400, 0.12, 0],
  [7.0, 130, 520, 0.08, 0],
  [7.6, 115, 450, 0.06, 1],
  [11.0, 30, 90, 0.03, 0.85],
  [13.5, 0, 6, 0, 0.6],
  [14.8, 0, 0, 0, 0.5],
  [15.2, 0, 0, 0, 0],
];
// Per vehicle: keys, when the arms close, where its pins sit in the arms, how far its middle is below them, its engines.
const CATCHES = {
  ship: { keys: CATCH, close: CATCH_CLOSE, pins: SHIP_PINS, c: VEHICLES.ship.center / PX_PER_M, engineY: SHIP_ENGINE_Y, wobble: 0.7 },
  // The booster is caught as high up the tower as the ship, well clear of the mount; it wobbles as its grid fins steer.
  booster: { keys: BOOSTER_CATCH, close: [14.6, 15.4], pins: SHIP_PINS, c: VEHICLES.booster.center / PX_PER_M, engineY: ENGINE_Y, wobble: 1 },
};
// The intro on opening the game: the ship catch from this many seconds in, played this much faster.
const INTRO = { from: 4.5, speed: 1.6 };
// The tabs' replays skip the first seconds of the vehicle far up the sky.
const REPLAY_FROM = 3;
// Exhaust smoke shows below this height (m), around the tower.
const SMOKE_ALT = 230;
// The Mars haze hides a replay seen from hundreds of meters; it thins to this share while one plays.
const REPLAY_FOG = 0.35;
// The replay's two fixed corner cameras (from the foot): high over the front-left corner, framing the tower and the
// falling ship together, and someone standing at eye height out at the front-right corner. Each aims partway from the
// arms toward the ship, so the tower stays in the shot as the ship comes down to it.
// The aerial camera looks in from this corner direction and backs off just far enough to fit the ship, the arms and the
// tower's foot in the frame for the screen's shape, plus this margin (m) around them.
const CATCH_AIR_DIR = new THREE.Vector3(-0.45, 0.24, 0.86).normalize();
const CATCH_AIR_MARGIN = 45;
const CATCH_GROUND = new THREE.Vector3(240, 1.7, 330);
// The ground view's aim, from the arms toward the vehicle: looking up at it early, settling on the tower by the catch.
const CATCH_AIM = { ground: [0.92, 0.3] };
// Someone on the ground looks up at most this far (radians).
const CATCH_GROUND_UP = 1.2;
// Where the camera sits relative to the ship's middle at the start and at the catch, until the player takes over.
const smooth01 = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** The replay's state at time t: { dx, h, a, thr }, positions on a smooth curve through the keys. */
function catchAt(t, K) {
  const last = K.length - 1;
  if (t >= K[last][0]) return { dx: K[last][1], h: K[last][2], a: K[last][3], thr: K[last][4] };
  let i = 0;
  while (t > K[i + 1][0]) i++;
  const [t0, t1] = [K[i][0], K[i + 1][0]];
  const u = (t - t0) / (t1 - t0);
  // Cubic Hermite with finite-difference slopes keeps the path and speed smooth through the keys.
  const slope = (j, k) => {
    const a = K[Math.max(0, j - 1)];
    const b = K[Math.min(last, j + 1)];
    return ((b[k] - a[k]) / (b[0] - a[0] || 1)) * (t1 - t0);
  };
  const herm = (k) => {
    const [p0, p1, m0, m1] = [K[i][k], K[i + 1][k], slope(i, k), slope(i + 1, k)];
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
  };
  const e = smooth01(u);
  return { dx: herm(1), h: herm(2), a: lerp(K[i][3], K[i + 1][3], e), thr: lerp(K[i][4], K[i + 1][4], e) };
}

const AXES = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].map((a) => new THREE.Vector3(...a));
const probe = new THREE.Vector3();
const push = new THREE.Vector3();
const ahead = new THREE.Vector3();

function setFov(camera, fov) {
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

/** Signed distance to an upright cylinder (negative inside). */
function cylinder(x, z, r, y0, y1) {
  return (p) => {
    const side = Math.hypot(p.x - x, p.z - z) - r;
    const end = Math.abs(p.y - (y0 + y1) / 2) - (y1 - y0) / 2;
    return Math.min(Math.max(side, end), 0) + Math.hypot(Math.max(side, 0), Math.max(end, 0));
  };
}

/** Signed distance to a box centered on (x, y, z) with half sizes hx, hy, hz, turned by yaw about the vertical. */
function box(x, y, z, hx, hy, hz, yaw = 0) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return (p) => {
    const dx = p.x - x;
    const dz = p.z - z;
    const qx = Math.abs(dx * c - dz * s) - hx;
    const qy = Math.abs(p.y - y) - hy;
    const qz = Math.abs(dx * s + dz * c) - hz;
    return Math.min(Math.max(qx, qy, qz), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
  };
}

/** The box around a mesh's geometry, placed by its world matrix, which only turns about the vertical. */
function meshBox(mesh) {
  mesh.geometry.computeBoundingBox();
  const b = mesh.geometry.boundingBox;
  const c = b.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  const h = b.getSize(new THREE.Vector3()).multiply(new THREE.Vector3().setFromMatrixScale(mesh.matrixWorld)).multiplyScalar(0.5);
  const e = mesh.matrixWorld.elements;
  return box(c.x, c.y, c.z, h.x, h.y, h.z, Math.atan2(-e[2], e[0]));
}

/** The direction out of a shape at p, by central differences. */
function outward(shape, p, n) {
  n.set(0, 0, 0);
  for (const a of AXES) n.addScaledVector(a, shape(probe.copy(p).addScaledVector(a, 0.01)));
  return n.normalize();
}

/**
 * Splits a mesh's triangles into those within r meters (horizontally) of p and the rest. The parts get copies of the
 * vertex buffers, since freeing a geometry also frees the buffers of its attributes.
 */
function splitNear(mesh, p, r) {
  const g = mesh.geometry;
  const v = new THREE.Vector3();
  const parts = [[], []];
  mesh.updateWorldMatrix(true, false);
  for (let i = 0; i < g.index.count; i += 3) {
    v.fromBufferAttribute(g.attributes.position, g.index.getX(i)).applyMatrix4(mesh.matrixWorld);
    parts[Math.hypot(v.x - p.x, v.z - p.z) < r ? 0 : 1].push(g.index.getX(i), g.index.getX(i + 1), g.index.getX(i + 2));
  }
  return parts.map((index) => {
    const part = new THREE.BufferGeometry();
    for (const name in g.attributes) part.setAttribute(name, g.attributes[name]);
    return part.setIndex(index).toNonIndexed();
  });
}

/**
 * Returns move(on), which puts the launch mount under the stack or back behind the lane. The props model bakes
 * the mount into world space, and its legs share one mesh with the tank plinths, so the legs are split off. The
 * parts stay in the world's tree, so a map change frees them with the rest of the world.
 */
function mountMover(view, foot) {
  const home = view.world.dressing.mount.position.clone();
  const shift = new THREE.Vector3(foot.x - home.x, 0, foot.z - home.z);
  const steel = view.scene.getObjectByName('props_mountSteel');
  if (!steel) {
    const mount = view.world.dressing.mount;
    return (on) => mount.position.copy(home).addScaledVector(shift, on ? 1 : 0);
  }
  const concrete = view.scene.getObjectByName('props_concrete');
  const [legs, rest] = splitNear(concrete, home, 20).map((geometry) => Object.assign(concrete.clone(), { geometry }));
  legs.position.add(shift);
  concrete.parent.add(legs, rest);
  const moved = [steel, view.scene.getObjectByName('props_dark')].map((m) => [m, m.position.clone()]);
  return (on) => {
    for (const [m, p] of moved) m.position.copy(p).addScaledVector(shift, on ? 1 : 0);
    concrete.visible = !on;
    legs.visible = rest.visible = on;
  };
}

/**
 * Explore mode: the full stack on the launch mount at the tower, with orbit controls, focus presets and an idle
 * turntable. It renders through the game's View with the sim stopped; main.js calls frame() while it's active.
 */
export class Explore {
  /** game: a fresh Game, used only as the static scene description (tower, arms, clock). */
  canSkip = () => true;

  constructor({ view, models, game, onExit }) {
    this.view = view;
    this.models = models;
    this.game = game;
    this.onExit = onExit;
    const tw = game.towers[0];
    // Arms open at the ship's catch pins, as after stacking.
    tw.armY = GROUND_Y - SHIP_PINS * PX_PER_M;
    this.foot = new THREE.Vector3(toX(tw.cx), 0, 0);
    this.active = false;
    this.idle = 0;
    this.flight = null;
    this.shapes = [];
    this.pickables = [];
    this.aimedAt = 0;
    this.raycaster = new THREE.Raycaster();
    this.dir = new THREE.Vector3();
    this.hint = $('explore-hint');
    this.chips = PRESETS.map((p, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.innerHTML = `<kbd>${i + 1}</kbd>${p.label}`;
      chip.addEventListener('click', () => this.focus(p));
      $('explore-chips').append(chip);
      return chip;
    });
    $('explore-back').addEventListener('click', () => this.back());
    $('explore-photo').addEventListener('click', () => this.photo());
    this.viewBtn = $('explore-view');
    this.viewBtn.addEventListener('click', (ev) => {
      if (ev.detail > 0) this.viewBtn.blur();
      this.setGroundView(!this.ground);
    });
    window.addEventListener('keydown', (ev) => this.onKey(ev));
    // Any tap or key skips the intro, unless canSkip says that gesture is needed for something else (turning sound on).
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => this.intro && this.canSkip() && this.finishIntro(), { capture: true });
  }

  /** focus: a preset id to open on, without the glide (?explore=1&focus=engines). */
  /** opts.intro: play the ship catch once with no UI, then go home (also on any tap or key). */
  enter(focus = null, opts = {}) {
    this.intro = !!opts.intro;
    document.body.classList.toggle('intro', this.intro);
    this.active = true;
    this.view.free = true;
    this.controls ??= this.createControls();
    this.controls.enabled = true;
    // The glide starts from the title camera, which hasn't been placed yet when the page opens on ?explore=1.
    const { camera, director, world } = this.view;
    director.apply(camera, this.game, { establish: world.establish });
    // The title looks down on the site, so the glide pivots where its line of sight meets the ground.
    camera.getWorldDirection(this.dir);
    this.controls.target.copy(camera.position).addScaledVector(this.dir, -camera.position.y / this.dir.y);
    for (const [i, p] of PRESETS.entries()) this.chips[i].lastChild.textContent = p.labels?.[world.map] ?? p.label;
    $('explore').classList.remove('hidden');
    document.body.classList.add('exploring');
    // Built before the first focus, so a replay asked for on entry (?focus=catch) can wait on it.
    this.ready ??= this.models.then((m) => this.build(m));
    const start = PRESETS.find((p) => p.id === focus);
    this.focus(start ?? PRESETS[0], !!start);
    // The glide in starts at the title camera, outside the site and the orbit limits.
    if (this.flight) this.flight.outside = true;
    if (!this.hinted) {
      this.hinted = true;
      this.hint.classList.add('on');
      setTimeout(() => this.hint.classList.remove('on'), 6000);
    }
    this.ready ??= this.models.then((m) => this.build(m));
    this.ready.then(() => this.stage(this.active));
  }

  exit() {
    this.active = false;
    this.view.free = false;
    this.controls.enabled = false;
    this.controls.autoRotate = false;
    this.flight = null;
    this.endReplay();
    $('explore').classList.add('hidden');
    document.body.classList.remove('exploring');
    if (this.stack) this.stage(false);
  }

  back() {
    this.exit();
    this.onExit();
  }

  build(models) {
    const { view } = this;
    this.builtModels = models;
    this.stack = createStack(view.boosterMats, view.shipMats, models);
    this.stack.root.position.set(this.foot.x, BOOSTER_Y, this.foot.z);
    view.scene.add(this.stack.root);
    this.hull = HULL.map(([r, y0, y1]) => cylinder(this.foot.x, this.foot.z, r, y0, y1));
    // The engines are off, and their glow discs would hide the insides of the bells.
    this.stack.booster.throatMat.visible = false;
    // Inspection lights for close-ups: a lamp beside the camera, and a spot from under the mount on the engine bells.
    this.lamp = new THREE.PointLight(0xfff2e2, 0, 0, 2);
    this.fill = new THREE.SpotLight(0xfff2e2, 0, 0, THREE.MathUtils.degToRad(22), 0.6, 2);
    this.fill.position.set(this.foot.x, 6, this.foot.z);
    this.fill.target.position.set(this.foot.x, BOOSTER_Y, this.foot.z);
    this.lights = new THREE.Group().add(this.lamp, this.fill, this.fill.target);
    view.scene.add(this.lights);
  }

  stage(on) {
    const { view } = this;
    // The title's map picker can swap in another world, with its own mount, between visits.
    if (this.world !== view.world) {
      this.world = view.world;
      // One mover per world: a cached world comes back with its mount already split off.
      this.movers ??= new WeakMap();
      if (!this.movers.has(view.world)) this.movers.set(view.world, mountMover(view, this.foot));
      this.moveMount = this.movers.get(view.world);
      this.pickables = [this.stack.root, view.towers[0].root, view.scene.getObjectByName('props') ?? view.world.dressing.mount];
    }
    this.stack.root.visible = on && !this.replay;
    this.lights.visible = on;
    this.moveMount(on);
    for (const v of Object.values(this.replayVehicles ?? {})) v.plume.setPalette(view.world.fx);
  }

  /** Moves the launch mount under the tower lane (on) or back (off), as Explore does, for the home screen. */
  mountUnderTower(on) {
    const { view } = this;
    this.movers ??= new WeakMap();
    if (!this.movers.has(view.world)) this.movers.set(view.world, mountMover(view, this.foot));
    this.movers.get(view.world)(on);
    (this.moved ??= new Set())[on ? 'add' : 'delete'](view.world);
  }

  /** Puts every world's mount back where the catch game expects it (cached maps keep theirs otherwise). */
  resetMounts() {
    for (const world of this.moved ?? []) this.movers.get(world)(false);
    this.moved?.clear();
  }

  /** Starts (or restarts) a catch replay of `kind` ('ship' or 'booster'): the stack steps aside for it. */
  startReplay(kind = 'ship') {
    // Only inside Explore: the replay vehicle would otherwise sit in the home screen's tower beside its showcase.
    if (!this.active) return;
    if (!this.stack) {
      this.ready?.then(() => this.active && this.startReplay(kind));
      return;
    }
    const { view } = this;
    this.endReplay();
    this.replayVehicles ??= {};
    if (!this.replayVehicles[kind]) {
      const v = kind === 'ship' ? createShip(view.shipMats, this.builtModels?.ship) : createBooster(view.boosterMats, this.builtModels?.booster);
      if (kind === 'ship') faceTower(v, 1);
      v.plume = kind === 'ship' ? createShipPlume() : createPlume({ boost: 1.45 });
      if (kind === 'booster') v.plume.group.position.y = ENGINE_Y;
      v.root.add(v.plume.group);
      this.replayVehicles[kind] = v;
    }
    const vehicle = this.replayVehicles[kind];
    vehicle.plume.setPalette(view.world.fx);
    view.scene.add(vehicle.root);
    // The arms wait at the vehicle's pins.
    this.game.towers[0].armY = GROUND_Y - CATCHES[kind].pins * PX_PER_M;
    this.thinned = new Map();
    this.replay = { t: this.intro ? INTRO.from : REPLAY_FROM, speed: this.intro ? INTRO.speed : 1, auto: true, kind, vehicle, ...CATCHES[kind] };
    document.body.classList.add('replaying');
    this.flight = null;
    this.stack.root.visible = false;
    // The corner cameras sit outside the orbit limits Explore uses for the stack.
    this.controls.maxTargetRadius = Infinity;
    this.controls.maxDistance = Infinity;
    this.controls.autoRotate = false;
    setFov(view.camera, 55);
    this.stepReplay(0, true);
  }

  /**
   * The double catch, for the share card: a second tower facing the first, its arms closed on a booster caught a moment
   * ago (engines still lit, settling), while the ship replay comes into tower A. The aerial camera frames both towers.
   */
  stageDouble(thr = 0.45) {
    const g = this.game;
    const { view } = this;
    if (!g.towers[1]) {
      const x = towerPositions(g.W).b;
      g.towers[1] = { ...g.towers[0], idx: 1, side: 1, x, cx: x + ARM_REACH, open: 0, closing: false, holding: null, rise: 1, bounce: 0, armVel: 0 };
    }
    const tw = g.towers[1];
    const pins = CATCHES.booster.pins;
    tw.armY = GROUND_Y - pins * PX_PER_M;
    const v = createBooster(view.boosterMats, this.builtModels?.booster);
    v.plume = createPlume({ boost: 1.45 });
    v.plume.group.position.y = ENGINE_Y;
    v.root.add(v.plume.group);
    v.plume.setPalette(view.world.fx);
    v.root.position.set(toX(tw.cx), pins, this.foot.z);
    view.scene.add(v.root);
    this.double = { v, thr, x: toX(tw.cx), foot: toX(tw.x), pins };
  }

  /** Switches the replay between following the ship from above and the fixed camera on the ground. */
  setGroundView(on) {
    this.ground = on;
    this.viewBtn.setAttribute('aria-pressed', String(on));
    this.viewBtn.classList.toggle('on', on);
    setFov(this.view.camera, on ? 62 : 55);
    // Back in the follow view, the camera eases back to its framing around the ship.
    if (!on && this.replay) this.replay.auto = true;
  }

  /** Leaves the intro for the home screen. */
  finishIntro() {
    if (!this.intro) return;
    this.intro = false;
    document.body.classList.remove('intro');
    this.view.handoffFrom(this.view.camera, this.controls.target);
    // The menu fades in once the camera has glided into place.
    document.body.classList.add('from-intro');
    setTimeout(() => document.body.classList.remove('from-intro'), 2600);
    this.back();
  }

  endReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.game.particles = [];
    document.body.classList.remove('replaying');
    if (this.ground) this.setGroundView(false);
    for (const v of Object.values(this.replayVehicles ?? {})) v.root.removeFromParent();
    this.game.towers[0].open = 1;
    this.game.towers[0].armY = GROUND_Y - SHIP_PINS * PX_PER_M;
    for (const [fog, density] of this.thinned ?? []) fog.density = density;
    this.thinned = null;
    this.controls.maxTargetRadius = PIVOT_R;
    this.controls.maxDistance = 520;
    if (this.stack) this.stack.root.visible = this.active;
  }

  /** Advances the replay: places the ship, its flame and the arms, and moves the camera with the ship. */
  stepReplay(dt, snap = false) {
    const r = this.replay;
    const { view } = this;
    r.t += dt * r.speed;
    if (this.intro && r.t > r.close[1] + 0.3) {
      this.finishIntro();
      return;
    }
    const fog = view.scene.fog;
    if (fog && !this.thinned.has(fog)) {
      this.thinned.set(fog, fog.density);
      fog.density *= REPLAY_FOG;
    }
    const s = catchAt(r.t, r.keys);
    r.thr = s.thr;
    if (r.kind === 'ship' && r.t > CATCH[3][0]) {
      // The flip swings a little past its lean, the other way, and settles.
      // Eased in, so the swing starts without a kick.
      const u = r.t - CATCH[3][0];
      s.a += 0.11 * smooth01(u / 0.8) * Math.exp(-u * 0.9) * Math.sin(u * 2.2);
    }
    if (r.wobble) {
      // Fin and flap steering all the way down, belly flop included: slow tilts, rocking and sideways drift that
      // settle over the last few seconds before the arms close.
      const w = r.wobble * (1 - smooth01((r.t - r.close[0] + 4) / 4));
      const t = r.t;
      s.a += w * (0.06 * Math.sin(t * 0.9) + 0.02 * Math.sin(t * 1.7 + 1.3));
      s.dx += w * (6 * Math.sin(t * 0.7 + 0.4) + 2 * Math.sin(t * 1.5));
      s.rock = w * (0.07 * Math.sin(t * 1.1 + 0.7) + 0.02 * Math.sin(t * 2.3));
    }
    const ship = r.vehicle;
    // The keys place the vehicle's middle; the root (its pins) sits r.c up the turned axis from it.
    const mid = new THREE.Vector3(this.foot.x - s.dx, r.pins - r.c + s.h, this.foot.z);
    ship.root.rotation.set(s.rock ?? 0, 0, s.a);
    ship.root.position.set(mid.x - Math.sin(s.a) * r.c, mid.y + Math.cos(s.a) * r.c, mid.z);
    const engineY = ship.root.position.y + Math.cos(s.a) * r.engineY;
    const engineX = ship.root.position.x - Math.sin(s.a) * r.engineY;
    ship.plume.update(s.thr, this.game.t, Math.max(0, engineY - view.world.groundHeight(engineX, mid.z)));
    ship.throatMat.color.setRGB(7 * s.thr + 0.02, 3 * s.thr, 0.9 * s.thr);
    this.replaySmoke(dt * r.speed, engineX, engineY - view.world.groundHeight(engineX, mid.z), s);
    if (this.double) {
      const d = this.double;
      const ey = d.pins + ENGINE_Y;
      d.v.plume.update(d.thr, this.game.t, Math.max(0, ey - view.world.groundHeight(d.x, mid.z)));
      d.v.throatMat.color.setRGB(7 * d.thr + 0.02, 3 * d.thr, 0.9 * d.thr);
    }
    const [c0, c1] = r.close;
    this.game.towers[0].open = 1 - smooth01((r.t - c0) / (c1 - c0));
    // The aim leans from the arms toward the ship. A drag or zoom in the aerial view keeps the player's angle and
    // moves with the aim; the ground view stays put where a person would stand.
    const c = this.controls;
    const arms = new THREE.Vector3(this.foot.x, r.pins - r.c, this.foot.z);
    let aim;
    let air = null;
    if (this.ground) aim = arms.clone().lerp(mid, lerp(CATCH_AIM.ground[0], CATCH_AIM.ground[1], smooth01(r.t / r.close[0])));
    else {
      // Fit the ship, the arms and the tower's foot: aim at the middle of their box, back off along CATCH_AIR_DIR.
      const fit = [mid, arms, new THREE.Vector3(this.foot.x + TOWER_DX, 0, this.foot.z)];
      // Extra sky above the arms (m), for a card with its title at the top.
      if (this.headroom) fit.push(new THREE.Vector3(arms.x, arms.y + this.headroom, arms.z));
      if (this.double) fit.push(new THREE.Vector3(this.double.foot, 0, this.foot.z), new THREE.Vector3(this.double.x, this.double.pins + 20, this.foot.z));
      const box = new THREE.Box3().setFromPoints(fit);
      aim = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2 + CATCH_AIR_MARGIN;
      const v = THREE.MathUtils.degToRad(view.camera.fov) / 2;
      const h = Math.atan(Math.tan(v) * view.camera.aspect);
      air = aim.clone().addScaledVector(CATCH_AIR_DIR, radius / Math.sin(Math.min(v, h)));
    }
    const move = aim.clone().sub(c.target);
    c.target.copy(aim);
    if (this.ground) {
      const g = CATCH_GROUND.clone().add(this.foot);
      g.y = view.world.groundHeight(g.x, g.z) + CATCH_GROUND.y;
      view.camera.position.copy(g);
      // Keep the look within CATCH_GROUND_UP of level.
      const d = aim.clone().sub(g);
      const flat = Math.hypot(d.x, d.z);
      if (d.y > flat * Math.tan(CATCH_GROUND_UP)) c.target.set(aim.x, g.y + flat * Math.tan(CATCH_GROUND_UP), aim.z);
    } else if (r.auto) {
      view.camera.position.lerp(air, snap ? 1 : 1 - Math.exp(-dt * 3));
    } else view.camera.position.add(move);
    this.idle = r.t > r.close[1] + 2 ? this.idle : 0;
  }

  /**
   * Exhaust smoke behind the burning engines and dust blown across the pad once the blast reaches the ground,
   * through the sim's own particles (the view draws them on the tower's plane, where the replay flies).
   */
  replaySmoke(dt, x, alt, s) {
    const g = this.game;
    const f = g.fx;
    const px = x * PX_PER_M + 640;
    const py = GROUND_Y - alt * PX_PER_M;
    const [ex, ey] = [Math.sin(s.a), Math.cos(s.a)];
    if (dt > 0 && s.thr > 0.05) {
      // Exhaust smoke hangs behind the vehicle only once it is down by the tower, thickening as it nears the ground.
      const near = Math.max(0, 1 - alt / SMOKE_ALT);
      for (let n = Math.round(dt * 60 * near * (1 + 1.5 * s.thr)); n > 0; n--) {
        const sp = f.range(150, 260) * s.thr;
        g.pushParticle({ k: 1, x: px + ex * 30 + f.range(-8, 8), y: py + ey * 30, vx: ex * sp + f.range(-25, 25), vy: ey * sp, t: 0, life: f.range(1.2, 2.2), size: f.range(12, 22), grow: 45 });
      }
      // The blast hits the ground below 90 m: billowing dust and steam thrown out both ways.
      const k = Math.max(0, 1 - alt / 90) * s.thr;
      for (let n = Math.round(dt * 60 * k * 6); n > 0; n--) {
        const side = f.chance(0.5) ? 1 : -1;
        g.pushParticle({ k: f.chance(0.7) ? 4 : 1, x: px + side * f.range(4, 40), y: GROUND_Y - f.range(0, 8), vx: side * f.range(160, 460) * (0.5 + k), vy: -f.range(15, 110), t: 0, life: f.range(1.4, 2.6), size: f.range(18, 36), grow: 60 });
      }
    }
    // The sim moves its particles in fixed 1/60 s steps.
    this.smokeT = (this.smokeT ?? 0) + dt;
    for (; this.smokeT >= 1 / 60; this.smokeT -= 1 / 60) g.updateParticles();
  }

  createControls() {
    const canvas = this.view.renderer.domElement;
    // Registered before OrbitControls' own listeners, so the pivot moves before its zoom step.
    canvas.addEventListener('wheel', (ev) => this.active && this.aim(ev.clientX, ev.clientY), { passive: true });
    const touches = new Map();
    canvas.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType !== 'touch') return;
      touches.set(ev.pointerId, ev);
      const [a, b] = touches.values();
      if (b && this.active) this.aim((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
    });
    for (const type of ['pointerup', 'pointercancel']) canvas.addEventListener(type, (ev) => touches.delete(ev.pointerId));

    const c = new OrbitControls(this.view.camera, canvas);
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.zoomToCursor = true;
    c.minDistance = 2.5;
    c.maxDistance = 520;
    c.cursor.copy(SITE);
    c.maxTargetRadius = PIVOT_R;
    c.autoRotateSpeed = 0.9;
    c.addEventListener('start', () => {
      this.wake();
      // Dragging or zooming during the replay hands the camera to the player; it still follows the ship.
      if (this.replay) {
        this.replay.auto = false;
        return;
      }
      // Taking over a glide from outside would snap the camera inside the orbit limits, so it runs to its end.
      if (this.flight?.outside) return;
      this.flight = null;
      for (const chip of this.chips) chip.classList.remove('on');
    });
    c.addEventListener('end', () => (this.idle = 0));
    return c;
  }

  /** Any input: restarts the idle timer (which stops the turntable) and retires the hint. */
  wake() {
    this.idle = 0;
    this.controls.autoRotate = false;
    this.hint.classList.remove('on');
  }

  /** Puts the orbit pivot at the depth of whatever is under the pointer, so zooming closes in on it and stops short. */
  aim(x, y) {
    const now = performance.now();
    if (now - this.aimedAt < AIM_MS) return;
    this.aimedAt = now;
    const { camera, renderer } = this.view;
    const rect = renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, 1 - ((y - rect.top) / rect.height) * 2), camera);
    const { ray } = this.raycaster;
    // The raycaster also hits hidden meshes, such as the mount's legs back behind the lane.
    let d = this.raycaster.intersectObjects(this.pickables).find((h) => h.object.visible)?.distance ?? Infinity;
    if (ray.direction.y < 0) d = Math.min(d, -ray.origin.y / ray.direction.y);
    if (d === Infinity) return;
    this.controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(this.dir), d);
  }

  /** Glides to a preset, or cuts to it when instant. */
  focus(p, instant = false) {
    this.wake();
    this.chips.forEach((chip, i) => chip.classList.toggle('on', PRESETS[i] === p));
    this.chips[PRESETS.indexOf(p)].scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
    if (p.replay) return this.startReplay(p.replay);
    this.endReplay();
    const base = p.world ? new THREE.Vector3() : this.foot;
    const to = { target: new THREE.Vector3(...p.target).add(base), position: new THREE.Vector3(...p.camera).add(base), fov: this.fovFor(p) };
    const { camera } = this.view;
    if (instant) {
      this.flight = null;
      this.controls.target.copy(to.target);
      camera.position.copy(to.position);
      setFov(camera, to.fov);
      return;
    }
    const from = { target: this.controls.target.clone(), position: camera.position.clone(), fov: camera.fov };
    const a = new THREE.Spherical().setFromVector3(from.position.clone().sub(from.target));
    const b = new THREE.Spherical().setFromVector3(to.position.clone().sub(to.target));
    const turn = THREE.MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, Math.PI * 2) - Math.PI;
    // Longer glides take longer, so the camera doesn't sweep past the tower and the arms in a blur.
    const seconds = GLIDE_S * (1 + 0.4 * Math.log1p(from.position.distanceTo(to.position) / 25));
    // Bow out and up in proportion to how far the pivot travels, so the camera swings wide of the stack and the tower.
    // A glide that starts during one from outside can start outside too.
    const f = { t: 0, seconds, from, to, a, b, turn, hop: 0.4 * from.target.distanceTo(to.target), outside: !!this.flight?.outside };
    this.route(f);
    this.flight = f;
  }

  /**
   * A preset's FOV, widened on screens narrower than square (counting the View's tall-screen lift) so its subject
   * still fits across them. A wide subject keeps the preset's FOV from edge to edge.
   */
  fovFor(p) {
    const { size, lift } = this.view;
    const narrow = Math.max(1, (size.h * (1 + lift)) / size.w) ** (p.wide ? 1 : 0.6);
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov / 2)) * narrow));
  }

  /**
   * Puts the pivot and the camera where the glide has them at eased progress e: the pivot moves straight, the camera
   * around it in spherical coordinates, or straight too on a glide that route() put on a line. Both rise on the way.
   */
  glideAt(f, e, target, position) {
    target.lerpVectors(f.from.target, f.to.target, e);
    const bow = f.hop * Math.sin(Math.PI * e);
    if (f.line) position.lerpVectors(f.from.position, f.to.position, e);
    else {
      const radius = Math.exp(lerp(Math.log(f.a.radius), Math.log(f.b.radius), e)) + bow;
      position.setFromSphericalCoords(radius, lerp(f.a.phi, f.b.phi, e), f.a.theta + f.turn * e).add(target);
    }
    // The rise stays small near the ends, where the camera can be under the mount.
    position.y = Math.max(FLOOR_Y, position.y + bow * Math.sin(Math.PI * e));
    return position;
  }

  /**
   * Takes a glide around the model on its curve, on a straight line, or on the curve the long way round when the
   * short way turns more than 120 degrees, whichever needs the smallest bend.
   */
  route(f) {
    const most = (bend) => Math.max(...bend.map((b) => b.length()));
    f.bend = this.bendAround(f);
    if (!most(f.bend)) return;
    const ways = [{ ...f, line: true }];
    if (Math.abs(f.turn) > (2 * Math.PI) / 3) ways.push({ ...f, line: false, turn: f.turn - Math.sign(f.turn) * 2 * Math.PI });
    for (const way of ways) {
      way.bend = this.bendAround(way);
      if (most(way.bend) < most(f.bend)) Object.assign(f, way);
    }
  }

  /**
   * The bend that takes a glide around the model. Each run of samples closer than CLEAR moves along the axis that
   * clears it with the least bend, each sample by what it needs. The bend grows and shrinks by at most SLOPE per
   * meter of glide, eases in and out, and falls to zero at both ends by at most END_SLOPE per meter, so the camera
   * never jumps. Where that leaves a sample short near an end, the clamp slides the camera along the model.
   */
  bendAround(f) {
    const pts = [];
    for (let i = 0; i <= ROUTE_N; i++) pts.push(this.glideAt(f, i / ROUTE_N, new THREE.Vector3(), new THREE.Vector3()));
    // Distance along the glide to each sample.
    const s = [0];
    for (let i = 1; i <= ROUTE_N; i++) s.push(s[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const bend = pts.map(() => new THREE.Vector3());
    const p = new THREE.Vector3();
    const at = (k) => p.copy(pts[k]).add(bend[k]);
    const clear = (k) => this.toModel(at(k)) >= CLEAR;
    const need = new Float64Array(ROUTE_N + 1);
    const eased = new Float64Array(ROUTE_N + 1);
    for (let pass = 0; pass < 3; pass++) {
      let bent = false;
      for (let i = 1; i < ROUTE_N; i++) {
        if (clear(i)) continue;
        let j = i;
        while (j + 1 < ROUTE_N && !clear(j + 1)) j++;
        let best = null;
        for (const axis of AXES) {
          // An axis that needs more than the best cost so far can't win, so its search stops there or at BEND_MAX.
          const limit = Math.min(best?.cost ?? Infinity, BEND_MAX);
          need.fill(0);
          let amount = 0;
          for (let k = i; k <= j && amount < limit; k++) amount = Math.max(amount, (need[k] = this.escape(at(k), axis, limit)));
          if (amount >= limit) continue;
          const run = need.slice(i, j + 1);
          for (let k = 1; k <= ROUTE_N; k++) need[k] = Math.max(need[k], need[k - 1] - SLOPE * (s[k] - s[k - 1]));
          for (let k = ROUTE_N - 1; k >= 0; k--) need[k] = Math.max(need[k], need[k + 1] - SLOPE * (s[k + 1] - s[k]));
          for (let k = 0; k <= ROUTE_N; k++) {
            eased[k] = 0;
            for (let m = -SMOOTH; m <= SMOOTH; m++) eased[k] += (need[k + m] ?? 0) * KERNEL[m + SMOOTH];
          }
          // Easing lowers the peaks, so the eased bend is raised until it covers the run again.
          let raise = 1;
          for (let k = i; k <= j; k++) raise = Math.max(raise, run[k - i] / eased[k]);
          // How far the run and the bent samples stay inside CLEAR or under the floor; that costs far more than length.
          let short = 0;
          for (let k = 0; k <= ROUTE_N; k++) {
            // A smooth minimum, so the bend has no corner where the end limit takes over.
            need[k] = ((raise * eased[k]) ** -4 + (END_SLOPE * Math.min(s[k], s[ROUTE_N] - s[k])) ** -4) ** -0.25;
            if (!need[k] && (k < i || k > j)) continue;
            at(k).addScaledVector(axis, need[k]);
            short = Math.max(short, CLEAR - this.toModel(p), FLOOR_Y - p.y);
          }
          const cost = amount + 1000 * short;
          if (!best || cost < best.cost) best = { cost, axis, bend: need.slice() };
        }
        if (best && Math.max(...best.bend) > 0.01) {
          for (let k = 0; k <= ROUTE_N; k++) bend[k].addScaledVector(best.axis, best.bend[k]);
          bent = true;
        }
        i = j;
      }
      if (!bent) break;
    }
    return bend;
  }

  /** How far p has to move along dir to be clear of the model with a little to spare, or limit if that's less. */
  escape(p, dir, limit) {
    let t = 0;
    for (let d = this.toModel(p); d < CLEAR + 0.25 && t < limit; d = this.toModel(ahead.copy(p).addScaledVector(dir, t))) {
      t += Math.max(CLEAR + 0.25 - d, 0.5);
    }
    return t;
  }

  /** One glide step. */
  fly(dt) {
    const f = this.flight;
    const { camera } = this.view;
    // Updating underneath lets momentum from an earlier drag die out instead of resuming after the glide.
    this.controls.update();
    f.t = Math.min(1, f.t + dt / f.seconds);
    const e = f.t * f.t * (3 - 2 * f.t);
    this.glideAt(f, e, this.controls.target, camera.position);
    const x = e * ROUTE_N;
    const i = Math.min(Math.floor(x), ROUTE_N - 1);
    camera.position.add(push.lerpVectors(f.bend[i], f.bend[i + 1], x - i));
    setFov(camera, lerp(f.from.fov, f.to.fov, e));
    if (f.t === 1) this.flight = null;
  }

  /** Keeps the camera above the ground, inside the site and clear of the model, and the pivot above the ground. */
  clamp() {
    const { camera, world } = this.view;
    const p = camera.position;
    const t = this.controls.target;
    t.y = Math.max(world.groundHeight(t.x, t.z), t.y);
    p.y = Math.max(world.groundHeight(p.x, p.z) + FLOOR_Y, p.y);
    const dx = p.x - SITE.x;
    const dz = p.z - SITE.z;
    const k = SITE_R / Math.hypot(dx, dz);
    if (k < 1 && !this.flight?.outside && !this.replay) p.set(SITE.x + dx * k, p.y, SITE.z + dz * k);
    // More than one round for the corners, where getting out of one shape can put the camera in another.
    for (let round = 0; round < 3; round++) {
      for (const shape of this.shapes) {
        const d = shape(p);
        if (d < CLEAR) p.addScaledVector(outward(shape, p, push), CLEAR - d);
      }
    }
    camera.lookAt(t);
  }

  /**
   * One orbit-controls step, turning the camera after IDLE_S without input (the turntable). The turntable starts
   * only clear of the stack, the tower and its arms, and turns back when it reaches one of them.
   */
  orbit(dt) {
    const c = this.controls;
    const p = this.view.camera.position;
    if (this.idle > IDLE_S && !c.autoRotate) c.autoRotate = !this.blocked(p);
    const was = c.autoRotate && this.blocked(p);
    c.update(dt);
    if (c.autoRotate && !was && this.blocked(p)) c.autoRotateSpeed *= -1;
  }

  /** The model the camera stays clear of, as signed distances to cylinders and boxes. */
  keepOut() {
    const { x, z } = this.foot;
    const shapes = [...this.hull];
    for (const [a, [r0, r1], [s0, s1], [y0, y1]] of PARTS) {
      const r = (r0 + r1) / 2;
      const s = (s0 + s1) / 2;
      const [cos, sin] = [Math.cos(a), Math.sin(a)];
      shapes.push(box(x + r * cos - s * sin, (y0 + y1) / 2, z + r * sin + s * cos, (r1 - r0) / 2, (y1 - y0) / 2, (s1 - s0) / 2, -a));
    }
    // The launch mount: ring table, clamps, ground plate, and six legs 11 m out.
    shapes.push(cylinder(x, z, 14.3, 17.75, MOUNT_TOP), cylinder(x, z, 6.9, 20, 24.5), cylinder(x, z, 9.2, -10, 0.6));
    for (let k = 0; k < 6; k++) shapes.push(cylinder(x + 11 * Math.cos((k * Math.PI) / 3), z + 11 * Math.sin((k * Math.PI) / 3), 2.5, -10, 20));
    // The tower from its base: lattice, top and boom, mast, footing. The carriage and the arms get a box per mesh.
    const tw = this.view.towers[0];
    const t = tw.root.position;
    shapes.push(
      box(t.x, t.y + 70, t.z, 8.5, 80, 8.5),
      box(t.x + 5.15, t.y + 153.7, t.z, 13.65, 3.7, 8.5),
      box(t.x - 3, t.y + 166.2, t.z + 3, 0.65, 8.9, 0.65),
      box(t.x, t.y - 3, t.z, 10, 7, 10),
    );
    tw.carriage.traverse((m) => m.isMesh && shapes.push(meshBox(m)));
    return shapes;
  }

  blocked(p) {
    return this.toModel(p) < CLEAR + 0.5;
  }

  /** Distance from p to the model (negative inside it). */
  toModel(p) {
    let d = Infinity;
    for (const shape of this.shapes) d = Math.min(d, shape(p));
    return d;
  }

  /**
   * Scales the inspection lights to the camera's distance from the stack, so the wide views keep the map's light.
   * The lamp is sized to the nearest part of the model, so a girder or the mount beside the camera doesn't burn out.
   */
  light() {
    const { camera } = this.view;
    const p = camera.position;
    const stack = Math.min(...this.hull.map((h) => h(p)));
    const fade = 1 - THREE.MathUtils.smoothstep(stack, LIGHT_NEAR, LIGHT_FAR);
    const near = Math.min(stack, this.toModel(p));
    // Up and to the right of the camera, so the light shapes the surface instead of flattening it.
    this.lamp.position.set(0.2 * near, 0.3 * near, 0).applyQuaternion(camera.quaternion).add(p);
    this.lamp.intensity = LAMP_LUX * near * near * fade;
    this.fill.intensity = FILL_CD * fade;
  }

  frame(dt) {
    this.game.t += dt;
    this.idle += dt;
    // The intro waits on its models without drawing, so the page never flashes the title camera's look at the ground.
    if (this.intro && !this.replay) return;
    if (this.replay) this.stepReplay(dt);
    if (this.flight) this.fly(dt);
    else this.orbit(dt);
    this.clamp();
    if (this.stack) this.light();
    this.view.render(this.game);
    // Only a render places the tower and its arms.
    if (this.stack && !this.shapes.length) this.shapes = this.keepOut();
  }

  /** Saves the view as a PNG. The canvas doesn't keep its pixels between frames, so it renders one first. */
  photo() {
    this.view.render(this.game);
    this.view.renderer.domElement.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'shipfall.png';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  }

  onKey(ev) {
    if (!this.active || ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (ev.code === 'Escape') this.back();
    const p = PRESETS[Number(ev.key) - 1];
    if (p) this.focus(p);
  }
}
