// Timeline of the staged screenshot flights (round 1, calm air, spawned over the tower, arms parked at the hover).
// Usage: node fuel-plan.mjs [sim path]
const simPath = process.argv[2] || '/Users/vsendilraj/dev/scratch/catch-the-ship-fuel/src/sim.js';
const { Game, NO_INPUT, PX_PER_M, CATCH_MAX_VY } = await import(simPath);

const pulse = (f) => [-1, 1, 1, -1][Math.floor(f / 6) % 4];
const scenarios = {
  still: () => 0,
  typical: (f) => (f >= 60 && f < 156 ? pulse(f) : 0),
  hoverSteer: (f, b) => (b.burning && b.vy < CATCH_MAX_VY * PX_PER_M ? pulse(f) : 0),
};

for (const [name, steer] of Object.entries(scenarios)) {
  const g = new Game({ width: 1280, seed: 7, overrides: { 1: { boosters: [{ spawnDx: 0, vx0: 0, vy0: 176, zeroY: 300 }], wind: { base: 0, gusts: [] } } } });
  g.start();
  while (g.phase !== 'live') g.step(NO_INPUT);
  const live0 = g.frame;
  const b = g.boosters[0];
  const tw = g.towers[0];
  tw.armY = b.zeroY + 10;
  const marks = [];
  let lastBand = '';
  let wasBurning = false;
  let open = 0;
  for (let f = 0; b.state === 'falling'; f++) {
    const dir = steer(f, b);
    g.step({ ...NO_INPUT, left: dir < 0, right: dir > 0 });
    if (tw.ready) open++;
    const band = b.fuel < 10 ? 'red' : b.fuel < 25 ? 'amber' : 'normal';
    if (b.burning && !wasBurning) marks.push(`f${f} ignite fuel=${b.fuel.toFixed(1)}`);
    if (band !== lastBand) marks.push(`f${f} band=${band} fuel=${b.fuel.toFixed(1)} burning=${b.burning}`);
    if (!b.burning && wasBurning) marks.push(`f${f} cutoff fuel=${b.fuel.toFixed(1)} popup=${g.popups.at(-1)?.text}`);
    if (b.burning && b.vy < CATCH_MAX_VY * PX_PER_M && !marks.some((m) => m.includes('slow'))) marks.push(`f${f} slow (<3 m/s) fuel=${b.fuel.toFixed(1)}`);
    if ([150, 340, 400, 450].includes(f + 1)) marks.push(`after ${f + 1} steps: fuel=${b.fuel.toFixed(1)} burning=${b.burning} vy=${(b.vy / PX_PER_M).toFixed(1)} m/s ready=${tw.ready}`);
    lastBand = band;
    wasBurning = b.burning;
  }
  console.log(`${name}: live at frame ${live0}, window ${(open / 60).toFixed(2)} s, end state ${b.state}, final fuel ${b.fuel.toFixed(1)}`);
  for (const m of marks) console.log('  ' + m);
}
