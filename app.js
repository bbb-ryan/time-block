import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ---------- DOM ----------
const fileInput = document.getElementById('fileInput');
const fileLabelText = document.getElementById('fileLabelText');
const video = document.getElementById('sourceVideo');

const buildBtn = document.getElementById('buildBtn');
const progressWrap = document.getElementById('progressWrap');
const progressFill = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');

const viewGroup = document.getElementById('viewGroup');
const sliceGroup = document.getElementById('sliceGroup');
const exportBtn = document.getElementById('exportBtn');
const hint = document.getElementById('hint');
const emptyState = document.getElementById('emptyState');
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');

const autoRotateCheckbox = document.getElementById('autoRotate');
const showBoxCheckbox = document.getElementById('showBox');
const resetCamBtn = document.getElementById('resetCamBtn');
const sliceEnabledCheckbox = document.getElementById('sliceEnabled');
const solidSidesCheckbox = document.getElementById('solidSides');
const ghostOnlyCurrentCheckbox = document.getElementById('ghostOnlyCurrent');
const zoomSlider = document.getElementById('zoom');
const zoomNumEl = document.getElementById('zoomVal');
const autoPlayCheckbox = document.getElementById('autoPlay');
const panelWindow = document.getElementById('panelWindow');
const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
const expandSidebarBtn = document.getElementById('expandSidebarBtn');
const closeSidebarBtn = document.getElementById('closeSidebarBtn');

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

const defaultTarget = new THREE.Vector3(0, 0, 0);
const cameraDir = new THREE.Vector3(0.62, 0.42, 0.66).normalize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.6;

// Half-diagonal of the block's bounding box. Zoom limits, clip planes, and
// the default camera distance are all derived from this, so a tiny block
// and a huge one both feel right to zoom instead of sharing fixed numbers.
let boundingRadius = 1.6;

function updateCameraLimits() {
  controls.minDistance = boundingRadius * 0.4;
  controls.maxDistance = boundingRadius * 8;
  camera.near = Math.max(0.001, boundingRadius * 0.01);
  camera.far = boundingRadius * 60;
  camera.updateProjectionMatrix();
  zoomSlider.min = controls.minDistance;
  zoomSlider.max = controls.maxDistance;
  zoomNumEl.min = controls.minDistance.toFixed(2);
  zoomNumEl.max = controls.maxDistance.toFixed(2);
}

function syncZoomSlider() {
  const d = camera.position.distanceTo(controls.target);
  zoomSlider.value = d;
  zoomNumEl.value = d.toFixed(2);
}

// Moves the camera along its current view direction to an exact distance —
// used by the zoom bar. Scroll-wheel dolly still works too; `change` keeps
// the bar in sync with it either way.
function setZoomDistance(dist) {
  const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
  if (dir.lengthSq() < 1e-6) dir.copy(cameraDir);
  dir.normalize().multiplyScalar(dist);
  camera.position.copy(controls.target).add(dir);
  controls.update();
}
controls.addEventListener('change', syncZoomSlider);

function resetCamera() {
  camera.position.copy(cameraDir).multiplyScalar(boundingRadius * 2.8);
  controls.target.copy(defaultTarget);
  controls.update();
  syncZoomSlider();
}
updateCameraLimits();
resetCamera();

