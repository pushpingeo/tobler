// The presentation CRS (invariant 10, CLAUDE.md; skills/cartography/SKILL.md section 2): the one coordinate system a
// run's outputs show. Chosen here and nowhere else, once per run, from where the site is: the grid of the region in
// catalogue/grids.json holding most of the site, on real outlines (invariant 2), else WGS 84 / UTM for the zone
// holding most of it. Recorded in the run record (presentation_crs) with the operation that reaches it; every output
// reads that record and builds its projector here (projectorFor), so no output picks its own.
//
// Getting there obeys invariant 1: a grid on another datum is reached by the transformation js/epsgtools.js chooses
// from the EPSG registry for the site; this file holds projection definitions only (from grids.json, or UTM's
// pattern), never a datum shift. No DOM; the run passes in the reference data, the grid table and the registry.
import * as turf from "./vendor/turf.js";
import { nearestKm } from "./nearness.js";
import { createEpsgTools } from "./epsgtools.js";

export const COAST_SLACK_KM = 1; // Natural Earth's coastline is good to about a kilometre (data/ref/README.md)
const SAMPLES = 30; // a 30 × 30 grid of sample points over an area, as js/reference.js countrySplit does

// ---- where the site is (pure) ----------------------------------------------------------------------------------

// Points that stand for the site: the point itself, points along a line, a grid inside an area (its vertices if it's
// too thin for the grid). Each counts once in the shares below, so a share is of the site's area (or length).
export function samplePoints(feature) {
  const g = feature.geometry || feature;
  if (g.type === "Point") return [g.coordinates];
  if (g.type === "MultiPoint") return g.coordinates;
  if (/LineString/.test(g.type)) {
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    return lines.flatMap((c) => {
      const line = turf.lineString(c), len = turf.length(line);
      return Array.from({ length: SAMPLES + 1 }, (_, i) => turf.along(line, (len * i) / SAMPLES).geometry.coordinates);
    });
  }
  const f = { type: "Feature", properties: {}, geometry: g };
  const [w, s, e, n] = turf.bbox(f);
  const out = [];
  for (let i = 0; i < SAMPLES; i++) for (let j = 0; j < SAMPLES; j++) {
    const pt = [w + ((e - w) * (i + 0.5)) / SAMPLES, s + ((n - s) * (j + 0.5)) / SAMPLES];
    if (turf.booleanPointInPolygon(pt, f)) out.push(pt);
  }
  if (out.length >= 20) return out;
  return turf.coordAll(f).concat([turf.centroid(f).geometry.coordinates]);
}

