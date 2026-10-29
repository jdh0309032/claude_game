// 로우폴리 3D 모델(바이크, 자동차, 소품)과 캔버스 텍스처 생성
import * as THREE from 'three';
import { mergeGeometries } from '../vendor/BufferGeometryUtils.js';

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

  if (type === 'truck') {
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
export function createBike(color) {
  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const body = [], det = [], head = [], tail = [];
  const SUIT = 0x1d1d26;

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

  // 라이더
  det.push(box(0.38, 0.5, 0.26, 0, 1.3, 0.02, SUIT, -0.75));
  const helmet = new THREE.SphereGeometry(0.18, 12, 10);
  helmet.translate(0, 1.58, -0.2);
  body.push(helmet);
  det.push(box(0.22, 0.08, 0.06, 0, 1.58, -0.37, 0x0c0c0c));
  for (const s of [-1, 1]) {
    det.push(box(0.1, 0.1, 0.46, s * 0.21, 1.28, -0.3, SUIT, 0.35));
    det.push(box(0.13, 0.13, 0.46, s * 0.18, 1.02, 0.12, SUIT, 0.25));
    det.push(box(0.12, 0.42, 0.12, s * 0.21, 0.74, 0.3, SUIT, 0.3));
  }

  head.push(box(0.18, 0.12, 0.05, 0, 0.92, -0.7));
  tail.push(box(0.16, 0.06, 0.04, 0, 1.0, 0.78));

  lean.add(
    new THREE.Mesh(merge(body), bodyMat),
    new THREE.Mesh(merge(det), vcMat),
    new THREE.Mesh(merge(head), headMat),
    new THREE.Mesh(merge(tail), tailMat),
  );

  const flameGeo = new THREE.ConeGeometry(0.11, 0.9, 8);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.45);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({
    color: 0x66d9ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.position.set(0.2, 0.47, 0.85);
  flame.visible = false;
  lean.add(flame);

  root.add(shadow(0.9, 2.2));
  return { root, lean, bodyMat, flame };
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
  const parts = [];
  for (const s of [-1, 1]) {
    parts.push(box(0.12, 0.32, len, s * 8.6, 0.62, zCenter, 0xb9bec5));
    parts.push(box(0.1, 0.06, len, s * 8.6, 0.45, zCenter, 0x8a9098));
  }
  return new THREE.Mesh(merge(parts), vcMat);
}

// ---------- 파워업
const POWER_STYLE = {
  shield: { color: 0x4cc9f0, icon: '🛡️' },
  magnet: { color: 0xff4d6d, icon: '🧲' },
  x2:     { color: 0xffd60a, icon: 'x2' },
  slow:   { color: 0x80ed99, icon: '⏳' },
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
  x.font = 'bold 64px sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillStyle = '#fff';
  x.fillText(icon, 64, 68);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
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
