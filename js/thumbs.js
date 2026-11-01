// 상점 타일 썸네일: 아이템 3D 모델을 투명 배경 PNG 로 한 번 렌더해 캐시
// 화면에 보이는 타일만 요청 → 한 프레임에 몇 개씩 나눠 렌더(메뉴가 끊기지 않게)
import * as THREE from 'three';
import { createItemModel } from './models.js';

const SIZE = 200; // 고해상도 폰(70px × 약 2.8배)에서도 선명하게
const cache = new Map();   // key → dataURL
const queue = [];          // { key, kind, id, color }
let renderer = null, scene = null, cam = null, busy = false;

// 아이템 종류별 카메라 방향 (라이더 기준 앞 = -z)
const DIRS = {
  box: new THREE.Vector3(0.75, 0.55, 1),      // 뒤쪽 3/4 위
  helmet: new THREE.Vector3(0.7, 0.3, -1),    // 앞쪽 3/4
  outfit: new THREE.Vector3(0.8, 0.25, -0.9), // 앞쪽 3/4
  bike: new THREE.Vector3(1, 0.22, -0.3),     // 옆쪽 살짝 앞
};

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6470, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(3, 6, 4);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.8);
  fill.position.set(-4, 2, -5);
  scene.add(fill);
  cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
}

function renderOne({ kind, id, color }) {
  const model = createItemModel(kind, id, color);
  scene.add(model);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3(); // 보이는 메쉬만 (그림자·꺼진 불꽃 제외)
  model.traverseVisible((o) => { if (o.isMesh) box.union(new THREE.Box3().setFromObject(o)); });
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const dir = DIRS[kind].clone().normalize();
  const dist = (r / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 0.92;
  cam.position.copy(c).addScaledVector(dir, dist);
  cam.lookAt(c);
  cam.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/png');
  scene.remove(model);
  model.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
  return url;
}

function pump() {
  busy = true;
  const t0 = performance.now();
  while (queue.length && performance.now() - t0 < 24) {
    const job = queue.shift();
    if (cache.has(job.key)) continue;
    try {
      cache.set(job.key, renderOne(job));
    } catch (e) {
      cache.set(job.key, '');
    }
    for (const img of document.querySelectorAll(`img[data-thumb="${job.key}"]`)) if (cache.get(job.key)) { img.src = cache.get(job.key); img.classList.add('on'); }
  }
  if (queue.length) requestAnimationFrame(pump);
  else busy = false;
}

export const thumbKey = (kind, id) => `${kind}:${id}`;
export function thumbUrl(kind, id) { return cache.get(thumbKey(kind, id)) || ''; }

// 화면의 <img data-thumb> 중 아직 없는 것 렌더 요청
export function fillThumbs(root, colorOf = () => undefined) {
  const imgs = root.querySelectorAll('img[data-thumb]');
  for (const img of imgs) {
    const key = img.dataset.thumb;
    if (cache.get(key)) { img.src = cache.get(key); img.classList.add('on'); continue; }
    if (queue.some((j) => j.key === key)) continue;
    const [kind, id] = key.split(':');
    queue.push({ key, kind, id, color: colorOf(kind, id) });
  }
  if (!queue.length) return;
  if (!renderer) {
    try { setup(); } catch (e) { queue.length = 0; return; } // WebGL 컨텍스트를 못 만들면 색 견본만
  }
  if (!busy) requestAnimationFrame(pump);
}