function resize() {
  const rect = stage.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
resize();

let lastFrameTime = performance.now();
const AUTOPLAY_LOOP_SECONDS = 6;
// A range input with step="0.01" ROUNDS every .value assignment to that
// step. Autoplay's per-frame delta (~0.0028 at 60fps/6s) is smaller than
// half that step, so reading nowSlider.value back each frame and adding to
// it always rounds right back down — it can never accumulate (verified:
// 60 simulated frames that way land back on exactly 0). Keep the real
// position in a full-precision variable instead, and only ever write it
// into the (lossy) DOM value — never read it back for the next tick.
let autoPlayPos = 0;

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;

  if (autoPlayCheckbox.checked && frameMeshes.length) {
    try {
      autoPlayPos += dt / AUTOPLAY_LOOP_SECONDS;
      if (autoPlayPos > 1) autoPlayPos -= 1;
      if (autoPlayPos < 0 || Number.isNaN(autoPlayPos)) autoPlayPos = 0;
      nowSlider.value = autoPlayPos;
      nowSlider.dispatchEvent(new Event('input'));
    } catch (err) {
      console.error('Autoplay tick failed:', err);
      hint.textContent = 'Autoplay error — see console for details.';
      autoPlayCheckbox.checked = false;
    }
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

// ---------- state ----------
const PLANE_W = 2;
let frameData = []; // [{ texture, edges }]
let frameMeshes = [];
let frameAspect = 16 / 9;
let planeH = 1;
let blockGroup = null;
let boxHelper = null;
let capGroup = null;
let totalDepth = 0;
let currentObjectURL = null;

// Two independent planes: `ghostPlane` (View → Now) decides what's elapsed
// and drives opacity only; `clipPlane` (Slice) is its own cutaway tool with
// its own position/tilt and only acts when Hard cut / Enable slice is on.
const ghostPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// ---------- helpers ----------
// Pairs a range slider with an editable number input showing its value:
// dragging the slider updates the number, typing a number (Enter/blur)
// commits and updates the slider. `decimals` controls display precision.
function bindRange(id, valId, opts = {}) {
  const el = document.getElementById(id);
  const numEl = document.getElementById(valId);
  const decimals = opts.decimals || 0;
  const fmt = (v) => (decimals ? Number(v).toFixed(decimals) : String(Math.round(v)));

  const syncNum = () => {
    numEl.value = fmt(parseFloat(el.value));
  };

  el.addEventListener('input', () => {
    syncNum();
    if (opts.onInput) opts.onInput(parseFloat(el.value));
  });

  const commitFromNum = () => {
    let v = parseFloat(numEl.value);
    if (Number.isNaN(v)) {
      syncNum();
      return;
    }
    v = Math.min(parseFloat(el.max), Math.max(parseFloat(el.min), v));
    el.value = v;
    numEl.value = fmt(v);
    if (opts.onInput) opts.onInput(v);
  };
  numEl.addEventListener('change', commitFromNum);
  numEl.addEventListener('keydown', (e) => {
    // Don't rely on blur() to trigger 'change' — commit directly so Enter
    // always works even if focus doesn't actually leave the field.
    if (e.key === 'Enter') {
      commitFromNum();
      numEl.blur();
    }
  });

  syncNum();
  return el;
}

// Native range inputs already jump-to-click in most browsers, but with a
// hairline custom track it's easy to miss — this guarantees a click
// anywhere on the slider snaps the thumb there immediately.
function addClickJump(range) {
  range.addEventListener('pointerdown', (e) => {
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const min = parseFloat(range.min);
    const max = parseFloat(range.max);
    const step = parseFloat(range.step) || 1;
    let v = min + frac * (max - min);
    v = Math.round(v / step) * step;
    v = Math.min(max, Math.max(min, v));
    if (v !== parseFloat(range.value)) {
      range.value = v;
      range.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
}

function meshMaterials(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function disposeObject3D(obj) {
  obj.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      meshMaterials(child).forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    }
  });
}

function seekTo(videoEl, time) {
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      videoEl.removeEventListener('seeked', onSeeked);
      clearTimeout(timer);
    };
    const onSeeked = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    videoEl.addEventListener('seeked', onSeeked);
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, 1000);
    try {
      videoEl.currentTime = time;
    } catch (e) {
      // ignore, timeout fallback will resolve
    }
  });
}

