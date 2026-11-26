// Elevation over a place, on land or at sea: one tool for every skill (Rob, 20 Nov).
//
// One convention inside Tobler: ELEVATION IN METRES, POSITIVE UP, relative to sea level. Land is positive, the seabed
// negative. Records and tools store only that. Each source in catalogue/trusted.json "elevation" declares its own
// convention: `sign` ("up": values are elevations; "down": values are depths, positive down), `units` and
// `vertical_datum`. `toElevation` converts as values are read, so no skill, prompt or card ever has to think about
// signs. Water depth is a way of showing elevation at sea (depth = -elevation), decided by whether the site is at sea,
// never by the sign alone: land can lie below sea level (polders, the Dead Sea).
//
// Sources today: NOAA NCEI's DEM Global Mosaic (an ImageServer; ETOPO 2022 at 15 arc-seconds, about 460 m, on land
// and in open ocean, finer coastal and survey DEMs where NOAA holds them). One getSamples call for up to 25 points.
// Later (with slope, for area discounting): Copernicus GLO-30 as a grid, read through the Worker.
import * as turf from "./vendor/turf.js";
import { M_PER } from "./units.js";

const UNIT_TO_M = { m: 1, metre: 1, meter: 1, metres: 1, ft: M_PER.ft, feet: M_PER.ft };

// A raw value from a source → elevation in metres, positive up. Unknown units or sign are refused, never guessed.
export function toElevation(raw, source) {
  const v = typeof raw === "number" ? raw : parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  const f = UNIT_TO_M[String(source.units || "m").toLowerCase()];
  if (!f) throw new Error(`unknown units "${source.units}" for ${source.title}`);
  if (source.sign !== "up" && source.sign !== "down") throw new Error(`source ${source.title} doesn't say whether its values are elevations or depths`);
  const m = v * f;
  return source.sign === "down" ? -m : m;
}

