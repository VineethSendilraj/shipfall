import * as THREE from 'three';
import { R as HULL_R, SKIRT, WIND } from './ship.js';
import { softDisc } from './textures.js';
import { DOOR_Y, SATS, SHIP_H } from '../flight.js';

// Ship model coordinates: the satellite slot is on the steel (leeward) side, DOOR_Y above the skirt.
const DOOR_THETA = WIND + Math.PI;
const DOOR_ARC = THREE.MathUtils.degToRad(80);
const DOOR_H = 2.2;
const DOOR_MID = DOOR_Y + SKIRT;
const SHIP_MID = -8.7; // halfway between the skirt and the nose tip
const SPAN = 5.4; // centre of the solar array from the middle of the satellite's bus

const v = new THREE.Vector3();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const m = new THREE.Matrix4();
const Y = new THREE.Vector3(0, 1, 0);
const ONE = new THREE.Vector3(1, 1, 1);

const glowVert = /* glsl */ `
  uniform vec3 uWind;
  varying float vFace; varying float vWind; varying float vLen;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFace = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
    vWind = dot(normal, uWind);
    vLen = uv.y;
    gl_Position = projectionMatrix * mv;
  }`;

/**
 * Reentry plasma: the far side of a shell around the hull, so it shows only outside the hull's outline, brightest
 * against it and fading to nothing at the shell's edge, and only on the windward side.
 */
function plasmaMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 }, uWind: { value: new THREE.Vector3(Math.sin(WIND), 0, Math.cos(WIND)) } },
    vertexShader: glowVert,
    fragmentShader: /* glsl */ `
      uniform float uHeat; uniform float uTime;
      varying float vFace; varying float vWind; varying float vLen;
      void main() {
        float face = clamp(vFace, 0.0, 1.0);
        float side = smoothstep(-0.1, 0.9, clamp(vWind, -1.0, 1.0));
        float len = clamp(vLen, 0.0, 1.0);
        float flow = 0.85 + 0.15 * sin(len * 70.0 + uTime * 31.0) * sin(len * 23.0 - uTime * 17.0);
        vec3 col = mix(vec3(0.75, 0.2, 0.85), vec3(2.4, 0.9, 0.3), side);
        gl_FragColor = vec4(col * clamp(1.6 * uHeat * side * face * face * flow, 0.0, 3.0), 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.BackSide,
    fog: false,
  });
}

/**
 * The glowing trail behind a reentering ship: a sheet in the flight plane, as wide as the ship where it leaves the
 * hull, narrowing and fading along -velocity.
 */
function wakeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uHeat: { value: 0 }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uHeat; uniform float uTime;
      varying vec2 vUv;
      void main() {
        vec2 p = clamp(vUv, 0.0, 1.0);
        float u = p.y; // 1 at the ship, 0 at the far end
        float w = (2.0 * p.x - 1.0) / mix(0.25, 1.0, u * u);
        float body = exp(-2.5 * w * w) * smoothstep(1.0, 0.85, u) * u * u * u;
        float flow = (0.8 + 0.2 * sin(u * 45.0 - uTime * 26.0)) * (0.8 + 0.2 * sin(p.x * 30.0 + sin(u * 7.0 - uTime * 3.0) * 1.5));
        vec3 col = mix(vec3(0.45, 0.1, 0.5), vec3(1.6, 0.6, 0.25), u * u);
        gl_FragColor = vec4(col * clamp(1.3 * uHeat * body * flow, 0.0, 2.0), 0.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    side: THREE.DoubleSide,
    fog: false,
  });
}

/**
 * Free flight's extra pieces on and around the vehicles: the ship's satellite door and its dark slot, the reentry
 * plasma and wake, the satellites (instanced), and the hot-staging flash with the glowing vents on the ring.
 */
export class Craft {
  constructor(shipMats) {
    const slotGeo = new THREE.CylinderGeometry(HULL_R + 0.015, HULL_R + 0.015, DOOR_H, 24, 1, true, DOOR_THETA - DOOR_ARC / 2, DOOR_ARC);
    slotGeo.translate(0, DOOR_MID, 0);
    this.slot = new THREE.Mesh(slotGeo, new THREE.MeshBasicMaterial({ color: 0x000000 }));
    const doorGeo = new THREE.CylinderGeometry(HULL_R + 0.03, HULL_R + 0.03, DOOR_H, 24, 1, true, -DOOR_ARC / 2, DOOR_ARC);
    doorGeo.translate(0, DOOR_H / 2, -(HULL_R + 0.03));
    const doorMat = shipMats.steel.clone();
    doorMat.side = THREE.DoubleSide;
    const door = new THREE.Mesh(doorGeo, doorMat);
    door.castShadow = true;
    // Hinged on its aft edge; rotation.y turns the hinge to the slot, rotation.x swings the door out.
    this.door = new THREE.Group();
    this.door.rotation.order = 'YXZ';
    this.door.rotation.y = DOOR_THETA;
    this.door.position.set(Math.sin(DOOR_THETA) * (HULL_R + 0.03), DOOR_MID - DOOR_H / 2, Math.cos(DOOR_THETA) * (HULL_R + 0.03));
    this.door.add(door);

    this.plasma = new THREE.Mesh(new THREE.CapsuleGeometry(7, 38, 8, 32), plasmaMaterial());
    this.plasma.position.set(Math.sin(WIND) * 2, SHIP_MID, Math.cos(WIND) * 2);
    this.shipParts = [this.slot, this.door, this.plasma];

    const wakeGeo = new THREE.PlaneGeometry(1, 1);
    wakeGeo.translate(0, -0.5, 0);
    this.wake = new THREE.Mesh(wakeGeo, wakeMaterial());
    this.wake.frustumCulled = false;

    const bus = new THREE.MeshStandardMaterial({ color: 0xc9a052, metalness: 1, roughness: 0.35 });
    const panel = new THREE.MeshStandardMaterial({ color: 0x1b2a55, metalness: 0.3, roughness: 0.28 });
    this.satBus = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.5, 1.4), bus, SATS);
    this.satPanel = new THREE.InstancedMesh(new THREE.BoxGeometry(7.5, 0.06, 2.4).translate(SPAN, 0, 0), panel, SATS);
    for (const s of [this.satBus, this.satPanel]) {
      s.frustumCulled = false;
      s.castShadow = true;
      s.count = 0;
    }

    this.flash = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: softDisc(), color: new THREE.Color(4, 2.3, 1), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false }),
    );
    this.vents = new THREE.Mesh(
      new THREE.TorusGeometry(HULL_R + 0.25, 0.55, 8, 48),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.vents.rotation.x = Math.PI / 2;
    this.vents.position.y = 9.5;
    this.objects = [this.wake, this.satBus, this.satPanel, this.flash];
  }

  /** Parts that ride on the vehicle models; called every frame since a model swap replaces the roots. */
  attach(shipRoot, boosterRoot) {
    for (const p of this.shipParts) if (p.parent !== shipRoot) shipRoot.add(p);
    if (this.vents.parent !== boosterRoot) boosterRoot.add(this.vents);
  }

  detach() {
    for (const p of [...this.shipParts, this.vents]) p.removeFromParent();
  }

  /** Shows everything once so its shaders compile before the flight needs them. */
  showAll(on) {
    for (const p of [...this.shipParts, this.vents, ...this.objects]) p.visible = on;
    this.satBus.count = this.satPanel.count = on ? 1 : 0;
  }

  /**
   * f: the flight (interpolated for this frame); center: the ship's middle in world space; time: real seconds,
   * for animation that must not speed up with the time warp.
   */
  update(f, center, time) {
    const s = f.ship;
    this.slot.visible = this.door.visible = s.door > 0.001;
    this.door.rotation.x = s.door * 1.2;

    const speed = Math.hypot(s.vx, s.vy);
    // Only a belly-first ship glows: on the way up the air meets the nose, not the tiles.
    const along = speed > 1 ? (Math.cos(s.ang) * s.vx + Math.sin(s.ang) * s.vy) / speed : 1;
    const heat = Math.min(s.heat, 1.2) * (1 - along * along);
    const pu = this.plasma.material.uniforms;
    this.plasma.visible = heat > 0.01;
    pu.uHeat.value = heat;
    pu.uTime.value = time;
    this.wake.visible = heat > 0.02;
    if (this.wake.visible) {
      const wu = this.wake.material.uniforms;
      wu.uHeat.value = heat;
      wu.uTime.value = time;
      this.wake.position.copy(center);
      this.wake.quaternion.setFromUnitVectors(Y, v.set(s.vx / speed, s.vy / speed, 0));
      this.wake.scale.set(SHIP_H, 40 + 140 * heat, 1);
    }

    let n = 0;
    for (const p of f.sats) {
      if (p.gone) continue;
      const k = p.spin * 6.283;
      e.set(k + time * (0.15 + 0.2 * p.spin), time * 0.11 + k * 0.5, 0.4 * Math.sin(time * 0.2 + k));
      m.compose(v.set(p.x, p.y, p.z), q.setFromEuler(e), ONE);
      this.satBus.setMatrixAt(n, m);
      this.satPanel.setMatrixAt(n, m);
      n++;
    }
    this.satBus.count = this.satPanel.count = n;
    this.satBus.visible = this.satPanel.visible = n > 0;
    this.satBus.instanceMatrix.needsUpdate = this.satPanel.instanceMatrix.needsUpdate = n > 0;

    const age = f.marks.stage == null ? -1 : f.t - f.marks.stage;
    const b = f.booster;
    this.flash.visible = age >= 0 && age < 0.9;
    if (this.flash.visible) {
      this.flash.position.set(b.x + Math.cos(b.ang) * 10, b.y + Math.sin(b.ang) * 10, 0);
      this.flash.material.opacity = Math.exp(-age * 5);
      this.flash.scale.setScalar(16 + 28 * age);
    }
    const vent = age >= 0 && age < 3 ? Math.exp(-age * 1.4) : 0;
    this.vents.visible = vent > 0.01;
    this.vents.material.color.setRGB(3.2 * vent, 1.2 * vent, 0.35 * vent);
  }
}
