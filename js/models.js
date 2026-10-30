// 로우폴리 3D 모델(바이크, 자동차, 소품)과 캔버스 텍스처 생성
// + 외부 .glb/.gltf 모델을 불러와 교체하는 ModelManager (없으면 절차적 모델로 fallback)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_CONFIG } from './config.js';
import { icon as svgIcon } from './icons.js';
import { drawFlag } from './themes.js';

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
};

const GLASS = 0x1b2735;
const RUBBER = 0x141414;
const TRIM = 0x2a2a2a;

function buildCar(type) {
  const d = CAR_DEFS[type];
  const L = d.len, W = d.w, hl = L / 2, hw = W / 2;
  const body = [], det = [], tail = [], head = [], bl = [], br = [];
  const big = type === 'truck' || type === 'bus';
  const small = type === 'tuktuk' || type === 'scooter';
  const wr = big ? 0.5 : small ? 0.28 : 0.36;
  const wheelZ = type === 'bus' ? [-hl + 2, hl - 2.2] : type === 'truck' ? [-hl + 1.2, hl - 1.4, hl - 2.6] : small ? [-hl + 0.4, hl - 0.45] : [-hl + 0.85, hl - 0.85];
  if (type !== 'scooter') {
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
    det.push(box(W + 0.06, 0.12, L - 2.6, 0, 3.0, -hl + 2.4 + (L - 2.6) / 2, 0xff6b00));
    det.push(box(W, 0.3, L, 0, 0.6, 0, 0x333333));
    lightY = 0.95;
  } else if (type === 'bus') {
    body.push(box(W, 2.6, L, 0, 1.75, 0));
    det.push(box(W + 0.02, 0.85, L * 0.9, 0, 2.2, 0.3, GLASS));
    det.push(box(W * 0.9, 1.1, 0.05, 0, 2.0, -hl - 0.01, GLASS));
    det.push(box(W + 0.02, 0.22, L + 0.02, 0, 0.6, 0, TRIM));
    det.push(box(W * 0.7, 0.25, 0.05, 0, 2.85, -hl - 0.02, 0x101010));
    lightY = 0.9;
  } else {
    const suv = type === 'suv';
    const bh = suv ? 0.8 : 0.62, by = 0.3;
    body.push(box(W, bh, L, 0, by + bh / 2, 0));
    const ch = suv ? 0.62 : 0.5, cl = suv ? L * 0.62 : L * 0.5, cz = suv ? 0.3 : 0.25;
    det.push(box(W * 0.86, ch, cl, 0, by + bh + ch / 2, cz, GLASS));
    body.push(box(W * 0.84, 0.08, cl * 0.92, 0, by + bh + ch + 0.04, cz));
    det.push(box(W + 0.04, 0.2, 0.22, 0, by + 0.12, -hl, TRIM));
    det.push(box(W + 0.04, 0.2, 0.22, 0, by + 0.12, hl, TRIM));
    lightY = by + bh - 0.17;
    const roofY = by + bh + ch + 0.08;
    if (type === 'taxi') {
      det.push(box(0.6, 0.22, 0.3, 0, roofY + 0.11, cz, 0xfff3b0));
      det.push(box(W + 0.01, 0.1, L * 0.7, 0, by + bh * 0.5, 0, 0x222222));
    }
    if (type === 'police') {
      det.push(box(W + 0.01, 0.16, L * 0.8, 0, by + bh * 0.5, 0, 0x1e4fd8));
      det.push(box(1.1, 0.06, 0.3, 0, roofY + 0.03, cz, 0x111111));
      sirenR = box(0.45, 0.16, 0.26, -0.27, roofY + 0.14, cz);
      sirenB = box(0.45, 0.16, 0.26, 0.27, roofY + 0.14, cz);
    }
  }

  for (const s of [-1, 1]) {
    tail.push(box(0.36, 0.18, 0.05, s * (hw - 0.3), lightY, hl + 0.02));
    head.push(box(0.36, 0.16, 0.05, s * (hw - 0.3), lightY, -hl - 0.02));
  }
  for (const z of [hl + 0.03, -hl - 0.03]) {
    bl.push(box(0.12, 0.12, 0.05, -hw + 0.06, lightY, z));
    br.push(box(0.12, 0.12, 0.05, hw - 0.06, lightY, z));
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
  basic:  { shell: 0x00b14f, visor: 0x0c0c0c },
  full:   { shell: 0x15171a, visor: 0x3a6ea5, full: true },
  retro:  { shell: 0xf3efe6, visor: 0x0c0c0c, stripe: 0xe63946 },
  gold:   { shell: 0xe6b422, visor: 0x2a1f00, shine: true },
  neko:   { shell: 0xffb3c7, visor: 0x0c0c0c, ears: true },
  carbon: { shell: 0x2e3135, visor: 0x8a2be2, full: true, stripe: 0x55595e },
  chrome: { shell: 0xd5dade, visor: 0x101418, full: true, shine: true },
  crown:  { shell: 0xffd700, visor: 0x2a1f00, crown: true, shine: true },
};

function deliveryBox(det, glow, style) {
  const st = BOX_STYLES[style] || BOX_STYLES.basic;
  det.push(box(0.34, 0.05, 0.4, 0, 1.03, 0.66, 0x333333));
  det.push(box(0.56, 0.5, 0.5, 0, 1.31, 0.68, st.base));
  (st.glow ? glow : det).push(box(0.575, 0.06, 0.515, 0, 1.4, 0.68, st.band));
  (st.glow ? glow : det).push(box(0.585, 0.04, 0.525, 0, 1.57, 0.68, st.lid));
  if (st.glow) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) glow.push(box(0.03, 0.5, 0.03, sx * 0.28, 1.31, 0.68 + sz * 0.25, st.band));
  }
  if (st.lock) {
    det.push(box(0.12, 0.14, 0.04, 0, 1.42, 0.94, 0xf5c518));
    for (const sx of [-1, 1]) det.push(box(0.04, 0.52, 0.52, sx * 0.2, 1.31, 0.68, 0xf5c518));
  }
  if (style === 'styrofoam') det.push(box(0.1, 0.51, 0.52, 0, 1.31, 0.68, 0x2f7fe0));
  if (st.stack) for (let i = 0; i < 3; i++) det.push(box(0.6, 0.04, 0.54, 0, 1.12 + i * 0.16, 0.68, 0xe63946));
  if (st.camo) {
    for (const [sx, sy, sz, c] of [[0.29, 1.2, 0.6, 0x3b4422], [0.29, 1.42, 0.8, 0x8a7f4f], [-0.29, 1.3, 0.55, 0x8a7f4f], [-0.29, 1.45, 0.82, 0x3b4422]]) {
      det.push(box(0.02, 0.14, 0.18, sx, sy, sz, c));
    }
  }
}

