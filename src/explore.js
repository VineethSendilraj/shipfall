import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ARM_REACH, GROUND_Y, PX_PER_M } from './sim.js';
import { toX } from './three/director.js';
import { ENGINE_Y } from './three/booster.js';
import { createStack, SHIELD_Y, SHIP_Y } from './three/stack.js';

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
const FLOOR_Y = 1.5; // low enough to look up at the engines from under the mount, above its ground plate
const IDLE_S = 8;
const GLIDE_S = 1.2; // a short glide; one across the site takes about twice as long
const AIM_MS = 150;

/** Focus presets in chip and key (1-9) order. Positions are relative to the foot of the stack unless `world`. */
const PRESETS = [
  { id: 'stack', label: 'Stack', target: [0, 76, 0], camera: [62, 10, 200], fov: 44 },
  // From below, between two of the mount's legs.
  { id: 'engines', label: 'Engines', target: [0, BOOSTER_Y + ENGINE_Y + 0.35, 0], camera: [0, 10, 6.3], fov: 52 },
  { id: 'fins', label: 'Grid fins', target: [0, BOOSTER_Y + 4.5, 0], camera: [11, BOOSTER_Y + 12, 14], fov: 40 },
  { id: 'ring', label: 'Hot-stage ring', target: [0, BOOSTER_Y + 10, 0], camera: [10, BOOSTER_Y + 12.5, 14], fov: 36 },
  { id: 'nose', label: 'Nose and tiles', target: [0, SHIP_PINS + 8, 0], camera: [8, SHIP_PINS + 11, 25.5], fov: 40 },
  { id: 'flaps', label: 'Flaps', target: [0, SHIP_PINS - 25, 0], camera: [9, SHIP_PINS - 21, 30], fov: 44 },
  { id: 'chopsticks', label: 'Chopsticks', target: [10, SHIP_PINS - 1, 0], camera: [-6, SHIP_PINS + 8, 40], fov: 46 },
  { id: 'tower', label: 'Tower top', target: [TOWER_DX, 148, 0], camera: [TOWER_DX + 34, 160, 30], fov: 42 },
  { id: 'farm', label: 'Tank farm', world: true, target: [-170, 14, -268], camera: [-122, 30, -190], fov: 40 },
];

function setFov(camera, fov) {
  if (camera.fov === fov) return;
  camera.fov = fov;
  camera.updateProjectionMatrix();
}

/** Splits a mesh's triangles into those within r meters (horizontally) of p and the rest, sharing its vertex buffers. */
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
    return part.setIndex(index);
  });
}

/**
 * Returns move(on), which puts the launch mount under the stack or back behind the lane. The props model bakes
 * the mount into world space, and its legs share one mesh with the tank plinths, so the legs are split off.
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
  const whole = concrete.geometry;
  const [legGeo, restGeo] = splitNear(concrete, home, 20);
  const legs = concrete.clone();
  legs.geometry = legGeo;
  legs.position.add(shift);
  concrete.parent.add(legs);
  const moved = [steel, view.scene.getObjectByName('props_dark')].map((m) => [m, m.position.clone()]);
  return (on) => {
    for (const [m, p] of moved) m.position.copy(p).addScaledVector(shift, on ? 1 : 0);
    concrete.geometry = on ? restGeo : whole;
    legs.visible = on;
  };
}

/**
 * Explore mode: the full stack on the launch mount at the tower, with orbit controls, focus presets and an idle
 * turntable. It renders through the game's View with the sim stopped; main.js calls frame() while it's active.
 */
