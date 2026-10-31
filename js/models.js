// 로우폴리 3D 모델(바이크, 자동차, 소품)과 캔버스 텍스처 생성
// + 외부 .glb/.gltf 모델을 불러와 교체하는 ModelManager (없으면 절차적 모델로 fallback)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_CONFIG } from './config.js';
import { icon as svgIcon } from './icons.js';
import { drawFlag, countryName, nationalLivery } from './themes.js';

// ======================================================================
// 외부 모델 관리자
// ======================================================================
const _box3 = new THREE.Box3();
const _v3 = new THREE.Vector3();

// 모델을 정면 -Z, 바닥 y=0, 중심 x/z=0 기준으로 정규화
function normalizeModel(scene, cfg) {
  const wrap = new THREE.Group();
  wrap.add(scene);
  if (cfg.rotateY) scene.rotation.y = cfg.rotateY;
  scene.updateMatrixWorld(true);
  _box3.setFromObject(scene);
  if (cfg.fit && cfg.size) {
    const axis = { length: 'z', height: 'y', width: 'x' }[cfg.fit] || 'z';
    const cur = _box3.getSize(_v3)[axis];
    if (cur > 0) scene.scale.multiplyScalar(cfg.size / cur);
    scene.updateMatrixWorld(true);
    _box3.setFromObject(scene);
  }
  const c = _box3.getCenter(_v3);
  scene.position.x -= c.x;
  scene.position.z -= c.z;
  scene.position.y += -_box3.min.y + (cfg.offsetY || 0);
  wrap.updateMatrixWorld(true);
  return wrap;
}

export class ModelManager {
  constructor(config = {}) {
    this.config = { ...config };
    this.models = new Map();
    this.listeners = [];
    this.loader = null;
  }

  // config 에 url 이 지정된 모든 모델을 비동기 로딩 (실패한 항목은 fallback 유지)
  loadAll() {
    const jobs = Object.entries(this.config)
      .filter(([, cfg]) => cfg && (typeof cfg === 'string' || cfg.url))
      .map(([key, cfg]) => this.load(key, cfg));
    return Promise.all(jobs);
  }

  // 런타임에 모델 등록/교체: models.register('car.sedan', { url: '...', fit: 'length', size: 4.4 })
  register(key, cfg) {
    this.config[key] = cfg;
    return this.load(key, cfg);
  }

  async load(key, cfg) {
    if (typeof cfg === 'string') cfg = { url: cfg };
    this.loader = this.loader || new GLTFLoader();
    try {
      const gltf = await this.loader.loadAsync(cfg.url);
      this.models.set(key, normalizeModel(gltf.scene, cfg));
      for (const fn of this.listeners) fn(key);
      return true;
    } catch (e) {
      console.warn(`[ModelManager] '${key}' 로딩 실패 → 기본 로우폴리 모델 사용`, e);
      return false;
    }
  }

  has(key) { return this.models.has(key); }

  // 씬에 배치할 복제본 (없으면 null → 호출측에서 절차적 모델 사용)
  instantiate(key) {
    const m = this.models.get(key);
    return m ? m.clone(true) : null;
  }

  // 인스턴싱용: 모델의 모든 메시를 하나의 지오메트리(그룹별 재질)로 합침
  instancedSource(key) {
    const m = this.models.get(key);
    if (!m) return null;
    const geoms = [], mats = [];
    m.traverse((o) => {
      if (!o.isMesh) return;
      let g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (g.index) g = g.toNonIndexed();
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
      }
      if (!g.attributes.normal) g.computeVertexNormals();
      geoms.push(g);
      mats.push(Array.isArray(o.material) ? o.material[0] : o.material);
    });
    if (!geoms.length) return null;
    if (!geoms.every((g) => g.attributes.uv)) geoms.forEach((g) => g.deleteAttribute('uv'));
    return { geometry: mergeGeometries(geoms, true), material: mats.length === 1 ? mats[0] : mats };
  }

  onLoad(fn) { this.listeners.push(fn); }
}

export const models = new ModelManager(MODEL_CONFIG);

// 외부 모델이 있으면 감싸서 반환, 없으면 절차적 생성 함수 결과 반환
export function modelOr(key, procedural) {
  const ext = models.instantiate(key);
  return ext || procedural();
}

// ---------- 공용 재질
export const vcMat = new THREE.MeshLambertMaterial({ vertexColors: true });
export const tailMat = new THREE.MeshLambertMaterial({ color: 0x400000, emissive: 0xff2020, emissiveIntensity: 0.6 });
export const headMat = new THREE.MeshLambertMaterial({ color: 0xfff8e0, emissive: 0xfff0c0, emissiveIntensity: 0.4 });
export const lampHeadMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee, emissive: 0xffd27a, emissiveIntensity: 0.1 });
export const coinMat = new THREE.MeshLambertMaterial({ color: 0xffc400, emissive: 0xffa000, emissiveIntensity: 0.5 });
export const shadowMat = new THREE.MeshBasicMaterial({ map: makeShadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 });
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

// ---------- 지오메트리 헬퍼
function paint(g, color) {
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

function box(w, h, d, x, y, z, color, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return color == null ? g : paint(g, color);
}

function cylX(r, len, x, y, z, color, seg = 12) {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return color == null ? g : paint(g, color);
}

function merge(list) {
  // Icosahedron 등 인덱스 없는 지오메트리가 섞이면 전부 비인덱스로 맞춰서 병합
  if (list.some((g) => !g.index)) list = list.map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(list, false);
}

function shadow(w, l) {
  const m = new THREE.Mesh(shadowGeo, shadowMat);
  m.scale.set(w, 1, l);
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

// ---------- 자동차
export const CAR_DEFS = {
  sedan:  { len: 4.4, w: 1.85, speed: [10, 17] },
  taxi:   { len: 4.4, w: 1.85, speed: [10, 16] },
  police: { len: 4.6, w: 1.9, speed: [13, 19] },
  suv:    { len: 4.8, w: 2.0, speed: [10, 16] },
  truck:  { len: 8.5, w: 2.4, speed: [8, 12] },
  bus:    { len: 11, w: 2.5, speed: [8, 11] },
  ramp:   { len: 9.5, w: 2.4, speed: [7, 10] }, // 경사판 견인트럭 (뒤에서 올라타면 점프)
  tuktuk: { len: 2.9, w: 1.45, speed: [7, 11] }, // 태국 툭툭
  scooter:{ len: 1.9, w: 0.75, speed: [9, 14] }, // 베트남 오토바이 물결
  jeepney:{ len: 5.6, w: 2.0, speed: [8, 12] },  // 필리핀 지프니
  doubledecker: { len: 11.5, w: 2.5, speed: [8, 11] }, // 싱가포르 2층 버스
  angkot: { len: 4.0, w: 1.7, speed: [9, 13] },   // 인도네시아 앙콧(합승 미니밴)
  songthaew: { len: 4.8, w: 1.9, speed: [9, 13] }, // 태국 송태우(픽업 합승)
  tricycle: { len: 2.2, w: 1.6, speed: [7, 10] },  // 필리핀 트라이시클
  remork: { len: 3.4, w: 1.6, speed: [7, 10] },    // 캄보디아 레모크(툭툭)
  trishaw: { len: 2.0, w: 1.4, speed: [4.5, 6.5] }, // 미얀마 트라이쇼(자전거 인력거)
};

const GLASS = 0x1b2735;
const RUBBER = 0x141414;
const TRIM = 0x2a2a2a;

// 박스 윗면만 좁혀 사다리꼴로 (경사진 앞유리·뒷유리)
function taperTop(g, sx, sz) {
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0) pos.setXYZ(i, pos.getX(i) * sx, pos.getY(i), pos.getZ(i) * sz);
  }
  pos.needsUpdate = true;
  return g;
}

function buildCar(type) {
  const d = CAR_DEFS[type];
  const L = d.len, W = d.w, hl = L / 2, hw = W / 2;
  const body = [], det = [], tail = [], head = [], bl = [], br = [];
  const big = type === 'truck' || type === 'bus' || type === 'doubledecker';
  const small = type === 'tuktuk' || type === 'scooter';
  const wr = big ? 0.5 : small ? 0.28 : 0.36;
  const wheelZ = type === 'bus' || type === 'doubledecker' ? [-hl + 2, hl - 2.2] : type === 'truck' ? [-hl + 1.2, hl - 1.4, hl - 2.6] : small ? [-hl + 0.4, hl - 0.45] : [-hl + 0.85, hl - 0.85];
  const ownWheels = type === 'scooter' || type === 'tricycle' || type === 'remork' || type === 'trishaw';
  if (!ownWheels) {
    for (const z of wheelZ) {
      for (const s of [-1, 1]) {
        if (type === 'tuktuk' && z < 0 && s > 0) continue; // 앞바퀴 1개
        const wx = type === 'tuktuk' && z < 0 ? 0 : s * (hw - 0.12);
        det.push(cylX(wr, 0.25, wx, wr, z, RUBBER, 14));
        det.push(cylX(wr * 0.5, 0.27, wx, wr, z, 0x9aa0a6, 10));
      }
    }
  }
  let lightY, sirenR = null, sirenB = null;

  if (type === 'scooter') {
    // 스쿠터 + 라이더 (차체 색 = 라이더 셔츠)
    for (const z of wheelZ) {
      const t = new THREE.TorusGeometry(0.26, 0.08, 6, 14);
      t.rotateY(Math.PI / 2);
      t.translate(0, 0.34, z);
      det.push(paint(t, RUBBER));
    }
    det.push(box(0.32, 0.34, 1.1, 0, 0.55, 0.05, 0xdedede));
    det.push(box(0.3, 0.1, 0.5, 0, 0.8, 0.25, 0x1a1a1a));
    body.push(box(0.38, 0.48, 0.26, 0, 1.12, 0.12, null, -0.4));
    det.push(new THREE.SphereGeometry(0.16, 10, 8).translate(0, 1.48, -0.02));
    paint(det[det.length - 1], [0xffd21f, 0xe63946, 0x2a9df4, 0xffffff][(Math.random() * 4) | 0]);
    for (const sx of [-1, 1]) det.push(box(0.1, 0.36, 0.12, sx * 0.17, 0.74, 0.08, 0x2b2b2b, 0.4));
    det.push(box(0.5, 0.04, 0.04, 0, 1.0, -0.55, 0x222222));
    lightY = 0.72;
  } else if (type === 'tuktuk') {
    body.push(box(W, 0.55, L * 0.62, 0, 0.6, hl - L * 0.31));
    body.push(box(0.7, 0.5, 0.8, 0, 0.62, -hl + 0.55));
    det.push(box(W + 0.08, 0.08, L * 0.95, 0, 1.92, 0.05, 0x16324f));
    det.push(box(W + 0.1, 0.12, L * 0.95, 0, 1.8, 0.05, 0xffd60a));
    for (const sx of [-1, 1]) for (const z of [-0.5, hl - 0.1]) det.push(box(0.05, 1.1, 0.05, sx * (hw - 0.05), 1.3, z, 0x333333));
    det.push(box(W * 0.8, 0.6, 0.05, 0, 1.35, -0.55, GLASS));
    det.push(box(W * 0.9, 0.35, 0.6, 0, 1.0, hl - 0.6, 0x7a1f2b));
    lightY = 0.72;
  } else if (type === 'jeepney') {
    // 필리핀 지프니: 크롬 보닛 + 긴 승객칸(옆 창 뚫림) + 화려한 줄무늬 + 지붕 랙 + 보닛 위 은빛 말 장식
    body.push(box(W, 0.9, 1.6, 0, 0.75, -hl + 0.8));
    det.push(box(W * 0.92, 0.12, 1.5, 0, 1.24, -hl + 0.8, 0xd9dde1));
    det.push(box(W * 0.7, 0.5, 0.05, 0, 0.85, -hl - 0.02, 0xd9dde1));
    for (let k = 0; k < 5; k++) det.push(box(0.04, 0.45, 0.06, -W * 0.28 + k * W * 0.14, 0.85, -hl - 0.05, 0x8a8f96));
    det.push(box(W * 0.9, 0.55, 0.06, 0, 1.6, -hl + 1.62, GLASS));
    body.push(box(W, 1.0, L - 1.6, 0, 0.95, 0.8));
    det.push(box(W + 0.02, 0.65, L - 1.8, 0, 1.78, 0.85, 0x1b1d22));
    for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) det.push(box(0.06, 0.66, 0.1, sx * (hw + 0.01), 1.78, -hl + 1.75 + k * ((L - 1.9) / 6), 0xd9dde1));
    det.push(box(W + 0.12, 0.12, L - 1.4, 0, 2.15, 0.8, 0xd9dde1));
    for (let k = 0; k < 4; k++) det.push(box(W * 0.9, 0.08, 0.05, 0, 2.3, -hl + 2.2 + k * 1.0, 0x555555));
    for (const sx of [-1, 1]) {
      for (const [y, c] of [[0.6, 0xffd60a], [0.75, 0xe63946], [0.9, 0x2a9df4], [1.25, 0x2ec27e]]) det.push(box(0.03, 0.08, L - 1.8, sx * (hw + 0.015), y, 0.8, c));
      det.push(box(0.08, 0.3, 0.08, sx * (hw + 0.2), 1.45, -hl + 1.5, 0xd9dde1));
    }
    for (const sx of [-1, 1]) { const horse = new THREE.ConeGeometry(0.08, 0.35, 4); horse.rotateX(-0.6); horse.translate(sx * 0.3, 1.45, -hl + 0.4); det.push(paint(horse, 0xe9ecef)); }
    det.push(box(0.6, 0.2, 0.04, 0, 1.9, -hl + 1.6, 0xffd60a));
    det.push(box(W * 0.8, 0.12, 0.05, 0, 2.05, hl + 0.01, 0xe63946));
    lightY = 0.8;
  } else if (type === 'doubledecker') {
    // 싱가포르 2층 버스: 높은 차체 + 위·아래 창 띠 + 앞 2층 창 + 행선지 LED
    body.push(box(W, 3.9, L, 0, 2.3, 0));
    det.push(box(W + 0.03, 0.8, L * 0.9, 0, 1.95, 0.3, GLASS));
    det.push(box(W + 0.03, 0.85, L * 0.95, 0, 3.45, 0, GLASS));
    det.push(box(W * 0.9, 1.0, 0.05, 0, 1.9, -hl - 0.02, GLASS));
    det.push(box(W * 0.92, 0.85, 0.05, 0, 3.45, -hl - 0.02, GLASS));
    det.push(box(W + 0.03, 0.22, L + 0.03, 0, 0.55, 0, TRIM));
    for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) for (const y of [1.95, 3.45]) det.push(box(0.05, 0.82, 0.1, sx * (hw + 0.03), y, -hl + 1.6 + k * 1.35, 0x2b2b2b));
    det.push(box(0.05, 1.6, 1.0, hw + 0.03, 1.25, -hl + 0.9, 0x1f2b38));
    det.push(box(W * 0.7, 0.22, 0.05, 0, 2.75, -hl - 0.03, 0x101010));
    head.push(box(W * 0.5, 0.1, 0.03, 0, 2.75, -hl - 0.06));
    for (const sx of [-1, 1]) det.push(box(0.04, 0.12, L * 0.86, sx * (hw + 0.02), 2.7, 0, 0xffffff));
    det.push(box(W, 0.06, L, 0, 4.27, 0, 0xd9dde1));
    lightY = 0.85;
  } else if (type === 'angkot') {
    // 인도네시아 앙콧(미니밴 합승): 짧은 보닛 + 박스형 차체 + 옆 창 + 미닫이문 + 색 띠
    body.push(box(W, 1.25, L * 0.78, 0, 1.05, hl - L * 0.39));
    body.push(box(W, 0.65, L * 0.24, 0, 0.75, -hl + L * 0.12));
    det.push(paint(taperTop(new THREE.BoxGeometry(W * 0.94, 0.5, 0.5), 0.95, 0.4).translate(0, 1.32, -hl + L * 0.25), GLASS));
    for (const sx of [-1, 1]) {
      det.push(box(0.03, 0.45, L * 0.6, sx * (hw + 0.012), 1.35, 0.25, GLASS));
      det.push(box(0.03, 0.12, L * 0.78, sx * (hw + 0.015), 0.85, hl - L * 0.39, 0xffffff));
      det.push(box(0.02, 0.85, 0.03, sx * (hw + 0.012), 1.0, -0.15, 0x1b1d22));
    }
    det.push(box(W + 0.04, 0.18, 0.2, 0, 0.42, -hl, TRIM));
    det.push(box(W * 0.95, 0.06, L * 0.7, 0, 1.71, 0.3, 0x555b62));
    lightY = 0.7;
  } else if (type === 'songthaew') {
    // 태국 송태우: 픽업 캡 + 지붕 덮인 짐칸(양옆 벤치) + 뒤 손잡이
    body.push(box(W, 1.0, 1.5, 0, 0.95, -hl + 0.75));
    body.push(box(W * 0.94, 0.55, 1.1, 0, 1.72, -hl + 0.85));
    det.push(box(W * 0.85, 0.45, 0.05, 0, 1.7, -hl + 0.28, GLASS));
    det.push(box(W, 0.4, L - 1.5, 0, 0.65, hl - (L - 1.5) / 2, 0x3a3d42));
    for (const sx of [-1, 1]) {
      body.push(box(0.06, 0.45, L - 1.6, sx * (hw - 0.03), 1.07, hl - (L - 1.6) / 2));
      for (let k = 0; k < 3; k++) det.push(box(0.05, 0.85, 0.05, sx * (hw - 0.03), 1.72, -hl + 1.6 + k * ((L - 1.7) / 2), 0xc9ced3));
      det.push(box(0.35, 0.08, L - 1.8, sx * (hw - 0.3), 1.0, hl - (L - 1.8) / 2 - 0.05, 0x7a4a22));
    }
    body.push(box(W + 0.1, 0.08, L - 1.4, 0, 2.17, hl - (L - 1.4) / 2));
    det.push(box(0.05, 0.6, 0.05, 0, 1.5, hl - 0.02, 0xc9ced3));
    lightY = 0.75;
  } else if (type === 'tricycle' || type === 'remork' || type === 'trishaw') {
    // 필리핀 트라이시클(오토바이 + 지붕 달린 사이드카) / 캄보디아 레모크(오토바이 + 뒤 객차) / 미얀마 트라이쇼(자전거 + 옆 좌석)
    const wheel = (x, z, r, w = 0.1) => { det.push(cylX(r, w, x, r, z, RUBBER, 12)); det.push(cylX(r * 0.45, w + 0.02, x, r, z, 0x9aa0a6, 8)); };
    const rider = (x, z, shirt) => {
      det.push(box(0.3, 0.45, 0.25, x, 1.15, z, shirt, -0.3));
      det.push(paint(new THREE.SphereGeometry(0.14, 8, 6).translate(x, 1.5, z - 0.05), 0xf1c8a0));
      det.push(paint(new THREE.SphereGeometry(0.15, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, 1.54, z - 0.05), type === 'trishaw' ? 0x2b2b2b : 0xe63946));
      for (const sx of [-1, 1]) det.push(box(0.09, 0.4, 0.1, x + sx * 0.1, 0.78, z - 0.1, 0x2b2b2b, 0.4));
    };
    if (type === 'tricycle') {
      const mx = hw - 0.25;
      wheel(mx, -hl + 0.35, 0.28); wheel(mx, hl - 0.4, 0.28); wheel(-hw + 0.2, 0.15, 0.24);
      det.push(box(0.25, 0.3, 1.2, mx, 0.6, 0, 0x2b2f33));
      rider(mx, 0.05, 0xffd60a);
      body.push(box(0.9, 0.7, 1.3, -0.25, 0.75, 0.1));
      det.push(box(0.85, 0.06, 1.25, -0.25, 1.12, 0.1, 0x3a2a1a));
      for (const [px, pz] of [[-0.68, -0.5], [0.18, -0.5], [-0.68, 0.7], [0.18, 0.7]]) det.push(box(0.04, 0.85, 0.04, px, 1.5, pz, 0xc9ced3));
      body.push(box(1.0, 0.08, 1.4, -0.25, 1.95, 0.1));
      det.push(box(0.75, 0.35, 0.03, -0.25, 1.6, -0.52, GLASS));
      det.push(box(0.05, 0.12, 1.3, -0.72, 1.85, 0.1, 0xce1126));
      det.push(box(0.05, 0.12, 1.3, -0.72, 1.73, 0.1, 0x0038a8));
    } else if (type === 'remork') {
      wheel(0, -hl + 0.3, 0.27); wheel(0, -hl + 1.25, 0.27);
      det.push(box(0.25, 0.3, 1.1, 0, 0.6, -hl + 0.78, 0x2b2f33));
      rider(0, -hl + 0.9, 0x2a9d8f);
      det.push(box(0.06, 0.06, 0.7, 0, 0.6, -hl + 1.7, 0x555b62));
      for (const sx of [-1, 1]) wheel(sx * (hw - 0.1), hl - 0.55, 0.28, 0.08);
      det.push(box(W - 0.1, 0.08, 1.7, 0, 0.62, hl - 0.85, 0x5a3e2b));
      for (const sx of [-1, 1]) det.push(box(0.4, 0.4, 1.5, sx * 0.45, 0.85, hl - 0.85, 0x7a1f2b));
      for (const [px, pz] of [[-1, -1.65], [1, -1.65], [-1, -0.05], [1, -0.05]]) det.push(box(0.04, 1.2, 0.04, px * (hw - 0.08), 1.25, hl + pz + 0.02, 0xc9ced3));
      body.push(box(W, 0.08, 1.8, 0, 1.88, hl - 0.85));
      for (const sx of [-1, 1]) det.push(box(0.03, 0.18, 1.8, sx * (hw + 0.01), 1.8, hl - 0.85, 0xe8b923));
    } else {
      wheel(hw - 0.2, -hl + 0.35, 0.33, 0.05); wheel(hw - 0.2, hl - 0.35, 0.33, 0.05); wheel(-hw + 0.15, 0.1, 0.25, 0.06);
      det.push(box(0.05, 0.05, L - 0.7, hw - 0.2, 0.55, 0, 0x555b62));
      rider(hw - 0.2, 0.25, 0xffffff);
      body.push(box(0.7, 0.4, 0.8, -0.2, 0.6, 0.05));
      det.push(box(0.7, 0.4, 0.08, -0.2, 0.95, 0.42, 0x7a4a22));
      det.push(box(0.65, 0.06, 0.7, -0.2, 0.82, 0.05, 0x1d3557));
    }
    lightY = 0.75;
  } else if (type === 'ramp') {
    // 앞 캡 + 평판 적재함 + 후면 경사판 (뒤쪽 +Z 가 땅에 닿음)
    body.push(box(W, 1.3, 2.3, 0, 1.25, -hl + 1.15));
    body.push(box(W * 0.96, 0.9, 1.9, 0, 2.3, -hl + 1.25));
    det.push(box(W * 0.9, 0.6, 0.05, 0, 2.35, -hl + 0.28, GLASS));
    det.push(box(W, 0.3, L - 1.2, 0, 0.6, -0.6, 0x333333));
    const bedLen = L - 2.6 - 2.6;
    det.push(box(W, 0.15, bedLen, 0, 1.12, -hl + 2.4 + bedLen / 2, 0x8d939a));
    det.push(box(0.1, 0.35, bedLen, -hw + 0.05, 1.3, -hl + 2.4 + bedLen / 2, 0xffc400));
    det.push(box(0.1, 0.35, bedLen, hw - 0.05, 1.3, -hl + 2.4 + bedLen / 2, 0xffc400));
    const rampLen = 2.9, ang = Math.atan2(1.15, 2.7);
    const rz = hl - 1.35;
    det.push(box(W * 0.86, 0.1, rampLen, 0, 0.6, rz, 0xffc400, ang));
    for (let i = 0; i < 4; i++) {
      const t = (i + 0.5) / 4 - 0.5;
      det.push(box(W * 0.87, 0.11, 0.22, 0, 0.6 - Math.sin(ang) * t * rampLen + 0.01, rz + Math.cos(ang) * t * rampLen, 0x1a1a1a, ang));
    }
    det.push(box(1.2, 0.14, 0.3, 0, 2.82, -hl + 1.25, 0xff8800));
    lightY = 0.95;
  } else if (type === 'truck') {
    body.push(box(W, 1.3, 2.3, 0, 1.25, -hl + 1.15));
    body.push(box(W * 0.96, 0.9, 1.9, 0, 2.3, -hl + 1.25));
    det.push(box(W * 0.9, 0.6, 0.05, 0, 2.35, -hl + 0.28, GLASS));
    det.push(box(W + 0.04, 2.7, L - 2.6, 0, 2.1, -hl + 2.4 + (L - 2.6) / 2, 0xe9e9e9));
    det.push(box(W + 0.08, 0.12, L - 2.6, 0, 3.0, -hl + 2.4 + (L - 2.6) / 2, 0xff6b00));
    // 컨테이너 세로 리브 + 뒷문 + 옆 거울
    for (let z = -hl + 2.7; z < hl - 0.2; z += 0.9) for (const sx of [-1, 1]) det.push(box(0.04, 2.6, 0.08, sx * (hw + 0.04), 2.1, z, 0xc9ced3));
    det.push(box(0.04, 2.5, 0.04, 0, 2.1, hl + 0.03, 0x9aa0a6));
    for (const sx of [-1, 1]) det.push(box(0.1, 0.3, 0.06, sx * (hw + 0.12), 2.2, -hl + 0.5, 0x222222));
    det.push(box(W, 0.3, L, 0, 0.6, 0, 0x333333));
    lightY = 0.95;
  } else if (type === 'bus') {
    body.push(box(W, 2.6, L, 0, 1.75, 0));
    det.push(box(W + 0.03, 0.85, L * 0.9, 0, 2.2, 0.3, GLASS));
    det.push(box(W * 0.9, 1.1, 0.05, 0, 2.0, -hl - 0.02, GLASS));
    det.push(box(W + 0.03, 0.22, L + 0.03, 0, 0.6, 0, TRIM));
    // 창틀(기둥) + 앞문 + 행선지 LED + 옆 줄무늬
    for (let k = 0; k < 7; k++) for (const sx of [-1, 1]) det.push(box(0.05, 0.86, 0.1, sx * (hw + 0.03), 2.2, -hl + 1.6 + k * 1.35, 0x2b2b2b));
    det.push(box(0.05, 1.7, 1.0, hw + 0.03, 1.35, -hl + 0.9, 0x1f2b38));
    det.push(box(W * 0.7, 0.25, 0.05, 0, 2.85, -hl - 0.03, 0x101010));
    head.push(box(W * 0.5, 0.12, 0.03, 0, 2.85, -hl - 0.06));
    for (const sx of [-1, 1]) det.push(box(0.04, 0.14, L * 0.86, sx * (hw + 0.02), 1.15, 0, 0xffffff));
    lightY = 0.9;
  } else {
    const suv = type === 'suv';
    const bh = suv ? 0.8 : 0.62, by = 0.3;
    body.push(box(W, bh, L, 0, by + bh / 2, 0));
    // 보닛·트렁크 위 살짝 경사진 숄더 라인
    body.push(taperTop(new THREE.BoxGeometry(W * 0.98, 0.08, L * 0.98), 0.96, 0.94).translate(0, by + bh + 0.04, 0));
    const ch = suv ? 0.62 : 0.52, cl = suv ? L * 0.62 : L * 0.52, cz = suv ? 0.3 : 0.25;
    // 사다리꼴 캐빈(경사 앞·뒷유리) + 같은 모양으로 좁힌 차체색 지붕
    const tz = suv ? 0.86 : 0.7;
    det.push(paint(taperTop(new THREE.BoxGeometry(W * 0.86, ch, cl), 0.9, tz).translate(0, by + bh + 0.08 + ch / 2, cz), GLASS));
    body.push(box(W * 0.8, 0.08, cl * tz * 0.98, 0, by + bh + 0.08 + ch + 0.04, cz));
    // B필러 (차체색) + 사이드미러
    for (const sx of [-1, 1]) {
      body.push(box(0.06, ch * 0.92, 0.12, sx * W * 0.405, by + bh + 0.08 + ch / 2, cz, null));
      body.push(box(0.16, 0.1, 0.08, sx * (hw + 0.06), by + bh + 0.12, cz - cl / 2 + 0.05));
    }
    // 범퍼, 그릴, 번호판, 문 틈, 사이드 스커트
    det.push(box(W + 0.04, 0.2, 0.22, 0, by + 0.12, -hl, TRIM));
    det.push(box(W + 0.04, 0.2, 0.22, 0, by + 0.12, hl, TRIM));
    det.push(box(W * 0.45, 0.16, 0.03, 0, by + bh * 0.55, -hl - 0.02, 0x16181c));
    det.push(box(0.46, 0.13, 0.03, 0, by + 0.28, -hl - 0.13, 0xf4f4f4));
    det.push(box(0.46, 0.13, 0.03, 0, by + 0.28, hl + 0.13, type === 'taxi' ? 0xffd60a : 0xf4f4f4));
    for (const sx of [-1, 1]) {
      for (const dz of [cz - cl * 0.05, cz + cl * 0.42]) det.push(box(0.02, bh * 0.7, 0.025, sx * (hw + 0.012), by + bh * 0.5, dz, 0x1b1d22));
      det.push(box(0.03, 0.08, L * 0.62, sx * (hw + 0.015), by + 0.06, 0, 0x1b1d22));
    }
    lightY = by + bh - 0.17;
    const roofY = by + bh + 0.08 + ch + 0.08;
    if (type === 'taxi') {
      det.push(box(0.62, 0.24, 0.3, 0, roofY + 0.12, cz, 0xfff3b0));
      det.push(box(0.64, 0.06, 0.32, 0, roofY + 0.27, cz, 0x111111));
      // 체크무늬 띠
      for (let k = 0; k < 10; k++) for (const sx of [-1, 1]) det.push(box(0.02, 0.09, L * 0.07, sx * (hw + 0.012), by + bh * 0.5 + (k % 2) * 0.09, -L * 0.35 + k * L * 0.07, 0x111111));
    }
    if (type === 'police') {
      det.push(box(W + 0.01, 0.16, L * 0.8, 0, by + bh * 0.5, 0, 0x1e4fd8));
      det.push(box(1.1, 0.06, 0.3, 0, roofY + 0.03, cz, 0x111111));
      sirenR = box(0.45, 0.16, 0.26, -0.27, roofY + 0.14, cz);
      sirenB = box(0.45, 0.16, 0.26, 0.27, roofY + 0.14, cz);
    }
  }

  if (type === 'tricycle' || type === 'remork' || type === 'trishaw') {
    // 삼륜·인력거: 오토바이(자전거) 앞에 헤드램프 1개, 차체 뒤에 후미등 1개, 깜빡이는 차체 모서리에 붙임
    // [앞등 x, z, y], [뒷등 x, z, y]: 각각 오토바이 앞끝 / 사이드카·객차 뒤끝에 붙임
    const [hx, hz, hy] = type === 'tricycle' ? [hw - 0.25, -0.62, 0.72] : type === 'remork' ? [0, -hl + 0.2, 0.72] : [hw - 0.2, -hl + 0.32, 0.95];
    const [tx, tz, ty] = type === 'tricycle' ? [-0.25, 0.77, 0.75] : type === 'remork' ? [0, hl - 0.02, 0.62] : [-0.2, 0.47, 0.6];
    head.push(box(0.12, 0.1, 0.04, hx, hy, hz));
    tail.push(box(0.22, 0.07, 0.03, tx, ty, tz));
    bl.push(box(0.05, 0.05, 0.04, hx - 0.1, hy, hz), box(0.05, 0.05, 0.03, tx - 0.15, ty, tz));
    br.push(box(0.05, 0.05, 0.04, hx + 0.1, hy, hz), box(0.05, 0.05, 0.03, tx + 0.15, ty, tz));
  } else {
    for (const s of [-1, 1]) {
      tail.push(box(0.36, 0.18, 0.05, s * (hw - 0.3), lightY, hl + 0.02));
      head.push(box(0.36, 0.16, 0.05, s * (hw - 0.3), lightY, -hl - 0.02));
    }
    for (const z of [hl + 0.03, -hl - 0.03]) {
      bl.push(box(0.12, 0.12, 0.05, -hw + 0.06, lightY, z));
      br.push(box(0.12, 0.12, 0.05, hw - 0.06, lightY, z));
    }
  }

  return {
    body: merge(body), detail: merge(det), tail: merge(tail), head: merge(head),
    bl: merge(bl), br: merge(br), sirenR, sirenB,
  };
}

