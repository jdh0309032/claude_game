// 플레이어 데이터(코인, 보유 아이템, 최고 기록, 미션, 설정) — Supabase 서버 저장
// 기기에는 로그인 토큰만 보관하고, 게임 데이터는 localStorage 에 저장하지 않습니다.
// 게스트(비로그인)는 메모리에서만 플레이하며 새로고침하면 진행이 사라집니다.
import { SUPABASE_URL, SUPABASE_ANON_KEY, ID_EMAIL_DOMAIN, GEO_IP_ENDPOINTS } from './config.js';

// 로그인 유지용 토큰 (게임 데이터 아님)
const SESSION_KEY = 'grabrider.session.v1';
// 이전 버전이 기기에 남긴 게임 데이터 키 — 읽지 않고 지움
const LEGACY_KEYS = ['motorush.save.v1', 'grabrider.localdb.v1'];

// 상점 가격표는 config.js 에서 관리
export { BIKES, BOXES, OUTFITS, HELMETS, PAINTS } from './config.js';
import { BIKES, BOXES, OUTFITS, HELMETS, PAINTS, BOOSTS, ECON, ADS } from './config.js';
import { guessRegion, isCountryCode } from './themes.js';
import { t } from './i18n.js';

// 이전 버전 바이크 id → 새 라인업으로 이전
const LEGACY_BIKES = { street: 'city', racer: 'sport', hyper: 'phantom' };

export const MISSION_DEFS = {
  near:     { label: (n) => t('Get {n} near misses in one run', { n }),          targets: [5, 10, 20, 35, 50, 80] },
  dist:     { label: (n) => t('Ride {n} m in one run', { n: n.toLocaleString() }), targets: [1000, 2500, 5000, 8000, 12000, 20000] },
  score:    { label: (n) => t('Score {n} in one run', { n: n.toLocaleString() }), targets: [3000, 10000, 25000, 50000, 100000, 200000] },
  coins:    { label: (n) => t('Collect {n} coins in one run', { n }),          targets: [10, 25, 50, 80, 120, 200] },
  oncoming: { label: (n) => t('Ride {n} m in the wrong way lane', { n: n.toLocaleString() }), targets: [200, 500, 1000, 2000, 3500, 5000] },
  combo:    { label: (n) => t('Reach a x{n} near-miss combo', { n }),          targets: [3, 5, 8, 12, 16, 20] },
  speed:    { label: (n) => t('Hit {n} KM/H', { n }),            targets: [120, 150, 180, 210, 240, 280] },
  smash:    { label: (n) => (n === 1 ? t('Smash a car in Giant Mode') : t('Smash {n} cars in Giant Mode', { n })),     targets: [1, 3, 5, 10, 15, 25] },
  jump:     { label: (n) => (n === 1 ? t('Get airborne off a ramp') : t('Get airborne {n} times off ramps', { n })),      targets: [1, 2, 3, 5, 8, 12] },
};

// 서버(player_data.data)에 저장하는 키
const SERVER_KEYS = [
  'coins', 'best', 'bestDist', 'lastDist', 'noticeSeen', 'ownedBikes', 'bike', 'prevBike', 'ownedBoxes', 'box', 'ownedOutfits', 'outfit',
  'ownedHelmets', 'helmet', 'ownedFlags', 'flag', 'ownedPaints', 'bikePaint', 'helmetPaint', 'prevBox', 'boosts', 'armedBoosts', 'streak', 'lastDaily', 'adCooldownUntil', 'lastName',
  'missions', 'missionLevels', 'settings', 'stats',
];

