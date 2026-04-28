// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// @ts-ignore
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ===== 2D PAINTING SYSTEM =====
const canvas = document.getElementById('skinCanvas');
// @ts-ignore
const ctx = canvas.getContext('2d');
const colorPicker = document.getElementById('colorPicker');
const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const loadInput = document.getElementById('loadInput');
const toggleGuideBtn = document.getElementById('toggleGuide');
const skinGuide = document.getElementById('skinGuide');

let painting = false;
let currentTool = 'brush';
const toolButtons = document.querySelectorAll('.toolBtn[data-tool]');

toolButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    toolButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTool = btn.dataset.tool;
  });
});

// Initial fill
ctx.fillStyle = "#aaaaaa";
ctx.fillRect(0, 0, canvas.width, canvas.height);

function getMousePos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: Math.floor((e.clientX - rect.left) * scaleX),
    y: Math.floor((e.clientY - rect.top) * scaleY)
  };
}

canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  painting = true;
  handleToolAction(e);
});
canvas.addEventListener('mouseup', () => painting = false);
canvas.addEventListener('mouseleave', () => painting = false);
canvas.addEventListener('mousemove', e => {
  if (painting && currentTool === 'brush') handleToolAction(e);
});

// ===== ZOOM / PAN =====
const canvasStack = document.getElementById('canvasStack');
const canvasZoom = document.getElementById('canvasZoom');
let zoom = 1, panX = 0, panY = 0;
const MIN_ZOOM = 1, MAX_ZOOM = 32;

function applyTransform() {
  canvasZoom.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
}

function clampPan() {
  const r = canvasStack.getBoundingClientRect();
  panX = Math.min(0, Math.max(r.width  - r.width  * zoom, panX));
  panY = Math.min(0, Math.max(r.height - r.height * zoom, panY));
}

canvasStack.addEventListener('wheel', e => {
  e.preventDefault();
  const r = canvasStack.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const my = e.clientY - r.top;
  const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
  const lx = (mx - panX) / zoom;
  const ly = (my - panY) / zoom;
  zoom = next;
  panX = mx - lx * zoom;
  panY = my - ly * zoom;
  clampPan();
  applyTransform();
}, { passive: false });

let isPanning = false, lastX = 0, lastY = 0;
canvasStack.addEventListener('contextmenu', e => e.preventDefault());
canvasStack.addEventListener('mousedown', e => {
  if (e.button !== 2) return;
  isPanning = true;
  lastX = e.clientX;
  lastY = e.clientY;
  canvasStack.classList.add('panning');
  e.preventDefault();
});
window.addEventListener('mousemove', e => {
  if (!isPanning) return;
  panX += e.clientX - lastX;
  panY += e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  clampPan();
  applyTransform();
});
window.addEventListener('mouseup', e => {
  if (e.button === 2 && isPanning) {
    isPanning = false;
    canvasStack.classList.remove('panning');
  }
});

clearBtn.onclick = () => {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#aaaaaa";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  updateTexture();
};

saveBtn.onclick = () => {
  const link = document.createElement('a');
  link.download = 'skin.png';
  link.href = canvas.toDataURL();
  link.click();
};

loadBtn.onclick = () => loadInput.click();
loadInput.onchange = e => {
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    updateTexture();
  };
  img.src = URL.createObjectURL(file);
};

toggleGuideBtn.onclick = () => {
  skinGuide.classList.toggle('hidden');
  toggleGuideBtn.classList.toggle('active');
};
toggleGuideBtn.classList.add('active');

function handleToolAction(e) {
  const { x, y } = getMousePos(e);

  switch (currentTool) {
    case 'brush':
      ctx.fillStyle = colorPicker.value;
      ctx.fillRect(x, y, 1, 1);
      updateTexture();
      break;

    case 'picker':
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      colorPicker.value = rgbToHex(pixel[0], pixel[1], pixel[2]);
      currentTool = 'brush';
      document.querySelector('[data-tool="brush"]').classList.add('active');
      document.querySelector('[data-tool="picker"]').classList.remove('active');
      break;

    case 'bucket':
      bucketFill(x, y, hexToRgb(colorPicker.value));
      updateTexture();
      break;
  }
}

