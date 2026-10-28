import * as THREE from 'three';
import { ENGINE_Y } from './booster.js';
import { SHIP_ENGINE_Y, SKIRT, WIND } from './ship.js';
import { MOON_DIR } from './world.js';
import { COL_IDLE, COL_READY, COL_OFF } from './view.js';
import { createPlanet, createAir, createSpaceSky, buildSpaceEnv, setAirCamera, sunlight, SUN_DIR, CENTER, AIR_TOP } from './flight-world.js';
import { Craft } from './flight-craft.js';
import { FlightDirector, alongAxis, shipMid } from './flight-camera.js';
import { DT } from '../sim.js';
import { SITE_X, TOWER_X, R, ARM_Y, BOOSTER_TOP, local, wrap } from '../flight.js';

const SITE = new THREE.Vector3(SITE_X, 0, 0);
// Farther than this the flat launch site would z-fight the planet under it, and it is a few pixels anyway.
const SITE_FAR = 20000;
// Light bounced off the sunlit planet onto the vehicles' undersides.
const BOUNCE = new THREE.Color(0.25, 0.32, 0.45);
const SUN_I = 9;
const SPACE_ENV = 1;
// Roll that turns the ship's tiles to the right of its axis: into the airflow when it flies belly first eastbound.
const ROLL = Math.PI / 2 - WIND;
const ROLL_RATE = 0.8;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = THREE.MathUtils.smoothstep;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/**
 * Draws a free flight with the catch game's View: its renderer, scene, launch site and vehicle models, plus the
 * planet, its air, the space sky and the flight's craft. enter() adds them; exit() puts the catch scene back.
 */
export class FlightView {
  constructor(view) {
    this.view = view;
    this.planet = createPlanet();
    this.air = createAir();
    this.space = createSpaceSky();
    this.spaceEnv = buildSpaceEnv(view.renderer);
    this.craft = new Craft(view.shipMats);
    this.mount = view.world.dressing.mount.clone();
    this.mount.position.set(SITE_X, 0, 0);
    this.objects = [this.planet, this.air, this.space, this.mount, ...this.craft.objects];
    this.hemi = view.scene.children.find((o) => o.isHemisphereLight);
    this.fill = view.scene.children.find((o) => o.isDirectionalLight && o !== view.world.moon);
    this.site = [];
    this.kids = [];
    this.director = new FlightDirector();
    this.sun = new THREE.Color();
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
    this._u = new THREE.Vector3();
  }

  enter() {
    const v = this.view;
    const { scene, world } = v;
    const m = world.moon;
    this.saved = {
      env: scene.environment,
      envI: scene.environmentIntensity,
      fog: scene.fog.density,
      sky: this.hemi.color.clone(),
      ground: this.hemi.groundColor.clone(),
      fill: this.fill.intensity,
      moon: m.color.clone(),
      moonI: m.intensity,
      moonTarget: m.target.position.clone(),
      plumes: v.pool.map((s) => s.plume.group.scale.clone()),
    };
    scene.add(...this.objects);
    this.mount.visible = true;
    this.director = new FlightDirector();
    this.prev = null;
    this.crash = null;
    this.roll = ROLL;
    v.guide.visible = v.lane.visible = false;
    this.craft.attach(v.pool[2].root, v.pool[0].root);
    this.craft.showAll(true);
    v.renderer.compile(scene, v.camera);
    this.craft.showAll(false);
  }

  exit() {
    const v = this.view;
    const { scene, camera, world } = v;
    const sv = this.saved;
    scene.remove(...this.objects);
    this.craft.detach();
    this.restoreSite();
    this.kids = [];
    v.pool[2].root.rotation.set(0, 0, 0, 'XYZ');
    v.pool.forEach((s, i) => s.plume.group.scale.copy(sv.plumes[i]));
    v.particles.group.position.set(0, 0, 0);
    v.particles.group.rotation.set(0, 0, 0);
    camera.near = 1;
    camera.far = 6000;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    scene.fog.density = sv.fog;
    scene.environment = sv.env;
    scene.environmentIntensity = sv.envI;
    scene.environmentRotation.set(0, 0, 0);
    this.hemi.position.set(0, 1, 0);
    this.hemi.color.copy(sv.sky);
    this.hemi.groundColor.copy(sv.ground);
    this.fill.intensity = sv.fill;
    const m = world.moon;
    m.color.copy(sv.moon);
    m.intensity = sv.moonI;
    m.target.position.copy(sv.moonTarget);
    m.position.copy(MOON_DIR).multiplyScalar(420).add(sv.moonTarget);
    this.skyOn(true);
  }

