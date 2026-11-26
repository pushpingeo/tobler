// How a feature sits against the site (package B, 26 Nov): a tool, deterministic and generic, no judgement.
//
//   within    wholly on the site (a point on the site's edge counts as on it)
//   crosses   partly on the site: it crosses the edge, or one of its parts is on the site and another isn't
//   covers    the site lies wholly inside it (a zone, a wide designation)
//   adjacent  off the site, within 50 m of its edge (Rob, 26 Nov: the same for every check), touching included
//   outside   off the site, further than that, with its distance
//
// With the overlap: for an area, how much of the site it covers (km² and share of the site's own area, holes taken
// off) and how much of it is on the site; for a line, its length inside; for a multi-part feature, how many parts
// are on the site. And the zone answer: for a check that asks "is the site inside a published zone?", which zones
// the site touches and how much of the site each covers, and all of them together.
//
// How it measures (invariant 2): distances are geodesic (js/nearness.js, via geometryDistanceKm); overlays and areas
// are worked out in a Lambert azimuthal equal-area plane centred on the site (js/siterole.js laea), so areas are true.
// Lengths inside are geodesic: each segment's true length times the share of it that lies inside, found in the plane.
// The edge work runs only for features that touch the site; everything else is a distance. No DOM.
import * as turf from "./vendor/turf.js";
import { laea } from "./siterole.js";
import { planarKm2 } from "./areabudget.js";
import { geometryDistanceKm } from "./datatools.js";

export const ADJACENT_KM = 0.05;
export const RELATIONS = ["within", "crosses", "covers", "adjacent", "outside"];

const SLIVER_KM2 = 1e-6; // 1 m²: an overlap smaller than this is a touch, not a crossing
const ON_EDGE_KM = 1e-6; // 1 mm
const F = (geometry) => ({ type: "Feature", properties: {}, geometry });
const geomOf = (x) => (x?.type === "Feature" ? x.geometry : x);
const walk = (g, f) => {
  const w = (c) => (typeof c[0] === "number" ? f(c) : c.map(w));
  return { type: g.type, coordinates: w(g.coordinates) };
};
const isArea = (g) => /Polygon/.test(g?.type || "");
const r6 = (v) => Math.round(v * 1e6) / 1e6;

// The site, prepared once per geometry object: its plane, its projected outline, its area and its edges.
const cache = new WeakMap();
function prepareSite(g) {
  let s = cache.get(g);
  if (s) return s;
  const centre = turf.centroid(F(g)).geometry.coordinates;
  const P = laea(centre);
  const S = walk(g, P);
  const km2 = planarKm2(S);
  if (!(km2 > 0)) throw new Error("The site outline has no area.");
  const rings = (S.type === "Polygon" ? [S.coordinates] : S.coordinates).flat();
  const edges = [];
  for (const r of rings) for (let i = 0; i < r.length - 1; i++) {
    const [a, b] = [r[i], r[i + 1]];
    edges.push([a[0], a[1], b[0], b[1], Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
  }
  s = { g, P, S, km2, edges, box: turf.bbox(F(S)) };
  cache.set(g, s);
  return s;
}

// Inside the projected site, even-odd over every ring, so a point in a hole is outside.
function insidePlane(s, x, y) {
  let c = 0;
  for (const e of s.edges) if ((e[1] > y) !== (e[3] > y) && x < ((e[2] - e[0]) * (y - e[1])) / (e[3] - e[1]) + e[0]) c++;
  return c % 2 === 1;
}

// Where along segment a→b (0..1) it crosses the site's edges.
function crossingsOn(s, a, b) {
  const ts = [];
  const x0 = Math.min(a[0], b[0]), y0 = Math.min(a[1], b[1]), x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const e of s.edges) {
    if (e[6] < x0 || e[4] > x1 || e[7] < y0 || e[5] > y1) continue;
    const ex = e[2] - e[0], ey = e[3] - e[1];
    const d = dx * ey - dy * ex;
    if (Math.abs(d) < 1e-15) continue; // parallel: a line along the edge is judged by the midpoints either side
    const t = ((e[0] - a[0]) * ey - (e[1] - a[1]) * ex) / d;
    const u = ((e[0] - a[0]) * dy - (e[1] - a[1]) * dx) / d;
    if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
  }
  return ts;
}

// A line's length (km, geodesic) and how much of it is on the site.
function lineInside(s, coords) {
  let total = 0, inside = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const p = coords[i], q = coords[i + 1];
    const len = turf.distance(p, q, { units: "kilometers" });
    total += len;
    if (!(len > 0)) continue;
    const a = s.P(p), b = s.P(q);
    const ts = [0, ...crossingsOn(s, a, b).sort((x, y) => x - y), 1];
    for (let k = 0; k < ts.length - 1; k++) {
      const m = (ts[k] + ts[k + 1]) / 2;
      if (ts[k + 1] - ts[k] > 0 && insidePlane(s, a[0] + m * (b[0] - a[0]), a[1] + m * (b[1] - a[1]))) inside += len * (ts[k + 1] - ts[k]);
    }
  }
  return { total, inside };
}

