// Sealed NTR runs: a screening runs as its own short agent loop (skill, fixed inputs, read-only data tools,
// structured result), never inside the conversation. The result is a run record: GeoJSON with provenance, the one
// source for the card, the map and later exports. No DOM, so the page, the scripts and the tests share it.
import * as turf from "./vendor/turf.js";
import * as R from "./reference.js";
import { FENCE_RULE } from "./fence.js";
import { runTurn } from "./converse.js";
import { createPlaceTools, placeToolDefs } from "./placetools.js";
import { fileOriginText } from "./fileimport.js";
import { bandFor, distancesLine, chooseDistances, ASSET_TYPES, MAX_KM } from "./distances.js";
import { nearestBoundaries } from "./boundaries.js";
import { DISCLAIMER } from "./disclaimer.js";
// The caveat for a screen of something the profile isn't built for, when the profile doesn't give its own words.
export const OUTSIDE_PROFILE = "A general screen: the method wasn't built for this kind of development, so treat it as a first look.";
import { aroundSiteKm2 } from "./datatools.js";
import { siteChange } from "./outofdate.js";
import { waterDepth, vesselTraffic, seaLines } from "./seavalues.js";
import { elevationFrom, elevationSignificance, elevationLine, elevationShort } from "./elevation.js";
import { readDecision, settleDecision } from "./industry.js";
import * as K from "./checks.js";
import { placeRole, coverageIn, whereText, applySearchArea, reword, sameShape, SEARCH_BAND, SEARCH_NOTE } from "./siterole.js";

// The band for a piece of evidence: a wide area the site lies within is "around the site", not "on site".
export const AROUND = "around the site";
// Inside a search area (a stand-in for an outline nobody found), distance 0 is "in the search area", not "on site".
const bandOf = (p, d) => (p.surrounds ? AROUND : p.in_search_area && !(p.distance_km > 0) ? SEARCH_BAND : bandFor(p.distance_km, d));

// tobler-run/2 (23 Nov): adds the checks. Old share links (tobler-run/1, no checks) still open.
export const RUN_SCHEMA = "tobler-run/2";
export const SCREEN_TOOLS = ["get_place", "find_data", "get_data", "find_features_near", "get_elevation"];
const THEME_OF = { PS4: "community", PS5: "land", PS6: "biodiversity", PS7: "indigenous", PS8: "heritage", context: "context" };
export const THEME_CODE = Object.fromEntries(Object.entries(THEME_OF).map(([k, v]) => [v, k]));
const CONF_ORDER = { high: 0, medium: 1, low: 2 };
// Severity (how much it would matter if real) is kept apart from confidence (how sure the evidence is). A flag the
// analyst didn't rate sorts after the rated ones of the same confidence; nothing is guessed for it.
const SEV_ORDER = { high: 0, medium: 1, low: 2 };
const sevRank = (f) => SEV_ORDER[f.severity] ?? 3;
// A plain summary written in code from a result's decision, flags and gaps, for when the analyst's own write-up was
// cut off and only the result could be recovered. It says only what the result says.
export function summaryFromResult(json) {
  const lines = [];
  if (json?.decision) lines.push(`Decision: ${String(json.decision).trim()}.${json.decision_why ? ` ${String(json.decision_why).trim()}` : ""}`);
  const flags = Array.isArray(json?.flags) ? json.flags : [];
  if (flags.length) {
    lines.push("", "Flags, most serious first:");
    const rank = (f) => (SEV_ORDER[f.severity] ?? 3) * 3 + (CONF_ORDER[f.confidence] ?? 2);
    for (const f of [...flags].sort((a, b) => rank(a) - rank(b))) lines.push(`- ${f.risk}${f.next_step ? `. Next step: ${f.next_step}` : ""}`);
  } else lines.push("", "No flags raised.");
  const gaps = Array.isArray(json?.data_gaps) ? json.data_gaps.length : 0;
  if (gaps) lines.push("", `${gaps} gap${gaps === 1 ? "" : "s"} noted: see the gaps.`);
  lines.push("", "(The analyst's write-up was cut off, so this summary was put together from its result.)");
  return lines.join("\n");
}
export const findingId = (i) => `F-${String(i + 1).padStart(2, "0")}`;
const round = (v, d = 2) => (v == null || !Number.isFinite(+v) ? null : Math.round(+v * 10 ** d) / 10 ** d);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The site as screened: a point gets a footprint circle (radius from the distance table); lines and areas as they are.
// Volume guard (Rob's housing screen near Liverpool, 20 Nov: ~400 features to 20 km, and the write-up was cut off).
// Everything found still goes on the map and into the run record; the analyst sees the count and the nearest few,
// and details that only repeat the name are dropped.
export const DENSE_AT = 25, DENSE_SHOW = 6;
export function forAnalyst(name, out) {
  if (!out || typeof out !== "object") return out;
  const key = name === "find_features_near" ? "candidates" : name === "get_data" ? "nearest" : null;
  if (!key || !Array.isArray(out[key])) return out;
  const total = name === "find_features_near" ? out.found : (out.within_distance ?? out.returned_by_service);
  const slim = (x) => {
    const d = x.details && Object.entries(x.details).filter(([k, v]) => !(k === "name" && v === x.name));
    return { ...x, ...(x.details ? { details: d.length ? Object.fromEntries(d) : undefined } : {}) };
  };
  const list = out[key].map(slim);
  if (!(total > DENSE_AT) || list.length <= DENSE_SHOW) return { ...out, [key]: list };
  const shown = list.slice(0, DENSE_SHOW);
  const { not_listed, listed, ...rest } = out;
  return { ...rest, [key]: shown, listed: shown.length,
    dense: `${total} found: a busy area. Only the nearest ${shown.length} are shown here (all are on the map and in the run). Report the count and the nearest, say what it means for the site, and don't list more.` };
}

// The analyst's view of a tool's output on a search area: items inside it say where, and how much of it they cover.
export function markInArea(name, out, inArea) {
  const key = name === "find_features_near" ? "candidates" : name === "get_data" ? "nearest" : null;
  if (!key || !out || !Array.isArray(out[key])) return out;
  return { ...out, [key]: out[key].map((x) => {
    const w = !(x.distance_km > 0) && !x.around_site ? inArea.get(`${norm(x.name)}|${round(x.distance_km, 2)}`) : null;
    return w ? { ...x, in_search_area: w } : x;
  }) };
}

export function footprintOf(feature, d) {
  if (feature.geometry.type !== "Point") return { feature, note: null };
  const f = turf.circle(feature.geometry.coordinates, d.footprint_km, { units: "kilometers", steps: 48 });
  return { feature: { type: "Feature", properties: {}, geometry: f.geometry }, note: `a point, screened as a ${d.footprint_km} km footprint round it (default for a ${d.asset_label})` };
}

export function systemFor(skill) {
  return `You are Tobler's screening analyst, running one sealed screen of one site for environmental constraints and environmental and social (E&S) risk. Nobody is chatting with you: do the screen, then write the result.

- ${FENCE_RULE}
- The site, its footprint, the asset type, the stage and the distances are fixed by this run and given in the first message. Use them as given; don't ask about them and don't change them. If the stage or asset type was assumed, say so in the summary.
- The tools fetch every dataset out to the wider band and measure from the footprint edge. Never work out a distance yourself: use the distances the tools return.
- Items marked around_site (or "around the site") are wide areas the site lies within: seas, regions, very large designations. They are not features on the site. Mention one only where being inside it matters for this project (for example a large protected area the site sits in, or a MARPOL special area for an offshore site); a sea area around an onshore site is not a finding.
- Put independent searches in the same step: they run at the same time. Aim to finish within about ten steps.
- Name features and datasets as the data names them. Ids (C3, D2) are for tool calls only.
- Your last message is the result: the short summary, then the JSON block, exactly as the method's Output section says. Use the distances given (not the skill's table) in "distances_km".
- Keep the result compact so it fits in one reply: summary under 300 words; at most 8 flags, each next_step one short line; at most 4 evidence items per flag (the nearest or strongest, and say in "why" how many more there are); "data_gaps" at most 12 short lines; leave "checked" as an empty list, because the run records what the tools checked itself. Keep your thinking before the result short: the reply limit (16,000 tokens) includes it.

<method skill="${skill.name}" version="${skill.version}">
${skill.body}
</method>`;
}