  /** Call after each sim step. */
  step(f) {
    const v = this.view;
    this.director.step(f, v.size.w / (v.size.h * (1 + v.lift)));
    for (const e of f.events) {
      if (e.type === 'boosterLost' || (e.type === 'over' && f.ship.mode === 'crashed')) this.crash = { t: f.real, phi: f.anchor, lift: f.anchorLift };
    }
    const s = f.ship;
    const want = s.mode === 'stacked' || s.mode === 'free' || s.dir > 0 ? ROLL : ROLL + Math.PI;
    this.roll += clamp(want - this.roll, -ROLL_RATE * DT, ROLL_RATE * DT);
  }

  /** Call before each sim step: what that step started from, so frames drawn between steps can be interpolated. */
  snapshot(f) {
    const p = (this.prev ??= { b: {}, s: {}, sats: [], pos: new THREE.Vector3(), tgt: new THREE.Vector3(), fov: 0 });
    for (const k of ['x', 'y', 'ang']) {
      p.b[k] = f.booster[k];
      p.s[k] = f.ship[k];
    }
    p.sats = f.sats.map((q) => [q.x, q.y, q.z]);
    p.pos.copy(this.director.pos);
    p.tgt.copy(this.director.tgt);
    p.fov = this.director.fov;
  }

  /** Blends the drawn state alpha of the way from the last snapshot to the current step; returns an undo. */
  interpolate(f, alpha) {
    const p = this.prev;
    const saved = [];
    // A bigger change than max in one step is a jump (a snap into the arms, a cut): draw it as is.
    const blend = (o, k, from, max, angle = false) => {
      const d = angle ? wrap(o[k] - from) : o[k] - from;
      if (Math.abs(d) > max) return;
      saved.push([o, k, o[k]]);
      o[k] -= d * (1 - alpha);
    };
    for (const [o, q] of [
      [f.booster, p.b],
      [f.ship, p.s],
    ]) {
      blend(o, 'x', q.x, 2000);
      blend(o, 'y', q.y, 2000);
      blend(o, 'ang', q.ang, 1.5, true);
    }
    f.sats.forEach((o, i) => p.sats[i]?.forEach((from, j) => blend(o, 'xyz'[j], from, 2000)));
    const d = this.director;
    const now = [d.pos.clone(), d.tgt.clone(), d.fov];
    if (!d.snapped) {
      d.pos.lerpVectors(p.pos, now[0], alpha);
      d.tgt.lerpVectors(p.tgt, now[1], alpha);
      d.fov = p.fov + (now[2] - p.fov) * alpha;
    }
    return () => {
      for (const [o, k, x] of saved) o[k] = x;
      d.pos.copy(now[0]);
      d.tgt.copy(now[1]);
      d.fov = now[2];
    };
  }

  /** alpha: how far the frame is between the last two sim steps (1 = exactly the latest step). */
  render(f, { alpha = 1 } = {}) {
    const undo = alpha < 1 && this.prev ? this.interpolate(f, alpha) : null;
    try {
      this.draw(f);
    } finally {
      undo?.();
    }
  }

  /** World point -> CSS pixel position on screen. */
  project(x, y, z = 0) {
    const p = this._v.set(x, y, z).project(this.view.camera);
    return { x: (p.x * 0.5 + 0.5) * this.view.size.w, y: (-p.y * 0.5 + 0.5) * this.view.size.h, visible: p.z > -1 && p.z < 1 };
  }

