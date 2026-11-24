// Reference layers (Natural Earth) and the questions the workspace asks of any shape:
// how big is it, where is it, how far from the coast, what towns are near, and what scale of work is it.
// No DOM here, so it runs in the page and in the tests.
import * as turf from "./vendor/turf.js";
import { nearestKm } from "./nearness.js";

export const REF_LAYERS = ["countries", "coastline", "places", "rivers", "lakes"];

// Loads layers on first use. fetchJson(name) returns the parsed file; the page passes a fetch-based one.
export function createReference(fetchJson) {
  const cache = {};
  const get = (name) => (cache[name] ||= fetchJson(name).then((j) => prepare(name, j)));
  return { get, loaded: () => Object.keys(cache) };
}

function prepare(name, j) {
  if (name === "places") {
    const ix = Object.fromEntries(j.fields.map((f, i) => [f, i]));
    return j.rows.map((r) => ({ lon: r[ix.lon], lat: r[ix.lat], name: r[ix.name], country: r[ix.country], region: r[ix.region], pop: r[ix.pop], rank: r[ix.rank] }));
  }
  for (const f of j.features) f.bbox = turf.bbox(f);
  return j;
}

// ---- scale ----------------------------------------------------------------------
// Local: a site (up to ~50 km across). Regional: a block, basin or province (up to ~1,000 km). Global: bigger.
export const SCALES = {
  local: { label: "Local", hint: "a site, up to about 50 km across" },
  regional: { label: "Regional", hint: "a block, basin or province, up to about 1,000 km across" },
  global: { label: "Global", hint: "a country or more" },
};

export function extentKm(feature) {
  const [w, s, e, n] = turf.bbox(feature);
  const midLat = (s + n) / 2;
  const across = turf.distance([w, midLat], [e, midLat]);
  const down = turf.distance([w, s], [w, n]);
  return Math.max(across, down);
}

export const scaleForKm = (km) => (km <= 50 ? "local" : km <= 1000 ? "regional" : "global");

// From the geometry's size. A point has no size, so it's local unless the zoom or the request says otherwise.
export function deduceScale(feature) {
  if (feature.geometry.type === "Point") return "local";
  return scaleForKm(extentKm(feature));
}

// From the map view: how wide the visible map is, [west, south, east, north] in degrees.
export function viewKm([w, s, e, n]) {
  const midLat = Math.max(-85, Math.min(85, (s + n) / 2));
  const across = (Math.min(e - w, 360) / 360) * 40075 * Math.cos((midLat * Math.PI) / 180);
  const down = turf.distance([0, Math.max(-85, s)], [0, Math.min(85, n)]);
  return Math.min(across, down) || Math.max(across, down);
}

// Where a place's scale came from, in the order it's decided: the request, the size, the zoom; or set by the person.
export const SCALE_FROM = {
  request: "Worked out from what you asked",
  size: "Worked out from the size",
  zoom: "Worked out from the zoom level when the point was dropped",
  you: "Set by you",
};

// ---- measuring ----------------------------------------------------------------------
export function measure(feature) {
  const g = feature.geometry;
  const out = { type: g.type, centroid: turf.centroid(feature).geometry.coordinates.map((v) => round(v, 5)) };
  if (g.type === "Polygon" || g.type === "MultiPolygon") {
    out.area_km2 = round(turf.area(feature) / 1e6, 3);
    out.perimeter_km = round(turf.length(outline(feature)), 2);
  }
  if (g.type === "LineString" || g.type === "MultiLineString") out.length_km = round(turf.length(feature), 2);
  if (g.type !== "Point") out.extent_km = round(extentKm(feature), 2);
  return out;
}

function outline(feature) {
  const rings = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  return { type: "Feature", properties: {}, geometry: { type: "MultiLineString", coordinates: rings.flat() } };
}

// ---- where is it --------------------------------------------------------------------
const inBox = ([x, y], [w, s, e, n]) => x >= w && x <= e && y >= s && y <= n;
const boxesMeet = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

