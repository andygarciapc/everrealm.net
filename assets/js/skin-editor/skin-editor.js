// @ts-ignore
import * as THREE from 'three';
// @ts-ignore
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// @ts-ignore
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

// ===== DOM REFS =====
const canvas = document.getElementById('skinCanvas');
// @ts-ignore
const ctx = canvas.getContext('2d');
const displayCanvas = document.getElementById('displayCanvas');
// @ts-ignore
const displayCtx = displayCanvas.getContext('2d');

const colorPicker = document.getElementById('colorPicker');
const hexInput = document.getElementById('hexInput');
const brushSizeInput = document.getElementById('brushSize');
const brushSizeLabel = document.getElementById('brushSizeLabel');
const recentColorsDiv = document.getElementById('recentColors');

const clearBtn = document.getElementById('clearBtn');
const saveBtn = document.getElementById('saveBtn');
const loadBtn = document.getElementById('loadBtn');
const loadInput = document.getElementById('loadInput');
const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

const toggleGuideBtn = document.getElementById('toggleGuide');
const toggleGridBtn = document.getElementById('toggleGrid');
const toggleMirrorBtn = document.getElementById('toggleMirror');
const resetViewBtn = document.getElementById('resetViewBtn');

const skinGuide = document.getElementById('skinGuide');
const pixelGridDiv = document.getElementById('pixelGrid');
const brushPreviewDiv = document.getElementById('brushPreview');
const hudDiv = document.getElementById('hud');

const canvasStack = document.getElementById('canvasStack');
const canvasZoom = document.getElementById('canvasZoom');

// ===== STATE =====
let currentTool = 'brush';
let brushSize = 1;
let mirrorX = false;
let gridOn = false;

let painting = false;
let painting3D = false;
let lastPaintX = null;
let lastPaintY = null;

let zoom = 1, panX = 0, panY = 0;
const MIN_ZOOM = 1, MAX_ZOOM = 32;

let isPanning = false, lastX = 0, lastY = 0;

const HISTORY_LIMIT = 30;
/** @type {ImageData[]} */
const pastStack = [];
/** @type {ImageData[]} */
const futureStack = [];

const RECENT_LIMIT = 8;
const RECENT_KEY = 'everrealm.skinEditor.recentColors';
/** @type {string[]} */
let recentColors = [];

// ===== UV ISLANDS (per-face paint clipping) =====
// At FBX load we compute connected UV islands. Each island stores a Path2D
// (used as a canvas clip for brush/eraser) and a Uint8Array mask of length
// 128*128 (used by the bucket fill predicate). On stroke start we pin the
// island under the cursor; the entire stroke is clipped to it.
/** @type {Array<{path: Path2D, mask: Uint8Array}>} */
let uvIslands = [];
/** @type {Map<string, number>} */
let triangleToIsland = new Map();
/** @type {Int16Array | null} */
let pixelToIsland = null;
/** @type {{path: Path2D, mask: Uint8Array} | null} */
let currentIsland = null;

// ===== INITIAL FILL =====
ctx.fillStyle = '#aaaaaa';
ctx.fillRect(0, 0, canvas.width, canvas.height);

// Display canvas is the THREE texture source. It is supersampled (1024x1024)
// so we can draw 1-px grid lines between the 8x8 blocks that represent each
// paint pixel — at the canvas's native 128x128 with NearestFilter, a thin
// line is impossible to express. Saved PNGs come from the paint canvas, so
// the grid never bakes into the user's skin.
function syncDisplayCanvas() {
  displayCtx.imageSmoothingEnabled = false;
  displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
  displayCtx.drawImage(
    canvas,
    0, 0, canvas.width, canvas.height,
    0, 0, displayCanvas.width, displayCanvas.height
  );
  if (gridOn) drawTexelGrid(displayCtx);
}

function drawTexelGrid(c) {
  const cells = canvas.width; // 128
  const w = c.canvas.width;
  const h = c.canvas.height;
  const sx = w / cells;
  const sy = h / cells;
  c.save();
  c.strokeStyle = 'rgba(0,0,0,0.6)';
  c.lineWidth = 1;
  for (let i = 0; i <= cells; i++) {
    const px = Math.round(i * sx) + 0.5;
    c.beginPath(); c.moveTo(px, 0); c.lineTo(px, h); c.stroke();
    const py = Math.round(i * sy) + 0.5;
    c.beginPath(); c.moveTo(0, py); c.lineTo(w, py); c.stroke();
  }
  c.restore();
}

