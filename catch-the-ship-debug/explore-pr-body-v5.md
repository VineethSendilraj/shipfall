A free camera on the full stack: the ship stacked on the booster, on the launch mount at the tower with the arms open. It works on Starbase and on Mars. The sim stays stopped.

- Opens from Explore on the title card, explore on the X card, or `?explore=1`. Add `&focus=<preset>` (for example `&focus=engines`) to open on a preset without the glide, and `&map=mars` to open on Mars.
- Explore keeps the map that the title card shows. The stack stands at the same tower on both maps. Back (or Esc) returns to the title on that map.
- Explore starts at the title's establishing shot and glides to the Stack preset in 2.6 s to 2.8 s. Its first frame is 0.4 m from the title's last frame, so there is no cut.
- Orbit controls with damping. Scroll or pinch zooms toward the part under the pointer and stops short of it. Right-drag or two fingers pan.
- The camera stays inside the site, 2.5 m to 520 m from its pivot, and 1.5 m above the ground. Each map gives its ground height through a new `groundHeight(x, z)` on the world (`world.js`, `mars.js`).
- The camera stays 1.6 m clear of the stack, the mount and the tower. Each frame pushes it out of 42 cylinders and boxes measured from the models.
- Nine presets, as chips and keys 1-9: Stack, Engines, Grid fins, Hot-stage ring, Nose and tiles, Flaps, Chopsticks, Tower top and Tank farm (Habitat on Mars). Each glide lasts 1.2 s to 2.6 s and goes on the path with the smallest detour around the stack.
- Near the stack, two inspection lights fade in (from 40 m off the hull, full at 25 m). They exist only in Explore. A lamp up and to the right of the camera puts about 4.5 lux on the nearest part of the model. A spot from under the mount lights the engine bells. Explore hides the engines' glow discs, so the bells show their insides and rims.
- After 8 s without input, the camera turns slowly. Any input stops it.
- UI: an EXPLORE tag, a hint on first entry, the chips (they scroll on small screens), Photo (saves a PNG, hidden in the X embed) and Back. Explore hides the HUD, the touch buttons and the sound button. On tall screens the chips and the hint stay above the bottom 30%. On screens narrower than square, the presets widen their FOV so the subject still fits.
- The title card has four buttons in a 2x2 grid: Start mission and Free flight, then Leaderboard and Explore. No label wraps at widths from 360 px to 1280 px. At 360x640 the card scrolls by 8 px of its bottom padding.
- Files: new `src/explore.js` and `src/three/stack.js`. Small edits to `src/main.js`, `src/three/view.js` (`view.free` gives the camera to Explore), `src/three/world.js`, `src/three/mars.js`, `src/game.html` and `styles.css` (appended only). 8 files, +718/−5.
- Overlap with #23: #23 deletes the title card's button row and the X card, where the two Explore buttons are. The PR that merges second must add Explore to the new home screen. Both PRs also edit `src/main.js`, `src/three/view.js` and `styles.css`.

**Lights in daylight and at dusk.** The lamp and the spot make the close-ups brighter but clip no pixels on either map. Mean luma and clipped share per preset at 1280x720, with the lights off in parentheses:

| Preset | Lamp (cd) | Spot (cd) | Starbase luma | Starbase clipped | Mars luma | Mars clipped |
| --- | --- | --- | --- | --- | --- | --- |
| Engines | 68 | 800 | 62.0 (52.7) | 0% (0%) | 36.9 (23.2) | 0% (0%) |
| Grid fins | 326 | 800 | 107.4 (104.5) | 0% (0%) | 83.5 (81.3) | 0.16% (0.16%) |
| Hot-stage ring | 389 | 800 | 104.7 (97.4) | 0% (0%) | 94.6 (87.3) | 0.19% (0.19%) |
| Nose and tiles | 679 | 800 | 132.4 (130.3) | 0% (0%) | 86.7 (83.4) | 0% (0%) |
| Flaps | 2331 | 787 | 118.6 (112.5) | 0% (0%) | 81.9 (74.0) | 0% (0%) |
| Chopsticks | 365 | 188 | 113.3 (112.4) | 0% (0%) | 72.5 (70.5) | 0% (0%) |

Stack, Tower top and Tank farm are more than 40 m from the hull, so the lights stay at zero there. A pixel clips when a channel reaches 254. The Mars clips are the same with the lights off.

**Checked** on 477828f unless noted. Headless Chrome on Metal at 1280x720, quality high.

