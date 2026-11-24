// OpenStreetMap as a check source (24 Nov, coverage drive): infrastructure and community receptors anywhere in the
// world, where no national layer is in Tobler's data. One Overpass query per run for every OpenStreetMap check that
// applies, each feature measured from the site's edge (js/nearness.js) and handed back in the same shape as an atlas
// layer's answer, so the checks count, band and list them like any other source. OpenStreetMap's completeness varies
// by place, so these checks are never must-checks and their line says where the data comes from. No DOM.
import * as turf from "./vendor/turf.js";
import { geometryDistanceKm } from "./datatools.js";

// The kinds a check can ask for (catalogue/checks.json "osm"). sel: Overpass selectors (the bbox is added);
// match: the same rule on a feature's tags, to sort one combined answer back into kinds; name: a fallback name.
export const OSM_KINDS = {
  "power line": { sel: ['way["power"="line"]'], match: (t) => t.power === "line", name: (t) => `Power line${t.voltage ? ` (${kv(t.voltage)})` : ""}`, line: true },
  substation: { sel: ['nwr["power"="substation"]'], match: (t) => t.power === "substation", name: (t) => `Substation${t.voltage ? ` (${kv(t.voltage)})` : ""}` },
  pipeline: { sel: ['way["man_made"="pipeline"]'], match: (t) => t.man_made === "pipeline", name: (t) => `${cap(t.substance || "")} pipeline`.trim(), line: true },
  "main road": { sel: ['way["highway"~"^(motorway|trunk|primary)$"]'], match: (t) => /^(motorway|trunk|primary)$/.test(t.highway || ""), name: (t) => t.ref || `${cap(t.highway)} road`, line: true },
  railway: { sel: ['way["railway"="rail"]'], match: (t) => t.railway === "rail", name: () => "Railway", line: true },
  aerodrome: { sel: ['nwr["aeroway"="aerodrome"]'], match: (t) => t.aeroway === "aerodrome", name: () => "Aerodrome" },
  "wind turbine": { sel: ['node["power"="generator"]["generator:source"="wind"]'], match: (t) => t.power === "generator" && t["generator:source"] === "wind", name: () => "Wind turbine" },
  homes: { sel: ['nwr["landuse"="residential"]'], match: (t) => t.landuse === "residential", name: () => "Homes (residential land)", byName: true },
  school: { sel: ['nwr["amenity"~"^(school|kindergarten|college)$"]'], match: (t) => /^(school|kindergarten|college)$/.test(t.amenity || ""), name: (t) => cap(t.amenity) },
  "health care": { sel: ['nwr["amenity"~"^(hospital|clinic|nursing_home)$"]', 'nwr["social_facility"="nursing_home"]'],
    match: (t) => /^(hospital|clinic|nursing_home)$/.test(t.amenity || "") || t.social_facility === "nursing_home", name: (t) => (t.amenity === "hospital" ? "Hospital" : t.amenity === "clinic" ? "Clinic" : "Care home") },
};
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ") : s);
const kv = (v) => String(v).split(";").map((x) => (+x >= 1000 ? `${Math.round(+x / 1000)} kV` : x)).join(", ");

// The box a site's edge grown by km covers (degrees, roomy: the distances are measured properly afterwards).
export function grownBox(feature, km) {
  const [w, s, e, n] = turf.bbox(feature);
  const lat = (s + n) / 2, dy = km / 110.574, dx = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [w - dx, Math.max(-90, s - dy), e + dx, Math.min(90, n + dy)];
}

// One Overpass query for several kinds: ways with their shapes, relations by their centre (a hospital mapped as a
// multipolygon still counts, measured to its centre).
export const MAX_ELEMENTS = 4000;
export function osmQuery(kinds, box) {
  const b = `(${box[1].toFixed(5)},${box[0].toFixed(5)},${box[3].toFixed(5)},${box[2].toFixed(5)})`;
  const stmts = kinds.flatMap((k) => OSM_KINDS[k]?.sel || []).map((s) => `${s}${b};`).join("");
  return `[out:json][timeout:25];(${stmts})->.a;(node.a;way.a;);out geom qt ${MAX_ELEMENTS};rel.a;out center qt 400;`;
}

