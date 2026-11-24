// The area budget (developable area): the site's gross area, what each deduction takes off it, and what's left.
// A tool: deterministic and generic, no judgement. Which deductions apply, their buffers and why are the skill's
// (skills/developable-area/SKILL.md); this only does the geometry. No DOM, so it runs in the page and the tests.
//
// How it measures (invariant 2): features are buffered geodesically (turf), then everything is projected into a
// Lambert azimuthal equal-area projection centred on the site, where the overlays and areas are worked out. Each
// deduction takes only what's still left, so ground under two constraints is counted once, against the first.
// Soft constraints aren't taken off: they're measured on what's left, each counted once, against the first.
// The remaining shape comes back as WGS84. The model only ever sees names, hectares and shares (invariant 3).
import * as turf from "./vendor/turf.js";
import { laea } from "./siterole.js";

const RE = 6371.0088;
const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;

// The inverse of siterole.js laea: projected km back to longitude and latitude.
export function laeaInverse([lon0, lat0]) {
  const p0 = rad(lat0);
  return ([x, y]) => {
    const rho = Math.hypot(x, y);
    if (rho < 1e-12) return [lon0, lat0];
    const c = 2 * Math.asin(Math.min(1, rho / (2 * RE)));
    const lat = Math.asin(Math.cos(c) * Math.sin(p0) + (y * Math.sin(c) * Math.cos(p0)) / rho);
    const lon = rad(lon0) + Math.atan2(x * Math.sin(c), rho * Math.cos(p0) * Math.cos(c) - y * Math.sin(p0) * Math.sin(c));
    return [((deg(lon) + 540) % 360) - 180, deg(lat)];
  };
}