function defaults() {
  return {
    coins: 0,
    best: 0,
    bestDist: 0,
    lastDist: 0, // 직전 판 거리 (시작 버튼에 RECENT 로 표시)
    noticeSeen: '', // 마지막으로 본 공지 id (새 공지 점 표시용)
    ownedBikes: ['rookie'],
    bike: 'rookie',
    prevBike: 'rookie', // 국가대표 바이크 회수 시 돌아갈 바이크
    ownedBoxes: ['basic'],
    box: 'basic',
    ownedOutfits: ['jacket'],
    outfit: 'jacket',
    ownedHelmets: ['basic'],
    helmet: 'basic',
    ownedFlags: [],
    flag: '', // 장착한 상점 국기 ('' = 없음)
    ownedPaints: [],
    bikePaint: '', // '' = 바이크 기본 색
    helmetPaint: '', // '' = 헤드기어 기본 색
    prevBox: 'basic', // 국가대표 배달통 회수 시 돌아갈 상자
    boosts: {},        // 소모성 부스트 보유 개수 { shield: 2, ... }
    armedBoosts: [],   // 다음 판에 사용할 부스트
    streak: 0,
    lastDaily: '',
    adCooldownUntil: 0,
    lastName: '',
    missions: [],
    missionLevels: {},
    // controls: 'onehand'(기본, 좌우 슬라이드만 · 자동 가속) | 'slide'(슬라이드 + 스로틀/브레이크) | 'arrows'(방향 버튼 + 스로틀/브레이크)
    // flipControls: 조향·페달 좌우 반전 / ctrlVer: 조작 기본값 이전용 버전
    settings: { sound: true, music: true, vibrate: true, quality: 'high', controls: 'onehand', flipControls: false, wetFx: true, ctrlVer: 3, lang: '' }, // lang '' = 영어(기본)
    stats: { runs: 0, totalDist: 0, totalNear: 0 },
    // ---- 아래는 서버 data 에 저장하지 않는 런타임 상태
    country: guessRegion(), // 랭킹 국가 (IP 판별 → 로그인 시 서버에 고정된 값)
    countrySource: 'tz',    // 'tz' 시간대 추정 | 'ip' IP 판별 | 'server' 서버 고정값
    nationalUnlocked: false, // 국가대표 바이크 (서버 순위 검증 결과)
    nationalCode: '',
  };
}

export const save = defaults();

try { for (const k of LEGACY_KEYS) localStorage.removeItem(k); } catch (e) { /* ignore */ }

// 서버 데이터로 save 를 통째로 교체 (없는 키는 기본값)
function applyData(d) {
  const def = defaults();
  const keep = { country: save.country, countrySource: save.countrySource, nationalUnlocked: save.nationalUnlocked, nationalCode: save.nationalCode };
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, def, keep);
  for (const k of SERVER_KEYS) if (d && d[k] !== undefined) save[k] = d[k];
  save.settings = { ...def.settings, ...(d?.settings || {}) };
  save.stats = { ...def.stats, ...(d?.stats || {}) };
  save.missionLevels = { ...(d?.missionLevels || {}) };
  for (const k of ['ownedBikes', 'ownedBoxes', 'ownedOutfits', 'ownedHelmets', 'ownedFlags', 'ownedPaints']) {
    if (!Array.isArray(save[k])) save[k] = def[k];
  }
  if (!save.boosts || typeof save.boosts !== 'object' || Array.isArray(save.boosts)) save.boosts = {};
  if (!Array.isArray(save.armedBoosts)) save.armedBoosts = [];
  // 자석 부스트는 HEAD START 로 바뀜: 이미 산 자석은 같은 개수의 HEAD START 로 옮김
  if (save.boosts.magnet) {
    save.boosts = { ...save.boosts, headstart: (save.boosts.headstart || 0) + save.boosts.magnet };
    delete save.boosts.magnet;
  }
  save.armedBoosts = [...new Set(save.armedBoosts.map((id) => (id === 'magnet' ? 'headstart' : id)))];
  save.ownedBikes = [...new Set(save.ownedBikes.map((id) => LEGACY_BIKES[id] || id))].filter((id) => id !== 'national');
  save.ownedBoxes = save.ownedBoxes.filter((id) => id !== 'national');
  save.bike = LEGACY_BIKES[save.bike] || save.bike;
  // 이전 버전 계정: 조작 기본값을 한 손 조작으로 한 번 전환 (예전 touchMode/oneHand/throttle 키 정리)
  if (d?.settings?.ctrlVer !== 3) {
    save.settings.controls = 'onehand';
    save.settings.ctrlVer = 3;
  }
  if (!['onehand', 'slide', 'arrows'].includes(save.settings.controls)) save.settings.controls = 'onehand';
  for (const k of ['touchMode', 'oneHand', 'throttle']) delete save.settings[k];
  save.coins = Math.max(0, Math.floor(Number(save.coins) || 0));
  ensureMissions();
}

