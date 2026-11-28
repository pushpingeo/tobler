// The map engine (plan step 2b): one printed map sheet, worked out from a run, as an SVG. No DOM, so it can be tested.
// The rules are the cartography skill's (skills/cartography/SKILL.md); this file applies the parts marked "always".
// Everything is projected through the run's projector (js/presentation.js, projectorFor; invariant 10): this file holds
// no projection of its own. Geometry is projected vertex by vertex, so a sheet is in the run's grid, not warped.
//   planSheet(inputs, projector) → a plan: frame, scale, ticks, legend, north-arrow corner, paths in millimetres.
//   sheetSvg(plan, { basemap }) → the sheet as an SVG string (millimetre units, A3 landscape).
//   sheetInputs(record, { kind, topic }) → the inputs for planSheet from a run record (full or from a share link).
import * as turf from "./vendor/turf.js";
import { topicOf, topicInfo } from "./findings.js";
import { presentationLine } from "./presentation.js";

// ---- the sheet (millimetres) ----------------------------------------------------------------------------------------

export const PAPER = { A3: { w: 420, h: 297 } };
export const PANEL_MM = 95; // Rob, 28 Nov
// Space outside the frame for the coordinate labels: wider on the left (labels read across) and at the bottom.
const MARGIN = { left: 18, right: 8, top: 8, bottom: 12 };
export const STANDARD_SCALES = [2500, 5000, 10000, 25000, 50000, 100000, 250000];
// Beyond the skill's list, only when a run's furthest finding won't fit at 1:250,000 (a 50 km reach is about 100 km
// across; A3 at 1:250,000 shows about 75 km). Every finding stays on its map; the sheet says the scale.
export const WIDE_SCALES = [500000, 1000000];
export const TICK_INTERVALS_M = [100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000];
const TICK_MIN_MM = 30;
const SCALE_BAR_MAX_MM = 60;
export const SHEET_DISCLAIMER = "Made with Tobler from public web services, each named under Sources. A screening map: boundaries may have been generalised. Not a survey, title plan or legal boundary.";
export const SITE_COLOUR = "#d1352a";
const INK = "#15303c";

export function frameBox(paper = "A3") {
  const P = PAPER[paper];
  return { x: MARGIN.left, y: MARGIN.top, w: P.w - MARGIN.left - MARGIN.right - PANEL_MM, h: P.h - MARGIN.top - MARGIN.bottom };
}

// The next standard scale up from an extent (metres across and down) for a frame (millimetres).
export function scaleFor(widthM, heightM, frame) {
  const need = Math.max(widthM * 1000 / frame.w, heightM * 1000 / frame.h);
  return [...STANDARD_SCALES, ...WIDE_SCALES].find((s) => s >= need) ?? WIDE_SCALES.at(-1);
}

// The first interval that puts ticks at least 30 mm apart (1 km at 1:25,000).
export const tickInterval = (scale) => TICK_INTERVALS_M.find((i) => i * 1000 / scale >= TICK_MIN_MM) ?? TICK_INTERVALS_M.at(-1);

// Full metres, grouped in threes: "622 000".
export const groupMetres = (v) => String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

// The longest round length (1, 2 or 5 × 10ⁿ m) that fits the bar.
export function scaleBarLength(scale) {
  const maxM = SCALE_BAR_MAX_MM * scale / 1000;
  let best = 1;
  for (let p = 1; p <= 1e7; p *= 10) for (const k of [1, 2, 5]) if (k * p <= maxM) best = k * p;
  return best;
}
const lengthText = (m) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
export const scaleText = (s, paper = "A3") => `1:${s.toLocaleString("en-GB")} at ${paper}`;

// ---- geometry in the grid, then in millimetres -----------------------------------------------------------------------

