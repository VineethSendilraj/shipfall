// Loads the compressed GLBs with three's GLTFLoader + MeshoptDecoder (same path as the game) and checks
// node structure, roles, bounds and the steel UV convention.
import { readFileSync } from 'node:fs';
const REPO = '/Users/vsendilraj/dev/scratch/catch-the-ship-blender';
const THREE = await import(`${REPO}/node_modules/three/build/three.module.js`);
const { GLTFLoader } = await import(`${REPO}/node_modules/three/examples/jsm/loaders/GLTFLoader.js`);
const { MeshoptDecoder } = await import(`${REPO}/node_modules/three/examples/jsm/libs/meshopt_decoder.module.js`);

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const load = (name) =>
  new Promise((res, rej) => {
    const buf = readFileSync(`${REPO}/public/models/${name}.glb`);
    loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
  });

for (const name of ['booster', 'tower', 'props']) {
  const gltf = await load(name);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  console.log(`\n== ${name}`);
  scene.traverse((o) => {
    const depth = (() => { let d = 0, p = o; while (p.parent) { d++; p = p.parent; } return d; })();
    const box = new THREE.Box3().setFromObject(o);
    const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
    let extra = '';
    if (o.isMesh) {
      const g = o.geometry;
      const tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      extra = ` mesh role=${o.userData.role} tris=${tris} attrs=${Object.keys(g.attributes).join(',')} pos=${fmt(o.position)} scale=${fmt(o.scale)}`;
    }
    console.log(`${'  '.repeat(depth)}${o.type} "${o.name}"${extra} bounds ${fmt(box.min)}..${fmt(box.max)}`);
  });
  if (name === 'booster') {
    const steel = scene.getObjectByProperty('name', 'booster_steel') || scene.children[0].children.find((c) => c.userData.role === 'steel');
    const pos = steel.geometry.attributes.position;
    const uv = steel.geometry.attributes.uv;
    const v = new THREE.Vector3();
    let top = null, bot = null, front = null, right = null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(steel.matrixWorld);
      const u = uv.getX(i), w = uv.getY(i);
      if (!top || v.y > top.y) top = { y: v.y, w };
      if (!bot || v.y < bot.y) bot = { y: v.y, w };
      if (Math.abs(v.x) < 0.01 && v.z > 4 && (!front || u < front.u)) front = { u, x: v.x, z: v.z };
      if (Math.abs(v.z) < 0.01 && v.x > 4) right = { u, x: v.x, z: v.z };
    }
    console.log('steel top', top, 'bottom', bot, 'u at +Z', front, 'u at +X', right);
    const throat = scene.children[0].children.find((c) => c.userData.role === 'throat');
    const tb = new THREE.Box3().setFromObject(throat);
    const pin = scene.children[0].children.find((c) => c.userData.role === 'pin');
    console.log('throat y range', tb.min.y.toFixed(3), tb.max.y.toFixed(3));
    const bell = scene.children[0].children.find((c) => c.userData.role === 'bell');
    console.log('bell y range', new THREE.Box3().setFromObject(bell).min.y.toFixed(3));
    // Pins: lowest point of the pin mesh near |z| > 5 should be y = 0.
    const pp = pin.geometry.attributes.position;
    let minY = 1e9;
    for (let i = 0; i < pp.count; i++) {
      v.fromBufferAttribute(pp, i).applyMatrix4(pin.matrixWorld);
      if (Math.abs(v.z) > 5 && v.y < minY) minY = v.y;
    }
    console.log('pin underside at |z|>5:', minY.toFixed(3));
  }
}