// 바이크 차종별 외형 (config.js BIKES[].style)
function bikeShape(style, body, det, glow, accent) {
  if (style === 'classic') {
    const lamp = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 14);
    lamp.rotateX(Math.PI / 2);
    lamp.translate(0, 0.92, -0.72);
    det.push(paint(lamp, 0xd9dde1));
    for (const z of [-0.72, 0.7]) det.push(box(0.16, 0.04, 0.5, 0, 0.74, z, 0xd9dde1));
    det.push(box(0.32, 0.06, 0.46, 0, 1.01, 0.2, 0x7a4a22));
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
    for (const sx of [-1, 1]) glow.push(box(0.02, 0.04, 0.9, sx * 0.2, 0.78, -0.1, neon));
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
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const bikeTail = tailMat.clone(); // 내 바이크 전용 (브레이크 시 밝아짐)
  const body = [], det = [], head = [], tail = [], glow = [];
  const out = OUTFIT_STYLES[opts.outfit] || OUTFIT_STYLES.jacket;
  const hel = HELMET_STYLES[opts.helmet] || HELMET_STYLES.basic;
  bikeShape(opts.style || 'scooter', body, det, glow, opts.accent);
  if (opts.national) {
    // 국가대표 바이크: 포인트 색 레이싱 스트라이프 + 금색 트림 + 번호판 #1
    const ac = opts.accent ?? 0xffd700;
    det.push(box(0.41, 0.07, 0.66, 0, 0.99, -0.3, ac, -0.35));
    det.push(box(0.12, 0.31, 0.64, 0, 0.83, -0.3, ac, -0.35));
    glow.push(box(0.43, 0.03, 0.03, 0, 0.92, -0.62, 0xffd700));
    det.push(box(0.2, 0.14, 0.02, 0, 0.82, 0.82, 0xffffff));
    det.push(box(0.04, 0.1, 0.025, 0, 0.82, 0.83, 0x111111));
  }
  const JACKET = out.top;
  const PANTS = out.pants;

  for (const z of [-0.72, 0.7]) {
    const t = new THREE.TorusGeometry(0.3, 0.1, 8, 18);
    t.rotateY(Math.PI / 2);
    t.translate(0, 0.4, z);
    det.push(paint(t, 0x111111));
    det.push(cylX(0.13, 0.14, 0, 0.4, z, 0x8a8f96, 10));
  }
  det.push(box(0.3, 0.32, 0.6, 0, 0.58, 0.05, 0x3a3a3a));
  const ex = new THREE.CylinderGeometry(0.06, 0.085, 0.75, 8);
  ex.rotateX(Math.PI / 2);
  ex.translate(0.2, 0.47, 0.5);
  det.push(paint(ex, 0xc0c4c8));
  const fork = new THREE.CylinderGeometry(0.035, 0.035, 0.8, 6);
  fork.rotateX(-0.45);
  fork.translate(0, 0.74, -0.58);
  det.push(paint(fork, 0x666666));
  det.push(box(0.3, 0.08, 0.42, 0, 1.0, 0.22, 0x161616));
  det.push(box(0.3, 0.2, 0.04, 0, 1.15, -0.62, 0x223344, -0.9));
  det.push(box(0.64, 0.045, 0.045, 0, 1.06, -0.5, 0x222222));

  body.push(box(0.38, 0.42, 0.5, 0, 0.88, -0.42, null, -0.5));
  body.push(box(0.34, 0.22, 0.5, 0, 0.96, -0.06, null, 0.1));
  body.push(box(0.28, 0.16, 0.5, 0, 0.94, 0.52, null, -0.25));

  // 라이더 (의상 + 헬멧)
  det.push(box(0.38, 0.5, 0.26, 0, 1.3, 0.02, JACKET, -0.75));
  det.push(box(0.39, 0.06, 0.27, 0, 1.2, 0.08, out.trim, -0.75));
  if (out.poncho) {
    // 우비: 어깨에서 퍼지는 판초 + 후드
    const pon = new THREE.CylinderGeometry(0.2, 0.36, 0.62, 8, 1, true);
    pon.rotateX(-0.75);
    pon.translate(0, 1.27, 0.05);
    det.push(paint(pon, JACKET));
  }
  const helmet = new THREE.SphereGeometry(0.18, 12, 10);
  helmet.translate(0, 1.58, -0.2);
  det.push(paint(helmet, hel.shell));
  if (hel.full) det.push(box(0.26, 0.12, 0.1, 0, 1.52, -0.36, hel.shell));
  det.push(box(0.22, hel.full ? 0.1 : 0.08, 0.06, 0, 1.58, -0.37, hel.visor));
  if (hel.stripe) det.push(box(0.05, 0.05, 0.36, 0, 1.75, -0.2, hel.stripe));
  if (hel.shine) glow.push(box(0.04, 0.04, 0.3, 0.09, 1.71, -0.2, 0xfff3b0));
  if (hel.ears) {
    for (const sx of [-1, 1]) {
      const ear = new THREE.ConeGeometry(0.06, 0.13, 4);
      ear.translate(sx * 0.1, 1.77, -0.18);
      det.push(paint(ear, hel.shell));
    }
  }
  if (hel.crown) {
    const band = new THREE.CylinderGeometry(0.13, 0.13, 0.05, 12);
    band.translate(0, 1.76, -0.2);
    det.push(paint(band, 0xffd700));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const sp = new THREE.ConeGeometry(0.03, 0.1, 4);
      sp.translate(Math.cos(a) * 0.11, 1.84, -0.2 + Math.sin(a) * 0.11);
      glow.push(paint(sp, 0xffe066));
    }
  }
  if (out.reflect) for (const y of [1.18, 1.36]) glow.push(box(0.395, 0.04, 0.275, 0, y, 0.05, 0xe6ff5c, -0.75));
  if (out.hump) det.push(box(0.22, 0.16, 0.12, 0, 1.47, 0.12, 0xffffff, -0.75));
  if (out.bow) det.push(box(0.12, 0.05, 0.04, 0, 1.47, -0.14, 0xd62828));
  for (const s of [-1, 1]) {
    det.push(box(0.1, 0.1, 0.46, s * 0.21, 1.28, -0.3, JACKET, 0.35));
    det.push(box(0.13, 0.13, 0.46, s * 0.18, 1.02, 0.12, PANTS, 0.25));
    det.push(box(0.12, 0.42, 0.12, s * 0.21, 0.74, 0.3, PANTS, 0.3));
  }

  // 배달 박스 (뒷좌석 랙 위) — 외부 'box' 모델이 있으면 그것으로 교체
  const extBox = models.instantiate('box');
  if (!extBox) deliveryBox(det, glow, opts.box);

  head.push(box(0.18, 0.12, 0.05, 0, 0.92, -0.7));
  tail.push(box(0.16, 0.06, 0.04, 0, 1.0, 0.78));

  lean.add(
    new THREE.Mesh(merge(body), bodyMat),
    new THREE.Mesh(merge(det), vcMat),
    new THREE.Mesh(merge(head), headMat),
    new THREE.Mesh(merge(tail), bikeTail),
  );
  if (glow.length) lean.add(new THREE.Mesh(merge(glow), new THREE.MeshBasicMaterial({ vertexColors: true })));
  if (extBox) {
    extBox.position.set(0, 1.05, 0.68);
    lean.add(extBox);
  }
  const flame = makeFlame();
  lean.add(flame);
  // 브레이크 시 후미등(스톱램프) 글로우
  if (opts.flag) lean.add(flagDecals(opts.flag, Boolean(extBox)));
  const brakeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  brakeGlow.position.set(0, 1.0, 0.82);
  brakeGlow.scale.set(1.6, 1.0, 1);
  lean.add(brakeGlow);
  root.add(shadow(0.9, 2.2));
  return { root, lean, bodyMat, flame, tailMat: bikeTail, brakeGlow };
}

