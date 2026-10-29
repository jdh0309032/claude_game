// 저장 데이터(코인, 랭킹, 바이크, 미션, 설정) — localStorage 기반
const KEY = 'motorush.save.v1';

export const BIKES = [
  { id: 'rookie',  name: '루키 125',    price: 0,     maxKmh: 170, accel: 1.0,  handling: 1.0,  color: 0xe63946, desc: '입문용 경량 바이크' },
  { id: 'street',  name: '스트리트 400', price: 600,   maxKmh: 200, accel: 1.1,  handling: 1.12, color: 0x2a9df4, desc: '균형 잡힌 도심형' },
  { id: 'racer',   name: '레이서 R6',    price: 2000,  maxKmh: 235, accel: 1.25, handling: 1.25, color: 0x2ec27e, desc: '날카로운 코너링' },
  { id: 'hyper',   name: '하이퍼 1000',  price: 5000,  maxKmh: 270, accel: 1.4,  handling: 1.38, color: 0xffb703, desc: '압도적인 최고속도' },
  { id: 'phantom', name: '팬텀 X',      price: 12000, maxKmh: 300, accel: 1.6,  handling: 1.55, color: 0x9b5de5, desc: '전설의 하이퍼바이크' },
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
};

function defaults() {
  return {
    coins: 0,
    best: 0,
    ranking: [],
    ownedBikes: ['rookie'],
    bike: 'rookie',
    lastName: '',
    lastDaily: '',
    lastRankId: 0,
    missions: [],
    missionLevels: {},
    settings: { sound: true, vibrate: true, quality: 'high', touchMode: 'zones' },
    stats: { runs: 0, totalDist: 0, totalNear: 0 },
  };
}

function load() {
  const def = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw);
      return {
        ...def,
        ...d,
        settings: { ...def.settings, ...(d.settings || {}) },
        stats: { ...def.stats, ...(d.stats || {}) },
        missionLevels: { ...(d.missionLevels || {}) },
      };
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
