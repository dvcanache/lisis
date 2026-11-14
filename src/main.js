import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const ROT_SPEED = 0.4;

const asciiCanvas = document.getElementById('ascii-canvas');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

const renderer = new THREE.WebGLRenderer({
  canvas: asciiCanvas,
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050b1a);

const initialAspect = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(45, initialAspect, 0.1, 100);
const zoomFactor = initialAspect < 1 ? 1 / Math.max(initialAspect, 0.45) : 1;
camera.position.set(0, 1.1 * zoomFactor, 4.2 * zoomFactor);

const controls = new OrbitControls(camera, asciiCanvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0, 0);
controls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// Lighting
scene.add(new THREE.AmbientLight(0xffffff, 1.35));
scene.add(new THREE.HemisphereLight(0x88e0ff, 0x1a2b24, 0.9));

const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
keyLight.position.set(3, 5, 4);
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x7be0ff, 1.1);
rimLight.position.set(-4, 2, -3);
scene.add(rimLight);

const fillLight = new THREE.PointLight(0xff9cf0, 1.2, 12);
fillLight.position.set(0, -1.5, 2.5);
scene.add(fillLight);

let modelRoot = null;
let bgRoot = null;
let flowerBaseY = -1.1;
let mixer = null;
let renderTarget = null;
let pixelBuffer = new Uint8Array(0);
let cols = 0;
let rows = 0;
let viewWidth = 0;
let viewHeight = 0;
let cellW = 0;

function createNaviTextMesh() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.font = '600 132px "Cinzel", "Papyrus", "Times New Roman", serif';
  ctx.shadowColor = '#28f0ff';
  ctx.shadowBlur = 32;
  ctx.fillStyle = '#c8ffff';
  ctx.fillText('OEL NGATI KAMEIE', canvas.width / 2, 210);
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('OEL NGATI KAMEIE', canvas.width / 2, 210);

  ctx.font = '500 44px "JetBrains Mono", monospace';
  ctx.shadowColor = '#28f0ff';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#7bf5ff';
  ctx.fillText('— TE VEO —', canvas.width / 2, 345);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  const radius = 1.65;
  const arcAngle = Math.PI * 0.85;
  const geom = new THREE.CylinderGeometry(
    radius,
    radius,
    0.85,
    48,
    1,
    true,
    -arcAngle / 2,
    arcAngle
  );

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(0, -0.95, 0);
  return mesh;
}

const naviTextMesh = createNaviTextMesh();
naviTextMesh.position.set(0, 1.05, -0.5);
scene.add(naviTextMesh);

function updateDimensions() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function groundFlower() {
  if (!modelRoot || !bgRoot) return;
  const bgBox = new THREE.Box3().setFromObject(bgRoot);
  const flowerBox = new THREE.Box3().setFromObject(modelRoot);
  const deltaY = bgBox.min.y - flowerBox.min.y;
  modelRoot.position.y += deltaY + 0.55;
  flowerBaseY = modelRoot.position.y;
  controls.target.set(0, flowerBaseY + 0.8, 0);
  controls.update();
}

function onAssetReady() {
  onAssetReady.count = (onAssetReady.count || 0) + 1;
  if (onAssetReady.count >= 2) {
    groundFlower();
    document.getElementById('loader-spinner').classList.add('hidden');
    loadingText.classList.add('hidden');
    document.getElementById('btn-start').classList.remove('hidden');
  }
}

