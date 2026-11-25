// What a place stands for, and how findings inside it are worded (Cnoc Buidhe, 20 Nov: no outline was found, so a
// 19.6 km² circle stood in for the wind farm, and a goose roost clipping its edge became "SPA on site, high
// confidence"). A shape built from clues to stand in for an outline nobody found is a search area: where the site
// probably is, not the site. Findings inside it are reported by the share of it they cover, never "on site", and
// their confidence is capped. Decided in code from how the place was built, never by the model. No DOM.
import * as turf from "./vendor/turf.js";

export const SEARCH_BAND = "in the search area";
// A finding covering less than this share of a search area is low confidence: a layout could easily avoid it.
export const LOW_COVERAGE = 0.1;

// Roles: "footprint" (a published outline of the asset, or a shape the person drew), "area" (an area the person asked
// for round a found place: "3 km² round the Jackdaw platform", or a site they defined by size and position), "search_area" (a stand-in for an unknown outline,
// including the default footprint round a point), "point".
export function placeRole(origin = {}, geometry = {}) {
  if (geometry.type === "Point") return { role: "point", why: "a point" };
  if (origin.role) return { role: origin.role, why: origin.role_why || "" };
  if (origin.method !== "words") return { role: "footprint", why: "drawn on the map" };
  const shape = origin.shape || (/^outline/.test(origin.steps?.at(-1) || origin.steps?.[0] || "") || origin.steps?.some((s) => /^outlines? of /.test(s)) ? "feature" : null);
  const anchor = origin.anchor?.name || origin.anchor?.place || "the anchor";
  const moved = !!origin.offset || origin.steps?.some((s) => /^moved /.test(s));
  // A published outline is the footprint, unless it's only a namesake or a region standing in for the site.
  if (shape === "feature" && !moved && !["name_only", "settlement_or_region", "none"].includes(origin.match)) {
    return { role: "footprint", why: `the published outline of ${anchor}` };
  }
  if (origin.match === "named_place") return { role: "area", why: `the area asked for round ${anchor}` };
  // A site the person defined by size and position ("a 1 km² site 5 km west of Évora", Rob 22 Nov): nothing existing
  // is being stood in for, so the shape is the site. Only for shapes with a size the person gave.
  if (origin.site_defined && ["square", "circle", "rectangle"].includes(origin.shape)) return { role: "area", why: `the site as you described it, placed from ${anchor}` };
  return { role: "search_area", why: `built from clues round ${anchor}` };
}

// ---- places that aren't sites (plan item 1, 25 Nov) --------------------------------------
// A place found from words that is a whole country or region, a lake or sea area, a town's centre point, or a road or
// river, isn't a site: screening it as one gave whole-country flags (New Zealand), a lake screened for oil and gas
// (Tekapo) and a town point as a wind farm (Kelso). The run asks which part first. Decided in code from what the
// place was built on (the anchor's type, the shape, the size), only for places built straight on a found feature:
// a shape the analyst built round it (a 5 ha square 1 km south-east) is already a choice of part, and a place the
// person drew, typed or brought in a file is their own definition.
const KIND_RULES = [
  { kind: "water", what: "a lake or other water body", test: /\b(lake|loch|lough|reservoir|lagoon|bay|sea|estuary|fjord|firth|river|natural: water|water body)\b/i },
  { kind: "region", what: "an administrative area", test: /\b(country|countries|member state|sovereign state|federated state|province|region|county|municipality|district|parish|administrative|council area|local authority)\b/i },
  { kind: "settlement", what: "a town or village", test: /\b(city|town|village|hamlet|suburb|neighbourhood|neighborhood|quarter|locality|populated place|small burgh|township)\b/i },
  { kind: "line", what: "a road, railway or river", test: /\b(highway|road|street|motorway|railway: (rail|line)|waterway|canal)\b/i },
];
// Types that name something that can be a site even when big (a licence block, a lease): never asked about.
const SITE_TYPES = /\b(licen[cs]e|permit|concession|block|lease|field|tenement|wind farm|solar farm|generating station|mine|quarry|refinery|works|plant|airport|port|dam)\b/i;
export const REGION_KM2 = 2500;

