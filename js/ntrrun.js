// Sealed NTR runs: a screening runs as its own short agent loop (skill, fixed inputs, read-only data tools,
// structured result), never inside the conversation. The result is a run record: GeoJSON with provenance, the one
// source for the card, the map and later exports. No DOM, so the page, the scripts and the tests share it.
import * as turf from "./vendor/turf.js";
import * as R from "./reference.js";
import { FENCE_RULE } from "./fence.js";
import { createPlaceTools } from "./placetools.js";
import { fileOriginText } from "./fileimport.js";
import { serviceOriginText } from "./servicesite.js";
import * as U from "./units.js";
import { LADDER, ASSET_TYPES, MAX_KM, chooseAsset, readDistances, distancesFromInputs, resolveReaches, changeLines, reachRecord, reachLine, changesLine, runBand, runDistancesLine, runFurthest, isLegacy, ladderBand, kmText } from "./reach.js";
import { nearestBoundaries } from "./boundaries.js";
import { DISCLAIMER } from "./disclaimer.js";
// The caveat for a screen of something the profile isn't built for, when the profile doesn't give its own words.
export const OUTSIDE_PROFILE = "A general screen: the method wasn't built for this kind of development, so treat it as a first look.";
import { aroundSiteKm2 } from "./datatools.js";
import { relationPart, zonesAtSite, isOnSite } from "./relation.js";
import { siteChange } from "./outofdate.js";
import { runDiff } from "./rundiff.js";
import { waterDepth, vesselTraffic, seaLines } from "./seavalues.js";
import { elevationFrom, elevationSignificance, elevationLine, elevationShort } from "./elevation.js";
import { readDecision, settleDecision, settleScreen } from "./industry.js";
import { relevanceOf, checkMaps, compareFlags, headlineOf, headlineText, relevanceLine, sourceNote, isRelevanceRun } from "./relevance.js";
import * as K from "./checks.js";
import { areasNear } from "./ukareas.js";
import { topicOf, TOPIC_IDS } from "./findings.js";
import { osmAnswers } from "./osmchecks.js";
import { overpassQuery } from "./gazetteer.js";
import { osmSnapshot } from "./osmsnapshot.js";
import { offerFor } from "./bringin.js";
import { areaBudget, budgetLines } from "./areabudget.js";
import { budgetRules, resolveDeductions, reachByCheck, classMatches, budgetSummary } from "./developable.js";
import { placeRole, coverageIn, whereText, applySearchArea, reword, sameShape, SEARCH_BAND, SEARCH_NOTE } from "./siterole.js";
import { presentationCrs } from "./presentation.js";

// The band for a piece of evidence: a wide area the site lies within is "around the site", not "on site".
export const AROUND = "around the site";
// Inside a search area (a stand-in for an outline nobody found), distance 0 is "in the search area", not "on site".
// run: the run record's tobler_run (or anything with its reach, or an old run's distances).
const bandOf = (p, run) => (p.surrounds ? AROUND : p.in_search_area && !(p.distance_km > 0) ? SEARCH_BAND : runBand(p.distance_km, run));

// tobler-run/2 (23 Nov): adds the checks. Old share links (tobler-run/1, no checks) still open.
export const RUN_SCHEMA = "tobler-run/2";
export const SCREEN_TOOLS = ["get_place", "find_data", "get_data", "find_features_near", "get_elevation"];
// Flags and findings carry a topic id in their "theme" field (the field name is kept for old records). Flags from
// the IFC skill, or records from before 24 Nov, carry PS codes or the six old themes; topicOf reads them all.
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
    lines.push("", flags.some((f) => f.severity) ? "Flags, most serious first:" : "Flags:");
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

// The site as screened: a point gets a footprint circle (radius from the asset table: the footprint's own width, which
// belongs to the place); lines and areas as they are. asset: { footprint_km, label }.
export function footprintOf(feature, asset) {
  if (feature.geometry.type !== "Point") return { feature, note: null };
  const f = turf.circle(feature.geometry.coordinates, asset.footprint_km, { units: "kilometers", steps: 48 });
  return { feature: { type: "Feature", properties: {}, geometry: f.geometry }, note: `a point, screened as a ${asset.footprint_km} km footprint round it (default for ${/^(a|an) /.test(asset.label) ? asset.label : `a ${asset.label}`})` };
}

// The constraints screen, sealed (plan item 1, 26 Nov): one judgement of the checks, with no tools. What the checks
// couldn't answer goes in data_gaps, and up to three kinds of evidence the analyst would look for go in look_for:
// after the run, code searches the atlas for them and offers the layers to the person (js/bringin.js). Before this,
// the analyst searched the catalogue itself and brought in layers nobody asked for (Welsh layers at Stanlow).
export function systemForScreen(skill) {
  return `You are Tobler's screening analyst, writing one sealed screen of one site for environmental constraints and environmental and social (E&S) risk. Nobody is chatting with you and you have no tools: the run has already carried out the checks, measured in code, and gives them in the first message. Judge them as the method says, then write the result.

- ${FENCE_RULE}
- The site, its footprint, the asset type, the stage and the distances are fixed by this run and given in the first message. Use them as given; don't ask about them and don't change them. If the stage or asset type was assumed, say so in the summary.
- Never work out a distance yourself: the checks give them, measured from the footprint edge.
- Items marked "around the site" are wide areas the site lies within: seas, regions, very large designations. They are not features on the site. Mention one only where being inside it matters for this project.
- Name features and datasets as the checks name them.
- A flag's evidence is a list of ids, never retyped names or distances: an evidence id (E7) from the checks' lines, or a check's id in square brackets ([heritage.listed-buildings]) when the check found something. The run fills in names, distances, sources and licences from the ids. Something you can't cite by id can't support a flag: put it in data_gaps.
- What the checks couldn't answer, and evidence that matters for this site that no check covers, goes in data_gaps. Name up to three of those that a published map layer could answer in look_for, with two or three short words that would be in such a layer's title. Tobler searches for them after the run and asks the person before bringing anything in.
- Your reply is the result: the short summary, then the JSON block, exactly as the method's Output section says.
- Keep the result compact so it fits in one reply: summary under 300 words; at most 8 flags, each next_step one short line; at most 4 evidence items per flag (the nearest or strongest, and say in "why" how many more there are); "data_gaps" at most 12 short lines; leave "checked" as an empty list, because the run records what was checked itself. Keep your thinking before the result short: the reply limit (16,000 tokens) includes it.

<method skill="${skill.name}" version="${skill.version}">
${skill.body}
</method>`;
}

// What the analyst named for the atlas search after the run: at most three, each { what, words, topic }.
export function readLookFor(v) {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object" && x.what).slice(0, 3).map((x) => ({
    what: String(x.what).replace(/\s+/g, " ").trim().slice(0, 80),
    words: (Array.isArray(x.words) ? x.words : [x.words]).map((w) => String(w || "").replace(/\s+/g, " ").trim().slice(0, 40)).filter((w) => w.length >= 3).slice(0, 3),
    topic: TOPIC_IDS.includes(x.topic) ? x.topic : "context",
  })).filter((x) => x.words.length);
}

export const isArea = (feature) => /Polygon/.test(feature?.geometry?.type || "");

// The search distances in the analyst's words: each check's reach is on its line; this says where they came from.
function reachLines(reach) {
  return [
    `Search distances: ${reachLine(reach)}. The furthest any check looked is ${kmText(reach.furthest_km)}. Each check's line gives its own reach.`,
    reach.asset?.note || null,
    reach.extended?.length ? `Extended for ${reach.asset.label}: ${reach.extended.map((e) => `${e.label} to ${kmText(e.to_km)}`).join("; ")} (${[...new Set(reach.extended.map((e) => e.why))].join("; ")}).` : null,
    changesLine(reach) || null,
    reach.not_used?.length ? `Not used: ${reach.not_used.map((n) => n.line).join("; ")}.` : null,
  ].filter(Boolean).join(" ");
}

