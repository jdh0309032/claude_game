// 결과 자랑 카드: 1080x1920(인스타·왓츠앱 스토리 비율) PNG 를 캔버스로 그림
// - 위: 로고 + 방금 달린 장면 스냅샷 / 가운데: 결과·점수·기록 / 아래: 도전 문구 + 링크
// - 공유: 앱(Capacitor Share 플러그인) → 브라우저 공유 시트(navigator.share 파일) → 이미지 저장
const W = 1080, H = 1920;
const GREEN = '#00b14f', GREEN_D = '#00873c';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 글자가 maxW 보다 넓으면 글자 크기를 줄임
function fitText(ctx, text, maxW, size, font) {
  let s = size;
  ctx.font = font(s);
  while (ctx.measureText(text).width > maxW && s > 18) { s -= 2; ctx.font = font(s); }
  return s;
}

function loadImage(src) {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = src;
  });
}

/**
 * @param {object} d { title, tone: 'gold'|'green', score, record, recordLabel, scoreLabel, stats: [[label, value]...], country, rankLine,
 *                    tagline, url, scene: 배경용 주행 장면 canvas, rider: 투명 배경 라이더 canvas, scriptFont }
 * @returns {Promise<Blob>}
 */
export async function makeResultCard(d) {
  const sf = d.scriptFont ? `, '${d.scriptFont}'` : '';
  const DISPLAY = (s) => `${s}px 'Russo One'${sf}, 'Arial Black', sans-serif`;
  const BRAND = (s) => `900 ${s}px Nunito${sf}, 'Arial Rounded MT Bold', sans-serif`;
  const BODY = (s, w = 700) => `${w} ${s}px Rajdhani${sf}, system-ui, sans-serif`;
  try { await Promise.all([document.fonts.load(DISPLAY(80)), document.fonts.load(BRAND(80)), document.fonts.load(BODY(40))]); } catch (e) { /* 기본 글꼴 */ }

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.textAlign = 'center';
  const gold = d.tone === 'gold';
  const accent = gold ? '#ffd34d' : '#39ff88';

  // 1) 배경: 주행 장면을 크게 흐리게 + 짙은 초록 그라데이션
  ctx.fillStyle = '#04170d';
  ctx.fillRect(0, 0, W, H);
  if (d.scene?.width) {
    const k = Math.max(W / d.scene.width, H / d.scene.height) * 1.08;
    const w = d.scene.width * k, h = d.scene.height * k;
    ctx.save();
    ctx.filter = 'blur(16px) saturate(1.2)';
    try { ctx.drawImage(d.scene, (W - w) / 2, (H - h) / 2, w, h); } catch (e) { /* 읽기 실패 */ }
    ctx.restore();
  }
  const shade = ctx.createLinearGradient(0, 0, 0, H);
  shade.addColorStop(0, 'rgba(3, 26, 14, 0.55)');
  shade.addColorStop(0.45, 'rgba(0, 70, 34, 0.45)');
  shade.addColorStop(0.7, 'rgba(3, 22, 12, 0.85)');
  shade.addColorStop(1, 'rgba(2, 14, 8, 0.97)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, W, H);

  // 2) 속도선: 라이더 뒤에서 퍼져 나가는 빛줄기
  const ox = W / 2, oy = 720;
  ctx.save();
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + (i % 3) * 0.02;
    const r0 = 260 + (i * 37) % 120, r1 = 1300;
    ctx.strokeStyle = `rgba(255,255,255,${0.04 + ((i * 13) % 7) * 0.012})`;
    ctx.lineWidth = 3 + (i % 4) * 3;
    ctx.beginPath();
    ctx.moveTo(ox + Math.cos(a) * r0, oy + Math.sin(a) * r0);
    ctx.lineTo(ox + Math.cos(a) * r1, oy + Math.sin(a) * r1);
    ctx.stroke();
  }
  ctx.restore();
  const glow = ctx.createRadialGradient(ox, oy + 40, 30, ox, oy + 40, 520);
  glow.addColorStop(0, gold ? 'rgba(255,211,77,0.5)' : 'rgba(57,255,136,0.55)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 200, W, 1100);

  // 3) 로고
  ctx.fillStyle = '#fff';
  ctx.font = BRAND(88);
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.fillText('Grub Rider', W / 2, 130);
  ctx.shadowBlur = 0;

  // 4) 결과 제목 (살짝 기울인 굵은 글씨 + 빛)
  ctx.save();
  ctx.translate(W / 2, 268);
  ctx.transform(1, 0, -0.12, 1, 0, 0);
  fitText(ctx, d.title, W - 140, 132, DISPLAY);
  ctx.shadowColor = accent;
  ctx.shadowBlur = 40;
  ctx.fillStyle = accent;
  ctx.fillText(d.title, 0, 0);
  ctx.shadowBlur = 0;
  ctx.restore();

  // 5) 라이더 (그림자 타원 + 투명 배경 렌더)
  ctx.save();
  ctx.translate(ox, 1115);
  ctx.scale(1, 0.16);
  const shadow = ctx.createRadialGradient(0, 0, 10, 0, 0, 380);
  shadow.addColorStop(0, 'rgba(0,0,0,0.65)');
  shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = shadow;
  ctx.fillRect(-380, -380, 760, 760);
  ctx.restore();
  if (d.rider?.width) ctx.drawImage(d.rider, 105, 290, 870, 870);

  // 6) 점수
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = BODY(36);
  ctx.fillText(spaced(d.scoreLabel), W / 2, 1215);
  ctx.fillStyle = '#fff';
  fitText(ctx, d.score, W - 160, 200, DISPLAY);
  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = 24;
  ctx.fillText(d.score, W / 2, 1380);
  ctx.shadowBlur = 0;
  let y = 1400;
  if (d.record) {
    ctx.font = DISPLAY(40);
    const tw = ctx.measureText(d.recordLabel).width + 70;
    const g = ctx.createLinearGradient((W - tw) / 2, 0, (W + tw) / 2, 0);
    g.addColorStop(0, '#ffd34d');
    g.addColorStop(1, '#ffb800');
    ctx.fillStyle = g;
    roundRect(ctx, (W - tw) / 2, y + 6, tw, 64, 32);
    ctx.fill();
    ctx.fillStyle = '#3a2a00';
    ctx.fillText(d.recordLabel, W / 2, y + 52);
    y += 96;
  } else y += 30;

  // 7) 핵심 기록 3개 (반투명 바)
  const picks = [0, 3, 1].map((i) => d.stats[i]).filter(Boolean);
  const bx = 90, bw = W - 180, bh = 130;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  roundRect(ctx, bx, y, bw, bh, 30);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  ctx.stroke();
  const cw = bw / picks.length;
  picks.forEach(([label, value], i) => {
    const cx = bx + cw * i + cw / 2;
    if (i) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(bx + cw * i, y + 26, 2, bh - 52);
    }
    ctx.fillStyle = '#fff';
    fitText(ctx, String(value), cw - 30, 52, DISPLAY);
    ctx.fillText(String(value), cx, y + 68);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    fitText(ctx, String(label), cw - 30, 28, (s) => BODY(s));
    ctx.fillText(String(label), cx, y + 108);
  });
  y += bh + 20;

  // 8) 국가 + 순위
  const flag = d.country ? await loadImage(`assets/flags/${d.country}.svg`) : null;
  if (d.rankLine) {
    ctx.font = BODY(38);
    const fw = flag ? 54 : 0, gap = flag ? 14 : 0;
    const tw = Math.min(W - 240, ctx.measureText(d.rankLine).width);
    const lx = W / 2 - (tw + fw + gap) / 2;
    if (flag) {
      ctx.save();
      roundRect(ctx, lx, y + 14, fw, 36, 6);
      ctx.clip();
      ctx.drawImage(flag, lx, y + 14, fw, 36);
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    fitText(ctx, d.rankLine, W - 240 - fw, 38, (s) => BODY(s));
    ctx.fillText(d.rankLine, lx + fw + gap, y + 45);
    ctx.textAlign = 'center';
  }

  // 9) 도전 버튼 모양 + 링크
  ctx.font = DISPLAY(48);
  const pw = Math.min(W - 160, ctx.measureText(d.tagline).width + 110);
  ctx.fillStyle = '#00b14f';
  ctx.shadowColor = 'rgba(0,177,79,0.6)';
  ctx.shadowBlur = 30;
  roundRect(ctx, (W - pw) / 2, 1726, pw, 96, 48);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff';
  fitText(ctx, d.tagline, pw - 70, 48, DISPLAY);
  ctx.fillText(d.tagline, W / 2, 1791);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  fitText(ctx, d.url, W - 160, 30, (s) => BODY(s, 600));
  ctx.fillText(d.url, W / 2, 1878);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

// 라틴 글자만 자간을 띄움 (태국어 등 결합 문자는 그대로)
function spaced(s) { return /^[\x20-\x7e]+$/.test(s) ? s.split('').join(' ') : s; }

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/**
 * 이미지 + 문구 공유 (shareFile 참고). 결과: 'shared' | 'cancelled' | 'saved'
 */
export async function shareImage(blob, text, filename = 'grub-rider.png') { return shareFile(blob, text, filename); }

// 이미지·영상 공통 공유
export async function shareFile(blob, text, filename) {
  const cap = window.Capacitor;
  const Share = cap?.Plugins?.Share, Fs = cap?.Plugins?.Filesystem;
  // 앱: 캐시에 저장 → 안드로이드 공유 시트 (왓츠앱, 인스타 스토리 등)
  if (cap?.isNativePlatform?.() && Share && Fs) {
    try {
      const { uri } = await Fs.writeFile({ path: filename, data: await blobToBase64(blob), directory: 'CACHE' });
      await Share.share({ text, files: [uri], dialogTitle: 'Grub Rider' });
      return 'shared';
    } catch (e) {
      if (/cancel/i.test(String(e?.message || e))) return 'cancelled';
    }
  }
  // 브라우저: 파일 공유 시트
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return 'shared';
    } catch (e) {
      if (e?.name === 'AbortError') return 'cancelled';
    }
  }
  // 그 밖: 이미지로 저장
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  return 'saved';
}
