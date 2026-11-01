import * as THREE from 'three';
import * as M from './models.js';
import { Sound } from './audio.js';
import { icon, hydrateIcons } from './icons.js';
import { ScreenRain } from './rainfx.js';
import {
  THEMES, ZONE_LENGTH, themeAt, themeIndexAt, driveSign, pickWeighted, COUNTRY_CODES, countryName, isCountryCode, flagBadge, nationalLivery, preloadFlags, setThemeOrder,
} from './themes.js';
import { PreviewStage, renderRiderSnapshot } from './preview.js';
import { fillThumbs, thumbKey } from './thumbs.js';
import { showRewarded, adsEnabled } from './ads.js';
import { BILLBOARD_POSTERS, SHARE_BASE_URL, ADS, ECON, GACHA_ODDS, TIERS, DEFAULT_NOTICES, STREAK_REWARDS, STREAK_SPECIAL_HELMET, FLAG_CHECK_INTERVAL_SEC,
  FLAG_SHOP_CODES, FLAG_PRICE_THEME, FLAG_PRICE_OTHER, ADMIN_DEBUG_TOGGLE, APP_INFO, BOOSTS, BOOST_BUNDLE, BOOST_START_TIME, HEAD_START_TIME,
} from './config.js';
import { paymentsMode, initPayments, getPacks, buyPack } from './payments.js';
import { initLiveUpdate, webBuild } from './updater.js';
import { machineTranslate } from './mt.js';
import { t, setLang, getLang, LANGS, applyI18n, onLangChange } from './i18n.js';
import {
  save, persist, resetSave, BIKES, BOXES, OUTFITS, HELMETS, PAINTS, getBike,
  replaceDoneMissions, missionText, auth, leaderboard, getSession, ONLINE, detectCountry,
  loadPlayerData, flushSave, lockCountry, isServerReady, adminSetCountry, claimPendingCoins, deleteAccount, loadAppConfig,
  submitInquiry, replyInquiry, myInquiries, logRun, logClientError,
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
const SQUALL_TIME = 30;
const GRAVITY = 16;
const CAR_COLORS = [0xd62828, 0xf77f00, 0x2a9d8f, 0x264653, 0x8d99ae, 0xe9ecef, 0x1d3557, 0x6a4c93, 0x40916c, 0x151515, 0xbfc0c0, 0x7f5539, 0x3a86ff];
const POWER_TYPES = ['shield', 'magnet', 'giant', 'x2', 'slow'];
// 등장 비중: 자석·보호막·거대화 위주
const POWER_WEIGHTS = [0.3, 0.3, 0.22, 0.1, 0.08];
const POWER_LABEL = { shield: 'SHIELD', magnet: 'MAGNET', giant: 'GIANT MODE', x2: 'x2 SCORE', slow: 'SLOW-MO' }; // 표시할 때 t()
const GIANT_TIME = 6;
// NPC 차선 변경: 깜빡이 시간 / 옆 차선까지 이동 시간 (s)
const LANE_BLINK = 1.0, LANE_MOVE = 1.5;
// 공중 묘기: 회전 속도(rad/s), 착지 허용 각도(rad), 착지 무적 시간(s), 회전 종류별 점수(1바퀴당)
const AIR_FLIP = 9.5, AIR_SPIN = 9.5, LAND_TOL = 0.68, LAND_IFRAMES = 1.8;
// 착지 보조: 땅에 닿기 0.25초 전부터, 수평과의 각도가 40° 안이면 바퀴가 바닥을 향하도록 자동으로 돌려 줌 (여러 축으로 돌려도 착지가 쉬움)
const LAND_ASSIST_TIME = 0.25, LAND_ASSIST_ANGLE = 0.7, LAND_ASSIST_RATE = 8;
// 공중 묘기 점수 = (바퀴마다 기본 점수의 합) × 회전 수 배수 × 콤보 배수 × TRICK_UNIT
//   기본 점수(1바퀴): 전진(뒤로 돌기) 1.0 · 전진 사선 1.3 · 좌/우(옆으로 돌기) 1.6 · 후진(앞으로 돌기) 1.8 · 후진 사선 2.2
//   회전 수 배수: 1바퀴 x1.0 · 2바퀴 x2.5 · 3바퀴 이상 x5.0
//   콤보 배수(서로 다른 동작 수): 1가지 x1.0 · 2가지 x1.5 · 3가지 이상 x2.2
//   예) 전진 2바퀴 = 2.0×2.5×1.0 = 5 → 1,500점 / 전진+후진 = 2.8×2.5×1.5 = 10.5 → 3,150점 / 전진+좌우+후진 = 4.4×5.0×2.2 = 48.4 → 14,520점
const TRICK_BASE = { back: 1.0, backDiag: 1.3, side: 1.6, front: 1.8, frontDiag: 2.2 };
const TRICK_ROT_MULT = [0, 1.0, 2.5, 5.0];
const TRICK_COMBO_MULT = [0, 1.0, 1.5, 2.2];
const TRICK_UNIT = 300; // 기본 점수 1.0 = 게임 점수 300
const TRICK_JUMP = 200; // 회전 없이 점프만
const TRICK_NAMES = { back: 'BACKFLIP', backDiag: 'DIAGONAL BACKFLIP', side: 'SIDE FLIP', front: 'FRONT FLIP', frontDiag: 'DIAGONAL FRONT FLIP' };

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
const STREAMS = ['car', 'coin', 'cone', 'power', 'weather', 'puddle', 'stall', 'hazard', 'ramp'];
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
// 안개에 완전히 묻힌 픽셀은 그리지 않음: 하늘(배경)과 같은 색이라 평소엔 차이가 없지만,
// 안개 밖 원경 랜드마크(fog: false)를 먼 빌딩의 '하늘색 실루엣'이 투명 구멍처럼 가리던 문제를 없앰
THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace(
  'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
  'if ( fogFactor > 0.965 ) discard;\n\tgl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87c6ff);
scene.fog = new THREE.Fog(0x87c6ff, 60, 240);
// near 0.5: 모바일(16비트 깊이 버퍼)에서도 바이크 장식 면이 지직거리지 않게 / far 1000: 원경 랜드마크용
const camera = new THREE.PerspectiveCamera(65, 1, 0.5, 1000);
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
  // jitter: 슬롯 간격에 섞는 무작위 오프셋 비율 (건물처럼 붙어 있는 소품은 0 → 서로 겹치지 않음)
  constructor({ always = [], variants = [], block = null, jitter = 0.3 }, count, spacing, respawn) {
    this.always = always;
    this.block = block; // (it) => true 면 이번 프레임에 숨김 (빌보드 아래 가로수/가로등 등)
    this.variants = variants;
    this.span = count * spacing;
    this.respawn = respawn;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = { i, x: 0, z: 25 - i * spacing - Math.random() * spacing * jitter, sx: 1, sy: 1, sz: 1, ry: 0, hidden: false, variant: 0 };
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
const BUILDING_STYLES = ['ruko', 'tube', 'neon', 'modern', 'brick', 'haussmann', 'peranakan', 'colonial', 'teak'];
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
  // 건물 길이(z) 10m + 간격 0.4m, 무작위 오프셋 없음 → 옆 건물과 겹치지 않음
  const strip = new PropStrip({ variants: groups, jitter: 0 }, 42, 10.4, (it, k) => {
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

const TREE_KINDS = ['palm', 'sakura', 'ginkgo', 'round', 'raintree', 'frangipani'];
const treeMeshes = TREE_KINDS.map((k) => new THREE.InstancedMesh(M.treeVariant(k), M.vcMat, 56));
const CURB_KINDS = ['warung', 'vending', 'cafe', 'tent', 'planter', 'mamak', 'sarisari', 'juicecart', 'teashop'];
// 도로 위 축제 장식 (나라별)
const OVERHEAD_KINDS = ['lanterns', 'bunting_ph', 'bunting_my', 'bunting_id', 'flags_th', 'flags_kh', 'flags_mm'];
const overheadMeshes = OVERHEAD_KINDS.map((k) => new THREE.InstancedMesh(M.overheadGeometry(k), M.vcMat, 6));
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
    it.x = side * (Math.random() < 0.7 ? rand(9.6, 10.2) : rand(22, 27)); // 먼 나무는 앞 건물(≤19.6m)과 뒤 건물(≥30m) 사이
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
  // 축제 장식 줄: 그 나라 구간에서만 (국경 근처 120m 는 비움 → 관문과 겹치지 않게)
  new PropStrip({ variants: overheadMeshes.map((m) => [m]), block: underBoard }, 6, 55, (it) => {
    const d = slotDist(it);
    const kind = themeAt(d).overhead;
    const toBorder = ZONE_LENGTH - (d % ZONE_LENGTH);
    it.x = 0;
    it.variant = Math.max(0, OVERHEAD_KINDS.indexOf(kind));
    it.hidden = !kind || toBorder < 120 || d % ZONE_LENGTH < 60 || Math.random() < 0.25;
  }),
  new PropStrip({ always: [bldgMesh] }, 30, 14, (it, k) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * rand(38, 80); // 폭 최대 16m → 가장 가까운 면도 30m 밖
    it.sx = rand(8, 16);
    it.sy = rand(12, 50);
    it.sz = rand(8, 14);
    // 원경 빌딩: 하늘·안개와 구분되는 중간 밝기 (너무 밝으면 몸체가 안개에 묻혀 창문만 떠 보임)
    bldgMesh.setColorAt(k, tmpColor.setHSL(rand(0.05, 0.62), rand(0.08, 0.22), rand(0.38, 0.55)));
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
    return { color: c1, opts: { style: 'sport', accent: c2, national: true, nationalCode: cc } };
  }
  return { color: bk.color, opts: { style: bk.style } };
}
const paintOf = (id) => PAINTS.find((p) => p.id === id) || null;
const paintOpt = (id) => {
  const p = paintOf(id);
  return p ? { hex: p.hex, finish: p.finish } : null;
};
// 바이크·배달통·헤드기어·국기·페인트 조합 → createBike 옵션
function composeLook(bikeId, code, eq) {
  const look = bikeLook(bikeId, code);
  const opts = {
    ...look.opts,
    nationalCode: isCountryCode(code) ? code : save.country, // 국가대표 배달통 국기
    box: eq.box || 'basic', outfit: eq.outfit || 'jacket', helmet: eq.helmet || 'basic',
    flag: isCountryCode(eq.flag) ? eq.flag : null,
    paint: look.opts.national ? null : paintOpt(eq.bikePaint), // 국가대표 바이크는 국기 래핑 고정
    helmetPaint: paintOpt(eq.helmetPaint),
  };
  return { color: look.color, opts };
}
const myNationalCode = () => save.nationalCode || save.country;
// 표시용 바이크 이름: 동남아 국가대표는 나라별 전용 이름 (예: NATIONAL · GARUDA WING)
const bikeName = (bikeId, code) => {
  const bk = getBike(bikeId);
  if (bk.special === 'national' && M.SEA_NATIONAL_NAMES[code]) return `NATIONAL · ${M.SEA_NATIONAL_NAMES[code]}`;
  return bk.name.toUpperCase();
};
const myLook = () => composeLook(save.bike, myNationalCode(), save);
const currentBikeKey = () => JSON.stringify(myLook());
const riderOpts = () => myLook().opts;
// 랭킹 행(다른 라이더)의 장착 조합 → 3D 미리보기. 내 행은 지금 장착한 그대로
function rowLook(r) {
  if (r.isMe) return myLook();
  const lk = r.look || {};
  return composeLook(r.bike, r.country, { box: r.box, outfit: r.outfit, helmet: r.helmet, flag: r.flag, bikePaint: lk.bikePaint, helmetPaint: lk.helmetPaint });
}

// 관리자 모드가 아니면 보유하지 않은 아이템 장착을 해제
function sanitizeEquip() {
  if (isAdminMode()) return;
  if (save.bike === 'national' && !save.nationalUnlocked) save.bike = save.ownedBikes.includes(save.prevBike) ? save.prevBike : 'rookie';
  if (save.bike !== 'national' && !save.ownedBikes.includes(save.bike)) save.bike = 'rookie';
  if (save.box === 'national' && !save.nationalUnlocked) save.box = save.ownedBoxes.includes(save.prevBox) ? save.prevBox : 'basic';
  for (const [k, own, def] of [['box', 'ownedBoxes', 'basic'], ['outfit', 'ownedOutfits', 'jacket'], ['helmet', 'ownedHelmets', 'basic']]) {
    if (k === 'box' && save.box === 'national') continue;
    if (!save[own].includes(save[k])) save[k] = def;
  }
  if (save.flag && !save.ownedFlags.includes(save.flag)) save.flag = '';
  for (const k of ['bikePaint', 'helmetPaint']) if (save[k] && !save.ownedPaints.includes(save[k])) save[k] = '';
}

// 내 장착 상태를 랭킹 DB(leaderboard)에 동기화 → 다른 사람 랭킹 3D 뷰·전광판에도 지금 모습으로 보임
let lookSyncTimer = null;
function syncMyLook() {
  if (!getSession() || !isServerReady() || isAdminMode()) return;
  clearTimeout(lookSyncTimer);
  lookSyncTimer = setTimeout(() => {
    leaderboard.syncLook({
      bike: save.bike, box: save.box, outfit: save.outfit, helmet: save.helmet, flag: save.flag || '',
      look: { bikePaint: save.bikePaint || '', helmetPaint: save.helmetPaint || '' },
    });
  }, 800);
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

// ---------- 게임 상태

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
  // 점프대가 있는 차선의 앞뒤는 비워 둠 (점프대로 달려가는데 차가 튀어나오지 않게)
  if (rampNear(LANES[lane], z, len / 2 + 25)) return false;
  return true;
}

// x 차선의 z 주변(margin)에 아직 쓰이지 않은 점프대가 있는지
function rampNear(x, z, margin) {
  for (const r of jumpRamps) {
    if (!r.active || r.used || Math.abs(r.x - x) > 2) continue;
    if (z > r.z - M.JUMP_RAMP.length - margin && z < r.z + margin) return true;
  }
  return false;
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

// 나라 고유 교통수단: 그 나라 구간에서만 보이게 함
const LOCAL_TYPES = new Set(['jeepney', 'doubledecker', 'angkot', 'songthaew', 'tricycle', 'remork', 'trishaw', 'tuktuk']);
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
  let type = forced?.type || pickType(r[0], r[9], z);
  // 국경 120m 앞에서는 나라 고유 교통수단 대신 일반 차 (다음 나라로 넘어가 섞이지 않게)
  if (!forced && LOCAL_TYPES.has(type) && ZONE_LENGTH - ((G.distance - z) % ZONE_LENGTH) < 120) type = 'sedan';
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
      ghost: false, lane, targetLane: lane, dir, ds, side: Math.sign(LANES[lane]), baseX: LANES[lane], x: LANES[lane], z, offset: 0,
      speed: lerp(def.speed[0], def.speed[1], r[4]) * (dir < 0 ? 1.1 : 1),
      passed: false, minGap: 99, changing: false, changeT: 0, flying: false, honked: false,
      wob: r[5] * Math.PI * 2,
      wobAmp: (type === 'bus' || type === 'doubledecker' || type === 'truck' || type === 'ramp' ? 0.1 : 0.22) * (1 + clamp(G.distance / 8000, 0, 1) * 0.8),
      // 앞서가는 같은 방향 차량일수록 깜빡이 후 급차선 변경을 자주 함
      canChange: type !== 'ramp' && r[6] < Math.min(dir > 0 ? 0.7 : 0.4, (dir > 0 ? 0.3 : 0.12) + G.distance / 8000),
    });
    // 나라별 색: 택시(방콕 핑크·싱가포르 블루 등)·버스·특수 차량·일반 차 팔레트
    const pal = themeAt(sd).colors || {};
    const from = (arr) => arr[(r[8] * arr.length) | 0];
    const col = pal[type] ? from(pal[type])
      : type === 'taxi' ? 0xffc300 : type === 'police' ? 0xf4f4f4 : type === 'bus' ? from([0x2e86de, 0x10ac84, 0xee5253])
        : type === 'ramp' ? 0xff8c1a : type === 'sedan' || type === 'suv' ? from(pal.car || CAR_COLORS) : CAR_COLORS[(r[8] * CAR_COLORS.length) | 0];
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
    // 나라 고유 교통수단(지프니·툭툭·레모크 등)이 다른 나라 구간으로 넘어가면, 아직 멀리 있을 때 정리
    if (LOCAL_TYPES.has(c.type) && c.z < -140 && !(themeAt(G.distance - c.z).traffic || {})[c.type]) {
      releaseCar(c);
      continue;
    }
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
      // 깜빡이 1초 → 부드러운 S자 차선 변경 (가감속 곡선 + 진행 방향으로 차체가 살짝 틀어짐)
      if (c.changeT > LANE_BLINK) {
        const tx = LANES[c.targetLane];
        const u = clamp((c.changeT - LANE_BLINK) / LANE_MOVE, 0, 1);
        const ease = u * u * (3 - 2 * u);
        c.baseX = c.fromX + (tx - c.fromX) * ease;
        const vx = ((tx - c.fromX) * 6 * u * (1 - u)) / LANE_MOVE; // 횡속도 (m/s)
        const yaw = clamp(Math.atan2(vx, Math.max(c.speed, 6)), -0.22, 0.22);
        c.group.rotation.y = c.dir < 0 ? Math.PI + yaw : -yaw;
        if (u >= 1) {
          c.baseX = tx;
          c.lane = c.targetLane;
          c.changing = false;
          c.canChange = false;
          c.group.rotation.y = c.dir < 0 ? Math.PI : 0;
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
        c.fromX = c.baseX;
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

    // 점프대 위·앞뒤를 지나는 차: 멀리 있으면 정리, 가까우면 라이더와 충돌하지 않게 (억울한 죽음 방지)
    if (!c.ghost && rampNear(c.x, c.z, c.len / 2 + 6)) {
      if (c.z < -45) {
        releaseCar(c);
        continue;
      }
      c.ghost = true;
    }
    if (!solid || G.air || c.ghost || G.state !== 'playing') continue;
    const dx = Math.abs(c.x - G.x), dz = Math.abs(c.z);
    // 슬립스트림: 같은 방향 대형차(트럭·버스·견인트럭) 바로 뒤
    if (c.dir > 0 && (c.type === 'truck' || c.type === 'bus' || c.type === 'doubledecker' || c.type === 'ramp')) {
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
  if (G.giantT > 0 || G.invuln > 0) return;
  G.speed *= 0.75;
  G.shake = 0.6;
  G.combo = 0;
  sfx.land();
  vibrate([30, 30, 30]);
  popup(t('POTHOLE!'), 'power');
}

// ---------- 독립 점프대 (견인트럭 외에 도로 위 곳곳)
const jumpRamps = [];
function spawnJumpRamp() {
  const r1 = wr('ramp');
  let jr = jumpRamps.find((k) => !k.active);
  if (!jr) {
    jr = { obj: M.createJumpRamp() };
    scene.add(jr.obj);
    jumpRamps.push(jr);
  }
  // 기본 차선은 시드로 정하고, 그 자리에 차가 있으면 옆 차선부터 차례로 시도 (없으면 그대로)
  const base = (r1 * 4) | 0;
  let lane = base;
  for (let k = 0; k < 4; k++) {
    const l = (base + k) % 4;
    if (cars.every((o) => o.flying || (o.lane !== l && o.targetLane !== l) || Math.abs(o.z - SPAWN_Z) > o.len / 2 + 20)) {
      lane = l;
      break;
    }
  }
  Object.assign(jr, { active: true, x: LANES[lane], z: SPAWN_Z, used: false });
  jr.obj.visible = true;
}
function updateJumpRamps(dt, collide) {
  for (const jr of jumpRamps) {
    if (!jr.active) continue;
    jr.z += G.speed * dt;
    jr.obj.position.set(jr.x, 0, jr.z);
    jr.obj.neon.color.setHSL(0.13, 1, 0.5 + Math.sin(G.time * 8) * 0.15);
    // 낮은 쪽 끝이 바이크에 닿는 순간 점프
    if (collide && !jr.used && !G.air && G.state === 'playing' && jr.z > -0.2 && jr.z < 2.5
      && Math.abs(G.x - jr.x) < M.JUMP_RAMP.width / 2 + 0.1) {
      jr.used = true;
      startJump(jr);
    }
    if (jr.z - M.JUMP_RAMP.length > 20) {
      jr.active = false;
      jr.obj.visible = false;
    }
  }
}

// ---------- 배달 드롭존: 도로 가장자리 구역을 정확히 통과하면 코인
const dropZones = [];
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
      earn(ECON.dropReward);
      popup(t('DROP ZONE!'), 'perfect', t('+{n} COINS', { n: ECON.dropReward }));
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
  else if (r1 < 0.72) x = nearest;
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

// 판 수입: 저장 코인 + 이번 판 합계(결과 화면·광고 2배 기준)
function earn(n) {
  save.coins += n;
  G.earned += n;
}
function collectCoin() {
  G.coinsRun++;
  earn(ECON.coinValue);
  G.score += 10 * G.mult;
  sfx.coin();
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
  popup(t(POWER_LABEL[type]), 'power');
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
  // 원경 랜드마크는 크기(반폭)만큼 도로에서 떨어뜨려 놓아, 도로·카메라 위로 걸치지 않게 함
  if (!obj.userData.half) {
    const bb = new THREE.Box3().setFromObject(obj);
    obj.userData.half = { x: (bb.max.x - bb.min.x) / 2, z: (bb.max.z - bb.min.z) / 2 };
  }
  const { half } = obj.userData;
  // 좌우·거리는 판 시드로 정해 메뉴에서 보던 자리와 출발 후 자리가 같게
  const h = ((G.seed ?? 0) ^ (theme.code.charCodeAt(0) * 2654435761) ^ (theme.code.charCodeAt(1) * 40503)) >>> 0;
  const side = h & 1 ? 1 : -1, off = 70 + ((h >>> 1) % 31);
  const l = { obj, z: z - half.z, x: side * (half.x + off), halfZ: half.z };
  landmarks.push(l);
  // 바로 제자리에 놓음: 새로 만든 모델은 원점(카메라 바로 위)에 있으므로, 카운트다운 동안 화면을 덮거나 출발 순간 튀지 않게
  obj.position.set(l.x, 0, l.z);
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
  // 메뉴에서 이미 보이던 같은 나라 랜드마크는 그 자리 그대로 이어서 사용 (출발할 때 위치가 바뀌지 않게)
  const keep = landmarks.find((l) => l.obj === landmarkCache[t.landmark] && l.z < -300);
  for (const l of landmarks) if (l !== keep) l.obj.visible = false;
  landmarks = keep ? [keep] : [];
  if (!keep) spawnLandmark(t, -330);
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
    // 앞쪽 끝이 카메라에서 160m 안으로 들어오기 전에 정리 (가까이 오면 화면을 덮는 거대한 형상이 됨)
    if (l.z + l.halfZ > -160) {
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
      foot: row ? t('BEAT THIS RIDER TO TAKE THE BOARD') : t('BE THE FIRST IN {country}', { country: theme.country.toUpperCase() }),
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
pbMarker.setLabel(t('PERSONAL BEST'));
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
    popup(t('NEW RECORD!'), 'perfect', t('PERSONAL BEST DISTANCE'));
    sfx.mission();
  }
  if (!G.rivalPassed && G.rivalDist > 0 && G.distance >= G.rivalDist) {
    G.rivalPassed = true;
    popup(t('PASSED {name}!', { name: G.rivalName }), 'combo', t('#1 IN {country}', { country: countryName(save.country).toUpperCase() }));
    sfx.fever();
  }
}

// ======================================================================
// 돌발 핫 배달 (15초 안에 400m)
// ======================================================================
const HOT_TIME = 15, HOT_DIST = 400;
function updateHotDelivery(rdt) {
  if (G.distance > G.nextHot) {
    G.nextHot += 400;
    if (!G.hot && Math.random() < 0.2) {
      G.hot = { t: HOT_TIME, start: G.distance };
      popup(t('HOT DELIVERY!'), 'big', `${HOT_TIME}s / ${HOT_DIST} m`);
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
  $('hotText').textContent = `${Math.max(0, h.t).toFixed(1)}s · ${t('{n} m LEFT', { n: fmt(Math.max(0, HOT_DIST - done)) })}`;
  $('hotBar').style.width = `${clamp(done / HOT_DIST, 0, 1) * 100}%`;
  if (done >= HOT_DIST) {
    G.hot = null;
    earn(ECON.hotReward);
    G.hotDone++;
    popup(t('DELIVERED!'), 'perfect', t('+{n} COINS', { n: ECON.hotReward }));
    sfx.fireworks();
    vibrate([30, 40, 30]);
  } else if (h.t <= 0) {
    G.hot = null;
    popup(t('LATE DELIVERY'), 'combo');
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
    if (G.draftT === 0) popup(t('SLIPSTREAM'), 'power');
    G.draftT = Math.min(2, G.draftT + dt);
  } else {
    G.draftT = 0;
  }
}

const FEVER_TIME = 5;
// 피버 잔상: 바이크 뒤 노면에 깔리는 무지개 빛줄기 (예전 반투명 유령 바이크는 카메라와 바이크 사이에 떠서 바이크·점프 각도를 가렸음)
const TRAIL_COLORS = [0xff2fd6, 0xffe600, 0x7cff4f, 0x00e5ff].map((c) => new THREE.Color(c));
const TRAIL_SEG = 14, TRAIL_W = 0.11;
const feverTrail = (() => {
  const n = TRAIL_COLORS.length * (TRAIL_SEG + 1) * 2;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const idx = [];
  for (let c = 0; c < TRAIL_COLORS.length; c++) for (let k = 0; k < TRAIL_SEG; k++) {
    const o = (c * (TRAIL_SEG + 1) + k) * 2;
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);
  return mesh;
})();
const trailHistory = [];

function startFever() {
  G.feverT = FEVER_TIME;
  popup(t('FEVER MODE!'), 'big', t('x3 SCORE · AUTO MAGNET'));
  sfx.fever();
  vibrate([20, 30, 20, 30, 40]);
}

function updateFeverTrails() {
  trailHistory.push(G.x);
  if (trailHistory.length > TRAIL_SEG * 2 + 2) trailHistory.shift();
  const on = G.feverT > 0 && G.state === 'playing';
  feverTrail.visible = on;
  if (!on) return;
  const P = feverTrail.geometry.attributes.position, C = feverTrail.geometry.attributes.color;
  const fade = Math.min(1, G.feverT / 0.8); // 끝날 때 서서히 사라짐
  const lean = Math.sin(G.lean || 0) * 0.5;
  TRAIL_COLORS.forEach((col, c) => {
    const off = (c - (TRAIL_COLORS.length - 1) / 2) * TRAIL_W;
    for (let k = 0; k <= TRAIL_SEG; k++) {
      const h = trailHistory[Math.max(0, trailHistory.length - 1 - k * 2)] ?? G.x;
      const z = 0.95 + k * 0.55; // 뒷바퀴 바로 뒤부터 뒤로 뻗음 (노면, 바이크보다 앞으로 오지 않음)
      const x = h + off * (1 + k * 0.06) - (k === 0 ? lean : 0);
      const a = (1 - k / TRAIL_SEG) ** 1.4 * 0.85 * fade;
      const o = (c * (TRAIL_SEG + 1) + k) * 2;
      P.setXYZ(o, x - TRAIL_W / 2, 0.04, z);
      P.setXYZ(o + 1, x + TRAIL_W / 2, 0.04, z);
      C.setXYZ(o, col.r * a, col.g * a, col.b * a);
      C.setXYZ(o + 1, col.r * a, col.g * a, col.b * a);
    }
  });
  P.needsUpdate = true;
  C.needsUpdate = true;
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
  // 스피드 라인
  const kmh = spd * 3.6;
  const op = G.state === 'playing' ? clamp((kmh - 150) / 120, 0, 0.45) : 0;
  streaks.lines.visible = op > 0.01;
  if (streaks.lines.visible) {
    streaks.lines.material.opacity = op;
    const P = streaks.pos;
    const len = spd * 0.08;
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
  const p = clamp((1.35 - window.innerWidth / window.innerHeight) / 0.8, 0, 1); // 0 = 가로화면, 1 = 세로화면
  const baseY = lerp(3.0, 5.4, p), camZ = lerp(6.2, 8.4, p);
  let lookZ = lerp(-14, -24, p), lookY = lerp(1.2, 0.6, p);
  if (G.state === 'menu') {
    // 시작 화면: 라이더 뒤쪽 위에서 앞(-z)을 보는 3/4 구도. 앞쪽은 새로 생기는 길이라 건물이 사라지지 않고,
    // 카메라가 차선 위 높이(인도 소품은 x 9m 밖)에 있어 눈앞을 스치는 오브젝트도 없음. 좌우로 아주 천천히 흔들림
    const t = G.time || 0;
    const side = 2.6 + Math.sin(t * 0.25) * 0.8;
    camera.position.set(G.x + side, 2.8, 9.5);
    camera.lookAt(G.x + side * 0.22, 1.9, -10); // 거리 풍경이 보이도록 거의 수평, 라이더는 가운데
    // 화면 위쪽(헤더)·아래쪽(시트) 사이 창에 라이더가 오도록 투영을 아래로 늘려 위쪽으로 올려 그림
    const W = window.innerWidth, H = window.innerHeight;
    const extra = lerp(0.2, 0.45, p);
    // 매 프레임 적용: 로그인 후 설정 반영(applyQuality → resize) 등이 aspect 를 W/H 로 되돌려 세로로 늘어나 보이는 것 방지
    camera.setViewOffset(W, H * (1 + extra), 0, H * extra, W, H);
    const mfov = lerp(60, 84, p);
    if (Math.abs(camera.fov - mfov) > 0.05) camera.fov = lerp(camera.fov, mfov, Math.min(1, rdt * 4));
    camera.updateProjectionMatrix();
    return;
  }
  if (camera.view && camera.view.enabled) {
    // setViewOffset 이 camera.aspect 를 가상 프레임 비율로 바꿔 두므로, 해제할 때 실제 화면 비율로 되돌림
    camera.clearViewOffset();
    resize();
  }
  const sf = clamp((G.speed * 3.6 - 60) / 220, 0, 1);
  const fov = lerp(62, 72, p) + sf * 12 + (G.air ? 6 : 0) + (G.feverT > 0 ? 10 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, rdt * 4));
    camera.updateProjectionMatrix();
  }
  camX = lerp(camX, G.x * 0.75, Math.min(1, rdt * 5));
  camY = lerp(camY, (G.airY || 0) * 0.6, Math.min(1, rdt * 4));
  G.shake = Math.max(0, (G.shake || 0) - rdt * 2.2);
  const s = G.shake * 0.35;
  giantCam = lerp(giantCam, G.giantT > 0 ? 1 : 0, Math.min(1, rdt * 3));
  camera.position.set(camX + rand(-s, s), baseY + camY + giantCam * 1.6 + rand(-s, s), camZ + giantCam * 2.5);
  camera.lookAt(camX * 0.9, lookY + camY * 0.5, lookZ);
  camera.rotateZ((G.lean || 0) * 0.08);
}

// ---------- 입력 (키보드 + 멀티터치 포인터 추적)
const keys = {};
const held = { left: false, right: false, throttle: false, brake: false };
const holdPointers = new Map(); // pointerId → 'left' | 'right' | 'throttle' | 'brake'
const pad = { id: null, originX: 0, originY: 0, value: 0, throttle: false, brake: false, thrAmt: 0, brkAmt: 0 };
// 페달(스로틀 그립·브레이크 레버)을 얼마나 당겼는지 0~1: 누른 높이(위쪽일수록 많이), 누른 채 위로 밀면 더 당김
const pedalAmt = { throttle: 0, brake: 0 };
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
  pad.throttle = pad.brake = false;
  pad.thrAmt = pad.brkAmt = 0;
  pad.rawX = pad.rawUp = 0;
  refreshHeld();
}

function refreshHeld() {
  for (const k of Object.keys(held)) held[k] = false;
  for (const v of holdPointers.values()) held[v] = true;
  for (const [k, el] of Object.entries(holdButtons)) el.classList.toggle('active', held[k]);
  // 조이스틱 손잡이: 손가락 위치를 원 안(반경 JOY_R)으로 제한해 그대로 따라감
  $('steerKnob').style.transform = `translate(${pad.knobX || 0}px, ${pad.knobY || 0}px)`;
  const dot = $('steerDot');
  dot.classList.toggle('on', pad.id !== null);
  dot.classList.toggle('gas', pad.throttle);
  dot.classList.toggle('brk', pad.brake);
  dot.style.setProperty('--amt', (pad.thrAmt || pad.brkAmt || 0).toFixed(2));
}

// 페달 당긴 양: 버튼 아래쪽을 누르면 30%, 위쪽 끝(또는 그 위로 밀면) 100%
function setPedal(el, key, e) {
  if (!(key in pedalAmt)) return;
  const r = el.getBoundingClientRect();
  const a = clamp(0.3 + 0.7 * ((r.bottom - e.clientY) / r.height), 0.3, 1);
  pedalAmt[key] = a;
  el.style.setProperty('--amt', a.toFixed(2));
}

// 버튼마다 포인터 ID 를 따로 추적 → 조향·가속·브레이크·니트로 동시 입력
function bindHold(el, key) {
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') enableTouchUI();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    holdPointers.set(e.pointerId, key);
    setPedal(el, key, e);
    refreshHeld();
  });
  el.addEventListener('pointermove', (e) => { if (holdPointers.get(e.pointerId) === key) setPedal(el, key, e); });
  const up = (e) => {
    if (holdPointers.get(e.pointerId) !== key) return;
    holdPointers.delete(e.pointerId);
    if (key in pedalAmt) { pedalAmt[key] = 0; el.style.setProperty('--amt', 0); }
    refreshHeld();
  };
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, up);
}
for (const [k, el] of Object.entries(holdButtons)) bindHold(el, k);

// 터치 조향: 화면의 조향 쪽 영역 아무 데나 누른 지점이 기준점. 거기서 좌우로 민 만큼 조향 (패드 없음)
// 한 손 조작(설정 ONE-HAND SLIDE): 기준점에서 위로 밀면 스로틀, 아래로 밀면 브레이크
const STEER_RANGE = 80; // 기준점에서 이만큼(px) 밀면 최대 조향
const STEER_DEAD = 6;   // 손떨림 무시 구간(px)
const PEDAL_DEAD = 18;  // 위/아래로 이만큼(px) 넘게 밀어야 스로틀/브레이크
const PEDAL_FULL = 78;  // 여기까지 밀면 스로틀/브레이크 100% (그 사이는 민 만큼 비례)
const JOY_R = 46;      // 조이스틱 손잡이가 움직이는 반경(px)
function padFromPointer(e) {
  const dx = e.clientX - pad.originX, dy = pad.originY - e.clientY;
  const ax = Math.max(0, Math.abs(dx) - STEER_DEAD);
  const t = clamp(ax / (STEER_RANGE - STEER_DEAD), 0, 1);
  pad.value = Math.sign(dx) * t * (0.6 + 0.4 * t); // 가운데는 부드럽게, 끝으로 갈수록 크게
  // 한 손 조작: 버튼 없이 같은 손가락을 위로 밀면 스로틀, 아래로 밀면 브레이크 (페달 방식은 버튼으로)
  const oneHand = (save.settings.controls || 'onehand') === 'onehand';
  pad.throttle = oneHand && dy > PEDAL_DEAD;
  pad.brake = oneHand && dy < -PEDAL_DEAD;
  // 얼마나 밀었는지(0~1): 데드존을 넘은 만큼, PEDAL_FULL 까지 밀면 최대
  pad.thrAmt = pad.throttle ? clamp((dy - PEDAL_DEAD) / (PEDAL_FULL - PEDAL_DEAD), 0.15, 1) : 0;
  pad.brkAmt = pad.brake ? clamp((-dy - PEDAL_DEAD) / (PEDAL_FULL - PEDAL_DEAD), 0.15, 1) : 0;
  const m = Math.hypot(dx, dy), k = m > JOY_R ? JOY_R / m : 1;
  pad.knobX = dx * k;
  pad.knobY = oneHand ? -dy * k : 0;
  // 공중 묘기용 아날로그 방향 (데드존 밖에서만)
  pad.rawX = clamp(dx / STEER_RANGE, -1, 1);
  pad.rawUp = Math.abs(dy) > 12 ? clamp(dy / STEER_RANGE, -1, 1) : 0;
}
const steerZone = $('steerZone');
const steerDot = $('steerDot');
steerZone.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (pad.id !== null) return;
  if (e.pointerType === 'touch') enableTouchUI();
  try { steerZone.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  const r = steerZone.getBoundingClientRect();
  pad.id = e.pointerId;
  pad.originX = e.clientX;
  pad.originY = e.clientY;
  pad.value = 0;
  pad.throttle = pad.brake = false;
  pad.thrAmt = pad.brkAmt = 0;
  pad.rawX = pad.rawUp = 0;
  pad.knobX = pad.knobY = 0;
  steerDot.style.left = `${e.clientX - r.left}px`;
  steerDot.style.top = `${e.clientY - r.top}px`;
  refreshHeld();
});
steerZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== pad.id) return;
  padFromPointer(e);
  refreshHeld();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  steerZone.addEventListener(ev, (e) => {
    if (e.pointerId !== pad.id) return;
    pad.id = null;
    pad.value = 0;
    pad.throttle = pad.brake = false;
  pad.thrAmt = pad.brkAmt = 0;
    pad.rawX = pad.rawUp = 0;
    pad.knobX = pad.knobY = 0;
    refreshHeld();
  });
}