export const isArea = (feature) => /Polygon/.test(feature?.geometry?.type || "");

export function firstMessage({ siteName, describe, inputs, distances, footprintNote, origin, baseline = null, inside = false, searchArea = null }) {
  const reach = inside ? 0 : distances.wider;
  const lines = [
    `Screen ${siteName}.`,
    `Site: ${R.summaryLine(describe)}${footprintNote ? `; ${footprintNote}` : ""}.`,
    origin ? `How the site was found: ${origin}.` : null,
    searchArea ? `This is a search area, not the site's outline: ${searchArea}. Nobody knows where on it the ${inputs.asset_label} would go. So nothing is "on site": a feature with distance 0 is "in the search area", and the tools say how much of the area it covers (in_search_area). Say "in the search area" and give that share; a small share on the edge is something a layout could avoid. Severity is how much it would matter if it is on the site; the run caps the confidence of findings inside a search area. Put one line in data_gaps saying the site's outline wasn't found.` : null,
    `Setting: ${describe.offshore ? "offshore" : "onshore"}${describe.coast_km != null && describe.coast_km < 10 ? " (coastal: screen both ways)" : ""}.`,
    `Asset type: ${inputs.asset_label}${inputs.asset_assumed ? " (assumed: say so)" : ""}. Stage: ${inputs.stage || "greenfield (assumed: say so)"}.`,
    inputs.outside_profile ? `This is outside what the method was built for, so do a general screen with the same themes and say once in the summary that it's a first look. The card already carries this caveat: ${inputs.outside_profile}` : null,
    inputs.capacity_mw ? `Capacity: ${inputs.capacity_mw} MW.` : null,
    inputs.tip_height_m ? `Turbine tip height: ${inputs.tip_height_m} m.` : null,
    inside
      ? "Scope: inside the area only, as the person asked. The tools fetch only what lies inside the area or touches its edge (distance 0, band \"on site\"); the surroundings were not screened. Assess only what is inside, and put one line in data_gaps saying the surroundings weren't screened."
      : `Distances from the footprint edge: ${distancesLine(distances)}. Why: ${distances.reasons.join("; ")}.`,
    inputs.focus ? `The person asked especially about: ${inputs.focus}.` : null,
    describe.offshore && describe.coast_km != null && describe.coast_km > reach
      ? `No land ${inside ? "inside the area" : "within the wider band"} (the coast is about ${Math.round(describe.coast_km)} km away): settlements, schools, clinics, roads and other onshore receptors are out of reach. Don't search for them and don't list them as gaps; coastal communities matter only as spill reach beyond the bands.` : null,
    baseline ? `Already checked by the run before you started, by topic (don't fetch these again; they are evidence like anything you fetch). Each check is found, none found, or not checked with the reason; "must" marks a check its topic can't be called clear without. Not-checked lines are already on the card as gaps, so don't repeat them in data_gaps unless you have something to add:\n${baseline}` : null,
    `Refer to the site as "${siteName}" in tool calls.`,
  ];
  return lines.filter(Boolean).join("\n");
}

// The last ```json block in the reply (or the last {...} that parses).
export function parseResult(text) {
  const t = String(text || "");
  const re = /```(?:json)?\s*([\s\S]*?)```/g;
  const blocks = [];
  for (let m; (m = re.exec(t));) blocks.push({ body: m[1], start: m.index });
  for (const b of blocks.reverse()) { try { return { json: JSON.parse(b.body), summary: t.slice(0, b.start).trim() }; } catch { /* try the one before */ } }
  const i = t.indexOf("{"), j = t.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return { json: JSON.parse(t.slice(i, j + 1)), summary: t.slice(0, i).trim() }; } catch { /* fall through */ } }
  return { json: null, summary: t.trim() };
}

// Match each evidence item the model gave to a feature the tools actually returned in this run.
// Evidence the analyst takes from the values the run read at sea (water depth, AIS traffic) has no feature to match:
// it traces to those values instead, when the run has them.
const DEPTH_WORDS = /water depth|\bdepth\b|bathymetr|DEM Global Mosaic/i;
const ELEV_WORDS = /elevation|altitude|above sea level|below sea level|low-lying|DEM Global Mosaic|ETOPO/i;
const TRAFFIC_WORDS = /vessel|\bAIS\b|traffic|Vessel Density/i;
function traceToSea(e, sea, d) {
  const text = `${e.name || ""} ${e.dataset || ""}`;
  const v = sea?.depth && DEPTH_WORDS.test(text) ? { src: sea.depth, km: 0, value: "water depth" }
    : sea?.elevation && ELEV_WORDS.test(text) ? { src: sea.elevation, km: 0, value: "elevation" }
    : sea?.traffic && TRAFFIC_WORDS.test(text) ? { src: sea.traffic, km: e.distance_km > 0 ? sea.traffic.busiest.distance_km : 0, value: "vessel traffic" } : null;
  if (!v) return null;
  return { ...e, distance_km: v.km, band: v.km === 0 ? "on site" : bandFor(v.km, d), dataset: v.src.dataset, publisher: v.src.publisher, licence: v.src.licence, checked: v.src.checked_at, from_values: v.value, traced: true };
}

export function traceFlags(flags, evidence, d, sea = null) {
  // A feature can go by more than one name: a maritime boundary by its line name or by the territories either side.
  const feats = evidence.flatMap((f) => [f.properties.name, f.properties.details?.sides].filter(Boolean).map((nm) => ({ f, n: norm(nm), ds: norm(f.properties.dataset) })));
  return (flags || []).map((flag) => {
    const ev = (flag.evidence || []).map((e) => {
      const n = norm(e.name), ds = norm(e.dataset);
      const near = (f) => e.distance_km == null || f.properties.distance_km == null || Math.abs(f.properties.distance_km - e.distance_km) <= Math.max(0.5, 0.15 * f.properties.distance_km);
      const named = feats.filter((x) => n && x.n && (x.n === n || (n.length >= 4 && (x.n.includes(n) || n.includes(x.n)))));
      const hit = named.find((x) => near(x.f) && ds && x.ds && (x.ds.includes(ds) || ds.includes(x.ds))) || named.find((x) => near(x.f)) || null;
      if (!hit) return traceToSea(e, sea, d) || { ...e, distance_km: round(e.distance_km), traced: false };
      const p = hit.f.properties;
      return { ...e, name: p.name, distance_km: p.distance_km, band: bandOf(p, d), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, fid: p.fid, traced: true,
        ...(p.in_search_area ? { in_search_area: true, ...(p.coverage != null ? { coverage: p.coverage } : {}), ...(p.side ? { side: p.side } : {}) } : {}) };
    });
    const traced = ev.filter((e) => e.traced);
    const dists = (traced.length ? traced : ev).map((e) => e.distance_km).filter((v) => v != null);
    return {
      risk: String(flag.risk || "").trim(), theme: THEME_OF[flag.theme] || THEME_OF[String(flag.theme || "").toUpperCase()] || (THEME_CODE[flag.theme] ? flag.theme : "context"),
      confidence: CONF_ORDER[flag.confidence] != null ? flag.confidence : "low",
      severity: SEV_ORDER[flag.severity] != null ? flag.severity : null, why: flag.why || "",
      next_step: String(flag.next_step || "").trim(), evidence: ev,
      fids: traced.map((e) => e.fid), nearest_km: dists.length ? Math.min(...dists) : null, traced: traced.length, untraced: ev.length - traced.length,
    };
  }).sort((a, b) => sevRank(a) - sevRank(b) || CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence] || (a.nearest_km ?? 1e9) - (b.nearest_km ?? 1e9))
    // Finding IDs follow the order shown, so F-01 is the same on the card, the map, the download and later the PDF.
    .map((f, i) => ({ id: findingId(i), ...f }));
}

