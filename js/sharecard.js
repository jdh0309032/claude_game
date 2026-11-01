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
 * @param {object} d { title, delivered, score, record, recordLabel, stats: [[label, value]...6], country, countryName, rankLine,
 *                    tagline, url, scene: HTMLCanvasElement|null, scriptFont }
 * @returns {Promise<Blob>}
 */
export async function makeResultCard(d) {
  const sf = d.scriptFont ? `, '${d.scriptFont}'` : '';
  const DISPLAY = (s) => `${s}px 'Russo One'${sf}, 'Arial Black', sans-serif`;
  const BRAND = (s) => `900 ${s}px Nunito${sf}, 'Arial Rounded MT Bold', sans-serif`;
  const BODY = (s, w = 800) => `${w} ${s}px Rajdhani${sf}, system-ui, sans-serif`;
  try { await Promise.all([document.fonts.load(DISPLAY(80)), document.fonts.load(BRAND(80)), document.fonts.load(BODY(40))]); } catch (e) { /* 기본 글꼴 */ }

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // 배경: 초록 그라데이션 + 사선 줄무늬
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#17d36a');
  bg.addColorStop(0.55, GREEN);
  bg.addColorStop(1, '#005a29');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#fff';
  for (let x = -H; x < W; x += 90) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x + 40, 0); ctx.lineTo(x + 40 + H, H); ctx.lineTo(x + H, H);
    ctx.fill();
  }
  ctx.restore();

  // 로고
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = BRAND(96);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 18;
  ctx.fillText('Grub Rider', W / 2, 150);
  ctx.shadowBlur = 0;

  // 장면 스냅샷 (가운데를 잘라 채움)
  const sx = 70, sy = 200, sw = W - 140, sh = 640;
  ctx.save();
  roundRect(ctx, sx, sy, sw, sh, 40);
  ctx.clip();
  ctx.fillStyle = '#0d2a1a';
  ctx.fillRect(sx, sy, sw, sh);
  if (d.scene && d.scene.width) {
    const cw = d.scene.width, ch = d.scene.height;
    const k = Math.max(sw / cw, sh / ch);
    const w = cw * k, h = ch * k;
    try { ctx.drawImage(d.scene, sx + (sw - w) / 2, sy + (sh - h) * 0.62, w, h); } catch (e) { /* 캔버스 읽기 실패 */ }
    const fade = ctx.createLinearGradient(0, sy + sh * 0.55, 0, sy + sh);
    fade.addColorStop(0, 'rgba(0,0,0,0)');
    fade.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = fade;
    ctx.fillRect(sx, sy, sw, sh);
  }
  ctx.restore();
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  roundRect(ctx, sx, sy, sw, sh, 40);
  ctx.stroke();

  // 결과 제목 (스냅샷 아래쪽에 겹쳐서)
  ctx.fillStyle = d.delivered ? '#7dffb0' : '#ff8a8a';
  fitText(ctx, d.title, sw - 80, 104, DISPLAY);
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = 20;
  ctx.fillText(d.title, W / 2, sy + sh - 50);
  ctx.shadowBlur = 0;

  // 흰 카드: 점수 + 기록
  const cx = 70, cy = 890, cwid = W - 140, chgt = 760;
  ctx.fillStyle = '#fff';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 14;
  roundRect(ctx, cx, cy, cwid, chgt, 44);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  ctx.fillStyle = '#17201b';
  const scoreTxt = d.score;
  fitText(ctx, scoreTxt, cwid - 120, 210, DISPLAY);
  ctx.fillText(scoreTxt, W / 2, cy + 230);
  let y = cy + 270;
  if (d.record) {
    ctx.font = DISPLAY(46);
    const tw = ctx.measureText(d.recordLabel).width + 60;
    ctx.fillStyle = '#e3f7ec';
    roundRect(ctx, (W - tw) / 2, y, tw, 70, 35);
    ctx.fill();
    ctx.fillStyle = GREEN_D;
    ctx.fillText(d.recordLabel, W / 2, y + 52);
    y += 100;
  } else y += 40;

  // 기록 6칸 (3 x 2)
  const gx = cx + 40, gw = (cwid - 80 - 40) / 3, gh = 130;
  d.stats.slice(0, 6).forEach(([label, value], i) => {
    const col = i % 3, row = Math.floor(i / 3);
    const x = gx + col * (gw + 20), yy = y + row * (gh + 20);
    ctx.fillStyle = '#f2f5f3';
    roundRect(ctx, x, yy, gw, gh, 24);
    ctx.fill();
    ctx.fillStyle = '#6b7570';
    fitText(ctx, String(label), gw - 24, 30, (s) => BODY(s, 700));
    ctx.fillText(String(label), x + gw / 2, yy + 46);
    ctx.fillStyle = '#17201b';
    fitText(ctx, String(value), gw - 24, 50, DISPLAY);
    ctx.fillText(String(value), x + gw / 2, yy + 106);
  });
  y += gh * 2 + 20 + 80;

  // 국가 + 순위 줄
  const flag = d.country ? await loadImage(`assets/flags/${d.country}.svg`) : null;
  const line = d.rankLine || d.countryName || '';
  if (line) {
    ctx.font = BODY(44);
    const fw = flag ? 72 : 0;
    const tw = Math.min(cwid - 120, ctx.measureText(line).width);
    const lx = W / 2 - (tw + fw + (flag ? 18 : 0)) / 2;
    if (flag) {
      ctx.save();
      roundRect(ctx, lx, y - 40, fw, 48, 8);
      ctx.clip();
      ctx.drawImage(flag, lx, y - 40, fw, 48);
      ctx.restore();
    }
    ctx.fillStyle = '#17201b';
    ctx.textAlign = 'left';
    fitText(ctx, line, cwid - 120 - fw, 44, (s) => BODY(s));
    ctx.fillText(line, lx + fw + (flag ? 18 : 0), y);
    ctx.textAlign = 'center';
  }

  // 아래: 도전 문구 + 링크
  ctx.fillStyle = '#fff';
  fitText(ctx, d.tagline, W - 160, 66, DISPLAY);
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 12;
  ctx.fillText(d.tagline, W / 2, 1760);
  ctx.shadowBlur = 0;
  ctx.font = BODY(38, 700);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  fitText(ctx, d.url, W - 160, 38, (s) => BODY(s, 700));
  ctx.fillText(d.url, W / 2, 1840);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = reject;
  r.readAsDataURL(blob);
});

/**
 * 이미지 + 문구 공유. 결과: 'shared' | 'cancelled' | 'saved'
 */
export async function shareImage(blob, text, filename = 'grub-rider.png') {
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
  const file = new File([blob], filename, { type: 'image/png' });
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
