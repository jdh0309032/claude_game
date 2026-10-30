import * as THREE from 'three';
import * as M from './models.js';
import { Sound } from './audio.js';
import { net, describeError } from './net.js';
import { icon, hydrateIcons } from './icons.js';
import { ScreenRain } from './rainfx.js';
import {
  THEMES, ZONE_LENGTH, themeAt, themeIndexAt, driveSign, pickWeighted, COUNTRY_CODES, countryName, isCountryCode, flagBadge, nationalLivery, preloadFlags,
} from './themes.js';
import { PreviewStage, renderRiderSnapshot } from './preview.js';
import { showRewarded, adsEnabled } from './ads.js';
import { BILLBOARD_POSTERS, SHARE_BASE_URL, ADS, GACHA_PRICE, GACHA_REFUND, STREAK_REWARDS, STREAK_SPECIAL_HELMET, FLAG_CHECK_INTERVAL_SEC,
  FLAG_SHOP_CODES, FLAG_PRICE_THEME, FLAG_PRICE_OTHER, ADMIN_DEBUG_TOGGLE,
} from './config.js';
import {
  save, persist, resetSave, BIKES, BOXES, OUTFITS, HELMETS, getBike,
  replaceDoneMissions, missionText, auth, leaderboard, getSession, ONLINE, detectCountry,
  loadPlayerData, flushSave, lockCountry, isServerReady, adminSetCountry,
} from './storage.js';

const $ = (id) => document.getElementById(id);
const DEBUG = new URLSearchParams(location.search).has('debug');
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

// ---------- 상수
const LANES = [-5.25, -1.75, 1.75, 5.25]; // 우측통행 국가: 0,1 = 반대 차선 / 2,3 = 같은 방향 (좌측통행 국가는 반대)
const DIVIDERS = [-3.5, 0, 3.5];
const SPAWN_Z = -230;
const ROAD_HALF = 7.5;
const BIKE_HW = 0.34, BIKE_HL = 0.95;
const ROAD_LEN = 420, TILE = 40;
const CONTINUE_COST = 150;
const BOOST_TIME = 4;
const SQUALL_TIME = 30;
const GRAVITY = 16;
const CAR_COLORS = [0xd62828, 0xf77f00, 0x2a9d8f, 0x264653, 0x8d99ae, 0xe9ecef, 0x1d3557, 0x6a4c93, 0x40916c, 0x151515, 0xbfc0c0, 0x7f5539, 0x3a86ff];
const POWER_TYPES = ['shield', 'magnet', 'giant', 'x2', 'slow'];
// 등장 비중: 자석·보호막·거대화 위주
const POWER_WEIGHTS = [0.3, 0.3, 0.22, 0.1, 0.08];
const POWER_LABEL = { shield: 'SHIELD', magnet: 'MAGNET', giant: 'GIANT MODE', x2: 'x2 SCORE', slow: 'SLOW-MO' };
const GIANT_TIME = 6;
// 공중 묘기: 회전 속도(rad/s), 착지 허용 각도(rad), 회전수별 보너스
const AIR_SPIN = 9.5, AIR_FLIP = 9.5, LAND_TOL = 0.5;
const TRICK_BONUS = [200, 500, 1200, 2500];

// ---------- 시드 기반 월드 난수 (PRNG: mulberry32)
// 멀티플레이 시 방장이 만든 시드로 두 기기의 도로/교통/날씨를 동일하게 생성.
// 스폰 종류마다 별도 스트림을 써서 한쪽의 차이가 다른 스폰에 번지지 않게 함
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STREAMS = ['car', 'coin', 'cone', 'power', 'weather', 'puddle', 'stall', 'hazard'];
const W = {};
function seedWorld(seed) {
  STREAMS.forEach((k, i) => { W[k] = mulberry32((seed ^ (i * 0x9e3779b1)) >>> 0); });
}
const wr = (k) => W[k]();
const wrand = (k, a, b) => a + W[k]() * (b - a);
const newSeed = () => (Math.random() * 2 ** 32) >>> 0;
seedWorld(newSeed());

// WhatsApp 챌린지 링크 (?seed=1234) → 같은 도로로 플레이
let challengeSeed = (() => {
  const v = new URLSearchParams(location.search).get('seed');
  return v && /^\d{1,10}$/.test(v) ? Number(v) >>> 0 : null;
})();

const sfx = new Sound();
sfx.setEnabled(save.settings.sound);
sfx.setMusic(save.settings.music);

// ---------- 렌더러/씬
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c6ff);
scene.fog = new THREE.Fog(0x87c6ff, 60, 240);
const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 500);
const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 2.2);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(-40, 60, 30);
scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
function applyQuality() {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, save.settings.quality === 'high' ? 2 : 1));
  resize();
}
window.addEventListener('resize', resize);
applyQuality();

// 화면 빗물 오버레이 (설정에서 끌 수 있음)
const screenRain = new ScreenRain($('rainFx'), canvas);
screenRain.setEnabled(save.settings.wetFx);

// ---------- 게임 상태 (소품 생성 시 참조하므로 먼저 선언)
const G = { state: 'loading', distance: 0 };

// ---------- 도로, 지면, 연석/보도
const roadTex = M.makeRoadTexture(renderer.capabilities.getMaxAnisotropy());
roadTex.repeat.set(1, ROAD_LEN / TILE);
const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
const road = new THREE.Mesh(new THREE.PlaneGeometry(17, ROAD_LEN), roadMat);
road.rotation.x = -Math.PI / 2;
road.position.z = 25 - ROAD_LEN / 2;
scene.add(road);

const grassTex = M.makeGrassTexture();
grassTex.repeat.set(60, ROAD_LEN / 10);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, ROAD_LEN), new THREE.MeshLambertMaterial({ map: grassTex, color: 0xc9c2a0 }));
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.03, 25 - ROAD_LEN / 2);
scene.add(grass);
scene.add(M.createRails(ROAD_LEN, 25 - ROAD_LEN / 2));

// ---------- 스크롤되는 도로변 소품 (인도네시아 도심)
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

// 소품 슬롯: always = 항상 보이는 메시, variants = 슬롯마다 하나만 보이는 변형 그룹 (국가 테마별 스타일)
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);
class PropStrip {
  constructor({ always = [], variants = [], block = null }, count, spacing, respawn) {
    this.always = always;
    this.block = block; // (it) => true 면 이번 프레임에 숨김 (빌보드 아래 가로수/가로등 등)
    this.variants = variants;
    this.span = count * spacing;
    this.respawn = respawn;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = { i, x: 0, z: 25 - i * spacing - Math.random() * spacing * 0.3, sx: 1, sy: 1, sz: 1, ry: 0, hidden: false, variant: 0 };
      respawn(it, i);
      this.items.push(it);
    }
    for (const m of [...always, ...variants.flat()]) {
      m.frustumCulled = false;
      scene.add(m);
    }
    this.update(0);
  }
  update(dz) {
    const items = this.items;
    const fill = this.variants.map(() => 0);
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      it.z += dz;
      if (it.z > 25) {
        it.z -= this.span;
        this.respawn(it, k);
      }
      dummy.position.set(it.x, 0, it.z);
      dummy.rotation.set(0, it.ry, 0);
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      const hide = it.hidden || (this.block !== null && this.block(it));
      const mat = hide ? ZERO_MATRIX : dummy.matrix;
      for (const m of this.always) m.setMatrixAt(k, mat);
      // 변형 메시는 보이는 인스턴스만 앞쪽에 모아 count 로 그림 (숨은 변형 정점 처리 비용 제거)
      if (hide) continue;
      const group = this.variants[it.variant];
      if (!group || !group.length) continue;
      const n = fill[it.variant]++;
      for (const m of group) {
        m.setMatrixAt(n, dummy.matrix);
        if (m.userData.tinted && it.color) m.setColorAt(n, it.color);
      }
    }
    for (const m of this.always) m.instanceMatrix.needsUpdate = true;
    for (let v = 0; v < this.variants.length; v++) {
      for (const m of this.variants[v]) {
        m.count = fill[v];
        m.instanceMatrix.needsUpdate = true;
        if (m.instanceColor) m.instanceColor.needsUpdate = true;
      }
    }
  }
}

// 슬롯이 다시 나타나는 위치(먼 앞쪽)의 실제 주행 거리 → 그 구간의 국가 테마
const slotDist = (it) => (G.distance || 0) - it.z;
const slotTheme = (it) => themeAt(slotDist(it));

// 건물: 스타일별 base(+glow) 인스턴스 메시 (좌/우 각각)
const BUILDING_STYLES = ['ruko', 'tube', 'neon', 'modern', 'brick', 'haussmann'];
const RUKO_COLORS = [0xfff1c9, 0xd8f1e3, 0xfde2e4, 0xdbeafe, 0xfff7ae, 0xe9e3ff, 0xffffff, 0xffd8b5];
const rukoMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const buildingGeoms = Object.fromEntries(BUILDING_STYLES.map((st) => [st, M.buildingStyle(st)]));
function buildingSide(side) {
  const groups = BUILDING_STYLES.map((st) => {
    const g = buildingGeoms[st];
    const meshes = [new THREE.InstancedMesh(g.base, st === 'ruko' ? rukoMat : M.vcMat, 42)];
    if (g.glow) meshes.push(new THREE.InstancedMesh(g.glow, M.glowMat, 42));
    return meshes;
  });
  const rukoBase = groups[0][0];
  rukoBase.userData.tinted = true;
  const strip = new PropStrip({ variants: groups }, 42, 10.2, (it, k) => {
    const theme = slotTheme(it);
    const st = pickWeighted(theme.building);
    it.variant = BUILDING_STYLES.indexOf(st);
    it.x = side * 16.6;
    it.ry = side > 0 ? Math.PI : 0;
    it.sy = st === 'ruko' || st === 'tube' ? 0.85 + Math.random() * 0.45 : 0.8 + Math.random() * 0.5;
    it.hidden = Math.random() < 0.08; // 골목 사이 틈
    if (st === 'ruko') (it.color ||= new THREE.Color()).setHex(pick(RUKO_COLORS));
  });
  return { strip, groups };
}

const TREE_KINDS = ['palm', 'sakura', 'ginkgo', 'round'];
const treeMeshes = TREE_KINDS.map((k) => new THREE.InstancedMesh(M.treeVariant(k), M.vcMat, 56));
const CURB_KINDS = ['warung', 'vending', 'cafe', 'tent', 'planter'];
const curbMeshes = CURB_KINDS.map((k) => new THREE.InstancedMesh(M.curbVariant(k), M.vcMat, 14));
const lampPole = new THREE.InstancedMesh(M.lampPoleGeometry(), M.vcMat, 18);
const lampHead = new THREE.InstancedMesh(M.lampHeadGeometry(), M.lampHeadMat, 18);
// 가로등 국기: 국경 150m 전부터 다음 나라 국기, 평소엔 일부 가로등에 현재 나라 국기
const lampFlags = THEMES.map((t) => new THREE.InstancedMesh(M.lampFlagGeometry(), M.flagMaterial(t.code), 18));
const buildingMat = M.makeBuildingMaterial();
const bldgMesh = new THREE.InstancedMesh(M.buildingGeometry(), buildingMat, 30);
const buildingsL = buildingSide(-1), buildingsR = buildingSide(1);

// 빌보드가 서 있는 인도 구간의 가로수·가로등은 숨김 (패널/기둥과 겹쳐 파묻히지 않게)
const activeBoards = [];
function underBoard(it) {
  const ax = Math.abs(it.x);
  if (ax > 14) return false;
  for (const b of activeBoards) {
    if (Math.sign(it.x) === b.side && Math.abs(it.z - b.z) < b.halfZ) return true;
  }
  return false;
}

const strips = [
  new PropStrip({ variants: treeMeshes.map((m) => [m]), block: underBoard }, 56, 7.5, (it) => {
    it.variant = TREE_KINDS.indexOf(slotTheme(it).tree);
    const side = Math.random() < 0.5 ? -1 : 1;
    it.x = side * (Math.random() < 0.7 ? rand(9.6, 10.2) : rand(26, 44));
    it.sx = it.sy = it.sz = rand(0.85, 1.3);
    it.ry = rand(0, Math.PI * 2);
  }),
  new PropStrip({ always: [lampPole, lampHead], variants: [[], ...lampFlags.map((m) => [m])], block: underBoard }, 18, 24, (it) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * 9.2;
    it.ry = side > 0 ? 0 : Math.PI;
    const d = slotDist(it);
    const border = Math.ceil(d / ZONE_LENGTH) * ZONE_LENGTH;
    if (border - d < 150 && border > 0) it.variant = 1 + themeIndexAt(border);
    else it.variant = Math.random() < 0.15 ? 1 + themeIndexAt(d) : 0;
  }),
  buildingsL.strip,
  buildingsR.strip,
  new PropStrip({ variants: curbMeshes.map((m) => [m]) }, 14, 30, (it) => {
    it.variant = CURB_KINDS.indexOf(slotTheme(it).curb);
    const side = it.i % 2 ? 1 : -1;
    it.x = side * 12.2;
    it.ry = side > 0 ? Math.PI : 0;
    it.hidden = Math.random() < 0.3;
  }),
  new PropStrip({ always: [bldgMesh] }, 30, 14, (it, k) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * rand(30, 80);
    it.sx = rand(8, 16);
    it.sy = rand(12, 50);
    it.sz = rand(8, 14);
    bldgMesh.setColorAt(k, tmpColor.setHSL(rand(0.05, 0.6), rand(0.05, 0.2), rand(0.55, 0.8)));
    if (bldgMesh.instanceColor) bldgMesh.instanceColor.needsUpdate = true;
  }),
];

// ---------- 바이크
let bike = null;
let bikeKey = '';
// 실제 라이트 대신 도로 위에 가산 블렌딩 빛줄기를 깔아 모바일 성능 확보
const headlight = new THREE.Mesh(
  new THREE.PlaneGeometry(6, 18).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: M.makeBeamTexture(), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
);
headlight.position.set(0, 0.04, -9.6);
const shieldBubble = new THREE.Mesh(
  new THREE.SphereGeometry(1.45, 20, 14),
  new THREE.MeshBasicMaterial({ color: 0x4cc9f0, transparent: true, opacity: 0.22, depthWrite: false }),
);
shieldBubble.position.y = 0.95;
shieldBubble.scale.set(0.8, 1, 1.2);

// ---------- 관리자 모드: 서버 계정(player_data.is_admin) 또는 ?debug 토글
// 모든 아이템 사용 가능 + 랭킹 기록 차단
let serverAdmin = false;
let debugAdmin = false;
const isAdminMode = () => serverAdmin || debugAdmin;

// 상점 국기 카탈로그 (헬멧 스티커 + 차체 데칼 + 상자 깃발)
const FLAGS = FLAG_SHOP_CODES.map((code) => ({
  id: code, code, name: `${countryName(code)} Flag`,
  price: THEMES.some((t) => t.code === code) ? FLAG_PRICE_THEME : FLAG_PRICE_OTHER,
  desc: 'Helmet sticker, bike decal and box flag',
}));

// 바이크 외형. 국가대표 바이크는 그 나라 국기 색으로 도색 (국기 데칼은 장착한 국기를 따르고, 없앨 수도 있음)
function bikeLook(bikeId, code) {
  const bk = getBike(bikeId);
  if (bk.special === 'national') {
    const cc = isCountryCode(code) ? code : save.country;
    const [c1, c2] = nationalLivery(cc);
    return { color: c1, opts: { style: 'sport', accent: c2, national: true } };
  }
  return { color: bk.color, opts: { style: bk.style } };
}
const myNationalCode = () => save.nationalCode || save.country;
function myLook() {
  const look = bikeLook(save.bike, myNationalCode());
  const flag = isCountryCode(save.flag) ? save.flag : null;
  return { color: look.color, opts: { ...look.opts, box: save.box, outfit: save.outfit, helmet: save.helmet, flag } };
}
const currentBikeKey = () => JSON.stringify(myLook());
const riderOpts = () => myLook().opts;
// 랭킹 행(다른 라이더)의 장착 조합 → 3D 미리보기
function rowLook(r) {
  const look = bikeLook(r.bike, r.country);
  const flag = isCountryCode(r.flag) ? r.flag : null;
  return { color: look.color, opts: { ...look.opts, box: r.box || 'basic', outfit: r.outfit || 'jacket', helmet: r.helmet || 'basic', flag } };
}

// 관리자 모드가 아니면 보유하지 않은 아이템 장착을 해제
function sanitizeEquip() {
  if (isAdminMode()) return;
  if (save.bike === 'national' && !save.nationalUnlocked) save.bike = save.ownedBikes.includes(save.prevBike) ? save.prevBike : 'rookie';
  if (save.bike !== 'national' && !save.ownedBikes.includes(save.bike)) save.bike = 'rookie';
  for (const [k, own, def] of [['box', 'ownedBoxes', 'basic'], ['outfit', 'ownedOutfits', 'jacket'], ['helmet', 'ownedHelmets', 'basic']]) {
    if (!save[own].includes(save[k])) save[k] = def;
  }
  if (save.flag && !save.ownedFlags.includes(save.flag)) save.flag = '';
}

function buildBike() {
  if (bike) scene.remove(bike.root);
  const look = myLook();
  bike = M.createBike(look.color, look.opts);
  bike.root.add(headlight, shieldBubble);
  scene.add(bike.root);
  bikeKey = currentBikeKey();
}
buildBike();

// 멀티플레이 상대 고스트
const ghost = M.createGhost();
ghost.root.visible = false;
scene.add(ghost.root);

// ---------- 게임 상태
const MP = { active: false, opp: null, snaps: [], oppName: 'Rival', oppDone: false, oppScore: 0, ready: false, oppReady: false, roomSeed: null };

// ---------- 차량(트래픽)
const cars = [];
const carPool = {};

function acquireCar(type) {
  const pool = carPool[type] || (carPool[type] = []);
  let c = pool.find((p) => !p.active);
  if (!c) {
    c = M.createCar(type);
    pool.push(c);
    scene.add(c.group);
  }
  c.active = true;
  c.group.visible = true;
  return c;
}

function releaseCar(c) {
  c.active = false;
  c.group.visible = false;
  const i = cars.indexOf(c);
  if (i >= 0) cars.splice(i, 1);
  if (c.stale) {
    // 외부 모델로 교체된 타입의 옛 모델은 버림
    scene.remove(c.group);
    const pool = carPool[c.type];
    const j = pool.indexOf(c);
    if (j >= 0) pool.splice(j, 1);
  }
}

function laneClear(lane, z, len, self) {
  for (const o of cars) {
    if (o === self || o.flying) continue;
    if (o.lane !== lane && o.targetLane !== lane) continue;
    if (Math.abs(o.z - z) < (o.len + len) / 2 + 7) return false;
  }
  return true;
}

// 같은 z 근처에서 네 차선이 모두 막히지 않도록 (항상 빠져나갈 틈 유지)
function blocksAll(lane, z) {
  const occ = new Set([lane]);
  for (const o of cars) {
    if (o.flying) continue;
    if (Math.abs(o.z - z) < 22) {
      occ.add(o.lane);
      occ.add(o.targetLane);
    }
  }
  return occ.size >= 4;
}

