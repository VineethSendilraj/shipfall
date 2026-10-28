import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const NAMES = ['booster', 'ship', 'tower', 'props'];

/**
 * Loads the Blender-built models (public/models/*.glb, made by blender/build.sh). Resolves to
 * { booster, ship, tower, props }, each the loaded scene or null if that file failed to load; the game then
 * keeps its procedural model for it.
 */
export function loadModels(base = `${import.meta.env.BASE_URL}models/`) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return Promise.all(
    NAMES.map((name) =>
      loader.loadAsync(`${base}${name}.glb`).then(
        (gltf) => gltf.scene,
        (err) => {
          console.warn(`${name}.glb failed to load; keeping the procedural model`, err);
          return null;
        },
      ),
    ),
  ).then((scenes) => Object.fromEntries(NAMES.map((name, i) => [name, scenes[i]])));
}

const aoMaterials = new WeakMap();

/** The vertex-colored twin of a role material, made once and shared by every mesh with baked AO. */
function withVertexColors(mat) {
  let twin = aoMaterials.get(mat);
  if (!twin) {
    twin = mat.clone();
    twin.vertexColors = true;
    // clone() does not copy onBeforeCompile.
    twin.onBeforeCompile = mat.onBeforeCompile;
    aoMaterials.set(mat, twin);
  }
  return twin;
}

/**
 * Clones a loaded node (geometry is shared) and gives each mesh the game material named by its `role`
 * (a glTF extra set in Blender). Meshes with ambient occlusion baked into vertex colors get the
 * vertex-colored twin of that material. Throws on a role with no material so the caller keeps its fallback.
 */
export function instantiate(node, mats, castShadow = () => true) {
  const root = node.clone();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const base = mats[o.userData.role];
    if (!base) throw new Error(`no material for model role "${o.userData.role}" (${o.name})`);
    // Bump-mapped materials keep the shared one: with vertex colors they flash single bright pixels under MSAA on Metal.
    const mat = o.geometry.attributes.color && !base.bumpMap ? withVertexColors(base) : base;
    o.material = mat;
    // Without vertex tangents, anisotropy derives them per pixel, and MSAA edge pixels turn that into one-frame flashes.
    if (mat.anisotropy > 0 && !o.geometry.attributes.tangent) o.geometry.computeTangents();
    o.castShadow = castShadow(o.userData.role);
    o.receiveShadow = true;
  });
  return root;
}