// Up to n points spread over a feature: the point itself; points evenly along a line; the centre plus a grid inside a polygon.
export function samplePoints(feature, n = 25) {
  const g = feature.geometry;
  if (g.type === "Point") return [g.coordinates];
  if (/LineString/.test(g.type)) {
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    const segs = [];
    let total = 0;
    for (const line of lines) for (let i = 1; i < line.length; i++) {
      const km = turf.distance(line[i - 1], line[i]);
      segs.push({ a: line[i - 1], b: line[i], start: total, km });
      total += km;
    }
    if (!segs.length || total === 0) return [lines[0][0]];
    const pts = [];
    for (let k = 0; k < n; k++) {
      const at = (total * k) / (n - 1);
      const s = segs.find((x) => at <= x.start + x.km) || segs.at(-1);
      const f = s.km ? Math.min(1, (at - s.start) / s.km) : 0;
      pts.push([s.a[0] + (s.b[0] - s.a[0]) * f, s.a[1] + (s.b[1] - s.a[1]) * f]);
    }
    return pts;
  }
  const inside = (p) => { try { return turf.booleanPointInPolygon(p, feature); } catch { return false; } };
  const pts = [turf.pointOnFeature(feature).geometry.coordinates];
  const [w, s, e, nn] = turf.bbox(feature);
  // A finer grid until enough points fall inside (thin or odd shapes), capped.
  for (const k of [5, 7, 10, 14]) {
    const grid = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const p = [w + ((i + 0.5) * (e - w)) / k, s + ((j + 0.5) * (nn - s)) / k];
      if (inside(p)) grid.push(p);
    }
    if (grid.length >= Math.min(n - 1, 12) || k === 14) {
      const step = Math.max(1, Math.ceil(grid.length / (n - 1)));
      for (let i = 0; i < grid.length && pts.length < n; i += step) pts.push(grid[i]);
      break;
    }
  }
  return pts;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const withTimeout = (ms) => (typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
const r3 = (v) => Math.round(v * 1000) / 1000;

// Elevation over a feature from one source. Returns { elevation, checked }: elevation null when not checked or no values.
// elevation: { typical_m, min_m, max_m, points, below_sea_level_points, cell_m, rasters, ... } all positive up.
export async function elevationOver({ feature, source, fetchFn = globalThis.fetch, n = 25, timeoutMs = 12000, now = () => new Date().toISOString() }) {
  const pts = samplePoints(feature, n);
  const base = { evidence: "elevation", dataset: source.title, publisher: source.publisher, licence: source.licence, checked_at: now() };
  try {
    if (source.kind !== "arcgis-imageserver") throw new Error(`can't read ${source.kind || "this kind of"} service yet`);
    const geometry = JSON.stringify({ points: pts.map((p) => [r3(p[0]), r3(p[1])]), spatialReference: { wkid: 4326 } });
    const url = `${source.url}/getSamples?geometry=${encodeURIComponent(geometry)}&geometryType=esriGeometryMultipoint&returnFirstValueOnly=true&outFields=Name,CellsizeArcseconds&f=json`;
    const res = await fetchFn(url, { signal: withTimeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    if (j.error) throw new Error(j.error.message || "service error");
    const got = (j.samples || []).map((s) => ({ m: toElevation(s.value, source), res: +s.resolution, raster: s.attributes?.Name }))
      .filter((x) => x.m != null && x.m > -11500 && x.m < 9000);
    if (!got.length) return { elevation: null, checked: { ...base, result: "none in dataset", why: "no values returned for this place" } };
    const vals = got.map((x) => x.m);
    const cells = got.map((x) => x.res).filter((x) => x > 0);
    // Cell size: services in degrees (NOAA, the EEA's EMODnet copy) or in metres (England's lidar, USGS 3DEP).
    const cellM = (v) => (source.resolution_units === "m" ? v : v * 111320);
    const rasters = [...new Set(got.map((x) => x.raster).filter(Boolean))].slice(0, 4);
    const elevation = {
      convention: "metres, positive up, relative to sea level",
      typical_m: Math.round(median(vals)), min_m: Math.round(Math.min(...vals)), max_m: Math.round(Math.max(...vals)),
      points: vals.length, below_sea_level_points: vals.filter((v) => v < 0).length,
      // The points below sea level on their own, so water depth isn't averaged with land.
      below: (() => { const b = vals.filter((v) => v < 0); return b.length ? { typical_m: Math.round(median(b)), min_m: Math.round(Math.min(...b)), max_m: Math.round(Math.max(...b)) } : null; })(),
      cell_m: cells.length ? Math.max(1, Math.round(cellM(Math.max(...cells)))) : null, rasters,
      vertical_datum: source.vertical_datum,
      dataset: source.title, publisher: source.publisher, licence: source.licence, attribution: source.attribution, checked_at: base.checked_at,
    };
    return { elevation, checked: { ...base, result: "features", count: vals.length } };
  } catch (e) {
    return { elevation: null, checked: { ...base, result: "not checked", why: String(e.message || e).slice(0, 160) } };
  }
}

// Whether a source serves this place: its box (`where`, [w, s, e, n]) holds the feature's centre, and it serves this
// setting (`serves`: "land", "sea" or both when absent; a bathymetry model shouldn't answer for a site on land).
export function sourceServes(source, feature, setting = null) {
  if (setting && source.serves && source.serves !== setting) return false;
  if (!source.where) return true;
  let c;
  try { c = turf.centroid(feature).geometry.coordinates; } catch { return true; }
  const [w, so, e, n] = source.where;
  return c[0] >= w && c[0] <= e && c[1] >= so && c[1] <= n;
}

// Try each source in order (finest first, as listed); the first that answers wins. Sources that don't cover the place
// or the setting are skipped; one that covers it but has no values there (a lidar gap) falls through to the next.
// The last answer records which finer sources were tried, so the card can say why a coarser one was used.
export async function elevationFrom(sources, opts) {
  let last = null;
  const tried = [];
  for (const source of (sources || []).filter((x) => sourceServes(x, opts.feature, opts.setting || null))) {
    if (last) tried.push(`${last.checked.dataset}: ${last.checked.result}${last.checked.why ? ` (${last.checked.why})` : ""}`);
    last = await elevationOver({ ...opts, source });
    if (last.elevation) return tried.length ? { ...last, checked: { ...last.checked, finer_tried: tried } } : last;
  }
  return last || { elevation: null, checked: { evidence: "elevation", result: "not checked", why: "no elevation source configured" } };
}

// Water depth at sea, from elevation: depth = -elevation. Deepest depth is the lowest elevation.
export function depthFrom(e) {
  if (!e?.below) return null;
  const b = e.below;
  return {
    typical_m: -b.typical_m, min_m: -b.max_m, max_m: -b.min_m, points: e.points,
    sea_points: e.below_sea_level_points, land_points: e.points - e.below_sea_level_points, cell_m: e.cell_m,
    dataset: e.dataset, publisher: e.publisher, licence: e.licence, attribution: e.attribution, checked_at: e.checked_at,
  };
}

// When elevation matters for a site on land (Rob, 20 Nov: show it only when it's significant, or the results get
// crowded). Thresholds are rough and for Rob to correct:
// - low-lying: typical elevation 10 m or less (flooding, storm surge, sea-level rise); below sea level if under 0;
// - upland: typical or highest 1,000 m or more (Rob, 20 Nov): exposed weather, snow and ice, harder access, shorter
//   working seasons;
// - high altitude: typical or highest 2,500 m or more (less oxygen, cold, workforce health); very high from 3,500 m.
export const ELEVATION_RULES = { lowLyingM: 10, uplandM: 1000, highM: 2500, veryHighM: 3500 };
export function elevationSignificance(e, rules = ELEVATION_RULES) {
  if (!e) return null;
  if (e.typical_m < 0) return { kind: "below sea level", why: "parts of the site lie below sea level: flooding and drainage" };
  if (e.typical_m <= rules.lowLyingM) return { kind: "low-lying", why: "low-lying: flooding, storm surge and sea-level rise" };
  const top = Math.max(e.typical_m, e.max_m);
  if (top >= rules.veryHighM) return { kind: "very high altitude", why: "very high altitude: much less oxygen, cold, workforce health and equipment derating" };
  if (top >= rules.highM) return { kind: "high altitude", why: "high altitude: less oxygen, cold, workforce health" };
  if (top >= rules.uplandM) return { kind: "upland", why: "upland: exposed weather, snow and ice, harder access and shorter working seasons" };
  return null;
}

const range = (a, b) => (a !== b ? `, ${a}–${b} m across the site` : "");

// The analyst's line (with the source) and the card's short line, for a site on land.
export function elevationLine(e, sig) {
  const where = e.typical_m < 0 ? `about ${-e.typical_m} m below sea level` : `about ${e.typical_m} m above sea level`;
  return `Elevation ${where}${range(e.min_m, e.max_m)}${sig ? ` (${sig.why})` : ""}. ${e.dataset} (${e.publisher}), cells about ${e.cell_m || "?"} m; heights relative to ${e.vertical_datum || "sea level"}.`;
}
export function elevationShort(e, sig) {
  const where = e.typical_m < 0 ? `about ${-e.typical_m} m below sea level` : `about ${e.typical_m} m`;
  return `Elevation ${where}${range(e.min_m, e.max_m)}${sig ? `: ${sig.kind}` : ""} (NOAA).`;
}