function pickType(r, r2, z) {
  // 국가 테마 특수 교통 (태국 툭툭 / 베트남 오토바이 물결 / 뉴욕 옐로캡)
  const tr = themeAt(G.distance - z).traffic;
  let acc = 0;
  for (const [type, w] of Object.entries(tr)) {
    acc += w;
    if (r2 < acc) return type;
  }
  if (G.distance > 600 && r < 0.1) return 'ramp'; // 견인트럭 점프대 (이전 대비 2배)
  if (r < 0.2 + Math.min(0.05, G.distance / 60000)) return 'bus';
  if (r < 0.31) return 'truck';
  if (r < 0.45) return 'suv';
  if (r < 0.52) return 'taxi';
  if (r < 0.55) return 'police';
  return 'sedan';
}

// 통행 방향이 바뀌는 국경(예: 한국 R → 일본 L) 기준 [-200m, +150m] 은 교통 공백 구간
const GAP_BEFORE = 200, GAP_AFTER = 150;
function inBorderGap(d) {
  const b = Math.round(d / ZONE_LENGTH) * ZONE_LENGTH;
  if (b <= 0 || driveSign(b - 1) === driveSign(b + 1)) return false;
  return d > b - GAP_BEFORE && d < b + GAP_AFTER;
}

function spawnCar(z = SPAWN_Z, forced = null) {
  // 난수는 결과와 무관하게 항상 같은 개수만 소비 → 멀티 동기화 유지
  const r = Array.from({ length: 10 }, () => wr('car'));
  const type = forced?.type || pickType(r[0], r[9], z);
  const def = M.CAR_DEFS[type];
  // 스폰 위치 나라의 통행 방향 (좌측통행이면 왼쪽 두 차선이 같은 방향)
  const sd = G.distance - z;
  const ds = driveSign(sd);
  // 통행 방향이 바뀌는 국경 앞뒤 구간에는 차를 만들지 않음 → 서로 다른 규칙의 차가 섞이지 않게
  if (!forced && inBorderGap(sd)) return null;
  const same = ds > 0 ? [2, 3] : [1, 0];
  const order = forced ? [forced.lane] : type === 'ramp' ? (r[1] < 0.5 ? same : [same[1], same[0]]) : [0, 1, 2, 3];
  if (type !== 'ramp' && !forced) {
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(r[i] * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  for (const lane of order) {
    if (!laneClear(lane, z, def.len) || blocksAll(lane, z)) continue;
    const c = acquireCar(type);
    const dir = (lane >= 2) === (ds > 0) ? 1 : -1;
    Object.assign(c, {
      lane, targetLane: lane, dir, ds, side: Math.sign(LANES[lane]), baseX: LANES[lane], x: LANES[lane], z, offset: 0,
      speed: lerp(def.speed[0], def.speed[1], r[4]) * (dir < 0 ? 1.1 : 1),
      passed: false, minGap: 99, changing: false, changeT: 0, flying: false, honked: false,
      wob: r[5] * Math.PI * 2,
      wobAmp: (type === 'bus' || type === 'truck' || type === 'ramp' ? 0.1 : 0.22) * (1 + clamp(G.distance / 8000, 0, 1) * 0.8),
      // 앞서가는 같은 방향 차량일수록 깜빡이 후 급차선 변경을 자주 함
      canChange: type !== 'ramp' && r[6] < Math.min(dir > 0 ? 0.7 : 0.4, (dir > 0 ? 0.3 : 0.12) + G.distance / 8000),
    });
    const col = type === 'taxi' ? 0xffc300 : type === 'police' ? 0xf4f4f4 : type === 'bus' ? [0x2e86de, 0x10ac84, 0xee5253][(r[8] * 3) | 0]
      : type === 'ramp' ? 0xff8c1a : CAR_COLORS[(r[8] * CAR_COLORS.length) | 0];
    c.bodyMat.color.setHex(col);
    c.blinkMatL.emissiveIntensity = 0;
    c.blinkMatR.emissiveIntensity = 0;
    c.group.rotation.set(0, dir < 0 ? Math.PI : 0, 0);
    c.group.position.set(c.x, 0, c.z);
    cars.push(c);
    return c;
  }
  return null;
}

function otherLane(l) {
  return l === 0 ? 1 : l === 1 ? 0 : l === 2 ? 3 : 2;
}

function setBlink(c, side, on) {
  // side: +1 = 차량 기준 오른쪽
  (side > 0 ? c.blinkMatR : c.blinkMatL).emissiveIntensity = on ? 2.2 : 0;
}

function updateCars(dt, collide) {
  const t = G.time;
  const solid = collide && !G.air;
  if (collide) draftingNow = false;
  for (let i = cars.length - 1; i >= 0; i--) {
    const c = cars[i];
    if (c.flying) {
      c.vy -= 22 * dt;
      const p = c.group.position;
      p.x += c.vx * dt;
      p.y = Math.max(-0.5, p.y + c.vy * dt);
      c.z += (G.speed - c.vz) * dt;
      p.z = c.z;
      c.group.rotation.x += c.sx * dt;
      c.group.rotation.z += c.sz * dt;
      c.flyT -= dt;
      if (c.flyT <= 0 || c.z > 40) releaseCar(c);
      continue;
    }

    // 앞차가 느리면 따라가기 (같은 차선 추돌 방지)
    for (const o of cars) {
      if (o === c || o.flying || o.dir !== c.dir) continue;
      if (o.lane !== c.lane && o.targetLane !== c.lane && o.lane !== c.targetLane) continue;
      const ahead = (c.z - o.z) * c.dir;
      if (ahead > 0 && ahead < (c.len + o.len) / 2 + 5 && o.speed < c.speed) c.speed = o.speed;
    }

    // 차는 절대 중앙선을 넘지 않음. 통행 방향이 다른 나라로 넘어가는 차는 멀리 있을 때 정리
    // (국경 앞뒤 교통 공백 구간 덕분에 대부분 라이더 시야 밖에서 처리됨)
    if (driveSign(G.distance - c.z) !== c.ds) {
      if (c.z < -40) {
        releaseCar(c);
        continue;
      }
      c.canChange = false;
    }
    if (c.changing) {
      c.changeT += dt;
      const on = Math.floor(c.changeT * 6) % 2 === 0;
      setBlink(c, Math.sign(LANES[c.targetLane] - c.baseX) * c.dir, on);
      // 깜빡이 1초 → 급차선 변경 (약 0.5초 만에 옆 차선으로)
      if (c.changeT > 1.0) {
        const tx = LANES[c.targetLane];
        const step = 7 * dt;
        c.baseX += clamp(tx - c.baseX, -step, step);
        if (Math.abs(tx - c.baseX) < 0.01) {
          c.baseX = tx;
          c.lane = c.targetLane;
          c.changing = false;
          c.canChange = false;
          c.blinkMatL.emissiveIntensity = 0;
          c.blinkMatR.emissiveIntensity = 0;
        }
      }
    } else if (c.canChange && c.z > -150 && c.z < -20 && Math.random() < 0.7 * dt) {
      const ol = otherLane(c.lane);
      if (laneClear(ol, c.z, c.len, c)) {
        c.targetLane = ol;
        c.changing = true;
        c.changeT = 0;
      }
    }

    c.z += (G.speed - c.dir * c.speed) * dt;
    c.x = c.baseX + Math.sin(t * 0.8 + c.wob) * c.wobAmp;
    // 안전장치: 차체가 중앙선(x = 0)을 넘지 않도록 자기 쪽으로 고정
    c.x = c.side * Math.max(c.side * c.x, c.w / 2 + 0.25);
    c.group.position.set(c.x, 0, c.z);
    if (c.sirenR) {
      const ph = Math.floor(t * 8) % 2;
      c.sirenR.material.emissiveIntensity = ph ? 2.6 : 0.2;
      c.sirenB.material.emissiveIntensity = ph ? 0.2 : 2.6;
    }
    if (c.z > 25 || c.z < -330) {
      releaseCar(c);
      continue;
    }

    if (!solid || G.air || G.state !== 'playing') continue;
    const dx = Math.abs(c.x - G.x), dz = Math.abs(c.z);
    // 슬립스트림: 같은 방향 대형차(트럭·버스·견인트럭) 바로 뒤
    if (c.dir > 0 && (c.type === 'truck' || c.type === 'bus' || c.type === 'ramp')) {
      const gap = -(c.z + c.len / 2) - BIKE_HL;
      if (gap > 0 && gap < DRAFT_GAP && dx < DRAFT_LANE) draftingNow = true;
    }
    if (dx < c.w / 2 + BIKE_HW - 0.05 && dz < c.len / 2 + BIKE_HL - 0.15) {
      // 견인트럭: 뒤쪽 경사판으로 진입하면 점프
      const rearGap = c.z + c.len / 2 + BIKE_HL; // 트럭 뒷면이 바이크 앞을 지난 거리
      if (c.type === 'ramp' && rearGap < 2.2 && dx < c.w / 2 - 0.1) {
        startJump(c);
        continue;
      }
      hitObstacle(c);
      continue;
    }
    // 정면에서 다가오는 차가 경적
    if (c.dir < 0 && !c.honked && c.z < -10 && c.z > -45 && dx < 1.4) {
      c.honked = true;
      sfx.horn();
    }
    if (!c.passed) {
      if (dz < c.len / 2 + 1.2) {
        const gap = dx - c.w / 2 - BIKE_HW;
        if (gap < c.minGap) c.minGap = gap;
      }
      if (c.z - c.len / 2 > 1.0) {
        c.passed = true;
        if (c.minGap < 1.0) nearMiss(c, Math.max(0, c.minGap));
      }
    }
  }
}

// ---------- 인스턴스 장애물 공통 (라바콘 / 공사 표지판 / 물웅덩이)
function makeInstanced(geo, mat, max) {
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const items = Array.from({ length: max }, () => ({ active: false, x: 0, z: 0, y: 0, vy: 0, vx: 0, rot: 0, flying: false, hit: false }));
  return { mesh, items };
}

const conePool = makeInstanced(M.coneGeometry(), M.vcMat, 48);
const signPool = makeInstanced(M.signGeometry(), M.vcMat, 16);
const puddleMat = M.createPuddleMaterial();
const puddlePool = makeInstanced(M.puddleGeometry(), puddleMat, 18);
puddlePool.mesh.renderOrder = -1;
// 도로 돌발 위험: 포트홀(덜컹·감속), 열린 맨홀(충돌), 화물 상자(충돌, 니트로·거대화로 날림)
const potholePool = makeInstanced(M.potholeGeometry(), M.vcMat, 12);
const manholePool = makeInstanced(M.manholeGeometry(), M.vcMat, 8);
const cargoPool = makeInstanced(M.cargoGeometry(), M.vcMat, 10);
const HAZARDS = [
  { pool: potholePool, kind: 'pothole', hw: 0.6, hl: 0.55 },
  { pool: manholePool, kind: 'manhole', hw: 0.5, hl: 0.5 },
  { pool: cargoPool, kind: 'cargo', hw: 0.55, hl: 0.45 },
];

function spawnHazard() {
  const r1 = wr('hazard'), r2 = wr('hazard'), r3 = wr('hazard');
  const kind = r1 < 0.45 ? 'pothole' : r1 < 0.75 ? 'cargo' : 'manhole';
  const h = HAZARDS.find((k) => k.kind === kind);
  spawnInPool(h.pool, { x: LANES[(r2 * 4) | 0] + (r3 - 0.5) * 1.2, z: SPAWN_Z, rot: 0 });
}

function hitPothole() {
  if (G.giantT > 0 || G.boostTime > 0) return;
  G.speed *= 0.75;
  G.shake = 0.6;
  G.combo = 0;
  sfx.land();
  vibrate([30, 30, 30]);
  popup('POTHOLE!', 'power');
}

// ---------- 배달 드롭존: 도로 가장자리 구역을 정확히 통과하면 코인 + 부스트
const dropZones = [];
const DROP_REWARD = 30;
function spawnDropZone() {
  const r1 = wr('hazard');
  let d = dropZones.find((z) => !z.active);
  if (!d) {
    d = { obj: M.createDropZone() };
    scene.add(d.obj);
    dropZones.push(d);
  }
  Object.assign(d, { active: true, x: r1 < 0.5 ? LANES[0] : LANES[3], z: SPAWN_Z, done: false });
  d.obj.visible = true;
}
function updateDropZones(dt, collide) {
  for (const d of dropZones) {
    if (!d.active) continue;
    d.z += G.speed * dt;
    d.obj.position.set(d.x, 0, d.z);
    d.obj.area.material.opacity = 0.22 + Math.sin(G.time * 6) * 0.08;
    if (collide && !d.done && d.z > -M.DROP_ZONE.length / 2 && d.z < M.DROP_ZONE.length / 2 && G.state === 'playing'
      && !G.air && Math.abs(G.x - d.x) < M.DROP_ZONE.width / 2 - BIKE_HW * 0.5) {
      d.done = true;
      G.bonusCoins += DROP_REWARD;
      save.coins += DROP_REWARD;
      G.slingT = Math.max(G.slingT, 1.2);
      addNitro(15);
      popup('DROP ZONE!', 'perfect', `+${DROP_REWARD} COINS · BOOST`);
      sfx.mission();
      vibrate(25);
    }
    if (d.z > 20) {
      d.active = false;
      d.obj.visible = false;
    }
  }
}

function spawnInPool(pool, props) {
  const it = pool.items.find((k) => !k.active);
  if (!it) return null;
  return Object.assign(it, { active: true, y: 0, vy: 0, vx: 0, rot: 0, flying: false, hit: false }, props);
}

function spawnCones() {
  // 중앙선(공사 구간) 비중을 높이고, 솔로 모드에선 플레이어가 타는 경계에도 배치
  const r1 = wr('cone'), r2 = wr('cone'), r3 = wr('cone'), r4 = wr('cone');
  const nearest = DIVIDERS.reduce((a, d) => (Math.abs(d - G.x) < Math.abs(a - G.x) ? d : a));
  let x;
  if (r1 < 0.5) x = 0;
  else if (r1 < 0.72 && !MP.active) x = nearest;
  else x = DIVIDERS[(r2 * 3) | 0];
  const n = 4 + ((r3 * 5) | 0);
  for (let i = 0; i < n; i++) spawnInPool(conePool, { x, z: SPAWN_Z - i * 3.2 });
  // 중앙선 공사 구간이면 앞뒤로 표지판
  if (x === 0 && r4 < 0.7) {
    spawnInPool(signPool, { x: 0, z: SPAWN_Z + 4 });
    if (r4 < 0.35) spawnInPool(signPool, { x: 0, z: SPAWN_Z - n * 3.2 - 2 });
  }
}

function spawnPuddle() {
  const r1 = wr('puddle'), r2 = wr('puddle');
  const x = r1 < 0.5 ? LANES[(r2 * 4) | 0] : DIVIDERS[(r2 * 3) | 0] + (r1 - 0.75) * 2;
  spawnInPool(puddlePool, { x, z: SPAWN_Z });
}

// hw/hl: 충돌 반폭/반길이, kind: 'cone' | 'sign' | 'puddle'
function updatePool(pool, dt, collide, hw, hl, kind) {
  const { mesh, items } = pool;
  for (let k = 0; k < items.length; k++) {
    const c = items[k];
    if (!c.active) {
      dummy.scale.set(0, 0, 0);
    } else {
      c.z += G.speed * dt;
      if (c.flying) {
        c.vy -= 22 * dt;
        c.y = Math.max(0, c.y + c.vy * dt);
        c.x += c.vx * dt;
        c.rot += dt * 12;
      } else if (collide && !G.air && !c.hit && G.state === 'playing' && Math.abs(c.x - G.x) < hw + BIKE_HW && Math.abs(c.z) < hl + BIKE_HL) {
        if (kind === 'puddle') {
          c.hit = true;
          hitPuddle();
        } else if (kind === 'pothole') {
          c.hit = true;
          hitPothole();
        } else if (kind === 'manhole') {
          c.hit = true;
          hitObstacle(c, 'hole');
        } else {
          hitObstacle(c, 'small');
        }
      }
      if (c.z > 20) c.active = false;
      dummy.scale.set(1, 1, 1);
    }
    dummy.position.set(c.x, c.y + (kind === 'puddle' ? 0.03 : 0), c.z);
    if (kind === 'pothole' || kind === 'manhole') dummy.rotation.set(0, 0, 0);
    else dummy.rotation.set(c.rot, 0, c.rot * 0.7);
    dummy.updateMatrix();
    mesh.setMatrixAt(k, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// ---------- 갓길 노점상 (Kaki Lima 수레 / 천막)
const stallPool = [];
const stalls = [];
function acquireStall(kind) {
  let s = stallPool.find((p) => !p.active && p.kind === kind && !p.stale);
  if (!s) {
    s = { kind, mesh: M.createStall(kind), ...M.STALL_DEFS[kind] };
    stallPool.push(s);
    scene.add(s.mesh);
  }
  s.active = true;
  s.mesh.visible = true;
  return s;
}
function releaseStall(s) {
  s.active = false;
  s.mesh.visible = false;
  stalls.splice(stalls.indexOf(s), 1);
}
function spawnStall() {
  const r1 = wr('stall'), r2 = wr('stall'), r3 = wr('stall');
  const kind = r1 < 0.6 ? 'cart' : 'tent';
  const side = r2 < 0.5 ? -1 : 1;
  const n = r3 < 0.35 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const s = acquireStall(i === 0 ? kind : (kind === 'cart' ? 'tent' : 'cart'));
    Object.assign(s, { x: side * (s.kind === 'cart' ? 7.55 : 7.8), z: SPAWN_Z - i * 4.2, y: 0, vy: 0, vx: 0, flying: false });
    s.mesh.rotation.set(0, 0, 0);
    stalls.push(s);
  }
}
function updateStalls(dt, collide) {
  for (let i = stalls.length - 1; i >= 0; i--) {
    const s = stalls[i];
    s.z += G.speed * dt;
    if (s.flying) {
      s.vy -= 22 * dt;
      s.y = Math.max(0, s.y + s.vy * dt);
      s.x += s.vx * dt;
      s.mesh.rotation.z += dt * 5;
    } else if (collide && !G.air && G.state === 'playing' && Math.abs(s.x - G.x) < s.hw + BIKE_HW && Math.abs(s.z) < s.hl + BIKE_HL) {
      hitObstacle(s, 'stall');
    }
    s.mesh.position.set(s.x, s.y, s.z);
    if (s.z > 20) releaseStall(s);
  }
}

// ---------- 코인
const MAX_COINS = 80;
const coinMesh = new THREE.InstancedMesh(M.coinGeometry(), M.coinMat, MAX_COINS);
coinMesh.frustumCulled = false;
scene.add(coinMesh);
const coins = Array.from({ length: MAX_COINS }, () => ({ active: false, x: 0, z: 0 }));

function spawnCoins() {
  const r = Array.from({ length: 5 }, () => wr('coin'));
  const pattern = ['line', 'line', 'zig', 'split'][(r[0] * 4) | 0];
  const n = 6 + ((r[1] * 7) | 0);
  const lane = (r[2] * 4) | 0;
  const div = DIVIDERS[(r[3] * 3) | 0];
  const phase = r[4] * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const c = coins.find((k) => !k.active);
    if (!c) break;
    c.active = true;
    c.z = SPAWN_Z - i * 3.5;
    c.x = pattern === 'line' ? LANES[lane] : pattern === 'split' ? div : Math.sin(phase + i * 0.55) * 5.2;
  }
}

function updateCoins(dt, collide) {
  const t = G.time;
  for (let k = 0; k < MAX_COINS; k++) {
    const c = coins[k];
    if (c.active) {
      c.z += G.speed * dt;
      if (collide && (G.magnetTime > 0 || G.feverT > 0) && c.z > -30 && c.z < 3) {
        c.x += (G.x - c.x) * Math.min(1, dt * 7);
        c.z += -c.z * Math.min(1, dt * 5);
      }
      if (collide && (G.airY || 0) < 2.2 && Math.abs(c.x - G.x) < 0.9 && Math.abs(c.z) < 1.3) {
        c.active = false;
        collectCoin();
      } else if (c.z > 15) {
        c.active = false;
      }
    }
    if (c.active) {
      dummy.position.set(c.x, 1.0 + Math.sin(t * 4 + k) * 0.12, c.z);
      dummy.rotation.set(0, t * 4 + k * 0.3, 0);
      dummy.scale.set(1, 1, 1);
    } else {
      dummy.scale.set(0, 0, 0);
    }
    dummy.updateMatrix();
    coinMesh.setMatrixAt(k, dummy.matrix);
  }
  coinMesh.instanceMatrix.needsUpdate = true;
}

function collectCoin() {
  G.coinsRun++;
  save.coins++;
  addNitro(2);
  G.score += 10 * G.mult;
  sfx.coin();
}

// 니트로 게이지: 니트로 발동(4초 무적) 중에는 충전 차단
function addNitro(v) {
  if (G.boostTime > 0) return;
  G.nitro = Math.min(100, G.nitro + v);
}

// ---------- 파워업
const powerMeshes = {};
for (const t of POWER_TYPES) {
  powerMeshes[t] = M.createPowerUp(t);
  powerMeshes[t].group.visible = false;
  scene.add(powerMeshes[t].group);
}
const powerItems = [];

function spawnPower() {
  const r1 = wr('power'), r2 = wr('power'), r3 = wr('power');
  let acc = 0;
  const type = POWER_TYPES[Math.max(0, POWER_WEIGHTS.findIndex((w) => (acc += w) > r1))];
  if (powerItems.some((p) => p.type === type)) return;
  const x = r2 < 0.5 ? LANES[(r3 * 4) | 0] : DIVIDERS[(r3 * 3) | 0];
  powerItems.push({ type, x, z: SPAWN_Z });
  powerMeshes[type].group.visible = true;
}

function updatePowerups(dt, collide) {
  for (let i = powerItems.length - 1; i >= 0; i--) {
    const p = powerItems[i];
    const m = powerMeshes[p.type];
    p.z += G.speed * dt;
    m.group.position.set(p.x, 0, p.z);
    m.core.rotation.y += dt * 3;
    m.core.rotation.x = Math.sin(G.time * 2) * 0.3;
    m.core.position.y = 1.2 + Math.sin(G.time * 3) * 0.15;
    let remove = p.z > 15;
    if (collide && (G.airY || 0) < 2.5 && Math.abs(p.x - G.x) < 1.2 && Math.abs(p.z) < 1.5) {
      applyPower(p.type);
      remove = true;
    }
    if (remove) {
      m.group.visible = false;
      powerItems.splice(i, 1);
    }
  }
}

function applyPower(type) {
  if (type === 'shield') G.shield = true;
  if (type === 'magnet') G.magnetTime = 10;
  if (type === 'x2') G.x2Time = 12;
  if (type === 'slow') G.slowTime = 5;
  if (type === 'giant') {
    G.giantT = GIANT_TIME;
    sfx.fever();
  }
  sfx.power();
  vibrate(30);
  popup(POWER_LABEL[type], 'power');
}

// ======================================================================
// 글로벌 국가 테마 진행 — 국경 관문 · 국기 · 랜드마크 · 하늘/안개 보간
// ======================================================================
const themeTint = new THREE.Color(THEMES[0].tint);
const themeTintTarget = new THREE.Color(THEMES[0].tint);
let themeTintAmt = THEMES[0].tintAmt;
const gateCache = {};
const gates = [];        // { obj, at } — at: 국경 거리(m)
const landmarkCache = {};
let landmarks = [];      // { obj, x, z } — 원경 패럴랙스

function gateFor(idx) {
  if (!gateCache[idx]) {
    const g = M.createBorderGate(THEMES[idx]);
    g.visible = false;
    scene.add(g);
    gateCache[idx] = g;
  }
  return gateCache[idx];
}

function spawnLandmark(theme, z = -440) {
  let obj = landmarkCache[theme.landmark];
  if (!obj) {
    obj = M.createLandmark(theme.landmark);
    scene.add(obj);
    landmarkCache[theme.landmark] = obj;
  }
  landmarks = landmarks.filter((l) => l.obj !== obj);
  obj.visible = true;
  landmarks.push({ obj, z, x: (Math.random() < 0.5 ? -1 : 1) * rand(85, 120) });
}

function resetThemes() {
  G.themeIdx = themeIndexAt(G.distance);
  G.nextBorder = (Math.floor(G.distance / ZONE_LENGTH) + 1) * ZONE_LENGTH;
  const t = THEMES[G.themeIdx];
  themeTint.setHex(t.tint);
  themeTintTarget.setHex(t.tint);
  themeTintAmt = t.tintAmt;
  for (const g of Object.values(gateCache)) g.visible = false;
  gates.length = 0;
  for (const l of landmarks) l.obj.visible = false;
  landmarks = [];
  spawnLandmark(t, -330);
}

function updateThemes(dz, rdt) {
  const nb = G.nextBorder;
  // 국경 관문: 국경 지점에 배치되어 앞쪽에서 다가옴 (HUD 팝업 없음)
  if (nb - G.distance < 235 && !gates.some((g) => g.at === nb)) {
    const obj = gateFor(themeIndexAt(nb));
    obj.visible = true;
    gates.push({ obj, at: nb });
  }
  for (let i = gates.length - 1; i >= 0; i--) {
    const g = gates[i];
    const z = -(g.at - G.distance);
    g.obj.position.set(0, 0, z);
    for (const f of g.obj.flags) f.rotation.y = Math.sin(G.time * 3 + f.position.x) * 0.3;
    if (z > 20) {
      g.obj.visible = false;
      gates.splice(i, 1);
    }
  }
  // 관문 통과 → 다음 나라: 하늘/안개 틴트를 부드럽게 보간
  if (G.distance >= nb) {
    G.themeIdx = themeIndexAt(G.distance);
    G.nextBorder = (Math.floor(G.distance / ZONE_LENGTH) + 1) * ZONE_LENGTH;
    const t = THEMES[G.themeIdx];
    themeTintTarget.setHex(t.tint);
    spawnLandmark(t);
    fetchRegionTop(t.code);
    fetchRegionTop(themeAt(G.nextBorder).code);
  }
  const k = 1 - Math.exp(-rdt * 1.2);
  themeTint.lerp(themeTintTarget, k);
  themeTintAmt = lerp(themeTintAmt, THEMES[G.themeIdx].tintAmt, k);
  for (let i = landmarks.length - 1; i >= 0; i--) {
    const l = landmarks[i];
    l.z += dz * 0.28;
    l.obj.position.set(l.x, 0, l.z);
    if (l.z > -70) {
      l.obj.visible = false;
      landmarks.splice(i, 1);
    }
  }
}

// ---------- 국가 랭킹 캐시 (전광판 / 라이벌 마커)
const regionTops = {};
const regionFetchAt = {};
async function fetchRegionTop(code, force = false) {
  if (!code) return;
  if (!force && regionFetchAt[code] && performance.now() - regionFetchAt[code] < 60000) return;
  regionFetchAt[code] = performance.now();
  const res = await leaderboard.fetchTop({ country: code });
  regionTops[code] = res.ok ? res.top : [];
  if (code === save.country) {
    setupRivalMarker();
    if (res.ok && res.me) applyNationalStatus(res.me.rank === 1, code);
  }
}

// ======================================================================
// 도로변 3D 빌보드 + 랭킹 1위 LED 전광판
// ======================================================================
const boardPool = [], megaPool = [];
const megaShots = {};
const megaInfoCache = new Map();
// 건물 전면 좌표: 건물 중심 |x| = 16.6, 깊이 6 → 도로 쪽 외벽 |x| = 13.6.
// 차양·네온 간판·비상계단이 외벽에서 최대 ~1m 튀어나오므로 빌보드의 건물 쪽 끝은 그보다 앞(BOARD_FAR)에 둠
const BUILDING_FRONT = 16.6 - 3;
const BOARD_FAR = BUILDING_FRONT - 1.1;
const BOARD_NEAR = ROAD_HALF - 0.9; // 도로 쪽 끝은 바깥 차선 위 높이 6m+ 로만 살짝 걸침
const BOARD_MAX_YAW = 0.93; // 다가오는 라이더 쪽으로 최대한 비스듬히

function acquireBoard(pool, factory) {
  let b = pool.find((x) => !x.active);
  if (!b) {
    b = { obj: factory(), active: false };
    scene.add(b.obj);
    pool.push(b);
  }
  b.active = true;
  b.obj.visible = true;
  activeBoards.push(b);
  return b;
}

// 폭 W 인 판이 BOARD_NEAR~BOARD_FAR 사이에 들어가는 최대 각도로 세우고, 중심 x 를 건물 전면 기준으로 계산
function placeBoard(b, side, y) {
  const { width } = b.obj.dims;
  const s = Math.min(Math.sin(BOARD_MAX_YAW), (BOARD_FAR - BOARD_NEAR) / width);
  const yaw = Math.asin(s);
  const cx = BOARD_FAR - (width / 2) * s;
  b.z = SPAWN_Z;
  b.side = side;
  b.halfZ = (width / 2) * Math.cos(yaw) + 2;
  b.obj.position.set(side * cx, y, b.z);
  b.obj.rotation.y = side < 0 ? -yaw : -(Math.PI - yaw);
  b.obj.setSide(side < 0 ? 1 : -1); // 기둥을 건물 쪽 절반으로
}

function spawnBillboard() {
  const theme = themeAt(G.distance - SPAWN_Z);
  const posters = BILLBOARD_POSTERS[theme.code] || [];
  if (!posters.length) return;
  const b = acquireBoard(boardPool, M.createBillboard);
  placeBoard(b, Math.random() < 0.5 ? -1 : 1, 6.2 + b.obj.dims.height / 2);
  b.obj.panel.material.map = M.posterTexture(pick(posters), theme.code);
  b.obj.panel.material.needsUpdate = true;
}

function spawnMegaBoard() {
  const theme = themeAt(G.distance - SPAWN_Z);
  const row = (regionTops[theme.code] || [])[0];
  const b = acquireBoard(megaPool, M.createMegaBoard);
  placeBoard(b, Math.random() < 0.5 ? -1 : 1, 6.8 + b.obj.dims.height / 2);
  // 1위 라이더 3D 스냅샷 (메인 렌더러로 렌더 타깃에 한 번만 그림). 1위라서 국기 아이템도 착용
  const key = row ? [row.nickname, row.bike, row.box, row.outfit, row.helmet, row.country, row.flag].join('|') : 'none';
  let shot = megaShots[theme.code];
  if (!shot) {
    shot = { rt: new THREE.WebGLRenderTarget(256, 256), key: null };
    shot.rt.texture.colorSpace = THREE.SRGBColorSpace;
    megaShots[theme.code] = shot;
  }
  if (shot.key !== key) {
    const look = row ? rowLook(row) : bikeLook('rookie');
    renderRiderSnapshot(renderer, shot.rt, look.opts, look.color);
    shot.key = key;
  }
  b.obj.shot.material.map = shot.rt.texture;
  b.obj.shot.material.needsUpdate = true;
  const infoKey = theme.code + key + (row?.score || 0) + (row?.dist || 0);
  if (!megaInfoCache.has(infoKey)) {
    megaInfoCache.set(infoKey, M.megaInfoTexture({
      code: theme.code,
      country: theme.country,
      name: row ? String(row.nickname).toUpperCase() : '',
      dist: fmt(row?.dist || 0),
      score: fmt(row?.score || 0),
      empty: !row,
      foot: row ? 'BEAT THIS RIDER TO TAKE THE BOARD' : `BE THE FIRST IN ${theme.country.toUpperCase()}`,
    }));
  }
  b.obj.info.material.map = megaInfoCache.get(infoKey);
  b.obj.info.material.needsUpdate = true;
}

function updateBoards(dz) {
  if (G.distance > G.nextBoard) {
    spawnBillboard();
    G.nextBoard += rand(70, 140);
  }
  if (G.distance > G.nextMega) {
    spawnMegaBoard();
    G.nextMega += rand(550, 750);
  }
  for (let i = activeBoards.length - 1; i >= 0; i--) {
    const b = activeBoards[i];
    b.z += dz;
    b.obj.position.z = b.z;
    if (b.z > 25) {
      b.active = false;
      b.obj.visible = false;
      activeBoards.splice(i, 1);
    }
  }
}

function clearBoards() {
  for (const b of activeBoards) {
    b.active = false;
    b.obj.visible = false;
  }
  activeBoards.length = 0;
}

// ======================================================================
// 라이벌 마커 (개인 최고 거리 / 지역 1위 거리)
// ======================================================================
const pbMarker = M.createRivalMarker(0x39ff88);
pbMarker.setLabel('PERSONAL BEST');
const rivalMarker = M.createRivalMarker(0xffc400);
pbMarker.visible = rivalMarker.visible = false;
scene.add(pbMarker, rivalMarker);

function setupRivalMarker() {
  if (G.rivalPassed) return;
  const me = getSession();
  const row = (regionTops[save.country] || []).find((r) => !r.isMe && r.dist > 0 && r.nickname !== me?.nickname);
  G.rivalDist = row ? row.dist : 0;
  G.rivalName = row ? String(row.nickname).toUpperCase() : '';
  if (row) rivalMarker.setLabel(`1ST: ${G.rivalName} · ${fmt(row.dist)} m`);
}

function updateMarkers() {
  const place = (m, dist) => {
    const z = -(dist - G.distance);
    m.visible = dist > 0 && z > -230 && z < 15 && G.state !== 'menu';
    if (m.visible) m.position.set(0, 0, z);
  };
  place(pbMarker, G.pbDist || 0);
  place(rivalMarker, G.rivalDist || 0);
  if (G.state !== 'playing') return;
  if (!G.pbPassed && G.pbDist > 0 && G.distance >= G.pbDist) {
    G.pbPassed = true;
    popup('NEW RECORD!', 'perfect', 'PERSONAL BEST DISTANCE');
    sfx.mission();
  }
  if (!G.rivalPassed && G.rivalDist > 0 && G.distance >= G.rivalDist) {
    G.rivalPassed = true;
    popup(`PASSED ${G.rivalName}!`, 'combo', `#1 IN ${countryName(save.country).toUpperCase()}`);
    sfx.fever();
  }
}

// ======================================================================
// 돌발 핫 배달 (15초 안에 400m)
// ======================================================================
const HOT_TIME = 15, HOT_DIST = 400, HOT_REWARD = 250;
function updateHotDelivery(rdt) {
  if (G.distance > G.nextHot) {
    G.nextHot += 400;
    if (!G.hot && Math.random() < 0.2) {
      G.hot = { t: HOT_TIME, start: G.distance };
      popup('HOT DELIVERY!', 'big', `${HOT_TIME}s / ${HOT_DIST} m`);
      sfx.beep(true);
    }
  }
  const el = $('hotBanner');
  if (!G.hot) {
    el.classList.add('hidden');
    return;
  }
  const h = G.hot;
  h.t -= rdt;
  const done = G.distance - h.start;
  el.classList.remove('hidden');
  el.classList.toggle('urgent', h.t < 4);
  $('hotText').textContent = `${Math.max(0, h.t).toFixed(1)}s · ${fmt(Math.max(0, HOT_DIST - done))} m LEFT`;
  $('hotBar').style.width = `${clamp(done / HOT_DIST, 0, 1) * 100}%`;
  if (done >= HOT_DIST) {
    G.hot = null;
    G.bonusCoins += HOT_REWARD;
    save.coins += HOT_REWARD;
    G.hotDone++;
    popup('DELIVERED!', 'perfect', `+${HOT_REWARD} COINS`);
    sfx.fireworks();
    vibrate([30, 40, 30]);
  } else if (h.t <= 0) {
    G.hot = null;
    popup('LATE DELIVERY', 'combo');
  }
}

// ======================================================================
// 슬립스트림 & 슬링샷 / 피버 모드
// ======================================================================
const DRAFT_GAP = 6;      // 대형차 뒤 이 거리 안 (m)
const DRAFT_LANE = 0.9;   // 같은 차선 판정 (횡 간격 m)
let draftingNow = false;

function updateDraft(dt) {
  if (draftingNow) {
    if (G.draftT === 0) popup('SLIPSTREAM', 'power');
    G.draftT = Math.min(2, G.draftT + dt);
  } else {
    // 충분히 드래프팅한 뒤 차선을 바꿔 빠져나오면 슬링샷 부스트
    if (G.draftT > 0.6 && Math.abs(G.vx) > 1.5) {
      G.slingT = 1.4;
      G.score += 200;
      popup('SLINGSHOT!', 'big', '+200');
      sfx.slingshot();
      vibrate(25);
    }
    G.draftT = 0;
  }
  G.slingT = Math.max(0, G.slingT - dt);
}

const FEVER_TIME = 5;
const feverTrails = [0xff2fd6, 0x00e5ff, 0xffe600, 0x7cff4f].map((c) => {
  const g = M.createGhost(c);
  g.root.visible = false;
  scene.add(g.root);
  return g;
});
const trailHistory = [];

function startFever() {
  G.feverT = FEVER_TIME;
  popup('FEVER MODE!', 'big', 'x3 SCORE · AUTO MAGNET');
  sfx.fever();
  vibrate([20, 30, 20, 30, 40]);
}

function updateFeverTrails() {
  trailHistory.push({ x: G.x, y: G.airY || 0, l: G.lean });
  if (trailHistory.length > 16) trailHistory.shift();
  const on = G.feverT > 0 && G.state === 'playing';
  feverTrails.forEach((g, i) => {
    g.root.visible = on;
    if (!on) return;
    const h = trailHistory[Math.max(0, trailHistory.length - 1 - (i + 1) * 3)];
    g.root.position.set(h.x, h.y, (i + 1) * 0.85);
    g.lean.rotation.z = h.l;
  });
}

// ---------- 이펙트 (3D 빗줄기, 스피드 라인)
function makeLines(n, color) {
  const pos = new Float32Array(n * 6);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  const drops = Array.from({ length: n }, () => ({ x: 0, y: rand(0, 18), z: rand(-70, 3) }));
  return { lines, pos, drops };
}
const rain = makeLines(1300, 0xaab8d0);
const streaks = makeLines(70, 0xffffff);
for (const d of rain.drops) d.x = rand(-20, 20);
for (const d of streaks.drops) d.x = rand(-14, 14);

function updateFx(rdt) {
  const cx = camera.position.x, cz = camera.position.z;
  const spd = G.speed;
  rain.lines.visible = G.rainAmt > 0.01;
  if (rain.lines.visible) {
    rain.lines.material.opacity = G.rainAmt * 0.6;
    const P = rain.pos;
    const active = Math.floor(rain.drops.length * (0.4 + G.rainAmt * 0.6));
    rain.drops.forEach((d, i) => {
      const o = i * 6;
      if (i >= active) {
        P[o + 1] = P[o + 4] = -10;
        return;
      }
      d.y -= 30 * rdt;
      d.z += spd * rdt;
      if (d.y < 0 || d.z > cz + 3) {
        d.y = rand(8, 18);
        d.z = cz - rand(2, 70);
        d.x = cx + rand(-20, 20);
      }
      P[o] = d.x; P[o + 1] = d.y; P[o + 2] = d.z;
      P[o + 3] = d.x - 0.15; P[o + 4] = d.y + 0.9; P[o + 5] = d.z - spd * 0.02;
    });
    rain.lines.geometry.attributes.position.needsUpdate = true;
  }
  // 스피드 라인: 니트로 중엔 시안색 터보 라인
  const kmh = spd * 3.6;
  const boosting = G.boostTime > 0 && G.state === 'playing';
  const op = (G.state === 'playing' ? clamp((kmh - 150) / 120, 0, 0.45) : 0) + (boosting ? 0.55 : 0);
  streaks.lines.material.color.setHex(boosting ? 0x00e5ff : 0xffffff);
  streaks.lines.visible = op > 0.01;
  if (streaks.lines.visible) {
    streaks.lines.material.opacity = op;
    const P = streaks.pos;
    const len = spd * (boosting ? 0.14 : 0.08);
    streaks.drops.forEach((d, i) => {
      d.z += spd * 1.4 * rdt;
      if (d.z > cz + 2) {
        d.z = cz - rand(20, 70);
        const a = rand(0, Math.PI * 2), r = rand(3, 9);
        d.x = cx + Math.cos(a) * r * 1.6;
        d.y = Math.max(0.3, 2.5 + Math.sin(a) * r * 0.6);
      }
      const o = i * 6;
      P[o] = d.x; P[o + 1] = d.y; P[o + 2] = d.z;
      P[o + 3] = d.x; P[o + 4] = d.y; P[o + 5] = d.z - len;
    });
    streaks.lines.geometry.attributes.position.needsUpdate = true;
  }
}

// ---------- 낮/밤 사이클 & 날씨
const SKY_KEYS = [
  // t, 하늘색, 반구광, 태양광, 밤(0~1)
  [0.0, 0x87c6ff, 2.2, 2.6, 0],
  [0.36, 0x87c6ff, 2.2, 2.6, 0],
  [0.46, 0xff9466, 1.6, 1.6, 0.35],
  [0.56, 0x10163a, 0.75, 0.2, 1],
  [0.86, 0x10163a, 0.75, 0.2, 1],
  [0.94, 0xffb38a, 1.5, 1.4, 0.4],
  [1.0, 0x87c6ff, 2.2, 2.6, 0],
];
const CYCLE = 5000;
const skyA = new THREE.Color(), skyB = new THREE.Color(), rainSky = new THREE.Color(0x4a525e);
const WHITE = new THREE.Color(0xffffff);

function updateEnvironment(rdt) {
  const t = ((G.distance + 400) % CYCLE) / CYCLE;
  let k = 0;
  while (k < SKY_KEYS.length - 2 && t > SKY_KEYS[k + 1][0]) k++;
  const a = SKY_KEYS[k], b = SKY_KEYS[k + 1];
  const f = clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
  skyA.setHex(a[1]);
  skyB.setHex(b[1]);
  skyA.lerp(skyB, f);
  const night = lerp(a[4], b[4], f);
  skyA.lerp(themeTint, themeTintAmt * (1 - night * 0.5)); // 나라별 대기색
  G.rainAmt = approach(G.rainAmt || 0, G.rain ? 1 : 0, rdt * 0.5);
  const ra = G.rainAmt;
  skyB.copy(rainSky).multiplyScalar(lerp(1, 0.3, night));
  skyA.lerp(skyB, ra * 0.8);
  // 번개: 하늘·조명이 순간 밝아짐
  G.lightning = Math.max(0, (G.lightning || 0) - rdt * 3);
  const flash = G.lightning;
  if (flash > 0) skyA.lerp(WHITE, flash * 0.6);
  scene.background.copy(skyA);
  scene.fog.color.copy(skyA);
  M.landmarkMat.color.setScalar(1).lerp(skyA, 0.5); // 원경 랜드마크는 하늘색에 녹아들게
  M.landmarkGlowMat.color.setScalar(1).lerp(skyA, 0.2);
  scene.fog.near = lerp(60, 22, ra);
  scene.fog.far = lerp(240, 130, ra);
  hemi.intensity = lerp(a[2], b[2], f) * (1 - ra * 0.4) + flash * 2.5;
  sun.intensity = lerp(a[3], b[3], f) * (1 - ra * 0.7);
  M.lampHeadMat.emissiveIntensity = 0.1 + Math.max(night, ra * 0.6) * 2.2;
  buildingMat.emissiveIntensity = night * 1.1;
  M.tailMat.emissiveIntensity = 0.6 + Math.max(night, ra * 0.5) * 1.6;
  M.headMat.emissiveIntensity = 0.4 + Math.max(night, ra * 0.5) * 1.8;
  M.coinMat.emissiveIntensity = 0.5 + night * 0.6;
  headlight.material.opacity = Math.max(night, ra * 0.5) * 0.55;
  headlight.visible = G.state !== 'crashing' && G.state !== 'over';
  // 젖은 노면 + 하늘을 비추는 물웅덩이 반사
  roadMat.color.setScalar(1 - ra * 0.3);
  puddleMat.color.copy(skyA).lerp(WHITE, 0.35 + flash * 0.5);
  puddleMat.opacity = 0.7 + ra * 0.25;
  sfx.rain(G.state === 'playing' || G.state === 'crashing' ? ra : 0);
}

// ---------- 카메라
let camX = 0, camY = 0;
let giantCam = 0;
function updateCamera(rdt) {
  const p = clamp((1.35 - camera.aspect) / 0.8, 0, 1); // 0 = 가로화면, 1 = 세로화면
  const baseY = lerp(3.0, 5.4, p), camZ = lerp(6.2, 8.4, p);
  let lookZ = lerp(-14, -24, p), lookY = lerp(1.2, 0.6, p);
  if (G.state === 'menu') {
    // 메뉴에서는 하단 시트에 가리지 않도록 라이더가 화면 가운데 오게
    lookZ = lerp(-7, -6, p);
    lookY = lerp(-1.9, -2.6, p);
  }
  const sf = clamp((G.speed * 3.6 - 60) / 220, 0, 1);
  const fov = lerp(62, 72, p) + sf * 12 + (G.boostTime > 0 ? 8 : 0) + (G.air ? 6 : 0) + (G.feverT > 0 ? 10 : 0) + (G.slingT > 0 ? 5 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, rdt * 4));
    camera.updateProjectionMatrix();
  }
  camX = lerp(camX, G.x * 0.75, Math.min(1, rdt * 5));
  camY = lerp(camY, (G.airY || 0) * 0.6, Math.min(1, rdt * 4));
  G.shake = Math.max(0, (G.shake || 0) - rdt * 2.2);
  const s = G.shake * 0.35 + (G.boostTime > 0 ? 0.04 : 0);
  giantCam = lerp(giantCam, G.giantT > 0 ? 1 : 0, Math.min(1, rdt * 3));
  camera.position.set(camX + rand(-s, s), baseY + camY + giantCam * 1.6 + rand(-s, s), camZ + giantCam * 2.5);
  camera.lookAt(camX * 0.9, lookY + camY * 0.5, lookZ);
  camera.rotateZ((G.lean || 0) * 0.08);
}

// ---------- 입력 (키보드 + 멀티터치 포인터 추적)
const keys = {};
const held = { left: false, right: false, throttle: false, brake: false };
const holdPointers = new Map(); // pointerId → 'left' | 'right' | 'throttle' | 'brake'
const pad = { id: null, originX: 0, value: 0 };
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const holdButtons = { left: $('btnLeft'), right: $('btnRight'), throttle: $('btnThrottle'), brake: $('btnBrake') };

function enableTouchUI() {
  document.body.classList.add('touch');
  $('touchControls').classList.remove('hidden');
}
if (isTouchDevice) enableTouchUI();

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryBoost();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter') {
    if (G.state === 'menu' && currentScreen === 'menu') startRun();
    else if (G.state === 'over' && currentScreen === 'gameover') retry();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', releaseAllInput);

function releaseAllInput() {
  for (const k of Object.keys(keys)) keys[k] = false;
  holdPointers.clear();
  pad.id = null;
  pad.value = 0;
  refreshHeld();
}

function refreshHeld() {
  for (const k of Object.keys(held)) held[k] = false;
  for (const v of holdPointers.values()) held[v] = true;
  for (const [k, el] of Object.entries(holdButtons)) el.classList.toggle('active', held[k]);
  $('steerKnob').style.transform = `translateX(${pad.value * 52}px)`;
}

// 버튼마다 포인터 ID 를 따로 추적 → 조향·가속·브레이크·니트로 동시 입력
function bindHold(el, key) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') enableTouchUI();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    holdPointers.set(e.pointerId, key);
    refreshHeld();
  });
  const up = (e) => {
    if (holdPointers.get(e.pointerId) !== key) return;
    holdPointers.delete(e.pointerId);
    refreshHeld();
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
}
for (const [k, el] of Object.entries(holdButtons)) bindHold(el, k);