// What the tools actually checked, from their replies (ground truth for the card, beside the model's own list).
function checkedFrom(tool, input, out) {
  if (tool === "get_data") {
    if (!out) return null;
    return { evidence: input.theme || "", dataset: out.dataset || input.dataset, publisher: out.publisher || "", licence: out.licence || "", checked_at: out.checked_at,
      result: out.not_checked ? "not checked" : out.within_distance ? "features" : "none in dataset", count: out.within_distance || 0, ...(out.not_checked ? { why: out.not_checked } : {}) };
  }
  if (tool === "find_features_near") {
    if (!out) return null;
    const srcs = out.sources || [];
    const failed = srcs.filter((s) => s.not_checked || s.error).map((s) => `${s.source}: ${s.not_checked || s.error}`);
    return { evidence: input.theme || "", dataset: `${input.feature_type} (atlas and OpenStreetMap)`, publisher: srcs.map((s) => s.source).join(", "), licence: "",
      result: out.found ? "features" : failed.length === srcs.length && srcs.length ? "not checked" : "none in dataset", count: out.found || 0, ...(failed.length ? { why: failed.join("; ").slice(0, 300) } : {}) };
  }
  if (tool === "find_data" && out?.not_checked) return { evidence: input.text, dataset: `catalogue search "${input.text}"`, publisher: "AI Living World Atlas", result: "not checked", why: out.not_checked };
  return null;
}

// host: the same host the page gives createPlaceTools (atlas, firms, ref, trusted, fetchFn…). The run gets its own
// tools, with a host whose only place is the site footprint and whose findings go into the run, not the map.
export const SCREEN_MAX_TOKENS = 16000;
// Every model call in a screening run asks for the larger reply limit (the conversation keeps the smaller one).
const roomy = (callClaude) => (args) => callClaude({ ...args, maxTokens: SCREEN_MAX_TOKENS });

