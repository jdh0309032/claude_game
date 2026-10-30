// 구간별 글로벌 국가/도시 테마 + 국기 그리기 + 지역(랭킹) 추정
export const ZONE_LENGTH = 1000; // 매 1,000m 마다 다음 나라로

// building: ruko | tube | neon | modern | brick | haussmann (models.js BUILDING_STYLES)
// tree: palm | sakura | ginkgo | round, curb: warung | vending | cafe | tent | planter
// drive: 'L' 좌측통행 / 'R' 우측통행
// traffic: 특수 차량 비율 (tuktuk / scooter / taxi 추가 가중치)
export const THEMES = [
  {
    code: 'ID', drive: 'L', country: 'Indonesia', city: 'Jakarta', welcome: 'SELAMAT DATANG DI JAKARTA',
    building: { ruko: 1 }, tree: 'palm', curb: 'warung', landmark: 'monas',
    tint: 0xffe0b0, tintAmt: 0.08, traffic: { scooter: 0.12 },
  },
  {
    code: 'VN', drive: 'R', country: 'Vietnam', city: 'Hanoi', welcome: 'CHAO MUNG DEN HA NOI',
    building: { tube: 0.8, ruko: 0.2 }, tree: 'palm', curb: 'tent', landmark: 'pagoda',
    tint: 0xffc59a, tintAmt: 0.12, traffic: { scooter: 0.35 },
  },
  {
    code: 'TH', drive: 'L', country: 'Thailand', city: 'Bangkok', welcome: 'WELCOME TO BANGKOK',
    building: { ruko: 0.5, neon: 0.5 }, tree: 'palm', curb: 'warung', landmark: 'temple',
    tint: 0xffb6e6, tintAmt: 0.12, traffic: { tuktuk: 0.25, scooter: 0.1 },
  },
  {
    code: 'KR', drive: 'R', country: 'South Korea', city: 'Seoul', welcome: 'WELCOME TO SEOUL',
    building: { neon: 0.75, modern: 0.25 }, tree: 'ginkgo', curb: 'tent', landmark: 'namsan',
    tint: 0xa9b8ff, tintAmt: 0.12, traffic: {},
  },
  {
    code: 'JP', drive: 'L', country: 'Japan', city: 'Tokyo', welcome: 'WELCOME TO TOKYO',
    building: { neon: 0.85, modern: 0.15 }, tree: 'sakura', curb: 'vending', landmark: 'tokyotower',
    tint: 0xffb3d1, tintAmt: 0.14, traffic: {},
  },
  {
    code: 'SG', drive: 'L', country: 'Singapore', city: 'Marina Bay', welcome: 'WELCOME TO SINGAPORE',
    building: { modern: 1 }, tree: 'palm', curb: 'planter', landmark: 'mbs',
    tint: 0xb8fff0, tintAmt: 0.1, traffic: {},
  },
  {
    code: 'US', drive: 'R', country: 'USA', city: 'New York', welcome: 'WELCOME TO NEW YORK',
    building: { brick: 0.8, modern: 0.2 }, tree: 'round', curb: 'cafe', landmark: 'empire',
    tint: 0xffd6a5, tintAmt: 0.08, traffic: { taxi: 0.35 },
  },
  {
    code: 'FR', drive: 'R', country: 'France', city: 'Paris', welcome: 'BIENVENUE A PARIS',
    building: { haussmann: 1 }, tree: 'round', curb: 'cafe', landmark: 'eiffel',
    tint: 0xd7e3ff, tintAmt: 0.1, traffic: {},
  },
];

export const themeIndexAt = (distance) => Math.floor(Math.max(0, distance) / ZONE_LENGTH) % THEMES.length;
export const themeAt = (distance) => THEMES[themeIndexAt(distance)];
// 통행 방향: +1 = 우측통행(한국·베트남·미국·프랑스), -1 = 좌측통행(인도네시아·태국·일본·싱가포르)
export const driveSign = (distance) => (themeAt(distance).drive === 'L' ? -1 : 1);

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

