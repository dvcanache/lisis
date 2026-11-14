import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const RAMP = ' .:-=+*#%@';
const RAMP_MAX = RAMP.length - 1;
const CELL_SIZE = 4;
const ROT_SPEED = 0.4;
const GLOW_STRENGTH = 0.85;

const asciiCanvas = document.getElementById('ascii-canvas');
const asciiCtx = asciiCanvas.getContext('2d', { alpha: false });
const glowCanvas = document.createElement('canvas');
const glowCtx = glowCanvas.getContext('2d');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Offscreen WebGL renderer
const glCanvas = document.createElement('canvas');
const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas,
  antialias: false,
  powerPreference: 'high-performance',
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

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
  ctx.fillText('— I SEE YOU —', canvas.width / 2, 345);

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
scene.add(naviTextMesh);

function updateDimensions() {
  viewWidth = window.innerWidth;
  viewHeight = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);

  asciiCanvas.width = (viewWidth * dpr) | 0;
  asciiCanvas.height = (viewHeight * dpr) | 0;
  asciiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

  camera.aspect = viewWidth / viewHeight;
  camera.updateProjectionMatrix();

  const targetCellW = CELL_SIZE * 0.62;
  const newCols = Math.max(20, (viewWidth / targetCellW) | 0);
  const newRows = Math.max(12, (viewHeight / CELL_SIZE) | 0);
  cellW = viewWidth / newCols;

  if (newCols !== cols || newRows !== rows) {
    cols = newCols;
    rows = newRows;

    if (renderTarget) renderTarget.dispose();
    renderTarget = new THREE.WebGLRenderTarget(cols, rows, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });
    pixelBuffer = new Uint8Array(cols * rows * 4);

    glowCanvas.width = Math.max(1, (viewWidth * 0.4) | 0);
    glowCanvas.height = Math.max(1, (viewHeight * 0.4) | 0);
  }
}

function onAssetReady() {
  onAssetReady.count = (onAssetReady.count || 0) + 1;
  if (onAssetReady.count >= 2) {
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
        if (child.isMesh && child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            mat.side = THREE.DoubleSide;
          });
        }
      });

      modelRoot = wrapper;
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
        loadingText.textContent = `Loading... ${pct}%`;
      }
    },
    (err) => {
      console.error('Failed to load FBX:', err);
      loadingText.textContent = 'Error loading model.';
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
      const bgWrapper = new THREE.Group();
      bgWrapper.add(bgFbx);
      bgWrapper.scale.setScalar(scale);
      bgWrapper.position.set(0, 0.2, 0);
      scene.add(bgWrapper);

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

      const color = `rgb(${r},${g},${b})`;
      if (color !== lastColor) {
        asciiCtx.fillStyle = color;
        lastColor = color;
      }

      asciiCtx.fillText(ch, x * cellW, drawY);
    }
  }

  // Lightweight GPU-accelerated bloom pass
  glowCtx.clearRect(0, 0, glowCanvas.width, glowCanvas.height);
  glowCtx.drawImage(asciiCanvas, 0, 0, glowCanvas.width, glowCanvas.height);

  asciiCtx.save();
  asciiCtx.globalCompositeOperation = 'lighter';
  asciiCtx.globalAlpha = GLOW_STRENGTH * 0.55;
  asciiCtx.filter = 'blur(6px)';
  asciiCtx.drawImage(glowCanvas, 0, 0, viewWidth, viewHeight);
  asciiCtx.restore();
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (modelRoot) {
    modelRoot.rotation.y += delta * ROT_SPEED;
  }
  naviTextMesh.position.y = -0.95 + Math.sin(clock.elapsedTime * 1.4) * 0.05;

  if (mixer) {
    mixer.update(delta);
  }

  controls.update();
  renderAsciiFrame();
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