// The UTM zone of a point, with Norway's and Svalbard's exceptions.
export function utmZone([lon, lat]) {
  let z = Math.floor((((lon + 180) % 360) + 360) % 360 / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) z = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) z = 31; else if (lon >= 9 && lon < 21) z = 33;
    else if (lon >= 21 && lon < 33) z = 35; else if (lon >= 33 && lon < 42) z = 37;
  }
  return z;
}
const mostOf = (items) => {
  const m = new Map();
  for (const k of items) m.set(k, (m.get(k) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
};

export function utmFor(points) {
  const [zone, zc] = mostOf(points.map(utmZone));
  const [south] = mostOf(points.map(([, lat]) => lat < 0));
  const code = (south ? 32700 : 32600) + zone;
  return { kind: "utm", code, name: `WGS 84 / UTM zone ${zone}${south ? "S" : "N"}`, zone, hemisphere: south ? "S" : "N",
    zone_share: +(zc / points.length).toFixed(3), base: { code: 4326, name: "WGS 84" } };
}

const bboxOf = (f) => f.bbox || (f.bbox = turf.bbox(f));
const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;
const inside = (pt, f) => inBox(pt, bboxOf(f)) && turf.booleanPointInPolygon(pt, f);

// The grid's CRS for the site (a zoned grid takes the zone holding most of the site).
function gridCrs(grid, points) {
  if (grid.crs) return { code: grid.crs.code, name: grid.crs.name, base: grid.crs.base };
  const z = grid.zones;
  const [zone, zc] = mostOf(points.map(utmZone));
  if (zone < z.from || zone > z.to) return null;
  return { code: z.code_base + zone, name: z.name.replace("{zone}", zone), base: z.base, zone, zone_share: +(zc / points.length).toFixed(3) };
}

// Which grid, if any, from the outlines alone. layers: { "uk-areas": FeatureCollection, countries: FeatureCollection }.
// The region holding the most sample points wins, against the other countries too: a site mostly in Belgium with a
// corner in the Netherlands is shown in UTM, not RD New. A site touching no outline (at sea) gets a grid only if one of
// its regions is within the coastline's accuracy; otherwise UTM.
export function chooseRegion(feature, { grids, layers }) {
  const points = samplePoints(feature);
  const regions = (grids?.grids || []).map((g) => ({ g, parts: (layers[g.outline.layer]?.features || []).filter((f) => g.outline.names.includes(f.properties?.name)) }))
    .filter((r) => r.parts.length);
  const covered = new Set((grids?.grids || []).flatMap((g) => g.covers || []));
  const others = (layers.countries?.features || []).filter((f) => !covered.has(f.properties?.name));
  const counts = new Map();
  let land = 0;
  for (const pt of points) {
    const r = regions.find((x) => x.parts.some((f) => inside(pt, f)));
    const key = r ? `grid:${r.g.id}` : (others.find((f) => inside(pt, f))?.properties?.name ?? null);
    if (key) { land++; counts.set(key, (counts.get(key) || 0) + 1); }
  }
  const utm = utmFor(points);
  if (!land) {
    // At sea, or on a coast the outlines missed: the nearest grid region within the coastline's accuracy.
    const geom = feature.geometry || feature;
    let near = null;
    for (const r of regions) for (const f of r.parts) {
      const km = nearestKm(geom, f.geometry);
      if (km != null && km <= COAST_SLACK_KM && (!near || km < near.km)) near = { r, km };
    }
    if (near) return { grid: near.r.g, crs: gridCrs(near.r.g, points), share: 0, why: `The site touches no land outline, but ${near.r.g.region} is ${near.km.toFixed(2)} km away, within the outlines' accuracy (about ${COAST_SLACK_KM} km), so its grid is used.`, utm, points };
    return { grid: null, utm, share: 0, why: "The site touches no land outline (at sea), so it's shown in WGS 84 / UTM.", points };
  }
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  const share = +(n / points.length).toFixed(3);
  if (!top.startsWith("grid:")) return { grid: null, utm, share, why: `Most of the site is in ${top}, which has no grid in Tobler's table, so it's shown in WGS 84 / UTM.`, points };
  const grid = regions.find((r) => `grid:${r.g.id}` === top).g;
  const crs = gridCrs(grid, points);
  if (!crs) return { grid: null, utm, share, why: `${grid.region}'s grid has no zone for this site, so it's shown in WGS 84 / UTM.`, points };
  const pct = Math.round(share * 100);
  return { grid, crs, utm, share, why: `${pct >= 99 ? "The site is" : `${pct}% of the site is`} in ${grid.region}, whose standard grid is ${crs.name}.`, points };
}

// ---- the run's presentation CRS (registry) ---------------------------------------------------------------------

// A point of the site to look up transformations at: the sample nearest the samples' middle (on the site, never
// outside a crescent).
function anchorOf(points) {
  const mx = points.reduce((s, p) => s + p[0], 0) / points.length, my = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.reduce((best, p) => (Math.hypot(p[0] - mx, p[1] - my) < Math.hypot(best[0] - mx, best[1] - my) ? p : best), points[0]);
}
const inArea = ([lon, lat], b) => !b || (b[0] <= b[2] ? lon >= b[0] && lon <= b[2] : lon >= b[0] || lon <= b[2]) && lat >= b[1] && lat <= b[3];

// presentationCrs({ feature, ref, grids, epsg }) → the run record's presentation_crs. ref.get(name) loads data/ref;
// epsg is host.epsg (null: the registry isn't connected, so no grid on another datum can be reached). Never throws:
// anything that stops the grid falls back to UTM, and the record says what and why.
export async function presentationCrs(args) {
  try { return await choose(args); }
  catch (e) { return { chosen_by: "js/presentation.js", kind: null, code: null, why: `No presentation CRS could be chosen: ${String(e.message || e).slice(0, 160)}` }; }
}
async function choose({ feature, ref, grids, epsg }) {
  const layerNames = [...new Set((grids?.grids || []).map((g) => g.outline.layer))];
  let choice;
  if (!grids?.grids?.length) {
    const points = samplePoints(feature);
    choice = { grid: null, utm: utmFor(points), share: 0, why: "The grid table (catalogue/grids.json) wasn't loaded, so no national grid could be chosen; shown in WGS 84 / UTM.", points };
  } else try {
    const layers = Object.fromEntries(await Promise.all([...new Set([...layerNames, "countries"])].map(async (n) => [n, await ref.get(n)])));
    choice = chooseRegion(feature, { grids, layers });
  } catch (e) {
    const points = samplePoints(feature);
    choice = { grid: null, utm: utmFor(points), share: 0, why: `The outlines couldn't be read (${String(e.message || e).slice(0, 120)}), so it's shown in WGS 84 / UTM.`, points };
  }
  const geo = epsg ? createEpsgTools({ epsg, transformationChoice: () => "choose" }, () => null).presentationGeodesy : null;
  const base = { chosen_by: "js/presentation.js", grids_version: grids?.version ?? null };
  const utmRecord = async (why, extra = {}) => {
    const u = choice.utm;
    let registry = null;
    if (geo) { try { const d = await geo.describe(u.code); registry = { name: d.name, deprecated: d.deprecated }; } catch { registry = null; } }
    return { ...base, kind: "utm", code: u.code, epsg: `EPSG:${u.code}`, name: registry?.name || u.name, zone: u.zone, hemisphere: u.hemisphere, zone_share: u.zone_share,
      base: u.base, region: null,
      operation: { kind: "conversion", name: "Universal Transverse Mercator", note: "A conversion on one datum (WGS 84): nothing to choose and no accuracy lost." },
      accuracy_m: 0, registry_checked: !!registry, why, ...extra };
  };
  if (!choice.grid) return utmRecord(choice.why);
  const { grid, crs } = choice;
  const fallback = (reason) => utmRecord(`${choice.why} ${reason} Shown in WGS 84 / UTM instead.`, { fallback_from: { code: crs.code, name: crs.name, region: grid.region, reason } });
  if (!geo) return fallback(`The EPSG registry wasn't connected, so ${crs.name} couldn't be reached by a registered transformation.`);
  const anchor = anchorOf(choice.points);
  let r;
  try { r = await geo.reach({ code: crs.code, lonlat: anchor }); }
  catch (e) { return fallback(`The EPSG registry couldn't be read (${String(e.message || e).slice(0, 120)}).`); }
  if (r.error) return fallback(`The EPSG registry couldn't be read (${String(r.error).slice(0, 120)}).`);
  const d = r.crs;
  if (d.kind !== "projected" || d.deprecated) return fallback(`EPSG:${crs.code} is ${d.deprecated ? "deprecated" : `not a projected CRS (${d.kind})`} in the registry.`);
  if (d.base?.code !== crs.base) return fallback(`EPSG:${crs.code}'s base CRS in the registry is EPSG:${d.base?.code}, not EPSG:${crs.base} as the grid table says.`);
  if (!inArea(anchor, d.area_of_use?.bbox)) return fallback(`The site is outside EPSG:${crs.code}'s area of use (${d.area_of_use?.name}).`);
  if (r.kind === "none") return fallback(`No transformation from WGS 84 could be applied here: ${r.why}`);
  const op = r.kind === "conversion"
    ? { kind: "conversion", note: r.note }
    : { kind: "transformation", code: r.operation.code, epsg: `EPSG:${r.operation.code}`, name: r.operation.name, accuracy_m: r.operation.accuracy_m, direction: r.operation.direction,
      area_of_use: r.operation.area_of_use, epsg_version: r.operation.epsg_version, applied_in: "Tobler (js/transform.js), from the EPSG record's parameters" };
  return { ...base, kind: "national grid", code: crs.code, epsg: `EPSG:${crs.code}`, name: d.name, region: grid.region, share: choice.share,
    ...(crs.zone ? { zone: crs.zone, zone_share: crs.zone_share } : {}),
    base: { code: d.base.code, name: d.base.name }, operation: op,
    accuracy_m: op.kind === "conversion" ? 0 : op.accuracy_m ?? null, registry_checked: true,
    area_of_use: d.area_of_use?.name || null, why: choice.why };
}

// One line for a page: "British National Grid (EPSG:27700), from WGS 84 by OSGB36 to WGS 84 (6) (EPSG:1314), about 2 m".
export function presentationLine(pc) {
  if (!pc?.code) return "";
  const op = pc.operation;
  const how = op?.kind === "transformation"
    ? `, reached from WGS 84 by ${op.name} (${op.epsg}, ${op.direction === "reverse" ? "run in reverse, " : ""}${op.accuracy_m == null ? "accuracy not stated" : `about ${op.accuracy_m} m`})`
    : ", a conversion from WGS 84 on one datum";
  return `${pc.name} (EPSG:${pc.code})${how}.${pc.fallback_from ? ` ${pc.fallback_from.name} wasn't used: ${pc.fallback_from.reason}` : ""}`;
}

// The projection-only definition and base geographic CRS of a CRS Tobler can draw in or read: a grid in the table,
// or UTM on WGS 84 (EPSG 326zz, 327zz). null if it isn't one of those. Always rebuilt from the code, never read from a
// record (a share link is the person's to edit).
export function definitionOf(code, grids) {
  code = +code;
  for (const g of grids?.grids || []) {
    if (g.crs?.code === code) return { code, name: g.crs.name, base: g.crs.base, projection: g.crs.projection };
    const z = g.zones;
    if (z && code - z.code_base >= z.from && code - z.code_base <= z.to) {
      const zone = code - z.code_base;
      return { code, name: z.name.replace("{zone}", zone), base: z.base, projection: z.projection.replace("{zone}", zone) };
    }
  }
  if ((code > 32600 && code <= 32660) || (code > 32700 && code <= 32760)) {
    const zone = code % 100, south = code > 32700;
    return { code, name: `WGS 84 / UTM zone ${zone}${south ? "S" : "N"}`, base: 4326, projection: `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs` };
  }
  return null;
}

// ---- the projector every output uses -----------------------------------------------------------------------------

// The geographic system a projection sits on (same ellipsoid or datum, no projection), so proj4 converts and never
// shifts: "+proj=tmerc … +ellps=airy" → "+proj=longlat +ellps=airy".
export const ellipsoidalOf = (projection) => projection.replace(/\+proj=\S+/, "+proj=longlat")
  .replace(/\+(x_0|y_0|k|k_0|lat_0|lon_0|lat_ts|zone|units)=\S+/g, "").replace(/\+south\b/, "").replace(/\s+/g, " ").trim();

let lib = null;
const loadProj4 = async () => (lib ||= (await import("./vendor/fileread.js")).proj4);

// projectorFor(pc, { grids, epsg }) → { forward([lon, lat]) → [E, N], inverse([E, N]) → [lon, lat] } in the run's
// presentation CRS: the projection rebuilt from its code (the grid table or UTM's pattern), the transformation re-read
// from the registry by the code the run recorded (the same record, so the same numbers). Throws if either can't be had.
export async function projectorFor(pc, { grids, epsg = null, proj4 = null } = {}) {
  const P = proj4 || await loadProj4();
  const def = definitionOf(pc?.code, grids);
  if (!def) throw new Error(`EPSG:${pc?.code} isn't a grid in catalogue/grids.json or a WGS 84 / UTM zone.`);
  if (def.base !== (pc.base?.code ?? def.base)) throw new Error(`The run's base CRS (EPSG:${pc.base?.code}) isn't the grid table's (EPSG:${def.base}).`);
  const fwd = P(ellipsoidalOf(def.projection), def.projection);
  let toGrid = (ll) => ll, toWgs = (ll) => ll;
  if (pc.operation?.kind === "transformation") {
    if (!epsg) throw new Error("The EPSG registry is needed to rebuild this run's transformation.");
    const geo = createEpsgTools({ epsg, transformationChoice: () => "choose" }, () => null).presentationGeodesy;
    const prep = await geo.reachWith({ operation: pc.operation.code, base: def.base });
    toGrid = ([lon, lat]) => { const [o] = prep.toGrid([[lat, lon]]); return [o[1], o[0]]; };
    toWgs = ([lon, lat]) => { const [o] = prep.toWgs([[lat, lon]]); return [o[1], o[0]]; };
  }
  return {
    code: pc.code, name: pc.name,
    forward: (lonlat) => fwd.forward(toGrid(lonlat)),
    inverse: (en) => toWgs(fwd.inverse(en)),
  };
}
