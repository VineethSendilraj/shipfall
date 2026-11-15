/** Synthesized WebAudio effects. Muted by default; the context is created on first unmute (a user gesture). */
export class Sound {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on && !this.ctx) this.init();
    if (this.ctx) {
      if (on) this.ctx.resume();
      this.master.gain.setTargetAtTime(on ? 0.7 : 0, this.ctx.currentTime, 0.05);
    }
  }

  init() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5 + w * 0.15;
    }
    this.noiseBuf = buf;

    const loop = (type, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.engine = loop('lowpass', 260, 0.7);
    this.rcs = loop('highpass', 2400, 0.5);
  }

  update(throttle, rcs) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    // When the engines cut (a catch), the roar fades out over half a second instead of stopping dead.
    if (throttle > 0.02) {
      this.lastOn = t;
      this.held = throttle;
    } else if (t - (this.lastOn ?? -9) < 0.5) throttle = this.held * (1 - (t - this.lastOn) / 0.5);
    this.engine.g.gain.setTargetAtTime(Math.min(1, throttle) * 0.9, t, 0.08);
    this.engine.f.frequency.setTargetAtTime(160 + throttle * 420, t, 0.1);
    this.rcs.g.gain.setTargetAtTime(rcs ? 0.12 : 0, t, 0.03);
  }

  tone(freq, dur, { type = 'sine', gain = 0.25, at = 0, slide = 0 } = {}) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  burst(dur, freq, gain, at = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(freq, t);
    f.frequency.exponentialRampToValueAtTime(80, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  /** Struck steel: partials at a bar's inharmonic ratios, each fading faster the higher it rings. */
  ring(base, dur, gain, at = 0) {
    [1, 2.76, 5.4, 8.93].forEach((r, i) => this.tone(base * r, dur / (1 + i * 0.6), { gain: gain / (1 + i), at }));
  }

  /** The arms closing on the pins: a heavy thud, a short knock of noise and the tower ringing. */
  clank(gain, at = 0) {
    this.tone(62, 0.45, { gain, slide: 0.6, at });
    this.burst(0.12, 2200, gain * 0.8, at);
    this.ring(180, 0.9, gain * 0.16, at + 0.01);
  }

  play(type) {
    if (!this.ctx || !this.enabled) return;
    switch (type) {
      // Mechanical, not musical: thuds, steel ringing at inharmonic partials, hydraulic and vapor hiss.
      case 'catch':
        this.clank(0.5);
        break;
      case 'perfect':
        // Clamp vapor venting after a clean catch.
        this.burst(0.9, 5000, 0.16);
        break;
      case 'double':
        this.clank(0.35, 0.25);
        this.burst(1.2, 4200, 0.18);
        break;
      case 'clang':
      case 'miss':
        this.ring(240, 0.5, 0.07);
        this.burst(0.3, 2600, 0.3);
        break;
      case 'crash':
        this.burst(1.4, 900, 0.9);
        this.tone(70, 0.9, { gain: 0.5, slide: 0.5 });
        break;
      case 'close':
        // Hydraulics driving the arms.
        this.burst(0.35, 1800, 0.12);
        this.tone(95, 0.3, { type: 'sawtooth', gain: 0.035, slide: 0.8 });
        break;
      case 'ignite':
        this.burst(0.5, 1400, 0.4);
        break;
      case 'unlock':
        // A deep tower-steel boom.
        this.tone(55, 1.4, { gain: 0.35, slide: 0.85 });
        this.ring(110, 1.6, 0.06);
        break;
      case 'gust':
        this.burst(1.0, 700, 0.18);
        break;
      default:
        break;
    }
  }
}