document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) b.blur();
});

// 방향 버튼·키보드: 누르는 순간 최대가 아니라 부드럽게 차오르고 최대치도 낮춤 (감도 완화)
const BTN_STEER_MAX = 0.8;
const BTN_STEER_RISE = 4.5; // 초당 증가량
let btnSteer = 0;
function updateButtonSteer(rdt) {
  let t = 0;
  if (keys.ArrowLeft || keys.KeyA || held.left) t -= BTN_STEER_MAX;
  if (keys.ArrowRight || keys.KeyD || held.right) t += BTN_STEER_MAX;
  // 반대 방향 전환·손 뗄 때는 빠르게, 누를 때는 천천히
  const rate = t === 0 || Math.sign(t) !== Math.sign(btnSteer) ? 10 : BTN_STEER_RISE;
  btnSteer = approach(btnSteer, t, rate * rdt);
}
function steerInput() {
  return clamp(btnSteer + pad.value, -1, 1);
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
  for (const d of [...dropZones, ...jumpRamps]) {
    d.active = false;
    d.obj.visible = false;
  }
  for (const p of powerItems) powerMeshes[p.type].group.visible = false;
  powerItems.length = 0;
}

function resetRun(seed) {
  const runSeed = seed ?? newSeed();
  seedWorld(runSeed);
  setThemeOrder(runSeed);
  clearWorld();
  screenRain.reset();
  Object.assign(G, {
    speed: 21, x: 3.5 * driveSign(0), vx: 0, lean: 0, distance: 0, score: 0, mult: 1, time: 0,
    coinsRun: 0, nearMiss: 0, combo: 0, comboTimer: 0, maxCombo: 0,
    shield: false, secondChance: false, boostsUsed: [], headT: 0, magnetTime: 0, x2Time: 0, slowTime: 0, giantT: 0, invuln: 0, oncomingDist: 0,
    rotAngle: 0, rotSeg: {}, rotTypes: [], rotationCount: 0, rotShown: 0, tricks: 0, landInv: 0,
    maxKmh: 0, smashed: 0, jumps: 0, continued: false, finalized: false,
    nextSpawn: 25, nextCoins: 60, nextPower: wrand('power', 120, 180), nextCones: wrand('cone', 350, 600),
    nextStall: wrand('stall', 300, 500), nextHazard: wrand('hazard', 350, 500), nextDrop: wrand('hazard', 400, 600), nextRamp: wrand('ramp', 250, 400), nextPuddle: wrand('puddle', 400, 700), nextSquall: wrand('weather', 1200, 2000),
    squallT: 0, rain: false, rainAmt: 0, lightning: 0, boltT: 0, shake: 0, crashT: 0,
    air: false, airY: 0, airVy: 0, slipT: 0, slipDir: 0, rpm: 0, braking: false,
    missionsDone: [], cd: 0, cdShown: 0, globalSubmitted: false,
    seed: runSeed, nextBoard: 120, nextMega: 300, nextHot: 500, hot: null, earned: 0, nextKm: 1000, hotDone: 0,
    draftT: 0, feverT: 0, pbDist: save.bestDist || 0, pbPassed: false,
    rivalDist: 0, rivalName: '', rivalPassed: false, doubled: false, revived: false,
  });
  for (let z = -60; z > SPAWN_Z; z -= wrand('car', 16, 26)) spawnCar(z);
  clearBoards();
  resetThemes();
  // 도로변 소품을 이번 판 국가 순서로 다시 배치
  for (const st of strips) st.items.forEach((it, k) => st.respawn(it, k));
  for (const st of strips) st.update(0);
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
  // 메뉴에서 보던 나라 그대로 출발 (재도전은 새 시드 → 새 국가 순서)
  resetRun(opts.seed ?? challengeSeed ?? (G.state === 'menu' ? G.seed : undefined));
  applyArmedBoosts();
  $('hotBanner').classList.add('hidden');
  hideScreens();
  $('hud').classList.remove('hidden');
  $('hudAdmin').classList.toggle('hidden', !isAdminMode());
  G.state = 'countdown';
  G.cd = 3.2;
  G.cdShown = 0;
  $('countdown').classList.remove('hidden');
  if (save.stats.runs === 0) showTutorial();
}

