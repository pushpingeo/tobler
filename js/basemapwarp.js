// The basemap in the run's grid (plan step 2b). MapLibre can only draw Web Mercator, so the page draws positron in Web
// Mercator off screen, at print resolution, and warps the picture into the presentation CRS through a control grid:
// every 64th output pixel is taken back through the run's projector (inverse: grid → WGS 84) and on to a Web Mercator
// pixel; pixels between are interpolated from the four nodes round them. This is raster reprojection (rubber-sheeting),
// not vector reprojection: the basemap's labels turn by the grid convergence and its text is resampled once. Vector
// layers on the sheet don't come through here; js/mapsheet.js projects them vertex by vertex.
// The geodesy is the projector's (js/presentation.js, invariant 10): this file holds only Web Mercator's pixel formula,
// which is how MapLibre addresses its own canvas, not a coordinate system any output shows.
//   warpPlan(…) → where to point MapLibre and the control grid (no DOM; tested).
//   warpPixels(src, plan) → the warped picture's pixels (no DOM; tested).
//   drawBasemap(…) → the whole thing in a page: render, read, warp, an image.

export const PRINT_DPI = 200; // Rob, 28 Nov: sharp in print, inside phone GPU limits
export const PIXEL_RATIO = 2; // MapLibre draws at 100 CSS px per inch, so its labels print at a readable size
export const STEP_PX = 64;
const TILE = 512; // MapLibre's world is 512 CSS px across at zoom 0
const R = 6378137;

// Web Mercator, as MapLibre addresses its canvas: world CSS pixels at a zoom.
export function worldPx([lon, lat], zoom) {
  const size = TILE * 2 ** zoom, phi = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * size, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * size];
}
export function lonLatOfWorldPx([x, y], zoom) {
  const size = TILE * 2 ** zoom;
  return [(x / size) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / size))) * 180) / Math.PI];
}

// ground: the frame in the grid { e0, e1, n0, n1 } (metres); widthPx, heightPx: the output picture; inverse: the
// projector's grid → [lon, lat]. Returns the zoom, MapLibre's centre and canvas size (CSS px), and the control grid of
// source pixels (device px) for each node.
export function warpPlan({ ground, widthPx, heightPx, inverse, pixelRatio = PIXEL_RATIO, step = STEP_PX }) {
  const mPerPx = (ground.e1 - ground.e0) / widthPx;
  const cols = Math.ceil(widthPx / step) + 1, rows = Math.ceil(heightPx / step) + 1;
  const nodeX = (i) => Math.min(i * step, widthPx), nodeY = (j) => Math.min(j * step, heightPx);
  const toGround = (x, y) => [ground.e0 + (x / widthPx) * (ground.e1 - ground.e0), ground.n1 - (y / heightPx) * (ground.n1 - ground.n0)];
  const ll = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) ll.push(inverse(toGround(nodeX(i), nodeY(j))));
  const mid = inverse(toGround(widthPx / 2, heightPx / 2));
  // A device pixel of the source should be about a pixel of the output: CSS px are pixelRatio times larger.
  const zoom = Math.log2((2 * Math.PI * R * Math.cos((mid[1] * Math.PI) / 180)) / (TILE * mPerPx * pixelRatio));
  const w = ll.map((p) => worldPx(p, zoom));
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of w) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cssW = Math.ceil(x1 - x0) + 4, cssH = Math.ceil(y1 - y0) + 4;
  const cxw = (x0 + x1) / 2, cyw = (y0 + y1) / 2;
  const ox = cxw - cssW / 2, oy = cyw - cssH / 2; // the canvas's top-left in world CSS px
  const sx = new Float64Array(w.length), sy = new Float64Array(w.length);
  w.forEach(([x, y], k) => { sx[k] = (x - ox) * pixelRatio; sy[k] = (y - oy) * pixelRatio; });
  return { zoom, centre: lonLatOfWorldPx([cxw, cyw], zoom), cssW, cssH, pixelRatio, origin: [ox, oy],
    widthPx, heightPx, step, cols, rows, sx, sy, mPerPx };
}

// The exact source pixel for an output pixel (to test the grid against): no interpolation.
export function exactSource(plan, ground, inverse, x, y) {
  const g = [ground.e0 + (x / plan.widthPx) * (ground.e1 - ground.e0), ground.n1 - (y / plan.heightPx) * (ground.n1 - ground.n0)];
  const [wx, wy] = worldPx(inverse(g), plan.zoom);
  return [(wx - plan.origin[0]) * plan.pixelRatio, (wy - plan.origin[1]) * plan.pixelRatio];
}

