// 하이라이트 클립: 점프대에 다가가는 순간부터 착지 후까지 + 마지막 설치 유도 화면을 짧은 세로 영상(720x1280)으로 녹화
// - 게임 화면(WebGL 캔버스)을 매 프레임 2D 캔버스에 옮겨 그리고, 로고·점수·묘기 자막을 얹어 MediaRecorder 로 인코딩
// - 게임 소리(효과음·엔진·음악)도 함께 녹음
// - 점프대가 약 1.6초 앞에 오면 미리 녹화 시작(arm) → 점프 안 하면 버림. 점프 전후만 녹화해 평소 주행엔 부담 없음
// - 판정: 한 판에서 **점수가 가장 높았던 기술**이 담긴 클립 하나만 보관 (클립 점수 = 그 클립 안 기술 중 최고 점수)
// - 앞 클립이 마지막 화면을 그리는 동안 다음 점프가 오면, 앞 클립은 따로 끝까지 마무리하고 새 클립을 동시에 녹화
//   (예전엔 이 사이의 점프가 녹화되지 않아 더 높은 기술이 빠질 수 있었음)
// - 형식: MP4(H.264+AAC) 우선, 안 되면 WebM
const CW = 720, CH = 1280;
const MIME = [
  'video/mp4;codecs="avc1.42E01F,mp4a.40.2"', 'video/mp4;codecs="avc1.42E01E,mp4a.40.2"', 'video/mp4;codecs=avc1,opus',
  'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm',
];
const HOLD_MS = 1500;   // 착지 후 자막을 보여 주는 시간
const END_MS = 2600;    // 마지막 설치 유도 화면
const FADE_MS = 350;    // 게임 화면 → 마지막 화면 전환
const ARM_MS = 3500;    // 미리 녹화를 시작했는데 이 안에 점프하지 않으면 버림
const MAX_MS = 15000;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;