export function countryAt(countries, lonlat) {
  for (const f of countries.features) {
    if (inBox(lonlat, f.bbox) && turf.booleanPointInPolygon(lonlat, f)) return f.properties;
  }
  return null;
}

// Countries a shape touches, largest overlap not computed (bbox + intersect test only).
export function countriesTouched(countries, feature) {
  if (feature.geometry.type === "Point") {
    const c = countryAt(countries, feature.geometry.coordinates);
    return c ? [c] : [];
  }
  return touching(countries, feature).map((f) => f.properties);
}
// Country features a shape meets: box test, then the shape's edges against the country's (js/nearness.js, the shape
// prepared once), which is far quicker than turf's intersect on a detailed site; turf if that can't measure it.
function touching(countries, feature) {
  const b = turf.bbox(feature);
  return countries.features.filter((f) => {
    if (!boxesMeet(b, f.bbox)) return false;
    const d = nearestKm(feature.geometry, f.geometry);
    return d != null ? d === 0 : turf.booleanIntersects(f, feature);
  });
}

// Each touched country's share of an area, from a grid of sample points (Rob's Miri log, 18 Nov: Miri Division
// came out "across Indonesia, Malaysia and Brunei" because 1:10m borders clip its edge). Countries holding less
// than `minShare` are only touched at the edge, which at this resolution (about a kilometre) may not be real.
export function countrySplit(countries, feature, { minShare = 0.02, grid = 30 } = {}) {
  if (feature.geometry.type === "Point") return { main: countriesTouched(countries, feature).map((c) => c.name), edge: [] };
  const touched = touching(countries, feature);
  if (!/Polygon/.test(feature.geometry.type) || touched.length < 2) return { main: touched.map((f) => f.properties.name), edge: [] };
  const [w, s, e, n] = turf.bbox(feature);
  const count = new Map(touched.map((f) => [f.properties.name, 0]));
  let inside = 0;
  for (let i = 0; i < grid; i++) for (let j = 0; j < grid; j++) {
    const pt = [w + (e - w) * (i + 0.5) / grid, s + (n - s) * (j + 0.5) / grid];
    if (!turf.booleanPointInPolygon(pt, feature)) continue;
    inside++;
    const c = touched.find((f) => inBox(pt, f.bbox) && turf.booleanPointInPolygon(pt, f));
    if (c) count.set(c.properties.name, count.get(c.properties.name) + 1);
  }
  if (inside < 20) return { main: touched.map((f) => f.properties.name), edge: [] }; // too thin to sample: say all
  const main = [...count].filter(([, k]) => k / inside >= minShare).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const edge = [...count].filter(([, k]) => k / inside < minShare).map(([name]) => name);
  return main.length ? { main, edge } : { main: touched.map((f) => f.properties.name), edge: [] };
}

// Distance in km from a point to the nearest coastline. Searches lines whose boxes are close enough first.
export function coastDistanceKm(coastline, lonlat) {
  const kmPerDegLat = 111.32;
  const scored = coastline.features.map((f) => {
    const [w, s, e, n] = f.bbox;
    const dx = Math.max(w - lonlat[0], 0, lonlat[0] - e) * kmPerDegLat * Math.cos((lonlat[1] * Math.PI) / 180);
    const dy = Math.max(s - lonlat[1], 0, lonlat[1] - n) * kmPerDegLat;
    return { f, lower: Math.hypot(dx, dy) * 0.95 };
  }).sort((a, b) => a.lower - b.lower);
  let best = Infinity;
  for (const { f, lower } of scored) {
    if (lower > best) break;
    const lines = f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const c of lines) {
      if (c.length < 2) continue;
      const d = turf.pointToLineDistance(lonlat, turf.lineString(c), { units: "kilometers" });
      if (d < best) best = d;
    }
  }
  return round(best, 1);
}

