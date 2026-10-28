// Max number of vehicles of each kind that need a view slot at once (any state but 'waiting').
import { Game, NO_INPUT, DOUBLE_UNLOCK_SCORE } from '/Users/vsendilraj/dev/scratch/catch-the-ship-ship/src/sim.js';
import { createDemoRunner } from '/Users/vsendilraj/dev/scratch/catch-the-ship-ship/src/demo.js';
const max = { booster: 0, ship: 0 };
const count = (g) => {
  for (const kind of ['booster', 'ship']) max[kind] = Math.max(max[kind], g.boosters.filter((b) => b.kind === kind && b.state !== 'waiting').length);
};
const r = createDemoRunner();
while (!r.done) { r.step(); count(r.game); }
for (let seed = 1; seed <= 40; seed++) {
  const g = new Game({ width: 1280, seed, maxRounds: 12 });
  g.lives = 99;
  g.start();
  for (let i = 0; i < 60 * 60 * 3 && g.phase !== 'over'; i++) {
    if (g.round === 2 && !g.doubleUnlocked) g.score = DOUBLE_UNLOCK_SCORE;
    g.lives = 99;
    g.step(NO_INPUT);
    count(g);
  }
}
console.log(JSON.stringify(max));
