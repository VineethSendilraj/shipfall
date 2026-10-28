// Prints the showcase timeline for the ship (sim only, no browser). Run from the starship worktree.
import { createDemoRunner } from '/Users/vsendilraj/dev/scratch/catch-the-ship-ship/src/demo.js';
const r = createDemoRunner();
let last = '';
while (!r.done) {
  r.step();
  const g = r.game;
  for (const e of g.events) if (['catch', 'ignite', 'cutoff', 'unlock', 'round', 'inbound', 'double'].includes(e.type)) console.log(`f${r.frame} r${g.round} ${e.type} ${e.kind ?? ''}`);
  const s = g.boosters.find((b) => b.kind === 'ship');
  if (s) {
    const key = `${s.state} burn=${s.burning}`;
    if (key !== last || r.frame % 30 === 0) console.log(`  f${r.frame} ship ${key} y=${s.y.toFixed(0)} thr=${s.throttle.toFixed(2)} alt=${g.altitudeM(s).toFixed(1)}`);
    last = key;
  }
}