// 드래그 조향 패드 (아날로그)
const steerPad = $('steerPad');
steerPad.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  try { steerPad.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const r = steerPad.getBoundingClientRect();
  pad.id = e.pointerId;
  pad.originX = r.left + r.width / 2;
  pad.value = clamp((e.clientX - pad.originX) / 52, -1, 1);
  refreshHeld();
});
steerPad.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pad.id) return;
  pad.value = clamp((e.clientX - pad.originX) / 52, -1, 1);
  refreshHeld();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  steerPad.addEventListener(ev, (e) => {
    if (e.pointerId !== pad.id) return;
    pad.id = null;
    pad.value = 0;
    refreshHeld();
  });
}

$('btnNitro').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  tryBoost();
});
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) b.blur();
});

function steerInput() {
  let s = 0;
  if (keys.ArrowLeft || keys.KeyA || held.left) s -= 1;
  if (keys.ArrowRight || keys.KeyD || held.right) s += 1;
  s += pad.value;
  return clamp(s, -1, 1);
}

function vibrate(p) {
  if (save.settings.vibrate && navigator.vibrate) {
    try { navigator.vibrate(p); } catch (e) { /* ignore */ }
  }
}

// ---------- 게임 흐름
function clearWorld() {
  while (cars.length) releaseCar(cars[0]);
  while (stalls.length) releaseStall(stalls[0]);
  for (const c of coins) c.active = false;
  for (const pool of [conePool, signPool, puddlePool, potholePool, manholePool, cargoPool]) for (const c of pool.items) c.active = false;
  for (const d of dropZones) {
    d.active = false;
    d.obj.visible = false;
  }
  for (const p of powerItems) powerMeshes[p.type].group.visible = false;
  powerItems.length = 0;
}