const walk = (g, f) => {
  const w = (c) => (typeof c[0] === "number" ? f(c) : c.map(w));
  return { type: g.type, coordinates: w(g.coordinates) };
};
const F = (geometry) => ({ type: "Feature", properties: {}, geometry });
const polys = (g) => (!g ? [] : g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : []);
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
// Planar km² of projected (Multi)Polygon coordinates, holes subtracted.
export function planarKm2(g) {
  return polys(g).reduce((s, p) => s + Math.abs(ringArea(p[0])) - p.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
}
const isArea = (g) => /Polygon/.test(g?.type || "");
// Polygon pieces too small to matter (under 1 m²) are dropped from the shapes, never from the sums.
const SLIVER_KM2 = 1e-6;
const tidy = (g) => {
  if (!g) return null;
  const kept = polys(g).filter((p) => planarKm2({ type: "Polygon", coordinates: p }) > SLIVER_KM2);
  return !kept.length ? null : kept.length === 1 ? { type: "Polygon", coordinates: kept[0] } : { type: "MultiPolygon", coordinates: kept };
};
const op = (fn, a, b) => {
  if (!a || !b) return fn === "difference" ? a : null;
  const r = turf[fn](turf.featureCollection([F(a), F(b)]));
  return tidy(r?.geometry || null);
};
const unionAll = (list) => {
  const gs = list.filter(Boolean);
  if (!gs.length) return null;
  if (gs.length === 1) return tidy(gs[0]);
  return tidy(turf.union(turf.featureCollection(gs.map(F)))?.geometry || null);
};
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const roundGeom = (g) => (g ? walk(g, ([x, y]) => [Math.round(x * 1e7) / 1e7, Math.round(y * 1e7) / 1e7]) : null);

// One deduction's zone, projected: each feature clipped to the site's neighbourhood (a box, to narrow only: the
// real overlay comes after), buffered geodesically, then projected. Points and lines with no buffer have no area.
function zoneOf(d, ctx) {
  const m = Math.max(0, +d.buffer_m || 0);
  const box = turf.bboxPolygon(ctx.box(m / 1000 + 0.2));
  const parts = [];
  let unread = 0, noArea = 0;
  for (const g of d.geometries || []) {
    if (!g?.type) continue;
    try {
      let geom = g;
      if (isArea(geom)) {
        const clipped = turf.intersect(turf.featureCollection([F(geom), box]));
        if (!clipped) continue;
        geom = clipped.geometry;
      }
      if (m > 0) geom = turf.buffer(F(geom), m, { units: "meters", steps: 8 })?.geometry;
      else if (!isArea(geom)) { noArea++; continue; }
      if (!geom) continue;
      parts.push(tidy(walk(geom, ctx.P)));
    } catch { unread++; }
  }
  let zone = null;
  try { zone = unionAll(parts); } catch {
    // A union that won't compute (an invalid shape): add the pieces one at a time, skipping the ones that fail.
    for (const p of parts) { try { zone = zone ? unionAll([zone, p]) : p; } catch { unread++; } }
  }
  return { zone, unread, noArea };
}

// site: a (Multi)Polygon feature in WGS84. deductions, in the order they're applied:
//   { id, label, kind: "hard" | "buffer" | "avoid" | "soft", topic, buffer_m, reason, state: "found" | "none" | "not_checked",
//     why (when not checked), geometries: [GeoJSON geometries in WGS84], count, source: { dataset, publisher, licence } }
// hard, buffer and avoid are taken off the gross; soft is measured on what's left and not taken off.
export function areaBudget(site, deductions = []) {
  if (!isArea(site?.geometry)) throw new Error("An area budget needs a site outline: a point or a line has no area to budget.");
  const centre = turf.centroid(site).geometry.coordinates;
  const P = laea(centre), Pi = laeaInverse(centre);
  const S = tidy(walk(site.geometry, P));
  const grossKm2 = planarKm2(S);
  if (!(grossKm2 > 0)) throw new Error("The site outline has no area.");
  const [w, s, e, n] = turf.bbox(site);
  const box = (km) => {
    const lat = (s + n) / 2, dy = km / 110.574, dx = km / (111.32 * Math.max(0.05, Math.cos(rad(lat))));
    return [w - dx, s - dy, e + dx, n + dy];
  };
  const ctx = { P, box };
  let left = S;
  const rows = [];
  const zones = new Map();
  for (const d of deductions.filter((x) => x.kind !== "soft")) {
    const row = { id: d.id, label: d.label, kind: d.kind, topic: d.topic || null, buffer_m: +d.buffer_m || 0, reason: d.reason || "", state: d.state || "none",
      ...(d.why ? { why: d.why } : {}), count: d.count ?? (d.geometries || []).length, ha: 0, share: 0, ...(d.source ? { source: d.source } : {}), ...(d.changed ? { changed: d.changed } : {}) };
    if (row.state === "found" && d.geometries?.length) {
      const { zone, unread, noArea } = zoneOf(d, ctx);
      if (unread) row.unread = unread;
      if (noArea) row.no_area = noArea;
      const take = op("intersect", left, zone);
      const km2 = planarKm2(take);
      row.ha = round(km2 * 100);
      row.share = round(km2 / grossKm2, 4);
      if (take) { zones.set(d.id, take); left = op("difference", left, zone); }
      // Something within reach that takes nothing (a monument 300 m off, a line whose buffer misses): still listed.
      if (!take) row.takes_nothing = true;
    }
    rows.push(row);
  }
  const netKm2 = planarKm2(left);
  // Soft constraints on what's left, each piece counted once.
  let softLeft = left;
  const soft = [];
  for (const d of deductions.filter((x) => x.kind === "soft")) {
    const row = { id: d.id, label: d.label, kind: "soft", topic: d.topic || null, buffer_m: +d.buffer_m || 0, reason: d.reason || "", state: d.state || "none",
      ...(d.why ? { why: d.why } : {}), count: d.count ?? (d.geometries || []).length, ha: 0, share: 0, ...(d.source ? { source: d.source } : {}), ...(d.changed ? { changed: d.changed } : {}) };
    if (row.state === "found" && d.geometries?.length && softLeft) {
      const { zone, unread, noArea } = zoneOf(d, ctx);
      if (unread) row.unread = unread;
      if (noArea) row.no_area = noArea;
      const take = op("intersect", softLeft, zone);
      const km2 = planarKm2(take);
      row.ha = round(km2 * 100);
      row.share = round(km2 / grossKm2, 4);
      if (take) { zones.set(d.id, take); softLeft = op("difference", softLeft, zone); }
      else row.takes_nothing = true;
    }
    soft.push(row);
  }
  const back = (g) => roundGeom(g ? walk(g, Pi) : null);
  const softHa = soft.reduce((t, r) => t + r.ha, 0);
  return {
    gross_ha: round(grossKm2 * 100),
    rows,
    net_ha: round(netKm2 * 100),
    net_share: round(netKm2 / grossKm2, 4),
    soft,
    soft_ha: round(softHa),
    // The net area clear of soft constraints too.
    clear_ha: round(planarKm2(softLeft) * 100),
    method: "Features buffered geodesically (turf), then overlaid in a Lambert azimuthal equal-area projection centred on the site. Deductions in order, each taking only what's still left, so overlaps count once against the first. Soft constraints measured on what's left, not taken off. Coordinates WGS84 (EPSG:4326).",
    shapes: {
      net: back(left),
      clear: back(softLeft),
      taken: Object.fromEntries([...zones].map(([id, g]) => [id, back(g)])),
    },
  };
}

// The budget as short lines, for the conversation agent (names and numbers only, never coordinates) and the card.
const pct = (v) => (v >= 0.995 ? "100%" : v > 0 && v < 0.005 ? "under 1%" : `${Math.round(v * 100)}%`);
export function budgetLines(b) {
  const out = [`Gross site area: ${b.gross_ha} ha`];
  for (const r of b.rows) {
    if (r.state === "not_checked") out.push(`${r.label}: not checked (${r.why || "no data"})`);
    else if (r.ha > 0) out.push(`− ${r.label}: ${r.ha} ha (${pct(r.share)})`);
  }
  out.push(`Net developable: ${b.net_ha} ha (${pct(b.net_share)} of gross)`);
  const softs = b.soft.filter((r) => r.ha > 0);
  if (softs.length) out.push(`Of which soft constraints: ${b.soft_ha} ha (${softs.map((r) => `${r.label} ${r.ha} ha`).join("; ")})`);
  for (const r of b.soft.filter((x) => x.state === "not_checked")) out.push(`${r.label}: not checked (${r.why || "no data"})`);
  return out;
}

export const _test = { planarKm2, tidy };