// Every ring, line or point of a GeoJSON geometry, projected: { polys: [[ring…]…], lines: [[pt…]…], points: [pt…] }.
function projectGeometry(g, fwd) {
  const out = { polys: [], lines: [], points: [] };
  const ring = (r) => r.map(fwd);
  const walk = (g) => {
    if (!g) return;
    if (g.type === "Point") out.points.push(fwd(g.coordinates));
    else if (g.type === "MultiPoint") g.coordinates.forEach((c) => out.points.push(fwd(c)));
    else if (g.type === "LineString") out.lines.push(ring(g.coordinates));
    else if (g.type === "MultiLineString") g.coordinates.forEach((l) => out.lines.push(ring(l)));
    else if (g.type === "Polygon") out.polys.push(g.coordinates.map(ring));
    else if (g.type === "MultiPolygon") g.coordinates.forEach((p) => out.polys.push(p.map(ring)));
    else if (g.type === "GeometryCollection") g.geometries.forEach(walk);
  };
  walk(g);
  return out;
}
function boundsOf(shapes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = ([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  for (const s of shapes) { s.points.forEach(add); s.lines.forEach((l) => l.forEach(add)); s.polys.forEach((p) => p[0].forEach(add)); }
  return { x0, y0, x1, y1 };
}

// Planar tests in millimetres (sheet space).
const inRing = ([x, y], r) => {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inPoly = (p, poly) => inRing(p, poly[0]) && !poly.slice(1).some((h) => inRing(p, h));
function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const lineDist = (p, l) => { let d = Infinity; for (let i = 1; i < l.length; i++) d = Math.min(d, segDist(p, l[i - 1], l[i])); return l.length === 1 ? Math.hypot(p[0] - l[0][0], p[1] - l[0][1]) : d; };
const segsCross = (a, b, c, d) => {
  const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
};
const inBox = ([x, y], b) => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
const boxEdges = (b) => { const c = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]]; return c.map((p, i) => [p, c[(i + 1) % 4]]); };

// Does a shape (in millimetres) draw inside a box? On its real outline: a vertex inside, an edge crossing the box, or
// the box inside a polygon. Never on the shape's bounding box (the skill's legend rule).
export function drawsIn(s, b) {
  const lineHits = (l) => l.some((p) => inBox(p, b)) || boxEdges(b).some(([c, d]) => l.some((p, i) => i > 0 && segsCross(l[i - 1], p, c, d)));
  if (s.points.some((p) => inBox(p, b))) return true;
  if (s.lines.some(lineHits)) return true;
  for (const poly of s.polys) {
    if (poly.some(lineHits)) return true;
    if (inPoly([b.x + b.w / 2, b.y + b.h / 2], poly)) return true;
  }
  return false;
}

// Is a point (mm) drawn on? Inside a filled polygon, or within reach of a line, ring or point marker.
function drawnAt(p, s, { fill = true, lineMm = 0.8, pointMm = 1.6 } = {}) {
  if (s.points.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= pointMm)) return true;
  if (s.lines.some((l) => lineDist(p, l) <= lineMm)) return true;
  for (const poly of s.polys) {
    if (fill && inPoly(p, poly)) return true;
    if (poly.some((r) => lineDist(p, r) <= lineMm)) return true;
  }
  return false;
}

// ---- the north arrow's corner ---------------------------------------------------------------------------------------

export const ARROW = { w: 12, h: 22, inset: 5 };
export const CORNERS = ["top left", "top right", "bottom left", "bottom right"];
export function cornerBox(frame, corner) {
  const x = corner.endsWith("left") ? frame.x + ARROW.inset : frame.x + frame.w - ARROW.inset - ARROW.w;
  const y = corner.startsWith("top") ? frame.y + ARROW.inset : frame.y + frame.h - ARROW.inset - ARROW.h;
  return { x, y, w: ARROW.w, h: ARROW.h };
}
// The first quiet corner (the site doesn't touch it and under 5% of it is drawn on), else the least busy. Sampled on a
// 16 × 16 grid of points in the corner's box.
export function arrowCorner(frame, { site, drawn }) {
  const N = 16;
  const scored = CORNERS.map((corner) => {
    const b = cornerBox(frame, corner);
    let hits = 0, siteHit = drawsIn(site, b);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const p = [b.x + (i + 0.5) * b.w / N, b.y + (j + 0.5) * b.h / N];
      if (drawnAt(p, site)) siteHit = true;
      if (drawnAt(p, site) || drawn.some((s) => drawnAt(p, s.mm, { fill: s.fill }))) hits++;
    }
    return { corner, box: b, siteHit, share: hits / (N * N) };
  });
  const quiet = scored.find((c) => !c.siteHit && c.share < 0.05);
  return quiet ? { ...quiet, quiet: true } : { ...scored.slice().sort((a, b) => (a.siteHit - b.siteHit) || (a.share - b.share))[0], quiet: false };
}

