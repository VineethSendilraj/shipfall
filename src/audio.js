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

  burst(dur, freq, gain) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
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

  play(type) {
    if (!this.ctx || !this.enabled) return;
    switch (type) {
      case 'catch':
        this.tone(220, 0.5, { type: 'triangle', gain: 0.3 });
        this.tone(660, 0.25, { gain: 0.18, at: 0.05 });
        this.tone(990, 0.35, { gain: 0.14, at: 0.12 });
        break;
      case 'perfect':
        [880, 1175, 1568].forEach((f, i) => this.tone(f, 0.4, { gain: 0.13, at: 0.18 + i * 0.07 }));
        break;
      case 'double':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.5, { type: 'triangle', gain: 0.14, at: 0.3 + i * 0.08 }));
        break;
      case 'clang':
      case 'miss':
        [190, 287, 431].forEach((f) => this.tone(f, 0.7, { type: 'square', gain: 0.06 }));
        this.burst(0.25, 3000, 0.35);
        break;
      case 'crash':
        this.burst(1.4, 900, 0.9);
        this.tone(70, 0.9, { gain: 0.5, slide: 0.5 });
        break;
      case 'close':
        this.tone(140, 0.12, { type: 'sawtooth', gain: 0.08, slide: 0.7 });
        break;
      case 'ignite':
        this.burst(0.5, 1400, 0.4);
        break;
      case 'unlock':
        [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.6, { type: 'triangle', gain: 0.12, at: i * 0.1 }));
        break;
      case 'gust':
        this.burst(1.0, 700, 0.18);
        break;
      case 'liftoff':
        this.burst(2.2, 520, 0.7);
        this.tone(48, 1.6, { gain: 0.35, slide: 0.8 });
        break;
      case 'land':
        [392, 523, 784].forEach((f, i) => this.tone(f, 0.55, { type: 'triangle', gain: 0.13, at: 0.1 + i * 0.09 }));
        break;
      case 'lowfuel':
        [880, 880].forEach((f, i) => this.tone(f, 0.12, { type: 'square', gain: 0.05, at: i * 0.2 }));
        break;
      case 'enginesOut':
        this.tone(330, 0.8, { type: 'sawtooth', gain: 0.06, slide: 0.4 });
        break;
      default:
        break;
    }
  }
}
