// Site boundaries from the person's own files (Rob, 23 Nov): a shapefile (dropped as a folder, as its files together or
// as a .zip) or GeoJSON, read in the browser and never uploaded. The file isn't kept as a layer: the features the person
// picks are copied into places, and the file is forgotten. Points and lines need a width to become a site.
// No DOM: js/workspace.js does the dropping and the card; this reads, converts and builds.
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import { ellipsoid, applyTransformation } from "./transform.js";

export const ACCEPT = ".zip,.shp,.dbf,.shx,.prj,.cpg,.geojson,.json";
export const MAX_BYTES = 100e6; // per drop; bigger than any red-line boundary needs
export const LIST_MAX = 200; // features offered for picking; more than this are named in words
export const MAX_VERTICES = 5000; // a place's outline is simplified beyond this, and the shift said
export const WIDTHS_M = [1, 30, 100]; // quick choices for points and lines

let lib = null; // the reading library is loaded only when a file arrives
const load = async () => (lib ||= await import("./vendor/fileread.js"));

const ext = (n) => (n.match(/\.([^./\\]+)$/)?.[1] || "").toLowerCase();
const stem = (n) => n.replace(/\.[^./\\]+$/, "");
const base = (n) => n.split(/[\\/]/).pop();
const kindOf = (t) => (/Polygon/.test(t) ? "polygon" : /LineString/.test(t) ? "line" : /Point/.test(t) ? "point" : null);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

// ---- coordinate systems -------------------------------------------------------------------------------------
// Coordinate systems a GeoJSON file can name by EPSG code (the old "crs" member). Shapefiles carry their own .prj.
const EPSG = {
  4326: "+proj=longlat +datum=WGS84",
  4258: "+proj=longlat +ellps=GRS80",
  4277: "+proj=longlat +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489",
  27700: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +towgs84=446.448,-125.157,542.06,0.15,0.247,0.842,-20.489 +units=m",
  29903: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=1.000035 +x_0=200000 +y_0=250000 +ellps=mod_airy +towgs84=482.5,-130.6,564.6,-1.042,-0.214,-0.631,8.15 +units=m",
  2157: "+proj=tmerc +lat_0=53.5 +lon_0=-8 +k=0.99982 +x_0=600000 +y_0=750000 +ellps=GRS80 +units=m",
  3857: "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
};
const NAMES = { 4326: "WGS 84", 4258: "ETRS89", 4277: "OSGB36", 27700: "British National Grid", 29903: "Irish Grid", 2157: "Irish Transverse Mercator", 3857: "Web Mercator" };
function epsgDef(code) {
  code = +code;
  if (EPSG[code]) return { def: EPSG[code], name: `${NAMES[code]} (EPSG:${code})` };
  const z = code % 100;
  if (code > 32600 && code <= 32660) return { def: `+proj=utm +zone=${z} +datum=WGS84 +units=m`, name: `WGS 84 / UTM zone ${z}N (EPSG:${code})` };
  if (code > 32700 && code <= 32760) return { def: `+proj=utm +zone=${z} +south +datum=WGS84 +units=m`, name: `WGS 84 / UTM zone ${z}S (EPSG:${code})` };
  if (code >= 25828 && code <= 25838) return { def: `+proj=utm +zone=${z} +ellps=GRS80 +units=m`, name: `ETRS89 / UTM zone ${z}N (EPSG:${code})` };
  if (code >= 23028 && code <= 23038) return { def: `+proj=utm +zone=${z} +ellps=intl +units=m`, name: `ED50 / UTM zone ${z}N (EPSG:${code})`, ed50: true };
  return null;
}
const crsCode = (gj) => String(gj?.crs?.properties?.name || "").match(/EPSG:{1,2}(?:[\d.]*:)?(\d{4,5})\b/i)?.[1] || (/CRS84$/i.test(gj?.crs?.properties?.name || "") ? "4326" : null);

// ED50 has no shift that proj4 knows; Tobler applies EPSG's general one (ED50 to WGS 84 (1), code 1133, a geocentric
// translation good to about 10 m) with its own maths (js/transform.js). North Sea work may need a regional one.
const ED50_SHIFT = { method: 9603, params: { tx: -87, ty: -98, tz: -121 }, from: ellipsoid({ a: 6378388, invf: 297 }), to: ellipsoid({ a: 6378137, invf: 298.257223563 }) };
const isEd50 = (text, p) => /european_1950|\bED_?50\b|European[ _]Datum[ _]1950/i.test(text) || p?.datumCode === "european_1950";