// ---- the plan -------------------------------------------------------------------------------------------------------

// inputs: { site (WGS 84 feature), evidence ([features] with theme, dataset, name), rings_km ([…]),
//   extent_km (grow the site by this for the frame; 0 = the site), title, subtitle, pc (presentation_crs),
//   small (lines), locator (country feature or null), paper }
export function planSheet(inputs, projector) {
  const { site, evidence = [], rings_km = [], extent_km = 0, paper = "A3" } = inputs;
  if (!site?.geometry) throw new Error("A sheet needs the site's outline.");
  const fwd = (ll) => projector.forward(ll);
  const frame = frameBox(paper);
  // The extent: the site grown by the extent distance (a true buffer), in the grid.
  const grown = extent_km > 0 ? turf.buffer(site, extent_km, { units: "kilometers", steps: 64 }) : site;
  const gb = boundsOf([projectGeometry(grown.geometry, fwd)]);
  const pad = extent_km > 0 ? 1 : 1.15; // a site map leaves the site a little room
  const wM = Math.max(gb.x1 - gb.x0, 1) * pad, hM = Math.max(gb.y1 - gb.y0, 1) * pad;
  const scale = scaleFor(wM, hM, frame);
  const cx = (gb.x0 + gb.x1) / 2, cy = (gb.y0 + gb.y1) / 2;
  const halfW = frame.w * scale / 2000, halfH = frame.h * scale / 2000;
  const ground = { e0: cx - halfW, e1: cx + halfW, n0: cy - halfH, n1: cy + halfH };
  const toMm = ([e, n]) => [frame.x + (e - ground.e0) * 1000 / scale, frame.y + (ground.n1 - n) * 1000 / scale];
  const mmOf = (g) => {
    const s = projectGeometry(g, fwd);
    return { points: s.points.map(toMm), lines: s.lines.map((l) => l.map(toMm)), polys: s.polys.map((p) => p.map((r) => r.map(toMm))) };
  };

  const siteMm = mmOf(site.geometry);
  const rings = rings_km.filter((v) => v > 0).map((km) => ({ km, mm: mmOf(turf.buffer(site, km, { units: "kilometers", steps: 96 }).geometry) }))
    .map((r) => ({ ...r, draws: drawsIn(r.mm, frame) }));
  const layers = evidence.map((f) => {
    const theme = topicOf(f.properties.theme);
    return { name: f.properties.name || "", theme, colour: topicInfo(theme).colour, dataset: f.properties.dataset || topicInfo(theme).label,
      publisher: f.properties.publisher || "", licence: f.properties.licence || "", checked_at: f.properties.checked_at || "", surrounds: !!f.properties.surrounds, label: f.properties.label || null, mm: mmOf(f.geometry) };
  }).map((l) => ({ ...l, draws: drawsIn(l.mm, frame) }));

  // The legend: only what draws inside the frame (skill, section 4), site first, then bands, then each layer by source.
  const legend = [{ kind: "site", label: inputs.site_label || "The site", colour: SITE_COLOUR }];
  const ringsDrawn = rings.filter((r) => r.draws);
  if (ringsDrawn.length) legend.push({ kind: "band", label: `Distance from the site: ${ringsDrawn.map((r) => lengthText(r.km * 1000)).join(", ")}`, colour: INK });
  const seen = new Map();
  for (const l of layers.filter((x) => x.draws)) {
    const key = `${l.theme}|${l.dataset}`;
    if (!seen.has(key)) seen.set(key, { kind: l.mm.polys.length ? "area" : l.mm.lines.length ? "line" : "point", label: l.dataset, topic: topicInfo(l.theme).label, colour: l.colour });
  }
  legend.push(...[...seen.values()].sort((a, b) => a.topic.localeCompare(b.topic) || a.label.localeCompare(b.label)));

  // Sources: each layer drawn, with publisher, licence and the date it was queried (skill, section 3).
  const src = new Map();
  for (const l of layers.filter((x) => x.draws)) {
    const k = `${l.dataset}|${l.publisher}`;
    const was = src.get(k);
    if (!was) src.set(k, { dataset: l.dataset, publisher: l.publisher, licence: l.licence, checked_at: l.checked_at });
    else { was.licence ||= l.licence; if (l.checked_at && (!was.checked_at || l.checked_at > was.checked_at)) was.checked_at = l.checked_at; }
  }

  const drawn = [...rings.filter((r) => r.draws).map((r) => ({ mm: { points: [], lines: r.mm.polys.flat(), polys: [] }, fill: false })),
    ...layers.filter((l) => l.draws).map((l) => ({ mm: l.mm, fill: !l.surrounds }))];
  const arrow = arrowCorner(frame, { site: siteMm, drawn });

  const interval = tickInterval(scale);
  const ticks = {
    interval,
    e: range(Math.ceil(ground.e0 / interval) * interval, ground.e1, interval).map((e) => ({ v: e, x: toMm([e, ground.n0])[0] })),
    n: range(Math.ceil(ground.n0 / interval) * interval, ground.n1, interval).map((n) => ({ v: n, y: toMm([ground.e0, n])[1] })),
  };

  // The locator: the country in the same grid, fitted to the panel's box, with the frame drawn on it.
  let locator = null;
  if (inputs.locator?.geometry) {
    const s = projectGeometry(inputs.locator.geometry, fwd);
    const b = boundsOf([s]);
    locator = { shape: s, bounds: b, frameGround: ground };
  }

  return { paper, frame, scale, ground, site: siteMm, rings, layers, legend, arrow, ticks, locator,
    scale_bar_m: scaleBarLength(scale), title: inputs.title || "", subtitle: inputs.subtitle || "", pc: inputs.pc || null,
    sources: [...src.values()].sort((a, b) => a.dataset.localeCompare(b.dataset)), small: inputs.small || [], wide_scale: WIDE_SCALES.includes(scale), notes: inputs.notes || [] };
}
const range = (from, to, step) => { const out = []; for (let v = from; v <= to + 1e-6; v += step) out.push(v); return out; };