- `npm test`: 21 sim, 13 flight and 7 API tests pass. `npm run check:card`: 57/57, 296 KB of gzipped JS. Both ran on 2b70f5b, and 477828f adds one CSS line.
- The catch game is pixel-identical to main (b751593) in 6 demo frames on each map. A piloted free flight is identical in 4 frames on each map. Each of the 20 pairs differs in 0 of 921600 pixels.
- Free flight and Explore: Explore after a free flight draws the same frame as Explore on a fresh page (0 pixels differ). This holds on Starbase, on Mars, and after a switch to Mars. A free flight after Explore draws the same first frame as on a fresh page.
- The #17 merge changes no Explore frame: the 9 presets on both maps are pixel-identical before (7d694a9) and after it. So the results below, from 7d694a9, still apply.
- Frame time (7d694a9, both maps): 60 fps with 0 missed frames (p99 16.8 ms). The runs were close orbits at the engines (8 m) and the tiles (10 m), and the turntable with the whole site in view (497 m).
- Glide planning takes 0.5 ms (median) and 22 ms at most, from the oddest user pose.
- Clearance, by exact distance to the model triangles: on each map, 72 preset glides and 360 glides from user poses. None comes within 1.5 m of the stack, the mount or the tower. At Starbase, two glides from near the engines to the Tank farm pass 0.11 m and 0.54 m from a tank. The tanks are scenery, not part of the 42 shapes.
- Ground: in 40 zoom drops per map, the camera stays at least 1.46 m (Starbase) and 1.40 m (Mars) above the ground mesh. The turntable stays at least 1.52 m and 1.81 m above it.
- Flash scan (every frame, a 16x9 block-luma grid at 640x360, T = 0.06), 6082 frames per run: 266 frames flag at Starbase (243 with the lights off) and 309 on Mars (291). Almost all are in glides and close orbits. The lights do not change the top flag (0.45 at Starbase, 0.34 on Mars).
- Map trip (Starbase, Mars, Starbase in one session): the Engines close-up is the same on both Starbase visits (0 of 518400 pixels differ). The geometry and texture counts in Explore match those back on the title.
- After Explore, Start mission draws the same frames as on a fresh page, on both maps.

**Follow-up, not in this PR:** add the Starbase tanks to the camera's obstacle shapes, so glides to the Tank farm keep 1.6 m from them.

**Close-ups before and after the inspection lights, 1280x720**

| | Lights off | Lights on |
| --- | --- | --- |
| **Engines, Starbase** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-sb-engines-off.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-sb-engines.jpg?raw=true" width="400"> |
| **Engines, Mars** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-mars-engines-off.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-mars-engines.jpg?raw=true" width="400"> |
| **Nose and tiles, Starbase** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-sb-nose-off.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-sb-nose.jpg?raw=true" width="400"> |
| **Nose and tiles, Mars** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-mars-nose-off.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-maps-v5-mars-nose.jpg?raw=true" width="400"> |

**Presets on both maps, 1280x720**

| | Starbase | Mars |
| --- | --- | --- |
| **Entry (the Stack preset)** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-entry.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-entry.jpg?raw=true" width="420"> |
| **Engines** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-engines.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-engines.jpg?raw=true" width="420"> |
| **Grid fins** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-fins.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-fins.jpg?raw=true" width="420"> |
| **Hot-stage ring** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-ring.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-ring.jpg?raw=true" width="420"> |
| **Nose and tiles** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-nose.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-nose.jpg?raw=true" width="420"> |
| **Flaps** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-flaps.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-flaps.jpg?raw=true" width="420"> |
| **Chopsticks** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-chopsticks.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-chopsticks.jpg?raw=true" width="420"> |
| **Tower top** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-tower.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-tower.jpg?raw=true" width="420"> |
| **Tank farm (Habitat on Mars)** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-sb-farm.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-mars-farm.jpg?raw=true" width="420"> |

**Phone, 390x844, Starbase**

| Entry (the Stack preset) | Engines | Flaps |
| --- | --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-390-entry.jpg?raw=true" width="210"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-390-engines.jpg?raw=true" width="210"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-390-flaps.jpg?raw=true" width="210"> |

**480x480, the X card embed** (`/embed/?explore=1`)

| Entry (the Stack preset) | Engines |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-480-entry.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/fff9083b802e77070b7b5ba3757bf502d6180551/explore-v5-480-engines.jpg?raw=true" width="400"> |
