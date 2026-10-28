import * as THREE from 'three';
import { ENGINE_Y } from './booster.js';
import { SHIP_ENGINE_Y, SKIRT, faceTower } from './ship.js';
import { COL_IDLE, COL_READY, COL_OFF } from './view.js';
import { createLook, setAirCamera, CENTER, AIR_TOP, AH } from './flight-world.js';
import { Craft } from './flight-craft.js';
import { FlightDirector, alongAxis, shipMid } from './flight-camera.js';
import { toX } from './director.js';
import { DT, PX_PER_M, VEHICLES } from '../sim.js';
import { SITE_X, TOWER_X, R, ARM_Y, BOOSTER_TOP, local, wrap } from '../flight.js';

const SITE = new THREE.Vector3(SITE_X, 0, 0);
// Farther than this the flat launch site would z-fight the planet under it, and it is a few pixels anyway.
const SITE_FAR = 20000;
const SPACE_ENV = 1;
// Roll that keeps the ship's tiles on the right of its axis (toward the tower on the pad): into the airflow when it
// flies belly first eastbound.
const ROLL = 0;
const ROLL_RATE = 0.8;
// Lowest the player can orbit the camera to, in meters above the ground.
const MIN_ALT = 7;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const smooth = THREE.MathUtils.smoothstep;
const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

/** Turns a group in the catch game's frame onto the planet: x = SITE_X over the point at angle phi, its ground lift meters up. */
function onGround(group, phi, lift) {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  group.rotation.set(0, 0, -phi);
  group.position.set(CENTER.x - c * SITE_X + s * (R + lift), CENTER.y + s * SITE_X + c * (R + lift), 0);
}

/**
 * Draws a free flight with the catch game's View: its renderer, scene, launch site and vehicle models, plus the
 * planet, its air, the space sky and the flight's craft. enter(f) adds them and aims the camera at flight f;
 * exit() puts the catch scene back.
 */
export class FlightView {
  constructor(view) {
    this.view = view;
    // The planet, air and space sky of each map flown so far.
    this.look = createLook(view.world.map, view.renderer);
    this.looks = { [view.world.map]: this.look };
    this.craft = new Craft(view.shipMats);
    // Holds a copy of the current map's launch mount, on the flight's pad.
    this.mount = new THREE.Group();
    this.mount.position.copy(SITE);
    this.objects = [this.mount, ...this.craft.objects];
    this.world = null;
    this.site = [];
    this.kids = [];
    this.director = new FlightDirector();
    this.sun = new THREE.Color();
    this._c = new THREE.Color();
    this._v = new THREE.Vector3();
    this._u = new THREE.Vector3();
    this._cam = new THREE.Vector3();
    this._w = new THREE.Vector3();
  }

  enter(f) {
    const v = this.view;
    this.plumes = v.pool.map((s) => s.plume.group.scale.clone());
    this.bind();
    v.scene.add(...this.objects);
    this.director = new FlightDirector();
    this.prev = null;
    this.roll = ROLL;
    this.boom = null;
    this.boomAt = 0;
    this.hold = null;
    // The director's first step only cuts to the opening shot. Without it, a frame drawn before the first sim step
    // looks out from the world's origin.
    this.step(f);
    v.guide.visible = v.lane.visible = false;
    this.craft.attach(v.pool[2].root, v.pool[0].root);
    this.craft.showAll(true);
    v.renderer.compile(v.scene, v.camera);
    this.craft.showAll(false);
  }

  /** Draws the current map's planet and takes over its lights, fog, reflections and launch mount; again whenever the map changes. */
  bind() {
    const v = this.view;
    const { scene, world } = v;
    this.restoreSite();
    this.kids = [];
    this.world = world;
    scene.remove(...this.look.objects);
    this.look = this.looks[world.map] ??= createLook(world.map, v.renderer);
    scene.add(...this.look.objects);
    // The planet gives way to the map's own terrain, which dips below it in places, while that is drawn.
    const box = new THREE.Box3().setFromObject(world.outer);
    const c = box.getCenter(this._v);
    this.look.planet.material.uniforms.uHole.value.set(c.x - CENTER.x, c.z - CENTER.z, (box.max.x - box.min.x) / 2, 0);
    const mount = world.dressing.mount.clone();
    mount.position.set(0, 0, 0);
    mount.visible = true;
    this.mount.clear().add(mount);
    const lights = world.root.children;
    this.hemi = lights.find((o) => o.isHemisphereLight);
    this.fill = lights.find((o) => o.isDirectionalLight && o !== world.keyLight);
    const k = world.keyLight;
    const keyOff = k.position.clone().sub(k.target.position);
    this.saved = {
      env: scene.environment,
      envI: scene.environmentIntensity,
      fog: scene.fog.density,
      sky: this.hemi.color.clone(),
      ground: this.hemi.groundColor.clone(),
      fill: this.fill.intensity,
      key: k.color.clone(),
      keyI: k.intensity,
      keyPos: k.position.clone(),
      keyTarget: k.target.position.clone(),
      // Where the key light shines from, kept while free flight moves its target.
      keyDir: keyOff.clone().normalize(),
      keyDist: keyOff.length(),
    };
  }

