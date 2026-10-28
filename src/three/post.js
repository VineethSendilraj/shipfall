import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uHaze: { value: new THREE.Vector4(0.5, 0.5, 0, 0.1) },
    uHaze2: { value: new THREE.Vector4(0.5, 0.5, 0, 0.1) },
    uAspect: { value: 16 / 9 },
    uFlash: { value: new THREE.Vector3() },
    uDip: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec4 uHaze; uniform vec4 uHaze2; uniform float uAspect;
    uniform vec3 uFlash; uniform float uDip;
    varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y); }
    float hazeMask(vec4 hz, vec2 uv) {
      vec2 d = uv - hz.xy; d.x *= uAspect; d.y *= 0.6;
      return hz.z * exp(-dot(d, d) / (hz.w * hz.w));
    }
    void main() {
      vec2 uv = vUv;
      float m = hazeMask(uHaze, vUv) + hazeMask(uHaze2, vUv);
      vec2 w = vec2(n2(vUv * vec2(70.0, 38.0) + vec2(0.0, uTime * 5.0)), n2(vUv * vec2(52.0, 66.0) + vec2(3.0, uTime * 6.5))) - 0.5;
      uv += w * 0.009 * m;
      vec2 cc = vUv - 0.5;
      float r2 = dot(cc, cc);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + cc * r2 * 0.0015).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - cc * r2 * 0.0015).b;
      // Grade in linear light, before tone mapping: cool shadows, warm highlights, a little more colour.
      float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
      float hi = luma / (luma + 0.35);
      col *= mix(vec3(0.9, 0.98, 1.12), vec3(1.08, 1.0, 0.9), hi);
      col = max(mix(vec3(luma), col, 1.22), 0.0);
      col *= pow(max(luma, 1e-4) / 0.3, 0.12);
      float vig = smoothstep(1.05, 0.3, length(cc * vec2(1.0, 0.9)) * 1.25);
      col *= mix(0.55, 1.0, vig);
      col += uFlash;
      col *= 1.0 - uDip;
      col *= 1.0 + (h21(vUv * 1931.0 + fract(uTime * 37.0) * 91.0) - 0.5) * 0.06;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export function createComposer(renderer, scene, camera, w, h, samples) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.42, 0.5, 1.0);
  composer.addPass(bloom);
  const final = new ShaderPass(FinalShader);
  composer.addPass(final);
  composer.addPass(new OutputPass());
  // Only used by the reduced-quality levels, which render without MSAA. SMAA keeps the thin lattice crisp where FXAA smears it.
  const aa = new SMAAPass();
  aa.enabled = false;
  composer.addPass(aa);
  return { composer, bloom, final, aa };
}
