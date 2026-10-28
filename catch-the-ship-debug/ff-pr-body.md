Stacked on #12: this branch merges `starship-catch`, so free flight flies the real upper stage. Merge #12 first and this diff shrinks to the free flight changes.

**What it does**
- A sandbox mode: the full stack (booster with the ship on top, 128 m) stands on the launch mount at night. Lift off, fly anywhere around the site, land it back.
- Entry points: Free flight on the title card (or `F`), on the X card quick start, and `?mode=flight`. Post on X shares `/?mode=flight`.
- Arcade flight computer: thrust-to-weight 1.5, thrust along the axis, tilt up to 20 degrees toward the input, brakes to a hover and levels when you let go, quadratic drag, 40 m/s top speed, engines spool, descent protection near the ground, about 3 minutes of hover fuel, empty tank shuts the engines down. Soft fence at 2.4 km, ceiling at 1.5 km.
- Touchdown limits: under 3 m/s down, 2 m/s sideways, 5 degrees of tilt. Best result is landing back on the mount, skirt fully on the ring.
- Crashes: hard, sliding or tilted touchdowns, the mount's rim or side, the towers and their arms, the tank farm, outbuildings and floodlight masts. Fireball, dark smoke, sparks, tumbling debris and an explosion light, with a wide shot that puts the obstacle behind the fireball.
- Steam and dust under the engines, steam out from under the mount at liftoff.
- Camera: low pad shot looking up between the towers, then a chase camera that pulls back with speed and altitude. Drag the scene to orbit. Framing scales with the stack height and handles the tall phone layout.
- HUD reuses the webcast bar: engine rings lit by throttle (3, 13, then 33), radar altitude, speed, fuel, T+ clock, ALIGN shows the tilt, distance and bearing to the mount, the SHIP icon. A ring on the mount turns green when you are lined up to land, and a faint beacon marks it from far away.
- Result card in the game over card styles: time aloft, max altitude, distance flown, touchdown speed, fuel left; Fly again, Home, Post on X.

**Controls**
- Keys: hold W to light the engines and lift off; W/S climb and descend (no input holds altitude); A/D turn; arrows fly relative to the camera; P pause; Esc back to the title.
- Touch and the embed: left stick climbs and turns, right stick flies. The sticks stay clear of the HUD, and above the bottom 30% on tall phones.

**Catch game**
- Its sim, draw path, demo and visuals are unchanged. Flight objects stay hidden outside free flight and reuse the existing engine and crash lights, so catch shaders and light counts are the same. Shared files only gain code; the ground haze gets a `uFade` uniform that stays 1 there.
- The browser demo still matches the node runner: 6,923 points at frame 1,718.

**Measured** (headless Chrome on the M4 Max GPU through Metal, 1512x982 at DPR 2, high quality, 3 interleaved rounds, machine under heavy unrelated load)
- GPU per frame: catch 9.2 ms median (8.6 to 10.4); flight 7.7 ms at liftoff (6.2 to 7.9), 6.6 ms cruising (5.2 to 7.8).
- JS per frame, p50: catch 8.0 ms, flight 8.3 ms.
- Draw calls at 1280x720: catch 105; flight 94 cruising, 188 at liftoff (both towers and the stack in the shadow pass).
- `npm test`: 20 catch, 18 free flight (liftoff needs thrust, touchdown limits, mount landing, empty tank, fence, ceiling, determinism), 7 API. `npm run check:card`: 46/46.
- Scripted flights through `window.__flight` (`?mode=flight&capture=1`) at 1280x720 and 480x480 hit the same frames every run.