syncDisplayCanvas();

// ===== HISTORY =====
function pushHistory() {
  const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
  pastStack.push(snap);
  if (pastStack.length > HISTORY_LIMIT) pastStack.shift();
  futureStack.length = 0;
  refreshHistoryButtons();
}

function undo() {
  if (!pastStack.length) return;
  const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  futureStack.push(current);
  const prev = pastStack.pop();
  ctx.putImageData(prev, 0, 0);
  updateTexture();
  refreshHistoryButtons();
}

function redo() {
  if (!futureStack.length) return;
  const current = ctx.getImageData(0, 0, canvas.width, canvas.height);
  pastStack.push(current);
  const next = futureStack.pop();
  ctx.putImageData(next, 0, 0);
  updateTexture();
  refreshHistoryButtons();
}

function refreshHistoryButtons() {
  // @ts-ignore
  undoBtn.disabled = pastStack.length === 0;
  // @ts-ignore
  redoBtn.disabled = futureStack.length === 0;
}
refreshHistoryButtons();

// ===== STAMPING PRIMITIVES =====
function stampOnce(cx, cy, mode) {
  const half = Math.floor(brushSize / 2);
  const sx = cx - half;
  const sy = cy - half;
  ctx.save();
  if (currentIsland) ctx.clip(currentIsland.path);
  if (mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#000';
    ctx.fillRect(sx, sy, brushSize, brushSize);
  } else {
    ctx.fillStyle = colorPicker.value;
    ctx.fillRect(sx, sy, brushSize, brushSize);
  }
  ctx.restore();
}

function paintStamp(cx, cy, mode) {
  stampOnce(cx, cy, mode);
  if (mirrorX) stampOnce(canvas.width - 1 - cx, cy, mode);
}

function paintLine(x0, y0, x1, y1, mode) {
  // Bresenham — stamp the brush at every integer cell along the line so
  // a fast drag doesn't leave gaps between mousemove samples.
  let dx = Math.abs(x1 - x0);
  let dy = -Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1;
  let sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0, y = y0;
  // Skip the first cell — caller has already stamped it for (x0,y0) on the
  // previous move (or via the initial mousedown). This keeps redraws tight
  // when stamps overlap heavily.
  let first = true;
  while (true) {
    if (!first) paintStamp(x, y, mode);
    first = false;
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}

// ===== TOOL SELECTION =====
const toolButtons = document.querySelectorAll('.toolBtn[data-tool]');
toolButtons.forEach(btn => {
  // @ts-ignore
  btn.addEventListener('click', () => selectTool(btn.dataset.tool));
});

function selectTool(name) {
  currentTool = name;
  toolButtons.forEach(b => {
    // @ts-ignore
    b.classList.toggle('active', b.dataset.tool === name);
  });
}

// ===== 2D PAINT EVENTS =====
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
  lastPaintX = null;
  lastPaintY = null;
  const start = getMousePos(e);
  currentIsland = islandUnderTexel(start.x, start.y);
  if (currentTool === 'brush' || currentTool === 'eraser' || currentTool === 'bucket') {
    pushHistory();
  }
  if (currentTool === 'brush' || currentTool === 'bucket') {
    pushRecentColor(colorPicker.value);
  }
  painting = true;
  handleToolAction(e);
});
canvas.addEventListener('mouseup', () => {
  painting = false;
  lastPaintX = null;
  lastPaintY = null;
  currentIsland = null;
});
canvas.addEventListener('mouseleave', () => {
  painting = false;
  lastPaintX = null;
  lastPaintY = null;
  currentIsland = null;
  brushPreviewDiv.classList.add('hidden');
  hudDiv.classList.add('hidden');
});
canvas.addEventListener('mouseenter', () => {
  brushPreviewDiv.classList.remove('hidden');
  hudDiv.classList.remove('hidden');
});
canvas.addEventListener('mousemove', e => {
  updateBrushPreview(e);
  updateHud(e);
  if (painting && (currentTool === 'brush' || currentTool === 'eraser')) {
    handleToolAction(e);
  }
});