// ---- SVG ------------------------------------------------------------------------------------------------------------

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f2 = (v) => (Math.round(v * 100) / 100).toString();
const ringD = (r) => `M${r.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}Z`;
const lineD = (l) => `M${l.map(([x, y]) => `${f2(x)} ${f2(y)}`).join("L")}`;
const polysD = (polys) => polys.map((p) => p.map(ringD).join("")).join("");

// Wraps text to a width in millimetres. An estimate (no DOM to measure with): an average sans-serif letter is about
// half the font size wide. Good enough for a panel with room to spare; the sheet page checks the real sizes.
export function wrap(text, widthMm, sizeMm) {
  const max = Math.max(8, Math.floor(widthMm / (sizeMm * 0.5)));
  const words = String(text).split(/\s+/).filter(Boolean), lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > max) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines;
}

function textBlock(x, y, lines, size, { weight = 400, fill = INK, lead = 1.3 } = {}) {
  return lines.map((t, i) => `<text x="${f2(x)}" y="${f2(y + i * size * lead)}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(t)}</text>`).join("");
}

function northArrow(b) {
  const cx = b.x + b.w / 2, top = b.y + 7, base = b.y + b.h - 1, half = 3.2;
  // Split down its length: left half black, right half white, black outline; N above. No halo, no circle.
  return `<g class="north-arrow" stroke="#000" stroke-width="0.35" stroke-linejoin="round">`
    + `<path d="M${f2(cx)} ${f2(top)}L${f2(cx - half)} ${f2(base)}L${f2(cx)} ${f2(base - 3)}Z" fill="#000"/>`
    + `<path d="M${f2(cx)} ${f2(top)}L${f2(cx + half)} ${f2(base)}L${f2(cx)} ${f2(base - 3)}Z" fill="#fff"/>`
    + `</g><text x="${f2(cx)}" y="${f2(b.y + 5)}" font-size="4.2" font-weight="700" text-anchor="middle" fill="#000">N</text>`;
}

