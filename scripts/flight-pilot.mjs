// A small autopilot that flies the free-flight stack through the same inputs a player has (W/S, A/D,
// arrows as -1..1 axes). Used by the flight tests and the scripted screenshot runs.
const VMAX = 40;

/**
 * Input that flies toward (x, z) at a base height of alt meters, or, with land: true, descends onto the
 * point once it is over it. yawTo: optional heading (radians) to turn toward.
 */
export function pilot(f, { x, z, alt = 60, land = false, speed = VMAX, yawTo = null }) {
  const ex = x - f.base.x;
  const ez = z - f.base.z;
  const d = Math.hypot(ex, ez);
  // The flight computer holds whatever ground velocity the arrows ask for, so ask for one that can still
  // stop on the point: the stack brakes at about 3 m/s^2, and the lean takes a second or two to swing.
  const want = Math.min(speed, 0.15 * d, Math.sqrt(2 * 1.4 * d));
  const cx = d > 1e-6 ? (ex / d) * (want / VMAX) : 0;
  const cz = d > 1e-6 ? (ez / d) * (want / VMAX) : 0;
  const h = f.yaw;
  const s = Math.sin(h);
  const c = Math.cos(h);
  // forward = (-sin h, 0, -cos h), right = (cos h, 0, -sin h)
  const fwd = Math.max(-1, Math.min(1, -s * cx - c * cz));
  const right = Math.max(-1, Math.min(1, c * cx - s * cz));
  const vh = Math.hypot(f.vel.x, f.vel.z);
  let climb;
  if (land && d < 1.5 && vh < 0.8) climb = -1;
  else if (land && d < 8) climb = 0;
  else climb = Math.max(-1, Math.min(1, (alt - f.lowY) * 0.05 - f.vel.y * 0.04));
  let yaw = 0;
  if (yawTo !== null) {
    let dh = yawTo - f.yaw;
    dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    yaw = Math.max(-1, Math.min(1, -dh * 2));
  }
  return { climb, yaw, fwd, right };
}
