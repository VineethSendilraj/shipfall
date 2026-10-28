// Bounds of the vertices of one GLB mesh that pass a filter (to size colliders).
import { readFileSync } from 'node:fs';
import * as THREE from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/build/three.module.js';
import { GLTFLoader } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from '/Users/vsendilraj/dev/scratch/catch-the-ship/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const [file, meshName, filter] = process.argv.slice(2);
const buf = readFileSync(file);
await MeshoptDecoder.ready;
const gltf = await new Promise((res, rej) => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
gltf.scene.updateMatrixWorld(true);
const mesh = gltf.scene.getObjectByName(meshName);
const p = mesh.geometry.attributes.position;
const v = new THREE.Vector3();
const fn = new Function('x', 'y', 'z', `return ${filter};`);
const b = new THREE.Box3();
let n = 0;
for (let i = 0; i < p.count; i++) {
  v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
  if (fn(v.x, v.y, v.z)) { b.expandByPoint(v); n++; }
}
console.log(meshName, filter, n, 'min', b.min.toArray().map((x) => x.toFixed(2)).join(','), 'max', b.max.toArray().map((x) => x.toFixed(2)).join(','));
