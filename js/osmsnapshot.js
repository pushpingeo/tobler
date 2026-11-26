// Tobler's own copy of OpenStreetMap (25 Nov): the kinds the checks ask Overpass for, built weekly from Geofabrik
// extracts by scripts/osm-extract and hosted as FlatGeobuf files with a spatial index. A lookup reads the market's
// manifest once, then for each group of kinds only the parts of the files near the site (a few HTTP range requests),
// so it doesn't depend on the public Overpass servers. Answers come back in Overpass's shape (with the full geometry
// attached), so js/osmchecks.js sorts and measures them exactly as before.
//
// Returns null, and the caller asks Overpass instead, when the copy is switched off (no base URL), or when the
// ground the checks need isn't all inside the copy's outline. Throws when the copy can't be read (the caller asks
// Overpass then too, and says so if that fails as well). No DOM.
import * as turf from "./vendor/turf.js";
import { deserialize } from "./vendor/flatgeobuf.js";
import { CONFIG } from "./config.js";

export const MAX_PER_GROUP = 20000;
const MANIFEST_TTL_MS = 10 * 60 * 1000;
const manifests = new Map(); // url → { at, promise }

function manifest(url, fetchFn) {
  const hit = manifests.get(url);
  if (hit && Date.now() - hit.at < MANIFEST_TTL_MS) return hit.promise;
  const promise = fetchFn(url).then(async (r) => {
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  });
  promise.catch(() => manifests.delete(url));
  manifests.set(url, { at: Date.now(), promise });
  return promise;
}
export const forgetManifests = () => manifests.clear();

const boxPoly = (b) => turf.bboxPolygon(b);
const unionBox = (boxes) => boxes.reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const overlaps = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// Is the whole box inside the copy's outline? The real outline, not its box (invariant 2): a box only picks the
// files. The outline was shrunk when it was made (scripts/osm-extract/publish.py), so "inside" errs towards Overpass.
export function covers(outline, box) {
  if (!outline) return false;
  try {
    return turf.difference(turf.featureCollection([boxPoly(box), { type: "Feature", properties: {}, geometry: outline }])) === null;
  } catch { return false; }
}

// One feature from a file, as an Overpass element with its geometry (osmchecks' elementGeometry uses `geojson`).
// A one-part multipolygon becomes a polygon, as Overpass's way would.
function element(f) {
  const p = f.properties || {};
  let g = f.geometry;
  if (g?.type === "MultiPolygon" && g.coordinates.length === 1) g = { type: "Polygon", coordinates: g.coordinates[0] };
  let tags = {};
  try { tags = JSON.parse(p.tags || "{}"); } catch { /* keep none */ }
  return { type: p.osm_type, id: p.osm_id, tags, geojson: g };
}

// The source osmAnswers takes: (kinds, boxOf) → { elements, via, data_as_of, release, capped, kinds } | null, where
// kinds are the ones it answered (each kind's own box inside the copy's outline); the rest are Overpass's.
// options: base (URL ending in /, default CONFIG.osmSnapshotBase), markets (default CONFIG.osmSnapshotMarkets),
// fetchFn (for the manifest; the file reads use the page's fetch), timeoutMs, maxPerGroup (features read per group
// before the answer is marked capped; the place search asks for fewer than the checks).
export function osmSnapshot({ base = CONFIG.osmSnapshotBase, markets = CONFIG.osmSnapshotMarkets || [], fetchFn = globalThis.fetch, timeoutMs = 20000, maxPerGroup = MAX_PER_GROUP } = {}) {
  return async (kinds, boxOf) => {
    if (!base || !markets.length || !kinds.length) return null;
    // Which kinds the copy can answer: each kind's own box inside the copy's outline (Heswall, 26 Nov: a mine's 15 km
    // aerodrome box reached out into Liverpool Bay, past the outline, so the whole run went to Overpass, which was
    // down, and ten checks came back not checked). The kinds the copy can't answer go to Overpass on their own.
    let lastErr = null, m = null, mUrl = null, served = [];
    for (const market of markets) {
      const url = new URL(`${market}.json`, base).href;
      try {
        const j = await manifest(url, fetchFn);
        const ok = kinds.filter((k) => j.kind_groups?.[k] && covers(j.outline, boxOf(k)));
        if (ok.length > served.length) { m = j; mUrl = url; served = ok; }
        if (served.length === kinds.length) break;
      } catch (e) { lastErr = e; }
    }
    if (!m) {
      if (lastErr) throw new Error(`Tobler's copy of OpenStreetMap couldn't be read (${lastErr.message || lastErr})`);
      return null; // outside the copy: Overpass
    }
    const groups = new Map(); // group → box
    for (const k of served) {
      const g = m.kind_groups[k];
      groups.set(g, groups.has(g) ? unionBox([groups.get(g), boxOf(k)]) : boxOf(k));
    }
    const fileBase = m.base ? new URL(m.base, mUrl).href : mUrl;
    const seen = new Set(), elements = [], used = new Set();
    let capped = false;
    const read = async () => {
      await Promise.all([...groups].map(async ([g, b]) => {
        const rect = { minX: b[0], minY: b[1], maxX: b[2], maxY: b[3] };
        let n = 0;
        for (const r of m.regions.filter((x) => overlaps(x.bbox, b) && x.files?.[g])) {
          used.add(r);
          if (!r.files[g].features) continue;
          for await (const f of deserialize(new URL(r.files[g].path, fileBase).href, { rect })) {
            const el = element(f);
            const key = `${el.type}/${el.id}`;
            if (seen.has(key)) continue; // an extract's edge overlaps its neighbour's
            seen.add(key);
            elements.push(el);
            if (++n >= maxPerGroup) { capped = true; break; }
          }
          if (n >= maxPerGroup) break;
        }
      }));
    };
    let timer;
    try {
      await Promise.race([read(), new Promise((_, no) => { timer = setTimeout(() => no(new Error(`timed out after ${timeoutMs / 1000} s`)), timeoutMs); })]);
    } catch (e) {
      throw new Error(`Tobler's copy of OpenStreetMap couldn't be read (${e.message || e})`);
    } finally { clearTimeout(timer); }
    const dates = [...used].map((r) => r.data_as_of).filter(Boolean).sort();
    return { elements, via: "copy", release: m.release, data_as_of: dates[0] || null, capped, kinds: served };
  };
}
