import * as THREE from 'three';
import { createBooster, ENGINE_Y } from './booster.js';
import { createShip } from './ship.js';
import { createPlume } from './effects.js';
import { assembleStack, stackHeight } from './stack.js';
import { createFlightFx } from './flight-fx.js';
import { FlightCamera } from './flight-camera.js';
import { toX, toY } from './director.js';
import { FLIGHT, towerColliders } from '../flight.js';
import { towerPositions, ARM_DEFAULT } from '../sim.js';

const WORLD_W = 1280;
const ARM_Y = toY(ARM_DEFAULT);
// Both catch towers where the catch game puts them (tower B is the one that rises for the double catch).
const TOWER_XS = Object.values(towerPositions(WORLD_W)).map(toX);
const MOUNT_TOP = 22.25;
const MOUNT_R = 14.25;
const BORE_R = 5.2;
// Turned so the camera behind the stack sees the ship's tiles on one half and bare steel on the other.
const MODEL_YAW = Math.PI / 2;
const UP = new THREE.Vector3(0, 1, 0);
const COL_IDLE = new THREE.Color(0.25, 0.95, 1.5);
const COL_READY = new THREE.Color(0.35, 2.6, 0.75);
const COL_OFF = new THREE.Color(0.08, 0.25, 0.35);
const HORIZON_R = 5300;
const FLIGHT_NEAR = 3;
const GROUND_SCALE = 1.36; // the 4 km ground disk, stretched past the horizon wall
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const lerpAngle = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;

