// Logs the scripted mission: real time, mission time, altitude, downrange angle and warp at each event.
import { Flight, local, speeds } from '../catch-the-ship-orbit/src/flight.js';
import { createFlightPilot } from '../catch-the-ship-orbit/src/flight-pilot.js';

const f = new Flight({ seed: 1 });
const pilot = createFlightPilot();
let lastMode = '';
let lastB = '';
const row = (tag) => {
  const s = f.ship;
  const L = local(s.x, s.y);
  const v = speeds(s, L);
  const b = f.booster;
  const Lb = local(b.x, b.y);
  console.log(
    `${tag.padEnd(14)} real ${f.real.toFixed(1).padStart(6)} t ${f.t.toFixed(1).padStart(7)} alt ${(L.alt / 1000).toFixed(2).padStart(7)}km phi ${L.phi.toFixed(3).padStart(7)} vh ${v.vh.toFixed(0).padStart(5)} vr ${v.vr.toFixed(0).padStart(5)} warp ${f.warp.toFixed(1).padStart(5)} mode ${s.mode} | B ${b.state} alt ${Lb.alt.toFixed(0)} d ${(Lb.phi * 100000).toFixed(0)}`,
  );
};
let next = 0;
while (f.phase !== 'over' && f.real < 1500) {
  f.step(pilot(f));
  for (const e of f.events) row(e.type);
  if (f.ship.mode !== lastMode) {
    lastMode = f.ship.mode;
    row(`mode:${lastMode}`);
  }
  if (f.booster.state !== lastB) {
    lastB = f.booster.state;
    row(`B:${lastB}`);
  }
  if (f.real >= next) {
    next += 10;
    row('.');
  }
}
row('end');
console.log(f.outcome, f.stats, f.marks);