// 첫 판: 조작 안내 카드 (손가락 애니메이션). 첫 조작을 하거나 6초가 지나면 사라짐
let tutTimer = 0;
function showTutorial() {
  const c = save.settings.controls || 'onehand';
  $('tutTitle').textContent = t('HOW TO RIDE');
  $('tutText').textContent = t(c === 'onehand' ? 'Slide left / right to steer. Slide up for gas, down to brake.' : c === 'slide' ? 'Slide to steer. Hold THROTTLE to go, BRAKE to slow down.' : 'Use the arrows to steer. Hold THROTTLE to go, BRAKE to slow down.');
  $('tutorial').classList.remove('hidden');
  clearTimeout(tutTimer);
  tutTimer = setTimeout(hideTutorial, 6500);
  const off = () => { hideTutorial(); window.removeEventListener('pointerdown', off); window.removeEventListener('keydown', off); };
  setTimeout(() => { window.addEventListener('pointerdown', off); window.addEventListener('keydown', off); }, 3400); // 카운트다운 중에는 유지
}
function hideTutorial() {
  clearTimeout(tutTimer);
  const el = $('tutorial');
  if (el.classList.contains('hidden')) return;
  el.classList.add('out');
  setTimeout(() => { el.classList.add('hidden'); el.classList.remove('out'); toast(t('Brush past cars for NEAR MISS bonuses')); }, 300);
}

function updateCountdown(rdt) {
  G.cd -= rdt;
  const n = Math.ceil(G.cd - 0.2);
  const el = $('countdown');
  if (n !== G.cdShown) {
    G.cdShown = n;
    el.classList.remove('tick');
    void el.offsetWidth;
    el.innerHTML = `<span>${n > 0 ? n : t('GO!')}</span>`;
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
  if (G.distance >= G.nextKm && G.state === 'playing') { // 1 km 돌파 보너스
    earn(ECON.kmBonus);
    popup(`${fmt(G.nextKm / 1000)} KM!`, 'power', t('+{n} COINS', { n: ECON.kmBonus }));
    G.nextKm += 1000;
  }
  updateThemes(dz, frameDt);
  updateBoards(dz);
  roadTex.offset.y = (G.distance / TILE) % 1;
  grassTex.offset.y = (G.distance / 10) % 1;
  for (const s of strips) s.update(dz);
}

// 거리 기준 스폰 — 절대 거리 일정표(+=)를 써서 멀티에서 같은 거리 → 같은 결과
const SPAWN_KEYS = ['nextSpawn', 'nextCoins', 'nextPower', 'nextCones', 'nextStall', 'nextPuddle', 'nextSquall', 'nextHazard', 'nextDrop', 'nextRamp'];
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
  if (G.distance > G.nextRamp) {
    spawnJumpRamp();
    G.nextRamp += wrand('ramp', 180, 320); // 점프대 자주 등장
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
  toast(t('SQUALL WARNING  ·  30s HEAVY RAIN  ·  SCORE x1.3'));
  lightningStrike();
}

function updatePlaying(rdt) {
  const ts = G.slowTime > 0 ? 0.55 : 1;
  const dt = rdt * ts;
  G.time += rdt;
  G.slowTime = Math.max(0, G.slowTime - rdt);
  G.magnetTime = Math.max(0, G.magnetTime - rdt);
  if (G.headT > 0) {
    G.headT = Math.max(0, G.headT - rdt);
    G.invuln = Math.max(G.invuln, 0.8); // 질주 중 + 끝나고 잠깐 무적
    G.magnetTime = Math.max(G.magnetTime, 0.5);
  }
  G.x2Time = Math.max(0, G.x2Time - rdt);
  G.giantT = Math.max(0, G.giantT - rdt);
  G.landInv = Math.max(0, G.landInv - rdt);
  G.invuln = Math.max(0, G.invuln - rdt);
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
      toast(t('SQUALL HAS PASSED'));
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
  // 한 손 조작: 터치 영역에서 위로 밀면 스로틀, 아래로 밀면 브레이크
  // 아날로그: 키보드는 100%, 조이스틱은 민 만큼, 페달은 당긴 만큼 (0~1)
  const thrAmt = Math.max(keys.ArrowUp || keys.KeyW ? 1 : 0, held.throttle ? pedalAmt.throttle || 1 : 0, pad.thrAmt || 0);
  const brkAmt = Math.max(keys.ArrowDown || keys.KeyS ? 1 : 0, held.brake ? pedalAmt.brake || 1 : 0, pad.brkAmt || 0);
  const throttle = thrAmt > 0, brake = brkAmt > 0;
  G.thrAmt = thrAmt;
  const manual = false;
  const cruise = Math.min(maxSpd * 0.85, (75 + G.distance / 45) / 3.6);
  let target = manual ? 40 / 3.6 : cruise;
  // 순항 속도에서 최고 속도까지 당긴 만큼 / 브레이크는 순항에서 50 km/h 까지 누른 만큼
  if (throttle) target = cruise + (maxSpd - cruise) * thrAmt;
  if (brake) target = cruise + (50 / 3.6 - cruise) * brkAmt;
  // 소모성 부스트 HEAD START: 몇 초 동안 최고속의 1.5배로 무적 질주 (코인 자석 포함)
  if (G.headT > 0) target = maxSpd * 1.5;
  if (G.draftT > 0 && !brake) target *= 1 + 0.1 * clamp(G.draftT / 0.6, 0, 1); // 슬립스트림 가속
  const accel = G.headT > 0 ? 30 : target > G.speed ? 7 * bk.accel * (throttle ? 0.55 + 0.45 * thrAmt : 1) : brake ? 22 * (0.35 + 0.65 * brkAmt) : manual ? 5 : 6;
  if (!G.air) G.speed = approach(G.speed, target, accel * rdt); // 공중에선 속도 유지
  G.braking = Boolean(brake);
  // RPM: 스로틀을 감으면 빠르게 치솟고, 놓으면 떨어짐
  const spdRatio = clamp(G.speed / (maxSpd * 1.35), 0, 1);
  const rpmTarget = throttle ? clamp((0.35 + 0.37 * thrAmt) + spdRatio * 0.25 + Math.sin(G.time * 40) * 0.03, 0, 1) : 0;
  G.rpm = approach(G.rpm, rpmTarget, rdt * (rpmTarget > G.rpm ? 3.2 : 2.2));

  // 조향 (물웅덩이에 미끄러지면 반응이 둔해지고 옆으로 밀림)
  updateButtonSteer(rdt);
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
  }
  let mult = 1 + Math.min(G.combo, 20) * 0.1;
  if (onc) mult *= 2;
  if (G.x2Time > 0) mult *= 2;
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
  updateJumpRamps(dt, true);
  updateStalls(dt, true);
  if (G.state !== 'playing') return;
  updateCoins(dt, true);
  updatePowerups(dt, true);
  checkMissions();
  poseBike();
  sfx.engineUpdate(G.speed / maxSpd, false);
  sfx.setIntensity(spdRatio, false);
}

function startJump(c) {
  G.air = true;
  G.isAirborne = true;
  G.airY = 0.4;
  G.airVy = 9 + G.speed * 0.12; // 공중 묘기를 할 수 있도록 체공 시간 확보
  airQ.identity();
  G.rotAngle = 0;
  G.rotSeg = {}; // 지금 돌고 있는 바퀴에서 동작별로 돈 각도
  G.rotTypes = []; // 완성한 바퀴마다의 동작
  G.rotationCount = 0;
  G.rotShown = 0;
  G.jumps++;
  c.passed = true;
  sfx.jump();
  vibrate(30);
  popup(t('AIRBORNE'), 'big');
}

// 공중 자세는 쿼터니언 하나로 관리: 입력 방향(위·아래 = 플립, 좌·우 = 스핀, 사선 = 그 사이 축)을
// 회전축으로 삼아 돌리므로 사선으로 계속 누르면 그 대각선 축으로 정확히 360° 돈다
const TAU = Math.PI * 2;
const airQ = new THREE.Quaternion();
const airDq = new THREE.Quaternion();
const airAxis = new THREE.Vector3();
const levelQ = new THREE.Quaternion();
const offLevelAngle = () => 2 * Math.acos(Math.min(1, Math.abs(airQ.w))); // 수평 자세와의 각도 차

// 공중 묘기 입력 벡터: 슬라이드 중이면 손가락 방향 그대로(아날로그, 페달도 더함), 아니면 키/버튼
function trickInput(steer, throttle, brake) {
  if (pad.id !== null) {
    const pedal = (held.throttle ? 1 : 0) - (held.brake ? 1 : 0);
    return [clamp((pad.rawUp || 0) + pedal, -1, 1), pad.rawX || 0];
  }
  return [(throttle ? 1 : 0) - (brake ? 1 : 0), steer];
}

function updateAirTricks(rdt, steer, throttle, brake) {
  const [ix, iy] = trickInput(steer, throttle, brake); // ix: 플립(위 +), iy: 스핀(오른쪽 +)
  const mag = Math.min(1, Math.hypot(ix, iy));
  // 착지까지 남은 시간 (내려오는 중일 때만): airY + vy·t - g·t²/2 = 0
  const tLand = G.airVy < 0 || G.airY < 3 ? (G.airVy + Math.sqrt(G.airVy * G.airVy + 2 * GRAVITY * Math.max(0, G.airY))) / GRAVITY : Infinity;
  const off = offLevelAngle();
  if (tLand < LAND_ASSIST_TIME && G.airVy < 0 && off < LAND_ASSIST_ANGLE) {
    // 착지 직전 + 일정 각도 안: 입력과 상관없이 바퀴가 바닥을 향하도록 빠르게 맞춤 (남은 시간 안에 수평이 되게)
    const k = Math.min(1, Math.max(LAND_ASSIST_RATE * rdt, rdt / Math.max(0.05, tLand - 0.04)));
    airQ.slerp(levelQ, k);
  } else if (mag > 0.15) {
    airAxis.set(ix, iy, 0).normalize();
    const ang = AIR_SPIN * mag * rdt;
    airDq.setFromAxisAngle(airAxis, ang);
    airQ.premultiply(airDq);
    G.rotAngle += ang;
    const dir = trickDir(ix, iy);
    G.rotSeg[dir] = (G.rotSeg[dir] || 0) + ang;
  } else if (offLevelAngle() < 0.6) {
    // 입력을 놓으면 가까운 수평 자세로 살짝 맞춰 줌 (착지 보조)
    airQ.slerp(levelQ, Math.min(1, 4 * rdt));
  }
  G.rotationCount = Math.floor(G.rotAngle / TAU + 0.08);
  if (G.rotationCount > G.rotShown) {
    // 한 바퀴 완성: 그 바퀴 동안 가장 많이 돈 동작으로 기록
    while (G.rotTypes.length < G.rotationCount) {
      let best = 'back', most = -1;
      for (const k in G.rotSeg) if (G.rotSeg[k] > most) { most = G.rotSeg[k]; best = k; }
      G.rotTypes.push(best);
      G.rotSeg = {};
    }
    G.rotShown = G.rotationCount;
    popup(t(TRICK_NAMES[G.rotTypes[G.rotTypes.length - 1]]), 'combo', `${G.rotationCount * 360}°`);
    sfx.near(true);
  }
}