export class Explore {
  /** game: a fresh Game, used only as the static scene description (tower, arms, clock). */
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
    window.addEventListener('keydown', (ev) => this.onKey(ev));
  }

  /** focus: a preset id to open on, without the glide (?explore=1&focus=engines). */
  enter(focus = null) {
    this.active = true;
    this.view.free = true;
    this.controls ??= this.createControls();
    this.controls.enabled = true;
    // The glide starts from the title camera, which hasn't been placed yet when the page opens on ?explore=1.
    this.view.director.apply(this.view.camera, this.game);
    this.controls.target.copy(this.view.director.tgt);
    $('explore').classList.remove('hidden');
    document.body.classList.add('exploring');
    const start = PRESETS.find((p) => p.id === focus);
    this.focus(start ?? PRESETS[0], !!start);
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
    this.stack = createStack(view.boosterMats, view.shipMats, models);
    this.stack.root.position.set(this.foot.x, BOOSTER_Y, this.foot.z);
    view.scene.add(this.stack.root);
    this.moveMount = mountMover(view, this.foot);
    this.pickables = [this.stack.root, view.towers[0].root, view.scene.getObjectByName('props') ?? view.world.dressing.mount];
  }

  stage(on) {
    this.stack.root.visible = on;
    this.moveMount(on);
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
    let d = this.raycaster.intersectObjects(this.pickables)[0]?.distance ?? Infinity;
    if (ray.direction.y < 0) d = Math.min(d, -ray.origin.y / ray.direction.y);
    if (d === Infinity) return;
    this.controls.target.copy(camera.position).addScaledVector(camera.getWorldDirection(this.dir), d);
  }

  /** Glides to a preset, or cuts to it when instant. */
  focus(p, instant = false) {
    this.wake();
    this.chips.forEach((chip, i) => chip.classList.toggle('on', PRESETS[i] === p));
    this.chips[PRESETS.indexOf(p)].scrollIntoView({ behavior: instant ? 'auto' : 'smooth', block: 'nearest', inline: 'nearest' });
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
    // Bow out and up in proportion to how far the pivot travels, so the camera swings around or over the stack and
    // the tower instead of through them.
    const f = { t: 0, seconds, from, to, a, b, turn, hop: 0.4 * from.target.distanceTo(to.target) };
    // From a pose the user picked, the short way round can pass through the tower or its arms. Then go the long way
    // round, or else swing wider, if that misses the keep-out boxes (other than one an end is in).
    const walls = this.walls?.filter((w) => !w.containsPoint(from.position) && !w.containsPoint(to.position)) ?? [];
    if (this.crosses(f, walls)) {
      const long = { ...f, turn: f.turn - Math.sign(f.turn) * 2 * Math.PI };
      const wide = { ...f };
      for (let i = 0; i < 8 && this.crosses(wide, walls); i++) wide.hop = 1.4 * wide.hop + 4;
      if (Math.abs(f.turn) > (2 * Math.PI) / 3 && !this.crosses(long, walls)) f.turn = long.turn;
      else if (!this.crosses(wide, walls)) f.hop = wide.hop;
    }
    this.flight = f;
  }

  /**
   * A preset's FOV, widened on screens narrower than square (counting the View's tall-screen lift) so its subject
   * still fits across them.
   */
  fovFor(p) {
    const { size, lift } = this.view;
    const narrow = Math.max(1, (size.h * (1 + lift)) / size.w) ** 0.6;
    return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(p.fov / 2)) * narrow));
  }

  /**
   * Puts the pivot and the camera where the glide has them at eased progress e: the pivot moves straight, the camera
   * around it in spherical coordinates.
   */
  glideAt(f, e, target, position) {
    target.lerpVectors(f.from.target, f.to.target, e);
    const bow = f.hop * Math.sin(Math.PI * e);
    const radius = Math.exp(lerp(Math.log(f.a.radius), Math.log(f.b.radius), e)) + bow;
    position.setFromSphericalCoords(radius, lerp(f.a.phi, f.b.phi, e), f.a.theta + f.turn * e).add(target);
    // The rise stays small near the ends, where the camera can be under the mount.
    position.y += bow * Math.sin(Math.PI * e);
  }

  crosses(f, walls) {
    const target = new THREE.Vector3();
    const position = new THREE.Vector3();
    for (let e = 0.05; e < 1; e += 0.05) {
      this.glideAt(f, e, target, position);
      position.y = Math.max(FLOOR_Y, position.y);
      if (walls.some((w) => w.containsPoint(position))) return true;
    }
    return false;
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
    setFov(camera, lerp(f.from.fov, f.to.fov, e));
    if (f.t === 1) this.flight = null;
  }

  /** Keeps the camera above the ground and inside the site, and the pivot above the ground. */
  clamp() {
    const { camera } = this.view;
    const p = camera.position;
    const t = this.controls.target;
    t.y = Math.max(0, t.y);
    p.y = Math.max(FLOOR_Y, p.y);
    const dx = p.x - SITE.x;
    const dz = p.z - SITE.z;
    const k = SITE_R / Math.hypot(dx, dz);
    if (k < 1) p.set(SITE.x + dx * k, p.y, SITE.z + dz * k);
    camera.lookAt(t);
  }

  /**
   * One orbit-controls step, turning the camera after IDLE_S without input (the turntable). The turntable starts
   * only clear of the stack, the tower and its arms, and turns back when it reaches one of them.
   */
  orbit(dt) {
    const c = this.controls;
    const p = this.view.camera.position;
    if (this.idle > IDLE_S && !c.autoRotate && this.walls) c.autoRotate = !this.blocked(p);
    const was = c.autoRotate && this.blocked(p);
    c.update(dt);
    if (c.autoRotate && !was && this.blocked(p)) c.autoRotateSpeed *= -1;
  }

  /**
   * Boxes 2 m clear of the stack, the tower, and the carriage with its arms. The carriage gets its own box because
   * the tower's would then reach over the stack along the open arms.
   */
  keepOut() {
    const tw = this.view.towers[0];
    const box = (objs) => objs.reduce((b, o) => b.expandByObject(o), new THREE.Box3()).expandByScalar(2);
    return [box([this.stack.root]), box(tw.root.children.filter((c) => c !== tw.carriage)), box([tw.carriage])];
  }

  blocked(p) {
    return this.walls.some((b) => b.containsPoint(p));
  }

  frame(dt) {
    this.game.t += dt;
    this.idle += dt;
    if (this.flight) this.fly(dt);
    else this.orbit(dt);
    this.clamp();
    this.view.render(this.game);
    // Only a render places the tower and its arms.
    if (this.stack) this.walls ??= this.keepOut();
  }

  /** Saves the view as a PNG. The canvas doesn't keep its pixels between frames, so it renders one first. */
  photo() {
    this.view.render(this.game);
    this.view.renderer.domElement.toBlob((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'catch-the-booster.png';
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