const carCache = {};

export function createCar(type) {
  const d = CAR_DEFS[type];
  const ext = models.instantiate('car.' + type);
  if (ext) {
    // 외부 모델: 색상/깜빡이는 더미 재질로 받아서 무시
    const group = new THREE.Group();
    group.add(ext, shadow(d.w * 1.35, d.len * 1.15));
    const dummyMat = () => new THREE.MeshLambertMaterial();
    return { group, bodyMat: dummyMat(), blinkMatL: dummyMat(), blinkMatR: dummyMat(), sirenR: null, sirenB: null, type, len: d.len, w: d.w, active: false, external: true };
  }
  const g = carCache[type] || (carCache[type] = buildCar(type));
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const blinkMatL = new THREE.MeshLambertMaterial({ color: 0x553300, emissive: 0xffaa00, emissiveIntensity: 0 });
  const blinkMatR = blinkMatL.clone();
  group.add(
    new THREE.Mesh(g.body, bodyMat),
    new THREE.Mesh(g.detail, vcMat),
    new THREE.Mesh(g.tail, tailMat),
    new THREE.Mesh(g.head, headMat),
    new THREE.Mesh(g.bl, blinkMatL),
    new THREE.Mesh(g.br, blinkMatR),
    shadow(d.w * 1.35, d.len * 1.15),
  );
  let sirenR = null, sirenB = null;
  if (g.sirenR) {
    sirenR = new THREE.Mesh(g.sirenR, new THREE.MeshLambertMaterial({ color: 0x550000, emissive: 0xff1020, emissiveIntensity: 0 }));
    sirenB = new THREE.Mesh(g.sirenB, new THREE.MeshLambertMaterial({ color: 0x000055, emissive: 0x2050ff, emissiveIntensity: 0 }));
    group.add(sirenR, sirenB);
  }
  return { group, bodyMat, blinkMatL, blinkMatR, sirenR, sirenB, type, len: d.len, w: d.w, active: false };
}

// ---------- 바이크 + 라이더
export const BOX_STYLES = {
  basic:     { base: 0x00b14f, band: 0xffffff, lid: 0x00873c },
  neon:      { base: 0x161a2e, band: 0x00f0ff, lid: 0xff2fd6, glow: true },
  styrofoam: { base: 0xf4f4ee, band: 0x2f7fe0, lid: 0xe2e2da },
  treasure:  { base: 0x7a4a22, band: 0xf5c518, lid: 0x5c3517, lock: true },
  pizza:     { base: 0xf1e3c8, band: 0xe63946, lid: 0xe63946, stack: true },
  camo:      { base: 0x5b6b3a, band: 0x3b4422, lid: 0x2f3a1c, camo: true },
  goldbox:   { base: 0xe6b422, band: 0xfff3b0, lid: 0xc99a10, glow: true, lock: true },
  vintage:   { base: 0x9c6b3c, band: 0x5a3e2b, lid: 0x7a5230, planks: true },
  anime:     { base: 0xffc2e2, band: 0x8e7cff, lid: 0xff6fae, anime: true },
  cyber:     { base: 0x0b0f1e, band: 0x39ff88, lid: 0x00e5ff, glow: true, grid: true },
  national:  { base: 0x24262d, band: 0x101114, lid: 0x24262d, national: true }, // 면은 createBike 에서 국기 텍스처로 감쌈
};
export const OUTFIT_STYLES = {
  jacket:     { top: 0x00b14f, trim: 0xffffff, pants: 0x23272b },
  raincoat:   { top: 0xffd21f, trim: 0xf2f2f2, pants: 0xffd21f, poncho: true },
  raincoat_p: { top: 0xff6fae, trim: 0xffffff, pants: 0xff6fae, poncho: true },
  hivis:      { top: 0xff8c00, trim: 0xd9ff00, pants: 0x23272b, reflect: true },
  leather:    { top: 0x1b1b1f, trim: 0xb8bec6, pants: 0x1b1b1f },
  racing:     { top: 0xd62828, trim: 0xffffff, pants: 0xd62828, hump: true },
  tux:        { top: 0x2b2d42, trim: 0xffffff, pants: 0x111111, bow: true },
};
export const HELMET_STYLES = {
  basic:  { shell: 0x00b14f, visor: 0x0d3b24 },
  full:   { shell: 0x15171a, visor: 0x2f6db5, full: true, stripe: 0x3a3d42 },
  retro:  { shell: 0xf3efe6, visor: 0x7a4a22, stripe: 0xe63946, goggles: true },
  gold:   { shell: 0xe6b422, visor: 0x2a1f00, full: true, shine: true },
  neko:   { shell: 0xffb3c7, visor: 0x3a2a4a, full: true, ears: true },
  carbon: { shell: 0x2e3135, visor: 0x8a2be2, full: true, stripe: 0x55595e },
  chrome: { shell: 0xd5dade, visor: 0x101418, full: true, shine: true },
  crown:  { shell: 0xffd700, visor: 0x2a1f00, full: true, crown: true, shine: true },
  // 헬멧이 아닌 헤드기어 (kind 로 모양 구분)
  snapback:  { kind: 'cap', shell: 0x16181d, brim: 0x00b14f },
  straw:     { kind: 'straw', shell: 0xe9c46a, band: 0xc1121f },
  dino:      { kind: 'dino', shell: 0x52b788 },
  chibi:     { kind: 'chibi', shell: 0xffe0bd },
  cyberneon: { kind: 'cyber', shell: 0x14141c, visor: 0x00e5ff, neon: 0xff2fd6 },
};

// 메탈릭 반사용 환경맵: 하늘 → 밝은 수평선 → 어두운 지면 + 소프트박스 하이라이트 (등장방형)
let _envTex = null;
function envTexture() {
  if (_envTex) return _envTex;
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#6fa8dc');
  g.addColorStop(0.42, '#e8f3ff');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(0.56, '#a9b1bb');
  g.addColorStop(1, '#4a525e');
  x.fillStyle = g;
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = 'rgba(255,255,255,0.95)';
  for (const [px, py, w, h] of [[40, 40, 120, 26], [300, 30, 80, 40], [200, 90, 160, 12], [430, 70, 60, 20]]) x.fillRect(px, py, w, h);
  _envTex = new THREE.CanvasTexture(c);
  _envTex.mapping = THREE.EquirectangularReflectionMapping;
  _envTex.colorSpace = THREE.SRGBColorSpace;
  return _envTex;
}

// 페인트 마감: solid(무광 단색) / metallic(금속 반사 + 하이라이트) / neon(완전 발광 + 후광)
// 정점 색 + 광택 / 금속 반사 (헬멧·배달통 공용, 한 번만 생성)
let _glossMat = null, _metalMat = null;
function glossMat() {
  if (!_glossMat) _glossMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0.1, envMap: envTexture(), envMapIntensity: 0.9 });
  return _glossMat;
}
function facetMat() {
  if (!_facetMat) _facetMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.38, metalness: 0.35, envMap: envTexture(), envMapIntensity: 1.0 });
  return _facetMat;
}
let _facetMat = null;
function metalMat() {
  if (!_metalMat) _metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.85, envMap: envTexture(), envMapIntensity: 1.8 });
  return _metalMat;
}

export function paintMaterial(hex, finish) {
  if (finish === 'metallic') {
    return new THREE.MeshStandardMaterial({ color: hex, metalness: 0.85, roughness: 0.18, envMap: envTexture(), envMapIntensity: 2.0 });
  }
  if (finish === 'neon') return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(1.15) });
  return new THREE.MeshLambertMaterial({ color: hex });
}

// 네온 후광: 같은 모양을 살짝 키운 뒷면 반투명 가산 블렌딩 껍데기
function neonHalo(geo, hex, center, scale = 1.12) {
  const g = geo.clone();
  g.translate(-center.x, -center.y, -center.z);
  g.scale(scale, scale, scale);
  g.translate(center.x, center.y, center.z);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({
    color: hex, transparent: true, opacity: 0.35, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
}

// 국가대표 배달통 면 텍스처: 국기를 면에 꽉 차게(가운데 기준 잘라 맞춤) + 은은한 광택 + 비네팅

// ---------- 라이더 몸 (캡슐 관절 모델)
// 좌표: 앞 = -z. 핸들 그립 (±0.3, 1.08, -0.48), 시트 (0, 1.0, 0.22)
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = new THREE.Vector3(0, 1, 0);
// a → b 를 잇는 캡슐 (팔·다리·몸통). sx/sz 로 단면을 납작하게
function limb(a, b, r, color, list, sx = 1, sz = 1) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length() - r * 2 * 0.15);
  const g = new THREE.CapsuleGeometry(r, len, 4, 10);
  g.scale(sx, 1, sz);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  const m = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  list.push(paint(g, color));
}
function ball(c, r, color, list, sx = 1, sy = 1, sz = 1) {
  const g = new THREE.SphereGeometry(r, 12, 10);
  g.scale(sx, sy, sz);
  g.translate(c.x, c.y, c.z);
  list.push(paint(g, color));
}
const SKIN = 0xf1c8a0, GLOVE = 0x1c1f24, BOOT = 0x2a2a2e, SOLE = 0x111111;

function rider(det, glow, out) {
  const J = out.top, P = out.pants, T = out.trim;
  const hip = V(0, 1.13, 0.16), chest = V(0, 1.4, -0.04), neck0 = V(0, 1.47, -0.08), neck1 = V(0, 1.53, -0.15);
  // 몸통: 골반(바지) + 허리 + 넓은 가슴(재킷) + 어깨
  ball(V(0, 1.1, 0.17), 0.13, P, det, 1.2, 0.7, 1);
  limb(V(0, 1.16, 0.13), chest, 0.13, J, det, 1.25, 0.85);
  ball(V(0, 1.4, -0.03), 0.15, J, det, 1.3, 0.85, 0.9);
  ball(V(0, 1.15, 0.12), 0.135, T, det, 1.22, 0.22, 0.9); // 허리 밴드 (트림 색)
  // 등 로고 패치 (배달 라이더)
  { const g = new THREE.BoxGeometry(0.2, 0.13, 0.02); g.rotateX(-0.78); g.translate(0, 1.33, 0.1); det.push(paint(g, T)); }
  // 목 + 칼라
  limb(neck0, neck1, 0.05, SKIN, det);
  { const c = new THREE.TorusGeometry(0.075, 0.025, 6, 14); c.rotateX(Math.PI / 2 - 0.6); c.translate(0, 1.47, -0.08); det.push(paint(c, T)); }
  for (const s of [-1, 1]) {
    const sh = V(s * 0.19, 1.43, -0.04), el = V(s * 0.25, 1.25, -0.27), wr = V(s * 0.29, 1.1, -0.45), hand = V(s * 0.3, 1.08, -0.49);
    ball(sh, 0.085, J, det);                 // 어깨
    limb(sh, el, 0.07, J, det);              // 위팔
    limb(el, wr, 0.06, J, det);              // 아래팔
    ball(wr, 0.064, T, det, 1, 0.55, 1);     // 소매 끝 (트림)
    ball(hand, 0.052, GLOVE, det, 1, 0.9, 1.2); // 장갑
    const hp = V(s * 0.1, 1.1, 0.14), kn = V(s * 0.17, 1.09, -0.2), an = V(s * 0.16, 0.74, -0.08);
    limb(hp, kn, 0.088, P, det);             // 허벅지
    ball(kn, 0.08, P, det);                  // 무릎
    limb(kn, an, 0.07, P, det);              // 정강이
    // 부츠 + 밑창
    det.push(box(0.11, 0.12, 0.22, s * 0.16, 0.68, -0.13, BOOT));
    det.push(box(0.12, 0.03, 0.24, s * 0.16, 0.61, -0.13, SOLE));
  }
  if (out.poncho) {
    // 우비: 어깨에서 퍼지는 판초 + 후드
    const pon = new THREE.CylinderGeometry(0.17, 0.33, 0.5, 12, 1, true);
    pon.rotateX(-0.6);
    pon.translate(0, 1.3, 0.03);
    det.push(paint(pon, J));
    { const hood = new THREE.SphereGeometry(0.13, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2); hood.rotateX(0.9); hood.translate(0, 1.5, 0.02); det.push(paint(hood, J)); }
  }
  if (out.reflect) {
    // 반사 띠: 가슴·허리를 두르는 형광 링
    for (const [y, z] of [[1.37, -0.02], [1.2, 0.08]]) {
      const g = new THREE.TorusGeometry(0.15, 0.018, 4, 18);
      g.scale(1.3, 1, 0.95);
      g.rotateX(Math.PI / 2 - 0.65);
      g.translate(0, y, z);
      glow.push(paint(g, 0xe6ff5c));
    }
  }
  if (out.hump) ball(V(0, 1.47, 0.07), 0.08, 0xffffff, det, 1.1, 0.8, 1.2); // 레이싱 험프
  if (out.bow) {
    for (const s of [-1, 1]) { const g = new THREE.ConeGeometry(0.03, 0.06, 4); g.rotateZ(s * Math.PI / 2); g.translate(s * 0.03, 1.45, -0.17); det.push(paint(g, 0xd62828)); }
  }
}

// 헤드기어 (머리 중심 0, 1.6, -0.19 / 앞쪽 -z). paintOpt: { hex, finish } 로 껍데기 색 변경
// mats.gloss: 광택 재질(쉘·바이저) / mats.metal: 금속 반사(골드·크롬). 모든 장식은 쉘 표면에 반쯤 묻혀 떠 보이지 않게 배치
function headgear(det, glow, hel, paintOpt, shellOut = det, mats = {}) {
  const shell = paintOpt ? paintOpt.hex : hel.shell;
  const gloss = mats.gloss || det;
  const metal = mats.metal || gloss;
  // 메탈릭·네온 페인트는 쉘을 따로 모아 전용 재질로, 아니면 기본 광택(골드·크롬은 금속)
  const shellList = paintOpt ? (paintOpt.finish !== 'solid' ? shellOut : gloss) : hel.shine ? metal : gloss;
  const sph = (r, x, y, z, c, list = det, sx = 1, sy = 1, sz = 1, seg = 12) => {
    const g = new THREE.SphereGeometry(r, seg, Math.max(8, seg - 2));
    g.scale(sx, sy, sz);
    g.translate(x, y, z);
    list.push(paint(g, c));
  };
  const face = 0xf1c8a0;
  const HC = V(0, 1.6, -0.19);
  const R = 0.19;
  const SC = [0.96, 1.0, 1.1];
  const FRONT = Math.PI * 1.5; // 구의 phi 기준 정면(-z)
  const BACK = Math.PI * 0.5;
  // 쉘 조각 (구의 phi/theta 범위)
  const part = (r, phiS, phiL, thS, thL, c, list, seg = 22) => {
    const g = new THREE.SphereGeometry(r, seg, 16, phiS, phiL, thS, thL);
    g.scale(SC[0], SC[1], SC[2]);
    g.translate(HC.x, HC.y, HC.z);
    list.push(paint(g, c));
    return g;
  };
  // 쉘 표면 위의 점 (phi, theta)
  const onShell = (r, phi, th) => V(
    HC.x - r * Math.cos(phi) * Math.sin(th) * SC[0],
    HC.y + r * Math.cos(th) * SC[1],
    HC.z + r * Math.sin(phi) * Math.sin(th) * SC[2],
  );
  // 앞→뒤로 정수리를 지나는 띠 (두 장의 얇은 구면 조각)
  const lune = (w, c, list, thFront = Math.PI * 0.36, thBack = Math.PI * 0.82, off = 0) => {
    part(R * 1.012, FRONT + off - w / 2, w, 0, thFront, c, list, 6);
    part(R * 1.012, BACK - off - w / 2, w, 0, thBack, c, list, 6);
  };
  const eyes = (z = -0.33, y = 1.57) => {
    for (const sx of [-1, 1]) {
      sph(0.02, sx * 0.05, y, z, 0x1b1b1b, det, 1, 1.2, 0.8);
      sph(0.007, sx * 0.045, y + 0.008, z - 0.016, 0xffffff, glow);
    }
  };
  const faceBall = () => {
    sph(0.14, 0, 1.55, -0.2, face, det, 0.95, 1.05, 1, 16);
    eyes();
    det.push(box(0.04, 0.008, 0.01, 0, 1.495, -0.333, 0xb5655a)); // 입
  };

  switch (hel.kind) {
    case 'cap': { // 스냅백: 얼굴 + 둥근 크라운 + 평평한 챙 + 단추
      sph(0.15, 0, 1.56, -0.2, face, det, 0.95, 1.05, 1, 16);
      eyes(-0.34);
      const crown = new THREE.SphereGeometry(0.165, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      crown.scale(1, 0.85, 1.08);
      crown.translate(0, 1.62, -0.19);
      shellList.push(paint(crown, shell));
      const brim = new THREE.CylinderGeometry(0.14, 0.14, 0.018, 18, 1, false, Math.PI * 0.5, Math.PI);
      brim.scale(1.05, 1, 1.15);
      brim.translate(0, 1.625, -0.3);
      det.push(paint(brim, hel.brim));
      sph(0.022, 0, 1.755, -0.19, hel.brim);
      // 정면 로고 패치
      det.push(box(0.07, 0.045, 0.02, 0, 1.69, -0.355, hel.brim, -0.45));
      return;
    }
    case 'straw': { // 밀짚모자: 얼굴(눈) + 넓은 챙 + 크라운 + 붉은 띠
      sph(0.15, 0, 1.56, -0.2, face, det, 0.95, 1.05, 1, 16);
      eyes(-0.34);
      const brim = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 24);
      brim.translate(0, 1.66, -0.2);
      shellList.push(paint(brim, shell));
      const top = new THREE.CylinderGeometry(0.13, 0.16, 0.14, 18);
      top.translate(0, 1.74, -0.2);
      shellList.push(paint(top, shell));
      const band = new THREE.CylinderGeometry(0.162, 0.162, 0.035, 18);
      band.translate(0, 1.69, -0.2);
      det.push(paint(band, hel.band));
      return;
    }
    case 'dino': { // 공룡 후드: 머리를 덮는 공룡 머리 + 앞으로 튀어나온 주둥이(이빨) + 큰 눈 + 등 가시. 얼굴은 입 아래로 보임
      faceBall();
      const r = R * 1.06;
      part(r, 0, Math.PI * 2, 0, Math.PI * 0.42, shell, shellList);                       // 정수리
      part(r, FRONT + 0.8, Math.PI * 2 - 1.6, Math.PI * 0.42, Math.PI * 0.36, shell, shellList); // 옆·뒤 (얼굴 쪽은 열림)
      { // 후드 안감 (안쪽에서 보이도록 뒤집은 면)
        const g = new THREE.SphereGeometry(r * 0.97, 22, 10, FRONT + 0.8, Math.PI * 2 - 1.6, Math.PI * 0.42, Math.PI * 0.36);
        g.scale(-SC[0], SC[1], SC[2]);
        g.translate(HC.x, HC.y, HC.z);
        det.push(paint(g, 0x2d6a4f));
      }
      // 위턱 주둥이 + 콧구멍
      sph(0.13, 0, 1.675, -0.39, shell, shellList, 1.0, 0.55, 1.05, 18);
      for (const sx of [-1, 1]) sph(0.016, sx * 0.045, 1.71, -0.515, 0x1b4332);
      // 이빨: 주둥이 아래 가장자리를 따라
      for (let i = -3; i <= 3; i++) {
        const x = i * 0.034;
        const z = -0.39 - 0.125 * Math.sqrt(Math.max(0, 1 - (x / 0.13) ** 2));
        const t = new THREE.ConeGeometry(0.014, 0.045, 4);
        t.rotateX(Math.PI);
        t.translate(x, 1.6, z + 0.01);
        det.push(paint(t, 0xffffff));
      }
      // 큰 눈 + 눈두덩
      for (const sx of [-1, 1]) {
        sph(0.05, sx * 0.1, 1.78, -0.36, 0xffffff, det, 1, 1, 0.9, 14);
        sph(0.026, sx * 0.105, 1.78, -0.402, 0x111111);
        sph(0.009, sx * 0.095, 1.792, -0.425, 0xffffff, glow);
        sph(0.054, sx * 0.1, 1.8, -0.35, shell, shellList, 1.05, 0.5, 1);
      }
      // 등 가시: 정수리 앞에서 뒤통수까지 표면 법선 방향으로
      const spikes = [[-0.12, 0.075], [0.12, 0.085], [0.38, 0.08], [0.64, 0.07], [0.9, 0.06], [1.15, 0.05]];
      spikes.forEach(([a, s], i) => {
        const p = V(0, HC.y + r * Math.cos(a) * SC[1], HC.z + r * Math.sin(a) * SC[2]);
        const c = new THREE.ConeGeometry(s * 0.6, s * 1.5, 4);
        c.scale(0.45, 1, 1.15);
        c.translate(0, s * 0.55, 0);
        c.rotateX(a);
        c.translate(p.x, p.y, p.z);
        det.push(paint(c, i % 2 ? 0xffd166 : 0xff9f1c));
      });
      return;
    }
    case 'chibi': // 대두 가면: 커다란 얼굴 + 큰 눈 + 볼터치 + 앞머리 + 머리 위 삐침
      sph(0.3, 0, 1.68, -0.18, shell, shellList, 1, 1, 1, 18);
      for (const sx of [-1, 1]) {
        sph(0.06, sx * 0.11, 1.7, -0.45, 0x2b2d42, det, 1, 1.25, 0.6);
        sph(0.02, sx * 0.09, 1.74, -0.49, 0xffffff, glow);
        sph(0.01, sx * 0.125, 1.67, -0.485, 0xffffff, glow);
        sph(0.04, sx * 0.19, 1.6, -0.43, 0xff8fab, det, 1, 0.6, 0.5);
      }
      { const hair = new THREE.SphereGeometry(0.32, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2.4); hair.translate(0, 1.72, -0.16); det.push(paint(hair, 0x3d2b1f)); } // 얼굴 구와 표면이 겹치지 않게 살짝 크게
      { const tuft = new THREE.ConeGeometry(0.035, 0.14, 5); tuft.rotateZ(-0.5); tuft.translate(0.04, 2.04, -0.17); det.push(paint(tuft, 0x3d2b1f)); }
      det.push(box(0.08, 0.02, 0.02, 0, 1.58, -0.47, 0xd62828));
      return;
    case 'cyber': { // 사이버 네온: 매끈한 검은 쉘 + 발광 바이저 + 플러시 네온 라인 + 측면 핀
      part(R, 0, Math.PI * 2, 0, Math.PI * 0.8, shell, shellList);
      sph(0.1, 0, 1.47, -0.31, shell, shellList, 1.3, 0.75, 0.9, 16);
      part(R * 1.03, FRONT - 0.95, 1.9, Math.PI * 0.38, Math.PI * 0.14, hel.visor, glow);
      lune(0.05, hel.neon, glow);
      lune(0.018, hel.visor, glow, Math.PI * 0.36, Math.PI * 0.75, 0.32);
      lune(0.018, hel.visor, glow, Math.PI * 0.36, Math.PI * 0.75, -0.32);
      return;
    }
    default:
      break;
  }

  // ---- 헬멧
  if (!hel.full) {
    // 오픈페이스(하프): 얼굴이 보이는 반구 쉘 + 귀 덮개 + 테두리 + 짧은 챙
    faceBall();
    part(R, 0, Math.PI * 2, 0, Math.PI * 0.52, shell, shellList);
    for (const sx of [-1, 1]) sph(0.065, sx * 0.165, 1.55, -0.17, shell, shellList, 0.45, 1.1, 1, 14);
    { // 테두리 고무 트림
      const t = new THREE.TorusGeometry(R * Math.sin(Math.PI * 0.52), 0.011, 6, 32);
      t.rotateX(Math.PI / 2);
      t.scale(SC[0], 1, SC[2]);
      t.translate(HC.x, HC.y + R * Math.cos(Math.PI * 0.52), HC.z);
      det.push(paint(t, 0x202326));
    }
    { // 이마 챙: 쉘에서 앞으로 살짝 내려오는 부채꼴 판
      const g = new THREE.CylinderGeometry(R * 1.22, R * 1.22, 0.022, 20, 1, false, Math.PI - 0.62, 1.24);
      g.rotateX(0.22);
      g.scale(SC[0], 1, SC[2]);
      g.translate(HC.x, HC.y + 0.01, HC.z);
      shellList.push(paint(g, shell));
    }
  } else {
    // 풀페이스: 쉘 + 턱 가드 + 곡면 바이저(광택) + 하이라이트 + 바이저 힌지 + 턱 통풍구 + 뒤 스포일러
    part(R, 0, Math.PI * 2, 0, Math.PI * 0.8, shell, shellList);
    sph(0.1, 0, 1.47, -0.31, shell, shellList, 1.3, 0.75, 0.9, 16);
    part(R * 1.03, FRONT - 0.92, 1.84, Math.PI * 0.37, Math.PI * 0.16, hel.visor, gloss);
    part(R * 1.036, FRONT - 0.55, 0.45, Math.PI * 0.395, Math.PI * 0.014, 0xffffff, glow, 8);
    for (const s of [-1, 1]) {
      const p = onShell(R * 1.01, FRONT + s * 0.92, Math.PI * 0.45);
      const g = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 14);
      g.rotateZ(Math.PI / 2);
      g.translate(p.x, p.y, p.z);
      det.push(paint(g, 0x3a3d42));
    }
    for (const x of [-0.035, 0, 0.035]) det.push(box(0.018, 0.035, 0.03, x, 1.455, -0.395, 0x1d1f22));
    { const p = onShell(R, BACK, Math.PI * 0.3); det.push(box(0.15, 0.03, 0.09, p.x, p.y, p.z, shell, 0.5)); }
    { const p = onShell(R, BACK, Math.PI * 0.62); det.push(box(0.07, 0.025, 0.025, p.x, p.y, p.z, 0xff3b30)); }
  }
  if (hel.stripe) {
    lune(0.07, hel.stripe, det);
    if (!hel.full) { lune(0.025, 0x1b1b1b, det, Math.PI * 0.36, Math.PI * 0.5, 0.075); lune(0.025, 0x1b1b1b, det, Math.PI * 0.36, Math.PI * 0.5, -0.075); }
  }
  if (hel.goggles) {
    // 레트로 고글: 쉘 이마에 걸친 렌즈 2개 + 쉘에 밀착된 가죽 끈
    const th = Math.PI * 0.36;
    const t = new THREE.TorusGeometry(R * Math.sin(th) * 1.02, 0.012, 6, 32);
    t.rotateX(Math.PI / 2);
    t.scale(SC[0], 1, SC[2]);
    t.translate(HC.x, HC.y + R * Math.cos(th), HC.z);
    det.push(paint(t, 0x5a3e2b));
    for (const s of [-1, 1]) {
      const p = onShell(R * 1.0, FRONT + s * 0.38, th);
      const n = p.clone().sub(HC).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
      const g = new THREE.CylinderGeometry(0.04, 0.044, 0.04, 16);
      g.applyQuaternion(q);
      g.translate(p.x + n.x * 0.012, p.y + n.y * 0.012, p.z + n.z * 0.012);
      det.push(paint(g, 0x8a6a3a));
      const l = new THREE.CylinderGeometry(0.03, 0.03, 0.01, 16);
      l.applyQuaternion(q);
      l.translate(p.x + n.x * 0.034, p.y + n.y * 0.034, p.z + n.z * 0.034);
      glow.push(paint(l, 0x9bd8ff));
    }
  }
  if (hel.ears) {
    for (const sx of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.07, 0.14, 4);
      ear.rotateY(Math.PI / 4);
      ear.scale(1, 1, 0.55);
      ear.rotateZ(-sx * 0.3);
      ear.translate(sx * 0.105, 1.8, -0.17);
      shellList.push(paint(ear, shell));
      const inner = new THREE.ConeGeometry(0.042, 0.09, 4);
      inner.rotateY(Math.PI / 4);
      inner.scale(1, 1, 0.3);
      inner.rotateZ(-sx * 0.3);
      inner.translate(sx * 0.108, 1.795, -0.2);
      det.push(paint(inner, 0xff8fab));
    }
    // 수염 (바이저 옆)
    for (const sx of [-1, 1]) for (const dy of [-0.012, 0.012]) det.push(box(0.07, 0.006, 0.006, sx * 0.17, 1.5 + dy, -0.33, 0x3a2a4a));
  }
  if (hel.crown) {
    const band = new THREE.CylinderGeometry(0.135, 0.14, 0.055, 20);
    band.translate(0, 1.775, -0.19);
    metal.push(paint(band, 0xffd700));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = new THREE.ConeGeometry(0.03, 0.1, 4);
      sp.translate(Math.cos(a) * 0.115, 1.85, -0.19 + Math.sin(a) * 0.115);
      metal.push(paint(sp, 0xffd700));
      sph(0.016, Math.cos(a) * 0.118, 1.905, -0.19 + Math.sin(a) * 0.118, [0xe63946, 0x2f7fe0, 0x2a9d8f][i % 3], glow);
    }
  }
}