// 입력 방향 → 동작: 위(가속) = 전진(뒤로 돌기), 아래(브레이크) = 후진(앞으로 돌기), 좌/우 = 옆으로 돌기, 그 사이 = 사선
function trickDir(ix, iy) {
  const a = Math.atan2(Math.abs(iy), Math.abs(ix)); // 0 = 위·아래, π/2 = 좌·우
  if (a > 1.18) return 'side'; // 67.5° 넘으면 좌/우
  const fwd = ix >= 0;
  if (a < 0.39) return fwd ? 'back' : 'front'; // 22.5° 안이면 앞뒤
  return fwd ? 'backDiag' : 'frontDiag';
}

// 착지 점수: (기본 점수 합) × 회전 수 배수 × 콤보 배수 × TRICK_UNIT
function trickScore(types) {
  const n = types.length;
  if (!n) return { pts: TRICK_JUMP, rot: 0, combo: 0 };
  const sum = types.reduce((acc, k) => acc + TRICK_BASE[k], 0);
  const rot = TRICK_ROT_MULT[Math.min(n, 3)];
  const kinds = new Set(types).size;
  const combo = TRICK_COMBO_MULT[Math.min(kinds, 3)];
  return { pts: Math.round(sum * rot * combo * TRICK_UNIT), rot, combo, kinds };
}

function trickTitle(types) {
  const n = types.length;
  if (!n) return t('AIR JUMP!');
  const kinds = new Set(types).size;
  if (kinds > 1) return t('{n}-WAY COMBO', { n: kinds });
  const name = t(TRICK_NAMES[types[0]]);
  return n > 1 ? t('{n}x {trick}', { n, trick: name }) : name;
}

function land() {
  G.air = false;
  G.isAirborne = false;
  G.airY = 0;
  G.airVy = 0;
  // 착지 판정: 차체가 수평 자세에 가까워야 성공, 아니면 크래시
  const clean = offLevelAngle() < LAND_TOL;
  const types = G.rotTypes.slice(0, G.rotationCount);
  if (!clean) {
    popup(t('CRASH LANDING!'), 'big');
    crash({ x: G.x - 0.5 });
    return;
  }
  airQ.identity();
  // 착지 무적: 1.8초 동안 차·장애물과 부딪혀도 통과 (보호막처럼 은은하게 점멸)
  G.invuln = Math.max(G.invuln, LAND_IFRAMES);
  G.landInv = LAND_IFRAMES;
  const sc = trickScore(types);
  const pts = Math.round(sc.pts * (G.x2Time > 0 ? 2 : 1));
  G.score += pts;
  if (types.length > 0) G.tricks += types.length;
  const mult = types.length ? ` · x${sc.rot}${sc.combo > 1 ? ` · ${t('COMBO x{n}', { n: sc.combo })}` : ''}` : '';
  popup(trickTitle(types), 'perfect', t('CLEAN LANDING · +{n}', { n: fmt(pts) }) + mult);
  G.shake = 0.5;
  sfx.land();
  vibrate(40);
}

function hitPuddle() {
  G.slipT = 1.3;
  G.slipDir = Math.random() < 0.5 ? -1 : 1;
  sfx.splash();
  vibrate(20);
  popup(t('SLIPPING!'), 'power');
  screenRain.splash(16);
}

const pivotTmp = new THREE.Vector3();
const AIR_PIVOT = 0.9; // 공중 회전 중심 높이 (차체 가운데)
function poseBike() {
  if (G.air && G.rotAngle > 0) {
    bike.root.quaternion.copy(airQ);
    pivotTmp.set(0, AIR_PIVOT, 0).applyQuaternion(airQ);
    bike.root.position.set(G.x - pivotTmp.x, (G.airY || 0) + AIR_PIVOT - pivotTmp.y, -pivotTmp.z);
  } else {
    bike.root.rotation.set(0, 0, 0);
    bike.root.position.set(G.x, G.airY || 0, 0);
  }
  // 거대화: 차체 1.8배
  const gs = approach(bike.root.scale.x, G.giantT > 0 ? 1.8 : 1, 0.06);
  bike.root.scale.setScalar(gs);
  bike.lean.rotation.z = G.lean;
  bike.lean.rotation.x = G.air ? clamp(-G.airVy * 0.03, -0.3, 0.25) : 0;
  bike.flame.visible = G.headT > 0; // HEAD START 질주 중 배기 불꽃
  if (bike.flame.visible) bike.flame.scale.set(1.4, 1.4, rand(1.2, 2.0));
  shieldBubble.visible = G.shield || G.landInv > 0;
  shieldBubble.material.opacity = 0.18 + Math.sin(G.time * 6) * 0.06;
  // 무적 점멸: 착지 무적은 은은하게(느리게), 그 외 부딪힌 뒤 무적은 빠르게
  let visible = true;
  if (G.invuln > 0 && G.giantT <= 0 && !G.air) {
    visible = G.landInv > 0 ? Math.floor(G.time * 5) % 3 !== 0 : Math.floor(G.time * 12) % 2 === 0;
  }
  bike.root.visible = visible;
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
  // 시작 화면은 차 없이 라이더만: 카메라 앞을 스치는 오브젝트가 없게
  while (cars.length) releaseCar(cars[0]);
  updateStalls(rdt, false);
  poseBike();
  sfx.setIntensity(0.15, false);
}

function nearMiss(c, gap) {
  G.combo++;
  G.comboTimer = 3;
  if (G.combo % 5 === 0) startFever(); // 5연속 니어미스 → 피버
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.nearMiss++;
  const perfect = gap < 0.35;
  let pts = 100 * (1 + Math.min(G.combo, 40) * 0.25) * (perfect ? 2 : 1) * (c.type === 'police' ? 2 : 1) * (c.dir < 0 ? 1.5 : 1);
  if (G.x2Time > 0) pts *= 2;
  pts = Math.round(pts);
  G.score += pts;
  const tag = c.type === 'police' ? 'POLICE x2  ' : '';
  popup(perfect ? t('PERFECT!') : t('NEAR MISS!'), perfect ? 'perfect' : '', `${tag}+${pts}`);
  if (G.combo >= 2 && G.combo % 5 === 0) popup(t('COMBO x{n}', { n: G.combo }), 'combo');
  sfx.near(perfect);
  vibrate(perfect ? 25 : 12);
}

// kind: 'car' | 'small'(라바콘·표지판) | 'stall'(노점상)
function hitObstacle(o, kind = 'car') {
  if (G.state !== 'playing') return;
  const smashing = G.giantT > 0; // 거대화: 부딪힌 걸 날려버림
  if (G.invuln > 0 && !smashing) return; // 무적(깜빡임) 중엔 통과
  if (kind === 'hole') {
    // 구멍은 날려버릴 수 없음: 니트로·거대화는 그냥 지나가고, 보호막은 깨지며 통과
    if (smashing) return;
    if (G.shield) {
      G.shield = false;
      G.invuln = 1.2;
      popup(t('SHIELD BROKEN'), 'power');
      sfx.smash();
      return;
    }
    popup(t('OPEN MANHOLE!'), 'big');
    crash(o);
    return;
  }
  if (smashing || G.shield) {
    if (!smashing) {
      G.shield = false;
      G.invuln = 1.2;
      popup(t('SHIELD BROKEN'), 'power');
    } else if (kind === 'car') {
      G.smashed++;
      const pts = 300 * (G.x2Time > 0 ? 2 : 1);
      G.score += pts;
      popup(t('SMASH!'), 'combo', `+${pts}`);
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
  updateJumpRamps(dt, false);
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
  if (G.crashT > 1.7) {
    if (G.secondChance) {
      // 소모성 부스트: SECOND CHANCE — 한 번 무료 부활 (이어달리기 기회는 그대로)
      G.secondChance = false;
      const was = G.continued;
      reviveRun();
      G.continued = was;
      popup(t('SECOND CHANCE!'), 'big');
    } else {
      showGameOver();
    }
  }
}

// ---------- 미션
function missionValue(type) {
  switch (type) {
    case 'near': return G.nearMiss;
    case 'dist': return G.distance;
    case 'score': return G.score;
    case 'coins': return G.coinsRun;
    case 'oncoming': return G.oncomingDist;
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
    toast(`${t('MISSION COMPLETE')}  ·  ${missionText(m)}  ·  ${t('+{n} COINS', { n: m.reward })}`);
    sfx.mission();
    persist();
  }
}

// ---------- UI 헬퍼
const SCREENS = ['menu', 'garage', 'ranking', 'missions', 'notices', 'support', 'settings', 'pause', 'gameover', 'auth', 'daily', 'gacha', 'coinshop'];
let currentScreen = null;
// 버튼 글자 맞춤: 먼저 한 줄로 두고 넘치면 글자를 최대 72%까지 줄임. 그래도 넘치면 고르게 두 줄로 (CSS text-wrap: balance)
// 큰 글자가 따로 있는 버튼(시작 버튼의 .play-txt)은 그 글자만 줄임
function fitButton(el) {
  const tg = el.querySelector(':scope > .play-txt') || el;
  tg.style.fontSize = '';
  el.classList.add('fit-1');
  // 글자가 안쪽 여백(padding)까지 넘쳐도 잡히도록 실제 글자·아이콘 범위로 잼
  const rg = document.createRange();
  const over = () => {
    if (el.scrollWidth > el.clientWidth + 1 || tg.scrollWidth > tg.clientWidth + 1) return true;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    rg.selectNodeContents(el);
    const c = rg.getBoundingClientRect();
    return c.right > r.right - (parseFloat(cs.paddingRight) || 0) * 0.5 + 0.5 || c.left < r.left + (parseFloat(cs.paddingLeft) || 0) * 0.5 - 0.5;
  };
  if (!over()) return;
  const base = parseFloat(getComputedStyle(tg).fontSize) || 16;
  const min = Math.max(11, base * 0.72);
  let f = Math.max(min, Math.floor(base * Math.min(el.clientWidth / el.scrollWidth, tg.clientWidth / tg.scrollWidth) * 2) / 2);
  tg.style.fontSize = `${f}px`;
  while (over() && f > min) { f -= 0.5; tg.style.fontSize = `${f}px`; }
  if (over()) { el.classList.remove('fit-1'); tg.style.fontSize = `${Math.max(11, base * 0.86)}px`; }
}
let fitQueued = false;
function scheduleFit() {
  if (fitQueued) return;
  fitQueued = true;
  requestAnimationFrame(() => {
    fitQueued = false;
    for (const el of document.querySelectorAll('.screen:not(.hidden) .btn, .modal:not(.hidden) .btn')) if (el.offsetParent) fitButton(el);
  });
}
window.addEventListener('resize', scheduleFit);
// 버튼 글자가 바뀌면(번역·가격·카운트 등) 그 화면만 다시 맞춤. 게임 중 HUD 변경은 걸러서 비용 없음
new MutationObserver((list) => {
  for (const m of list) {
    const n = m.target.nodeType === 3 ? m.target.parentElement : m.target;
    const hit = m.type === 'attributes' ? n.classList.contains('screen') : n?.closest?.('.btn');
    if (hit) { scheduleFit(); return; }
  }
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });

function show(id) {
  const changed = currentScreen !== id;
  currentScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
  if (id && changed) { // 패널이 살짝 떠오르며 나타남
    const el = $(id);
    el.classList.remove('enter');
    void el.offsetWidth;
    el.classList.add('enter');
  }
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
  setFlexLabel(`${t('MY RIDE')} · ${bikeName(save.bike, myNationalCode())}`, look.opts.flag);
}
function setFlexLabel(text, flag) {
  $('flexLabel').innerHTML = `${flag ? flagBadge(flag, 'flag') : ''}${escapeHtml(text)}`;
}
function hideScreens() { show(null); }

const popupsEl = $('popups');
// 화면 중앙 알림: 최대 2개만 (새 것 위·큰 글씨, 이전 것은 작고 흐리게), 같은 알림이 연달아 오면 쌓지 않고 xN 으로 합침
const POPUP_MAX = 2;
function popup(text, cls = '', sub = '') {
  const last = popupsEl.firstElementChild;
  if (last && last.dataset.key === text && !last.classList.contains('old')) {
    const n = (Number(last.dataset.n) || 1) + 1;
    last.dataset.n = n;
    last.firstChild.textContent = `${text} x${n}`;
    const sm = last.querySelector('small');
    if (sub) { if (sm) sm.textContent = sub; } else if (sm) sm.remove();
    last.classList.remove('bump');
    void last.offsetWidth; // 애니메이션 재시작
    last.classList.add('bump');
    clearTimeout(last._t);
    last._t = setTimeout(() => last.remove(), 1100);
    return;
  }
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.dataset.key = text;
  el.appendChild(document.createTextNode(text));
  if (sub) {
    const s = document.createElement('small');
    s.textContent = sub;
    el.appendChild(s);
  }
  if (cls === 'big') popupsEl.replaceChildren(); // 큰 알림은 앞의 작은 알림들을 정리하고 단독으로
  for (const old of popupsEl.children) old.classList.add('old');
  popupsEl.prepend(el);
  while (popupsEl.children.length > POPUP_MAX) popupsEl.lastElementChild.remove();
  el._t = setTimeout(() => el.remove(), 1250);
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
  score: $('hudScore'), mult: $('hudMult'), combo: $('hudCombo'), best: $('hudBest'), tags: $('hudTags'), powers: $('hudPowers'),
  speed: $('hudSpeed'), dist: $('hudDist'), coins: $('hudCoins'), boostFx: $('boostFx'),
  speedArc: $('speedArc'), rpmArc: $('rpmArc'), brakeFx: $('brakeFx'),
};
let lastTags = '';
// 상단 중앙: 지금 켜진 아이템·부스터 + 남은 시간 (아이콘 · 초 · 줄어드는 막대)
const powerMax = {};
let lastPowers = '';
function powerChip(key, ic, label, t, cls = '') {
  if (t === true) return `<span class="pw ${cls}" title="${label}">${icon(ic)}</span>`;
  if (!(t > 0)) {
    delete powerMax[key];
    return '';
  }
  powerMax[key] = Math.max(powerMax[key] || 0, t);
  const f = Math.round((t / powerMax[key]) * 20) * 5;
  return `<span class="pw ${cls}" title="${label}">${icon(ic)}<em>${Math.ceil(t)}s</em><i style="width:${f}%"></i></span>`;
}
function updatePowerHud() {
  const html = [
    powerChip('fever', 'bolt', 'FEVER x3', G.feverT, 'hot'),
    powerChip('giant', 'giant', t('GIANT'), G.giantT, 'hot'),
    powerChip('x2', 'x2', t('SCORE'), G.x2Time),
    powerChip('head', 'bolt', t('HEAD START'), G.headT, 'hot'),
    powerChip('magnet', 'magnet', t('MAGNET'), G.headT > 0 ? 0 : G.magnetTime),
    powerChip('slow', 'clock', t('SLOW-MO'), G.slowTime),
    G.shield ? powerChip('shield', 'shield', t('SHIELD'), true) : '',
    G.secondChance ? powerChip('revive', 'retry', '2ND CHANCE', true) : '',
  ].join('');
  if (html !== lastPowers) {
    hud.powers.innerHTML = html;
    lastPowers = html;
  }
}
const tagHtml = (ic, text, cls = '') => `<span class="tag ${cls}">${ic ? icon(ic) : ''}${text}</span>`;

function updateHud() {
  const scoreText = fmt(G.score);
  hud.score.textContent = scoreText;
  hud.score.dataset.len = scoreText.length > 9 ? 'xl' : scoreText.length > 7 ? 'l' : '';
  hud.mult.textContent = 'x' + G.mult.toFixed(1);
  hud.mult.classList.toggle('hot', G.mult >= 2);
  hud.combo.classList.toggle('hidden', G.combo < 2);
  if (G.combo >= 2) hud.combo.textContent = t('COMBO {n}', { n: G.combo });
  hud.best.textContent = `${t('BEST')} ${fmt(Math.max(save.best, G.score))}`;
  hud.speed.textContent = Math.round(G.speed * 3.6);
  hud.dist.textContent = `${fmt(G.distance)} m`;
  hud.coins.textContent = fmtCoins(save.coins);
  const maxSpd = getBike(save.bike).maxKmh / 3.6;
  hud.speedArc.setAttribute('stroke-dasharray', `${(clamp(G.speed / maxSpd, 0, 1) * 100).toFixed(1)} 100`);
  hud.rpmArc.setAttribute('stroke-dasharray', `${(G.rpm * 100).toFixed(1)} 100`);
  hud.boostFx.classList.toggle('slow', G.slowTime > 0);
  hud.brakeFx.classList.toggle('on', G.braking && G.state === 'playing');
  $('feverFx').classList.toggle('on', G.feverT > 0 && G.state === 'playing');

  updatePowerHud();
  const tags = [];
  if (G.air && G.rotationCount > 0) tags.push(tagHtml('flip', t('TRICK x{n}', { n: G.rotationCount })));
  else if (G.draftT > 0) tags.push(tagHtml('gauge', t('SLIPSTREAM')));
  if (G.onc) tags.push(tagHtml('warn', 'WRONG WAY x2', 'onc'));
  if (G.air) tags.push(tagHtml('jump', t('AIRBORNE')));
  if (G.rain) tags.push(tagHtml('rain', `${t('SQUALL')} ${Math.ceil(Math.max(0, G.squallT))}s · x1.3`));
  if (G.slipT > 0) tags.push(tagHtml('drop', t('SLIPPING'), 'onc'));
  const html = tags.join('');
  if (html !== lastTags) {
    hud.tags.innerHTML = html;
    lastTags = html;
  }
}

// ---------- 화면: 메뉴
function goMenu() {
  sfx.engineStop();
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
  updateNoticeDot();
  $('challengeChip').classList.toggle('hidden', challengeSeed == null);
  if (challengeSeed != null) $('challengeText').textContent = `${t('CHALLENGE ROAD')} #${challengeSeed}`;
  const s = getSession();
  $('menuName').textContent = s ? s.nickname : save.lastName || 'Rider';
  $('accountLabel').textContent = s ? s.nickname.toUpperCase() : t('SIGN IN');
  $('menuBest').textContent = fmt(save.best);
  $('menuDist').textContent = `${fmt(save.bestDist || 0)} m`;
  $('menuRecent').textContent = `${fmt(save.lastDist || 0)} m`;
  $('menuCountry').innerHTML = `${flagBadge(save.country)}${escapeHtml(save.country)}`;
  $('menuFlag').innerHTML = `${flagBadge(save.country)}<span>${escapeHtml(countryName(save.country).toUpperCase())}</span>`;
  $('menuCoins').textContent = fmtCoins(save.coins);
  renderBoostBar();
  $('adminBadge').classList.toggle('hidden', !isAdminMode());
  $('guestNote').classList.toggle('hidden', Boolean(s) && isServerReady());
  $('guestNote').textContent = s ? t('OFFLINE · progress is not being saved') : t('GUEST · sign in to save coins and items');
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
$('btnGarage').addEventListener('click', () => { garageSel = null; renderGarage(); openScreen('garage'); });
$('btnRanking').addEventListener('click', () => { openScreen('ranking'); renderRanking(); });
$('btnMissions').addEventListener('click', () => { renderMissions(); openScreen('missions'); });
// ---------- 공지 (서버 app_config 'notices' 우선, 없으면 기본 공지)
let notices = DEFAULT_NOTICES;
function setNotices(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.items) ? raw.items : null;
  if (!list) return;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  notices = list.filter((n) => n && typeof n === 'object' && str(n.title, 80))
    .map((n) => ({
      id: str(n.id, 60) || str(n.title, 60), date: str(n.date, 20), tag: str(n.tag, 16).toUpperCase() || 'NOTICE', title: str(n.title, 80), body: str(n.body, 2000),
      // 관리자 페이지가 자동 번역해 넣는 언어별 제목·본문 { vi: { title, body }, ... }
      i18n: Object.fromEntries(Object.entries(n.i18n && typeof n.i18n === 'object' ? n.i18n : {}).map(([k, v]) => [k, { title: str(v?.title, 80), body: str(v?.body, 2000) }])),
    }))
    .slice(0, 30);
}
function updateNoticeDot() {
  $('noticeDot').classList.toggle('hidden', !notices.length || save.noticeSeen === notices[0].id);
}
// 관리자가 번역해 두지 않은 언어는 기계 번역으로 채움 (기기에 캐시)
const NTR_KEY = 'gr.noticeTr';
let noticeTr = {};
try { noticeTr = JSON.parse(localStorage.getItem(NTR_KEY)) || {}; } catch (e) { noticeTr = {}; }
const ntrPending = new Set();
const looksLatin = (s) => /^[\u0000-\u024f\u1e00-\u1eff\u2000-\u206f\s]*$/.test(s);
function noticeText(n) {
  const lang = getLang();
  const loc = n.i18n?.[lang];
  if (loc?.title) return loc;
  if (t(n.title) !== n.title) return { title: t(n.title), body: t(n.body) }; // 게임에 들어 있는 기본 공지
  const src = n.i18n?.ko?.title ? { ...n.i18n.ko, lang: 'ko' } : { title: n.title, body: n.body, lang: 'auto' };
  if (lang === 'en' && looksLatin(n.title)) return n;
  const key = `${lang}|${n.id}|${src.title.length}|${src.body.length}`;
  if (noticeTr[key]) return noticeTr[key];
  if (!ntrPending.has(key)) {
    ntrPending.add(key);
    Promise.all([machineTranslate(src.title, src.lang, lang), src.body ? machineTranslate(src.body, src.lang, lang) : ''])
      .then(([title, body]) => {
        noticeTr[key] = { title, body };
        try { localStorage.setItem(NTR_KEY, JSON.stringify(noticeTr)); } catch (e) { /* ignore */ }
        if (currentScreen === 'notices') renderNotices();
      })
      .catch(() => {})
      .finally(() => ntrPending.delete(key));
  }
  return lang === 'ko' && n.i18n?.ko ? n.i18n.ko : n; // 번역이 오기 전엔 원문
}
function renderNotices() {
  $('noticeList').innerHTML = notices.length
    ? notices.map((n) => {
      const { title, body } = noticeText(n);
      return `<article class="notice tag-${n.tag.toLowerCase()}"><div class="nt-head"><em>${escapeHtml(t(n.tag))}</em><small>${escapeHtml(n.date)}</small></div>
      <h3>${escapeHtml(title)}</h3><p>${escapeHtml(body).replace(/\n/g, '<br>')}</p></article>`;
    }).join('')
    : `<p class="muted">${t('No notices yet.')}</p>`;
}
$('btnNotices').addEventListener('click', () => {
  renderNotices();
  pollConfig(); // 열 때마다 최신 공지 확인
  openScreen('notices');
  if (notices.length && save.noticeSeen !== notices[0].id) {
    save.noticeSeen = notices[0].id;
    persist();
  }
  updateNoticeDot();
});
$('btnSettings').addEventListener('click', () => { renderSettings(); openScreen('settings'); });
$('btnAccount').addEventListener('click', () => { renderAuth(); openScreen('auth'); });
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => {
    sfx.click();
    if (backTo === 'gameover') {
      show('gameover');
      submitGlobal();
    } else if (backTo === 'settings') {
      renderSettings();
      show('settings');
    } else {
      refreshMenu();
      show('menu');
    }
    backTo = 'menu';
  });
}