// 클립 하나 (자기 캔버스·녹화기)
class Session {
  constructor(owner, surface, meta) {
    this.o = owner;
    this.s = surface; // { canvas, ctx, stream }
    this.meta = meta;
    this.phase = 'live';
    this.best = -1;     // 이 클립 안 기술 중 최고 점수
    this.stopAt = 0;
    this.armedAt = 0;
    this.caption = null;
    this.t0 = performance.now();
    this.fresh = true;
    this.draw(0);
    const tracks = [...surface.stream.getVideoTracks()];
    try {
      const a = owner.audio?.();
      if (a) tracks.push(...a.getAudioTracks());
    } catch (e) { /* 소리 없이 */ }
    let rec;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), { mimeType: owner.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    } catch (e) {
      try { rec = new MediaRecorder(new MediaStream(tracks), { mimeType: owner.mime }); } catch (err) { rec = null; }
    }
    this.rec = rec;
    if (!rec) return;
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => { owner._release(this.s); owner._done(chunks, this.final ?? -1); };
    rec.start();
  }

  get done() { return !this.rec || this.phase === 'stopped'; }

  stop(score) {
    if (this.phase === 'stopped') return;
    this.phase = 'stopped';
    this.final = score;
    try { this.rec.stop(); } catch (e) { this.o._release(this.s); }
  }

  // 착지: 이 클립의 최고 점수를 갱신하고 자막 → 잠시 뒤 마지막 화면
  land(score, title, sub) {
    if (score < 0) {
      // 넘어진 착지: 앞서 성공한 기술이 있으면 넘어지는 장면 없이 바로 마지막 화면, 없으면 버림
      if (this.best >= 0) this.toEnd(this.o.lastScore);
      else this.stop(-1);
      return;
    }
    this.best = Math.max(this.best, score);
    this.armedAt = 0;
    this.caption = title ? { title, sub, t: performance.now() } : null;
    this.stopAt = performance.now() + HOLD_MS;
  }

  toEnd(score) {
    this.phase = 'end';
    this.endScore = Math.floor(score || 0);
    const last = document.createElement('canvas');
    last.width = CW;
    last.height = CH;
    last.getContext('2d').drawImage(this.s.canvas, 0, 0);
    this.last = last;
    if (!this.o.hero) this.o.prepare(); // 보통은 판 시작 때 미리 준비됨
    this.endT = performance.now();
  }

  frame(score) {
    if (this.phase === 'stopped') return;
    const now = performance.now();
    if (this.phase === 'live') {
      this.draw(score);
      if (this.armedAt && now - this.armedAt > ARM_MS) { this.stop(-1); return; } // 점프 안 함
      if (this.stopAt && now >= this.stopAt) this.toEnd(score);
      else if (!this.stopAt && now - this.t0 > MAX_MS) { if (this.best >= 0) this.toEnd(score); else this.stop(-1); return; }
    }
    if (this.phase === 'end') {
      this.drawEnd(now - this.endT);
      if (now - this.endT >= END_MS) this.stop(this.best);
    }
  }

  font(kind, size) {
    const sf = this.meta?.scriptFont ? `, '${this.meta.scriptFont}'` : '';
    if (kind === 'display') return `${size}px 'Russo One'${sf}, 'Arial Black', sans-serif`;
    if (kind === 'brand') return `900 ${size}px Nunito${sf}, sans-serif`;
    return `700 ${size}px Rajdhani${sf}, system-ui, sans-serif`;
  }

  draw(score) {
    const ctx = this.s.ctx, src = this.o.src;
    // 게임 화면을 9:16 으로 잘라 채움. 바이크를 따라가며(부드럽게) 잘라서 공중에서도 화면 밖으로 나가지 않게
    const k = Math.max(CW / src.width, CH / src.height);
    const w = src.width * k, h = src.height * k;
    const f = this.o.focus?.() || { x: 0.5, y: 0.6 };
    const tx = Math.min(0, Math.max(CW - w, CW * 0.5 - f.x * w));
    const ty = Math.min(0, Math.max(CH - h, CH * 0.58 - f.y * h));
    // 아주 부드럽게 따라감 (작은 움직임은 무시) → 영상이 흔들리지 않음
    if (this.fresh) { this.ox = tx; this.oy = ty; this.fresh = false; }
    const dx = tx - this.ox, dy = ty - this.oy;
    if (Math.abs(dx) > 6) this.ox += (dx - Math.sign(dx) * 6) * 0.06;
    if (Math.abs(dy) > 10) this.oy += (dy - Math.sign(dy) * 10) * 0.06;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = 'high';
    try { ctx.drawImage(src, this.ox, this.oy, w, h); } catch (e) { return; }
    const top = ctx.createLinearGradient(0, 0, 0, 200);
    top.addColorStop(0, 'rgba(0,0,0,0.55)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, CW, 200);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = this.font('brand', 46);
    ctx.fillText('Grub Rider', 32, 72);
    ctx.textAlign = 'right';
    ctx.font = this.font('display', 46);
    ctx.fillText(Math.floor(score || 0).toLocaleString('en-US'), CW - 32, 74);
    if (this.caption) {
      const a = Math.min(1, (performance.now() - this.caption.t) / 220);
      const s = 0.7 + 0.3 * easeOut(a) + (a < 1 ? 0.12 * Math.sin(a * Math.PI) : 0);
      ctx.save();
      ctx.translate(CW / 2, CH * 0.34);
      ctx.scale(s, s);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.font = this.font('display', 62);
      const tw = Math.min(CW - 50, ctx.measureText(this.caption.title).width + 76);
      ctx.fillStyle = 'rgba(0, 120, 50, 0.88)';
      roundRect(ctx, -tw / 2, -78, tw, this.caption.sub ? 160 : 108, 30);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(this.caption.title, 0, -4, CW - 90);
      if (this.caption.sub) {
        ctx.font = this.font('display', 46);
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(this.caption.sub, 0, 58, CW - 90);
      }
      ctx.restore();
    }
  }

  // 마지막 화면: 초록 배경 + 내 라이더 + 점수 + 설치 유도
  drawEnd(ms) {
    const ctx = this.s.ctx, m = this.meta || {};
    const fade = easeOut(ms / FADE_MS);
    ctx.globalAlpha = 1;
    ctx.drawImage(this.last, 0, 0);
    ctx.save();
    ctx.globalAlpha = fade;
    const bg = ctx.createLinearGradient(0, 0, CW, CH);
    bg.addColorStop(0, '#17d36a');
    bg.addColorStop(0.55, '#00a147');
    bg.addColorStop(1, '#00451f');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CW, CH);
    const ox = CW / 2, oy = CH * 0.36, rot = ms / 4000;
    for (let i = 0; i < 28; i++) {
      const a = rot + (i / 28) * Math.PI * 2;
      ctx.fillStyle = `rgba(255,255,255,${i % 2 ? 0.04 : 0.08})`;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.arc(ox, oy, 1400, a, a + Math.PI / 28);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const logoIn = easeOut((ms - 100) / 400);
    ctx.globalAlpha = fade * logoIn;
    ctx.fillStyle = '#fff';
    ctx.font = this.font('brand', 104);
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24;
    ctx.fillText('Grub Rider', CW / 2, 170 - (1 - logoIn) * 30);
    ctx.shadowBlur = 0;
    if (this.o.hero) {
      const hi = easeOut((ms - 150) / 500);
      const size = 620;
      ctx.globalAlpha = fade * hi;
      ctx.drawImage(this.o.hero, (CW - size) / 2, 210 + (1 - hi) * 120, size, size);
    }
    const si = easeOut((ms - 400) / 400);
    ctx.globalAlpha = fade * si;
    ctx.font = this.font('body', 34);
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(m.scoreLabel || 'SCORE', CW / 2, 880);
    ctx.font = this.font('display', 128);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 20;
    ctx.fillText(this.endScore.toLocaleString('en-US'), CW / 2, 1000, CW - 80);
    ctx.shadowBlur = 0;
    const bi = easeOut((ms - 700) / 400);
    const pulse = 1 + Math.sin(ms / 160) * 0.025 * bi;
    ctx.globalAlpha = fade * bi;
    ctx.save();
    ctx.translate(CW / 2, 1110);
    ctx.scale(pulse, pulse);
    ctx.font = this.font('display', 54);
    const cta = m.cta || 'PLAY FREE NOW';
    const bw = Math.min(CW - 80, ctx.measureText(cta).width + 120);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24;
    roundRect(ctx, -bw / 2, -60, bw, 112, 56);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#00873c';
    ctx.fillText(cta, 0, 18, bw - 60);
    ctx.restore();
    ctx.globalAlpha = fade * bi;
    ctx.font = this.font('body', 32);
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(m.store || m.url || '', CW / 2, 1222, CW - 80);
    ctx.restore();
  }
}

