// Finding places and features by name: the "anchors" that areas are built around.
// Sources: authoritative named-feature layers listed in catalogue/anchors.json (from the atlas),
// OpenStreetMap through Nominatim, Natural Earth towns, and OpenStreetMap features near a point (Overpass).
// No DOM, so it runs in the page and in the evaluation. fetchFn is injectable for tests and for Node.
import * as turf from "./vendor/turf.js";
import { atlasFeaturesNear, ATLAS_CONCEPTS, describeChecked } from "./atlasfeatures.js";
import { osmSnapshot } from "./osmsnapshot.js";
import { nearestKm } from "./nearness.js";

const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

// Searches are remembered for the session, so a re-run or a follow-up doesn't ask the same server again.
const memo = new Map();
const remembered = (key, fn) => {
  if (!memo.has(key)) memo.set(key, fn().catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
};

// The public Overpass servers, and one request to one of them. (Moved from the lab's js/tools.js on 25 Nov.)
export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

export async function fetchOverpass(query, endpoint = OVERPASS_ENDPOINTS[0], fetchFn = fetch, timeoutMs = 100000, extraHeaders = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetchFn(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...extraHeaders },
      body: "data=" + encodeURIComponent(query),
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(e.name === "AbortError" ? `timed out after ${timeoutMs / 1000} s` : e.message);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Overpass ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = await res.json();
  // Overpass can answer 200 with a partial result and a "remark" when a query times out or runs out of memory.
  if (json.remark && /error|timeout|timed out|out of memory|capacity/i.test(json.remark)) throw new Error(`Overpass: ${json.remark.slice(0, 200)}`);
  return json;
}

// Overpass: ask the server that answered last time; if it hasn't answered in a few seconds, ask the next one too,
// and so on (a staggered start, so a healthy server isn't asked three times). Two speeds:
// - quick (a conversation's lookups): gives up after 15 s, servers 4 s apart. If every server fails, later quick
//   lookups say so at once for two minutes (the "down" latch) rather than keep the person waiting.
// - patient (sealed study runs, 25 Nov): up to 55 s, servers 10 s apart, because the eval fetch log has good answers
//   at 50–60 s and a run has no one waiting on each step. The latch doesn't stop it: it makes a real attempt. If every
//   server fails fast (a 429 or 504 in seconds) and time is left, it waits 5 s and tries once more.
export const OVERPASS_SPEEDS = {
  quick: { budgetMs: 15000, staggerMs: 4000, rounds: 1, pauseMs: 0, minRetryMs: 0 },
  patient: { budgetMs: 55000, staggerMs: 10000, rounds: 2, pauseMs: 5000, minRetryMs: 15000 },
};
let fastest = 0;
let overpassDownUntil = 0;
export class ServiceDown extends Error {}
export const overpassLatched = () => Date.now() < overpassDownUntil;
export function resetOverpass() { fastest = 0; overpassDownUntil = 0; memo.clear(); } // for tests
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function overpass(q, fetchFn, headers, { patient = false } = {}) {
  if (!patient && overpassLatched()) throw new ServiceDown("OpenStreetMap's Overpass service isn't answering right now (all three public servers failed a moment ago).");
  const speed = OVERPASS_SPEEDS[patient ? "patient" : "quick"];
  return remembered(`overpass:${patient ? "p" : "q"}:${q}`, async () => {
    let lastErr;
    const t0 = Date.now();
    const left = () => speed.budgetMs - (Date.now() - t0);
    for (let round = 0; round < speed.rounds; round++) {
      if (round) { if (left() < speed.minRetryMs) break; await sleep(speed.pauseMs); }
      // The next server is asked after the stagger, or at once if every server asked so far has already failed
      // (a 429 or a refused connection says nothing about whether the next one is busy).
      const tries = [];
      for (let k = 0; k < OVERPASS_ENDPOINTS.length; k++) tries.push((async (earlier) => {
        const i = (fastest + k) % OVERPASS_ENDPOINTS.length;
        if (k) await Promise.race([sleep(speed.staggerMs * k), Promise.any(earlier).then(() => new Promise(() => {}), () => {})]);
        const ms = left();
        if (ms < 2000) throw new Error("out of time");
        try { const j = await fetchOverpass(q, OVERPASS_ENDPOINTS[i], fetchFn, ms, headers); return { j, i }; }
        catch (e) { lastErr = e; throw e; }
      })(tries.slice()));
      try {
        const { j, i } = await Promise.any(tries);
        fastest = i; overpassDownUntil = 0; return j;
      } catch { /* every server failed this round */ }
    }
    overpassDownUntil = Date.now() + 120000;
    const secs = Math.round((Date.now() - t0) / 1000);
    throw new ServiceDown(`OpenStreetMap's Overpass service isn't answering right now (all three public servers failed within ${secs} s; last: ${lastErr?.message}).`);
  });
}

// For the checks' OpenStreetMap source (js/osmchecks.js): the same servers, fallbacks and "not answering" note.
// options.patient: a sealed study run's longer wait (OVERPASS_SPEEDS).
export const overpassQuery = (q, fetchFn = globalThis.fetch, headers = {}, options = {}) => overpass(q, fetchFn, headers, options);

// A candidate keeps its full geometry here; the model only ever sees a compact description.
export function candidate({ name, type, geometry, source, extra = {} }) {
  const f = { type: "Feature", properties: {}, geometry };
  const at = geometry.type === "Point" ? geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates;
  const c = { name, type, geometry, source, extra, lonlat: at.map((v) => round(v, 5)) };
  if (/Polygon/.test(geometry.type)) c.area_km2 = round(turf.area(f) / 1e6, 3);
  if (/LineString/.test(geometry.type)) c.length_km = round(turf.length(f), 2);
  return c;
}

// ---- authoritative layers from the atlas -------------------------------------------------
export const BLOCK_REF = /\b(\d{1,3})\s*\/\s*(\d{1,2})([a-z])?\b/i;

const esc = (s) => String(s).replace(/'/g, "''").toUpperCase();
const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export async function searchAnchors(sources, term, { near = null, fetchFn = fetch, limit = 8 } = {}) {
  const out = [];
  const block = term.match(BLOCK_REF);
  for (const s of sources) {
    if (near && !intersects(s.coverage, [near[0] - 2, near[1] - 2, near[0] + 2, near[1] + 2])) continue;
    let where;
    if (s.search === "block_ref") {
      if (!block) continue;
      where = `${s.name_field} = '${block[1]}/${block[2]}'`;
    } else {
      // Search on the distinctive name: drop words that describe the kind of thing.
      const words = term.replace(BLOCK_REF, "").replace(/\b(offshore|onshore|wind ?farms?|wind|farm|project|site|lease|area|platform|gas|oil|field|installation|fpso|the)\b/gi, " ").replace(/\s+/g, " ").trim();
      if (words.length < 3) continue;
      where = `UPPER(${s.name_field}) LIKE '%${esc(words)}%'`;
    }
    if (s.where) where = `(${where}) AND ${s.where}`;
    const fields = [s.name_field, s.type_field, ...(s.extra_fields || [])].filter(Boolean).join(",");
    const url = `${s.url}/query?where=${encodeURIComponent(where)}&outFields=${fields}&outSR=4326&f=geojson&resultRecordCount=${limit}`;
    try {
      const r = await fetchFn(url);
      if (!r.ok) throw new Error(`${r.status}`);
      const j = await r.json();
      for (const f of j.features || []) {
        if (!f.geometry) continue;
        const p = f.properties || {};
        out.push(candidate({
          name: p[s.name_field], type: [s.kind, p[s.type_field]].filter(Boolean).join(": "), geometry: f.geometry,
          source: { id: s.id, title: s.title, publisher: s.publisher, licence: s.licence || "not stated", url: s.landing_page, atlas_id: s.atlas_id },
          extra: {
            ...Object.fromEntries((s.extra_fields || []).map((k) => [k, p[k]]).filter(([, v]) => v != null && String(v).trim())),
            ...(s.search === "block_ref" && block[3] ? { note: `This layer has whole blocks only; part-block ${block[1]}/${block[2]}${block[3]} is a licensed subdivision of it.` } : {}),
          },
        }));
      }
    } catch (e) {
      out.push({ error: `${s.title}: ${e.message}` });
    }
  }
  return out;
}

// ---- OpenStreetMap: Nominatim ------------------------------------------------------------
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
let lastNominatim = 0;
let nominatimQueue = Promise.resolve();
// Nominatim's policy is at most one request a second. Searches can run side by side, so they queue here.
function nominatimSlot() {
  const slot = nominatimQueue.then(async () => {
    const wait = lastNominatim + 1100 - Date.now();
    if (wait > 0) await new Promise((ok) => setTimeout(ok, wait));
    lastNominatim = Date.now();
  });
  nominatimQueue = slot.catch(() => {});
  return slot;
}

export async function searchNominatim(term, { near = null, country = null, fetchFn = fetch, limit = 6, headers = {} } = {}) {
  const q = new URLSearchParams({ q: term, format: "jsonv2", limit: String(limit), polygon_geojson: "1", polygon_threshold: "0.0005", addressdetails: "1" });
  if (country) q.set("countrycodes", country.toLowerCase());
  if (near) q.set("viewbox", [near[0] - 1, near[1] + 1, near[0] + 1, near[1] - 1].join(","));
  const j = await remembered(`nominatim:${q}`, async () => {
    await nominatimSlot();
    const r = await fetchFn(`${NOMINATIM}?${q}`, { headers });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    return r.json();
  });
  return j.map((x) => {
    // Towns and admin areas anchor on their centre ("5 km round Linlithgow" means from the town, not its edge),
    // but keep their outline for when the person asks for the area itself ("Fife").
    const isArea = x.category === "boundary" || x.category === "place";
    const poly = x.geojson && /Polygon/.test(x.geojson.type);
    const c = candidate({
      name: x.name || x.display_name.split(",")[0],
      type: `${x.category}: ${x.type}${x.addresstype && x.addresstype !== x.type ? ` (${x.addresstype})` : ""}`.replace(/_/g, " "),
      geometry: poly && !isArea ? x.geojson : { type: "Point", coordinates: [+x.lon, +x.lat] },
      source: { id: "osm-nominatim", title: "OpenStreetMap (Nominatim search)", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}` },
      extra: { place: x.display_name, country: x.address?.country, importance: round(x.importance || 0, 3) },
    });
    if (poly && isArea) { c.outline = x.geojson; c.extra.outline_km2 = round(turf.area({ type: "Feature", properties: {}, geometry: x.geojson }) / 1e6, 1); }
    return c;
  });
}

// ---- Natural Earth towns (already loaded for the reference layer) ------------------------------
// The settlement a point lies in or near, for naming a drawn shape ("Point near Linlithgow"). Nominatim's reverse
// lookup at village level, queued like every Nominatim call; null at sea or when nothing is named nearby.
export async function settlementNear(lonlat, { fetchFn = fetch, headers = {} } = {}) {
  const q = new URLSearchParams({ lat: lonlat[1].toFixed(5), lon: lonlat[0].toFixed(5), format: "jsonv2", zoom: "14", addressdetails: "1" });
  const j = await remembered(`nominatim-reverse:${q}`, async () => {
    await nominatimSlot();
    const r = await fetchFn(`https://nominatim.openstreetmap.org/reverse?${q}`, { headers });
    if (!r.ok) throw new Error(`Nominatim ${r.status}`);
    return r.json();
  });
  const a = j?.address || {};
  return a.village || a.town || a.city || a.hamlet || a.suburb || a.municipality || null;
}

export function searchNaturalEarth(places, term, limit = 5) {
  const t = term.toLowerCase().trim();
  return places
    .filter((p) => p.name && p.name.toLowerCase() === t)
    .sort((a, b) => b.pop - a.pop)
    .slice(0, limit)
    .map((p) => candidate({
      name: p.name, type: "populated place", geometry: { type: "Point", coordinates: [p.lon, p.lat] },
      source: { id: "natural-earth", title: "Natural Earth populated places", publisher: "Natural Earth", licence: "Public domain", url: "https://www.naturalearthdata.com/" },
      extra: { country: p.country, region: p.region, population: p.pop },
    }));
}

// ---- OpenStreetMap features of a kind near a point (Overpass) ---------------------------------
// Used to find the asset itself ("the solar farm north of Mocuba") once a town or feature anchors the search.
export const FEATURE_TYPES = {
  "solar farm": ['nwr["power"="plant"]["plant:source"="solar"]', 'way["power"="generator"]["generator:source"="solar"]'],
  "wind farm": ['nwr["power"="plant"]["plant:source"="wind"]', 'node["power"="generator"]["generator:source"="wind"]'],
  "hydro or dam": ['nwr["power"="plant"]["plant:source"="hydro"]', 'way["waterway"="dam"]', 'nwr["water"="reservoir"]'],
  "thermal power plant": ['nwr["power"="plant"]["plant:source"~"coal|gas|oil|diesel|biomass|biogas|waste"]'],
  "power plant (any)": ['nwr["power"="plant"]'],
  "substation": ['nwr["power"="substation"]'],
  "mine or quarry": ['nwr["landuse"="quarry"]', 'nwr["industrial"~"mine|mining"]', 'nwr["man_made"="mineshaft"]'],
  "port or terminal": ['nwr["landuse"="port"]', 'nwr["industrial"~"port|terminal|lng|oil"]', 'nwr["man_made"~"pier|jetty"]["name"]'],
  "offshore platform": ['nwr["man_made"="offshore_platform"]'],
  "industrial area": ['way["landuse"="industrial"]'],
  "airport": ['nwr["aeroway"="aerodrome"]'],
  "settlement": ['node["place"~"city|town|village|hamlet"]'],
  "school": ['nwr["amenity"~"^(school|kindergarten|college|university)$"]'],
  "hospital or clinic": ['nwr["amenity"~"^(hospital|clinic|doctors)$"]', 'nwr["healthcare"~"^(hospital|clinic|centre)$"]'],
  "place of worship": ['nwr["amenity"="place_of_worship"]'],
  "cemetery": ['nwr["landuse"="cemetery"]', 'nwr["amenity"="grave_yard"]'],
  "railway station": ['nwr["railway"~"^(station|halt)$"]'],
  "park or green space": ['nwr["leisure"~"^(park|nature_reserve|recreation_ground)$"]'],
  "residential area": ['way["landuse"="residential"]'],
  "main road": ['way["highway"~"^(motorway|trunk|primary)$"]'],
  "railway": ['way["railway"="rail"]'],
  "river": ['way["waterway"~"^(river|canal)$"]'],
  "pipeline": ['way["man_made"="pipeline"]'],
  "power line": ['way["power"="line"]'],
  "protected area": ['nwr["boundary"="protected_area"]', 'nwr["leisure"="nature_reserve"]'],
  "heritage site": ['nwr["heritage"]', 'nwr["historic"~"^(castle|monument|archaeological_site|ruins)$"]'],
};

// When Overpass is down, everyday features can still be found through Nominatim's search phrases.
const NOMINATIM_PHRASES = {
  "school": { q: ["school"], keep: /^(amenity: (school|kindergarten|college|university))$/ },
  "hospital or clinic": { q: ["hospital", "clinic"], keep: /^(amenity|healthcare): (hospital|clinic|doctors)$/ },
  "place of worship": { q: ["place of worship"], keep: /^amenity: place of worship$/ },
  "railway station": { q: ["railway station"], keep: /^railway: (station|halt)$/ },
  "park or green space": { q: ["park"], keep: /^leisure: (park|nature reserve|recreation ground)$/ },
  "cemetery": { q: ["cemetery"], keep: /^(landuse: cemetery|amenity: grave yard)$/ },
};

async function nearViaNominatim(lonlat, featureType, radiusKm, { fetchFn, headers, limit }) {
  const ph = NOMINATIM_PHRASES[featureType];
  const dLat = radiusKm / 111.32, dLon = radiusKm / (111.32 * Math.cos((lonlat[1] * Math.PI) / 180));
  const box = [lonlat[0] - dLon, lonlat[1] + dLat, lonlat[0] + dLon, lonlat[1] - dLat].join(",");
  const out = [];
  for (const q of ph.q) {
    const params = new URLSearchParams({ q, format: "jsonv2", limit: "40", viewbox: box, bounded: "1" });
    const j = await remembered(`nominatim:${params}`, async () => {
      await nominatimSlot();
      const r = await fetchFn(`${NOMINATIM}?${params}`, { headers });
      if (!r.ok) throw new Error(`Nominatim ${r.status}`);
      return r.json();
    });
    for (const x of j) {
      const type = `${x.category}: ${x.type}`.replace(/_/g, " ");
      if (!ph.keep.test(type)) continue;
      const c = candidate({
        name: x.name || null, type, geometry: { type: "Point", coordinates: [+x.lon, +x.lat] },
        source: { id: "osm-nominatim", title: "OpenStreetMap (Nominatim search, because Overpass was busy)", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${x.osm_type}/${x.osm_id}` },
        extra: { place: x.display_name },
      });
      c.distance_km = round(turf.distance(lonlat, c.lonlat), 2);
      c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
      if (c.distance_km <= radiusKm && !out.some((o) => o.source.url === c.source.url)) out.push(c);
    }
  }
  out.sort((a, b) => a.distance_km - b.distance_km);
  return { candidates: out.slice(0, limit), total: out.length, note: "Overpass was busy, so these came from Nominatim's search, which can miss unnamed or less prominent features." };
}

// ---- The same lookup through Tobler's copy of OpenStreetMap (js/osmsnapshot.js, 25 Nov) ----------------------
// Only for the feature types whose Overpass selectors the copy holds with the same tags; the rest (solar farms,
// mines, ports, universities, doctors…) aren't in the copy and go to Overpass as before. extra: a narrower tag test
// within the copy's kind. Two are deliberate supersets of the Overpass selector: residential areas and the
// aerodromes/substations also come as multipolygon relations, read whole (Overpass reads those ways only, or by
// their bounding box).
export const COPY_FEATURE_TYPES = {
  substation: { kind: "substation" },
  "main road": { kind: "main road" },
  railway: { kind: "railway" },
  pipeline: { kind: "pipeline" },
  "power line": { kind: "power line" },
  airport: { kind: "aerodrome" },
  "residential area": { kind: "homes" },
  river: { kind: "watercourse", extra: (t) => /^(river|canal)$/.test(t.waterway || "") },
};
// Fewer features per lookup than the checks read: a place search wants the nearest few, not every building.
const COPY_MAX_PER_GROUP = 5000;
const boxAround = ([lon, lat], km) => {
  const dy = km / 110.574, dx = km / (111.32 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));
  return [lon - dx, Math.max(-90, lat - dy), lon + dx, Math.min(90, lat + dy)];
};
// null when the copy can't answer this (switched off, a type it doesn't hold, or ground outside its outline);
// throws when it can't be read. Candidates carry the feature's real shape, so no outline fetch is needed later.
export async function findFeaturesNearCopy(lonlat, featureType, radiusKm, { name = null, limit = 15, snapshot = null } = {}) {
  const ft = COPY_FEATURE_TYPES[featureType];
  if (!ft || !snapshot) return null;
  const km = Math.min(Math.max(radiusKm, 0.5), 50);
  const box = boxAround(lonlat, km);
  const got = await snapshot([ft.kind], () => box);
  if (!got) return null;
  const nameRe = name ? new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  const pt = { type: "Point", coordinates: lonlat };
  const cands = [];
  for (const el of got.elements || []) {
    const t = el.tags || {};
    if (ft.extra && !ft.extra(t)) continue;
    if (nameRe && !nameRe.test(t.name || "")) continue;
    const geometry = el.geojson;
    if (!geometry) continue;
    const c = candidate({
      name: t.name || t["name:en"] || null, type: describeTags(t), geometry,
      source: { id: "osm-copy", title: `OpenStreetMap (Tobler's copy${got.data_as_of ? `, data as of ${String(got.data_as_of).slice(0, 10)}` : ""})`, publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${el.type}/${el.id}` },
      extra: pick(t, ["operator", "ref", "voltage", "substance"]),
    });
    let d = null;
    try { d = nearestKm(pt, geometry); } catch { /* measure to its point instead */ }
    if (d == null) d = turf.distance(lonlat, c.lonlat);
    if (d > km + 1e-9) continue; // the box's corners are further than the radius
    c.distance_km = round(d, 2);
    c.edge_km = c.distance_km;
    c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
    cands.push(c);
  }
  const bySize = /farm|hydro|power plant|mine|port|platform|industrial|airport/.test(featureType);
  cands.sort(bySize ? (a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || a.distance_km - b.distance_km : (a, b) => a.distance_km - b.distance_km);
  return { candidates: cands.slice(0, limit), total: cands.length, via: "copy", data_as_of: got.data_as_of || null,
    ...(got.capped ? { note: `Tobler's copy of OpenStreetMap stopped at ${COPY_MAX_PER_GROUP} features in this search, so some further away may be missing.` } : {}) };
}

// Asks the atlas and OpenStreetMap at the same time and merges what answers. Neither is required:
// whatever fails is reported as "not checked", never as "none found".
// osmCopy: Tobler's copy of OpenStreetMap (default: the configured one; null to skip it), asked before Overpass for
// the types it holds (COPY_FEATURE_TYPES). If the copy can't be read, Overpass, and the source line says so.
export async function findFeaturesNear(lonlat, featureType, radiusKm, { name = null, fetchFn = fetch, limit = 15, headers = {}, atlas = null, allow = {}, osmCopy } = {}) {
  const parts = FEATURE_TYPES[featureType];
  if (!parts) throw new Error(`Unknown feature type. Use one of: ${Object.keys(FEATURE_TYPES).join(", ")}.`);
  const copy = osmCopy !== undefined ? osmCopy : (COPY_FEATURE_TYPES[featureType] ? osmSnapshot({ maxPerGroup: COPY_MAX_PER_GROUP }) : null);
  const osmP = (async () => {
    let copyFailed = null;
    try {
      const got = await findFeaturesNearCopy(lonlat, featureType, radiusKm, { name, limit, snapshot: copy });
      if (got) return got;
    } catch (e) { copyFailed = String(e.message || e).slice(0, 160); }
    const withNote = (r) => (copyFailed ? { ...r, copy_failed: copyFailed } : r);
    try { return withNote(await findFeaturesNearOverpass(lonlat, featureType, radiusKm, { name, fetchFn, limit, headers })); }
    catch (e) {
      if (e instanceof ServiceDown && NOMINATIM_PHRASES[featureType] && !name) return withNote(await nearViaNominatim(lonlat, featureType, radiusKm, { fetchFn, headers, limit }));
      if (copyFailed) throw new Error(`${copyFailed}; then ${String(e.message || e).slice(0, 160)}`);
      throw e;
    }
  })();
  const atlasP = atlas && ATLAS_CONCEPTS[featureType]
    ? atlasFeaturesNear(lonlat, featureType, radiusKm, { call: atlas, name, limit, allow })
    : Promise.resolve(null);
  // Once the atlas has found something, OpenStreetMap gets 3 more seconds, not its full 15: when Overpass is
  // struggling, waiting it out was most of a search's time.
  const GRACE = 3000;
  const graceP = atlasP.then((v) => (v?.candidates?.length ? new Promise((ok) => setTimeout(() => ok("grace"), GRACE)) : new Promise(() => {})), () => new Promise(() => {}));
  const osmOrGrace = Promise.race([osmP, graceP]).then((v) => {
    if (v === "grace") throw new Error(`OpenStreetMap was still searching ${GRACE / 1000} s after the atlas answered, so it was skipped to save time`);
    return v;
  });
  const [osm, at] = await Promise.allSettled([osmOrGrace, atlasP]);
  const sources = [];
  const cands = [];
  if (at.status === "fulfilled" && at.value) {
    cands.push(...at.value.candidates);
    sources.push({ source: "AI Living World Atlas", found: at.value.total, layers_checked: describeChecked(at.value.checked),
      ...(at.value.layers_not_checked ? { more_layers_not_checked: at.value.layers_not_checked } : {}),
      ...(at.value.left_out?.length ? { left_out_for_licence: `${at.value.left_out.length} layer${at.value.left_out.length > 1 ? "s" : ""} (${at.value.left_out.slice(0, 2).map((x) => x.title).join("; ")}): ${at.value.left_out[0].why}` } : {}) });
  } else if (atlas && ATLAS_CONCEPTS[featureType]) sources.push({ source: "AI Living World Atlas", not_checked: String(at.reason?.message || at.reason || "unavailable").slice(0, 120) });
  if (osm.status === "fulfilled") {
    cands.push(...osm.value.candidates);
    sources.push({ source: osm.value.via === "copy" ? "OpenStreetMap (Tobler's copy)" : "OpenStreetMap", found: osm.value.total,
      ...(osm.value.data_as_of ? { data_as_of: String(osm.value.data_as_of).slice(0, 10) } : {}),
      ...(osm.value.note ? { note: osm.value.note } : {}), ...(osm.value.copy_failed ? { copy_failed: osm.value.copy_failed } : {}) });
  }
  else sources.push({ source: "OpenStreetMap", not_checked: String(osm.reason?.message || osm.reason).slice(0, 160) });
  if (!cands.length && osm.status === "rejected" && !(at.status === "fulfilled" && at.value)) throw osm.reason;
  const bySize = /farm|hydro|power plant|mine|port|platform|industrial|airport/.test(featureType);
  const near = (c) => c.edge_km ?? c.distance_km;
  cands.sort(bySize ? (a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || near(a) - near(b) : (a, b) => near(a) - near(b));
  return {
    candidates: cands.slice(0, limit), total: cands.length, sources,
    wind_turbines: osm.status === "fulfilled" ? osm.value.wind_turbines : undefined,
    ...(osm.status === "fulfilled" && osm.value.note ? { note: osm.value.note } : {}),
  };
}

async function findFeaturesNearOverpass(lonlat, featureType, radiusKm, { name, fetchFn, limit, headers }) {
  const parts = FEATURE_TYPES[featureType];
  const r = Math.min(Math.max(radiusKm, 0.5), 50) * 1000;
  const nameFilter = name ? `["name"~"${name.replace(/["\\]/g, "")}",i]` : "";
  // Tags and bounding boxes only: cheap enough not to time out over a wide radius. Outlines are fetched later,
  // only for the feature that's actually used (featureOutline).
  const q = `[out:json][timeout:14];(${parts.map((p) => `${p}${nameFilter}(around:${r},${lonlat[1]},${lonlat[0]});`).join("")});out tags bb 150;`;
  const json = await overpass(q, fetchFn, headers);
  const cands = [];
  let turbines = 0;
  for (const el of json.elements || []) {
    const t = el.tags || {};
    if (t["generator:source"] === "wind" && el.type === "node") { turbines++; continue; } // counted, not listed
    let geometry;
    if (el.type === "node") geometry = { type: "Point", coordinates: [el.lon, el.lat] };
    else if (el.bounds) geometry = turf.bboxPolygon([el.bounds.minlon, el.bounds.minlat, el.bounds.maxlon, el.bounds.maxlat]).geometry;
    if (!geometry) continue;
    const c = candidate({
      name: t.name || t["name:en"] || null, type: describeTags(t), geometry,
      source: { id: "osm-overpass", title: "OpenStreetMap (Overpass)", publisher: "OpenStreetMap contributors", licence: "ODbL 1.0", url: `https://www.openstreetmap.org/${el.type}/${el.id}` },
      extra: pick(t, ["operator", "plant:output:electricity", "start_date", "generator:output:electricity"]),
    });
    c.distance_km = round(turf.distance(lonlat, c.lonlat), 2);
    c.bearing = Math.round((turf.bearing(lonlat, c.lonlat) + 360) % 360);
    if (el.type !== "node") { c.osm = { type: el.type, id: el.id }; c.approx = true; c.extra.size = "area is of the bounding box until the outline is fetched"; }
    cands.push(c);
  }
  // Big assets: largest first (the mine or plant itself). Everything else: nearest first.
  const bySize = /farm|hydro|power plant|mine|port|platform|industrial|airport/.test(featureType);
  cands.sort(bySize ? (a, b) => (b.area_km2 || 0) - (a.area_km2 || 0) || a.distance_km - b.distance_km : (a, b) => a.distance_km - b.distance_km);
  return { candidates: cands.slice(0, limit), total: cands.length, wind_turbines: turbines || undefined };
}

const sameXY = (a, b) => a.lat === b.lat && a.lon === b.lon;

// The real outline of one OpenStreetMap way or relation, fetched when a place is built from it.
export async function featureOutline(osm, { fetchFn = fetch, headers = {} } = {}) {
  const json = await overpass(`[out:json][timeout:14];${osm.type}(${osm.id});out geom;`, fetchFn, headers);
  const el = json.elements?.[0];
  if (el?.type === "way" && el.geometry?.length > 3 && sameXY(el.geometry[0], el.geometry.at(-1))) return { type: "Polygon", coordinates: [el.geometry.map((p) => [p.lon, p.lat])] };
  if (el?.type === "way" && el.geometry) return { type: "LineString", coordinates: el.geometry.map((p) => [p.lon, p.lat]) };
  if (el?.type === "relation") {
    const outers = (el.members || []).filter((m) => m.role === "outer" && m.geometry?.length > 3 && sameXY(m.geometry[0], m.geometry.at(-1)));
    if (outers.length) return { type: "MultiPolygon", coordinates: outers.map((m) => [m.geometry.map((p) => [p.lon, p.lat])]) };
  }
  return null; // caller keeps the bounding box and says so
}

// ---- Wikidata: named assets (mines, dams, power plants, ports) with coordinates ------------------
const WD = "https://www.wikidata.org/w/api.php";
export async function searchWikidata(term, { fetchFn = fetch, headers = {}, limit = 8 } = {}) {
  const get = (params) => {
    const url = `${WD}?${new URLSearchParams({ format: "json", origin: "*", ...params })}`;
    return remembered(url, async () => {
      const r = await fetchFn(url, { headers });
      if (!r.ok) throw new Error(`Wikidata ${r.status}`);
      return r.json();
    });
  };
  const found = await get({ action: "wbsearchentities", search: term, language: "en", uselang: "en", type: "item", limit: String(limit) });
  const ids = (found.search || []).map((x) => x.id);
  if (!ids.length) return [];
  const ents = (await get({ action: "wbgetentities", ids: ids.join("|"), props: "claims|labels|descriptions", languages: "en" })).entities || {};
  const val = (e, p) => (e.claims?.[p] || []).map((c) => c.mainsnak?.datavalue?.value).filter(Boolean);
  const withCoords = ids.map((id) => ents[id]).filter((e) => e && val(e, "P625").length);
  const linked = [...new Set(withCoords.flatMap((e) => [...val(e, "P31"), ...val(e, "P17")].map((v) => v.id)))];
  const labels = linked.length ? (await get({ action: "wbgetentities", ids: linked.slice(0, 50).join("|"), props: "labels", languages: "en" })).entities || {} : {};
  const label = (id) => labels[id]?.labels?.en?.value || id;
  return withCoords.map((e) => {
    const c = val(e, "P625")[0];
    return candidate({
      name: e.labels?.en?.value || e.id, type: val(e, "P31").map((v) => label(v.id)).join(", ") || "item",
      geometry: { type: "Point", coordinates: [c.longitude, c.latitude] },
      source: { id: "wikidata", title: "Wikidata", publisher: "Wikidata contributors", licence: "CC0 1.0", url: `https://www.wikidata.org/wiki/${e.id}` },
      extra: { description: e.descriptions?.en?.value, country: val(e, "P17").map((v) => label(v.id)).join(", ") || undefined },
    });
  });
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, o[k]]));
function describeTags(t) {
  for (const k of ["power", "man_made", "amenity", "healthcare", "railway", "leisure", "landuse", "industrial", "waterway", "water", "aeroway", "place"]) {
    if (t[k]) return `${k}=${t[k]}${t["plant:source"] ? ` (${t["plant:source"]})` : t["generator:source"] ? ` (${t["generator:source"]})` : ""}`;
  }
  return "feature";
}