// A 1px-wide strip cropped from one edge of the frame, as its own texture.
// Stretched across a side face's UV (0..1), this extrudes that edge's actual
// pixels through the box's depth — a real slit-scan surface, not a flat tint.
function edgeStripTexture(sourceCanvas, edge) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const strip = document.createElement('canvas');
  if (edge === 'left' || edge === 'right') {
    strip.width = 1;
    strip.height = h;
    const sx = edge === 'left' ? 0 : w - 1;
    strip.getContext('2d').drawImage(sourceCanvas, sx, 0, 1, h, 0, 0, 1, h);
  } else {
    strip.width = w;
    strip.height = 1;
    const sy = edge === 'top' ? 0 : h - 1;
    strip.getContext('2d').drawImage(sourceCanvas, 0, sy, w, 1, 0, 0, w, 1);
  }
  const tex = new THREE.CanvasTexture(strip);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

async function extractFrames(videoEl, count, maxWidth, onProgress) {
  const duration = videoEl.duration;
  const scale = Math.min(1, maxWidth / videoEl.videoWidth);
  const w = Math.max(2, Math.round(videoEl.videoWidth * scale));
  const h = Math.max(2, Math.round(videoEl.videoHeight * scale));
  const frames = [];
  const safeDuration = Math.max(0, duration - 0.05);

  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : Math.min(safeDuration, (duration * i) / (count - 1));
    await seekTo(videoEl, t);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.drawImage(videoEl, 0, 0, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const edges = {
      right: edgeStripTexture(c, 'right'),
      left: edgeStripTexture(c, 'left'),
      top: edgeStripTexture(c, 'top'),
      bottom: edgeStripTexture(c, 'bottom'),
    };
    frames.push({ texture: tex, edges });
    onProgress(i + 1, count);
    // Yield so the progress bar repaints between frames. setTimeout, not
    // requestAnimationFrame — rAF callbacks are suspended entirely while
    // the tab is backgrounded/hidden, which would hang extraction forever
    // if the user switches away mid-build; a timer keeps firing either way.
    await new Promise((r) => setTimeout(r, 0));
  }
  return frames;
}

function rebuildBoxHelper(w, h, d) {
  if (boxHelper) {
    scene.remove(boxHelper);
    boxHelper.geometry.dispose();
    boxHelper.material.dispose();
  }
  const geo = new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, Math.max(d, 0.001)));
  const mat = new THREE.LineBasicMaterial({ color: 0x6ee7ff, transparent: true, opacity: 0.35 });
  boxHelper = new THREE.LineSegments(geo, mat);
  boxHelper.visible = showBoxCheckbox.checked;
  scene.add(boxHelper);
}

// How far a plane with this normal has to travel from center to sweep past
// the whole box (the box's support function) — so Position always spans
// the full volume in whatever direction the plane is actually facing,
// instead of being scaled to the Z axis regardless of tilt.
function boxExtentAlong(normal) {
  return (
    (PLANE_W / 2) * Math.abs(normal.x) +
    (planeH / 2) * Math.abs(normal.y) +
    (totalDepth / 2) * Math.abs(normal.z)
  );
}

// Slice: its own independent cutaway plane (Position / Cut angle X / Y).
// Only does anything when "Enable slice" is on — no effect on ghosting.
function updateClipPlane() {
  const tiltXv = parseFloat(tiltXSlider.value);
  const tiltYv = parseFloat(tiltYSlider.value);
  const posV = parseFloat(slicePosSlider.value);

  const normal = new THREE.Vector3(0, 0, 1);
  const euler = new THREE.Euler(
    THREE.MathUtils.degToRad(tiltXv),
    THREE.MathUtils.degToRad(tiltYv),
    0,
    'XYZ'
  );
  normal.applyEuler(euler).normalize();

  const offset = posV * boxExtentAlong(normal);
  clipPlane.normal.copy(normal);
  clipPlane.constant = -offset;
  updateSliceCaps();
}

function updateSliceEnabled() {
  const on = sliceEnabledCheckbox.checked;
  // A hard cut through paper-thin, gapped planes looks frayed, not solid —
  // slicing only makes sense against real volume, so force it on.
  if (on && !solidSidesCheckbox.checked) {
    solidSidesCheckbox.checked = true;
    if (frameMeshes.length) layoutBlock(parseFloat(spacingSlider.value));
  }
  frameMeshes.forEach((mesh) => {
    meshMaterials(mesh).forEach((m) => {
      m.clippingPlanes = on ? [clipPlane] : [];
      m.needsUpdate = true;
    });
  });
  updateSliceCaps();
}