function resetRun(seed) {
  const runSeed = seed ?? newSeed();
  seedWorld(runSeed);
  clearWorld();
  screenRain.reset();
  Object.assign(G, {
    speed: 21, x: 3.5 * driveSign(0), vx: 0, lean: 0, distance: 0, score: 0, mult: 1, time: 0,
    coinsRun: 0, nearMiss: 0, combo: 0, comboTimer: 0, maxCombo: 0, nitro: 0, boostTime: 0,
    shield: false, magnetTime: 0, x2Time: 0, slowTime: 0, giantT: 0, invuln: 0, oncomingDist: 0,
    rotPitch: 0, rotYaw: 0, rotationCount: 0, rotShown: 0, tricks: 0,
    boostsUsed: 0, maxKmh: 0, smashed: 0, jumps: 0, continued: false, finalized: false,
    nextSpawn: 25, nextCoins: 60, nextPower: wrand('power', 120, 180), nextCones: wrand('cone', 350, 600),
    nextStall: wrand('stall', 300, 500), nextHazard: wrand('hazard', 350, 500), nextDrop: wrand('hazard', 400, 600), nextPuddle: wrand('puddle', 400, 700), nextSquall: wrand('weather', 1200, 2000),
    squallT: 0, rain: false, rainAmt: 0, lightning: 0, boltT: 0, shake: 0, crashT: 0,
    air: false, airY: 0, airVy: 0, slipT: 0, slipDir: 0, rpm: 0, braking: false,
    missionsDone: [], cd: 0, cdShown: 0, globalSubmitted: false,
    seed: runSeed, nextBoard: 120, nextMega: 300, nextHot: 500, hot: null, bonusCoins: 0, hotDone: 0,
    draftT: 0, slingT: 0, feverT: 0, pbDist: save.bestDist || 0, pbPassed: false,
    rivalDist: 0, rivalName: '', rivalPassed: false, doubled: false, revived: false,
  });
  for (let z = -60; z > SPAWN_Z; z -= wrand('car', 16, 26)) spawnCar(z);
  clearBoards();
  resetThemes();
  setupRivalMarker();
  fetchRegionTop(THEMES[G.themeIdx].code);
  fetchRegionTop(save.country);
  updatePool(conePool, 0, false, 0, 0, 'cone');
  updatePool(signPool, 0, false, 0, 0, 'sign');
  updatePool(puddlePool, 0, false, 0, 0, 'puddle');
  for (const h of HAZARDS) updatePool(h.pool, 0, false, 0, 0, h.kind);
  updateCoins(0, false);
  resetBikePose();
}

function resetBikePose() {
  bike.root.position.set(G.x, 0, 0);
  bike.root.rotation.set(0, 0, 0);
  bike.root.scale.setScalar(1);
  bike.lean.rotation.set(0, 0, 0);
  bike.root.visible = true;
}

function startRun(opts = {}) {
  sfx.init();
  sfx.click();
  if (bikeKey !== currentBikeKey()) buildBike();
  MP.active = Boolean(opts.mp);
  MP.oppDone = false;
  MP.oppScore = 0;
  MP.opp = null;
  MP.snaps = [];
  MP.ready = false;
  MP.oppReady = false;
  ghost.root.visible = false;
  resetRun(opts.seed ?? (!opts.mp ? challengeSeed : null) ?? undefined);
  $('hotBanner').classList.add('hidden');
  hideScreens();
  $('hud').classList.remove('hidden');
  $('hudVs').classList.toggle('hidden', !MP.active);
  $('hudAdmin').classList.toggle('hidden', !isAdminMode());
  G.state = 'countdown';
  G.cd = 3.2;
  G.cdShown = 0;
  $('countdown').classList.remove('hidden');
  if (save.stats.runs === 0) {
    toast(isTouchDevice ? 'LEFT THUMB: STEER  ·  RIGHT THUMB: THROTTLE / BRAKE / NOS' : 'ARROWS STEER  ·  UP THROTTLE  ·  DOWN BRAKE  ·  SPACE NITRO');
    toast('Brush past cars for NEAR MISS bonuses');
  }
}

function updateCountdown(rdt) {
  G.cd -= rdt;
  const n = Math.ceil(G.cd - 0.2);
  const el = $('countdown');
  if (n !== G.cdShown) {
    G.cdShown = n;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.innerHTML = `<span>${n > 0 ? n : 'GO!'}</span>`;
    el.classList.add('tick');
    sfx.beep(n <= 0);
  }
  if (G.cd <= 0) {
    G.state = 'playing';
    setTimeout(() => el.classList.add('hidden'), 600);
    sfx.engineStart();
  }
}

function spawnGap() {
  const base = lerp(30, 9, clamp(G.distance / 14000, 0, 1));
  return base * wrand('car', 0.6, 1.3);
}

function scrollWorld(dz) {
  G.distance += dz;
  updateThemes(dz, frameDt);
  updateBoards(dz);
  roadTex.offset.y = (G.distance / TILE) % 1;
  grassTex.offset.y = (G.distance / 10) % 1;
  for (const s of strips) s.update(dz);
}

// 거리 기준 스폰 — 절대 거리 일정표(+=)를 써서 멀티에서 같은 거리 → 같은 결과
const SPAWN_KEYS = ['nextSpawn', 'nextCoins', 'nextPower', 'nextCones', 'nextStall', 'nextPuddle', 'nextSquall', 'nextHazard', 'nextDrop'];
function runSpawners() {
  // 비정상적으로 크게 밀린 경우(디버그 점프 등)만 따라잡기
  for (const k of SPAWN_KEYS) if (G.distance - G[k] > 1500) G[k] = G.distance;
  if (G.distance > G.nextSpawn) {
    spawnCar();
    if (wr('car') < clamp(G.distance / 20000, 0, 0.35)) spawnCar();
    G.nextSpawn += spawnGap();
  }
  if (G.distance > G.nextCoins) {
    spawnCoins();
    G.nextCoins += wrand('coin', 120, 260);
  }
  if (G.distance > G.nextPower) {
    spawnPower();
    G.nextPower += wrand('power', 100, 150); // 100~150m 마다
  }
  if (G.distance > G.nextCones) {
    spawnCones();
    G.nextCones += wrand('cone', 260, 560) * lerp(1, 0.5, clamp(G.distance / 15000, 0, 1));
  }
  if (G.distance > G.nextStall) {
    spawnStall();
    G.nextStall += wrand('stall', 220, 480);
  }
  if (G.distance > G.nextPuddle) {
    spawnPuddle();
    G.nextPuddle += G.rain ? wrand('puddle', 25, 60) : wrand('puddle', 220, 420);
  }
  if (G.distance > G.nextHazard) {
    spawnHazard();
    G.nextHazard += wrand('hazard', 160, 320) * lerp(1, 0.6, clamp(G.distance / 15000, 0, 1));
  }
  if (G.distance > G.nextDrop) {
    spawnDropZone();
    G.nextDrop += wrand('hazard', 450, 700);
  }
  if (G.distance > G.nextSquall) {
    startSquall();
    G.nextSquall += wrand('weather', 2400, 4200);
  }
}