// 국가대표 풀 바디 래핑: 국기 + 레이싱 스트라이프
function nationalWrapTexture(code, accent) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const acc = '#' + new THREE.Color(accent).getHexString();
  const draw = () => {
    drawFlag(x, code, 256, 256, 0, 0, () => { draw(); tex.needsUpdate = true; });
    x.save();
    x.translate(128, 128);
    x.rotate(-0.5);
    x.fillStyle = 'rgba(255,255,255,0.92)';
    x.fillRect(-200, -38, 400, 10);
    x.fillRect(-200, 28, 400, 10);
    x.fillStyle = acc;
    x.fillRect(-200, -26, 400, 52);
    x.restore();
  };
  draw();
  return tex;
}

// 모서리가 둥근 상자 (세로 모서리 반경 r, 위아래 모서리는 살짝 깎음). 중심 (x, y, z)
function roundBox(w, h, d, r, x, y, z, color, bev = 0.015) {
  r = Math.min(r, w / 2 - bev - 0.001, d / 2 - bev - 0.001);
  const W = w / 2 - bev, D = d / 2 - bev, rr = Math.max(0.002, r - bev);
  const s = new THREE.Shape();
  s.moveTo(-W + rr, -D);
  s.lineTo(W - rr, -D);
  s.quadraticCurveTo(W, -D, W, -D + rr);
  s.lineTo(W, D - rr);
  s.quadraticCurveTo(W, D, W - rr, D);
  s.lineTo(-W + rr, D);
  s.quadraticCurveTo(-W, D, -W, D - rr);
  s.lineTo(-W, -D + rr);
  s.quadraticCurveTo(-W, -D, -W + rr, -D);
  const g = new THREE.ExtrudeGeometry(s, { depth: h - bev * 2, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 2, curveSegments: 5 });
  g.translate(0, 0, -(h - bev * 2) / 2);
  g.rotateX(Math.PI / 2); // 모양 y → z, 돌출 방향 z → y (뒤집지 않아 면 방향 유지)
  g.translate(x, y, z);
  return color == null ? g : paint(g, color);
}

// 배달통 (뒷좌석 랙 위). 몸통 중심 (0, 1.31, 0.68) · 0.56 x 0.5 x 0.5
// 모든 장식은 면에서 최소 8mm 이상 띄워 겹친 면이 지직거리지 않게 함 (layer 마다 +8mm)
function deliveryBox(det, glow, style, mats = {}, code = null) {
  const st = BOX_STYLES[style] || BOX_STYLES.basic;
  const gloss = mats.gloss || det;
  const metal = mats.metal || gloss;
  const CX = 0, CY = 1.31, CZ = 0.68, W = 0.56, H = 0.5, D = 0.5;
  const TOP = CY + H / 2, BACKZ = CZ + D / 2;
  // 랙 + 받침 브래킷
  det.push(box(0.36, 0.04, 0.42, 0, 1.03, 0.66, 0x2b2d31));
  for (const sx of [-1, 1]) det.push(box(0.03, 0.08, 0.36, sx * 0.15, 1.0, 0.66, 0x3a3d42));
  if (st.national && code) {
    // 국가대표 배달통: 나라별 에어로 포드 (옆면 아트 패널은 createBike 에서 텍스처로 붙임)
    nationalPod(code, det, glow, metal, gloss);
    return;
  }
  if (st.national) {
    // 국가 코드가 없을 때(미리보기 등): 기본 색 에어로 포드
    nationalPod('', det, glow, metal, gloss);
    return;
  }
  const L = (n) => 0.004 + n * 0.008; // 면에서 띄우는 거리
  // 뒷면 장식 (w x h, 중심 x, y)
  const backB = (w, h, x, y, c, n = 1, list = det, rz = 0) => {
    const g = new THREE.BoxGeometry(w, h, 0.008);
    if (rz) g.rotateZ(rz);
    g.translate(x, y, BACKZ + L(n));
    list.push(paint(g, c));
  };
  const backDisc = (r, x, y, c, n = 1, list = det, sx = 1, sy = 1, seg = 24) => {
    const g = new THREE.CylinderGeometry(r, r, 0.008, seg);
    g.rotateX(Math.PI / 2);
    g.scale(sx, sy, 1);
    g.translate(x, y, BACKZ + L(n));
    list.push(paint(g, c));
  };
  // 옆면 장식 (양쪽). z 는 몸통 기준 상대값
  const sideB = (h, dz, y, z, c, n = 1, list = det) => {
    for (const sx of [-1, 1]) list.push(box(0.008, h, dz, sx * (W / 2 + L(n)), y, CZ + z, c));
  };
  // 몸통을 두르는 띠 (몸통보다 g 만큼 큰 둥근 상자)
  const wrap = (h, y, c, r, g = 0.018, list = det) => list.push(roundBox(W + g, h, D + g, r + g / 2, CX, y, CZ, c, 0.004));
  const body = (c, r, list = det) => list.push(roundBox(W, H, D, r, CX, CY, CZ, c, 0.02));
  const lid = (c, r, list = det, h = 0.07) => list.push(roundBox(W + 0.03, h, D + 0.03, r + 0.015, CX, TOP + h / 2 - 0.012, CZ, c, 0.012));
  const reflector = (y = 1.11) => { backB(0.2, 0.035, -0.12, y, 0xd62828, 3, glow); backB(0.2, 0.035, 0.12, y, 0xd62828, 3, glow); };
  const handle = (c = 0x1d1f22, y = TOP + 0.058) => {
    const t = new THREE.TorusGeometry(0.07, 0.014, 6, 14, Math.PI);
    t.translate(0, y, CZ);
    det.push(paint(t, c));
  };

  switch (style) {
    case 'styrofoam': { // 쿨러: 흰 스티로폼 + 세로 리브 + 파란 테이프 + 눈꽃
      body(0xf4f4ee, 0.04);
      lid(0xe2e2da, 0.04);
      for (const x of [-0.18, -0.06, 0.06, 0.18]) backB(0.03, 0.38, x, 1.3, 0xe6e6de, 1);
      for (const z of [-0.15, 0, 0.15]) sideB(0.38, 0.03, 1.3, z, 0xe6e6de, 1);
      wrap(0.06, 1.47, 0x2f7fe0, 0.04);
      backB(0.06, 0.4, 0, 1.29, 0x2f7fe0, 2);
      [0, Math.PI / 3, -Math.PI / 3].forEach((a, i) => backB(0.17, 0.022, 0, 1.24, 0x2f7fe0, 3 + i, det, a)); // 엇갈린 막대는 층을 달리해 겹침 방지
      backDisc(0.03, 0, 1.24, 0xffffff, 6);
      handle(0x2f7fe0);
      reflector();
      return;
    }
    case 'pizza': { // 피자 보온 가방: 부드러운 빨간 가방 + 지퍼 + 피자 조각 엠블럼 + 손잡이 끈
      body(0xd62828, 0.1);
      lid(0xb71c1c, 0.1, det, 0.06);
      wrap(0.02, 1.535, 0x222222, 0.1, 0.014);
      for (const sx of [-1, 1]) det.push(box(0.03, 0.03, 0.05, sx * 0.2, 1.535, BACKZ + 0.01, 0xc0c4c8));
      { // 피자 조각: 노란 삼각형 + 크러스트 + 페퍼로니
        const g = new THREE.CylinderGeometry(0.15, 0.15, 0.008, 3);
        g.rotateX(Math.PI / 2);
        g.rotateZ(Math.PI);
        g.translate(0, 1.29, BACKZ + L(1));
        det.push(paint(g, 0xffd166));
        backB(0.24, 0.035, 0, 1.36, 0xc77d3a, 2);
        for (const [x, y] of [[-0.04, 1.31], [0.045, 1.3], [0, 1.24]]) backDisc(0.022, x, y, 0xb71c1c, 2);
      }
      for (const sx of [-1, 1]) det.push(box(0.04, 0.012, 0.42, sx * 0.12, TOP + 0.07, CZ, 0x1d1f22));
      reflector();
      return;
    }
    case 'neon': { // 네온: 어두운 몸통 + 발광 프레임 + 번개
      body(0x161a2e, 0.03, gloss);
      lid(0x0e1020, 0.03, gloss);
      wrap(0.022, TOP - 0.01, st.band, 0.03, 0.02, glow);
      wrap(0.022, CY - H / 2 + 0.03, st.lid, 0.03, 0.02, glow);
      for (const sx of [-1, 1]) backB(0.018, 0.36, sx * 0.2, 1.3, st.band, 1, glow);
      backB(0.06, 0.2, 0.025, 1.35, st.lid, 2, glow, -0.45);
      backB(0.06, 0.2, -0.025, 1.22, st.lid, 3, glow, -0.45);
      backB(0.1, 0.04, 0, 1.285, st.lid, 4, glow);
      sideB(0.018, 0.36, 1.3, 0, st.band, 1, glow);
      return;
    }
    case 'camo': { // 군용 크레이트: 위장 무늬 + 스텐실 + 측면 손잡이 + 걸쇠
      body(0x5b6b3a, 0.025);
      lid(0x3b4422, 0.025);
      const patches = [[-0.14, 1.2, 0.16, 0.1, 0x3b4422], [0.1, 1.41, 0.2, 0.09, 0x8a7f4f], [0.17, 1.17, 0.12, 0.08, 0x2f3a1c], [-0.12, 1.43, 0.12, 0.07, 0x2f3a1c]];
      for (const [x, y, w, h, c] of patches) backB(w, h, x, y, c, 1, det, x * 1.5);
      for (const [z, y, w, h, c] of patches) sideB(h, w, y, z * 0.9, c, 1);
      for (let i = 0; i < 3; i++) backB(0.035, 0.05, -0.05 + i * 0.05, 1.3, 0xe9e5cf, 2);
      for (const sx of [-1, 1]) { // 손잡이
        const t = new THREE.TorusGeometry(0.06, 0.012, 6, 12, Math.PI);
        t.rotateY(Math.PI / 2);
        t.rotateX(Math.PI);
        t.translate(sx * (W / 2 + 0.02), 1.42, CZ);
        det.push(paint(t, 0x1d1f22));
      }
      for (const sx of [-1, 1]) backB(0.05, 0.08, sx * 0.17, TOP - 0.03, 0x2b2d31, 3);
      reflector();
      return;
    }
    case 'treasure': { // 보물상자: 나무 + 둥근 뚜껑 + 금띠 + 자물쇠
      body(0x7a4a22, 0.02);
      { // 반원통 뚜껑
        const g = new THREE.CylinderGeometry(D / 2 + 0.015, D / 2 + 0.015, W + 0.02, 20, 1, false, -Math.PI / 2, Math.PI);
        g.rotateZ(Math.PI / 2);
        g.scale(1, 0.55, 1);
        g.translate(CX, TOP - 0.005, CZ);
        det.push(paint(g, 0x5c3517));
      }
      for (const x of [-0.19, 0.19]) {
        const g = new THREE.TorusGeometry(D / 2 + 0.025, 0.014, 6, 20, Math.PI);
        g.rotateY(Math.PI / 2);
        g.scale(1, 0.55, 1);
        g.translate(x, TOP - 0.005, CZ);
        metal.push(paint(g, 0xf5c518));
        backB(0.04, H - 0.04, x, CY, 0xf5c518, 1, metal);
      }
      sideB(H - 0.04, 0.04, CY, 0, 0xf5c518, 1, metal); // 양옆 한 번만 (예전엔 두 번 그려 겹침)
      wrap(0.035, 1.12, 0xf5c518, 0.02, 0.018, metal);
      backB(0.1, 0.12, 0, TOP - 0.05, 0xf5c518, 2, metal);
      backDisc(0.016, 0, TOP - 0.04, 0x1b1b1b, 3);
      backB(0.012, 0.035, 0, TOP - 0.07, 0x1b1b1b, 3);
      return;
    }
    case 'goldbox': { // 골드 VIP 금고: 금속 광택 몸통 + 다이얼 + 경첩 + 리벳
      body(0xe6b422, 0.03, metal);
      lid(0xc99a10, 0.03, metal);
      wrap(0.03, 1.12, 0xfff3b0, 0.03, 0.018, metal);
      backDisc(0.11, 0, 1.3, 0x2a2a2e, 1);
      backDisc(0.085, 0, 1.3, 0xd9dde1, 2, metal);
      backDisc(0.03, 0, 1.3, 0x2a2a2e, 3);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        backB(0.008, 0.02, Math.cos(a) * 0.07, 1.3 + Math.sin(a) * 0.07, 0x2a2a2e, 3, det, a + Math.PI / 2);
      }
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) backDisc(0.014, sx * 0.21, 1.3 + sy * 0.18, 0xfff3b0, 1, metal);
      for (const sx of [-1, 1]) det.push(box(0.03, 0.12, 0.05, sx * 0.21, 1.42, BACKZ + 0.02, 0x3a3d42));
      sideB(0.1, 0.3, 1.3, 0, 0xfff3b0, 1, metal);
      handle(0xfff3b0);
      return;
    }
    case 'vintage': { // 빈티지 나무 상자: 판자 + 틈 + 철 모서리 + 빨간 도장
      body(0x3d2a1c, 0.012);
      lid(0x6b4a2e, 0.012, det, 0.06);
      const planks = [1.14, 1.255, 1.37, 1.485];
      planks.forEach((y, i) => {
        const c = [0x9c6b3c, 0x8d5f33, 0xa47543, 0x93653a][i];
        backB(W - 0.04, 0.1, 0, y, c, 1);
        sideB(0.1, D - 0.04, y, 0, c, 1);
      });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) { // L자 철 모서리
        backB(0.08, 0.025, sx * (W / 2 - 0.06), CY + sy * (H / 2 - 0.035), 0x3d3d3d, 2);
        backB(0.025, 0.08, sx * (W / 2 - 0.035), CY + sy * (H / 2 - 0.06), 0x3d3d3d, 3);
        backDisc(0.008, sx * (W / 2 - 0.035), CY + sy * (H / 2 - 0.035), 0x9aa0a6, 4);
      }
      for (const [w, h, y] of [[0.22, 0.012, 1.34], [0.22, 0.012, 1.27], [0.012, 0.07, 1.305]]) {
        const n = w > 0.1 ? 2 : 3; // 가로·세로 선이 엇갈리는 곳은 층을 달리함
        backB(w, h, 0.0, y, 0xb02a2a, n);
        if (w > 0.1) continue;
        backB(w, h, -0.105, y, 0xb02a2a, n);
        backB(w, h, 0.105, y, 0xb02a2a, n);
      }
      return;
    }
    case 'anime': { // 카와이 박스: 둥근 핑크 + 고양이 귀 + 큰 눈 + 볼터치 + 반짝이
      body(0xffc2e2, 0.12, gloss);
      lid(0xff6fae, 0.12, gloss, 0.06);
      for (const sx of [-1, 1]) {
        const e = new THREE.ConeGeometry(0.08, 0.13, 4);
        e.rotateY(Math.PI / 4);
        e.scale(1, 1, 0.5);
        e.translate(sx * 0.17, TOP + 0.1, CZ + 0.05);
        det.push(paint(e, 0xff6fae));
        const ie = new THREE.ConeGeometry(0.045, 0.08, 4);
        ie.rotateY(Math.PI / 4);
        ie.scale(1, 1, 0.3);
        ie.translate(sx * 0.17, TOP + 0.09, CZ + 0.072);
        det.push(paint(ie, 0xffe0f0));
        backDisc(0.07, sx * 0.12, 1.33, 0xffffff, 1, det, 0.85, 1.1);
        backDisc(0.05, sx * 0.115, 1.32, 0x2b2d42, 2, det, 0.85, 1.15);
        backDisc(0.03, sx * 0.115, 1.3, 0x8e7cff, 3, det, 0.85, 1.1);
        backDisc(0.017, sx * 0.1, 1.355, 0xffffff, 4, glow);
        backDisc(0.008, sx * 0.13, 1.29, 0xffffff, 4, glow);
        backDisc(0.04, sx * 0.19, 1.22, 0xff8fab, 1, det, 1.2, 0.6);
      }
      backB(0.03, 0.01, -0.015, 1.215, 0x2b2d42, 1, det, 0.5);
      backB(0.03, 0.01, 0.015, 1.215, 0x2b2d42, 1, det, -0.5);
      for (const [z, y] of [[-0.12, 1.42], [0.12, 1.2]]) { // 옆면 별
        [0, Math.PI / 2, Math.PI / 4, -Math.PI / 4].forEach((a, k) => {
          for (const sx of [-1, 1]) {
            const g = new THREE.BoxGeometry(0.008, a % (Math.PI / 2) ? 0.05 : 0.09, 0.016);
            g.rotateX(a);
            g.translate(sx * (W / 2 + L(1 + k)), y, CZ + z); // 별 팔마다 층을 달리해 겹침 방지
            glow.push(paint(g, 0xfff275));
          }
        });
      }
      return;
    }
    case 'cyber': { // 사이버 그리드: 검은 몸통 + 네온 격자 + 홀로 패널 + 발광 뚜껑 테두리
      body(0x0b0f1e, 0.02, gloss);
      lid(0x070a14, 0.02, gloss);
      wrap(0.016, TOP + 0.03, st.lid, 0.02, 0.05, glow);
      for (const y of [1.17, 1.29, 1.41]) backB(W - 0.08, 0.012, 0, y, st.band, 1, glow);
      for (const x of [-0.12, 0, 0.12]) backB(0.012, H - 0.08, x, CY, st.band, 2, glow);
      for (const y of [1.17, 1.29, 1.41]) sideB(0.012, D - 0.08, y, 0, st.band, 1, glow);
      sideB(0.1, 0.22, 1.3, 0, 0x0e3a4a, 2);
      sideB(0.012, 0.18, 1.32, 0, st.lid, 3, glow);
      sideB(0.012, 0.12, 1.28, -0.03, st.lid, 3, glow);
      return;
    }
    default: { // 클래식 그린: 초록 몸통 + 흰 띠 + 로고(원 + 속도선) + 반사판 + 손잡이
      body(st.base, 0.05, gloss);
      lid(st.lid, 0.05, gloss);
      wrap(0.06, 1.42, st.band, 0.05);
      backDisc(0.085, 0.06, 1.25, 0xffffff, 1);
      backDisc(0.06, 0.06, 1.25, st.base, 2);
      { // 로고 안쪽: 흰 오토바이 바퀴 + 짐
        backDisc(0.018, 0.03, 1.23, 0xffffff, 3);
        backDisc(0.018, 0.09, 1.23, 0xffffff, 3);
        backB(0.06, 0.012, 0.06, 1.25, 0xffffff, 3);
        backB(0.03, 0.03, 0.04, 1.275, 0xffffff, 3);
      }
      for (const [w, y] of [[0.1, 1.27], [0.07, 1.245], [0.05, 1.22]]) backB(w, 0.012, -0.03 - w / 2 - 0.02, y, 0xffffff, 1);
      handle();
      reflector();
    }
  }
}