// 국가 1위 전용 국기: 헬멧 스티커 + 차체 데칼 + 배달 상자 깃발
function flagDecals(code, extBox) {
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
    decal(0.14, 0.093, sx * 0.183, 1.6, -0.17, sx * Math.PI / 2); // 헬멧 옆면
    decal(0.3, 0.2, sx * 0.173, 0.97, -0.06, sx * Math.PI / 2, -0.1); // 시트 아래 차체
  }
  // 상자 뒤 모서리의 깃대 + 깃발
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.75, 6), new THREE.MeshLambertMaterial({ color: 0xd0d4d8 }));
  const top = extBox ? 1.7 : 1.59;
  pole.position.set(0.24, top + 0.375, 0.88);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.24).translate(0.18, 0, 0), new THREE.MeshBasicMaterial({ map: flagTexture(code), side: THREE.DoubleSide }));
  cloth.rotation.y = -Math.PI / 2 + 0.25; // 주행 반대 방향(+z, 뒤쪽)으로 휘날림
  cloth.position.set(0.24, top + 0.62, 0.88);
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
      for (let fl = 1; fl < h / 3; fl++) {
        b.push(box(0.1, 1.4, 1.1, face + 0.04, fl * 3 + 0.6, z - 1, 0x2d6a4f));
        b.push(box(0.1, 1.4, 1.1, face + 0.04, fl * 3 + 0.6, z + 1, 0x2d6a4f));
        b.push(box(0.6, 0.1, 3.8, face + 0.3, fl * 3 - 0.3, z, 0x9c6644));
      }
      b.push(box(0.12, 2.4, 3.6, face + 0.05, 1.2, z, 0x6c757d));
      for (const lz of [z - 1.4, z + 1.4]) g.push(paint(new THREE.SphereGeometry(0.28, 8, 6).translate(face + 0.55, 2.9, lz), 0xff3b30));
      g.push(box(0.15, 0.7, 3.4, face + 0.12, 3.4, z, 0xd00000));
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
    return { base: merge(b), glow: merge(g) };
  }
  return { base: rukoGeometry(), glow: null };
}

