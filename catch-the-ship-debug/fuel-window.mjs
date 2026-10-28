// Catch-window harness for the shared-tank change. Drives the real Game class through scripted approaches and
// reports the window: seconds the booster spends inside the catch tolerance (|dy| <= 12 px, |dx| < 15 px,
// descent < 3 m/s), with the arms parked at the best fixed height for that approach.
// Usage: node fuel-window.mjs <path to sim.js> [grid|pilots|all]
import { pathToFileURL } from 'node:url';

const [simPath, mode = 'all'] = process.argv.slice(2);
const sim = await import(pathToFileURL(simPath).href);
const { Game, NO_INPUT, DT, PX_PER_M, CATCH_TOL_Y, CATCH_TOL_X, CATCH_MAX_VY, ARM_MIN, ARM_MAX } = sim;
const OLD_LAT_SECONDS = 100 / 26; // all the lateral thrust a pilot can spend on main today

function setup({ d = 0, seed = 7, booster = null, wind = null } = {}) {
  const o = {};
  if (booster) o.boosters = [booster];
  if (wind) o.wind = wind;
  const g = new Game({ width: 1280, seed, overrides: { [d + 1]: o } });
  g.round = d;
  g.beginRound();
  while (g.phase !== 'live') g.step(NO_INPUT);
  return g;
}

const input = (dir) => ({ ...NO_INPUT, left: dir < 0, right: dir > 0 });
// Left, right, right, left: each cycle ends where it started, so the pulses spend fuel without drifting.
const pulse = (f) => [-1, 1, 1, -1][Math.floor(f / 6) % 4];

/** Holds no thrusters. */
const none = () => () => NO_INPUT;

/** P-controller on the lateral offset, like the showcase autopilot. */
const pilot = (gain = 2) => (g, b, tw) => {
  const dx = b.x - tw.cx;
  const err = b.vx - Math.max(-60, Math.min(60, -dx * gain));
  return input(err > 1.5 ? -1 : err < -1.5 ? 1 : 0);
};

/** Spends `secs` of lateral thrust in short alternating pulses from the first frame, then holds steady. */
const spend = (secs) => {
  let used = 0;
  let f = 0;
  return (g, b, tw) => {
    if (used >= secs - 1e-9) return pilot(2)(g, b, tw);
    used += DT;
    return input(pulse(f++));
  };
};

/** Holds still until the hover, then pulses left and right without a break. */
const hoverSteer = () => {
  let f = 0;
  return (g, b, tw) => (b.burning && b.vy / PX_PER_M < CATCH_MAX_VY ? input(pulse(f++)) : pilot(2)(g, b, tw));
};

function fly(g, ctl) {
  const b = g.boosters[0];
  const tw = g.towers[0];
  const tr = [];
  let lat = 0;
  let ign = -1;
  let cut = -1;
  let hover = -1;
  let thrDecel = 0;
  let thrHover = 0;
  let fuelIgn = null;
  let fuelHover = null;
  let fuelCut = null;
  let pop = null;
  while (b.state === 'falling' && tr.length < 4000) {
    const was = b.burning;
    g.step(ctl(g, b, tw));
    if (b.state !== 'falling') break;
    if (b.rcs) lat += DT;
    const vy = b.vy / PX_PER_M;
    tr.push({ y: b.y, vy, dx: b.x - tw.cx });
    if (!was && b.burning) {
      ign = tr.length;
      fuelIgn = b.fuel;
    }
    if (b.burning && hover < 0 && vy < CATCH_MAX_VY) {
      hover = tr.length;
      fuelHover = b.fuel;
    }
    if (b.burning) {
      if (hover < 0) thrDecel += b.throttle * DT;
      else thrHover += b.throttle * DT;
    }
    if (was && !b.burning && cut < 0) {
      cut = tr.length;
      fuelCut = b.fuel;
      pop = g.popups.find((p) => p.text === 'ENGINE CUTOFF' || p.text === 'FUEL DEPLETED');
    }
  }
  let best = 0;
  let bestArm = 0;
  for (let arm = ARM_MIN; arm <= ARM_MAX; arm += 0.25) {
    let n = 0;
    for (const f of tr) if (Math.abs(f.y - arm) <= CATCH_TOL_Y && f.vy < CATCH_MAX_VY && Math.abs(f.dx) < CATCH_TOL_X) n++;
    if (n > best) {
      best = n;
      bestArm = arm;
    }
  }
  return {
    win: best * DT,
    arm: bestArm,
    lat,
    burn: cut > 0 && ign > 0 ? (cut - ign) * DT : NaN,
    hoverT: cut > 0 && hover > 0 ? (cut - hover) * DT : 0,
    thrDecel,
    thrHover,
    fuelIgn,
    fuelHover,
    fuelCut,
    reason: pop?.text ?? (cut < 0 ? 'no cutoff' : '?'),
    end: b.state,
  };
}

