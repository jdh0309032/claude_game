// 3D 미리보기 (차고 360° 쇼룸 / 랭킹 Flex View / 전광판 스냅샷)
import * as THREE from 'three';
import { createBike } from './models.js';

function makeStageScene() {
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.8));
  const key = new THREE.SpotLight(0xffffff, 120, 30, 0.6, 0.5, 1.6);
  key.position.set(3.5, 5, -3);
  key.target.position.set(0, 0.9, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x9bf6ff, 1.6);
  rim.position.set(-4, 3, 4);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(2.4, 40).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x1f2533 }),
  );
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.25, 2.4, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00b14f }),
  );
  ring.position.y = 0.01;
  scene.add(floor, ring);
  return scene;
}

// 3/4 정면-측면 뷰 (바이크 앞 45°)
function frontSideCamera(aspect) {
  const cam = new THREE.PerspectiveCamera(32, aspect, 0.5, 30);
  cam.position.set(3.1, 2.1, -3.6);
  cam.lookAt(0, 1.05, 0); // 상자 위 국기 깃발까지 프레임 안에
  return cam;
}

export class PreviewStage {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'stage-canvas';
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = makeStageScene();
    this.camera = frontSideCamera(1);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.bike = null;
    this.key = '';
    this.yaw = 0;
    this.velocity = 0;
    this.draggable = false;
    this.active = false;
    this.t = 0;
    this._bindDrag();
  }

  setRider(opts, color) {
    const key = JSON.stringify([opts, color]);
    if (key === this.key) return;
    this.key = key;
    if (this.bike) this.pivot.remove(this.bike.root);
    this.bike = createBike(color, opts);
    this.pivot.add(this.bike.root);
  }

  // container 에 캔버스를 붙이고 렌더 시작 (draggable: 360° 회전 허용)
  mount(container, { draggable = false } = {}) {
    container.appendChild(this.canvas);
    this.draggable = draggable;
    this.yaw = 0;
    this.canvas.classList.toggle('draggable', draggable);
    this.active = true;
    this._resize();
    if (!this.raf) this._loop();
  }

  unmount() {
    this.active = false;
    this.canvas.remove();
  }

  _resize() {
    const r = this.canvas.parentElement?.getBoundingClientRect();
    if (!r || !r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
  }

  _bindDrag() {
    let lastX = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (!this.draggable) return;
      lastX = e.clientX;
      try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (lastX == null) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      this.yaw += dx * 0.012;
      this.velocity = dx * 0.012;
    });
    const end = () => { lastX = null; };
    this.canvas.addEventListener('pointerup', end);
    this.canvas.addEventListener('pointercancel', end);
  }

  _loop() {
    this.raf = requestAnimationFrame(() => {
      this.raf = null;
      if (!this.active) return;
      this.t += 1 / 60;
      if (this.draggable) {
        this.yaw += this.velocity;
        this.velocity *= 0.92;
        if (Math.abs(this.velocity) < 0.0005) this.yaw += 0.004; // 천천히 자동 회전
      } else {
        this.yaw = Math.sin(this.t * 0.6) * 0.18; // 미세한 아이들 흔들림
      }
      this.pivot.rotation.y = this.yaw;
      if (this.bike) {
        this.bike.lean.rotation.z = Math.sin(this.t * 1.7) * 0.03;
        this.bike.root.position.y = Math.sin(this.t * 9) * 0.006; // 엔진 아이들 진동
      }
      this._resize();
      this.renderer.render(this.scene, this.camera);
      this._loop();
    });
  }
}

// 전광판용 스냅샷: 메인 렌더러로 렌더 타깃에 한 번 그려서 텍스처로 사용 (픽셀 복사 없음)
const snapScene = makeStageScene();
const snapCam = frontSideCamera(1);
let snapBike = null;
export function renderRiderSnapshot(renderer, target, opts, color) {
  if (snapBike) snapScene.remove(snapBike.root);
  snapBike = createBike(color, opts);
  snapBike.root.rotation.y = 0.15;
  snapScene.add(snapBike.root);
  const prevTarget = renderer.getRenderTarget();
  const prevClear = renderer.getClearColor(new THREE.Color());
  const prevAlpha = renderer.getClearAlpha();
  renderer.setClearColor(0x0b1d2a, 1);
  renderer.setRenderTarget(target);
  renderer.clear();
  renderer.render(snapScene, snapCam);
  renderer.setRenderTarget(prevTarget);
  renderer.setClearColor(prevClear, prevAlpha);
}

// 자랑 카드용 히어로 렌더: 바닥 없이 투명 배경, 낮은 3/4 앞 각도 + 기울인 자세 → 캔버스 반환
// (WebGL 컨텍스트를 아끼려고 렌더러 하나를 만들어 재사용)
let heroR = null, heroScene = null, heroBike = null;
export function renderRiderHero(w, h, opts, color, { crashed = false } = {}) {
  if (!heroR) {
    heroR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    heroR.setPixelRatio(1);
    heroScene = new THREE.Scene();
    heroScene.add(new THREE.HemisphereLight(0xffffff, 0x2a3a30, 2.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.6);
    key.position.set(3, 6, -4);
    const rim = new THREE.DirectionalLight(0x7dffb0, 2.2);
    rim.position.set(-4, 2.5, 3);
    const fill = new THREE.DirectionalLight(0xffe2b0, 0.9);
    fill.position.set(4, 1, 2);
    heroScene.add(key, rim, fill);
  }
  if (heroBike) heroScene.remove(heroBike.root);
  heroBike = createBike(color, opts);
  heroScene.add(heroBike.root);
  // 달리는 자세: 몸을 기울이고 앞바퀴를 살짝 들어 올림 (크래시면 더 크게 기울임)
  heroBike.lean.rotation.z = crashed ? 0.55 : -0.22;
  heroBike.root.rotation.x = crashed ? 0 : -0.08;
  heroBike.root.rotation.y = -0.35;
  heroR.setSize(w, h, false);
  heroR.setClearColor(0x000000, 0);
  const cam = new THREE.PerspectiveCamera(30, w / h, 0.3, 40);
  cam.position.set(3.4, 1.15, -4.6);
  cam.lookAt(0, 1.0, 0.1);
  heroR.render(heroScene, cam);
  return heroR.domElement;
}