  draw(f) {
    const v = this.view;
    const { scene, camera, world } = v;
    const cam = this.placeCamera(f);
    // 1 at the launch site, 0 high up or far away: how much of the catch game's night scene to keep.
    const catchW = (1 - smooth(cam.alt, 1200, 4000)) * (1 - smooth(Math.abs(cam.phi) * R, 4000, 9000));
    const nearSite = camera.position.distanceTo(SITE) < SITE_FAR;

    this.skyOn(catchW > 0);
    world.sky.position.copy(camera.position);
    world.skyMat.uniforms.uTime.value = f.real;
    this.space.visible = this.air.visible = catchW < 1;
    this.space.position.copy(camera.position);
    const sp = this.space.material.uniforms;
    sp.uFade.value = 1 - catchW;
    sp.uUp.value.copy(camera.up);
    sp.uDip.value = Math.sqrt(Math.max(0, 1 - (R / cam.r) ** 2));
    sp.uTime.value = f.real;
    this.air.material.uniforms.uFade.value = 1 - catchW;
    this.planet.material.uniforms.uClouds.value = smooth(cam.alt, 2000, 6000);
    setAirCamera(camera.position);
    scene.fog.density = this.saved.fog * catchW;

    this.syncSite();
    const show = { site: nearSite, disc: nearSite && cam.alt < 1500, haze: nearSite && cam.alt < 400, off: false };
    for (const e of this.site) e.o.visible = e.vis && show[e.k];

    this.light(catchW);
    this.tower(f);
    this.effects(f, this.vehicles(f, nearSite));
    v.composer.render();
  }