// A converter to WGS84 longitude/latitude from a .prj (WKT) or a proj string, with words for the card and the record.
export function converterFor(proj4, text, { name, ed50 } = {}) {
  const p = proj4.Proj(text);
  const label = name || (String(text).match(/^\s*\w+\s*\[\s*"([^"]+)"/)?.[1] || "the file's coordinate system").replace(/_/g, " ");
  const dt = p.datum?.datum_type; // 1, 2: a 3- or 7-parameter shift; 4: WGS84; 5: no datum shift known
  const a = p.a, rf = p.rf || (p.b ? a / (a - p.b) : null);
  const grs80ish = Math.abs(a - 6378137) < 1 && rf && Math.abs(rf - 298.257) < 0.01;
  const geographic = p.projName === "longlat";
  const toWgs = proj4(text, "WGS84");
  const fix = (c) => c;
  if (dt === 4) return { name: label, how: geographic ? "WGS 84 longitude and latitude, used as it is" : `converted from ${label} (WGS 84) to longitude and latitude`, convert: geographic ? fix : (c) => toWgs.forward(c), datum: "WGS 84", accuracy_m: 0 };
  if (dt === 1 || dt === 2) return { name: label, how: `converted from ${label} to WGS 84 with a ${dt === 1 ? "3" : "7"}-parameter datum shift (good to a few metres)`, convert: (c) => toWgs.forward(c), datum: p.datumCode || label, accuracy_m: 5, shift: (p.datum.datum_params || []).slice(0, dt === 1 ? 3 : 7) };
  if (ed50 || isEd50(text, p)) {
    const toGeog = proj4(text, `+proj=longlat +a=6378388 +rf=297 +no_defs`);
    return {
      name: label, how: `converted from ${label} (ED50) to WGS 84 with EPSG's general ED50 shift (code 1133, good to about 10 m; offshore work may need a regional transformation)`,
      convert: (c) => { const [lon, lat] = toGeog.forward(c); const [[la, lo]] = applyTransformation([[lat, lon]], ED50_SHIFT); return [lo, la]; },
      datum: "ED50", accuracy_m: 10, transformation: "EPSG:1133",
    };
  }
  if (grs80ish) return { name: label, how: `converted from ${label} to longitude and latitude; its datum (ETRS89 or similar) is treated as WGS 84, which it matches to a metre or so`, convert: geographic ? fix : (c) => toWgs.forward(c), datum: "ETRS89 or similar", accuracy_m: 1 };
  return {
    name: label, how: `converted from ${label}, but its datum wasn't recognised, so no datum shift was applied: positions could be out by tens to hundreds of metres. Check the outline against the map`,
    convert: (c) => toWgs.forward(c), datum: "unknown", accuracy_m: null, warning: "datum not recognised: no shift applied",
  };
}

// No .prj: longitude and latitude if every number fits, British National Grid if they fit that, otherwise ask.
function guessConverter(proj4, coords) {
  const xs = coords.map((c) => c[0]), ys = coords.map((c) => c[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (x0 >= -180 && x1 <= 180 && y0 >= -90 && y1 <= 90) return { ...converterFor(proj4, EPSG[4326], { name: "WGS 84" }), guessed: true, how: "no coordinate system given; the numbers are longitudes and latitudes, so WGS 84 was assumed" };
  if (x0 >= 0 && x1 <= 700000 && y0 >= 0 && y1 <= 1300000) {
    return { ...converterFor(proj4, EPSG[27700], { name: "British National Grid" }), guessed: true,
      how: "no coordinate system given; the numbers fit British National Grid, so it was assumed and converted to WGS 84 (if this is Irish or other data, add its .prj file)" };
  }
  return null;
}

// ---- reading ------------------------------------------------------------------------------------------------
// files: [{ name, bytes: Uint8Array }] (names may include folder paths). Returns { name, layers, features, notes,
// skipped }. Features: { fid, layer, label, kind, geometry (WGS84), props, size }.
export async function readFiles(files) {
  const { proj4, parseShp, parseDbf, unzipSync, strFromU8 } = await load();
  const total = files.reduce((n, f) => n + f.bytes.byteLength, 0);
  if (total > MAX_BYTES) throw new Error(`That's ${Math.round(total / 1e6)} MB. Site files are usually far smaller: try just the boundary layer (up to ${MAX_BYTES / 1e6} MB).`);
  const all = [], skipped = [], notes = [];
  for (const f of files) {
    if (/(^|[\\/])(__MACOSX|\.)/.test(f.name)) continue;
    if (ext(f.name) === "zip") {
      let entries;
      try { entries = unzipSync(f.bytes); } catch { skipped.push(`${base(f.name)}: couldn't be opened as a zip`); continue; }
      for (const [n, b] of Object.entries(entries)) if (!/(^|\/)(__MACOSX|\.)/.test(n) && !n.endsWith("/")) all.push({ name: n, bytes: b, from: base(f.name) });
    } else all.push(f);
  }
  const groups = new Map();
  for (const f of all) {
    const k = stem(f.name).toLowerCase();
    if (!groups.has(k)) groups.set(k, { name: base(stem(f.name)), parts: {} });
    groups.get(k).parts[ext(f.name)] = f.bytes;
  }
  const layers = [], features = [];
  const text = (b) => (b ? strFromU8(b) : null);
  for (const g of groups.values()) {
    const P = g.parts;
    let rows = null, conv = null, kindName;
    try {
      if (P.shp) {
        kindName = "shapefile";
        const shapes = parseShp(P.shp);
        let attrs = [];
        if (P.dbf) { try { attrs = parseDbf(P.dbf, text(P.cpg) || undefined); } catch { notes.push(`${g.name}: its attribute table (.dbf) couldn't be read, so features have no names`); } }
        else notes.push(`${g.name}: no .dbf, so features have no names or attributes`);
        rows = shapes.map((geometry, i) => ({ geometry, props: attrs[i] || {} }));
        if (P.prj) conv = converterFor(proj4, text(P.prj));
      } else if (P.geojson || P.json) {
        kindName = "GeoJSON";
        const gj = JSON.parse(text(P.geojson || P.json));
        const list = gj.type === "FeatureCollection" ? gj.features : gj.type === "Feature" ? [gj] : gj.type && gj.coordinates ? [{ type: "Feature", geometry: gj, properties: {} }] : null;
        if (!list) { skipped.push(`${g.name}: not GeoJSON features`); continue; }
        rows = list.map((f) => ({ geometry: f.geometry, props: f.properties || {} }));
        const code = crsCode(gj);
        if (code) {
          const d = epsgDef(code);
          if (!d) { skipped.push(`${g.name}: it says its coordinates are EPSG:${code}, which this page can't convert yet. Save it as WGS 84 (EPSG:4326) and drop it again`); continue; }
          conv = converterFor(proj4, d.def, d);
        }
      } else {
        const has = Object.keys(P).filter((e) => !["shx", "cpg", "prj", "qmd", "xml", "sbn", "sbx", "qix", "fix", "aih", "ain", "atx", "lock"].includes(e));
        if (P.dbf && !P.shp) skipped.push(`${g.name}.dbf: no matching .shp, so there are no shapes. Drop the .shp with it, or the whole folder`);
        else if (has.length) skipped.push(`${g.name}.${has[0]}: not a file type Tobler reads (shapefiles, zips and GeoJSON for now)`);
        else if (P.prj || P.shx) skipped.push(`${g.name}: only its ${P.prj ? ".prj" : ".shx"} arrived. Drop the .shp and .dbf with it, or the whole folder`);
        continue;
      }
    } catch (e) { skipped.push(`${g.name}: couldn't be read (${String(e.message || e).slice(0, 100)})`); continue; }
    rows = rows.filter((r) => r.geometry && kindOf(r.geometry.type) && r.geometry.coordinates?.length);
    if (!rows.length) { skipped.push(`${g.name}: no shapes in it`); continue; }
    if (!conv) {
      conv = guessConverter(proj4, rows.flatMap((r) => coordsOf(r.geometry)).slice(0, 5000));
      if (!conv) { skipped.push(`${g.name}: there's no .prj and the coordinates aren't longitude and latitude or British National Grid, so they can't be placed. Drop the .prj file with it`); continue; }
    }
    // Convert every coordinate (2D: heights and measures are dropped), then check it lands on the Earth.
    let bad = 0;
    const layer = { name: g.name, type: kindName, crs: { name: conv.name, how: conv.how, datum: conv.datum, accuracy_m: conv.accuracy_m, ...(conv.guessed ? { guessed: true } : {}), ...(conv.transformation ? { transformation: conv.transformation } : {}), ...(conv.shift ? { shift: conv.shift } : {}), ...(conv.warning ? { warning: conv.warning } : {}) }, count: 0 };
    for (const r of rows) {
      const geometry = mapCoords(r.geometry, (c) => conv.convert([c[0], c[1]]));
      if (!coordsOf(geometry).every(([x, y]) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) <= 180 && Math.abs(y) <= 90)) { bad++; continue; }
      const kind = kindOf(geometry.type);
      const n = features.length + 1;
      const f = { type: "Feature", properties: {}, geometry };
      features.push({
        fid: `F${n}`, layer: g.name, kind, geometry, props: r.props, label: labelOf(r.props, g.name, layer.count + 1),
        size: kind === "polygon" ? { area_ha: round(turf.area(f) / 1e4, 2) } : kind === "line" ? { length_km: round(turf.length(f), 3) } : { points: geometry.type === "MultiPoint" ? geometry.coordinates.length : 1 },
      });
      layer.count++;
    }
    if (bad) notes.push(`${g.name}: ${bad} feature${bad > 1 ? "s" : ""} landed off the Earth after conversion and ${bad > 1 ? "were" : "was"} left out (wrong coordinate system?)`);
    if (layer.count) layers.push(layer);
  }
  const name = files.length === 1 ? base(files[0].name) : layers.length === 1 ? `${layers[0].name}${layers[0].type === "shapefile" ? ".shp" : ".geojson"}` : `${files.length} files`;
  return { name, layers, features, notes, skipped };
}

const NAME_KEYS = [/^name$/i, /^site_?name$/i, /^site$/i, /^title$/i, /^label$/i, /name/i, /^desc(ription)?$/i, /^ref(erence)?$/i, /^id$/i];
function labelOf(props, layer, n) {
  const keys = Object.keys(props || {});
  for (const re of NAME_KEYS) {
    const k = keys.find((x) => re.test(x) && props[x] != null && String(props[x]).trim() && String(props[x]).trim().length <= 80);
    if (k) return String(props[k]).trim();
  }
  return `${layer} ${n}`;
}
function coordsOf(g) {
  const out = [];
  const walk = (c) => (typeof c[0] === "number" ? out.push(c) : c.forEach(walk));
  walk(g.coordinates);
  return out;
}
function mapCoords(g, f) {
  const walk = (c) => (typeof c[0] === "number" ? f(c) : c.map(walk));
  return { type: g.type, coordinates: walk(g.coordinates) };
}

// A compact view of a loaded file for the analyst and the card: never the coordinates.
export function fileSummary(file, limit = 40) {
  if (!file) return null;
  const counts = {};
  for (const f of file.features) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return {
    file: file.name,
    contents: Object.entries(counts).map(([k, n]) => `${n} ${k}${n > 1 ? "s" : ""}`).join(", "),
    coordinates: file.layers.map((l) => `${l.name}: ${l.crs.how}`),
    features: file.features.slice(0, limit).map((f) => ({ fid: f.fid, label: f.label, kind: f.kind, ...f.size, ...(file.layers.length > 1 ? { layer: f.layer } : {}) })),
    ...(file.features.length > limit ? { not_listed: `${file.features.length - limit} more not listed; fields: ${Object.keys(file.features[0]?.props || {}).slice(0, 15).join(", ")}` } : {}),
    ...(file.notes?.length ? { notes: file.notes } : {}),
  };
}

// ---- building places ----------------------------------------------------------------------------------------
// From the features picked: one place (combine "parts": one site in pieces) or one per feature ("separate").
// Points and lines need buffer_m (metres, measured round the shape, not in degrees). Returns [{ feature, origin, name }].
export function placesFromFile(file, { fids, combine = "parts", buffer_m = null, name = null } = {}) {
  if (!file?.features?.length) throw new Error("No file is loaded. Ask the person to drop the site's file on the map.");
  const pick = fids === "all" || !fids?.length ? file.features : fids.map((id) => {
    const f = file.features.find((x) => x.fid === id || x.fid === String(id).toUpperCase());
    if (!f) throw new Error(`No feature ${id} in ${file.name}.`);
    return f;
  });
  if (!pick.length) throw new Error("Pick at least one feature.");
  const needWidth = pick.filter((f) => f.kind !== "polygon");
  if (needWidth.length && !(buffer_m > 0)) {
    const e = new Error(`${needWidth.length === pick.length ? "These are" : "Some of these are"} ${[...new Set(needWidth.map((f) => `${f.kind}s`))].join(" and ")}, so they need a width to become a site: ask how wide (e.g. 1 m for the line itself, 30 m for a cable corridor).`);
    e.needs_width = true;
    throw e;
  }
  if (buffer_m != null && !(buffer_m >= 0.5 && buffer_m <= 50000)) throw new Error("A width between 0.5 m and 50 km, please.");
  const crsOf = (f) => file.layers.find((l) => l.name === f.layer)?.crs;
  const shapeOf = (f) => {
    const feat = { type: "Feature", properties: {}, geometry: f.geometry };
    // turf's buffer works in a projection centred on the shape, so the width is metres on the ground anywhere.
    if (f.kind !== "polygon") return turf.buffer(feat, buffer_m, { units: "meters", steps: 8 });
    return safeValid(feat) ? feat : turf.buffer(feat, 0, { units: "meters" }) || feat;
  };
  const build = (feats, given) => {
    const steps = [];
    let shape;
    const shapes = feats.map(shapeOf).filter(Boolean);
    if (!shapes.length) throw new Error("Those features gave no shape.");
    if (shapes.length > 1) { shape = turf.union(turf.featureCollection(shapes)) || shapes[0]; steps.push(`${shapes.length} features joined into one site`); }
    else shape = shapes[0];
    if (feats.some((f) => f.kind !== "polygon")) steps.push(`${buffer_m} m either side of the ${[...new Set(feats.filter((f) => f.kind !== "polygon").map((f) => f.kind))].join(" and ")}`);
    shape = { type: "Feature", properties: {}, geometry: shape.geometry };
    const filled = G.fillHoles(shape);
    if (filled.holes) { shape = filled.feature; steps.push(`${filled.holes} hole${filled.holes > 1 ? "s" : ""} filled (adds ${round(filled.addedKm2 * 100, 2)} ha), because the map can't edit holes yet`); }
    const n = countVertices(shape.geometry);
    if (n > MAX_VERTICES) {
      let tol = 0.000005, s = shape;
      while (countVertices(s.geometry) > MAX_VERTICES && tol < 0.01) { tol *= 2; s = turf.simplify(shape, { tolerance: tol, highQuality: true }); }
      steps.push(`simplified from ${n} to ${countVertices(s.geometry)} corners (moves the edge by up to about ${Math.max(1, Math.round(tol * 111000))} m)`);
      shape = s;
    }
    shape = G.roundCoords(shape);
    const allPolygons = feats.every((f) => f.kind === "polygon");
    const layers = [...new Set(feats.map((f) => f.layer))];
    const crs = crsOf(feats[0]);
    const origin = {
      method: "file", file: file.name, layer: layers.join(", "), features: feats.map((f) => ({ fid: f.fid, label: f.label })),
      crs: { name: crs?.name, how: crs?.how, ...(crs?.guessed ? { guessed: true } : {}), ...(crs?.transformation ? { transformation: crs.transformation } : {}), ...(crs?.warning ? { warning: crs.warning } : {}) },
      ...(buffer_m && !allPolygons ? { buffer_m } : {}), steps,
      role: allPolygons ? "footprint" : "area",
      role_why: allPolygons ? `the outline from your file ${file.name}` : `the site as you defined it: ${buffer_m} m round ${feats.length > 1 ? "the features" : `${feats[0].label}`} from your file`,
      at: new Date().toISOString(),
    };
    return { feature: shape, origin, name: given || (feats.length === 1 ? feats[0].label : stem(file.name)) };
  };
  if (combine === "separate") return pick.map((f) => build([f], pick.length === 1 ? name : null));
  return [build(pick, name)];
}
function safeValid(f) { try { return turf.booleanValid(f); } catch { return true; } }
function countVertices(g) { return coordsOf(g).length; }

// One line for the card, the project summary and the run record: how the place came from the file.
export function fileOriginText(o) {
  if (o?.method !== "file") return null;
  const which = o.features?.length === 1 ? `"${o.features[0].label}"` : `${o.features?.length} features`;
  return `from your file ${o.file} (${which}${o.buffer_m ? `, ${o.buffer_m} m wide` : ""}); ${o.crs?.how || "coordinates as given"}`;
}