function bucketFill(x, y, fillColor) {
  const targetColor = ctx.getImageData(x, y, 1, 1).data;
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  const matchColor = (i) =>
    data[i] === targetColor[0] &&
    data[i + 1] === targetColor[1] &&
    data[i + 2] === targetColor[2] &&
    data[i + 3] === targetColor[3];

  const setColor = (i) => {
    data[i] = fillColor.r;
    data[i + 1] = fillColor.g;
    data[i + 2] = fillColor.b;
    data[i + 3] = 255;
  };

  const stack = [{ x, y }];
  while (stack.length) {
    const n = stack.pop();
    const idx = (n.y * width + n.x) * 4;
    if (!matchColor(idx)) continue;

    let west = n.x;
    let east = n.x;
    while (west >= 0 && matchColor((n.y * width + west) * 4)) west--;
    while (east < width && matchColor((n.y * width + east) * 4)) east++;

    for (let i = west + 1; i < east; i++) {
      setColor((n.y * width + i) * 4);
      if (n.y > 0 && matchColor(((n.y - 1) * width + i) * 4))
        stack.push({ x: i, y: n.y - 1 });
      if (n.y < height - 1 && matchColor(((n.y + 1) * width + i) * 4))
        stack.push({ x: i, y: n.y + 1 });
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex) {
  const bigint = parseInt(hex.slice(1), 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
}

// ===== 3D PREVIEW =====
const preview = document.getElementById('preview');
const renderer = new THREE.WebGLRenderer({ canvas: preview, antialias: true, alpha: true });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);
camera.position.set(0, 5, 140);

const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
scene.add(light);

const texture = new THREE.CanvasTexture(canvas);
texture.flipY = true;
texture.magFilter = THREE.NearestFilter;
texture.minFilter = THREE.NearestFilter;

const skinMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true });

// ============================ RUNTIME ============================
function resize() {
  const size = document.getElementById('rightPanel').clientHeight;
  renderer.setSize(size, size);
  camera.aspect = 1;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function updateTexture() {
  texture.needsUpdate = true;
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
controls.enablePan = false;
controls.target.set(0, 5, 0);
controls.minDistance = 20;
controls.maxDistance = 500;
// Left = paint on model, Right = orbit. Wheel still dollies.
controls.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

let fbxRoot = null;
const fbxLoader = new FBXLoader();
fbxLoader.load('models/EverRealmModel_v1.fbx', (fbx) => {
  fbx.traverse((child) => {
    if (child.isMesh) child.material = skinMat;
  });
  scene.add(fbx);
  fbxRoot = fbx;

  const box = new THREE.Box3().setFromObject(fbx);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  controls.target.copy(center);
  camera.position.set(center.x, center.y, center.z + size.length() * 1.2);
  controls.minDistance = size.length() * 0.3;
  controls.maxDistance = size.length() * 4;
  camera.updateProjectionMatrix();
  controls.update();
}, undefined, (err) => {
  console.error('Failed to load EverRealmModel_v1.fbx:', err);
});

// ===== 3D PAINTING =====
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let painting3D = false;

preview.addEventListener('contextmenu', e => e.preventDefault());

function paintAtPointer3D(e) {
  if (!fbxRoot) return false;
  const r = preview.getBoundingClientRect();
  ndc.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
  ndc.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(fbxRoot, true);
  if (!hits.length || !hits[0].uv) return false;
  let { x: u, y: v } = hits[0].uv;
  if (texture.flipY) v = 1 - v;
  const px = Math.floor(u * canvas.width);
  const py = Math.floor(v * canvas.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return false;

  if (currentTool === 'picker') {
    const data = ctx.getImageData(px, py, 1, 1).data;
    colorPicker.value = rgbToHex(data[0], data[1], data[2]);
    currentTool = 'brush';
    document.querySelector('[data-tool="brush"]').classList.add('active');
    document.querySelector('[data-tool="picker"]').classList.remove('active');
  } else if (currentTool === 'bucket') {
    bucketFill(px, py, hexToRgb(colorPicker.value));
    updateTexture();
  } else {
    ctx.fillStyle = colorPicker.value;
    ctx.fillRect(px, py, 1, 1);
    updateTexture();
  }
  return true;
}

preview.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  if (paintAtPointer3D(e)) {
    painting3D = true;
    preview.setPointerCapture(e.pointerId);
  }
});
preview.addEventListener('pointermove', e => {
  if (painting3D && currentTool === 'brush') paintAtPointer3D(e);
});
preview.addEventListener('pointerup', e => {
  if (painting3D) {
    painting3D = false;
    if (preview.hasPointerCapture(e.pointerId)) preview.releasePointerCapture(e.pointerId);
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
