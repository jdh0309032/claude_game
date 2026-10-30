// 구간별 글로벌 국가/도시 테마 + 국기 그리기 + 지역(랭킹) 추정
export const ZONE_LENGTH = 1000; // 매 1,000m 마다 다음 나라로

// building: ruko | tube | neon | modern | brick | haussmann (models.js BUILDING_STYLES)
// tree: palm | sakura | ginkgo | round, curb: warung | vending | cafe | tent | planter
// traffic: 특수 차량 비율 (tuktuk / scooter / taxi 추가 가중치)
export const THEMES = [
  {
    code: 'ID', country: 'Indonesia', city: 'Jakarta', welcome: 'SELAMAT DATANG DI JAKARTA',
    building: { ruko: 1 }, tree: 'palm', curb: 'warung', landmark: 'monas',
    tint: 0xffe0b0, tintAmt: 0.08, traffic: { scooter: 0.12 },
  },
  {
    code: 'VN', country: 'Vietnam', city: 'Hanoi', welcome: 'CHAO MUNG DEN HA NOI',
    building: { tube: 0.8, ruko: 0.2 }, tree: 'palm', curb: 'tent', landmark: 'pagoda',
    tint: 0xffc59a, tintAmt: 0.12, traffic: { scooter: 0.35 },
  },
  {
    code: 'TH', country: 'Thailand', city: 'Bangkok', welcome: 'WELCOME TO BANGKOK',
    building: { ruko: 0.5, neon: 0.5 }, tree: 'palm', curb: 'warung', landmark: 'temple',
    tint: 0xffb6e6, tintAmt: 0.12, traffic: { tuktuk: 0.25, scooter: 0.1 },
  },
  {
    code: 'KR', country: 'South Korea', city: 'Seoul', welcome: 'WELCOME TO SEOUL',
    building: { neon: 0.75, modern: 0.25 }, tree: 'ginkgo', curb: 'tent', landmark: 'namsan',
    tint: 0xa9b8ff, tintAmt: 0.12, traffic: {},
  },
  {
    code: 'JP', country: 'Japan', city: 'Tokyo', welcome: 'WELCOME TO TOKYO',
    building: { neon: 0.85, modern: 0.15 }, tree: 'sakura', curb: 'vending', landmark: 'tokyotower',
    tint: 0xffb3d1, tintAmt: 0.14, traffic: {},
  },
  {
    code: 'SG', country: 'Singapore', city: 'Marina Bay', welcome: 'WELCOME TO SINGAPORE',
    building: { modern: 1 }, tree: 'palm', curb: 'planter', landmark: 'mbs',
    tint: 0xb8fff0, tintAmt: 0.1, traffic: {},
  },
  {
    code: 'US', country: 'USA', city: 'New York', welcome: 'WELCOME TO NEW YORK',
    building: { brick: 0.8, modern: 0.2 }, tree: 'round', curb: 'cafe', landmark: 'empire',
    tint: 0xffd6a5, tintAmt: 0.08, traffic: { taxi: 0.35 },
  },
  {
    code: 'FR', country: 'France', city: 'Paris', welcome: 'BIENVENUE A PARIS',
    building: { haussmann: 1 }, tree: 'round', curb: 'cafe', landmark: 'eiffel',
    tint: 0xd7e3ff, tintAmt: 0.1, traffic: {},
  },
];

export const themeIndexAt = (distance) => Math.floor(Math.max(0, distance) / ZONE_LENGTH) % THEMES.length;
export const themeAt = (distance) => THEMES[themeIndexAt(distance)];