// ======================================================================
// 동남아 8개국 국가대표 바이크: 나라 특색을 살린 전용 래핑 + 3D 장식 (그 외 나라는 기존 국기 래핑)
// ======================================================================
const star = (x, cx, cy, r, n = 5, inner = 0.45, rot = -Math.PI / 2) => {
  x.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, rr = i % 2 ? r * inner : r;
    x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  x.closePath();
  x.fill();
};
const crescent = (x, cx, cy, r, bg, off = 0.35) => {
  x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  const f = x.fillStyle; x.fillStyle = bg;
  x.beginPath(); x.arc(cx + r * off, cy, r * 0.85, 0, Math.PI * 2); x.fill();
  x.fillStyle = f;
};
const SEA_PAINT = {
  SG(x, W, H) { // 빨강/흰 투톤 + 초승달·별 5개 + 사자 갈기 물결
    x.fillStyle = '#ef3340'; x.fillRect(0, 0, W, H / 2);
    x.fillStyle = '#ffffff'; x.fillRect(0, H / 2, W, H / 2);
    x.fillStyle = '#ffffff';
    crescent(x, 70, 62, 38, '#ef3340');
    for (let i = 0; i < 5; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5; star(x, 112 + Math.cos(a) * 20, 62 + Math.sin(a) * 20, 8); }
    x.strokeStyle = '#ef3340'; x.lineWidth = 6;
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(180 + i * 50, H); x.quadraticCurveTo(205 + i * 50, H * 0.62, 230 + i * 50, H); x.stroke(); }
  },
  MY(x, W, H) { // 말레이 호랑이(하리마우): 노랑 + 검은 줄무늬 + 남색 띠 초승달·14각 별
    x.fillStyle = '#ffcc00'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#16120c';
    for (let i = 0; i < 9; i++) {
      const cx = 20 + i * 58;
      x.beginPath(); x.moveTo(cx, 0); x.quadraticCurveTo(cx + 34, H * 0.3, cx + 6, H * 0.55); x.quadraticCurveTo(cx + 22, H * 0.3, cx - 14, 0); x.fill();
      x.beginPath(); x.moveTo(cx + 20, H); x.quadraticCurveTo(cx - 10, H * 0.72, cx + 14, H * 0.5); x.quadraticCurveTo(cx + 4, H * 0.75, cx + 38, H); x.fill();
    }
    x.fillStyle = '#010066'; x.fillRect(0, H * 0.4, W, H * 0.2);
    x.fillStyle = '#cc0001'; x.fillRect(0, H * 0.4 - 6, W, 6); x.fillRect(0, H * 0.6, W, 6);
    x.fillStyle = '#ffcc00'; crescent(x, 60, H / 2, 20, '#010066', 0.4); star(x, 92, H / 2, 16, 14, 0.5);
  },
  ID(x, W, H) { // 빨강/흰 + 바틱 메가 멘둥(구름 물결) + 금빛 가루다 깃털 줄
    x.fillStyle = '#ce1126'; x.fillRect(0, 0, W, H / 2);
    x.fillStyle = '#fff8f0'; x.fillRect(0, H / 2, W, H / 2);
    x.lineWidth = 5;
    for (let i = 0; i < 7; i++) for (let k = 0; k < 4; k++) {
      x.strokeStyle = k % 2 ? '#8b0a18' : '#d94a5a';
      x.beginPath(); x.arc(40 + i * 72, H * 0.78, 30 - k * 7, Math.PI, Math.PI * 2); x.stroke();
    }
    x.fillStyle = '#ffd34d';
    for (let i = 0; i < 16; i++) { x.beginPath(); x.ellipse(16 + i * 32, H * 0.5, 7, 20, 0.5, 0, Math.PI * 2); x.fill(); }
  },
  TH(x, W, H) { // 짙은 남색 + 금빛 카녹(불꽃 덩굴) 문양 + 빨·흰·파 삼선
    x.fillStyle = '#1b1d4a'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e8b923';
    for (let i = 0; i < 10; i++) for (const y of [H * 0.25, H * 0.78]) {
      const cx = 22 + i * 52;
      x.beginPath(); x.moveTo(cx, y + 18); x.quadraticCurveTo(cx - 18, y, cx + 4, y - 20); x.quadraticCurveTo(cx + 2, y - 4, cx + 16, y + 2); x.quadraticCurveTo(cx + 10, y + 12, cx, y + 18); x.fill();
    }
    for (const [y, c] of [[0.44, '#a51931'], [0.48, '#f4f5f8'], [0.52, '#2d2a4a'], [0.56, '#f4f5f8'], [0.6, '#a51931']]) { x.fillStyle = c; x.fillRect(0, H * y, W, H * 0.04); }
  },
  VN(x, W, H) { // 빨강 + 큰 금별 + 연꽃 윤곽
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#e1251b'); g.addColorStop(1, '#a3150e');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffcd00'; star(x, 80, H / 2, 52);
    x.strokeStyle = '#ffd966'; x.lineWidth = 5;
    for (let k = -2; k <= 2; k++) { x.beginPath(); x.ellipse(300 + k * 26, H * 0.55, 16, 48, k * 0.35, 0, Math.PI * 2); x.stroke(); }
    x.fillStyle = '#ffcd00'; x.fillRect(0, H - 14, W, 6); x.fillRect(0, 8, W, 6);
  },
  PH(x, W, H) { // 파랑/빨강 + 흰 삼각형 안 8줄기 태양·별 3개 + 지프니 무지개 핀스트라이프
    x.fillStyle = '#0038a8'; x.fillRect(0, 0, W, H / 2);
    x.fillStyle = '#ce1126'; x.fillRect(0, H / 2, W, H / 2);
    x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(0, 0); x.lineTo(H * 0.86, H / 2); x.lineTo(0, H); x.fill();
    x.fillStyle = '#fcd116';
    x.beginPath(); x.arc(70, H / 2, 22, 0, Math.PI * 2); x.fill();
    for (let i = 0; i < 8; i++) { x.save(); x.translate(70, H / 2); x.rotate((i * Math.PI) / 4); x.fillRect(-4, -48, 8, 22); x.restore(); }
    star(x, 18, 22, 11); star(x, 18, H - 22, 11); star(x, H * 0.74, H / 2, 11);
    ['#ffd60a', '#2ec27e', '#ff70a6', '#ffffff'].forEach((c, i) => { x.fillStyle = c; x.fillRect(H * 0.8, H / 2 - 18 + i * 9, W, 4); });
  },
  KH(x, W, H) { // 파랑/빨강/파랑 + 사암색 패널에 앙코르와트 실루엣(금색)
    x.fillStyle = '#032ea1'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#e00025'; x.fillRect(0, H * 0.25, W, H * 0.5);
    x.fillStyle = '#cdb68a'; x.fillRect(120, H * 0.3, 280, H * 0.4);
    x.fillStyle = '#e8b923';
    const base = H * 0.66;
    x.fillRect(140, base - 8, 240, 8);
    for (const [cx, h] of [[180, 34], [220, 46], [260, 64], [300, 46], [340, 34]]) { x.beginPath(); x.moveTo(cx - 14, base - 8); x.quadraticCurveTo(cx - 12, base - h * 0.6, cx, base - h - 8); x.quadraticCurveTo(cx + 12, base - h * 0.6, cx + 14, base - 8); x.fill(); }
    x.fillStyle = '#ffffff'; x.fillRect(0, H * 0.25 - 4, W, 4); x.fillRect(0, H * 0.75, W, 4);
  },
  MM(x, W, H) { // 황금 바탕 + 미얀마 전통 기하 문양 + 노랑·초록·빨강 띠 + 흰 별
    x.fillStyle = '#d9a514'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#a87808'; x.lineWidth = 4;
    for (let i = 0; i < 18; i++) { x.beginPath(); x.moveTo(i * 30, 0); x.lineTo(i * 30 + 15, 22); x.lineTo(i * 30 + 30, 0); x.stroke(); x.beginPath(); x.moveTo(i * 30, H); x.lineTo(i * 30 + 15, H - 22); x.lineTo(i * 30 + 30, H); x.stroke(); }
    for (const [y, c] of [[0.36, '#fecb00'], [0.46, '#34b233'], [0.56, '#ea2839']]) { x.fillStyle = c; x.fillRect(0, H * y, W, H * 0.1); }
    x.fillStyle = '#ffffff'; star(x, 80, H * 0.51, 30);
  },
};
const seaWrapCache = {};
function seaWrapTexture(code) {
  if (seaWrapCache[code]) return seaWrapCache[code];
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');
  SEA_PAINT[code](x, 512, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  seaWrapCache[code] = t;
  return t;
}

// ======================================================================
// 국가대표 슈퍼바이크 (모든 나라 공통 차체) + 동남아 8개국은 전용 래핑·포인트 색·탱크 엠블럼
// 좌표: 앞 -z · 위 +y · 바퀴 z -0.72 / 0.7 (반지름 0.4) · 배달통 z 0.43~0.93, y 1.06 이상은 비움
// ======================================================================
// 옆 실루엣(z, y)을 폭 w 로 돌출한 날렵한 패널. taper(z) 로 앞뒤 폭을 좁힘
function sideExtrude(pts, w, bev, taper = null) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(-z, y) : s.moveTo(-z, y)));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, w - bev * 2), bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev * 0.7, bevelSegments: 2, curveSegments: 3 });
  g.translate(0, 0, -(w - bev * 2) / 2);
  g.rotateY(Math.PI / 2);
  if (taper) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * taper(p.getZ(i)));
  }
  g.computeVertexNormals();
  return g;
}
// 차체 래핑: 옆에서 투영한 UV → 모든 페어링 조각에 리버리가 한 장의 그림처럼 이어짐
function sideUV(g) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, (p.getZ(i) + 1.1) / 2.15, (p.getY(i) - 0.45) / 0.85);
  return g;
}
const lerpT = (a, b, t) => a + (b - a) * Math.min(1, Math.max(0, t));

// 동남아 8개국: 이름 · 포인트 색(림·캘리퍼) · LED 색 · 차체 금속감 · 탱크 엠블럼
const SEA_NATIONAL = {
  SG: { name: 'MERLION RR', rim: 0xef3340, led: 0xffffff, metal: 0.25, emblem: (mt, gl) => { // 초승달 + 별 5개
    const t = new THREE.TorusGeometry(0.045, 0.012, 6, 16, Math.PI * 1.3); t.rotateX(-Math.PI / 2 + 0.25); t.rotateY(Math.PI * 0.35); t.translate(0, 1.16, -0.3); mt.push(paint(t, 0xffffff));
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; gl.push(paint(new THREE.SphereGeometry(0.008, 6, 4).translate(Math.cos(a) * 0.025 + 0.03, 1.165, -0.3 + Math.sin(a) * 0.025), 0xffffff)); }
  } },
  MY: { name: 'HARIMAU RR', rim: 0xffcc00, led: 0xffcc00, metal: 0.25, emblem: (mt) => { // 14각 별
    const g = new THREE.CylinderGeometry(0.05, 0.05, 0.01, 14); g.translate(0, 1.16, -0.3); mt.push(paint(g, 0xffcc00));
    const c = new THREE.CylinderGeometry(0.02, 0.02, 0.014, 14); c.translate(0, 1.162, -0.3); mt.push(paint(c, 0x010066));
  } },
  ID: { name: 'GARUDA RR', rim: 0xe6b422, led: 0xffffff, metal: 0.25, emblem: (mt) => { // 금빛 날개 한 쌍
    for (const s of [-1, 1]) for (let i = 0; i < 3; i++) { const f = new THREE.ConeGeometry(0.014, 0.09 - i * 0.015, 4); f.scale(1, 1, 0.3); f.rotateZ(-s * (1.1 + i * 0.22)); f.rotateX(-Math.PI / 2 + 0.25); f.translate(s * (0.035 + i * 0.006), 1.165, -0.3 + i * 0.012); mt.push(paint(f, 0xe6b422)); }
    mt.push(paint(new THREE.SphereGeometry(0.016, 8, 6).translate(0, 1.165, -0.31), 0xe6b422));
  } },
  TH: { name: 'SIAM RR', rim: 0xe8b923, led: 0x9bdcff, metal: 0.3, emblem: (mt) => { // 금빛 초파(사원 지붕 끝) 곡선
    for (let i = 0; i < 4; i++) { const c = new THREE.CylinderGeometry(0.006, 0.01, 0.035, 6); c.rotateX(-0.4 - i * 0.45); c.translate(0, 1.165 + i * 0.012, -0.32 + i * 0.016); mt.push(paint(c, 0xe8b923)); }
  } },
  VN: { name: 'RONG RR', rim: 0xffcd00, led: 0xffcd00, metal: 0.25, emblem: (mt) => { // 금별
    const g = new THREE.CylinderGeometry(0.045, 0.045, 0.01, 5); g.translate(0, 1.16, -0.3); mt.push(paint(g, 0xffcd00));
  } },
  PH: { name: 'MABUHAY RR', rim: 0x0038a8, led: 0xfcd116, metal: 0.25, emblem: (mt) => { // 8줄기 태양
    mt.push(paint(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 12).translate(0, 1.162, -0.3), 0xfcd116));
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; mt.push(paint(new THREE.BoxGeometry(0.008, 0.008, 0.026).rotateY(a).translate(Math.sin(a) * 0.033, 1.162, -0.3 + Math.cos(a) * 0.033), 0xfcd116)); }
  } },
  KH: { name: 'ANGKOR RR', rim: 0xe8b923, led: 0xffffff, metal: 0.2, emblem: (mt) => { // 연꽃봉오리 탑 3개
    for (const [x, s] of [[-0.03, 0.75], [0, 1], [0.03, 0.75]]) { mt.push(paint(new THREE.CylinderGeometry(0.008 * s, 0.012 * s, 0.03 * s, 8).translate(x, 1.17 + 0.015 * s, -0.3), 0xe8b923)); mt.push(paint(new THREE.ConeGeometry(0.008 * s, 0.03 * s, 8).translate(x, 1.17 + 0.045 * s, -0.3), 0xffd34d)); }
  } },
  MM: { name: 'GOLDEN RR', rim: 0x34b233, led: 0xffd34d, metal: 0.7, emblem: (mt) => { // 작은 황금 탑
    mt.push(paint(new THREE.SphereGeometry(0.022, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 1.2, 1).translate(0, 1.16, -0.3), 0xf2c230));
    mt.push(paint(new THREE.ConeGeometry(0.008, 0.06, 8).translate(0, 1.21, -0.3), 0xffd34d));
  } },
};
export const SEA_NATIONAL_NAMES = Object.fromEntries(Object.entries(SEA_NATIONAL).map(([k, v]) => [k, v.name]));

// ---------- 국가대표 슈퍼바이크 포인트: 각진(로우폴리) 동물 머리 노즈 + 꼬리 장식
// 노즈 끝 z -1.04 앞쪽에 머리, 테일 끝 z 1.0 뒤에 꼬리 (배달통 z 0.44~1.0 은 피함)
function facetKit(F, G, opt = {}) {
  // 노즈 앞 머리 조각은 30% 크게 (기준점: 노즈 끝)
  const HEAD_K = opt.k ?? 1.3, HA = new THREE.Vector3(0, 0.97, -1.02), HDZ = opt.dz ?? 0, HDY = opt.dy ?? 0;
  const put = (geo, c, list = F) => {
    geo.computeBoundingBox();
    const cz = (geo.boundingBox.min.z + geo.boundingBox.max.z) / 2;
    if (cz < -0.85) {
      geo.translate(-HA.x, -HA.y, -HA.z);
      geo.scale(HEAD_K, HEAD_K, HEAD_K);
      geo.translate(HA.x, HA.y + HDY, HA.z + HDZ);
    }
    list.push(paint(geo.index ? geo.toNonIndexed() : geo, c));
  };
  const xf = (g, p, s = [1, 1, 1], r = [0, 0, 0]) => {
    g.scale(s[0], s[1], s[2]);
    if (r[0]) g.rotateX(r[0]);
    if (r[1]) g.rotateY(r[1]);
    if (r[2]) g.rotateZ(r[2]);
    g.translate(p[0], p[1], p[2]);
    return g;
  };
  // ---- 머리 표면에 붙는 디테일 (코·줄무늬): 머리 조각을 다 만든 뒤 flush() 에서 앞쪽으로 광선을 쏴
  //      실제 표면 위치·기울기를 찾아 그 면에 맞춰 붙임 → 공중에 뜨지 않음
  const pending = [];
  const toWorldXY = (x, y) => [HA.x + (x - HA.x) * HEAD_K, HA.y + (y - HA.y) * HEAD_K + HDY];
  const raw = (geo, c, list) => list.push(paint(geo.index ? geo.toNonIndexed() : geo, c));
  const hitMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const surfaceHit = (x, y) => {
    const [X, Y] = toWorldXY(x, y);
    // 머리 몸체만 대상 (수염·뿔·이빨처럼 가는 조각은 제외 → 눈이 그 위에 붙지 않게)
    const meshes = F.filter((g) => {
      g.computeBoundingBox();
      const b = g.boundingBox, sz = b.getSize(new THREE.Vector3());
      return (b.min.z + b.max.z) / 2 < -0.7 && Math.min(sz.x, sz.y, sz.z) > 0.06;
    }).map((g) => new THREE.Mesh(g, hitMat));
    const ray = new THREE.Raycaster(new THREE.Vector3(X, Y, -5), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const n = hit.face.normal.clone();
    if (n.z > 0) n.negate();
    return { p: hit.point, n, q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, -1), n) };
  };
  const placeOn = (geo, h, rz, out) => {
    if (rz) geo.rotateZ(rz);
    geo.applyQuaternion(h.q);
    geo.translate(h.p.x + h.n.x * out, h.p.y + h.n.y * out, h.p.z + h.n.z * out);
    return geo;
  };
  const flush = () => {
    for (const d of pending.splice(0)) {
      const h = surfaceHit(d.x, d.y);
      if (!h) continue;
      if (d.kind === 'wedge') {
        // 끝이 가늘어지는 납작한 줄무늬 (호랑이 무늬)
        const g = new THREE.ConeGeometry(0.5, 1, 3).scale(d.w * HEAD_K, d.len * HEAD_K, 0.014);
        raw(placeOn(g, h, d.rz, 0.006), d.c, F);
      } else if (d.kind === 'mark') {
        raw(placeOn(new THREE.BoxGeometry(d.w * HEAD_K, d.h * HEAD_K, 0.012), h, d.rz, 0.004), d.c, F);
      } else if (d.kind === 'knob') {
        const g = new THREE.OctahedronGeometry(d.r * HEAD_K, 0).scale(d.s[0], d.s[1], d.s[2]);
        raw(placeOn(g, h, 0, d.r * HEAD_K * d.s[2] * 0.35), d.c, F);
      }
    }
  };
  return {
    flush,
    mark: (w, h, p, c, rz = 0) => pending.push({ kind: 'mark', w, h, x: p[0], y: p[1], c, rz }),
    wedge: (w, len, p, c, rz = 0) => pending.push({ kind: 'wedge', w, len, x: p[0], y: p[1], c, rz }),
    sph: (r, p, c, s, rot) => put(xf(new THREE.SphereGeometry(r, 12, 9), p, s, rot), c),
    knob: (r, p, c, s = [1, 1, 1]) => pending.push({ kind: 'knob', r, x: p[0], y: p[1], c, s }),
    ico: (r, p, c, s, rot) => put(xf(new THREE.IcosahedronGeometry(r, 0), p, s, rot), c),
    oct: (r, p, c, s, rot) => put(xf(new THREE.OctahedronGeometry(r, 0), p, s, rot), c),
    cone: (r, h, p, c, rot, sides = 4, s) => put(xf(new THREE.ConeGeometry(r, h, sides), p, s, rot), c),
    blk: (w, h, d, p, c, rot) => put(xf(new THREE.BoxGeometry(w, h, d), p, [1, 1, 1], rot), c),
    gem: (r, p, c) => put(xf(new THREE.OctahedronGeometry(r, 0), p), c, G),
    // 점들을 잇는 각진 마디 (꼬리·코·뿔)
    seg: (pts, r0, r1, c, alt = null) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = new THREE.Vector3(...pts[i]), b = new THREE.Vector3(...pts[i + 1]);
        const len = a.distanceTo(b), r = r0 + (r1 - r0) * (i / Math.max(1, pts.length - 2));
        const g = new THREE.CylinderGeometry(r * 0.8, r, len, 5);
        g.translate(0, len / 2, 0);
        g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
        g.translate(a.x, a.y, a.z);
        put(g, alt && i % 2 ? alt : c);
      }
    },
  };
}
const ACCENTS = {
  SG(A, led) { // 멀라이언: 각진 사자 머리 + 붉은 갈기 + 물고기 꼬리 지느러미
    A.ico(0.12, [0, 0.97, -1.1], 0xe9ecef, [1, 0.85, 1.25]);
    A.blk(0.12, 0.07, 0.1, [0, 0.93, -1.23], 0xdfe3e8, [0.2, 0, 0]);
    A.blk(0.1, 0.035, 0.08, [0, 0.875, -1.2], 0x9aa0a6);
    for (let i = 0; i < 9; i++) { const a = -1.9 + (i / 8) * 3.8; A.cone(0.045, 0.17, [Math.sin(a) * 0.12, 0.97 + Math.cos(a) * 0.11, -1.0], i % 2 ? 0xc1121f : 0xef3340, [Math.PI / 2 - 0.5, 0, -a]); }
    for (const s of [-1, 1]) { A.cone(0.03, 0.07, [s * 0.07, 1.07, -1.08], 0xe9ecef, [0, 0, s * 0.3], 3); }
    for (const s of [-1, 1]) A.cone(0.09, 0.32, [s * 0.07, 1.02, 1.1], 0xc1121f, [-0.9, 0, s * 0.55], 4, [0.25, 1, 1]);
    A.cone(0.05, 0.12, [0, 1.0, 0.96], 0xef3340, [-0.6, 0, 0], 4, [0.25, 1, 1]);
  },
  MY(A, led) { // 하리마우: 각진 호랑이 머리(귀·송곳니·줄무늬) + 말린 줄무늬 꼬리
    A.ico(0.12, [0, 0.97, -1.1], 0xf3901e, [1.1, 0.85, 1.2]);
    A.ico(0.065, [0, 0.92, -1.22], 0xfff3e0, [1.3, 0.7, 1]);
    A.knob(0.024, [0, 0.95], 0x1b1b1b, [1.3, 0.8, 0.7]);
    for (const s of [-1, 1]) {
      A.cone(0.045, 0.09, [s * 0.08, 1.07, -1.07], 0xf3901e, [0, 0, s * 0.35], 3);
      A.cone(0.022, 0.05, [s * 0.08, 1.065, -1.09], 0x1b1b1b, [0, 0, s * 0.35], 3);
      A.cone(0.012, 0.05, [s * 0.03, 0.86, -1.25], 0xffffff, [Math.PI, 0, 0], 4);
      // 볼: 바깥에서 안쪽으로 가늘어지는 줄무늬 3줄 + 눈 위 짧은 무늬
      for (let k = 0; k < 3; k++) A.wedge(0.016, 0.07 - k * 0.01, [s * (0.1 + k * 0.006), 0.995 - k * 0.028], 0x1b1b1b, s * (1.25 + k * 0.12));
      A.wedge(0.012, 0.04, [s * 0.05, 1.035], 0x1b1b1b, s * 0.6);
    }
    // 이마: 가운데 세로 무늬 + 양옆으로 뻗는 가로 무늬 (王 모양)
    A.wedge(0.014, 0.05, [0, 1.03], 0x1b1b1b, 0);
    for (let k = 0; k < 2; k++) for (const s of [-1, 1]) A.wedge(0.012, 0.045, [s * 0.022, 1.045 - k * 0.022], 0x1b1b1b, s * Math.PI / 2);
    const tail = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; tail.push([0, 0.92 + Math.sin(t * 2.4) * 0.32, 1.0 + t * 0.22 - t * t * 0.1]); }
    A.seg(tail, 0.035, 0.018, 0xf3901e, 0x1b1b1b);
  },
  ID(A, led) { // 가루다: 각진 독수리 머리 + 갈고리 부리 + 볏 + 깃털 부채 꼬리
    A.oct(0.1, [0, 1.0, -1.1], 0xe6b422, [0.9, 1, 1.3]);
    A.cone(0.045, 0.16, [0, 0.96, -1.25], 0xff9f1c, [-Math.PI / 2 - 0.45, 0, 0], 4);
    A.cone(0.02, 0.06, [0, 0.9, -1.3], 0xff9f1c, [Math.PI, 0, 0], 4);
    for (let i = 0; i < 4; i++) A.cone(0.025, 0.2 - i * 0.025, [0, 1.09 + i * 0.01, -1.04 + i * 0.05], i % 2 ? 0xffd34d : 0xe6b422, [0.9 + i * 0.15, 0, 0], 3, [0.5, 1, 1]);
    for (let i = -2; i <= 2; i++) A.cone(0.04, 0.34, [i * 0.05, 1.02, 1.08], i % 2 ? 0xce1126 : 0xe6b422, [-1.1, 0, i * 0.3], 4, [1, 1, 0.25]);
  },
  TH(A, led) { // 왕실 흰 코끼리: 각진 머리 + 큰 귀 + 코 + 상아 + 금빛 관(차다) + 금빛 초파 꼬리
    A.ico(0.12, [0, 0.98, -1.08], 0xd9d4cc, [1.1, 1, 1.1]);
    for (const s of [-1, 1]) {
      // 둥근 귀 (얇은 타원판 + 안쪽 분홍빛 + 위 금테)
      A.sph(0.085, [s * 0.135, 0.965, -1.02], 0xcfc8bd, [0.2, 1.05, 0.85], [0, s * 0.5, s * 0.15]);
      A.sph(0.062, [s * 0.15, 0.96, -1.035], 0xd9b3a6, [0.12, 0.9, 0.7], [0, s * 0.5, s * 0.15]);
      A.sph(0.05, [s * 0.125, 1.05, -1.02], 0xe8b923, [0.22, 0.25, 0.8], [0, s * 0.5, 0]);
      // 휘어진 상아: 입가에서 앞으로 나와 위로 휨
      A.seg([[s * 0.045, 0.92, -1.15], [s * 0.06, 0.87, -1.22], [s * 0.065, 0.86, -1.28], [s * 0.06, 0.885, -1.33], [s * 0.05, 0.92, -1.35]], 0.017, 0.006, 0xfff3dc);
    }
    A.seg([[0, 0.94, -1.17], [0, 0.88, -1.25], [0, 0.81, -1.28], [0, 0.75, -1.27], [0, 0.71, -1.22]], 0.04, 0.02, 0xd9d4cc);
    A.cone(0.055, 0.13, [0, 1.12, -1.07], 0xe8b923, [0, 0, 0], 6);
    A.blk(0.14, 0.025, 0.12, [0, 1.06, -1.07], 0xe8b923);
    A.gem(0.016, [0, 1.06, -1.135], 0xe63946);
    A.seg([[0, 0.95, 1.02], [0, 1.02, 1.12], [0, 1.12, 1.17], [0, 1.2, 1.16], [0, 1.25, 1.1]], 0.03, 0.012, 0xe8b923);
  },
  VN(A, led) { // 용: 각진 긴 머리 + 벌린 턱·이빨 + 금빛 뿔·수염 + 여의주 + 가시 꼬리
    A.oct(0.1, [0, 0.98, -1.1], 0xc1121f, [1, 0.8, 1.5]);
    A.blk(0.1, 0.05, 0.12, [0, 0.965, -1.25], 0xc1121f, [0.1, 0, 0]);
    A.blk(0.08, 0.03, 0.15, [0, 0.915, -1.19], 0x8b0a18, [0.22, 0, 0]); // 아래턱: 뒤쪽 끝이 머리 안으로 이어짐
    for (let i = 0; i < 3; i++) A.cone(0.009, 0.03, [-0.02 + i * 0.02, 0.93, -1.24], 0xffffff, [0, 0, 0], 4);
    for (let i = 0; i < 4; i++) A.cone(0.01, 0.035, [-0.03 + i * 0.02, 0.935, -1.29], 0xffffff, [Math.PI, 0, 0], 4);
    for (const s of [-1, 1]) {
      A.seg([[s * 0.05, 1.05, -1.06], [s * 0.08, 1.12, -0.98], [s * 0.1, 1.15, -0.88]], 0.016, 0.006, 0xffcd00);
      A.seg([[s * 0.05, 0.96, -1.28], [s * 0.14, 0.94, -1.25], [s * 0.2, 0.9, -1.15]], 0.006, 0.003, 0xffcd00);
    }
    A.gem(0.024, [0, 0.93, -1.26], 0xfff3b0); // 벌린 턱 사이에 문 여의주
    for (let i = 0; i < 4; i++) A.cone(0.025, 0.09, [0, 0.99 + i * 0.005, 0.66 + i * 0.1], 0xffcd00, [-0.5, 0, 0], 3, [0.4, 1, 1]);
    for (const a of [-0.6, 0, 0.6]) A.cone(0.04, 0.22, [0, 1.0, 1.08], a ? 0xffb703 : 0xc1121f, [-1.0, 0, a], 3, [0.4, 1, 1]);
  },
  PH(A, led) { // 카라바오(물소): 각진 머리 + 크게 휜 뿔 + 금 코뚜레 + 태양 광선 꼬리
    A.ico(0.12, [0, 0.97, -1.09], 0x4a4e57, [1.15, 0.9, 1.15]);
    A.ico(0.07, [0, 0.92, -1.21], 0x6b6f78, [1.3, 0.8, 0.9]);
    A.mark(0.05, 0.009, [0, 0.885], 0xfcd116);
    for (const s of [-1, 1]) A.knob(0.012, [s * 0.025, 0.89], 0x1b1b1b, [1, 0.7, 0.6]);
    for (const s of [-1, 1]) {
      A.seg([[s * 0.08, 1.04, -1.08], [s * 0.15, 1.07, -1.07], [s * 0.2, 1.1, -1.03], [s * 0.21, 1.15, -0.98]], 0.028, 0.008, 0xbfb59a); // 머리와 함께 커지므로 짧게 (뒤에서 배달통 옆으로 튀어나오지 않게)
    }
    A.oct(0.035, [0, 0.98, 1.04], 0xfcd116);
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; A.cone(0.022, 0.1, [Math.sin(a) * 0.08, 0.98 + Math.cos(a) * 0.08, 1.05], i % 2 ? 0xfcd116 : 0xffe066, [Math.PI / 2, 0, -a], 3, [1, 1, 0.3]); }
  },
  KH(A, led) { // 나가(코브라): 펼친 각진 후드 + 머리 + 독니 + 갈라진 혀 + 솟은 꼬리
    A.oct(0.16, [0, 1.0, -1.0], 0xcdb68a, [1.4, 1.1, 0.35]);
    for (let i = 0; i < 3; i++) A.blk(0.02, 0.08, 0.01, [-0.06 + i * 0.06, 1.0, -1.06], 0xe8b923, [0, 0, (i - 1) * 0.4]);
    A.oct(0.07, [0, 0.98, -1.14], 0xb59f74, [1, 0.8, 1.5]);
    for (const s of [-1, 1]) A.cone(0.008, 0.04, [s * 0.022, 0.957, -1.19], 0xffffff, [Math.PI, 0, 0], 4); // 머리 아랫면에 박힌 독니
    const tail = [];
    for (let i = 0; i <= 6; i++) { const t = i / 6; tail.push([Math.sin(t * Math.PI * 1.5) * 0.06, 0.93 + t * 0.35, 1.0 + t * 0.12]); }
    A.seg(tail, 0.035, 0.01, 0xcdb68a, 0xb59f74);
    A.cone(0.02, 0.07, tail[tail.length - 1], 0xe8b923, [0, 0, 0], 4);
  },
  MM(A, led) { // 녹색 공작: 각진 머리 + 볏(금 끝) + 부채꼴 꼬리 깃(금 눈알)
    A.blk(0.08, 0.1, 0.08, [0, 0.98, -1.06], 0x2a9df4, [0.4, 0, 0]);
    A.oct(0.06, [0, 1.06, -1.12], 0x1b998b, [0.9, 1, 1.4]);
    A.cone(0.018, 0.07, [0, 1.05, -1.2], 0x9aa0a6, [-Math.PI / 2, 0, 0], 4);
    for (let i = -1.5; i <= 1.5; i += 1) { A.seg([[i * 0.015, 1.1, -1.11], [i * 0.025, 1.19, -1.1]], 0.004, 0.004, 0x1b998b); A.gem(0.012, [i * 0.025, 1.2, -1.1], 0xffd34d); }
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.32;
      A.oct(0.12, [Math.sin(a) * 0.15, 1.0 + Math.cos(a) * 0.15, 1.08], [0x1b998b, 0x2a9df4, 0x34b233][(i + 3) % 3], [0.35, 1, 0.12], [0, 0, -a]);
      A.gem(0.016, [Math.sin(a) * 0.22, 1.0 + Math.cos(a) * 0.22, 1.09], 0xffd34d);
    }
  },
};

