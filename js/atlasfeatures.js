// Features near a point from the AI Living World Atlas: find the datasets that hold this kind of thing here,
// then fetch their features. Thousands of publishers' servers stand behind it, so no single outage
// (like OpenStreetMap's Overpass on 16 Nov) stops the search.
// The transport is injected: in the evaluation it calls the atlas MCP server with the key from the environment;
// in the page it goes through the Worker, which holds the key. No DOM, so it runs in both.
import * as turf from "./vendor/turf.js";
import { classifyLicence, licenceBlock } from "./licence.js";
import { candidate } from "./gazetteer.js";

// Tobler's feature types → the atlas's concepts, and an optional test on the feature's own type field.
export const ATLAS_CONCEPTS = {
  "solar farm": { concept: "power-plant", keep: /solar|photovoltaic|\bpv\b/i },
  "wind farm": { concept: "power-plant", keep: /wind/i, also: "offshore-wind-site" },
  "hydro or dam": { concept: "power-plant", keep: /hydro|dam|reservoir/i },
  "thermal power plant": { concept: "power-plant", keep: /coal|gas|oil|diesel|biomass|thermal|steam|combined/i },
  "power plant (any)": { concept: "power-plant" },
  "mine or quarry": { concept: "mineral-extraction" },
  "offshore platform": { concept: "oil-gas" },
  "port or terminal": { concept: "port-airport", keep: /port|terminal|harbour|harbor|jetty|wharf/i },
  "airport": { concept: "port-airport", keep: /airport|aerodrome|airfield/i },
  "settlement": { concept: "settlement" },
  "school": { concept: "school" },
  "hospital or clinic": { concept: "health-facility" },
  "park or green space": { concept: "greenspace", geom: "area" },
  "main road": { concept: "road", geom: "line" },
  "railway": { concept: "rail", geom: "line" },
  "river": { concept: "river", geom: "line" },
  "pipeline": { concept: "pipeline", geom: "line" },
  "power line": { concept: "power-line", geom: "line" },
  "protected area": { concept: "protected-area", geom: "area" },
  "heritage site": { concept: "heritage-site" },
};

// The atlas's publisher types for official bodies: "central-gov", "local-gov", "public-body", "intergovernmental"…
const AUTHORITATIVE = /gov|public-body|intergov|regulator|mapping-agency/i;
const NAME_KEYS = /^(name|site_?name|plant_?name|plant___project_name|project_?name|mine_?name|facility_?name|dep_?name|title|label|nom|nombre|naam|bezeichnung)$/i;
const NAMEISH = /name|project|plant|site|mine|facility|title|^ref$|road_?num|roadnumber|route/i;
const TYPEISH = /^(type|.*_?type|commod.*|fuel|technology|source|status|primary_fuel|dep_type)$/i;

// Fields that hold who made or supplied the data, not what the feature is: never a name (Rosebank, 17 Nov: habitat
// polygons labelled "JNCC" and "PC, JNCC" from a project/source column). Short all-capital codes are skipped too.
const NOT_A_NAME = /source|provider|supplier|owner|origin|author|contact|licen[cs]|copyright|dataset|survey|contract|organi[sz]ation|agency|publisher|citation|metadata|surveyor|data_?set|contractor/i;
const CODE_LIKE = /^[A-Z0-9&/,.\s-]{1,12}$/;
const ROADISH = /road|route|^ref$|num/i; // road numbers ("M9") are names, however short
const DESCRIPTIVE = /habitat|hab_?(type|name|desc)|feature|class|designat|category|descr|description|sitetype|eunis/i;
const usable = (k, v) => typeof v === "string" && v.trim() && v.length < 120 && !NOT_A_NAME.test(k);