function lightningStrike() {
  G.lightning = 1;
  sfx.thunder();
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function startSquall() {
  G.squallT = SQUALL_TIME;
  G.rain = true;
  G.boltT = rand(4, 8);
  toast('SQUALL WARNING  ·  30s HEAVY RAIN  ·  SCORE x1.3');
  lightningStrike();
}

function updatePlaying(rdt) {
  const ts = G.slowTime > 0 ? 0.55 : 1;
  const dt = rdt * ts;
  G.time += rdt;
  G.slowTime = Math.max(0, G.slowTime - rdt);
  G.magnetTime = Math.max(0, G.magnetTime - rdt);
  G.x2Time = Math.max(0, G.x2Time - rdt);
  G.giantT = Math.max(0, G.giantT - rdt);
  G.invuln = Math.max(0, G.invuln - rdt);
  G.boostTime = Math.max(0, G.boostTime - rdt);
  G.slipT = Math.max(0, G.slipT - rdt);
  if (G.squallT > 0) {
    G.squallT -= rdt;
    G.boltT -= rdt;
    if (G.boltT <= 0 && G.squallT > 2) {
      lightningStrike();
      G.boltT = rand(4, 9);
    }
    if (G.squallT <= 0) {
      G.rain = false;
      toast('SQUALL HAS PASSED');
    }
  }
  if (G.combo > 0) {
    G.comboTimer -= rdt;
    if (G.comboTimer <= 0) G.combo = 0;
  }
  G.feverT = Math.max(0, G.feverT - rdt);

  // 속도: 자동 가속(기본) / 수동 가속(THROTTLE 을 눌러야 가속)
  const bk = getBike(save.bike);
  const maxSpd = bk.maxKmh / 3.6;
  const throttle = keys.ArrowUp || keys.KeyW || held.throttle;
  const brake = keys.ArrowDown || keys.KeyS || held.brake;
  const manual = save.settings.throttle === 'manual';
  const cruise = Math.min(maxSpd * 0.85, (75 + G.distance / 45) / 3.6);
  let target = manual ? 40 / 3.6 : cruise;
  if (throttle) target = maxSpd;
  if (brake) target = 50 / 3.6;
  if (G.draftT > 0 && !brake) target *= 1 + 0.1 * clamp(G.draftT / 0.6, 0, 1); // 슬립스트림 가속
  if (G.slingT > 0) target = Math.max(target, maxSpd * 1.25);                // 슬링샷 부스트
  if (G.boostTime > 0) target = maxSpd * 1.35;
  const accel = target > G.speed ? (G.boostTime > 0 || G.slingT > 0 ? 30 : 7 * bk.accel) : brake ? 22 : manual ? 5 : 6;
  if (!G.air) G.speed = approach(G.speed, target, accel * rdt); // 공중에선 속도 유지
  G.braking = Boolean(brake);
  // RPM: 스로틀을 감으면 빠르게 치솟고, 놓으면 떨어짐
  const spdRatio = clamp(G.speed / (maxSpd * 1.35), 0, 1);
  const rpmTarget = G.boostTime > 0 ? 1 : throttle ? clamp(0.72 + spdRatio * 0.25 + Math.sin(G.time * 40) * 0.03, 0, 1) : 0;
  G.rpm = approach(G.rpm, rpmTarget, rdt * (rpmTarget > G.rpm ? 3.2 : 2.2));

  // 조향 (물웅덩이에 미끄러지면 반응이 둔해지고 옆으로 밀림)
  const steer = steerInput();
  const handling = bk.handling * (G.rain ? 0.85 : 1);
  const latMax = (7 + G.speed * 0.1) * handling;
  const slipping = G.slipT > 0;
  const resp = slipping ? 1.2 : G.air ? 2.5 : G.rain ? 5 : 10;
  // 공중: 좌우 = 스핀(Yaw), 스로틀/위 = 백플립, 브레이크/아래 = 프런트플립. 옆으로는 관성만
  G.vx = lerp(G.vx, G.air ? G.vx * 0.6 : steer * latMax, 1 - Math.exp(-rdt * resp));
  if (G.air) updateAirTricks(rdt, steer, throttle, brake);
  if (slipping) G.vx += G.slipDir * 7 * rdt * (G.slipT / 1.3);
  G.x += G.vx * rdt;
  if (Math.abs(G.x) > ROAD_HALF) {
    G.x = Math.sign(G.x) * ROAD_HALF;
    G.vx = 0;
  }
  G.lean = lerp(G.lean, (-G.vx / latMax) * 0.55 + (slipping ? Math.sin(G.time * 20) * 0.08 : 0), 1 - Math.exp(-rdt * 10));

  // 견인트럭 점프 비행
  if (G.air) {
    G.airVy -= GRAVITY * dt;
    G.airY += G.airVy * dt;
    if (G.airY <= 0) land();
  }

  const dz = G.speed * dt;
  scrollWorld(dz);

  // 점수 — 역주행 차선: 우측통행 국가는 왼쪽, 좌측통행 국가는 오른쪽
  G.ds = driveSign(G.distance);
  const onc = G.x * G.ds < -0.3;
  if (onc) {
    G.oncomingDist += dz;
    addNitro(dt * 3);
  }
  let mult = 1 + Math.min(G.combo, 20) * 0.1;
  if (onc) mult *= 2;
  if (G.x2Time > 0) mult *= 2;
  if (G.boostTime > 0) mult *= 1.5;
  if (G.rain) mult *= 1.3;
  if (G.feverT > 0) mult *= 3;
  G.mult = mult;
  G.onc = onc;
  G.score += dz * 0.6 * mult;
  G.maxKmh = Math.max(G.maxKmh, Math.round(G.speed * 3.6));

  runSpawners();

  updateCars(dt, true);
  if (G.state !== 'playing') return;
  updateDraft(dt);
  updateMarkers();
  updateHotDelivery(rdt);
  updateFeverTrails();
  updatePool(conePool, dt, true, 0.24, 0.25, 'cone');
  updatePool(signPool, dt, true, 0.62, 0.2, 'sign');
  updatePool(puddlePool, dt, true, 1.0, 1.6, 'puddle');
  for (const h of HAZARDS) updatePool(h.pool, dt, true, h.hw, h.hl, h.kind);
  updateDropZones(dt, true);
  updateStalls(dt, true);
  if (G.state !== 'playing') return;
  updateCoins(dt, true);
  updatePowerups(dt, true);
  checkMissions();
  poseBike();
  sfx.engineUpdate(G.speed / (maxSpd * 1.35), G.boostTime > 0);
  sfx.setIntensity(spdRatio, G.boostTime > 0);
}

function startJump(c) {
  G.air = true;
  G.isAirborne = true;
  G.airY = 0.4;
  G.airVy = 9 + G.speed * 0.12; // 공중 묘기를 할 수 있도록 체공 시간 확보
  G.rotPitch = 0;
  G.rotYaw = 0;
  G.rotationCount = 0;
  G.rotShown = 0;
  G.jumps++;
  c.passed = true;
  sfx.jump();
  vibrate(30);
  popup('AIRBORNE', 'big', isTouchDevice ? 'STEER = SPIN · THROTTLE / BRAKE = FLIP' : 'LEFT/RIGHT = SPIN · UP/DOWN = FLIP');
}

// 가장 가까운 한 바퀴(2π 배수)까지 남은 각도
const offLevel = (a) => Math.abs(a - Math.round(a / (Math.PI * 2)) * Math.PI * 2);

function updateAirTricks(rdt, steer, throttle, brake) {
  const flip = (throttle ? 1 : 0) - (brake ? 1 : 0);
  G.rotYaw += steer * AIR_SPIN * rdt;
  G.rotPitch += flip * AIR_FLIP * rdt;
  // 입력이 없으면 가까운 수평 자세로 살짝 맞춰 줌 (착지 보조)
  const snap = (a) => {
    const t = Math.round(a / (Math.PI * 2)) * Math.PI * 2;
    return Math.abs(t - a) < 0.6 ? approach(a, t, 3 * rdt) : a;
  };
  if (!steer) G.rotYaw = snap(G.rotYaw);
  if (!flip) G.rotPitch = snap(G.rotPitch);
  G.rotationCount = Math.floor((Math.abs(G.rotYaw) + Math.abs(G.rotPitch)) / (Math.PI * 2) + 0.08);
  if (G.rotationCount > G.rotShown) {
    G.rotShown = G.rotationCount;
    popup(G.rotationCount === 1 ? '360!' : `${G.rotationCount * 360}!`, 'combo', `${G.rotationCount} ROTATION${G.rotationCount > 1 ? 'S' : ''}`);
    sfx.near(true);
  }
}

function land() {
  G.air = false;
  G.isAirborne = false;
  G.airY = 0;
  G.airVy = 0;
  // 착지 판정: 차체가 수평(한 바퀴 단위)에 가까워야 성공, 아니면 크래시
  const clean = offLevel(G.rotPitch) < LAND_TOL && offLevel(G.rotYaw) < LAND_TOL;
  const rots = G.rotationCount;
  if (!clean) {
    popup('CRASH LANDING!', 'big');
    crash({ x: G.x - 0.5 });
    return;
  }
  G.rotPitch = 0;
  G.rotYaw = 0;
  G.invuln = Math.max(G.invuln, 0.5); // 착지 직후 잠깐 무적
  const base = TRICK_BONUS[Math.min(rots, 3)];
  const pts = Math.round(base * (G.x2Time > 0 ? 2 : 1));
  G.score += pts;
  if (rots > 0) G.tricks += rots;
  addNitro(20 + rots * 10);
  if (rots >= 3) {
    G.slingT = 1.8; // 3회전 이상: 스피드 부스트
    popup('INSANE TRICK!', 'perfect', `CLEAN LANDING x${rots} · +${fmt(pts)} · BOOST`);
  } else {
    popup(rots ? 'CLEAN LANDING!' : 'AIR JUMP!', 'perfect', `${rots ? `x${rots} · ` : ''}+${fmt(pts)}`);
  }
  G.shake = 0.5;
  sfx.land();
  vibrate(40);
}

function hitPuddle() {
  G.slipT = 1.3;
  G.slipDir = Math.random() < 0.5 ? -1 : 1;
  sfx.splash();
  vibrate(20);
  popup('SLIPPING!', 'power');
  screenRain.splash(16);
}

const pivotTmp = new THREE.Vector3();
const AIR_PIVOT = 0.9; // 공중 회전 중심 높이 (차체 가운데)
function poseBike() {
  if (G.air && (G.rotPitch || G.rotYaw)) {
    bike.root.rotation.set(G.rotPitch, G.rotYaw, 0, 'YXZ');
    pivotTmp.set(0, AIR_PIVOT, 0).applyEuler(bike.root.rotation);
    bike.root.position.set(G.x - pivotTmp.x, (G.airY || 0) + AIR_PIVOT - pivotTmp.y, -pivotTmp.z);
  } else {
    bike.root.rotation.set(0, 0, 0);
    bike.root.position.set(G.x, G.airY || 0, 0);
  }
  // 거대화: 차체 1.8배
  const gs = approach(bike.root.scale.x, G.giantT > 0 ? 1.8 : 1, 0.06);
  bike.root.scale.setScalar(gs);
  bike.lean.rotation.z = G.lean;
  bike.lean.rotation.x = G.air ? clamp(-G.airVy * 0.03, -0.3, 0.25) : G.boostTime > 0 ? -0.06 : 0;
  bike.flame.visible = G.boostTime > 0;
  if (bike.flame.visible) bike.flame.scale.set(1, 1, rand(0.7, 1.3));
  shieldBubble.visible = G.shield;
  shieldBubble.material.opacity = 0.18 + Math.sin(G.time * 6) * 0.06;
  bike.root.visible = G.invuln > 0 && G.boostTime <= 0 && G.giantT <= 0 && !G.air ? Math.floor(G.time * 12) % 2 === 0 : true;
  // 브레이크: 스톱램프 점등 + 노면 반사 글로우
  const braking = G.braking && G.state === 'playing';
  if (bike.tailMat) bike.tailMat.emissiveIntensity = braking ? 5 : M.tailMat.emissiveIntensity;
  if (bike.brakeGlow) bike.brakeGlow.material.opacity = approach(bike.brakeGlow.material.opacity, braking ? 0.9 : 0, 0.2);
}

function updateAttract(rdt) {
  G.time += rdt;
  G.speed = 24;
  G.x = Math.sin(G.time * 0.5) * 0.25;
  G.lean = -Math.cos(G.time * 0.5) * 0.1;
  G.braking = false;
  scrollWorld(G.speed * rdt);
  if (G.distance > G.nextSpawn) {
    spawnCar();
    G.nextSpawn = G.distance + rand(10, 22);
  }
  updateCars(rdt, false);
  updateStalls(rdt, false);
  poseBike();
  sfx.setIntensity(0.15, false);
}

function tryBoost() {
  if (G.state !== 'playing' || G.nitro < 100 || G.boostTime > 0) return;
  G.nitro = 0;
  G.boostTime = BOOST_TIME;
  G.boostsUsed++;
  G.shake = 0.4;
  sfx.boost();
  vibrate(40);
  popup('NITRO!', 'big');
}

function nearMiss(c, gap) {
  G.combo++;
  G.comboTimer = 3;
  if (G.combo % 5 === 0) startFever(); // 5연속 니어미스 → 피버
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.nearMiss++;
  const perfect = gap < 0.35;
  let pts = 100 * (1 + G.combo * 0.25) * (perfect ? 2 : 1) * (c.type === 'police' ? 2 : 1) * (c.dir < 0 ? 1.5 : 1);
  if (G.x2Time > 0) pts *= 2;
  pts = Math.round(pts);
  G.score += pts;
  addNitro(perfect ? 22 : 14);
  const tag = c.type === 'police' ? 'POLICE x2  ' : '';
  popup(perfect ? 'PERFECT!' : 'NEAR MISS!', perfect ? 'perfect' : '', `${tag}+${pts}`);
  if (G.combo >= 2 && G.combo % 5 === 0) popup(`COMBO x${G.combo}`, 'combo');
  sfx.near(perfect);
  vibrate(perfect ? 25 : 12);
}

// kind: 'car' | 'small'(라바콘·표지판) | 'stall'(노점상)
function hitObstacle(o, kind = 'car') {
  if (G.state !== 'playing') return;
  const smashing = G.boostTime > 0 || G.giantT > 0; // 니트로·거대화: 부딪힌 걸 날려버림
  if (G.invuln > 0 && !smashing) return; // 무적(깜빡임) 중엔 통과
  if (kind === 'hole') {
    // 구멍은 날려버릴 수 없음: 니트로·거대화는 그냥 지나가고, 보호막은 깨지며 통과
    if (smashing) return;
    if (G.shield) {
      G.shield = false;
      G.invuln = 1.2;
      popup('SHIELD BROKEN', 'power');
      sfx.smash();
      return;
    }
    popup('OPEN MANHOLE!', 'big');
    crash(o);
    return;
  }
  if (smashing || G.shield) {
    if (!smashing) {
      G.shield = false;
      G.invuln = 1.2;
      popup('SHIELD BROKEN', 'power');
    } else if (kind === 'car') {
      G.smashed++;
      const pts = 300 * (G.x2Time > 0 ? 2 : 1);
      G.score += pts;
      popup('SMASH!', 'combo', `+${pts}`);
    }
    knockAway(o, kind);
    sfx.smash();
    vibrate(40);
    G.shake = 0.6;
    return;
  }
  crash(o);
}

function knockAway(o, kind) {
  const side = o.x - G.x >= 0 ? 1 : -1;
  o.flying = true;
  o.vx = side * rand(5, 11);
  o.vy = kind === 'car' ? rand(9, 14) : rand(7, 10);
  if (kind === 'car') {
    o.passed = true;
    o.vz = -rand(10, 20);
    o.sx = rand(-4, 4);
    o.sz = -side * rand(3, 7);
    o.flyT = 2.2;
  }
}

function crash(o) {
  G.state = 'crashing';
  G.crashT = 0;
  G.shake = 1.3;
  G.combo = 0;
  G.air = false;
  G.braking = false;
  const side = G.x - o.x >= 0 ? 1 : -1;
  G.cv = { vx: side * rand(3, 6), vy: 8, y: G.airY || 0, rx: rand(-6, -3), rz: -side * rand(4, 8) };
  sfx.crash();
  sfx.engineStop();
  vibrate([90, 40, 160]);
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function updateCrashing(rdt) {
  const dt = rdt * 0.6;
  G.crashT += rdt;
  G.time += rdt;
  G.speed = Math.max(0, G.speed - 30 * dt);
  G.rpm = Math.max(0, G.rpm - rdt * 2);
  scrollWorld(G.speed * dt);
  updateCars(dt, false);
  updatePool(conePool, dt, false, 0, 0, 'cone');
  updatePool(signPool, dt, false, 0, 0, 'sign');
  updatePool(puddlePool, dt, false, 0, 0, 'puddle');
  for (const h of HAZARDS) updatePool(h.pool, dt, false, 0, 0, h.kind);
  updateDropZones(dt, false);
  updateStalls(dt, false);
  updateCoins(dt, false);
  updatePowerups(dt, false);
  updateMarkers();
  updateFeverTrails();
  const cv = G.cv;
  cv.vy -= 22 * dt;
  cv.y += cv.vy * dt;
  if (cv.y < 0) {
    cv.y = 0;
    cv.vy = -cv.vy * 0.35;
    cv.vx *= 0.6;
    cv.rx *= 0.6;
    cv.rz *= 0.6;
  }
  G.x = clamp(G.x + cv.vx * dt, -8, 8);
  G.airY = 0;
  bike.root.position.set(G.x, cv.y, 0);
  bike.root.rotation.x += cv.rx * dt;
  bike.root.rotation.z += cv.rz * dt;
  bike.root.visible = true;
  bike.flame.visible = false;
  shieldBubble.visible = false;
  if (G.crashT > 1.7) showGameOver();
}

// ---------- 미션
function missionValue(type) {
  switch (type) {
    case 'near': return G.nearMiss;
    case 'dist': return G.distance;
    case 'score': return G.score;
    case 'coins': return G.coinsRun;
    case 'oncoming': return G.oncomingDist;
    case 'boost': return G.boostsUsed;
    case 'combo': return G.maxCombo;
    case 'speed': return G.maxKmh;
    case 'smash': return G.smashed;
    case 'jump': return G.jumps;
    default: return 0;
  }
}

function checkMissions() {
  for (const m of save.missions) {
    if (m.done || missionValue(m.type) < m.target) continue;
    m.done = true;
    save.missionLevels[m.type] = (save.missionLevels[m.type] || 0) + 1;
    save.coins += m.reward;
    G.missionsDone.push(m);
    toast(`MISSION COMPLETE  ·  ${missionText(m)}  ·  +${m.reward} COINS`);
    sfx.mission();
    persist();
  }
}

// ---------- UI 헬퍼
const SCREENS = ['menu', 'garage', 'ranking', 'missions', 'settings', 'pause', 'gameover', 'auth', 'multi', 'daily', 'gacha'];
let currentScreen = null;
function show(id) {
  currentScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  // 모달이 떠 있으면 터치 조작부 전체를 숨김 (모달 위로 뚫고 나오지 않게)
  document.body.classList.toggle('modal-open', Boolean(id));
  if (id === 'garage') mountStage('garageStage', true);
  else if (id === 'ranking') mountStage('rankStage', false);
  else if (stage) stage.unmount();
  if (id === 'garage') startAdTicker();
}

// ---------- 3D 미리보기 (차고 쇼룸 / 랭킹 Flex View) — 렌더러 하나를 공유
let stage = null;
function mountStage(containerId, draggable) {
  stage = stage || new PreviewStage();
  const look = myLook();
  stage.setRider(look.opts, look.color);
  stage.mount($(containerId), { draggable });
  setFlexLabel(`MY RIDE · ${getBike(save.bike).name.toUpperCase()}`, look.opts.flag);
}
function setFlexLabel(text, flag) {
  $('flexLabel').innerHTML = `${flag ? flagBadge(flag, 'flag') : ''}${escapeHtml(text)}`;
}
function hideScreens() { show(null); }

const popupsEl = $('popups');
function popup(text, cls = '', sub = '') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.textContent = text;
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    el.appendChild(s);
  }
  popupsEl.appendChild(el);
  while (popupsEl.children.length > 4) popupsEl.firstChild.remove();
  setTimeout(() => el.remove(), 1250);
}