// ---------- 동남아 국가대표: 동물 머리 페어링 슈퍼바이크 (무게감 있는 머신)
// 큰 각진 동물 머리가 앞바퀴 위 프런트 페어링이 되고, 갈기·깃털 가닥이 탱크와 옆구리를 따라 뒤로 흐름.
// 가운데는 기어·배기관이 드러난 기계식 엔진, 뒤는 짧게 치켜 올라간 테일. (다리·날개 없이 하나의 머신)
const ANIMAL_PALETTE = {
  SG: { main: 0xf2f2f0, second: 0xc1121f, metal: 0xd9dde1, strand: [0xe9ecef, 0xc9ced3, 0xc1121f] },  // 멀라이언: 펄 화이트 + 레드
  MY: { main: 0xf3901e, second: 0x1b1b1b, metal: 0xd98a2b, strand: [0xf3901e, 0x1b1b1b, 0xfff3e0] },  // 호랑이: 오렌지·블랙·화이트
  ID: { main: 0xb3121f, second: 0x5a0a10, metal: 0xd4a017, strand: [0xb3121f, 0x7a0d16, 0xe6b422] },  // 가루다: 레드 + 골드
  TH: { main: 0xe9e4da, second: 0xd4a017, metal: 0xd4a017, strand: [0xe9e4da, 0xd4a017, 0x1b1d4a] },  // 흰 코끼리: 아이보리 + 골드 + 네이비
  VN: { main: 0xc1121f, second: 0xffcd00, metal: 0xd4a017, strand: [0xc1121f, 0x8b0a18, 0xffcd00] },  // 용: 레드 + 골드
  PH: { main: 0x3d4149, second: 0xe9e2cf, metal: 0xc9ced3, strand: [0x3d4149, 0x0038a8, 0xce1126] },  // 카라바오: 차콜 + 아이보리 뿔
  KH: { main: 0xc8b28a, second: 0xd4a017, metal: 0xd4a017, strand: [0xc8b28a, 0xa8926a, 0xd4a017] },  // 나가: 사암 + 골드
  MM: { main: 0x167a6e, second: 0xe6b422, metal: 0xe6b422, strand: [0x167a6e, 0x2a6fd4, 0xe6b422] },  // 공작: 에메랄드 + 블루 + 골드
};
// 갈기·깃털 가닥: 머리 뒤에서 시작해 몸통을 따라 뒤로 흐르며 가늘어지는 각진 날
function strand(A, pts, r0, c) { A.seg(pts, r0, r0 * 0.25, c); }
function animalMachine(K, code, led) {
  const P = ANIMAL_PALETTE[code];
  const A = facetKit(K.facet, K.glow, { k: 2.3, dz: 0.35, dy: 0.0 });
  // 1) 큰 동물 머리 = 프런트 페어링 (기존 머리 디자인을 2.3배로 앞바퀴 위에) + 꼬리 장식
  ACCENTS[code](A, led);
  A.flush(); // 코·줄무늬를 머리 표면에 붙임
  // 머리 뒤를 감싸는 페어링 칼라(목) — 머리와 탱크를 잇는 무게감 있는 덩어리
  A.ico(0.24, [0, 0.98, -0.62], P.main, [1.0, 0.95, 0.9]);
  A.ico(0.2, [0, 0.82, -0.66], P.second, [1.05, 0.7, 0.85]);
  // 2) 갈기·깃털 가닥: 머리 뒤에서 탱크 위·옆구리로 흘러감
  const S = P.strand;
  for (let i = 0; i < 5; i++) { // 탱크 위로 흐르는 굵은 가닥 (서로 겹쳐 한 덩어리 갈기처럼)
    const x = (i - 2) * 0.06, h = 1.2 - Math.abs(i - 2) * 0.03;
    strand(A, [[x, h, -0.64], [x * 1.1, h - 0.02, -0.42], [x * 1.2, h - 0.08, -0.2], [x * 1.25, h - 0.18, 0.0]], 0.075, S[i % S.length]);
  }
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { // 옆구리로 흐르는 굵은 가닥 (부츠 높이 0.75 위)
    const y = 1.1 - i * 0.09;
    strand(A, [[s * 0.18, y, -0.68], [s * 0.21, y - 0.03, -0.44], [s * 0.2, y - 0.07, -0.2], [s * 0.16, 0.98 - i * 0.045, 0.0]], 0.08, S[(i + (s > 0 ? 1 : 0)) % S.length]);
  }
  // 3) 무게감 있는 탱크 (나라 래핑, 각진) — 라이더 무릎 앞
  K.body.push(sideUV((() => { const g = new THREE.IcosahedronGeometry(0.21, 1); g.scale(1.1, 0.75, 1.5); g.translate(0, 1.0, -0.28); return g.toNonIndexed(); })()));
  // 4) 드러난 기계식 엔진: 블록 + V 실린더 + 측면 기어 + 황동 배기관
  K.det.push(box(0.24, 0.3, 0.46, 0, 0.6, -0.12, 0x24272c));
  for (const [z, rx] of [[-0.28, -0.35], [0.0, 0.35]]) {
    const c = new THREE.CylinderGeometry(0.075, 0.085, 0.26, 10);
    c.rotateX(rx);
    c.translate(0, 0.83, z);
    K.metal.push(paint(c, 0x9aa0a6));
    for (let k = 0; k < 4; k++) { const f = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 10); f.rotateX(rx); f.translate(0, 0.76 + k * 0.045, z + (rx > 0 ? 1 : -1) * k * 0.016); K.det.push(paint(f, 0x3d4148)); }
  }
  for (const s of [-1, 1]) { // 측면 기어 (커버 + 톱니 + 볼트)
    const gx = s * 0.135;
    K.metal.push(cylX(0.11, 0.03, gx, 0.55, 0.06, P.metal, 16));
    for (let t = 0; t < 12; t++) { const a = (t / 12) * Math.PI * 2; K.metal.push(box(0.035, 0.03, 0.03, gx, 0.55 + Math.cos(a) * 0.115, 0.06 + Math.sin(a) * 0.115, P.metal)); }
    K.det.push(cylX(0.05, 0.04, gx, 0.55, 0.06, 0x24272c, 12));
    for (let t = 0; t < 5; t++) { const a = (t / 5) * Math.PI * 2; K.metal.push(cylX(0.012, 0.05, gx, 0.55 + Math.cos(a) * 0.075, 0.06 + Math.sin(a) * 0.075, 0xc9ced3, 6)); }
    K.metal.push(cylX(0.075, 0.025, s * 0.125, 0.58, -0.3, P.metal, 14));
  }
  // 황동·크롬 배기관: 실린더 앞에서 내려와 엔진 아래를 지나 테일 아래 머플러로
  for (const s of [-1, 1]) A.seg([[s * 0.04, 0.8, -0.38], [s * 0.1, 0.62, -0.46], [s * 0.12, 0.4, -0.36], [s * 0.12, 0.34, -0.05], [s * 0.1, 0.38, 0.3]], 0.026, 0.026, P.metal);
  for (const s of [-1, 1]) { const m = new THREE.CylinderGeometry(0.05, 0.065, 0.36, 12); m.rotateX(Math.PI / 2 - 0.25); m.translate(s * 0.1, 0.45, 0.48); K.metal.push(paint(m, P.metal)); }
  // 5) 짧게 치켜 올라간 테일 카울 + 위로 휘는 깃·갈기 (배달통 z 0.44~1.0, y 1.06 아래·뒤만 사용)
  A.seg([[0, 0.9, 0.08], [0, 0.94, 0.4], [0, 0.95, 0.72], [0, 0.98, 0.95]], 0.12, 0.06, P.main);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) strand(A, [[s * 0.08, 0.92 - i * 0.03, 0.4], [s * 0.12, 0.9 - i * 0.04, 0.75], [s * 0.1, 0.96 - i * 0.03, 1.02], [s * 0.06, 1.1 - i * 0.05, 1.16]], 0.04, S[(i + 1) % S.length]);
  // 6) 프런트 흙받이 (머리 아래 바퀴 위) + 휠 림 컬러 링
  A.seg([[0, 0.83, -1.0], [0, 0.88, -0.78], [0, 0.85, -0.55]], 0.07, 0.06, P.second);
  for (const z of [-0.72, 0.7]) K.det.push(paint(new THREE.TorusGeometry(0.29, 0.02, 8, 28).rotateY(Math.PI / 2).translate(0, 0.4, z), P.metal));
}

function nationalSuperbike(K, code, accent) {
  const kit = SEA_NATIONAL[code];
  const rim = kit ? kit.rim : accent ?? 0xffd700;
  const led = kit ? kit.led : 0xffffff;
  const B = (g) => K.body.push(sideUV(g));
  const form = ANIMAL_PALETTE[code];
  if (form) {
    // 동물 머리 페어링 머신 (무게감 있는 슈퍼바이크)
    animalMachine(K, code, led);
  } else {
  // 엔진 (카울 안쪽보다 좁게 → 옆면이 카울 면과 겹치지 않음) + 냉각 핀
  K.det.push(box(0.2, 0.3, 0.5, 0, 0.6, -0.12, 0x2b2e33));
  for (let k = 0; k < 4; k++) K.det.push(box(0.22, 0.012, 0.36, 0, 0.5 + k * 0.05, -0.15, 0x3d4148));
  // 앞 페어링(노즈): 끝이 뾰족하고 위로 갈수록 좁아짐
  B(sideExtrude([[-1.04, 0.9], [-0.98, 1.0], [-0.8, 1.11], [-0.62, 1.15], [-0.5, 1.06], [-0.47, 0.84], [-0.62, 0.7], [-0.92, 0.76]], 0.36, 0.03,
    (z) => lerpT(1, 0.45, (-z - 0.6) / 0.44)));
  // 옆 카울 (엔진 덮개, 무릎 자리는 좁게)
  // 무릎·발 자리(z -0.45 뒤)는 폭을 좁혀 부츠가 카울에 파묻히지 않게
  B(sideExtrude([[-0.6, 0.84], [-0.46, 0.97], [-0.14, 0.95], [0.06, 0.78], [0.04, 0.54], [-0.32, 0.47], [-0.58, 0.6]], 0.3, 0.025,
    (z) => lerpT(1, 0.58, (z + 0.45) / 0.35)));
  // 연료탱크
  B(sideExtrude([[-0.52, 1.03], [-0.42, 1.14], [-0.14, 1.13], [0.02, 1.03], [-0.04, 0.95], [-0.46, 0.95]], 0.34, 0.04,
    (z) => lerpT(0.75, 1, (z + 0.52) / 0.3)));
  // 테일: 배달통 아래로 낮고 날렵하게 뻗음
  B(sideExtrude([[0.05, 0.92], [0.22, 0.99], [0.5, 1.0], [0.96, 0.96], [1.0, 0.91], [0.62, 0.82], [0.2, 0.8]], 0.28, 0.025,
    (z) => lerpT(1, 0.45, (z - 0.1) / 0.9)));
  // 벨리 팬
  B(sideExtrude([[-0.5, 0.5], [0.02, 0.44], [0.05, 0.36], [-0.42, 0.38]], 0.26, 0.02));
  // 윈드스크린 (틴트, 노즈 윗면에서 띄움) + 램에어 흡입구 + LED 헤드램프 2개 + 미러
  K.det.push(paint(sideExtrude([[-0.79, 1.135], [-0.6, 1.29], [-0.56, 1.27], [-0.65, 1.165]], 0.24, 0.008, (z) => lerpT(0.7, 1, (z + 0.8) / 0.25)), 0x2a3d55));
  K.det.push(box(0.09, 0.05, 0.06, 0, 0.88, -1.02, 0x111111));
  for (const s of [-1, 1]) {
    const l = new THREE.BoxGeometry(0.1, 0.022, 0.05);
    l.rotateZ(-s * 0.35);
    l.rotateY(s * 0.4);
    l.translate(s * 0.08, 0.98, -0.99);
    K.glow.push(paint(l, led));
    K.det.push(box(0.012, 0.012, 0.09, s * 0.17, 1.13, -0.66, 0x111111));
    K.det.push(box(0.07, 0.035, 0.02, s * 0.2, 1.15, -0.7, 0x16181c));
  }
  }
  // 풋페그 (부츠 바로 아래, 부츠와 면이 겹치지 않게 아래로 띄움)
  for (const sx of [-1, 1]) {
    K.metal.push(cylX(0.016, 0.12, sx * 0.17, 0.575, -0.12, 0xc9ced3, 8));
    K.det.push(box(0.03, 0.04, 0.03, sx * 0.14, 0.59, -0.12, 0x2b2e33)); // 엔진·냉각핀·부츠 밑창 면에서 띄운 브래킷
  }
  // 골드 도립식 포크 2개 + 앞 흙받이
  // 포크: 앞 차축(z -0.72)에서 핸들 쪽(z -0.56)으로 기울어 올라감
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 0.1, 0.4, -0.72), b = new THREE.Vector3(s * 0.1, 1.0, -0.56);
    const f = new THREE.CylinderGeometry(0.026, 0.032, a.distanceTo(b), 10);
    f.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    f.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    K.metal.push(paint(f, 0xd4a017));
  }
  if (!form) K.body.push(sideUV(sideExtrude([[-0.97, 0.83], [-0.72, 0.91], [-0.48, 0.83], [-0.53, 0.8], [-0.72, 0.87], [-0.94, 0.79]], 0.14, 0.01)));
  // 스윙암 (양쪽) + 체인 가드
  for (const s of [-1, 1]) {
    const a = new THREE.BoxGeometry(0.035, 0.07, 0.7);
    a.rotateX(0.14);
    a.translate(s * 0.12, 0.46, 0.36);
    K.det.push(paint(a, 0x2b2e33));
  }
  // 휠: 포인트 색 5스포크 + 브레이크 디스크 + 캘리퍼
  for (const z of [-0.72, 0.7]) {
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.BoxGeometry(0.03, 0.15, 0.03); // 허브(0.13) 밖 ~ 림 링 안쪽(0.27): 스포크끼리·림 링과 면이 겹치지 않음
      sp.translate(0, 0.195, 0);
      sp.rotateX((i / 5) * Math.PI * 2);
      sp.translate(0, 0.4, z);
      K.det.push(paint(sp, rim));
    }
    for (const s of [-1, 1]) {
      if (z > 0 && s < 0) continue;
      K.metal.push(cylX(0.19, 0.012, s * 0.09, 0.4, z, 0xc9ced3, 24));
      K.det.push(box(0.03, 0.08, 0.06, s * 0.118, 0.55, z + 0.1, rim)); // 디스크 면에서 띄운 캘리퍼
    }
  }
  if (!form) {
    // 티타늄 사이드 머플러 (오른쪽, 위로 치켜 올라감). 동물 형태는 뒷다리 자리라 생략
    const m = new THREE.CylinderGeometry(0.055, 0.07, 0.42, 14);
    m.rotateX(Math.PI / 2 + 0.28);
    m.translate(0.2, 0.62, 0.48);
    K.metal.push(paint(m, 0x7f86a6));
    K.det.push(paint(new THREE.CylinderGeometry(0.046, 0.046, 0.02, 14).rotateX(Math.PI / 2 + 0.28).translate(0.2, 0.68, 0.69), 0x2b2e33));
    K.metal.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8).rotateX(Math.PI / 2 - 0.1).translate(0.16, 0.48, 0.12), 0x9aa0a6));
  }
  // 테일 LED + 검은 번호판 홀더
  K.glow.push(box(0.16, 0.02, 0.02, 0, form ? 0.8 : 0.93, form ? 0.96 : 1.0, 0xff2a2a));
  K.det.push(box(0.15, 0.09, 0.015, 0, 0.74, 0.98, 0x1b1d22, -0.3));
  if (kit && !form) kit.emblem(K.metal, K.glow);
}

// ======================================================================
// 국가대표 배달통: 날렵한 에어로 포드 (옆에서 보면 뒤로 솟은 쐐기형 + 리어 스포일러 + LED 테일)
// 옆면은 나라별 아트(동남아 8개국은 전용 문양, 그 외는 국기) + NATIONAL TEAM 문구
// ======================================================================
const POD = { W: 0.5, BEV: 0.035 };
// 옆 실루엣 (z, y): 라이더 쪽(앞)은 낮고 둥글게, 뒤로 갈수록 높아지는 쐐기
const POD_PROFILE = [[0.44, 1.08], [0.96, 1.08], [1.0, 1.2], [0.98, 1.44], [0.9, 1.53], [0.62, 1.5], [0.47, 1.4], [0.42, 1.26]];
function podShape(pts, sign) {
  const s = new THREE.Shape();
  pts.forEach(([z, y], i) => (i ? s.lineTo(sign * z, y) : s.moveTo(sign * z, y)));
  s.closePath();
  return s;
}
function podShellGeometry() {
  const g = new THREE.ExtrudeGeometry(podShape(POD_PROFILE, -1), {
    depth: POD.W - POD.BEV * 2, bevelEnabled: true, bevelThickness: POD.BEV, bevelSize: POD.BEV * 0.6, bevelSegments: 3, curveSegments: 4,
  });
  g.translate(0, 0, -(POD.W - POD.BEV * 2) / 2);
  g.rotateY(Math.PI / 2); // 모양 x(= -z) → 월드 z, 돌출 → 월드 x
  return g;
}
// 옆면 아트 패널 (실루엣보다 살짝 작게, 면에서 띄움). side: +1 오른쪽 / -1 왼쪽
function podPanelGeometry(side) {
  const cz = 0.7, cy = 1.3;
  const inset = POD_PROFILE.map(([z, y]) => [cz + (z - cz) * 0.9, cy + (y - cy) * 0.86]);
  const g = new THREE.ShapeGeometry(podShape(inset, side > 0 ? -1 : 1));
  // UV: 앞(라이더 쪽) → 뒤 방향이 양쪽 모두 같은 방향으로 읽히게
  const pos = g.attributes.position, uv = g.attributes.uv;
  const zs = inset.map((p) => p[0]), ys = inset.map((p) => p[1]);
  const z0 = Math.min(...zs), z1 = Math.max(...zs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let i = 0; i < pos.count; i++) {
    const z = Math.abs(pos.getX(i)), y = pos.getY(i);
    uv.setXY(i, (z - z0) / (z1 - z0), (y - y0) / (y1 - y0));
  }
  g.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(side * (POD.W / 2 + POD.BEV * 0.6 + 0.006), 0, 0);
  return g;
}
const podTexCache = {};
function nationalPodTexture(code) {
  if (podTexCache[code]) return podTexCache[code];
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    if (SEA_PAINT[code]) SEA_PAINT[code](x, 512, 256);
    else drawFlag(x, code, 512, 256, 0, 0, () => { draw(); tex.needsUpdate = true; });
    // 속도감 사선 + 아래 검은 띠에 NATIONAL TEAM · 나라 이름
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.moveTo(0, 196); x.lineTo(512, 176); x.lineTo(512, 256); x.lineTo(0, 256); x.fill();
    x.fillStyle = '#ffffff';
    x.font = 'bold 34px "Russo One", "Arial Black", sans-serif';
    x.textAlign = 'left'; x.textBaseline = 'middle';
    x.fillText('NATIONAL TEAM', 24, 222, 300);
    x.font = 'bold 22px "Russo One", "Arial Black", sans-serif';
    x.textAlign = 'right';
    x.fillText(String(countryName(code)).toUpperCase(), 496, 224, 170);
  };
  draw();
  podTexCache[code] = tex;
  return tex;
}
// 포드 뒷면 아트: 나라 문양 + 큰 국가 코드 + NATIONAL TEAM (주행 중 가장 많이 보이는 면)
const podBackCache = {};
function nationalPodBackTexture(code) {
  if (podBackCache[code]) return podBackCache[code];
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const x = c.getContext('2d');
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => {
    if (SEA_PAINT[code]) SEA_PAINT[code](x, 512, 320);
    else drawFlag(x, code, 512, 320, 0, 0, () => { draw(); tex.needsUpdate = true; });
    const g = x.createLinearGradient(0, 120, 0, 320);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.75)');
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 320);
    x.fillStyle = '#ffffff';
    x.strokeStyle = 'rgba(0,0,0,0.6)';
    x.lineWidth = 8;
    x.font = 'bold 150px "Russo One", "Arial Black", sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.strokeText(code, 256, 190);
    x.fillText(code, 256, 190);
    x.font = 'bold 34px "Russo One", "Arial Black", sans-serif';
    x.fillText('NATIONAL TEAM', 256, 290, 460);
  };
  draw();
  podBackCache[code] = tex;
  return tex;
}

function nationalPod(code, det, glow, metal, gloss) {
  const [c1, c2] = nationalLivery(code);
  gloss.push(paint(podShellGeometry(), c1));
  // 리어 스포일러 (윙 + 지지대 2개) + 위쪽 레이싱 스트라이프 2줄
  metal.push(box(0.56, 0.02, 0.12, 0, 1.6, 0.93, 0x26292d, 0.18));
  for (const s of [-1, 1]) det.push(box(0.025, 0.08, 0.05, s * 0.17, 1.55, 0.92, 0x26292d));
  for (const s of [-1, 1]) det.push(paint(podShellStripe(s * 0.07), c2));
  // LED 테일 라이트 (뒷면) + 하단 디퓨저
  glow.push(box(0.42, 0.03, 0.02, 0, 1.135, 1.03, 0xff2a2a));
  det.push(box(0.44, 0.05, 0.06, 0, 1.1, 0.97, 0x1b1d22));
  // 레이싱 디퓨저 핀 (뒤 아래 양쪽)
  for (const s of [-1, 1]) det.push(box(0.02, 0.09, 0.1, s * 0.16, 1.135, 1.0, 0x1b1d22));

}
// 위쪽 스트라이프: 실루엣 윗선을 따라가는 얇은 띠
function podShellStripe(x) {
  const top = POD_PROFILE.filter(([, y]) => y > 1.3).sort((a, b) => a[0] - b[0]);
  const parts = [];
  for (let i = 0; i < top.length - 1; i++) {
    const [z0, y0] = top[i], [z1, y1] = top[i + 1];
    const len = Math.hypot(z1 - z0, y1 - y0);
    const g = new THREE.BoxGeometry(0.04, 0.012, len);
    g.rotateX(-Math.atan2(y1 - y0, z1 - z0));
    g.translate(x, (y0 + y1) / 2 + 0.034, (z0 + z1) / 2);
    parts.push(g);
  }
  return merge(parts);
}

// 바이크 차종별 외형 (config.js BIKES[].style)
function bikeShape(style, body, det, glow, accent) {
  if (style === 'classic') {
    const lamp = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(0, 0.92, -0.72);
    det.push(paint(lamp, 0xd9dde1));
    for (const z of [-0.72, 0.7]) det.push(box(0.16, 0.04, 0.5, 0, 0.74, z, 0xd9dde1));
    det.push(box(0.37, 0.07, 0.48, 0, 1.03, 0.21, 0x7a4a22)); // 가죽 안장: 차체(폭 0.34)보다 넓게 → 옆면이 차체 옆면과 겹치지 않음
  } else if (style === 'express') {
    for (const sx of [-1, 1]) det.push(box(0.16, 0.36, 0.5, sx * 0.34, 0.78, 0.55, 0x2b2f33));
    det.push(box(0.5, 0.04, 0.5, 0, 1.04, 0.66, 0x55595e));
  } else if (style === 'sport') {
    body.push(box(0.4, 0.3, 0.62, 0, 0.82, -0.3, null, -0.35));
    det.push(box(0.26, 0.16, 0.04, 0, 1.08, -0.62, 0x1a2a3a, -1.1));
  } else if (style === 'enduro') {
    for (const z of [-0.78, 0.72]) body.push(box(0.14, 0.04, 0.42, 0, 0.82, z, null, z < 0 ? 0.25 : -0.25));
    det.push(box(0.7, 0.05, 0.05, 0, 1.16, -0.5, 0x1a1a1a));
    body.push(box(0.2, 0.2, 0.3, 0, 0.9, 0.62, null, -0.4));
  } else if (style === 'cyber') {
    const neon = accent ?? 0x00e5ff;
    for (const sx of [-1, 1]) glow.push(box(0.025, 0.04, 0.9, sx * 0.235, 0.78, -0.1, neon));
    glow.push(box(0.3, 0.03, 0.03, 0, 0.98, -0.68, neon));
    for (const z of [-0.72, 0.7]) glow.push(cylX(0.2, 0.15, 0, 0.4, z, 0xff2fd6, 14));
    body.push(box(0.42, 0.26, 0.9, 0, 0.84, -0.15, null, -0.2));
  }
}