  exit() {
    const v = this.view;
    const { scene, camera } = v;
    scene.remove(...this.objects, ...this.look.objects);
    this.craft.detach();
    this.restoreSite();
    this.kids = [];
    v.pool[2].root.rotation.set(0, 0, 0, 'XYZ');
    v.pool.forEach((s, i) => s.plume.group.scale.copy(this.plumes[i]));
    for (const g of [v.particles.group, v.explosions.group]) {
      g.position.set(0, 0, 0);
      g.rotation.set(0, 0, 0);
    }
    camera.near = 1;
    camera.far = 6000;
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();
    scene.environmentRotation.set(0, 0, 0);
    // A map switched since the last frame brought its own lights and fog, which free flight has not touched.
    if (v.world === this.world) {
      const sv = this.saved;
      const k = this.world.keyLight;
      scene.fog.density = sv.fog;
      scene.environment = sv.env;
      scene.environmentIntensity = sv.envI;
      this.hemi.position.set(0, 1, 0);
      this.hemi.color.copy(sv.sky);
      this.hemi.groundColor.copy(sv.ground);
      this.fill.intensity = sv.fill;
      k.color.copy(sv.key);
      k.intensity = sv.keyI;
      k.target.position.copy(sv.keyTarget);
      k.position.copy(sv.keyPos);
    }
    this.skyOn(true);
  }

  /** Call after each sim step. */
  step(f) {
    const v = this.view;
    this.director.step(f, v.size.w / (v.size.h * (1 + v.lift)));
    const s = f.ship;
    const want = s.mode === 'stacked' || s.mode === 'free' || s.dir > 0 ? ROLL : ROLL + Math.PI;
    this.roll += clamp(want - this.roll, -ROLL_RATE * DT, ROLL_RATE * DT);
    this.crash(f);
  }