export function firstMessage({ siteName, describe, inputs, reach: rr, footprintNote, origin, baseline = null, inside = false, searchArea = null }) {
  const reach = inside ? 0 : rr.furthest_km;
  const lines = [
    `Screen ${siteName}.`,
    `Site: ${R.summaryLine(describe)}${footprintNote ? `; ${footprintNote}` : ""}.`,
    origin ? `How the site was found: ${origin}.` : null,
    searchArea ? `This is a search area, not the site's outline: ${searchArea}. Nobody knows where on it the ${inputs.asset_label} would go. So nothing is "on site": a feature with distance 0 is "in the search area", and the run says how much of the area it covers (in_search_area). Say "in the search area" and give that share; a small share on the edge is something a layout could avoid. Severity is how much it would matter if it is on the site; the run caps the confidence of findings inside a search area. Put one line in data_gaps saying the site's outline wasn't found.` : null,
    `Setting: ${describe.offshore ? "offshore" : "onshore"}${describe.coast_km != null && describe.coast_km < 10 ? " (coastal: screen both ways)" : ""}.`,
    `Asset type: ${inputs.asset_label}${inputs.asset_assumed ? " (assumed: say so)" : ""}. Stage: ${inputs.stage || "greenfield (assumed: say so)"}.`,
    inputs.outside_profile ? `This is outside what the method was built for, so do a general screen with the same themes and say once in the summary that it's a first look. The card already carries this caveat: ${inputs.outside_profile}` : null,
    inputs.capacity_mw ? `Capacity: ${inputs.capacity_mw} MW.` : null,
    inputs.tip_height_m ? `Turbine tip height: ${inputs.tip_height_m} m.` : null,
    inside
      ? "Scope: inside the area only, as the person asked. The run fetched only what lies inside the area or touches its edge (distance 0, band \"on site\"); the surroundings were not screened. Assess only what is inside, and put one line in data_gaps saying the surroundings weren't screened."
      : reachLines(rr),
    inputs.focus ? `The person asked especially about: ${inputs.focus}.` : null,
    describe.offshore && describe.coast_km != null && describe.coast_km > reach
      ? `No land ${inside ? "inside the area" : "within any check's reach"} (the coast is about ${Math.round(describe.coast_km)} km away): settlements, schools, clinics, roads and other onshore receptors are out of reach. Don't list them as gaps; coastal communities matter only as spill reach beyond the checks' reach.` : null,
    baseline ? `The checks, by topic: your evidence. Each check is found, none found, or not checked with the reason; "must" marks a check its topic can't be called clear without. Not-checked lines are already on the card as gaps, so don't repeat them in data_gaps unless you have something to add:\n${baseline}` : null,
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

// Flags cite evidence by id (plan item 1, 25 Nov): an evidence feature the run holds (E7, from the tool output's ref
// or the checks' lines) or a check that found something (its id, e.g. heritage.listed-buildings). Code fills in the
// name, distance, source, licence and date; the analyst never retypes them. A citation that doesn't resolve is kept
// as untraced, and a flag with nothing traced isn't raised: it becomes a gap (Rob, 25 Nov: "nothing disappears
// without a trace"). Before 25 Nov evidence was matched by name and distance after the fact: 43 of 296 items failed.
const ID_LIKE = /^E\d+$|^[a-z][\w-]*(\.[\w-]+)+$/i; // E7, or a check id such as heritage.listed-buildings
// The value checks, by what they read (the card and seaMatters look for these words).
const FROM_VALUES = { "topo.water-depth": "water depth", "topo.elevation": "elevation", "material.vessel-traffic": "vessel traffic" };
const refOf = (e) => (typeof e === "string" ? e : e && typeof e === "object" ? (e.ref || e.id || null) : null);
// Where a check's finding is: on the site for a value or an inside answer, else the nearest it counted.
function checkKm(c, sea) {
  if (c.answer === "value_at_site") return c.id === "material.vessel-traffic" && sea?.traffic?.busiest ? sea.traffic.busiest.distance_km : 0;
  if (c.answer === "inside" || c.irz) return c.inside === false ? null : 0;
  if (c.answer === "classes") { const ks = (c.classes || []).map((x) => (x.on_site ? 0 : x.nearest_km)).filter((v) => v != null); return ks.length ? Math.min(...ks) : null; }
  return c.nearest ? (c.nearest.around ? 0 : c.nearest.distance_km) : null;
}
function resolveRef(e, byFid, byCheck, d, sea) {
  const id = String(refOf(e) || "").trim().replace(/^\[|\]$/g, "");
  if (!ID_LIKE.test(id)) return { ref: (typeof e === "object" && e ? String(e.name || e.ref || e.id || "") : String(e || "")).slice(0, 120), traced: false, why: "not cited by id" };
  const p = byFid.get(id.toUpperCase());
  if (p) return { ref: p.fid, name: p.name, distance_km: p.distance_km, band: bandOf(p, d), ...(p.surrounds || p.in_search_area ? {} : relationPart(p)), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, fid: p.fid, traced: true,
    ...(p.in_search_area ? { in_search_area: true, ...(p.coverage != null ? { coverage: p.coverage } : {}), ...(p.side ? { side: p.side } : {}) } : {}) };
  const c = byCheck.get(id);
  if (c && c.state === "found") {
    const km = checkKm(c, sea);
    const srcs = (c.sources?.length ? c.sources : c.source ? [c.source] : []).filter((x) => x?.dataset && x.state !== "not_checked");
    return { ref: c.id, check: c.id, ...(FROM_VALUES[c.id] ? { from_values: FROM_VALUES[c.id] } : {}), name: `${c.label}: ${K.checkLine(c)}`.slice(0, 200), distance_km: km, band: km == null ? null : km === 0 ? (c.search_area ? SEARCH_BAND : "on site") : runBand(km, d),
      dataset: srcs.map((x) => x.dataset).join("; "), publisher: [...new Set(srcs.map((x) => x.publisher).filter(Boolean))].join("; "),
      licence: [...new Set(srcs.map((x) => x.licence).filter(Boolean))].join("; "), checked: srcs[0]?.checked_at || null, traced: true };
  }
  return { ref: id, traced: false, why: c ? `the check came back ${c.state === "none" ? "none found" : "not checked"}` : "not in this run" };
}

// Returns { flags, not_raised }. evidence: the run's evidence features; ctx.checks: the run's check results.
// relevance: the topic order, for a screen ordered and badged by relevance (package E): the flag's class is set in code
// from its evidence, and the analyst's severity and confidence, if it sent any, aren't kept. Without it (a study, an
// old record) the order is severity, then confidence, as before.
export function traceResult(flags, evidence, d, { checks = [], sea = null, relevance = null } = {}) {
  const byFid = new Map(evidence.map((f) => [String(f.properties.fid).toUpperCase(), f.properties]));
  const byCheck = new Map((checks || []).map((c) => [c.id, c]));
  const all = (flags || []).map((flag) => {
    const ev = (Array.isArray(flag.evidence) ? flag.evidence : []).map((e) => resolveRef(e, byFid, byCheck, d, sea));
    const traced = ev.filter((e) => e.traced);
    const dists = traced.map((e) => e.distance_km).filter((v) => v != null);
    return {
      risk: String(flag.risk || "").trim(), theme: topicOf(flag.topic || flag.theme),
      ...(flag.linkage && typeof flag.linkage === "object" ? { linkage: {
        source: String(flag.linkage.source || "").slice(0, 160), pathway: String(flag.linkage.pathway || "").slice(0, 160), receptor: String(flag.linkage.receptor || "").slice(0, 160),
        rating: ["likely", "possible"].includes(flag.linkage.rating) ? flag.linkage.rating : "possible" } } : {}),
      ...(relevance ? {} : { confidence: CONF_ORDER[flag.confidence] != null ? flag.confidence : "low",
        severity: SEV_ORDER[flag.severity] != null ? flag.severity : null }), why: flag.why || "",
      next_step: String(flag.next_step || "").trim(), evidence: traced,
      fids: traced.map((e) => e.fid).filter(Boolean), nearest_km: dists.length ? Math.min(...dists) : null, traced: traced.length, untraced: ev.length - traced.length,
      ...(ev.length > traced.length ? { untraced_refs: ev.filter((e) => !e.traced).map((e) => `${e.ref || "?"} (${e.why})`) } : {}),
    };
  });
  const maps = relevance ? checkMaps(checks || []) : null;
  const kept = all.filter((f) => f.traced > 0)
    .map((f, i) => (relevance ? { ...f, relevance: relevanceOf(f.evidence, maps), _i: i } : f))
    .sort(relevance ? compareFlags(relevance) : (a, b) => sevRank(a) - sevRank(b) || CONF_ORDER[a.confidence] - CONF_ORDER[b.confidence] || (a.nearest_km ?? 1e9) - (b.nearest_km ?? 1e9))
    // Finding IDs follow the order shown, so F-01 is the same on the card, the map, the download and later the PDF.
    .map(({ _i, ...f }, i) => ({ id: findingId(i), ...f }));
  const not_raised = all.filter((f) => f.traced === 0).map((f) => ({ risk: f.risk, theme: f.theme, refs: f.untraced_refs || [] }));
  return { flags: kept, not_raised };
}
export const traceFlags = (flags, evidence, d, ctx = {}) => traceResult(flags, evidence, d, ctx).flags;
// The gap line for a flag that wasn't raised.
export const notRaisedGap = (n) => `Not raised as a flag, because its evidence didn't trace to anything this run found: ${n.risk.replace(/[.\s]+$/, "")}`;

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

// A study's system prompt: one sealed judgement from the checks, no tools.
export function systemForStudy(skill) {
  return `You are Tobler's analyst, writing one sealed ${skill.name.replace(/-/g, " ")} for one site. Nobody is chatting with you and you have no tools: the run has already carried out the checks, measured in code, and gives them in the first message. Judge them as the method says, then write the result.

- ${FENCE_RULE}
- Never work out a distance or an area yourself: use the distances the checks give.
- Name features and datasets as the checks name them.
- A linkage's evidence is a list of ids, never retyped names or distances: an evidence id (E7) or a check's id in square brackets ([ground.landfill]) when that check found something, as the checks below give them. The run fills in names, distances and sources from the ids. Something you can't cite by id can't support a linkage: put it in data_gaps.
- Your reply is the result: the short summary, then the JSON block, exactly as the method's Output section says. Keep your thinking short: the reply limit includes it.

<method skill="${skill.name}" version="${skill.version}">
${skill.body}
</method>`;
}

export function studyMessage({ siteName, describe, origin, reach, baseline, searchArea = null, study }) {
  return [
    `${study.label} for ${siteName}.`,
    `Site: ${R.summaryLine(describe)}.`,
    origin ? `How the site was found: ${origin}.` : null,
    searchArea ? `This is a search area, not the site's outline: ${searchArea}. Nothing is "on site": a record at distance 0 is "in the search area". Put one line in data_gaps saying the outline wasn't found.` : null,
    reachLines(reach),
    `The checks, by topic (found, none found, or not checked with the reason). The card groups them as ${study.groups.map((g) => g.label.toLowerCase()).join(", ")}:\n${baseline}`,
    study.full_study_adds?.length ? `Not in open records here (the card already lists these as what a full desk study would add, so don't repeat them in data_gaps): ${study.full_study_adds.join("; ")}.` : null,
  ].filter(Boolean).join("\n");
}

async function studyTurn({ skill, callClaude, message, onEvent, system = null }) {
  const t0 = Date.now();
  const messages = [{ role: "user", content: message }];
  const resp = await callClaude({ system: system || systemForStudy(skill), messages });
  onEvent({ type: "round", round: 0, ms: Date.now() - t0, input_tokens: resp.usage?.input_tokens || 0, output_tokens: resp.usage?.output_tokens || 0, tools: 0 });
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  return { text, usage: { input_tokens: resp.usage?.input_tokens || 0, output_tokens: resp.usage?.output_tokens || 0 }, history: [...messages, { role: "assistant", content: resp.content || [] }], stopReason: resp.stop_reason };
}

// A study's decision, settled in code: when every source check came back not checked, nothing can be said about
// linkages, so the decision is insufficient evidence whatever was written.
export function settleStudy(decision, { study, checks = [] } = {}) {
  if (!decision) return decision;
  const sources = new Set(study.groups.find((g) => g.id === "sources")?.checks || []);
  const ran = checks.filter((c) => sources.has(c.id));
  if (decision.value !== "insufficient evidence" && ran.length && ran.every((c) => c.state === "not_checked")) {
    return { ...decision, value: "insufficient evidence", changed: `from ${decision.value}: none of the source records could be checked` };
  }
  if (decision.value !== "insufficient evidence" && !ran.length) {
    return { ...decision, value: "insufficient evidence", changed: `from ${decision.value}: no source records cover this place` };
  }
  return decision;
}
// Every model call in a screening run asks for the larger reply limit (the conversation keeps the smaller one).
const roomy = (callClaude) => (args) => callClaude({ ...args, maxTokens: SCREEN_MAX_TOKENS });

// study (optional): a skill other than the screen that judges the checks alone (the contamination desk study, 24 Nov):
// { id, label, groups: [{ id, label, checks: [check ids] }], decisions, full_study_adds }. The run carries out only its
// checks, then asks once for the judgement, with no tools: its data is the checks, all measured in code.
// broughtIn: layers the person brought in after an earlier run on this place (js/bringin.js), each { atlas_id, dataset,
// publisher, licence, topic, for }. A re-run fetches them again, out to its own reach, as evidence the analyst can cite,
// listed apart from the standard checks (Rob, 26 Nov: explore first, then re-run to have them judged).
// asset: the asset for this run (js/reach.js chooseAsset; a study or a budget makes its own). said: the person's
// distances, read (js/reach.js readDistances): { search, protection, not_used }.
export async function runScreening({ host, site, inputs, asset, said = { search: [], protection: [], not_used: [] }, skill, study = null, callClaude: call, model = "", runId = "R1", onEvent = () => {}, now = () => new Date().toISOString(), broughtIn = [] }) {
  const callClaude = roomy(call);
  const started = now();
  const fp = footprintOf(site.feature, asset);
  // Inside only (areas, when the person asks): fetch only what's inside or touching; otherwise each check to its reach.
  const inside = inputs.extent === "inside" && isArea(site.feature);
  const screenPlace = { name: site.name, feature: fp.feature, origin: site.origin, status: "accepted", edits: [] };
  const evidence = [];
  const seen = new Map();
  const siteKm2 = isArea(fp.feature) ? turf.area(fp.feature) / 1e6 : 0;
  // What the site is: a point is screened on a default footprint, which stands in for an outline nobody has, so it's a
  // search area too; an area is whatever make_place recorded (js/siterole.js).
  const role = site.feature.geometry.type === "Point"
    ? { role: "search_area", why: `a default ${asset.footprint_km} km footprint round a point` }
    : placeRole(site.origin, site.feature.geometry);
  const searchArea = role.role === "search_area" && isArea(fp.feature);
  const searchNote = searchArea ? SEARCH_NOTE(siteKm2, role.why) : null;
  const rawFound = new Map(); // dataset title → every feature a tool returned, before de-duplication (for the checks)
  const capture = (list, meta = {}) => {
    for (const c of list) {
      const ds = c.source?.title || meta.dataset || "";
      if (!rawFound.has(ds)) rawFound.set(ds, []);
      rawFound.get(ds).push(c);
      const around = c.around_site ? c.area_km2 : aroundSiteKm2(siteKm2, c.geometry, c.distance_km);
      const dataset = c.source?.title || meta.dataset || "";
      const key = `${norm(dataset)}|${norm(c.name)}|${round(c.distance_km, 2)}`;
      // The analyst cites evidence by this id (E1, E2…), from its tool output and the checks: code fills in the rest.
      if (seen.has(key)) continue;
      const fid = `E${evidence.length + 1}`;
      seen.set(key, fid);
      // Inside a search area: how much of it the feature covers, and where (equal-area, js/siterole.js).
      let where = null;
      if (searchArea && !around && c.geometry && !(c.distance_km > 0)) {
        try { where = coverageIn(fp.feature, c.geometry); } catch { where = null; }
        if (!where) where = { coverage: null, side: null };
      }
      evidence.push({ type: "Feature", geometry: c.geometry, properties: {
        role: "evidence", fid, run: runId, name: c.name || c.type || "Unnamed feature", type: c.type || "", theme: meta.theme || "context",
        // A feature that only touches the edge from outside is next to the site, in the first band, not "on site".
        distance_km: round(c.distance_km, 2), band: around ? AROUND : where ? SEARCH_BAND : ladderBand(c.relation === "adjacent" ? Math.max(c.distance_km, 1e-9) : c.distance_km, reach || MAX_KM),
        ...(around ? {} : relationPart(c)), area_km2: c.area_km2 ?? (around ? Math.round(around) : null),
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
  const checked = [];
  const calls = [];
  const lastOut = new Map(); // dataset id → the tool's own output, for the checks (the analyst sees a slimmer copy)
  const exec = async (name, input, meta = {}) => {
    if (!SCREEN_TOOLS.includes(name)) throw new Error(`${name} isn't available in a screening run.`);
    const i = { ...input };
    // The checks step keeps a layer to its own reach (meta.ownReach); anything else goes out to the run's furthest reach.
    if (name === "get_data") { i.place = site.name; i.within_km = inside ? 0 : meta.ownReach ? Math.min(MAX_KM, Math.max(0, +i.within_km || 0)) : Math.min(MAX_KM, Math.max(+i.within_km || 0, reach)); }
    if (name === "find_features_near") { i.anchor = /^C\d+$/i.test(String(i.anchor || "")) ? i.anchor : site.name; i.radius_km = inside ? 0 : Math.min(MAX_KM, Math.max(+i.radius_km || 0, reach)); }
    const t0 = Date.now();
    try {
      const out = await tools.exec(name, i);
      calls.push({ tool: name, input: i, ms: Date.now() - t0 });
      const c = checkedFrom(name, i, out); if (c) checked.push(meta.check ? { ...c, check: meta.check } : c);
      if (name === "get_data") lastOut.set(i.dataset, out);
      return out;
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
  // The one coordinate system every output of this run shows (invariant 10), chosen while the checks run. Never throws.
  const presentationP = presentationCrs({ feature: fp.feature, ref: host.ref, grids: host.grids || null, epsg: host.epsg || null });
  // Checks, in code, before the analyst starts (catalogue/checks.json; js/checks.js): every check that applies to
  // this site, at this scale, comes back found, none found or not checked with the reason, so the essentials never
  // depend on a lucky catalogue search and a topic with no data shows as a gap, never as silence.
  const catalogue = host.checks || { checks: [], topics: [] };
  // An area budget (the developable area, 25 Nov) is always at site scale, and each of its checks looks out only as
  // far as its largest buffer: a feature further out can't touch the site.
  const budget = study?.budget || null;
  const scale = asset.scale || "local";
  const edges = LADDER; // every check reports on the one ladder (js/reach.js)
  const sb = turf.bbox(fp.feature);
  const studyChecks = study ? new Set(study.groups.flatMap((g) => g.checks)) : null;
  const budgetReach = budget ? reachByCheck(budget.deductions) : null;
  // Each check's reach (package A, 26 Nov): its own default, extended by the asset, overridden by the person; the
  // developable area's buffers win in a budget. The only search distance.
  const reachOpts = { scale, asset, inside, override: budgetReach ? (id) => budgetReach.get(id) : null };
  const reaches = resolveReaches(catalogue, { ...reachOpts, search: said.search || [] });
  const defaults = resolveReaches(catalogue, reachOpts);
  const inScope = (id) => !studyChecks || studyChecks.has(id);
  const reachMax = Math.max(0, ...[...reaches].filter(([id]) => inScope(id)).map(([, r]) => r.km));
  const sea = offshore || (describe.coast_km != null && describe.coast_km <= reachMax);
  // UK nations and councils, on their real outlines (invariant 2), out to the furthest reach any check could use.
  const ukAreas = await ukAreasNear(host.ref, fp.feature, describe, reachMax);
  const plans = K.planChecks(catalogue, { bbox: sb, countries: describe.countries || [], offshore, sea, coast_km: describe.coast_km ?? null, areas: ukAreas }, scale,
    { inside, skill: study?.id || "screen", reaches })
    .filter((p) => inScope(p.check.id));
  const reachRec = reachRecord({ asset, scale, plans, reaches, changes: changeLines(said.search || [], plans, defaults), protection: said.protection || [], notUsed: said.not_used || [], inside, budget: !!budget });
  // The furthest any check in this run looks: what's fetched for brought-in layers, the rings and the slider.
  const reach = inside ? 0 : reachRec.furthest_km;
  const runLike = { reach: reachRec };
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
  const fetchKm = (p) => Math.min(MAX_KM, Math.max(0, p.reach_km || 0));
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
      capture(nb.evidence, { theme: topicOf(bp.check.topic) });
      boundaryFids = evidence.slice(e0).map((f) => f.properties.fid);
      for (const c of nb.checked) checked.push({ ...c, check: bp.check.id });
      const failed = nb.checked.filter((c) => c.result === "not checked");
      if (nb.checked.length && failed.length === nb.checked.length) results.set(bp.check.id, K.notChecked(bp, failed.map((c) => `${c.dataset}: ${c.why}`).join("; ")));
      else {
        const r = K.fromFeatures(bp, asFeats(nb.evidence), edges, { dataset: nb.checked.map((c) => c.dataset).join("; "), publisher: [...new Set(nb.checked.map((c) => c.publisher).filter(Boolean))].join("; "),
          licence: [...new Set(nb.checked.map((c) => c.licence).filter(Boolean))].join("; "), checked_at: now(), fetched_km: fetchKm(bp) });
        if (failed.length) r.partly = failed.map((c) => `${c.dataset}: not checked (${c.why})`).join("; ");
        results.set(bp.check.id, r);
        featsOf.set(bp.check.id, evidence.filter((f) => boundaryFids.includes(f.properties.fid)).map((f) => f.properties));
      }
    } catch (e) {
      checked.push({ evidence: "transboundary", dataset: "boundaries", result: "not checked", why: String(e.message || e).slice(0, 160), check: bp.check.id });
      results.set(bp.check.id, K.notChecked(bp, String(e.message || e)));
    }
  }
  // Atlas layers, each fetched once however many checks use it (JNCC's offshore set serves the SAC, SPA and marine
  // checks), out to the furthest reach any of them needs.
  const layerPlans = plans.filter((p) => !results.has(p.check.id) && p.sources.some((x) => x.atlas_id || x.osm));
  const keyOf = (x) => x.atlas_id || (x.osm ? `osm:${x.osm}` : null);
  const layerFetch = new Map(); // atlas_id → { source, km, fields, name_field }
  // OpenStreetMap (js/osmchecks.js): every kind any check asks for, in one query, each out to its own reach.
  const osmWants = new Map();
  for (const p of layerPlans) for (const x of p.sources.filter((y) => y.osm)) osmWants.set(x.osm, Math.max(osmWants.get(x.osm) || 0, Math.min(MAX_KM, Math.max(0, p.reach_km || 0))));
  for (const p of layerPlans) for (const x of p.sources.filter((y) => y.atlas_id)) {
    const l = layerFetch.get(x.atlas_id) || { source: x, km: 0, fields: new Set(), name_field: x.name_field || null, coverage: false };
    // Every check layer fetches only to its own reach, up to 500 features (24 Nov): fetched further, a busy layer filled
    // its limit with features far away and undercounted the ones in reach (15+ scheduled monuments round Linlithgow).
    // Layers the person brought in go to the run's furthest reach.
    l.km = Math.max(l.km, Math.min(MAX_KM, Math.max(0, p.reach_km || 0)));
    if (p.check.answer === "classes") l.coverage = true;
    for (const f of [x.code_field, x.filter?.field, x.class_field, ...(x.keep_fields || [])].filter(Boolean)) l.fields.add(f);
    layerFetch.set(x.atlas_id, l);
  }
  const layers = [...layerFetch.values()];
  // Values read off rasters (catalogue/trusted.json "values"): elevation over the footprint on every site on land,
  // water depth offshore, and AIS vessel traffic when the sea is within the traffic check's read_km. In parallel.
  const vals = host.trusted?.values || {};
  const elevSources = vals.elevation || [];
  const depthPlan = toolPlan("depth"), elevPlan = toolPlan("elevation"), trafficPlan = toolPlan("traffic");
  const wantDepth = !!depthPlan && offshore && elevSources.length > 0;
  const wantElev = !!elevPlan && !offshore && elevSources.length > 0;
  const trafficKm = trafficPlan?.check.read_km?.[scale] ?? 5;
  const wantTraffic = !!trafficPlan && !inside && !!vals.traffic && (offshore || (describe.coast_km != null && describe.coast_km <= trafficKm));
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
      wantElev ? elevationFrom(elevSources, { feature: fp.feature, fetchFn, now, setting: "land" }) : null,
      wantTraffic ? vesselTraffic({ site: fp.feature, closeKm: trafficKm, source: vals.traffic, fetchFn, now }) : null,
    ]);
    if (d) { checked.push({ ...d.checked, check: depthPlan.check.id }); if (d.depth) seaVals.depth = d.depth; if (d.elevation) elevation = d.elevation; }
    if (e) { checked.push({ ...e.checked, check: elevPlan.check.id }); if (e.elevation) { elevation = e.elevation; elevSig = elevationSignificance(elevation); } }
    if (t) { checked.push({ ...t.checked, check: trafficPlan.check.id }); if (t.traffic) seaVals.traffic = t.traffic; capture(t.evidence, { theme: topicOf(trafficPlan.check.topic) }); }
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
  const layerAnswers = new Map(); // atlas_id (or osm:<kind>) → { features, meta } or { not_checked }
  const osmJob = osmWants.size ? (async () => {
    const t0 = Date.now();
    const kinds = [...osmWants.keys()];
    onEvent({ type: "tool_start", name: "openstreetmap", input: { kinds } });
    // Tobler's own copy of OpenStreetMap first (js/osmsnapshot.js), Overpass when the site is outside it or it can't
    // be read. host.osmSnapshot: a test's own source, or null to go straight to Overpass.
    const snapshot = host.osmSnapshot !== undefined ? host.osmSnapshot : osmSnapshot({ fetchFn: host.fetchFn || globalThis.fetch });
    // A study run is sealed and nobody waits on each step, so Overpass gets the patient wait (55 s, a retry); a
    // constraints screen keeps the quick one (js/gazetteer.js OVERPASS_SPEEDS).
    const patient = !!study;
    const got = await osmAnswers({ wants: osmWants, site: fp.feature, snapshot, timeoutS: patient ? 50 : 25,
      onOverpass: () => onEvent({ type: "tool_start", name: "openstreetmap", input: { kinds, overpass: true, patient } }),
      query: (q) => overpassQuery(q, host.fetchFn || globalThis.fetch, host.headers || {}, { patient }), now });
    for (const [kind, a] of got) {
      layerAnswers.set(`osm:${kind}`, a);
      const plan = layerPlans.find((p) => p.sources.some((x) => x.osm === kind));
      if (a.not_checked) { checked.push({ evidence: kind, dataset: `OpenStreetMap: ${kind}`, publisher: "OpenStreetMap contributors", result: "not checked", why: a.not_checked, check: plan.check.id }); continue; }
      checked.push({ evidence: kind, dataset: a.meta.dataset, publisher: a.meta.publisher, licence: a.meta.licence, result: a.features.length ? "features" : "none found", count: a.features.length, within_km: a.meta.fetched_km, checked_at: a.meta.checked_at, via: a.meta.via, ...(a.meta.data_as_of ? { data_as_of: a.meta.data_as_of } : {}), check: plan.check.id });
      capture(a.features.map((f) => ({ name: f.name, type: kind, geometry: f.geometry, distance_km: f.distance_km, extra: f.extra, ...relationPart(f),
        source: { title: a.meta.dataset, publisher: a.meta.publisher, licence: a.meta.licence, url: `https://www.openstreetmap.org/${f.osm}` } })), { theme: topicOf(plan.check.topic) });
    }
    onEvent({ type: "tool", name: "openstreetmap", input: { kinds }, ms: Date.now() - t0, baseline: true,
      output: Object.fromEntries([...got].map(([k, a]) => [k, a.not_checked ? `not checked (${a.not_checked})` : `${a.features.length} within ${a.meta.fetched_km} km, ${a.meta.via === "copy" ? `Tobler's copy${a.meta.data_as_of ? ` (data as of ${String(a.meta.data_as_of).slice(0, 10)})` : ""}` : "Overpass"}`])) });
  })() : null;
  await Promise.allSettled([...(osmJob ? [osmJob] : []), ...layers.map(async (l) => {
    const x = l.source, rec = x.record || {};
    const id = tools.useDataset({ id: x.atlas_id, title: rec.title || x.atlas_id, publisher: rec.publisher || "", licence: rec.licence || "", capabilities: ["query"], concepts: [] }, "B");
    const check = layerPlans.find((p) => p.sources.includes(x));
    const input = { dataset: id, place: site.name, theme: topicOf(check.check.topic), within_km: l.km, limit: 500, ...(l.fields.size ? { fields: [...l.fields] } : {}), ...(l.name_field ? { name_field: l.name_field } : {}) };
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
      layerAnswers.set(x.atlas_id, { features: (rawFound.get(raw.dataset) || []).map((c) => ({ name: c.name, distance_km: c.distance_km, around_site: !!c.around_site, extra: c.extra || {}, bbox: box(c), geometry: c.geometry, coverage: cov(c), ...relationPart(c) })),
        meta: { dataset: raw.dataset, publisher: raw.publisher, licence: raw.licence, checked_at: raw.checked_at, capped: !!raw.capped, fetched_km: raw.within_km } });
    } catch (e) {
      onEvent({ type: "tool", name: "get_data", input, error: String(e.message || e), ms: Date.now() - t0, baseline: true });
      layerAnswers.set(x.atlas_id, { not_checked: String(e.message || e) });
    }
  })]);
  for (const p of layerPlans) {
    const answers = p.sources.map((x) => (x.pending ? { source: x } : { source: x, ...(layerAnswers.get(keyOf(x)) || { not_checked: "not fetched" }) }));
    const r = K.fromSources(p, answers, edges, mergeShapes ? { sameShape } : {});
    // The SSSI Impact Risk Zones: the zones the site is in, read for this kind of development (the profile's
    // categories for the asset type; "all consultations" always).
    if (p.check.decode === "irz" && r.state !== "not_checked") {
      const codes = answers.flatMap((a) => (a.features || []).filter((f) => !(f.distance_km > 0)).map((f) => K.irzCodeOf(f.extra?.[a.source.code_field]))).filter(Boolean);
      const keys = host.profile?.()?.irz_categories?.[inputs.asset_type] || host.profile?.()?.irz_categories?.other || [];
      r.irz = K.decodeIrz(codes, host.irz, keys);
      r.irz_codes = [...new Set(codes)].slice(0, 12);
    }
    // The zone answer (js/relation.js): for a check that asks "is the site inside?", how much of the site the zones
    // cover together, each piece once; and when it isn't inside, a zone next to it is said.
    if (p.check.answer === "inside" && isArea(fp.feature) && !searchArea && r.state !== "not_checked") {
      const feats = answers.flatMap((a) => (a.features || []).filter((f) => f.geometry && K.passes(a.source, f)));
      if (r.state === "found") {
        try {
          const z = zonesAtSite(fp.feature, feats.filter(isOnSite).map((f) => ({ name: f.name, geometry: f.geometry })));
          if (z.zones.length) { r.site_share = z.site_share; if (z.zones.length > 1) r.zones = z.zones.length; }
        } catch { /* the line keeps its name without a share */ }
      } else {
        const next = feats.filter((f) => f.relation === "adjacent").sort((a, b) => a.distance_km - b.distance_km)[0];
        if (next) r.next_to = { name: next.name, distance_km: round(next.distance_km, 3) };
      }
    }
    results.set(p.check.id, r);
    // The analyst's nearest names: the features this check counted, from its own sources (after each source's filter).
    const keep = (a) => (f) => f.dataset === a.meta?.dataset && K.passes(a.source, f);
    const ev = evidence.map((f) => f.properties);
    featsOf.set(p.check.id, answers.filter((a) => a.meta?.dataset && !a.not_checked).flatMap((a) => ev.filter(keep(a))));
    // A pending source beside answered ones is still a gap to list.
    for (const a of answers.filter((y) => y.source.pending)) checked.push({ evidence: p.check.topic, dataset: `${p.check.label} (${a.source.region})`, result: "not checked", why: a.source.pending, check: p.check.id });
  }
  // Layers the person brought in after an earlier run: fetched again here, each to the run's reach.
  const brought = [];
  await Promise.all((budget ? [] : broughtIn).map(async (b) => {
    const id = tools.useDataset({ id: b.atlas_id, title: b.dataset, publisher: b.publisher || "", licence: b.licence_full || b.licence || "", capabilities: ["query"], concepts: [] }, "B");
    const input = { dataset: id, place: site.name, theme: topicOf(b.topic || "context"), within_km: reach, limit: 500 };
    const t0 = Date.now();
    onEvent({ type: "tool_start", name: "get_data", input });
    try {
      await exec("get_data", input, { ownReach: true });
      const raw = lastOut.get(id) || {};
      onEvent({ type: "tool", name: "get_data", input, output: raw, ms: Date.now() - t0, baseline: true });
      brought.push({ ...b, dataset: raw.dataset || b.dataset, checked_at: raw.checked_at || now(), within_km: reach, ...(raw.not_checked ? { not_checked: String(raw.not_checked).split(/(?<=\.)\s/)[0].slice(0, 160) } : { count: raw.within_distance ?? 0 }) });
    } catch (e) {
      onEvent({ type: "tool", name: "get_data", input, error: String(e.message || e), ms: Date.now() - t0, baseline: true });
      brought.push({ ...b, checked_at: now(), within_km: reach, not_checked: String(e.message || e).slice(0, 160) });
    }
  }));
  const seaRes = seaJob ? await seaJob.catch((e) => ({ lines: [], notChecked: [`elevation, water depth and vessel traffic: not checked (${String(e.message || e).slice(0, 120)})`] })) : null;
  if (seaRes && seaJob) for (const p of [depthPlan, elevPlan, trafficPlan]) if (p && !results.has(p.check.id) && ((p === depthPlan && wantDepth) || (p === elevPlan && wantElev) || (p === trafficPlan && wantTraffic))) results.set(p.check.id, K.notChecked(p, seaRes.notChecked[0] || "no reading"));
  // In plan order (the catalogue's order), only checks that ran or were found wanting: a value check that didn't
  // apply here (no sea within reach, inside only) is left out, as checks that don't apply are.
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
        return { ...(p ? { fid: p.fid } : {}), name: m.name, distance_km: m.around_site ? null : m.distance_km, ...(m.around_site ? { around: true } : relationPart(m)),
          ...(m.coverage ? { coverage: Math.round(m.coverage * 1000) / 1000 } : {}), ...(m.detail ? { detail: m.detail } : {}), ...(m.publisher ? { publisher: m.publisher } : {}) };
      });
      delete r.members;
    } else if (r.id === "context.boundaries" && r.state === "found") {
      r.features = evidence.filter((f) => boundaryFids.includes(f.properties.fid) && (f.properties.surrounds || f.properties.distance_km <= (r.reach_km ?? 0) + 1e-9))
        .sort((a, b) => a.properties.distance_km - b.properties.distance_km)
        .map((f) => ({ fid: f.properties.fid, name: f.properties.name, distance_km: f.properties.distance_km, ...(f.properties.details?.sides ? { detail: f.properties.details.sides } : {}) }));
    }
  }
  // A study's report is by its own groups, not topics, so "topics with no check" is a screen's line only.
  const noCheck = study ? [] : K.uncheckedTopics(catalogue, checkResults, scale);
  // The analyst's lines, by topic: each check's answer, with the nearest few by name, and the values' full lines.
  const plainName = (f) => `${f.name}${f.details?.sides ? ` [${f.details.sides}${f.details.line_type ? `, ${f.details.line_type}` : ""}]` : ""} ${f.surrounds ? "(around the site: a wide area it lies within)" : `${f.distance_km} km`}`;
  // With its evidence id first, the id a flag cites (E7).
  const nameOf = (f) => `${f.fid ? `${f.fid} ` : ""}${plainName(f)}`;
  // The same feature from two sources (NatureScot's and JNCC's SAC) is listed once, under the first one's id.
  const onceEach = (fs) => { const seenName = new Set(); return fs.filter((f) => { const k = plainName(f); if (seenName.has(k)) return false; seenName.add(k); return true; }); };
  const baselineLines = [`Scale of this screen: ${scale}. Each check looks out to its own reach and reports on one ladder of bands (within the site, 0–100 m, 100–250 m, 250–500 m, 500 m–1 km, 1–2, 2–5, 5–10, 10–20, 20–30, 30–50 km); bands are for reporting, not risk.`];
  for (const g of K.byTopic(catalogue, checkResults)) {
    baselineLines.push(`${g.label}:`);
    for (const r of g.results) {
      const near = r.state === "found" && r.answer === "count_by_band" ? onceEach((featsOf.get(r.id) || []).filter((f) => f.distance_km <= (r.reach_km ?? 0) + 1e-9 || f.surrounds)
        .sort((a, b) => a.distance_km - b.distance_km)).map(nameOf).slice(0, 3) : [];
      // Every source the check used (a UK check may read four nations' layers and JNCC's), titles only.
      const srcs = (r.sources?.length ? r.sources : r.source ? [r.source] : []).filter((x) => x.dataset);
      const src = r.answer === "value_at_site" && r.state === "found" ? "" : srcs.length ? ` [${srcs.map((x) => `${x.dataset}${x.state === "not_checked" ? ": not checked" : ""}`).join("; ")}]` : "";
      baselineLines.push(`- [${r.id}] ${r.label}${r.must ? " (must)" : ""}: ${K.checkLine(r, { nearest: !near.length })}${near.length ? `; nearest ${near.join("; ")}` : ""}${r.partly ? ` (partly: ${r.partly})` : ""}${src}`);
      if (r.irz) for (const z of r.irz.filter((y) => y.consult)) baselineLines.push(`  - Natural England's wording, ${z.category}: ${z.texts.join(" | ")}`);
    }
  }
  if (seaRes) for (const l of seaRes.lines) baselineLines.push(`- ${l}`);
  if (brought.length) {
    baselineLines.push("Brought in by the person after an earlier run (not standard checks; judge them like any evidence, citing their ids):");
    for (const b of brought) {
      const near = b.not_checked ? [] : evidence.filter((f) => f.properties.dataset === b.dataset).sort((x, y) => x.properties.distance_km - y.properties.distance_km).slice(0, 3).map((f) => nameOf(f.properties));
      baselineLines.push(`- ${b.dataset} (${b.publisher || "publisher not stated"}), for ${String(b.for || "").toLowerCase()}: ${b.not_checked ? `not checked (${b.not_checked})` : b.count ? `${b.count} within ${reach} km; nearest ${near.join("; ")}` : `none within ${reach} km`}`);
    }
  }
  const ncLine = K.noCheckLine(catalogue, noCheck);
  if (ncLine) baselineLines.push(`${ncLine}. The card already lists them as not checked; where one matters for this site, say so in data_gaps.`);
  const baselineCalls = calls.length;
  // One line per source the tools reached, for the repair prompt when a write-up is cut off.
  const summarise = (c) => {
    const near = evidence.filter((f) => f.properties.dataset === c.dataset).sort((x, y) => x.properties.distance_km - y.properties.distance_km).slice(0, 3)
      .map((f) => nameOf({ ...f.properties }));
    return `- ${c.dataset} (${c.publisher || "?"}): ${c.result === "features" ? `${c.count} ${inside ? "inside or touching the area" : `within ${reach} km`}; nearest ${near.join("; ")}` : c.result}${c.why ? ` (${c.why})` : ""}`;
  };
  const origin = site.origin?.method === "words"
    ? `from the words "${site.origin.words}", anchored on ${site.origin.anchor?.name || site.origin.anchor?.place || "a found feature"}${site.origin.anchor?.type ? `, a ${String(site.origin.anchor.type).slice(0, 60)}` : ""}${site.origin.anchor?.source?.publisher ? ` (${site.origin.anchor.source.publisher})` : ""}, ${site.origin.confidence} confidence`
    : site.origin?.method === "file" ? fileOriginText(site.origin)
    : site.origin?.method === "service" ? serviceOriginText(site.origin)
    : "drawn on the map by the person";
  // An area budget asks no model: the rules are the skill's, the geometry is the area_budget tool's.
  const budgetOut = budget ? budgetFrom({ budget, plans, results, layerAnswers, keyOf, catalogue, site: fp.feature }) : null;
  const screenMessage = () => firstMessage({ siteName: site.name, describe, inputs, reach: reachRec, footprintNote: fp.note, origin, baseline: baselineLines.join("\n") || null, inside, searchArea: searchNote });
  const res = budget ? { text: "", usage: { input_tokens: 0, output_tokens: 0 }, history: [], stopReason: null }
    : study ? await studyTurn({ skill, study, callClaude, message: studyMessage({ siteName: site.name, describe, origin, reach: reachRec, baseline: baselineLines.join("\n"), searchArea: searchNote, study }), onEvent })
    : await studyTurn({ skill, callClaude, message: screenMessage(), onEvent, system: systemForScreen(skill) });
  let parsed = budgetOut ? { json: { flags: [], data_gaps: [], checked: [] }, summary: budgetSummary(budgetOut.budget) } : parseResult(res.text);
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
    const ASK = study
      ? "Reply now with only the JSON block, compact: the decision and its reason in one line; at most 6 flags, each with severity and a short next_step, and at most 3 evidence ids each (E-numbers or check ids, as the lines above give them); data_gaps at most 10 short lines; checked as []. Keep any thinking brief."
      : "Reply now with only the JSON block, compact: at most 6 flags, each with a short next_step and at most 3 evidence ids (E-numbers or check ids, as the lines above give them); data_gaps at most 10 short lines; checked as []. Keep any thinking brief.";
    // First from a compact summary of what the tools found, not the whole history (Rob's housing screen, 20 Nov: the
    // full history was ~34k tokens and the write-up hit the cap); then, if that fails, from the full history as before.
    const found = checked.filter((c) => c.result === "features" || c.result === "not checked").map(summarise).join("\n");
    const tail = String(res.text || "").slice(-3000);
    const attempts = [
      { how: "summary", messages: [{ role: "user", content: `${firstMessage({ siteName: site.name, describe, inputs, reach: reachRec, footprintNote: fp.note, origin, baseline: null, inside, searchArea: searchNote })}\n\nWhat the tools found (everything is on the map and in the run):\n${found || "- nothing returned"}\n\n${tail ? `Your write-up was cut off before its JSON block. Its last part:\n${tail}\n\n` : ""}${ASK}` }] },
      { how: "history", messages: [...history, { role: "user", content: `Your result was cut off or had no JSON block. ${ASK}` }] },
    ];
    debug.repairs = [];
    for (const a of attempts) {
      try {
        const resp = await callClaude({ system: study ? systemForStudy(skill) : systemForScreen(skill), messages: a.messages });
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
  // A screen is ordered and badged by relevance, set in code (package E, Rob 27 Nov); a study keeps its own order.
  const byRelevance = !study && !budget;
  const traced = traceResult(parsed.json?.flags, evidence, runLike, { checks: checkResults, sea: seaVals, relevance: byRelevance ? (catalogue?.topics || []).map((t) => t.id) : null });
  let flags = traced.flags;
  if (searchArea) {
    flags = applySearchArea(flags, new Map(evidence.map((f) => [f.properties.fid, f.properties])));
    parsed.summary = reword(parsed.summary);
  }
  const siteFeature = { type: "Feature", geometry: fp.feature.geometry, properties: { role: "site", name: site.name, run: runId } };
  const presentation_crs = await presentationP;
  return {
    type: "FeatureCollection",
    tobler_run: {
      schema: RUN_SCHEMA, id: runId, kind: study ? study.id : "ntr-screen", skill: { name: skill.name, version: skill.version }, model,
      // A study travels with its own groups and labels, so the card, report and share link need no profile.
      ...(study ? { study: { id: study.id, label: study.label, groups: study.groups.map((g) => ({ id: g.id, label: g.label, checks: g.checks.filter((c) => checkResults.some((r) => r.id === c)) })), full_study_adds: study.full_study_adds || [] } } : {}),
      ...(budgetOut ? { budget: budgetOut.budget } : {}),
      industry: host.profile?.()?.id || null,
      decision: budget ? null : study
        ? settleStudy(readDecision(parsed.json?.decision, searchArea ? reword(parsed.json?.decision_why) : parsed.json?.decision_why, study.decisions), { study, checks: checkResults })
        // A screen has no decision word (Rob, 27 Nov): only "insufficient evidence", set in code, when a topic's
        // must-checks all came back not checked. Its headline is built from the flags' classes.
        : settleScreen({ checks: checkResults, topicLabel: (t) => K.topicLabel(catalogue, t) }),
      ...(byRelevance ? { order: "relevance", headline: headlineOf(flags, checkResults) } : {}),
      started_at: started, finished_at: now(),
      site: {
        name: site.name, how_found: origin, confidence: site.origin?.method === "words" ? site.origin.confidence : site.origin?.method === "file" ? "from the person's file" : site.origin?.method === "service" ? "from a service the person chose" : "drawn",
        anchor_source: site.origin?.anchor?.source ? { title: site.origin.anchor.source.title, publisher: site.origin.anchor.source.publisher, licence: site.origin.anchor.source.licence } : null,
        footprint: inside ? "inside the area only (the surroundings weren't screened)" : searchArea ? searchNote : fp.note || `screened on the ${/Line/.test(site.feature.geometry.type) ? "line" : "area"} itself`,
        role: searchArea ? "search_area" : role.role, role_why: role.why, ...(siteKm2 ? { area_km2: round(siteKm2, 3) } : {}),
        setting: offshore ? "offshore" : "onshore", summary: R.summaryLine(describe),
        asset_type: inputs.asset_type, asset_label: inputs.asset_label, asset_assumed: !!inputs.asset_assumed, ...(inputs.outside_profile ? { outside_profile: inputs.outside_profile } : {}),
        ...(inputs.asset_from ? { asset_from: inputs.asset_from } : {}),
        stage: study ? (inputs.stage || "") : inputs.stage || "greenfield (assumed)", capacity_mw: inputs.capacity_mw ?? null, tip_height_m: inputs.tip_height_m ?? null,
      },
      ...(Object.keys(seaVals).length ? { sea: seaVals } : {}),
      ...(elevation ? { elevation: { ...elevation, ...(elevSig ? { significance: elevSig } : {}) } } : {}),
      extent: inside ? "inside" : "around", reach: reachRec, fetched_to_km: reach, assessed_within_km: reach, presentation_crs,
      method: inside
        ? "Inside the area only, at the person's request: features inside the area or touching its edge (distance 0), geodesic on WGS84; the surroundings weren't fetched. Coordinates WGS84 (EPSG:4326)."
        : searchArea
          ? "The site's outline wasn't found, so it was screened as a search area: features inside it are reported by the share of it they cover (overlay in a Lambert azimuthal equal-area projection centred on it), not as on site; under 10% covered is low confidence, 10% or more isn't capped, and points or lines inside are medium. Distances outside it geodesic on WGS84, measured from its edge; each check fetched once, out to its own reach. Coordinates WGS84 (EPSG:4326)."
          : "Distances geodesic on WGS84, measured from the footprint edge (0 = on site); each check fetched once, out to its own reach (its default, extended by the asset where there's a stated reason, or as the person set it), and reported on one ladder of bands. Coordinates WGS84 (EPSG:4326).",
      flags, checked, data_gaps: [...(Array.isArray(parsed.json?.data_gaps) ? parsed.json.data_gaps.map(String) : []), ...traced.not_raised.map(notRaisedGap)],
      ...(traced.not_raised.length ? { not_raised: traced.not_raised } : {}),
      ...(brought.length ? { brought_in: brought } : {}),
      model_checked: Array.isArray(parsed.json?.checked) ? parsed.json.checked : [],
      ...(!study && readLookFor(parsed.json?.look_for).length ? { look_for: readLookFor(parsed.json.look_for) } : {}),
      summary: parsed.summary, ...(parsed.json ? {} : { parse_error: "The analyst's result had no readable JSON block, so there are no structured flags. The summary is kept as written." }),
      checks: checkResults, checks_scale: scale, checks_merge_shapes: mergeShapes, checks_version: catalogue.version || null, ...(noCheck.length ? { no_check_topics: noCheck } : {}),
      // Topic names travel with the run, so a share link can show them without the catalogue.
      topic_labels: Object.fromEntries((catalogue.topics || []).filter((t) => noCheck.includes(t.id) || checkResults.some((c) => c.topic === t.id)).map((t) => [t.id, t.label])),
      baseline: { layers: layers.map((l) => l.source.record?.title || l.source.atlas_id), calls: baselineCalls }, disclaimer: DISCLAIMER,
      calls, usage, ...(parsed.json && !repaired ? {} : { debug }), ...(repaired ? { note: "The first result was cut off; the structured result was asked for again from the same evidence." } : {}), assessments: [],
    },
    features: [siteFeature, ...evidence, ...(budgetOut?.features || [])],
  };
}

// The area budget from a run's checks: each deduction's features (every piece, after each source's filter and the
// deduction's classes, within its buffer), then the area_budget tool. A deduction whose checks weren't checked is
// "not checked", never zero; one with no data here says so. OpenStreetMap relations come only as a centre point, so
// they're counted apart and left out of the area. Returns the budget for the record and its shapes for the map.
export function budgetFrom({ budget, plans, results, layerAnswers, keyOf, catalogue, site }) {
  const topicOfCheck = (id) => catalogue.checks?.find((c) => c.id === id)?.topic || null;
  const ded = budget.deductions.map((d) => {
    const base = { id: d.id, label: d.label, kind: d.kind, buffer_m: d.buffer_m, reason: d.reason, topic: topicOfCheck(d.checks[0]), ...(d.distance ? { distance: d.distance } : {}), ...(d.changed ? { changed: d.changed } : {}) };
    const ps = plans.filter((p) => d.checks.includes(p.check.id));
    if (!ps.length) return { ...base, state: "not_checked", why: "no data for this place in Tobler yet" };
    const rs = ps.map((p) => results.get(p.check.id)).filter(Boolean);
    const answered = rs.filter((r) => r.state !== "not_checked");
    if (!answered.length) return { ...base, state: "not_checked", why: rs.map((r) => r.why).find(Boolean) || "not checked" };
    const geometries = [];
    const sources = [];
    let count = 0, centreOnly = 0;
    const km = (d.buffer_m || 0) / 1000;
    for (const p of ps) {
      if (results.get(p.check.id)?.state === "not_checked") continue;
      for (const s of p.sources) {
        const a = layerAnswers.get(keyOf(s));
        if (!a || a.not_checked || !a.features) continue;
        let used = 0;
        for (const f of a.features) {
          if (!K.passes(s, f)) continue;
          if (d.classes && !classMatches(K.classOf(s, f), d.classes)) continue;
          if (!f.around_site && !(f.distance_km != null && f.distance_km <= km + 1e-6)) continue;
          for (const piece of [f, ...(f.parts || [])]) {
            if (!piece.geometry) continue;
            if (String(piece.osm || "").startsWith("relation/")) { centreOnly++; continue; }
            geometries.push(piece.geometry);
          }
          count++; used++;
        }
        if (used && a.meta) sources.push({ dataset: a.meta.dataset, publisher: a.meta.publisher, licence: a.meta.licence, checked_at: a.meta.checked_at });
      }
    }
    const partly = rs.map((r) => r.partly).filter(Boolean).join("; ");
    return { ...base, state: count ? "found" : "none", geometries, count, ...(centreOnly ? { centre_only: centreOnly } : {}), ...(partly ? { partly } : {}), source: sources };
  });
  for (const n of budget.not_checked || []) ded.push({ id: n.id, label: n.label, kind: n.kind || "soft", state: "not_checked", why: n.why, reason: "" });
  const b = areaBudget(site, ded);
  // Carry the extras the tool doesn't know about onto its rows.
  const extra = new Map(ded.map((d) => [d.id, d]));
  for (const row of [...b.rows, ...b.soft]) {
    const d = extra.get(row.id);
    if (d?.centre_only) row.centre_only = d.centre_only;
    if (d?.partly) row.partly = d.partly;
    if (d?.distance) row.distance = d.distance;
  }
  const feats = [];
  const rowOf = new Map([...b.rows, ...b.soft].map((r) => [r.id, r]));
  for (const [id, g] of Object.entries(b.shapes.taken)) {
    const r = rowOf.get(id);
    if (g) feats.push({ type: "Feature", geometry: g, properties: { role: "budget", part: r.kind === "soft" ? "soft" : "taken", deduction: id, label: r.label, kind: r.kind, theme: topicOf(r.topic), ha: r.ha } });
  }
  if (b.shapes.net) feats.push({ type: "Feature", geometry: b.shapes.net, properties: { role: "budget", part: "net", label: "Net developable area", ha: b.net_ha } });
  const { shapes, ...rest } = b;
  return {
    budget: { asset_type: budget.asset_type, asset_label: budget.asset_label, asset_assumed: !!budget.asset_assumed, changes: budget.changes || [], ...(budget.notes?.length ? { notes: budget.notes } : {}), ...(budget.unknown?.length ? { unknown: budget.unknown } : {}), ...rest },
    features: feats,
  };
}

export const evidenceOf = (record) => record.features.filter((f) => f.properties.role === "evidence");

// The slider: findings up to km, nearest first.
export function evidenceWithin(record, km) {
  return evidenceOf(record).filter((f) => f.properties.distance_km != null && f.properties.distance_km <= km + 1e-9)
    .sort((a, b) => a.properties.distance_km - b.properties.distance_km);
}

// "First school at 1.3 km": the nearest finding of each topic within km.
export function nearestByTheme(record, km) {
  const out = new Map();
  for (const f of evidenceWithin(record, km)) if (!f.properties.surrounds && !out.has(topicOf(f.properties.theme))) out.set(topicOf(f.properties.theme), f.properties);
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
  // An old run (near/close/wider) narrows its bands as before; a new one keeps its ladder, and only the distance the
  // flags are written for changes.
  const legacy = isLegacy(run);
  const d = legacy ? { ...run.distances, wider: km, close: Math.min(run.distances.close, km), near: Math.min(run.distances.near, km), set_by: "person",
    reasons: [`re-assessed from the stored evidence within ${km} km (fetched to ${run.fetched_to_km} km)`, ...run.distances.reasons] } : null;
  const bandsBy = legacy ? { distances: d } : run;
  const ev = evidenceWithin(record, km).map((f) => {
    const p = f.properties;
    return { ref: p.fid, name: p.name, type: p.type, theme: topicOf(p.theme), distance_km: p.distance_km, band: bandOf(p, bandsBy), ...(p.in_search_area ? { in_search_area: whereText(p) } : {}), dataset: p.dataset, publisher: p.publisher, licence: p.licence, checked: p.checked_at, ...(p.details ? { details: p.details } : {}) };
  });
  const insideOnly = km === 0 && isArea(record.features.find((f) => f.properties.role === "site"));
  const where = insideOnly ? "inside the area (inside it or touching its edge)" : `within ${km} km of the footprint edge`;
  const message = [
    `Re-assess the screen of ${run.site.name} for findings ${where}.${insideOnly ? " The person chose to look inside the area only." : ""} No tools: use only the evidence below, which was fetched in the original run.`,
    `Site: ${run.site.summary}; ${run.site.footprint}. Setting: ${run.site.setting}. Asset type: ${run.site.asset_label}. Stage: ${run.site.stage}.`,
    run.site.role === "search_area" ? "The site's outline wasn't found, so this is a search area: evidence marked \"in the search area\" may or may not be on the site. Say \"in the search area\" with the share it covers (coverage), never \"on site\"." : null,
    legacy ? `Distances now: ${runDistancesLine({ distances: d })}.` : `Distances now: findings within ${kmText(km)} of the site's edge. In the original run ${reachLine(run.reach)}; the checks below keep those reaches.`,
    `Evidence ${insideOnly ? "inside the area" : `within ${km} km`} (${ev.length} features):\n${JSON.stringify(ev)}`,
    run.checks?.length ? `The checks (cite one that found something by its id in square brackets):\n${run.checks.map((c) => `- [${c.id}] ${c.label}: ${K.checkLine(c)}`).join("\n")}` : null,
    `What the original run checked:\n${JSON.stringify(run.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.why ? { why: c.why } : {}) })))}`,
    `Gaps from the original run:\n${JSON.stringify(run.data_gaps)}`,
    insideOnly
      ? "Write the short summary and the JSON block as the method says. Features outside the area are out of scope for this view (they were found and stay in the run); gaps still stand."
      : "Write the short summary and the JSON block as the method says. Features beyond the new distance are out of scope; gaps still stand.",
  ].filter(Boolean).join("\n\n");
  const resp = await callClaude({ system: systemForScreen(skill), messages: [{ role: "user", content: message }] });
  const text = (resp.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  const parsed = parseResult(text);
  if (!parsed.json) throw new Error("The re-assessment came back without a readable result. The earlier flags are unchanged.");
  run.assessments.push({ at: now(), within_km: run.assessed_within_km, flags: run.flags, decision: run.decision ?? null, ...(run.headline ? { headline: run.headline } : {}), summary: run.summary, ...(legacy ? { distances: run.distances } : {}) });
  const byRelevance = isRelevanceRun(run);
  const traced = traceResult(parsed.json.flags, evidenceOf(record), bandsBy, { checks: run.checks || [], sea: run.sea || null, relevance: byRelevance ? Object.keys(run.topic_labels || {}) : null });
  run.flags = traced.flags;
  const searchArea = run.site.role === "search_area";
  if (searchArea) run.flags = applySearchArea(run.flags, new Map(evidenceOf(record).map((f) => [f.properties.fid, f.properties])));
  if (byRelevance) { run.decision = settleScreen({ checks: run.checks || [], topicLabel: (t) => run.topic_labels?.[t] || t }); run.headline = headlineOf(run.flags, run.checks || []); }
  else run.decision = settleDecision(readDecision(parsed.json.decision, searchArea ? reword(parsed.json.decision_why) : parsed.json.decision_why), { checked: run.checked, flags: run.flags, ...(run.checks ? { checks: run.checks } : {}) }); // a decision written for the old distance no longer stands
  run.data_gaps = [...(Array.isArray(parsed.json.data_gaps) ? parsed.json.data_gaps.map(String) : run.data_gaps.filter((g) => !/^Not raised as a flag/.test(g))), ...traced.not_raised.map(notRaisedGap)];
  if (traced.not_raised.length) run.not_raised = traced.not_raised; else delete run.not_raised;
  run.summary = searchArea ? reword(parsed.summary) : parsed.summary;
  if (legacy) run.distances = d;
  run.assessed_within_km = km;
  for (const f of evidenceOf(record)) f.properties.band = bandOf(f.properties, bandsBy);
  run.usage = { input_tokens: (run.usage?.input_tokens || 0) + (resp.usage?.input_tokens || 0), output_tokens: (run.usage?.output_tokens || 0) + (resp.usage?.output_tokens || 0) };
  return record;
}

// What the conversation's tool gets back: the headline, as data only. The reply after a run is written in code
// (js/runreply.js) and ends the turn, so nothing here tells the model what to say (plan item 1, 25 Nov).
export function headline(record) {
  const r = record.tobler_run;
  const rel = isRelevanceRun(r);
  const byConf = { high: 0, medium: 0, low: 0 };
  if (!rel) r.flags.forEach((f) => { byConf[f.confidence]++; });
  const notChecked = r.checked.filter((c) => c.result === "not checked");
  return {
    run: r.id, site: r.site.name, scope: r.extent === "inside" ? "inside the area only" : "the site and its surroundings", distances: r.extent === "inside" ? "none (inside the area only)" : runDistancesLine(r), ...(r.reach?.changes?.length ? { your_changes: r.reach.changes.map((c) => c.line) } : {}), ...(r.reach?.not_used?.length ? { not_used: r.reach.not_used.map((n) => n.line) } : {}), asset: `${r.site.asset_label}${r.site.asset_assumed ? " (assumed)" : ""}`, stage: r.site.stage,
    ...(r.decision ? { decision: r.decision.value } : {}),
    flags: r.flags.length, ...(rel ? { headline: headlineText(r.headline) } : { by_confidence: byConf }),
    top_flags: r.flags.slice(0, 5).map((f) => ({ id: f.id, risk: f.risk, ...(rel ? { relevance: f.relevance?.class || null } : { ...(f.severity ? { severity: f.severity } : {}), confidence: f.confidence }), theme: f.theme, nearest_km: f.nearest_km })),
    evidence_features: evidenceOf(record).length, sources_checked: r.checked.length, not_checked: notChecked.map((c) => c.dataset).slice(0, 6), gaps: r.data_gaps.length,
    ...(r.parse_error ? { problem: r.parse_error } : {}),
    ...(r.replaces ? { replaces: { run: r.replaces.run, why: r.replaces.why, ...(r.replaces.diff ? { changed: r.replaces.diff.lines } : {}), ...(r.replaces.checks_changed ? { checks_changed: r.replaces.checks_changed } : {}) } } : {}),
    ...(r.checks ? { checks: K.checksSummary(r.checks).replace(/^Checks: /, "") } : {}),
    ...(r.site.role === "search_area" ? { site_is: `a search area: ${r.site.role_why}` } : {}),
  };
}

// What the conversation agent gets back from an area budget: names and numbers only.
export function budgetHeadline(record) {
  const r = record.tobler_run, b = r.budget;
  const nc = [...b.rows, ...b.soft].filter((x) => x.state === "not_checked").map((x) => `${x.label} (${x.why})`);
  const biggest = [...b.rows].sort((x, y) => y.ha - x.ha)[0];
  return {
    run: r.id, site: r.site.name, asset: `${b.asset_label}${b.asset_assumed ? " (assumed: no asset type given)" : ""}`,
    gross_ha: b.gross_ha, net_ha: b.net_ha, net_share: `${Math.round(b.net_share * 100)}%`, soft_ha: b.soft_ha,
    budget: budgetLines(b), ...(biggest?.ha > 0 ? { biggest_deduction: `${biggest.label}, ${biggest.ha} ha` } : {}),
    not_checked: nc, ...(b.changes.length ? { your_changes: b.changes } : {}),
    ...(b.unknown?.length ? { not_rules: b.unknown } : {}),
    ...(r.replaces ? { replaces: { run: r.replaces.run, why: r.replaces.why } } : {}),
  };
}

// The screening service the conversation's screen_site and get_run tools call. table: catalogue/assets.json;
// skill: the parsed NTR skill. onRun(record, place) shows the card; onEvent reports progress.
// skillFor(name): another parsed skill, for studies (the profile's skills_offered names each study's skill).
export function createScreening({ host, table, skill, skillFor = () => null, callClaude, model = "", onRun = () => {}, onEvent = () => {}, now }) {
  const runs = new Map();
  let n = 0;
  // Every new run of a skill on a place is linked to the last one, edited or not, and compared with it in code, so
  // the card and the reply can say what changed and why (plan item 1, 25 Nov: reruns changed with no explanation).
  // What the person brought in after the latest run of this kind on this place, and what that run carried over: a
  // re-run takes it all (deduplicated by layer).
  const carried = (place, kind) => {
    const old = [...runs.values()].reverse().find((o) => (o.tobler_run.kind || "ntr-screen") === kind && place.id != null && o.tobler_run.place_id === place.id);
    if (!old) return [];
    const r = old.tobler_run, seen = new Set();
    return [...(r.brought_in || []), ...(r.added || []).filter((a) => !a.not_checked)].filter((a) => a.atlas_id && !seen.has(a.atlas_id) && seen.add(a.atlas_id))
      .map((a) => ({ atlas_id: a.atlas_id, dataset: a.dataset, publisher: a.publisher, licence: a.licence, licence_full: a.licence_full, topic: a.topic, for: a.for }));
  };
  const linkPrevious = (record, place, i, kind) => {
    const old = (i.replaces ? runs.get(String(i.replaces).trim().toUpperCase()) : null)
      || [...runs.values()].reverse().find((o) => (o.tobler_run.kind || "ntr-screen") === kind && place.id != null && o.tobler_run.place_id === place.id && !o.tobler_run.replaced_by);
    if (!old || old === record) return;
    const ch = siteChange(old, place);
    const r = record.tobler_run;
    r.replaces = { run: old.tobler_run.id, why: ch ? `the site was edited after it ran (${ch.text})` : "run again on the same site" };
    // Which checks moved, line by line, for the card.
    if (r.checks) r.replaces.checks_changed = K.checksChanged(old.tobler_run.checks || [], r.checks);
    r.replaces.diff = runDiff(old, record, { siteChanged: ch?.text || null });
    old.tobler_run.replaced_by = r.id;
  };
  // After a screen or a study, the atlas is searched for what wasn't checked, and what it has is offered (plan item 1,
  // 26 Nov; js/bringin.js). A failed search is said, never hidden; it doesn't fail the run.
  const offer = async (record) => {
    onEvent({ type: "offer_start", run: record.tobler_run.id });
    const pats = host.trusted?.publishers?.patterns || [];
    try {
      record.tobler_run.offer = await offerFor(record, { atlas: host.atlas || null, catalogue: host.checks || {},
        allow: { esri: !!host.esriLicence?.(), nonCommercial: !!host.nonCommercial?.() }, trusted: pats.length ? new RegExp(pats.join("|"), "i") : null, ...(now ? { now } : {}) });
    } catch (e) {
      record.tobler_run.offer = { at: (now || (() => new Date().toISOString()))(), searched: [], items: [], nothing: [], failed: [], state: "none", error: String(e.message || e).slice(0, 160) };
    }
    onEvent({ type: "offer", run: record.tobler_run.id, offered: record.tobler_run.offer.items.length });
  };
  return {
    runs,
    offer,
    // An asset type's label ("solar farm"), from the asset table.
    assetLabel(id) { const tb = typeof table === "function" ? table() : table; return tb?.assets?.[id]?.label || null; },
    // The asset table itself, for reading what's planned from the person's words (js/assetwords.js).
    assetTable() { return typeof table === "function" ? table() : table; },
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
      if (!sk?.body || !tb?.assets) throw new Error("The screening method or the asset table hasn't loaded yet; try again in a moment.");
      const d0 = await R.describe(host.ref, place.feature);
      const assetId = ASSET_TYPES.includes(i.asset_type) && i.asset_type !== "other" ? i.asset_type : null;
      // Something the profile isn't built for (housing, a warehouse): screened at once as a general screen, and the
      // caveat travels with the run so the card and report say it, not only the chat (Rob, 22 Nov).
      const planned = !assetId && typeof i.planned === "string" && i.planned.trim() ? i.planned.replace(/\s+/g, " ").trim().slice(0, 60) : null;
      const num = (v) => (Number.isFinite(+v) && +v > 0 ? +v : null);
      const site = { asset_type: assetId, offshore: !!d0.offshore, capacity_mw: num(i.capacity_mw), tip_height_m: num(i.tip_height_m), area_km2: d0.area_km2 ?? null };
      const asset = chooseAsset(tb, { ...site, planned, countries: d0.countries || [] });
      const said = readDistances(distancesFromInputs(i), { catalogue: host.checks || {} });
      const id = `R${++n}`;
      // For the page's progress line: what's being screened, so it can say roughly how long it takes.
      onEvent({ type: "screen_start", run: id, site: place.name, setting: site.offshore ? "offshore" : "onshore",
        inside: i.extent === "inside" && /Polygon/.test(place.feature.geometry.type), wider_km: furthestFor(host.checks, asset, said) });
      const record = await runScreening({
        host, site: { name: place.name, feature: place.feature, origin: place.origin }, asset, said, skill: sk, callClaude, model, runId: id, onEvent, ...(now ? { now } : {}), broughtIn: carried(place, "ntr-screen"),
        inputs: { asset_type: assetId || "other", asset_label: assetId ? tb.assets[assetId].label : planned || "site of unknown type", asset_assumed: assetId ? !!i.assumed : !planned,
          ...(planned ? { outside_profile: host.profile?.()?.wording?.outside || OUTSIDE_PROFILE } : {}),
          stage: i.stage || "", capacity_mw: site.capacity_mw, tip_height_m: site.tip_height_m, focus: i.focus || "", extent: i.extent === "inside" ? "inside" : "around",
          ...(i.asset_from ? { asset_from: i.asset_from } : {}) },
      });
      if (i.extent === "inside" && !isArea(place.feature)) record.tobler_run.note_scope = "Inside only applies to areas, so this point or line was screened with its surroundings.";
      record.tobler_run.place_id = place.id ?? null;
      record.tobler_run.place_geometry_at_run = JSON.stringify(place.feature.geometry);
      // What was asked, so the run can be repeated as it was once the site is edited (js/outofdate.js).
      record.tobler_run.inputs = { asset_type: assetId || "other", assumed: assetId ? !!i.assumed : !planned, ...(planned ? { planned } : {}), ...(i.asset_from ? { asset_from: i.asset_from } : {}), stage: i.stage || "", focus: i.focus || "",
        ...(distancesFromInputs(i).length ? { distances: distancesFromInputs(i) } : {}) };
      // A re-run after the site was edited: which run it replaces, and why. From the card's re-run button (replaces),
      // or found here when the analyst screens a place again whose latest run is out of date.
      linkPrevious(record, place, i, "ntr-screen");
      await offer(record);
      runs.set(id, record);
      onRun(record, place);
      return headline(record);
    },
    // A study (the profile's skills_offered entry: the contamination desk study) on a place on land: only its checks,
    // at its own distances, then one judgement. It shares the run numbering, card, report and share link.
    async study(entry, place, i = {}) {
      const sk = skillFor(entry.skill);
      if (!sk?.body) throw new Error(`The ${entry.label.toLowerCase()} method hasn't loaded yet; try again in a moment.`);
      if (entry.kind === "budget") return this.budget(entry, sk, place, i);
      const d0 = await R.describe(host.ref, place.feature);
      if (entry.setting === "land" && d0.offshore) return { not_available: `The ${entry.label.toLowerCase()} is for sites on land, and ${place.name} is offshore. A constraints screen works at sea.` };
      // A study has no asset: it runs at its own scale (site scale for the desk study: records on and close to the site
      // matter most), each check to its own reach, with the person's distances if they gave any.
      const asset = { id: null, label: entry.label.toLowerCase(), row: false, setting: "onshore", scale: entry.scale || "local", footprint_km: 0.1, extends: [],
        scale_why: `the ${entry.label.toLowerCase()} looks at records on and close to the site, so each check uses its site-scale reach` };
      const said = readDistances(distancesFromInputs(i), { catalogue: host.checks || {} });
      const id = `R${++n}`;
      onEvent({ type: "screen_start", run: id, site: place.name, setting: "onshore", inside: false, wider_km: furthestFor(host.checks, asset, said, entry), study: entry.id });
      const record = await runScreening({
        host, site: { name: place.name, feature: place.feature, origin: place.origin }, asset, said, skill: sk, study: entry, callClaude, model, runId: id, onEvent, ...(now ? { now } : {}), broughtIn: carried(place, entry.id),
        inputs: { asset_type: "other", asset_label: entry.label.toLowerCase(), asset_assumed: false, stage: i.stage || "", focus: i.focus || "", extent: "around" },
      });
      record.tobler_run.place_id = place.id ?? null;
      record.tobler_run.place_geometry_at_run = JSON.stringify(place.feature.geometry);
      record.tobler_run.inputs = { study: entry.id, focus: i.focus || "", ...(distancesFromInputs(i).length ? { distances: distancesFromInputs(i) } : {}) };
      linkPrevious(record, place, i, entry.id);
      await offer(record);
      runs.set(id, record);
      onRun(record, place);
      return headline(record);
    },
    // The developable area (25 Nov): an area budget on an outline, from the skill's rules for the asset type and the
    // person's own changes. Its checks run as a study's do; then the area_budget tool, and no model call.
    async budget(entry, sk, place, i = {}) {
      const label = entry.label.toLowerCase();
      const role = placeRole(place.origin || {}, place.feature.geometry);
      if (!isArea(place.feature)) return { not_available: `The ${label} needs an outline, and ${place.name} is a ${place.feature.geometry.type === "Point" ? "point" : "line"}. Draw the site or bring in its boundary file.` };
      if (role.role === "search_area") return { not_available: `${place.name} is a search area (${role.why}), not the site's outline, so an area budget on it would read as fact. Draw the site or bring in its boundary file, then ask again.` };
      const d0 = await R.describe(host.ref, place.feature);
      if (d0.offshore) return { not_available: `The ${label} is for sites on land, and ${place.name} is offshore.` };
      const rules = budgetRules(sk);
      // The person's distances here are protection distances: a deduction's buffer, never how far anything looks.
      const said = readDistances(distancesFromInputs(i), { catalogue: host.checks || {}, deductions: rules.deductions, budget: true });
      // Protection distances from the asset table where a source gives one for this place (package D), by country
      // and, in the UK, nation on real outlines; otherwise the skill's first cuts. The person's own beat both.
      const tb = typeof table === "function" ? table() : table;
      const where = { countries: d0.countries || [], areas: (d0.countries || []).includes("United Kingdom") ? await ukAreasNear(host.ref, place.feature, d0, 0) : {} };
      const plan = resolveDeductions(rules, { ...i, buffers: said.protection.map((p) => ({ id: p.id, buffer_m: p.buffer_m })) }, { protection: tb?.protection, where });
      for (const p of said.protection) { const d = plan.deductions.find((x) => x.id === p.id); p.line = d?.changed ? `${p.label}: ${d.changed}` : `${p.label}: ${p.buffer_m} m (doesn't apply to a ${plan.asset_label})`; }
      const reachKm = Math.max(0.05, ...[...reachByCheck(plan.deductions).values()]);
      const asset = { id: plan.asset_type, label: plan.asset_label, row: true, setting: "onshore", scale: "local", footprint_km: 0.1, extends: [],
        scale_why: `each check looks only as far as its largest buffer for ${/^general/.test(plan.asset_label) ? "a general site" : `a ${plan.asset_label}`}: a feature further out can't touch the site` };
      const KIND_LABEL = { hard: "Can't build", buffer: "Keep clear", avoid: "Avoided by default", soft: "Soft constraints" };
      const groups = Object.entries(KIND_LABEL).map(([k, l]) => ({ id: k, label: l, checks: [...new Set(plan.deductions.filter((d) => d.kind === k).flatMap((d) => d.checks))] })).filter((g) => g.checks.length);
      const studyEntry = { ...entry, groups, budget: plan, full_study_adds: [] };
      const id = `R${++n}`;
      onEvent({ type: "screen_start", run: id, site: place.name, setting: "onshore", inside: false, wider_km: reachKm, study: entry.id });
      const record = await runScreening({
        host, site: { name: place.name, feature: place.feature, origin: place.origin }, asset, said, skill: sk, study: studyEntry, callClaude, model, runId: id, onEvent, ...(now ? { now } : {}),
        inputs: { asset_type: plan.asset_type, asset_label: plan.asset_label, asset_assumed: plan.asset_assumed, stage: "", extent: "around" },
      });
      record.tobler_run.place_id = place.id ?? null;
      record.tobler_run.place_geometry_at_run = JSON.stringify(place.feature.geometry);
      const keep = (v) => (Array.isArray(v) && v.length ? v : undefined);
      record.tobler_run.inputs = JSON.parse(JSON.stringify({ study: entry.id, asset_type: plan.asset_type, distances: keep(distancesFromInputs(i)), leave_out: keep(i.leave_out), as_soft: keep(i.as_soft) }));
      linkPrevious(record, place, i, entry.id);
      runs.set(id, record);
      onRun(record, place);
      return budgetHeadline(record);
    },
    getRun(id) {
      const rec = runs.get(String(id || "").trim().toUpperCase()) || [...runs.values()].at(-1);
      if (!rec) throw new Error("No screening runs yet in this conversation.");
      const r = rec.tobler_run;
      if (r.budget) return { ...budgetHeadline(rec), rows: [...r.budget.rows, ...r.budget.soft].map((x) => ({ label: x.label, kind: x.kind, state: x.state, ha: x.ha, buffer_m: x.buffer_m, reason: x.reason, ...(x.why ? { why: x.why } : {}) })),
        ...(r.replaced_by ? { replaced_by: `${r.replaced_by} (this run is out of date: the site was edited after it)` } : {}) };
      return {
        run: r.id, site: r.site.name, scope: r.extent === "inside" ? "inside the area only" : "the site and its surroundings", asset: r.site.asset_label, stage: r.site.stage, distances: runDistancesLine(r), ...(r.reach?.changes?.length ? { your_changes: r.reach.changes.map((c) => c.line) } : {}), assessed_within_km: r.assessed_within_km,
        ...(r.replaces ? { replaces: r.replaces } : {}), ...(r.replaced_by ? { replaced_by: `${r.replaced_by} (this run is out of date: the site was edited after it)` } : {}),
        ...(r.decision ? { decision: r.decision } : {}), ...(isRelevanceRun(r) ? { headline: headlineText(r.headline) } : {}),
        // A screen's flags carry their class and its line, set in code (package E), in place of a rating.
        flags: r.flags.map((f) => ({ id: f.id, risk: f.risk, theme: topicOf(f.theme), ...(f.relevance ? { relevance: f.relevance.class, where: relevanceLine(f.relevance, U.dist), source: sourceNote(f) } : { ...(f.severity ? { severity: f.severity } : {}), confidence: f.confidence }), why: f.why, ...(f.next_step ? { next_step: f.next_step } : {}),
          evidence: f.evidence.map((e) => ({ name: e.name, distance_km: e.distance_km, band: e.band, dataset: e.dataset, publisher: e.publisher, traced: e.traced })) })),
        checked: r.checked.map((c) => ({ dataset: c.dataset, publisher: c.publisher, result: c.result, ...(c.count ? { count: c.count } : {}), ...(c.why ? { why: c.why.slice(0, 160) } : {}) })),
        data_gaps: r.data_gaps,
        // In the reader's units with the metric value beside each distance: the agent quotes, never converts (package C).
        ...(r.checks ? { checks: r.checks.map((c) => `${c.label}${c.must ? " (must)" : ""}: ${K.checkLine(c, { units: U.getUnits(), both: true })}`) } : {}),
        ...(r.sea ? { sea: seaLines(r.sea) } : {}),
        ...(r.elevation ? { elevation: elevationLine(r.elevation, r.elevation.significance) } : {}),
        ...(r.offer?.items?.length ? { offered_after_run: r.offer.items.map((x) => ({ id: x.id, for: x.label, dataset: x.dataset.title, publisher: x.dataset.publisher, licence: x.dataset.licence_short, state: x.state })) } : {}),
        ...(r.offer?.nothing?.length ? { atlas_had_nothing_for: r.offer.nothing } : {}),
        ...(r.added?.length ? { brought_in_after_run: r.added } : {}),
      };
    },
  };
}

// UK nations and councils near the site, on their real outlines (js/ukareas.js), out to the furthest reach any check
// could use in this run (reachMax). Only near the UK (a loose box narrows it; the outlines decide). {} far from the
// UK; null if the outlines couldn't be loaded, and then every nation's layers are asked (js/checks.js touches).
const UK_WINDOW = [-14, 49, 3.5, 61.5];
async function ukAreasNear(ref, feature, describe, reachMax) {
  const sb = turf.bbox(feature);
  const g = K.growBox(sb, reachMax);
  const near = !(g[2] < UK_WINDOW[0] || g[0] > UK_WINDOW[2] || g[3] < UK_WINDOW[1] || g[1] > UK_WINDOW[3]);
  if (!near) return {};
  try {
    const fc = await ref.get("uk-areas");
    return areasNear(fc, feature, reachMax, { onLand: !describe.offshore && (describe.countries || []).includes("United Kingdom") });
  } catch { return null; }
}

// The furthest any check could look in a run, before it's planned: for the page's progress line.
function furthestFor(catalogue, asset, said, study = null) {
  const only = study ? new Set(study.groups.flatMap((g) => g.checks)) : null;
  const m = resolveReaches(catalogue || {}, { scale: asset.scale, asset, search: said?.search || [] });
  return Math.min(MAX_KM, Math.max(0, ...[...m].filter(([id]) => !only || only.has(id)).map(([, r]) => r.km)));
}