// opts: { box, outfit, helmet } — 차고에서 고른 커스텀 파츠
export function createBike(color, opts = {}) {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const ext = models.instantiate('bike');
  if (ext) {
    // 외부 바이크 모델(라이더 포함)을 통째로 사용
    lean.add(ext);
    const flame = makeFlame();
    lean.add(flame);
    root.add(shadow(0.9, 2.2));
    return { root, lean, bodyMat: new THREE.MeshLambertMaterial({ color }), flame };
  }
  let bodyMat;
  // 국가대표: 공통 슈퍼바이크 차체. 동남아 8개국은 나라별 전용 래핑, 그 외 나라는 국기 래핑
  const seaKit = opts.national ? SEA_NATIONAL[opts.nationalCode] : null;
  const superbike = Boolean(opts.national);
  if (seaKit) {
    bodyMat = new THREE.MeshStandardMaterial({ map: seaWrapTexture(opts.nationalCode), roughness: 0.32, metalness: seaKit.metal, envMap: envTexture(), envMapIntensity: 1.1, flatShading: true });
  } else if (opts.national && opts.nationalCode) {
    // 국가대표: 국기 + 레이싱 패턴 풀 바디 래핑
    bodyMat = new THREE.MeshStandardMaterial({ map: nationalWrapTexture(opts.nationalCode, opts.accent ?? 0xffd700), roughness: 0.3, metalness: 0.2, envMap: envTexture(), envMapIntensity: 1.1 });
  } else if (opts.paint) {
    bodyMat = paintMaterial(opts.paint.hex, opts.paint.finish);
  } else {
    bodyMat = new THREE.MeshLambertMaterial({ color });
  }
  const bikeTail = tailMat.clone(); // 내 바이크 전용 (브레이크 시 밝아짐)
  const body = [], det = [], head = [], tail = [], glow = [];
  const out = OUTFIT_STYLES[opts.outfit] || OUTFIT_STYLES.jacket;
  const hel = HELMET_STYLES[opts.helmet] || HELMET_STYLES.basic;
  const gloss = [], metal = []; // 광택(헬멧 쉘·바이저·일부 배달통) / 금속 반사(골드·크롬·국가대표 장식)
  const facet = []; // 각진 동물 머리·꼬리 (플랫 셰이딩)
  if (superbike) nationalSuperbike({ body, det, glow, metal, gloss, facet }, opts.nationalCode, opts.accent);
  else bikeShape(opts.style || 'scooter', body, det, glow, opts.accent);
  const JACKET = out.top;
  const PANTS = out.pants;

  for (const z of [-0.72, 0.7]) {
    const t = superbike ? new THREE.TorusGeometry(0.29, 0.125, 10, 24) : new THREE.TorusGeometry(0.3, 0.1, 8, 18); // 국가대표: 두꺼운 타이어
    t.rotateY(Math.PI / 2);
    t.translate(0, 0.4, z);
    det.push(paint(t, 0x111111));
    det.push(cylX(0.13, 0.14, 0, 0.4, z, 0x8a8f96, 10));
  }
  // 엔진: 윗면(0.72)·앞면(z -0.23)이 부츠 윗면(0.74)·밑창 앞면(-0.25)과 같은 평면이 되지 않게
  if (!superbike) det.push(box(0.28, 0.3, 0.58, 0, 0.57, 0.06, 0x3a3a3a));
  if (!superbike) {
    // 기본 머플러·포크 (국가대표 슈퍼바이크는 전용 티타늄 머플러·골드 포크)
    const ex = new THREE.CylinderGeometry(0.06, 0.085, 0.75, 8);
    ex.rotateX(Math.PI / 2);
    ex.translate(0.2, 0.47, 0.5);
    det.push(paint(ex, 0xc0c4c8));
    const fork = new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6);
    fork.rotateX(-0.45);
    fork.translate(0, 0.74, -0.58);
    det.push(paint(fork, 0x666666));
  }
  det.push(box(0.3, 0.08, 0.42, 0, superbike ? 1.065 : 1.0, 0.22, 0x161616));
  det.push(box(0.64, 0.045, 0.045, 0, 1.06, -0.5, 0x222222));
  if (!superbike) {
    // 기본 차체
    det.push(box(0.3, 0.2, 0.04, 0, 1.15, -0.62, 0x223344, -0.9));
    body.push(box(0.38, 0.42, 0.5, 0, 0.88, -0.42, null, -0.5));
    body.push(box(0.34, 0.22, 0.5, 0, 0.96, -0.06, null, 0.1));
    body.push(box(0.28, 0.16, 0.5, 0, 0.94, 0.52, null, -0.25));
  }

  // 라이더 (의상 + 헤드기어)
  rider(det, glow, out);
  const helmetShell = [];
  headgear(det, glow, hel, opts.helmetPaint, helmetShell, { gloss, metal });

  // 배달 박스 (뒷좌석 랙 위) — 외부 'box' 모델이 있으면 그것으로 교체
  const extBox = models.instantiate('box');
  if (!extBox) deliveryBox(det, glow, opts.box, { gloss, metal }, opts.box === 'national' ? opts.nationalCode : null);
  const nationalBox = !extBox && opts.box === 'national' && opts.nationalCode;

  head.push(box(0.18, 0.12, 0.05, 0, 0.92, -0.7));
  tail.push(box(0.16, 0.06, 0.04, 0, 1.0, 0.78));

  const bodyGeo = merge(body);
  lean.add(
    new THREE.Mesh(bodyGeo, bodyMat),
    new THREE.Mesh(merge(det), vcMat),
    new THREE.Mesh(merge(head), headMat),
    new THREE.Mesh(merge(tail), bikeTail),
  );
  if (glow.length) lean.add(new THREE.Mesh(merge(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  if (gloss.length) lean.add(new THREE.Mesh(merge(gloss), glossMat()));
  if (metal.length) lean.add(new THREE.Mesh(merge(metal), metalMat()));
  if (facet.length) lean.add(new THREE.Mesh(merge(facet), facetMat()));
  // 네온 바이크: 차체 후광
  if (opts.paint && opts.paint.finish === 'neon' && !opts.national) lean.add(neonHalo(bodyGeo, opts.paint.hex, new THREE.Vector3(0, 0.88, -0.15), 1.1));
  // 메탈릭·네온 헤드기어 쉘
  if (helmetShell.length && opts.helmetPaint) {
    const hg = merge(helmetShell);
    lean.add(new THREE.Mesh(hg, paintMaterial(opts.helmetPaint.hex, opts.helmetPaint.finish)));
    if (opts.helmetPaint.finish === 'neon') lean.add(neonHalo(hg, opts.helmetPaint.hex, new THREE.Vector3(0, 1.6, -0.19), 1.14));
  }
  if (extBox) {
    extBox.position.set(0, 1.05, 0.68);
    lean.add(extBox);
  }
  const flame = makeFlame();
  lean.add(flame);
  // 브레이크 시 후미등(스톱램프) 글로우
  if (opts.flag) lean.add(flagDecals(opts.flag, Boolean(extBox), superbike));
  if (nationalBox) {
    // 국가대표 에어로 포드 옆면: 나라 아트 + NATIONAL TEAM (실루엣 모양 패널, 면에서 띄움)
    const m = new THREE.MeshStandardMaterial({
      map: nationalPodTexture(opts.nationalCode), roughness: 0.35, metalness: 0.15, envMap: envTexture(), envMapIntensity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    for (const sd of [-1, 1]) lean.add(new THREE.Mesh(podPanelGeometry(sd), m));
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.25), new THREE.MeshStandardMaterial({
      map: nationalPodBackTexture(opts.nationalCode), roughness: 0.35, metalness: 0.15, envMap: envTexture(), envMapIntensity: 0.8,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    }));
    back.position.set(0, 1.315, 1.025);
    back.rotation.x = -0.083;
    lean.add(back);
  }
  const brakeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  brakeGlow.position.set(0, 1.0, 0.82);
  brakeGlow.scale.set(1.6, 1.0, 1);
  lean.add(brakeGlow);
  root.add(shadow(0.9, 2.2));
  return { root, lean, bodyMat, flame, tailMat: bikeTail, brakeGlow };
}

// 국가 1위 전용 국기: 헬멧 스티커 + 차체 데칼 + 배달 상자 깃발
function flagDecals(code, extBox, noBody = false) {
  const grp = new THREE.Group();
  const decalMat = new THREE.MeshBasicMaterial({
    map: flagTexture(code), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const decal = (w, h, x, y, z, ry, rx = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), decalMat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0, 'YXZ');
    grp.add(m);
  };
  for (const sx of [-1, 1]) {
    decal(0.13, 0.087, sx * 0.192, 1.62, -0.17, sx * Math.PI / 2); // 헬멧 옆면
    if (!noBody) decal(0.3, 0.2, sx * 0.173, 0.97, -0.06, sx * Math.PI / 2, -0.1); // 시트 아래 차체 (국가대표 슈퍼바이크는 래핑이 있어 생략)
  }
  // 상자 뒤 모서리의 깃대 + 깃발
  // 낮은 깃대: 상자 옆 뒤 모서리에 붙여 상자 위로 살짝만 솟게 (너무 높으면 시야를 가림)
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.44, 6), new THREE.MeshLambertMaterial({ color: 0xd0d4d8 }));
  const top = extBox ? 1.7 : 1.59;
  pole.position.set(0.305, top - 0.08, 0.9);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.27, 0.18).translate(0.135, 0, 0), new THREE.MeshBasicMaterial({ map: flagTexture(code), side: THREE.DoubleSide }));
  cloth.rotation.y = -Math.PI / 2 + 0.25; // 주행 반대 방향(+z, 뒤쪽)으로 휘날림
  cloth.position.set(0.305, top + 0.04, 0.9);
  grp.add(pole, cloth);
  grp.userData.cloth = cloth;
  return grp;
}

let _glowTex = null;
function glowTexture() {
  if (_glowTex) return _glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}

function makeFlame() {
  const flameGeo = new THREE.ConeGeometry(0.11, 0.9, 8);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.45);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
    color: 0x66d9ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.position.set(0.2, 0.47, 0.85);
  flame.visible = false;
  return flame;
}

// 멀티플레이 상대 고스트: 반투명 단색 라이더
export function createGhost(color = 0x7ad7ff) {
  const b = createBike(color, {});
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.38, depthWrite: false });
  b.root.traverse((o) => { if (o.isMesh) o.material = mat; });
  return b;
}

// ---------- 도로변 소품 (인스턴싱용 단일 지오메트리)
export function treeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 1.6, 6);
  trunk.translate(0, 0.8, 0);
  const c1 = new THREE.ConeGeometry(1.4, 2.8, 7);
  c1.translate(0, 2.7, 0);
  const c2 = new THREE.ConeGeometry(1.0, 2.1, 7);
  c2.translate(0, 3.9, 0);
  return merge([paint(trunk, 0x6b4a2f), paint(c1, 0x2f7d3a), paint(c2, 0x3f9a48)]);
}

export function lampPoleGeometry() {
  const pole = new THREE.CylinderGeometry(0.09, 0.13, 7.2, 6);
  pole.translate(0, 3.6, 0);
  return merge([paint(pole, 0x7a7f86), box(1.8, 0.09, 0.09, -0.85, 7.15, 0, 0x7a7f86)]);
}

export function lampHeadGeometry() {
  return box(0.75, 0.14, 0.34, -1.65, 7.06, 0);
}

export function buildingGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1);
  // 지붕(+y)·바닥(-y) 면은 창문 없는 텍스처 모서리(벽색)만 쓰도록 UV 를 한 점으로 모음
  const uv = g.attributes.uv;
  for (let i = 8; i < 16; i++) uv.setXY(i, 0.02, 0.99);
  g.translate(0, 0.5, 0);
  return g;
}

export function coneGeometry() {
  const base = box(0.55, 0.06, 0.55, 0, 0.03, 0, 0x222222);
  const cone = new THREE.ConeGeometry(0.24, 0.75, 10);
  cone.translate(0, 0.43, 0);
  const band = new THREE.CylinderGeometry(0.15, 0.18, 0.12, 10);
  band.translate(0, 0.48, 0);
  return merge([base, paint(cone, 0xff6a00), paint(band, 0xf5f5f5)]);
}

// ---------- 도로 돌발 위험 요소
// 공사 포트홀: 울퉁불퉁한 검은 구멍 + 부서진 아스팔트 조각
export function potholeGeometry() {
  const hole = new THREE.CircleGeometry(0.7, 14);
  const pos = hole.attributes.position;
  for (let i = 1; i < pos.count; i++) {
    const k = 0.75 + ((i * 37) % 11) / 30;
    pos.setXY(i, pos.getX(i) * k, pos.getY(i) * (k * 0.85));
  }
  hole.rotateX(-Math.PI / 2);
  hole.translate(0, 0.02, 0);
  const parts = [paint(hole.toNonIndexed(), 0x141414)];
  for (const [x, z, r] of [[0.75, 0.2, 0.12], [-0.6, -0.45, 0.1], [0.2, -0.7, 0.09]]) {
    const chip = new THREE.DodecahedronGeometry(r, 0);
    chip.translate(x, r * 0.5, z);
    parts.push(paint(chip, 0x4a4a4a));
  }
  return merge(parts);
}

// 열린 맨홀: 검은 구멍 + 옆으로 밀려난 뚜껑 + 경고 링
export function manholeGeometry() {
  const hole = new THREE.CircleGeometry(0.55, 18).rotateX(-Math.PI / 2).translate(0, 0.025, 0);
  const rim = new THREE.RingGeometry(0.55, 0.68, 18).rotateX(-Math.PI / 2).translate(0, 0.03, 0);
  const cover = new THREE.CylinderGeometry(0.55, 0.55, 0.06, 18).translate(0.75, 0.05, 0.55);
  const tape = new THREE.TorusGeometry(0.85, 0.035, 4, 20).rotateX(-Math.PI / 2).translate(0, 0.45, 0);
  const posts = [0, 1, 2, 3].map((i) => {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    return box(0.06, 0.5, 0.06, Math.cos(a) * 0.85, 0.25, Math.sin(a) * 0.85, 0xff6a00);
  });
  return merge([paint(hole.toNonIndexed(), 0x050505), paint(rim.toNonIndexed(), 0x6c757d), paint(cover, 0x3d4247), paint(tape, 0xff6a00), ...posts]);
}

// 트럭에서 떨어진 화물 상자 더미
export function cargoGeometry() {
  return merge([
    box(0.9, 0.6, 0.7, -0.15, 0.3, 0, 0xc68b59),
    box(0.62, 0.5, 0.55, 0.35, 0.25, 0.25, 0xb07a4b),
    box(0.55, 0.45, 0.5, -0.05, 0.83, -0.05, 0xd4a373, 0.3),
    box(0.92, 0.08, 0.12, -0.15, 0.61, 0, 0xe9d8a6),
    box(0.57, 0.07, 0.12, -0.05, 1.06, -0.05, 0xe9d8a6, 0.3),
  ]);
}

// 독립 점프대: 노란/검정 경사로 + 황금색 네온 안내선 (낮은 쪽이 라이더 방향 +z, 높은 쪽 -z)
export const JUMP_RAMP = { width: 2.8, length: 5, height: 1.1 };
export function createJumpRamp() {
  const { width: W, length: L, height: H } = JUMP_RAMP;
  const grp = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(L, 0);
  shape.lineTo(L, H);
  shape.closePath();
  const wedge = new THREE.ExtrudeGeometry(shape, { depth: W, bevelEnabled: false });
  wedge.rotateY(Math.PI / 2); // 모양의 x(길이) → -z
  wedge.translate(-W / 2, 0, 0);
  const body = new THREE.Mesh(wedge, new THREE.MeshLambertMaterial({ color: 0xffc300 }));
  // 경사면 위 안내선 (경사 각도에 맞춰 눕힘)
  const slope = Math.atan2(H, L);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xffd700 });
  const len = Math.hypot(L, H);
  const lines = [];
  for (const x of [-W / 2 + 0.18, W / 2 - 0.18, 0]) {
    const g = new THREE.BoxGeometry(x === 0 ? 0.08 : 0.14, 0.04, len);
    g.rotateX(slope);
    g.translate(x, H / 2 + 0.03, -L / 2);
    lines.push(g);
  }
  // 셰브론(진행 방향 화살표)
  for (let i = 0; i < 3; i++) {
    for (const sx of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.9, 0.04, 0.12);
      g.rotateY(sx * 0.6);
      g.rotateX(slope);
      const t = 0.25 + i * 0.25;
      g.translate(sx * 0.35, H * t + 0.04, -L * t - sx * 0.0);
      lines.push(g);
    }
  }
  const neon = new THREE.Mesh(merge(lines), lineMat);
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.6, L + 0.8).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffd700, transparent: true, opacity: 0.18, depthWrite: false }));
  glow.position.set(0, 0.03, -L / 2);
  grp.add(glow, body, neon);
  grp.neon = lineMat;
  return grp;
}

// 배달 드롭존: 도로 가장자리 반투명 구역 + "DROP ZONE" 라벨
let dropTex = null;
function dropTexture() {
  if (dropTex) return dropTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.55)';
  x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#39ff88';
  x.font = 'bold 38px "Russo One", "Arial Black", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText('DROP ZONE', 128, 34, 240);
  dropTex = new THREE.CanvasTexture(c);
  dropTex.colorSpace = THREE.SRGBColorSpace;
  return dropTex;
}
export const DROP_ZONE = { width: 2.0, length: 8 };
export function createDropZone() {
  const grp = new THREE.Group();
  const area = new THREE.Mesh(
    new THREE.PlaneGeometry(DROP_ZONE.width, DROP_ZONE.length).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.28, depthWrite: false }),
  );
  area.position.y = 0.04;
  area.renderOrder = 1;
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x39ff88 });
  const edges = [
    [DROP_ZONE.width, 0.06, 0, -DROP_ZONE.length / 2], [DROP_ZONE.width, 0.06, 0, DROP_ZONE.length / 2],
    [0.06, DROP_ZONE.length, -DROP_ZONE.width / 2, 0], [0.06, DROP_ZONE.length, DROP_ZONE.width / 2, 0],
  ].map(([w, l, x, z]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2), edgeMat);
    m.position.set(x, 0.05, z);
    return m;
  });
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: dropTexture(), transparent: true, depthWrite: false }));
  label.scale.set(2.6, 0.65, 1);
  label.position.set(0, 1.9, 0);
  const beam = new THREE.Mesh(
    new THREE.BoxGeometry(DROP_ZONE.width, 1.4, DROP_ZONE.length),
    new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.07, depthWrite: false }),
  );
  beam.position.y = 0.7;
  grp.add(area, ...edges, beam, label);
  grp.area = area;
  return grp;
}

export function coinGeometry() {
  const g = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 20);
  g.rotateX(Math.PI / 2);
  return g;
}

export function createRails(len, zCenter) {
  // 인도 경계석(연석) + 보도블록 띠
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(box(0.35, 0.22, len, s * 8.7, 0.11, zCenter, 0xd9d9d9));
    parts.push(box(4.6, 0.12, len, s * 11.2, 0.06, zCenter, 0xa9a39a));
  }
  return new THREE.Mesh(merge(parts), vcMat);
}

// ---------- 인도네시아 도심 배경 (인스턴싱용)
export function palmGeometry() {
  const parts = [];
  // 살짝 휘어진 줄기 (마디 6개)
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.CylinderGeometry(0.15 - i * 0.01, 0.19 - i * 0.01, 1.05, 7);
    const nx = x + 0.08 + i * 0.03;
    seg.rotateZ(-Math.atan2(nx - x, 1));
    seg.translate((x + nx) / 2, y + 0.5, 0);
    parts.push(paint(seg, i % 2 ? 0x8b6b47 : 0x7a5c3c));
    x = nx;
    y += 1.0;
  }
  // 잎 9장: 아래로 처지는 납작한 박스
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const leaf = new THREE.BoxGeometry(2.6, 0.05, 0.5);
    leaf.translate(1.3, 0, 0);
    leaf.rotateZ(-0.45 - (i % 3) * 0.12);
    leaf.rotateY(a);
    leaf.translate(x, y + 0.05, 0);
    parts.push(paint(leaf, i % 2 ? 0x2f8f3a : 0x3fa14a));
  }
  for (let i = 0; i < 3; i++) {
    const nut = new THREE.SphereGeometry(0.16, 6, 5);
    nut.translate(x + Math.cos(i * 2.1) * 0.2, y - 0.2, Math.sin(i * 2.1) * 0.2);
    parts.push(paint(nut, 0x5b4022));
  }
  return merge(parts);
}

// Ruko(상가주택): 정면이 +X 를 향함. 인스턴스 색으로 외벽 색 변화
export function rukoGeometry() {
  const W = 6, L = 10, H = 8.5; // x 깊이, z 폭, 높이
  const p = [];
  p.push(box(W, H, L, 0, H / 2, 0, 0xf4efe6));
  const roof = new THREE.BoxGeometry(W + 0.6, 0.25, L + 0.4);
  roof.rotateZ(0.22);
  roof.translate(0, H + 0.55, 0);
  p.push(paint(roof, 0xd07a4a));
  // 옥상: 주황색 물탱크(토렌) + TV 안테나
  { const tank = new THREE.CylinderGeometry(0.45, 0.45, 0.9, 10); tank.translate(-1.2, H + 1.2, -2.6); p.push(paint(tank, 0xf77f00)); }
  p.push(box(0.9, 0.12, 0.9, -1.2, H + 0.72, -2.6, 0x555555));
  { const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4); pole.translate(-1.8, H + 1.5, 2.4); p.push(paint(pole, 0x888888)); }
  p.push(box(0.04, 0.04, 0.9, -1.8, H + 2.1, 2.4, 0x888888));
  for (let k = 0; k < 3; k++) {
    const z = -L / 2 + L / 6 + (k * L) / 3;
    // 1층 셔터 + 간판
    p.push(box(0.1, 2.6, 2.7, W / 2 + 0.04, 1.3, z, 0x9aa2ab));
    for (let r = 0; r < 3; r++) p.push(box(0.12, 0.05, 2.7, W / 2 + 0.06, 0.5 + r * 0.75, z, 0x7f8790));
    p.push(box(0.2, 0.75, 3.0, W / 2 + 0.12, 3.15, z, [0xe63946, 0x2a9df4, 0xffc400][k]));
    p.push(box(0.12, 0.3, 2.0, W / 2 + 0.24, 3.15, z, 0xffffff));
    // 2층 창 + 발코니
    p.push(box(0.08, 1.4, 1.1, W / 2 + 0.04, 5.2, z - 0.7, 0x2b3a4a));
    p.push(box(0.08, 1.4, 1.1, W / 2 + 0.04, 5.2, z + 0.7, 0x2b3a4a));
    p.push(box(0.7, 0.12, 3.0, W / 2 + 0.35, 4.2, z, 0xbfb6a8));
    // 처마
    const eave = new THREE.BoxGeometry(1.4, 0.08, 3.2);
    eave.rotateZ(-0.25);
    eave.translate(W / 2 + 0.65, 2.75, z);
    p.push(paint(eave, 0x8a5a3c));
  }
  return merge(p);
}

// Warung(간이 식당/구멍가게): 정면 +X
export function warungGeometry() {
  const p = [];
  p.push(box(2.6, 1.0, 3.2, 0, 0.5, 0, 0x9c6b3e));
  p.push(box(2.7, 0.1, 3.3, 0, 1.05, 0, 0xd9c6a5));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.1, 2.4, 0.1, sx * 1.25, 1.2, sz * 1.55, 0x5a4632));
  const roof = new THREE.BoxGeometry(3.4, 0.08, 3.8);
  roof.rotateZ(-0.18);
  roof.translate(0.2, 2.5, 0);
  p.push(paint(roof, 0x2a7fd4));
  p.push(box(0.06, 0.55, 3.0, 1.32, 1.95, 0, 0xffc400));
  // 진열 병/과자
  for (let i = 0; i < 6; i++) p.push(box(0.18, 0.3, 0.18, 0.9, 1.25, -1.2 + i * 0.48, [0xe63946, 0x2ec27e, 0xff8800][i % 3]));
  return merge(p);
}

// ======================================================================
// 국가별 테마 소품 (인스턴싱용, 정면 +X)
// ======================================================================
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true }); // 네온/간판 (항상 밝음)

const NEON = [0xff2d95, 0x00e5ff, 0xffe600, 0x7cff4f, 0xff7a00, 0xb15cff];