function loadModel() {
  const loader = new FBXLoader();
  loader.load(
    '/glowing-flower.fbx',
    (fbx) => {
      const box = new THREE.Box3().setFromObject(fbx);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 2.8 / maxDim;

      fbx.position.sub(center);
      const wrapper = new THREE.Group();
      wrapper.add(fbx);
      wrapper.scale.setScalar(scale);

      fbx.traverse((child) => {
        if (child.isMesh) {
          const cBox = new THREE.Box3().setFromObject(child);
          const cSize = cBox.getSize(new THREE.Vector3());
          const cCenter = cBox.getCenter(new THREE.Vector3());
          if (cSize.y < Math.max(cSize.x, cSize.z) * 0.25 && cCenter.y < 0) {
            child.visible = false;
            return;
          }
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((mat) => {
              mat.side = THREE.DoubleSide;
            });
          }
        }
      });

      modelRoot = wrapper;
      modelRoot.position.y = -1.1;
      scene.add(modelRoot);

      if (fbx.animations && fbx.animations.length > 0) {
        mixer = new THREE.AnimationMixer(fbx);
        mixer.clipAction(fbx.animations[0]).play();
      }

      onAssetReady();
    },
    (xhr) => {
      if (xhr.total > 0) {
        const pct = Math.round((xhr.loaded / xhr.total) * 100);
        loadingText.textContent = `Cargando... ${pct}%`;
      }
    },
    (err) => {
      console.error('Failed to load FBX:', err);
      loadingText.textContent = 'Error al cargar el modelo.';
    }
  );

  // Load Avatar background scene
  const bgLoader = new FBXLoader();
  bgLoader.setResourcePath('/avatar-scene/textures/');
  bgLoader.load(
    '/avatar-scene/source/Scene Avatar 13_07.fbx',
    (bgFbx) => {
      const box = new THREE.Box3().setFromObject(bgFbx);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const scale = 12 / maxDim;

      bgFbx.position.sub(center);
      bgFbx.traverse((child) => {
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
            if (mat.emissiveMap) {
              mat.emissive = new THREE.Color(0xffffff);
              mat.emissiveIntensity = 1.6;
            }
          });
        }
      });

      const bgWrapper = new THREE.Group();
      bgWrapper.add(bgFbx);
      bgWrapper.scale.setScalar(scale);
      bgWrapper.position.set(0, 0.2, 0);
      bgRoot = bgWrapper;
      scene.add(bgRoot);

      onAssetReady();
    },
    undefined,
    (err) => {
      console.warn('Background scene failed to load:', err);
      onAssetReady();
    }
  );
}

function renderAsciiFrame() {
  if (!renderTarget || cols === 0 || rows === 0) return;

  renderer.setRenderTarget(renderTarget);
  renderer.render(scene, camera);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, cols, rows, pixelBuffer);
  renderer.setRenderTarget(null);

  asciiCtx.fillStyle = '#050608';
  asciiCtx.fillRect(0, 0, viewWidth, viewHeight);
  asciiCtx.font = `500 ${CELL_SIZE}px "JetBrains Mono", monospace`;
  asciiCtx.textBaseline = 'top';

  let lastColor = '';

  for (let y = 0; y < rows; y++) {
    const srcRow = (rows - 1 - y) * cols * 4;
    const drawY = y * CELL_SIZE;

    for (let x = 0; x < cols; x++) {
      const idx = srcRow + x * 4;
      const r = pixelBuffer[idx];
      const g = pixelBuffer[idx + 1];
      const b = pixelBuffer[idx + 2];

      // Original luminance (no contrast distortion)
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (lum < 0.015) continue;

      const charIdx = Math.min(RAMP_MAX, (lum * RAMP_MAX + 0.5) | 0);
      const ch = RAMP[charIdx];
      if (ch === ' ') continue;

      const cr = Math.min(255, (r * 1.35) | 0);
      const cg = Math.min(255, (g * 1.35) | 0);
      const cb = Math.min(255, (b * 1.35) | 0);
      const color = `rgb(${cr},${cg},${cb})`;
      if (color !== lastColor) {
        asciiCtx.fillStyle = color;
        lastColor = color;
      }

      asciiCtx.fillText(ch, x * cellW, drawY);
    }
  }
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (modelRoot) {
    modelRoot.rotation.y += delta * ROT_SPEED;
  }
  naviTextMesh.position.y = 1.05 + Math.sin(clock.elapsedTime * 1.2) * 0.08;

  if (mixer) {
    mixer.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

const bgMusic = document.getElementById('bg-music');
const btnStart = document.getElementById('btn-start');

btnStart.addEventListener('click', () => {
  loadingOverlay.classList.add('hidden');
  bgMusic.play().catch(() => {});
});

window.addEventListener('resize', updateDimensions);

updateDimensions();
loadModel();
animate();
