// 저장 데이터(코인, 랭킹, 바이크, 커스텀 파츠, 미션, 설정) — localStorage 기반
// + 계정 인증 / 글로벌 랭킹 API (Supabase 설정 시 온라인, 아니면 로컬 모드)
import { SUPABASE_URL, SUPABASE_ANON_KEY, ID_EMAIL_DOMAIN } from './config.js';

const KEY = 'motorush.save.v1';
const SESSION_KEY = 'grabrider.session.v1';
const LOCAL_DB_KEY = 'grabrider.localdb.v1';

// 상점 가격표는 config.js 에서 관리
export { BIKES, BOXES, OUTFITS, HELMETS } from './config.js';
import { BIKES } from './config.js';
import { guessRegion } from './themes.js';

// 이전 버전 바이크 id → 새 라인업으로 이전
const LEGACY_BIKES = { street: 'city', racer: 'sport', hyper: 'phantom' };

export const MISSION_DEFS = {
  near:     { label: (n) => `Get ${n} near misses in one run`,          targets: [5, 10, 20, 35, 50, 80] },
  dist:     { label: (n) => `Ride ${n.toLocaleString()} m in one run`, targets: [1000, 2500, 5000, 8000, 12000, 20000] },
  score:    { label: (n) => `Score ${n.toLocaleString()} in one run`, targets: [3000, 10000, 25000, 50000, 100000, 200000] },
  coins:    { label: (n) => `Collect ${n} coins in one run`,          targets: [10, 25, 50, 80, 120, 200] },
  oncoming: { label: (n) => `Ride ${n.toLocaleString()} m in the wrong way lane`, targets: [200, 500, 1000, 2000, 3500, 5000] },
  boost:    { label: (n) => `Fire nitro ${n} times`,               targets: [1, 2, 3, 5, 7, 10] },
  combo:    { label: (n) => `Reach a x${n} near-miss combo`,          targets: [3, 5, 8, 12, 16, 20] },
  speed:    { label: (n) => `Hit ${n} KM/H`,            targets: [120, 150, 180, 210, 240, 280] },
  smash:    { label: (n) => `Smash ${n} cars with nitro`,     targets: [1, 3, 5, 10, 15, 25] },
  jump:     { label: (n) => `Air jump off ${n} ramp trucks`,         targets: [1, 2, 3, 5, 8, 12] },
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
    region: guessRegion(),
    bestDist: 0,
    streak: 0,
    adCooldownUntil: 0,
    helmet: 'basic',
    lastName: '',
    lastDaily: '',
    lastRankId: 0,
    missions: [],
    missionLevels: {},
    settings: { sound: true, music: true, vibrate: true, quality: 'high', touchMode: 'buttons', throttle: 'auto', wetFx: true },
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
      merged.ownedBikes = [...new Set(merged.ownedBikes.map((id) => LEGACY_BIKES[id] || id))];
      merged.bike = LEGACY_BIKES[merged.bike] || merged.bike;
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
  if (/already registered|already exists/i.test(m)) return 'That ID is already taken';
  if (/invalid login|invalid credentials/i.test(m)) return 'Wrong ID or password';
  if (/failed to fetch|network/i.test(m)) return 'Cannot reach the server';
  if (/rate limit/i.test(m)) return 'Too many attempts, try again later';
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
      if (ONLINE) {
        const t = await sb('/auth/v1/signup', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw, data: { nickname: id } } });
        if (!t.access_token) return { ok: false, error: 'Turn off "Confirm email" in Supabase Auth settings' };
        setSession(sessionFromToken(t, id));
      } else {
        const db = localDB();
        if (db.users[id]) return { ok: false, error: 'That ID is already taken' };
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
    if (!id || !pw) return { ok: false, error: 'Enter your ID and password' };
    try {
      if (ONLINE) {
        const t = await sb('/auth/v1/token?grant_type=password', { method: 'POST', body: { email: `${id}@${ID_EMAIL_DOMAIN}`, password: pw } });
        setSession(sessionFromToken(t, id));
      } else {
        const u = localDB().users[id];
        if (!u || (await hashPassword(pw, u.salt)) !== u.hash) return { ok: false, error: 'Wrong ID or password' };
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

// 새 스키마(supabase/migrations/002_regions_flex.sql) 적용 여부. 없으면 기존 컬럼만 사용
let schemaV2 = true;
const V2_COLS = 'user_id,nickname,score,bike,dist,region,box,outfit,helmet';
const V1_COLS = 'user_id,nickname,score,bike';
const isMissingSchema = (e) => e && (e.status === 400 || e.status === 404) && /column|function|schema cache|does not exist/i.test(e.message);

// entry: { score, dist, bike, box, outfit, helmet, region }
export const leaderboard = {
  // 게임 오버 시 최고 점수 전송 (서버/로컬 모두 본인 최고점만 유지)
  async submit(entry) {
    if (!session) return { ok: false, error: 'Sign in required' };
    const e = { ...entry, score: Math.floor(entry.score), dist: Math.floor(entry.dist || 0) };
    try {
      if (session.mode === 'online') {
        await ensureFreshToken();
        if (schemaV2) {
          try {
            const best = await sb('/rest/v1/rpc/submit_score_v2', {
              method: 'POST', auth: true,
              body: { p_score: e.score, p_dist: e.dist, p_bike: e.bike, p_box: e.box, p_outfit: e.outfit, p_helmet: e.helmet, p_region: e.region, p_nickname: session.nickname },
            });
            return { ok: true, best };
          } catch (err) {
            if (!isMissingSchema(err)) throw err;
            schemaV2 = false;
            console.warn('[leaderboard] v2 schema not found, using v1. Run supabase/migrations/002_regions_flex.sql');
          }
        }
        const best = await sb('/rest/v1/rpc/submit_score', { method: 'POST', auth: true, body: { p_score: e.score, p_bike: e.bike, p_nickname: session.nickname } });
        return { ok: true, best };
      }
      const db = localDB();
      const cur = db.board[session.id];
      if (!cur || e.score > cur.score) db.board[session.id] = { nickname: session.nickname, ...e, updatedAt: Date.now() };
      writeJSON(LOCAL_DB_KEY, db);
      return { ok: true, best: db.board[session.id].score };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },

  // TOP 10 + 내 순위 (region 지정 시 지역 랭킹)
  async fetchTop({ region = null } = {}) {
    try {
      if (ONLINE) {
        const q = (cols) => `/rest/v1/leaderboard?select=${cols}&order=score.desc&limit=10${region ? `&region=eq.${encodeURIComponent(region)}` : ''}`;
        let top;
        try {
          top = await sb(q(schemaV2 ? V2_COLS : V1_COLS));
        } catch (err) {
          if (!isMissingSchema(err)) throw err;
          schemaV2 = false;
          if (region) return { ok: false, error: 'Regional ranking needs the 002 database migration' };
          top = await sb(q(V1_COLS));
        }
        let me = null;
        if (session?.mode === 'online') {
          await ensureFreshToken();
          let r;
          try {
            r = schemaV2
              ? await sb('/rest/v1/rpc/my_rank_v2', { method: 'POST', auth: true, body: { p_region: region } })
              : await sb('/rest/v1/rpc/my_rank', { method: 'POST', auth: true, body: {} });
          } catch (err) {
            if (!isMissingSchema(err)) throw err;
            r = await sb('/rest/v1/rpc/my_rank', { method: 'POST', auth: true, body: {} });
          }
          if (r && r[0]) me = { rank: Number(r[0].rank), score: r[0].score, nickname: session.nickname };
        }
        return { ok: true, online: true, v2: schemaV2, top: top.map((t) => ({ ...t, isMe: t.user_id === session?.userId })), me };
      }
      const all = Object.entries(localDB().board)
        .map(([id, v]) => ({ id, ...v }))
        .filter((r) => !region || r.region === region)
        .sort((a, b) => b.score - a.score);
      const idx = session ? all.findIndex((r) => r.id === session.id) : -1;
      return {
        ok: true,
        online: false,
        v2: true,
        top: all.slice(0, 10).map((r) => ({ ...r, isMe: r.id === session?.id })),
        me: idx >= 0 ? { rank: idx + 1, score: all[idx].score, nickname: all[idx].nickname } : null,
      };
    } catch (err) {
      return { ok: false, error: friendly(err) };
    }
  },
};
