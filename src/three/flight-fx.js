import * as THREE from 'three';
import { makePoints } from './effects.js';
import { createRng } from '../rng.js';
import { DT } from '../sim.js';

// Free-flight effects in world space: ground steam and dust under the engines, and the explosion (fireball,
// smoke, sparks, tumbling debris). Fixed-size pools stepped with the simulation from a seeded random stream,
// so a scripted flight looks the same every run; nothing is allocated per frame.
export const STEAM = 0;
export const DUST = 1;
export const FIRE = 2;
export const SMOKE = 3;
export const SPARK = 4;

const MAX = 1500;
const MAX_STREAKS = 500;
const DEBRIS = 18;
const FIRE_RAMP = [2.3, 1.55, 0.7, 1.7, 0.75, 0.2, 0.95, 0.3, 0.06, 0.3, 0.07, 0.02];

function fireColor(u, out) {
  const s = Math.min(0.999, Math.max(0, u)) * 3;
  const i = Math.floor(s);
  const t = s - i;
  for (let k = 0; k < 3; k++) out[k] = FIRE_RAMP[i * 3 + k] + (FIRE_RAMP[i * 3 + 3 + k] - FIRE_RAMP[i * 3 + k]) * t;
  return out;
}

export function createFlightFx(mats) {
  const glow = makePoints(MAX, true, 0);
  const smoke = makePoints(MAX, false, 1);
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_STREAKS * 6), 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX_STREAKS * 6), 3).setUsage(THREE.DynamicDrawUsage));
  streakGeo.setDrawRange(0, 0);
  const streaks = new THREE.LineSegments(
    streakGeo,
    new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
  );
  streaks.frustumCulled = false;
  const group = new THREE.Group();
  group.add(smoke, glow, streaks);

  // Debris: plain meshes sharing one box, in the booster's own materials (no new shader programs).
  const chunk = new THREE.BoxGeometry(1, 1, 1);
  const debris = [];
  for (let i = 0; i < DEBRIS; i++) {
    const m = new THREE.Mesh(chunk, i % 3 === 0 ? mats.darkSteel : mats.steel);
    m.castShadow = true;
    m.visible = false;
    group.add(m);
    debris.push({ mesh: m, vx: 0, vy: 0, vz: 0, wx: 0, wy: 0, wz: 0, rest: false });
  }

  const px = new Float32Array(MAX);
  const py = new Float32Array(MAX);
  const pz = new Float32Array(MAX);
  const vx = new Float32Array(MAX);
  const vy = new Float32Array(MAX);
  const vz = new Float32Array(MAX);
  const age = new Float32Array(MAX);
  const life = new Float32Array(MAX);
  const size = new Float32Array(MAX);
  const grow = new Float32Array(MAX);
  const seed = new Float32Array(MAX);
  const kind = new Uint8Array(MAX);
  const col = [0, 0, 0];
  let n = 0;
  let rng = createRng(9071);

  function spawn(k, x, y, z, ux, uy, uz, l, s, gr) {
    if (n >= MAX) return;
    px[n] = x;
    py[n] = y;
    pz[n] = z;
    vx[n] = ux;
    vy[n] = uy;
    vz[n] = uz;
    age[n] = 0;
    life[n] = l;
    size[n] = s;
    grow[n] = gr;
    seed[n] = rng.next();
    kind[n] = k;
    n++;
  }

  function remove(i) {
    n--;
    px[i] = px[n];
    py[i] = py[n];
    pz[i] = pz[n];
    vx[i] = vx[n];
    vy[i] = vy[n];
    vz[i] = vz[n];
    age[i] = age[n];
    life[i] = life[n];
    size[i] = size[n];
    grow[i] = grow[n];
    seed[i] = seed[n];
    kind[i] = kind[n];
  }

  return {
    group,
    get count() {
      return n;
    },
    reset() {
      n = 0;
      rng = createRng(9071);
      for (const d of debris) d.mesh.visible = false;
    },
    rand: (lo, hi) => rng.range(lo, hi),

    /**
     * Exhaust meeting a surface at (x, y, z): steam and dust thrown out radially along it. k: 0..1 strength.
     * ring: spawn on a circle of this radius (under the mount's ring table) instead of at the point.
     */
    blast(x, y, z, k, ring = 0) {
      const count = Math.floor(k * 3.2 + rng.next());
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const r = ring ? ring * rng.range(0.7, 1.05) : rng.range(2, 9);
        const sp = rng.range(10, 30) * (0.45 + 0.75 * k);
        const isDust = !ring && rng.chance(0.3);
        const big = rng.next();
        spawn(isDust ? DUST : STEAM, x + c * r, y + rng.range(0.5, 4), z + s * r, c * sp, rng.range(2, 10), s * sp, rng.range(2.6, 5.2), 5 + big * 8, 4 + big * 6);
      }
    },

    /** A big cloud all at once: the liftoff and touchdown billows. */
    burst(x, y, z, count, radius, speed) {
      for (let i = 0; i < count; i++) {
        const a = rng.range(0, Math.PI * 2);
        const c = Math.cos(a);
        const s = Math.sin(a);
        const r = radius * rng.range(0.5, 1.2);
        const sp = speed * rng.range(0.3, 1.1);
        const big = rng.next();
        spawn(STEAM, x + c * r, y + rng.range(0, 18) * rng.next(), z + s * r, c * sp, rng.range(3, 15), s * sp, rng.range(4.5, 8.5), 8 + big * 10, 5 + big * 7);
      }
    },

    /**
     * The stack coming apart: a fireball along its length, a dark smoke column, sparks and debris.
     * (x, y, z): impact point; axis/len: the stack from its engine plane; speed: impact speed.
     */
    explode(x, y, z, bx, by, bz, ax, ay, az, len) {
      // Dark smoke first, so the fire reads as burning inside it rather than as a solid glow.
      for (let i = 0; i < 110; i++) {
        const s = rng.range(0, len * 0.9);
        const a = rng.range(0, Math.PI * 2);
        const sp = rng.range(2, 14);
        spawn(SMOKE, bx + ax * s + Math.cos(a) * 5, Math.max(3, by + ay * s), bz + az * s + Math.sin(a) * 5, Math.cos(a) * sp, rng.range(2, 10), Math.sin(a) * sp, rng.range(5, 9), rng.range(14, 24), rng.range(6, 12));
      }
      for (let i = 0; i < 130; i++) {
        const s = rng.range(0, len) * Math.sqrt(rng.next());
        const a = rng.range(0, Math.PI * 2);
        const sp = rng.range(8, 36);
        spawn(FIRE, bx + ax * s, Math.max(1, by + ay * s), bz + az * s, Math.cos(a) * sp, rng.range(-2, 16), Math.sin(a) * sp, rng.range(1.0, 2.3), rng.range(10, 18), rng.range(14, 24));
      }
      for (let i = 0; i < 50; i++) {
        const a = rng.range(0, Math.PI * 2);
        const sp = rng.range(14, 42);
        spawn(FIRE, x + Math.cos(a) * 4, y + 2, z + Math.sin(a) * 4, Math.cos(a) * sp, rng.range(0, 10), Math.sin(a) * sp, rng.range(0.8, 1.8), rng.range(8, 14), rng.range(12, 20));
      }
      // The first instant: a few huge, short-lived flashes around the middle of the stack.
      for (let i = 0; i < 8; i++) {
        const s = len * rng.range(0.25, 0.7);
        spawn(FIRE, bx + ax * s + rng.range(-6, 6), Math.max(8, by + ay * s), bz + az * s + rng.range(-6, 6), 0, rng.range(2, 8), 0, rng.range(0.35, 0.6), rng.range(40, 60), rng.range(30, 50));
      }
      for (let i = 0; i < 260; i++) {
        const s = rng.range(0, len);
        const a = rng.range(0, Math.PI * 2);
        const up = rng.range(-0.2, 1);
        const sp = rng.range(20, 75);
        const h = Math.sqrt(1 - up * up);
        spawn(SPARK, bx + ax * s, Math.max(1, by + ay * s), bz + az * s, Math.cos(a) * h * sp, up * sp, Math.sin(a) * h * sp, rng.range(1.2, 3.2), 0.5, 0);
      }
      for (let i = 0; i < 50; i++) {
        const a = rng.range(0, Math.PI * 2);
        const sp = rng.range(15, 40);
        spawn(DUST, x + Math.cos(a) * 6, 1.5, z + Math.sin(a) * 6, Math.cos(a) * sp, rng.range(1, 5), Math.sin(a) * sp, rng.range(2.5, 4.5), rng.range(9, 15), rng.range(8, 14));
      }
      debris.forEach((d, i) => {
        const s = rng.range(0.1, 0.95) * len;
        const a = rng.range(0, Math.PI * 2);
        const sp = rng.range(10, 38);
        d.mesh.position.set(bx + ax * s, Math.max(2, by + ay * s), bz + az * s);
        d.mesh.scale.set(rng.range(1.5, 6), rng.range(0.8, 3.2), rng.range(0.25, 1.2));
        d.mesh.rotation.set(rng.range(0, 6.3), rng.range(0, 6.3), rng.range(0, 6.3));
        d.vx = Math.cos(a) * sp;
        d.vz = Math.sin(a) * sp;
        d.vy = rng.range(6, 30) + (i % 4 === 0 ? 14 : 0);
        d.wx = rng.range(-6, 6);
        d.wy = rng.range(-6, 6);
        d.wz = rng.range(-6, 6);
        d.rest = false;
        d.mesh.visible = true;
      });
    },

    /** Burning wreckage: a little fire and a lot of smoke at (x, z) for a while after the explosion. */
    smolder(x, z, k) {
      if (rng.next() < 0.9 * k) {
        const a = rng.range(0, Math.PI * 2);
        const r = rng.range(0, 14);
        spawn(FIRE, x + Math.cos(a) * r, rng.range(1, 6), z + Math.sin(a) * r, rng.range(-2, 2), rng.range(5, 11), rng.range(-2, 2), rng.range(0.6, 1.3), rng.range(5, 9), rng.range(6, 10));
      }
      if (rng.next() < 0.7 * k) {
        const a = rng.range(0, Math.PI * 2);
        spawn(SMOKE, x + Math.cos(a) * 8, rng.range(4, 12), z + Math.sin(a) * 8, rng.range(-2, 2), rng.range(5, 10), rng.range(-2, 2), rng.range(5, 8), rng.range(12, 18), rng.range(7, 11));
      }
    },

    step() {
      for (let i = n - 1; i >= 0; i--) {
        age[i] += DT;
        if (age[i] >= life[i]) {
          remove(i);
          continue;
        }
        const k = kind[i];
        let drag = 0.985;
        let lift = 0;
        if (k === STEAM) {
          drag = 0.975;
          lift = 2.6;
        } else if (k === DUST) {
          drag = 0.97;
          lift = -0.4;
        } else if (k === FIRE) {
          drag = 0.94;
          lift = 7;
        } else if (k === SMOKE) {
          lift = 2.8;
        } else {
          drag = 0.996;
          lift = -9.81;
        }
        vx[i] *= drag;
        vz[i] *= drag;
        vy[i] = vy[i] * (k === SPARK ? 1 : drag) + lift * DT;
        px[i] += vx[i] * DT;
        py[i] += vy[i] * DT;
        pz[i] += vz[i] * DT;
        if (k === SPARK) {
          if (py[i] < 0.2 && vy[i] < 0) {
            py[i] = 0.2;
            vy[i] *= -0.35;
            vx[i] *= 0.6;
            vz[i] *= 0.6;
          }
        } else {
          // Clouds roll along the ground instead of sinking into it.
          const floor = (size[i] + grow[i] * age[i]) * 0.3;
          if (py[i] < floor) {
            py[i] = floor;
            if (vy[i] < 0) vy[i] = 0;
          }
        }
      }
      for (const d of debris) {
        if (!d.mesh.visible || d.rest) continue;
        const m = d.mesh;
        d.vy -= 9.81 * DT;
        m.position.x += d.vx * DT;
        m.position.y += d.vy * DT;
        m.position.z += d.vz * DT;
        m.rotation.x += d.wx * DT;
        m.rotation.y += d.wy * DT;
        m.rotation.z += d.wz * DT;
        const floor = m.scale.y * 0.5;
        if (m.position.y < floor) {
          m.position.y = floor;
          d.vy = Math.abs(d.vy) > 4 ? -d.vy * 0.3 : 0;
          d.vx *= 0.55;
          d.vz *= 0.55;
          d.wx *= 0.5;
          d.wy *= 0.5;
          d.wz *= 0.5;
          if (Math.hypot(d.vx, d.vy, d.vz) < 0.8) d.rest = true;
        }
      }
    },

    hideDebris() {
      for (const d of debris) d.mesh.visible = false;
    },

    /**
     * Writes the GPU buffers. alpha: how far the frame is past the last step (particles are drawn back along
     * their velocity, so they move smoothly between steps). glow: engine glow { x, y, z, power } or null.
     */
    render(alpha, scale, glowAt) {
      glow.material.uniforms.uScale.value = scale;
      smoke.material.uniforms.uScale.value = scale;
      const gp = glow.geometry.attributes;
      const sp = smoke.geometry.attributes;
      const lp = streakGeo.attributes;
      const back = (1 - alpha) * DT;
      let ng = 0;
      let ns = 0;
      let nl = 0;
      for (let i = 0; i < n; i++) {
        const u = age[i] / life[i];
        const x = px[i] - vx[i] * back;
        const y = py[i] - vy[i] * back;
        const z = pz[i] - vz[i] * back;
        const s = size[i] + grow[i] * age[i];
        const k = kind[i];
        if (k === FIRE) {
          fireColor(u, col);
          gp.position.setXYZ(ng, x, y, z);
          gp.aColor.setXYZW(ng, col[0], col[1], col[2], Math.pow(1 - u, 1.4) * 0.42);
          gp.aSize.setX(ng, s);
          gp.aSeed.setX(ng, seed[i]);
          ng++;
        } else if (k === SPARK) {
          const fade = (1 - u) * (1 - u);
          if (nl < MAX_STREAKS) {
            lp.position.setXYZ(nl * 2, x, y, z);
            lp.position.setXYZ(nl * 2 + 1, x - vx[i] * 0.05, y - vy[i] * 0.05, z - vz[i] * 0.05);
            lp.color.setXYZ(nl * 2, 3.2 * fade, 1.7 * fade, 0.55 * fade);
            lp.color.setXYZ(nl * 2 + 1, 0, 0, 0);
            nl++;
          }
          gp.position.setXYZ(ng, x, y, z);
          gp.aColor.setXYZW(ng, 6, 3.6, 1.2, fade);
          gp.aSize.setX(ng, 0.45);
          gp.aSeed.setX(ng, seed[i]);
          ng++;
        } else {
          let a;
          let r;
          let g;
          let b;
          if (k === STEAM) {
            a = Math.sin(Math.PI * Math.min(1, u * 1.25)) * 0.27;
            r = 0.44;
            g = 0.45;
            b = 0.48;
          } else if (k === DUST) {
            a = Math.sin(Math.PI * Math.min(1, u * 1.2)) * 0.4;
            r = 0.34;
            g = 0.29;
            b = 0.24;
          } else {
            a = Math.sin(Math.PI * Math.min(1, u * 1.1)) * 0.58;
            // Fresh smoke still glows from the fire inside it.
            const hot = Math.max(0, 1 - u * 4);
            r = 0.045 + hot * 0.75;
            g = 0.045 + hot * 0.28;
            b = 0.05 + hot * 0.06;
          }
          if (glowAt) {
            const dx = x - glowAt.x;
            const dy = y - glowAt.y;
            const dz = z - glowAt.z;
            const lit = Math.min(0.8, (glowAt.power * 1800) / (dx * dx + dy * dy + dz * dz + 900));
            r += lit * 0.42;
            g += lit * 0.2;
            b += lit * 0.05;
          }
          sp.position.setXYZ(ns, x, y, z);
          sp.aColor.setXYZW(ns, r, g, b, a);
          sp.aSize.setX(ns, s);
          sp.aSeed.setX(ns, seed[i]);
          ns++;
        }
      }
      glow.geometry.setDrawRange(0, ng);
      smoke.geometry.setDrawRange(0, ns);
      streakGeo.setDrawRange(0, nl * 2);
      gp.position.needsUpdate = gp.aColor.needsUpdate = gp.aSize.needsUpdate = gp.aSeed.needsUpdate = true;
      sp.position.needsUpdate = sp.aColor.needsUpdate = sp.aSize.needsUpdate = sp.aSeed.needsUpdate = true;
      lp.position.needsUpdate = true;
      lp.color.needsUpdate = true;
    },
  };
}
