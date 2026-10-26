import { Game } from './sim.js';
import { DEMO_SCRIPT } from './demo-script.js';

/**
 * Deterministic showcase configuration. All randomness comes from the seeded PRNG inside Game;
 * the overrides pin the "story beats" (arm adjustment, wind gust, double catch) so the showcase
 * reads well on video.
 */
export const DEMO = {
  seed: 20261025,
  width: 1280,
  titleFrames: 120,
  endFrames: 180,
  maxRounds: 3,
  overrides: {
    1: { boosters: [{ zeroY: 258, spawnDx: -150, vx0: 26 }], wind: { base: 4, gusts: [] } },
    2: { boosters: [{ zeroY: 376, spawnDx: -70, vx0: 14 }], wind: { base: -3, gusts: [{ t0: 2.2, dur: 1.3, amp: 120 }] } },
    3: {
      boosters: [
        { zeroY: 300, spawnDx: -120, vx0: 22 },
        { zeroY: 352, spawnDx: 70, vx0: -14 },
      ],
      wind: { base: 2.5, gusts: [] },
    },
  },
};

function inRanges(ranges, f) {
  for (const [a, b] of ranges) if (f >= a && f < b) return true;
  return false;
}

export function scriptedInput(script = DEMO_SCRIPT) {
  const close = new Set(script.close);
  return (frame) => ({
    left: inRanges(script.left, frame),
    right: inRanges(script.right, frame),
    up: inRanges(script.up, frame),
    down: inRanges(script.down, frame),
    close: close.has(frame),
  });
}

/** Advances the showcase exactly one fixed 1/60 s step per call. */
export function createDemoRunner(inputFn = scriptedInput()) {
  const game = new Game({ width: DEMO.width, seed: DEMO.seed, maxRounds: DEMO.maxRounds, overrides: DEMO.overrides });
  let frame = 0;
  let overAt = -1;
  return {
    game,
    get frame() {
      return frame;
    },
    get overAt() {
      return overAt;
    },
    get done() {
      return overAt >= 0 && frame >= overAt + DEMO.endFrames;
    },
    step() {
      if (frame === DEMO.titleFrames) game.start();
      game.events.length = 0;
      game.step(inputFn(frame, game));
      if (overAt < 0 && game.phase === 'over') overAt = frame;
      frame++;
    },
  };
}