function handleToolAction(e) {
  const { x, y } = getMousePos(e);

  switch (currentTool) {
    case 'brush':
    case 'eraser': {
      const mode = currentTool === 'eraser' ? 'erase' : 'paint';
      if (lastPaintX !== null) {
        paintLine(lastPaintX, lastPaintY, x, y, mode);
      } else {
        paintStamp(x, y, mode);
      }
      lastPaintX = x;
      lastPaintY = y;
      updateTexture();
      break;
    }
    case 'picker': {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      setColor(rgbToHex(pixel[0], pixel[1], pixel[2]));
      // Stay on the picker — let the user keep sampling until they pick another tool.
      break;
    }
    case 'bucket': {
      const fill = hexToRgb(colorPicker.value);
      const mask = currentIsland ? currentIsland.mask : null;
      bucketFill(x, y, fill, mask);
      if (mirrorX) {
        const mx = canvas.width - 1 - x;
        const mirrorMask = mask || (islandUnderTexel(mx, y)?.mask) || null;
        bucketFill(mx, y, fill, mirrorMask);
      }
      updateTexture();
      break;
    }
  }
}

// ===== ZOOM / PAN =====
function applyTransform() {
  canvasZoom.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  updatePixelGrid();
}

function cellSizePx() {
  return (canvasStack.getBoundingClientRect().width / canvas.width) * zoom;
}

function updatePixelGrid() {
  const visible = gridOn && zoom >= 4;
  pixelGridDiv.classList.toggle('visible', visible);
  if (!visible) return;
  const cs = cellSizePx();
  const total = cs * canvas.width;
  pixelGridDiv.style.left = panX + 'px';
  pixelGridDiv.style.top = panY + 'px';
  pixelGridDiv.style.width = total + 'px';
  pixelGridDiv.style.height = total + 'px';
  pixelGridDiv.style.backgroundSize = `${cs}px ${cs}px`;
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

// ===== ACTIONS =====
clearBtn.onclick = () => {
  pushHistory();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#aaaaaa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  updateTexture();
};

saveBtn.onclick = () => save();

function save() {
  const link = document.createElement('a');
  link.download = 'skin.png';
  link.href = canvas.toDataURL();
  link.click();
}

loadBtn.onclick = () => loadInput.click();
loadInput.onchange = e => {
  // @ts-ignore
  const file = e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    pushHistory();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    updateTexture();
  };
  img.src = URL.createObjectURL(file);
};

undoBtn.onclick = () => undo();
redoBtn.onclick = () => redo();

// ===== TOGGLES =====
toggleGuideBtn.onclick = () => {
  skinGuide.classList.toggle('hidden');
  toggleGuideBtn.classList.toggle('active');
};

toggleGridBtn.onclick = () => {
  gridOn = !gridOn;
  toggleGridBtn.classList.toggle('active', gridOn);
  applyTransform();
  updateTexture();
};

toggleMirrorBtn.onclick = () => {
  mirrorX = !mirrorX;
  toggleMirrorBtn.classList.toggle('active', mirrorX);
};

resetViewBtn.onclick = () => {
  zoom = 1;
  panX = 0;
  panY = 0;
  applyTransform();
};

// ===== BRUSH SIZE =====
brushSizeInput.addEventListener('input', () => {
  // @ts-ignore
  setBrushSize(parseInt(brushSizeInput.value, 10));
});

function setBrushSize(n) {
  brushSize = Math.max(1, Math.min(8, n | 0));
  // @ts-ignore
  brushSizeInput.value = String(brushSize);
  brushSizeLabel.textContent = String(brushSize);
}
setBrushSize(1);

// ===== BRUSH PREVIEW + HUD =====
function updateBrushPreview(e) {
  const { x, y } = getMousePos(e);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    brushPreviewDiv.classList.add('hidden');
    return;
  }
  brushPreviewDiv.classList.remove('hidden');
  const half = Math.floor(brushSize / 2);
  const cs = cellSizePx();
  brushPreviewDiv.style.left   = (panX + (x - half) * cs) + 'px';
  brushPreviewDiv.style.top    = (panY + (y - half) * cs) + 'px';
  brushPreviewDiv.style.width  = (brushSize * cs) + 'px';
  brushPreviewDiv.style.height = (brushSize * cs) + 'px';
}

