// 저장 데이터(코인, 랭킹, 바이크, 커스텀 파츠, 미션, 설정) — localStorage 기반
// + 계정 인증 / 글로벌 랭킹 API (Supabase 설정 시 온라인, 아니면 로컬 모드)
import { SUPABASE_URL, SUPABASE_ANON_KEY, ID_EMAIL_DOMAIN } from './config.js';

const KEY = 'motorush.save.v1';
const SESSION_KEY = 'grabrider.session.v1';
const LOCAL_DB_KEY = 'grabrider.localdb.v1';

export const BIKES = [
  { id: 'rookie',  name: '루키 125',    price: 0,     maxKmh: 170, accel: 1.0,  handling: 1.0,  color: 0xf2f2f2, desc: '신입 라이더의 배달 스쿠터' },
  { id: 'street',  name: '스트리트 400', price: 600,   maxKmh: 200, accel: 1.1,  handling: 1.12, color: 0x2a9df4, desc: '균형 잡힌 도심형' },
  { id: 'racer',   name: '레이서 R6',    price: 2000,  maxKmh: 235, accel: 1.25, handling: 1.25, color: 0x2ec27e, desc: '날카로운 코너링' },
  { id: 'hyper',   name: '하이퍼 1000',  price: 5000,  maxKmh: 270, accel: 1.4,  handling: 1.38, color: 0xffb703, desc: '압도적인 최고속도' },
  { id: 'phantom', name: '팬텀 X',      price: 12000, maxKmh: 300, accel: 1.6,  handling: 1.55, color: 0x9b5de5, desc: '전설의 하이퍼바이크' },
];

// 차고 커스텀 파츠 (모델 모양은 models.js 의 *_STYLES 와 id 로 매칭)
export const BOXES = [
  { id: 'basic',     name: '기본 배달 상자', price: 0,    icon: '🟩', desc: '그린 컬러 기본 상자' },
  { id: 'styrofoam', name: '스티로폼 박스', price: 300,  icon: '⬜', desc: '신선식품 배달 전용' },
  { id: 'neon',      name: '네온 박스',     price: 1500, icon: '🟦', desc: '밤에 빛나는 네온 라인' },
  { id: 'treasure',  name: '보물상자',      price: 4000, icon: '🧰', desc: '황금 장식 나무 상자' },
];
export const OUTFITS = [
  { id: 'jacket',     name: '라이더 재킷',  price: 0,    icon: '🧥', desc: '그린 라이더 재킷' },
  { id: 'raincoat',   name: '옐로 우비',    price: 500,  icon: '🟨', desc: '스콜에도 끄떡없는 판초 우비' },
  { id: 'raincoat_p', name: '핑크 우비',    price: 800,  icon: '🩷', desc: '눈에 띄는 핑크 판초' },
];
export const HELMETS = [
  { id: 'basic', name: '그린 헬멧',   price: 0,    icon: '🟢', desc: '기본 하프 헬멧' },
  { id: 'full',  name: '풀페이스',    price: 700,  icon: '⚫', desc: '블루 미러 바이저' },
  { id: 'retro', name: '레트로',      price: 1200, icon: '⚪', desc: '레드 스트라이프 클래식' },
  { id: 'gold',  name: '골드 헬멧',   price: 6000, icon: '🟡', desc: '랭커의 상징' },
];

export const MISSION_DEFS = {
  near:     { label: (n) => `한 판에 니어미스 ${n}회`,          targets: [5, 10, 20, 35, 50, 80] },
  dist:     { label: (n) => `한 판에 ${n.toLocaleString()}m 주행`, targets: [1000, 2500, 5000, 8000, 12000, 20000] },
  score:    { label: (n) => `한 판에 ${n.toLocaleString()}점 달성`, targets: [3000, 10000, 25000, 50000, 100000, 200000] },
  coins:    { label: (n) => `한 판에 코인 ${n}개 획득`,          targets: [10, 25, 50, 80, 120, 200] },
  oncoming: { label: (n) => `역주행 차선에서 ${n.toLocaleString()}m 달리기`, targets: [200, 500, 1000, 2000, 3500, 5000] },
  boost:    { label: (n) => `니트로 ${n}회 사용`,               targets: [1, 2, 3, 5, 7, 10] },
  combo:    { label: (n) => `니어미스 콤보 x${n} 달성`,          targets: [3, 5, 8, 12, 16, 20] },
  speed:    { label: (n) => `최고속도 ${n}km/h 돌파`,            targets: [120, 150, 180, 210, 240, 280] },
  smash:    { label: (n) => `니트로로 차량 ${n}대 날려버리기`,     targets: [1, 3, 5, 10, 15, 25] },
  jump:     { label: (n) => `견인트럭 경사판 점프 ${n}회`,         targets: [1, 2, 3, 5, 8, 12] },
};