export async function runScreening({ host, site, inputs, distances, skill, callClaude: call, model = "", runId = "R1", maxRounds = 14, onEvent = () => {}, now = () => new Date().toISOString() }) {
  const callClaude = roomy(call);
  const started = now();
  const fp = footprintOf(site.feature, distances);
  // Inside only (areas, when the person asks): fetch only what's inside or touching; otherwise out to the wider band.
  const inside = inputs.extent === "inside" && isArea(site.feature);
  const reach = inside ? 0 : distances.wider;
  const screenPlace = { name: site.name, feature: fp.feature, origin: site.origin, status: "accepted", edits: [] };
  const evidence = [];
  const seen = new Map();
  const siteKm2 = isArea(fp.feature) ? turf.area(fp.feature) / 1e6 : 0;
  // What the site is: a point is screened on a default footprint, which stands in for an outline nobody has, so it's a
  // search area too; an area is whatever make_place recorded (js/siterole.js).
  const role = site.feature.geometry.type === "Point"
    ? { role: "search_area", why: `a default ${distances.footprint_km} km footprint round a point` }
    : placeRole(site.origin, site.feature.geometry);
  const searchArea = role.role === "search_area" && isArea(fp.feature);
  const searchNote = searchArea ? SEARCH_NOTE(siteKm2, role.why) : null;
  const inArea = new Map(); // name|distance → where in the search area, for the analyst's view of the tool output
  const rawFound = new Map(); // dataset title → every feature a tool returned, before de-duplication (for the checks)
  const capture = (list, meta = {}) => {
    for (const c of list) {
      const ds = c.source?.title || meta.dataset || "";
      if (!rawFound.has(ds)) rawFound.set(ds, []);
      rawFound.get(ds).push(c);
      const around = c.around_site ? c.area_km2 : aroundSiteKm2(siteKm2, c.geometry, c.distance_km);
      const dataset = c.source?.title || meta.dataset || "";
      const key = `${norm(dataset)}|${norm(c.name)}|${round(c.distance_km, 2)}`;
      if (seen.has(key)) continue;
      const fid = `E${evidence.length + 1}`;
      seen.set(key, fid);
      // Inside a search area: how much of it the feature covers, and where (equal-area, js/siterole.js).
      let where = null;
      if (searchArea && !around && c.geometry && !(c.distance_km > 0)) {
        try { where = coverageIn(fp.feature, c.geometry); } catch { where = null; }
        if (!where) where = { coverage: null, side: null };
        inArea.set(`${norm(c.name)}|${round(c.distance_km, 2)}`, whereText(where));
      }
      evidence.push({ type: "Feature", geometry: c.geometry, properties: {
        role: "evidence", fid, run: runId, name: c.name || c.type || "Unnamed feature", type: c.type || "", theme: meta.theme || "context",
        distance_km: round(c.distance_km, 2), band: around ? AROUND : where ? SEARCH_BAND : bandFor(c.distance_km, distances), area_km2: c.area_km2 ?? (around ? Math.round(around) : null),
        ...(where ? { in_search_area: true, ...(where.coverage != null ? { coverage: Math.round(where.coverage * 1000) / 1000 } : {}), ...(where.side ? { side: where.side } : {}) } : {}),
        ...(around ? { surrounds: true } : {}),
        dataset, publisher: meta.publisher || c.source?.publisher || "", licence: c.source?.licence || "",
        checked_at: now(), ...(c.extra && Object.keys(c.extra).length ? { details: c.extra } : {}),
      } });
    }
  };
  const sealedHost = {
    ...host,
    places: () => [screenPlace],
    // One place in a sealed run: any place name means the site.
    findPlace: () => screenPlace,
    addPlace() { throw new Error("A screening run can't add places."); },
    updatePlace() { throw new Error("A screening run can't change places."); },
    renamePlace() { throw new Error("A screening run can't rename places."); },
    offerChoices: undefined, onCandidates: undefined, showFindings: undefined, clearFindings: undefined,
    addFindings: capture,
  };
  const tools = createPlaceTools(sealedHost);
  const defs = placeToolDefs([]).filter((t) => SCREEN_TOOLS.includes(t.name));
  const checked = [];
  const calls = [];
  const lastOut = new Map(); // dataset id → the tool's own output, for the checks (the analyst sees a slimmer copy)
  const exec = async (name, input, meta = {}) => {
    if (!SCREEN_TOOLS.includes(name)) throw new Error(`${name} isn't available in a screening run.`);
    const i = { ...input };
    // Fetch once, out to the wider band, so the card's slider can work inside it without new queries.
    // The checks step can keep a layer to its own reach (meta.ownReach: class layers, dense layers); otherwise out to the wider band.
    if (name === "get_data") { i.place = site.name; i.within_km = inside ? 0 : meta.ownReach ? Math.min(MAX_KM, Math.max(0, +i.within_km || 0)) : Math.min(MAX_KM, Math.max(+i.within_km || 0, reach)); }
    if (name === "find_features_near") { i.anchor = /^C\d+$/i.test(String(i.anchor || "")) ? i.anchor : site.name; i.radius_km = inside ? 0 : Math.min(MAX_KM, Math.max(+i.radius_km || 0, reach)); }
    const t0 = Date.now();
    try {
      const out = await tools.exec(name, i);
      calls.push({ tool: name, input: i, ms: Date.now() - t0 });
      const c = checkedFrom(name, i, out); if (c) checked.push(meta.check ? { ...c, check: meta.check } : c);
      if (name === "get_data") lastOut.set(i.dataset, out);
      return forAnalyst(name, searchArea ? markInArea(name, out, inArea) : out);
    } catch (e) {
      calls.push({ tool: name, input: i, ms: Date.now() - t0, error: String(e.message || e).slice(0, 200) });
      // A mistyped id (a candidate's C1 passed as a dataset) is the analyst's slip, not a source that wasn't checked.
      const realSource = name === "find_features_near" || (name === "get_data" && tools.datasets?.has?.(String(i.dataset || "").toUpperCase()));
      if (realSource) checked.push({ evidence: i.theme || "", dataset: i.dataset || i.feature_type, result: "not checked", why: String(e.message || e).slice(0, 200) });
      throw e;
    }
  };
  const describe = await R.describe(host.ref, fp.feature);
  const offshore = !!describe.offshore;
  // Checks, in code, before the analyst starts (catalogue/checks.json; js/checks.js): every check that applies to
  // this site, at this scale, comes back found, none found or not checked with the reason, so the essentials never
  // depend on a lucky catalogue search and a topic with no data shows as a gap, never as silence.
  const sea = offshore || (describe.coast_km != null && describe.coast_km <= reach);
  const catalogue = host.checks || { checks: [], topics: [], scales: {} };
  const scale = K.screenScale(distances, siteKm2);
  const edges = catalogue.scales?.[scale] || [];
  const sb = turf.bbox(fp.feature);
  const plans = K.planChecks(catalogue, { bbox: sb, countries: describe.countries || [], offshore, sea, coast_km: describe.coast_km ?? null }, scale, { inside });
  const results = new Map();
  const featsOf = new Map(); // check id → the evidence properties it counted, for the analyst's nearest names
  for (const p of plans) {
    const u = K.unsourced(p);
    if (!u) continue;
    results.set(p.check.id, u);
    // In the run's list of sources too, so "what still needs checking" picks it up.
    const region = p.sources.length === 1 ? p.sources[0].region : null;
    checked.push({ evidence: p.check.topic, dataset: `${p.check.label}${region ? ` (${region})` : ""}`, result: "not checked", why: u.why, check: p.check.id });
  }
  const fetchKm = (p) => Math.min(MAX_KM, Math.max(p.reach_km || 0, reach));
  const asFeats = (list) => list.map((x) => ({ name: x.name, distance_km: x.distance_km, around_site: !!(x.surrounds || x.around_site) }));
  const toolPlan = (tool) => plans.find((p) => p.source?.tool === tool && !results.has(p.check.id));
  let boundaryFids = [];
  const bp = toolPlan("boundaries");
  if (bp) {
    try {
      const tb = Date.now();
      const nb = await nearestBoundaries({ ref: host.ref, site: fp.feature, withinKm: fetchKm(bp), atlas: host.atlas || null, sea, now });
      onEvent({ type: "tool", name: "nearest_boundaries", input: { within_km: fetchKm(bp), sea }, ms: Date.now() - tb, baseline: true,
        output: { found: nb.evidence.map((e) => `${e.name} (${e.type}) ${e.distance_km} km`), checked: nb.checked.map((c) => `${c.dataset}: ${c.result}${c.why ? ` (${c.why})` : ""}`) } });
      const e0 = evidence.length;
      capture(nb.evidence, { theme: K.mapTheme(bp.check.topic) });
      boundaryFids = evidence.slice(e0).map((f) => f.properties.fid);
      for (const c of nb.checked) checked.push({ ...c, check: bp.check.id });
      const failed = nb.checked.filter((c) => c.result === "not checked");
      if (nb.checked.length && failed.length === nb.checked.length) results.set(bp.check.id, K.notChecked(bp, failed.map((c) => `${c.dataset}: ${c.why}`).join("; ")));
      else {
        const r = K.fromFeatures(bp, asFeats(nb.evidence), edges, { dataset: nb.checked.map((c) => c.dataset).join("; "), publisher: [...new Set(nb.checked.map((c) => c.publisher).filter(Boolean))].join("; "),
          licence: [...new Set(nb.checked.map((c) => c.licence).filter(Boolean))].join("; "), checked_at: now(), fetched_km: fetchKm(bp) });
        if (failed.length) r.partly = failed.map((c) => `${c.dataset}: not checked (${c.why})`).join("; ");
        results.set(bp.check.id, r);
        featsOf.set(bp.check.id, nb.evidence.map((e) => ({ name: e.name, distance_km: e.distance_km, details: e.extra, surrounds: e.around_site })));
      }
    } catch (e) {
      checked.push({ evidence: "transboundary", dataset: "boundaries", result: "not checked", why: String(e.message || e).slice(0, 160), check: bp.check.id });
      results.set(bp.check.id, K.notChecked(bp, String(e.message || e)));
    }
  }
  // Atlas layers, each fetched once however many checks use it (JNCC's offshore set serves the SAC, SPA and marine
  // checks), out to the furthest reach any of them needs.
  const layerPlans = plans.filter((p) => !results.has(p.check.id) && p.sources.some((x) => x.atlas_id));
  const layerFetch = new Map(); // atlas_id → { source, km, fields, name_field }
  for (const p of layerPlans) for (const x of p.sources.filter((y) => y.atlas_id)) {
    const l = layerFetch.get(x.atlas_id) || { source: x, km: 0, fields: new Set(), name_field: x.name_field || null, coverage: false };
    // Every check layer fetches only to its own reach, up to 500 features (24 Nov): fetched out to the wider band, a
    // busy layer filled its limit with features far away and undercounted the ones in reach (15+ scheduled monuments
    // round Linlithgow). The analyst's own searches still go to the wider band, for the slider.
    l.km = Math.max(l.km, Math.min(MAX_KM, Math.max(0, p.reach_km || 0)));
    if (p.check.answer === "classes") l.coverage = true;
    for (const f of [x.code_field, x.filter?.field, x.class_field, ...(x.keep_fields || [])].filter(Boolean)) l.fields.add(f);
    layerFetch.set(x.atlas_id, l);
  }
  const layers = [...layerFetch.values()];
  // Values read off rasters (catalogue/trusted.json "values"): elevation over the footprint on every site on land,
  // water depth offshore, and AIS vessel traffic when the sea is within the close band. In parallel with the layers.
  const vals = host.trusted?.values || {};
  const elevSources = vals.elevation || [];
  const depthPlan = toolPlan("depth"), elevPlan = toolPlan("elevation"), trafficPlan = toolPlan("traffic");
  const wantDepth = !!depthPlan && offshore && elevSources.length > 0;
  const wantElev = !!elevPlan && !offshore && elevSources.length > 0;
  const wantTraffic = !!trafficPlan && !inside && !!vals.traffic && (offshore || (describe.coast_km != null && describe.coast_km <= distances.close));
  const fetchFn = host.fetchFn || globalThis.fetch;
  const seaVals = {};
  let elevation = null, elevSig = null;
  const valueResult = (plan, got, ok) => {
    if (!plan || !got) return;
    if (got.checked.result === "not checked") { results.set(plan.check.id, K.notChecked(plan, got.checked.why, got.checked)); return; }
    const text = ok();
    if (text) results.set(plan.check.id, K.fromValue(plan, { text, meta: got.checked }));
    else results.set(plan.check.id, { ...K.notChecked(plan, got.checked.why || "no reading on the site", got.checked), reason: "failed" });
  };
  const seaJob = (wantDepth || wantElev || wantTraffic) ? (async () => {
    const t0 = Date.now();
    const [d, e, t] = await Promise.all([
      wantDepth ? waterDepth({ site: fp.feature, sources: elevSources, fetchFn, now }) : null,
      wantElev ? elevationFrom(elevSources, { feature: fp.feature, fetchFn, now }) : null,
      wantTraffic ? vesselTraffic({ site: fp.feature, closeKm: distances.close, source: vals.traffic, fetchFn, now }) : null,
    ]);
    if (d) { checked.push({ ...d.checked, check: depthPlan.check.id }); if (d.depth) seaVals.depth = d.depth; if (d.elevation) elevation = d.elevation; }
    if (e) { checked.push({ ...e.checked, check: elevPlan.check.id }); if (e.elevation) { elevation = e.elevation; elevSig = elevationSignificance(elevation); } }
    if (t) { checked.push({ ...t.checked, check: trafficPlan.check.id }); if (t.traffic) seaVals.traffic = t.traffic; capture(t.evidence, { theme: K.mapTheme(trafficPlan.check.topic) }); }
    // The card's short line for each value (the source goes beside it, from the check's record).
    valueResult(depthPlan, d, () => (seaVals.depth ? seaLines({ depth: seaVals.depth })[0].split(". ")[0].replace(/^Water depth /, "") : null));
    valueResult(elevPlan, e, () => (elevation ? elevationShort(elevation, elevSig).replace(/ \(NOAA\)\.$/, "").replace(/^Elevation /, "") : null));
    const tv = seaVals.traffic;
    valueResult(trafficPlan, t, () => (tv ? seaLines({ traffic: tv })[0].replace(` ${tv.dataset} (${tv.publisher}).`, "").replace(/\.$/, "").replace(/^Vessel traffic \(AIS, (\d{4} annual average)\): /, "$1: ") : null));
    const lines = [...(elevSig ? [elevationLine(elevation, elevSig)] : []), ...seaLines(seaVals)];
    const notChecked = [d, t, e && e.checked.result === "not checked" ? e : null].filter((x) => x && x.checked.result !== "features")
      .map((x) => `${x.checked.dataset}: ${x.checked.result}${x.checked.why ? ` (${x.checked.why})` : ""}`);
    onEvent({ type: "tool", name: "sea_values", input: { depth: wantDepth, elevation: wantElev, traffic: wantTraffic }, ms: Date.now() - t0, baseline: true, output: { lines, not_found: notChecked } });
    return { lines, notChecked };
  })() : null;
  onEvent({ type: "baseline", layers: layers.length + (seaJob ? 1 : 0) });
  // Settings: count the same shape from two layers once (on unless the person switched it off).
  const mergeShapes = host.mergeShapes ? !!host.mergeShapes() : true;
  const layerAnswers = new Map(); // atlas_id → { features, meta } or { not_checked }
  await Promise.allSettled(layers.map(async (l) => {
    const x = l.source, rec = x.record || {};
    const id = tools.useDataset({ id: x.atlas_id, title: rec.title || x.atlas_id, publisher: rec.publisher || "", licence: rec.licence || "", capabilities: ["query"], concepts: [] }, "B");
    const check = layerPlans.find((p) => p.sources.includes(x));
    const input = { dataset: id, place: site.name, theme: K.mapTheme(check.check.topic), within_km: l.km, limit: 500, ...(l.fields.size ? { fields: [...l.fields] } : {}), ...(l.name_field ? { name_field: l.name_field } : {}) };
    const t0 = Date.now();
    onEvent({ type: "tool_start", name: "get_data", input });
    try {
      const output = await exec("get_data", input, { check: check.check.id, ownReach: true });
      onEvent({ type: "tool", name: "get_data", input, output, ms: Date.now() - t0, baseline: true });
      const raw = lastOut.get(id);
      if (!raw || raw.not_checked) { layerAnswers.set(x.atlas_id, { not_checked: raw?.not_checked || "no reply", meta: raw || {} }); return; }
      // Each feature with its own extent (duplicates across layers) and, for class layers, the share of the site it
      // covers (equal-area, js/siterole.js), so a polygon that only touches the edge isn't counted as on the site.
      const cov = (c) => { if (!l.coverage || c.distance_km > 0 || !isArea(fp.feature)) return null; try { return coverageIn(fp.feature, c.geometry)?.coverage ?? 0; } catch { return null; } };
      const box = (c) => { try { return turf.bbox({ type: "Feature", properties: {}, geometry: c.geometry }); } catch { return null; } };
      layerAnswers.set(x.atlas_id, { features: (rawFound.get(raw.dataset) || []).map((c) => ({ name: c.name, distance_km: c.distance_km, around_site: !!c.around_site, extra: c.extra || {}, bbox: box(c), geometry: c.geometry, coverage: cov(c) })),
        meta: { dataset: raw.dataset, publisher: raw.publisher, licence: raw.licence, checked_at: raw.checked_at, capped: !!raw.capped, fetched_km: raw.within_km } });
    } catch (e) {
      onEvent({ type: "tool", name: "get_data", input, error: String(e.message || e), ms: Date.now() - t0, baseline: true });
      layerAnswers.set(x.atlas_id, { not_checked: String(e.message || e) });
    }
  }));
  for (const p of layerPlans) {
    const answers = p.sources.map((x) => (x.pending ? { source: x } : { source: x, ...(layerAnswers.get(x.atlas_id) || { not_checked: "not fetched" }) }));
    const r = K.fromSources(p, answers, edges, mergeShapes ? { sameShape } : {});
    // The SSSI Impact Risk Zones: the zones the site is in, read for this kind of development (the profile's
    // categories for the asset type; "all consultations" always).
    if (p.check.decode === "irz" && r.state !== "not_checked") {
      const codes = answers.flatMap((a) => (a.features || []).filter((f) => !(f.distance_km > 0)).map((f) => K.irzCodeOf(f.extra?.[a.source.code_field]))).filter(Boolean);
      const keys = host.profile?.()?.irz_categories?.[inputs.asset_type] || host.profile?.()?.irz_categories?.other || [];
      r.irz = K.decodeIrz(codes, host.irz, keys);
      r.irz_codes = [...new Set(codes)].slice(0, 12);
    }
    results.set(p.check.id, r);
    // The analyst's nearest names: the features this check counted, from its own sources (after each source's filter).
    const keep = (a) => (f) => f.dataset === a.meta?.dataset && K.passes(a.source, f);
    const ev = evidence.map((f) => f.properties);
    featsOf.set(p.check.id, answers.filter((a) => a.meta?.dataset && !a.not_checked).flatMap((a) => ev.filter(keep(a))));
    // A pending source beside answered ones is still a gap to list.
    for (const a of answers.filter((y) => y.source.pending)) checked.push({ evidence: p.check.topic, dataset: `${p.check.label} (${a.source.region})`, result: "not checked", why: a.source.pending, check: p.check.id });
  }
  const seaRes = seaJob ? await seaJob.catch((e) => ({ lines: [], notChecked: [`elevation, water depth and vessel traffic: not checked (${String(e.message || e).slice(0, 120)})`] })) : null;
  if (seaRes && seaJob) for (const p of [depthPlan, elevPlan, trafficPlan]) if (p && !results.has(p.check.id) && ((p === depthPlan && wantDepth) || (p === elevPlan && wantElev) || (p === trafficPlan && wantTraffic))) results.set(p.check.id, K.notChecked(p, seaRes.notChecked[0] || "no reading"));
  // In plan order (the catalogue's order), only checks that ran or were found wanting: a value check that didn't
  // apply here (no sea in the close band, inside only) is left out, as checks that don't apply are.
  const checkResults = plans.map((p) => results.get(p.check.id)).filter(Boolean);
  // A search area is never "on site": the checks say "in the search area" (js/siterole.js).
  if (searchArea) for (const r of checkResults) {
    r.search_area = true;
    if (r.text) r.text = reword(r.text);
    for (const b of r.bands || []) if (b.label === "on site") b.label = SEARCH_BAND;
  }
  // Each check's features as map ids, nearest first, so the card can list them and drive the map (24 Nov).
  const fidOf = new Map(evidence.map((f) => [`${norm(f.properties.dataset)}|${norm(f.properties.name)}|${round(f.properties.distance_km, 2)}`, f.properties]));
  for (const r of checkResults) {
    if (r.members) {
      r.features = r.members.map((m) => {
        const p = fidOf.get(`${norm(m.dataset)}|${norm(m.name)}|${round(m.distance_km, 2)}`);
        return { ...(p ? { fid: p.fid } : {}), name: m.name, distance_km: m.around_site ? null : m.distance_km, ...(m.around_site ? { around: true } : {}),
          ...(m.coverage ? { coverage: Math.round(m.coverage * 1000) / 1000 } : {}), ...(m.detail ? { detail: m.detail } : {}), ...(m.publisher ? { publisher: m.publisher } : {}) };
      });
      delete r.members;
    } else if (r.id === "context.boundaries" && r.state === "found") {
      r.features = evidence.filter((f) => boundaryFids.includes(f.properties.fid) && (f.properties.surrounds || f.properties.distance_km <= (r.reach_km ?? 0) + 1e-9))
        .sort((a, b) => a.properties.distance_km - b.properties.distance_km)
        .map((f) => ({ fid: f.properties.fid, name: f.properties.name, distance_km: f.properties.distance_km, ...(f.properties.details?.sides ? { detail: f.properties.details.sides } : {}) }));
    }
  }
  const noCheck = K.uncheckedTopics(catalogue, checkResults, scale);
  // The analyst's lines, by topic: each check's answer, with the nearest few by name, and the values' full lines.
  const nameOf = (f) => `${f.name}${f.details?.sides ? ` [${f.details.sides}${f.details.line_type ? `, ${f.details.line_type}` : ""}]` : ""} ${f.surrounds ? "(around the site: a wide area it lies within)" : `${f.distance_km} km`}`;
  const baselineLines = [`Scale of this screen: ${scale} (bands ${edges.join(", ")} km; each check looks out to its own reach).`];
  for (const g of K.byTopic(catalogue, checkResults)) {
    baselineLines.push(`${g.label}:`);
    for (const r of g.results) {
      const near = r.state === "found" && r.answer === "count_by_band" ? [...new Set((featsOf.get(r.id) || []).filter((f) => f.distance_km <= (r.reach_km ?? 0) + 1e-9 || f.surrounds)
        .sort((a, b) => a.distance_km - b.distance_km).map(nameOf))].slice(0, 3) : [];
      // Every source the check used (a UK check may read four nations' layers and JNCC's), titles only.
      const srcs = (r.sources?.length ? r.sources : r.source ? [r.source] : []).filter((x) => x.dataset);
      const src = r.answer === "value_at_site" && r.state === "found" ? "" : srcs.length ? ` [${srcs.map((x) => `${x.dataset}${x.state === "not_checked" ? ": not checked" : ""}`).join("; ")}]` : "";
      baselineLines.push(`- ${r.label}${r.must ? " (must)" : ""}: ${K.checkLine(r, { nearest: !near.length })}${near.length ? `; nearest ${near.join("; ")}` : ""}${r.partly ? ` (partly: ${r.partly})` : ""}${src}`);
      if (r.irz) for (const z of r.irz.filter((y) => y.consult)) baselineLines.push(`  - Natural England's wording, ${z.category}: ${z.texts.join(" | ")}`);
    }
  }
  if (seaRes) for (const l of seaRes.lines) baselineLines.push(`- ${l}`);
  const ncLine = K.noCheckLine(catalogue, noCheck);
  if (ncLine) baselineLines.push(`${ncLine}. Search for these yourself where they matter for this site; the card already lists them as not checked.`);
  const baselineCalls = calls.length;
  // One line per source the tools reached, for the repair prompt when a write-up is cut off.
  const summarise = (c) => {
    const near = evidence.filter((f) => f.properties.dataset === c.dataset).sort((x, y) => x.properties.distance_km - y.properties.distance_km).slice(0, 3)
      .map((f) => nameOf({ ...f.properties }));
    return `- ${c.dataset} (${c.publisher || "?"}): ${c.result === "features" ? `${c.count} ${inside ? "inside or touching the area" : `within ${reach} km`}; nearest ${near.join("; ")}` : c.result}${c.why ? ` (${c.why})` : ""}`;
  };
  const origin = site.origin?.method === "words"
    ? `from the words "${site.origin.words}", anchored on ${site.origin.anchor?.name || site.origin.anchor?.place || "a found feature"}${site.origin.anchor?.source?.publisher ? ` (${site.origin.anchor.source.publisher})` : ""}, ${site.origin.confidence} confidence`
    : site.origin?.method === "file" ? fileOriginText(site.origin)
    : "drawn on the map by the person";
  const res = await runTurn({
    system: systemFor(skill),
    messages: [{ role: "user", content: firstMessage({ siteName: site.name, describe, inputs, distances, footprintNote: fp.note, origin, baseline: baselineLines.join("\n") || null, inside, searchArea: searchNote }) }],
    tools: defs, exec, callClaude, maxRounds,
    onEvent: (ev) => { if (ev.type === "tool_start") onEvent({ type: "tool_start", name: ev.name, input: ev.input }); if (ev.type === "tool" || ev.type === "round" || ev.type === "warning") onEvent(ev); },
  });
  let parsed = parseResult(res.text);
  const usage = { ...res.usage };
  let repaired = false;
  const lastMsg = res.history.at(-1);
  const debug = { final_stop: res.stopReason ?? res.stop_reason ?? null, final_chars: String(res.text || "").length, final_blocks: Array.isArray(lastMsg?.content) ? lastMsg.content.map((b) => b.type).join(",") : typeof lastMsg?.content };
  if (!parsed.json) {
    // Cut off (the reply hit the length cap) or no JSON block: ask once for the JSON alone, from the same history.
    // Thinking blocks are signed to the request they came from, so they're dropped (as in the conversation loop);
    // the cut-off message keeps only its text. Haiku thinks by default, and on a big screen the thinking can use
    // most of the 8,000-token cap before the write-up ends (Rosebank, 18 Nov).
    const last = res.history.length - 1;
    const history = res.history.map((m, i) => {
      if (m.role !== "assistant" || !Array.isArray(m.content)) return m;
      const keep = m.content.filter((b) => (i === last ? b.type === "text" : b.type !== "thinking" && b.type !== "redacted_thinking"));
      return { ...m, content: keep.length ? keep : [{ type: "text", text: "…" }] };
    });
    if (history.at(-1)?.role === "user") history.pop();
    const ASK = "Reply now with only the JSON block, compact: the decision and its reason in one line; at most 6 flags, each with severity and a short next_step, and at most 3 evidence items each (name, distance_km, dataset only); data_gaps at most 10 short lines; checked as []. Keep any thinking brief.";
    // First from a compact summary of what the tools found, not the whole history (Rob's housing screen, 20 Nov: the
    // full history was ~34k tokens and the write-up hit the cap); then, if that fails, from the full history as before.
    const found = checked.filter((c) => c.result === "features" || c.result === "not checked").map(summarise).join("\n");
    const tail = String(res.text || "").slice(-3000);
    const attempts = [
      { how: "summary", messages: [{ role: "user", content: `${firstMessage({ siteName: site.name, describe, inputs, distances, footprintNote: fp.note, origin, baseline: null, inside, searchArea: searchNote })}\n\nWhat the tools found (everything is on the map and in the run):\n${found || "- nothing returned"}\n\n${tail ? `Your write-up was cut off before its JSON block. Its last part:\n${tail}\n\n` : ""}${ASK}` }] },
      { how: "history", messages: [...history, { role: "user", content: `Your result was cut off or had no JSON block. ${ASK}` }] },
    ];
    debug.repairs = [];
    for (const a of attempts) {
      try {
        const resp = await callClaude({ system: systemFor(skill), ...(a.how === "history" ? { tools: defs } : {}), messages: a.messages });
        usage.input_tokens += resp.usage?.input_tokens || 0; usage.output_tokens += resp.usage?.output_tokens || 0;
        const t2 = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
        const again = parseResult(t2);
        debug.repairs.push({ how: a.how, stop: resp.stop_reason, chars: t2.length, tokens_in: resp.usage?.input_tokens, tokens_out: resp.usage?.output_tokens, json: !!again.json, ...(again.json ? {} : { head: t2.slice(0, 300) }) });
        // The summary is written from the repaired result, never kept from the cut-off write-up: that draft can
        // disagree with the flags and decision the repair returned (Rob's Kelso report, 20 Nov: "major issue" in
        // the summary, "progress with targeted investigation" in the decision, flags the result didn't have).
        if (again.json) { parsed = { json: again.json, summary: summaryFromResult(again.json) }; debug.cut_off_summary = String(res.text || "").split("```")[0].trim().slice(0, 3000); repaired = true; break; }
      } catch (e) { debug.repairs.push({ how: a.how, error: String(e.message || e).slice(0, 300) }); }
    }
    debug.raw_tail = String(res.text || "").slice(-1500);
  }
  let flags = traceFlags(parsed.json?.flags, evidence, distances, { ...seaVals, elevation });
  if (searchArea) {
    flags = applySearchArea(flags, new Map(evidence.map((f) => [f.properties.fid, f.properties])));
    parsed.summary = reword(parsed.summary);
  }
  const siteFeature = { type: "Feature", geometry: fp.feature.geometry, properties: { role: "site", name: site.name, run: runId } };
  return {
    type: "FeatureCollection",
    tobler_run: {
      schema: RUN_SCHEMA, id: runId, kind: "ntr-screen", skill: { name: skill.name, version: skill.version }, model,
      industry: host.profile?.()?.id || null,
      decision: settleDecision(readDecision(parsed.json?.decision, searchArea ? reword(parsed.json?.decision_why) : parsed.json?.decision_why, host.profile?.()?.decisions), { checked, flags, checks: checkResults, topicLabel: (t) => K.topicLabel(catalogue, t) }),
      started_at: started, finished_at: now(),
      site: {
        name: site.name, how_found: origin, confidence: site.origin?.method === "words" ? site.origin.confidence : site.origin?.method === "file" ? "from the person's file" : "drawn",
        anchor_source: site.origin?.anchor?.source ? { title: site.origin.anchor.source.title, publisher: site.origin.anchor.source.publisher, licence: site.origin.anchor.source.licence } : null,
        footprint: inside ? "inside the area only (the surroundings weren't screened)" : searchArea ? searchNote : fp.note || `screened on the ${/Line/.test(site.feature.geometry.type) ? "line" : "area"} itself`,
        role: searchArea ? "search_area" : role.role, role_why: role.why, ...(siteKm2 ? { area_km2: round(siteKm2, 3) } : {}),
        setting: offshore ? "offshore" : "onshore", summary: R.summaryLine(describe),
        asset_type: inputs.asset_type, asset_label: inputs.asset_label, asset_assumed: !!inputs.asset_assumed, ...(inputs.outside_profile ? { outside_profile: inputs.outside_profile } : {}),
        stage: inputs.stage || "greenfield (assumed)", capacity_mw: inputs.capacity_mw ?? null, tip_height_m: inputs.tip_height_m ?? null,
      },
      ...(Object.keys(seaVals).length ? { sea: seaVals } : {}),
      ...(elevation ? { elevation: { ...elevation, ...(elevSig ? { significance: elevSig } : {}) } } : {}),
      extent: inside ? "inside" : "around", distances, fetched_to_km: reach, assessed_within_km: reach,
      method: inside
        ? "Inside the area only, at the person's request: features inside the area or touching its edge (distance 0), geodesic on WGS84; the surroundings weren't fetched. Coordinates WGS84 (EPSG:4326)."
        : searchArea
          ? "The site's outline wasn't found, so it was screened as a search area: features inside it are reported by the share of it they cover (overlay in a Lambert azimuthal equal-area projection centred on it), not as on site; under 10% covered is low confidence, 10% or more isn't capped, and points or lines inside are medium. Distances outside it geodesic on WGS84, measured from its edge; features fetched once out to the wider band. Coordinates WGS84 (EPSG:4326)."
          : "Distances geodesic on WGS84, measured from the footprint edge (0 = on site); features fetched once out to the wider band. Coordinates WGS84 (EPSG:4326).",
      flags, checked, data_gaps: Array.isArray(parsed.json?.data_gaps) ? parsed.json.data_gaps.map(String) : [],
      model_checked: Array.isArray(parsed.json?.checked) ? parsed.json.checked : [],
      summary: parsed.summary, ...(parsed.json ? {} : { parse_error: "The analyst's result had no readable JSON block, so there are no structured flags. The summary is kept as written." }),
      checks: checkResults, checks_scale: scale, checks_merge_shapes: mergeShapes, checks_version: catalogue.version || null, ...(noCheck.length ? { no_check_topics: noCheck } : {}),
      // Topic names travel with the run, so a share link can show them without the catalogue.
      topic_labels: Object.fromEntries((catalogue.topics || []).filter((t) => noCheck.includes(t.id) || checkResults.some((c) => c.topic === t.id)).map((t) => [t.id, t.label])),
      baseline: { layers: layers.map((l) => l.source.record?.title || l.source.atlas_id), calls: baselineCalls }, disclaimer: DISCLAIMER,
      calls, usage, ...(parsed.json && !repaired ? {} : { debug }), ...(repaired ? { note: "The first result was cut off; the structured result was asked for again from the same evidence." } : {}), assessments: [],
    },
    features: [siteFeature, ...evidence],
  };
}

