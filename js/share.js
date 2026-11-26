// Share links (20 Nov): a run, slimmed and compressed into the link's # part. Nothing is stored anywhere and nothing
// is re-run: the link shows exactly what was produced. The report page (report.html) reads it; it's also the PDF.
// What travels: the site, the evidence behind the flags (not every feature fetched), what was checked, the gaps,
// the decision, the summary, the distances and the method. Geometry is simplified for display only and coordinates
// rounded to about a metre; the run download (GeoJSON) keeps everything. No DOM, so it can be tested.

export const SHARE_PREFIX = "v1.";
export const LONG_LINK = 8000; // characters: fine to open, but some chat apps cut links this long
export const MAX_LINK = 400000; // beyond this, browsers start to refuse; simplify harder or drop shapes

// Douglas–Peucker on lon/lat, tolerance in degrees. Display only.
function dp(points, tol) {
  if (points.length <= 2) return points;
  const [a, b] = [points[0], points.at(-1)];
  let idx = -1, max = -1;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segDist(points[i], a, b);
    if (d > max) { max = d; idx = i; }
  }
  if (max <= tol) return [a, b];
  return [...dp(points.slice(0, idx + 1), tol).slice(0, -1), ...dp(points.slice(idx), tol)];
}
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}
const r5 = (c) => [Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5];
function ring(coords, tol, closed) {
  const out = dp(coords.map(r5), tol);
  if (closed && out.length < 4) return coords.length >= 4 ? [coords[0], coords[1], coords[2], coords[0]].map(r5) : out;
  return out;
}
export function simplifyGeometry(g, tol) {
  if (!g) return g;
  switch (g.type) {
    case "Point": return { type: "Point", coordinates: r5(g.coordinates) };
    case "MultiPoint": return { type: g.type, coordinates: g.coordinates.map(r5) };
    case "LineString": return { type: g.type, coordinates: ring(g.coordinates, tol, false) };
    case "MultiLineString": return { type: g.type, coordinates: g.coordinates.map((l) => ring(l, tol, false)) };
    case "Polygon": return { type: g.type, coordinates: g.coordinates.map((l) => ring(l, tol, true)) };
    case "MultiPolygon": return { type: g.type, coordinates: g.coordinates.map((p) => p.map((l) => ring(l, tol, true))) };
    default: return g;
  }
}

const KEEP_PROPS = ["role", "fid", "name", "type", "theme", "distance_km", "band", "dataset", "publisher", "licence", "checked_at", "surrounds", "in_search_area", "coverage", "side",
  "part", "deduction", "label", "kind", "ha", "relation", "site_share", "length_inside_km", "parts", "parts_on_site"];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null).map((k) => [k, o[k]]));