export function notASite(origin = {}, geometry = {}, { area_km2 = null, offshore = false } = {}) {
  if (origin.method !== "words" || origin.offset || origin.steps?.some((s) => /^moved /.test(s))) return null;
  const shape = origin.shape || (geometry.type === "Point" ? "point" : null);
  if (!["feature", "point"].includes(shape)) return null;
  const type = String(origin.anchor?.type || "");
  if (SITE_TYPES.test(type)) return null;
  const rule = KIND_RULES.find((r) => r.test.test(type));
  // A settlement or a road only matters as a point or a line: an outline of a town is still a whole town, though.
  if (rule?.kind === "line" && geometry.type === "Polygon") return null;
  if (rule) return { kind: rule.kind, what: rule.kind === "region" && /\b(country|countries|member state|sovereign state)\b/i.test(type) ? "a whole country" : rule.what, type, ...(area_km2 != null ? { area_km2 } : {}) };
  // Whatever it's called, an area this big on land is a region, not a site.
  if (!offshore && /Polygon/.test(geometry.type) && area_km2 > REGION_KM2) return { kind: "region", what: "a very large area", type, area_km2 };
  return null;
}

// ---- equal-area overlay ----------------------------------------------------------------
// Lambert azimuthal equal-area on a sphere, centred on the site, so shares of area are true anywhere on Earth.
const RE = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
export function laea([lon0, lat0]) {
  const p0 = rad(lat0), l0 = rad(lon0);
  return ([lon, lat]) => {
    const p = rad(lat), dl = rad(lon) - l0;
    const k = Math.sqrt(2 / Math.max(1e-12, 1 + Math.sin(p0) * Math.sin(p) + Math.cos(p0) * Math.cos(p) * Math.cos(dl)));
    return [RE * k * Math.cos(p) * Math.sin(dl), RE * k * (Math.cos(p0) * Math.sin(p) - Math.sin(p0) * Math.cos(p) * Math.cos(dl))];
  };
}
const projectGeom = (g, f) => {
  const walk = (c) => (typeof c[0] === "number" ? f(c) : c.map(walk));
  return { type: g.type, coordinates: walk(g.coordinates) };
};
// Planar area in km² of projected (Multi)Polygon coordinates, holes subtracted.
function ringArea(r) { let a = 0; for (let i = 0, n = r.length; i < n - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return a / 2; }
function planarArea(g) {
  if (!g) return 0;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  return polys.reduce((s, poly) => s + Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((h, r) => h + Math.abs(ringArea(r)), 0), 0);
}
// Where two planar segments cross, or null.
function crossing([x1, y1], [x2, y2], [x3, y3], [x4, y4]) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [x1 + t * (x2 - x1), y1 + t * (y2 - y1)] : null;
}
const COMPASS = ["northern", "north-eastern", "eastern", "south-eastern", "southern", "south-western", "western", "north-western"];
function sideOf([x, y], radiusKm) {
  if (Math.hypot(x, y) < 0.35 * radiusKm) return "middle";
  const a = (Math.atan2(x, y) * 180) / Math.PI;
  return COMPASS[Math.round(((a + 360) % 360) / 45) % 8];
}

