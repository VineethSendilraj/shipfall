Branched from the local `final-preview` (f666f8c, #5 + #6). Those two are already in `main`, so this diff is one commit. `main` has since merged #7–#10, and this branch conflicts with it in `README.md`, `scripts/test-sim.mjs`, `src/sim.js` (the FUEL DEPLETED popup line) and `src/ui.js` (the new HUD bar, which needs the ship texts ported in). Not merged here.

**What it adds**
- Double-catch rounds: tower B catches a stainless upper stage (the ship) instead of a second booster. `src/sim.js` gets a vehicle kind (`VEHICLES`: height, pin and engine positions, tumble pivot). Catch tolerances are the booster's. The ship lights its landing burn with its pins at the booster's ignition height, so the descent plays the same. Single rounds stay boosters; the `?demo=1` script still catches everything, the ship last.
- `public/models/ship.glb` from `blender/build_models.py`: ogive nose, hex heat-shield tiles on the windward half (UVs in m/64 for a hex texture drawn in `src/three/ship.js`), two forward and two aft flaps at the tile edges, catch pins on ±Z below the forward flaps, 3 sea-level + 3 vacuum bells. Pins' undersides at y = 0, bell exits at y = −35, nose tip at y = 15.5. `ship.js` has a procedural fallback, the plume from the 3 center engines (the booster plume, narrowed) and the throat glow.
- Cycles ambient occlusion baked into `COLOR_0` on the booster, ship, tower and props (throats excluded). `instantiate()` gives those meshes a vertex-colored copy of their role material, one per material. Long members are cut along their length so the per-vertex bake can shade the joints.
- Texts: banner "double catch · booster and ship inbound", unlock "second tower online · booster and ship per round", HUD "DOUBLE CATCH · SHIP · TOWER B", "SHIP LOST".

**Budgets** (meshopt, total 1.94 MB)

| File | Triangles | Size |
| --- | --- | --- |
| `booster.glb` | 77,188 (was 70,746) | 637 KB (was 466) |
| `ship.glb` | 38,444 | 257 KB |
| `tower.glb` | 58,056 (was 24,984) | 656 KB (was 260) |
| `props.glb` | 53,678 (was 32,810) | 390 KB (was 194) |

**Verification** (headless Chrome, Metal)
- `npm test`: 15 sim + 7 API pass. New sim tests cover the ship at tower B, its tolerances and clang span, ignition height, an unattended ship crash, and the demo catching booster, booster, booster, ship. `npm run check:card`: 53/53.
- Flash scan: 4 flagged frames at 1280×720 (f666f8c: 4), 3 at 480×480 (f666f8c: 2). The extra frames (1540, 1542) come in the post-game-over pull-back, with a work light behind the lattice; f666f8c measures 0.040–0.058 at the same frames, and the darker lattice pushes them past the 0.06 threshold.
- With vertex colors, the bump-mapped steel flashed single bright pixels under MSAA (frames 457, 890, 1313–1414; turning off the bump map or the colors fixed each). So bump-mapped materials keep the shared material and get no AO: the booster and ship steel and the ship tiles. The polished steel on `blender-models` has no bump map, so it would pick up the AO.
- fps, uncapped, full showcase, alternating runs on a heavily loaded machine (wide spread): median 278 vs 318 on f666f8c; double round 287 vs 298.

**Frames** (`~/dev/scratch/catch-the-ship-debug/`): `final-1280-f1380/f1440` (ship landing burn), `final-1280-f1466/f1505` (tower B catch), `final-480-*` (same at 480×480), `final-close-ship*` (nose and forward flaps, tiles, engines, aft), `final-ao-*` (f666f8c on the left, AO on the right).