// 각 스타일: { base, glow? } — base 는 vcMat, glow 는 glowMat 으로 렌더
export function buildingStyle(style) {
  const W = 6, L = 10, b = [], g = [];
  const face = W / 2;
  if (style === 'ruko') return { base: rukoGeometry(), glow: null };
  if (style === 'tube') {
    // 하노이 튜브하우스: 좁고 높은 집 2채 + 녹색 덧창 + 홍등
    for (const [z, h, c] of [[-2.5, 11, 0xf2c14e], [2.5, 9.5, 0xe9d8a6]]) {
      b.push(box(W, h, 4.8, 0, h / 2, z, c));
      for (let fl = 1; fl * 3 + 1.5 < h; fl++) { // 창 위쪽(층*3+1.3)이 지붕(h) 아래에 있는 층만
        b.push(box(0.1, 1.4, 1.1, face + 0.04, fl * 3 + 0.6, z - 1, 0x2d6a4f));
        b.push(box(0.1, 1.4, 1.1, face + 0.04, fl * 3 + 0.6, z + 1, 0x2d6a4f));
        b.push(box(0.6, 0.1, 3.8, face + 0.3, fl * 3 - 0.3, z, 0x9c6644));
      }
      b.push(box(0.12, 2.4, 3.6, face + 0.05, 1.2, z, 0x6c757d));
      for (const lz of [z - 1.4, z + 1.4]) g.push(paint(new THREE.SphereGeometry(0.28, 8, 6).translate(face + 0.55, 2.9, lz), 0xff3b30));
      g.push(box(0.15, 0.7, 3.4, face + 0.12, 3.4, z, 0xd00000));
      // 옥상: 스테인리스 물탱크 + 화분
      { const t = new THREE.CylinderGeometry(0.35, 0.35, 1.0, 10); t.rotateX(Math.PI / 2); t.translate(-1, h + 0.45, z); b.push(paint(t, 0xc9ced3)); }
      for (const pz of [z - 1.6, z + 1.6]) b.push(paint(new THREE.SphereGeometry(0.35, 6, 5).translate(1.8, h + 0.35, pz), 0x2d6a4f));
    }
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'neon') {
    // 서울/도쿄 번화가: 높은 빌딩 + 세로/가로 네온 간판
    const h = 22;
    b.push(box(W, h, L, 0, h / 2, 0, 0x2a2d3e));
    for (let fl = 0; fl < 7; fl++) b.push(box(0.06, 1.6, L * 0.9, face + 0.03, 3 + fl * 2.8, 0, 0x3d5a80));
    for (let k = 0; k < 3; k++) {
      const z = -3.3 + k * 3.3;
      g.push(paint(box(0.25, 6 + k, 0.9, face + 0.5, 6 + k * 1.5, z), NEON[(k * 2) % NEON.length]));
      g.push(paint(box(0.2, 0.7, 2.6, face + 0.2, 2.9 + k * 0.1, z), NEON[(k * 2 + 1) % NEON.length]));
    }
    g.push(paint(box(0.2, 1.2, L * 0.8, face + 0.15, h - 2, 0), 0xffffff));
    // 옥상: 실외기 줄 + 옥상 광고판 프레임 + 안테나
    for (let k = 0; k < 3; k++) b.push(box(0.9, 0.6, 0.9, -1.5, h + 0.3, -3 + k * 1.4, 0x9aa3ad));
    b.push(box(0.2, 2.4, 5, 1.6, h + 1.6, 1.5, 0x1d2230));
    for (const pz of [-0.6, 3.6]) b.push(box(0.15, 1.6, 0.15, 1.6, h + 0.8, pz, 0x55595e));
    g.push(paint(box(0.22, 1.9, 4.6, 1.72, h + 1.6, 1.5), NEON[3 % NEON.length]));
    { const pole = new THREE.CylinderGeometry(0.04, 0.04, 3, 4); pole.translate(-2, h + 1.5, 3.5); b.push(paint(pole, 0x777777)); }
    g.push(paint(new THREE.SphereGeometry(0.12, 6, 4).translate(-2, h + 3.05, 3.5), 0xff3b30));
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'modern') {
    // 싱가포르: 흰색 미래형 타워 + 층마다 정원
    const h = 26;
    b.push(box(W * 0.9, h, L * 0.9, 0, h / 2, 0, 0xe9f1f2));
    for (let fl = 0; fl < 8; fl++) {
      b.push(box(0.05, 2.2, L * 0.86, face * 0.9 + 0.03, 2 + fl * 3, 0, 0x7fb7be));
      b.push(box(1.0, 0.35, L * 0.9, face * 0.9 + 0.4, 3.3 + fl * 3, 0, 0x52b788));
    }
    g.push(paint(box(0.1, 0.25, L * 0.88, face * 0.9 + 0.05, h - 0.5, 0), 0x9bf6ff));
    // 옥상 정원: 나무 + 유리 난간
    for (const [tx, tz] of [[-1, -2.5], [0.8, 0.5], [-0.6, 3]]) {
      b.push(paint(new THREE.CylinderGeometry(0.08, 0.1, 0.9, 5).translate(tx, h + 0.45, tz), 0x6b4f2a));
      b.push(paint(new THREE.IcosahedronGeometry(0.7, 0).translate(tx, h + 1.2, tz), 0x40916c));
    }
    g.push(paint(box(0.06, 0.6, L * 0.86, face * 0.9 - 0.05, h + 0.3, 0), 0xcfefff));
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'brick') {
    // 뉴욕: 붉은 벽돌 + 비상계단 + 옥상 물탱크 + 1층 상점 차양
    const h = 15;
    b.push(box(W, h, L, 0, h / 2, 0, 0x9b3d2e));
    for (let fl = 0; fl < 4; fl++) for (let k = 0; k < 3; k++) b.push(box(0.06, 1.5, 1.6, face + 0.03, 4.5 + fl * 2.7, -3.3 + k * 3.3, 0x23303d));
    for (let fl = 0; fl < 4; fl++) b.push(box(0.9, 0.08, 2.2, face + 0.45, 3.8 + fl * 2.7, 2, 0x222222));
    b.push(box(0.05, 10.8, 0.06, face + 0.85, 8.9, 3.05, 0x222222));
    b.push(box(1.2, 0.12, L * 0.9, face + 0.6, 3.1, 0, 0x2a9d8f));
    const tank = new THREE.CylinderGeometry(1.1, 1.1, 2.2, 10);
    tank.translate(-0.5, h + 2.1, -2);
    b.push(paint(tank, 0x7f5539));
    g.push(paint(box(0.15, 0.6, 3, face + 0.1, 2.4, -2.5), 0xff595e));
    // 옥상: 실외기 + 난간
    for (const pz of [1, 3]) b.push(box(1.0, 0.7, 1.0, 1, h + 0.35, pz, 0xa0a7ae));
    b.push(box(W, 0.5, 0.15, 0, h + 0.25, L / 2 - 0.08, 0x7f2f22));
    b.push(box(W, 0.5, 0.15, 0, h + 0.25, -L / 2 + 0.08, 0x7f2f22));
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'haussmann') {
    // 파리: 크림색 석조 + 철제 발코니 + 슬레이트 맨사드 지붕 + 노천 카페 차양
    const h = 14;
    b.push(box(W, h, L, 0, h / 2, 0, 0xefe2c4));
    const roof = new THREE.BoxGeometry(W, 2.6, L);
    roof.translate(0, h + 1.2, 0);
    b.push(paint(roof, 0x5c6b7a));
    for (let fl = 0; fl < 4; fl++) {
      for (let k = 0; k < 4; k++) b.push(box(0.06, 1.7, 1.2, face + 0.03, 4.2 + fl * 2.6, -3.75 + k * 2.5, 0x2b3a4a));
      b.push(box(0.55, 0.08, L * 0.92, face + 0.28, 3.4 + fl * 2.6, 0, 0x1f1f1f));
    }
    for (let k = 0; k < 5; k++) {
      const aw = new THREE.BoxGeometry(1.6, 0.06, 1.9);
      aw.rotateZ(-0.3);
      aw.translate(face + 0.8, 2.8, -4 + k * 2);
      b.push(paint(aw, k % 2 ? 0xc1121f : 0xffffff));
    }
    g.push(paint(box(0.12, 0.45, 3.2, face + 0.08, 3.25, 0), 0xffd166));
    // 맨사드 지붕 위 굴뚝 + 다락 창
    for (const pz of [-3.2, 0.2, 3.4]) {
      b.push(box(0.7, 1.4, 0.9, -1.2, h + 3.1, pz, 0xb5651d));
      b.push(box(0.8, 0.12, 1.0, -1.2, h + 3.85, pz, 0x6c4a2f));
    }
    for (let k = 0; k < 3; k++) b.push(box(0.3, 0.9, 1.0, face + 0.1, h + 1.3, -3 + k * 3, 0x2b3a4a));
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'peranakan') {
    // 싱가포르·말레이시아 페라나칸 숍하우스: 파스텔 2칸 + 5피트 아케이드 + 덧창 + 코니스 + 기와지붕
    for (const [z, c, sh] of [[-2.5, 0x9ad1c4, 0x2d6a4f], [2.5, 0xf6bfd0, 0x3a5a8c]]) {
      const h = 9;
      b.push(box(W, h, 4.9, 0, h / 2, z, c));
      // 1층 아케이드(오각기둥 + 어두운 안쪽)
      b.push(box(0.1, 2.8, 4.3, face - 1.2, 1.4, z, 0x4a3b2e));
      b.push(box(1.3, 0.35, 4.9, face - 0.55, 3.0, z, c));
      for (const pz of [z - 2.2, z + 2.2]) b.push(box(0.35, 2.8, 0.35, face - 0.2, 1.4, pz, 0xf4efe6));
      b.push(box(0.06, 0.25, 4.0, face + 0.04, 3.0, z, 0xffffff));
      // 2층: 덧창 3개 (아치 위 + 루버)
      for (const wz of [z - 1.4, z, z + 1.4]) {
        b.push(box(0.08, 2.0, 0.9, face + 0.04, 5.2, wz, sh));
        for (let r = 0; r < 5; r++) b.push(box(0.1, 0.05, 0.86, face + 0.06, 4.45 + r * 0.38, wz, 0xf4efe6));
        b.push(paint(new THREE.CylinderGeometry(0.45, 0.45, 0.08, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(face + 0.05, 6.2, wz), 0xf4efe6));
      }
      // 코니스 + 타일 띠 + 박공
      b.push(box(0.45, 0.3, 4.9, face + 0.18, 7.3, z, 0xffffff));
      for (let k = 0; k < 6; k++) b.push(box(0.06, 0.32, 0.6, face + 0.04, 6.85, z - 1.9 + k * 0.76, k % 2 ? 0x2f7fe0 : 0xe9c46a));
      const roof = new THREE.BoxGeometry(W + 0.4, 0.22, 5.1);
      roof.rotateZ(0.32);
      roof.translate(0, h + 0.6, z);
      b.push(paint(roof, 0xb5532d));
      g.push(paint(new THREE.SphereGeometry(0.22, 8, 6).translate(face + 0.4, 2.6, z), 0xff3b30));
    }
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'colonial') {
    // 양곤·마닐라 식민지풍: 바랜 크림색 3층 + 아치 창 + 철제 발코니 + 몰딩 + 1층 가게 차양
    const h = 13;
    b.push(box(W, h, L, 0, h / 2, 0, 0xe8d9a8));
    b.push(box(W + 0.1, 0.5, L + 0.1, 0, h - 0.2, 0, 0xf6efd6));
    b.push(box(W + 0.2, 0.25, L + 0.2, 0, 4.0, 0, 0xf6efd6));
    for (let fl = 0; fl < 2; fl++) {
      for (let k = 0; k < 4; k++) {
        const wz = -3.6 + k * 2.4, wy = 5.6 + fl * 3.4;
        b.push(box(0.08, 1.8, 1.0, face + 0.04, wy, wz, 0x3d5a6c));
        b.push(paint(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).translate(face + 0.05, wy + 0.9, wz), 0xf6efd6));
      }
      b.push(box(0.6, 0.1, L * 0.86, face + 0.3, 4.75 + fl * 3.4, 0, 0x5b5b5b));
      for (let k = 0; k < 12; k++) b.push(box(0.04, 0.7, 0.04, face + 0.58, 5.1 + fl * 3.4, -4.2 + k * 0.76, 0x3b3b3b));
      b.push(box(0.04, 0.05, L * 0.86, face + 0.58, 5.45 + fl * 3.4, 0, 0x3b3b3b));
    }
    // 1층 가게: 셔터 + 줄무늬 차양 + 간판
    for (let k = 0; k < 2; k++) {
      const z = -2.5 + k * 5;
      b.push(box(0.1, 2.6, 4.0, face + 0.04, 1.3, z, 0x8d99ae));
      const aw = new THREE.BoxGeometry(1.4, 0.06, 4.2);
      aw.rotateZ(-0.3);
      aw.translate(face + 0.7, 3.0, z);
      b.push(paint(aw, k ? 0x2a9d8f : 0xe76f51));
      g.push(paint(box(0.12, 0.5, 2.6, face + 0.08, 3.55, z), k ? 0xffd166 : 0xffffff));
    }
    // 바랜 얼룩 + 옥상 물탱크
    for (const [y, z] of [[9, -2], [6.5, 3.5], [11.5, 1]]) b.push(box(0.05, 0.9, 1.4, face + 0.03, y, z, 0xcbbb88));
    b.push(paint(new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10).translate(-1, h + 0.7, 2.5), 0x3b6ea5));
    return { base: merge(b), glow: merge(g) };
  }
  if (style === 'teak') {
    // 캄보디아·미얀마 목조 가옥: 높은 기둥(필로티) + 판자벽 + 가파른 박공지붕 + 1층 가게 + 화분
    for (const [z, c] of [[-2.5, 0x8a5a35], [2.5, 0x9c6b3c]]) {
      // 1층: 기둥 + 가게(콘크리트)
      b.push(box(W * 0.9, 2.6, 4.4, -0.2, 1.3, z, 0xd8cfc0));
      for (const pz of [z - 2.1, z + 2.1]) b.push(box(0.3, 3.2, 0.3, face - 0.2, 1.6, pz, 0x5a3e2b));
      b.push(box(0.1, 2.2, 3.4, face - 0.62, 1.1, z, 0x3a3f45));
      // 2층: 판자벽 + 창 + 발코니 난간
      b.push(box(W, 3.2, 4.8, 0, 4.5, z, c));
      for (let r = 0; r < 6; r++) b.push(box(0.06, 0.05, 4.7, face + 0.03, 3.1 + r * 0.55, z, 0x5a3e2b));
      for (const wz of [z - 1.2, z + 1.2]) {
        b.push(box(0.08, 1.2, 0.9, face + 0.05, 4.6, wz, 0x2b2015));
        b.push(box(0.1, 1.2, 0.35, face + 0.06, 4.6, wz - 0.65, 0x2d6a4f));
        b.push(box(0.1, 1.2, 0.35, face + 0.06, 4.6, wz + 0.65, 0x2d6a4f));
      }
      b.push(box(0.9, 0.1, 4.6, face + 0.45, 3.0, z, 0x6b4a2e));
      for (let k = 0; k < 8; k++) b.push(box(0.05, 0.8, 0.05, face + 0.85, 3.45, z - 2.1 + k * 0.6, 0x6b4a2e));
      b.push(box(0.05, 0.06, 4.5, face + 0.85, 3.85, z, 0x6b4a2e));
      // 가파른 박공지붕 (양쪽 경사판) + 끝 장식
      for (const s of [-1, 1]) {
        const r = new THREE.BoxGeometry(W * 0.62, 0.15, 5.2);
        r.rotateZ(-s * 0.75);
        r.translate(s * 1.36, 7.4, z);
        b.push(paint(r, 0x7a2e1f));
      }
      b.push(paint(new THREE.ConeGeometry(0.15, 0.9, 4).translate(0, 9.0, z - 2.4), 0xd4a017));
      b.push(paint(new THREE.ConeGeometry(0.15, 0.9, 4).translate(0, 9.0, z + 2.4), 0xd4a017));
      for (const pz of [z - 1.6, z + 1.6]) b.push(paint(new THREE.IcosahedronGeometry(0.3, 0).translate(face + 0.6, 3.35, pz), 0x2f9e44));
      g.push(paint(box(0.1, 0.4, 2.4, face + 0.06, 2.5, z), 0xffd166));
    }
    return { base: merge(b), glow: merge(g) };
  }
  return { base: rukoGeometry(), glow: null };
}

export function treeVariant(kind) {
  if (kind === 'palm') return palmGeometry();
  if (kind === 'raintree') {
    // 레인트리: 굵은 줄기 + 넓게 퍼진 우산형 수관 (싱가포르·말레이시아 가로수)
    const p = [];
    const t = new THREE.CylinderGeometry(0.2, 0.32, 3.0, 7);
    t.translate(0, 1.5, 0);
    p.push(paint(t, 0x4a3b2e));
    for (const s of [-1, 1]) { const br = new THREE.CylinderGeometry(0.08, 0.14, 1.6, 5); br.rotateZ(s * 0.7); br.translate(s * 0.5, 3.2, 0); p.push(paint(br, 0x4a3b2e)); }
    for (const [x, y, z, r, c] of [[0, 4.0, 0, 1.9, 0x2f7d3a], [1.5, 3.7, 0.4, 1.3, 0x3f8f46], [-1.5, 3.8, -0.3, 1.35, 0x37853f], [0.3, 3.6, 1.4, 1.2, 0x3f8f46], [-0.2, 3.7, -1.4, 1.2, 0x2f7d3a]]) {
      const s = new THREE.IcosahedronGeometry(r, 1);
      s.scale(1.25, 0.55, 1.25);
      s.translate(x, y, z);
      p.push(paint(s, c));
    }
    return merge(p);
  }
  if (kind === 'frangipani') {
    // 프랑지파니(플루메리아): 갈라진 회색 가지 + 잎 뭉치 + 흰·노랑 꽃
    const p = [];
    const t = new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6);
    t.translate(0, 0.8, 0);
    p.push(paint(t, 0x8d8378));
    for (const [a, ry] of [[0.55, 0], [0.5, 2.1], [0.6, 4.2]]) {
      const br = new THREE.CylinderGeometry(0.07, 0.11, 1.5, 5);
      br.translate(0, 0.75, 0);
      br.rotateZ(a);
      br.rotateY(ry);
      br.translate(0, 1.5, 0);
      p.push(paint(br, 0x8d8378));
      const tip = new THREE.Vector3(-Math.sin(a) * 1.5, 1.5 + Math.cos(a) * 1.5, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), ry);
      const l = new THREE.IcosahedronGeometry(0.7, 0);
      l.scale(1, 0.6, 1);
      l.translate(tip.x, tip.y + 0.15, tip.z);
      p.push(paint(l, 0x3f8f46));
      for (let k = 0; k < 4; k++) {
        const f = new THREE.IcosahedronGeometry(0.13, 0);
        f.translate(tip.x + Math.cos(k * 1.6) * 0.45, tip.y + 0.45, tip.z + Math.sin(k * 1.6) * 0.45);
        p.push(paint(f, k % 2 ? 0xfff8e1 : 0xffe066));
      }
    }
    return merge(p);
  }

  const trunk = new THREE.CylinderGeometry(0.16, 0.24, 2.2, 6);
  trunk.translate(0, 1.1, 0);
  const parts = [paint(trunk, 0x5b4636)];
  const leaf = { sakura: [0xffb7c5, 0xff9eb5], ginkgo: [0xf6c945, 0xe9b824], round: [0x3f8f46, 0x2f7d3a] }[kind] || [0x3f8f46, 0x2f7d3a];
  for (const [x, y, z, r] of [[0, 3.2, 0, 1.5], [0.8, 2.8, 0.4, 1.0], [-0.7, 2.9, -0.5, 1.05], [0.2, 3.9, -0.3, 1.0]]) {
    const sph = new THREE.IcosahedronGeometry(r, 0);
    sph.translate(x, y, z);
    parts.push(paint(sph, leaf[(x > 0) | 0]));
  }
  return merge(parts);
}

export function curbVariant(kind) {
  if (kind === 'warung') return warungGeometry();
  const p = [];
  if (kind === 'vending') {
    // 일본 자판기 3대
    for (let i = 0; i < 3; i++) {
      p.push(box(1.0, 1.9, 0.9, 0, 0.95, -1.2 + i * 1.2, [0xd00000, 0x0077b6, 0xffffff][i]));
      p.push(box(0.06, 0.9, 0.7, 0.52, 1.3, -1.2 + i * 1.2, 0xcfe8ff));
    }
  } else if (kind === 'cafe') {
    // 노천 카페 테이블 + 의자 + 파라솔
    for (const z of [-1.4, 1.4]) {
      const t = new THREE.CylinderGeometry(0.45, 0.45, 0.06, 10);
      t.translate(0, 0.75, z);
      p.push(paint(t, 0xffffff));
      p.push(box(0.06, 0.75, 0.06, 0, 0.37, z, 0x333333));
      for (const dz of [-0.6, 0.6]) p.push(box(0.4, 0.5, 0.4, 0, 0.25, z + dz, 0x7a4a22));
      const um = new THREE.ConeGeometry(1.1, 0.45, 8, 1, true);
      um.translate(0, 2.3, z);
      p.push(paint(um, z < 0 ? 0xc1121f : 0x1d3557));
      p.push(box(0.04, 2.0, 0.04, 0, 1.3, z, 0x555555));
    }
  } else if (kind === 'tent') {
    // 포장마차 (주황 천막)
    p.push(box(2.4, 0.9, 3.0, 0, 0.45, 0, 0x8d6e63));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.06, 2.3, 0.06, sx * 1.15, 1.15, sz * 1.45, 0x777777));
    const roof = new THREE.BoxGeometry(2.6, 0.06, 3.4);
    roof.rotateZ(0.15);
    roof.translate(0, 2.35, 0);
    p.push(paint(roof, 0xff7b00));
    p.push(box(0.04, 1.2, 3.2, 1.25, 1.7, 0, 0xff9e2c));
  } else if (kind === 'mamak') {
    // 말레이시아 마막 식당: 초록 천막 + 플라스틱 테이블·의자 + 테 타릭 카운터
    p.push(box(1.2, 1.0, 3.2, -0.6, 0.5, 0, 0xc0c4c8));
    p.push(box(0.06, 0.4, 3.0, 0.02, 1.2, 0, 0x2d6a4f));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.06, 2.5, 0.06, sx * 1.2, 1.25, sz * 1.6, 0x888888));
    const roof = new THREE.BoxGeometry(2.6, 0.06, 3.5);
    roof.rotateZ(-0.12);
    roof.translate(0, 2.55, 0);
    p.push(paint(roof, 0x1b998b));
    for (const z of [-0.9, 0.9]) {
      const t = new THREE.CylinderGeometry(0.4, 0.4, 0.05, 10);
      t.translate(0.6, 0.72, z);
      p.push(paint(t, 0xe63946));
      p.push(box(0.05, 0.7, 0.05, 0.6, 0.36, z, 0x777777));
      for (const dz of [-0.45, 0.45]) p.push(box(0.32, 0.42, 0.32, 0.6, 0.21, z + dz, z < 0 ? 0x2a9df4 : 0xff8800));
      for (let k = 0; k < 2; k++) p.push(paint(new THREE.CylinderGeometry(0.05, 0.04, 0.14, 6).translate(0.5 + k * 0.2, 0.82, z), 0xc8a165));
    }
  } else if (kind === 'sarisari') {
    // 필리핀 사리사리 스토어: 작은 가게 + 철망 창 + 매달린 과자 봉지 + 함석 지붕
    p.push(box(2.2, 2.4, 3.0, -0.3, 1.2, 0, 0xf1e3c8));
    p.push(box(0.06, 1.0, 2.2, 0.82, 1.45, 0, 0x2b2015));
    for (let k = 0; k < 9; k++) p.push(box(0.04, 1.0, 0.03, 0.86, 1.45, -1.0 + k * 0.25, 0x666666));
    for (let k = 0; k < 4; k++) p.push(box(0.04, 0.03, 2.2, 0.86, 1.05 + k * 0.27, 0, 0x666666));
    for (let k = 0; k < 7; k++) p.push(box(0.06, 0.32, 0.18, 0.95, 1.75 - (k % 2) * 0.12, -0.9 + k * 0.3, [0xe63946, 0xffc400, 0x2a9df4, 0x2ec27e][k % 4]));
    p.push(box(0.5, 0.06, 2.4, 1.05, 0.95, 0, 0x8d6e63));
    const roof = new THREE.BoxGeometry(2.8, 0.05, 3.4);
    roof.rotateZ(-0.2);
    roof.translate(0.1, 2.55, 0);
    p.push(paint(roof, 0x9aa0a6));
    p.push(box(0.06, 0.45, 2.6, 0.9, 2.15, 0, 0xce1126));
  } else if (kind === 'juicecart') {
    // 캄보디아 사탕수수 주스 수레: 바퀴 달린 수레 + 압착기 + 사탕수수 다발 + 파라솔
    p.push(box(1.0, 0.8, 2.0, 0, 0.75, 0, 0x2a9d8f));
    for (const sz of [-0.8, 0.8]) p.push(cylX(0.3, 0.1, -0.55, 0.3, sz, 0x222222, 12), cylX(0.3, 0.1, 0.55, 0.3, sz, 0x222222, 12));
    p.push(box(0.6, 0.6, 0.6, 0, 1.45, -0.5, 0xc0c4c8));
    p.push(cylX(0.18, 0.7, 0, 1.55, -0.5, 0x777777, 10));
    for (let k = 0; k < 6; k++) { const c = new THREE.CylinderGeometry(0.035, 0.035, 1.6, 5); c.rotateX(1.3); c.translate(-0.25 + k * 0.1, 1.25, 0.4); p.push(paint(c, k % 2 ? 0x9bbf4a : 0xc9a227)); }
    p.push(box(0.04, 2.2, 0.04, 0.4, 1.9, 0.5, 0x555555));
    const um = new THREE.ConeGeometry(1.1, 0.4, 8, 1, true);
    um.translate(0.4, 3.0, 0.5);
    p.push(paint(um, 0xe63946));
    p.push(box(0.4, 0.4, 0.3, 0.3, 1.35, 0.6, 0xfff3b0));
  } else if (kind === 'teashop') {
    // 미얀마 찻집: 낮은 테이블 + 아주 작은 플라스틱 의자 + 보온병 + 차양
    for (const z of [-1.0, 0.4]) {
      p.push(box(0.6, 0.05, 0.6, 0.3, 0.45, z, 0xd62828));
      p.push(box(0.05, 0.42, 0.05, 0.3, 0.22, z, 0x777777));
      for (const [dx, dz] of [[-0.45, 0], [0.45, 0], [0, 0.45]]) p.push(box(0.24, 0.25, 0.24, 0.3 + dx, 0.12, z + dz, [0x2a9df4, 0x2ec27e, 0xffc400][(dz > 0) + (dx > 0)]));
      p.push(paint(new THREE.CylinderGeometry(0.06, 0.06, 0.25, 8).translate(0.25, 0.6, z), 0xc0c4c8));
    }
    p.push(box(0.8, 0.9, 1.4, -0.7, 0.45, 1.1, 0x6b4a2e));
    p.push(paint(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10).translate(-0.7, 1.15, 1.1), 0x9aa0a6));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.05, 2.3, 0.05, sx * 1.1, 1.15, sz * 1.6, 0x666666));
    const roof = new THREE.BoxGeometry(2.4, 0.05, 3.4);
    roof.rotateZ(-0.15);
    roof.translate(0, 2.35, 0);
    p.push(paint(roof, 0x1d3557));
  } else {
    // 싱가포르 도심 정원 화단
    p.push(box(1.4, 0.6, 3.4, 0, 0.3, 0, 0xbfc5c9));
    for (let i = 0; i < 4; i++) {
      const bush = new THREE.IcosahedronGeometry(0.55, 0);
      bush.translate(0, 0.9, -1.2 + i * 0.8);
      p.push(paint(bush, i % 2 ? 0x2d6a4f : 0x40916c));
    }
  }
  return merge(p);
}

// ---------- 랜드마크 (먼 스카이라인, 안개 영향 줄임)
export const landmarkMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
export const landmarkGlowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });

export function createLandmark(kind) {
  const p = [], g = [];
  const cyl = (rt, rb, h, x, y, z, c, seg = 8) => { const q = new THREE.CylinderGeometry(rt, rb, h, seg); q.translate(x, y, z); return paint(q, c); };
  const cone = (r, h, x, y, z, c, seg = 8) => { const q = new THREE.ConeGeometry(r, h, seg); q.translate(x, y, z); return paint(q, c); };
  switch (kind) {
    case 'monas': { // 모나스: 넓은 광장 기단(컵 모양) + 흰 오벨리스크 + 금빛 불꽃
      p.push(box(60, 2, 60, 0, 1, 0, 0xd8d0c4), box(44, 5, 44, 0, 4.5, 0, 0xeae2d6));
      { const cup = new THREE.CylinderGeometry(26, 14, 10, 4); cup.rotateY(Math.PI / 4); cup.translate(0, 12, 0); p.push(paint(cup, 0xf1ece4)); }
      p.push(cyl(2.6, 5.2, 92, 0, 63, 0, 0xf6f2ea, 4));
      p.push(cyl(6, 4, 4, 0, 111, 0, 0xd8d0c4, 4));
      { const f = new THREE.ConeGeometry(4, 14, 8); f.translate(0, 120, 0); g.push(paint(f, 0xffc300)); }
      for (const [x, z] of [[-1.6, 1], [1.4, -1], [0.4, 1.6]]) { const f = new THREE.ConeGeometry(1.6, 7, 6); f.translate(x, 121 + Math.abs(x), z); g.push(paint(f, 0xffe066)); }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(paint(new THREE.IcosahedronGeometry(4, 0).translate(sx * 24, 6, sz * 24), 0x2f7d3a));
      break;
    }
    case 'pagoda': { // 하노이 쩐꾸옥 사원 탑: 붉은 11층 탑 + 처마 + 연꽃 첨탑 + 호숫가 정자
      for (let i = 0; i < 9; i++) {
        const w = 22 - i * 2;
        p.push(box(w, 8, w, 0, 4 + i * 9.5, 0, 0xb5361e));
        p.push(box(w + 6, 1.2, w + 6, 0, 8.6 + i * 9.5, 0, 0x4a3b2e));
        for (let k = 0; k < 3; k++) for (const s of [-1, 1]) p.push(box(0.3, 3, 2.2, s * (w / 2 + 0.2), 4 + i * 9.5, -w / 3 + k * (w / 3), 0xffd166));
      }
      g.push(cone(3, 12, 0, 92, 0, 0xffd166, 8));
      p.push(box(20, 4, 14, 46, 2, 10, 0xc0392b));
      { const r = new THREE.ConeGeometry(16, 8, 4); r.rotateY(Math.PI / 4); r.scale(1, 1, 0.75); r.translate(46, 8, 10); p.push(paint(r, 0x5a3e2b)); }
      break;
    }
    case 'temple': { // 왓 아룬: 도자기 장식 프랑(중앙 첨탑) 계단식 + 작은 프랑 4개 + 금빛 첨두
      p.push(box(90, 6, 90, 0, 3, 0, 0xf4e9d8));
      for (let i = 0; i < 7; i++) {
        const r = 18 - i * 2.2;
        p.push(cyl(r, r + 1.2, 10, 0, 11 + i * 10, 0, i % 2 ? 0xe9dcc3 : 0xf2e6c9, 12));
        for (let k = 0; k < 8; k++) {
          const a = (k / 8) * Math.PI * 2;
          p.push(paint(new THREE.IcosahedronGeometry(1.1, 0).translate(Math.cos(a) * (r + 0.6), 11 + i * 10, Math.sin(a) * (r + 0.6)), [0x2a9df4, 0xe63946, 0x2ec27e, 0xffc400][(k + i) % 4]));
        }
      }
      g.push(cone(3, 22, 0, 92, 0, 0xffc300, 10));
      for (const [x, z] of [[-34, -34], [34, -34], [-34, 34], [34, 34]]) {
        for (let i = 0; i < 4; i++) p.push(cyl(6 - i * 1.2, 6.6 - i * 1.2, 7, x, 9 + i * 7, z, 0xf2e6c9, 10));
        g.push(cone(1.4, 10, x, 41, z, 0xffc300));
      }
      break;
    }
    case 'namsan': // 남산 + N서울타워
      { const hill = new THREE.SphereGeometry(40, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); hill.scale(1.4, 0.95, 1); p.push(paint(hill, 0x2f5d3a)); }
      p.push(cyl(2.5, 3.5, 60, 0, 66, 0, 0xe6e6e6));
      p.push(cyl(9, 9, 9, 0, 98, 0, 0xcfd8dc, 12));
      g.push(cyl(0.6, 0.6, 26, 0, 116, 0, 0xff3b6b, 6));
      break;
    case 'tokyotower': // 도쿄타워 (빨강/흰 격자 느낌)
      for (let i = 0; i < 8; i++) {
        const w = 30 - i * 3.6;
        p.push(box(w, 12, w, 0, 6 + i * 12, 0, i % 2 ? 0xffffff : 0xe63946));
      }
      p.push(box(14, 3, 14, 0, 60, 0, 0xffffff));
      g.push(cyl(0.6, 1.2, 24, 0, 110, 0, 0xffe066, 6));
      break;
    case 'mbs': { // 마리나 베이 샌즈: 기울어진 3개 타워 + 배 모양 스카이파크 + 슈퍼트리 그로브 + 아트사이언스 연꽃
      for (const x of [-30, 0, 30]) {
        for (const s of [-1, 1]) {
          const t = new THREE.BoxGeometry(7, 92, 18);
          t.rotateZ(s * 0.06);
          t.translate(x + s * 4.2, 46, 0);
          p.push(paint(t, 0xd9e2ec));
        }
        for (let k = 0; k < 6; k++) g.push(box(14.6, 0.6, 18.4, x, 14 + k * 13, 0, 0x9bf6ff));
      }
      { const deck = new THREE.CylinderGeometry(11, 11, 112, 16, 1, false, 0, Math.PI); deck.rotateZ(Math.PI / 2); deck.scale(1, 0.32, 1); deck.translate(0, 95, 0); p.push(paint(deck, 0x8d99ae)); }
      g.push(box(100, 0.8, 18, 0, 97, 0, 0x52b788));
      for (const [x, z, h] of [[-62, 26, 30], [-50, 34, 36], [-40, 22, 26], [-30, 36, 32]]) {
        p.push(cyl(1.4, 2.4, h, x, h / 2, z, 0x3f5d4a, 8));
        { const c = new THREE.ConeGeometry(8, 6, 12, 1, true); c.rotateX(Math.PI); c.translate(x, h + 2, z); g.push(paint(c, 0xb15cff)); }
      }
      for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI - Math.PI / 2; const f = new THREE.ConeGeometry(3, 16, 4); f.rotateZ(a * 0.9); f.translate(56 + Math.sin(a) * 6, 10 + Math.cos(a) * 4, 26); p.push(paint(f, 0xf4f4f4)); }
      break;
    }
    case 'empire': // 엠파이어 스테이트 풍 + 주변 스카이라인
      p.push(box(30, 60, 30, 0, 30, 0, 0xb7a99a), box(20, 30, 20, 0, 75, 0, 0xc2b5a7), box(12, 16, 12, 0, 98, 0, 0xcdc2b5));
      g.push(cyl(0.8, 2, 30, 0, 121, 0, 0xfff3b0, 6));
      for (const [x, h] of [[-45, 55], [-28, 38], [32, 48], [50, 32]]) p.push(box(16, h, 16, x, h / 2, 6, 0x8e8478));
      break;
    case 'eiffel': // 에펠탑
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const leg = new THREE.BoxGeometry(4, 50, 4);
        leg.rotateZ(sx * 0.32);
        leg.rotateX(-sz * 0.32);
        leg.translate(sx * 8, 23, sz * 8);
        p.push(paint(leg, 0x7a5c3c));
      }
      p.push(box(26, 2.5, 26, 0, 30, 0, 0x7a5c3c), box(14, 2, 14, 0, 58, 0, 0x7a5c3c));
      p.push(cyl(2.2, 6.5, 50, 0, 84, 0, 0x7a5c3c, 4));
      g.push(cyl(0.5, 0.5, 12, 0, 114, 0, 0xffe066, 6));
      break;
    case 'petronas': { // 페트로나스 트윈타워: 8각 기둥 계단식 + 스카이브리지 + 첨탑 + KL타워
      for (const x of [-18, 18]) {
        for (let i = 0; i < 6; i++) p.push(cyl(9 - i * 1.0, 9.5 - i * 1.0, 22, x, 11 + i * 20, 0, 0xc9d1d9, 8));
        for (let i = 0; i < 6; i++) g.push(cyl(9.1 - i * 1.0, 9.1 - i * 1.0, 0.8, x, 21 + i * 20, 0, 0x9bf6ff, 8));
        p.push(cyl(2, 4, 10, x, 127, 0, 0xdfe6ec, 8));
        g.push(cyl(0.4, 1.2, 30, x, 147, 0, 0xffffff, 6));
      }
      p.push(box(28, 3, 4, 0, 82, 0, 0x8d99ae));
      for (const s of [-1, 1]) { const leg = new THREE.BoxGeometry(1.2, 22, 1.2); leg.rotateZ(s * 0.45); leg.translate(s * 5, 72, 0); p.push(paint(leg, 0x8d99ae)); }
      p.push(cyl(1.6, 2.4, 70, 70, 35, 20, 0xd9d9d9, 8), cyl(7, 6, 8, 70, 74, 20, 0xbfc5c9, 10));
      g.push(cyl(0.3, 0.3, 18, 70, 87, 20, 0xff3b6b, 6));
      break;
    }
    case 'mayon': { // 마욘 화산: 완벽한 원뿔 + 녹색 기슭 + 연기 + 마닐라 스카이라인
      { const c = new THREE.ConeGeometry(90, 120, 24, 4); c.translate(0, 60, 0); p.push(paint(c, 0x7d8f69)); }
      { const c = new THREE.ConeGeometry(42, 56, 24, 2); c.translate(0, 92, 0); p.push(paint(c, 0x8a8178)); }
      { const c = new THREE.ConeGeometry(14, 18, 20, 1); c.translate(0, 111, 0); p.push(paint(c, 0x6e6660)); }
      for (const [x, y, r] of [[3, 124, 7], [10, 131, 9], [20, 137, 11], [32, 141, 12]]) p.push(paint(new THREE.IcosahedronGeometry(r, 1).translate(x, y, 0), 0xe9e5df));
      for (const [x, h] of [[-80, 26], [-66, 38], [-54, 22], [62, 30], [76, 44], [90, 24]]) p.push(box(10, h, 10, x, h / 2, 30, 0x9aa5b1));
      break;
    }
    case 'angkor': { // 앙코르와트: 연꽃봉오리 탑 5개 + 회랑 기단 + 해자 둑길
      p.push(box(120, 6, 70, 0, 3, 0, 0x8a8174), box(90, 8, 52, 0, 10, 0, 0x948a7b), box(60, 8, 36, 0, 18, 0, 0x9e937f));
      const tower = (x, z, s) => {
        for (let i = 0; i < 5; i++) p.push(cyl((5.5 - i * 0.9) * s, (6 - i * 0.9) * s, 7 * s, x, 22 + (3.5 + i * 7) * s, z, i % 2 ? 0x8f8574 : 0xa39883, 8));
        p.push(cone(1.8 * s, 9 * s, x, 22 + 39 * s, z, 0x8f8574, 8));
      };
      tower(0, 0, 1.45);
      for (const [x, z] of [[-24, -14], [24, -14], [-24, 14], [24, 14]]) tower(x, z, 1.0);
      p.push(box(14, 2, 60, 0, 1, -60, 0x8a8174));
      for (const sx of [-1, 1]) p.push(paint(new THREE.IcosahedronGeometry(6, 0).translate(sx * 50, 8, -40), 0x3f7f3a));
      break;
    }
    case 'shwedagon': { // 쉐다곤 파고다: 계단식 기단 + 종 모양 황금 탑 + 첨탑 + 보석 우산(티)
      p.push(box(80, 8, 80, 0, 4, 0, 0xe9dfc8));
      for (let i = 0; i < 3; i++) g.push(box(52 - i * 10, 4, 52 - i * 10, 0, 10 + i * 4, 0, 0xe6b422));
      { const bell = new THREE.SphereGeometry(18, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.62); bell.scale(1, 1.25, 1); bell.translate(0, 22, 0); g.push(paint(bell, 0xf2c230)); }
      for (let i = 0; i < 6; i++) g.push(cyl(8 - i * 1.2, 9 - i * 1.2, 4, 0, 44 + i * 4, 0, i % 2 ? 0xffd34d : 0xe6b422, 16));
      g.push(cone(4, 40, 0, 88, 0, 0xffd34d, 16));
      g.push(cyl(2.6, 2.6, 2, 0, 104, 0, 0xfff3b0, 12), cone(0.6, 8, 0, 110, 0, 0xffffff, 8));
      for (const [x, z] of [[-30, -30], [30, -30], [-30, 30], [30, 30]]) { g.push(cone(3, 20, x, 18, z, 0xe6b422, 10)); p.push(box(8, 4, 8, x, 6, z, 0xe9dfc8)); }
      break;
    }
    default:
      p.push(box(20, 60, 20, 0, 30, 0, 0x999999));
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(merge(p), landmarkMat));
  if (g.length) grp.add(new THREE.Mesh(merge(g), landmarkGlowMat));
  return grp;
}