export function treeVariant(kind) {
  if (kind === 'palm') return palmGeometry();
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
    case 'monas': // 모나스 탑
      p.push(box(40, 6, 40, 0, 3, 0, 0xeae2d6), box(24, 10, 24, 0, 11, 0, 0xeae2d6));
      p.push(cyl(2.5, 5, 90, 0, 61, 0, 0xf1ece4, 4));
      p.push(box(10, 4, 10, 0, 107, 0, 0xd8d0c4));
      g.push(cone(3.5, 12, 0, 115, 0, 0xffc300, 6));
      break;
    case 'pagoda': // 하노이 탑 + 지붕
      for (let i = 0; i < 6; i++) {
        p.push(box(26 - i * 3.5, 9, 26 - i * 3.5, 0, 4.5 + i * 13, 0, 0xc1440e));
        p.push(box(32 - i * 3.5, 1.5, 32 - i * 3.5, 0, 10 + i * 13, 0, 0x5a3e2b));
      }
      g.push(cone(2, 10, 0, 87, 0, 0xffd166));
      break;
    case 'temple': // 왓 아룬 풍 사원 첨탑
      p.push(box(70, 8, 40, 0, 4, 0, 0xf4e9d8));
      p.push(cone(16, 80, 0, 48, 0, 0xf2e6c9, 10));
      for (const sx of [-24, 24]) p.push(cone(8, 42, sx, 29, 0, 0xf2e6c9, 10));
      g.push(cone(3, 18, 0, 96, 0, 0xffc300), cone(1.6, 10, -24, 54, 0, 0xffc300), cone(1.6, 10, 24, 54, 0, 0xffc300));
      break;
    case 'namsan': // 남산 + N서울타워
      { const hill = new THREE.SphereGeometry(70, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); hill.scale(1.4, 0.55, 1); p.push(paint(hill, 0x2f5d3a)); }
      p.push(cyl(2.5, 3.5, 60, 0, 68, 0, 0xe6e6e6));
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
    case 'mbs': // 마리나 베이 샌즈: 3개 타워 + 스카이파크
      for (const x of [-30, 0, 30]) {
        const t = new THREE.BoxGeometry(14, 90, 18);
        t.translate(x, 45, 0);
        p.push(paint(t, 0xd9e2ec));
        g.push(paint(box(14.2, 1, 18.2, x, 70, 0), 0x9bf6ff));
      }
      p.push(box(100, 5, 22, 0, 93, 0, 0x8d99ae));
      g.push(paint(box(96, 1, 20, 0, 96, 0), 0x52b788));
      break;
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
    default:
      p.push(box(20, 60, 20, 0, 30, 0, 0x999999));
  }
  const grp = new THREE.Group();
  grp.add(new THREE.Mesh(merge(p), landmarkMat));
  if (g.length) grp.add(new THREE.Mesh(merge(g), landmarkGlowMat));
  return grp;
}