// A projected (Multi)Polygon clipped to a box, ring by ring (Sutherland–Hodgman). A concave ring can come back
// with zero-width runs along the box's sides; the overlay below treats them as nothing, and areas are unaffected.
function clipRing(ring, [x0, y0, x1, y1]) {
  let pts = ring.slice(0, -1);
  const sides = [[(p) => p[0] >= x0, (a, b) => [x0, a[1] + ((b[1] - a[1]) * (x0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + ((b[1] - a[1]) * (x1 - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= y0, (a, b) => [a[0] + ((b[0] - a[0]) * (y0 - a[1])) / (b[1] - a[1]), y0]],
    [(p) => p[1] <= y1, (a, b) => [a[0] + ((b[0] - a[0]) * (y1 - a[1])) / (b[1] - a[1]), y1]]];
  for (const [inside, cut] of sides) {
    if (!pts.length) break;
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length], b = pts[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    pts = out;
  }
  return pts.length >= 3 ? [...pts, pts[0]] : null;
}
function clipToBox(g, box) {
  const polys = (g.type === "Polygon" ? [g.coordinates] : g.coordinates)
    .map((p) => { const outer = clipRing(p[0], box); return outer ? [outer, ...p.slice(1).map((r) => clipRing(r, box)).filter(Boolean)] : null; })
    .filter((p) => p && planarKm2({ type: "Polygon", coordinates: p }) > 0);
  return !polys.length ? null : polys.length === 1 ? { type: "Polygon", coordinates: polys[0] } : { type: "MultiPolygon", coordinates: polys };
}

// The overlap of a projected area with the site. The site is first trimmed to the area's box, a little wider (the
// overlap can't lie outside it), so a detailed outline costs only its edges near the feature: on a 4,688-vertex site
// the overlay took about 60 ms a feature untrimmed. The trim narrows only; the overlay itself is exact.
function cutWith(s, polyPlane) {
  const [w, so, e, n] = turf.bbox(F(polyPlane));
  const pad = Math.max(e - w, n - so, 1e-3) * 0.01;
  const [sw, ss, se, sn] = s.box;
  let site = s.S;
  if (w - pad > sw || so - pad > ss || e + pad < se || n + pad < sn) {
    site = clipToBox(s.S, [w - pad, so - pad, e + pad, n + pad]);
    if (!site) return null;
  }
  const cut = turf.intersect(turf.featureCollection([F(site), F(polyPlane)]));
  return cut ? cut.geometry : null;
}
const intersectKm2 = (s, polyPlane) => {
  try { const g = cutWith(s, polyPlane); return g ? planarKm2(g) : 0; } catch { return null; }
};

// The parts of a geometry, each a geometry of its own.
const partsOf = (g) => {
  if (g.type === "MultiPolygon") return g.coordinates.map((c) => ({ type: "Polygon", coordinates: c }));
  if (g.type === "MultiLineString") return g.coordinates.map((c) => ({ type: "LineString", coordinates: c }));
  if (g.type === "MultiPoint") return g.coordinates.map((c) => ({ type: "Point", coordinates: c }));
  return [g];
};

const offSite = (base, km, adjacentKm) => ({ ...base, relation: km <= adjacentKm ? "adjacent" : "outside", distance_km: r6(km) });

// site: a (Multi)Polygon geometry or feature in WGS84. feature: any point, line or area geometry or feature.
// Returns { relation, distance_km, site_km2, ... } (see the top of the file), or null for a shape it can't read.
export function relationOf(site, feature, { adjacentKm = ADJACENT_KM } = {}) {
  const sg = geomOf(site);
  if (!isArea(sg)) throw new Error("How a feature sits against the site needs the site's outline: a point or a line has no inside.");
  const g = geomOf(feature);
  if (!g?.coordinates || !/^(Multi)?(Point|LineString|Polygon)$/.test(g.type)) return null;
  const s = prepareSite(sg);
  const base = { site_km2: r6(s.km2) };
  const multi = /^Multi/.test(g.type);
  const parts = partsOf(g);
  if (multi) base.parts = parts.length;
  const km = geometryDistanceKm(sg, g);
  if (km == null) return null;
  if (km > 0) return offSite({ ...base, ...(multi ? { parts_on_site: 0 } : {}) }, km, adjacentKm);

  // It touches the site: how much of it is on the site.
  if (/Point/.test(g.type)) {
    const on = parts.filter((p) => { const d = geometryDistanceKm(sg, p); return d != null && d <= ON_EDGE_KM; }).length;
    const out = { ...base, distance_km: 0, ...(multi ? { parts_on_site: on } : {}) };
    return { ...out, relation: on === parts.length ? "within" : "crosses" };
  }
  if (/LineString/.test(g.type)) {
    let total = 0, inside = 0, on = 0;
    for (const p of parts) { const l = lineInside(s, p.coordinates); total += l.total; inside += l.inside; if (l.inside > ON_EDGE_KM) on++; }
    // Touching the edge with nothing inside (a line ending on the boundary, or running along it): adjacent at 0 m.
    if (!(inside > ON_EDGE_KM)) return offSite({ ...base, length_km: r6(total), length_inside_km: 0, line_share: 0, ...(multi ? { parts_on_site: 0 } : {}) }, 0, adjacentKm);
    const share = total > 0 ? Math.min(1, inside / total) : 0;
    const out = { ...base, distance_km: 0, length_km: r6(total), length_inside_km: r6(inside), line_share: r6(share), ...(multi ? { parts_on_site: on } : {}) };
    return { ...out, relation: share >= 1 - 1e-6 ? "within" : "crosses" };
  }
  // An area: overlaid in the site's plane.
  let featKm2 = 0, overlap = 0, on = 0;
  for (const p of parts) {
    const pp = walk(p, s.P);
    featKm2 += planarKm2(pp);
    const o = intersectKm2(s, pp);
    if (o == null) return null;
    overlap += o;
    if (o > SLIVER_KM2) on++;
  }
  if (!(overlap > SLIVER_KM2)) return offSite({ ...base, overlap_km2: 0, site_share: 0, feature_share: 0, ...(multi ? { parts_on_site: 0 } : {}) }, 0, adjacentKm);
  const siteShare = Math.min(1, overlap / s.km2), featShare = featKm2 > 0 ? Math.min(1, overlap / featKm2) : 0;
  const tol = (a) => Math.max(SLIVER_KM2, a * 1e-6);
  const relation = featKm2 - overlap <= tol(featKm2) ? "within" : s.km2 - overlap <= tol(s.km2) ? "covers" : "crosses";
  return { ...base, relation, distance_km: 0, overlap_km2: r6(overlap), site_share: r6(siteShare), feature_share: r6(featShare), ...(multi ? { parts_on_site: on } : {}) };
}

// The zone answer. zones: [{ id, name, geometry }]. Points and lines aren't zones and are only counted.
// Returns { inside, wholly, site_share (all the zones together, each piece counted once), zones (those touching the
// site, largest share first, each with its relation, overlap and share), nearest (the nearest zone off the site, with
// its distance, or null), not_areas }.
export function zonesAtSite(site, zones = []) {
  const sg = geomOf(site);
  if (!isArea(sg)) throw new Error("The zone answer needs the site's outline: a point or a line has no inside.");
  const s = prepareSite(sg);
  const touching = [], cuts = [];
  let nearest = null, notAreas = 0;
  for (const z of zones) {
    const g = geomOf(z.geometry);
    if (!isArea(g)) { notAreas++; continue; }
    const r = relationOf(sg, g);
    if (!r) continue;
    const label = { ...(z.id != null ? { id: z.id } : {}), ...(z.name ? { name: z.name } : {}) };
    if (r.relation === "adjacent" || r.relation === "outside") {
      if (!nearest || r.distance_km < nearest.distance_km) nearest = { ...label, relation: r.relation, distance_km: r.distance_km };
      continue;
    }
    touching.push({ ...label, relation: r.relation, overlap_km2: r.overlap_km2, site_share: r.site_share });
    try { const cut = cutWith(s, walk(g, s.P)); if (cut) cuts.push(F(cut)); } catch { /* measured singly above */ }
  }
  let together = 0;
  if (cuts.length === 1) together = planarKm2(cuts[0].geometry);
  else if (cuts.length > 1) {
    try { together = planarKm2(turf.union(turf.featureCollection(cuts))?.geometry); }
    catch { together = Math.max(...touching.map((t) => t.overlap_km2)); } // a union that won't compute: at least the largest
  }
  const share = Math.min(1, together / s.km2);
  touching.sort((a, b) => b.site_share - a.site_share);
  return { inside: touching.length > 0, wholly: touching.length > 0 && s.km2 - together <= Math.max(SLIVER_KM2, s.km2 * 1e-6), site_share: r6(share),
    site_km2: r6(s.km2), zones: touching, nearest, not_areas: notAreas };
}

// ---- for the places that measure features (fetch_features, the OpenStreetMap checks, the offer) ----------------

const KEEP = ["site_share", "length_inside_km", "parts", "parts_on_site"];
// The relations that put a feature on the site. Adjacent, touching included, isn't on it (Rob, 26 Nov).
export const ON_SITE = new Set(["within", "crosses", "covers"]);
// Just the relation fields of a feature, to copy onto another record (a check's nearest, a card row, the map).
export const relationPart = (f = {}) => Object.fromEntries(["relation", ...KEEP].filter((k) => f[k] != null).map((k) => [k, f[k]]));
export const isOnSite = (f) => (f?.relation ? ON_SITE.has(f.relation) : f?.distance_km != null && !(f.distance_km > 0));

// The fields a measured feature carries: relation, and the overlap that goes with it. distKm is the distance the
// caller has already measured, so a feature off the site costs nothing more. {} when the site has no outline (a point:
// its run measures from the point), or when the shape can't be read.
export function relationFields(site, geometry, distKm = null) {
  const sg = geomOf(site);
  if (!isArea(sg) || !geometry) return {};
  if (distKm != null && distKm > ADJACENT_KM) return { relation: "outside" };
  if (distKm != null && distKm > 0) return { relation: "adjacent" };
  let r;
  try { r = relationOf(sg, geometry); } catch { return {}; }
  if (!r) return {};
  return Object.fromEntries([["relation", r.relation], ...KEEP.filter((k) => r[k] != null && !(k === "site_share" && !r.site_share) && !(k === "length_inside_km" && !r.length_inside_km)).map((k) => [k, r[k]])]);
}

// One thing in several pieces (a road, a river, patches of homes): its relation as a whole. Pieces of one kind are
// measured together as one multi-part shape; mixed kinds fall back to the pieces one by one.
export function relationFieldsAll(site, geometries, distKm = null) {
  const gs = geometries.filter((g) => g?.coordinates);
  if (gs.length <= 1) return relationFields(site, gs[0], distKm);
  const fam = (g) => g.type.replace(/^Multi/, "");
  const kinds = new Set(gs.map(fam));
  if (kinds.size === 1) {
    const k = [...kinds][0];
    const coords = gs.flatMap((g) => (/^Multi/.test(g.type) ? g.coordinates : [g.coordinates]));
    const out = relationFields(site, { type: `Multi${k}`, coordinates: coords }, distKm);
    // Pieces of one thing aren't "parts" to the person: say how much is on the site, not how many pieces.
    delete out.parts; delete out.parts_on_site;
    return out;
  }
  const each = gs.map((g) => relationFields(site, g));
  const on = each.filter((x) => ON_SITE.has(x.relation));
  if (!on.length) return each.some((x) => x.relation === "adjacent") ? { relation: "adjacent" } : each[0] || {};
  return { relation: on.length === each.length && on.every((x) => x.relation === "within") ? "within" : "crosses" };
}

// Where a feature is, in a few words, for the card, the map, the report and the replies. dist formats a distance in
// the person's units. Null for a feature off the site and not next to it: the caller writes its distance as usual.
const pct = (v) => (v >= 0.995 ? "all" : v >= 0.01 ? `${Math.round(v * 100)}%` : "under 1%");
export function whereWords(f, dist = (km) => `${Math.round(km * 1000)} m`) {
  switch (f?.relation) {
    case "within": return "on site";
    case "covers": return "the site lies within it";
    case "crosses": {
      const partly = f.parts > 1 && f.parts_on_site != null ? `partly on site (${f.parts_on_site} of ${f.parts} parts)` : "crosses the site's edge";
      if (f.site_share) return `${partly}, ${pct(f.site_share)} of the site`;
      if (f.length_inside_km) return `${partly}, ${dist(f.length_inside_km)} of it on site`;
      return partly;
    }
    case "adjacent": return f.distance_km > 0 ? `next to the site, ${dist(f.distance_km)}` : "next to the site (touching its edge)";
    default: return null;
  }
}
