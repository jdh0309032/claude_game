// WebAudio로 즉석 합성하는 효과음 + 아케이드 BGM (외부 음원 파일 없음)
const ENGINE_VOL = 0.022; // 이전 0.06 대비 약 37% — 플레이 방해 안 되게
const MUSIC_VOL = 0.32;
const BPM = 128;

// A minor 진행: Am - F - C - G (마디당 한 코드)
const CHORDS = [
  { root: 110.0, tones: [220.0, 261.63, 329.63, 440.0] },
  { root: 87.31, tones: [174.61, 220.0, 261.63, 349.23] },
  { root: 130.81, tones: [196.0, 261.63, 329.63, 392.0] },
  { root: 98.0, tones: [196.0, 246.94, 293.66, 392.0] },
];
const BASS_STEPS = [0, 2, 3, 6, 8, 10, 11, 14];
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 2, 3];

export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.musicOn = true;
    this.engine = null;
    this.music = null;
    this.intensity = 0;
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
      // 음악 버스: 부스트 때 필터가 열리는 로우패스 → 마스터
      this.musicFilter = this.ctx.createBiquadFilter();
      this.musicFilter.type = 'lowpass';
      this.musicFilter.frequency.value = 5200;
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = this.musicOn ? MUSIC_VOL : 0;
      this.musicFilter.connect(this.musicGain).connect(this.master);
      this.startMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? MUSIC_VOL : 0, this.ctx.currentTime, 0.1);
  }

  // 0~1: 속도가 오르면 하이햇·리드가 커지고, 니트로 때 필터 개방
  setIntensity(v, boost = false) {
    this.intensity = v;
    if (this.musicFilter) this.musicFilter.frequency.setTargetAtTime(boost ? 12000 : 3200 + v * 4000, this.ctx.currentTime, 0.2);
  }

  // ---------- BGM 스텝 시퀀서 (16분음표, lookahead 스케줄링)
  startMusic() {
    if (!this.ctx || this.music) return;
    const stepDur = 60 / BPM / 4;
    this.music = { step: 0, next: this.ctx.currentTime + 0.1, stepDur };
    this.music.timer = setInterval(() => {
      const m = this.music;
      if (!m || this.ctx.state !== 'running') return;
      while (m.next < this.ctx.currentTime + 0.12) {
        this.playStep(m.step, m.next, stepDur);
        m.step = (m.step + 1) % 64;
        m.next += stepDur;
      }
    }, 25);
  }

  playStep(step, t, sd) {
    const c = this.ctx, out = this.musicFilter, lvl = this.intensity;
    const s = step % 16, chord = CHORDS[(step >> 4) % 4];
    // 킥 (4 on the floor)
    if (s % 4 === 0) {
      const o = c.createOscillator(), g = c.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
      g.gain.setValueAtTime(0.9, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    }
    // 클랩 (2, 4박)
    if (s === 4 || s === 12) this.noiseAt(t, 0.16, 0.35, 'bandpass', 1700, 1.2, out);
    // 하이햇: 오프비트 오픈 + 16비트 클로즈 (속도 오를수록 촘촘)
    if (s % 4 === 2) this.noiseAt(t, 0.09, 0.16 + lvl * 0.08, 'highpass', 7500, 0.7, out);
    else if (s % 2 === 1 && lvl > 0.25) this.noiseAt(t, 0.03, 0.05 + lvl * 0.06, 'highpass', 9000, 0.7, out);
    // 베이스: 루트/옥타브 펌핑
    if (BASS_STEPS.includes(s)) {
      const f = chord.root * (s % 4 === 2 ? 2 : 1);
      const o = c.createOscillator(), lp = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + sd * 1.6);
      g.gain.setValueAtTime(0.32, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + sd * 1.8);
      o.connect(lp).connect(g).connect(out);
      o.start(t);
      o.stop(t + sd * 2);
    }
    // 리드 아르페지오 (16분음표, 속도 오를수록 커짐)
    const arpVol = 0.035 + lvl * 0.06;
    if (step % 2 === 0 || lvl > 0.5) {
      const f = chord.tones[ARP_ORDER[s % 8]] * (step >= 32 && s >= 8 ? 2 : 1);
      const o = c.createOscillator(), g = c.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      g.gain.setValueAtTime(arpVol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + sd * 0.9);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + sd);
    }
    // 패드: 마디 시작에 코드 깔기
    if (s === 0) {
      for (const f of chord.tones.slice(0, 3)) {
        const o = c.createOscillator(), g = c.createGain();
        o.type = 'triangle';
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.035, t + 0.08);
        g.gain.exponentialRampToValueAtTime(0.001, t + sd * 15);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + sd * 16);
      }
    }
  }

  noiseAt(t, dur, vol, type, freq, q, out) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(out);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
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

  // 핫 배달 성공: 폭죽 (휘슬 상승 → 팡 + 반짝임)
  fireworks() {
    for (let i = 0; i < 4; i++) {
      const d = i * 0.22;
      this.tone(500 + i * 120, 0.35, { type: 'triangle', vol: 0.06, to: 1800 + i * 200, delay: d });
      this.noise(0.5, { vol: 0.4, type: 'lowpass', freq: 3500, to: 300, delay: d + 0.33 });
      this.noise(0.6, { vol: 0.12, type: 'highpass', freq: 6000, to: 9000, delay: d + 0.4 });
    }
    [1047, 1319, 1568, 2093].forEach((f, i) => this.tone(f, 0.18, { type: 'square', vol: 0.05, delay: 1.1 + i * 0.08 }));
  }
  slingshot() {
    this.noise(0.6, { vol: 0.35, freq: 500, to: 5000, q: 1.2 });
    this.tone(300, 0.4, { type: 'sawtooth', vol: 0.07, to: 1400 });
  }
  fever() {
    [523, 784, 1047, 1568].forEach((f, i) => this.tone(f, 0.16, { type: 'square', vol: 0.07, delay: i * 0.06 }));
    this.noise(0.8, { vol: 0.3, freq: 800, to: 6000, q: 0.8 });
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
    g.gain.setTargetAtTime(ENGINE_VOL, c.currentTime, 0.2);
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
