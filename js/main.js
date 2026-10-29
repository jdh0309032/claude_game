import * as THREE from 'three';
import * as M from './models.js';
import { Sound } from './audio.js';
import { net } from './net.js';
import {
  save, persist, resetSave, BIKES, BOXES, OUTFITS, HELMETS, getBike, qualifies, addRanking, sortRanking,
  replaceDoneMissions, missionText, auth, leaderboard, getSession, ONLINE,
} from './storage.js';

const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const approach = (v, t, step) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

// ---------- 상수
const LANES = [-5.25, -1.75, 1.75, 5.25]; // 0,1 = 반대 차선(역주행) / 2,3 = 같은 방향
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
const POWER_TYPES = ['shield', 'magnet', 'x2', 'slow'];
const POWER_LABEL = { shield: '🛡️ 실드!', magnet: '🧲 자석!', x2: '✨ 점수 x2!', slow: '⏳ 슬로우모션!' };

// ---------- 시드 기반 월드 난수 (멀티플레이 시 두 기기의 도로/교통/날씨를 동일하게)
// 스폰 종류마다 별도 스트림을 써서 한쪽의 차이가 다른 스폰에 번지지 않게 함
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const STREAMS = ['car', 'coin', 'cone', 'power', 'weather', 'puddle', 'stall'];
const W = {};
function seedWorld(seed) {
  STREAMS.forEach((k, i) => { W[k] = mulberry32((seed ^ (i * 0x9e3779b1)) >>> 0); });
}
const wr = (k) => W[k]();
const wrand = (k, a, b) => a + W[k]() * (b - a);
seedWorld((Math.random() * 2 ** 32) >>> 0);

const sfx = new Sound();
sfx.setEnabled(save.settings.sound);

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