// ---------- 차고: 탭 4개(바이크 / 라이더 / 배달통 / 국기) + 타일 격자
// 타일을 누르면 3D 쇼룸에서 먼저 미리보고, 아래 버튼으로 장착하거나 구매
let garageTab = 'bike';
let garageSel = null; // { kind, id } — 미리보기 중인 아이템
const SHOP = {
  box: { list: BOXES, owned: 'ownedBoxes', cur: 'box' },
  outfit: { list: OUTFITS, owned: 'ownedOutfits', cur: 'outfit' },
  helmet: { list: HELMETS, owned: 'ownedHelmets', cur: 'helmet' },
  flag: { list: FLAGS, owned: 'ownedFlags', cur: 'flag' },
};
// 종류별 정보: 저장 키(장착), 보유 목록, 카탈로그, 이름
const KINDS = {
  bike: { cur: 'bike', owned: 'ownedBikes', list: () => BIKES, label: 'BIKE' },
  box: { cur: 'box', owned: 'ownedBoxes', list: () => BOXES, label: 'DELIVERY BOX' },
  outfit: { cur: 'outfit', owned: 'ownedOutfits', list: () => OUTFITS, label: 'OUTFIT' },
  helmet: { cur: 'helmet', owned: 'ownedHelmets', list: () => HELMETS, label: 'HEADGEAR' },
  flag: { cur: 'flag', owned: 'ownedFlags', list: () => [{ id: '', name: 'No Flag', price: 0, desc: 'Ride without a flag' }, ...FLAGS], label: 'FLAG' },
  bikePaint: { cur: 'bikePaint', owned: 'ownedPaints', list: () => [{ id: '', name: 'Factory Color', price: 0, desc: 'Original color' }, ...PAINTS], label: 'BIKE PAINT' },
  helmetPaint: { cur: 'helmetPaint', owned: 'ownedPaints', list: () => [{ id: '', name: 'Factory Color', price: 0, desc: 'Original color' }, ...PAINTS], label: 'HEADGEAR COLOR' },
};
const TAB_SECTIONS = {
  bike: ['bike', 'bikePaint'],
  rider: ['helmet', 'helmetPaint', 'outfit'],
  box: ['box'],
  flag: ['flag'],
};
const itemOf = (kind, id) => KINDS[kind].list().find((x) => x.id === id) || null;

// 아이템 상태: equipped / owned / buy / locked
function itemState(kind, it) {
  const k = KINDS[kind];
  if (save[k.cur] === it.id) return 'equipped';
  if (it.id === '' || it.price === 0) return 'owned';
  if (it.special === 'national') return save.nationalUnlocked || isAdminMode() ? 'owned' : 'locked';
  if (save[k.owned].includes(it.id) || isAdminMode()) return 'owned';
  if (it.special) return 'locked';
  return 'buy';
}

const THUMB_KINDS = new Set(['box', 'helmet', 'outfit', 'bike']);
function tileVisual(kind, it) {
  // 상자·헤드기어·의상·바이크: 3D 모델 썸네일 (배경 없음, 그려지기 전엔 색 점)
  if (THUMB_KINDS.has(kind) && it.special !== 'national') {
    return `<span class="tv item-thumb" style="--sw:${it.swatch || '#ccc'}"><img data-thumb="${thumbKey(kind, it.id)}" alt="">${it.tag ? flagBadge(it.tag, 'flag') : ''}</span>`;
  }
  if (kind === 'bike') {
    if (it.special === 'national') {
      const [c1, c2] = nationalLivery(myNationalCode()).map((c) => '#' + c.toString(16).padStart(6, '0'));
      return `<span class="tv round" style="background:linear-gradient(135deg, ${c1} 50%, ${c2} 50%)">${flagBadge(myNationalCode(), 'flag')}</span>`;
    }
    const hex = '#' + it.color.toString(16).padStart(6, '0');
    return `<span class="tv round" style="background:${hex}26;color:${hex === '#f2f2f2' ? '#5b6470' : hex};box-shadow:inset 0 0 0 2px ${hex}">${icon('bike')}</span>`;
  }
  if (kind === 'flag') return it.id ? `<span class="tv flagtv">${flagBadge(it.id, 'flag')}</span>` : '<span class="tv none">—</span>';
  if (kind === 'bikePaint' || kind === 'helmetPaint') {
    if (!it.id) return '<span class="tv dot factory"></span>';
    const hex = '#' + it.hex.toString(16).padStart(6, '0');
    return `<span class="tv dot ${it.finish}" style="--c:${hex}"></span>`;
  }
  if (kind === 'box' && it.special === 'national') return `<span class="tv">${flagBadge(myNationalCode(), 'flag')}</span>`;
  // 나라 특색 아이템: 색 견본 위에 그 나라 국기 배지
  if (it.tag) return `<span class="tv tagged" style="background:${it.swatch}">${flagBadge(it.tag, 'flag')}</span>`;
  return `<span class="tv" style="background:${it.swatch}"></span>`;
}

function tileSub(kind, it, st) {
  if (st === 'equipped') return `<em class="ok">${icon('check')}</em>`;
  if (st === 'locked') return `<em class="lock">${it.special === 'national' ? '#1' : t('7-DAY')}</em>`;
  if (st === 'buy') return `<em class="price">${icon('coin')}${fmtCoins(it.price)}</em>`;
  return '';
}

// 등급순 정렬: 무료 기본템 → COMMON → RARE → EPIC → LEGENDARY (같은 등급은 가격순), 특별 아이템(국가대표·출석)은 맨 뒤
const TIER_RANK = { common: 1, rare: 2, epic: 3, legendary: 4 };
function sortByTier(items) {
  const rank = (it) => (it.special ? 9 : !it.price ? 0 : TIER_RANK[it.tier] || 1);
  return items.map((it, i) => [it, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0].price || 0) - (b[0].price || 0) || a[1] - b[1]).map((x) => x[0]);
}

function renderTiles(kind) {
  const k = KINDS[kind];
  const items = sortByTier(k.list().filter((it) => kind !== 'bike' || !it.special || it.special === 'national'));
  const compact = kind === 'flag' || kind === 'bikePaint' || kind === 'helmetPaint';
  return `<div class="shop-section">${t(k.label)}</div><div class="tile-grid ${compact ? 'compact' : ''}">${items.map((it) => {
    const st = itemState(kind, it);
    const sel = garageSel && garageSel.kind === kind && garageSel.id === it.id;
    const name = kind === 'flag' && it.id ? it.id : t(it.name);
    const tr = it.tier && TIERS[it.tier];
    return `<button class="tile ${st} ${sel ? 'sel' : ''} ${tr ? `tier-${it.tier}` : ''}" data-kind="${kind}" data-id="${it.id}" title="${escapeHtml(it.name)}"${tr ? ` style="--tc:${tr.color}"` : ''}>${tr ? `<i class="tier-dot">${tr.label[0]}</i>` : ''}
      ${tileVisual(kind, it)}<span class="tn">${escapeHtml(name)}</span>${tileSub(kind, it, st)}</button>`;
  }).join('')}</div>`;
}

// 미리보기: 지금 장착 상태에서 선택한 아이템 하나만 바꿔 쇼룸에 표시
function previewLook() {
  if (!garageSel) return myLook();
  const eq = { ...save, [KINDS[garageSel.kind].cur]: garageSel.id };
  return composeLook(eq.bike, myNationalCode(), eq);
}

function renderActionBar() {
  const bar = $('garageAction');
  const sel = garageSel;
  const it = sel && itemOf(sel.kind, sel.id);
  if (!it) {
    bar.innerHTML = `<div class="ga-info"><b>${t('Tap an item to preview')}</b><small>${t('Your current ride is shown above')}</small></div>`;
    return;
  }
  const st = itemState(sel.kind, it);
  let desc = it.desc || '';
  if (it.special === 'national') desc = save.nationalUnlocked || isAdminMode() ? t('Painted in {country} colors', { country: countryName(myNationalCode()) }) : t('Be #1 in {country} to unlock', { country: countryName(save.country) });
  if (it.finish) desc = t('{finish} finish · bike and headgear', { finish: t(it.finish.toUpperCase()) });
  let btn;
  if (st === 'equipped') btn = `<button class="btn" disabled>${t('EQUIPPED')}</button>`;
  else if (st === 'owned') btn = `<button class="btn primary" data-act="equip">${t('EQUIP')}</button>`;
  else if (st === 'buy') btn = `<button class="btn gold" data-act="buy" ${save.coins < it.price ? 'disabled' : ''}>${icon('coin')}${fmtCoins(it.price)}</button>`;
  else btn = `<button class="btn" disabled>${it.special === 'national' ? t('#1 ONLY') : t('7-DAY STREAK')}</button>`;
  const tr = it.tier && TIERS[it.tier];
  // 바이크 스펙: 최고 속도·가속·핸들링 막대 (모든 바이크 중 최고치 기준)
  let spec = '';
  if (sel.kind === 'bike' && it.maxKmh) {
    const max = (k) => Math.max(...BIKES.map((x) => x[k] || 0));
    const row = (label, v, top, val) => `<div class="ga-spec-row"><span>${t(label)}</span><i><b style="width:${Math.round(clamp(v / top, 0.08, 1) * 100)}%"></b></i><em>${val}</em></div>`;
    spec = `<div class="ga-spec">${row('TOP SPEED', it.maxKmh, max('maxKmh'), `${it.maxKmh} km/h`)}${row('ACCEL', it.accel || 1, max('accel'), `${Math.round((it.accel || 1) * 100)}`)}${row('HANDLING', it.handling || 1, max('handling'), `${Math.round((it.handling || 1) * 100)}`)}</div>`;
  }
  bar.innerHTML = `<div class="ga-info"><small>${t(KINDS[sel.kind].label)}${tr ? ` · <em class="tier-tag" style="--tc:${tr.color}">${t(tr.label)}</em>` : ''}</small><b>${escapeHtml(t(it.name))}</b><span>${escapeHtml(t(desc))}</span>${spec}</div>${btn}`;
}