export const evidenceOf = (record) => record.features.filter((f) => f.properties.role === "evidence");

// The slider: findings up to km, nearest first.
export function evidenceWithin(record, km) {
  return evidenceOf(record).filter((f) => f.properties.distance_km != null && f.properties.distance_km <= km + 1e-9)
    .sort((a, b) => a.properties.distance_km - b.properties.distance_km);
}

// "First school at 1.3 km": the nearest finding of each theme within km.
export function nearestByTheme(record, km) {
  const out = new Map();
  for (const f of evidenceWithin(record, km)) if (!f.properties.surrounds && !out.has(f.properties.theme)) out.set(f.properties.theme, f.properties);
  return [...out.entries()].map(([theme, p]) => ({ theme, name: p.name, distance_km: p.distance_km }));
}

// Whether a flag's traced evidence is all beyond km (the flag still stands as written; the card says so).
export function flagBeyond(flag, km) {
  if (!flag.fids?.length) return false;
  return flag.nearest_km != null && flag.nearest_km > km + 1e-9;
}

// Re-assess on tap: the stored evidence within km, no new fetching, one model call without tools.
export async function reassess({ record, km, skill, callClaude: call, now = () => new Date().toISOString() }) {
  const callClaude = roomy(call);
  const run = record.tobler_run;
  const d = { ...run.distances, wider: km, close: Math.min(run.distances.close, km), near: Math.min(run.distances.near, km), set_by: "person",
    reasons: [`re-assessed from the stored evidence within ${km} km (fetched to ${run.fetched_to_km} km)`, ...run.distances.reasons] };
  const ev = evidenceWithin(record, km).map((f) => {
    const p = f.properties;
    return { name: p.name, type: p.type, theme: THEME_CODE[p.theme] || p.theme, distance_km: p.distance_km, band: bandOf(p, d), ...(p.in_search_area ? { in_search_area: whereText(p) } : {}), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, ...(p.details ? { details: p.details } : {}) };
  });
  const insideOnly = km === 0 && isArea(record.features.find((f) => f.properties.role === "site"));
  const where = insideOnly ? "inside the area (inside it or touching its edge)" : `within ${km} km of the footprint edge`;
  const message = [
    `Re-assess the screen of ${run.site.name} for findings ${where}.${insideOnly ? " The person chose to look inside the area only." : ""} No tools: use only the evidence below, which was fetched in the original run.`,
    `Site: ${run.site.summary}; ${run.site.footprint}. Setting: ${run.site.setting}. Asset type: ${run.site.asset_label}. Stage: ${run.site.stage}.`,
    run.site.role === "search_area" ? "The site's outline wasn't found, so this is a search area: evidence marked \"in the search area\" may or may not be on the site. Say \"in the search area\" with the share it covers (coverage), never \"on site\"." : null,
    `Distances now: ${distancesLine(d)}.`,
    `Evidence ${insideOnly ? "inside the area" : `within ${km} km`} (${ev.length} features):\n${JSON.stringify(ev)}`,
    `What the original run checked:\n${JSON.stringify(run.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.why ? { why: c.why } : {}) })))}`,
    `Gaps from the original run:\n${JSON.stringify(run.data_gaps)}`,
    insideOnly
      ? "Write the short summary and the JSON block as the method says. Features outside the area are out of scope for this view (they were found and stay in the run); gaps still stand."
      : "Write the short summary and the JSON block as the method says. Features beyond the new distance are out of scope; gaps still stand.",
  ].filter(Boolean).join("\n\n");
  const resp = await callClaude({ system: systemFor(skill), messages: [{ role: "user", content: message }] });
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseResult(text);
  if (!parsed.json) throw new Error("The re-assessment came back without a readable result. The earlier flags are unchanged.");
  run.assessments.push({ at: now(), within_km: run.assessed_within_km, flags: run.flags, decision: run.decision ?? null, summary: run.summary, distances: run.distances });
  run.flags = traceFlags(parsed.json.flags, evidenceOf(record), d, { ...(run.sea || {}), elevation: run.elevation });
  const searchArea = run.site.role === "search_area";
  if (searchArea) run.flags = applySearchArea(run.flags, new Map(evidenceOf(record).map((f) => [f.properties.fid, f.properties])));
  run.decision = settleDecision(readDecision(parsed.json.decision, searchArea ? reword(parsed.json.decision_why) : parsed.json.decision_why), { checked: run.checked, flags: run.flags, ...(run.checks ? { checks: run.checks } : {}) }); // a decision written for the old distance no longer stands
  run.data_gaps = Array.isArray(parsed.json.data_gaps) ? parsed.json.data_gaps.map(String) : run.data_gaps;
  run.summary = searchArea ? reword(parsed.summary) : parsed.summary;
  run.distances = d;
  run.assessed_within_km = km;
  for (const f of evidenceOf(record)) f.properties.band = bandOf(f.properties, d);
  run.usage = { input_tokens: (run.usage?.input_tokens || 0) + (resp.usage?.input_tokens || 0), output_tokens: (run.usage?.output_tokens || 0) + (resp.usage?.output_tokens || 0) };
  return record;
}