function updateHud(e) {
  const { x, y } = getMousePos(e);
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
    hudDiv.classList.add('hidden');
    return;
  }
  hudDiv.classList.remove('hidden');
  const px = ctx.getImageData(x, y, 1, 1).data;
  const hex = px[3] === 0 ? 'transparent' : rgbToHex(px[0], px[1], px[2]);
  hudDiv.textContent = `${x},${y} · ${hex}`;
}

// ===== COLOR / HEX SYNC =====
function setColor(hex) {
  hex = hex.toLowerCase();
  // @ts-ignore
  colorPicker.value = hex;
  // @ts-ignore
  hexInput.value = hex;
  hexInput.classList.remove('invalid');
}

colorPicker.addEventListener('input', () => {
  // @ts-ignore
  const v = colorPicker.value.toLowerCase();
  // @ts-ignore
  hexInput.value = v;
  hexInput.classList.remove('invalid');
});

hexInput.addEventListener('input', () => {
  // @ts-ignore
  let v = hexInput.value.trim().toLowerCase();
  if (v && v[0] !== '#') v = '#' + v;
  // Accept #rgb shorthand by expanding it.
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) v = '#' + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
  if (/^#[0-9a-f]{6}$/.test(v)) {
    // @ts-ignore
    colorPicker.value = v;
    hexInput.classList.remove('invalid');
  } else {
    hexInput.classList.add('invalid');
  }
});

hexInput.addEventListener('blur', () => {
  // On blur, snap the displayed text back to the canonical picker value.
  // @ts-ignore
  hexInput.value = colorPicker.value.toLowerCase();
  hexInput.classList.remove('invalid');
});

hexInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // @ts-ignore
    hexInput.blur();
  }
});

// ===== RECENT COLORS =====
function pushRecentColor(hex) {
  hex = hex.toLowerCase();
  recentColors = [hex, ...recentColors.filter(c => c !== hex)].slice(0, RECENT_LIMIT);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors)); } catch (_) {}
  renderRecentColors();
}

function renderRecentColors() {
  recentColorsDiv.innerHTML = '';
  recentColors.forEach(hex => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = hex;
    b.title = hex;
    b.addEventListener('click', () => setColor(hex));
    recentColorsDiv.appendChild(b);
  });
}

function loadRecentColors() {
  try {
    const saved = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    if (Array.isArray(saved)) {
      recentColors = saved.filter(c => typeof c === 'string').slice(0, RECENT_LIMIT);
    }
  } catch (_) {}
  renderRecentColors();
}
loadRecentColors();

