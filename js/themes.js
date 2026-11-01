// 구간별 글로벌 국가/도시 테마 + 국기 그리기 + 지역(랭킹) 추정
export const ZONE_LENGTH = 1000; // 매 1,000m 마다 다음 나라로

// building: ruko | tube | neon | modern | brick | haussmann | peranakan | colonial | teak (models.js buildingStyle)
// tree: palm | sakura | ginkgo | round | raintree | frangipani
// curb: warung | vending | cafe | tent | planter | mamak | sarisari | juicecart | teashop
// overhead: 도로 위 축제 장식 (lanterns | bunting_ph | bunting_my | bunting_id | flags_th | flags_kh | flags_mm), 없으면 ''
// drive: 'L' 좌측통행 / 'R' 우측통행
// traffic: 특수 차량 비율 (tuktuk / scooter / taxi / jeepney / doubledecker / angkot / songthaew / tricycle / remork / trishaw)
// colors: 나라별 차량 색 (taxi / bus / car / 특수 차량 이름별 팔레트)
// 동남아 8개국(SG MY ID TH VN PH KH MM)만 주행. 한국·일본·미국·프랑스 맵은 archive/world_themes.js 에 보관 (스폰 안 함)
export const THEMES = [
  {
    code: 'SG', drive: 'L', country: 'Singapore', city: 'Marina Bay', welcome: 'WELCOME TO SINGAPORE',
    building: { modern: 0.55, peranakan: 0.45 }, tree: 'raintree', curb: 'planter', landmark: 'mbs', overhead: '',
    tint: 0xb8fff0, tintAmt: 0.1, traffic: { taxi: 0.2, doubledecker: 0.12 },
    colors: { taxi: [0x1e6fd9, 0xffd400, 0xd9dde1], bus: [0x6a2c91, 0xd62828], doubledecker: [0x6a2c91, 0xd62828, 0xf4f4f4], car: [0xf4f4f4, 0xbfc5ca, 0x151515, 0x2a3d55, 0x8d99ae] },
  },
  {
    code: 'MY', drive: 'L', country: 'Malaysia', city: 'Kuala Lumpur', welcome: 'SELAMAT DATANG KE KUALA LUMPUR',
    building: { peranakan: 0.5, modern: 0.3, ruko: 0.2 }, tree: 'palm', curb: 'mamak', landmark: 'petronas', overhead: 'bunting_my',
    tint: 0xfff0b0, tintAmt: 0.1, traffic: { scooter: 0.12, taxi: 0.1 },
    colors: { taxi: [0xc8102e, 0xf4f4f4], bus: [0xd62828, 0x0057b8], car: [0xf4f4f4, 0xc8102e, 0xbfc5ca, 0x151515, 0x2a9df4] },
  },
  {
    code: 'ID', drive: 'L', country: 'Indonesia', city: 'Jakarta', welcome: 'SELAMAT DATANG DI JAKARTA',
    building: { ruko: 0.8, modern: 0.2 }, tree: 'palm', curb: 'warung', landmark: 'monas', overhead: 'bunting_id',
    tint: 0xffe0b0, tintAmt: 0.08, traffic: { scooter: 0.22, tuktuk: 0.06, angkot: 0.14 },
    colors: { taxi: [0x2a7fd4], tuktuk: [0x2a6fd4], angkot: [0x2a9df4, 0x2ec27e, 0xe63946, 0xf2c230], bus: [0xe76f51, 0x2a6fd4], car: [0xf4f4f4, 0x151515, 0xbfc5ca, 0x8d99ae, 0xd62828] },
  },
  {
    code: 'TH', drive: 'L', country: 'Thailand', city: 'Bangkok', welcome: 'SAWASDEE! WELCOME TO BANGKOK',
    building: { ruko: 0.45, neon: 0.4, colonial: 0.15 }, tree: 'frangipani', curb: 'warung', landmark: 'temple', overhead: 'flags_th',
    tint: 0xffb6e6, tintAmt: 0.12, traffic: { tuktuk: 0.25, songthaew: 0.12, scooter: 0.08, taxi: 0.12 },
    colors: { taxi: [0xff4fa3, 0x7ac943, 0xff8c1a, 0x2a9df4], tuktuk: [0x1d3557, 0x2a9d8f, 0xe63946], songthaew: [0xc1121f, 0x2a6fd4, 0xf2c230], bus: [0xd62828, 0x1d6fd8], car: [0xf4f4f4, 0x151515, 0xbfc5ca, 0x1d3557] },
  },
  {
    code: 'VN', drive: 'R', country: 'Vietnam', city: 'Hanoi', welcome: 'CHAO MUNG DEN HA NOI',
    building: { tube: 0.8, ruko: 0.2 }, tree: 'palm', curb: 'tent', landmark: 'pagoda', overhead: 'lanterns',
    tint: 0xffc59a, tintAmt: 0.12, traffic: { scooter: 0.45, taxi: 0.08 },
    colors: { taxi: [0x2ec27e, 0xf4f4f4], bus: [0xf2c230, 0x2ec27e], car: [0xf4f4f4, 0xbfc5ca, 0x151515, 0xd62828] },
  },
  {
    code: 'PH', drive: 'R', country: 'Philippines', city: 'Manila', welcome: 'MABUHAY! WELCOME TO MANILA',
    building: { ruko: 0.45, colonial: 0.3, neon: 0.25 }, tree: 'palm', curb: 'sarisari', landmark: 'mayon', overhead: 'bunting_ph',
    tint: 0xbfe3ff, tintAmt: 0.1, traffic: { jeepney: 0.3, tricycle: 0.15 },
    colors: { taxi: [0xf4f4f4], jeepney: [0x2a9df4, 0xe63946, 0x2ec27e, 0xd9dde1, 0xffd60a], tricycle: [0xe63946, 0x2a9df4, 0xffd60a, 0x2ec27e], bus: [0x2a9df4, 0xe63946], car: [0xf4f4f4, 0x151515, 0xbfc5ca, 0x8d99ae] },
  },
  {
    code: 'KH', drive: 'R', country: 'Cambodia', city: 'Siem Reap', welcome: 'SOUR SDEY! WELCOME TO SIEM REAP',
    building: { teak: 0.65, ruko: 0.35 }, tree: 'frangipani', curb: 'juicecart', landmark: 'angkor', overhead: 'flags_kh',
    tint: 0xffd59a, tintAmt: 0.12, traffic: { remork: 0.3, scooter: 0.15 },
    colors: { taxi: [0x1d3557], remork: [0x1d3557, 0x7a1f2b, 0x2a9d8f], bus: [0x2a9d8f, 0xf2c230], car: [0xf4f4f4, 0x151515, 0xbfc5ca, 0x7f5539] },
  },
  {
    code: 'MM', drive: 'R', country: 'Myanmar', city: 'Yangon', welcome: 'MINGALABA! WELCOME TO YANGON',
    building: { colonial: 0.6, teak: 0.4 }, tree: 'raintree', curb: 'teashop', landmark: 'shwedagon', overhead: 'flags_mm',
    tint: 0xffe7a3, tintAmt: 0.12, traffic: { trishaw: 0.12, taxi: 0.2, bus: 0.1 },
    colors: { taxi: [0xe0e0e0, 0xf4f4f4], trishaw: [0x1d3557, 0x2a9d8f, 0x7a1f2b], bus: [0x1e6fd9, 0xf4f4f4], car: [0xf4f4f4, 0xbfc5ca, 0x151515, 0x8d99ae] },
  },
];