class PropStrip {
  constructor(meshes, count, spacing, respawn) {
    this.meshes = meshes;
    this.span = count * spacing;
    this.respawn = respawn;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = { i, x: 0, z: 25 - i * spacing - Math.random() * spacing * 0.3, sx: 1, sy: 1, sz: 1, ry: 0, hidden: false };
      respawn(it, i);
      this.items.push(it);
    }
    for (const m of meshes) {
      m.frustumCulled = false;
      scene.add(m);
    }
    this.update(0);
  }
  update(dz) {
    const items = this.items;
    for (let k = 0; k < items.length; k++) {
      const it = items[k];
      it.z += dz;
      if (it.z > 25) {
        it.z -= this.span;
        this.respawn(it, k);
      }
      dummy.position.set(it.x, 0, it.z);
      dummy.rotation.set(0, it.ry, 0);
      if (it.hidden) dummy.scale.set(0, 0, 0);
      else dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      for (const m of this.meshes) m.setMatrixAt(k, dummy.matrix);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

const palmMesh = new THREE.InstancedMesh(M.palmGeometry(), M.vcMat, 56);
const lampPole = new THREE.InstancedMesh(M.lampPoleGeometry(), M.vcMat, 18);
const lampHead = new THREE.InstancedMesh(M.lampHeadGeometry(), M.lampHeadMat, 18);
const rukoMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const rukoL = new THREE.InstancedMesh(M.rukoGeometry(), rukoMat, 42);
const rukoR = new THREE.InstancedMesh(M.rukoGeometry(), rukoMat, 42);
const warungMesh = new THREE.InstancedMesh(M.warungGeometry(), M.vcMat, 14);
const buildingMat = M.makeBuildingMaterial();
const bldgMesh = new THREE.InstancedMesh(M.buildingGeometry(), buildingMat, 30);
const RUKO_COLORS = [0xfff1c9, 0xd8f1e3, 0xfde2e4, 0xdbeafe, 0xfff7ae, 0xe9e3ff, 0xffffff, 0xffd8b5];
const rukoRespawn = (mesh, side) => (it, k) => {
  it.x = side * 16.6;
  it.ry = side > 0 ? Math.PI : 0;
  it.sy = 0.85 + Math.random() * 0.45;
  it.hidden = Math.random() < 0.08; // 골목 사이 틈
  mesh.setColorAt(k, tmpColor.setHex(pick(RUKO_COLORS)));
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
};
const strips = [
  new PropStrip([palmMesh], 56, 7.5, (it) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    it.x = side * (Math.random() < 0.7 ? rand(9.6, 10.2) : rand(26, 44));
    it.sx = it.sy = it.sz = rand(0.85, 1.3);
    it.ry = rand(0, Math.PI * 2);
  }),
  new PropStrip([lampPole, lampHead], 18, 24, (it) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * 9.2;
    it.ry = side > 0 ? 0 : Math.PI;
  }),
  new PropStrip([rukoL], 42, 10.2, rukoRespawn(rukoL, -1)),
  new PropStrip([rukoR], 42, 10.2, rukoRespawn(rukoR, 1)),
  new PropStrip([warungMesh], 14, 30, (it) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * 12.2;
    it.ry = side > 0 ? Math.PI : 0;
    it.hidden = Math.random() < 0.3;
  }),
  new PropStrip([bldgMesh], 30, 14, (it, k) => {
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

const currentBikeKey = () => [save.bike, save.box, save.outfit, save.helmet].join('|');
function buildBike() {
  if (bike) scene.remove(bike.root);
  bike = M.createBike(getBike(save.bike).color, { box: save.box, outfit: save.outfit, helmet: save.helmet });
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
const G = { state: 'loading' };
const MP = { active: false, opp: null, oppName: '상대', oppDone: false, oppScore: 0, ready: false, oppReady: false, sendT: 0 };

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

function pickType(r) {
  if (G.distance > 1200 && r < 0.05) return 'ramp';
  if (r < 0.12 + Math.min(0.05, G.distance / 60000)) return 'bus';
  if (r < 0.24) return 'truck';
  if (r < 0.4) return 'suv';
  if (r < 0.48) return 'taxi';
  if (r < 0.51) return 'police';
  return 'sedan';
}

function spawnCar(z = SPAWN_Z, forced = null) {
  // 난수는 결과와 무관하게 항상 같은 개수만 소비 → 멀티 동기화 유지
  const r = Array.from({ length: 10 }, () => wr('car'));
  const type = forced?.type || pickType(r[0]);
  const def = M.CAR_DEFS[type];
  const order = forced ? [forced.lane] : type === 'ramp' ? (r[1] < 0.5 ? [2, 3] : [3, 2]) : [0, 1, 2, 3];
  if (type !== 'ramp' && !forced) {
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(r[i] * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
  }
  for (const lane of order) {
    if (!laneClear(lane, z, def.len) || blocksAll(lane, z)) continue;
    const c = acquireCar(type);
    const dir = lane >= 2 ? 1 : -1;
    const inner = lane === 1 || lane === 2;
    Object.assign(c, {
      lane, targetLane: lane, dir, baseX: LANES[lane], x: LANES[lane], z, offset: 0,
      speed: lerp(def.speed[0], def.speed[1], r[4]) * (dir < 0 ? 1.1 : 1),
      passed: false, minGap: 99, changing: false, changeT: 0, flying: false, honked: false,
      wob: r[5] * Math.PI * 2,
      wobAmp: (type === 'bus' || type === 'truck' || type === 'ramp' ? 0.1 : 0.22) * (1 + clamp(G.distance / 8000, 0, 1) * 0.8),
      canChange: type !== 'ramp' && r[6] < Math.min(0.6, 0.15 + G.distance / 8000),
      // 안쪽 차선 차량은 중앙선 쪽으로 침범하는 패턴
      canInvade: inner && type !== 'ramp' && G.distance > 600 && r[7] < Math.min(0.4, 0.1 + G.distance / 15000),
      invadeT: 0,
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

    // 차선 변경 (깜빡이 → 이동)
    if (c.changing) {
      c.changeT += dt;
      const on = Math.floor(c.changeT * 6) % 2 === 0;
      setBlink(c, Math.sign(LANES[c.targetLane] - c.baseX) * c.dir, on);
      if (c.changeT > 0.9) {
        const tx = LANES[c.targetLane];
        const step = 2.6 * dt;
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

    // 중앙선 침범: 깜빡이 없이 중앙선 쪽으로 슬금슬금 → 2.6초 후 복귀
    if (c.canInvade && !c.changing && c.invadeT <= 0 && c.z > -130 && c.z < -35 && Math.random() < 0.6 * dt) {
      c.invadeT = 2.6;
      c.canInvade = false;
    }
    const want = c.invadeT > 0 ? -Math.sign(c.baseX) * 1.15 : 0;
    c.invadeT = Math.max(0, c.invadeT - dt);
    c.offset = approach(c.offset, want, 1.6 * dt);

    c.z += (G.speed - c.dir * c.speed) * dt;
    c.x = c.baseX + c.offset + Math.sin(t * 0.8 + c.wob) * c.wobAmp;
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
const puddlePool = makeInstanced(M.puddleGeometry(), M.createPuddleMaterial(), 18);
puddlePool.mesh.renderOrder = -1;

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
        } else {
          hitObstacle(c, 'small');
        }
      }
      if (c.z > 20) c.active = false;
      dummy.scale.set(1, 1, 1);
    }
    dummy.position.set(c.x, c.y + (kind === 'puddle' ? 0.03 : 0), c.z);
    dummy.rotation.set(c.rot, 0, c.rot * 0.7);
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
      if (collide && G.magnetTime > 0 && c.z > -30 && c.z < 3) {
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
  const type = POWER_TYPES[(r1 * POWER_TYPES.length) | 0];
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
  sfx.power();
  vibrate(30);
  popup(POWER_LABEL[type], 'power');
}

// ---------- 이펙트 (비, 스피드 라인)
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
  // 비 (스콜일수록 굵고 많이)
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
  const op = (G.state === 'playing' ? clamp((kmh - 150) / 120, 0, 0.45) : 0) + (G.boostTime > 0 ? 0.45 : 0);
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
  G.rainAmt = approach(G.rainAmt || 0, G.rain ? 1 : 0, rdt * 0.5);
  const ra = G.rainAmt;
  skyB.copy(rainSky).multiplyScalar(lerp(1, 0.3, night));
  skyA.lerp(skyB, ra * 0.8);
  scene.background.copy(skyA);
  scene.fog.color.copy(skyA);
  scene.fog.near = lerp(60, 22, ra);
  scene.fog.far = lerp(240, 130, ra);
  hemi.intensity = lerp(a[2], b[2], f) * (1 - ra * 0.35);
  sun.intensity = lerp(a[3], b[3], f) * (1 - ra * 0.65);
  M.lampHeadMat.emissiveIntensity = 0.1 + Math.max(night, ra * 0.6) * 2.2;
  buildingMat.emissiveIntensity = night * 1.1;
  M.tailMat.emissiveIntensity = 0.6 + Math.max(night, ra * 0.5) * 1.6;
  M.headMat.emissiveIntensity = 0.4 + Math.max(night, ra * 0.5) * 1.8;
  M.coinMat.emissiveIntensity = 0.5 + night * 0.6;
  headlight.material.opacity = Math.max(night, ra * 0.5) * 0.55;
  headlight.visible = G.state !== 'crashing' && G.state !== 'over';
  roadMat.color.setScalar(1 - ra * 0.3);
  sfx.rain(G.state === 'playing' || G.state === 'crashing' ? ra : 0);
}

// ---------- 카메라
let camX = 0, camY = 0;
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
  const fov = lerp(62, 72, p) + sf * 12 + (G.boostTime > 0 ? 8 : 0) + (G.air ? 6 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, rdt * 4));
    camera.updateProjectionMatrix();
  }
  camX = lerp(camX, G.x * 0.75, Math.min(1, rdt * 5));
  camY = lerp(camY, (G.airY || 0) * 0.6, Math.min(1, rdt * 4));
  G.shake = Math.max(0, (G.shake || 0) - rdt * 2.2);
  const s = G.shake * 0.35 + (G.boostTime > 0 ? 0.04 : 0);
  camera.position.set(camX + rand(-s, s), baseY + camY + rand(-s, s), camZ);
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
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter' && e.target.id === 'nameInput') submitName();
    return;
  }
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
  for (const pool of [conePool, signPool, puddlePool]) for (const c of pool.items) c.active = false;
  for (const p of powerItems) powerMeshes[p.type].group.visible = false;
  powerItems.length = 0;
}

function resetRun(seed) {
  seedWorld(seed ?? ((Math.random() * 2 ** 32) >>> 0));
  clearWorld();
  Object.assign(G, {
    speed: 21, x: 3.5, vx: 0, lean: 0, distance: 0, score: 0, mult: 1, time: 0,
    coinsRun: 0, nearMiss: 0, combo: 0, comboTimer: 0, maxCombo: 0, nitro: 0, boostTime: 0,
    shield: false, magnetTime: 0, x2Time: 0, slowTime: 0, invuln: 0, oncomingDist: 0,
    boostsUsed: 0, maxKmh: 0, smashed: 0, jumps: 0, continued: false, finalized: false, rankEntry: null,
    nextSpawn: 25, nextCoins: 60, nextPower: wrand('power', 450, 700), nextCones: wrand('cone', 350, 600),
    nextStall: wrand('stall', 300, 500), nextPuddle: wrand('puddle', 400, 700), nextSquall: wrand('weather', 1200, 2000),
    squallT: 0, rain: false, rainAmt: 0, shake: 0, crashT: 0,
    air: false, airY: 0, airVy: 0, slipT: 0, slipDir: 0,
    missionsDone: [], cd: 0, cdShown: 0, globalSubmitted: false,
  });
  for (let z = -60; z > SPAWN_Z; z -= wrand('car', 16, 26)) spawnCar(z);
  updatePool(conePool, 0, false, 0, 0, 'cone');
  updatePool(signPool, 0, false, 0, 0, 'sign');
  updatePool(puddlePool, 0, false, 0, 0, 'puddle');
  updateCoins(0, false);
  resetBikePose();
}

function resetBikePose() {
  bike.root.position.set(G.x, 0, 0);
  bike.root.rotation.set(0, 0, 0);
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
  MP.ready = false;
  MP.oppReady = false;
  resetRun(opts.seed);
  hideScreens();
  $('hud').classList.remove('hidden');
  $('hudVs').classList.toggle('hidden', !MP.active);
  G.state = 'countdown';
  G.cd = 3.2;
  G.cdShown = 0;
  $('countdown').classList.remove('hidden');
  if (save.stats.runs === 0) {
    toast(isTouchDevice ? '👆 왼손 ◀▶ 조향 · 오른손 THROTTLE/BRAKE' : '⌨️ ←→ 조향 · ↑ 가속 · ↓ 브레이크 · Space 니트로');
    toast('💨 차 옆을 아슬아슬하게 스치면 니어미스 보너스!');
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
  roadTex.offset.y = (G.distance / TILE) % 1;
  grassTex.offset.y = (G.distance / 10) % 1;
  for (const s of strips) s.update(dz);
}

// 거리 기준 스폰 — 절대 거리 일정표(+=)를 써서 멀티에서 같은 거리 → 같은 결과
const SPAWN_KEYS = ['nextSpawn', 'nextCoins', 'nextPower', 'nextCones', 'nextStall', 'nextPuddle', 'nextSquall'];
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
    G.nextPower += wrand('power', 500, 850);
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
  if (G.distance > G.nextSquall) {
    startSquall();
    G.nextSquall += wrand('weather', 2400, 4200);
  }
}

function startSquall() {
  G.squallT = SQUALL_TIME;
  G.rain = true;
  toast('⛈️ 스콜 경보! 30초간 폭우 · 점수 x1.3');
  sfx.thunder();
  const f = $('flash');
  f.classList.remove('go');
  void f.offsetWidth;
  f.classList.add('go');
}

function updatePlaying(rdt) {
  const ts = G.slowTime > 0 ? 0.55 : 1;
  const dt = rdt * ts;
  G.time += rdt;
  G.slowTime = Math.max(0, G.slowTime - rdt);
  G.magnetTime = Math.max(0, G.magnetTime - rdt);
  G.x2Time = Math.max(0, G.x2Time - rdt);
  G.invuln = Math.max(0, G.invuln - rdt);
  G.boostTime = Math.max(0, G.boostTime - rdt);
  G.slipT = Math.max(0, G.slipT - rdt);
  if (G.squallT > 0) {
    G.squallT -= rdt;
    if (G.squallT <= 0) {
      G.rain = false;
      toast('☀️ 스콜이 지나갔습니다');
    }
  }
  if (G.combo > 0) {
    G.comboTimer -= rdt;
    if (G.comboTimer <= 0) G.combo = 0;
  }

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
  if (G.boostTime > 0) target = maxSpd * 1.35;
  const accel = target > G.speed ? (G.boostTime > 0 ? 30 : 7 * bk.accel) : brake ? 22 : manual ? 5 : 6;
  G.speed = approach(G.speed, target, accel * rdt);

  // 조향 (물웅덩이에 미끄러지면 반응이 둔해지고 옆으로 밀림)
  const steer = steerInput();
  const handling = bk.handling * (G.rain ? 0.85 : 1);
  const latMax = (7 + G.speed * 0.1) * handling;
  const slipping = G.slipT > 0;
  const resp = slipping ? 1.2 : G.air ? 2.5 : G.rain ? 5 : 10;
  G.vx = lerp(G.vx, steer * latMax, 1 - Math.exp(-rdt * resp));
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

  // 점수
  const onc = G.x < -0.3;
  if (onc) {
    G.oncomingDist += dz;
    addNitro(dt * 3);
  }
  let mult = 1 + Math.min(G.combo, 20) * 0.1;
  if (onc) mult *= 2;
  if (G.x2Time > 0) mult *= 2;
  if (G.boostTime > 0) mult *= 1.5;
  if (G.rain) mult *= 1.3;
  G.mult = mult;
  G.onc = onc;
  G.score += dz * 0.6 * mult;
  G.maxKmh = Math.max(G.maxKmh, Math.round(G.speed * 3.6));

  runSpawners();

  updateCars(dt, true);
  if (G.state !== 'playing') return;
  updatePool(conePool, dt, true, 0.24, 0.25, 'cone');
  updatePool(signPool, dt, true, 0.62, 0.2, 'sign');
  updatePool(puddlePool, dt, true, 1.0, 1.6, 'puddle');
  updateStalls(dt, true);
  if (G.state !== 'playing') return;
  updateCoins(dt, true);
  updatePowerups(dt, true);
  checkMissions();
  poseBike();
  sfx.engineUpdate(G.speed / (maxSpd * 1.35), G.boostTime > 0);
}

function startJump(c) {
  G.air = true;
  G.airY = 0.4;
  G.airVy = 7.5 + G.speed * 0.1;
  G.jumps++;
  c.passed = true;
  sfx.jump();
  vibrate(30);
  popup('🛫 AIR!', 'big');
}

function land() {
  G.air = false;
  G.airY = 0;
  G.airVy = 0;
  G.invuln = Math.max(G.invuln, 0.5); // 착지 직후 잠깐 무적
  const pts = Math.round(500 * (1 + Math.min(G.combo, 20) * 0.1) * (G.x2Time > 0 ? 2 : 1));
  G.score += pts;
  addNitro(20);
  G.shake = 0.5;
  sfx.land();
  vibrate(40);
  popup(`AIR JUMP +${pts}`, 'perfect');
}

function hitPuddle() {
  G.slipT = 1.3;
  G.slipDir = Math.random() < 0.5 ? -1 : 1;
  sfx.splash();
  vibrate(20);
  popup('💦 미끄러짐!', 'power');
  const d = $('dropsFx');
  d.classList.add('splash');
  setTimeout(() => d.classList.remove('splash'), 900);
}

function poseBike() {
  bike.root.position.set(G.x, G.airY || 0, 0);
  bike.lean.rotation.z = G.lean;
  bike.lean.rotation.x = G.air ? clamp(-G.airVy * 0.03, -0.3, 0.25) : G.boostTime > 0 ? -0.06 : 0;
  bike.flame.visible = G.boostTime > 0;
  if (bike.flame.visible) bike.flame.scale.set(1, 1, rand(0.7, 1.3));
  shieldBubble.visible = G.shield;
  shieldBubble.material.opacity = 0.18 + Math.sin(G.time * 6) * 0.06;
  bike.root.visible = G.invuln > 0 && G.boostTime <= 0 && !G.air ? Math.floor(G.time * 12) % 2 === 0 : true;
}

function updateAttract(rdt) {
  G.time += rdt;
  G.speed = 24;
  G.x = Math.sin(G.time * 0.5) * 0.25;
  G.lean = -Math.cos(G.time * 0.5) * 0.1;
  scrollWorld(G.speed * rdt);
  if (G.distance > G.nextSpawn) {
    spawnCar();
    G.nextSpawn = G.distance + rand(10, 22);
  }
  updateCars(rdt, false);
  updateStalls(rdt, false);
  poseBike();
}

function tryBoost() {
  if (G.state !== 'playing' || G.nitro < 100 || G.boostTime > 0) return;
  G.nitro = 0;
  G.boostTime = BOOST_TIME;
  G.boostsUsed++;
  G.shake = 0.4;
  sfx.boost();
  vibrate(40);
  popup('NITRO!!', 'big');
}

function nearMiss(c, gap) {
  G.combo++;
  G.comboTimer = 3;
  G.maxCombo = Math.max(G.maxCombo, G.combo);
  G.nearMiss++;
  const perfect = gap < 0.35;
  let pts = 100 * (1 + G.combo * 0.25) * (perfect ? 2 : 1) * (c.type === 'police' ? 2 : 1) * (c.dir < 0 ? 1.5 : 1);
  if (G.x2Time > 0) pts *= 2;
  pts = Math.round(pts);
  G.score += pts;
  addNitro(perfect ? 22 : 14);
  const label = c.type === 'police' ? '🚓 ' : '';
  popup(`${label}${perfect ? 'PERFECT! ' : 'NEAR MISS '}+${pts}`, perfect ? 'perfect' : '');
  if (G.combo >= 2 && G.combo % 5 === 0) popup(`🔥 COMBO x${G.combo}`, 'combo');
  sfx.near(perfect);
  vibrate(perfect ? 25 : 12);
}

// kind: 'car' | 'small'(라바콘·표지판) | 'stall'(노점상)
function hitObstacle(o, kind = 'car') {
  if (G.state !== 'playing') return;
  if (G.invuln > 0 && G.boostTime <= 0) return; // 무적(깜빡임) 중엔 통과
  if (G.boostTime > 0 || G.shield) {
    if (G.boostTime <= 0) {
      G.shield = false;
      G.invuln = 1.2;
      popup('🛡️ 실드 파괴!', 'power');
    } else if (kind === 'car') {
      G.smashed++;
      const pts = 300 * (G.x2Time > 0 ? 2 : 1);
      G.score += pts;
      popup(`💥 SMASH +${pts}`, 'combo');
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
  scrollWorld(G.speed * dt);
  updateCars(dt, false);
  updatePool(conePool, dt, false, 0, 0, 'cone');
  updatePool(signPool, dt, false, 0, 0, 'sign');
  updatePool(puddlePool, dt, false, 0, 0, 'puddle');
  updateStalls(dt, false);
  updateCoins(dt, false);
  updatePowerups(dt, false);
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
    toast(`🎯 미션 완료! ${missionText(m)}  +🪙${m.reward}`);
    sfx.mission();
    persist();
  }
}

// ---------- UI 헬퍼
const SCREENS = ['menu', 'garage', 'ranking', 'missions', 'settings', 'pause', 'gameover', 'auth', 'multi'];
let currentScreen = null;
function show(id) {
  currentScreen = id;
  for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
}
function hideScreens() { show(null); }

const popupsEl = $('popups');
function popup(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'popup ' + cls;
  el.textContent = text;
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
const fmt = (n) => Math.floor(n).toLocaleString();

const hud = {
  score: $('hudScore'), mult: $('hudMult'), combo: $('hudCombo'), best: $('hudBest'), tags: $('hudTags'),
  speed: $('hudSpeed'), dist: $('hudDist'), coins: $('hudCoins'), nitroBar: $('nitroBar'), nitroWrap: $('nitroWrap'),
  btnNitro: $('btnNitro'), nitroFill: $('nitroFill'), boostFx: $('boostFx'), drops: $('dropsFx'), vs: $('hudVs'),
};
let lastTags = '';

function updateHud() {
  hud.score.textContent = fmt(G.score);
  hud.mult.textContent = 'x' + G.mult.toFixed(1);
  hud.mult.classList.toggle('hot', G.mult >= 2);
  hud.combo.classList.toggle('hidden', G.combo < 2);
  if (G.combo >= 2) hud.combo.textContent = `COMBO ${G.combo}`;
  hud.best.textContent = `BEST ${fmt(Math.max(save.best, G.score))}`;
  hud.speed.textContent = Math.round(G.speed * 3.6);
  hud.dist.textContent = (G.distance / 1000).toFixed(2) + ' km';
  hud.coins.textContent = save.coins;
  const boosting = G.boostTime > 0;
  const fill = boosting ? (G.boostTime / BOOST_TIME) * 100 : G.nitro;
  hud.nitroBar.style.width = fill + '%';
  hud.nitroWrap.classList.toggle('ready', G.nitro >= 100 && !boosting);
  hud.nitroWrap.classList.toggle('boost', boosting);
  hud.nitroFill.style.height = fill + '%';
  hud.btnNitro.classList.toggle('ready', G.nitro >= 100 && !boosting);
  hud.btnNitro.classList.toggle('locked', boosting);
  hud.boostFx.classList.toggle('on', boosting);
  hud.boostFx.classList.toggle('slow', !boosting && G.slowTime > 0);
  hud.drops.classList.toggle('on', G.rainAmt > 0.4);

  if (MP.active) {
    if (MP.opp) {
      const diff = Math.round(MP.opp.d - G.distance);
      const st = MP.oppDone ? '🏁' : diff >= 0 ? `▲${diff}m` : `▼${-diff}m`;
      hud.vs.textContent = `👻 ${MP.oppName} ${fmt(MP.oppDone ? MP.oppScore : MP.opp.sc)} · ${st}`;
    } else {
      hud.vs.textContent = net.connected ? '👻 상대 대기 중' : '⚠️ 연결 끊김';
    }
  }

  const tags = [];
  if (G.onc) tags.push('<span class="tag onc">⚠️ 역주행 x2</span>');
  if (G.air) tags.push('<span class="tag">🛫 AIR</span>');
  if (G.shield) tags.push('<span class="tag">🛡️ 실드</span>');
  if (G.magnetTime > 0) tags.push(`<span class="tag">🧲 ${Math.ceil(G.magnetTime)}s</span>`);
  if (G.x2Time > 0) tags.push(`<span class="tag">✨ x2 ${Math.ceil(G.x2Time)}s</span>`);
  if (G.slowTime > 0) tags.push(`<span class="tag">⏳ ${Math.ceil(G.slowTime)}s</span>`);
  if (G.rain) tags.push(`<span class="tag">⛈️ 스콜 ${Math.ceil(Math.max(0, G.squallT))}s · x1.3</span>`);
  if (G.slipT > 0) tags.push('<span class="tag onc">💦 미끄러짐</span>');
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
  refreshMenu();
  show('menu');
}

function refreshMenu() {
  const s = getSession();
  $('menuName').textContent = s ? s.nickname : save.lastName || '라이더';
  $('btnAccount').textContent = s ? `👤 ${s.nickname}` : '👤 로그인';
  $('menuBest').textContent = fmt(save.best);
  $('menuCoins').textContent = save.coins.toLocaleString();
}

let backTo = 'menu';
function openScreen(id, from = 'menu') {
  sfx.init();
  sfx.click();
  backTo = from;
  show(id);
}
$('btnPlay').addEventListener('click', () => startRun());
$('btnGarage').addEventListener('click', () => { renderGarage(); openScreen('garage'); });
$('btnRanking').addEventListener('click', () => { openScreen('ranking'); renderRanking(); });
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

// ---------- 차고 (바이크 / 배달 상자 / 라이더 의상·헬멧)
let garageTab = 'bike';
const SHOP = {
  box: { list: BOXES, owned: 'ownedBoxes', cur: 'box' },
  outfit: { list: OUTFITS, owned: 'ownedOutfits', cur: 'outfit' },
  helmet: { list: HELMETS, owned: 'ownedHelmets', cur: 'helmet' },
};

function shopButton(kind, item, owned, sel) {
  if (sel) return '<button class="btn" disabled>장착 중</button>';
  if (owned) return `<button class="btn primary" data-kind="${kind}" data-id="${item.id}" data-act="select">장착</button>`;
  return `<button class="btn gold" data-kind="${kind}" data-id="${item.id}" data-act="buy" ${save.coins < item.price ? 'disabled' : ''}>🪙 ${item.price.toLocaleString()}</button>`;
}

function renderShopItems(kind) {
  const { list, owned, cur } = SHOP[kind];
  return list.map((it) => {
    const o = save[owned].includes(it.id), sel = save[cur] === it.id;
    return `<div class="bike-card ${sel ? 'selected' : ''}">
      <div class="bike-icon" style="background:var(--green-soft)">${it.icon}</div>
      <div><h4>${it.name}</h4><p>${it.desc}</p></div>${shopButton(kind, it, o, sel)}</div>`;
  }).join('');
}

function renderGarage() {
  $('garageCoins').textContent = save.coins.toLocaleString();
  for (const b of $('garageTabs').children) b.classList.toggle('on', b.dataset.tab === garageTab);
  const list = $('shopList');
  if (garageTab === 'bike') {
    $('garageHint').textContent = '빠른 바이크일수록 거리 점수가 더 빨리 오릅니다.';
    list.innerHTML = BIKES.map((b) => {
      const owned = save.ownedBikes.includes(b.id);
      const sel = save.bike === b.id;
      const hex = '#' + b.color.toString(16).padStart(6, '0');
      return `<div class="bike-card ${sel ? 'selected' : ''}">
        <div class="bike-icon" style="background:${hex}33;border:2px solid ${hex}">🏍️</div>
        <div><h4>${b.name}</h4><p>${b.desc} · 최고 ${b.maxKmh}km/h</p>
          <div class="stat">속도<i><b style="width:${(b.maxKmh / 300) * 100}%"></b></i></div>
          <div class="stat">핸들링<i><b style="width:${(b.handling / 1.6) * 100}%"></b></i></div>
          <div class="stat">가속<i><b style="width:${(b.accel / 1.6) * 100}%"></b></i></div>
        </div>${shopButton('bike', b, owned, sel)}</div>`;
    }).join('');
  } else if (garageTab === 'box') {
    $('garageHint').textContent = '뒷좌석 배달 상자 스킨 (외형만 바뀝니다)';
    list.innerHTML = renderShopItems('box');
  } else {
    $('garageHint').textContent = '라이더 의상과 헬멧을 꾸며보세요';
    list.innerHTML = `<div class="shop-section">🧥 의상</div>${renderShopItems('outfit')}<div class="shop-section">⛑️ 헬멧</div>${renderShopItems('helmet')}`;
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
    if (save.coins < item.price) return;
    save.coins -= item.price;
    save[ownedKey].push(id);
    sfx.power();
    toast(`🎉 ${item.name} 구매 완료!`);
  } else {
    sfx.click();
  }
  save[curKey] = id;
  persist();
  buildBike();
  resetBikePose();
  renderGarage();
});

// ---------- 랭킹 (글로벌 / 내 기기)
let rankTab = 'global';
const medals = ['🥇', '🥈', '🥉'];

function rankTable(rows) {
  return `<table class="rank-table"><thead><tr><th>#</th><th>닉네임</th><th class="num">최고 점수</th><th>바이크</th></tr></thead><tbody>${
    rows.map((r, i) => `<tr class="${r.isMe ? 'me' : ''}">
      <td>${medals[i] ? `<span class="medal">${medals[i]}</span>` : i + 1}</td>
      <td>${escapeHtml(r.nickname || r.name)}${r.date ? `<br><small class="muted">${escapeHtml(r.date)}</small>` : ''}</td>
      <td class="num"><b>${fmt(r.score)}</b></td>
      <td><small>${escapeHtml(getBike(r.bike).name)}</small></td></tr>`).join('')
  }</tbody></table>`;
}

async function renderRanking() {
  for (const b of $('rankTabs').children) b.classList.toggle('on', b.dataset.rtab === rankTab);
  const list = $('rankList'), me = $('rankMe'), mode = $('rankMode');
  if (rankTab === 'local') {
    mode.textContent = '이 기기';
    mode.className = 'badge local';
    list.innerHTML = save.ranking.length
      ? rankTable(save.ranking.map((r) => ({ ...r, isMe: r.id === save.lastRankId })))
      : '<div class="empty">아직 기록이 없습니다.</div>';
    me.innerHTML = '';
    return;
  }
  mode.textContent = ONLINE ? '🟢 온라인' : '로컬 모드';
  mode.className = ONLINE ? 'badge' : 'badge local';
  list.innerHTML = '<div class="empty">불러오는 중...</div>';
  me.innerHTML = '';
  const res = await leaderboard.fetchTop();
  if (rankTab !== 'global' || currentScreen !== 'ranking') return;
  if (!res.ok) {
    list.innerHTML = `<div class="empty">랭킹을 불러오지 못했습니다<br><small>${escapeHtml(res.error)}</small></div>`;
    return;
  }
  list.innerHTML = res.top.length ? rankTable(res.top) : '<div class="empty">아직 등록된 기록이 없습니다.<br>첫 번째 랭커가 되어보세요!</div>';
  const s = getSession();
  if (!s) me.innerHTML = '로그인하면 내 순위가 표시됩니다 <button class="btn primary" id="rankLogin">로그인</button>';
  else if (res.me) me.innerHTML = `🙋 내 순위: <b>${res.me.rank}위</b> · ${escapeHtml(res.me.nickname)} · <b>${fmt(res.me.score)}</b>점`;
  else me.innerHTML = `🙋 ${escapeHtml(s.nickname)} 님은 아직 기록이 없습니다`;
  if (!ONLINE) me.innerHTML += '<br><small class="muted">서버 미설정: 이 기기의 계정끼리만 순위가 공유됩니다 (js/config.js)</small>';
  const rl = $('rankLogin');
  if (rl) rl.addEventListener('click', () => { renderAuth(); openScreen('auth', 'menu'); });
}

$('rankTabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-rtab]');
  if (!b) return;
  rankTab = b.dataset.rtab;
  sfx.click();
  renderRanking();
});

// ---------- 로그인 / 회원가입
let authTab = 'login';
function renderAuth() {
  const s = getSession();
  $('authMode').textContent = ONLINE ? '🟢 온라인 계정' : '로컬 계정';
  $('authMode').className = ONLINE ? 'badge' : 'badge local';
  $('authForms').classList.toggle('hidden', Boolean(s));
  $('authLogged').classList.toggle('hidden', !s);
  if (s) $('authNick').textContent = s.nickname;
  for (const b of $('authTabs').children) b.classList.toggle('on', b.dataset.auth === authTab);
  $('authPw2Wrap').classList.toggle('hidden', authTab !== 'signup');
  $('authSubmit').textContent = authTab === 'signup' ? '가입하고 시작하기' : '로그인';
  $('authPw').autocomplete = authTab === 'signup' ? 'new-password' : 'current-password';
  $('authMsg').textContent = '';
  $('authMsg').className = 'form-msg';
  $('authNote').textContent = ONLINE
    ? '로그인 정보는 Supabase 서버에 저장되며, 이 기기에는 자동 로그인 토큰만 보관합니다.'
    : '서버가 설정되지 않아 계정과 랭킹이 이 기기 브라우저에만 저장됩니다.';
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
    msg.textContent = '비밀번호 확인이 일치하지 않습니다';
    return;
  }
  const btn = $('authSubmit');
  btn.disabled = true;
  msg.className = 'form-msg ok';
  msg.textContent = '처리 중...';
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
  toast(`👋 ${res.user.nickname} 님 환영합니다!`);
  if (save.best > 0) leaderboard.submit(save.best, save.bike); // 기존 기록 반영
  refreshMenu();
  if (backTo === 'gameover') {
    backTo = 'menu';
    show('gameover');
    submitGlobal();
  } else {
    renderAuth();
  }
});
$('btnLogout').addEventListener('click', () => {
  auth.signOut();
  authTab = 'login';
  sfx.click();
  toast('로그아웃되었습니다');
  refreshMenu();
  renderAuth();
});