function defaults() {
  return {
    coins: 0,
    best: 0,
    ranking: [],
    ownedBikes: ['rookie'],
    bike: 'rookie',
    ownedBoxes: ['basic'],
    box: 'basic',
    ownedOutfits: ['jacket'],
    outfit: 'jacket',
    ownedHelmets: ['basic'],
    helmet: 'basic',
    lastName: '',
    lastDaily: '',
    lastRankId: 0,
    missions: [],
    missionLevels: {},
    settings: { sound: true, vibrate: true, quality: 'high', touchMode: 'buttons', throttle: 'auto' },
    stats: { runs: 0, totalDist: 0, totalNear: 0 },
  };
}

function load() {
  const def = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const merged = {
        ...def,
        ...d,
        settings: { ...def.settings, ...(d.settings || {}) },
        stats: { ...def.stats, ...(d.stats || {}) },
        missionLevels: { ...(d.missionLevels || {}) },
      };
      if (merged.settings.touchMode === 'zones') merged.settings.touchMode = 'buttons';
      return merged;
    }
  } catch (e) { /* 저장소 사용 불가 시 기본값 */ }
  return def;
}

export const save = load();

export function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (e) { /* ignore */ }
}

export function resetSave() {
  const def = defaults();
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, def);
  ensureMissions();
  persist();
}

export function getBike(id) {
  return BIKES.find((b) => b.id === id) || BIKES[0];
}

// ---------- 랭킹
export function qualifies(score) {
  if (score <= 0) return false;
  return save.ranking.length < 10 || score > save.ranking[save.ranking.length - 1].score;
}

export function sortRanking() {
  save.ranking.sort((a, b) => b.score - a.score);
  save.ranking = save.ranking.slice(0, 10);
}

export function addRanking(entry) {
  entry.id = Date.now();
  save.ranking.push(entry);
  sortRanking();
  save.lastRankId = entry.id;
  persist();
  return save.ranking.indexOf(entry) + 1;
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
  return { type, lvl, target, reward: 40 + lvl * 40, done: false };
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
// 계정 인증 & 글로벌 랭킹
// ======================================================================
export const ONLINE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const ID_RULE = /^[a-z0-9_]{3,12}$/;

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (e) { return fallback; }
}
function writeJSON(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* ignore */ }
}

let session = readJSON(SESSION_KEY, null);
export const getSession = () => session;
function setSession(s) {
  session = s;
  if (s) writeJSON(SESSION_KEY, s);
  else try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
}