/** Faint vertical light over the launch mount so it can be found from anywhere on the site. */
function beaconMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: COL_IDLE.clone() }, uAmp: { value: 1 } },
    vertexShader: /* glsl */ `
      varying float vV; varying float vDepth;
      void main() {
        vV = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uAmp; varying float vV; varying float vDepth;
      void main() {
        float a = (1.0 - vV) * (1.0 - vV) * 0.16 * uAmp * smoothstep(150.0, 420.0, vDepth);
        gl_FragColor = vec4(uColor * a, 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    fog: false,
  });
}

/**
 * Draws free flight with the catch game's renderer, scene, composer, towers and lights. Everything it adds
 * stays hidden outside free flight, and it borrows one engine light and the crash light instead of adding
 * lights, so the catch game's frame cost and shaders are untouched.
 */
export class FlightView {
  constructor(view, models = null) {
    this.view = view;
    this.group = new THREE.Group();
    this.group.name = 'free-flight';
    this.group.visible = false;
    this.rig = new THREE.Group();
    this.group.add(this.rig);
    this.fx = createFlightFx(view.boosterMats);
    this.group.add(this.fx.group);

    const ringMat = new THREE.MeshBasicMaterial({ color: COL_IDLE.clone(), toneMapped: false, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending });
    this.marker = new THREE.Mesh(new THREE.TorusGeometry(FLIGHT.mountLandR, 0.2, 6, 120), ringMat);
    this.marker.rotation.x = Math.PI / 2;
    const beaconGeo = new THREE.CylinderGeometry(1.4, 1.4, 420, 16, 1, true);
    beaconGeo.translate(0, 210, 0);
    this.beacon = new THREE.Mesh(beaconGeo, beaconMaterial());
    this.beacon.frustumCulled = false;
    // From altitude the ground disk's edge would show, with the sky's dark underside below the horizon: the
    // ground follows the camera in flight, and a wall in the fog's color closes the gap up to the horizon.
    const wallGeo = new THREE.CylinderGeometry(HORIZON_R, HORIZON_R, 1, 64, 1, true);
    wallGeo.translate(0, 0.5, 0);
    this.wall = new THREE.Mesh(wallGeo, new THREE.MeshBasicMaterial({ color: view.scene.fog.color, side: THREE.BackSide, fog: false }));
    this.wall.frustumCulled = false;
    this.group.add(this.marker, this.beacon, this.wall);
    this.fogDensity = view.scene.fog.density;
    this.near = view.camera.near;

    this.camera = new FlightCamera();
    this.prev = { valid: false, frame: -1, pos: new THREE.Vector3(), lean: new THREE.Vector2(), yaw: 0, throttle: 0, cpos: new THREE.Vector3(), ctgt: new THREE.Vector3(), fov: 46 };
    this._q = new THREE.Quaternion();
    this._q2 = new THREE.Quaternion();
    this._u = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this._cp = new THREE.Vector3();
    this._ct = new THREE.Vector3();
    this.glow = { x: 0, y: 0, z: 0, power: 0 };
    this.crashT = -1;
    this.build(models);
    view.scene.add(this.group);
  }

  /** (Re)builds the stack from the loaded models, or the procedural booster without them. */
  build(models) {
    if (this.stack) {
      this.rig.remove(this.stack);
      this.booster.root.remove(this.plume.group);
    }
    let booster;
    try {
      booster = createBooster(this.view.boosterMats, models?.booster ?? null);
    } catch (err) {
      console.error('booster model unusable in free flight; using the procedural one', err);
      booster = createBooster(this.view.boosterMats);
    }
    this.plume ??= createPlume();
    booster.root.add(this.plume.group);
    const ship = this.makeShip(models);
    this.booster = booster;
    this.hasShip = !!ship;
    this.stack = assembleStack(booster, ship);
    this.stack.position.y = -FLIGHT.comH - ENGINE_Y;
    this.rig.add(this.stack);
    this.stackH = stackHeight(this.hasShip);
    // Debris in the stack's own steel (the baked-AO variants once the models load): no new shaders mid-crash.
    const byRole = {};
    booster.root.traverse((o) => {
      if (o.isMesh && o.userData.role && !byRole[o.userData.role]) byRole[o.userData.role] = o.material;
    });
    this.fx.setDebrisMaterials(byRole.steel ?? this.view.boosterMats.steel, byRole.darkSteel ?? this.view.boosterMats.darkSteel);
  }

  /** The upper stage (ship.glb, or the procedural ship without it). */
  makeShip(models) {
    try {
      return createShip(this.view.shipMats, models?.ship ?? null);
    } catch (err) {
      console.error('ship model unusable in free flight; using the procedural one', err);
      return createShip(this.view.shipMats);
    }
  }

  useModels(models) {
    this.build(models);
  }

  get mount() {
    const p = this.view.world.dressing.mount.position;
    return { x: p.x, z: p.z, top: MOUNT_TOP, r: MOUNT_R };
  }

  /** Obstacles for the flight model: both towers, the tank farm, outbuildings and floodlight masts. */
  colliders() {
    const v = this.view;
    const out = [...towerColliders(TOWER_XS[0], -1, ARM_Y), ...towerColliders(TOWER_XS[1], 1, ARM_Y)];
    const { tanks, mats } = v.world.dressing;
    let rack = null;
    for (const o of tanks.children) {
      if (!o.isMesh) continue;
      const g = o.geometry;
      const p = o.position;
      if (g.type === 'CylinderGeometry' && o.material === mats.tankSteel && !g.parameters.openEnded) {
        const r = g.parameters.radiusTop;
        out.push({ type: 'cyl', kind: 'tanks', x: p.x, z: p.z, r, y0: 0, y1: p.y + g.parameters.height / 2 + 0.35 * r });
      } else if (g.type === 'SphereGeometry' && o.material === mats.insulated) {
        const r = g.parameters.radius;
        out.push({ type: 'cyl', kind: 'tanks', x: p.x, z: p.z, r: r + 0.3, y0: 0, y1: p.y + r });
      } else if (g.type === 'BoxGeometry' && o.material === mats.band) {
        const w = g.parameters.width / 2;
        rack = { type: 'box', kind: 'tanks', min: [p.x - w, 0, p.z - 2], max: [p.x + w, 9.6, p.z + 2] };
      }
    }
    if (rack) out.push(rack);
    for (const o of tanks.parent.children) {
      if (!o.isMesh || o.geometry.type !== 'BoxGeometry' || o.material !== v.towerMats.carriage) continue;
      const { width, height, depth } = o.geometry.parameters;
      const p = o.position;
      out.push({ type: 'box', kind: 'building', min: [p.x - width / 2, 0, p.z - depth / 2], max: [p.x + width / 2, p.y + height / 2, p.z + depth / 2] });
    }
    for (const spot of v.world.floods) out.push({ type: 'cyl', kind: 'mast', x: spot.position.x, z: spot.position.z, r: 2.8, y0: 0, y1: spot.position.y + 1.5 });
    return out;
  }

  enter(f) {
    const v = this.view;
    this.group.visible = true;
    v.particles.group.visible = false;
    v.guide.visible = false;
    v.lane.visible = false;
    for (const s of v.pool) {
      s.root.visible = false;
      s.light.intensity = 0;
    }
    v.crashLight.intensity = 0;
    // The flight camera never comes within a few meters of anything; a farther near plane buys depth precision.
    v.camera.near = FLIGHT_NEAR;
    v.camera.updateProjectionMatrix();
    this.rig.visible = true;
    this.fx.reset();
    this.crashT = -1;
    this.prev.valid = false;
    this.camera.reset(f, this.view.lift);
  }

  exit() {
    const v = this.view;
    this.group.visible = false;
    v.particles.group.visible = true;
    v.pool[0].light.intensity = 0;
    v.crashLight.intensity = 0;
    v.final.uniforms.uFlash.value.set(0, 0, 0);
    v.scene.fog.density = this.fogDensity;
    v.world.haze.material.uniforms.uFade.value = 1;
    v.world.outer.position.set(0, -0.05, 0);
    v.world.outer.scale.set(1, 1, 1);
    v.camera.near = this.near;
    v.camera.updateProjectionMatrix();
  }

  /** Call before each flight step, so frames between steps can be interpolated. */
  snapshot(f) {
    const p = this.prev;
    p.valid = true;
    p.frame = f.frame;
    p.pos.set(f.pos.x, f.pos.y, f.pos.z);
    p.lean.set(f.lean.x, f.lean.z);
    p.yaw = f.yaw;
    p.throttle = f.throttle;
    p.cpos.copy(this.camera.pos);
    p.ctgt.copy(this.camera.tgt);
    p.fov = this.camera.fov;
  }

  /** Call after each flight step: effects and camera advance with the simulation. */
  step(f) {
    const fx = this.fx;
    const m = f.mount;
    for (const ev of f.events) {
      if (ev.type === 'liftoff') fx.burst(m.x, 2, m.z, 80, 15, 28);
      else if (ev.type === 'land') fx.burst(f.base.x, f.lowY, f.base.z, 36, 7, 14);
      else if (ev.type === 'crash') {
        const { base, axis } = f;
        fx.explode(ev.x, ev.y, ev.z, base.x, base.y, base.z, axis.x, axis.y, axis.z, f.stackH);
        this.crashT = f.t;
      }
    }
    if (f.engines && f.throttle > 0.05 && f.phase === 'flying') {
      const e = f.base;
      const u = f.axis;
      if (f.surface === 'mount' && f.mountDist < m.r - 2) {
        // Exhaust down the mount's bore: steam out from under the ring table, between its legs.
        const k = f.throttle * Math.max(0, 1 - (e.y - m.top) / 95);
        if (k > 0.02) fx.blast(m.x, 0, m.z, Math.min(1.6, k * 1.8), 12);
      } else {
        const d = e.y / Math.max(0.3, u.y);
        const k = f.throttle * Math.max(0, 1 - e.y / 80);
        if (k > 0.02) fx.blast(e.x - u.x * d, 0, e.z - u.z * d, k);
      }
    }
    if (this.crashT >= 0) {
      const u = f.t - this.crashT;
      if (u < 7) fx.smolder(f.impact.x, f.impact.z, 1 - u / 7);
    }
    fx.step();
    this.camera.step(f, this.view.lift);
  }

  setTowers(t) {
    const v = this.view;
    const xs = TOWER_XS;
    v.towers.forEach((tw, i) => {
      tw.root.visible = true;
      tw.root.position.set(xs[i], 0, 0);
      tw.setArms(1, ARM_Y);
      const blink = Math.sin(t * 2.6 + i * 1.7) > 0.35 ? 1 : 0.12;
      tw.glowMat.color.copy(COL_OFF);
      tw.lightMat.color.setRGB(4 * blink, 0.25 * blink, 0.15);
      tw.spot.intensity = 90;
    });
  }

  /** alpha: how far the frame is between the last two steps (1 = exactly the latest step). */
  draw(f, alpha = 1) {
    const v = this.view;
    const p = this.prev;
    const a = p.valid && p.frame === f.frame - 1 ? alpha : 1;
    const t = f.t - (1 - a) * (1 / 60);

    // Stack pose, blended between the last two steps.
    const px = lerp(p.pos.x, f.pos.x, a);
    const py = lerp(p.pos.y, f.pos.y, a);
    const pz = lerp(p.pos.z, f.pos.z, a);
    const lx = lerp(p.lean.x, f.lean.x, a);
    const lz = lerp(p.lean.y, f.lean.z, a);
    const yaw = a < 1 ? lerpAngle(p.yaw, f.yaw, a) : f.yaw;
    const thr = a < 1 ? lerp(p.throttle, f.throttle, a) : f.throttle;
    const u = this._u.set(lx, 1, lz).normalize();
    this.rig.position.set(px, py, pz);
    this._q.setFromAxisAngle(UP, yaw + MODEL_YAW);
    this._q2.setFromUnitVectors(UP, u);
    this.rig.quaternion.multiplyQuaternions(this._q2, this._q);
    this.rig.visible = f.phase !== 'crashed';

    // Engines: plume down to whatever it hits (through the mount's bore to the ground), throat glow, light.
    const ex = px - u.x * FLIGHT.comH;
    const ey = py - u.y * FLIGHT.comH;
    const ez = pz - u.z * FLIGHT.comH;
    const md = Math.hypot(ex - f.mount.x, ez - f.mount.z);
    const floorY = md < BORE_R || md > f.mount.r ? 0 : f.mount.top;
    this.plume.update(thr, t, Math.max(0, (ey - floorY) / u.y));
    this.booster.throatMat.color.setRGB(7 * thr + 0.02, 3 * thr, 0.9 * thr);
    const light = v.pool[0].light;
    light.position.set(ex - u.x * 12, Math.max(2, ey - u.y * 12), ez - u.z * 12);
    light.intensity = thr > 0.02 ? 1400 * (0.25 + thr) : 0;
    for (let i = 1; i < v.pool.length; i++) v.pool[i].light.intensity = 0;
    const glow = this.glow;
    glow.x = ex - u.x * 10;
    glow.y = ey - u.y * 10;
    glow.z = ez - u.z * 10;
    glow.power = thr > 0.02 ? thr : 0;

    // Explosion light.
    const ct = this.crashT >= 0 ? t - this.crashT : 99;
    v.crashLight.intensity = ct < 5 ? 40000 * Math.exp(-ct * 1.3) * (0.85 + 0.15 * Math.sin(t * 31)) : 0;
    if (ct < 5) v.crashLight.position.set(f.impact.x, Math.max(10, f.impact.y + 12), f.impact.z);

    // Landing target on the mount and the beacon above it.
    const m = f.mount;
    this.marker.position.set(m.x, m.top + 0.35, m.z);
    const zone = f.landingZone;
    this.marker.material.color.copy(zone === 2 ? COL_READY : COL_IDLE);
    const pulse = 0.55 + 0.25 * Math.sin(t * 3.2);
    this.marker.material.opacity = f.phase === 'flying' ? (zone ? 0.95 : pulse) : f.phase === 'ready' ? 0.35 : 0;
    this.marker.visible = f.phase !== 'crashed' && !(f.phase === 'landed' && f.result?.onMount);
    this.beacon.position.set(m.x, m.top, m.z);
    this.beacon.visible = f.phase === 'flying' && f.airborne;
    this.beacon.material.uniforms.uAmp.value = Math.min(1, Math.max(0, (Math.hypot(f.base.x - m.x, f.base.z - m.z) - 60) / 200 + (f.lowY - 120) / 300));

    this.setTowers(t);

    // Camera between the last two steps (not across a cut).
    const cam = this.camera;
    const ca = p.cpos.distanceToSquared(cam.pos) < 900 ? a : 1;
    const cp = ca < 1 ? this._cp.lerpVectors(p.cpos, cam.pos, ca) : cam.pos;
    const ctg = ca < 1 ? this._ct.lerpVectors(p.ctgt, cam.tgt, ca) : cam.tgt;
    cam.apply(v.camera, f, cp, ctg, ca < 1 ? lerp(p.fov, cam.fov, ca) : cam.fov);

    const scale = (v.size.h * (1 + v.lift) * v.pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(v.camera.fov / 2)));
    this.fx.render(a, scale, glow.power > 0 ? glow : null);

    const camPos = v.camera.position;
    v.world.sky.position.copy(camPos);
    v.world.skyMat.uniforms.uTime.value = t;
    // Seen from far above, 5 cm under the pad z-fights; the outer ground is plain, so it drops out of the way.
    v.world.outer.position.set(camPos.x, -3, camPos.z);
    v.world.outer.scale.set(GROUND_SCALE, GROUND_SCALE, 1);
    this.wall.position.set(camPos.x, -0.1, camPos.z);
    this.wall.scale.y = Math.max(1, camPos.y + 0.1);
    // Thinner fog higher up keeps the site readable from above; the ground haze only belongs near the ground.
    v.scene.fog.density = this.fogDensity * (1 - 0.6 * smooth(80, 900, camPos.y));
    v.world.haze.material.uniforms.uFade.value = 1 - smooth(14, 55, camPos.y);
    const fu = v.final.uniforms;
    // Heat haze below the engines.
    fu.uHaze2.value.z = 0;
    if (thr > 0.02 && f.phase !== 'crashed') {
      const q = this._v.set(glow.x - u.x * 6, glow.y - u.y * 6, glow.z - u.z * 6).project(v.camera);
      const q2 = this._v2.set(glow.x - u.x * 6 + 12, glow.y - u.y * 6, glow.z - u.z * 6).project(v.camera);
      const r = Math.max(0.02, Math.hypot(q2.x - q.x, q2.y - q.y) * 0.5 * v.aspect);
      fu.uHaze.value.set(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5, q.z < 1 ? Math.min(1, thr * 1.6) : 0, r);
    } else fu.uHaze.value.z = 0;
    const fl = f.flash * 0.12;
    fu.uFlash.value.set(fl, fl * 0.6, fl * 0.32);
    fu.uDip.value = 0;
    fu.uTime.value = t;
    v.composer.render();
  }
}