export function pickName(p) {
  const k = Object.keys(p).find((k) => NAME_KEYS.test(k) && usable(k, p[k]))
    || Object.keys(p).find((k) => NAMEISH.test(k) && usable(k, p[k]) && (ROADISH.test(k) || !CODE_LIKE.test(p[k].trim())))
    || Object.keys(p).find((k) => DESCRIPTIVE.test(k) && usable(k, p[k]) && !CODE_LIKE.test(p[k].trim()) && p[k].length < 80);
  return k ? p[k].trim() : null;
}
// A publisher's name made readable, never reworded (24 Nov): a space after each comma, and a name written all in
// capitals ("BLACKNESS ROAD, BOGHALL LODGE") put in title case, keeping short joining words lower case, Roman
// numerals and Mc names. Mixed-case names keep their own capitals.
const SMALL = new Set(["of", "and", "the", "in", "on", "at", "to", "for", "by", "with", "de", "la", "le", "du", "des", "van", "von", "upon"]);
export function tidyName(s) {
  if (s == null) return s;
  let t = String(s).replace(/\s+/g, " ").replace(/\s*,\s*(?=\S)/g, ", ").trim();
  const letters = t.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 4 && letters === letters.toUpperCase()) {
    let first = true;
    t = t.toLowerCase().replace(/[a-z0-9'’]+/g, (w) => {
      const lead = first; first = false;
      if (/^(i{1,3}|iv|v|vi{1,3}|ix|x)$/.test(w) && !(w === "i" && lead)) return w.toUpperCase();
      if (!lead && SMALL.has(w)) return w;
      const c = w.charAt(0).toUpperCase() + w.slice(1);
      return /^Mc[a-z]/.test(c) ? `Mc${c.charAt(2).toUpperCase()}${c.slice(3)}` : c;
    });
  }
  return t;
}

export function pickType(p) {
  return Object.entries(p).filter(([k, v]) => TYPEISH.test(k) && typeof v === "string" && v.trim() && v.length < 80).map(([, v]) => v).slice(0, 2).join(", ");
}

// Distance from a point to a feature: 0 inside an area, else to its nearest edge or line; to the point itself for points.
export function edgeDistanceKm(lonlat, geometry) {
  const f = { type: "Feature", properties: {}, geometry };
  try {
    if (/Polygon/.test(geometry.type)) {
      if (turf.booleanPointInPolygon(lonlat, f)) return 0;
      // Every ring (outer and holes) as its own line: turf gives a polygon with holes as a MultiLineString, which
      // pointToLineDistance can't take (it used to fail, so such features went unmeasured).
      const rings = geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
      return Math.min(...rings.filter((r) => r.length > 1).map((r) => turf.pointToLineDistance(lonlat, turf.lineString(r), { units: "kilometers" })));
    }
    if (geometry.type === "LineString") return turf.pointToLineDistance(lonlat, f, { units: "kilometers" });
    if (geometry.type === "MultiLineString") return Math.min(...geometry.coordinates.map((c) => turf.pointToLineDistance(lonlat, turf.lineString(c), { units: "kilometers" })));
  } catch { /* fall through */ }
  return null;
}

// ---- choosing layers -------------------------------------------------------------------------
// One picker for both searches ("features near" and "find this named thing"), so a fix to which layers get
// asked helps both. Layers of the right recorded geometry come first, then those whose geometry isn't recorded;
// for those, titles stand in: a road search shouldn't spend its budget on junction or camera points (the M9 on
// 17 Nov found only junctions).
const POINTY = /junction|node|\bpoints?\b|label|sign|camera|counter|count site|station|\bstops?\b|collision|accident|crossing|vertices|vertex|marker|milepost|annotation|centroid|gritting|lamp/i;

function authorityRank(d) {
  const t = d.publisher_type || "";
  return (/central-gov|regional-gov|public-body|intergov|national|regulator|mapping-agency/i.test(t) ? 0
    : /curated|academic|ngo|research/i.test(t) ? 1 : /local-gov/i.test(t) ? 2 : 3)
    + (d.coverage === "global" && /local|city|unknown/i.test(t || "unknown") ? 2 : 0);
}