function renderGarage() {
  $('garageCoins').textContent = fmtCoins(save.coins);
  if (stage) {
    const look = previewLook();
    stage.setRider(look.opts, look.color);
  }
  $('btnGacha').disabled = save.coins < ECON.gachaPrice;
  $('gachaOdds').textContent = `${t('MYSTERY BOX ODDS')} · ${Object.entries(GACHA_ODDS).map(([k, p]) => `${t(TIERS[k].label)} ${p}%`).join(' · ')} — ${t('a random unowned box, outfit or helmet of that tier (if you own every item of a tier, the others share its chance)')}`;
  $('btnGacha').querySelector('span').textContent = `${t('MYSTERY BOX')} · ${fmt(ECON.gachaPrice)}`;
  $('btnAdCoins').classList.toggle('hidden', !adsEnabled());
  updateAdCoinsLabel();
  for (const b of $('garageTabs').children) b.classList.toggle('on', b.dataset.tab === garageTab);
  const adminNote = isAdminMode() ? '<div class="admin-note">ADMIN MODE · every item unlocked · scores are not recorded</div>' : '';
  $('shopList').innerHTML = adminNote + TAB_SECTIONS[garageTab].map(renderTiles).join('');
  fillThumbs($('shopList'), (kind, id) => (kind === 'bike' ? BIKES.find((b) => b.id === id)?.color : undefined));
  renderActionBar();
}

$('garageTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tab]');
  if (!b) return;
  garageTab = b.dataset.tab;
  garageSel = null;
  sfx.click();
  renderGarage();
});

$('shopList').addEventListener('click', (e) => {
  const t = e.target.closest('.tile');
  if (!t) return;
  garageSel = { kind: t.dataset.kind, id: t.dataset.id };
  sfx.click();
  renderGarage();
});

$('garageAction').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || !garageSel) return;
  const { kind, id } = garageSel;
  const k = KINDS[kind];
  const it = itemOf(kind, id);
  if (!it) return;
  const st = itemState(kind, it);
  if (btn.dataset.act === 'buy') {
    if (st !== 'buy' || save.coins < it.price) return;
    save.coins -= it.price;
    save[k.owned].push(id);
    sfx.power();
    toast(`${t('UNLOCKED')}  ·  ${it.name}`);
  } else {
    if (st !== 'owned') return;
    sfx.click();
  }
  if (kind === 'bike' && id === 'national' && save.bike !== 'national') save.prevBike = save.bike;
  if (kind === 'box' && id === 'national' && save.box !== 'national') save.prevBox = save.box;
  save[k.cur] = id;
  persist();
  syncMyLook();
  buildBike();
  resetBikePose();
  renderGarage();
});

// ---------- 미스터리 박스: 등급 먼저 뽑고(GACHA_ODDS), 그 등급의 미보유 상자·의상·헬멧 중 하나
let gachaResult = null;
function gachaPool() {
  const pool = [];
  for (const [kind, cat] of Object.entries(SHOP)) {
    if (kind !== 'flag') for (const it of cat.list) if (it.price > 0 && !it.special && !save[cat.owned].includes(it.id)) pool.push({ kind, it });
  }
  return pool;
}
const gachaPoolSize = () => gachaPool().length;
function gachaPick(pool) {
  const byTier = {};
  for (const e of pool) (byTier[e.it.tier || 'common'] ||= []).push(e);
  const tiers = Object.keys(GACHA_ODDS).filter((t) => byTier[t]);
  let r = Math.random() * tiers.reduce((a, t) => a + GACHA_ODDS[t], 0);
  for (const t of tiers) {
    r -= GACHA_ODDS[t];
    if (r <= 0) return pick(byTier[t]);
  }
  return pick(byTier[tiers[tiers.length - 1]]);
}
$('btnGacha').addEventListener('click', () => {
  if (save.coins < ECON.gachaPrice) return;
  const pool = gachaPool();
  save.coins -= ECON.gachaPrice;
  const reveal = $('gachaReveal');
  if (!pool.length) {
    save.coins += ECON.gachaRefund;
    gachaResult = null;
    reveal.innerHTML = `<div class="swatch" style="background:#ffd34d"></div><b>${t('ALL COLLECTED!')}</b><span class="muted">${t('Refunded {n} coins', { n: fmt(ECON.gachaRefund) })}</span>`;
  } else {
    gachaResult = gachaPick(pool);
    save[SHOP[gachaResult.kind].owned].push(gachaResult.it.id);
    const label = t({ box: 'DELIVERY BOX', outfit: 'OUTFIT', helmet: 'HELMET' }[gachaResult.kind]);
    const tr = TIERS[gachaResult.it.tier] || TIERS.common;
    reveal.innerHTML = `<div class="swatch" style="background:${gachaResult.it.swatch}"></div><small class="tier-tag" style="--tc:${tr.color}">${t(tr.label)} ${label}</small><b>${escapeHtml(t(gachaResult.it.name))}</b><span class="muted">${escapeHtml(t(gachaResult.it.desc))}</span>`;
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
    syncMyLook();
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

// ======================================================================
// 소모성 부스트: 메뉴에서 장착(보유 시) / 두 번 눌러 구매 → 다음 판 시작 시 1개 소모
// ======================================================================
let boostBuyArm = null; // 구매 확인 대기 중인 부스트 id (2.5초)
let boostInfo = null; // 마지막으로 누른 부스트 → 설명을 위에 보여 줌
let boostBuyTimer = 0;
const boostCount = (id) => Math.max(0, Math.floor(save.boosts?.[id] || 0));
function renderBoostBar() {
  const bar = $('boostBar');
  if (!bar) return;
  const armed = new Set(save.armedBoosts);
  const info = boostInfo && BOOSTS.find((x) => x.id === boostInfo);
  bar.innerHTML = `<div class="boost-head"><b>${t('BOOSTS')}</b><small>${armed.size ? t('{n} ready for the next ride', { n: armed.size }) : t('Tap to equip for the next ride')}</small></div>
    ${info ? `<p class="boost-desc"><b>${escapeHtml(t(info.name))}</b> — ${escapeHtml(t(info.desc))}</p>` : ''}
    <div class="boost-row">${BOOSTS.map((b) => {
    const n = boostCount(b.id);
    const on = armed.has(b.id);
    const confirm = boostBuyArm === b.id;
    const foot = confirm ? `<em class="buy">${t('BUY {n}?', { n: fmt(b.price) })}</em>`
      : n > 0 ? `<em class="cnt">x${n}</em>` : `<em class="price">${icon('coin')}${fmt(b.price)}</em>`;
    return `<button class="boost${on ? ' on' : ''}${confirm ? ' confirm' : ''}" data-boost="${b.id}" title="${escapeHtml(t(b.desc))}">
      ${on ? `<span class="chk">${icon('check')}</span>` : ''}<i>${icon(b.icon)}</i><span class="nm">${escapeHtml(t(b.name))}</span>${foot}</button>`;
  }).join('')}</div>`;
}
function buyBoost(id, count = 1, price) {
  const b = BOOSTS.find((x) => x.id === id);
  const cost = price ?? b.price * count;
  if (save.coins < cost) {
    toast(t('NOT ENOUGH COINS  ·  {n} NEEDED', { n: fmt(cost) }));
    return false;
  }
  save.coins -= cost;
  save.boosts = { ...save.boosts, [id]: boostCount(id) + count };
  persist();
  sfx.coin();
  return true;
}
$('boostBar').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-boost]');
  if (!btn) return;
  const id = btn.dataset.boost;
  const b = BOOSTS.find((x) => x.id === id);
  sfx.init();
  sfx.click();
  boostInfo = id;
  const armed = save.armedBoosts.includes(id);
  if (armed) {
    save.armedBoosts = save.armedBoosts.filter((x) => x !== id);
  } else if (boostCount(id) > 0 || isAdminMode()) {
    save.armedBoosts = [...save.armedBoosts, id];
  } else if (boostBuyArm === id) {
    // 두 번째 탭: 구매 후 바로 장착
    boostBuyArm = null;
    if (buyBoost(id)) {
      save.armedBoosts = [...save.armedBoosts, id];
      toast(`${t(b.name)}  ·  ${t('READY FOR THE NEXT RIDE')}`);
    }
  } else {
    boostBuyArm = id;
    clearTimeout(boostBuyTimer);
    boostBuyTimer = setTimeout(() => { boostBuyArm = null; renderBoostBar(); }, 2500);
  }
  persist();
  refreshCoinLabels();
  renderBoostBar();
});
// 판 시작: 장착한 부스트를 1개씩 소모하고 적용 (관리자는 소모 없음)
function applyArmedBoosts() {
  const used = [];
  for (const id of save.armedBoosts) {
    if (!isAdminMode()) {
      if (boostCount(id) <= 0) continue;
      save.boosts = { ...save.boosts, [id]: boostCount(id) - 1 };
    }
    used.push(id);
    if (id === 'shield') G.shield = true;
    if (id === 'headstart') G.headT = HEAD_START_TIME;
    if (id === 'x2') G.x2Time = BOOST_START_TIME;
    if (id === 'giant') G.giantT = GIANT_TIME;
    if (id === 'revive') G.secondChance = true;
  }
  // 다 쓴 부스트는 장착 해제, 남아 있으면 다음 판에도 장착 유지
  save.armedBoosts = save.armedBoosts.filter((id) => isAdminMode() || boostCount(id) > 0);
  G.boostsUsed = used;
  if (used.length) persist();
}

// ======================================================================
// 코인 상점 (인앱 결제). native: 스토어 결제 → 서버 웹훅이 pending_coins 지급 → claim 으로 받음
// ======================================================================
let shopFrom = 'menu';
let shopBusy = false;
function refreshCoinLabels() {
  $('menuCoins').textContent = fmtCoins(save.coins);
  $('garageCoins').textContent = fmtCoins(save.coins);
  $('shopCoins').textContent = fmtCoins(save.coins);
}
// 서버가 지급한 결제 코인 받기 (로그인 상태에서만)
let claiming = false;
async function claimCoins() {
  if (claiming || !getSession() || !isServerReady()) return 0;
  claiming = true;
  try {
    const n = await claimPendingCoins();
    if (n > 0) {
      toast(`${t('PURCHASE COMPLETE')}  ·  ${t('+{n} COINS', { n: fmt(n) })}`);
      sfx.fireworks();
      refreshCoinLabels();
      if (currentScreen === 'garage') renderGarage();
    }
    return n;
  } catch (e) {
    console.warn('[pay] claim', e);
    return 0;
  } finally {
    claiming = false;
  }
}
function openCoinShop(from) {
  if (G.state === 'playing' || G.state === 'crashing') return;
  shopFrom = from;
  sfx.init();
  sfx.click();
  show('coinshop');
  renderCoinShop();
}
async function renderCoinShop() {
  refreshCoinLabels();
  renderBoostBundles();
  const mode = paymentsMode();
  const grid = $('packGrid');
  const note = $('shopNote');
  note.textContent = mode === 'mock' ? 'TEST MODE · no real money is charged.'
    : mode === 'off' ? 'Coin purchases are available in the mobile app.'
      : !getSession() ? 'Sign in to buy coins so they are saved to your account.' : '';
  grid.innerHTML = `<div class="muted">${t('LOADING…')}</div>`;
  const packs = mode === 'off' ? [] : await getPacks();
  if (currentScreen !== 'coinshop') return;
  if (!packs.length) {
    grid.innerHTML = `<div class="muted">${mode === 'off' ? t('Not available on the web version.') : t('The store is not available right now. Try again later.')}</div>`;
    return;
  }
  grid.innerHTML = '';
  for (const pk of packs) {
    const b = document.createElement('button');
    b.className = `pack${pk.tag ? ' tagged' : ''}`;
    const tier = Math.min(4, Math.max(1, Math.round(Math.log10(pk.coins) * 2 - 5)));
    b.innerHTML = `${pk.tag ? `<span class="pack-tag">${escapeHtml(pk.tag)}</span>` : ''}
      <span class="pack-coins tier${tier}">${'<i></i>'.repeat(tier)}</span>
      <b>${fmt(pk.coins)}</b>${pk.bonus ? `<small class="pack-bonus">+${pk.bonus}% ${t('BONUS')}</small>` : '<small class="pack-bonus">&nbsp;</small>'}
      <span class="pack-price">${escapeHtml(pk.price)}</span>`;
    b.addEventListener('click', () => purchasePack(pk));
    grid.appendChild(b);
  }
}
// 코인 상점: 부스트 묶음 (코인으로 구매)
function renderBoostBundles() {
  const { count, payFor } = BOOST_BUNDLE;
  $('bundleGrid').innerHTML = BOOSTS.map((b) => `<button class="bundle" data-bundle="${b.id}">
    <i>${icon(b.icon)}</i><span class="nm">${escapeHtml(t(b.name))} x${count}</span><small>${t('own {n}', { n: boostCount(b.id) })}</small>
    <em>${icon('coin')}${fmt(b.price * payFor)}</em></button>`).join('');
}
$('bundleGrid').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-bundle]');
  if (!btn) return;
  const b = BOOSTS.find((x) => x.id === btn.dataset.bundle);
  const { count, payFor } = BOOST_BUNDLE;
  if (!confirm(t('Buy {name} x{n} for {price} coins?', { name: t(b.name), n: count, price: fmt(b.price * payFor) }))) return;
  if (buyBoost(b.id, count, b.price * payFor)) toast(`${t(b.name)} x${count}  ·  ${t('ADDED')}`);
  refreshCoinLabels();
  renderBoostBundles();
});
async function purchasePack(pk) {
  if (shopBusy) return;
  const mode = paymentsMode();
  if (mode === 'native' && !getSession()) {
    toast(t('SIGN IN FIRST  ·  COINS ARE SAVED TO YOUR ACCOUNT'));
    renderAuth();
    openScreen('auth');
    return;
  }
  shopBusy = true;
  sfx.click();
  try {
    const res = await buyPack(pk);
    if (!res.ok) {
      if (!res.cancelled) toast(`${t('PURCHASE FAILED')}  ·  ${t(res.error || 'Try again')}`);
      return;
    }
    if (res.test) {
      save.coins += pk.coins;
      persist();
      toast(`${t('TEST PURCHASE')}  ·  ${t('+{n} COINS', { n: fmt(pk.coins) })}`);
      sfx.fireworks();
    } else {
      // 스토어 결제 완료 → 서버 지급(웹훅)을 기다렸다가 받기
      toast(t('PAYMENT RECEIVED  ·  DELIVERING YOUR COINS…'));
      let got = 0;
      for (let i = 0; i < 15 && !got; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        got = await claimCoins();
      }
      if (!got) toast(t('COINS WILL ARRIVE SHORTLY  ·  REOPEN THE APP IF NOT'));
    }
    refreshCoinLabels();
  } finally {
    shopBusy = false;
  }
}
$('menuCoinBtn').addEventListener('click', () => openCoinShop('menu'));
$('garageCoinBtn').addEventListener('click', () => openCoinShop('garage'));
$('btnShopBack').addEventListener('click', () => {
  sfx.click();
  if (shopFrom === 'garage') { renderGarage(); show('garage'); } else { refreshMenu(); show('menu'); }
});

