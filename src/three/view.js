import * as THREE from 'three';
import { createBooster, createBoosterMaterials, ENGINE_Y } from './booster.js';
import { createShip, createShipMaterials, createShipPlume, SHIP_ENGINE_Y } from './ship.js';
import { createTower, createTowerMaterials } from './tower.js';
import { buildWorld, bakeSky } from './world.js';
import { createPlume, createParticles } from './effects.js';
import { createExplosions } from './explosion.js';
import { createComposer } from './post.js';
import { Director, toX, toY } from './director.js';
import { VEHICLES, PX_PER_M, CATCH_TOL_X, DT } from '../sim.js';

const GUIDE_R = VEHICLES.booster.halfW / PX_PER_M + CATCH_TOL_X / PX_PER_M;
const ENGINE_EXIT = { booster: ENGINE_Y, ship: SHIP_ENGINE_Y };
// One slot (and engine light) per vehicle on screen; every lit pixel pays for each light, so keep it at three.
const SLOT_KINDS = ['booster', 'booster', 'ship'];
const COL_IDLE = new THREE.Color(0.25, 0.95, 1.5);
const COL_READY = new THREE.Color(0.35, 2.6, 0.75);
const COL_OFF = new THREE.Color(0.08, 0.25, 0.35);

/** Render quality levels, best first. The auto-quality monitor steps down this list when frames run slow. */
export const QUALITY = [
  { name: 'high', maxDpr: 1.5, shadows: true, bloom: 1, msaa: 4, bakedSky: false },
  { name: 'medium', maxDpr: 1, shadows: true, bloom: 0.5, msaa: 0, bakedSky: true },
  { name: 'low', maxDpr: 0.75, shadows: false, bloom: 0.5, msaa: 0, bakedSky: true },
  { name: 'minimal', maxDpr: 0.5, shadows: false, bloom: 0, msaa: 0, bakedSky: true },
];

// Phone apps can cover the bottom ~30% of a tall embed, so the camera's aim point is lifted toward the top.
const TALL_ASPECT = 0.8;
const TALL_LIFT = 0.35;