// Nearest towns and cities. minPop filters out small places for wide views.
export function nearestPlaces(places, lonlat, { n = 3, minPop = 0, maxKm = Infinity } = {}) {
  return places
    .filter((p) => p.pop >= minPop)
    .map((p) => ({ ...p, km: turf.distance(lonlat, [p.lon, p.lat]) }))
    .filter((p) => p.km <= maxKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, n)
    .map((p) => ({ name: p.name, region: p.region, country: p.country, pop: p.pop, km: round(p.km, 1) }));
}

// The largest places inside a polygon, and how many there are.
export function placesInside(places, feature, n = 3) {
  const b = turf.bbox(feature);
  const inside = places.filter((p) => inBox([p.lon, p.lat], b) && turf.booleanPointInPolygon([p.lon, p.lat], feature));
  inside.sort((a, b2) => b2.pop - a.pop);
  return { count: inside.length, largest: inside.slice(0, n).map((p) => ({ name: p.name, country: p.country, pop: p.pop })) };
}

// Everything the workspace says about a shape. Loads only the layers it needs.
export async function describe(ref, feature) {
  const m = measure(feature);
  const scale = deduceScale(feature);
  const [countries, coastline, places] = await Promise.all(["countries", "coastline", "places"].map((n) => ref.get(n)));
  const anchor = feature.geometry.type === "Point" ? feature.geometry.coordinates : m.centroid;
  const split = countrySplit(countries, feature);
  const at = countryAt(countries, anchor);
  // For a wide area, distances from its middle mean little: list the biggest places inside it instead.
  const wide = scale !== "local" && /Polygon/.test(feature.geometry.type);
  return {
    ...m,
    scale,
    countries: split.main,
    ...(split.edge.length ? { touches_at_edge: split.edge } : {}),
    offshore: !at && split.main.length === 0,
    coast_km: wide ? null : coastDistanceKm(coastline, anchor),
    nearest_places: wide ? [] : nearestPlaces(places, anchor, { n: 3, minPop: scale === "local" ? 0 : 100000 }),
    places_inside: wide ? placesInside(places, feature, 3) : undefined,
    source: "Natural Earth (public domain), 1:10m. Good to about a kilometre; site-scale work uses OpenStreetMap.",
  };
}

// One line a person can read, e.g. "3.0 km² · offshore, 98 km from the coast · nearest town Peterhead (UK), 180 km".
export function summaryLine(d) {
  const size = d.area_km2 != null ? fmtArea(d.area_km2) : d.length_km != null ? `${fmtNum(d.length_km)} km long` : "A point";
  const coast = d.coast_km != null && d.coast_km < 50 ? `, ${fmtNum(d.coast_km)} km from the coast` : "";
  const where = d.offshore
    ? `offshore${d.coast_km != null ? `, ${fmtNum(d.coast_km)} km from the coast` : ""}`
    : d.countries.length > 3 ? `across ${d.countries.length} countries`
    : d.countries.length > 1 ? `across ${listOf(d.countries)}` : `in ${d.countries[0] || "an unnamed area"}${coast}`;
  const edge = d.touches_at_edge?.length ? `touching ${listOf(d.touches_at_edge)} at its edge` : "";
  const p = d.nearest_places[0];
  const big = d.places_inside?.largest[0];
  const near = p ? `nearest town ${p.name}${p.country && (d.offshore || d.countries.length !== 1 || p.country !== d.countries[0]) ? ` (${p.country})` : ""}, ${fmtNum(p.km)} km`
    : big ? `largest city ${big.name}` : "";
  return [size, where, edge, near].filter(Boolean).join(", ");
}

export function fmtArea(km2) {
  if (km2 < 0.01) return `${Math.round(km2 * 1e6).toLocaleString("en-GB")} m²`;
  if (km2 < 1) return `${round(km2 * 100, 1)} ha`;
  return `${fmtNum(km2)} km²`;
}
export function fmtNum(v) {
  if (!isFinite(v)) return "–";
  return v >= 100 ? Math.round(v).toLocaleString("en-GB") : v >= 10 ? round(v, 1).toString() : round(v, 2).toString();
}
const listOf = (a) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
function round(v, d) { const k = 10 ** d; return Math.round(v * k) / k; }
