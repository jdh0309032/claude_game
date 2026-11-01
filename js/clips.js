// 하이라이트 클립: 점프대에 다가가는 순간부터 착지 후까지 + 마지막 설치 유도 화면을 짧은 세로 영상(720x1280)으로 녹화
// - 게임 화면(WebGL 캔버스)을 매 프레임 2D 캔버스에 옮겨 그리고, 로고·점수·묘기 자막을 얹어 MediaRecorder 로 인코딩
// - 게임 소리(효과음·엔진·음악)도 함께 녹음
// - 점프대가 약 1.5초 앞에 오면 미리 녹화 시작(arm) → 점프 안 하면 버림. 점프 전후만 녹화해 평소 주행엔 부담 없음
// - 한 판에서 묘기 점수가 가장 높은 클립 하나만 보관. 형식: MP4(H.264+AAC) 우선, 안 되면 WebM
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
    this.best = null; // { blob, url, score, ext, type }
    this.rec = null;
    this.meta = {};
  }

  get supported() { return Boolean(this.mime); }
  get recording() { return Boolean(this.rec); }

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
    if (this.rec || !this.enabled || !this.supported) return;
    this._begin(meta);
    this.armedAt = performance.now();
  }

  // 점프 시작: 이미 녹화 중이면 그대로 이어감 (연속 점프도 한 클립)
  start(meta = {}) {
    if (!this.enabled || !this.supported) return;
    if (this.rec) {
      if (this.phase === 'live') { this.stopAt = 0; this.score = -1; this.armedAt = 0; }
      return;
    }
    this._begin(meta);
  }

  _begin(meta) {
    this.meta = { ...this.meta, ...meta };
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = CW;
      this.canvas.height = CH;
      this.ctx = this.canvas.getContext('2d');
      this.vstream = this.canvas.captureStream(30);
    }
    const tracks = [...this.vstream.getVideoTracks()];
    try {
      const a = this.audio?.();
      if (a) tracks.push(...a.getAudioTracks());
    } catch (e) { /* 소리 없이 */ }
    this.caption = null;
    this.score = -1;
    this.stopAt = 0;
    this.armedAt = 0;
    this.phase = 'live';
    this.t0 = performance.now();
    this.fresh = true;
    this.draw(0);
    let rec;
    try {
      rec = new MediaRecorder(new MediaStream(tracks), { mimeType: this.mime, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 128_000 });
    } catch (e) {
      try { rec = new MediaRecorder(new MediaStream(tracks), { mimeType: this.mime }); } catch (err) { return; }
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => this._done(chunks, rec.finalScore ?? -1); // 녹화마다 따로 보관 (다음 점프와 섞이지 않게)
    rec.start();
    this.rec = rec;
  }

  // 착지: 자막을 띄우고 잠시 뒤 마지막 화면으로. score < 0 이면 버림 (넘어진 착지)
  finish(score, title, sub) {
    if (!this.rec || this.phase !== 'live') return;
    this.score = score;
    this.armedAt = 0;
    this.caption = title ? { title, sub, t: performance.now() } : null;
    this.stopAt = performance.now() + (score < 0 ? 200 : HOLD_MS);
  }

  // 공중에서 넘어짐 / 점프 전에 부딪힘: 착지 자막 대기 중이 아니면 버림
  crashed() {
    if (this.rec && this.phase === 'live' && !this.stopAt) this.finish(-1);
  }

  cancel() {
    if (!this.rec) return;
    this._stop(-1);
  }

  _stop(score) {
    const rec = this.rec;
    this.rec = null;
    rec.finalScore = score;
    try { rec.stop(); } catch (e) { /* ignore */ }
  }

  // 매 프레임 (게임 렌더 직후 호출)
  frame(score) {
    if (!this.rec) return;
    const now = performance.now();
    if (this.phase === 'live') {
      this.draw(score);
      if (this.armedAt && now - this.armedAt > ARM_MS) { this._stop(-1); return; } // 점프 안 함
      if (this.stopAt && now >= this.stopAt) {
        if (this.score < 0) { this._stop(-1); return; }
        // 마지막 화면 시작: 지금 화면을 남겨 두고 그 위로 페이드
        this.phase = 'end';
        this.endScore = Math.floor(score || 0);
        this.last = this.last || document.createElement('canvas');
        this.last.width = CW;
        this.last.height = CH;
        this.last.getContext('2d').drawImage(this.canvas, 0, 0);
        if (!this.hero) this.prepare(); // 보통은 판 시작 때 미리 준비됨
        this.endT = performance.now();
        this.onEnd?.();
      } else if (!this.stopAt && now - this.t0 > MAX_MS) { this._stop(-1); return; }
    }
    if (this.phase === 'end') {
      this.drawEnd(now - this.endT);
      if (now - this.endT >= END_MS) this._stop(this.score);
    }
  }

  font(kind, size) {
    const sf = this.meta?.scriptFont ? `, '${this.meta.scriptFont}'` : '';
    if (kind === 'display') return `${size}px 'Russo One'${sf}, 'Arial Black', sans-serif`;
    if (kind === 'brand') return `900 ${size}px Nunito${sf}, sans-serif`;
    return `700 ${size}px Rajdhani${sf}, system-ui, sans-serif`;
  }

  draw(score) {
    const ctx = this.ctx, src = this.src;
    // 게임 화면을 9:16 으로 잘라 채움. 바이크를 따라가며(부드럽게) 잘라서 공중에서도 화면 밖으로 나가지 않게
    const k = Math.max(CW / src.width, CH / src.height);
    const w = src.width * k, h = src.height * k;
    const f = this.focus?.() || { x: 0.5, y: 0.6 };
    const tx = Math.min(0, Math.max(CW - w, CW * 0.5 - f.x * w));
    const ty = Math.min(0, Math.max(CH - h, CH * 0.58 - f.y * h));
    if (this.fresh) { this.ox = tx; this.oy = ty; this.fresh = false; }
    this.ox += (tx - this.ox) * 0.2;
    this.oy += (ty - this.oy) * 0.2;
    ctx.globalAlpha = 1;
    ctx.imageSmoothingQuality = 'high';
    try { ctx.drawImage(src, this.ox, this.oy, w, h); } catch (e) { return; }
    // 위: 그림자 띠 + 로고 + 점수
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
    // 착지 자막: 튀어나오듯 커졌다가 자리 잡음
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
    const ctx = this.ctx, m = this.meta || {};
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
    // 천천히 도는 빛줄기
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
    // 로고
    const logoIn = easeOut((ms - 100) / 400);
    ctx.globalAlpha = fade * logoIn;
    ctx.fillStyle = '#fff';
    ctx.font = this.font('brand', 104);
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24;
    ctx.fillText('Grub Rider', CW / 2, 170 - (1 - logoIn) * 30);
    ctx.shadowBlur = 0;
    // 라이더 (아래에서 튀어 오름)
    if (this.hero) {
      const hi = easeOut((ms - 150) / 500);
      const size = 620;
      ctx.globalAlpha = fade * hi;
      ctx.drawImage(this.hero, (CW - size) / 2, 210 + (1 - hi) * 120, size, size);
    }
    // 점수
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
    // 설치 유도 버튼 (살짝 맥박)
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

  _done(chunks, score) {
    if (!chunks.length || score < 0) return;
    const type = this.mime.split(';')[0];
    const blob = new Blob(chunks, { type });
    if (blob.size < 2000) return;
    if (this.best && this.best.score >= score) return;
    if (this.best?.url) URL.revokeObjectURL(this.best.url);
    this.best = { blob, url: URL.createObjectURL(blob), score, ext: type.includes('mp4') ? 'mp4' : 'webm', type };
    this.onClip?.(this.best);
  }
}
