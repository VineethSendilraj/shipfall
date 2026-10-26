// Copies three.js and the addon modules the game imports (resolved recursively) into vendor/three,
// so the game is served fully locally through an import map. Run after `npm install`.
import { mkdirSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const threeRoot = join(root, 'node_modules/three');
const out = join(root, 'vendor/three');

const ADDONS = [
  'postprocessing/EffectComposer.js',
  'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js',
  'postprocessing/ShaderPass.js',
  'postprocessing/OutputPass.js',
  'utils/BufferGeometryUtils.js',
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'build'), { recursive: true });
for (const f of ['three.module.js', 'three.core.js']) copyFileSync(join(threeRoot, 'build', f), join(out, 'build', f));
copyFileSync(join(threeRoot, 'LICENSE'), join(out, 'LICENSE'));

const seen = new Set();
const importRe = /(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]/g;
function copyAddon(abs) {
  if (seen.has(abs)) return;
  seen.add(abs);
  const rel = relative(join(threeRoot, 'examples/jsm'), abs);
  const dest = join(out, 'addons', rel);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(abs, dest);
  const src = readFileSync(abs, 'utf8');
  for (const m of src.matchAll(importRe)) copyAddon(resolve(dirname(abs), m[1]));
}
for (const a of ADDONS) copyAddon(join(threeRoot, 'examples/jsm', a));
console.log(`vendored three.js + ${seen.size} addon files into ${relative(root, out)}`);
