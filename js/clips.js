// 하이라이트 클립: 점프대에서 뜨는 순간부터 착지 후 1.6초까지를 짧은 세로 영상(540x960)으로 녹화
// - 게임 화면(WebGL 캔버스)을 매 프레임 작은 2D 캔버스에 옮겨 그리고, 로고·점수·묘기 자막을 얹어 MediaRecorder 로 인코딩
// - 녹화는 공중에 있는 동안만 → 평소 주행엔 부담 없음. 한 판에서 묘기 점수가 가장 높은 클립 하나만 보관
// - 형식: MP4(H.264)를 우선 (왓츠앱·인스타 스토리 호환), 안 되면 WebM
const CW = 540, CH = 960;
const MIME = ['video/mp4;codecs=avc1.42E01E', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
const HOLD_MS = 1600, MAX_MS = 12000;

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
    this.best = null; // { blob, url, score, ext }
    this.rec = null;
    this.font = '';
  }

  get supported() { return Boolean(this.mime); }
  get recording() { return Boolean(this.rec); }

  // 새 판: 지난 판 클립 정리
  reset() {
    this.cancel();
    if (this.best?.url) URL.revokeObjectURL(this.best.url);
    this.best = null;
  }

  // 점프 시작: 녹화 시작 (이미 녹화 중이면 그대로 이어서 — 연속 점프는 한 클립)
  start(meta = {}) {
    if (!this.enabled || !this.supported) return;
    this.meta = { ...this.meta, ...meta };
    if (this.rec) { this.stopAt = 0; this.score = -1; return; }
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = CW;
      this.canvas.height = CH;
      this.ctx = this.canvas.getContext('2d');
      this.stream = this.canvas.captureStream(30);
    }
    this.caption = null;
    this.score = -1;
    this.stopAt = 0;
    this.t0 = performance.now();
    this.fresh = true;
    this.draw(0);
    try {
      this.rec = new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: 3_000_000 });
    } catch (e) {
      this.rec = null;
      return;
    }
    const rec = this.rec, chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onstop = () => this._done(chunks, rec.finalScore ?? -1); // 녹화마다 따로 보관 (다음 점프와 섞이지 않게)
    rec.start();
  }

  // 착지: 자막을 띄우고 HOLD_MS 뒤에 녹화를 마침. score < 0 이면 버림 (넘어진 착지)
  finish(score, title, sub) {
    if (!this.rec) return;
    this.score = score;
    this.caption = title ? { title, sub, t: performance.now() } : null;
    this.stopAt = performance.now() + (score < 0 ? 300 : HOLD_MS);
  }

  // 공중에서 넘어짐: 착지 자막 대기 중이 아니면 버림
  crashed() {
    if (this.rec && !this.stopAt) this.finish(-1);
  }

  cancel() {
    if (!this.rec) return;
    const rec = this.rec;
    rec.finalScore = -1;
    this.rec = null;
    try { rec.stop(); } catch (e) { /* ignore */ }
  }

  // 매 프레임 (게임 렌더 직후 호출): 화면을 옮겨 그리고 끝낼 때가 되면 정지
  frame(score) {
    if (!this.rec) return;
    const now = performance.now();
    this.draw(score);
    if ((this.stopAt && now >= this.stopAt) || now - this.t0 > MAX_MS) {
      const rec = this.rec;
      rec.finalScore = this.stopAt ? this.score : -1; // 착지 없이 시간만 넘긴 녹화는 버림
      this.rec = null;
      try { rec.stop(); } catch (e) { /* ignore */ }
    }
  }

  draw(score) {
    const ctx = this.ctx, src = this.src;
    // 게임 화면을 9:16 으로 잘라 채움. 바이크를 따라가며(부드럽게) 잘라서 공중에서도 화면 밖으로 나가지 않게
    const k = Math.max(CW / src.width, CH / src.height);
    const w = src.width * k, h = src.height * k;
    const f = this.focus?.() || { x: 0.5, y: 0.6 };
    const tx = Math.min(0, Math.max(CW - w, CW * 0.5 - f.x * w));
    const ty = Math.min(0, Math.max(CH - h, CH * 0.58 - f.y * h));
    if (this.ox == null || this.fresh) { this.ox = tx; this.oy = ty; this.fresh = false; }
    this.ox += (tx - this.ox) * 0.2;
    this.oy += (ty - this.oy) * 0.2;
    try { ctx.drawImage(src, this.ox, this.oy, w, h); } catch (e) { return; }
    const sf = this.meta?.scriptFont ? `, '${this.meta.scriptFont}'` : '';
    // 위: 그림자 띠 + 로고 + 점수
    const top = ctx.createLinearGradient(0, 0, 0, 150);
    top.addColorStop(0, 'rgba(0,0,0,0.55)');
    top.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, CW, 150);
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.font = `900 34px Nunito${sf}, sans-serif`;
    ctx.fillText('Grub Rider', 24, 54);
    ctx.textAlign = 'right';
    ctx.font = `34px 'Russo One'${sf}, sans-serif`;
    ctx.fillText(Math.floor(score || 0).toLocaleString('en-US'), CW - 24, 56);
    // 아래: 링크
    const bot = ctx.createLinearGradient(0, CH - 120, 0, CH);
    bot.addColorStop(0, 'rgba(0,0,0,0)');
    bot.addColorStop(1, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = bot;
    ctx.fillRect(0, CH - 120, CW, 120);
    ctx.textAlign = 'center';
    ctx.font = `700 22px Rajdhani${sf}, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    if (this.meta?.url) ctx.fillText(this.meta.url, CW / 2, CH - 26);
    // 착지 자막: 튀어나오듯 커졌다가 자리 잡음
    if (this.caption) {
      const a = Math.min(1, (performance.now() - this.caption.t) / 220);
      const s = 0.7 + 0.3 * (1 - (1 - a) ** 3) + (a < 1 ? 0.12 * Math.sin(a * Math.PI) : 0);
      ctx.save();
      ctx.translate(CW / 2, CH * 0.36);
      ctx.scale(s, s);
      ctx.globalAlpha = a;
      ctx.font = `46px 'Russo One'${sf}, sans-serif`;
      const tw = Math.min(CW - 40, ctx.measureText(this.caption.title).width + 56);
      ctx.fillStyle = 'rgba(0, 120, 50, 0.85)';
      roundRect(ctx, -tw / 2, -58, tw, this.caption.sub ? 118 : 80, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(this.caption.title, 0, -2, CW - 70);
      if (this.caption.sub) {
        ctx.font = `34px 'Russo One'${sf}, sans-serif`;
        ctx.fillStyle = '#ffd34d';
        ctx.fillText(this.caption.sub, 0, 44, CW - 70);
      }
      ctx.restore();
    }
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