// How much of a search area a feature covers, and where in it. Areas: the share of the search area's own area.
// Points and lines: inside or not, and where (no share). Null when the feature isn't inside.
export function coverageIn(site, geometry) {
  if (!site?.geometry || !geometry || !/Polygon/.test(site.geometry.type)) return null;
  const centre = turf.centroid(site).geometry.coordinates;
  const P = laea(centre);
  const s = projectGeom(site.geometry, P);
  const siteKm2 = planarArea(s);
  if (!(siteKm2 > 0)) return null;
  const radius = Math.sqrt(siteKm2 / Math.PI);
  const g = projectGeom(geometry, P);
  const feat = (gg) => ({ type: "Feature", properties: {}, geometry: gg });
  if (/Polygon/.test(g.type)) {
    let cut = null;
    try { cut = turf.intersect(turf.featureCollection([feat(s), feat(g)])); } catch { return null; }
    if (!cut) return null;
    const km2 = planarArea(cut.geometry);
    if (!(km2 > 0)) return null;
    // The centroid of the projected cut, as plain numbers (turf.centroid only averages vertices, which is fine here).
    const c = turf.centroid(cut).geometry.coordinates;
    return { coverage: Math.min(1, km2 / siteKm2), km2, side: km2 / siteKm2 > 0.85 ? "most" : sideOf(c, radius) };
  }
  if (g.type === "Point") return turf.booleanPointInPolygon(g.coordinates, feat(s)) ? { coverage: null, side: sideOf(g.coordinates, radius) } : null;
  if (/LineString/.test(g.type)) {
    // Inside: its vertices inside, plus where it crosses the edge (a straight line can cross with no vertex inside).
    const lines = g.type === "LineString" ? [g.coordinates] : g.coordinates;
    const pts = lines.flat().filter((c) => turf.booleanPointInPolygon(c, feat(s)));
    const rings = (s.type === "Polygon" ? [s.coordinates] : s.coordinates).flat();
    for (const l of lines) for (let i = 0; i < l.length - 1; i++) for (const r of rings) for (let j = 0; j < r.length - 1; j++) {
      const x = crossing(l[i], l[i + 1], r[j], r[j + 1]);
      if (x) pts.push(x);
    }
    if (!pts.length) return null;
    const mid = [pts.reduce((a, c) => a + c[0], 0) / pts.length, pts.reduce((a, c) => a + c[1], 0) / pts.length];
    return { coverage: null, side: sideOf(mid, radius) };
  }
  return null;
}