const toastEl = $('toast');
const toastQ = [];
let toastBusy = false;
function toast(msg) {
  toastQ.push(msg);
  if (!toastBusy) nextToast();
}
function nextToast() {
  const m = toastQ.shift();
  if (!m) {
    toastBusy = false;
    return;
  }
  toastBusy = true;
  toastEl.textContent = m;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
    setTimeout(nextToast, 300);
  }, 2300);
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
// 코인처럼 커질 수 있는 숫자: 1,000,000 이상은 1.25M 형태로 줄여 레이아웃 넘침 방지
const fmtCoins = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e8 ? 0 : n >= 1e7 ? 1 : 2).replace(/\.?0+$/, '')}M` : fmt(n));

const hud = {
  score: $('hudScore'), mult: $('hudMult'), combo: $('hudCombo'), best: $('hudBest'), tags: $('hudTags'),
  speed: $('hudSpeed'), dist: $('hudDist'), coins: $('hudCoins'), nitroBar: $('nitroBar'), nitroWrap: $('nitroWrap'),
  btnNitro: $('btnNitro'), nitroFill: $('nitroFill'), boostFx: $('boostFx'), vs: $('hudVs'),
  speedArc: $('speedArc'), rpmArc: $('rpmArc'), brakeFx: $('brakeFx'),
};
let lastTags = '';
const tagHtml = (ic, text, cls = '') => `<span class="tag ${cls}">${ic ? icon(ic) : ''}${text}</span>`;

function updateHud() {
  const scoreText = fmt(G.score);
  hud.score.textContent = scoreText;
  hud.score.dataset.len = scoreText.length > 9 ? 'xl' : scoreText.length > 7 ? 'l' : '';
  hud.mult.textContent = 'x' + G.mult.toFixed(1);
  hud.mult.classList.toggle('hot', G.mult >= 2);
  hud.combo.classList.toggle('hidden', G.combo < 2);
  if (G.combo >= 2) hud.combo.textContent = `COMBO ${G.combo}`;
  hud.best.textContent = `BEST ${fmt(Math.max(save.best, G.score))}`;
  hud.speed.textContent = Math.round(G.speed * 3.6);
  hud.dist.textContent = `${fmt(G.distance)} m`;
  hud.coins.textContent = fmtCoins(save.coins);
  const maxSpd = (getBike(save.bike).maxKmh / 3.6) * 1.35;
  hud.speedArc.setAttribute('stroke-dasharray', `${(clamp(G.speed / maxSpd, 0, 1) * 100).toFixed(1)} 100`);
  hud.rpmArc.setAttribute('stroke-dasharray', `${(G.rpm * 100).toFixed(1)} 100`);
  const boosting = G.boostTime > 0;
  const fill = boosting ? (G.boostTime / BOOST_TIME) * 100 : G.nitro;
  hud.nitroBar.style.width = fill + '%';
  hud.nitroWrap.classList.toggle('ready', G.nitro >= 100 && !boosting);
  hud.nitroWrap.classList.toggle('boost', boosting);
  hud.nitroFill.style.height = fill + '%';
  hud.btnNitro.classList.toggle('ready', G.nitro >= 100 && !boosting);
  hud.btnNitro.classList.toggle('firing', boosting);
  hud.boostFx.classList.toggle('on', boosting);
  hud.boostFx.classList.toggle('slow', !boosting && G.slowTime > 0);
  hud.brakeFx.classList.toggle('on', G.braking && G.state === 'playing');
  $('feverFx').classList.toggle('on', G.feverT > 0 && G.state === 'playing');

  if (MP.active) {
    if (MP.opp) {
      const diff = Math.round(MP.opp.d - G.distance);
      const st = MP.oppDone ? 'FINISHED' : diff >= 0 ? `+${diff} m` : `${diff} m`;
      hud.vs.textContent = `GHOST ${MP.oppName}  ${fmt(MP.oppDone ? MP.oppScore : MP.opp.sc)}  ·  ${st}`;
    } else {
      hud.vs.textContent = net.connected ? 'WAITING FOR RIVAL' : 'RIVAL DISCONNECTED';
    }
  }

  const tags = [];
  if (G.feverT > 0) tags.push(tagHtml('bolt', `FEVER x3 ${Math.ceil(G.feverT)}s`, 'fever'));
  if (G.slingT > 0) tags.push(tagHtml('bolt', 'SLINGSHOT'));
  if (G.giantT > 0) tags.push(tagHtml('giant', `GIANT ${Math.ceil(G.giantT)}s`, 'fever'));
  if (G.air && G.rotationCount > 0) tags.push(tagHtml('flip', `TRICK x${G.rotationCount}`));
  else if (G.draftT > 0) tags.push(tagHtml('gauge', 'SLIPSTREAM'));
  if (G.onc) tags.push(tagHtml('warn', 'WRONG WAY x2', 'onc'));
  if (G.air) tags.push(tagHtml('jump', 'AIRBORNE'));
  if (G.shield) tags.push(tagHtml('shield', 'SHIELD'));
  if (G.magnetTime > 0) tags.push(tagHtml('magnet', `MAGNET ${Math.ceil(G.magnetTime)}s`));
  if (G.x2Time > 0) tags.push(tagHtml('x2', `x2 SCORE ${Math.ceil(G.x2Time)}s`));
  if (G.slowTime > 0) tags.push(tagHtml('clock', `SLOW-MO ${Math.ceil(G.slowTime)}s`));
  if (G.rain) tags.push(tagHtml('rain', `SQUALL ${Math.ceil(Math.max(0, G.squallT))}s · x1.3`));
  if (G.slipT > 0) tags.push(tagHtml('drop', 'SLIPPING', 'onc'));
  const html = tags.join('');
  if (html !== lastTags) {
    hud.tags.innerHTML = html;
    lastTags = html;
  }
}

// ---------- 화면: 메뉴
function goMenu() {
  sfx.engineStop();
  if (MP.active) leaveRoom();
  MP.active = false;
  ghost.root.visible = false;
  resetRun();
  G.x = 0;
  G.state = 'menu';
  $('hud').classList.add('hidden');
  $('countdown').classList.add('hidden');
  $('brakeFx').classList.remove('on');
  refreshMenu();
  show('menu');
}

function refreshMenu() {
  $('challengeChip').classList.toggle('hidden', challengeSeed == null);
  if (challengeSeed != null) $('challengeText').textContent = `CHALLENGE ROAD #${challengeSeed}`;
  const s = getSession();
  $('menuName').textContent = s ? s.nickname : save.lastName || 'Rider';
  $('accountLabel').textContent = s ? s.nickname.toUpperCase() : 'SIGN IN';
  $('menuBest').textContent = fmt(save.best);
  $('menuCoins').textContent = fmtCoins(save.coins);
  $('adminBadge').classList.toggle('hidden', !isAdminMode());
  $('guestNote').classList.toggle('hidden', Boolean(s) && isServerReady());
  $('guestNote').textContent = s ? 'OFFLINE · progress is not being saved' : 'GUEST · sign in to save coins and items';
}

let backTo = 'menu';
function openScreen(id, from = 'menu') {
  sfx.init();
  sfx.click();
  backTo = from;
  show(id);
}
$('btnPlay').addEventListener('click', () => startRun());
$('btnClearChallenge').addEventListener('click', () => {
  challengeSeed = null;
  history.replaceState(null, '', location.pathname);
  refreshMenu();
});
$('btnGarage').addEventListener('click', () => { renderGarage(); openScreen('garage'); });
$('btnRanking').addEventListener('click', () => { rankCountry = save.country; openScreen('ranking'); renderRanking(); });
$('btnMissions').addEventListener('click', () => { renderMissions(); openScreen('missions'); });
$('btnSettings').addEventListener('click', () => { renderSettings(); openScreen('settings'); });
$('btnAccount').addEventListener('click', () => { renderAuth(); openScreen('auth'); });
$('btnMulti').addEventListener('click', () => { renderMulti(); openScreen('multi'); });
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => {
    sfx.click();
    if (backTo === 'gameover') {
      show('gameover');
      submitGlobal();
    } else {
      refreshMenu();
      show('menu');
    }
    backTo = 'menu';
  });
}

// ---------- 차고 (바이크 / 배달 상자 / 라이더 의상·헬멧 / 국기)
let garageTab = 'bike';
const SHOP = {
  box: { list: BOXES, owned: 'ownedBoxes', cur: 'box' },
  outfit: { list: OUTFITS, owned: 'ownedOutfits', cur: 'outfit' },
  helmet: { list: HELMETS, owned: 'ownedHelmets', cur: 'helmet' },
  flag: { list: FLAGS, owned: 'ownedFlags', cur: 'flag' },
};

function shopButton(kind, item, owned, sel) {
  if (sel) return '<button class="btn" disabled>EQUIPPED</button>';
  // 관리자 모드: 구매 없이 모든 아이템 장착
  if (owned || isAdminMode()) return `<button class="btn primary" data-kind="${kind}" data-id="${item.id}" data-act="select">EQUIP</button>`;
  if (item.special === 'national') return '<button class="btn" disabled>#1 ONLY</button>';
  if (item.special) return '<button class="btn" disabled>7-DAY STREAK</button>';
  return `<button class="btn gold" data-kind="${kind}" data-id="${item.id}" data-act="buy" data-icon="coin" ${save.coins < item.price ? 'disabled' : ''}>${icon('coin')}${fmtCoins(item.price)}</button>`;
}

function renderShopItems(kind) {
  const { list, owned, cur } = SHOP[kind];
  return list.map((it) => {
    const o = save[owned].includes(it.id), sel = save[cur] === it.id;
    const sw = kind === 'flag'
      ? `<div class="swatch flag-swatch">${flagBadge(it.code, 'flag big')}</div>`
      : `<div class="swatch" style="background:${it.swatch}"></div>`;
    return `<div class="bike-card ${sel ? 'selected' : ''}">${sw}
      <div><h4>${escapeHtml(it.name)}</h4><p>${escapeHtml(it.desc)}</p></div>${shopButton(kind, it, o, sel)}</div>`;
  }).join('');
}

// 국가대표 바이크 카드 (국가 1위만 / 관리자)
function nationalCard() {
  const b = getBike('national');
  const here = countryName(save.country);
  const can = save.nationalUnlocked || isAdminMode();
  const sel = save.bike === 'national';
  const [c1, c2] = nationalLivery(myNationalCode()).map((c) => '#' + c.toString(16).padStart(6, '0'));
  const lock = can ? '' : 'locked';
  const desc = can
    ? `${save.nationalUnlocked ? `You are #1 in ${escapeHtml(here)}.` : 'Admin mode.'} Painted in national colors · TOP ${b.maxKmh} KM/H`
    : `Locked. Reach #1 in the ${escapeHtml(here)} ranking to ride it. Lose #1 and it is taken back.`;
  return `<div class="bike-card national-item ${lock} ${sel ? 'selected' : ''}">
    <div class="bike-icon ${can ? '' : 'mystery'}" style="${can ? `background:linear-gradient(135deg, ${c1} 50%, ${c2} 50%)` : ''}">${can ? flagBadge(myNationalCode(), 'flag big') : '?'}</div>
    <div><h4>${escapeHtml(b.name)} · ${escapeHtml(here)}</h4><p>${desc}</p>
      <div class="stat">SPEED<i><b style="width:${(b.maxKmh / 320) * 100}%"></b></i></div></div>
    ${sel ? '<button class="btn" disabled>EQUIPPED</button>' : can ? '<button class="btn primary" data-kind="bike" data-id="national" data-act="select">EQUIP</button>' : '<button class="btn" disabled>#1 ONLY</button>'}</div>`;
}

function renderGarage() {
  $('garageCoins').textContent = fmtCoins(save.coins);
  if (stage) {
    const look = myLook();
    stage.setRider(look.opts, look.color);
  }
  $('btnGacha').disabled = save.coins < GACHA_PRICE;
  $('btnAdCoins').classList.toggle('hidden', !adsEnabled());
  updateAdCoinsLabel();
  for (const b of $('garageTabs').children) b.classList.toggle('on', b.dataset.tab === garageTab);
  const list = $('shopList');
  const adminNote = isAdminMode() ? '<div class="admin-note">ADMIN MODE · every item unlocked · scores are not recorded</div>' : '';
  if (garageTab === 'bike') {
    $('garageHint').textContent = 'Faster bikes rack up distance points faster.';
    list.innerHTML = adminNote + nationalCard() + BIKES.filter((b) => !b.special).map((b) => {
      const owned = save.ownedBikes.includes(b.id);
      const sel = save.bike === b.id;
      const hex = '#' + b.color.toString(16).padStart(6, '0');
      return `<div class="bike-card ${sel ? 'selected' : ''}">
        <div class="bike-icon" style="background:${hex}33;border:2px solid ${hex};color:${hex === '#f2f2f2' ? '#5b6470' : hex}">${icon('bike')}</div>
        <div><h4>${escapeHtml(b.name)}</h4><p>${escapeHtml(b.desc)} · TOP ${b.maxKmh} KM/H</p>
          <div class="stat">SPEED<i><b style="width:${(b.maxKmh / 320) * 100}%"></b></i></div>
          <div class="stat">HANDLING<i><b style="width:${(b.handling / 1.6) * 100}%"></b></i></div>
          <div class="stat">ACCEL<i><b style="width:${(b.accel / 1.7) * 100}%"></b></i></div>
        </div>${shopButton('bike', b, owned, sel)}</div>`;
    }).join('');
  } else if (garageTab === 'box') {
    $('garageHint').textContent = 'Delivery box skins (cosmetic only).';
    list.innerHTML = adminNote + renderShopItems('box');
  } else if (garageTab === 'flag') {
    $('garageHint').textContent = 'World flags for your helmet, bike and delivery box.';
    const none = `<div class="bike-card ${save.flag ? '' : 'selected'}"><div class="swatch mystery">-</div>
      <div><h4>No Flag</h4><p>Ride without a flag</p></div>${save.flag ? '<button class="btn primary" data-kind="flag" data-id="" data-act="select">EQUIP</button>' : '<button class="btn" disabled>EQUIPPED</button>'}</div>`;
    list.innerHTML = adminNote + none + renderShopItems('flag');
  } else {
    $('garageHint').textContent = 'Customize your rider outfit and helmet.';
    list.innerHTML = `${adminNote}<div class="shop-section">OUTFIT</div>${renderShopItems('outfit')}<div class="shop-section">HELMET</div>${renderShopItems('helmet')}`;
  }
}

$('garageTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  garageTab = b.dataset.tab;
  sfx.click();
  renderGarage();
});

$('shopList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const { kind, id, act } = btn.dataset;
  const isBike = kind === 'bike';
  const item = isBike ? getBike(id) : SHOP[kind].list.find((x) => x.id === id);
  const ownedKey = isBike ? 'ownedBikes' : SHOP[kind].owned;
  const curKey = isBike ? 'bike' : SHOP[kind].cur;
  if (act === 'buy') {
    if (!item || item.price <= 0 || save.coins < item.price || isAdminMode()) return;
    save.coins -= item.price;
    save[ownedKey].push(id);
    sfx.power();
    toast(`UNLOCKED  ·  ${item.name}`);
  } else {
    const allowed = isAdminMode() || id === '' || (id === 'national' ? save.nationalUnlocked : save[ownedKey].includes(id));
    if (!allowed) return;
    sfx.click();
  }
  if (isBike && id === 'national' && save.bike !== 'national') save.prevBike = save.bike;
  save[curKey] = id;
  persist();
  buildBike();
  resetBikePose();
  renderGarage();
});

// ---------- 랜덤 가차 상자 (1,000 코인)
let gachaResult = null;
$('btnGacha').addEventListener('click', () => {
  if (save.coins < GACHA_PRICE) return;
  const pool = [];
  for (const [kind, cat] of Object.entries(SHOP)) {
    if (kind !== 'flag') for (const it of cat.list) if (it.price > 0 && !it.special && !save[cat.owned].includes(it.id)) pool.push({ kind, it });
  }
  save.coins -= GACHA_PRICE;
  const reveal = $('gachaReveal');
  if (!pool.length) {
    save.coins += GACHA_REFUND;
    gachaResult = null;
    reveal.innerHTML = `<div class="swatch" style="background:#ffd34d"></div><b>ALL COLLECTED!</b><span class="muted">Refunded ${fmt(GACHA_REFUND)} coins</span>`;
  } else {
    gachaResult = pick(pool);
    save[SHOP[gachaResult.kind].owned].push(gachaResult.it.id);
    const label = { box: 'DELIVERY BOX', outfit: 'OUTFIT', helmet: 'HELMET' }[gachaResult.kind];
    reveal.innerHTML = `<div class="swatch" style="background:${gachaResult.it.swatch}"></div><small class="muted">${label}</small><b>${escapeHtml(gachaResult.it.name)}</b><span class="muted">${escapeHtml(gachaResult.it.desc)}</span>`;
  }
  $('btnGachaEquip').classList.toggle('hidden', !gachaResult);
  persist();
  sfx.fireworks();
  show('gacha');
});
$('btnGachaEquip').addEventListener('click', () => {
  if (gachaResult) {
    save[SHOP[gachaResult.kind].cur] = gachaResult.it.id;
    persist();
    buildBike();
    resetBikePose();
  }
  renderGarage();
  show('garage');
});
$('btnGachaClose').addEventListener('click', () => {
  renderGarage();
  show('garage');
});

// ---------- 차고 무료 코인 (보상형 광고, 3분 쿨타임)
const adHooks = { pause: () => sfx.suspend(), resume: () => sfx.resume() };
function updateAdCoinsLabel() {
  const left = Math.ceil((save.adCooldownUntil - Date.now()) / 1000);
  const btn = $('btnAdCoins');
  btn.disabled = left > 0;
  $('adCoinsLabel').textContent = left > 0
    ? `NEXT FREE COINS IN ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`
    : `WATCH AD FOR ${ADS.freeCoins} COINS`;
}
let adTicker = null;
function startAdTicker() {
  clearInterval(adTicker);
  adTicker = setInterval(() => {
    if (currentScreen !== 'garage') {
      clearInterval(adTicker);
      return;
    }
    updateAdCoinsLabel();
  }, 1000);
}
$('btnAdCoins').addEventListener('click', async () => {
  if (Date.now() < save.adCooldownUntil) return;
  const ok = await showRewarded('free_coins', adHooks);
  if (!ok) return;
  save.coins += ADS.freeCoins;
  save.adCooldownUntil = Date.now() + ADS.freeCoinsCooldownSec * 1000;
  persist();
  toast(`+${ADS.freeCoins} COINS`);
  sfx.coin();
  renderGarage();
});

// ---------- 국가 랭킹 (행을 누르면 그 라이더의 3D 바이크/라이더 조합을 미리보기)
let rankCountry = null;
let rankRows = [];
let rankSel = -1;

function countryOptions(extra) {
  const codes = [...new Set([extra, save.country, ...COUNTRY_CODES].filter(isCountryCode))];
  return codes.map((c) => `<option value="${c}">${escapeHtml(countryName(c))}</option>`).join('');
}

function rankTable(rows) {
  return `<table class="rank-table selectable"><thead><tr><th>#</th><th>RIDER</th><th class="num">BEST</th><th>BIKE</th></tr></thead><tbody>${
    rows.map((r, i) => `<tr class="${r.isMe ? 'me' : ''} ${i === rankSel ? 'sel' : ''}" data-row="${i}">
      <td>${i < 3 ? `<b class="medal m${i + 1}">${i + 1}</b>` : i + 1}</td>
      <td>${i === 0 && r.country ? flagBadge(r.country, 'flag big') : ''}${escapeHtml(r.nickname)}${r.dist ? `<br><small class="muted">${fmt(r.dist)} m</small>` : ''}</td>
      <td class="num"><b>${fmt(r.score)}</b></td>
      <td><small>${escapeHtml(getBike(r.bike).name)}</small></td></tr>`).join('')
  }</tbody></table>`;
}