function scaleBar(x, y, lengthM, scale) {
  const w = lengthM * 1000 / scale, seg = w / 4, h = 1.6;
  const parts = [0, 1, 2, 3].map((i) => `<rect x="${f2(x + i * seg)}" y="${f2(y)}" width="${f2(seg)}" height="${h}" fill="${i % 2 ? "#fff" : "#000"}"/>`).join("");
  return `<g class="scale-bar">${parts}<rect x="${f2(x)}" y="${f2(y)}" width="${f2(w)}" height="${h}" fill="none" stroke="#000" stroke-width="0.3"/>`
    + `<text x="${f2(x)}" y="${f2(y + h + 3)}" font-size="2.4" fill="${INK}">0</text>`
    + `<text x="${f2(x + w)}" y="${f2(y + h + 3)}" font-size="2.4" text-anchor="end" fill="${INK}">${esc(lengthText(lengthM))}</text></g>`;
}

function legendPatch(e, x, y) {
  if (e.kind === "site") return `<rect x="${x}" y="${y}" width="7" height="4" fill="${SITE_COLOUR}" fill-opacity="0.12" stroke="#fff" stroke-width="1.1"/><rect x="${x}" y="${y}" width="7" height="4" fill="none" stroke="${SITE_COLOUR}" stroke-width="0.6"/>`;
  if (e.kind === "band") return `<line x1="${x}" y1="${y + 2}" x2="${x + 7}" y2="${y + 2}" stroke="${INK}" stroke-opacity="0.55" stroke-width="0.3" stroke-dasharray="1 0.8"/>`;
  if (e.kind === "line") return `<line x1="${x}" y1="${y + 2}" x2="${x + 7}" y2="${y + 2}" stroke="${e.colour}" stroke-width="0.6"/>`;
  if (e.kind === "point") return `<circle cx="${x + 3.5}" cy="${y + 2}" r="1.3" fill="${e.colour}" stroke="#fff" stroke-width="0.35"/>`;
  return `<rect x="${x}" y="${y}" width="7" height="4" fill="${e.colour}" fill-opacity="0.2" stroke="${e.colour}" stroke-width="0.4"/>`;
}