// Plain WebGL clipping only discards fragments — it never fills the hole it
// cuts, so a sliced box looks hollow inside. Each frame is a thin extruded
// slab where color only ever depends on (x, y), never depth, so the cap at
// any cut is just the box∩plane polygon with UV read straight off (x, y) —
// exactly the pixels the real photo has there. No separate cap texture
// needed: it's the same frame texture, just sampled directly.
function boxPlaneCapPolygon(halfW, halfH, zLo, zHi, normal, constant) {
  const xs = [-halfW, halfW];
  const ys = [-halfH, halfH];
  const zs = [zLo, zHi];
  const corners = [];
  for (const x of xs) for (const y of ys) for (const z of zs) corners.push(new THREE.Vector3(x, y, z));

  const dist = (p) => normal.x * p.x + normal.y * p.y + normal.z * p.z + constant;
  const pts = [];
  for (let a = 0; a < 8; a++) {
    for (let bit = 0; bit < 3; bit++) {
      const b = a ^ (1 << bit);
      if (b <= a) continue;
      const pa = corners[a];
      const pb = corners[b];
      const da = dist(pa);
      const db = dist(pb);
      if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
        const t = da / (da - db);
        pts.push(new THREE.Vector3().lerpVectors(pa, pb, t));
      }
    }
  }
  if (pts.length < 3) return null;

  const uniq = [];
  for (const p of pts) {
    if (!uniq.some((q) => q.distanceToSquared(p) < 1e-9)) uniq.push(p);
  }
  if (uniq.length < 3) return null;

  const centroid = uniq.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / uniq.length);
  const arbitrary = Math.abs(normal.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const u = new THREE.Vector3().crossVectors(normal, arbitrary).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u).normalize();
  uniq.sort((p, q) => {
    const pa = Math.atan2(v.dot(p.clone().sub(centroid)), u.dot(p.clone().sub(centroid)));
    const qa = Math.atan2(v.dot(q.clone().sub(centroid)), u.dot(q.clone().sub(centroid)));
    return pa - qa;
  });
  return uniq;
}

function disposeCapGroup() {
  if (!capGroup) return;
  capGroup.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose(); // caps don't own their map, just borrow the frame's
  });
  scene.remove(capGroup);
  capGroup = null;
}

function updateSliceCaps() {
  disposeCapGroup();
  if (!sliceEnabledCheckbox.checked || !frameMeshes.length) return;

  const halfW = PLANE_W / 2;
  const halfH = planeH / 2;
  const n = frameMeshes.length;
  const group = new THREE.Group();

  frameMeshes.forEach((mesh, i) => {
    const thickness = mesh.scale.z; // world-space box thickness for this frame
    const zLo = mesh.position.z - thickness / 2;
    const zHi = mesh.position.z + thickness / 2;
    const poly = boxPlaneCapPolygon(halfW, halfH, zLo, zHi, clipPlane.normal, clipPlane.constant);
    if (!poly) return;

    const positions = new Float32Array(poly.length * 3);
    const uvs = new Float32Array(poly.length * 2);
    poly.forEach((p, vi) => {
      positions[vi * 3] = p.x;
      positions[vi * 3 + 1] = p.y;
      positions[vi * 3 + 2] = p.z;
      uvs[vi * 2] = (p.x + halfW) / PLANE_W;
      uvs[vi * 2 + 1] = (p.y + halfH) / planeH;
    });
    const indices = [];
    for (let k = 1; k < poly.length - 1; k++) indices.push(0, k, k + 1);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const opacity = frameOpacityAt(mesh, i, n);
    const solid = opacity >= 0.999;
    const mat = new THREE.MeshBasicMaterial({
      map: frameData[i].texture,
      side: THREE.DoubleSide,
      transparent: !solid,
      opacity,
      depthWrite: solid,
    });
    group.add(new THREE.Mesh(geo, mat));
  });

  scene.add(group);
  capGroup = group;
}