const serverData = () => Object.fromEntries(SERVER_KEYS.map((k) => [k, save[k]]));

// ---------- 서버 동기화
let serverReady = false; // 현재 로그인 계정의 데이터를 서버에서 불러왔는지
let saveTimer = null;
let saving = null;
let saveAgain = false;
export const isServerReady = () => serverReady;
export const syncState = { lastError: '', lastSavedAt: 0 };

// 변경 즉시 서버로 저장 (짧게 묶어서 전송). 게스트·서버 미준비 상태에선 아무것도 안 함
export function persist() {
  if (!serverReady || !session) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => flushSave(), 300);
}

export async function flushSave({ keepalive = false } = {}) {
  clearTimeout(saveTimer);
  if (!serverReady || !session) return false;
  if (saving) {
    saveAgain = true;
    return saving;
  }
  saving = (async () => {
    try {
      await ensureFreshToken();
      await sb('/rest/v1/rpc/save_player_data', { method: 'POST', auth: true, body: { p_data: serverData() }, keepalive });
      syncState.lastError = '';
      syncState.lastSavedAt = Date.now();
      return true;
    } catch (e) {
      syncState.lastError = friendly(e);
      console.warn('[save] failed', e);
      return false;
    } finally {
      saving = null;
      if (saveAgain) {
        saveAgain = false;
        flushSave();
      }
    }
  })();
  return saving;
}

// 로그인 직후 서버 데이터 불러오기. 서버에 데이터가 없으면(새 계정) 지금까지의 게스트 진행을 올림
// 반환: { ok, isAdmin, country, fresh } / 실패 시 { ok: false, error }
export async function loadPlayerData() {
  serverReady = false;
  if (!session) return { ok: false, error: 'Sign in required' };
  try {
    await ensureFreshToken();
    const rows = await sb('/rest/v1/rpc/load_player_data', { method: 'POST', auth: true, body: {} });
    const row = rows && rows[0];
    const empty = !row || !row.data || !Object.keys(row.data).length;
    if (empty) {
      ensureMissions();
    } else {
      applyData(row.data);
    }
    serverReady = true;
    if (empty) await flushSave();
    if (row?.country_code) {
      save.country = row.country_code;
      save.countrySource = 'server';
    }
    return { ok: true, isAdmin: Boolean(row?.is_admin), country: row?.country_code || null, fresh: empty };
  } catch (e) {
    return { ok: false, error: isMissingSchema(e) ? 'Server needs the 004 database migration' : friendly(e) };
  }
}

// 로그아웃: 메모리 데이터를 게스트 기본값으로
export function resetToGuest() {
  serverReady = false;
  clearTimeout(saveTimer);
  applyData({});
  save.nationalUnlocked = false;
  save.nationalCode = '';
}

// 서버(결제 웹훅)가 지급해 둔 코인 받기. 받은 코인 수 반환
export async function claimPendingCoins() {
  if (!serverReady || !session) return 0;
  try {
    await ensureFreshToken();
    const n = Number(await sb('/rest/v1/rpc/claim_pending_coins', { method: 'POST', auth: true, body: {} })) || 0;
    if (n > 0) {
      save.coins += n;
      persist();
      await flushSave();
    }
    return n;
  } catch (e) {
    if (!isMissingSchema(e)) console.warn('[pay] claim failed', e);
    return 0;
  }
}

