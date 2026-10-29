import * as THREE from 'three';
import * as M from './models.js';
import { Sound } from './audio.js';
import {
  save, persist, resetSave, BIKES, getBike, qualifies, addRanking, sortRanking,
  replaceDoneMissions, missionText,
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
const CAR_COLORS = [0xd62828, 0xf77f00, 0x2a9d8f, 0x264653, 0x8d99ae, 0xe9ecef, 0x1d3557, 0x6a4c93, 0x40916c, 0x151515, 0xbfc0c0, 0x7f5539, 0x3a86ff];
const POWER_TYPES = ['shield', 'magnet', 'x2', 'slow'];
const POWER_LABEL = { shield: '🛡️ 실드!', magnet: '🧲 자석!', x2: '✨ 점수 x2!', slow: '⏳ 슬로우모션!' };

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

// ---------- 도로, 잔디, 가드레일
const roadTex = M.makeRoadTexture(renderer.capabilities.getMaxAnisotropy());
roadTex.repeat.set(1, ROAD_LEN / TILE);
const roadMat = new THREE.MeshLambertMaterial({ map: roadTex });
const road = new THREE.Mesh(new THREE.PlaneGeometry(17, ROAD_LEN), roadMat);
road.rotation.x = -Math.PI / 2;
road.position.z = 25 - ROAD_LEN / 2;
scene.add(road);

const grassTex = M.makeGrassTexture();
grassTex.repeat.set(60, ROAD_LEN / 10);
const grass = new THREE.Mesh(new THREE.PlaneGeometry(600, ROAD_LEN), new THREE.MeshLambertMaterial({ map: grassTex }));
grass.rotation.x = -Math.PI / 2;
grass.position.set(0, -0.03, 25 - ROAD_LEN / 2);
scene.add(grass);
scene.add(M.createRails(ROAD_LEN, 25 - ROAD_LEN / 2));

// ---------- 스크롤되는 도로변 소품
const dummy = new THREE.Object3D();
const tmpColor = new THREE.Color();

class PropStrip {
  constructor(meshes, count, spacing, respawn) {
    this.meshes = meshes;
    this.span = count * spacing;
    this.respawn = respawn;
    this.items = [];
    for (let i = 0; i < count; i++) {
      const it = { i, x: 0, z: 25 - i * spacing - Math.random() * spacing * 0.5, sx: 1, sy: 1, sz: 1, ry: 0 };
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
      dummy.scale.set(it.sx, it.sy, it.sz);
      dummy.updateMatrix();
      for (const m of this.meshes) m.setMatrixAt(k, dummy.matrix);
    }
    for (const m of this.meshes) m.instanceMatrix.needsUpdate = true;
  }
}

const treeMesh = new THREE.InstancedMesh(M.treeGeometry(), M.vcMat, 70);
const lampPole = new THREE.InstancedMesh(M.lampPoleGeometry(), M.vcMat, 18);
const lampHead = new THREE.InstancedMesh(M.lampHeadGeometry(), M.lampHeadMat, 18);
const buildingMat = M.makeBuildingMaterial();
const bldgMesh = new THREE.InstancedMesh(M.buildingGeometry(), buildingMat, 36);
const strips = [
  new PropStrip([treeMesh], 70, 6, (it) => {
    const side = Math.random() < 0.5 ? -1 : 1;
    it.x = side * rand(11, 42);
    it.sx = it.sy = it.sz = rand(0.7, 1.5);
    it.ry = rand(0, Math.PI * 2);
  }),
  new PropStrip([lampPole, lampHead], 18, 24, (it) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * 8.9;
    it.ry = side > 0 ? 0 : Math.PI;
  }),
  new PropStrip([bldgMesh], 36, 12, (it, k) => {
    const side = it.i % 2 ? 1 : -1;
    it.x = side * rand(48, 85);
    it.sx = rand(8, 16);
    it.sy = rand(10, 48);
    it.sz = rand(8, 14);
    bldgMesh.setColorAt(k, tmpColor.setHSL(rand(0.5, 0.7), rand(0.05, 0.2), rand(0.45, 0.78)));
    if (bldgMesh.instanceColor) bldgMesh.instanceColor.needsUpdate = true;
  }),
];

// ---------- 바이크
let bike = null;
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