// View → Now: the scrub point. Frames before it are elapsed (ghosted),
// frames from it onward haven't elapsed yet (solid). Fixed normal along the
// depth/time axis — this is purely a time concept, no tilt.
function updateGhostPlane() {
  const posV = parseFloat(nowSlider.value); // 0 (start, all solid) .. 1 (end, all ghosted)
  const offset = (posV - 0.5) * totalDepth;
  ghostPlane.constant = -offset;
  if (frameMeshes.length) updateGhostOpacity();
}

// Shared by the frame boxes and the slice caps, so a cap always matches the
// ghost/solid state of the frame it belongs to.
function frameOpacityAt(mesh, index, n) {
  const floor = parseFloat(ghostOpacitySlider.value);
  if (ghostOnlyCurrentCheckbox.checked) {
    const currentIndex = Math.round(parseFloat(nowSlider.value) * (n - 1));
    return index === currentIndex ? 1 : floor;
  }
  return ghostPlane.distanceToPoint(mesh.position) >= 0 ? 1 : floor;
}

function updateGhostOpacity() {
  const n = frameMeshes.length;
  frameMeshes.forEach((mesh, i) => {
    const opacity = frameOpacityAt(mesh, i, n);
    const solid = opacity >= 0.999;
    meshMaterials(mesh).forEach((m) => {
      m.opacity = opacity;
      m.transparent = !solid;
      m.depthWrite = solid;
      m.needsUpdate = true;
    });
  });
  updateSliceCaps();
}

function layoutBlock(spacingValue) {
  const n = frameMeshes.length;
  if (!n) return;
  const baseUnit = PLANE_W / n;
  const depthStep = baseUnit * spacingValue;
  totalDepth = Math.max(0.001, (n - 1) * depthStep);
  // Each frame is a unit-depth box; scaling it to depthStep makes it fill
  // exactly the gap to its neighbor, so the stack is solid with no seams
  // when "Solid sides" is on. Off, it's squashed to a hairline plane.
  const thickness = solidSidesCheckbox.checked ? depthStep : Math.min(depthStep, 0.002);
  frameMeshes.forEach((mesh, i) => {
    mesh.position.z = (i - (n - 1) / 2) * depthStep;
    mesh.scale.z = thickness;
  });
  rebuildBoxHelper(PLANE_W, planeH, totalDepth);
  updateClipPlane();
  updateGhostPlane();

  boundingRadius = Math.max(0.05, 0.5 * Math.hypot(PLANE_W, planeH, totalDepth));
  updateCameraLimits();
}

function buildBlock() {
  if (blockGroup) {
    scene.remove(blockGroup);
    disposeObject3D(blockGroup);
    frameMeshes = [];
  }

  planeH = 2 / frameAspect;
  const group = new THREE.Group();

  const opacity0 = parseFloat(ghostOpacitySlider.value);
  const clippingPlanes0 = sliceEnabledCheckbox.checked ? [clipPlane] : [];

  frameMeshes = frameData.map(({ texture, edges }) => {
    // A box, not DoubleSide: each face renders once (its natural winding),
    // so a stack of layers blends one surface per layer, not two — otherwise
    // ghost opacity effectively doubles (near + far face both drawing).
    const commonProps = {
      transparent: true,
      opacity: opacity0,
      depthWrite: false,
      clippingPlanes: clippingPlanes0,
      clipShadows: false,
    };
    // Front/back show the actual frame; the four side faces are that
    // frame's own edge pixels (a 1px strip) stretched across the depth —
    // a real extruded slit-scan surface, not a flat tint or squashed copy.
    const faceMat = (map) => new THREE.MeshBasicMaterial({ map, ...commonProps });
    // BoxGeometry face order: +x, -x, +y, -y, +z, -z
    const materials = [
      faceMat(edges.right),
      faceMat(edges.left),
      faceMat(edges.top),
      faceMat(edges.bottom),
      faceMat(texture),
      faceMat(texture),
    ];

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(PLANE_W, planeH, 1), materials);
    group.add(mesh);
    return mesh;
  });

  scene.add(group);
  blockGroup = group;

  layoutBlock(parseFloat(spacingSlider.value));
  resetCamera();

  viewGroup.removeAttribute('disabled');
  sliceGroup.removeAttribute('disabled');
  exportBtn.disabled = false;
  emptyState.classList.add('hidden');
}