// ---------- 차고 무료 코인 (보상형 광고, 3분 쿨타임)
const adHooks = { pause: () => sfx.suspend(), resume: () => sfx.resume() };
function updateAdCoinsLabel() {
  const left = Math.ceil((save.adCooldownUntil - Date.now()) / 1000);
  const btn = $('btnAdCoins');
  btn.disabled = left > 0;
  $('adCoinsLabel').textContent = left > 0
    ? t('NEXT FREE COINS IN {time}', { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` })
    : t('WATCH AD FOR {n} COINS', { n: ADS.freeCoins });
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
  toast(t('+{n} COINS', { n: ADS.freeCoins }));
  sfx.coin();
  renderGarage();
});

// ---------- 랭킹: 국가 리그 / 세계 리그 (행을 누르면 그 라이더의 3D 바이크/라이더 조합을 미리보기)
let rankTab = 'country';
let rankRows = [];
let rankSel = -1;

function countryOptions(extra) {
  const codes = [...new Set([extra, save.country, ...COUNTRY_CODES].filter(isCountryCode))];
  return codes.map((c) => `<option value="${c}">${escapeHtml(countryName(c))}</option>`).join('');
}

// 세계 리그는 모든 행에 국기 + 국가 코드, 국가 리그는 1위에만 국기
function rankTable(rows, world) {
  return `<table class="rank-table selectable"><thead><tr><th>#</th><th>RIDER</th><th class="num">BEST</th><th>BIKE</th></tr></thead><tbody>${
    rows.map((r, i) => {
      const flag = world ? `${flagBadge(r.country, 'flag')}` : i === 0 && r.country ? flagBadge(r.country, 'flag big') : '';
      const cc = world && r.country ? `<span class="cc">${escapeHtml(r.country)}</span>` : '';
      return `<tr class="${r.isMe ? 'me' : ''} ${i === rankSel ? 'sel' : ''}" data-row="${i}">
      <td>${i < 3 ? `<b class="medal m${i + 1}">${i + 1}</b>` : i + 1}</td>
      <td><span class="rider-cell">${flag}${cc}<span class="nick">${escapeHtml(r.nickname)}</span></span>${r.dist ? `<small class="muted">${fmt(r.dist)} m</small>` : ''}</td>
      <td class="num"><b>${fmt(r.score)}</b></td>
      <td><small>${escapeHtml(bikeName(r.bike, r.country))}</small></td></tr>`;
    }).join('')
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
    setFlexLabel(`${t('MY RIDE')} · ${bikeName(save.bike, myNationalCode())}`, look.opts.flag);
    return;
  }
  const look = rowLook(r);
  stage.setRider(look.opts, look.color);
  setFlexLabel(`#${i + 1} ${String(r.nickname).toUpperCase()} · ${bikeName(r.bike, r.country)}`, r.country);
}

async function renderRanking() {
  const list = $('rankList'), me = $('rankMe'), mode = $('rankMode');
  const world = rankTab === 'world';
  for (const b of $('rankTabs').children) b.classList.toggle('on', b.dataset.rtab === rankTab);
  $('rankTabs').querySelector('[data-rtab="country"]').innerHTML = `${flagBadge(save.country)}${escapeHtml(countryName(save.country).toUpperCase())}`;
  mode.textContent = world ? t('WORLD') : save.country;
  mode.className = 'badge';
  list.innerHTML = `<div class="empty">${t('Loading...')}</div>`;
  me.innerHTML = '';
  rankRows = [];
  selectRankRow(-1);
  const tab = rankTab;
  const country = save.country;
  const res = await leaderboard.fetchTop({ country, world });
  if (rankTab !== tab || currentScreen !== 'ranking') return;
  if (!res.ok) {
    list.innerHTML = `<div class="empty">${t('Could not load the ranking')}<br><small>${escapeHtml(t(res.error))}</small></div>`;
    return;
  }
  if (!world) {
    regionTops[country] = res.top;
    if (res.me) applyNationalStatus(res.me.rank === 1, res.me.country);
  }
  rankRows = res.top;
  rankSel = rankRows.length ? 0 : -1;
  list.innerHTML = rankRows.length
    ? rankTable(rankRows, world)
    : `<div class="empty">${world ? t('No records yet.') : t('No records in {country} yet.', { country: escapeHtml(countryName(country)) })}<br>${t('Be the first rider on the board!')}</div>`;
  selectRankRow(rankSel);
  const s = getSession();
  const where = world ? t('THE WORLD') : escapeHtml(countryName(country).toUpperCase());
  if (!s) me.innerHTML = `${t('Sign in to see your rank')} <button class="btn primary" id="rankLogin">${t('SIGN IN')}</button>`;
  else if (res.me) me.innerHTML = `${t('YOUR RANK IN {where}', { where })} <b>#${res.me.rank}</b> · <b>${fmt(res.me.score)}</b> <button class="btn small" id="rankMine">${t('MY RIDE')}</button>`;
  else me.innerHTML = `${t('{name} has no record yet', { name: escapeHtml(s.nickname) })} <button class="btn small" id="rankMine">${t('MY RIDE')}</button>`;
  $('rankLogin')?.addEventListener('click', () => { renderAuth(); openScreen('auth', 'menu'); });
  $('rankMine')?.addEventListener('click', () => { sfx.click(); selectRankRow(-1); });
}

$('rankList').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-row]');
  if (!tr) return;
  sfx.click();
  selectRankRow(Number(tr.dataset.row));
});
$('rankTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rtab]');
  if (!b || b.dataset.rtab === rankTab) return;
  rankTab = b.dataset.rtab;
  sfx.click();
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
  $('authSubmit').textContent = authTab === 'signup' ? t('CREATE ACCOUNT') : t('SIGN IN');
  $('authPw').autocomplete = authTab === 'signup' ? 'new-password' : 'current-password';
  $('authMsg').textContent = '';
  $('authMsg').className = 'form-msg';
  $('authNote').textContent = ONLINE
    ? t('Accounts are stored on the server. Only an auto sign-in token is kept on this device.')
    : t('No server configured: accounts and ranking are saved in this browser only.');
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
    msg.textContent = t('Passwords do not match');
    return;
  }
  const btn = $('authSubmit');
  btn.disabled = true;
  msg.className = 'form-msg ok';
  msg.textContent = t('Please wait...');
  const res = authTab === 'signup' ? await auth.signUp(id, pw) : await auth.signIn(id, pw);
  btn.disabled = false;
  if (!res.ok) {
    msg.className = 'form-msg';
    msg.textContent = t(res.error);
    return;
  }
  $('authPw').value = '';
  $('authPw2').value = '';
  sfx.mission();
  toast(t('WELCOME, {name}', { name: res.user.nickname.toUpperCase() }));
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
  toast(t('SIGNED OUT'));
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
    toast(`${t('SERVER')}  ·  ${t(res.error)}`);
    refreshMenu();
    return;
  }
  serverAdmin = res.isAdmin;
  if (!res.country) await lockCountry();
  if (save.settings.lang && save.settings.lang !== getLang()) setLang(save.settings.lang);
  refreshSupportBadge().then(() => { if (supportUnread) toast(t('SUPPORT REPLIED  ·  CHECK SETTINGS → HELP & SUPPORT')); });
  onDataReplaced();
  if (serverAdmin) toast(t('ADMIN MODE  ·  ALL ITEMS UNLOCKED  ·  SCORES NOT RECORDED'));
  // 새 계정이면 게스트로 세운 기록을 올림
  if (uploadBest && res.fresh && save.best > 0) await leaderboard.submit(scoreEntry(save.best, save.bestDist), { admin: isAdminMode() });
  regionTopsDirty(save.country);
  initPayments(getSession()?.userId).catch((e) => console.warn('[pay] init', e));
  await claimCoins();
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
    // 국가대표 패키지: 바이크 + 전용 배달통 동시 지급·장착
    if (save.bike !== 'national') save.prevBike = save.bike;
    if (save.box !== 'national') save.prevBox = save.box;
    save.bike = 'national';
    save.box = 'national';
    if (!silent) {
      toast(`${t('#1 IN {country}', { country: countryName(code).toUpperCase() })}  ·  ${t('NATIONAL TEAM PACKAGE UNLOCKED')}`);
      sfx.fireworks();
    }
  } else {
    if (!isAdminMode()) {
      if (save.bike === 'national') save.bike = save.ownedBikes.includes(save.prevBike) ? save.prevBike : 'rookie';
      if (save.box === 'national') save.box = save.ownedBoxes.includes(save.prevBox) ? save.prevBox : 'basic';
    }
    if (was && !silent) toast(t('YOU LOST #1  ·  NATIONAL TEAM PACKAGE TAKEN BACK'));
  }
  persist();
  syncMyLook();
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
  if (document.visibilityState === 'visible') { checkNationalStatus(); claimCoins(); }
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

// ---------- 1:1 문의 (설정 → HELP & SUPPORT). 관리자 답변은 내 언어 번역문이 있으면 그것을 먼저 보여줌
const INQ_CATS = [['payment', 'Payment / coins'], ['bug', 'Bug / crash'], ['account', 'Account / login'], ['suggestion', 'Suggestion'], ['other', 'Other']];
const INQ_STATUS = { open: 'WAITING', answered: 'ANSWERED', closed: 'CLOSED' };
let supportView = 'list', supportList = [], supportSel = null, supportUnread = false;
const deviceInfo = () => `${window.Capacitor?.getPlatform?.() || 'web'} · ${(navigator.userAgent.match(/Android [\d.]+|iPhone OS [\d_]+|Windows NT [\d.]+|Mac OS X [\d_]+/) || [''])[0]}`.slice(0, 160);
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(getLang(), { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };

// 운영자 답변: 내 언어 번역이 있으면 그것, 없으면 기계 번역(도착하면 다시 그림), 그전엔 원문
const staffTr = new Map();
function staffText(m) {
  const lang = getLang();
  if (m.translated && m.translated_lang === lang) return m.translated;
  if (lang === 'ko') return m.body; // 운영자는 한국어로 씀
  const key = `${lang}|${m.created_at}|${m.body.length}`;
  if (staffTr.has(key)) return staffTr.get(key) || m.translated || m.body;
  staffTr.set(key, '');
  machineTranslate(m.body, 'ko', lang)
    .then((tx) => { staffTr.set(key, tx); if (currentScreen === 'support' && supportView === 'thread') renderSupport(); })
    .catch(() => {});
  return m.translated || m.body;
}
// 실시간: 고객지원 화면이 열려 있으면 6초마다, 아니면 1분마다 새 답변 확인 (화면이 꺼져 있거나 게임 중이면 쉼)
let supportSig = '', supportPolling = false, supportLast = 0;
async function pollSupport(force = false) {
  if (supportPolling || document.hidden || !getSession() || !isServerReady() || G.state === 'playing') return;
  const open = currentScreen === 'support';
  if (!force && !open && Date.now() - supportLast < 60000) return;
  supportPolling = true;
  supportLast = Date.now();
  try {
    const res = await myInquiries(open && supportView === 'thread');
    if (!res.ok) return;
    const sg = JSON.stringify(res.list.map((i) => [i.id, i.status, i.messages.length, i.user_unread]));
    const changed = sg !== supportSig;
    supportSig = sg;
    const wasUnread = supportUnread;
    supportList = res.list;
    supportUnread = !open && supportList.some((i) => i.user_unread);
    $('settingsDot').classList.toggle('hidden', !supportUnread);
    $('supportDot').classList.toggle('hidden', !supportUnread);
    if (supportUnread && !wasUnread) toast(t('SUPPORT REPLIED  ·  CHECK SETTINGS → HELP & SUPPORT'));
    if (open && changed && supportView !== 'new') renderSupport();
  } finally { supportPolling = false; }
}
setInterval(pollSupport, 6000);

async function refreshSupportBadge() {
  if (!getSession() || !isServerReady()) { supportUnread = false; } else {
    const res = await myInquiries(false);
    supportList = res.list;
    supportUnread = supportList.some((i) => i.user_unread);
  }
  $('settingsDot').classList.toggle('hidden', !supportUnread);
  $('supportDot').classList.toggle('hidden', !supportUnread);
}

async function openSupport() {
  supportView = 'list';
  supportSel = null;
  openScreen('support', 'settings');
  await renderSupport(true);
}

async function renderSupport(reload = false) {
  const body = $('supportBody');
  if (!getSession()) {
    body.innerHTML = `<div class="app-card"><p>${t('Sign in to contact support. We reply in your language.')}</p></div>
      <button class="btn primary" id="supLogin">${t('SIGN IN')}</button>`;
    $('supLogin').addEventListener('click', () => { renderAuth(); openScreen('auth', 'menu'); });
    return;
  }
  if (reload) {
    body.innerHTML = `<div class="empty">${t('Loading...')}</div>`;
    const res = await myInquiries(true);
    if (!res.ok) { body.innerHTML = `<div class="empty">${escapeHtml(t(res.error))}</div>`; return; }
    supportList = res.list;
    supportUnread = false;
    $('settingsDot').classList.add('hidden');
    $('supportDot').classList.add('hidden');
  }
  if (supportView === 'new') {
    body.innerHTML = `<form id="supForm" class="form sup-form">
      <label><span>${t('CATEGORY')}</span><select id="supCat" class="select">${INQ_CATS.map(([v, l]) => `<option value="${v}">${escapeHtml(t(l))}</option>`).join('')}</select></label>
      <label><span>${t('SUBJECT')}</span><input id="supSubject" maxlength="120" placeholder="${escapeHtml(t('Short summary'))}"></label>
      <label><span>${t('MESSAGE')}</span><textarea id="supMsg" maxlength="2000" rows="6" placeholder="${escapeHtml(t('Tell us what happened. For payment issues, include the date and amount.'))}"></textarea></label>
      <p id="supErr" class="form-msg"></p>
      <button class="btn primary" type="submit">${t('SEND')}</button>
      <button class="btn" type="button" id="supCancel">${t('CANCEL')}</button>
    </form>`;
    $('supCancel').addEventListener('click', () => { supportView = 'list'; renderSupport(); });
    $('supForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('supMsg').value.trim();
      if (msg.length < 2) { $('supErr').textContent = t('Please write a message.'); return; }
      e.submitter && (e.submitter.disabled = true);
      const build = await webBuild();
      const res = await submitInquiry({ category: $('supCat').value, subject: $('supSubject').value.trim(), message: msg, lang: getLang(), appBuild: build ? `build ${build}` : APP_INFO.version, device: deviceInfo() });
      if (!res.ok) { $('supErr').textContent = t(res.error); e.submitter && (e.submitter.disabled = false); return; }
      toast(t('SENT  ·  WE WILL REPLY SOON'));
      supportView = 'list';
      renderSupport(true);
    });
    return;
  }
  if (supportView === 'thread') {
    const inq = supportList.find((i) => i.id === supportSel);
    if (!inq) { supportView = 'list'; renderSupport(); return; }
    inq.user_unread = false; // 열어 본 문의는 읽음 (서버는 목록을 불러올 때 이미 읽음 처리)
    // 다시 그려도 쓰던 답장은 유지
    const draft = $('supReplyMsg')?.value || '';
    const hadFocus = document.activeElement?.id === 'supReplyMsg';
    const msgs = inq.messages.map((m) => {
      const mine = m.sender === 'user';
      const shown = mine ? m.body : staffText(m);
      const translated = !mine && shown !== m.body;
      return `<div class="sup-msg ${mine ? 'me' : 'staff'}">
        <small>${mine ? t('You') : t('Grub Rider Support')} · ${fmtDate(m.created_at)}</small>
        <p>${escapeHtml(shown).replace(/\n/g, '<br>')}</p>
        ${translated ? `<details><summary>${t('Original')}</summary><p>${escapeHtml(m.body).replace(/\n/g, '<br>')}</p></details>` : ''}
      </div>`;
    }).join('');
    body.innerHTML = `<button class="btn small sup-back" id="supList">← ${t('ALL INQUIRIES')}</button>
      <div class="sup-thread-head"><b>${escapeHtml(inq.subject || t(INQ_CATS.find((c) => c[0] === inq.category)?.[1] || 'Other'))}</b><em class="sup-st st-${inq.status}">${t(INQ_STATUS[inq.status])}</em></div>
      <div class="sup-thread">${msgs}</div>
      ${inq.status === 'closed' ? `<p class="muted">${t('This inquiry is closed. Start a new one if you need more help.')}</p>` : `<form id="supReply" class="sup-reply"><textarea id="supReplyMsg" rows="2" maxlength="2000" placeholder="${escapeHtml(t('Write a reply…'))}"></textarea><button class="btn primary" type="submit">${t('SEND')}</button></form><p id="supErr" class="form-msg"></p>`}`;
    $('supList').addEventListener('click', () => { supportView = 'list'; renderSupport(); });
    $('supReply')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = $('supReplyMsg').value.trim();
      if (!msg) return;
      const res = await replyInquiry(inq.id, msg, getLang());
      if (!res.ok) { $('supErr').textContent = t(res.error); return; }
      renderSupport(true).then(() => { supportView = 'thread'; renderSupport(); });
    });
    const th = body.querySelector('.sup-thread');
    if (th) th.scrollTop = th.scrollHeight;
    if ($('supReplyMsg')) { $('supReplyMsg').value = draft; if (hadFocus) $('supReplyMsg').focus(); }
    return;
  }
  body.innerHTML = `<button class="btn primary" id="supNew" data-icon="next"><span>${t('NEW INQUIRY')}</span></button>
    ${supportList.length ? `<div class="sup-list">${supportList.map((i) => `<button class="sup-item" data-inq="${i.id}">
      <span><b>${escapeHtml(i.subject || t(INQ_CATS.find((c) => c[0] === i.category)?.[1] || 'Other'))}</b><small>${fmtDate(i.updated_at)}</small></span>
      <em class="sup-st st-${i.status}">${t(INQ_STATUS[i.status])}</em>${i.user_unread ? '<i class="dot"></i>' : ''}</button>`).join('')}</div>`
      : `<p class="muted">${t('No inquiries yet. Questions about payments, bugs or your account? Send us a message.')}</p>`}`;
  hydrateIcons(body);
  $('supNew').addEventListener('click', () => { supportView = 'new'; renderSupport(); });
  for (const b of body.querySelectorAll('[data-inq]')) b.addEventListener('click', () => { supportSel = Number(b.dataset.inq); supportView = 'thread'; renderSupport(); });
}
$('btnSupport').addEventListener('click', () => openSupport());

