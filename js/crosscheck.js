// The geodetic cross-check (CLAUDE.md, "Geodetic integrity"): a service's own WGS 84 output against Tobler's
// transformation of the same features' native coordinates. Lesson 12: don't trust a server's datum shift. About 100 m
// apart in Great Britain means one side skipped the OSGB36 shift; 1 to 2 m is two valid transformations disagreeing
// (a Helmert against a grid). Each point is also compared with its native coordinates taken through the projection
// alone, read as WGS 84, which is what a service that skipped the shift returns, so the verdict says which side it was.
//
// The transformation is chosen by js/epsgtools.js for where the points are (invariant 1); the projection definition is
// the grid table's (catalogue/grids.json) or UTM's. No DOM; the network only through the fetch passed in.
import * as turf from "./vendor/turf.js";
import { createEpsgTools } from "./epsgtools.js";
import { ellipsoidalOf, definitionOf } from "./presentation.js";

export const SKIP_MATCH_M = 5; // within this of the unshifted position: the service skipped the shift
export const AGREE_MIN_M = 5; // two valid transformations can differ by a few metres (Helmert against OSTN15)

let lib = null;
const loadProj4 = async () => (lib ||= (await import("./vendor/fileread.js")).proj4);

const metres = (a, b) => turf.distance(a, b, { units: "kilometers" }) * 1000;
const r2 = (x) => Math.round(x * 100) / 100;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };

// crossCheck({ points: [{ id, native: [x, y], wgs84: [lon, lat] }], nativeCrs, grids, epsg }) → per point and overall:
// how far the service's WGS 84 is from Tobler's, and from the unshifted position, and what that means.
export const nativeDefinition = definitionOf;

export async function crossCheck({ points, nativeCrs, grids, epsg, proj4 = null }) {
  const def = nativeDefinition(nativeCrs, grids);
  if (!def) return { error: `EPSG:${nativeCrs} isn't a grid in catalogue/grids.json or a WGS 84 / UTM zone, so it can't be cross-checked here.` };
  if (!points?.length) return { error: "No points to check." };
  const P = proj4 || await loadProj4();
  const proj = P(ellipsoidalOf(def.projection), def.projection);
  let toWgs = null, operation = null;
  if (def.base !== 4326) {
    if (!epsg) return { error: "The EPSG registry isn't connected, so the transformation can't be chosen." };
    const geo = createEpsgTools({ epsg, transformationChoice: () => "choose" }, () => null).presentationGeodesy;
    const r = await geo.reach({ code: def.code, lonlat: points[0].wgs84 });
    if (r.error) return { error: String(r.error) };
    if (r.kind === "transformation") { toWgs = r.toWgs; operation = r.operation; }
    else if (r.kind === "none") return { error: `No transformation could be applied here: ${r.why}` };
  }
  const acc = operation?.accuracy_m ?? 0;
  const agreeM = Math.max(AGREE_MIN_M, 2.5 * acc);
  const rows = points.map((p) => {
    const geog = proj.inverse(p.native); // [lon, lat] on the native datum
    const ours = toWgs ? (([o]) => [o[1], o[0]])(toWgs([[geog[1], geog[0]]])) : geog;
    const dOurs = metres(p.wgs84, ours), dRaw = metres(p.wgs84, geog);
    const verdict = dOurs <= agreeM ? "agree"
      : toWgs && dRaw <= SKIP_MATCH_M ? "service skipped the datum shift"
        : "disagree";
    return { id: p.id, from_ours_m: r2(dOurs), from_unshifted_m: r2(dRaw), verdict };
  });
  const worst = rows.find((r) => r.verdict === "service skipped the datum shift") ? "service skipped the datum shift" : rows.find((r) => r.verdict === "disagree") ? "disagree" : "agree";
  const med = median(rows.map((r) => r.from_ours_m));
  const what = {
    agree: `The service's WGS 84 is within ${agreeM} m of Tobler's (median ${r2(med)} m): two valid transformations${operation ? ` (Tobler's is ${operation.name}, about ${acc} m)` : ""} agreeing about as well as they should.`,
    "service skipped the datum shift": `The service's WGS 84 matches the native coordinates with no datum shift (within ${SKIP_MATCH_M} m), and is ${r2(med)} m (median) from Tobler's: the service skipped the shift. Take its native coordinates through Tobler's pipeline (lesson 12).`,
    disagree: `The service's WGS 84 is ${r2(med)} m (median) from Tobler's and doesn't match an unshifted reading either: something else is wrong (the wrong native CRS, or a bad transformation). Don't use its WGS 84 until it's understood.`,
  }[worst];
  return {
    native: { code: def.code, name: def.name, base: def.base }, operation: operation ? { code: operation.code, name: operation.name, accuracy_m: acc, direction: operation.direction, epsg_version: operation.epsg_version } : { kind: "conversion" },
    agree_within_m: agreeM, points: rows, median_m: r2(med), max_m: r2(Math.max(...rows.map((r) => r.from_ours_m))), verdict: worst, what,
  };
}

// The same features from an ArcGIS feature layer twice: in its own CRS and as the service's WGS 84 (outSR=4326). Up
// to n features, by object id, from a where clause or an envelope in the layer's CRS. The first vertex of each.
// fetchFn: the page's or the script's fetch (public services only; no tokens here).
export async function servicePairs({ url, n = 10, where = "1=1", envelope = null, fetchFn = fetch }) {
  const base = url.replace(/\/query\/?$/, "").replace(/\/$/, "");
  const info = await (await fetchFn(`${base}?f=json`)).json();
  const sr = info?.extent?.spatialReference?.latestWkid || info?.extent?.spatialReference?.wkid || info?.sourceSpatialReference?.latestWkid || info?.sourceSpatialReference?.wkid;
  if (!sr) throw new Error("The layer doesn't say its spatial reference.");
  const oid = info.objectIdField || (info.fields || []).find((f) => f.type === "esriFieldTypeOID")?.name || "OBJECTID";
  const q = (outSR) => {
    const p = new URLSearchParams({ where, outFields: oid, orderByFields: oid, resultRecordCount: String(n), returnGeometry: "true", outSR: String(outSR), f: "json" });
    if (envelope) { p.set("geometry", envelope.join(",")); p.set("geometryType", "esriGeometryEnvelope"); p.set("inSR", String(sr)); p.set("spatialRel", "esriSpatialRelIntersects"); }
    return fetchFn(`${base}/query?${p}`).then((r) => r.json());
  };
  const [a, b] = await Promise.all([q(sr), q(4326)]);
  if (a.error || b.error) throw new Error((a.error || b.error).message || "The service answered with an error.");
  const first = (g) => g?.points?.[0] || (g?.x != null ? [g.x, g.y] : null) || g?.paths?.[0]?.[0] || g?.rings?.[0]?.[0] || null;
  const byId = new Map((b.features || []).map((f) => [f.attributes[oid], first(f.geometry)]));
  const points = (a.features || []).map((f) => ({ id: f.attributes[oid], native: first(f.geometry), wgs84: byId.get(f.attributes[oid]) })).filter((p) => p.native && p.wgs84);
  return { native_crs: sr, layer: info.name || null, points };
}
