A free camera on the full stack: the ship stacked on the booster, on the launch mount at the tower with the arms open. The sim stays stopped.

- Opens from Explore on the title card, explore on the X card, or `?explore=1`. Add `&focus=<preset>` (for example `&focus=engines`) to open on a preset without the glide.
- Orbit controls with damping. Scroll or pinch zooms toward the part under the pointer and stops short of it. Right-drag or two fingers pan. The camera stays above the ground and inside the site, 2.5 m to 520 m from its pivot.
- Nine presets, as chips and keys 1-9: Stack, Engines, Grid fins, Hot-stage ring, Nose and tiles, Flaps, Chopsticks, Tower top, Tank farm. Each one glides to its view around or over the stack and the tower, in 1.2 s to 2.6 s.
- After 8 s without input, the camera turns slowly. Any input stops it. The turn starts only clear of the stack and the tower, and reverses when it reaches them.
- UI: an EXPLORE tag, a hint on first entry, the chips (they scroll on small screens), Photo (saves a PNG, hidden in the X embed) and Back (or Esc). The HUD, touch buttons and sound button are hidden. The disclaimer stays. On tall screens the chips and the hint stay above the bottom 30%. On screens narrower than square, the presets widen their FOV so the subject still fits.
- The title card has three buttons now. On phones, Start mission uses the compact padding and drops its ↵ hint, so the row stays on one line down to 360 px wide.
- New `src/explore.js` and `src/three/stack.js`. Small edits to `src/main.js`, `src/three/view.js` (`view.free` leaves the camera to explore mode), `src/game.html` and `styles.css` (appended only).
- No "Stacked on #12." line: #12 merged before this PR opened, and this branch starts at `main` (bdf3ea2).
- Overlaps with #15: both PRs add `src/three/stack.js`, and both edit `src/main.js`, `src/game.html` and `styles.css`. #13 also edits `src/main.js`.

**Checked.** `npm test`: 20 sim and 7 API tests pass. `VITE_SITE_URL=https://catch-the-ship.vercel.app npm run check:card`: 46/46, 249 KB of gzipped JS. Headless Chrome on Metal, 1280x720: 60 fps with 0 missed frames (p99 16.8 ms) in close orbits at the engines (8 m) and at the tiles (11 m), and on the turntable with the whole site in view (498 m), at DPR 1 and 1.5. AutoQuality stays on high. Flash scan (frame-stepped, 640x360, 16x9 block luma, T = 0.06): 228 of 6082 frames flag, all in glides and close orbits. Zoom, pan, tilt and three 8 s turntables flag none. The flags come from thin parts that cross a cell in one frame when the camera passes close to them (the mount ring, the hull, the lattice). The top flag is 0.345, in an orbit at the ship's tiles. All 72 preset-to-preset glides and the entry glide stay 1.5 m or more from the geometry. Of 352 glides from poses a user can orbit to, 44 come closer: 43 start inside the tower lattice or under the mount, and 1 ends at the mount.

**1280x720**

| Entry (the Stack preset) | Engines |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-entry.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-engines.jpg?raw=true" width="420"> |
| **Grid fins** | **Hot-stage ring** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-fins.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-ring.jpg?raw=true" width="420"> |
| **Nose and tiles** | **Flaps** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-nose.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-flaps.jpg?raw=true" width="420"> |
| **Chopsticks** | **Tower top** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-chopsticks.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-tower.jpg?raw=true" width="420"> |
| **Tank farm** | **Title card** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-farm.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-1280-title.jpg?raw=true" width="420"> |

**480x480, the X card embed** (`/embed/?explore=1`)

| Entry (the Stack preset) | Engines |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-entry.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-engines.jpg?raw=true" width="420"> |
| **Grid fins** | **Hot-stage ring** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-fins.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-ring.jpg?raw=true" width="420"> |
| **Nose and tiles** | **Flaps** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-nose.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-flaps.jpg?raw=true" width="420"> |
| **Chopsticks** | **Tower top** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-chopsticks.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-tower.jpg?raw=true" width="420"> |
| **Tank farm** | **Quick-start card** |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-farm.jpg?raw=true" width="420"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-480-card.jpg?raw=true" width="420"> |

**Phone, 390x844**

| Title card | Entry (the Stack preset) |
| --- | --- |
| <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-390-title.jpg?raw=true" width="210"> | <img src="https://github.com/VineethSendilraj/catch-the-ship/blob/98a24dc9acaa8163ec1d77880b33617377f87e45/explore-390-entry.jpg?raw=true" width="210"> |