function buildBike() {
  if (bike) scene.remove(bike.root);
  bike = M.createBike(getBike(save.bike).color);
  bike.root.add(headlight, shieldBubble);
  scene.add(bike.root);
}
buildBike();

// ---------- 게임 상태
const G = { state: 'loading' };

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

function pickType() {
  const r = Math.random();
  if (r < 0.07 + Math.min(0.05, G.distance / 60000)) return 'bus';
  if (r < 0.19) return 'truck';
  if (r < 0.35) return 'suv';
  if (r < 0.43) return 'taxi';
  if (r < 0.47) return 'police';
  return 'sedan';
}

function spawnCar(z = SPAWN_Z) {
  const type = pickType();
  const def = M.CAR_DEFS[type];
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  for (const lane of order) {
    if (!laneClear(lane, z, def.len) || blocksAll(lane, z)) continue;
    const c = acquireCar(type);
    const dir = lane >= 2 ? 1 : -1;
    Object.assign(c, {
      lane, targetLane: lane, dir, baseX: LANES[lane], x: LANES[lane], z,
      speed: rand(def.speed[0], def.speed[1]) * (dir < 0 ? 1.1 : 1),
      passed: false, minGap: 99, changing: false, changeT: 0, flying: false, honked: false,
      wob: rand(0, Math.PI * 2),
      wobAmp: (type === 'bus' || type === 'truck' ? 0.1 : 0.22) * (1 + clamp(G.distance / 8000, 0, 1) * 0.8),
      canChange: Math.random() < Math.min(0.6, 0.15 + G.distance / 8000),
    });
    const col = type === 'taxi' ? 0xffc300 : type === 'police' ? 0xf4f4f4 : type === 'bus' ? pick([0x2e86de, 0x10ac84, 0xee5253]) : pick(CAR_COLORS);
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

function updateCars(dt, collide) {
  const t = G.time;
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
      const side = Math.sign(LANES[c.targetLane] - c.baseX) * c.dir;
      (side > 0 ? c.blinkMatR : c.blinkMatL).emissiveIntensity = on ? 2.2 : 0;
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

    c.z += (G.speed - c.dir * c.speed) * dt;
    c.x = c.baseX + Math.sin(t * 0.8 + c.wob) * c.wobAmp;
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

    if (!collide || G.state !== 'playing') continue;
    const dx = Math.abs(c.x - G.x), dz = Math.abs(c.z);
    if (dx < c.w / 2 + BIKE_HW - 0.05 && dz < c.len / 2 + BIKE_HL - 0.15) {
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

// ---------- 라바콘(차선 경계 위 장애물)
const MAX_CONES = 40;
const coneMesh = new THREE.InstancedMesh(M.coneGeometry(), M.vcMat, MAX_CONES);
coneMesh.frustumCulled = false;
scene.add(coneMesh);
const cones = Array.from({ length: MAX_CONES }, () => ({ active: false, x: 0, z: 0, y: 0, vy: 0, vx: 0, rot: 0, flying: false }));

function spawnCones() {
  // 절반 이상은 플레이어가 타고 있는 차선 경계에 배치 → 경계선만 타는 플레이 견제
  const nearest = DIVIDERS.reduce((a, d) => (Math.abs(d - G.x) < Math.abs(a - G.x) ? d : a));
  const x = Math.random() < 0.6 ? nearest : pick(DIVIDERS);
  const n = 4 + ((Math.random() * 5) | 0);
  for (let i = 0; i < n; i++) {
    const c = cones.find((k) => !k.active);
    if (!c) break;
    Object.assign(c, { active: true, x, z: SPAWN_Z - i * 3.2, y: 0, vy: 0, vx: 0, rot: 0, flying: false });
  }
}

function updateCones(dt, collide) {
  for (let k = 0; k < MAX_CONES; k++) {
    const c = cones[k];
    if (!c.active) {
      dummy.scale.set(0, 0, 0);
    } else {
      c.z += G.speed * dt;
      if (c.flying) {
        c.vy -= 22 * dt;
        c.y = Math.max(0, c.y + c.vy * dt);
        c.x += c.vx * dt;
        c.rot += dt * 12;
      } else if (collide && Math.abs(c.x - G.x) < 0.24 + BIKE_HW && Math.abs(c.z) < 0.25 + BIKE_HL) {
        hitObstacle(c, true);
      }
      if (c.z > 20) c.active = false;
      dummy.scale.set(1, 1, 1);
    }
    dummy.position.set(c.x, c.y, c.z);
    dummy.rotation.set(c.rot, 0, c.rot * 0.7);
    dummy.updateMatrix();
    coneMesh.setMatrixAt(k, dummy.matrix);
  }
  coneMesh.instanceMatrix.needsUpdate = true;
}

// ---------- 코인
const MAX_COINS = 80;
const coinMesh = new THREE.InstancedMesh(M.coinGeometry(), M.coinMat, MAX_COINS);
coinMesh.frustumCulled = false;
scene.add(coinMesh);
const coins = Array.from({ length: MAX_COINS }, () => ({ active: false, x: 0, z: 0 }));

function spawnCoins() {
  const pattern = pick(['line', 'line', 'zig', 'split']);
  const n = 6 + ((Math.random() * 7) | 0);
  const lane = pick([0, 1, 2, 3]);
  const div = pick(DIVIDERS);
  const phase = rand(0, Math.PI * 2);
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
      if (collide && Math.abs(c.x - G.x) < 0.9 && Math.abs(c.z) < 1.3) {
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
  G.nitro = Math.min(100, G.nitro + 2);
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
  const avail = POWER_TYPES.filter((t) => !powerItems.some((p) => p.type === t));
  if (!avail.length) return;
  const type = pick(avail);
  const x = Math.random() < 0.5 ? pick(LANES) : pick(DIVIDERS);
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
    if (collide && Math.abs(p.x - G.x) < 1.2 && Math.abs(p.z) < 1.5) {
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
const rain = makeLines(900, 0xaab8d0);
const streaks = makeLines(70, 0xffffff);
for (const d of rain.drops) d.x = rand(-20, 20);
for (const d of streaks.drops) d.x = rand(-14, 14);

function updateFx(rdt) {
  const cx = camera.position.x, cz = camera.position.z;
  const spd = G.speed;
  // 비
  rain.lines.visible = G.rainAmt > 0.01;
  if (rain.lines.visible) {
    rain.lines.material.opacity = G.rainAmt * 0.55;
    const P = rain.pos;
    rain.drops.forEach((d, i) => {
      d.y -= 26 * rdt;
      d.z += spd * rdt;
      if (d.y < 0 || d.z > cz + 3) {
        d.y = rand(8, 18);
        d.z = cz - rand(2, 70);
        d.x = cx + rand(-20, 20);
      }
      const o = i * 6;
      P[o] = d.x; P[o + 1] = d.y; P[o + 2] = d.z;
      P[o + 3] = d.x; P[o + 4] = d.y + 0.7; P[o + 5] = d.z - spd * 0.02;
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
const skyA = new THREE.Color(), skyB = new THREE.Color(), rainSky = new THREE.Color(0x56606e);

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
  skyA.lerp(skyB, ra * 0.75);
  scene.background.copy(skyA);
  scene.fog.color.copy(skyA);
  scene.fog.near = lerp(60, 30, ra);
  scene.fog.far = lerp(240, 150, ra);
  hemi.intensity = lerp(a[2], b[2], f) * (1 - ra * 0.3);
  sun.intensity = lerp(a[3], b[3], f) * (1 - ra * 0.6);
  M.lampHeadMat.emissiveIntensity = 0.1 + night * 2.2;
  buildingMat.emissiveIntensity = night * 1.1;
  M.tailMat.emissiveIntensity = 0.6 + night * 1.6;
  M.headMat.emissiveIntensity = 0.4 + night * 1.8;
  M.coinMat.emissiveIntensity = 0.5 + night * 0.6;
  headlight.material.opacity = Math.max(night, ra * 0.5) * 0.55;
  headlight.visible = G.state !== 'crashing' && G.state !== 'over';
  roadMat.color.setScalar(1 - ra * 0.25);
}

// ---------- 카메라
let camX = 0;
function updateCamera(rdt) {
  const p = clamp((1.35 - camera.aspect) / 0.8, 0, 1); // 0 = 가로화면, 1 = 세로화면
  const camY = lerp(3.0, 5.4, p), camZ = lerp(6.2, 8.4, p);
  let lookZ = lerp(-14, -24, p), lookY = lerp(1.2, 0.6, p);
  if (G.state === 'menu') {
    // 메뉴에서는 하단 시트에 가리지 않도록 라이더가 화면 가운데 오게
    lookZ = lerp(-7, -6, p);
    lookY = lerp(-1.6, -1.3, p);
  }
  const sf = clamp((G.speed * 3.6 - 60) / 220, 0, 1);
  const fov = lerp(62, 72, p) + sf * 12 + (G.boostTime > 0 ? 8 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = lerp(camera.fov, fov, Math.min(1, rdt * 4));
    camera.updateProjectionMatrix();
  }
  camX = lerp(camX, G.x * 0.75, Math.min(1, rdt * 5));
  G.shake = Math.max(0, (G.shake || 0) - rdt * 2.2);
  const s = G.shake * 0.35 + (G.boostTime > 0 ? 0.04 : 0);
  camera.position.set(camX + rand(-s, s), camY + rand(-s, s), camZ);
  camera.lookAt(camX * 0.9, lookY, lookZ);
  camera.rotateZ((G.lean || 0) * 0.08);
}

// ---------- 입력
const keys = {};
const touch = { left: false, right: false, brake: false, pointers: new Map(), dragging: false };
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

function enableTouchUI() {
  document.body.classList.add('touch');
  $('touchControls').classList.remove('hidden');
}
if (isTouchDevice) enableTouchUI();

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') {
    if (e.key === 'Enter') submitName();
    return;
  }
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') tryBoost();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'Enter') {
    if (G.state === 'menu' && !$('menu').classList.contains('hidden')) startRun();
    else if (G.state === 'over') retry();
  }
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => {
  for (const k of Object.keys(keys)) keys[k] = false;
  touch.pointers.clear();
  refreshTouch();
});

function refreshTouch() {
  touch.left = false;
  touch.right = false;
  for (const v of touch.pointers.values()) {
    if (v.side < 0) touch.left = true;
    else touch.right = true;
  }
  touch.dragging = touch.pointers.size > 0;
  $('zoneLeft').classList.toggle('active', touch.left && save.settings.touchMode === 'zones');
  $('zoneRight').classList.toggle('active', touch.right && save.settings.touchMode === 'zones');
}

for (const [id, side] of [['zoneLeft', -1], ['zoneRight', 1]]) {
  const el = $(id);
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (e.pointerType === 'touch') enableTouchUI();
    try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (touch.pointers.size === 0) G.dragX = G.x;
    touch.pointers.set(e.pointerId, { side, lastX: e.clientX });
    refreshTouch();
  });
  el.addEventListener('pointermove', (e) => {
    const p = touch.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.lastX;
    p.lastX = e.clientX;
    G.dragX = clamp((G.dragX ?? G.x) + (dx / Math.min(window.innerWidth, 700)) * 22, -ROAD_HALF, ROAD_HALF);
  });
  const end = (e) => {
    touch.pointers.delete(e.pointerId);
    refreshTouch();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
}

const btnBrake = $('btnBrake');
btnBrake.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  touch.brake = true;
  btnBrake.classList.add('active');
});
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
  btnBrake.addEventListener(ev, () => {
    touch.brake = false;
    btnBrake.classList.remove('active');
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
  if (keys.ArrowLeft || keys.KeyA) s -= 1;
  if (keys.ArrowRight || keys.KeyD) s += 1;
  if (touch.dragging && save.settings.touchMode === 'drag') {
    s += clamp((G.dragX - G.x) * 1.4, -1, 1);
  } else {
    if (touch.left) s -= 1;
    if (touch.right) s += 1;
  }
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
  for (const c of coins) c.active = false;
  for (const c of cones) c.active = false;
  for (const p of powerItems) powerMeshes[p.type].group.visible = false;
  powerItems.length = 0;
}

function resetRun() {
  clearWorld();
  Object.assign(G, {
    speed: 21, x: 3.5, vx: 0, lean: 0, dragX: 3.5, distance: 0, score: 0, mult: 1, time: 0,
    coinsRun: 0, nearMiss: 0, combo: 0, comboTimer: 0, maxCombo: 0, nitro: 0, boostTime: 0,
    shield: false, magnetTime: 0, x2Time: 0, slowTime: 0, invuln: 0, oncomingDist: 0,
    boostsUsed: 0, maxKmh: 0, smashed: 0, continued: false, finalized: false, rankEntry: null,
    nextSpawn: 25, nextCoins: 60, nextPower: rand(450, 700), nextCones: rand(500, 800),
    weatherNext: rand(1500, 2500), rain: false, rainAmt: 0, shake: 0, crashT: 0,
    missionsDone: [], cd: 0, cdShown: 0,
  });
  for (let z = -60; z > SPAWN_Z; z -= rand(16, 26)) spawnCar(z);
  updateCones(0, false);
  updateCoins(0, false);
  resetBikePose();
}

function resetBikePose() {
  bike.root.position.set(G.x, 0, 0);
  bike.root.rotation.set(0, 0, 0);
  bike.lean.rotation.set(0, 0, 0);
  bike.root.visible = true;
}

function startRun() {
  sfx.init();
  sfx.click();
  if (bike.bodyMat.color.getHex() !== getBike(save.bike).color) buildBike();
  resetRun();
  hideScreens();
  $('hud').classList.remove('hidden');
  G.state = 'countdown';
  G.cd = 3.2;
  G.cdShown = 0;
  $('countdown').classList.remove('hidden');
  if (save.stats.runs === 0) {
    toast(isTouchDevice ? '👆 화면 좌/우를 눌러 차 사이를 빠져나가세요!' : '⌨️ ←→ 조향 · ↑ 가속 · ↓ 브레이크 · Space 니트로');
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
  return base * rand(0.6, 1.3);
}

function scrollWorld(dz) {
  G.distance += dz;
  roadTex.offset.y = (G.distance / TILE) % 1;
  grassTex.offset.y = (G.distance / 10) % 1;
  for (const s of strips) s.update(dz);
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
  if (G.combo > 0) {
    G.comboTimer -= rdt;
    if (G.comboTimer <= 0) G.combo = 0;
  }

  // 속도
  const bk = getBike(save.bike);
  const maxSpd = bk.maxKmh / 3.6;
  const throttle = keys.ArrowUp || keys.KeyW;
  const brake = keys.ArrowDown || keys.KeyS || touch.brake;
  const cruise = Math.min(maxSpd * 0.85, (75 + G.distance / 45) / 3.6);
  let target = cruise;
  if (throttle) target = maxSpd;
  if (brake) target = 50 / 3.6;
  if (G.boostTime > 0) target = maxSpd * 1.35;
  const accel = target > G.speed ? (G.boostTime > 0 ? 30 : 7 * bk.accel) : brake ? 22 : 6;
  G.speed = approach(G.speed, target, accel * rdt);

  // 조향
  const steer = steerInput();
  const handling = bk.handling * (G.rain ? 0.85 : 1);
  const latMax = (7 + G.speed * 0.1) * handling;
  G.vx = lerp(G.vx, steer * latMax, 1 - Math.exp(-rdt * (G.rain ? 5 : 10)));
  G.x += G.vx * rdt;
  if (Math.abs(G.x) > ROAD_HALF) {
    G.x = Math.sign(G.x) * ROAD_HALF;
    G.vx = 0;
  }
  G.lean = lerp(G.lean, (-G.vx / latMax) * 0.55, 1 - Math.exp(-rdt * 10));

  const dz = G.speed * dt;
  scrollWorld(dz);

  // 점수
  const onc = G.x < -0.3;
  if (onc) {
    G.oncomingDist += dz;
    G.nitro = Math.min(100, G.nitro + dt * 3);
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

  // 스폰
  if (G.distance > G.nextSpawn) {
    spawnCar();
    if (Math.random() < clamp(G.distance / 20000, 0, 0.35)) spawnCar();
    G.nextSpawn = G.distance + spawnGap();
  }
  if (G.distance > G.nextCoins) {
    spawnCoins();
    G.nextCoins = G.distance + rand(120, 260);
  }
  if (G.distance > G.nextPower) {
    spawnPower();
    G.nextPower = G.distance + rand(500, 850);
  }
  if (G.distance > G.nextCones) {
    spawnCones();
    G.nextCones = G.distance + rand(300, 650) * lerp(1, 0.5, clamp(G.distance / 15000, 0, 1));
  }
  if (G.distance > G.weatherNext) {
    if (G.rain) {
      G.rain = false;
      toast('☀️ 비가 그쳤습니다');
    } else if (Math.random() < 0.6) {
      G.rain = true;
      toast('🌧️ 비가 내립니다! 미끄럽지만 점수 x1.3');
    }
    G.weatherNext = G.distance + (G.rain ? rand(900, 1500) : rand(1500, 3000));
  }

  updateCars(dt, true);
  if (G.state !== 'playing') return;
  updateCones(dt, true);
  if (G.state !== 'playing') return;
  updateCoins(dt, true);
  updatePowerups(dt, true);
  checkMissions();
  poseBike();
  sfx.engineUpdate(G.speed / (maxSpd * 1.35), G.boostTime > 0);
}

function poseBike() {
  bike.root.position.set(G.x, 0, 0);
  bike.lean.rotation.z = G.lean;
  bike.lean.rotation.x = G.boostTime > 0 ? -0.06 : 0;
  bike.flame.visible = G.boostTime > 0;
  if (bike.flame.visible) bike.flame.scale.set(1, 1, rand(0.7, 1.3));
  shieldBubble.visible = G.shield;
  shieldBubble.material.opacity = 0.18 + Math.sin(G.time * 6) * 0.06;
  bike.root.visible = G.invuln > 0 && G.boostTime <= 0 ? Math.floor(G.time * 12) % 2 === 0 : true;
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
  G.nitro = Math.min(100, G.nitro + (perfect ? 22 : 14));
  const label = c.type === 'police' ? '🚓 ' : '';
  popup(`${label}${perfect ? 'PERFECT! ' : 'NEAR MISS '}+${pts}`, perfect ? 'perfect' : '');
  if (G.combo >= 2 && G.combo % 5 === 0) popup(`🔥 COMBO x${G.combo}`, 'combo');
  sfx.near(perfect);
  vibrate(perfect ? 25 : 12);
}

function hitObstacle(o, isCone = false) {
  if (G.state !== 'playing') return;
  if (G.invuln > 0 && G.boostTime <= 0) return; // 무적(깜빡임) 중엔 통과
  if (G.boostTime > 0 || G.shield) {
    if (G.boostTime <= 0) {
      G.shield = false;
      G.invuln = 1.2;
      popup('🛡️ 실드 파괴!', 'power');
    } else if (!isCone) {
      G.smashed++;
      const pts = 300 * (G.x2Time > 0 ? 2 : 1);
      G.score += pts;
      popup(`💥 SMASH +${pts}`, 'combo');
    }
    knockAway(o, isCone);
    sfx.smash();
    vibrate(40);
    G.shake = 0.6;
    return;
  }
  crash(o);
}

function knockAway(o, isCone) {
  const side = o.x - G.x >= 0 ? 1 : -1;
  o.flying = true;
  o.vx = side * rand(5, 11);
  o.vy = isCone ? rand(7, 10) : rand(9, 14);
  if (!isCone) {
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
  const side = G.x - o.x >= 0 ? 1 : -1;
  G.cv = { vx: side * rand(3, 6), vy: 8, y: 0, rx: rand(-6, -3), rz: -side * rand(4, 8) };
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
  updateCones(dt, false);
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
const SCREENS = ['menu', 'garage', 'ranking', 'missions', 'settings', 'pause', 'gameover'];
function show(id) {
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
  btnNitro: $('btnNitro'), nitroFill: $('nitroFill'), boostFx: $('boostFx'),
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
  hud.boostFx.classList.toggle('on', boosting);
  hud.boostFx.classList.toggle('slow', !boosting && G.slowTime > 0);

  const tags = [];
  if (G.onc) tags.push('<span class="tag onc">⚠️ 역주행 x2</span>');
  if (G.shield) tags.push('<span class="tag">🛡️ 실드</span>');
  if (G.magnetTime > 0) tags.push(`<span class="tag">🧲 ${Math.ceil(G.magnetTime)}s</span>`);
  if (G.x2Time > 0) tags.push(`<span class="tag">✨ x2 ${Math.ceil(G.x2Time)}s</span>`);
  if (G.slowTime > 0) tags.push(`<span class="tag">⏳ ${Math.ceil(G.slowTime)}s</span>`);
  if (G.rain) tags.push('<span class="tag">🌧️ x1.3</span>');
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
  refreshMenu();
  show('menu');
}

function refreshMenu() {
  $('menuName').textContent = save.lastName || '라이더';
  $('menuBest').textContent = fmt(save.best);
  $('menuCoins').textContent = save.coins.toLocaleString();
}

$('btnPlay').addEventListener('click', startRun);
$('btnGarage').addEventListener('click', () => { sfx.init(); sfx.click(); renderGarage(); show('garage'); });
$('btnRanking').addEventListener('click', () => { sfx.init(); sfx.click(); renderRanking(); show('ranking'); });
$('btnMissions').addEventListener('click', () => { sfx.init(); sfx.click(); renderMissions(); show('missions'); });
$('btnSettings').addEventListener('click', () => { sfx.init(); sfx.click(); renderSettings(); show('settings'); });
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => { sfx.click(); refreshMenu(); show('menu'); });
}

// ---------- 차고
function renderGarage() {
  $('garageCoins').textContent = save.coins.toLocaleString();
  $('bikeList').innerHTML = BIKES.map((b) => {
    const owned = save.ownedBikes.includes(b.id);
    const sel = save.bike === b.id;
    const hex = '#' + b.color.toString(16).padStart(6, '0');
    let btn;
    if (sel) btn = '<button class="btn" disabled>사용 중</button>';
    else if (owned) btn = `<button class="btn primary" data-select="${b.id}">선택</button>`;
    else btn = `<button class="btn gold" data-buy="${b.id}" ${save.coins < b.price ? 'disabled' : ''}>🪙 ${b.price.toLocaleString()}</button>`;
    return `<div class="bike-card ${sel ? 'selected' : ''}">
      <div class="bike-icon" style="background:${hex}33;border:2px solid ${hex}">🏍️</div>
      <div><h4>${b.name}</h4><p>${b.desc} · 최고 ${b.maxKmh}km/h</p>
        <div class="stat">속도<i><b style="width:${(b.maxKmh / 300) * 100}%"></b></i></div>
        <div class="stat">핸들링<i><b style="width:${(b.handling / 1.6) * 100}%"></b></i></div>
        <div class="stat">가속<i><b style="width:${(b.accel / 1.6) * 100}%"></b></i></div>
      </div>${btn}</div>`;
  }).join('');
}

$('bikeList').addEventListener('click', (e) => {
  const sel = e.target.closest('[data-select]');
  const buy = e.target.closest('[data-buy]');
  if (sel) {
    save.bike = sel.dataset.select;
    sfx.click();
  } else if (buy) {
    const b = getBike(buy.dataset.buy);
    if (save.coins < b.price) return;
    save.coins -= b.price;
    save.ownedBikes.push(b.id);
    save.bike = b.id;
    sfx.power();
    toast(`🎉 ${b.name} 구매 완료!`);
  } else return;
  persist();
  buildBike();
  resetBikePose();
  renderGarage();
});

// ---------- 랭킹
function renderRanking() {
  if (!save.ranking.length) {
    $('rankList').innerHTML = '<div class="empty">아직 기록이 없습니다.<br>첫 번째 랭커가 되어보세요!</div>';
    return;
  }
  const medals = ['🥇', '🥈', '🥉'];
  $('rankList').innerHTML = `<table class="rank-table"><thead><tr><th>#</th><th>이름</th><th class="num">점수</th><th class="num">거리</th></tr></thead><tbody>${
    save.ranking.map((r, i) => `<tr class="${r.id === save.lastRankId ? 'me' : ''}">
      <td>${medals[i] ? `<span class="medal">${medals[i]}</span>` : i + 1}</td>
      <td>${escapeHtml(r.name)}<br><small class="muted">${escapeHtml(getBike(r.bike).name)} · ${escapeHtml(r.date || '')}</small></td>
      <td class="num"><b>${fmt(r.score)}</b></td>
      <td class="num">${(r.dist / 1000).toFixed(2)}km</td></tr>`).join('')
  }</tbody></table>`;
}

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
  touchMode: (v) => (v === 'zones' ? '좌/우 터치' : '드래그'),
};
function renderSettings() {
  for (const b of document.querySelectorAll('[data-setting]')) {
    b.textContent = SETTING_LABELS[b.dataset.setting](save.settings[b.dataset.setting]);
  }
}
function applyTouchMode() {
  document.body.classList.toggle('drag-mode', save.settings.touchMode === 'drag');
}
applyTouchMode();

for (const b of document.querySelectorAll('[data-setting]')) {
  b.addEventListener('click', () => {
    const k = b.dataset.setting;
    const s = save.settings;
    if (k === 'sound') { s.sound = !s.sound; sfx.setEnabled(s.sound); }
    if (k === 'vibrate') { s.vibrate = !s.vibrate; vibrate(30); }
    if (k === 'quality') { s.quality = s.quality === 'high' ? 'low' : 'high'; applyQuality(); }
    if (k === 'touchMode') { s.touchMode = s.touchMode === 'zones' ? 'drag' : 'zones'; applyTouchMode(); }
    sfx.click();
    persist();
    renderSettings();
  });
}
$('btnReset').addEventListener('click', () => {
  if (!confirm('코인, 바이크, 랭킹, 미션 등 모든 데이터를 초기화할까요?')) return;
  resetSave();
  sfx.setEnabled(save.settings.sound);
  applyQuality();
  applyTouchMode();
  buildBike();
  resetBikePose();
  renderSettings();
  toast('데이터가 초기화되었습니다');
});

// ---------- 일시정지
function togglePause() {
  if (G.state === 'playing') {
    G.state = 'paused';
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
    ['코인', '🪙' + G.coinsRun],
    ['역주행', Math.floor(G.oncomingDist) + 'm'],
  ];
  $('goStats').innerHTML = stats.map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('');
  $('goMissions').innerHTML = G.missionsDone.map((m) => `<div>✅ ${escapeHtml(missionText(m))} +🪙${m.reward}</div>`).join('');

  // 이미 등록한 기록이 있으면 (이어달리기 후) 점수 갱신
  if (G.rankEntry) {
    G.rankEntry.score = score;
    G.rankEntry.dist = Math.floor(G.distance);
    sortRanking();
    persist();
    const pos = save.ranking.indexOf(G.rankEntry) + 1;
    $('rankDone').textContent = `🏆 랭킹 ${pos}위로 기록이 갱신되었습니다!`;
  }
  const canRank = !G.rankEntry && qualifies(score);
  $('rankForm').classList.toggle('hidden', !canRank);
  $('rankDone').classList.toggle('hidden', !G.rankEntry);
  if (canRank) {
    $('rankPos').textContent = save.ranking.filter((r) => r.score >= score).length + 1;
    $('nameInput').value = save.lastName || '';
  }
  const cont = $('btnContinue');
  $('contCost').textContent = CONTINUE_COST;
  cont.classList.toggle('hidden', G.continued);
  cont.disabled = save.coins < CONTINUE_COST;
  show('gameover');
  persist();
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
  done.textContent = `🏆 ${name} 님, 랭킹 ${pos}위에 등록되었습니다!`;
  done.classList.remove('hidden');
  sfx.mission();
}
$('btnSubmitName').addEventListener('click', submitName);

function finalizeRun() {
  if (G.finalized || !('score' in G)) return;
  G.finalized = true;
  const score = Math.floor(G.score);
  if (!G.rankEntry && qualifies(score)) {
    G.rankEntry = rankRecord(save.lastName || 'PLAYER');
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
  if (G.continued || save.coins < CONTINUE_COST) return;
  save.coins -= CONTINUE_COST;
  persist();
  G.continued = true;
  // 주변 장애물 정리 후 부활
  for (let i = cars.length - 1; i >= 0; i--) if (cars[i].z > -50) releaseCar(cars[i]);
  for (const c of cones) if (c.z > -50) c.active = false;
  G.x = clamp(G.x, -ROAD_HALF, ROAD_HALF);
  G.vx = 0;
  G.lean = 0;
  G.speed = 22;
  G.invuln = 3;
  resetBikePose();
  hideScreens();
  $('hud').classList.remove('hidden');
  G.state = 'playing';
  sfx.init();
  sfx.engineStart();
  popup('🔥 이어달리기!', 'big');
});

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
  updateEnvironment(rdt);
  updateCamera(rdt);
  updateFx(rdt);
  renderer.render(scene, camera);
}

// ---------- 시작
if (new URLSearchParams(location.search).has('debug')) window.__G = G;
goMenu();
$('loading').remove();
const today = new Date().toDateString();
if (save.lastDaily !== today) {
  save.lastDaily = today;
  save.coins += 100;
  persist();
  refreshMenu();
  toast('🎁 오늘의 출석 보상 +🪙100');
}
requestAnimationFrame(frame);