// ===== KEYBOARD =====
window.addEventListener('keydown', (e) => {
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  const ctrl = e.ctrlKey || e.metaKey;

  if (ctrl && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (ctrl && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault(); redo(); return;
  }
  if (ctrl && (e.key === 's' || e.key === 'S')) {
    e.preventDefault(); save(); return;
  }
  if (ctrl) return;

  switch (e.key) {
    case 'b': case 'B': selectTool('brush'); break;
    case 'e': case 'E': selectTool('eraser'); break;
    case 'f': case 'F': selectTool('bucket'); break;
    case 'i': case 'I': selectTool('picker'); break;
    case 'g': case 'G': toggleGuideBtn.click(); break;
    case 'x': case 'X': toggleGridBtn.click(); break;
    case 'm': case 'M': toggleMirrorBtn.click(); break;
    case '[': e.preventDefault(); setBrushSize(brushSize - 1); break;
    case ']': e.preventDefault(); setBrushSize(brushSize + 1); break;
    case '0': e.preventDefault(); resetViewBtn.click(); break;
  }
});

// ===== UV ISLAND BUILD =====
function buildUVIslands(root) {
  /** @type {Array<{meshUuid: string, faceIndex: number, uv: number[][]}>} */
  const triangles = [];

  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const geo = obj.geometry;
    const uvAttr = geo && geo.attributes && geo.attributes.uv;
    if (!uvAttr) return;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx ? (idx.length / 3) : (uvAttr.count / 3);
    for (let f = 0; f < triCount; f++) {
      const a = idx ? idx[f * 3]     : f * 3;
      const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
      const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
      triangles.push({
        meshUuid: obj.uuid,
        faceIndex: f,
        uv: [
          [uvAttr.getX(a), uvAttr.getY(a)],
          [uvAttr.getX(b), uvAttr.getY(b)],
          [uvAttr.getX(c), uvAttr.getY(c)],
        ],
      });
    }
  });

  // Union-find over triangle indices.
  const parent = new Int32Array(triangles.length);
  for (let i = 0; i < parent.length; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Two triangles share an island when they share a UV-space edge — same UV
  // pair at both endpoints. Vertex-only contact is not enough.
  const edgeKey = (u1, v1, u2, v2) => {
    const a = u1.toFixed(5) + ',' + v1.toFixed(5);
    const b = u2.toFixed(5) + ',' + v2.toFixed(5);
    return a < b ? a + '|' + b : b + '|' + a;
  };
  const edgeMap = new Map();
  triangles.forEach((t, i) => {
    const [a, b, c] = t.uv;
    const edges = [[a, b], [b, c], [c, a]];
    for (const [p, q] of edges) {
      const k = edgeKey(p[0], p[1], q[0], q[1]);
      const list = edgeMap.get(k);
      if (list) {
        for (const j of list) union(i, j);
        list.push(i);
      } else {
        edgeMap.set(k, [i]);
      }
    }
  });

  // Group triangles by their union-find root.
  const groups = new Map();
  for (let i = 0; i < triangles.length; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(i);
  }

  // Build islands: Path2D + mask. flipY follows the texture (true today).
  const flipY = !!texture.flipY;
  const W = canvas.width, H = canvas.height;
  const islands = [];
  const triMap = new Map();
  const pxMap = new Int16Array(W * H);
  for (let i = 0; i < pxMap.length; i++) pxMap[i] = -1;

  let islandIndex = 0;
  for (const triIndices of groups.values()) {
    const path = new Path2D();
    const mask = new Uint8Array(W * H);

    for (const ti of triIndices) {
      const t = triangles[ti];
      const p = t.uv.map(([u, v]) => [u * W, (flipY ? 1 - v : v) * H]);
      path.moveTo(p[0][0], p[0][1]);
      path.lineTo(p[1][0], p[1][1]);
      path.lineTo(p[2][0], p[2][1]);
      path.closePath();
      rasterizeTriangleMask(mask, W, H,
        p[0][0], p[0][1], p[1][0], p[1][1], p[2][0], p[2][1]);
      triMap.set(t.meshUuid + '-' + t.faceIndex, islandIndex);
    }

    for (let i = 0; i < mask.length; i++) {
      if (mask[i]) pxMap[i] = islandIndex;
    }
    islands.push({ path, mask });
    islandIndex++;
  }

  uvIslands = islands;
  triangleToIsland = triMap;
  pixelToIsland = pxMap;
}

function rasterizeTriangleMask(mask, W, H, x0, y0, x1, y1, x2, y2) {
  const minX = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
  const maxX = Math.min(W - 1, Math.ceil(Math.max(x0, x1, x2)));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(y0, y1, y2)));
  const ax = x1 - x0, ay = y1 - y0;
  const bx = x2 - x0, by = y2 - y0;
  const denom = ax * by - bx * ay;
  if (Math.abs(denom) < 1e-9) return;
  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5 - x0;
      const cy = py + 0.5 - y0;
      const u = (cx * by - bx * cy) / denom;
      const v = (ax * cy - cx * ay) / denom;
      if (u >= 0 && v >= 0 && u + v <= 1) {
        mask[py * W + px] = 1;
      }
    }
  }
}

function islandUnderTexel(x, y) {
  if (!pixelToIsland) return null;
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  const id = pixelToIsland[y * canvas.width + x];
  return id >= 0 ? uvIslands[id] : null;
}

function islandUnderRayHit(hit) {
  if (!hit || !hit.object) return null;
  const id = triangleToIsland.get(hit.object.uuid + '-' + hit.faceIndex);
  return (id !== undefined) ? uvIslands[id] : null;
}