export class View {
  constructor(canvas, { pixelRatio = 1, cinematic = false, samples = 4, preserve = false, map = 'starbase' } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: preserve });
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer = renderer;
    this.pixelRatio = pixelRatio;
    this.samples = samples;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 6000);

    const towerMats = createTowerMaterials();
    this.towerMats = towerMats;
    this.world = buildWorld(scene, renderer, towerMats, map);
    this.towers = [createTower(towerMats, -1), createTower(towerMats, 1)];
    for (const t of this.towers) scene.add(t.root);
    this.towers[1].root.visible = false;

    const mats = createBoosterMaterials(1.0);
    this.boosterMats = mats;
    this.shipMats = createShipMaterials(mats);
    this.pool = SLOT_KINDS.map((kind) => {
      const b = kind === 'ship' ? createShip(this.shipMats) : createBooster(mats);
      const plume = kind === 'ship' ? createShipPlume() : createPlume();
      b.root.add(plume.group);
      b.root.visible = false;
      const light = new THREE.PointLight(0xff8f45, 0, 0, 2);
      scene.add(b.root, light);
      return { ...b, kind, plume, light, id: null };
    });

    this.particles = createParticles(toX, toY);
    this.particles.setPalette(this.world.fx);
    scene.add(this.particles.group);
    // Crash explosions (fireball, shockwave, debris, smoke column, scorch, light pulse).
    this.explosions = createExplosions();
    this.explosions.setPalette(this.world.fx);
    scene.add(this.explosions.group);
    this.crashSeen = new WeakSet();

    const guideMat = new THREE.MeshBasicMaterial({ color: COL_IDLE.clone(), toneMapped: false, transparent: true, opacity: 0.55, depthWrite: false });
    this.guide = new THREE.Mesh(new THREE.TorusGeometry(GUIDE_R, 0.06, 6, 128), guideMat);
    this.guide.rotation.x = Math.PI / 2;
    const laneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.25, 0.35), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lane = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), laneMat);
    scene.add(this.guide, this.lane);

    this.director = new Director({ cinematic });
    this.size = { w: 1280, h: 720 };
    const post = createComposer(renderer, scene, this.camera, 1280 * pixelRatio, 720 * pixelRatio, samples);
    Object.assign(this, post);
    this.bloomScale = 1;
    const bloomSetSize = this.bloom.setSize.bind(this.bloom);
    this.bloom.setSize = (bw, bh) => bloomSetSize(Math.max(2, Math.round(bw * this.bloomScale)), Math.max(2, Math.round(bh * this.bloomScale)));
    this.lift = 0;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  /**
   * Swaps the loaded Blender models in for the procedural ones. A model that failed to load (null), or that
   * can't be instantiated, leaves its procedural version in place. Everything is rebuilt before anything is
   * swapped, and render() re-applies all per-frame state, so this can run between any two frames.
   */
  useModels(models) {
    if (!models) return;
    this.models = models;
    const build = (name, fn) => {
      if (!models[name]) return null;
      try {
        return fn(models[name]);
      } catch (err) {
        console.error(`${name} model unusable; keeping the procedural one`, err);
        return null;
      }
    };
    const make = { booster: (m) => createBooster(this.boosterMats, m), ship: (m) => createShip(this.shipMats, m) };
    const vehicles = { booster: null, ship: null };
    for (const kind in vehicles) vehicles[kind] = build(kind, (m) => this.pool.filter((s) => s.kind === kind).map(() => make[kind](m)));
    const towers = build('tower', (m) => [createTower(this.towerMats, -1, m), createTower(this.towerMats, 1, m)]);
    build('props', (m) => this.world.useProps(m));

    const replace = (oldRoot, newRoot) => {
      newRoot.visible = oldRoot.visible;
      this.scene.remove(oldRoot);
      this.scene.add(newRoot);
      oldRoot.traverse((o) => {
        if (o.isInstancedMesh) o.dispose();
        o.geometry?.dispose();
      });
    };
    for (const kind in vehicles) {
      if (!vehicles[kind]) continue;
      this.pool
        .filter((s) => s.kind === kind)
        .forEach((slot, i) => {
          const next = vehicles[kind][i];
          next.root.add(slot.plume.group);
          replace(slot.root, next.root);
          slot.root = next.root;
          slot.throatMat = next.throatMat;
        });
    }
    if (towers) {
      this.towers.forEach((old, i) => replace(old.root, towers[i].root));
      this.towers = towers;
    }
  }

  /**
   * Swaps the launch site for another map ('starbase' or 'mars') between two frames, without a reload.
   * The old world's geometry, materials, textures and render targets are freed first.
   */
  setMap(map) {
    if (map === this.world.map) return;
    this.world.dispose();
    this.skyCube?.dispose();
    this.skyCube = null;
    this.world = buildWorld(this.scene, this.renderer, this.towerMats, map);
    if (this.models?.props) {
      try {
        this.world.useProps(this.models.props);
      } catch (err) {
        console.error('props model unusable; keeping the procedural one', err);
      }
    }
    this.particles.setPalette(this.world.fx);
    this.explosions.setPalette(this.world.fx);
    if (this.quality) this.setQuality(this.quality);
  }

  setQuality(q) {
    const dpr = Math.min(window.devicePixelRatio || 1, q.maxDpr);
    this.quality = q;
    this.pixelRatio = dpr;
    this.renderer.setPixelRatio(dpr);
    this.composer.setPixelRatio(dpr);
    this.world.keyLight.castShadow = q.shadows;
    if (q.bakedSky && !this.skyCube) this.skyCube = bakeSky(this.renderer, this.world.sky);
    this.world.sky.visible = !q.bakedSky;
    this.scene.background = q.bakedSky ? this.skyCube.texture : null;
    this.bloom.enabled = q.bloom > 0;
    this.aa.enabled = q.msaa === 0;
    this.bloomScale = q.bloom || 1;
    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== q.msaa) {
        rt.samples = q.msaa;
        rt.dispose();
      }
    }
    this.resize(this.size.w, this.size.h);
  }

  resize(w, h) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    const cam = this.camera;
    cam.aspect = w / h;
    this.lift = w / h < TALL_ASPECT ? TALL_LIFT : 0;
    if (this.lift > 0) cam.setViewOffset(w, h * (1 + this.lift), 0, h * this.lift, w, h);
    else cam.clearViewOffset();
    cam.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = w / h;
  }

  get aspect() {
    return this.size.w / this.size.h;
  }

  stepCamera(game) {
    this.director.step(game, this.size.w / (this.size.h * (1 + this.lift)));
  }

  /** Call before each sim step: what that step started from, so frames drawn between steps can be interpolated. */
  snapshot(game) {
    const p = (this.prev ??= { boosters: new Map(), towers: [], pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0 });
    p.boosters.clear();
    for (const b of game.boosters) p.boosters.set(b.id, { x: b.x, y: b.y, tilt: b.tilt, rot: b.rot, state: b.state });
    p.towers = game.towers.map((tw) => tw && { armY: tw.armY, bounce: tw.bounce, open: tw.open, rise: tw.rise });
    p.pos.copy(this.director.pos);
    p.tgt.copy(this.director.tgt);
    p.fov = this.director.fov;
  }

  /** Blends the drawn state alpha of the way from the last snapshot to the current step; returns an undo. */
  interpolate(game, alpha) {
    const p = this.prev;
    const saved = [];
    // A bigger change than this in one step is a teleport (respawn, round reset): draw it as is.
    const blend = (o, k, from, maxJump) => {
      const to = o[k];
      if (typeof to !== 'number' || typeof from !== 'number' || Math.abs(to - from) > maxJump) return;
      saved.push([o, k, to]);
      o[k] = from + (to - from) * alpha;
    };
    for (const b of game.boosters) {
      const q = p.boosters.get(b.id);
      if (!q || q.state === 'waiting') continue;
      blend(b, 'x', q.x, 40);
      blend(b, 'y', q.y, 40);
      blend(b, 'tilt', q.tilt, Math.PI / 2);
      blend(b, 'rot', q.rot, Math.PI / 2);
    }
    game.towers.forEach((tw, i) => {
      const q = p.towers[i];
      if (tw && q) for (const k of ['armY', 'bounce', 'open', 'rise']) blend(tw, k, q[k], 40);
    });
    const d = this.director;
    const pos = d.pos.clone();
    const tgt = d.tgt.clone();
    const fov = d.fov;
    d.pos.lerpVectors(p.pos, pos, alpha);
    d.tgt.lerpVectors(p.tgt, tgt, alpha);
    d.fov = p.fov + (fov - p.fov) * alpha;
    return () => {
      for (const [o, k, v] of saved) o[k] = v;
      d.pos.copy(pos);
      d.tgt.copy(tgt);
      d.fov = fov;
    };
  }

  /** alpha: how far the frame is between the last two sim steps (1 = exactly the latest step). */
  render(game, { dip = null, alpha = 1 } = {}) {
    const undo = alpha < 1 && this.prev ? this.interpolate(game, alpha) : null;
    try {
      this.draw(game, dip, alpha);
    } finally {
      undo?.();
    }
  }

  /** Sim pixel coordinates -> CSS pixel position on screen. */
  project(xpx, ypx) {
    const v = this._v.set(toX(xpx), toY(ypx), 0).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.size.w, y: (-v.y * 0.5 + 0.5) * this.size.h, visible: v.z < 1 };
  }

  hazeFor(b, uniform) {
    const ex = toX(b.x);
    const ey = toY(b.y) - VEHICLES[b.kind].bottom / PX_PER_M - 14;
    const p = this._v.set(ex, Math.max(ey, 4), 0).project(this.camera);
    const q = this._v2.set(ex + 12, Math.max(ey, 4), 0).project(this.camera);
    const r = Math.max(0.02, Math.abs(q.x - p.x) * 0.5 * this.aspect);
    uniform.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, p.z < 1 ? Math.min(1, b.throttle * 1.6) : 0, r);
  }

  draw(game, dip, alpha = 1) {
    const t = game.t;
    const blink = (k) => (Math.sin(t * 2.6 + k) > 0.35 ? 1 : 0.12);

    const active = game.activeTower();
    this.towers.forEach((view, i) => {
      const tw = game.towers[i];
      view.root.visible = !!tw;
      if (!tw) return;
      view.root.position.set(toX(tw.x), -(1 - tw.rise) * 158, 0);
      view.setArms(tw.open, toY(tw.armY + tw.bounce));
      const isActive = tw === active && game.phase === 'live';
      view.glowMat.color.copy(tw.ready ? COL_READY : isActive || tw.holding ? COL_IDLE : COL_OFF);
      view.lightMat.color.setRGB(4 * blink(i * 1.7), 0.25 * blink(i * 1.7), 0.15);
      view.spot.intensity = 90;
    });

    const live = game.phase === 'live' && active && !active.holding;
    this.guide.visible = this.lane.visible = !!live;
    if (live) {
      const lx = toX(active.cx);
      const ay = toY(active.armY + active.bounce);
      this.guide.position.set(lx, ay + 0.05, 0);
      this.guide.material.color.copy(active.ready ? COL_READY : COL_IDLE);
      this.lane.position.set(lx, ay / 2, 0);
      this.lane.scale.y = ay;
    }

    const ids = new Set(game.boosters.filter((b) => b.state !== 'waiting').map((b) => b.id));
    for (const slot of this.pool) if (slot.id !== null && !ids.has(slot.id)) slot.id = null;
    const engines = [];
    let hazeIdx = 0;
    this.final.uniforms.uHaze.value.z = 0;
    this.final.uniforms.uHaze2.value.z = 0;
    for (const b of game.boosters) {
      if (b.state === 'waiting') continue;
      let slot = this.pool.find((s) => s.id === b.id);
      if (!slot) {
        slot = this.pool.find((s) => s.id === null && s.kind === b.kind);
        if (!slot) continue;
        slot.id = b.id;
      }
      const root = slot.root;
      root.visible = !(b.state === 'crashed' && b.alpha < 0.88);
      const X = toX(b.x);
      const Y = toY(b.y);
      if (b.state === 'tumbling' || b.state === 'crashed') {
        const a = -b.rot;
        const c = VEHICLES[b.kind].center / PX_PER_M;
        root.rotation.set(0, 0, a);
        root.position.set(X - Math.sin(a) * c, Y - c + Math.cos(a) * c, 0);
      } else {
        root.rotation.set(0, 0, -b.tilt);
        root.position.set(X, Y, 0);
      }
      if (b.state === 'crashed' && b.boom && !this.crashSeen.has(b.boom)) {
        this.crashSeen.add(b.boom);
        const up = this._v.set(0, 1, 0).applyEuler(root.rotation);
        this.explosions.spawn({
          t: b.boom.t,
          seed: b.boom.seed,
          x: toX(b.boom.x),
          bottom: root.position.clone().addScaledVector(up, ENGINE_EXIT[b.kind]),
          top: root.position.clone().addScaledVector(up, -VEHICLES[b.kind].top / PX_PER_M),
          drift: b.boom.wind,
        });
      }
      const thr = b.throttle;
      const exitY = ENGINE_EXIT[b.kind];
      const engineY = Y + exitY * Math.cos(b.tilt);
      slot.plume.update(thr, t, Math.max(0, engineY));
      slot.throatMat.color.setRGB(7 * thr + 0.02, 3 * thr, 0.9 * thr);
      const ex = X + Math.sin(b.tilt) * exitY;
      slot.light.position.set(ex, Math.max(2, engineY - 10), 6);
      slot.light.intensity = thr > 0.02 ? 650 * (0.25 + thr) : 0;
      if (thr > 0.02) {
        engines.push({ x: ex, y: engineY - 8, power: thr });
        if (hazeIdx < 2) this.hazeFor(b, hazeIdx++ === 0 ? this.final.uniforms.uHaze : this.final.uniforms.uHaze2);
      }
    }
    for (const slot of this.pool) {
      if (slot.id === null) {
        slot.root.visible = false;
        slot.light.intensity = 0;
      }
    }

    this.director.apply(this.camera, game);
    // Explosions are a function of time, so frames drawn between sim steps get the in-between time.
    this.explosions.update(t - (1 - alpha) * DT, this.camera);
    const scale = (this.size.h * (1 + this.lift) * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.particles.setScale(scale);
    this.particles.update(game.particles, engines);

    this.world.sky.position.copy(this.camera.position);
    this.world.skyMat.uniforms.uTime.value = t;
    const fl = game.flash;
    const [r, g, b] = game.flashColor.split(',').map(Number);
    this.final.uniforms.uFlash.value.set((r / 255) * fl * 0.1, (g / 255) * fl * 0.1, (b / 255) * fl * 0.1);
    this.final.uniforms.uDip.value = dip ?? this.director.dip;
    this.final.uniforms.uTime.value = t;
    this.composer.render();
  }
}