export class ClipRecorder {
  constructor(src) {
    this.src = src;
    this.enabled = true;
    this.mime = null;
    try {
      if (typeof MediaRecorder !== 'undefined' && HTMLCanvasElement.prototype.captureStream) {
        this.mime = MIME.find((m) => MediaRecorder.isTypeSupported(m)) || null;
      }
    } catch (e) { this.mime = null; }
    this.best = null; // { blob, url, score, ext, type } — 판정: 클립 안 최고 기술 점수가 가장 높은 것
    this.sessions = [];
    this.pool = [];
    this.meta = {};
    this.lastScore = 0;
  }

  get supported() { return Boolean(this.mime); }
  get recording() { return this.sessions.some((s) => !s.done); }
  get live() { return this.sessions.find((s) => s.phase === 'live' && !s.done) || null; }

  // 마지막 화면용 라이더 그림을 미리 렌더 (판 시작 카운트다운 중에 호출 → 주행 중 끊김 없음)
  prepare() {
    if (!this.supported || !this.heroImage) return;
    try {
      const src = this.heroImage();
      if (!src) return;
      const c = document.createElement('canvas'); // 렌더 캔버스는 재사용되므로 복사해 둠
      c.width = src.width;
      c.height = src.height;
      c.getContext('2d').drawImage(src, 0, 0);
      this.hero = c;
    } catch (e) { this.hero = null; }
  }

  // 새 판: 지난 판 클립 정리
  reset() {
    this.cancel();
    if (this.best?.url) URL.revokeObjectURL(this.best.url);
    this.best = null;
  }

  // 점프대가 곧 나옴: 미리 녹화 시작 (점프 직전 장면까지 담기)
  arm(meta = {}) {
    if (!this.enabled || !this.supported) return;
    const cur = this.live;
    if (cur && !cur.stopAt) return; // 이미 녹화 중 (미리 녹화 또는 공중)
    if (cur) cur.toEnd(this.lastScore); // 앞 기술은 착지했음 → 앞 클립은 마지막 화면으로 마무리 (동시에 진행)
    const s = this._open(meta);
    if (s) s.armedAt = performance.now();
  }

  // 점프 시작: 녹화 중인 클립이 있으면 이어서(연속 점프도 한 클립), 없으면 새로
  start(meta = {}) {
    if (!this.enabled || !this.supported) return;
    const s = this.live;
    if (s && !s.stopAt) { s.armedAt = 0; return; } // 미리 녹화하던 클립으로 이어감
    if (s) s.toEnd(this.lastScore); // 앞 기술은 이미 착지 → 기술마다 클립을 따로 (판정은 기술 점수)
    this._open(meta);
  }

  _open(meta) {
    this.meta = { ...this.meta, ...meta };
    const s = new Session(this, this._surface(), this.meta);
    if (!s.rec) { this._release(s.s); return null; }
    this.sessions.push(s);
    return s;
  }

  // 클립마다 캔버스가 따로 필요 (앞 클립이 마지막 화면을 그리는 동안 다음 클립 녹화)
  _surface() {
    const s = this.pool.pop();
    if (s) return s;
    const canvas = document.createElement('canvas');
    canvas.width = CW;
    canvas.height = CH;
    return { canvas, ctx: canvas.getContext('2d'), stream: canvas.captureStream(30) };
  }

  _release(surface) {
    if (surface && !this.pool.includes(surface)) this.pool.push(surface);
  }

  // 착지: 자막을 띄우고 잠시 뒤 마지막 화면으로. score < 0 = 넘어진 착지
  finish(score, title, sub) {
    this.live?.land(score, title, sub);
  }

  // 점프 전·공중에서 넘어짐: 착지 자막 대기 중이 아니면 처리
  crashed() {
    const s = this.live;
    if (s && !s.stopAt) s.land(-1);
  }

  cancel() {
    for (const s of this.sessions) s.stop(-1);
    this.sessions = [];
  }

  // 매 프레임 (게임 렌더 직후 호출)
  frame(score) {
    this.lastScore = score;
    for (const s of this.sessions) s.frame(score);
    this.sessions = this.sessions.filter((s) => !s.done);
  }

  _done(chunks, score) {
    if (!chunks.length || score < 0) return;
    const type = this.mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    if (blob.size < 2000) return;
    if (this.best && this.best.score >= score) return; // 더 높은 기술이 담긴 클립만 교체
    if (this.best?.url) URL.revokeObjectURL(this.best.url);
    this.best = { blob, url: URL.createObjectURL(blob), score, ext: type.includes('mp4') ? 'mp4' : 'webm', type };
    this.onClip?.(this.best);
  }
}