// 판마다 시작 국가·국가 순서를 시드로 섞음 (챌린지 링크는 같은 시드 → 같은 순서)
let ORDER = THEMES.map((_, i) => i);
export function setThemeOrder(seed) {
  let t = (seed ^ 0x51ed270b) >>> 0;
  const rnd = () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  ORDER = THEMES.map((_, i) => i);
  for (let i = ORDER.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [ORDER[i], ORDER[j]] = [ORDER[j], ORDER[i]];
  }
}
export const themeOrder = () => ORDER.slice();
export const themeIndexAt = (distance) => ORDER[Math.floor(Math.max(0, distance) / ZONE_LENGTH) % ORDER.length];
export const themeAt = (distance) => THEMES[themeIndexAt(distance)];
// 통행 방향: +1 = 우측통행(베트남·필리핀·캄보디아·미얀마), -1 = 좌측통행(싱가포르·말레이시아·인도네시아·태국)
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
  PL: [0xdc143c, 0xffffff], KH: [0x032ea1, 0xe00025], MM: [0xfecb00, 0x34b233],
};
export const nationalLivery = (code) => LIVERY[code] || [0x00b14f, 0xffd700];

// 랭킹 등 DOM 에서 쓰는 국기 배지 (이미지 파일 그대로)
export function flagBadge(code, cls = 'flag') {
  if (!isCountryCode(code)) return '';
  return `<img class="${cls}" src="${flagUrl(code)}" alt="${code}" title="${code}" loading="lazy" onerror="this.style.visibility='hidden'">`;
}