// finds: find_datasets results. Returns layers in the order to ask them, plus how many matched in all.
// National and intergovernmental bodies first (NatureScot's SSSIs before a council's copy), then curated and
// academic collections, then local bodies and unknown publishers, whose "global" extents are often wrong
// (San José traffic signals came up for the M9). "regional-gov" covers devolved governments and their agencies
// (NatureScot, Natural Resources Wales): treat them like national bodies (Linlithgow SSSIs, 17 Nov).
// Layers whose titles suggest the wrong kind of geometry, or (for a named search) the wrong kind of thing,
// go after the rest; they're still asked if the budget allows. Within a group the atlas's own order (fit) stands.
// The atlas records each layer's geometry where the service says it (ArcGIS does; most WFS don't), and filters on it.
const serverGeometry = (geom) => (geom === "line" ? { geometry: "line" } : geom === "area" ? { geometry: "polygon" } : {});
const WANT = { line: ["line", "polygon"], area: ["polygon"] };
const wrongGeometry = (d, geom) => Array.isArray(d.geometry) && d.geometry.length > 0 && WANT[geom] && !d.geometry.some((g) => WANT[geom].includes(g));

export function pickLayers(finds, { geom = null, titles = null, allow = {} } = {}) {
  const seen = new Set();
  // Layers flagged with a possibly overstated extent are usually local layers claiming the world: skip them.
  const left_out = [];
  const all = finds.flatMap((f) => f.results || []).filter((d) => !d.extent_may_be_overstated)
    .filter((d) => { const k = `${d.title}|${d.publisher}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    // The licence rule (Esri's Master License Agreement, non-commercial terms) applies to every search, not only find_data.
    .filter((d) => { const why = licenceBlock(classifyLicence(d.licence).class, allow); if (why) left_out.push({ title: d.title, why }); return !why; });
  const rank = (d) => authorityRank(d)
    + (geom && geom !== "point" && (wrongGeometry(d, geom) || (!d.geometry?.length && POINTY.test(d.title || ""))) ? 4 : 0)
    + (geom && geom !== "point" && !d.geometry?.length ? 1 : 0)
    + (titles && !titles.test(`${d.title} ${d.publisher}`) ? 3 : 0);
  all.forEach((d, i) => { d._i = i; });
  all.sort((x, y) => rank(x) - rank(y) || x._i - y._i);
  const unlisted = Math.max(0, finds.reduce((n, f) => n + (f.matches || 0), 0) - finds.reduce((n, f) => n + (f.results || []).length, 0));
  return { layers: all, unlisted, left_out };
}

// Does a feature's geometry suit what's wanted? A road corridor needs lines; a block or lease needs an outline.
export function geometryFits(geometry, geom) {
  if (!geom || !geometry) return true;
  if (geom === "line") return /LineString|Polygon/.test(geometry.type);
  if (geom === "area") return /Polygon/.test(geometry.type);
  return true;
}

// Ask layers in batches until there's enough or the time runs out. ask(d) → { returned, kept, wrong_geometry } or throws.
// Returns the checked list and how many layers were left unasked.
async function askInBatches(layers, ask, { first = 10, then = 10, max = 40, budgetMs = 30000, layerMs = 8000, enough = () => false } = {}) {
  const t0 = Date.now();
  const checked = [];
  let i = 0;
  while (i < layers.length && i < max) {
    const size = i === 0 ? first : then;
    const batch = layers.slice(i, Math.min(i + size, max));
    i += batch.length;
    // Each layer gets layerMs: a slow server is reported as too slow rather than holding up the batch.
    // Whatever it sends later is ignored (late), so results don't change after the reply has gone.
    await Promise.all(batch.map(async (d) => {
      let late = false;
      const timer = new Promise((ok) => setTimeout(() => { late = true; ok("late"); }, layerMs));
      try {
        const r = await Promise.race([ask(d, () => late), timer]);
        checked.push(r === "late" ? { dataset: d.title, publisher: d.publisher, error: `too slow (no answer in ${layerMs / 1000} s)`, slow: true } : { dataset: d.title, publisher: d.publisher, ...r });
      } catch (e) { checked.push({ dataset: d.title, publisher: d.publisher, error: String(e.message || e).slice(0, 120) }); }
    }));
    if (enough() || Date.now() - t0 > budgetMs) break;
  }
  return { checked, unasked: layers.length - i };
}

export function atlasCandidate(f, d, name) {
  return candidate({
    name, type: pickType(f.properties || {}) || d.title, geometry: f.geometry,
    source: { id: "atlas", atlas_id: d.id, title: d.title, publisher: d.publisher, publisher_type: d.publisher_type,
      authoritative: AUTHORITATIVE.test(d.publisher_type || ""), licence: d.licence || "not stated" },
    extra: {},
  });
}

// What the model is told about the layers asked: the ones that found something by name, the failures by name
// (a few), the rest as counts. The full list stays in the trace for the person; the model doesn't need it.
const label = (x) => `${x.dataset} (${x.publisher})`;
export function describeChecked(list) {
  const hits = list.filter((x) => !x.error && (x.kept ?? x.returned) > 0);
  const failed = list.filter((x) => x.error && !x.slow);
  const slow = list.filter((x) => x.slow);
  const wrong = list.reduce((n, x) => n + (x.wrong_geometry || 0), 0);
  return {
    asked: list.length,
    found_in: hits.map((x) => `${label(x)}: ${x.kept ?? x.returned}`),
    nothing_in: list.length - hits.length - failed.length - slow.length,
    ...(failed.length ? { failed: failed.slice(0, 5).map(label), ...(failed.length > 5 ? { more_failed: failed.length - 5 } : {}) } : {}),
    ...(slow.length ? { too_slow: slow.length } : {}),
    ...(wrong ? { skipped_wrong_geometry: wrong } : {}),
  };
}

// call(tool, args) → structuredContent. Returns { candidates, total, checked: [ { dataset, publisher, returned | error } ] }.
export async function atlasFeaturesNear(lonlat, featureType, radiusKm, { call, name = null, limit = 15, maxDatasets = 20, budgetMs = 30000, allow = {} } = {}) {
  const map = ATLAS_CONCEPTS[featureType];
  if (!map) return null; // not a kind of thing the atlas indexes; OpenStreetMap only
  const r = Math.min(Math.max(radiusKm, 0.5), 50);
  const finds = await Promise.all([map.concept, map.also].filter(Boolean).map((concept) =>
    call("find_datasets", { lon: lonlat[0], lat: lonlat[1], radius_km: r, concept, capability: "query", limit: 100, ...serverGeometry(map.geom) }).catch(() => ({ results: [] }))));
  const { layers, unlisted, left_out } = pickLayers(finds, { geom: map.geom, allow });
  const cands = [];
  let fitting = 0;
  const ask = async (d, isLate) => {
    const g = await call("fetch_features", { id: d.id, lon: lonlat[0], lat: lonlat[1], radius_km: r, limit: 100, ...(name ? { text: name } : {}) });
    if (isLate()) return null;
    let kept = 0, wrong = 0;
    for (const f of g.features || []) {
      if (!f.geometry) continue;
      const p = f.properties || {};
      if (map.keep && !map.keep.test(`${pickType(p)} ${d.title}`)) continue;
      // A name filter matches any text attribute: road numbers ("M9") often sit in their own field.
      if (name && !Object.values(p).some((v) => typeof v === "string" && v.toLowerCase().includes(name.toLowerCase()))) continue;
      if (!geometryFits(f.geometry, map.geom)) { wrong++; continue; }
      let c;
      try { c = atlasCandidate(f, d, pickName(p)); } catch { continue; }
      c.distance_km = Math.round(turf.distance(lonlat, c.lonlat) * 100) / 100;
      const edge = edgeDistanceKm(lonlat, f.geometry);
      if (edge != null) { c.edge_km = Math.round(edge * 100) / 100; if (c.edge_km === 0) c.contains_anchor = true; }
      if ((c.edge_km ?? c.distance_km) > r) continue;
      c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
      cands.push(c); kept++;
    }
    fitting += kept;
    return { returned: g.returned, kept, ...(wrong ? { wrong_geometry: wrong } : {}) };
  };
  // The first batch is wide, for a complete answer to "what's near here"; later batches only run if nothing
  // of the right geometry turned up yet.
  const { checked, unasked } = await askInBatches(layers, ask, { first: maxDatasets, then: 10, max: maxDatasets + 20, budgetMs, enough: () => fitting > 0 });
  // The same feature often appears in more than one layer (keep one per name within 1 km), and one site can come
  // in pieces within a layer (the Firth of Forth Ramsar site): keep its nearest piece and count the rest.
  const near = (c) => c.edge_km ?? c.distance_km;
  cands.sort((a, b) => near(a) - near(b));
  const seen = [];
  const uniq = cands.filter((c) => {
    const dup = seen.find((s) => s.name && c.name && s.name.toLowerCase() === c.name.toLowerCase()
      && (s.source.atlas_id === c.source.atlas_id || turf.distance(s.lonlat, c.lonlat) < 1));
    if (dup) {
      if (dup.source.atlas_id === c.source.atlas_id) {
        // A road or river comes in many short pieces: join them, so a corridor follows the whole stretch found
        // (the M9 corridor used one piece of 13, 17 Nov). Areas in pieces are counted instead.
        if (/LineString/.test(dup.geometry.type) && /LineString/.test(c.geometry.type)) {
          const parts = (g) => (g.type === "LineString" ? [g.coordinates] : g.coordinates);
          dup.geometry = { type: "MultiLineString", coordinates: [...parts(dup.geometry), ...parts(c.geometry)] };
          dup.length_km = Math.round(((dup.length_km || 0) + (c.length_km || 0)) * 100) / 100;
          dup.extra.pieces_joined = (dup.extra.pieces_joined || 1) + 1;
        } else dup.extra.more_pieces = (dup.extra.more_pieces || 0) + 1;
      }
      return false;
    }
    seen.push(c);
    return true;
  });
  uniq.sort((a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || a.distance_km - b.distance_km);
  return { candidates: uniq.slice(0, limit), total: uniq.length, checked, datasets_found: layers.length, layers_not_checked: unasked + unlisted, left_out };
}

// ---- finding a named thing in the catalogue ---------------------------------------------------
// Kinds of named thing → the atlas concepts that hold them, words expected in a suitable layer's title, and
// the geometry wanted. "OML 145 offshore Nigeria" is a licence block: look for licence layers covering Nigeria
// and its waters, and search them for the name.
export const NAMED_KINDS = {
  "licence block or concession": { concepts: ["oil-gas", "mineral-extraction", "maritime-boundary"], titles: /block|licen[cs]|concession|lease|permit|tenement|title|acreage|oml|opl|award|round/i, geom: "area" },
  // Outlines preferred, points accepted: global trackers (Global Energy Monitor) hold fields as points, and a field
  // missing from a national layer may be there (Bonga North and Bonga Southwest Aparo, 18 Nov).
  "oil or gas field": { concepts: ["oil-gas"], titles: /field|discover|reservoir|accumulation|extraction/i, prefer: "area", trackers: true },
  "well": { concepts: ["oil-gas"], titles: /well|borehole/i },
  "offshore installation": { concepts: ["oil-gas"], titles: /platform|installation|infrastructure|facilit|structure/i },
  "wind farm or lease": { concepts: ["offshore-wind-site", "power-plant", "renewable-potential"], titles: /wind|lease|agreement|site|zone/i, prefer: "area", trackers: true },
  "power plant": { concepts: ["power-plant"], trackers: true },
  "mine or quarry": { concepts: ["mineral-extraction"], trackers: true },
  "protected area": { concepts: ["protected-area"], geom: "area" },
  "heritage site": { concepts: ["heritage-site"] },
  "admin area": { concepts: ["admin-boundary"], geom: "area" },
  "park or green space": { concepts: ["greenspace", "tourism-recreation"], geom: "area" },
  "road": { concepts: ["road"], geom: "line" },
  "railway": { concepts: ["rail"], geom: "line" },
  "river": { concepts: ["river"], geom: "line" },
  "pipeline": { concepts: ["pipeline"], geom: "line" },
  "port or airport": { concepts: ["port-airport"] },
};

// Every word of the name must appear in the feature's text: "OML 145" matches { type: "OML", number: "145" }
// and "OML145". Short numbers must match whole ("145" isn't "1450").
export function nameMatches(props, name) {
  const text = Object.values(props).filter((v) => typeof v === "string" || typeof v === "number").map(String).join(" | ").toLowerCase();
  const squash = (s) => s.replace(/[^a-z0-9]/g, "");
  const sq = squash(name.toLowerCase());
  if (sq.length >= 4 && new RegExp(`${/^\d/.test(sq) ? "(?<!\\d)" : ""}${sq}${/\d$/.test(sq) ? "(?!\\d)" : ""}`).test(squash(text))) return true;
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[^a-z0-9]/g, "")}([^a-z0-9]|$)`).test(text));
}
// The part to send to the server: the longest word with a digit in it, else the longest word.
const serverText = (name) => {
  const w = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return (w.filter((x) => /\d/.test(x)).sort((a, b) => b.length - a.length)[0]) || w.sort((a, b) => b.length - a.length)[0] || name;
};

