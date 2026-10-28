// Prints node names and world bounding boxes of the GLB models (for flight colliders and the mount position).
import { readFileSync } from 'node:fs';
import * as THREE from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const [file, depth = '2'] = process.argv.slice(2);
const buf = readFileSync(file);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
await MeshoptDecoder.ready;
const gltf = await new Promise((res, rej) => loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
const root = gltf.scene;
root.updateMatrixWorld(true);
const f = (v) => v.toArray().map((x) => x.toFixed(2)).join(',');
const walk = (o, d) => {
  const b = new THREE.Box3().setFromObject(o);
  let tris = 0;
  o.traverse((m) => { if (m.isMesh) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3 * (m.isInstancedMesh ? m.count : 1); });
  console.log(`${'  '.repeat(d)}${o.name || '(unnamed)'} [${o.type}] role=${o.userData.role ?? ''} min(${f(b.min)}) max(${f(b.max)}) tris=${tris}`);
  if (d < +depth) for (const c of o.children) walk(c, d + 1);
};
walk(root, 0);