const params = (d, zeroY, vy0Jitter = 0) => ({
  zeroY,
  spawnDx: 0,
  vx0: 0,
  vy0: (44 + d * 3.5) * PX_PER_M + vy0Jitter,
  vHover: Math.min(2.6, 1.3 + d * 0.17) * PX_PER_M,
  hoverLen: Math.max(7, 22 - d * 2.2),
});
const calm = { base: 0, gusts: [] };
const f1 = (v) => (v === null || Number.isNaN(v) ? '  -  ' : v.toFixed(1).padStart(5));
const f2 = (v) => (v === null || Number.isNaN(v) ? '  -  ' : v.toFixed(2).padStart(5));

if (mode === 'grid' || mode === 'all') {
  console.log('No-steer approaches, calm air, booster spawned over the tower (d = difficulty, round d+1)');
  console.log(' d zeroY jit |  win  burn hover | thr·s decel hover | fuel ign hover  cut | cutoff');
  for (let d = 0; d <= 9; d++) {
    for (const zeroY of [ARM_MIN + 30, 300, ARM_MAX - 15]) {
      for (const jit of [-8, 8]) {
        const r = fly(setup({ d, booster: params(d, zeroY, jit), wind: calm }), none());
        console.log(
          `${String(d).padStart(2)} ${String(zeroY).padStart(5)} ${String(jit).padStart(3)} | ${f2(r.win)} ${f2(r.burn)} ${f2(r.hoverT)} | ${f2(r.thrDecel)} ${f2(r.thrHover)} | ${f1(r.fuelIgn)} ${f1(r.fuelHover)} ${f1(r.fuelCut)} | ${r.reason} -> ${r.end}`,
        );
      }
    }
  }
}

if (mode === 'pilots' || mode === 'all') {
  console.log('\nScripted approaches on round-1..3 parameters (mean over zeroY 240/300/395, vy0 jitter -8/+8)');
  console.log(' d approach            |  lat s   win  hoverT  fuel@hover fuel@cut | cutoffs');
  const approaches = [
    ['no steer', () => none()],
    ['typical (1.6 s)', () => spend(1.6)],
    [`full (${OLD_LAT_SECONDS.toFixed(2)} s)`, () => spend(OLD_LAT_SECONDS)],
    ['heavy steer in hover', () => hoverSteer()],
  ];
  for (const d of [0, 1, 2, 4, 6, 9]) {
    for (const [name, mk] of approaches) {
      const rs = [];
      for (const zeroY of [ARM_MIN + 30, 300, ARM_MAX - 15]) for (const jit of [-8, 8]) rs.push(fly(setup({ d, booster: params(d, zeroY, jit), wind: calm }), mk()));
      const mean = (k) => rs.reduce((s, r) => s + (r[k] ?? 0), 0) / rs.length;
      const reasons = {};
      for (const r of rs) reasons[`${r.reason}->${r.end}`] = (reasons[`${r.reason}->${r.end}`] || 0) + 1;
      const minWin = Math.min(...rs.map((r) => r.win));
      console.log(
        `${String(d).padStart(2)} ${name.padEnd(20)} | ${f2(mean('lat'))} ${f2(mean('win'))} (min ${f2(minWin)}) ${f2(mean('hoverT'))}  ${f1(mean('fuelHover'))}  ${f1(mean('fuelCut'))} | ${JSON.stringify(reasons)}`,
      );
    }
  }

  console.log('\nAutopilot on seeded random rounds (spawn offset, drift and wind as the game rolls them)');
  console.log(' d   n | lat s mean  max |  win mean  min | crashes before hover');
  for (const d of [0, 1, 2, 4]) {
    const rs = [];
    for (let seed = 1; seed <= 40; seed++) rs.push(fly(setup({ d, seed }), pilot(2)));
    const mean = (k) => rs.reduce((s, r) => s + r[k], 0) / rs.length;
    console.log(
      `${String(d).padStart(2)} ${String(rs.length).padStart(3)} | ${f2(mean('lat'))} ${f2(Math.max(...rs.map((r) => r.lat)))} | ${f2(mean('win'))} ${f2(Math.min(...rs.map((r) => r.win)))} | ${rs.filter((r) => r.win === 0).length}`,
    );
  }
}