// What the conversation agent gets back: the headline only. Detail stays in the run (get_run).
export function headline(record) {
  const r = record.tobler_run;
  const byConf = { high: 0, medium: 0, low: 0 };
  r.flags.forEach((f) => { byConf[f.confidence]++; });
  const notChecked = r.checked.filter((c) => c.result === "not checked");
  return {
    run: r.id, site: r.site.name, scope: r.extent === "inside" ? "inside the area only" : "the site and its surroundings", distances: r.extent === "inside" ? "none (inside the area only)" : distancesLine(r.distances), asset: `${r.site.asset_label}${r.site.asset_assumed ? " (assumed)" : ""}`, stage: r.site.stage,
    ...(r.decision ? { decision: r.decision.value } : {}),
    flags: r.flags.length, by_confidence: byConf,
    top_flags: r.flags.slice(0, 5).map((f) => ({ id: f.id, risk: f.risk, ...(f.severity ? { severity: f.severity } : {}), confidence: f.confidence, theme: f.theme, nearest_km: f.nearest_km })),
    evidence_features: evidenceOf(record).length, sources_checked: r.checked.length, not_checked: notChecked.map((c) => c.dataset).slice(0, 6), gaps: r.data_gaps.length,
    ...(r.parse_error ? { problem: r.parse_error } : {}),
    ...(r.replaces ? { replaces: `${r.replaces.run}, because ${r.replaces.why}. Say in a sentence what changed in the flags or the decision compared with ${r.replaces.run} (get_run ${r.replaces.run} if you need it).${r.replaces.checks_changed ? ` Checks that changed: ${r.replaces.checks_changed.length ? r.replaces.checks_changed.join("; ") : "none"}.` : ""}` } : {}),
    ...(r.checks ? { checks: K.checksSummary(r.checks).replace(/^Checks: /, "") } : {}),
    ...(r.site.role === "search_area" ? { site_is: `a search area: ${r.site.role_why}. Findings inside it are "in the search area" with the share they cover, not "on site". Say this in your reply, and that the real outline (drawn, or from the application) would sharpen the screen.` } : {}),
    note: "The run card under your reply shows the decision, the flags (F-01…), evidence, next steps, distances (with a slider) and gaps, and the map shows the evidence. Reply in two or three sentences: the most serious flags and the main gaps. Don't repeat the card.",
  };
}