// ---------- 국기 / 국경 관문
const flagTexCache = {};
export function flagTexture(code) {
  if (flagTexCache[code]) return flagTexCache[code];
  const c = document.createElement('canvas');
  c.width = 192;
  c.height = 128;
  drawFlag(c.getContext('2d'), code, 192, 128);
  const t = new THREE.CanvasTexture(c);
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
  drawFlag(x, theme.code, 112, 74, 14, 11);
  drawFlag(x, theme.code, 112, 74, 898, 11);
  x.fillStyle = '#ffffff';
  x.font = 'bold 50px "Russo One", "Arial Black", sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(theme.welcome, 512, 52, 740);
  const tex = new THREE.CanvasTexture(c);
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
  drawFlag(x, code, 54, 36, 440, 204);
  const t = new THREE.CanvasTexture(c);
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
  drawFlag(x, data.code, 140, 92, 30, 96);
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
  const t = new THREE.CanvasTexture(c);
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
    x.fillStyle = lit ? '#000' : '#d8d8d8';
    x.fillRect(0, 0, 64, 128);
    for (let r = 0; r < 12; r++) {
      for (let k = 0; k < 5; k++) {
        if (lit) x.fillStyle = Math.random() < 0.45 ? '#ffd98a' : '#000';
        else x.fillStyle = '#3b4656';
        x.fillRect(4 + k * 12, 4 + r * 10, 8, 6);
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