// The run, slimmed for a link. tol: simplification in degrees (0.0002 ≈ 20 m).
export function slimRun(record, { tol = 0.0002, now = () => new Date().toISOString() } = {}) {
  const r = record.tobler_run;
  const flagged = new Set(r.flags.flatMap((f) => f.fids || []));
  const evidence = record.features.filter((f) => f.properties.role === "evidence");
  // An area budget's shapes (what's left, what was taken off) travel too: they are its findings.
  const feats = record.features.filter((f) => f.properties.role === "site" || f.properties.role === "budget" || flagged.has(f.properties.fid));
  const run = {
    schema: r.schema, id: r.id, kind: r.kind, skill: r.skill, model: r.model, industry: r.industry ?? null, ...(r.study ? { study: r.study } : {}), ...(r.budget ? { budget: r.budget } : {}),
    started_at: r.started_at, finished_at: r.finished_at, decision: r.decision ?? null,
    site: r.site, ...(r.sea ? { sea: r.sea } : {}), ...(r.elevation ? { elevation: r.elevation } : {}),
    extent: r.extent, ...(r.reach ? { reach: r.reach } : { distances: r.distances }), fetched_to_km: r.fetched_to_km, assessed_within_km: r.assessed_within_km, method: r.method,
    flags: r.flags.map((f) => ({ id: f.id, risk: f.risk, theme: f.theme, severity: f.severity ?? null, confidence: f.confidence, why: f.why, next_step: f.next_step || "",
      nearest_km: f.nearest_km, fids: f.fids || [], ...pick(f, ["relation", "coverage", "confidence_capped", "linkage"]),
      evidence: f.evidence.map((e) => pick(e, ["name", "distance_km", "band", "dataset", "publisher", "licence", "checked", "traced", "fid", "ref", "check", "from_values", "in_search_area", "coverage", "side", "relation", "site_share", "length_inside_km", "parts", "parts_on_site"])) })),
    checked: r.checked.map((c) => ({ ...pick(c, ["evidence", "dataset", "publisher", "licence", "checked_at", "result", "count"]), ...(c.why ? { why: String(c.why).slice(0, 160) } : {}) })),
    ...(r.checks ? { checks: r.checks.map((c) => ({ ...pick(c, ["id", "topic", "label", "must", "answer", "scale", "reach_km", "reach_wanted_km", "reach_from", "reach_default_km", "reach_note", "state", "reason", "count", "bands", "bands_imperial", "around", "nearest", "inside", "text", "capped", "partly", "search_area", "classes", "irz_codes", "adjacent", "site_share", "zones", "next_to"]),
      ...(c.irz ? { irz: c.irz.map((z) => ({ key: z.key, category: z.category, consult: z.consult })) } : {}),
      // The nearest ten of each check's features travel in a link, by name (the shapes behind the flags travel anyway).
      ...(c.features?.length ? { features: c.features.slice(0, 10).map((f) => pick(f, ["name", "distance_km", "around", "coverage", "detail", "publisher", "relation", "site_share", "length_inside_km", "parts", "parts_on_site"])), features_total: c.features.length } : {}),
      ...(c.why ? { why: String(c.why).slice(0, 160) } : {}), ...(c.source ? { source: pick(c.source, ["atlas_id", "tool", "dataset", "publisher", "licence", "checked_at"]) } : {}),
      ...(c.sources?.length ? { sources: c.sources.map((x) => pick(x, ["region", "atlas_id", "dataset", "publisher", "licence", "checked_at", "state"])) } : {}) })),
      checks_scale: r.checks_scale, ...pick(r, ["checks_version", "checks_merge_shapes", "no_check_topics", "topic_labels"]) } : {}),
    data_gaps: r.data_gaps, summary: r.summary, disclaimer: r.disclaimer,
    ...(r.replaces ? { replaces: r.replaces } : {}), ...(r.out_of_date ? { out_of_date: r.out_of_date } : {}),
    assessments: (r.assessments || []).map((a) => ({ at: a.at, within_km: a.within_km, flags: a.flags?.length ?? 0, decision: a.decision?.value ?? null })),
    evidence_total: evidence.length,
    shared: { at: now(), evidence: r.budget ? `the area budget's shapes, of ${evidence.length} features found; shapes simplified for display` : `the ${feats.length - 1} features behind the flags, of ${evidence.length} found; shapes simplified for display` },
  };
  return {
    type: "FeatureCollection", tobler_run: run,
    features: feats.map((f) => ({ type: "Feature", properties: pick(f.properties, KEEP_PROPS), geometry: simplifyGeometry(f.geometry, tol) })),
  };
}

// base64url for bytes, in the browser and in Node.
const toB64 = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (s) => {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeRun(slim) {
  const bytes = new TextEncoder().encode(JSON.stringify(slim));
  return SHARE_PREFIX + toB64(await pipe(bytes, new CompressionStream("deflate-raw")));
}
export async function decodeRun(code) {
  const c = String(code || "").replace(/^#?(r=)?/, "");
  if (!c.startsWith(SHARE_PREFIX)) throw new Error("This link isn't a Tobler report link, or it's from a newer version.");
  const bytes = await pipe(fromB64(c.slice(SHARE_PREFIX.length)), new DecompressionStream("deflate-raw"));
  const rec = JSON.parse(new TextDecoder().decode(bytes));
  if (!rec?.tobler_run?.flags) throw new Error("The link didn't hold a screening run.");
  return rec;
}

// The link's # part for a run: simplify harder if it's too long to open, and say if it's long to paste.
export async function shareCode(record, opts = {}) {
  let code = "", tol = 0.0002;
  for (let i = 0; i < 5; i++, tol *= 5) {
    code = await encodeRun(slimRun(record, { ...opts, tol }));
    if (code.length <= MAX_LINK) break;
  }
  return { code, chars: code.length, long: code.length > LONG_LINK, tooLong: code.length > MAX_LINK };
}
