import * as THREE from 'three';
import { createBooster, createBoosterMaterials, ENGINE_Y } from './booster.js';
import { createTower, createTowerMaterials } from './tower.js';
import { buildWorld } from './world.js';
import { boosterSkin } from './textures.js';
import { createPlume, createParticles } from './effects.js';
import { createComposer } from './post.js';
import { Director, toX, toY } from './director.js';
import { BOOSTER, PX_PER_M, CATCH_TOL_X } from '../sim.js';

const CENTER_M = BOOSTER.center / PX_PER_M;
const GUIDE_R = BOOSTER.halfW / PX_PER_M + CATCH_TOL_X / PX_PER_M;
const COL_IDLE = new THREE.Color(0.25, 0.95, 1.5);
const COL_READY = new THREE.Color(0.35, 2.6, 0.75);
const COL_OFF = new THREE.Color(0.08, 0.25, 0.35);

export class View {
  constructor(canvas, { pixelRatio = 1, cinematic = false, samples = 4, preserve = false } = {}) {
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: preserve });
    renderer.setPixelRatio(pixelRatio);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.pixelRatio = pixelRatio;
    this.samples = samples;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 1, 6000);

    const towerMats = createTowerMaterials();
    this.world = buildWorld(scene, renderer, towerMats);
    this.towers = [createTower(towerMats, -1), createTower(towerMats, 1)];
    for (const t of this.towers) scene.add(t.root);
    this.towers[1].root.visible = false;

    const mats = createBoosterMaterials(boosterSkin(), 1.0);
    this.pool = [0, 1, 2].map(() => {
      const b = createBooster(mats);
      const plume = createPlume();
      b.root.add(plume.group);
      b.root.visible = false;
      const light = new THREE.PointLight(0xff8f45, 0, 320, 1.35);
      scene.add(b.root, light);
      return { ...b, plume, light, id: null };
    });

    this.particles = createParticles(toX, toY);
    scene.add(this.particles.group);

    const guideMat = new THREE.MeshBasicMaterial({ color: COL_IDLE.clone(), toneMapped: false, transparent: true, opacity: 0.85, depthWrite: false });
    this.guide = new THREE.Mesh(new THREE.TorusGeometry(GUIDE_R, 0.09, 6, 96), guideMat);
    this.guide.rotation.x = Math.PI / 2;
    const laneMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.06, 0.25, 0.35), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    this.lane = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 6), laneMat);
    scene.add(this.guide, this.lane);

    this.director = new Director({ cinematic });
    this.size = { w: 1280, h: 720 };
    const post = createComposer(renderer, scene, this.camera, 1280 * pixelRatio, 720 * pixelRatio, samples);
    Object.assign(this, post);
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
  }

  resize(w, h) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.final.uniforms.uAspect.value = w / h;
  }

  get aspect() {
    return this.size.w / this.size.h;
  }

  stepCamera(game) {
    this.director.step(game, this.aspect);
  }

  /** Sim pixel coordinates -> CSS pixel position on screen. */
  project(xpx, ypx) {
    const v = this._v.set(toX(xpx), toY(ypx), 0).project(this.camera);
    return { x: (v.x * 0.5 + 0.5) * this.size.w, y: (-v.y * 0.5 + 0.5) * this.size.h, visible: v.z < 1 };
  }

  hazeFor(b, uniform) {
    const ex = toX(b.x);
    const ey = toY(b.y) - BOOSTER.bottom / PX_PER_M - 14;
    const p = this._v.set(ex, Math.max(ey, 4), 0).project(this.camera);
    const q = this._v2.set(ex + 12, Math.max(ey, 4), 0).project(this.camera);
    const r = Math.max(0.02, Math.abs(q.x - p.x) * 0.5 * this.aspect);
    uniform.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, p.z < 1 ? Math.min(1, b.throttle * 1.6) : 0, r);
  }

  render(game, { dip = null } = {}) {
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
      view.spot.intensity = 900;
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
        slot = this.pool.find((s) => s.id === null);
        if (!slot) continue;
        slot.id = b.id;
      }
      const root = slot.root;
      root.visible = !(b.state === 'crashed' && b.alpha < 0.88);
      const X = toX(b.x);
      const Y = toY(b.y);
      if (b.state === 'tumbling' || b.state === 'crashed') {
        const a = -b.rot;
        root.rotation.set(0, 0, a);
        root.position.set(X - Math.sin(a) * CENTER_M, Y - CENTER_M + Math.cos(a) * CENTER_M, 0);
      } else {
        root.rotation.set(0, 0, -b.tilt);
        root.position.set(X, Y, 0);
      }
      const thr = b.throttle;
      const engineY = Y + ENGINE_Y * Math.cos(b.tilt);
      slot.plume.update(thr, t, Math.max(0, engineY));
      slot.throatMat.color.setRGB(7 * thr + 0.02, 3 * thr, 0.9 * thr);
      const ex = X + Math.sin(b.tilt) * ENGINE_Y;
      slot.light.position.set(ex, Math.max(2, engineY - 10), 6);
      slot.light.intensity = thr > 0.02 ? 9000 * (0.35 + thr) : 0;
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
    const scale = (this.size.h * this.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
    this.particles.setScale(scale);
    this.particles.update(game.particles, engines);

    this.world.sky.position.copy(this.camera.position);
    this.world.skyMat.uniforms.uTime.value = t;
    const fl = game.flash;
    const [r, g, b] = game.flashColor.split(',').map(Number);
    this.final.uniforms.uFlash.value.set((r / 255) * fl * 0.35, (g / 255) * fl * 0.35, (b / 255) * fl * 0.35);
    this.final.uniforms.uDip.value = dip ?? this.director.dip;
    this.final.uniforms.uTime.value = t;
    this.composer.render();
  }
}