// ---------- 1:1 문의 (009_ops.sql)
async function rpc(name, body, needAuth = true) {
  if (needAuth) await ensureFreshToken();
  return sb(`/rest/v1/rpc/${name}`, { method: 'POST', auth: needAuth, body });
}
const opsError = (e) => (isMissingSchema(e) ? 'Server needs the 009 database migration' : friendly(e));
export async function submitInquiry({ category, subject, message, lang, appBuild, device }) {
  if (!session) return { ok: false, error: 'Sign in required' };
  try {
    const id = await rpc('submit_inquiry', { p_category: category, p_subject: subject, p_message: message, p_lang: lang, p_app_build: appBuild, p_device: device });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: /too many/i.test(e.message) ? 'Too many inquiries today. Please try again tomorrow.' : opsError(e) };
  }
}
export async function replyInquiry(id, message, lang) {
  try {
    await rpc('reply_my_inquiry', { p_id: id, p_message: message, p_lang: lang });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: /too many/i.test(e.message) ? 'Too many messages. Please wait a while.' : opsError(e) };
  }
}
export async function myInquiries(markRead = false) {
  if (!session || !serverReady) return { ok: true, list: [] };
  try {
    return { ok: true, list: (await rpc('my_inquiries', { p_mark_read: markRead })) || [] };
  } catch (e) {
    return { ok: false, error: opsError(e), list: [] };
  }
}

// ---------- 통계·오류 기록 (실패해도 게임에는 영향 없음)
export function logRun(r) {
  if (!ONLINE) return;
  const body = { p_dist: r.dist | 0, p_score: r.score | 0, p_coins: r.coins | 0, p_duration: r.duration | 0, p_bike: r.bike || '', p_theme: r.theme || '', p_country: r.country || '', p_app_build: r.appBuild || '' };
  (session ? ensureFreshToken() : Promise.resolve())
    .then(() => sb('/rest/v1/rpc/log_run', { method: 'POST', auth: Boolean(session), body, keepalive: true }))
    .catch(() => {});
}
export function logClientError(e) {
  if (!ONLINE) return;
  sb('/rest/v1/rpc/log_client_error', {
    method: 'POST', auth: Boolean(session), keepalive: true,
    body: { p_message: String(e.message || '').slice(0, 500), p_stack: String(e.stack || '').slice(0, 3000), p_source: String(e.source || '').slice(0, 300), p_app_build: e.appBuild || '', p_device: e.device || '' },
  }).catch(() => {});
}

// 계정 삭제 (스토어 필수): 서버의 계정·기록·데이터 삭제 후 게스트로
export async function deleteAccount() {
  if (!session) return { ok: false, error: 'Sign in required' };
  try {
    await ensureFreshToken();
    await sb('/rest/v1/rpc/delete_my_account', { method: 'POST', auth: true, body: {} });
    setSession(null);
    resetToGuest();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: isMissingSchema(e) ? 'Server needs the 007 database migration' : friendly(e) };
  }
}

export function resetSave() {
  applyData({});
  persist();
}

export function getBike(id) {
  return BIKES.find((b) => b.id === id) || BIKES[0];
}

// ---------- 미션
function newMission() {
  const active = new Set(save.missions.map((m) => m.type));
  const types = Object.keys(MISSION_DEFS).filter((t) => !active.has(t));
  const type = types[(Math.random() * types.length) | 0];
  const lvl = save.missionLevels[type] || 0;
  const def = MISSION_DEFS[type];
  const over = Math.max(0, lvl - def.targets.length + 1);
  const target = Math.round(def.targets[Math.min(lvl, def.targets.length - 1)] * (1 + over * 0.5));
  return { type, lvl, target, reward: ECON.missionBase + lvl * ECON.missionStep, done: false };
}

export function ensureMissions() {
  if (!Array.isArray(save.missions)) save.missions = [];
  save.missions = save.missions.filter((m) => MISSION_DEFS[m.type]);
  while (save.missions.length < 3) save.missions.push(newMission());
}

export function replaceDoneMissions() {
  save.missions = save.missions.filter((m) => !m.done);
  ensureMissions();
}