// ---------- 미션
function renderMissions() {
  $('missionList').innerHTML = save.missions.map((m) => `
    <div class="mission ${m.done ? 'done' : ''}">
      <span>${m.done ? '✅ ' : '🎯 '}${escapeHtml(missionText(m))}</span>
      <span class="reward">🪙 ${m.reward}</span>
    </div>`).join('');
}

// ---------- 설정
const SETTING_LABELS = {
  sound: (v) => (v ? 'ON' : 'OFF'),
  vibrate: (v) => (v ? 'ON' : 'OFF'),
  quality: (v) => (v === 'high' ? '고화질' : '저화질(빠름)'),
  throttle: (v) => (v === 'auto' ? '자동 가속' : '수동 (THROTTLE)'),
  touchMode: (v) => (v === 'buttons' ? '◀ ▶ 버튼' : '드래그 패드'),
};
function renderSettings() {
  for (const b of document.querySelectorAll('[data-setting]')) {
    b.textContent = SETTING_LABELS[b.dataset.setting](save.settings[b.dataset.setting]);
  }
}
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
    if (k === 'vibrate') { s.vibrate = !s.vibrate; vibrate(30); }
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
  if (!confirm('코인, 바이크, 커스텀, 랭킹, 미션 등 모든 데이터를 초기화할까요? (계정은 유지됩니다)')) return;
  resetSave();
  sfx.setEnabled(save.settings.sound);
  applyQuality();
  applyControlSettings();
  buildBike();
  resetBikePose();
  renderSettings();
  toast('데이터가 초기화되었습니다');
});