  /** On a new crash, the catch game's explosion on the ground under it, its fire along the wreck as vehicles() draws it. */
  crash(f) {
    const boom = f.boom;
    if (!boom || boom === this.boom) return;
    const b = f.booster;
    const s = f.ship;
    const ship = s.mode === 'crashed';
    // The stack comes down as one: the ship still sits on the booster's ring.
    const stack = ship && b.state === 'lost' && alongAxis(this._u, b, BOOSTER_TOP).distanceTo(this._v.set(s.x, s.y, 0)) < 1;
    // Model origins as vehicles() places them: the booster's at its catch point, the ship's above its skirt.
    const bottom = ship && !stack ? alongAxis(this._u, s, SHIP_ENGINE_Y - SKIRT) : alongAxis(this._u, b, ENGINE_Y);
    const top = ship ? alongAxis(this._v, s, -VEHICLES.ship.top / PX_PER_M - SKIRT) : alongAxis(this._v, b, -VEHICLES.booster.top / PX_PER_M);
    const ground = (p) => {
      const q = this.toCatch(f, p.x, p.y);
      return new THREE.Vector3(q.x, q.y + f.anchorLift, 0);
    };
    this.view.explosions.spawn({ t: boom.t, seed: boom.seed, x: toX(boom.x), y: f.anchorLift, bottom: ground(bottom), top: ground(top), drift: boom.wind });
    this.boom = boom;
    this.boomAt = f.anchor;
    this.hold = { t: boom.t, booster: !ship || stack, ship };
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
      this.draw(f, alpha);
    } finally {
      undo?.();
    }
  }

  /** World point -> CSS pixel position on screen. */
  project(x, y, z = 0) {
    const p = this._v.set(x, y, z).project(this.view.camera);
    return { x: (p.x * 0.5 + 0.5) * this.view.size.w, y: (-p.y * 0.5 + 0.5) * this.view.size.h, visible: p.z > -1 && p.z < 1 };
  }

  draw(f, alpha) {
    const v = this.view;
    if (v.world !== this.world) this.bind();
    const { scene, camera, world } = v;
    const { planet, air, space } = this.look;
    const cam = this.placeCamera(f);
    // 1 at the launch site, 0 high up or far away: how much of the catch game's night scene to keep.
    const catchW = (1 - smooth(cam.alt, 1200, 4000)) * (1 - smooth(Math.abs(cam.phi) * R, 4000, 9000));
    const nearSite = camera.position.distanceTo(SITE) < SITE_FAR;

    this.skyOn(catchW > 0);
    world.sky.position.copy(camera.position);
    world.skyMat.uniforms.uTime.value = f.real;
    space.visible = air.visible = catchW < 1;
    space.position.copy(camera.position);
    const sp = space.material.uniforms;
    sp.uFade.value = 1 - catchW;
    sp.uUp.value.copy(camera.up);
    sp.uDip.value = Math.sqrt(Math.max(0, 1 - (R / cam.r) ** 2));
    sp.uTime.value = f.real;
    air.material.uniforms.uFade.value = 1 - catchW;
    planet.material.uniforms.uClouds.value = smooth(cam.alt, 2000, 6000);
    setAirCamera(camera.position);
    // The site's haze thins with height like the air, so a sight line that climbs to the target crosses less of it.
    const dh = Math.abs(local(this.director.tgt.x, this.director.tgt.y).alt - cam.alt) / AH;
    scene.fog.density = this.saved.fog * catchW * (dh > 1e-3 ? (1 - Math.exp(-dh)) / dh : 1);

    this.syncSite();
    const show = { site: nearSite, disc: nearSite && cam.alt < 1500, haze: nearSite && cam.alt < 400, off: false };
    for (const e of this.site) e.o.visible = e.vis && show[e.k];
    planet.material.uniforms.uHole.value.w = show.disc ? 1 : 0;

    this.light(catchW);
    this.tower(f);
    this.effects(f, this.vehicles(f, nearSite), alpha);
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
    const orbit = v.orbit;
    if (d.cuts !== this.cuts) {
      this.cuts = d.cuts;
      orbit.reset(true);
    }
    const T = local(d.tgt.x, d.tgt.y);
    const pos = orbit.apply(this._cam.copy(d.pos), d.tgt, this._w.set(T.ux, T.uy, 0));
    const lift = MIN_ALT - local(pos.x, pos.y).alt;
    if (lift > 0) pos.addScaledVector(this._w, lift);
    camera.position.set(pos.x + Math.sin(t * 37.1) * sh, pos.y + Math.sin(t * 41.7 + 2) * sh, pos.z + Math.sin(t * 29.3 + 4) * sh);
    const L = local(camera.position.x, camera.position.y);
    camera.up.set(L.ux, L.uy, 0);
    camera.lookAt(d.tgt);
    camera.fov = d.fov;
    camera.near = clamp(Math.min(pos.distanceTo(d.tgt) * 0.1, L.alt * 0.5), 1, 50);
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

  /** Launch-site meshes and their own visibility, collected again whenever a model swap changes the scene or the world. */
  syncSite() {
    const v = this.view;
    const a = v.scene.children;
    const b = v.world.root.children;
    const k = this.kids;
    if (a.length + b.length === k.length && a.every((o, i) => o === k[i]) && b.every((o, i) => o === k[a.length + i])) return;
    this.restoreSite();
    this.kids = [...a, ...b];
    const skip = new Set([v.world.sky, v.particles.group, v.explosions.group, v.guide, v.lane, ...v.pool.map((s) => s.root), ...this.look.objects, ...this.craft.objects]);
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

  /**
   * The map's key light at the site, sunlight elsewhere and, in the planet's shadow, a night site's key light or else
   * the moon; with sky light and reflections to match.
   */
  light(catchW) {
    const { scene } = this.view;
    const sv = this.saved;
    const look = this.look;
    const focus = this.director.tgt;
    const L = local(focus.x, focus.y);
    const U = this._u.set(L.ux, L.uy, 0);
    const sun = lum(look.sunlight(focus, this.sun));
    const top = Math.max(this.sun.r, this.sun.g, this.sun.b);
    const k = this.world.keyLight;
    k.target.position.lerpVectors(sv.keyTarget, focus, Math.max(smooth(L.alt, 100, 400), smooth(Math.abs(L.phi) * R, 300, 1000)));
    const w = 1 - catchW;
    // Deep in the planet's shadow, away from a site lit by its sun, the key light is the moon. It fades out before it turns.
    const moon = look.siteSun ? w * (1 - smooth(sun, 0, 0.3)) : 0;
    if (moon > 0.5) {
      k.color.copy(look.moonlight);
      k.intensity = (2 * moon - 1) * smooth(look.moonDir.dot(U), -0.1, 0.1);
      k.position.copy(look.moonDir);
    } else if (look.siteSun) {
      // The site's key light is this sun already: it turns into the sunlight as the site fades out.
      k.color.copy(sv.key);
      if (top > 0) k.color.lerp(this._c.copy(this.sun).multiplyScalar(1 / top), w);
      k.intensity = (sv.keyI * catchW + look.sunI * sun * w) * (1 - 2 * moon);
      k.position.copy(sv.keyDir).lerp(look.sunDir, w).normalize();
    } else if (sun < 0.5) {
      // One light: it fades out before it swaps between the key light's direction and the sun's.
      k.color.copy(sv.key);
      k.intensity = sv.keyI * (1 - 2 * sun) * smooth(sv.keyDir.dot(U), -0.1, 0.1);
      k.position.copy(sv.keyDir);
    } else {
      k.color.copy(this.sun).multiplyScalar(1 / top);
      k.intensity = look.sunI * (2 * sun - 1);
      k.position.copy(look.sunDir);
    }
    k.position.multiplyScalar(sv.keyDist).add(k.target.position);
    // A night site's sky light stays on in the planet's shadow. A day site's fades out with the site, and the planet
    // below takes over, lit by the sun or, in its shadow, by the moon.
    const sky = look.siteSun ? catchW : Math.max(catchW, 1 - sun);
    const shine = look.siteSun ? sun + ((1 - sun) * lum(look.moonlight)) / look.sunI : sun;
    this.hemi.position.copy(U);
    this.hemi.color.copy(sv.sky).multiplyScalar(sky);
    this.hemi.groundColor.copy(sv.ground).multiplyScalar(sky).add(this._c.copy(look.bounce).multiplyScalar(w * shine));
    this.fill.intensity = sv.fill * sky;
    // Both maps are the same PMREM size, so swapping them recompiles nothing; the intensity is 0 at the swap.
    const site = sky > 0.5;
    scene.environment = site ? sv.env : look.env;
    scene.environmentIntensity = site ? sv.envI * (2 * sky - 1) : SPACE_ENV * shine * (1 - 2 * sky);
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

    // A crashed hull stays up until the explosion's fire covers it, as in the catch game.
    const h = this.hold;
    const held = !!h && f.fx.t - h.t < 4.5 * DT;
    // A parked booster was lifted off the tower and taken away while the ship was out of sight.
    bs.root.visible = (b.state !== 'lost' || (held && h.booster)) && b.state !== 'parked' && (nearSite || b.state !== 'caught');
    bs.root.position.set(b.x, b.y, 0);
    bs.root.rotation.set(0, 0, b.ang - Math.PI / 2);
    this.engine(f, 0, b.x, b.y, b.ang, ENGINE_Y, bs.root.visible ? b.throttle : 0, b.engines > 13 ? 1.5 : 1, engines);

    const ox = s.x - Math.cos(s.ang) * SKIRT;
    const oy = s.y - Math.sin(s.ang) * SKIRT;
    ss.root.visible = s.mode !== 'crashed' || (held && h.ship);
    ss.root.position.set(ox, oy, 0);
    faceTower(ss, 1);
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
    const base = this.plumes[i];
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

  /** The catch game's particles turned onto the effects anchor, its explosions onto the ground of the last crash, and the post uniforms. */
  effects(f, engines, alpha) {
    const v = this.view;
    onGround(v.particles.group, f.anchor, f.anchorLift);
    v.particles.update(f.fx.particles, engines);
    onGround(v.explosions.group, this.boomAt, 0);
    // Explosions are a function of time, so frames drawn between sim steps get the in-between time.
    v.explosions.update(f.fx.t - (1 - alpha) * DT, v.camera);

    const fx = f.fx;
    const [r, g, b] = fx.flashColor.split(',').map(Number);
    const fl = fx.flash * 0.1;
    const u = v.final.uniforms;
    u.uFlash.value.set((r / 255) * fl, (g / 255) * fl, (b / 255) * fl);
    u.uDip.value = this.director.dip;
    u.uTime.value = f.real;
  }
}
