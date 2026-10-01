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
const sliceFlippedCheckbox = document.getElementById('sliceFlipped');
const solidSidesCheckbox = document.getElementById('solidSides');
const ghostOnlyCurrentCheckbox = document.getElementById('ghostOnlyCurrent');
const zoomSlider = document.getElementById('zoom');
const zoomNumEl = document.getElementById('zoomVal');
const autoPlayCheckbox = document.getElementById('autoPlay');
const panelWindow = document.getElementById('panelWindow');
const collapseSidebarBtn = document.getElementById('collapseSidebarBtn');
const expandSidebarBtn = document.getElementById('expandSidebarBtn');

const pointCloudCheckbox = document.getElementById('pointCloudEnabled');
const pointDensityControls = document.getElementById('pointDensityControls');

const bgRemoveEnabledCheckbox = document.getElementById('bgRemoveEnabled');
const chromaKeyControls = document.getElementById('chromaKeyControls');
const chromaKeyColorInput = document.getElementById('chromaKeyColor');
const bgRemovalWindow = document.getElementById('bgRemovalWindow');
const bgWindowCloseBtn = document.getElementById('bgWindowCloseBtn');
const bgSkipBtn = document.getElementById('bgSkipBtn');
const bgConfirmBtn = document.getElementById('bgConfirmBtn');
const bgProgressWrap = document.getElementById('bgProgressWrap');
const bgProgressFill = document.getElementById('bgProgressFill');
const bgProgressLabel = document.getElementById('bgProgressLabel');
const bgPreviewWrap = document.getElementById('bgPreviewWrap');
const bgPreviewCanvas = document.getElementById('bgPreviewCanvas');
const bgVideoInput = document.getElementById('bgVideoInput');
const bgVideoLabelText = document.getElementById('bgVideoLabelText');
const bgVideoUploadControls = document.getElementById('bgVideoUploadControls');
const bgVideoOpacityControls = document.getElementById('bgVideoOpacityControls');
const bgOnlyCurrentCheckbox = document.getElementById('bgOnlyCurrent');
const bgVideoEl = document.getElementById('bgSourceVideo');

// ---------- three.js setup ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.localClippingEnabled = true;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

const defaultTarget = new THREE.Vector3(0, 0, 0);
// Frame i sits at z = (i - (n-1)/2) * depthStep (see layoutBlock()), so
// frame 0 — the start of the clip — is always at the NEGATIVE z end and the
// last frame at the positive end. A negative z here puts the default/reset
// camera on frame 0's side, so the block reads start-to-end like the source
// footage instead of opening on its last moment.
const cameraDir = new THREE.Vector3(0.62, 0.42, -0.66).normalize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.autoRotateSpeed = 1.6;
// OrbitControls scales each wheel event by
// 0.95 ** (zoomSpeed * |deltaY| / (100 * devicePixelRatio)) — a trackpad's
// per-event deltaY is only a few px (vs. a mouse wheel's ~100), and on a
// 2x Retina display that's divided by 200, so at the default zoomSpeed=1
// each trackpad tick barely moves the camera at all. Raising zoomSpeed is
// the direct fix (same formula, bigger multiplier) rather than fighting it.
controls.zoomSpeed = 5;

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
let bgVideoObjectURL = null;
// Whether the frames currently in frameData have real per-pixel alpha baked
// in (vs. uniformly opaque). Drives "remove background on solid frames"
// automatically — no separate toggle, since it's only ever meaningful when
// background removal actually ran, and a no-op (same look either way)
// otherwise.
let lastBuildHadBgRemoval = false;

// Two independent planes: `ghostPlane` (View → Elapsed) decides what's elapsed
// and drives opacity only; `clipPlane` (Slice) is its own cutaway tool with
// its own position/tilt and only acts when Hard cut / Enable slice is on.
const ghostPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

// A small radial-gradient dot, generated once and reused as every point
// cloud's sprite — this (not any depth/covariance math) is what gives
// "Render frames as points" its soft, splat-like look instead of square
// GL points.
function makeDotSpriteTexture() {
  const size = 32;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const r = size / 2;
  const grad = ctx.createRadialGradient(r, r, 0, r, r, r);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.7, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}
const dotSpriteTexture = makeDotSpriteTexture();

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
    frames.push({ texture: tex, edges, time: t });
    onProgress(i + 1, count);
    // Yield so the progress bar repaints between frames. setTimeout, not
    // requestAnimationFrame — rAF callbacks are suspended entirely while
    // the tab is backgrounded/hidden, which would hang extraction forever
    // if the user switches away mid-build; a timer keeps firing either way.
    await new Promise((r) => setTimeout(r, 0));
  }
  return frames;
}