// ---------- range bindings ----------
bindRange('frameCount', 'frameCountVal');
bindRange('sampleWidth', 'sampleWidthVal');

const spacingSlider = bindRange('spacing', 'spacingVal', {
  decimals: 2,
  onInput: (v) => {
    if (frameMeshes.length) layoutBlock(v);
  },
});

const ghostOpacitySlider = bindRange('ghostOpacity', 'ghostOpacityVal', {
  decimals: 2,
  onInput: () => {
    if (frameMeshes.length) updateGhostOpacity();
  },
});

const nowSlider = bindRange('nowPos', 'nowPosVal', {
  decimals: 2,
  onInput: () => updateGhostPlane(),
});

const tiltXSlider = bindRange('tiltX', 'tiltXVal', {
  onInput: () => updateClipPlane(),
});

const tiltYSlider = bindRange('tiltY', 'tiltYVal', {
  onInput: () => updateClipPlane(),
});

const slicePosSlider = bindRange('slicePos', 'slicePosVal', {
  decimals: 2,
  onInput: () => updateClipPlane(),
});

document.querySelectorAll('input[type="range"]').forEach(addClickJump);

// ---------- UI events ----------
fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  fileLabelText.textContent = file.name;
  buildBtn.disabled = true;
  hint.textContent = 'Loading video metadata…';

  if (currentObjectURL) URL.revokeObjectURL(currentObjectURL);
  currentObjectURL = URL.createObjectURL(file);
  video.src = currentObjectURL;

  video.addEventListener(
    'loadedmetadata',
    () => {
      frameAspect = video.videoWidth / video.videoHeight || 16 / 9;
      buildBtn.disabled = false;
      hint.textContent = `Loaded ${video.videoWidth}×${video.videoHeight}, ${video.duration.toFixed(1)}s. Click Build block.`;
    },
    { once: true }
  );

  video.addEventListener(
    'error',
    () => {
      hint.textContent = 'Could not load that video file — try a different format (mp4/webm/mov).';
    },
    { once: true }
  );
});

buildBtn.addEventListener('click', async () => {
  buildBtn.disabled = true;
  fileInput.disabled = true;
  progressWrap.classList.remove('hidden');
  hint.textContent = '';

  const count = parseInt(document.getElementById('frameCount').value, 10);
  const maxW = parseInt(document.getElementById('sampleWidth').value, 10);

  const onProgress = (i, n) => {
    progressFill.style.width = `${(i / n) * 100}%`;
    progressLabel.textContent = `Extracting frames… ${i} / ${n}`;
  };

  try {
    const newFrameData = await extractFrames(video, count, maxW, onProgress);
    frameData.forEach((f) => {
      f.texture.dispose();
      Object.values(f.edges).forEach((t) => t.dispose());
    });
    frameData = newFrameData;
    buildBlock();
    hint.textContent = 'Drag to orbit, use the Zoom bar or scroll to zoom. Drag "Now" in View to scrub elapsed vs. solid.';
  } catch (err) {
    console.error(err);
    hint.textContent = 'Something went wrong extracting frames — see console for details.';
  } finally {
    progressWrap.classList.add('hidden');
    buildBtn.disabled = false;
    fileInput.disabled = false;
  }
});

autoRotateCheckbox.addEventListener('change', () => {
  controls.autoRotate = autoRotateCheckbox.checked;
});