// names: one name or several spellings of it. bbox: [w, s, e, n]. Returns { candidates, checked, layers_found, layers_not_checked }.
export async function atlasFindNamed(names, kind, bbox, { call, limit = 8, max = 40, budgetMs = 25000, layerMs = 8000, allow = {} } = {}) {
  const k = NAMED_KINDS[kind];
  if (!k) throw new Error(`Unknown kind. Use one of: ${Object.keys(NAMED_KINDS).join(", ")}.`);
  names = (Array.isArray(names) ? names : [names]).filter(Boolean);
  const finds = await Promise.all(k.concepts.map((concept) =>
    call("find_datasets", { bbox, concept, capability: "query", limit: 100, ...serverGeometry(k.geom) }).catch(() => ({ results: [] }))));
  const { layers, unlisted, left_out } = pickLayers(finds, { geom: k.geom, titles: k.titles, allow });
  const cands = [];
  // One server-side search per distinct distinctive word ("145" serves both "OML 145" and "Oil Mining Lease 145").
  const texts = [...new Set(names.map(serverText))];
  const ask = async (d, isLate) => {
    const got = await Promise.all(texts.map((text) => call("fetch_features", { id: d.id, bbox, limit: 50, text })));
    if (isLate()) return null;
    let kept = 0, wrong = 0, returned = 0;
    const seenHere = new Set();
    for (const g of got) {
      returned += g.returned || 0;
      for (const f of g.features || []) {
        const key = JSON.stringify(f.properties || {});
        if (!f.geometry || seenHere.has(key) || !names.some((n) => nameMatches(f.properties || {}, n))) continue;
        seenHere.add(key);
        if (!geometryFits(f.geometry, k.geom)) { wrong++; continue; }
        let c;
        try { c = atlasCandidate(f, d, pickName(f.properties || {}) || names[0]); } catch { continue; }
        c.extra = Object.fromEntries(Object.entries(f.properties || {}).filter(([, v]) => (typeof v === "string" && v.trim() && v.length < 80) || typeof v === "number").slice(0, 8));
        cands.push(c); kept++;
      }
    }
    return { returned, kept, ...(wrong ? { wrong_geometry: wrong } : {}) };
  };
  // For kinds global trackers also hold (fields, plants, mines, wind farms), stop once matches come from two layers or
  // after a second batch: a match in one national layer (Bonga Main) shouldn't hide namesakes held elsewhere (Global
  // Energy Monitor's Bonga North), which the person then chooses between. Other kinds stop at the first match
  // (Linlithgow Loch took 14 s instead of 3 with the extra batch).
  let batches = 0;
  const enough = () => { batches++; return cands.length > 0 && (!k.trackers || new Set(cands.map((c) => c.source.atlas_id)).size >= 2 || batches >= 2); };
  const { checked, unasked } = await askInBatches(layers, ask, { first: 10, then: 10, max, budgetMs, layerMs, enough });
  // Layers whose titles fit the kind come first, so a match there outranks one from an unrelated layer; then
  // outlines before points where outlines are preferred.
  const off = (c) => (k.titles && !k.titles.test(c.source.title) ? 1 : 0);
  const pointy = (c) => (k.prefer === "area" && !/Polygon/.test(c.geometry?.type || "") ? 1 : 0);
  cands.sort((a, b) => off(a) - off(b) || pointy(a) - pointy(b) || authorityRank(a.source) - authorityRank(b.source));
  return { candidates: cands.slice(0, limit), checked, layers_found: layers.length, layers_not_checked: unasked + unlisted, left_out };
}
