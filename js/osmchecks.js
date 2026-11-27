// OpenStreetMap as a check source (24 Nov, coverage drive): infrastructure and community receptors anywhere in the
// world, where no national layer is in Tobler's data. One Overpass query per run for every OpenStreetMap check that
// applies, each feature measured from the site's edge (js/nearness.js) and handed back in the same shape as an atlas
// layer's answer, so the checks count, band and list them like any other source. OpenStreetMap's completeness varies
// by place, so these checks are never must-checks and their line says where the data comes from. No DOM.
import * as turf from "./vendor/turf.js";
import { geometryDistanceKm } from "./datatools.js";
import { relationFieldsAll } from "./relation.js";

// The kinds a check can ask for (catalogue/checks.json "osm"). sel: Overpass selectors (the bbox is added);
// match: the same rule on a feature's tags, to sort one combined answer back into kinds; name: a fallback name.
export const OSM_KINDS = {
  "power line": { sel: ['way["power"="line"]'], match: (t) => t.power === "line", name: (t) => `Power line${t.voltage ? ` (${kv(t.voltage)})` : ""}`, line: true },
  substation: { sel: ['nwr["power"="substation"]'], match: (t) => t.power === "substation", name: (t) => `Substation${t.voltage ? ` (${kv(t.voltage)})` : ""}` },
  pipeline: { sel: ['way["man_made"="pipeline"]'], match: (t) => t.man_made === "pipeline", name: (t) => `${cap(t.substance || "")} pipeline`.trim(), line: true },
  "main road": { sel: ['way["highway"~"^(motorway|trunk|primary)$"]'], match: (t) => /^(motorway|trunk|primary)$/.test(t.highway || ""), name: (t) => t.ref || `${cap(t.highway)} road`, line: true },
  // B roads (Rob, 27 Nov): UK only, as the main roads check's second source. The UK tags B roads highway=secondary;
  // a minor B road tagged tertiary is missed, and the copy's tag sets can't match on a ref. copyOnly: from Tobler's
  // copy alone, never public Overpass (the first gate run: Overpass failed on all eight sites).
  "b road": { sel: ['way["highway"="secondary"]'], match: (t) => t.highway === "secondary", name: (t) => t.ref || "B road", line: true, copyOnly: true },
  railway: { sel: ['way["railway"="rail"]'], match: (t) => t.railway === "rail", name: () => "Railway", line: true },
  aerodrome: { sel: ['nwr["aeroway"="aerodrome"]'], match: (t) => t.aeroway === "aerodrome", name: () => "Aerodrome" },
  "wind turbine": { sel: ['node["power"="generator"]["generator:source"="wind"]'], match: (t) => t.power === "generator" && t["generator:source"] === "wind", name: () => "Wind turbine" },
  homes: { sel: ['nwr["landuse"="residential"]'], match: (t) => t.landuse === "residential", name: () => "Homes (residential land)", byName: true },
  school: { sel: ['nwr["amenity"~"^(school|kindergarten|college)$"]'], match: (t) => /^(school|kindergarten|college)$/.test(t.amenity || ""), name: (t) => cap(t.amenity) },
  "health care": { sel: ['nwr["amenity"~"^(hospital|clinic|nursing_home)$"]', 'nwr["social_facility"="nursing_home"]'],
    match: (t) => /^(hospital|clinic|nursing_home)$/.test(t.amenity || "") || t.social_facility === "nursing_home", name: (t) => (t.amenity === "hospital" ? "Hospital" : t.amenity === "clinic" ? "Clinic" : "Care home") },
  // For the area budget (developable area, 25 Nov): what's physically on the ground. Counted as things by kind, with
  // every piece kept for the budget's geometry.
  building: { sel: ['way["building"]'], match: (t) => !!t.building && t.building !== "no", name: () => "Buildings", byName: true },
  "water body": { sel: ['way["natural"="water"]', 'way["landuse"~"^(reservoir|basin)$"]'], match: (t) => t.natural === "water" || /^(reservoir|basin)$/.test(t.landuse || ""), name: (t) => cap(t.water || "water body") },
  watercourse: { sel: ['way["waterway"~"^(river|stream|canal|ditch|drain)$"]'], match: (t) => /^(river|stream|canal|ditch|drain)$/.test(t.waterway || ""), name: (t) => cap(t.waterway), line: true },
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
// multipolygon still counts, measured to its centre). box: one box for every kind, or a function kind → its own box
// (25 Nov: each kind only as far out as its own reach, so buildings on a site don't fill the limit with a town).
export const MAX_ELEMENTS = 4000;
// timeoutS: the server's own limit. Never shorter than the client will wait (a server still working after the
// client gave up wastes its capacity and our answer): 25 s for quick lookups, 50 s for patient study runs.
export function osmQuery(kinds, box, { timeoutS = 25 } = {}) {
  const bb = (x) => `(${x[1].toFixed(5)},${x[0].toFixed(5)},${x[3].toFixed(5)},${x[2].toFixed(5)})`;
  const boxOf = typeof box === "function" ? box : () => box;
  const stmts = kinds.flatMap((k) => (OSM_KINDS[k]?.sel || []).map((s) => `${s}${bb(boxOf(k))};`)).join("");
  return `[out:json][timeout:${timeoutS}];(${stmts})->.a;(node.a;way.a;);out geom qt ${MAX_ELEMENTS};rel.a;out center qt 400;`;
}

// An Overpass element as a geometry: a node a point, a way a line (or an area if closed and not a line kind), a
// relation its centre.
export function elementGeometry(el, isLine) {
  if (el.geojson) return el.geojson; // from Tobler's copy (js/osmsnapshot.js): already built, areas and relations whole
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
// snapshot(kinds, boxOf), if given, is Tobler's own copy (js/osmsnapshot.js), asked first: null means "not here" and
// a throw means it couldn't be read; either way query(q) runs an Overpass query (js/gazetteer.js overpassQuery:
// fallbacks, and "not answering" when all fail). meta.via says which answered; data_as_of is the copy's date.
// timeoutS: the Overpass server's own limit (osmQuery). onOverpass(): called just before Overpass is asked, so a run
// can say it's waiting on the public servers.
export async function osmAnswers({ wants, site, query, snapshot = null, timeoutS = 25, onOverpass = () => {}, now = () => new Date().toISOString() }) {
  const kinds = [...wants.keys()].filter((k) => OSM_KINDS[k]);
  const out = new Map();
  if (!kinds.length) return out;
  const boxOf = (k) => grownBox(site, wants.get(k));
  // The copy first, for the kinds it can answer; Overpass for the rest (or all, if the copy can't be read or the site
  // is outside it). Each kind says which answered it.
  const parts = []; // { kinds, json, via, source }
  let snapErr = null, left = kinds;
  if (snapshot) {
    try {
      const json = await snapshot(kinds, boxOf);
      if (json) {
        const served = Array.isArray(json.kinds) ? kinds.filter((k) => json.kinds.includes(k)) : kinds;
        if (served.length) parts.push({ kinds: served, json, via: "copy", source: { via: "copy", data_as_of: json.data_as_of || null, release: json.release || null } });
        left = kinds.filter((k) => !served.includes(k));
      }
    } catch (e) { snapErr = String(e.message || e); }
  }
  // A kind kept for the copy alone (copyOnly) never goes to Overpass: until the copy has it, it isn't checked.
  for (const k of left.filter((x) => OSM_KINDS[x].copyOnly)) {
    out.set(k, snapErr ? { not_checked: `Tobler's copy of OpenStreetMap couldn't be read (${snapErr.slice(0, 120)})` } : { not_checked: `${cap(PLURAL[k] || k)} aren't in Tobler's copy of OpenStreetMap yet`, not_in_copy: true });
  }
  left = left.filter((x) => !OSM_KINDS[x].copyOnly);
  if (left.length) {
    onOverpass();
    try { parts.push({ kinds: left, json: await query(osmQuery(left, boxOf, { timeoutS })), via: "overpass", source: { via: "overpass", ...(snapErr ? { copy_failed: snapErr.slice(0, 160) } : {}) } }); }
    catch (e) {
      const why = String(e.message || e).slice(0, 200);
      for (const k of left) out.set(k, { not_checked: snapErr ? `${snapErr.slice(0, 120)}; then ${why}` : why });
    }
  }
  const checkedAt = now();
  for (const { kinds: ks, json, via, source } of parts) answerKinds(ks, json, via, source);
  return new Map(kinds.filter((k) => out.has(k)).map((k) => [k, out.get(k)]));

  function answerKinds(ks, json, via, source) {
  const els = json?.elements || [];
  const capped = via === "copy" ? !!json.capped : els.filter((e) => e.type !== "relation").length >= MAX_ELEMENTS;
  for (const k of ks) {
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
    // unnamed kind), at its nearest piece, so the count is of things, not segments. The other pieces' shapes stay
    // with that row (parts), for the area budget; nothing else reads them.
    if (def.line || def.byName) {
      const seen = new Map();
      const kept = [];
      for (const f of features) {
        const key = f.name.toLowerCase();
        const k = seen.get(key);
        if (k) { (k.parts ||= []).push({ geometry: f.geometry, osm: f.osm }); continue; }
        seen.set(key, f); kept.push(f);
      }
      features.length = 0; features.push(...kept);
    }
    // How each sits against the site, the pieces of one thing taken together (js/relation.js).
    for (const f of features) Object.assign(f, relationFieldsAll(site.geometry, [f.geometry, ...(f.parts || []).map((x) => x.geometry)], f.distance_km));
    out.set(k, { features, meta: { dataset: via === "copy" ? copyTitle(k, source.data_as_of) : osmTitle(k), publisher: "OpenStreetMap contributors", licence: "ODbL 1.0 (© OpenStreetMap contributors)", checked_at: checkedAt, capped, fetched_km: within, ...source } });
  }
  }
}
const PLURAL = { "power line": "power lines", substation: "substations", pipeline: "pipelines", "main road": "main roads", "b road": "B roads", railway: "railways", aerodrome: "aerodromes",
  "wind turbine": "wind turbines", homes: "residential land", school: "schools", "health care": "hospitals, clinics and care homes",
  building: "buildings", "water body": "water bodies", watercourse: "rivers, streams and ditches" };
export const osmTitle = (kind) => `OpenStreetMap: ${PLURAL[kind] || kind} (completeness varies)`;
// From Tobler's copy, the title says how old the data is.
export const copyTitle = (kind, asOf) => osmTitle(kind).replace(/\)$/, `; Tobler's copy${asOf ? `, data as of ${String(asOf).slice(0, 10)}` : ""})`);