export function missionText(m) {
  return MISSION_DEFS[m.type].label(m.target);
}

ensureMissions();

// ======================================================================
// 계정 인증 & 국가 랭킹 (Supabase)
// ======================================================================
export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const ID_RULE = /^[a-z0-9_]{3,12}$/;

function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
let session = readSession();
if (session && session.mode !== 'online') session = null; // 예전 로컬 모드 계정은 폐지
export const getSession = () => session;
function setSession(s) {
  session = s;
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* ignore */ }
}

// ---------- Supabase REST
async function sb(path, { method = 'GET', body, auth = false, headers = {}, keepalive = false } = {}) {
  if (!ONLINE) throw new Error('No server configured (js/config.js)');
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...headers };
  if (auth && session?.token) h.Authorization = `Bearer ${session.token}`;
  const res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined, keepalive });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = json?.msg || json?.error_description || json?.message || `HTTP ${res.status}`;
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return json;
}

function sessionFromToken(t, id) {
  return {
    mode: 'online', id, nickname: t.user?.user_metadata?.nickname || id, userId: t.user?.id,
    token: t.access_token, refresh: t.refresh_token, expiresAt: Date.now() + (t.expires_in || 3600) * 1000,
  };
}

async function ensureFreshToken() {
  if (!session) return;
  if (Date.now() < session.expiresAt - 60000) return;
  const t = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh } });
  setSession(sessionFromToken(t, session.id));
}

const isMissingSchema = (e) => e && (e.status === 400 || e.status === 404) && /column|function|schema cache|does not exist|relation/i.test(e.message);

const friendly = (e) => {
  const m = String(e?.message || e);
  if (/already registered|already exists/i.test(m)) return 'That ID is already taken';
  if (/invalid login|invalid credentials/i.test(m)) return 'Wrong ID or password';
  if (/failed to fetch|network/i.test(m)) return 'Cannot reach the server';
  if (/rate limit/i.test(m)) return 'Too many attempts, try again later';
  if (/country not locked/i.test(m)) return 'Country not detected yet';
  if (isMissingSchema(e)) return 'Server needs the 004 database migration';
  return m;
};

export const auth = {
  validate(id, pw) {
    if (!ID_RULE.test(id)) return 'ID must be 3-12 lowercase letters, numbers or _';
    if (!pw || pw.length < 6) return 'Password must be at least 6 characters';
    return null;
  },

  async signUp(id, pw) {
    id = id.trim().toLowerCase();
    const err = this.validate(id, pw);
    if (err) return { ok: false, error: err };
    try {
      const t = await sb('/auth/v1/signup', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw, data: { nickname: id } } });
      if (!t.access_token) return { ok: false, error: 'Turn off "Confirm email" in Supabase Auth settings' };
      setSession(sessionFromToken(t, id));
      return { ok: true, user: session };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },

  async signIn(id, pw) {
    id = id.trim().toLowerCase();
    if (!id || !pw) return { ok: false, error: 'Enter your ID and password' };
    try {
      const t = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw } });
      setSession(sessionFromToken(t, id));
      return { ok: true, user: session };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },

  // 앱 시작 시 저장된 토큰으로 자동 로그인
  async restore() {
    if (!session) return null;
    if (!ONLINE) {
      setSession(null);
      return null;
    }
    try {
      await ensureFreshToken();
      return session;
    } catch (e) {
      if (e.status === 400 || e.status === 401) setSession(null);
      return session;
    }
  },

  async signOut() {
    await flushSave();
    if (session) sb('/auth/v1/logout', { method: 'POST', auth: true }).catch(() => {});
    setSession(null);
    resetToGuest();
  },
};

