import { QUALITY } from './three/view.js';

const WINDOW_MS = 1000;
const MIN_FRAMES = 8;
const TARGET_FPS = 33;

function isSoftwareRenderer(renderer) {
  const gl = renderer.getContext();
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  return /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
}

/**
 * Watches real frame times and steps render quality down (pixel ratio, MSAA, shadows, bloom) while the
 * game can't hold a playable frame rate. It never steps back up, so quality can't oscillate mid-round.
 */
export class AutoQuality {
  constructor(view, { forced = null } = {}) {
    this.view = view;
    const forcedLevel = QUALITY.findIndex((q) => q.name === forced);
    this.locked = forcedLevel >= 0;
    // Phones and tablets start at medium (pixel ratio 1, no MSAA): high-DPR screens on mobile GPUs rarely hold 33 fps at high.
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.level = this.locked ? forcedLevel : isSoftwareRenderer(view.renderer) ? 2 : touch ? 1 : 0;
    this.last = 0;
    this.frames = 0;
    this.elapsed = 0;
    this.settle = 1;
    this.fps = 0;
    view.setQuality(QUALITY[this.level]);
  }

  get name() {
    return QUALITY[this.level].name;
  }

  /** Call once per animation frame. Pass active=false while paused or hidden so idle gaps are ignored. */
  frame(now, active = true) {
    if (!active) {
      this.last = 0;
      return;
    }
    if (this.last) {
      const dt = now - this.last;
      if (dt < 400) {
        this.frames++;
        this.elapsed += dt;
      }
    }
    this.last = now;
    if (this.elapsed < WINDOW_MS || this.frames < MIN_FRAMES) return;
    this.fps = (this.frames * 1000) / this.elapsed;
    this.frames = 0;
    this.elapsed = 0;
    // The first window after a change includes shader recompiles, so it is not representative.
    if (this.settle > 0) {
      this.settle--;
      return;
    }
    if (!this.locked && this.fps < TARGET_FPS && this.level < QUALITY.length - 1) {
      this.level = Math.min(QUALITY.length - 1, this.level + (this.fps < TARGET_FPS / 2 ? 2 : 1));
      this.view.setQuality(QUALITY[this.level]);
      this.settle = 1;
    }
  }
}