// Samples a replacement background video at the *exact* timestamps the main
// video was already sampled at (not a re-derived fraction of the background
// video's own duration), so the two line up frame-for-frame regardless of
// how their durations compare. Clamping each timestamp to the background
// video's own duration is the one thing needed to get both edge cases right
// at once: a shorter background video simply keeps re-seeking to its own
// last moment (holding that frame) for every remaining timestamp, and a
// longer one is never sampled past where the main video ends.
async function extractPairedFrames(videoEl, timestamps, maxWidth, onProgress) {
  const scale = Math.min(1, maxWidth / videoEl.videoWidth);
  const w = Math.max(2, Math.round(videoEl.videoWidth * scale));
  const h = Math.max(2, Math.round(videoEl.videoHeight * scale));
  const safeDuration = Math.max(0, videoEl.duration - 0.05);
  const frames = [];

  for (let i = 0; i < timestamps.length; i++) {
    const t = Math.min(timestamps[i], safeDuration);
    await seekTo(videoEl, t);
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(videoEl, 0, 0, w, h);
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
    onProgress(i + 1, timestamps.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  return frames;
}

// ---------- background removal (chroma key) ----------
// Deterministic color-distance thresholding against a picked key color — no
// ML model, no download, no inference. Produces the same per-frame contract
// { bgMask: Float32Array(0..1), bgMaskW, bgMaskH } cached on each frame that
// bakeBackgroundAlpha/updateBgPreview/finalizeBackgroundRemoval below rely on.
function hexToRgb(hex) {
  const v = parseInt(hex.slice(1), 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

function smoothstep(t) {
  t = Math.min(1, Math.max(0, t));
  return t * t * (3 - 2 * t);
}

async function computeBackgroundMasks(frames, onProgress) {
  const { r: kr, g: kg, b: kb } = hexToRgb(chromaKeyColorInput.value);
  const tolerancePercent = parseFloat(chromaToleranceSlider.value);
  // Max possible per-pixel RGB Euclidean distance is sqrt(3 * 255^2); the
  // tolerance slider (1-100) is a percentage of that. `feather` widens a
  // soft transition band around the threshold instead of a hard cutoff,
  // so edges don't come out jagged.
  const maxDist = Math.sqrt(3 * 255 * 255);
  const threshold = (tolerancePercent / 100) * maxDist;
  const feather = Math.max(4, threshold * 0.4);
  for (let i = 0; i < frames.length; i++) {
    const sourceCanvas = frames[i].texture.image;
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const data = sourceCanvas.getContext('2d').getImageData(0, 0, w, h).data;
    const mask = new Float32Array(w * h);
    for (let p = 0; p < mask.length; p++) {
      const idx = p * 4;
      const dr = data[idx] - kr;
      const dg = data[idx + 1] - kg;
      const db = data[idx + 2] - kb;
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      // Close to the key color (dist < threshold-feather) -> background
      // (mask -> 0). Far from it (dist > threshold+feather) -> foreground
      // (mask -> 1), with a smoothstep ramp in between.
      mask[p] = smoothstep((dist - (threshold - feather)) / (2 * feather));
    }
    frames[i].bgMask = mask;
    frames[i].bgMaskW = w;
    frames[i].bgMaskH = h;
    onProgress(i + 1, frames.length);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// Phase 2 (cheap, re-run freely): copies `sourceCanvas` and sets each
// pixel's alpha from its cached mask confidence, blended toward
// `bgOpacity` for background pixels. Foreground stays fully opaque
// regardless of the slider; background fades continuously with it.
function bakeBackgroundAlpha(sourceCanvas, mask, maskW, maskH, bgOpacity) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  // Mask resolution isn't guaranteed to match the sample canvas (the model
  // has its own fixed input size), so sample it with nearest-neighbor.
  const sx = maskW / w;
  const sy = maskH / h;
  for (let y = 0; y < h; y++) {
    const my = Math.min(maskH - 1, Math.floor(y * sy));
    const rowOff = my * maskW;
    for (let x = 0; x < w; x++) {
      const mx = Math.min(maskW - 1, Math.floor(x * sx));
      const fg = mask[rowOff + mx];
      const alpha = fg + (1 - fg) * bgOpacity;
      data[(y * w + x) * 4 + 3] = Math.round(alpha * 255);
    }
  }
  ctx.putImageData(imgData, 0, 0);
  return out;
}

let bgPreviewFrameIndex = 0;
function updateBgPreview() {
  const frame = frameData[bgPreviewFrameIndex];
  if (!frame || !frame.bgMask) return;
  // Fixed reference opacity (fully removed) — this is just a sanity check
  // that the mask isolates the subject correctly. The real, live-adjustable
  // opacity control lives in the View panel once the block is built; it's
  // no longer decided here.
  const baked = bakeBackgroundAlpha(frame.texture.image, frame.bgMask, frame.bgMaskW, frame.bgMaskH, 0);
  bgPreviewCanvas.width = baked.width;
  bgPreviewCanvas.height = baked.height;
  const pctx = bgPreviewCanvas.getContext('2d');
  // Mid-gray backdrop so a faded/transparent background is actually visible
  // against the preview canvas, not indistinguishable from black.
  pctx.fillStyle = '#333';
  pctx.fillRect(0, 0, baked.width, baked.height);
  pctx.drawImage(baked, 0, 0);
}

// Renders the raw Float32Array mask (0..1 foreground confidence) into a
// plain grayscale canvas — confidence in every channel so either a
// grayscale or single-channel read works. This is what actually gets used
// (as a GPU texture, sampled live by a shader) instead of the old approach
// of baking a fixed opacity into the RGB texture's own alpha channel once.
function maskToCanvas(mask, maskW, maskH) {
  const canvas = document.createElement('canvas');
  canvas.width = maskW;
  canvas.height = maskH;
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(maskW, maskH);
  const data = imgData.data;
  for (let i = 0; i < mask.length; i++) {
    const v = Math.round(mask[i] * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function canvasToMaskTexture(canvas) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Builds a mask texture (whole frame + the 4 edge strips, via the same
// generic edgeStripTexture() already used for RGB) for every frame with a
// cached mask. The original RGB texture/edges are never touched — no bake,
// no fixed opacity decided here. Background opacity is read live from
// these mask textures by a shader uniform instead (patchBackgroundMaterial /
// updateBackgroundCompositing), adjustable any time after the block exists,
// without re-running this or rebuilding.
function finalizeBackgroundRemoval() {
  frameData.forEach((frame) => {
    if (!frame.bgMask) return;
    const maskCanvas = maskToCanvas(frame.bgMask, frame.bgMaskW, frame.bgMaskH);
    frame.maskTexture = canvasToMaskTexture(maskCanvas);
    frame.maskEdges = {
      right: edgeStripTexture(maskCanvas, 'right'),
      left: edgeStripTexture(maskCanvas, 'left'),
      top: edgeStripTexture(maskCanvas, 'top'),
      bottom: edgeStripTexture(maskCanvas, 'bottom'),
    };
  });
}

// Patches a MeshBasicMaterial's own compiled shader (via onBeforeCompile,
// not a hand-rolled ShaderMaterial) so clipping planes — used by Slice —
// keep working automatically instead of needing to be reimplemented by
// hand. Injects right after <map_fragment>, at which point diffuseColor.a
// already equals the material's own `opacity` uniform (untouched — the
// pristine RGB texture this app extracts always has alpha 1), multiplying
// in the mask-driven background fade *on top of* it. That's what makes the
// ghost-opacity multiplication automatic: `updateGhostOpacity()` already
// drives `material.opacity` every time Now/ghost state changes, unchanged;
// this shader just multiplies that by the live `uBgTargetOpacity` (resolved
// host-side by updateBackgroundCompositing(), see below) for background
// pixels, and 1.0 (no change) for foreground ones.
function patchBackgroundMaterial(material, maskMap) {
  const uniforms = {
    uMaskMap: { value: maskMap },
    // Whether THIS frame has a paired replacement-video frame at all (fixed
    // at build time) — decides whether background pixels show the
    // replacement's own color at all, independent of how visible they are.
    uBgVideoExists: { value: 0 },
    // The single number that actually decides background alpha, already
    // resolved host-side by updateBackgroundCompositing() for whichever
    // mode is active (only-current crossfade, or Background opacity vs.
    // Background ghost opacity split by played/not-played) — the shader
    // doesn't need to know which.
    uBgTargetOpacity: { value: 0 },
    uBgVideoMap: { value: null },
  };
  material.userData.bgUniforms = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uMaskMap;
        uniform float uBgVideoExists;
        uniform float uBgTargetOpacity;
        uniform sampler2D uBgVideoMap;`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          float fg = texture2D( uMaskMap, vMapUv ).r;
          if ( uBgVideoExists > 0.5 ) {
            vec3 bgColor = texture2D( uBgVideoMap, vMapUv ).rgb;
            diffuseColor.rgb = mix( bgColor, diffuseColor.rgb, fg );
          }
          diffuseColor.a *= mix( uBgTargetOpacity, 1.0, fg );
        }`
      );
  };
  material.needsUpdate = true;
  return uniforms;
}

function showBgRemovalWindow() {
  bgRemovalWindow.classList.remove('hidden');
  bgProgressWrap.classList.remove('hidden');
  bgPreviewWrap.classList.add('hidden');
  bgConfirmBtn.classList.add('hidden');
  bgConfirmBtn.disabled = true;
  bgProgressFill.style.width = '0%';
  bgProgressLabel.textContent = `Analyzing frames… 0 / ${frameData.length}`;
}

function hideBgRemovalWindow() {
  bgRemovalWindow.classList.add('hidden');
}

// Runs entirely between extraction and buildBlock(): shows the modal,
// computes masks with its own progress bar, shows a fixed-opacity preview
// of the middle frame so the mask quality can be sanity-checked, then waits
// for the user to confirm or skip before the 3D object is built. The actual
// background opacity is no longer decided here — see updateBackgroundCompositing().
async function runBackgroundRemovalFlow() {
  showBgRemovalWindow();
  hint.textContent = 'Keying out the background…';

  try {
    await computeBackgroundMasks(frameData, (i, n) => {
      bgProgressFill.style.width = `${(i / n) * 100}%`;
      bgProgressLabel.textContent = `Analyzing frames… ${i} / ${n}`;
    });
  } catch (err) {
    console.error(err);
    hint.textContent = 'Background removal failed — see console for details. Building without it.';
    hideBgRemovalWindow();
    buildBlock();
    return;
  }

  bgProgressWrap.classList.add('hidden');
  bgPreviewWrap.classList.remove('hidden');
  bgConfirmBtn.classList.remove('hidden');
  bgConfirmBtn.disabled = false;
  bgPreviewFrameIndex = Math.floor(frameData.length / 2);
  updateBgPreview();

  const choice = await new Promise((resolve) => {
    const onConfirm = () => {
      cleanup();
      resolve('confirm');
    };
    const onSkip = () => {
      cleanup();
      resolve('skip');
    };
    function cleanup() {
      bgConfirmBtn.removeEventListener('click', onConfirm);
      bgSkipBtn.removeEventListener('click', onSkip);
      bgWindowCloseBtn.removeEventListener('click', onSkip);
    }
    bgConfirmBtn.addEventListener('click', onConfirm);
    bgSkipBtn.addEventListener('click', onSkip);
    bgWindowCloseBtn.addEventListener('click', onSkip);
  });

  hideBgRemovalWindow();
  if (choice === 'confirm') {
    finalizeBackgroundRemoval();
    lastBuildHadBgRemoval = true;
  }
  buildBlock();
  hint.textContent = 'Drag to orbit, use the Zoom bar or scroll to zoom. Drag "Elapsed" in View to scrub elapsed vs. solid.';
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
  let constant = -offset;

  // Negating BOTH normal and constant keeps the plane in exactly the same
  // place (same solution set for normal·p + constant = 0) but flips which
  // half satisfies "kept" (distance >= 0) — the cut line doesn't move,
  // just which side survives it.
  if (sliceFlippedCheckbox.checked) {
    normal.negate();
    constant = -constant;
  }

  clipPlane.normal.copy(normal);
  clipPlane.constant = constant;
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
  // Point-cloud frames have no volume to cap — clippingPlanes already cuts
  // them cleanly (a naturally jagged edge of dots), which fits the look.
  if (!sliceEnabledCheckbox.checked || !frameMeshes.length || pointCloudCheckbox.checked) {
    // Slice is off in the common case, which means this return used to skip
    // right past the frameMeshes sync at the bottom of this function too —
    // background compositing would never run at all outside of Slice being
    // enabled. Every exit path needs it, not just the "caps actually built"
    // one below.
    updateBackgroundCompositing();
    return;
  }

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
    // Same blendAlpha reasoning as updateGhostOpacity() — caps are flat
    // single polygons (not boxes), so DoubleSide is always safe here
    // regardless of blendAlpha; only transparent/depthWrite need to follow.
    const blendAlpha = !solid || lastBuildHadBgRemoval;
    const mat = new THREE.MeshBasicMaterial({
      map: frameData[i].texture,
      side: THREE.DoubleSide,
      transparent: blendAlpha,
      opacity,
      depthWrite: !blendAlpha,
    });
    // Cap UVs are laid out across the full frame (same space as the front/
    // back face), so the whole-frame mask/bg-video textures apply directly —
    // no edge-strip variant needed here, unlike the side box faces.
    if (lastBuildHadBgRemoval && frameData[i].maskTexture) {
      const u = patchBackgroundMaterial(mat, frameData[i].maskTexture);
      if (frameData[i].bgVideoTexture) {
        u.uBgVideoMap.value = frameData[i].bgVideoTexture;
        u.uBgVideoExists.value = 1;
      }
    }
    const capMesh = new THREE.Mesh(geo, mat);
    // Not every frame yields a cap polygon (see the `if (!poly) return`
    // above), so capGroup's children aren't index-aligned with frameMeshes —
    // tag each cap with its real frame index so updateBackgroundCompositing()
    // can look up the right "only on current frame" comparison later.
    capMesh.userData.frameIndex = i;
    group.add(capMesh);
  });

  scene.add(group);
  capGroup = group;
  // Caps are rebuilt from scratch here, so any background-patched material
  // above starts back at patchBackgroundMaterial()'s uBgTargetOpacity:0
  // default — sync it to the live slider immediately rather than leaving it stuck
  // until something else happens to call updateBackgroundCompositing()
  // (updateSliceCaps() is called from slice-position/tilt/enable changes
  // too, not just updateGhostOpacity()).
  updateBackgroundCompositing();
}

// View → Elapsed: the scrub point. Frames before it are elapsed (ghosted),
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
    // Background-removed frames compute their alpha live in a shader patch
    // (patchBackgroundMaterial) driven by the mask texture and this same
    // `opacity` value — a material rendered with transparent:false ignores
    // that alpha entirely and shows the full original frame regardless of
    // what the shader computed. When the current build actually has
    // background removal, solid frames get the same alpha-aware treatment
    // ghosted frames already get, so the cutout actually shows (on
    // front/back AND the 4 side faces, since they share this materials
    // loop). Without background removal, blendAlpha reduces to exactly
    // !solid, keeping the DoubleSide flip-plane-visibility fix intact.
    const blendAlpha = !solid || lastBuildHadBgRemoval;
    meshMaterials(mesh).forEach((m) => {
      m.opacity = opacity;
      m.transparent = blendAlpha;
      m.depthWrite = !blendAlpha;
      // Blended (transparent) layers stay FrontSide — DoubleSide would draw
      // both the near AND far face of every stacked box, doubling the
      // alpha blend. Fully-opaque layers don't have that problem, and
      // DoubleSide is what keeps them visible after flipping the slice
      // plane exposes whichever face happens to be back-facing from the
      // current camera angle (a plain culling artifact, not a clip bug).
      m.side = blendAlpha ? THREE.FrontSide : THREE.DoubleSide;
      m.needsUpdate = true;
    });
  });
  // updateSliceCaps() calls updateBackgroundCompositing() itself now (it
  // has to, since caps are rebuilt from scratch on other triggers too), so
  // frameMeshes and caps end up synced from this one call.
  updateSliceCaps();
}

// Live, no-rebuild-needed background compositing: reads the current
// Background opacity / Background ghost opacity sliders and "only on
// current frame" checkbox, and writes the resolved result straight into
// each background-patched material's shader uniform (uBgTargetOpacity).

// Only used in "only on current frame" mode: a frame-index window either
// side of the exact current position that crossfades in/out, instead of a
// single Math.round()'d index snapping from fully off to fully on. Autoplay
// moves the exact position continuously, so a hard index match toggled on
// and off roughly every 75ms (80 frames / 6s loop) — read as flashing, not
// a transition.
const BG_ACTIVE_FADE_FRAMES = 1.5;

// Resolves what a background pixel's alpha multiplier should be for one
// frame, given which mode is active:
// - No replacement video at all: flat Background opacity, same as plain
//   (non-video) background removal always worked.
// - "Only on current frame" on: a crossfade peaking at Background opacity
//   right at Now, per BG_ACTIVE_FADE_FRAMES above.
// - Otherwise: a frame whose moment hasn't passed yet (or is the exact
//   current one) uses Background opacity, a multiplier on the full
//   replacement video. One that HAS already played uses Background ghost
//   opacity instead — and since this return value is multiplied straight
//   into diffuseColor.a, which already equals the material's own `opacity`
//   (1 for solid frames, Ghost opacity for elapsed ones — see
//   updateGhostOpacity()), that multiplication with Ghost opacity falls out
//   for free exactly like the original "0.25 background × 0.2 ghost = 0.05"
//   request, just using Background ghost opacity instead of Background
//   opacity for the elapsed case.
function bgTargetOpacityFor(mesh, i, exactIndex, hasVideo, bgOpacity, bgGhostOpacity, onlyCurrent) {
  if (!hasVideo) return bgOpacity;
  if (onlyCurrent) {
    const dist = Math.abs(i - exactIndex);
    return bgOpacity * Math.max(0, 1 - dist / BG_ACTIVE_FADE_FRAMES);
  }
  const elapsed = ghostPlane.distanceToPoint(mesh.position) < 0;
  return elapsed ? bgGhostOpacity : bgOpacity;
}

function updateBackgroundCompositing() {
  const n = frameMeshes.length;
  const bgOpacity = parseFloat(bgOpacitySlider.value);
  const bgGhostOpacity = parseFloat(bgGhostOpacitySlider.value);
  const onlyCurrent = bgOnlyCurrentCheckbox.checked;
  const exactIndex = parseFloat(nowSlider.value) * (n - 1);
  frameMeshes.forEach((mesh, i) => {
    meshMaterials(mesh).forEach((m) => {
      const u = m.userData && m.userData.bgUniforms;
      if (!u) return;
      const hasVideo = !!u.uBgVideoMap.value;
      u.uBgTargetOpacity.value = bgTargetOpacityFor(mesh, i, exactIndex, hasVideo, bgOpacity, bgGhostOpacity, onlyCurrent);
    });
  });
  // Slice caps are patched the same way (see updateSliceCaps()) but rebuilt
  // fresh every time ghost/slice state changes, so they need this same live
  // sync too — otherwise they'd sit stuck at the uBgTargetOpacity:0 default
  // patchBackgroundMaterial() initializes them with.
  if (capGroup) {
    capGroup.children.forEach((mesh) => {
      const u = mesh.material.userData && mesh.material.userData.bgUniforms;
      if (!u) return;
      const i = mesh.userData.frameIndex;
      const hasVideo = !!u.uBgVideoMap.value;
      u.uBgTargetOpacity.value = bgTargetOpacityFor(mesh, i, exactIndex, hasVideo, bgOpacity, bgGhostOpacity, onlyCurrent);
    });
  }
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

// Alternative to the box: each frame's own pixels become individual points
// (soft round sprites, not squares) instead of a solid textured plane — no
// depth/covariance estimation, just the frame's existing canvas resampled
// at `stride` intervals. Background-removed pixels (alpha near 0, already
// baked into `texture.image` by finalizeBackgroundRemoval if that ran)
// are skipped entirely rather than rendered as faint points.
function buildFramePoints(texture, stride, opacity0, clippingPlanes0, frameIndex) {
  const canvas = texture.image;
  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const halfW = PLANE_W / 2;
  const halfH = planeH / 2;

  // Every frame samples the identical (x,y) grid by default (same canvas
  // dims, same stride), which aliases into a moiré interference pattern
  // once ~100s of them stack densely along Z and are viewed at an angle —
  // confirmed by A/B testing against flat-box mode at the same settings,
  // which shows no such artifact (continuous textured faces don't have a
  // regular sample grid to alias against). A per-frame grid-offset alone
  // isn't enough to fix this: with a small integer stride, the offset
  // cycles through only `stride` distinct values and repeats every few
  // frames, so the moiré just reappears at a lower spatial frequency.
  // Instead, jitter each individual POINT by a continuous (sub-cell)
  // pseudo-random amount — this is the standard stochastic-sampling fix
  // for grid aliasing. `hash01` is deterministic (seeded from frame index
  // and pixel position), so a given build is still fully reproducible.
  function hash01(a, b) {
    let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b ^ 0x27d4eb2f, 0xc2b2ae35);
    h = Math.imul(h ^ (h >>> 15), 2246822519);
    h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const cellWorldW = (PLANE_W / w) * stride;
  const cellWorldH = (planeH / h) * stride;

  const positions = [];
  const colors = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const idx = (y * w + x) * 4;
      // alpha = fg + (1-fg)*bgOpacity (see bakeBackgroundAlpha) — background
      // pixels stay well under 50% even at a generous bgOpacity, foreground
      // stays at 100%, so a 50% cutoff separates them regardless of the
      // exact bgOpacity slider value used at bake time.
      if (data[idx + 3] < 128) continue;
      const seedA = frameIndex * 73856093 + x * 19349663;
      const seedB = frameIndex * 83492791 + y * 2654435761;
      const jx = (hash01(seedA, y) - 0.5) * cellWorldW;
      const jy = (hash01(x, seedB) - 0.5) * cellWorldH;
      positions.push((x / w) * PLANE_W - halfW + jx, halfH - (y / h) * planeH + jy, 0);
      colors.push(data[idx] / 255, data[idx + 1] / 255, data[idx + 2] / 255);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    // Sized to lightly overlap neighboring points at this density, so the
    // cloud reads as a soft continuous surface rather than isolated dots.
    size: (PLANE_W / (w / stride)) * 1.6,
    sizeAttenuation: true,
    vertexColors: true,
    map: dotSpriteTexture,
    transparent: true,
    opacity: opacity0,
    depthWrite: false,
    alphaTest: 0.02,
    clippingPlanes: clippingPlanes0,
    clipShadows: false,
  });
  return new THREE.Points(geo, mat);
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
  const asPoints = pointCloudCheckbox.checked;
  const pointStride = parseInt(pointDensitySlider.value, 10);

  frameMeshes = frameData.map((frame, i) => {
    const { texture, edges } = frame;
    if (asPoints) {
      const points = buildFramePoints(texture, pointStride, opacity0, clippingPlanes0, i);
      group.add(points);
      return points;
    }
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
    const rightMat = faceMat(edges.right);
    const leftMat = faceMat(edges.left);
    const topMat = faceMat(edges.top);
    const bottomMat = faceMat(edges.bottom);
    const frontMat = faceMat(texture);
    const backMat = faceMat(texture);

    // Background removal patches each face's shader with its matching mask
    // (the mask's own edge strips for the 4 side faces, the whole-frame mask
    // for front/back) so Background opacity reads live from a uniform
    // instead of a value baked into pixels at build time — see
    // patchBackgroundMaterial(). A replacement background video, if one was
    // extracted at matching timestamps, is wired the same way per face.
    if (lastBuildHadBgRemoval && frame.maskTexture) {
      const facePairs = [
        [rightMat, frame.maskEdges.right, frame.bgVideoEdges && frame.bgVideoEdges.right],
        [leftMat, frame.maskEdges.left, frame.bgVideoEdges && frame.bgVideoEdges.left],
        [topMat, frame.maskEdges.top, frame.bgVideoEdges && frame.bgVideoEdges.top],
        [bottomMat, frame.maskEdges.bottom, frame.bgVideoEdges && frame.bgVideoEdges.bottom],
        [frontMat, frame.maskTexture, frame.bgVideoTexture],
        [backMat, frame.maskTexture, frame.bgVideoTexture],
      ];
      facePairs.forEach(([mat, maskMap, bgVideoMap]) => {
        const u = patchBackgroundMaterial(mat, maskMap);
        if (bgVideoMap) {
          u.uBgVideoMap.value = bgVideoMap;
          u.uBgVideoExists.value = 1;
        }
      });
    }

    const materials = [rightMat, leftMat, topMat, bottomMat, frontMat, backMat];

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
const pointDensitySlider = bindRange('pointDensity', 'pointDensityVal');

// Lives in the View panel now, not the pre-build modal — live and
// adjustable any time after the block exists, no rebuild needed. Still
// bound by the same `bindRange` helper; only what `onInput` calls changed.
const bgOpacitySlider = bindRange('bgOpacity', 'bgOpacityVal', {
  decimals: 2,
  onInput: () => {
    if (frameMeshes.length) updateBackgroundCompositing();
  },
});

const bgGhostOpacitySlider = bindRange('bgGhostOpacity', 'bgGhostOpacityVal', {
  decimals: 2,
  onInput: () => {
    if (frameMeshes.length) updateBackgroundCompositing();
  },
});

const chromaToleranceSlider = bindRange('chromaTolerance', 'chromaToleranceVal');

function updateRemoveBackgroundControlsVisibility() {
  const on = bgRemoveEnabledCheckbox.checked;
  chromaKeyControls.classList.toggle('hidden', !on);
  bgVideoUploadControls.classList.toggle('hidden', !on);
}
bgRemoveEnabledCheckbox.addEventListener('change', updateRemoveBackgroundControlsVisibility);
updateRemoveBackgroundControlsVisibility();

function updatePointDensityControlsVisibility() {
  pointDensityControls.classList.toggle('hidden', !pointCloudCheckbox.checked);
}
pointCloudCheckbox.addEventListener('change', updatePointDensityControlsVisibility);
updatePointDensityControlsVisibility();

// Background opacity / Background ghost opacity / "only on current frame"
// only mean anything once a replacement background video is actually
// attached — hidden otherwise rather than shown as dead controls.
function updateBgVideoOpacityControlsVisibility() {
  bgVideoOpacityControls.classList.toggle('hidden', bgVideoInput.files.length === 0);
}
updateBgVideoOpacityControlsVisibility();

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

bgVideoInput.addEventListener('change', (e) => {
  updateBgVideoOpacityControlsVisibility();
  const file = e.target.files[0];
  if (!file) return;

  bgVideoLabelText.textContent = `Loading ${file.name}…`;

  if (bgVideoObjectURL) URL.revokeObjectURL(bgVideoObjectURL);
  bgVideoObjectURL = URL.createObjectURL(file);
  bgVideoEl.src = bgVideoObjectURL;

  bgVideoEl.addEventListener(
    'loadedmetadata',
    () => {
      bgVideoLabelText.textContent = `${file.name} (${bgVideoEl.duration.toFixed(1)}s)`;
    },
    { once: true }
  );

  bgVideoEl.addEventListener(
    'error',
    () => {
      bgVideoLabelText.textContent = 'Could not load that background video — try a different format.';
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
      if (f.maskTexture) f.maskTexture.dispose();
      if (f.maskEdges) Object.values(f.maskEdges).forEach((t) => t.dispose());
      if (f.bgVideoTexture) f.bgVideoTexture.dispose();
      if (f.bgVideoEdges) Object.values(f.bgVideoEdges).forEach((t) => t.dispose());
    });
    frameData = newFrameData;
    lastBuildHadBgRemoval = false;

    // A replacement background video only matters once background removal
    // actually punches a hole for it to show through — extracted here, right
    // after the main video, so its frames exist before finalizeBackgroundRemoval()
    // / buildBlock() read frame.bgVideoTexture.
    if (bgRemoveEnabledCheckbox.checked && bgVideoInput.files.length && bgVideoEl.readyState >= 1) {
      const timestamps = frameData.map((f) => f.time);
      const pairedFrames = await extractPairedFrames(bgVideoEl, timestamps, maxW, (i, n) => {
        progressFill.style.width = `${(i / n) * 100}%`;
        progressLabel.textContent = `Extracting background video frames… ${i} / ${n}`;
      });
      pairedFrames.forEach((pf, i) => {
        frameData[i].bgVideoTexture = pf.texture;
        frameData[i].bgVideoEdges = pf.edges;
      });
    }

    if (bgRemoveEnabledCheckbox.checked) {
      await runBackgroundRemovalFlow();
    } else {
      buildBlock();
      hint.textContent = 'Drag to orbit, use the Zoom bar or scroll to zoom. Drag "Elapsed" in View to scrub elapsed vs. solid.';
    }
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

bgOnlyCurrentCheckbox.addEventListener('change', () => {
  if (frameMeshes.length) updateBackgroundCompositing();
});

// Autoplay drives "Elapsed" itself, so any manual interaction with it should
// take back control rather than have the loop fight the user's drag.
function stopAutoPlay() {
  autoPlayCheckbox.checked = false;
}
nowSlider.addEventListener('pointerdown', stopAutoPlay);
document.getElementById('nowPosVal').addEventListener('focus', stopAutoPlay);

// Resume from wherever "Elapsed" currently sits, not wherever the accumulator
// last was (e.g. after the user manually repositioned it).
autoPlayCheckbox.addEventListener('change', () => {
  if (autoPlayCheckbox.checked) autoPlayPos = parseFloat(nowSlider.value) || 0;
});

function setSidebarCollapsed(collapsed) {
  panelWindow.classList.toggle('collapsed', collapsed);
}
collapseSidebarBtn.addEventListener('click', () => setSidebarCollapsed(true));
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

sliceFlippedCheckbox.addEventListener('change', updateClipPlane);

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