// basemap: { href (an image of the frame, already in the run's grid), attribution } or null (a plain ground).
export function sheetSvg(plan, { basemap = null } = {}) {
  const { frame: F, paper } = plan, P = PAPER[paper];
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${P.w} ${P.h}" width="${P.w}mm" height="${P.h}mm" font-family="'Public Sans', system-ui, sans-serif">`);
  out.push(`<rect width="${P.w}" height="${P.h}" fill="#fff"/>`);
  out.push(`<defs><clipPath id="frame"><rect x="${F.x}" y="${F.y}" width="${f2(F.w)}" height="${f2(F.h)}"/></clipPath></defs>`);
  // The map face.
  out.push(`<g clip-path="url(#frame)">`);
  out.push(basemap?.href
    ? `<image href="${esc(basemap.href)}" x="${F.x}" y="${F.y}" width="${f2(F.w)}" height="${f2(F.h)}" preserveAspectRatio="none"/>`
    : `<rect x="${F.x}" y="${F.y}" width="${f2(F.w)}" height="${f2(F.h)}" fill="#f4f5f3"/>`);
  for (const r of plan.rings.filter((x) => x.draws)) out.push(`<path d="${polysD(r.mm.polys)}" fill="none" stroke="${INK}" stroke-opacity="0.55" stroke-width="0.3" stroke-dasharray="1.6 1.2"/>`);
  for (const l of plan.layers.filter((x) => x.draws)) {
    if (l.mm.polys.length) out.push(`<path d="${polysD(l.mm.polys)}" fill="${l.colour}" fill-opacity="${l.surrounds ? 0.03 : 0.16}" fill-rule="evenodd" stroke="${l.colour}" stroke-width="0.45"/>`);
    for (const ln of l.mm.lines) out.push(`<path d="${lineD(ln)}" fill="none" stroke="${l.colour}" stroke-width="0.6"/>`);
    for (const [x, y] of l.mm.points) out.push(`<circle cx="${f2(x)}" cy="${f2(y)}" r="1.3" fill="${l.colour}" stroke="#fff" stroke-width="0.35"/>`);
  }
  // The site: a red line with a white casing, a faint fill; red is the site's alone.
  const sd = polysD(plan.site.polys);
  if (sd) out.push(`<path d="${sd}" fill="${SITE_COLOUR}" fill-opacity="0.08" fill-rule="evenodd" stroke="#fff" stroke-width="1.3"/><path d="${sd}" fill="none" stroke="${SITE_COLOUR}" stroke-width="0.6"/>`);
  for (const ln of plan.site.lines) out.push(`<path d="${lineD(ln)}" fill="none" stroke="#fff" stroke-width="1.3"/><path d="${lineD(ln)}" fill="none" stroke="${SITE_COLOUR}" stroke-width="0.6"/>`);
  for (const [x, y] of plan.site.points) out.push(`<circle cx="${f2(x)}" cy="${f2(y)}" r="1.6" fill="${SITE_COLOUR}" stroke="#fff" stroke-width="0.6"/>`);
  // Band labels, at the top of each ring that draws.
  for (const r of plan.rings.filter((x) => x.draws)) {
    const pts = r.mm.polys.flatMap((p) => p[0]).filter((p) => inBox(p, { x: F.x + 4, y: F.y + 4, w: F.w - 8, h: F.h - 8 }));
    if (!pts.length) continue;
    const [x, y] = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
    out.push(`<text x="${f2(x)}" y="${f2(y - 0.8)}" font-size="2.4" text-anchor="middle" fill="${INK}" stroke="#fff" stroke-width="0.6" paint-order="stroke">${esc(lengthText(r.km * 1000))}</text>`);
  }
  out.push(northArrow(plan.arrow.box));
  out.push(`</g>`);

  // Ticks outside the frame: left, bottom and top; labels in full metres on the left and bottom, units at the corner.
  const T = [], tk = 1.8;
  plan.ticks.e.forEach((t, i) => {
    T.push(`<line x1="${f2(t.x)}" y1="${f2(F.y + F.h)}" x2="${f2(t.x)}" y2="${f2(F.y + F.h + tk)}"/><line x1="${f2(t.x)}" y1="${F.y}" x2="${f2(t.x)}" y2="${f2(F.y - tk)}"/>`);
    T.push(`<text x="${f2(t.x)}" y="${f2(F.y + F.h + tk + 3)}" font-size="2.3" text-anchor="middle" stroke="none" fill="${INK}">${groupMetres(t.v)}${i === 0 ? " mE" : ""}</text>`);
  });
  plan.ticks.n.forEach((t, i) => {
    T.push(`<line x1="${F.x}" y1="${f2(t.y)}" x2="${f2(F.x - tk)}" y2="${f2(t.y)}"/>`);
    T.push(`<text x="${f2(F.x - tk - 0.8)}" y="${f2(t.y + 0.8)}" font-size="2.3" text-anchor="end" stroke="none" fill="${INK}">${groupMetres(t.v)}${i === 0 ? " mN" : ""}</text>`);
  });
  out.push(`<g class="ticks" stroke="${INK}" stroke-width="0.25">${T.join("")}</g>`);

  // The panel, flush with the map: one outer border round both.
  const px = F.x + F.w, pw = PANEL_MM, pad = 5, inner = pw - 2 * pad;
  out.push(`<rect x="${F.x}" y="${F.y}" width="${f2(F.w + pw)}" height="${f2(F.h)}" fill="none" stroke="${INK}" stroke-width="0.4"/>`);
  out.push(`<line x1="${f2(px)}" y1="${F.y}" x2="${f2(px)}" y2="${f2(F.y + F.h)}" stroke="${INK}" stroke-width="0.4"/>`);
  let y = F.y + pad + 5;
  const title = wrap(plan.title, inner, 5.2);
  out.push(textBlock(px + pad, y, title, 5.2, { weight: 700 })); y += title.length * 5.2 * 1.25 + 1;
  const sub = wrap(plan.subtitle, inner, 2.8);
  out.push(textBlock(px + pad, y, sub, 2.8)); y += sub.length * 2.8 * 1.3 + 4;

  out.push(`<text x="${f2(px + pad)}" y="${f2(y)}" font-size="2.6" font-weight="700" fill="${INK}">Legend</text>`); y += 4;
  for (const e of plan.legend) {
    const lines = wrap(e.topic ? `${e.label} (${e.topic})` : e.label, inner - 10, 2.5);
    out.push(legendPatch(e, px + pad, y - 3)); out.push(textBlock(px + pad + 10, y, lines, 2.5));
    y += Math.max(1, lines.length) * 2.5 * 1.3 + 1.6;
  }
  y += 2;

  // The locator, filling the panel's width (height capped).
  if (plan.locator) {
    const L = plan.locator, b = L.bounds, boxH = Math.min(46, Math.max(20, F.y + F.h - y - 95));
    const k = Math.min(inner / (b.x1 - b.x0), boxH / (b.y1 - b.y0));
    const lx = px + pad + (inner - (b.x1 - b.x0) * k) / 2, ly = y;
    const t = ([e, n]) => [lx + (e - b.x0) * k, ly + (b.y1 - n) * k];
    const d = L.shape.polys.map((p) => p.map((r) => ringD(thin(r.map(t), 0.25))).join("")).join("");
    out.push(`<g class="locator"><path d="${d}" fill="#eceee9" stroke="#8a9599" stroke-width="0.2" fill-rule="evenodd"/>`);
    const [ax, ay] = t([L.frameGround.e0, L.frameGround.n1]), [bx, by] = t([L.frameGround.e1, L.frameGround.n0]);
    const fw = Math.max(bx - ax, 1.2), fh = Math.max(by - ay, 1.2);
    out.push(`<rect x="${f2(ax + (bx - ax - fw) / 2)}" y="${f2(ay + (by - ay - fh) / 2)}" width="${f2(fw)}" height="${f2(fh)}" fill="none" stroke="${SITE_COLOUR}" stroke-width="0.5"/></g>`);
    y += (b.y1 - b.y0) * k + 5;
  }

  // Sources, then (from the bottom up) small print, the disclaimer, the coordinate statement and the scale bar.
  out.push(`<text x="${f2(px + pad)}" y="${f2(y)}" font-size="2.6" font-weight="700" fill="${INK}">Sources</text>`); y += 3.6;
  const srcLines = [...plan.sources.map((s) => `${s.dataset}${s.publisher ? `, ${s.publisher}` : ""}; ${s.licence && !/^unknown$/i.test(s.licence) ? s.licence : "licence not stated"}${s.checked_at ? `; queried ${String(s.checked_at).slice(0, 10)}` : ""}.`),
    basemap?.attribution ? `Basemap: ${basemap.attribution}` : "Basemap not drawn" + (basemap?.missing ? `: ${basemap.missing}` : ".")];
  const bottomStart = F.y + F.h - pad - 62;
  for (const s of srcLines) {
    const lines = wrap(s, inner, 2.2);
    if (y + lines.length * 2.2 * 1.3 > bottomStart) { out.push(textBlock(px + pad, y, ["… more in the report's sources."], 2.2)); y += 3; break; }
    out.push(textBlock(px + pad, y, lines, 2.2)); y += lines.length * 2.2 * 1.3 + 0.8;
  }

  let by = bottomStart + 4;
  out.push(scaleBar(px + pad, by, plan.scale_bar_m, plan.scale)); by += 8.5;
  out.push(`<text x="${f2(px + pad)}" y="${f2(by)}" font-size="2.8" font-weight="700" fill="${INK}">${esc(scaleText(plan.scale, paper))}</text>`); by += 4.2;
  const coord = wrap(`${plan.pc ? presentationLine(plan.pc) : "Coordinate system not recorded."} Ticks every ${lengthText(plan.ticks.interval)}.`, inner, 2.3);
  out.push(textBlock(px + pad, by, coord, 2.3)); by += coord.length * 2.3 * 1.3 + 2;
  const notes = plan.notes.flatMap((n) => wrap(n, inner, 2.1));
  if (notes.length) { out.push(textBlock(px + pad, by, notes, 2.1, { weight: 600 })); by += notes.length * 2.1 * 1.3 + 1.5; }
  const disc = wrap(SHEET_DISCLAIMER, inner, 2.1);
  out.push(textBlock(px + pad, by, disc, 2.1, { fill: "#4a5a62" })); by += disc.length * 2.1 * 1.3 + 1.5;
  const small = plan.small.flatMap((s) => wrap(s, inner, 2.1));
  out.push(textBlock(px + pad, by, small, 2.1, { fill: "#4a5a62" }));
  out.push(`</svg>`);
  return out.join("");
}
// Drops points closer than tol mm to the last kept one (the locator only).
function thin(r, tol) { const out = [r[0]]; for (const p of r.slice(1)) { const q = out.at(-1); if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= tol) out.push(p); } return out.length > 3 ? out : r; }

