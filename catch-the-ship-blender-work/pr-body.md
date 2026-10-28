Replaces the procedural booster, tower and site props with models built in Blender by a headless bpy script (`blender/`), shipped as meshopt-compressed GLBs in `public/models/`. The procedural models stay as the fallback and render until the GLBs arrive; `?demo=1` waits up to 6 s for them so a run never switches models midway. No gameplay or sim changes.

**Sourced vs built:** everything is built from code in this PR (MIT, no credits needed, no logos or marks). CC0 / CC-BY candidates were checked first and set aside: Sketchfab and BlendSwap need an account to download, the Printables / Cults3D booster and tower files are CC BY-NC or "CC BY No AI" 3D-print STLs, and Poly Pizza only has stylized low-poly rockets and tanks.

| File | Triangles | Size |
| --- | --- | --- |
| `booster.glb` | 70,746 | 466 KB |
| `tower.glb` (structure, carriage, one arm drawn twice) | 24,984 | 260 KB |
| `props.glb` (tank farm, spheres, launch mount) | 32,810 | 194 KB |

- Booster: rolled rings with raised weld seams on the skin texture's ring joints, vented hot-stage ring with the protective dome inside, four grid fins with real cell depth (cells along the booster axis, at a 12° steering angle) on actuator housings, catch hardpoints, raceway, conduits, aft stringers, heat shield, 33 bells (3 / 10 / 20) with throat discs.
- Tower: chamfered columns, I-beam girts with gussets, stair core, rails, top deck with hoist, sheaves and truss jib; carriage with roller trucks and hinge knuckles; arm truss with catch cart.
- Contract kept: body r 4.5 from y 8 to -63, bell exits at y -67.6, hardpoint undersides at y 0 on ±Z, fins at y 3.6 on the diagonals; the arm and carriage nodes keep the pivots `setArms()` drives. Meshes carry a `role` extra naming the game material; the body keeps CylinderGeometry UVs (checked numerically).

**Checks** (Chrome on Metal, this Mac):
- `npm test` 10/10, `npm run check:card` 53/53 (JS 191 KB gzipped).
- fps (`?demo=1&quality=high`): before 119.5 fps / p99 9.3 ms, after 119.5 and 119.4 fps / p99 9.4 and 9.3 ms (120 Hz vsync). Same-server A/B, GLBs blocked vs loaded, uncapped: 110.3–110.9 vs 108.9–110.0 fps, p99 17.8 ms both.
- Black frames: 0.000 with the original `black.mjs`. The headless rewrite reads 0.000–0.002 on most runs and up to 0.08 when a sample lands in the director's dip-to-black between shots (frames 496–499 and 921–923, identical with the procedural models); a frame-by-frame scan finds no black pixels on any other frame.

Preview: https://catch-the-ship-git-blender-models-vineethsendilrajs-projects.vercel.app/ (Vercel build succeeded; behind Vercel login). Rebuild with `blender/build.sh`.