// i = -1 → 내 라이더
function selectRankRow(i) {
  rankSel = i;
  for (const tr of $('rankList').querySelectorAll('tr[data-row]')) tr.classList.toggle('sel', Number(tr.dataset.row) === i);
  if (!stage) return;
  const r = rankRows[i];
  if (!r) {
    const look = myLook();
    stage.setRider(look.opts, look.color);
    setFlexLabel(`MY RIDE · ${getBike(save.bike).name.toUpperCase()}`, look.opts.flag);
    return;
  }
  const look = rowLook(r);
  stage.setRider(look.opts, look.color);
  setFlexLabel(`#${i + 1} ${String(r.nickname).toUpperCase()} · ${getBike(r.bike).name.toUpperCase()}`, r.country);
}

async function renderRanking() {
  const list = $('rankList'), me = $('rankMe'), mode = $('rankMode');
  const sel = $('rankCountry');
  rankCountry = rankCountry || save.country;
  sel.innerHTML = countryOptions(rankCountry);
  sel.value = rankCountry;
  mode.textContent = ONLINE ? 'ONLINE' : 'LOCAL MODE';
  mode.className = ONLINE ? 'badge' : 'badge local';
  list.innerHTML = '<div class="empty">Loading...</div>';
  me.innerHTML = '';
  rankRows = [];
  selectRankRow(-1);
  const country = rankCountry;
  const res = await leaderboard.fetchTop({ country });
  if (rankCountry !== country || currentScreen !== 'ranking') return;
  if (!res.ok) {
    list.innerHTML = `<div class="empty">Could not load the ranking<br><small>${escapeHtml(res.error)}</small></div>`;
    return;
  }
  regionTops[country] = res.top;
  if (country === save.country && res.me) applyNationalStatus(res.me.rank === 1, res.me.country);
  rankRows = res.top;
  rankSel = rankRows.length ? 0 : -1;
  list.innerHTML = rankRows.length
    ? rankTable(rankRows)
    : `<div class="empty">No records in ${escapeHtml(countryName(country))} yet.<br>Be the first rider on the board!</div>`;
  selectRankRow(rankSel);
  const s = getSession();
  if (!s) me.innerHTML = 'Sign in to see your rank <button class="btn primary" id="rankLogin">SIGN IN</button>';
  else if (res.me) me.innerHTML = `YOUR RANK IN ${escapeHtml(countryName(country).toUpperCase())} <b>#${res.me.rank}</b> · <b>${fmt(res.me.score)}</b> <button class="btn small" id="rankMine">MY RIDE</button>`;
  else me.innerHTML = `${escapeHtml(s.nickname)} has no record in ${escapeHtml(countryName(country))} <button class="btn small" id="rankMine">MY RIDE</button>`;
  if (!ONLINE) me.innerHTML += '<br><small class="muted">No server configured: ranking is shared only between accounts on this device (js/config.js)</small>';
  $('rankLogin')?.addEventListener('click', () => { renderAuth(); openScreen('auth', 'menu'); });
  $('rankMine')?.addEventListener('click', () => { sfx.click(); selectRankRow(-1); });
}

$('rankList').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-row]');
  if (!tr) return;
  sfx.click();
  selectRankRow(Number(tr.dataset.row));
});
$('rankCountry').addEventListener('change', (e) => {
  rankCountry = e.target.value;
  renderRanking();
});

// ---------- 로그인 / 회원가입
let authTab = 'login';
function renderAuth() {
  const s = getSession();
  $('authMode').textContent = ONLINE ? 'ONLINE' : 'LOCAL';
  $('authMode').className = ONLINE ? 'badge' : 'badge local';
  $('authForms').classList.toggle('hidden', Boolean(s));
  $('authLogged').classList.toggle('hidden', !s);
  if (s) $('authNick').textContent = s.nickname;
  for (const b of $('authTabs').children) b.classList.toggle('on', b.dataset.auth === authTab);
  $('authPw2Wrap').classList.toggle('hidden', authTab !== 'signup');
  $('authSubmit').textContent = authTab === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN';
  $('authPw').autocomplete = authTab === 'signup' ? 'new-password' : 'current-password';
  $('authMsg').textContent = '';
  $('authMsg').className = 'form-msg';
  $('authNote').textContent = ONLINE
    ? 'Accounts are stored on the server. Only an auto sign-in token is kept on this device.'
    : 'No server configured: accounts and ranking are saved in this browser only.';
}
$('authTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-auth]');
  if (!b) return;
  authTab = b.dataset.auth;
  renderAuth();
});
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('authId').value, pw = $('authPw').value, msg = $('authMsg');
  if (authTab === 'signup' && pw !== $('authPw2').value) {
    msg.textContent = 'Passwords do not match';
    return;
  }
  const btn = $('authSubmit');
  btn.disabled = true;
  msg.className = 'form-msg ok';
  msg.textContent = 'Please wait...';
  const res = authTab === 'signup' ? await auth.signUp(id, pw) : await auth.signIn(id, pw);
  btn.disabled = false;
  if (!res.ok) {
    msg.className = 'form-msg';
    msg.textContent = res.error;
    return;
  }
  $('authPw').value = '';
  $('authPw2').value = '';
  sfx.mission();
  toast(`WELCOME, ${res.user.nickname.toUpperCase()}`);
  await onSignedIn({ uploadBest: true });
  if (backTo === 'gameover') {
    backTo = 'menu';
    show('gameover');
    submitGlobal();
  } else {
    renderAuth();
  }
});
$('btnLogout').addEventListener('click', async () => {
  await auth.signOut(); // 서버에 마지막 저장 후 게스트 기본값으로
  serverAdmin = false;
  authTab = 'login';
  sfx.click();
  toast('SIGNED OUT');
  onDataReplaced();
  renderAuth();
});

// ======================================================================
// 계정 데이터 (서버) 불러오기 / 화면 반영
// ======================================================================
// 서버에서 불러온 설정·장착 상태를 화면/사운드/바이크에 반영
function onDataReplaced() {
  sanitizeEquip();
  sfx.setEnabled(save.settings.sound);
  sfx.setMusic(save.settings.music);
  screenRain.setEnabled(save.settings.wetFx);
  applyQuality();
  applyControlSettings();
  if (bikeKey !== currentBikeKey()) {
    buildBike();
    if (G.state !== 'playing' && G.state !== 'crashing') resetBikePose();
  }
  refreshMenu();
  if (currentScreen === 'garage') renderGarage();
  if (currentScreen === 'settings') renderSettings();
}

// 로그인(자동 로그인 포함) 직후: 서버 데이터 → 국가 고정 → 국가대표 검증 → 출석 보상
async function onSignedIn({ uploadBest = false } = {}) {
  const res = await loadPlayerData();
  if (!res.ok) {
    toast(`SERVER  ·  ${res.error}`);
    refreshMenu();
    return;
  }
  serverAdmin = res.isAdmin;
  if (!res.country) await lockCountry();
  onDataReplaced();
  if (serverAdmin) toast('ADMIN MODE  ·  ALL ITEMS UNLOCKED  ·  SCORES NOT RECORDED');
  // 새 계정이면 게스트로 세운 기록을 올림
  if (uploadBest && res.fresh && save.best > 0) await leaderboard.submit(scoreEntry(save.best, save.bestDist), { admin: isAdminMode() });
  regionTopsDirty(save.country);
  await checkNationalStatus();
  showDailyStreak();
  if (backTo === 'gameover' && currentScreen === 'auth') {
    backTo = 'menu';
    show('gameover');
    submitGlobal();
  } else if (currentScreen === 'auth') {
    renderAuth();
  }
}

// ======================================================================
// 국가대표 바이크: 서버 순위(my_rank_v4 = 1)로만 지급 / 회수
// ======================================================================
function regionTopsDirty(code) {
  delete regionFetchAt[code];
  fetchRegionTop(code, true);
}

// unlocked 가 바뀌었을 때만 처리. 지급 → 즉시 장착, 회수 → 원래 바이크로 리셋
function applyNationalStatus(unlocked, code, { silent = false } = {}) {
  const was = save.nationalUnlocked;
  if (was === unlocked && (!unlocked || save.nationalCode === code)) return;
  save.nationalUnlocked = unlocked;
  save.nationalCode = unlocked ? code : '';
  if (unlocked) {
    if (save.bike !== 'national') save.prevBike = save.bike;
    save.bike = 'national';
    if (!silent) {
      toast(`#1 IN ${countryName(code).toUpperCase()}  ·  NATIONAL TEAM BIKE UNLOCKED`);
      sfx.fireworks();
    }
  } else {
    if (save.bike === 'national' && !isAdminMode()) save.bike = save.ownedBikes.includes(save.prevBike) ? save.prevBike : 'rookie';
    if (was && !silent) toast('YOU LOST #1  ·  NATIONAL TEAM BIKE LOCKED');
  }
  persist();
  if (bikeKey !== currentBikeKey()) {
    buildBike();
    if (G.state !== 'playing' && G.state !== 'crashing') resetBikePose();
  }
  if (currentScreen === 'garage') renderGarage();
  else if (currentScreen === 'ranking' && rankSel < 0) selectRankRow(-1);
}

let nationalChecking = false;
async function checkNationalStatus() {
  if (nationalChecking) return;
  if (!getSession() || !isServerReady()) {
    applyNationalStatus(false, '', { silent: true });
    return;
  }
  nationalChecking = true;
  try {
    const r = await leaderboard.myRank();
    applyNationalStatus(Boolean(r && r.rank === 1), r?.country || save.country);
  } catch (e) {
    // 통신 실패 시 마지막으로 검증된 상태 유지
  } finally {
    nationalChecking = false;
  }
}

// 1위를 뺏기는 순간을 잡기 위해 주기적으로 재확인 (화면이 보일 때만)
setInterval(() => {
  if (document.visibilityState === 'visible') checkNationalStatus();
}, FLAG_CHECK_INTERVAL_SEC * 1000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkNationalStatus();
  else flushSave({ keepalive: true }); // 앱 전환·종료 직전 서버에 저장
});
window.addEventListener('pagehide', () => flushSave({ keepalive: true }));

// ---------- 미션
function renderMissions() {
  $('missionList').innerHTML = save.missions.map((m) => `
    <div class="mission ${m.done ? 'done' : ''}">
      <span>${m.done ? icon('check') + ' ' : ''}${escapeHtml(missionText(m))}</span>
      <span class="reward">${icon('coin')} ${m.reward}</span>
    </div>`).join('');
}

// ---------- 설정
const onOff = (v) => (v ? 'ON' : 'OFF');
const SETTING_LABELS = {
  sound: onOff,
  music: onOff,
  vibrate: onOff,
  wetFx: onOff,
  quality: (v) => (v === 'high' ? 'HIGH' : 'LOW (FAST)'),
  throttle: (v) => (v === 'auto' ? 'AUTO' : 'MANUAL'),
  touchMode: (v) => (v === 'buttons' ? 'BUTTONS' : 'DRAG PAD'),
};
function renderSettings() {
  for (const b of document.querySelectorAll('[data-setting]')) {
    b.textContent = SETTING_LABELS[b.dataset.setting](save.settings[b.dataset.setting]);
  }
  const src = { server: 'LOCKED', ip: 'IP', tz: 'ESTIMATED' }[save.countrySource] || '';
  $('countryLabel').innerHTML = `${flagBadge(save.country)}${escapeHtml(countryName(save.country))} <small class="muted">${isAdminMode() ? 'ADMIN' : src}</small>`;
  // 관리자만 국가를 바꿀 수 있음
  const sel = $('adminCountry');
  sel.classList.toggle('hidden', !isAdminMode());
  $('countryLabel').classList.toggle('hidden', isAdminMode());
  if (isAdminMode()) {
    sel.innerHTML = countryOptions(save.country);
    sel.value = save.country;
  }
  const showAdmin = ADMIN_DEBUG_TOGGLE && DEBUG && !serverAdmin;
  $('adminRow').classList.toggle('hidden', !showAdmin && !serverAdmin);
  $('btnAdmin').textContent = isAdminMode() ? 'ON' : 'OFF';
  $('btnAdmin').disabled = serverAdmin;
}
$('adminCountry').addEventListener('change', async (e) => {
  if (!isAdminMode()) return;
  const code = e.target.value;
  // 관리자 계정은 서버에도 저장 (admin_set_country), 디버그 관리자는 이번 접속에만
  if (serverAdmin) {
    const res = await adminSetCountry(code);
    if (!res.ok) {
      toast(`COUNTRY  ·  ${res.error}`);
      renderSettings();
      return;
    }
  }
  save.country = code;
  toast(`ADMIN  ·  COUNTRY ${countryName(code).toUpperCase()}`);
  regionTopsDirty(code);
  onDataReplaced();
  renderSettings();
});
// 디버그 전용 관리자 토글 (?debug). 이번 접속에만 적용, 랭킹 기록 차단
$('btnAdmin').addEventListener('click', () => {
  if (serverAdmin || !DEBUG) return;
  debugAdmin = !debugAdmin;
  sfx.click();
  toast(debugAdmin ? 'ADMIN MODE ON  ·  SCORES NOT RECORDED' : 'ADMIN MODE OFF');
  onDataReplaced();
  renderSettings();
});
function applyControlSettings() {
  document.body.classList.toggle('drag-mode', save.settings.touchMode === 'drag');
  document.body.classList.toggle('auto-throttle', save.settings.throttle === 'auto');
}
applyControlSettings();

for (const b of document.querySelectorAll('[data-setting]')) {
  b.addEventListener('click', () => {
    const k = b.dataset.setting;
    const s = save.settings;
    if (k === 'sound') { s.sound = !s.sound; sfx.setEnabled(s.sound); }
    if (k === 'music') { s.music = !s.music; sfx.init(); sfx.setMusic(s.music); }
    if (k === 'vibrate') { s.vibrate = !s.vibrate; vibrate(30); }
    if (k === 'wetFx') { s.wetFx = !s.wetFx; screenRain.setEnabled(s.wetFx); }
    if (k === 'quality') { s.quality = s.quality === 'high' ? 'low' : 'high'; applyQuality(); }
    if (k === 'throttle') s.throttle = s.throttle === 'auto' ? 'manual' : 'auto';
    if (k === 'touchMode') s.touchMode = s.touchMode === 'buttons' ? 'drag' : 'buttons';
    applyControlSettings();
    sfx.click();
    persist();
    renderSettings();
  });
}
$('btnReset').addEventListener('click', () => {
  if (!confirm('Reset coins, bikes, skins, ranking and missions? (Your account is kept)')) return;
  resetSave();
  sfx.setEnabled(save.settings.sound);
  sfx.setMusic(save.settings.music);
  screenRain.setEnabled(save.settings.wetFx);
  applyQuality();
  applyControlSettings();
  buildBike();
  resetBikePose();
  renderSettings();
  toast('PROGRESS RESET');
});

// ---------- 일시정지 (DELIVERY RECEIPT)
function renderReceipt() {
  const s = getSession();
  $('rcOrder').textContent = `#GR-${String(Math.floor(G.distance * 7 + G.time * 13) % 100000).padStart(5, '0')}`;
  $('rcRider').textContent = (s ? s.nickname : save.lastName || 'Guest Rider').toUpperCase();
  $('rcBike').textContent = getBike(save.bike).name.toUpperCase();
  const items = [
    ['DISTANCE', `${fmt(G.distance)} m`],
    ['NEAR MISSES', `${G.nearMiss} (MAX COMBO ${G.maxCombo})`],
    ['WRONG WAY', `${fmt(G.oncomingDist)} m`],
    ['AIR JUMPS', `${G.jumps}`],
    ['COINS', `${fmt(G.coinsRun)}`],
  ];
  $('rcItems').innerHTML = items.map(([k, v]) => `<div class="rc-item"><span>${k}</span><span>${v}</span></div>`).join('');
  $('rcMissions').innerHTML = save.missions.map((m) => {
    const pct = m.done ? 100 : Math.min(100, Math.floor((missionValue(m.type) / m.target) * 100));
    return `<div class="rc-mission ${m.done ? 'done' : ''}">
      <div class="top"><span>${escapeHtml(missionText(m))}</span><b>${pct}%</b></div>
      <i><b style="width:${pct}%"></b></i></div>`;
  }).join('');
  $('rcTotal').textContent = fmt(G.score);
}

function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
    releaseAllInput();
    renderReceipt();
    show('pause');
    $('brakeFx').classList.remove('on');
    sfx.suspend();
  } else if (G.state === 'paused') {
    resumeGame();
  }
}
function resumeGame() {
  hideScreens();
  G.state = 'playing';
  sfx.resume();
}
$('btnPause').addEventListener('click', togglePause);
$('btnResume').addEventListener('click', resumeGame);
$('btnQuit').addEventListener('click', () => {
  sfx.resume();
  if (MP.active) net.send({ t: 'over', sc: Math.floor(G.score) });
  finalizeRun();
  goMenu();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.state === 'playing') togglePause();
  if (!document.hidden) net.resume();
});

// ---------- 결과 / 랭킹 등록 / 이어달리기
function setResultTitle(delivered) {
  const t = $('goTitle');
  t.textContent = delivered ? 'DELIVERED!' : 'CRASHED!';
  t.className = `result-title ${delivered ? 'delivered' : 'crash'}`;
}