// ===== BUCKET FILL =====
function bucketFill(x, y, fillColor, mask) {
  if (mask && !mask[y * canvas.width + x]) return;

  const targetColor = ctx.getImageData(x, y, 1, 1).data;
  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Don't refill if target is already the fill color (would loop forever otherwise
  // when the matchColor predicate matches the just-set color).
  if (data[(y * width + x) * 4] === fillColor.r &&
      data[(y * width + x) * 4 + 1] === fillColor.g &&
      data[(y * width + x) * 4 + 2] === fillColor.b &&
      data[(y * width + x) * 4 + 3] === 255) {
    return;
  }

  const inMask = (px, py) => !mask || mask[py * width + px] === 1;

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
    if (!matchColor(idx) || !inMask(n.x, n.y)) continue;

    let west = n.x;
    let east = n.x;
    while (west >= 0 && matchColor((n.y * width + west) * 4) && inMask(west, n.y)) west--;
    while (east < width && matchColor((n.y * width + east) * 4) && inMask(east, n.y)) east++;

    for (let i = west + 1; i < east; i++) {
      setColor((n.y * width + i) * 4);
      if (n.y > 0 && matchColor(((n.y - 1) * width + i) * 4) && inMask(i, n.y - 1))
        stack.push({ x: i, y: n.y - 1 });
      if (n.y < height - 1 && matchColor(((n.y + 1) * width + i) * 4) && inMask(i, n.y + 1))
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

const texture = new THREE.CanvasTexture(displayCanvas);
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
  applyTransform();
}
window.addEventListener('resize', resize);
resize();

function updateTexture() {
  syncDisplayCanvas();
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

  try {
    buildUVIslands(fbxRoot);
  } catch (err) {
    console.error('Failed to build UV islands:', err);
  }
}, undefined, (err) => {
  console.error('Failed to load EverRealmModel_v1.fbx:', err);
});

// ===== 3D PAINTING =====
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

preview.addEventListener('contextmenu', e => e.preventDefault());

function pointerToTexel(e) {
  if (!fbxRoot) return null;
  const r = preview.getBoundingClientRect();
  ndc.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
  ndc.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(fbxRoot, true);
  if (!hits.length || !hits[0].uv) return null;
  const hit = hits[0];
  let { x: u, y: v } = hit.uv;
  if (texture.flipY) v = 1 - v;
  const px = Math.floor(u * canvas.width);
  const py = Math.floor(v * canvas.height);
  if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) return null;
  return { px, py, hit };
}

function paintAtPointer3D(e) {
  const hit = pointerToTexel(e);
  if (!hit) return false;
  const { px, py } = hit;

  switch (currentTool) {
    case 'picker': {
      const data = ctx.getImageData(px, py, 1, 1).data;
      setColor(rgbToHex(data[0], data[1], data[2]));
      // Stay on the picker.
      break;
    }
    case 'bucket': {
      const fill = hexToRgb(colorPicker.value);
      const mask = currentIsland ? currentIsland.mask : null;
      bucketFill(px, py, fill, mask);
      if (mirrorX) {
        const mx = canvas.width - 1 - px;
        const mirrorMask = mask || (islandUnderTexel(mx, py)?.mask) || null;
        bucketFill(mx, py, fill, mirrorMask);
      }
      updateTexture();
      break;
    }
    case 'brush':
    case 'eraser': {
      const mode = currentTool === 'eraser' ? 'erase' : 'paint';
      if (lastPaintX !== null) {
        paintLine(lastPaintX, lastPaintY, px, py, mode);
      } else {
        paintStamp(px, py, mode);
      }
      lastPaintX = px;
      lastPaintY = py;
      updateTexture();
      break;
    }
  }
  return true;
}

preview.addEventListener('pointerdown', e => {
  if (e.button !== 0) return;
  lastPaintX = null;
  lastPaintY = null;
  // Pin the island under the click so the whole stroke clips to that face.
  const probe = pointerToTexel(e);
  currentIsland = probe ? islandUnderRayHit(probe.hit) : null;
  if (currentTool === 'brush' || currentTool === 'eraser' || currentTool === 'bucket') {
    pushHistory();
  }
  if (currentTool === 'brush' || currentTool === 'bucket') {
    pushRecentColor(colorPicker.value);
  }
  if (paintAtPointer3D(e)) {
    painting3D = true;
    preview.setPointerCapture(e.pointerId);
  }
});
preview.addEventListener('pointermove', e => {
  if (painting3D && (currentTool === 'brush' || currentTool === 'eraser')) {
    paintAtPointer3D(e);
  }
});
preview.addEventListener('pointerup', e => {
  if (painting3D) {
    painting3D = false;
    lastPaintX = null;
    lastPaintY = null;
    currentIsland = null;
    if (preview.hasPointerCapture(e.pointerId)) preview.releasePointerCapture(e.pointerId);
  }
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
