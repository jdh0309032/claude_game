// 로우폴리 3D 모델(바이크, 자동차, 소품)과 캔버스 텍스처 생성
// + 외부 .glb/.gltf 모델을 불러와 교체하는 ModelManager (없으면 절차적 모델로 fallback)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MODEL_CONFIG } from './config.js';
import { icon as svgIcon } from './icons.js';

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
};

const GLASS = 0x1b2735;
const RUBBER = 0x141414;
const TRIM = 0x2a2a2a;

function buildCar(type) {
  const d = CAR_DEFS[type];
  const L = d.len, W = d.w, hl = L / 2, hw = W / 2;
  const body = [], det = [], tail = [], head = [], bl = [], br = [];
  const big = type === 'truck' || type === 'bus';
  const wr = big ? 0.5 : 0.36;
  const wheelZ = type === 'bus' ? [-hl + 2, hl - 2.2] : type === 'truck' ? [-hl + 1.2, hl - 1.4, hl - 2.6] : [-hl + 0.85, hl - 0.85];
  for (const z of wheelZ) {
    for (const s of [-1, 1]) {
      det.push(cylX(wr, 0.3, s * (hw - 0.12), wr, z, RUBBER, 14));
      det.push(cylX(wr * 0.5, 0.32, s * (hw - 0.12), wr, z, 0x9aa0a6, 10));
    }
  }
  let lightY, sirenR = null, sirenB = null;

  if (type === 'ramp') {
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
};
export const OUTFIT_STYLES = {
  jacket:     { top: 0x00b14f, trim: 0xffffff, pants: 0x23272b },
  raincoat:   { top: 0xffd21f, trim: 0xf2f2f2, pants: 0xffd21f, poncho: true },
  raincoat_p: { top: 0xff6fae, trim: 0xffffff, pants: 0xff6fae, poncho: true },
};
export const HELMET_STYLES = {
  basic:  { shell: 0x00b14f, visor: 0x0c0c0c },
  full:   { shell: 0x15171a, visor: 0x3a6ea5, full: true },
  retro:  { shell: 0xf3efe6, visor: 0x0c0c0c, stripe: 0xe63946 },
  gold:   { shell: 0xe6b422, visor: 0x2a1f00, shine: true },
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
  const brakeGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff2a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  brakeGlow.position.set(0, 1.0, 0.82);
  brakeGlow.scale.set(1.6, 1.0, 1);
  lean.add(brakeGlow);
  root.add(shadow(0.9, 2.2));
  return { root, lean, bodyMat, flame, tailMat: bikeTail, brakeGlow };
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
};

export function createPowerUp(type) {
  const { color, icon } = POWER_STYLE[type];
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.7 });
  let geo;
  if (type === 'shield') geo = new THREE.IcosahedronGeometry(0.55, 0);
  else if (type === 'magnet') geo = new THREE.TorusGeometry(0.42, 0.15, 8, 16, Math.PI);
  else if (type === 'x2') geo = new THREE.OctahedronGeometry(0.6);
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