  /** The director's shot plus shake, level with the local horizon; returns the camera's local frame. */
  placeCamera(f) {
    const v = this.view;
    const { camera } = v;
    const d = this.director;
    const b = f.booster;
    const t = f.real;
    const rumble = b.state === 'stacked' ? 0.4 * b.throttle * (1 - smooth(local(b.x, b.y).alt, 150, 2500)) : 0;
    const sh = f.fx.shake * 0.09 + rumble;
    camera.position.set(d.pos.x + Math.sin(t * 37.1) * sh, d.pos.y + Math.sin(t * 41.7 + 2) * sh, d.pos.z + Math.sin(t * 29.3 + 4) * sh);
    const L = local(camera.position.x, camera.position.y);
    camera.up.set(L.ux, L.uy, 0);
    camera.lookAt(d.tgt);
    camera.fov = d.fov;
    camera.near = clamp(Math.min(d.pos.distanceTo(d.tgt) * 0.1, L.alt * 0.5), 1, 50);
    camera.far = (L.r + AIR_TOP) * 1.05;
    camera.updateProjectionMatrix();
    v.particles.setScale((v.size.h * (1 + v.lift) * v.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    return L;
  }

  /** The catch game's night sky (or its baked copy), shown or hidden. */
  skyOn(on) {
    const v = this.view;
    const baked = !!v.quality?.bakedSky;
    v.world.sky.visible = on && !baked;
    v.scene.background = on && baked ? v.skyCube.texture : null;
  }

  /** Launch-site meshes and their own visibility, collected again whenever a model swap changes the scene. */
  syncSite() {
    const v = this.view;
    const kids = v.scene.children;
    if (kids.length === this.kids.length && kids.every((k, i) => k === this.kids[i])) return;
    this.restoreSite();
    this.kids = kids.slice();
    const skip = new Set([v.world.sky, v.particles.group, v.guide, v.lane, ...v.pool.map((s) => s.root), this.planet, this.air, this.space, ...this.craft.objects]);
    const kinds = new Map([
      [v.world.outer, 'disc'],
      [v.world.haze, 'haze'],
      [v.towers[1].root, 'off'],
    ]);
    const walk = (o, k) => {
      if (skip.has(o)) return;
      k = kinds.get(o) ?? k;
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite) this.site.push({ o, vis: o.visible, k });
      for (const c of o.children) walk(c, k);
    };
    walk(v.scene, 'site');
  }

  restoreSite() {
    for (const e of this.site) e.o.visible = e.vis;
    this.site = [];
  }

  /** Moonlight at the site and in the planet's shadow, sunlight elsewhere, with sky light and reflections to match. */
  light(catchW) {
    const { scene, world } = this.view;
    const sv = this.saved;
    const focus = this.director.tgt;
    const L = local(focus.x, focus.y);
    const U = this._u.set(L.ux, L.uy, 0);
    const sun = lum(sunlight(focus, this.sun));
    const m = world.moon;
    m.target.position.lerpVectors(sv.moonTarget, focus, Math.max(smooth(L.alt, 100, 400), smooth(Math.abs(L.phi) * R, 300, 1000)));
    // One light: it fades out before it swaps between the moon's direction and the sun's.
    if (sun < 0.5) {
      m.color.copy(sv.moon);
      m.intensity = sv.moonI * (1 - 2 * sun) * smooth(MOON_DIR.dot(U), -0.1, 0.1);
      m.position.copy(MOON_DIR);
    } else {
      m.color.copy(this.sun).multiplyScalar(1 / Math.max(this.sun.r, this.sun.g, this.sun.b));
      m.intensity = SUN_I * (2 * sun - 1);
      m.position.copy(SUN_DIR);
    }
    m.position.multiplyScalar(420).add(m.target.position);
    // The night side keeps the launch site's night sky light; the day side gets the sun's bounce off the planet.
    const night = Math.max(catchW, 1 - sun);
    this.hemi.position.copy(U);
    this.hemi.color.copy(sv.sky).multiplyScalar(night);
    this.hemi.groundColor.copy(sv.ground).multiplyScalar(night).add(this._c.copy(BOUNCE).multiplyScalar((1 - catchW) * sun));
    this.fill.intensity = sv.fill * night;
    // Both maps are the same PMREM size, so swapping them recompiles nothing; the intensity is 0 at the swap.
    const site = night > 0.5;
    scene.environment = site ? sv.env : this.spaceEnv;
    scene.environmentIntensity = site ? sv.envI * (2 * night - 1) : SPACE_ENV * sun * (1 - 2 * night);
    scene.environmentRotation.z = -L.phi;
  }

  tower(f) {
    const [tw, spare] = this.view.towers;
    const b = f.booster;
    tw.root.visible = spare.root.visible = true;
    tw.root.position.set(TOWER_X, 0, 0);
    tw.setArms(f.arms.open, ARM_Y + f.arms.bounce);
    tw.glowMat.color.copy(f.arms.holding ? COL_READY : b.state === 'landing' || b.state === 'closing' ? COL_IDLE : COL_OFF);
    const blink = Math.sin(f.real * 2.6) > 0.35 ? 1 : 0.12;
    tw.lightMat.color.setRGB(4 * blink, 0.25 * blink, 0.15);
    tw.spot.intensity = 90;
    spare.spot.intensity = 0;
  }

  /** The booster and ship models with their plumes and engine lights; returns the engines that light the smoke. */
  vehicles(f, nearSite) {
    const v = this.view;
    const [bs, spare, ss] = v.pool;
    const b = f.booster;
    const s = f.ship;
    spare.root.visible = false;
    spare.light.intensity = 0;
    v.final.uniforms.uHaze.value.z = 0;
    v.final.uniforms.uHaze2.value.z = 0;
    const engines = [];

    // A parked booster was lifted off the tower and taken away while the ship was out of sight.
    bs.root.visible = b.state !== 'lost' && b.state !== 'parked' && (nearSite || b.state !== 'caught');
    bs.root.position.set(b.x, b.y, 0);
    bs.root.rotation.set(0, 0, b.ang - Math.PI / 2);
    this.engine(f, 0, b.x, b.y, b.ang, ENGINE_Y, bs.root.visible ? b.throttle : 0, b.engines > 13 ? 1.5 : 1, engines);

    const ox = s.x - Math.cos(s.ang) * SKIRT;
    const oy = s.y - Math.sin(s.ang) * SKIRT;
    ss.root.visible = s.mode !== 'crashed';
    ss.root.position.set(ox, oy, 0);
    ss.root.rotation.set(0, this.roll, s.ang - Math.PI / 2, 'ZYX');
    // Hot staging: the ship's exhaust stops at the booster's dome and vents out of the ring until the booster falls clear.
    const reach = b.state === 'sep' ? alongAxis(this._u, b, BOOSTER_TOP).distanceTo(this._v.set(s.x, s.y, 0)) : Infinity;
    this.engine(f, 2, ox, oy, s.ang, SHIP_ENGINE_Y, ss.root.visible ? s.throttle : 0, s.engines === 6 ? 1.7 : 1, engines, reach);

    this.craft.attach(ss.root, bs.root);
    this.craft.update(f, shipMid(this._v, s), f.real);
    return engines;
  }

  /** Plume (at most reach meters long), throat glow, engine light and heat haze for pool slot i, whose model origin is (ox, oy). */
  engine(f, i, ox, oy, ang, exitY, thr, wide, engines, reach = Infinity) {
    const v = this.view;
    const slot = v.pool[i];
    const c = Math.cos(ang);
    const sn = Math.sin(ang);
    const ex = ox + c * exitY;
    const ey = oy + sn * exitY;
    const alt = local(ex, ey).alt;
    // Exhaust spreads wide in near vacuum.
    const vac = smooth(alt, 2000, 9000);
    const base = this.saved.plumes[i];
    const w = wide * (1 + 1.5 * vac);
    slot.plume.group.scale.set(base.x * w, base.y * (1 + 0.4 * vac), base.z * w);
    slot.plume.update(thr, f.real, Math.max(0, Math.min(alt, reach)));
    slot.throatMat.color.setRGB(7 * thr + 0.02, 3 * thr, 0.9 * thr);
    slot.light.position.set(ex - c * 10, ey - sn * 10, 6);
    slot.light.intensity = thr > 0.02 ? 650 * (0.25 + thr) * wide : 0;
    if (thr <= 0.02 || alt > 400) return;
    const cam = v.camera;
    const p = this._v.set(ex - c * 14, ey - sn * 14, 0);
    const r = 6 / (cam.position.distanceTo(p) * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)));
    p.project(cam);
    const haze = i === 0 ? v.final.uniforms.uHaze : v.final.uniforms.uHaze2;
    haze.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5, p.z < 1 ? Math.min(1, thr * 1.6) * (1 - smooth(alt, 150, 400)) : 0, Math.max(0.02, r));
    engines.push({ ...this.toCatch(f, ex - c * 8, ey - sn * 8), power: thr });
  }

  /** A world point in the catch game's frame (meters), where the effects anchor sits at the launch site. */
  toCatch(f, x, y) {
    const c = Math.cos(f.anchor);
    const s = Math.sin(f.anchor);
    const rx = x - CENTER.x;
    const ry = y - CENTER.y;
    return { x: rx * c - ry * s + SITE_X, y: rx * s + ry * c - R - f.anchorLift };
  }

  /** The catch game's particles turned onto the effects anchor, the crash fireball light and the post uniforms. */
  effects(f, engines) {
    const v = this.view;
    const c = Math.cos(f.anchor);
    const s = Math.sin(f.anchor);
    const lift = R + f.anchorLift;
    v.particles.group.rotation.set(0, 0, -f.anchor);
    v.particles.group.position.set(CENTER.x - c * SITE_X + s * lift, CENTER.y + s * SITE_X + c * lift, 0);
    v.particles.update(f.fx.particles, engines);

    const k = this.crash;
    const ct = k ? f.real - k.t : 9;
    v.crashLight.intensity = ct < 4 ? 14000 * Math.exp(-ct * 1.4) * (0.85 + 0.15 * Math.sin(f.real * 31)) : 0;
    if (k) v.crashLight.position.set(CENTER.x + Math.sin(k.phi) * (R + k.lift + 9), CENTER.y + Math.cos(k.phi) * (R + k.lift + 9), 8);

    const fx = f.fx;
    const [r, g, b] = fx.flashColor.split(',').map(Number);
    const fl = fx.flash * 0.1;
    const u = v.final.uniforms;
    u.uFlash.value.set((r / 255) * fl, (g / 255) * fl, (b / 255) * fl);
    u.uDip.value = this.director.dip;
    u.uTime.value = f.real;
  }
}