// ---------- 일시정지 (배달 주문서)
function renderReceipt() {
  const s = getSession();
  $('rcOrder').textContent = `#GR-${String(Math.floor(G.distance * 7 + G.time * 13) % 100000).padStart(5, '0')}`;
  $('rcRider').textContent = s ? s.nickname : save.lastName || '게스트 라이더';
  $('rcBike').textContent = getBike(save.bike).name;
  const items = [
    ['주행 거리', `${(G.distance / 1000).toFixed(2)} km`],
    ['니어미스', `${G.nearMiss}회 (최대 콤보 ${G.maxCombo})`],
    ['역주행 주행', `${Math.floor(G.oncomingDist)} m`],
    ['에어 점프', `${G.jumps}회`],
    ['획득 코인', `🪙 ${G.coinsRun}`],
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
});

// ---------- 게임 오버 / 랭킹 등록 / 이어달리기
function showGameOver() {
  G.state = 'over';
  $('hud').classList.add('hidden');
  const score = Math.floor(G.score);
  $('goScore').textContent = score.toLocaleString();
  $('goNew').classList.toggle('hidden', !(score > save.best && score > 0));
  save.best = Math.max(save.best, score);
  const stats = [
    ['거리', (G.distance / 1000).toFixed(2) + 'km'],
    ['니어미스', G.nearMiss],
    ['최대 콤보', G.maxCombo],
    ['최고속도', G.maxKmh + 'km/h'],
    ['에어 점프', G.jumps],
    ['코인', '🪙' + G.coinsRun],
  ];
  $('goStats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  $('goMissions').innerHTML = G.missionsDone.map((m) => `<div>✅ ${escapeHtml(missionText(m))} +🪙${m.reward}</div>`).join('');

  // 내 기기 랭킹: 로그인 상태면 닉네임으로 자동 등록, 게스트는 이름 입력
  const s = getSession();
  if (G.rankEntry) {
    G.rankEntry.score = score;
    G.rankEntry.dist = Math.floor(G.distance);
    sortRanking();
    persist();
    const pos = save.ranking.indexOf(G.rankEntry) + 1;
    $('rankDone').textContent = pos ? `📱 내 기기 랭킹 ${pos}위로 기록이 갱신되었습니다!` : '';
  } else if (s && qualifies(score)) {
    G.rankEntry = rankRecord(s.nickname);
    const pos = addRanking(G.rankEntry);
    $('rankDone').textContent = `📱 내 기기 랭킹 ${pos}위 등록!`;
  }
  const canRank = !G.rankEntry && qualifies(score);
  $('rankForm').classList.toggle('hidden', !canRank);
  $('rankDone').classList.toggle('hidden', !G.rankEntry);
  if (canRank) {
    $('rankPos').textContent = save.ranking.filter((r) => r.score >= score).length + 1;
    $('nameInput').value = save.lastName || '';
  }

  // 이어달리기 (멀티에선 불가)
  const cont = $('btnContinue');
  $('contCost').textContent = CONTINUE_COST;
  cont.classList.toggle('hidden', G.continued || MP.active);
  cont.disabled = save.coins < CONTINUE_COST;
  $('btnRetry').textContent = MP.active ? '🔁 재대결' : '다시 배달하기';

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

// 글로벌 랭킹 전송 (로그인 상태) / 로그인 유도 (게스트)
async function submitGlobal() {
  const box = $('goGlobal');
  box.classList.remove('hidden');
  const s = getSession();
  const score = Math.floor(G.score);
  if (!s) {
    box.innerHTML = '🌏 로그인하면 글로벌 랭킹에 기록이 등록됩니다 <button class="btn primary" id="goLogin">로그인</button>';
    $('goLogin').addEventListener('click', () => { renderAuth(); openScreen('auth', 'gameover'); });
    return;
  }
  if (score <= 0) {
    box.classList.add('hidden');
    return;
  }
  if (G.globalSubmitted === score) return;
  G.globalSubmitted = score;
  box.textContent = '🌏 글로벌 랭킹 전송 중...';
  const res = await leaderboard.submit(score, save.bike);
  if (!res.ok) {
    box.textContent = `🌏 랭킹 전송 실패: ${res.error}`;
    G.globalSubmitted = false;
    return;
  }
  const top = await leaderboard.fetchTop();
  const rank = top.ok && top.me ? `${top.me.rank}위` : '-';
  box.innerHTML = `🌏 글로벌 랭킹 <b>${rank}</b> · 내 최고 <b>${fmt(res.best)}</b>점${ONLINE ? '' : ' <small class="muted">(로컬 모드)</small>'}`;
}

function rankRecord(name) {
  const d = new Date();
  return {
    name, score: Math.floor(G.score), dist: Math.floor(G.distance), bike: save.bike,
    date: `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`,
  };
}

function submitName() {
  if (G.state !== 'over' || G.rankEntry) return;
  const name = $('nameInput').value.trim().slice(0, 10) || 'PLAYER';
  save.lastName = name;
  G.rankEntry = rankRecord(name);
  const pos = addRanking(G.rankEntry);
  $('nameInput').blur();
  $('rankForm').classList.add('hidden');
  const done = $('rankDone');
  done.textContent = `📱 ${name} 님, 내 기기 랭킹 ${pos}위에 등록되었습니다!`;
  done.classList.remove('hidden');
  sfx.mission();
}
$('btnSubmitName').addEventListener('click', submitName);

function finalizeRun() {
  if (G.finalized || !('score' in G)) return;
  G.finalized = true;
  const score = Math.floor(G.score);
  if (!G.rankEntry && qualifies(score)) {
    G.rankEntry = rankRecord(getSession()?.nickname || save.lastName || 'PLAYER');
    addRanking(G.rankEntry);
  }
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

$('btnContinue').addEventListener('click', () => {
  if (G.continued || MP.active || save.coins < CONTINUE_COST) return;
  save.coins -= CONTINUE_COST;
  persist();
  G.continued = true;
  // 주변 장애물 정리 후 부활
  for (let i = cars.length - 1; i >= 0; i--) if (cars[i].z > -50) releaseCar(cars[i]);
  for (let i = stalls.length - 1; i >= 0; i--) if (stalls[i].z > -50) releaseStall(stalls[i]);
  for (const pool of [conePool, signPool]) for (const c of pool.items) if (c.z > -50) c.active = false;
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
  popup('🔥 이어달리기!', 'big');
});

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
      ? (net.role === 'host' ? `✅ ${MP.oppName} 님 입장! 대결을 시작하세요` : '✅ 연결됨 · 방장이 시작하기를 기다리는 중...')
      : (net.role === 'host' ? '상대를 기다리는 중... 코드를 알려주세요' : '연결 중...');
  }
}

const myName = () => getSession()?.nickname || save.lastName || '라이더';
const multiMsg = (t, ok = false) => {
  $('multiMsg').textContent = t;
  $('multiMsg').className = ok ? 'form-msg ok' : 'form-msg';
};

$('btnHost').addEventListener('click', async () => {
  multiMsg('방을 만드는 중...', true);
  try {
    await net.host();
    multiMsg('');
  } catch (e) {
    multiMsg(`방 만들기 실패: ${e.message || e.type || e}`);
    net.close();
  }
  renderMulti();
});
$('btnJoin').addEventListener('click', async () => {
  const code = $('roomInput').value.trim();
  if (code.length < 5) {
    multiMsg('5자리 Room Code 를 입력하세요');
    return;
  }
  multiMsg('접속 중...', true);
  try {
    await net.join(code);
    multiMsg('');
  } catch (e) {
    multiMsg(e.message || '접속 실패');
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
  ghost.root.visible = false;
}

function hostStartMatch() {
  if (net.role !== 'host' || !net.connected) return;
  const seed = (Math.random() * 2 ** 32) >>> 0;
  net.send({ t: 'start', seed });
  if (G.state === 'over') finalizeRun();
  startRun({ mp: true, seed });
}

function requestRematch() {
  if (!net.connected) {
    toast('상대와 연결이 끊겨 재대결할 수 없습니다');
    return;
  }
  MP.ready = true;
  if (net.role === 'host') {
    if (MP.oppReady) hostStartMatch();
    else toast('상대의 재대결 수락을 기다리는 중...');
  } else {
    net.send({ t: 'ready' });
    toast('방장에게 재대결을 요청했습니다');
  }
}

net.on('connected', () => {
  net.send({ t: 'hello', name: myName(), bike: save.bike });
  sfx.mission();
  renderMulti();
});
net.on('disconnected', () => {
  toast('⚠️ 상대와 연결이 끊어졌습니다');
  MP.opp = null;
  ghost.root.visible = false;
  renderMulti();
  if (G.state === 'over' && MP.active) renderVsResult();
});
net.on('error', (e) => {
  if (currentScreen === 'multi') multiMsg(`연결 오류: ${e.type || e.message || e}`);
});
net.on('data', (m) => {
  if (!m || typeof m !== 'object') return;
  switch (m.t) {
    case 'hello':
      MP.oppName = String(m.name || '상대').slice(0, 12);
      renderMulti();
      break;
    case 'full':
      multiMsg('방이 가득 찼습니다');
      net.close();
      renderMulti();
      break;
    case 'start':
      if (net.role !== 'guest') break;
      if (G.state === 'over') finalizeRun();
      startRun({ mp: true, seed: m.seed >>> 0 });
      break;
    case 's':
      if (!MP.active) break;
      MP.opp = { d: +m.d || 0, x: +m.x || 0, y: +m.y || 0, l: +m.l || 0, v: +m.v || 0, sc: +m.sc || 0, at: performance.now() };
      break;
    case 'over':
      MP.oppDone = true;
      MP.oppScore = Math.floor(+m.sc || 0);
      if (G.state === 'over' && MP.active) renderVsResult();
      break;
    case 'ready':
      MP.oppReady = true;
      if (net.role === 'host') {
        if (MP.ready) hostStartMatch();
        else toast(`🔁 ${MP.oppName} 님이 재대결을 원합니다`);
      }
      break;
    case 'bye':
      toast(`${MP.oppName} 님이 방을 나갔습니다`);
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
  // 내 상태 10Hz 전송
  MP.sendT -= rdt;
  if (MP.sendT <= 0 && (G.state === 'playing' || G.state === 'crashing' || G.state === 'paused')) {
    MP.sendT = 0.1;
    net.send({ t: 's', d: Math.round(G.distance * 10) / 10, x: +G.x.toFixed(2), y: +(G.airY || 0).toFixed(2), l: +G.lean.toFixed(2), v: +G.speed.toFixed(1), sc: Math.floor(G.score) });
  }
  // 상대 고스트: 수신 위치를 속도로 외삽해서 부드럽게
  const o = MP.opp;
  if (!o || MP.oppDone) {
    ghost.root.visible = false;
    return;
  }
  const ext = Math.min(0.5, (performance.now() - o.at) / 1000);
  const z = -((o.d + o.v * ext) - G.distance);
  ghost.root.visible = z > -220 && z < 12;
  ghost.root.position.x = lerp(ghost.root.position.x, o.x, Math.min(1, rdt * 10));
  ghost.root.position.y = o.y;
  ghost.root.position.z = z;
  ghost.lean.rotation.z = o.l;
}

function renderVsResult() {
  const el = $('goVs');
  el.classList.remove('hidden', 'win', 'lose');
  const me = Math.floor(G.score);
  if (!MP.oppDone) {
    el.innerHTML = net.connected
      ? `<b>⏳ ${escapeHtml(MP.oppName)} 님이 아직 주행 중...</b>현재 상대 점수 ${fmt(MP.opp?.sc || 0)}`
      : '<b>⚠️ 상대 연결 끊김</b>대결이 무효 처리되었습니다';
    return;
  }
  const win = me > MP.oppScore, draw = me === MP.oppScore;
  if (!draw) el.classList.add(win ? 'win' : 'lose');
  el.innerHTML = `<b>${win ? '🏆 승리!' : draw ? '🤝 무승부' : '😵 패배'}</b>나 ${fmt(me)} vs ${escapeHtml(MP.oppName)} ${fmt(MP.oppScore)}`;
}

// ---------- 외부 3D 모델 교체 (로딩 완료 시 즉시 반영)
const INSTANCED_KEYS = {
  'prop.palm': [palmMesh], 'prop.ruko': [rukoL, rukoR], 'prop.warung': [warungMesh],
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
  console.info(`[ModelManager] '${key}' 외부 모델 적용`);
});
M.models.loadAll();

// ---------- 메인 루프
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (now - last) / 1000);
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
}

// ---------- 시작
if (new URLSearchParams(location.search).has('debug')) {
  window.__G = G;
  window.__MP = MP;
  window.__models = M.models;
  window.__cars = cars;
  window.__scene = scene;
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
  };
}
goMenu();
$('loading').remove();
auth.restore().then(refreshMenu);
const today = new Date().toDateString();
if (save.lastDaily !== today) {
  save.lastDaily = today;
  save.coins += 100;
  persist();
  refreshMenu();
  toast('🎁 오늘의 출석 보상 +🪙100');
}
requestAnimationFrame(frame);