// ---------- 설정
// 언어: 설정에서 고르면 저장(계정에 함께 저장)하고 화면 전체를 다시 그림
$('langSelect').addEventListener('change', async (e) => {
  save.settings.lang = e.target.value;
  persist();
  await setLang(e.target.value);
});
onLangChange(() => {
  scheduleFit();
  refreshMenu();
  renderBoostBar();
  if (currentScreen === 'settings') renderSettings();
  if (currentScreen === 'garage') renderGarage();
  if (currentScreen === 'missions') renderMissions();
  if (currentScreen === 'notices') renderNotices();
  if (currentScreen === 'auth') renderAuth();
});
const onOff = (v) => (v ? t('ON') : t('OFF'));
const SETTING_LABELS = {
  sound: onOff,
  music: onOff,
  vibrate: onOff,
  wetFx: onOff,
  quality: (v) => (v === 'high' ? t('HIGH') : t('LOW (FAST)')),
  controls: (v) => t({ onehand: 'ONE-HAND', slide: 'SLIDE + PEDALS', arrows: 'ARROWS + PEDALS' }[v] || 'ONE-HAND'),
  flipControls: onOff,
};
function renderSettings() {
  $('langSelect').innerHTML = LANGS.map((l) => `<option value="${l.code}">${escapeHtml(l.name)}</option>`).join('');
  $('langSelect').value = getLang();
  for (const b of document.querySelectorAll('[data-setting]')) {
    b.textContent = SETTING_LABELS[b.dataset.setting](save.settings[b.dataset.setting]);
  }
  $('controlsHint').textContent = t(CONTROL_HINTS[save.settings.controls] || CONTROL_HINTS.onehand);
  $('flipRow').classList.toggle('hidden', save.settings.controls === 'onehand');
  const src = t({ server: 'LOCKED', ip: 'IP', tz: 'ESTIMATED' }[save.countrySource] || '');
  $('countryLabel').innerHTML = `${flagBadge(save.country)}<span class="cl-name">${escapeHtml(countryName(save.country))}</span> <small class="muted">${isAdminMode() ? 'ADMIN' : src}</small>`;
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
  $('btnAdmin').textContent = isAdminMode() ? t('ON') : t('OFF');
  $('btnAdmin').disabled = serverAdmin;
  $('appVersion').textContent = `${APP_INFO.name} v${APP_INFO.version}`;
  webBuild().then((n) => { if (n) $('appVersion').textContent = `${APP_INFO.name} v${APP_INFO.version} · build ${n}`; });
  $('btnDeleteAccount').classList.toggle('hidden', !getSession());
}
// 계정 삭제 (스토어 정책 필수): 두 번 확인 → 서버에서 계정·기록·데이터 삭제
$('btnDeleteAccount').addEventListener('click', async () => {
  if (!getSession()) return;
  if (!confirm(t('Delete your account permanently? Your coins, items, ranking records and purchases cannot be recovered.'))) return;
  if (prompt(t('Type DELETE to confirm.')) !== 'DELETE') return;
  const res = await deleteAccount();
  if (!res.ok) {
    toast(`${t('DELETE FAILED')}  ·  ${t(res.error)}`);
    return;
  }
  serverAdmin = false;
  debugAdmin = false;
  toast(t('ACCOUNT DELETED'));
  onDataReplaced();
  applyNationalStatus(false, '', { silent: true });
  renderSettings();
});
$('adminCountry').addEventListener('change', async (e) => {
  if (!isAdminMode()) return;
  const code = e.target.value;
  // 관리자 계정은 서버에도 저장 (admin_set_country), 디버그 관리자는 이번 접속에만
  if (serverAdmin) {
    const res = await adminSetCountry(code);
    if (!res.ok) {
      toast(`${t('COUNTRY')}  ·  ${t(res.error)}`);
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
  toast(debugAdmin ? t('ADMIN MODE ON  ·  SCORES NOT RECORDED') : t('ADMIN MODE OFF'));
  onDataReplaced();
  renderSettings();
});
// 조작 3종: 한 손(기본) = 화면 어디든 좌우 슬라이드 · 자동 가속 / 슬라이드 + 페달 / 방향 버튼 + 페달
const CONTROL_HINTS = {
  onehand: 'One finger anywhere: slide left / right to steer, up for gas, down to brake. No buttons. In the air the same slide does tricks.',
  slide: 'Slide on the steering side, THROTTLE and BRAKE buttons on the other side.',
  arrows: 'LEFT / RIGHT buttons on one side, THROTTLE and BRAKE on the other side.',
};
function applyControlSettings() {
  const c = save.settings.controls || 'onehand';
  document.body.classList.toggle('drag-mode', c !== 'arrows');
  document.body.classList.toggle('one-hand', c === 'onehand');
  document.body.classList.toggle('flip-controls', c !== 'onehand' && Boolean(save.settings.flipControls));
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
    if (k === 'controls') {
      const order = ['onehand', 'slide', 'arrows'];
      s.controls = order[(order.indexOf(s.controls) + 1) % order.length];
    }
    if (k === 'flipControls') s.flipControls = !s.flipControls;
    applyControlSettings();
    sfx.click();
    persist();
    renderSettings();
  });
}
$('btnReset').addEventListener('click', () => {
  if (!confirm(t('Reset coins, bikes, skins, ranking and missions? (Your account is kept)'))) return;
  resetSave();
  sfx.setEnabled(save.settings.sound);
  sfx.setMusic(save.settings.music);
  screenRain.setEnabled(save.settings.wetFx);
  applyQuality();
  applyControlSettings();
  buildBike();
  resetBikePose();
  renderSettings();
  toast(t('PROGRESS RESET'));
});

// ---------- 일시정지 (DELIVERY RECEIPT)
function renderReceipt() {
  const s = getSession();
  $('rcOrder').textContent = `#GR-${String(Math.floor(G.distance * 7 + G.time * 13) % 100000).padStart(5, '0')}`;
  $('rcRider').textContent = (s ? s.nickname : save.lastName || 'Guest Rider').toUpperCase();
  $('rcBike').textContent = bikeName(save.bike, myNationalCode());
  const items = [
    [t('DISTANCE'), `${fmt(G.distance)} m`],
    [t('NEAR MISSES'), `${G.nearMiss} (${t('MAX COMBO')} ${G.maxCombo})`],
    [t('WRONG WAY'), `${fmt(G.oncomingDist)} m`],
    [t('AIR JUMPS'), `${G.jumps}`],
    [t('COINS'), `${fmt(G.earned)}`],
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

// 안드로이드 뒤로가기 버튼 (앱): 주행 중 → 일시정지, 화면 → 뒤로, 메뉴 → 두 번 누르면 종료
{
  const App = window.Capacitor?.Plugins?.App;
  let exitArmed = 0;
  App?.addListener?.('backButton', () => {
    if (!$('tutorial').classList.contains('hidden')) { hideTutorial(); return; }
    if (G.state === 'playing') { togglePause(); return; }
    if (G.state === 'paused') { resumeGame(); return; }
    if (G.state === 'countdown') return;
    if (currentScreen === 'gameover') { $('btnHome').click(); return; }
    if (currentScreen === 'support' && supportView !== 'list') { supportView = 'list'; renderSupport(); return; }
    if (currentScreen === 'gacha') { $('btnGachaClose').click(); return; }
    if (currentScreen === 'coinshop') { $('btnShopBack').click(); return; }
    if (currentScreen === 'daily') { $('btnClaimDaily').click(); return; }
    if (currentScreen && currentScreen !== 'menu') { $(currentScreen).querySelector('[data-back]')?.click(); return; }
    if (Date.now() - exitArmed < 2000) { App.exitApp(); return; }
    exitArmed = Date.now();
    toast(t('Press back again to exit'));
  });
}
$('btnQuit').addEventListener('click', () => {
  sfx.resume();
  finalizeRun();
  goMenu();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && G.state === 'playing') togglePause();
});

// ---------- 결과 / 랭킹 등록 / 이어달리기
function setResultTitle(delivered) {
  const el = $('goTitle');
  el.textContent = delivered ? t('DELIVERED!') : t('CRASHED!');
  el.className = `result-title ${delivered ? 'delivered' : 'crash'}`;
}

// 결과 점수: 0 → 최종값으로 빠르게 올라가는 연출 (0.9초, ease-out)
function countUp(el, to) {
  const t0 = performance.now(), dur = 900;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = fmt(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1 && currentScreen === 'gameover') requestAnimationFrame(step);
    else el.textContent = fmt(to);
  };
  requestAnimationFrame(step);
}

function showGameOver() {
  G.state = 'over';
  $('hud').classList.add('hidden');
  $('brakeFx').classList.remove('on');
  const score = Math.floor(G.score);
  const isRecord = score > save.best && score > 0;
  countUp($('goScore'), score);
  $('goNew').classList.toggle('hidden', !isRecord);
  setResultTitle(isRecord);
  save.best = Math.max(save.best, score);
  save.bestDist = Math.max(save.bestDist || 0, Math.floor(G.distance));
  save.lastDist = Math.floor(G.distance);
  $('hotBanner').classList.add('hidden');
  G.hot = null;
  const stats = [
    [t('DISTANCE'), `${fmt(G.distance)} m`],
    [t('NEAR MISS'), G.nearMiss],
    [t('MAX COMBO'), G.maxCombo],
    [t('TOP SPEED'), `${G.maxKmh} KM/H`],
    [t('AIR JUMPS'), G.jumps],
    [t('COINS'), fmt(G.earned)],
  ];
  $('goStats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  $('goMissions').innerHTML = G.missionsDone.map((m) => `<div>${icon('check')} ${escapeHtml(missionText(m))} +${m.reward}</div>`).join('');

  // 이어달리기 (멀티에선 불가)
  const cont = $('btnContinue');
  $('contCost').textContent = ECON.continueCost;
  cont.classList.toggle('hidden', G.continued);
  cont.disabled = save.coins < ECON.continueCost;
  $('retryLabel').textContent = t('RETRY');
  // 보상형 광고: 부활 1회 / 코인 2배 1회 (배너 없음)
  $('btnAdRevive').classList.toggle('hidden', !adsEnabled() || G.continued || isAdminMode());
  $('btnAdminRevive').classList.toggle('hidden', !isAdminMode());
  $('btnAdDouble').classList.toggle('hidden', !adsEnabled() || G.doubled || G.earned <= 0);

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
    box.innerHTML = `${icon('gear')} ${t('ADMIN MODE · this run is not recorded on the ranking')}`;
    return;
  }
  if (!s) {
    box.innerHTML = `<p class="ge-msg">${flagBadge(save.country)} ${t('Sign in to post your score to the {country} ranking', { country: cname })}</p><button class="btn primary small ge-btn" id="goLogin">${t('SIGN IN')}</button>`;
    $('goLogin').addEventListener('click', () => { renderAuth(); openScreen('auth', 'gameover'); });
    return;
  }
  if (score <= 0) {
    box.classList.add('hidden');
    return;
  }
  if (G.globalSubmitted === score) return;
  G.globalSubmitted = score;
  box.innerHTML = `${flagBadge(save.country)} ${t('Posting to the {country} ranking...', { country: cname })}`;
  const res = await leaderboard.submit(scoreEntry(score, G.distance), { admin: isAdminMode() });
  if (!res.ok) {
    box.innerHTML = `${flagBadge(save.country)} ${t('Could not post score')}: ${escapeHtml(t(res.error))}`;
    G.globalSubmitted = false;
    return;
  }
  syncMyLook();
  let rank = '-';
  try {
    const r = await leaderboard.myRank();
    if (r) rank = `#${r.rank}`;
    applyNationalStatus(Boolean(r && r.rank === 1), r?.country || save.country);
  } catch (e) { /* 순위 조회 실패 시 표시만 생략 */ }
  regionTopsDirty(save.country);
  box.innerHTML = `${flagBadge(save.country)} ${t('{country} RANK', { country: cname.toUpperCase() })} <b>${rank}</b> · ${t('BEST')} <b>${fmt(res.best)}</b>`;
}

function finalizeRun() {
  if (G.finalized || !('score' in G)) return;
  G.finalized = true;
  if (!isAdminMode()) {
    webBuild().then((b) => logRun({
      dist: G.distance, score: G.score, coins: G.earned, duration: G.time || 0, bike: save.bike,
      theme: THEMES[G.themeIdx]?.code || '', country: save.country, appBuild: b ? `build ${b}` : APP_INFO.version,
    }));
  }
  const score = Math.floor(G.score);
  save.best = Math.max(save.best, score);
  save.stats.runs++;
  save.stats.totalDist += Math.floor(G.distance);
  save.stats.totalNear += G.nearMiss;
  replaceDoneMissions();
  persist();
}

function retry() {
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
  if (G.continued || save.coins < ECON.continueCost) return;
  save.coins -= ECON.continueCost;
  persist();
  reviveRun();
});
// 관리자: 비용·광고 없이 몇 번이든 즉시 부활
$('btnAdminRevive').addEventListener('click', () => {
  if (!isAdminMode() || G.state !== 'over') return;
  reviveRun();
});
$('btnAdRevive').addEventListener('click', async () => {
  if (G.continued) return;
  if (await showRewarded('revive', adHooks)) reviveRun();
});
$('btnAdDouble').addEventListener('click', async () => {
  if (G.doubled) return;
  if (!(await showRewarded('double_coins', adHooks))) return;
  const extra = G.earned;
  G.doubled = true;
  save.coins += extra;
  persist();
  $('btnAdDouble').classList.add('hidden');
  toast(`${t('COINS DOUBLED')}  ·  +${fmt(extra)}`);
  sfx.coin();
});
// WhatsApp 챌린지: 내 점수 + 같은 도로 시드 링크
$('btnWhatsApp').addEventListener('click', () => {
  const base = SHARE_BASE_URL || `${location.origin}${location.pathname}`;
  const url = `${base}${base.includes('?') ? '&' : '?'}seed=${G.seed}`;
  const text = `I scored ${fmt(G.score)} (${fmt(G.distance)} m) on Grub Rider! Ride the exact same road and beat me: ${url}`;
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
  popup(t('BACK ON THE ROAD'), 'big');
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
  window.__models = M.models;
  window.__cars = cars;
  window.__scene = scene;
  window.__renderer = renderer;
  window.__camera = camera;
  window.__save = save;
  window.__dbg = {
    show: (id) => show(id),
    trickScore, trickDir, trickTitle,
    jump: () => startJump({}),
    gameOver: () => showGameOver(),
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
    ramp: (x, z) => { spawnJumpRamp(); const j = jumpRamps.find((k) => k.active && k.z === SPAWN_Z); if (j) Object.assign(j, { x, z }); },
    drop: (x, z) => { spawnDropZone(); const d = dropZones.find((k) => k.active && k.z === SPAWN_Z); if (d) Object.assign(d, { x, z }); },
    power: (type) => applyPower(type),
    admin: (on) => { debugAdmin = on; onDataReplaced(); },
  };
}
goMenu();
// 로딩 화면: 첫 프레임이 그려진 뒤 부드럽게 사라짐
requestAnimationFrame(() => requestAnimationFrame(() => {
  const l = $('loading');
  l.classList.add('done');
  setTimeout(() => l.remove(), 450);
}));
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
    ${t('DAY {n}', { n: i + 1 })}<b>${fmt(c)}</b>${i === 6 ? `<small>${t('+ CROWN')}</small>` : icon('coin')}</div>`).join('');
  show('daily');
  $('btnClaimDaily').addEventListener('click', () => {
    const coins = STREAK_REWARDS[day - 1];
    save.coins += coins;
    save.streak = day;
    save.lastDaily = today;
    let msg = `${t('DAY {n} REWARD', { n: day })}  ·  ${t('+{n} COINS', { n: fmt(coins) })}`;
    if (day === 7 && !save.ownedHelmets.includes(STREAK_SPECIAL_HELMET)) {
      save.ownedHelmets.push(STREAK_SPECIAL_HELMET);
      msg += `  ·  ${t('STREAK CROWN UNLOCKED')}`;
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
initLiveUpdate(); // 앱: 라이브 업데이트 확인 (웹에서는 무시)
{
  const sent = new Set();
  const report = (message, stack, source) => {
    const key = String(message).slice(0, 200);
    if (!message || sent.has(key) || sent.size >= 8) return;
    sent.add(key);
    webBuild().then((b) => logClientError({ message, stack, source, appBuild: b ? `build ${b}` : APP_INFO.version, device: deviceInfo() }));
  };
  window.addEventListener('error', (e) => report(e.message, e.error?.stack, `${e.filename || ''}:${e.lineno || ''}:${e.colno || ''}`));
  window.addEventListener('unhandledrejection', (e) => report(`Unhandled: ${e.reason?.message || e.reason}`, e.reason?.stack, 'promise'));
}
const LOAD_TIPS = ['Brush past cars for NEAR MISS bonuses', 'Land level after a flip to stay on the road', 'Every km pays +50 coins', 'Ride the wrong way for x2 score - carefully!', 'Be #1 in your country to unlock the National Team bike'];
setLang(save.settings.lang || 'en') // 기본은 항상 영어, 설정에서만 바꿈
  .then(() => { const el = $('loadTip'); if (el) el.textContent = t(pick(LOAD_TIPS)); });
// 운영 설정(가격·보상)은 다른 로딩과 병렬로 받고, 도착하면 보이는 화면만 다시 그림
function applyAppConfig(cfg) {
  if (!cfg) return;
  if (cfg.notices) {
    const before = JSON.stringify(notices);
    setNotices(cfg.notices);
    updateNoticeDot();
    if (currentScreen === 'notices' && JSON.stringify(notices) !== before) {
      renderNotices();
      if (notices.length && save.noticeSeen !== notices[0].id) { save.noticeSeen = notices[0].id; persist(); updateNoticeDot(); }
    }
  }
  // 가격·보상이 바뀌었을 때만 다시 그림 (1분마다 확인할 때 차고 화면이 튀지 않게)
  const eco = JSON.stringify(cfg.economy || null);
  if (eco === lastEconomy) return;
  lastEconomy = eco;
  if (G.state === 'menu') refreshMenu();
  if (currentScreen === 'garage') renderGarage();
}
let lastEconomy = '';
loadAppConfig().then(applyAppConfig);
// 공지·가격은 실행 중에도 1분마다(게임 플레이 중에는 쉼), 앱으로 돌아올 때 다시 확인 → 다시 켜지 않아도 새 공지가 뜸
let configBusy = false;
function pollConfig() {
  if (configBusy || document.hidden || G.state === 'playing') return;
  configBusy = true;
  loadAppConfig().then(applyAppConfig).finally(() => { configBusy = false; });
}
setInterval(pollConfig, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollConfig(); pollSupport(true); } });
detectCountry()
  .then(() => auth.restore())
  .then((s) => (s ? onSignedIn() : refreshMenu()));
requestAnimationFrame(frame);