const pct = (v) => (v >= 0.995 ? "all" : v >= 0.1 ? `${Math.round(v * 100)}%` : v >= 0.01 ? `${Math.round(v * 1000) / 10}%` : "under 1%");
// "in the search area (covers 4% of it, on its eastern side)"
export function whereText(p) {
  const bits = [];
  if (p.coverage != null) bits.push(`covers ${pct(p.coverage)} of it`);
  if (p.side === "most") { if (p.coverage == null) bits.push("across most of it"); }
  else if (p.side === "middle") bits.push("in its middle");
  else if (p.side) bits.push(`on its ${p.side} side`);
  return `${SEARCH_BAND}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

// Words the analyst wrote that claim more than a search area can say. Applied to its text when the site is a search
// area, so the card and report never say "on site" for a place nobody has located.
export function reword(text) {
  if (!text) return text;
  const keepCase = (m, to) => (m[0] === m[0].toUpperCase() ? to[0].toUpperCase() + to.slice(1) : to);
  return String(text)
    .replace(/\bon (and|or) near (the )?site\b/gi, (m, w) => keepCase(m, `in ${w.toLowerCase()} near the search area`))
    .replace(/\b(on|across|inside|within) the footprint\b/gi, (m, w) => keepCase(m, `${w.toLowerCase()} the search area`))
    .replace(/\bon[- ]site\b|\bon the site\b|\bat the site itself\b/gi, (m) => keepCase(m, SEARCH_BAND));
}

// Flags on a search area: those whose nearest traced evidence lies inside it say so, and their confidence may be capped
// (Rob, 22 Nov). An area covering LOW_COVERAGE (10%) or more of the search area is uncapped: a layout would struggle to
// avoid it. Low when every area inside covers less than that and no point or line sits inside. Medium otherwise: points
// and lines have no share to measure. Severity stays: it is how much the finding would matter if it is on the site.
export function applySearchArea(flags, evidenceByFid) {
  const ORDER = { high: 0, medium: 1, low: 2 };
  return flags.map((f) => {
    const inside = (f.fids || []).map((id) => evidenceByFid.get(id)).filter((p) => p?.in_search_area);
    const out = { ...f, risk: reword(f.risk), why: reword(f.why), next_step: reword(f.next_step) };
    if (!inside.length) return { ...out, relation: f.nearest_km == null ? null : "outside the search area" };
    const areas = inside.filter((p) => p.coverage != null);
    const coverage = areas.length ? Math.max(...areas.map((p) => p.coverage)) : null;
    const small = areas.length === inside.length && coverage != null && coverage < LOW_COVERAGE;
    const big = coverage != null && coverage >= LOW_COVERAGE;
    const cap = big ? null : small ? "low" : "medium";
    const capped = cap != null && ORDER[f.confidence] < ORDER[cap];
    return { ...out, relation: SEARCH_BAND, ...(coverage != null ? { coverage: Math.round(coverage * 1000) / 1000 } : {}),
      ...(capped ? { confidence: cap, confidence_capped: `${f.confidence} → ${cap}: inside a search area, not a known site outline${small ? `, and covering under ${Math.round(LOW_COVERAGE * 100)}% of it` : ""}` } : {}) };
  });
}

// The line the card and the report lead with for a search area.
export function searchHeadline(site = {}) {
  const km2 = site.area_km2;
  const size = km2 == null ? "a" : km2 < 1 ? `a ${Math.round(km2 * 100)} ha` : `a ${Math.round(km2 * 10) / 10} km²`;
  return `Screened ${size} search area (${site.role_why || "built from clues"}), because the site's outline wasn't found. Findings inside it say how much of it they cover; none of them is known to be on the site itself.`;
}

export const SEARCH_NOTE = (km2, why) => `a search area of ${km2 < 1 ? `${Math.round(km2 * 100)} ha` : `${Math.round(km2 * 10) / 10} km²`} (${why}), standing in for an outline that wasn't found`;

// Whether two features from different layers are the same feature (Rob, 24 Nov: the same shape, not just a similar
// box). Polygons: each covers at least 95% of the other, in a local equal-area projection. Lines: every vertex within
// 20 m of the other line, both ways. Points: within 10 m. Anything else, or a geometry that won't compare: not the same.
export const SAME_SHAPE = { cover: 0.95, lineM: 20, pointM: 10 };
export function sameShape(a, b, rules = SAME_SHAPE) {
  if (!a || !b) return false;
  const kind = (g) => (/Polygon/.test(g.type) ? "area" : /LineString/.test(g.type) ? "line" : /Point/.test(g.type) ? "point" : null);
  if (kind(a) !== kind(b) || !kind(a)) return false;
  const F = (g) => ({ type: "Feature", properties: {}, geometry: g });
  try {
    if (kind(a) === "point") {
      const pa = a.type === "Point" ? [a.coordinates] : a.coordinates, pb = b.type === "Point" ? [b.coordinates] : b.coordinates;
      return pa.length === pb.length && pa.every((c) => pb.some((d) => turf.distance(c, d) * 1000 <= rules.pointM));
    }
    if (kind(a) === "line") {
      const verts = (g) => (g.type === "LineString" ? g.coordinates : g.coordinates.flat());
      const lines = (g) => (g.type === "LineString" ? [g.coordinates] : g.coordinates).filter((l) => l.length > 1).map((l) => turf.lineString(l));
      const within = (pts, ls) => pts.every((c) => Math.min(...ls.map((l) => turf.pointToLineDistance(c, l))) * 1000 <= rules.lineM);
      return within(verts(a), lines(b)) && within(verts(b), lines(a));
    }
    const ab = coverageIn(F(a), b)?.coverage ?? 0, ba = coverageIn(F(b), a)?.coverage ?? 0;
    return ab >= rules.cover && ba >= rules.cover;
  } catch { return false; }
}
