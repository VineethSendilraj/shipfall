# Catch the Booster visual scorecard

Scale (threejs-game-skills visual-scorecard): 0 placeholder, 1 basic styled, 2 premium stylized, 3 showcase.
Premium = every category >= 2 and average >= 2.3. Frames: real Chrome on Metal, demo mode, 1280x720 and 480x480.

| Category | main (base-*) | PR #2 (v7-*) | Evidence |
|---|---|---|---|
| Art direction | 1 | 1.5 | night launch site drives forms; UI was generic neon, now webcast style |
| Hero (booster) | 1 | 1 | open cylinder plus boxes; no chines, hot-stage ring or engine shroud detail |
| Obstacles (tower, arms) | 2 | 2 | lattice tower and chopsticks are readable and authored |
| Interactables (catch window) | 1.5 | 1.5 | guide ring and green arm glow; catch moment has little feedback |
| World | 1 | 1.5 | primitive tanks/boxes; PR #2 adds tank detail, beams, horizon haze |
| Materials | 1 | 2 | flat steel reading as blue plastic; PR #2 env-lit anisotropic steel with welds |
| Lighting/render | 1.5 | 2 | ACES, blue fill; PR #2 AgX, site-light env, grain |
| VFX/motion | 1.5 | 1.5 | cylinder plume and point particles; no ground steam or catch impact |
| UI/HUD | 1 (auto-fail: glass stat cards) | 2 | PR #2 webcast telemetry; no share action, plain game over |
| Performance evidence | 1 | 2 | PR #2 fps parity measured (120 fps, p99 9.3 ms) |
| **Average** | **1.25** | **1.7** | |

Automatic failures still standing after PR #2: hero is a primitive placeholder.
