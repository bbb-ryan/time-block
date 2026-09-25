# Time Block

Turn a video into a solid 3D "block of time" — every sampled frame becomes a real
slab of geometry stacked along a depth axis, so the block is genuinely solid from
any angle, not just a stack of flat cards. Rotate it to see motion trails ghost
through the volume, scrub a point in time to reveal what's already happened vs.
what hasn't, or slice through it at any angle to see a real cross-section.

Runs entirely client-side — no upload, no server processing. Video decoding,
frame extraction, background removal, and rendering all happen in your browser
via `<video>`, `<canvas>`, Three.js/WebGL, and (for background removal) local
ML inference over ONNX Runtime Web.

## Running it locally

```bash
cd "3d video"
python3 serve.py 8744
```

Then open `http://localhost:8744`. A real server (not `file://`) is required
because the page uses ES module import maps for Three.js and the background
removal models. `serve.py` (not plain `python3 -m http.server`) is what's
actually used here — the bare `http.server` module sends no `Cache-Control`
header at all, which leaves the browser free to serve stale `app.js` across
reloads; `serve.py` explicitly disables caching so edits always show up.

## Feature guide

### Source
Pick any video file (`mp4`, `mov`, `webm`, `m4v`, `avi`, `mkv`, `ogv` — actual
playback support depends on your browser's codec support). Codecs with an
alpha channel meant for pre-keyed footage (e.g. Apple ProRes 4444) generally
won't work: most browsers can't decode ProRes at all, and even where a codec
does decode, `<video>` → `<canvas>` capture always flattens to opaque RGB, so
alpha never survives regardless. Use the built-in background removal below
instead of a pre-keyed source.

### Build
- **Frames** (20–400) — how many evenly-spaced frames to sample from the video.
  More frames = a denser, more detailed block, but slower to extract.
- **Sample width** (80–1080px) — resolution each sampled frame is downscaled to
  before being used as a texture. Higher = sharper but slower/heavier.
- **Render frames as points** — each frame becomes a cloud of soft round
  points sampled from its own pixels instead of a solid textured plane. Not
  real Gaussian Splatting (that needs multiple camera angles of the same
  instant, which a single video doesn't provide) — just a different, more
  "particulate" look that stays visible even from a glancing/edge-on camera
  angle, where a flat plane would vanish to a hairline.
  - **Point spacing** — sample every Nth pixel as a point. Lower = denser and
    more solid-looking (more points, slower); higher = sparser and more
    particle-like (fewer points, faster).
- **Remove background** — separates the subject from the background *before*
  the block is built, in its own preview window (see below), so the block only
  contains the moving subject instead of a busy or cluttered backdrop.
  - **Model** — three interchangeable ways to produce the mask:
    - *Selfie / person* — MediaPipe's selfie segmenter. Fast, tuned
      specifically for real human portraits/selfies.
    - *General subject (ISNet)* — [@imgly/background-removal](https://github.com/imgly/background-removal-js),
      a class-agnostic salient-object segmenter (the same family behind most
      "remove.bg"-style tools). Slower, but not limited to photographic
      people — works on objects, animals, illustrated characters, etc.
    - *Green screen (chroma key)* — plain color-distance thresholding against
      a picked key color. Instant, deterministic, no ML model — but only
      works if the subject was actually filmed against a plain, evenly-lit
      green/blue backdrop. Exposes its own **Key color** picker and
      **Tolerance** slider.
  - The **Remove Background** window that opens after clicking Build block
    runs the mask computation once (with its own progress bar), then lets you
    preview and adjust a **Background opacity** slider live against a sample
    frame — 0 fades the background out completely, 1 restores it fully —
    before baking the chosen value into every frame and building the object.
    **Skip** builds without any of it.
- **Build block** — extracts frames (and, if enabled, removes the background)
  and constructs the 3D volume. Shows a progress bar while it works.

### View
- **Depth** — spacing between frames along the time axis. Compress it into a
  thin fan or stretch it into a long block.
- **Ghost opacity** — how transparent "elapsed" frames are (see *Now*, below).
- **Now** (0–1) — the scrub point. Frames before it are elapsed and render
  ghosted at *Ghost opacity*; frames from it onward haven't elapsed yet and
  render fully solid. This is what actually drives the "block of time" effect.
  - **Autoplay** — loops *Now* from 0 to 1 automatically (6s per loop).
    Stops itself the moment you touch the Now slider/field directly.
  - **Ghost all but current frame** — swaps the before/after split for a
    single-frame "spotlight": only the exact frame at *Now* stays solid,
    everything else (past *or* future) ghosts.
- **Solid sides (fill to next frame)** — extrudes each frame into a real box
  that touches its neighbors, so the block has no gaps from any viewing angle.
  Off by default (thin/fanned look); automatically forced on when *Enable
  slice* is turned on, since a hard cut through gapped planes looks frayed.
  If background removal produced real per-pixel transparency, solid frames
  automatically respect it too (no separate toggle needed) — though the side
  walls themselves are still a flat rectangular extrusion of each frame's
  edge pixels, not a silhouette-shaped one, so a background-removed block
  with Solid sides on can look corrugated rather than smooth (see Known
  issues below).
- **Auto-rotate** — turntable spin of the camera around the block.
- **Show outline** — wireframe box around the block's full extent.
- **Zoom** — camera distance, draggable directly, via scroll-wheel, or via
  trackpad pinch (all stay in sync). Range auto-scales to the block's actual
  size.
- **Reset camera** — reframes the camera to fit the current block.

### Slice
An independent cutaway tool — its own position and angle, unrelated to *Now*.
- **Position** — where the cut plane sits, from one side of the volume to the
  other (the range auto-adjusts to whatever the current tilt actually spans).
- **Cut angle X / Y** — tilts the cut plane.
- **Horizontal / Vertical / Diagonal** — angle presets.
- **Enable slice** — physically removes the geometry on the far side of the
  cut plane (rather than just fading it), revealing a real, correctly
  textured cross-section at the cut — not a hollow gap.
- **Flip cut plane** — swaps which side of the cut is kept, without moving
  the cut line itself.

### Export
- **Export PNG** — saves the current view as a PNG.

### Window chrome
The sidebar ("Controls") is a Win98-styled window whose title-bar
Minimize/Maximize buttons collapse it down to a thin strip and restore it, so
the viewport can have the full window when you want it.

## Known issues

- **Background-removed + Solid sides can look corrugated.** Each frame's side
  wall is still built from a flat rectangular edge strip, so once background
  removal makes that edge partially transparent, packing frames edge-to-edge
  shows the rippling boundary rather than a smooth wall. A fix that traces
  each frame's real silhouette and extrudes *that* shape instead exists on
  the `silhouette-side-geometry` branch (not yet merged) — but it surfaced a
  second, more fundamental issue: background removal only fades a pixel's
  *alpha*, never its RGB, so a removed background's original color is still
  present underneath at reduced opacity. That's invisible through one or two
  translucent layers, but stacking many silhouette side walls compounds it
  into a visible color haze. Fixing that (darkening RGB toward black as
  Background opacity drops) is the next step before merging.

## Deploying

### GitHub Pages

The repo is already on GitHub, so this needs no extra files or accounts —
Pages is configured to serve straight from the `main` branch's root, the
same static files (`index.html`, `app.js`, `style.css`) used locally. Push to
`main` and the live site updates automatically:

```bash
git push origin main
```

The URL is `https://bbb-ryan.github.io/time-block/` (check **Settings →
Pages** in the GitHub repo for the exact URL and deployment status). No
server-side code or environment variables are needed: everything the app
depends on (Three.js, the ML background-removal models, ONNX Runtime Web)
loads from public CDNs via the import map in `index.html`, exactly like it
does locally.

### Anywhere else

Since there's no build step, any static host works the same way — copy
`index.html`, `app.js`, and `style.css` to the host and serve them over
HTTP(S). (`file://` won't work — ES module import maps require a real
origin.)

## Roadmap

Not built yet, roughly in priority order:

- **Fix background-removal RGB bleed-through** — darken removed-background
  pixels toward black (not just fade their alpha), so faded background no
  longer keeps its full original color underneath. See *Known issues* above.
- **Merge silhouette-following Solid sides** — once the RGB fix above lands,
  merge the `silhouette-side-geometry` branch so Solid sides on a
  background-removed block extrudes the traced subject silhouette instead of
  a flat rectangle.
- **Cropper** — crop the source video's frame before extraction, instead of
  always using the full frame (useful for framing a subject or fixing aspect
  ratio before building).
- **Better pan/zoom** — further camera control refinements beyond the current
  orbit/zoom (e.g. right-click/two-finger pan, fit-to-view, smoother easing).
- **UI pass** — general polish: clearer disabled-state treatment, real
  behavior (or removal) of the decorative window-chrome buttons that don't
  yet do anything (e.g. the Viewport window's own minimize/close), and other
  small consistency fixes.