function showGameOver() {
  G.state = 'over';
  $('hud').classList.add('hidden');
  $('brakeFx').classList.remove('on');
  const score = Math.floor(G.score);
  const isRecord = score > save.best && score > 0;
  $('goScore').textContent = fmt(score);
  $('goNew').classList.toggle('hidden', !isRecord);
  setResultTitle(isRecord);
  save.best = Math.max(save.best, score);
  save.bestDist = Math.max(save.bestDist || 0, Math.floor(G.distance));
  $('hotBanner').classList.add('hidden');
  G.hot = null;
  const stats = [
    ['DISTANCE', `${fmt(G.distance)} m`],
    ['NEAR MISS', G.nearMiss],
    ['MAX COMBO', G.maxCombo],
    ['TOP SPEED', `${G.maxKmh} KM/H`],
    ['AIR JUMPS', G.jumps],
    ['COINS', fmt(G.coinsRun)],
  ];
  $('goStats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  $('goMissions').innerHTML = G.missionsDone.map((m) => `<div>${icon('check')} ${escapeHtml(missionText(m))} +${m.reward}</div>`).join('');

  // 이어달리기 (멀티에선 불가)
  const cont = $('btnContinue');
  $('contCost').textContent = CONTINUE_COST;
  cont.classList.toggle('hidden', G.continued || MP.active);
  cont.disabled = save.coins < CONTINUE_COST;
  $('retryLabel').textContent = MP.active ? 'REMATCH' : 'RETRY';
  // 보상형 광고: 부활 1회 / 코인 2배 1회 (배너 없음)
  $('btnAdRevive').classList.toggle('hidden', !adsEnabled() || G.continued || MP.active || isAdminMode());
  $('btnAdminRevive').classList.toggle('hidden', !isAdminMode() || MP.active);
  $('btnAdDouble').classList.toggle('hidden', !adsEnabled() || G.doubled || G.coinsRun + G.bonusCoins <= 0);

  if (MP.active) {
    net.send({ t: 'over', sc: score });
    renderVsResult();
  } else {
    $('goVs').classList.add('hidden');
  }
  show('gameover');
  submitGlobal();
  persist();
}

// 국가 랭킹 전송 (로그인 상태) / 로그인 유도 (게스트)
async function submitGlobal() {
  const box = $('goGlobal');
  box.classList.remove('hidden');
  const s = getSession();
  const score = Math.floor(G.score);
  const cname = escapeHtml(countryName(save.country));
  if (isAdminMode()) {
    box.innerHTML = `${icon('gear')} ADMIN MODE · this run is not recorded on the ranking`;
    return;
  }
  if (!s) {
    box.innerHTML = `${flagBadge(save.country)} Sign in to post your score to the ${cname} ranking <button class="btn primary" id="goLogin">SIGN IN</button>`;
    $('goLogin').addEventListener('click', () => { renderAuth(); openScreen('auth', 'gameover'); });
    return;
  }
  if (score <= 0) {
    box.classList.add('hidden');
    return;
  }
  if (G.globalSubmitted === score) return;
  G.globalSubmitted = score;
  box.innerHTML = `${flagBadge(save.country)} Posting to the ${cname} ranking...`;
  const res = await leaderboard.submit(scoreEntry(score, G.distance), { admin: isAdminMode() });
  if (!res.ok) {
    box.innerHTML = `${flagBadge(save.country)} Could not post score: ${escapeHtml(res.error)}`;
    G.globalSubmitted = false;
    return;
  }
  let rank = '-';
  try {
    const r = await leaderboard.myRank();
    if (r) rank = `#${r.rank}`;
    applyNationalStatus(Boolean(r && r.rank === 1), r?.country || save.country);
  } catch (e) { /* 순위 조회 실패 시 표시만 생략 */ }
  regionTopsDirty(save.country);
  box.innerHTML = `${flagBadge(save.country)} ${cname.toUpperCase()} RANK <b>${rank}</b> · BEST <b>${fmt(res.best)}</b>`;
}

function finalizeRun() {
  if (G.finalized || !('score' in G)) return;
  G.finalized = true;
  const score = Math.floor(G.score);
  save.best = Math.max(save.best, score);
  save.stats.runs++;
  save.stats.totalDist += Math.floor(G.distance);
  save.stats.totalNear += G.nearMiss;
  replaceDoneMissions();
  persist();
}

function retry() {
  if (MP.active) {
    requestRematch();
    return;
  }
  finalizeRun();
  startRun();
}
$('btnRetry').addEventListener('click', retry);
$('btnHome').addEventListener('click', () => {
  sfx.click();
  finalizeRun();
  goMenu();
});

const scoreEntry = (score, dist) => ({ score, dist, bike: save.bike, box: save.box, outfit: save.outfit, helmet: save.helmet, flag: myLook().opts.flag || '' });

$('btnContinue').addEventListener('click', () => {
  if (G.continued || MP.active || save.coins < CONTINUE_COST) return;
  save.coins -= CONTINUE_COST;
  persist();
  reviveRun();
});
// 관리자: 비용·광고 없이 몇 번이든 즉시 부활
$('btnAdminRevive').addEventListener('click', () => {
  if (!isAdminMode() || MP.active || G.state !== 'over') return;
  reviveRun();
});
$('btnAdRevive').addEventListener('click', async () => {
  if (G.continued || MP.active) return;
  if (await showRewarded('revive', adHooks)) reviveRun();
});
$('btnAdDouble').addEventListener('click', async () => {
  if (G.doubled) return;
  if (!(await showRewarded('double_coins', adHooks))) return;
  const extra = G.coinsRun + G.bonusCoins;
  G.doubled = true;
  save.coins += extra;
  persist();
  $('btnAdDouble').classList.add('hidden');
  toast(`COINS DOUBLED  ·  +${fmt(extra)}`);
  sfx.coin();
});
// WhatsApp 챌린지: 내 점수 + 같은 도로 시드 링크
$('btnWhatsApp').addEventListener('click', () => {
  const base = SHARE_BASE_URL || `${location.origin}${location.pathname}`;
  const url = `${base}${base.includes('?') ? '&' : '?'}seed=${G.seed}`;
  const text = `I scored ${fmt(G.score)} (${fmt(G.distance)} m) on Grab Rider! Ride the exact same road and beat me: ${url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
});

function reviveRun() {
  G.continued = true;
  // 주변 장애물 정리 후 부활
  for (let i = cars.length - 1; i >= 0; i--) if (cars[i].z > -50) releaseCar(cars[i]);
  for (let i = stalls.length - 1; i >= 0; i--) if (stalls[i].z > -50) releaseStall(stalls[i]);
  for (const pool of [conePool, signPool, potholePool, manholePool, cargoPool]) for (const c of pool.items) if (c.z > -50) c.active = false;
  G.x = clamp(G.x, -ROAD_HALF, ROAD_HALF);
  G.vx = 0;
  G.lean = 0;
  G.speed = 22;
  G.invuln = 3;
  G.slipT = 0;
  resetBikePose();
  hideScreens();
  $('hud').classList.remove('hidden');
  G.state = 'playing';
  sfx.init();
  sfx.engineStart();
  popup('BACK ON THE ROAD', 'big');
}

// ======================================================================
// 1v1 멀티플레이 (Room Code + 시드 동기화 + 고스트)
// ======================================================================
function renderMulti() {
  const inRoom = Boolean(net.peer);
  $('multiIdle').classList.toggle('hidden', inRoom);
  $('multiRoom').classList.toggle('hidden', !inRoom);
  $('roomCode').textContent = net.code || '-----';
  $('btnMultiStart').classList.toggle('hidden', !(net.role === 'host' && net.connected));
  if (inRoom) {
    $('multiStatus').textContent = net.connected
      ? (net.role === 'host' ? `${MP.oppName} joined. Start the race!` : 'Connected. Waiting for the host to start...')
      : (net.role === 'host' ? 'Waiting for a rival... Share the code, then come back and keep this screen open.' : 'Connecting...');
  }
}

const myName = () => getSession()?.nickname || save.lastName || 'Rider';
const multiMsg = (t, ok = false) => {
  $('multiMsg').textContent = t;
  $('multiMsg').className = ok ? 'form-msg ok' : 'form-msg';
};

$('btnHost').addEventListener('click', async () => {
  multiMsg('Creating room...', true);
  try {
    await net.host();
    MP.roomSeed = net.seed;
    multiMsg('');
  } catch (e) {
    console.warn('[net] host failed', e);
    multiMsg(`Could not create room: ${describeError(e)}`);
    net.close();
  }
  renderMulti();
});
$('btnJoin').addEventListener('click', async () => {
  const code = $('roomInput').value.trim();
  if (code.length < 5) {
    multiMsg('Enter the 5-character room code');
    return;
  }
  multiMsg('Joining...', true);
  try {
    await net.join(code);
    multiMsg('');
  } catch (e) {
    console.warn('[net] join failed', e);
    multiMsg(describeError(e));
    net.close();
  }
  renderMulti();
});
$('btnLeaveRoom').addEventListener('click', () => {
  leaveRoom();
  renderMulti();
});
$('btnMultiStart').addEventListener('click', hostStartMatch);

function leaveRoom() {
  net.send({ t: 'bye' });
  net.close();
  MP.active = false;
  MP.roomSeed = null;
  ghost.root.visible = false;
}

// 방장: 첫 판은 방 시드, 재대결부터는 새 시드를 만들어 참가자에게 전달
function hostStartMatch() {
  if (net.role !== 'host' || !net.connected) return;
  const seed = MP.roomSeed ?? newSeed();
  MP.roomSeed = null;
  net.seed = seed;
  net.send({ t: 'start', seed });
  if (G.state === 'over') finalizeRun();
  startRun({ mp: true, seed });
}

function requestRematch() {
  if (!net.connected) {
    toast('RIVAL DISCONNECTED  ·  CANNOT REMATCH');
    return;
  }
  MP.ready = true;
  if (net.role === 'host') {
    if (MP.oppReady) hostStartMatch();
    else toast('WAITING FOR RIVAL TO ACCEPT...');
  } else {
    net.send({ t: 'ready' });
    toast('REMATCH REQUESTED');
  }
}

net.on('connected', () => {
  // 방장은 접속 즉시 도로 시드를 넘겨줌
  net.send({ t: 'hello', name: myName(), bike: save.bike, seed: net.role === 'host' ? net.seed : undefined });
  sfx.mission();
  renderMulti();
});
net.on('disconnected', () => {
  toast('RIVAL DISCONNECTED');
  MP.opp = null;
  ghost.root.visible = false;
  renderMulti();
  if (G.state === 'over' && MP.active) renderVsResult();
});
net.on('status', (t) => {
  if (currentScreen === 'multi') multiMsg(t, true);
});
net.on('error', (e) => {
  if (currentScreen === 'multi') multiMsg(`Connection error: ${describeError(e)}`);
});
net.on('data', (m) => {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello':
      MP.oppName = String(m.name || 'Rival').slice(0, 12);
      if (net.role === 'guest' && m.seed != null) net.seed = m.seed >>> 0;
      renderMulti();
      break;
    case 'full':
      multiMsg('This room is full');
      net.close();
      renderMulti();
      break;
    case 'start':
      if (net.role !== 'guest') break;
      net.seed = m.seed >>> 0;
      if (G.state === 'over') finalizeRun();
      startRun({ mp: true, seed: net.seed });
      break;
    case 's': {
      if (!MP.active) break;
      const snap = { d: +m.d || 0, x: +m.x || 0, y: +m.y || 0, l: +m.l || 0, v: +m.v || 0, sc: +m.sc || 0, at: performance.now() };
      MP.opp = snap;
      MP.snaps.push(snap);
      if (MP.snaps.length > 12) MP.snaps.shift();
      break;
    }
    case 'over':
      MP.oppDone = true;
      MP.oppScore = Math.floor(+m.sc || 0);
      if (G.state === 'over' && MP.active) renderVsResult();
      break;
    case 'ready':
      MP.oppReady = true;
      if (net.role === 'host') {
        if (MP.ready) hostStartMatch();
        else toast(`${MP.oppName.toUpperCase()} WANTS A REMATCH`);
      }
      break;
    case 'bye':
      toast(`${MP.oppName.toUpperCase()} LEFT THE ROOM`);
      break;
    default:
      break;
  }
});

function updateMultiplayer(rdt) {
  if (!MP.active) {
    ghost.root.visible = false;
    return;
  }
  // 내 상태 전송 (net.sendState 가 15 FPS 로 제한 + 버퍼 체크)
  if (G.state === 'playing' || G.state === 'crashing' || G.state === 'paused') {
    net.sendState({ t: 's', d: Math.round(G.distance * 10) / 10, x: +G.x.toFixed(2), y: +(G.airY || 0).toFixed(2), l: +G.lean.toFixed(2), v: +G.speed.toFixed(1), sc: Math.floor(G.score) });
  }
  // 상대 고스트: 15 FPS 패킷을 100ms 지연 버퍼로 보간 → 60 FPS 로 부드럽게
  if (!MP.opp || MP.oppDone) {
    ghost.root.visible = false;
    return;
  }
  const target = sampleOpponent(performance.now() - INTERP_DELAY);
  ghostTarget.set(target.x, target.y, -(target.d - G.distance));
  const k = 1 - Math.exp(-rdt * 18);
  if (!ghost.root.visible) ghost.root.position.copy(ghostTarget);
  else ghost.root.position.lerp(ghostTarget, k);
  ghost.lean.rotation.z = THREE.MathUtils.lerp(ghost.lean.rotation.z, target.l, k);
  ghost.root.visible = ghost.root.position.z > -220 && ghost.root.position.z < 12;
}

const INTERP_DELAY = 100; // ms
const ghostTarget = new THREE.Vector3();
// 시각 t 의 상대 상태: 앞뒤 스냅샷 사이를 선형 보간, 버퍼보다 늦으면 속도로 외삽(최대 0.5초)
function sampleOpponent(t) {
  const snaps = MP.snaps;
  const lastSnap = snaps[snaps.length - 1];
  if (snaps.length < 2 || t >= lastSnap.at) {
    const ext = clamp((t - lastSnap.at) / 1000, 0, 0.5);
    return { ...lastSnap, d: lastSnap.d + lastSnap.v * ext };
  }
  for (let i = snaps.length - 1; i > 0; i--) {
    const a = snaps[i - 1], b = snaps[i];
    if (t >= a.at) {
      const f = clamp((t - a.at) / Math.max(1, b.at - a.at), 0, 1);
      return {
        d: THREE.MathUtils.lerp(a.d, b.d, f), x: THREE.MathUtils.lerp(a.x, b.x, f),
        y: THREE.MathUtils.lerp(a.y, b.y, f), l: THREE.MathUtils.lerp(a.l, b.l, f),
      };
    }
  }
  return snaps[0];
}

function renderVsResult() {
  const el = $('goVs');
  el.classList.remove('hidden', 'win', 'lose');
  const me = Math.floor(G.score);
  if (!MP.oppDone) {
    el.innerHTML = net.connected
      ? `<b>${escapeHtml(MP.oppName)} IS STILL RIDING...</b>Rival score ${fmt(MP.opp?.sc || 0)}`
      : '<b>RIVAL DISCONNECTED</b>This race does not count';
    return;
  }
  const win = me > MP.oppScore, draw = me === MP.oppScore;
  if (!draw) el.classList.add(win ? 'win' : 'lose');
  el.innerHTML = `<b>${win ? 'YOU WIN' : draw ? 'DRAW' : 'YOU LOSE'}</b>YOU ${fmt(me)}  ·  ${escapeHtml(MP.oppName)} ${fmt(MP.oppScore)}`;
  if (win) setResultTitle(true);
}

// ---------- 외부 3D 모델 교체 (로딩 완료 시 즉시 반영)
const INSTANCED_KEYS = {
  'prop.palm': [treeMeshes[0]], 'prop.ruko': [buildingsL.groups[0][0], buildingsR.groups[0][0]], 'prop.warung': [curbMeshes[0]],
  'prop.building': [bldgMesh], 'prop.lamp': [lampPole], 'obstacle.cone': [conePool.mesh], 'obstacle.sign': [signPool.mesh],
};
M.models.onLoad((key) => {
  if (key === 'bike' || key === 'box') {
    buildBike();
    if (G.state !== 'playing') resetBikePose();
  } else if (key.startsWith('car.')) {
    const type = key.slice(4);
    for (const c of [...(carPool[type] || [])]) {
      c.stale = true;
      if (!c.active) releaseCar(c);
    }
  } else if (key === 'obstacle.stall') {
    for (const s of stallPool) s.stale = true;
  } else if (INSTANCED_KEYS[key]) {
    const src = M.models.instancedSource(key);
    if (src) {
      for (const mesh of INSTANCED_KEYS[key]) {
        mesh.geometry = src.geometry;
        mesh.material = src.material;
      }
      if (key === 'prop.lamp') lampHead.visible = false;
    }
  }
  console.info(`[ModelManager] '${key}' external model applied`);
});
M.models.loadAll();

// ---------- 메인 루프
let last = performance.now();
let frameDt = 1 / 60;
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (now - last) / 1000);
  frameDt = rdt;
  last = now;
  switch (G.state) {
    case 'playing': updatePlaying(rdt); break;
    case 'crashing': updateCrashing(rdt); break;
    case 'countdown': updateCountdown(rdt); poseBike(); break;
    case 'menu': updateAttract(rdt); break;
    default: break;
  }
  if (G.state === 'playing' || G.state === 'countdown' || G.state === 'crashing') updateHud();
  updateMultiplayer(rdt);
  updateEnvironment(rdt);
  updateCamera(rdt);
  updateFx(rdt);
  renderer.render(scene, camera);
  // 화면 빗물은 렌더 직후 같은 프레임에서 그려야 굴절 스냅샷이 유효
  if (G.state !== 'paused') {
    const wet = G.state === 'playing' || G.state === 'crashing' ? G.rainAmt : 0;
    screenRain.update(rdt, wet, G.speed);
    screenRain.render();
  }
}

// ---------- 시작
hydrateIcons();
if (DEBUG) {
  window.__G = G;
  window.__MP = MP;
  window.__models = M.models;
  window.__cars = cars;
  window.__scene = scene;
  window.__renderer = renderer;
  window.__save = save;
  window.__net = net;
  window.__dbg = {
    car: (type, lane, z) => spawnCar(z, { type, lane }),
    puddle: (x, z) => spawnInPool(puddlePool, { x, z }),
    sign: (x, z) => spawnInPool(signPool, { x, z }),
    stall: (kind, side, z) => {
      const st = acquireStall(kind);
      Object.assign(st, { x: side * (kind === 'cart' ? 7.55 : 7.8), z, y: 0, vy: 0, vx: 0, flying: false });
      stalls.push(st);
    },
    squall: startSquall,
    // 거리 점프 후 도로변 소품을 현재 위치 테마로 즉시 재배치
    refreshProps: () => {
      for (const st of strips) st.items.forEach((it, k) => st.respawn(it, k));
      for (const st of strips) st.update(0);
    },
    fever: startFever,
    mega: spawnMegaBoard,
    crash: () => crash({ x: G.x - 1 }),
    boards: activeBoards,
    board: spawnBillboard,
    jump: () => startJump({}),
    hazard: (kind, x, z) => spawnInPool(HAZARDS.find((h) => h.kind === kind).pool, { x, z, rot: 0 }),
    drop: (x, z) => { spawnDropZone(); const d = dropZones.find((k) => k.active && k.z === SPAWN_Z); if (d) Object.assign(d, { x, z }); },
    power: (type) => applyPower(type),
    admin: (on) => { debugAdmin = on; onDataReplaced(); },
  };
}
goMenu();
$('loading').remove();
// 7일 연속 출석 (로그인 계정만: 서버에 저장되므로)
// 어제도 접속했으면 연속 +1, 아니면 1일차부터. 7일차엔 특수 헬멧
let dailyShown = false;
function showDailyStreak() {
  if (dailyShown || !getSession() || !isServerReady() || currentScreen !== 'menu') return;
  const today = new Date().toDateString();
  if (save.lastDaily === today) return;
  dailyShown = true;
  const yesterday = new Date(Date.now() - 86400000).toDateString();
  const day = save.lastDaily === yesterday ? (save.streak % 7) + 1 : 1;
  $('streakGrid').innerHTML = STREAK_REWARDS.map((c, i) => `<div class="${i + 1 < day ? 'done' : i + 1 === day ? 'today' : ''} ${i === 6 ? 'special' : ''}">
    DAY ${i + 1}<b>${fmt(c)}</b>${i === 6 ? '<small>+ CROWN</small>' : icon('coin')}</div>`).join('');
  show('daily');
  $('btnClaimDaily').addEventListener('click', () => {
    const coins = STREAK_REWARDS[day - 1];
    save.coins += coins;
    save.streak = day;
    save.lastDaily = today;
    let msg = `DAY ${day} REWARD  ·  +${fmt(coins)} COINS`;
    if (day === 7 && !save.ownedHelmets.includes(STREAK_SPECIAL_HELMET)) {
      save.ownedHelmets.push(STREAK_SPECIAL_HELMET);
      msg += '  ·  STREAK CROWN UNLOCKED';
    }
    persist();
    sfx.init();
    sfx.mission();
    toast(msg);
    refreshMenu();
    show('menu');
  }, { once: true });
}

// 국기 이미지 미리 불러오기 (3D 국경 게이트·가로등·광고판 텍스처용)
preloadFlags([...THEMES.map((t) => t.code), ...FLAG_SHOP_CODES]);

// 시작: IP 로 국가 판별 → 자동 로그인 → 서버 데이터 → 국가 고정 → 국가대표 검증
detectCountry()
  .then(() => auth.restore())
  .then((s) => (s ? onSignedIn() : refreshMenu()));
requestAnimationFrame(frame);