// ---------- 국가 자동 판별 (IP Geolocation → 실패 시 시간대)
async function fetchCountry(ep) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 3500);
  try {
    const res = await fetch(ep.url, { signal: ctl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const code = String(ep.pick(await res.json()) || '').toUpperCase();
    return isCountryCode(code) ? code : null;
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 접속마다 IP 로 판별 (사용자가 직접 바꿀 수 없음). 서버에 고정된 국가가 있으면 그 값이 우선
export async function detectCountry() {
  if (save.countrySource === 'server') return save.country;
  for (const ep of GEO_IP_ENDPOINTS || []) {
    const code = await fetchCountry(ep);
    if (!code) continue;
    save.country = code;
    save.countrySource = 'ip';
    return code;
  }
  return null;
}

// 로그인 계정의 국가를 서버에 고정 (이미 고정돼 있으면 그 값이 돌아옴)
export async function lockCountry() {
  if (!session) return null;
  if (save.countrySource === 'server') return save.country;
  try {
    await ensureFreshToken();
    const cc = await sb('/rest/v1/rpc/lock_country', { method: 'POST', auth: true, body: { p_country: save.country } });
    if (isCountryCode(cc)) {
      save.country = cc;
      save.countrySource = 'server';
    }
    return cc;
  } catch (e) {
    console.warn('[country] lock failed', e);
    return null;
  }
}

// 관리자 전용: 국가 변경 (005 마이그레이션의 admin_set_country, 서버에서 관리자 여부 확인)
export async function adminSetCountry(code) {
  if (!isCountryCode(code)) return { ok: false, error: 'Invalid country' };
  try {
    await ensureFreshToken();
    const cc = await sb('/rest/v1/rpc/admin_set_country', { method: 'POST', auth: true, body: { p_country: code } });
    save.country = cc;
    save.countrySource = 'server';
    return { ok: true, country: cc };
  } catch (e) {
    return { ok: false, error: isMissingSchema(e) ? 'Server needs the 005 database migration' : friendly(e) };
  }
}

// 운영 설정 (008 app_config): 'economy' 로 가격·보상 덮어쓰기. 서버가 없거나 테이블이 없으면 기본값 유지
const PRICE_LISTS = () => ({ bike: BIKES, box: BOXES, outfit: OUTFITS, helmet: HELMETS, paint: PAINTS, boost: BOOSTS });
const ECON_NUM_KEYS = ['coinValue', 'dropReward', 'hotReward', 'kmBonus', 'continueCost', 'gachaPrice', 'gachaRefund', 'missionBase', 'missionStep'];
export function applyEconomy(e) {
  if (!e || typeof e !== 'object') return;
  const num = (v) => (Number.isFinite(v) && v >= 0 && v <= 10000000 ? Math.round(v) : null);
  for (const k of ECON_NUM_KEYS) if (num(e[k]) != null) ECON[k] = num(e[k]);
  if (num(e.freeCoins) != null) ADS.freeCoins = num(e.freeCoins);
  if (num(e.freeCoinsCooldownSec) != null) ADS.freeCoinsCooldownSec = num(e.freeCoinsCooldownSec);
  const lists = PRICE_LISTS();
  for (const [kind, map] of Object.entries(e.prices || {})) {
    const list = lists[kind];
    if (!list || !map || typeof map !== 'object') continue;
    for (const [id, p] of Object.entries(map)) {
      const it = list.find((x) => x.id === id);
      if (it && it.price > 0 && num(p) > 0) it.price = num(p); // 무료·특별 아이템은 건드리지 않음
    }
  }
}
export async function loadAppConfig() {
  if (!ONLINE) return null;
  try {
    const rows = await sb('/rest/v1/app_config?select=key,value');
    const cfg = Object.fromEntries((rows || []).map((r) => [r.key, r.value]));
    applyEconomy(cfg.economy);
    return cfg;
  } catch (e) {
    return null; // 008 마이그레이션 전이거나 오프라인
  }
}

// 전 세계에서 나보다 점수가 높은 기록 수 (PostgREST count)
async function countAbove(score) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leaderboard?select=user_id&score=gt.${Math.floor(score)}`, {
    method: 'HEAD', headers: { apikey: SUPABASE_ANON_KEY, Prefer: 'count=exact', Range: '0-0' },
  });
  const range = res.headers.get('content-range') || '';
  const n = Number(range.split('/')[1]);
  return Number.isFinite(n) ? n : 0;
}

const COLS_V4 = 'user_id,nickname,score,bike,dist,country_code,box,outfit,helmet,flag';
const COLS = `${COLS_V4},look`;
let lookColumn = true;

// entry: { score, dist, bike, box, outfit, helmet, flag }
export const leaderboard = {
  // 게임 오버 시 최고 점수 전송. 국가는 서버에 고정된 값을 사용 (클라이언트가 보내지 않음)
  // admin: true 면 전송 자체를 하지 않음 (서버에서도 관리자 계정은 기록 거부)
  async submit(entry, { admin = false } = {}) {
    if (admin) return { ok: false, skipped: true, error: 'Admin mode: scores are not recorded' };
    if (!session) return { ok: false, error: 'Sign in required' };
    try {
      await ensureFreshToken();
      if (save.countrySource !== 'server') await lockCountry();
      const best = await sb('/rest/v1/rpc/submit_score_v4', {
        method: 'POST', auth: true,
        body: {
          p_score: Math.floor(entry.score), p_dist: Math.floor(entry.dist || 0), p_bike: entry.bike, p_box: entry.box,
          p_outfit: entry.outfit, p_helmet: entry.helmet, p_flag: entry.flag || '', p_nickname: session.nickname,
        },
      });
      if (best === null) return { ok: false, skipped: true, error: 'Admin account: scores are not recorded' };
      return { ok: true, best };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },

  // TOP 10 + 내 순위. world: true 면 전 세계(국가 구분 없이), 아니면 country 국가 리그
  async fetchTop({ country, world = false } = {}) {
    try {
      const where = world ? '' : `&country_code=eq.${encodeURIComponent(country)}`;
      const q = (cols) => `/rest/v1/leaderboard?select=${cols}${where}&score=gt.0&order=score.desc,best_at.asc&limit=10`;
      let top;
      try {
        top = await sb(q(lookColumn ? COLS : COLS_V4));
      } catch (err) {
        // 006 미적용(look 열 없음)이면 look 없이 다시 조회
        if (!lookColumn || !isMissingSchema(err)) throw err;
        lookColumn = false;
        top = await sb(q(COLS_V4));
      }
      let me = null;
      if (session && (world || country === save.country)) {
        try {
          const r = await this.myRank();
          if (r) me = world ? { rank: (await countAbove(r.score)) + 1, score: r.score, country: r.country, world: true, countryRank: r.rank } : r;
          if (me) me.nickname = session.nickname;
        } catch (e) { /* 내 순위만 생략 */ }
      }
      return {
        ok: true, online: true,
        top: top.map((t) => ({ ...t, country: t.country_code, isMe: t.user_id === session?.userId })),
        me,
      };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },

  // 내 장착 상태(바이크·상자·의상·헤드기어·국기·페인트)를 랭킹 행에 바로 반영 (006 의 update_my_look)
  async syncLook(eq) {
    if (!session) return false;
    try {
      await ensureFreshToken();
      await sb('/rest/v1/rpc/update_my_look', {
        method: 'POST', auth: true,
        body: { p_bike: eq.bike, p_box: eq.box, p_outfit: eq.outfit, p_helmet: eq.helmet, p_flag: eq.flag || '', p_look: eq.look || {} },
      });
      return true;
    } catch (e) {
      if (!isMissingSchema(e)) console.warn('[leaderboard] look sync failed', e);
      return false;
    }
  },

  // 내 국가 순위 (서버에 고정된 국가 기준). 기록 없음 → null, 통신 실패 → throw
  async myRank() {
    if (!session) return null;
    await ensureFreshToken();
    const r = await sb('/rest/v1/rpc/my_rank_v4', { method: 'POST', auth: true, body: {} });
    if (!r || !r[0]) return null;
    return { rank: Number(r[0].rank), score: r[0].score, country: r[0].country_code };
  },
};
