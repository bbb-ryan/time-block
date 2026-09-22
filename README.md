# Time Block

Turn a video into a solid 3D "block of time" — every sampled frame becomes a real
slab of geometry stacked along a depth axis, so the block is genuinely solid from
any angle, not just a stack of flat cards. Rotate it to see motion trails ghost
through the volume, scrub a point in time to reveal what's already happened vs.
what hasn't, or slice through it at any angle to see a real cross-section.

Runs entirely client-side — no upload, no server processing. Video decoding,
frame extraction, and rendering all happen in your browser via `<video>`,
`<canvas>`, and Three.js/WebGL.

## Running it

```bash
cd "3d video"
python3 -m http.server 8743
```

Then open `http://localhost:8743`. A real server (not `file://`) is required
because the page uses ES module import maps for Three.js.

## Feature guide

### Source
Pick any video file (`mp4`, `mov`, `webm`, `m4v`, `avi`, `mkv`, `ogv` — actual
playback support depends on your browser's codec support).

### Build
- **Frames** (20–400) — how many evenly-spaced frames to sample from the video.
  More frames = a denser, more detailed block, but slower to extract.
- **Sample width** (80–1080px) — resolution each sampled frame is downscaled to
  before being used as a texture. Higher = sharper but slower/heavier.
- **Build block** — extracts frames and constructs the 3D volume. Shows a
  progress bar while it works.

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
- **Auto-rotate** — turntable spin of the camera around the block.
- **Show outline** — wireframe box around the block's full extent.
- **Zoom** — camera distance, draggable directly or via scroll-wheel (both
  stay in sync). Range auto-scales to the block's actual size.
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

### Export
- **Export PNG** — saves the current view as a PNG.

### Window chrome
The Win98-styled title bar's Minimize/Close buttons actually collapse the
sidebar down to a thin strip (Maximize/Close restore it), so the viewport can
have the full window when you want it.

## Roadmap

Not built yet, roughly in priority order:

- **Flip cut plane** — a toggle to invert which side of the *Slice* cut is
  kept, instead of only ever discarding the "far" side.
- **Background remover** — segment out the static background so the block
  only contains the moving subject, isolating motion trails from clutter.
- **Cropper** — crop the source video's frame before extraction, instead of
  always using the full frame (useful for framing a subject or fixing aspect
  ratio before building).
- **Better pan/zoom** — further camera control refinements beyond the current
  orbit/zoom (e.g. right-click/two-finger pan, fit-to-view, smoother easing).
- **UI pass** — general polish: clearer disabled-state treatment, real
  behavior (or removal) of the decorative window-chrome buttons that don't
  yet do anything (e.g. the Viewport window's own minimize/close), and other
  small consistency fixes.