showBoxCheckbox.addEventListener('change', () => {
  if (boxHelper) boxHelper.visible = showBoxCheckbox.checked;
});

solidSidesCheckbox.addEventListener('change', () => {
  if (frameMeshes.length) layoutBlock(parseFloat(spacingSlider.value));
});

ghostOnlyCurrentCheckbox.addEventListener('change', () => {
  if (frameMeshes.length) updateGhostOpacity();
});

// Autoplay drives "Now" itself, so any manual interaction with it should
// take back control rather than have the loop fight the user's drag.
function stopAutoPlay() {
  autoPlayCheckbox.checked = false;
}
nowSlider.addEventListener('pointerdown', stopAutoPlay);
document.getElementById('nowPosVal').addEventListener('focus', stopAutoPlay);

// Resume from wherever "Now" currently sits, not wherever the accumulator
// last was (e.g. after the user manually repositioned it).
autoPlayCheckbox.addEventListener('change', () => {
  if (autoPlayCheckbox.checked) autoPlayPos = parseFloat(nowSlider.value) || 0;
});

function setSidebarCollapsed(collapsed) {
  panelWindow.classList.toggle('collapsed', collapsed);
}
collapseSidebarBtn.addEventListener('click', () => setSidebarCollapsed(true));
closeSidebarBtn.addEventListener('click', () => setSidebarCollapsed(true));
expandSidebarBtn.addEventListener('click', () => setSidebarCollapsed(false));

// Position each help tooltip from the icon's real rect right before it
// shows, clamped to the viewport — keeps it `position: fixed` so it never
// affects a scrollable ancestor's layout while hidden.
document.querySelectorAll('.help').forEach((el) => {
  const position = () => {
    const r = el.getBoundingClientRect();
    const tipWidth = 210;
    let left = r.left;
    if (left + tipWidth > window.innerWidth - 8) left = window.innerWidth - tipWidth - 8;
    if (left < 8) left = 8;
    el.style.setProperty('--tip-left', `${left}px`);
    el.style.setProperty('--tip-top', `${r.bottom + 4}px`);
  };
  el.addEventListener('mouseenter', position);
  el.addEventListener('focus', position);
});

zoomSlider.addEventListener('input', () => {
  const v = parseFloat(zoomSlider.value);
  zoomNumEl.value = v.toFixed(2);
  setZoomDistance(v);
});

function commitZoomFromNum() {
  let v = parseFloat(zoomNumEl.value);
  if (Number.isNaN(v)) {
    zoomNumEl.value = parseFloat(zoomSlider.value).toFixed(2);
    return;
  }
  v = Math.min(parseFloat(zoomSlider.max), Math.max(parseFloat(zoomSlider.min), v));
  zoomSlider.value = v;
  zoomNumEl.value = v.toFixed(2);
  setZoomDistance(v);
}
zoomNumEl.addEventListener('change', commitZoomFromNum);
zoomNumEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    commitZoomFromNum();
    zoomNumEl.blur();
  }
});

resetCamBtn.addEventListener('click', resetCamera);

sliceEnabledCheckbox.addEventListener('change', updateSliceEnabled);
updateSliceEnabled();

document.querySelectorAll('.presets button').forEach((btn) => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    if (preset === 'horizontal') {
      tiltXSlider.value = 90;
      tiltYSlider.value = 0;
    } else if (preset === 'vertical') {
      tiltXSlider.value = 0;
      tiltYSlider.value = 90;
    } else if (preset === 'diagonal') {
      tiltXSlider.value = 45;
      tiltYSlider.value = 45;
    }
    tiltXSlider.dispatchEvent(new Event('input'));
    tiltYSlider.dispatchEvent(new Event('input'));
  });
});

exportBtn.addEventListener('click', () => {
  renderer.render(scene, camera);
  const link = document.createElement('a');
  link.download = 'time-block.png';
  link.href = renderer.domElement.toDataURL('image/png');
  link.click();
});