// ---- from a run record ----------------------------------------------------------------------------------------------

export const SHEET_KINDS = ["site", "around", "topic"];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");

// kind: "site" (map 1, the site fills the frame), "around" (map 2, the site grown by the furthest finding), "topic"
// (one topic's findings; topic = its id). printed: the date the sheet is made (ISO).
export function sheetInputs(record, { kind = "around", topic = null, printed = new Date().toISOString(), locator = null } = {}) {
  const r = record.tobler_run, s = r.site || {};
  const site = record.features.find((f) => f.properties.role === "site");
  const all = record.features.filter((f) => f.properties.role === "evidence");
  const furthestOf = (fs) => Math.max(0, ...fs.map((f) => f.properties.distance_km ?? 0).filter(Number.isFinite));
  const furthestReach = r.reach?.furthest_km ?? r.fetched_to_km ?? 50;
  const t = topic ? topicOf(topic) : null;
  const evidence = kind === "topic" ? all.filter((f) => topicOf(f.properties.theme) === t)  : all;
  const extent_km = kind === "site" ? 0 : Math.min(furthestOf(evidence) || (kind === "around" ? Math.min(furthestReach, 1) : 0.5), furthestReach);
  const rings = (r.reach?.ladder || []).filter((v) => v <= extent_km * 1.5 + 1e-9);
  const place = s.name || "The site";
  const what = kind === "site" ? "on the site" : kind === "around" ? "around the site" : topicInfo(t).label.toLowerCase();
  const assetWord = s.asset_label && !s.asset_assumed ? ` ${s.asset_label}` : "";
  const notes = [];
  if (kind === "topic" && !evidence.length) notes.push(`Nothing from this topic's checks is in this run's shared shapes.`);
  const skill = typeof r.skill === "string" ? r.skill : `${r.skill?.name || "ntr-screening"}${r.skill?.version ? ` ${r.skill.version}` : ""}`;
  return {
    site, evidence, rings_km: rings, extent_km, pc: r.presentation_crs || null, locator,
    title: `${place}${assetWord}: ${what}`,
    subtitle: [s.asset_label ? `${cap(s.asset_label)}${s.asset_assumed ? " (assumed)" : ""}` : null, s.area_km2 ? `${fmtArea(s.area_km2)}` : null, r.finished_at ? `screened ${String(r.finished_at).slice(0, 10)}` : null].filter(Boolean).join(" · "),
    notes,
    small: [`Run ${r.id || "not recorded"} · skill ${skill} · cartography 0.6 · printed ${printed.slice(0, 10)} · A3 · asktobler.com`],
  };
}
const fmtArea = (km2) => (km2 >= 1 ? `${km2.toLocaleString("en-GB", { maximumFractionDigits: 1 })} km²` : `${(km2 * 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })} ha`);