// ---------- 국기: 실제 국기 이미지 (assets/flags/XX.svg, country-flag-icons 3:2, MIT)
// 직접 그린 근사 국기는 쓰지 않음. 이미지가 없거나 로딩 중이면 국가 코드가 적힌 중립 배지를 보여줌
const FLAG_DIR = 'assets/flags/';
export const flagUrl = (code) => `${FLAG_DIR}${code}.svg`;
const flagImgs = {};
function flagImage(code) {
  if (!isCountryCode(code)) return null;
  let e = flagImgs[code];
  if (!e) {
    const img = new Image();
    e = flagImgs[code] = { img, ready: false, failed: false, waiters: [] };
    img.onload = () => {
      e.ready = true;
      for (const fn of e.waiters.splice(0)) fn();
    };
    img.onerror = () => {
      e.failed = true;
      e.waiters.length = 0;
    };
    img.src = flagUrl(code);
  }
  return e;
}
// 자주 쓰는 국기를 미리 불러 둠 (3D 텍스처가 바로 그려지도록)
export function preloadFlags(codes) {
  for (const c of codes) flagImage(c);
}

function flagPlaceholder(x, code, w, h, ox, oy) {
  x.save();
  x.fillStyle = '#2b2d42';
  x.fillRect(ox, oy, w, h);
  x.fillStyle = '#ffffff';
  x.font = `bold ${Math.round(h * 0.45)}px "Russo One", "Arial Black", sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(String(code || '?').slice(0, 2), ox + w / 2, oy + h * 0.53);
  x.restore();
}

// ctx 의 (ox, oy, w, h) 영역에 국기를 그림. 아직 로딩 중이면 배지를 그려 두고, 로딩되면 다시 그린 뒤 onReady() 호출
export function drawFlag(ctx, code, w, h, ox = 0, oy = 0, onReady = null) {
  const e = flagImage(code);
  if (e && e.ready) {
    ctx.drawImage(e.img, ox, oy, w, h);
    return true;
  }
  flagPlaceholder(ctx, code, w, h, ox, oy);
  if (e && !e.failed) {
    e.waiters.push(() => {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(e.img, ox, oy, w, h);
      ctx.restore();
      if (onReady) onReady();
    });
  }
  return false;
}

// 국가대표 바이크 도색 [차체, 포인트] — 국기 대표색
const LIVERY = {
  ID: [0xce1126, 0xffffff], VN: [0xda251d, 0xffcd00], TH: [0x2d2a4a, 0xa51931], KR: [0xf4f4f4, 0xcd2e3a],
  JP: [0xf4f4f4, 0xbc002d], SG: [0xef3340, 0xffffff], US: [0x3c3b6e, 0xb22234], FR: [0x0055a4, 0xef4135],
  MY: [0x010066, 0xffcc00], PH: [0x0038a8, 0xce1126], CN: [0xde2910, 0xffde00], IN: [0xff9933, 0x138808],
  GB: [0x012169, 0xc8102e], DE: [0x111111, 0xffce00], IT: [0x009246, 0xce2b37], ES: [0xaa151b, 0xf1bf00],
  NL: [0x21468b, 0xae1c28], CA: [0xd52b1e, 0xffffff], RU: [0x0039a6, 0xd52b1e], UA: [0x0057b7, 0xffd700],
  PL: [0xdc143c, 0xffffff],
};
export const nationalLivery = (code) => LIVERY[code] || [0x00b14f, 0xffd700];

// 랭킹 등 DOM 에서 쓰는 국기 배지 (이미지 파일 그대로)
export function flagBadge(code, cls = 'flag') {
  if (!isCountryCode(code)) return '';
  return `<img class="${cls}" src="${flagUrl(code)}" alt="${code}" title="${code}" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