// An Overpass element as a geometry: a node a point, a way a line (or an area if closed and not a line kind), a
// relation its centre.
export function elementGeometry(el, isLine) {
  if (el.type === "node") return { type: "Point", coordinates: [el.lon, el.lat] };
  if (el.type === "way" && el.geometry?.length) {
    const cs = el.geometry.map((p) => [p.lon, p.lat]);
    const closed = cs.length > 3 && cs[0][0] === cs.at(-1)[0] && cs[0][1] === cs.at(-1)[1];
    return closed && !isLine ? { type: "Polygon", coordinates: [cs] } : { type: "LineString", coordinates: cs };
  }
  if (el.center) return { type: "Point", coordinates: [el.center.lon, el.center.lat] };
  return null;
}

// The answer for each kind: features within its own km of the site (nearest first), or why it couldn't be checked.
// query(q) runs an Overpass query (js/gazetteer.js overpassQuery: fallbacks, and "not answering" when all fail).
export async function osmAnswers({ wants, site, query, now = () => new Date().toISOString() }) {
  const kinds = [...wants.keys()].filter((k) => OSM_KINDS[k]);
  const out = new Map();
  if (!kinds.length) return out;
  const km = Math.max(...kinds.map((k) => wants.get(k)));
  let json;
  try { json = await query(osmQuery(kinds, grownBox(site, km))); }
  catch (e) {
    for (const k of kinds) out.set(k, { not_checked: String(e.message || e).slice(0, 200) });
    return out;
  }
  const els = json?.elements || [];
  const capped = els.filter((e) => e.type !== "relation").length >= MAX_ELEMENTS;
  const checkedAt = now();
  for (const k of kinds) {
    const def = OSM_KINDS[k], within = wants.get(k);
    const features = [];
    for (const el of els) {
      const t = el.tags || {};
      if (!def.match(t)) continue;
      const geometry = elementGeometry(el, def.line);
      if (!geometry) continue;
      let d;
      try { d = geometryDistanceKm(site.geometry, geometry); } catch { continue; }
      if (d == null || d > within + 1e-9) continue;
      const name = t.name || t["name:en"] || def.name(t);
      const extra = Object.fromEntries(["voltage", "operator", "ref", "highway", "substance", "amenity", "usage"].filter((f) => t[f]).map((f) => [f, t[f]]));
      features.push({ name, distance_km: Math.round(d * 1000) / 1000, around_site: false, extra, geometry, coverage: null,
        osm: `${el.type}/${el.id}` });
    }
    features.sort((a, b) => a.distance_km - b.distance_km);
    // A road, railway or power line comes in many pieces, and homes in many patches: one row per name (or per
    // unnamed kind), at its nearest piece, so the count is of things, not segments.
    if (def.line || def.byName) {
      const seen = new Set();
      const kept = features.filter((f) => { const key = f.name.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
      features.length = 0; features.push(...kept);
    }
    out.set(k, { features, meta: { dataset: osmTitle(k), publisher: "OpenStreetMap contributors", licence: "ODbL 1.0 (© OpenStreetMap contributors)", checked_at: checkedAt, capped, fetched_km: within } });
  }
  return out;
}
const PLURAL = { "power line": "power lines", substation: "substations", pipeline: "pipelines", "main road": "main roads", railway: "railways", aerodrome: "aerodromes",
  "wind turbine": "wind turbines", homes: "residential land", school: "schools", "health care": "hospitals, clinics and care homes" };
export const osmTitle = (kind) => `OpenStreetMap: ${PLURAL[kind] || kind} (completeness varies)`;