// 가중치 객체에서 하나 고르기 ({ ruko: 0.5, neon: 0.5 })
export function pickWeighted(weights, r = Math.random()) {
  const entries = Object.entries(weights);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

// ---------- 랭킹 국가
// IP 위치 조회로 어떤 나라든 들어올 수 있으므로 ISO 3166-1 alpha-2 코드를 그대로 쓰고,
// 목록(드롭다운)에는 주행 테마 8개국 + 자주 쓰는 나라를 먼저 보여줌
export const COUNTRY_CODES = [
  ...THEMES.map((t) => t.code),
  'MY', 'PH', 'CN', 'TW', 'HK', 'IN', 'AU', 'NZ', 'GB', 'DE', 'IT', 'ES', 'NL', 'CA', 'MX', 'BR',
  'AR', 'RU', 'UA', 'PL', 'TR', 'SA', 'AE', 'EG', 'ZA', 'NG', 'KH', 'LA', 'MM', 'BD', 'PK',
];
export const isCountryCode = (c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c);

let regionNames = null;
try { regionNames = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* 구형 브라우저 */ }
export function countryName(code) {
  const t = THEMES.find((x) => x.code === code);
  if (t) return t.country;
  try { return regionNames?.of(code) || code; } catch (e) { return code; }
}

// IP 조회 실패 시 대체: 기기 시간대로 추정
export function guessRegion() {
  let tz = '';
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
  const map = {
    'Asia/Jakarta': 'ID', 'Asia/Makassar': 'ID', 'Asia/Jayapura': 'ID', 'Asia/Pontianak': 'ID',
    'Asia/Ho_Chi_Minh': 'VN', 'Asia/Saigon': 'VN', 'Asia/Hanoi': 'VN',
    'Asia/Bangkok': 'TH', 'Asia/Seoul': 'KR', 'Asia/Tokyo': 'JP', 'Asia/Singapore': 'SG',
    'Europe/Paris': 'FR', 'Asia/Kuala_Lumpur': 'MY', 'Asia/Manila': 'PH', 'Asia/Shanghai': 'CN',
    'Asia/Taipei': 'TW', 'Asia/Hong_Kong': 'HK', 'Asia/Kolkata': 'IN', 'Europe/London': 'GB',
    'Europe/Berlin': 'DE', 'Europe/Rome': 'IT', 'Europe/Madrid': 'ES', 'Europe/Amsterdam': 'NL',
  };
  if (map[tz]) return map[tz];
  if (tz.startsWith('Australia/')) return 'AU';
  if (tz.startsWith('America/')) return 'US';
  return 'ID';
}

// ---------- 국기 (Canvas 2D 로 직접 그림)
function star(x, cx, cy, r, color) {
  x.fillStyle = color;
  x.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.42 : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
  x.fill();
}

export function drawFlag(ctx, code, w, h, ox = 0, oy = 0) {
  const x = ctx;
  x.save();
  x.translate(ox, oy);
  const rect = (c, a, b, cw, ch) => { x.fillStyle = c; x.fillRect(a, b, cw, ch); };
  // 가로(false) / 세로(true) 줄무늬 국기
  const bands = (cols, vertical) => cols.forEach((c, i) => (vertical
    ? rect(c, (w / cols.length) * i, 0, w / cols.length + 0.5, h)
    : rect(c, 0, (h / cols.length) * i, w, h / cols.length + 0.5)));
  switch (code) {
    case 'ID':
      rect('#ce1126', 0, 0, w, h / 2);
      rect('#ffffff', 0, h / 2, w, h / 2);
      break;
    case 'VN':
      rect('#da251d', 0, 0, w, h);
      star(x, w / 2, h / 2, h * 0.32, '#ffcd00');
      break;
    case 'TH': {
      const s = h / 6;
      rect('#a51931', 0, 0, w, h);
      rect('#f4f5f8', 0, s, w, s * 4);
      rect('#2d2a4a', 0, s * 2, w, s * 2);
      break;
    }
    case 'KR': {
      rect('#ffffff', 0, 0, w, h);
      const cx = w / 2, cy = h / 2, r = h * 0.25;
      x.save();
      x.translate(cx, cy);
      x.rotate(Math.atan2(2, 3));
      x.fillStyle = '#0047a0';
      x.beginPath(); x.arc(0, 0, r, 0, Math.PI); x.fill();
      x.fillStyle = '#cd2e3a';
      x.beginPath(); x.arc(0, 0, r, Math.PI, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(-r / 2, 0, r / 2, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#0047a0';
      x.beginPath(); x.arc(r / 2, 0, r / 2, 0, Math.PI * 2); x.fill();
      x.restore();
      // 4괘 (단순화)
      x.fillStyle = '#000';
      const bar = (bx, by, ang) => {
        x.save(); x.translate(bx, by); x.rotate(ang);
        for (let i = 0; i < 3; i++) x.fillRect(-h * 0.08, -h * 0.07 + i * h * 0.055, h * 0.16, h * 0.035);
        x.restore();
      };
      bar(w * 0.2, h * 0.24, -0.98); bar(w * 0.8, h * 0.76, -0.98);
      bar(w * 0.8, h * 0.24, 0.98); bar(w * 0.2, h * 0.76, 0.98);
      break;
    }
    case 'JP':
      rect('#ffffff', 0, 0, w, h);
      x.fillStyle = '#bc002d';
      x.beginPath(); x.arc(w / 2, h / 2, h * 0.3, 0, Math.PI * 2); x.fill();
      break;
    case 'SG':
      rect('#ef3340', 0, 0, w, h / 2);
      rect('#ffffff', 0, h / 2, w, h / 2);
      x.fillStyle = '#ffffff';
      x.beginPath(); x.arc(w * 0.2, h * 0.25, h * 0.17, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ef3340';
      x.beginPath(); x.arc(w * 0.245, h * 0.25, h * 0.16, 0, Math.PI * 2); x.fill();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / 5;
        star(x, w * 0.3 + Math.cos(a) * h * 0.08, h * 0.25 + Math.sin(a) * h * 0.08, h * 0.035, '#ffffff');
      }
      break;
    case 'US': {
      const s = h / 13;
      for (let i = 0; i < 13; i++) rect(i % 2 ? '#ffffff' : '#b22234', 0, i * s, w, s + 0.5);
      rect('#3c3b6e', 0, 0, w * 0.4, s * 7);
      x.fillStyle = '#ffffff';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
        x.beginPath(); x.arc(w * 0.035 + c * w * 0.064, s * 0.8 + r * s * 1.3, Math.max(1, h * 0.022), 0, Math.PI * 2); x.fill();
      }
      break;
    }
    case 'FR':
      rect('#0055a4', 0, 0, w / 3, h);
      rect('#ffffff', w / 3, 0, w / 3, h);
      rect('#ef4135', (w * 2) / 3, 0, w / 3 + 0.5, h);
      break;
    case 'DE': bands(['#000000', '#dd0000', '#ffce00'], false); break;
    case 'NL': bands(['#ae1c28', '#ffffff', '#21468b'], false); break;
    case 'RU': bands(['#ffffff', '#0039a6', '#d52b1e'], false); break;
    case 'UA': bands(['#0057b7', '#ffd700'], false); break;
    case 'PL': bands(['#ffffff', '#dc143c'], false); break;
    case 'IT': bands(['#009246', '#ffffff', '#ce2b37'], true); break;
    case 'ES':
      rect('#aa151b', 0, 0, w, h);
      rect('#f1bf00', 0, h / 4, w, h / 2);
      break;
    case 'IN':
      bands(['#ff9933', '#ffffff', '#138808'], false);
      x.strokeStyle = '#000080';
      x.lineWidth = Math.max(1, h * 0.03);
      x.beginPath(); x.arc(w / 2, h / 2, h * 0.13, 0, Math.PI * 2); x.stroke();
      break;
    case 'CN':
      rect('#de2910', 0, 0, w, h);
      star(x, w * 0.17, h * 0.27, h * 0.16, '#ffde00');
      for (const [sx, sy] of [[0.33, 0.1], [0.4, 0.2], [0.4, 0.35], [0.33, 0.45]]) star(x, w * sx, h * sy, h * 0.055, '#ffde00');
      break;
    case 'PH':
      rect('#0038a8', 0, 0, w, h / 2);
      rect('#ce1126', 0, h / 2, w, h / 2);
      x.fillStyle = '#ffffff';
      x.beginPath(); x.moveTo(0, 0); x.lineTo(h * 0.87, h / 2); x.lineTo(0, h); x.closePath(); x.fill();
      star(x, h * 0.3, h / 2, h * 0.11, '#fcd116');
      break;
    case 'MY': {
      const s = h / 14;
      for (let i = 0; i < 14; i++) rect(i % 2 ? '#ffffff' : '#cc0001', 0, i * s, w, s + 0.5);
      rect('#010066', 0, 0, w / 2, s * 8);
      x.fillStyle = '#ffcc00';
      x.beginPath(); x.arc(w * 0.18, s * 4, s * 2.6, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#010066';
      x.beginPath(); x.arc(w * 0.215, s * 4, s * 2.3, 0, Math.PI * 2); x.fill();
      star(x, w * 0.36, s * 4, s * 1.9, '#ffcc00');
      break;
    }
    case 'GB':
      rect('#012169', 0, 0, w, h);
      x.strokeStyle = '#ffffff';
      x.lineWidth = h * 0.2;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
      x.strokeStyle = '#c8102e';
      x.lineWidth = h * 0.07;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, h); x.moveTo(w, 0); x.lineTo(0, h); x.stroke();
      rect('#ffffff', w / 2 - h * 0.17, 0, h * 0.34, h);
      rect('#ffffff', 0, h / 2 - h * 0.17, w, h * 0.34);
      rect('#c8102e', w / 2 - h * 0.1, 0, h * 0.2, h);
      rect('#c8102e', 0, h / 2 - h * 0.1, w, h * 0.2);
      break;
    case 'CA':
      rect('#ffffff', 0, 0, w, h);
      rect('#d52b1e', 0, 0, w / 4, h);
      rect('#d52b1e', (w * 3) / 4, 0, w / 4 + 0.5, h);
      star(x, w / 2, h / 2, h * 0.26, '#d52b1e');
      break;
    default:
      // 아직 그림이 없는 나라: 중립 배지 + 국가 코드
      rect('#2b2d42', 0, 0, w, h);
      rect('#00b14f', 0, h * 0.78, w, h * 0.22);
      x.fillStyle = '#ffffff';
      x.font = `bold ${Math.round(h * 0.5)}px "Russo One", "Arial Black", sans-serif`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(String(code || '?').slice(0, 2), w / 2, h * 0.42);
  }
  x.restore();
}

const flagCache = {};
// 국기 캔버스 (DOM 배지 / 3D 텍스처 공용)
export function flagCanvas(code, w = 96, h = 64) {
  const key = `${code}-${w}x${h}`;
  if (flagCache[key]) return flagCache[key];
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  drawFlag(c.getContext('2d'), code, w, h);
  flagCache[key] = c;
  return c;
}

// 랭킹 등 DOM 에서 쓰는 국기 배지 (data URL 이미지)
export function flagBadge(code, cls = 'flag') {
  if (!code) return '';
  const url = flagCanvas(code, 48, 32).toDataURL();
  return `<img class="${cls}" src="${url}" alt="${code}" title="${code}">`;
}