async function hashPassword(pw, salt) {
  const data = new TextEncoder().encode(salt + ':' + pw);
  if (globalThis.crypto && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // 보안 컨텍스트가 아닐 때(http://사설IP 등) 대체 해시 — 로컬 모드 전용
  let h = 2166136261;
  for (const b of data) h = Math.imul(h ^ b, 16777619);
  return (h >>> 0).toString(16);
}
const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// ---------- Supabase REST
async function sb(path, { method = 'GET', body, auth = false, headers = {} } = {}) {
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json', ...headers };
  if (auth && session?.token) h.Authorization = `Bearer ${session.token}`;
  const res = await fetch(SUPABASE_URL + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
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
  if (!ONLINE || !session || session.mode !== 'online') return;
  if (Date.now() < session.expiresAt - 60000) return;
  const t = await sb('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refresh } });
  setSession(sessionFromToken(t, session.id));
}

// ---------- 로컬 모드 DB (이 브라우저 안에서만 공유)
const localDB = () => readJSON(LOCAL_DB_KEY, { users: {}, board: {} });

const friendly = (e) => {
  const m = String(e?.message || e);
  if (/already registered|already exists/i.test(m)) return '이미 사용 중인 아이디입니다';
  if (/invalid login|invalid credentials/i.test(m)) return '아이디 또는 비밀번호가 올바르지 않습니다';
  if (/failed to fetch|network/i.test(m)) return '서버에 연결할 수 없습니다';
  return m;
};

export const auth = {
  validate(id, pw) {
    if (!ID_RULE.test(id)) return '아이디는 영문 소문자/숫자/_ 3~12자로 입력하세요';
    if (!pw || pw.length < 6) return '비밀번호는 6자 이상이어야 합니다';
    return null;
  },

  async signUp(id, pw) {
    id = id.trim().toLowerCase();
    const err = this.validate(id, pw);
    if (err) return { ok: false, error: err };
    try {
      if (ONLINE) {
        const t = await sb('/auth/v1/signup', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw, data: { nickname: id } } });
        if (!t.access_token) return { ok: false, error: 'Supabase 이메일 확인(Confirm email)을 꺼주세요' };
        setSession(sessionFromToken(t, id));
      } else {
        const db = localDB();
        if (db.users[id]) return { ok: false, error: '이미 사용 중인 아이디입니다' };
        const salt = randomToken();
        db.users[id] = { salt, hash: await hashPassword(pw, salt), created: Date.now() };
        writeJSON(LOCAL_DB_KEY, db);
        setSession({ mode: 'local', id, nickname: id, token: randomToken() });
      }
      return { ok: true, user: session };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },

  async signIn(id, pw) {
    id = id.trim().toLowerCase();
    if (!id || !pw) return { ok: false, error: '아이디와 비밀번호를 입력하세요' };
    try {
      if (ONLINE) {
        const t = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw } });
        setSession(sessionFromToken(t, id));
      } else {
        const u = localDB().users[id];
        if (!u || (await hashPassword(pw, u.salt)) !== u.hash) return { ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다' };
        setSession({ mode: 'local', id, nickname: id, token: randomToken() });
      }
      return { ok: true, user: session };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },

  // 앱 시작 시 저장된 토큰으로 자동 로그인
  async restore() {
    if (!session) return null;
    try {
      if (session.mode === 'online') {
        if (!ONLINE) { setSession(null); return null; }
        await ensureFreshToken();
      } else if (!localDB().users[session.id]) {
        setSession(null);
        return null;
      }
      return session;
    } catch (e) {
      if (e.status === 400 || e.status === 401) setSession(null);
      return session;
    }
  },

  signOut() {
    if (ONLINE && session?.mode === 'online') sb('/auth/v1/logout', { method: 'POST', auth: true }).catch(() => {});
    setSession(null);
  },
};

export const leaderboard = {
  // 게임 오버 시 최고 점수 전송 (서버/로컬 모두 본인 최고점만 유지)
  async submit(score, bike) {
    if (!session) return { ok: false, error: '로그인이 필요합니다' };
    score = Math.floor(score);
    try {
      if (session.mode === 'online') {
        await ensureFreshToken();
        const best = await sb('/rest/v1/rpc/submit_score', { method: 'POST', auth: true, body: { p_score: score, p_bike: bike, p_nickname: session.nickname } });
        return { ok: true, best };
      }
      const db = localDB();
      const cur = db.board[session.id];
      if (!cur || score > cur.score) db.board[session.id] = { nickname: session.nickname, score, bike, updatedAt: Date.now() };
      writeJSON(LOCAL_DB_KEY, db);
      return { ok: true, best: db.board[session.id].score };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },

  // TOP 10 + 내 순위
  async fetchTop() {
    try {
      if (ONLINE) {
        const top = await sb('/rest/v1/leaderboard?select=user_id,nickname,score,bike&order=score.desc&limit=10');
        let me = null;
        if (session?.mode === 'online') {
          await ensureFreshToken();
          const r = await sb('/rest/v1/rpc/my_rank', { method: 'POST', auth: true, body: {} });
          if (r && r[0]) me = { rank: Number(r[0].rank), score: r[0].score, nickname: session.nickname };
        }
        return { ok: true, online: true, top: top.map((t) => ({ ...t, isMe: t.user_id === session?.userId })), me };
      }
      const all = Object.entries(localDB().board)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => b.score - a.score);
      const idx = session ? all.findIndex((r) => r.id === session.id) : -1;
      return {
        ok: true,
        online: false,
        top: all.slice(0, 10).map((r) => ({ ...r, isMe: r.id === session?.id })),
        me: idx >= 0 ? { rank: idx + 1, score: all[idx].score, nickname: all[idx].nickname } : null,
      };
    } catch (e) {
      return { ok: false, error: friendly(e) };
    }
  },
};