// The source pixel the control grid gives for an output pixel (bilinear between the four nodes round it).
export function gridSource(plan, x, y) {
  const { step, cols, rows, sx, sy, widthPx, heightPx } = plan;
  const i = Math.min(Math.floor(x / step), cols - 2), j = Math.min(Math.floor(y / step), rows - 2);
  const xa = i * step, xb = Math.min((i + 1) * step, widthPx), ya = j * step, yb = Math.min((j + 1) * step, heightPx);
  const u = xb > xa ? (x - xa) / (xb - xa) : 0, v = yb > ya ? (y - ya) / (yb - ya) : 0;
  const k = j * cols + i;
  const lerp = (a) => (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + cols] * (1 - u) + a[k + cols + 1] * u) * v;
  return [lerp(sx), lerp(sy)];
}

// src: { width, height, data (RGBA bytes) }, the MapLibre canvas. Returns RGBA bytes for widthPx × heightPx.
// Pixel centres: output (x + 0.5, y + 0.5) samples the source at its centre-based position, bilinear.
export function warpPixels(src, plan) {
  const { widthPx: W, heightPx: H } = plan;
  const out = new Uint8ClampedArray(W * H * 4);
  const sw = src.width, sh = src.height, d = src.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [fx, fy] = gridSource(plan, x + 0.5, y + 0.5);
      const gx = fx - 0.5, gy = fy - 0.5;
      const x0 = Math.floor(gx), y0 = Math.floor(gy), ax = gx - x0, ay = gy - y0;
      const o = (y * W + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= sw || y0 + 1 >= sh) { out[o + 3] = 0; continue; }
      const p00 = (y0 * sw + x0) * 4, p10 = p00 + 4, p01 = p00 + sw * 4, p11 = p01 + 4;
      for (let c = 0; c < 4; c++) {
        out[o + c] = (d[p00 + c] * (1 - ax) + d[p10 + c] * ax) * (1 - ay) + (d[p01 + c] * (1 - ax) + d[p11 + c] * ax) * ay;
      }
    }
  }
  return out;
}

// Output size in pixels for a frame in millimetres.
export const pixelsFor = (frame, dpi = PRINT_DPI) => ({ widthPx: Math.round((frame.w / 25.4) * dpi), heightPx: Math.round((frame.h / 25.4) * dpi) });

// In a page: draws the style off screen, warps it and returns { href (PNG data URL), plan } or { error }.
// maplibregl is the page's global. Waits for the map to go idle (every tile loaded), up to timeoutMs.
export async function drawBasemap({ maplibregl, style, ground, frame, inverse, dpi = PRINT_DPI, timeoutMs = 30000, doc = document }) {
  const { widthPx, heightPx } = pixelsFor(frame, dpi);
  const plan = warpPlan({ ground, widthPx, heightPx, inverse });
  const box = doc.createElement("div");
  // Off screen but laid out: a hidden or display:none container never draws (lesson: hidden tabs).
  box.style.cssText = `position:fixed;left:-${plan.cssW + 100}px;top:0;width:${plan.cssW}px;height:${plan.cssH}px;pointer-events:none`;
  doc.body.append(box);
  let map = null;
  try {
    map = new maplibregl.Map({ container: box, style, center: plan.centre, zoom: plan.zoom, bearing: 0, pitch: 0,
      interactive: false, attributionControl: false, preserveDrawingBuffer: true, fadeDuration: 0, pixelRatio: plan.pixelRatio,
      renderWorldCopies: false, maxCanvasSize: [8192, 8192] });
    let failed = null;
    map.on("error", (e) => { failed ||= String(e?.error?.message || e?.message || "the basemap failed"); });
    await new Promise((ok, no) => {
      const t = setTimeout(() => no(new Error(failed || "the basemap didn't finish loading")), timeoutMs);
      map.once("idle", () => { clearTimeout(t); ok(); });
    });
    if (failed && !map.areTilesLoaded()) throw new Error(failed);
    const gl = map.getCanvas();
    if (gl.width !== Math.round(plan.cssW * plan.pixelRatio) || gl.height !== Math.round(plan.cssH * plan.pixelRatio)) {
      throw new Error(`the basemap canvas came out ${gl.width} × ${gl.height}, not the size asked for`);
    }
    const c = doc.createElement("canvas"); c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d"); ctx.drawImage(gl, 0, 0);
    const src = ctx.getImageData(0, 0, c.width, c.height);
    const px = warpPixels(src, plan);
    const outC = doc.createElement("canvas"); outC.width = widthPx; outC.height = heightPx;
    outC.getContext("2d").putImageData(new ImageData(px, widthPx, heightPx), 0, 0);
    return { href: outC.toDataURL("image/png"), plan, canvas: outC };
  } catch (e) {
    return { error: e.message || String(e), plan };
  } finally {
    try { map?.remove(); } catch { /* already gone */ }
    box.remove();
  }
}