// The screening service the conversation's screen_site and get_run tools call. table: catalogue/distances.json;
// skill: the parsed NTR skill. onRun(record, place) shows the card; onEvent reports progress.
export function createScreening({ host, table, skill, callClaude, model = "", onRun = () => {}, onEvent = () => {}, now }) {
  const runs = new Map();
  let n = 0;
  return {
    runs,
    // A run saved in this browser (js/projectstore.js), put back on reload: the analyst can read it again, and new
    // runs carry on numbering after it (R3 after R1 and R2), so ids never repeat in a project.
    restore(record) {
      const id = record?.tobler_run?.id;
      if (!id) return;
      runs.set(id, record);
      const k = +String(id).replace(/^R/, "");
      if (Number.isFinite(k) && k > n) n = k;
    },
    async screen(i, place) {
      const sk = typeof skill === "function" ? skill() : skill;
      const tb = typeof table === "function" ? table() : table;
      if (!sk?.body || !tb?.assets) throw new Error("The screening method or the distance table hasn't loaded yet; try again in a moment.");
      const d0 = await R.describe(host.ref, place.feature);
      const asset = ASSET_TYPES.includes(i.asset_type) && i.asset_type !== "other" ? i.asset_type : null;
      // Something the profile isn't built for (housing, a warehouse): screened at once as a general screen, and the
      // caveat travels with the run so the card and report say it, not only the chat (Rob, 22 Nov).
      const planned = !asset && typeof i.planned === "string" && i.planned.trim() ? i.planned.replace(/\s+/g, " ").trim().slice(0, 60) : null;
      const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
      const site = { asset_type: asset, offshore: !!d0.offshore, capacity_mw: num(i.capacity_mw), tip_height_m: num(i.tip_height_m), area_km2: d0.area_km2 ?? null };
      const distances = chooseDistances(tb, site, i.distances || {});
      const id = `R${++n}`;
      // For the page's progress line: what's being screened, so it can say roughly how long it takes.
      onEvent({ type: "screen_start", run: id, site: place.name, setting: site.offshore ? "offshore" : "onshore",
        inside: i.extent === "inside" && /Polygon/.test(place.feature.geometry.type), wider_km: distances.wider });
      const record = await runScreening({
        host, site: { name: place.name, feature: place.feature, origin: place.origin }, distances, skill: sk, callClaude, model, runId: id, onEvent, ...(now ? { now } : {}),
        inputs: { asset_type: asset || "other", asset_label: asset ? tb.assets[asset].label : planned || "site of unknown type", asset_assumed: asset ? !!i.assumed : !planned,
          ...(planned ? { outside_profile: host.profile?.()?.wording?.outside || OUTSIDE_PROFILE } : {}),
          stage: i.stage || "", capacity_mw: site.capacity_mw, tip_height_m: site.tip_height_m, focus: i.focus || "", extent: i.extent === "inside" ? "inside" : "around" },
      });
      if (i.extent === "inside" && !isArea(place.feature)) record.tobler_run.note_scope = "Inside only applies to areas, so this point or line was screened with its surroundings.";
      record.tobler_run.place_id = place.id ?? null;
      record.tobler_run.place_geometry_at_run = JSON.stringify(place.feature.geometry);
      // What was asked, so the run can be repeated as it was once the site is edited (js/outofdate.js).
      record.tobler_run.inputs = { asset_type: asset || "other", assumed: asset ? !!i.assumed : !planned, ...(planned ? { planned } : {}), stage: i.stage || "", focus: i.focus || "",
        ...(i.distances && Object.keys(i.distances).length ? { distances: i.distances } : {}) };
      // A re-run after the site was edited: which run it replaces, and why. From the card's re-run button (replaces),
      // or found here when the analyst screens a place again whose latest run is out of date.
      const old = (i.replaces ? runs.get(String(i.replaces).trim().toUpperCase()) : null)
        || [...runs.values()].reverse().find((o) => place.id != null && o.tobler_run.place_id === place.id && !o.tobler_run.replaced_by && siteChange(o, place));
      if (old) {
        const ch = siteChange(old, place);
        record.tobler_run.replaces = { run: old.tobler_run.id, why: ch ? `the site was edited after it ran (${ch.text})` : "re-run" };
        // Which checks moved, so the card and the reply can say why the flags did.
        if (record.tobler_run.checks) record.tobler_run.replaces.checks_changed = K.checksChanged(old.tobler_run.checks || [], record.tobler_run.checks);
        old.tobler_run.replaced_by = id;
      }
      runs.set(id, record);
      onRun(record, place);
      return headline(record);
    },
    getRun(id) {
      const rec = runs.get(String(id || "").trim().toUpperCase()) || [...runs.values()].at(-1);
      if (!rec) throw new Error("No screening runs yet in this conversation.");
      const r = rec.tobler_run;
      return {
        run: r.id, site: r.site.name, scope: r.extent === "inside" ? "inside the area only" : "the site and its surroundings", asset: r.site.asset_label, stage: r.site.stage, distances: distancesLine(r.distances), assessed_within_km: r.assessed_within_km,
        ...(r.replaces ? { replaces: r.replaces } : {}), ...(r.replaced_by ? { replaced_by: `${r.replaced_by} (this run is out of date: the site was edited after it)` } : {}),
        ...(r.decision ? { decision: r.decision } : {}),
        flags: r.flags.map((f) => ({ id: f.id, risk: f.risk, theme: THEME_CODE[f.theme] || f.theme, ...(f.severity ? { severity: f.severity } : {}), confidence: f.confidence, why: f.why, ...(f.next_step ? { next_step: f.next_step } : {}),
          evidence: f.evidence.map((e) => ({ name: e.name, distance_km: e.distance_km, band: e.band, dataset: e.dataset, publisher: e.publisher, traced: e.traced })) })),
        checked: r.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.count ? { count: c.count } : {}), ...(c.why ? { why: c.why.slice(0, 160) } : {}) })),
        data_gaps: r.data_gaps,
        ...(r.checks ? { checks: r.checks.map((c) => `${c.label}${c.must ? " (must)" : ""}: ${K.checkLine(c)}`) } : {}),
        ...(r.sea ? { sea: seaLines(r.sea) } : {}),
        ...(r.elevation ? { elevation: elevationLine(r.elevation, r.elevation.significance) } : {}),
      };
    },
  };
}