// ---------- 도로 위 축제 장식 (나라별: 랜턴 줄 / 삼각 깃발 줄 / 불교 깃발). 도로 양쪽 기둥 사이에 처진 줄
export function overheadGeometry(kind) {
  const p = [];
  const X = 9.6, Y = 8.4, SAG = 1.1, N = 15;
  for (const sx of [-1, 1]) {
    p.push(box(0.14, Y + 0.3, 0.14, sx * X, (Y + 0.3) / 2, 0, 0x6c757d));
    p.push(box(0.3, 0.12, 0.3, sx * X, Y + 0.36, 0, 0x6c757d));
  }
  const yAt = (t) => Y - SAG * (1 - (2 * t - 1) ** 2);
  for (let i = 0; i < N; i++) { // 줄 (짧은 원기둥 조각)
    const t0 = i / N, t1 = (i + 1) / N;
    const a = V(-X + 2 * X * t0, yAt(t0), 0), b = V(-X + 2 * X * t1, yAt(t1), 0);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(0.02, 0.02, len, 4);
    g.rotateZ(Math.PI / 2 + Math.atan2(b.y - a.y, b.x - a.x));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, 0);
    p.push(paint(g, 0x333333));
  }
  const pal = {
    lanterns: [0xe63946, 0xffb703, 0xe63946, 0xfb8500],
    bunting_ph: [0xe63946, 0xffd60a, 0x2a9df4, 0x2ec27e, 0xff70a6, 0xffffff],
    bunting_my: [0xcc0001, 0xffffff, 0x010066, 0xffcc00],
    bunting_id: [0xce1126, 0xffffff],
    flags_th: [0xffd60a, 0xffffff, 0x2d2a4a, 0xffd60a],
    flags_kh: [0x032ea1, 0xe00025, 0xffffff, 0xffd60a],
    flags_mm: [0xffd60a, 0xffffff, 0xe6b422, 0x2a9d8f, 0xe63946],
  }[kind] || [0xffffff];
  const M = 26;
  for (let i = 1; i < M; i++) {
    const t = i / M, x = -X + 2 * X * t, y = yAt(t);
    const c = pal[i % pal.length];
    if (kind === 'lanterns') {
      if (i % 2) continue;
      const l = new THREE.SphereGeometry(0.32, 10, 8);
      l.scale(1, 1.25, 1);
      l.translate(x, y - 0.5, 0);
      p.push(paint(l, c));
      p.push(box(0.36, 0.06, 0.36, x, y - 0.06, 0, 0xd4a017), box(0.36, 0.06, 0.36, x, y - 0.94, 0, 0xd4a017));
      p.push(box(0.04, 0.3, 0.04, x, y - 1.15, 0, 0xffd166));
    } else {
      // 삼각 깃발 (앞뒤로 보이는 납작한 삼각뿔)
      const f = new THREE.ConeGeometry(0.28, 0.55, 3);
      f.rotateX(Math.PI);
      f.scale(1, 1, 0.12);
      f.translate(x, y - 0.3, 0);
      p.push(paint(f, c));
    }
  }
  return merge(p);
}

// ---------- 국기 / 국경 관문
const flagTexCache = {};
export function flagTexture(code) {
  if (flagTexCache[code]) return flagTexCache[code];
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  const t = new THREE.CanvasTexture(c);
  drawFlag(c.getContext('2d'), code, 192, 128, 0, 0, () => { t.needsUpdate = true; });
  t.colorSpace = THREE.SRGBColorSpace;
  flagTexCache[code] = t;
  return t;
}

// 가로등 깃발 (가로등 기둥 옆에 매다는 세로형 배너), 인스턴싱용
export function lampFlagGeometry() {
  const g = new THREE.PlaneGeometry(0.9, 1.35);
  g.rotateY(Math.PI / 2);
  g.translate(-0.05, 5.2, 0.55);
  return g;
}
export function flagMaterial(code) {
  return new THREE.MeshBasicMaterial({ map: flagTexture(code), side: THREE.DoubleSide });
}

export function createBorderGate(theme) {
  const grp = new THREE.Group();
  const p = [];
  for (const sx of [-1, 1]) {
    p.push(box(1.2, 8, 1.2, sx * 9.3, 4, 0, 0xdedede));
    p.push(box(1.6, 0.6, 1.6, sx * 9.3, 0.3, 0, 0x9e9e9e));
    p.push(box(0.12, 4, 0.12, sx * 9.3, 10, 0, 0x777777));
  }
  p.push(box(20, 1.6, 1.0, 0, 7.6, 0, 0x2b2d42));
  grp.add(new THREE.Mesh(merge(p), vcMat));
  // 환영 문구 패널 (3D 오브젝트, HUD 아님)
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#12141f';
  x.fillRect(0, 0, 1024, 96);
  let tex = null;
  const refresh = () => { if (tex) tex.needsUpdate = true; };
  drawFlag(x, theme.code, 111, 74, 14, 11, refresh);
  drawFlag(x, theme.code, 111, 74, 898, 11, refresh);
  x.fillStyle = '#ffffff';
  x.font = 'bold 50px "Russo One", "Arial Black", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(theme.welcome, 512, 52, 740);
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (const zf of [0.51, -0.51]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(19.6, 1.45), new THREE.MeshBasicMaterial({ map: tex }));
    sign.position.set(0, 7.6, zf);
    if (zf < 0) sign.rotation.y = Math.PI;
    grp.add(sign);
  }
  // 통행 방향 안내판 (국경을 넘으면 좌/우측 통행이 바뀔 수 있음)
  const kc = document.createElement('canvas');
  kc.width = 512;
  kc.height = 64;
  const kx = kc.getContext('2d');
  kx.fillStyle = '#ffd60a';
  kx.fillRect(0, 0, 512, 64);
  kx.fillStyle = '#111111';
  kx.font = 'bold 40px "Russo One", "Arial Black", sans-serif';
  kx.textAlign = 'center';
  kx.textBaseline = 'middle';
  const left = theme.drive === 'L';
  kx.fillText(left ? '<<  KEEP LEFT' : 'KEEP RIGHT  >>', 256, 34, 480);
  const ktex = new THREE.CanvasTexture(kc);
  ktex.colorSpace = THREE.SRGBColorSpace;
  for (const zf of [0.51, -0.51]) {
    const k = new THREE.Mesh(new THREE.PlaneGeometry(7, 0.875), new THREE.MeshBasicMaterial({ map: ktex }));
    k.position.set(0, 6.35, zf);
    if (zf < 0) k.rotation.y = Math.PI;
    grp.add(k);
  }
  // 기둥 위 국기
  grp.flags = [];
  for (const sx of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6, 6, 1), flagMaterial(theme.code));
    f.position.set(sx * 9.3 + 1.25, 11.2, 0);
    grp.add(f);
    grp.flags.push(f);
  }
  return grp;
}

// ---------- 빌보드 (건물 벽 / 가로등 프레임)
const posterCache = new Map();
export function posterTexture(poster, code) {
  const key = poster.title + code;
  if (posterCache.has(key)) return posterCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = poster.bg;
  x.fillRect(0, 0, 512, 256);
  x.fillStyle = poster.fg;
  x.globalAlpha = 0.15;
  for (let i = 0; i < 6; i++) { x.beginPath(); x.arc(420 + i * 8, 40 + i * 30, 90 - i * 10, 0, Math.PI * 2); x.fill(); }
  x.globalAlpha = 1;
  x.font = 'bold 64px "Russo One", "Arial Black", sans-serif';
  x.textBaseline = 'middle';
  x.fillText(poster.title, 28, 108, 456);
  x.font = 'bold 30px "Rajdhani", "Arial", sans-serif';
  x.fillText(poster.sub, 30, 178, 400);
  let t = null;
  drawFlag(x, code, 54, 36, 440, 204, () => { if (t) t.needsUpdate = true; });
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  posterCache.set(key, t);
  return t;
}

// 도로변 빌보드 공통 치수 (main.js 가 건물 전면에서 띄우는 오프셋 계산에 사용)
export const BILLBOARD = { width: 8.4, height: 4.4, posts: [0.6, 3.2] };
export const MEGABOARD = { width: 12.4, height: 5.6, posts: [1.6, 5.0] };

// 패널(포스터/LED 화면)이 백보드 위에서 깜빡이지 않도록 앞쪽으로 띄우고 나중에 그림
function screenMat() {
  return new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 });
}
// 기둥은 건물 쪽 절반에만 세워 인도에 서고 차도로는 내려오지 않게 함 (setSide 로 좌/우 반전)
function boardPosts(grp, dims, topY) {
  const posts = dims.posts.map(() => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, topY, 0.28), new THREE.MeshLambertMaterial({ color: 0x55595e }));
    m.position.set(0, -dims.height / 2 - topY / 2, 0);
    grp.add(m);
    return m;
  });
  grp.setSide = (farSign) => posts.forEach((m, i) => { m.position.z = farSign * dims.posts[i]; });
}

export function createBillboard() {
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(box(0.3, BILLBOARD.height, BILLBOARD.width, 0, 0, 0, 0x2b2d42), vcMat));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(8, 4), screenMat());
  panel.rotation.y = Math.PI / 2;
  panel.position.x = 0.2;
  panel.renderOrder = 2;
  grp.add(panel);
  boardPosts(grp, BILLBOARD, 6.2);
  grp.panel = panel;
  grp.dims = BILLBOARD;
  return grp;
}

// 대형 LED 전광판: 왼쪽 = 1위 라이더 3D 스냅샷, 오른쪽 = 텍스트
export function createMegaBoard() {
  const grp = new THREE.Group();
  const frame = [box(0.4, MEGABOARD.height, MEGABOARD.width, 0, 0, 0, 0x14161f)];
  frame.push(box(0.42, 0.12, MEGABOARD.width, 0, MEGABOARD.height / 2 - 0.06, 0, 0x39ff88));
  grp.add(new THREE.Mesh(merge(frame), vcMat));
  const shot = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), screenMat());
  shot.rotation.y = Math.PI / 2;
  shot.position.set(0.25, -0.1, -3.5);
  const info = new THREE.Mesh(new THREE.PlaneGeometry(6.75, 5), screenMat());
  info.rotation.y = Math.PI / 2;
  info.position.set(0.25, -0.1, 2.625);
  shot.renderOrder = info.renderOrder = 2;
  grp.add(shot, info);
  boardPosts(grp, MEGABOARD, 6.8);
  grp.shot = shot;
  grp.info = info;
  grp.dims = MEGABOARD;
  return grp;
}

// data: { code, name, dist, score, empty, foot }
export function megaInfoTexture(data) {
  const W = 648, H = 480;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0b1d2a');
  g.addColorStop(1, '#14002b');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  // LED 도트 패턴
  x.fillStyle = 'rgba(255,255,255,0.05)';
  for (let yy = 0; yy < H; yy += 6) for (let xx = 0; xx < W; xx += 6) x.fillRect(xx, yy, 2, 2);
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#39ff88';
  x.font = 'bold 34px "Russo One", "Arial Black", sans-serif';
  x.fillText('CURRENT COUNTRY #1:', 30, 64, W - 60);
  // 국기 배지
  x.fillStyle = '#ffffff';
  x.fillRect(26, 92, 148, 100);
  let t = null;
  drawFlag(x, data.code, 138, 92, 30, 96, () => { if (t) t.needsUpdate = true; });
  x.fillStyle = '#ffffff';
  x.font = 'bold 48px "Russo One", "Arial Black", sans-serif';
  x.fillText(data.country.toUpperCase(), 196, 162, W - 226);
  x.fillStyle = '#00e5ff';
  x.font = 'bold 54px "Russo One", "Arial Black", sans-serif';
  x.fillText(data.empty ? 'NO RIDER YET' : `${data.name} (${data.dist}m)`, 30, 280, W - 60);
  if (!data.empty) {
    x.fillStyle = '#ffd34d';
    x.font = 'bold 40px "Rajdhani", "Arial", sans-serif';
    x.fillText(`${data.score} PTS`, 30, 350, W - 60);
  }
  x.fillStyle = 'rgba(255,255,255,0.7)';
  x.font = 'bold 28px "Rajdhani", "Arial", sans-serif';
  x.fillText(data.foot, 30, 430, W - 60);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---------- 라이벌 거리 마커 (도로를 가로지르는 반투명 게이트)
export function createRivalMarker(color) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  const band = new THREE.Mesh(new THREE.PlaneGeometry(15, 0.25), mat);
  band.rotation.x = -Math.PI / 2;
  band.position.y = 0.05;
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(15, 2.4), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
  wall.position.y = 1.2;
  grp.add(band, wall);
  for (const sx of [-7.6, 7.6]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 3.2, 0.15), mat);
    post.position.set(sx, 1.6, 0);
    grp.add(post);
  }
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 96;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
  label.scale.set(6.4, 1.2, 1);
  label.position.y = 3.6;
  grp.add(label);
  grp.setLabel = (text) => {
    const x = c.getContext('2d');
    x.clearRect(0, 0, 512, 96);
    x.fillStyle = 'rgba(10,12,20,0.75)';
    x.fillRect(0, 8, 512, 80);
    x.fillStyle = '#' + new THREE.Color(color).getHexString();
    x.fillRect(0, 8, 10, 80);
    x.fillStyle = '#ffffff';
    x.font = 'bold 44px "Russo One", "Arial Black", sans-serif';
    x.textBaseline = 'middle';
    x.fillText(text, 26, 50, 470);
    tex.needsUpdate = true;
  };
  return grp;
}

// ---------- 갓길 장애물: 노점상(Kaki Lima 수레 + 파라솔) / 천막
export const STALL_DEFS = {
  cart: { hw: 0.55, hl: 0.9 },
  tent: { hw: 0.75, hl: 1.2 },
};

export function createStall(kind) {
  const ext = models.instantiate('obstacle.stall');
  if (ext) return ext;
  const p = [];
  if (kind === 'cart') {
    p.push(box(1.0, 0.75, 1.6, 0, 0.75, 0, 0x2a9df4));
    p.push(box(1.02, 0.12, 1.62, 0, 1.18, 0, 0xffffff));
    p.push(box(0.9, 0.5, 1.2, 0, 1.5, 0, 0xcfe8ff));
    for (const sz of [-1, 1]) p.push(cylX(0.28, 0.08, 0.5, 0.28, sz * 0.5, 0x222222, 10));
    p.push(box(0.06, 0.06, 0.8, 0, 0.9, 1.15, 0x444444));
    const pole = new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6);
    pole.translate(0, 2.2, 0);
    p.push(paint(pole, 0x666666));
    const umb = new THREE.ConeGeometry(1.15, 0.5, 8, 1, true);
    umb.translate(0, 2.95, 0);
    p.push(paint(umb, 0xe63946));
    const umb2 = new THREE.ConeGeometry(1.16, 0.5, 8, 1, true);
    umb2.rotateY(Math.PI / 8);
    umb2.translate(0, 2.94, 0);
    p.push(paint(umb2, 0xf5f5f5));
    p.push(box(0.95, 0.12, 0.05, 0, 1.0, -0.82, 0xffc400));
  } else {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) p.push(box(0.07, 2.2, 0.07, sx * 0.72, 1.1, sz * 1.15, 0x888888));
    const roof = new THREE.BoxGeometry(1.7, 0.06, 2.6);
    roof.rotateZ(0.12);
    roof.translate(0, 2.25, 0);
    p.push(paint(roof, 0xff8800));
    p.push(box(1.72, 0.3, 0.04, 0, 2.0, -1.3, 0xffffff));
    p.push(box(1.3, 0.75, 1.8, 0, 0.38, 0, 0x7a5c3c));
    for (let i = 0; i < 4; i++) p.push(box(0.3, 0.25, 0.3, -0.3 + (i % 2) * 0.6, 0.88, -0.5 + (i >> 1) * 1.0, [0xffd21f, 0x2ec27e, 0xe63946, 0xff8800][i]));
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(merge(p), vcMat), shadow(kind === 'cart' ? 1.4 : 1.9, kind === 'cart' ? 2.0 : 2.8));
  return g;
}

// ---------- 중앙선 공사 표지판 (바리케이드)
export function signGeometry() {
  const p = [];
  for (const sx of [-1, 1]) {
    p.push(box(0.08, 1.1, 0.08, sx * 0.55, 0.55, 0, 0x555555));
    p.push(box(0.3, 0.06, 0.5, sx * 0.55, 0.03, 0, 0x333333));
  }
  for (let i = 0; i < 6; i++) p.push(box(0.2, 0.4, 0.06, -0.5 + i * 0.2, 0.85, 0, i % 2 ? 0xffffff : 0xff6a00));
  p.push(box(0.5, 0.3, 0.06, 0, 1.25, 0, 0xffc400));
  p.push(box(0.16, 0.16, 0.08, 0, 1.25, -0.01, 0x222222));
  return merge(p);
}

// ---------- 도로 위 물웅덩이 (반투명 평면)
export function createPuddleMaterial() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 10, 64, 64, 62);
  g.addColorStop(0, 'rgba(160,190,220,0.95)');
  g.addColorStop(0.7, 'rgba(120,150,185,0.8)');
  g.addColorStop(1, 'rgba(120,150,185,0)');
  x.fillStyle = g;
  x.beginPath();
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI * 2, r = 46 + Math.sin(i * 2.7) * 12;
    x.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  x.fill();
  x.strokeStyle = 'rgba(255,255,255,0.5)';
  x.lineWidth = 2;
  x.beginPath();
  x.ellipse(52, 50, 18, 6, -0.4, 0, Math.PI * 2);
  x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.85 });
}
export const puddleGeometry = () => new THREE.PlaneGeometry(2.6, 3.8).rotateX(-Math.PI / 2);

// ---------- 파워업
const POWER_STYLE = {
  shield: { color: 0x4cc9f0, icon: 'shield' },
  magnet: { color: 0xff4d6d, icon: 'magnet' },
  x2:     { color: 0xffd60a, icon: 'x2' },
  slow:   { color: 0x80ed99, icon: 'clock' },
  giant:  { color: 0xb5179e, icon: 'giant' },
};

export function createPowerUp(type) {
  const { color, icon } = POWER_STYLE[type];
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.7 });
  let geo;
  if (type === 'shield') geo = new THREE.IcosahedronGeometry(0.55, 0);
  else if (type === 'magnet') geo = new THREE.TorusGeometry(0.42, 0.15, 8, 16, Math.PI);
  else if (type === 'x2') geo = new THREE.OctahedronGeometry(0.6);
  else if (type === 'giant') geo = new THREE.BoxGeometry(0.75, 0.75, 0.75);
  else { geo = new THREE.CylinderGeometry(0.5, 0.5, 0.18, 20); geo.rotateX(Math.PI / 2); }
  const core = new THREE.Mesh(geo, mat);
  core.position.y = 1.2;
  group.add(core);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.05, 6, 32).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  ring.position.y = 0.08;
  group.add(ring);

  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.2, 16, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide }));
  beam.position.y = 1.6;
  group.add(beam);

  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.beginPath();
  x.arc(64, 64, 58, 0, Math.PI * 2);
  x.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  // 라인 아이콘 SVG 를 캔버스에 그려서 스프라이트 라벨로 사용
  const img = new Image();
  img.onload = () => {
    x.drawImage(img, 28, 28, 72, 72);
    tex.needsUpdate = true;
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    svgIcon(icon).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" ').replace(/currentColor/g, '#ffffff'),
  );
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(1.1, 1.1, 1);
  sprite.position.y = 2.5;
  group.add(sprite);
  return { group, core };
}

// ---------- 텍스처
export function makeRoadTexture(aniso) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const x = c.getContext('2d');
  const W = 17, px = c.width / W, py = c.height / 40;
  const X = (m) => (m + W / 2) * px;
  x.fillStyle = '#3b3e44';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#4a4d53';
  x.fillRect(0, 0, X(-7), c.height);
  x.fillRect(X(7), 0, c.width - X(7), c.height);
  for (let i = 0; i < 9000; i++) {
    const v = 50 + Math.random() * 30;
    x.fillStyle = `rgba(${v},${v},${v + 4},0.5)`;
    x.fillRect(Math.random() * c.width, Math.random() * c.height, 2, 2);
  }
  x.fillStyle = '#efefef';
  x.fillRect(X(-7.05), 0, 0.16 * px, c.height);
  x.fillRect(X(6.89), 0, 0.16 * px, c.height);
  x.fillStyle = '#ffc400';
  x.fillRect(X(-0.22), 0, 0.12 * px, c.height);
  x.fillRect(X(0.1), 0, 0.12 * px, c.height);
  x.fillStyle = '#f2f2f2';
  for (let i = 0; i < 4; i++) {
    x.fillRect(X(-3.56), i * 10 * py, 0.13 * px, 4 * py);
    x.fillRect(X(3.43), i * 10 * py, 0.13 * px, 4 * py);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeGrassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#4f8f3a';
  x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#4a8836';
  x.fillRect(0, 0, 128, 64);
  for (let i = 0; i < 1600; i++) {
    const g = 110 + Math.random() * 60;
    x.fillStyle = `rgba(${g * 0.45},${g},${g * 0.32},0.5)`;
    x.fillRect(Math.random() * 128, Math.random() * 128, 2, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeBuildingMaterial() {
  const make = (lit) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const x = c.getContext('2d');
    x.fillStyle = lit ? '#000' : '#ffffff'; // 벽은 흰색 → 인스턴스 색이 그대로 벽색이 됨
    x.fillRect(0, 0, 64, 128);
    for (let r = 0; r < 12; r++) {
      for (let k = 0; k < 5; k++) {
        if (lit) x.fillStyle = Math.random() < 0.45 ? '#ffd98a' : '#000';
        else x.fillStyle = '#56606e';
        x.fillRect(4 + k * 12, 6 + r * 10, 8, 6);
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return new THREE.MeshLambertMaterial({ map: make(false), emissive: 0xffffff, emissiveMap: make(true), emissiveIntensity: 0 });
}

export function makeBeamTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const x = c.getContext('2d');
  x.beginPath();
  x.moveTo(52, 256);
  x.lineTo(76, 256);
  x.lineTo(128, 0);
  x.lineTo(0, 0);
  x.closePath();
  x.clip();
  const g = x.createLinearGradient(0, 256, 0, 0);
  g.addColorStop(0, 'rgba(255,240,200,0.95)');
  g.addColorStop(0.5, 'rgba(255,235,190,0.45)');
  g.addColorStop(1, 'rgba(255,230,180,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 128, 256);
  x.globalCompositeOperation = 'destination-in';
  const h = x.createLinearGradient(0, 0, 128, 0);
  h.addColorStop(0, 'rgba(0,0,0,0)');
  h.addColorStop(0.5, 'rgba(0,0,0,1)');
  h.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = h;
  x.fillRect(0, 0, 128, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeShadowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.8)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
