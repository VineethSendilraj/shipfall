A free camera on the full stack: the ship stacked on the booster, on the launch mount at the tower with the arms open. The sim stays stopped.

- Opens from Explore on the title card, explore on the X card, or `?explore=1`. Add `&focus=<preset>` (for example `&focus=engines`) to open on a preset without the glide.
- Orbit controls with damping. Scroll or pinch zooms toward the part under the pointer and stops short of it. Right-drag or two fingers pan. The camera stays above the ground and inside the site, 2.5 m to 520 m from its pivot.
- The camera stays 1.6 m clear of the stack, the mount and the tower. Each frame pushes it out of 42 cylinders and boxes measured from the models, with one box for each carriage and arm mesh.
- Nine presets, as chips and keys 1-9: Stack, Engines, Grid fins, Hot-stage ring, Nose and tiles, Flaps, Chopsticks, Tower top, Tank farm. Each one glides to its view in 1.2 s to 2.6 s. A glide goes on its arc, on a straight line, or on the arc the long way round (for turns over 120°), whichever needs the smallest detour. It then bends smoothly around any shape still in its way.
- Near the stack, two inspection lights fade in (from 40 m off the hull, full at 25 m). They exist only in Explore. A lamp up and to the right of the camera puts about 4.5 lux on the nearest part of the model. A spot from under the mount lights the engine bells. The engines' glow discs are hidden, so the bells show their insides and rims. The wide views keep the night.
- After 8 s without input, the camera turns slowly. Any input stops it. The turn starts only clear of the stack and the tower, and reverses when it reaches them.
- UI: an EXPLORE tag, a hint on first entry, the chips (they scroll on small screens), Photo (saves a PNG, hidden in the X embed) and Back (or Esc). The HUD, touch buttons and sound button are hidden. The disclaimer stays. On tall screens the chips and the hint stay above the bottom 30%. On screens narrower than square, the presets widen their FOV so the subject still fits. Engines and Flaps keep their whole width.
- The title card has three buttons now. On phones, Start mission uses the compact padding and drops its ↵ hint, so the row stays on one line down to 360 px wide.
- New `src/explore.js` and `src/three/stack.js`. Small edits to `src/main.js`, `src/three/view.js` (`view.free` leaves the camera to explore mode), `src/game.html` and `styles.css` (appended only).
- No "Stacked on #12." line: #12 merged before this PR opened, and this branch starts at `main` (bdf3ea2).
- Overlaps with #15: both PRs add `src/three/stack.js`, and both edit `src/main.js`, `src/game.html` and `styles.css`. #13 also edits `src/main.js`.

**Checked.** `npm test`: 20 sim and 7 API tests pass. `VITE_SITE_URL=https://catch-the-ship.vercel.app npm run check:card`: 46/46, 251 KB of gzipped JS. Headless Chrome on Metal at 1280x720, AutoQuality on high:

- Frame time: 60 fps with 0 missed frames (p99 16.8 ms) in close orbits at the engines (8 m) and at the tiles (11 m), and on the turntable with the whole site in view (498 m), at DPR 1 and 1.5. All 72 preset-to-preset glides miss no frames, and so do the 12 glides from user poses that take longest to plan. Planning a glide takes 0.3 ms from a preset (2.5 ms at most) and up to 14 ms from an odd user pose.
- Clearance, by exact distance to the model triangles: all 72 preset glides, the 9 turntables and 360 glides from poses a user can orbit or zoom to stay more than 1.5 m from the model and the other scenery. The closest is 2.0 m. On these paths the per-frame push moves the camera 0.01 m at most.
- Flash scan (frame-stepped, 640x360, 16x9 block luma, T = 0.06): 281 of 6082 frames flag, all in glides and close orbits. Zoom, pan, tilt and the turntables flag none. The top flag is 0.316, in the Tank farm to Stack glide. With the inspection lights off, 248 frames flag, with the same top flag. The lamp adds one-frame glints on the rim of the mount's ring table in glides under the mount.
- Phone, 390x844: the engine skirt and both flaps are inside the screen, with 3 px and 54 px to spare at each side.

**Close-ups at 1280x720, before and after the inspection lights**

| | Before | After |
| --- | --- | --- |
| **Engines** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-1280-engines.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-engines.jpg?raw=true" width="400"> |
| **Nose and tiles** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-1280-nose.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-nose.jpg?raw=true" width="400"> |
| **Grid fins** | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-1280-fins.jpg?raw=true" width="400"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-fins.jpg?raw=true" width="400"> |

The pad floodlights already light the white booster and its grid fins, so that view changes little.

**1280x720**

| Entry (the Stack preset) | Hot-stage ring |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-entry.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-ring.jpg?raw=true" width="420"> |
| **Flaps** | **Chopsticks** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-flaps.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-chopsticks.jpg?raw=true" width="420"> |
| **Tower top** | **Tank farm** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-tower.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-1280-farm.jpg?raw=true" width="420"> |
| **Title card** | |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-1280-title.jpg?raw=true" width="420"> | |

**480x480, the X card embed** (`/embed/?explore=1`)

| Entry (the Stack preset) | Engines |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-entry.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-engines.jpg?raw=true" width="420"> |
| **Grid fins** | **Hot-stage ring** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-fins.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-ring.jpg?raw=true" width="420"> |
| **Nose and tiles** | **Flaps** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-nose.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-flaps.jpg?raw=true" width="420"> |
| **Chopsticks** | **Tower top** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-chopsticks.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-tower.jpg?raw=true" width="420"> |
| **Tank farm** | **Quick-start card** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-480-farm.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-480-card.jpg?raw=true" width="420"> |

**Phone, 390x844**

| Title card | Entry (the Stack preset) |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-390-title.jpg?raw=true" width="210"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-390-entry.jpg?raw=true" width="210"> |

| Engines, before the fit | Engines | Flaps, before the fit | Flaps |
| --- | --- | --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-390-engines-before.jpg?raw=true" width="200"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-390-engines.jpg?raw=true" width="200"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-390-flaps-before.jpg?raw=true" width="200"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/c59a1aa91a49aa2747b4d3a1623447fd37486c76/explore-v3-390-flaps.jpg?raw=true" width="200"> |
