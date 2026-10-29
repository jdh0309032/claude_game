// WebAudio로 즉석 합성하는 효과음 (외부 음원 파일 없음)
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.engine = null;
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? 0.6 : 0;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  suspend() { if (this.ctx) this.ctx.suspend(); }
  resume() { if (this.ctx) this.ctx.resume(); }

  tone(freq, dur, { type = 'sine', vol = 0.2, to = null, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  noise(dur, { vol = 0.3, type = 'bandpass', freq = 1000, to = null, q = 1, delay = 0 } = {}) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t);
    s.stop(t + dur + 0.02);
  }

  click() { this.tone(660, 0.05, { type: 'square', vol: 0.05 }); }
  coin() {
    this.tone(988, 0.07, { type: 'square', vol: 0.06 });
    this.tone(1319, 0.12, { type: 'square', vol: 0.06, delay: 0.06 });
  }
  near(perfect) {
    this.noise(0.35, { vol: 0.35, freq: 500, to: 3200, q: 1.4 });
    if (perfect) this.tone(1200, 0.18, { type: 'triangle', vol: 0.12, to: 1900 });
  }
  crash() {
    this.noise(0.9, { vol: 0.8, type: 'lowpass', freq: 2500, to: 150 });
    this.tone(120, 0.7, { type: 'sawtooth', vol: 0.25, to: 30 });
  }
  smash() {
    this.noise(0.45, { vol: 0.55, type: 'lowpass', freq: 3000, to: 300 });
    this.tone(220, 0.3, { type: 'square', vol: 0.1, to: 60 });
  }
  power() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, { type: 'triangle', vol: 0.13, delay: i * 0.06 }));
  }
  mission() {
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.06, delay: i * 0.08 }));
  }
  boost() {
    this.noise(1.1, { vol: 0.45, freq: 300, to: 4500, q: 0.8 });
    this.tone(180, 0.9, { type: 'sawtooth', vol: 0.08, to: 900 });
  }
  beep(high) { this.tone(high ? 880 : 440, high ? 0.35 : 0.15, { type: 'square', vol: 0.09 }); }
  horn() {
    this.tone(415, 0.4, { type: 'square', vol: 0.05 });
    this.tone(523, 0.4, { type: 'square', vol: 0.04 });
  }

  // 스콜 빗소리: 루프 노이즈 (intensity 0~1)
  rain(intensity) {
    if (!this.ctx) return;
    if (!this.rainNode && intensity > 0.01) {
      const c = this.ctx;
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf;
      s.loop = true;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 900;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(hp).connect(lp).connect(g).connect(this.master);
      s.start();
      this.rainNode = { s, g };
    }
    if (this.rainNode) {
      this.rainNode.g.gain.setTargetAtTime(intensity * 0.22, this.ctx.currentTime, 0.4);
      if (intensity <= 0.01) {
        const n = this.rainNode;
        this.rainNode = null;
        n.s.stop(this.ctx.currentTime + 1.5);
      }
    }
  }
  thunder() {
    this.noise(2.2, { vol: 0.5, type: 'lowpass', freq: 400, to: 60, q: 0.5 });
    this.noise(0.25, { vol: 0.3, type: 'lowpass', freq: 2000, to: 300 });
  }
  jump() {
    this.tone(220, 0.45, { type: 'triangle', vol: 0.16, to: 880 });
    this.noise(0.5, { vol: 0.3, freq: 600, to: 2500, q: 1 });
  }
  land() {
    this.tone(140, 0.25, { type: 'sine', vol: 0.3, to: 50 });
    this.noise(0.2, { vol: 0.35, type: 'lowpass', freq: 900, to: 150 });
  }
  splash() {
    this.noise(0.45, { vol: 0.45, freq: 1800, to: 500, q: 0.7 });
    this.noise(0.25, { vol: 0.25, type: 'highpass', freq: 3000, to: 6000, delay: 0.05 });
  }

  engineStart() {
    if (!this.ctx || this.engine) return;
    const c = this.ctx;
    const o1 = c.createOscillator();
    o1.type = 'sawtooth';
    const o2 = c.createOscillator();
    o2.type = 'square';
    o2.detune.value = -1200;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const g = c.createGain();
    g.gain.value = 0;
    o1.connect(f);
    o2.connect(f);
    f.connect(g).connect(this.master);
    o1.frequency.value = 60;
    o2.frequency.value = 60;
    o1.start();
    o2.start();
    g.gain.setTargetAtTime(0.06, c.currentTime, 0.2);
    this.engine = { o1, o2, f, g };
  }

  engineUpdate(ratio, boost) {
    if (!this.engine) return;
    const t = this.ctx.currentTime;
    const freq = 55 + ratio * 150 + (boost ? 45 : 0);
    this.engine.o1.frequency.setTargetAtTime(freq, t, 0.1);
    this.engine.o2.frequency.setTargetAtTime(freq, t, 0.1);
    this.engine.f.frequency.setTargetAtTime(450 + ratio * 1700 + (boost ? 1500 : 0), t, 0.1);
  }

  engineStop() {
    if (!this.engine) return;
    const { o1, o2, g } = this.engine;
    const t = this.ctx.currentTime;
    g.gain.setTargetAtTime(0, t, 0.08);
    o1.stop(t + 0.5);
    o2.stop(t + 0.5);
    this.engine = null;
  }
}
