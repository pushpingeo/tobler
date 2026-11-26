// Tests for sealed NTR runs, the run record, the slider helpers, re-assessment and scale-aware distances.
// Atlas and model are faked; the site is a 10 km square field west of Shetland (Rosebank-like).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { createPlaceTools } from "../js/placetools.js";
import { parseSkill } from "../js/converse.js";
import { chooseAsset, readDistances, runBand, runDistancesLine, ladderBand, runRings } from "../js/reach.js";
import { runScreening, createScreening, evidenceWithin, nearestByTheme, flagBeyond, reassess, parseResult, traceFlags, traceResult, notRaisedGap, footprintOf, headline, RUN_SCHEMA } from "../js/ntrrun.js";
import * as G from "../js/geometry.js";
import { siteChange, rerunInput, runLines, outOfDateText } from "../js/outofdate.js";
import * as K from "../js/checks.js";
import { laeaInverse } from "../js/areabudget.js";
import { budgetRules, resolveDeductions, classMatches } from "../js/developable.js";
import { BUDGET_RULE_IDS, BUDGET_ASSETS } from "../js/placetools.js";
import { finishTurn } from "../js/runreply.js";
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const table = JSON.parse(read("../catalogue/assets.json"));
const trusted = JSON.parse(read("../catalogue/trusted.json"));
const checksCat = JSON.parse(read("../catalogue/checks.json"));
const BASELINE_IDS = new Set(checksCat.checks.flatMap((c) => c.sources.map((s) => s.atlas_id)).filter(Boolean));
const skill = parseSkill(read("../skills/ntr-screening/SKILL.md"));
const ref = R.createReference(async (n) => JSON.parse(read(`../data/ref/${n}.json`)));

const FIELD = [-3.95, 60.98];
const square = G.squareAround(FIELD, 100, 0); // 10 km square
const east = (km) => turf.destination(FIELD, 5 + km, 90).geometry.coordinates;

// Fake atlas: pipelines (one inside, one 1.5 km out, one 30 km out), wrecks (2 km and 45 km), a failing heritage layer.
const atlasCalls = [];
async function atlas(tool, args) {
  atlasCalls.push([tool, args]);
  if (tool === "find_datasets" && /pipeline/i.test(args.text || "")) return { matches: 1, results: [{ id: "pipe", title: "UKCS pipelines (WGS84)", publisher: "North Sea Transition Authority", capabilities: ["query"], licence: "NSTA Open User Licence" }] };
  if (tool === "find_datasets" && /wreck/i.test(args.text || "")) return { matches: 2, results: [
    { id: "wreck", title: "Worldwide wreck locations (UK Hydrographic Office)", publisher: "EMODnet Human Activities", capabilities: ["query"], licence: "Creative Commons CC-BY 4.0" },
    { id: "broken", title: "Heritage Ship Wrecks", publisher: "EMODnet Human Activities", capabilities: ["query"], licence: "Creative Commons CC-BY 4.0" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  // Crown Estate Scotland's pipelines layer is the subsea pipelines check's source: the same lines, so a screen run from
  // the conversation (no layers brought in) still has pipelines to judge.
  if (tool === "fetch_features" && (args.id === "pipe" || args.id === "c026fa004eab396c")) {
    const line = (a, b, name) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, b] }, properties: { PIPE_NAME: name, Lease_Description: name } });
    return { returned: 3, features: [
      line(FIELD, turf.destination(FIELD, 2, 0).geometry.coordinates, "Rosebank 9 inch Production flowline 1"),
      line(east(1.5), turf.destination(east(1.5), 2, 0).geometry.coordinates, "West of Shetland Pipeline"),
      line(east(30), turf.destination(east(30), 2, 0).geometry.coordinates, "Clair export"),
    ] };
  }
  if (tool === "fetch_features" && args.id === "wreck") return { returned: 2, features: [
    { type: "Feature", geometry: { type: "Point", coordinates: east(2) }, properties: { name: "TROLDFOS (POSSIBLY)", date_sunk: "19170418" } },
    { type: "Feature", geometry: { type: "Point", coordinates: east(45) }, properties: { name: "FAR WRECK" } },
  ] };
  if (tool === "fetch_features" && args.id === "broken") throw new Error("atlas: fetch failed");
  // Boundaries: a Faroe–UK treaty line 12 km west of the field, and one far away (an antimeridian line the box query
  // also returns). Baseline layers: one protected area 20 km north; the others answer empty.
  if (tool === "fetch_features" && args.id === "9760b5061ea298eb") return { returned: 2, features: [
    { type: "Feature", geometry: { type: "LineString", coordinates: [turf.destination(FIELD, 17, -90).geometry.coordinates, turf.destination(turf.destination(FIELD, 17, -90), 30, 0).geometry.coordinates] },
      properties: { line_name: "Faeroe (Denmark) - United Kingdom", line_type: "Treaty", territory1: "Faeroe", sovereign1: "Denmark", territory2: "United Kingdom", sovereign2: "United Kingdom" } },
    { type: "Feature", geometry: { type: "LineString", coordinates: [[179, 65], [-179, 66]] }, properties: { line_name: "Russia - Alaska (United States)", line_type: "Treaty" } }] };
  if (tool === "fetch_features" && args.id === "154dfce48e32f9ee") return { returned: 1, features: [
    { type: "Feature", geometry: turf.circle(turf.destination(FIELD, 28, 0).geometry.coordinates, 3).geometry, properties: { name: "Faroe-Shetland Sponge Belt", desig_eng: "Nature Conservation Marine Protected Area" } }] };
  // MARPOL's "North West European waters": a wide area the field lies within (around the site, not on it).
  if (tool === "fetch_features" && args.id === "751ddc65885f897d") return { returned: 1, features: [
    { type: "Feature", geometry: turf.bboxPolygon([-15, 48, 10, 64]).geometry, properties: { name: "North West European waters" } }] };
  // UK sites: JNCC's offshore layer holds SACs and MPAs together; NatureScot's SAC layer has the same SAC under its
  // own code field, so the check counts it once.
  const wyville = turf.circle(turf.destination(FIELD, 40, -60).geometry.coordinates, 8).geometry;
  if (tool === "fetch_features" && args.id === "1d6371b702df0abc") return { returned: 2, features: [
    { type: "Feature", geometry: wyville, properties: { SITE_NAME: "Wyville Thomson Ridge", SITE_CODE: "UK0030354", SITE_STATU: "SAC" } },
    { type: "Feature", geometry: turf.circle(turf.destination(FIELD, 28, 0).geometry.coordinates, 3).geometry, properties: { SITE_NAME: "Faroe-Shetland Sponge Belt", SITE_CODE: "UKNCMPA015", SITE_STATU: "NCMPA" } }] };
  if (tool === "fetch_features" && args.id === "7d382e1686a08bff") return { returned: 1, features: [
    { type: "Feature", geometry: wyville, properties: { NAME: "Wyville Thomson Ridge", PA_CODE: "UK0030354" } }] };
  if (tool === "fetch_features" && BASELINE_IDS.has(args.id)) return { returned: 0, features: [] };
  throw new Error(`unexpected ${tool} ${JSON.stringify(args)}`);
}
const host = (nonCommercial = true) => ({ ref, anchors: [], headers: {}, atlas, firms: null, trusted, checks: checksCat, esriLicence: () => false, nonCommercial: () => nonCommercial, fetchFn: async () => ({ ok: true, json: async () => [] }), places: () => [], findPlace: () => null, skillText: () => "" });

// Flags cite evidence by id (25 Nov). In a scripted run the ids come from what the run showed the model: refIn finds
// a feature's id by name in the messages so far (a tool result's "ref", or "E7 Name" in the checks' lines).
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function refIn(req, name) {
  const texts = (req?.messages || []).flatMap((m) => (typeof m.content === "string" ? [m.content] : m.content.flatMap((b) => (b.type === "tool_result" ? [String(b.content)] : b.type === "text" ? [b.text] : []))));
  for (const t of texts) {
    const m = t.match(new RegExp(`"ref":"(E\\d+)"[^{}]*?"name":"${esc(name)}"`, "i")) || t.match(new RegExp(`\\b(E\\d+) ${esc(name)} `, "i"));
    if (m) return m[1];
  }
  return name;
}
const RESULT = (extra = "", ref = (n) => n) => `Rosebank screened as an offshore oil field (assumed greenfield).

\`\`\`json
{"site":{"place":"Area 1"},"distances_km":{"near":2,"close":10,"wider":50},
 "flags":[
  {"risk":"Wreck close to the field could need a survey and avoidance zone","theme":"PS8","confidence":"medium","why":"heritage and safety",
   "evidence":["${ref("TROLDFOS (POSSIBLY)")}"]},
  {"risk":"Existing pipelines on and near site (simultaneous operations)","theme":"PS4","confidence":"high","why":"SIMOPS",
   "evidence":["${ref("Rosebank 9 inch Production flowline 1")}","${ref("West of Shetland Pipeline")}"]},
  {"risk":"Seabird colonies on Shetland may be in spill reach","theme":"PS6","confidence":"low","why":"regional knowledge",
   "evidence":["Foula seabird colony (regional knowledge)"]}${extra}
 ],
 "checked":[],"data_gaps":["Key Biodiversity Areas not checked","Heritage Ship Wrecks not checked (service failed)"]}
\`\`\``;

// A scripted model: find data, then fetch (asking for less than the wider band, which the run overrides), then answer.
function scriptedModel(script) {
  const calls = [];
  let i = 0;
  const fn = async (req) => {
    calls.push(req);
    const step = script[Math.min(i++, script.length - 1)];
    return typeof step === "function" ? step(req) : step;
  };
  fn.calls = calls;
  return fn;
}
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const toolTurn = (...uses) => ({ stop_reason: "tool_use", content: uses, usage: { input_tokens: 1000, output_tokens: 50 } });
const final = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 2000, output_tokens: 400 } });
// Since 26 Nov the screen's analyst has no tools: the pipelines, wrecks and the failing wreck layer come in as layers
// the person brought in after an earlier run (the same fetches the analyst used to make), and one call judges them.
const standardScript = () => scriptedModel([(req) => final(RESULT("", (n) => refIn(req, n)))]);
const BROUGHT = [
  { atlas_id: "pipe", dataset: "UKCS pipelines (WGS84)", publisher: "North Sea Transition Authority", licence: "NSTA Open User Licence", topic: "community-health", for: "Pipelines" },
  { atlas_id: "wreck", dataset: "Worldwide wreck locations (UK Hydrographic Office)", publisher: "EMODnet Human Activities", licence: "Creative Commons CC-BY 4.0", topic: "heritage", for: "Shipwrecks" },
  { atlas_id: "broken", dataset: "Heritage Ship Wrecks", publisher: "EMODnet Human Activities", licence: "Creative Commons CC-BY 4.0", topic: "heritage", for: "Shipwrecks" },
];
const site = { name: "Area 1", feature: square, origin: { method: "words", words: "Rosebank", confidence: "high", match: "name_and_type", shape: "feature", anchor: { name: "Rosebank", source: { title: "UKCS offshore hydrocarbon fields (WGS84)", publisher: "North Sea Transition Authority", licence: "not stated" } } } };

await test("the asset for a run: offshore oil field at global scale, with the reason and its footprint (reach tests: test/reach.test.mjs)", () => {
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  assert.equal(d.scale, "global");
  assert.equal(d.footprint_km, 5);
  assert.match(d.scale_why, /offshore oil or gas field offshore/);
  assert.equal(d.row, true);
});

await test("bands: one ladder, and old runs keep theirs", () => {
  assert.deepEqual([0, 0.05, 1.9, 7, 49, 51].map((k) => ladderBand(k, 50)), ["on site", "0–100 m", "1–2 km", "5–10 km", "30–50 km", "beyond"]);
  const old = { distances: { near: 2, close: 10, wider: 50 } };
  assert.deepEqual([0, 1.9, 2, 7, 49, 51].map((k) => runBand(k, old)), ["on site", "near", "near", "close", "wider", "beyond"]);
});

await test("parseResult takes the last JSON block and keeps the summary above it", () => {
  const p = parseResult(RESULT());
  assert.equal(p.json.flags.length, 3);
  assert.match(p.summary, /^Rosebank screened/);
  assert.equal(parseResult("no json here").json, null);
});

let record;
await test("sealed run: each check to its own reach, brought-in layers to the furthest, records evidence with provenance, traces flags, reports what failed", async () => {
  atlasCalls.length = 0;
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  record = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: model, model: "claude-haiku-5-5", runId: "R1",
    inputs: { asset_type: "oil-gas-field", asset_label: "offshore oil or gas field", asset_assumed: true }, now: () => "2026-11-18T05:00:00Z" });
  // The brought-in layers are fetched to the furthest any check looks (50 km here).
  const fetches = atlasCalls.filter(([t]) => t === "fetch_features");
  // Layers brought in go out to the wider band, for the slider; the checks fetch only to their own reach
  // (24 Nov: a busy layer fetched wide undercounted what was in reach), up to 500 features.
  assert.ok(fetches.filter(([, x]) => BASELINE_IDS.has(x.id)).every(([, x]) => x.limit === 500));
  for (const [, a] of fetches.filter(([, x]) => !BASELINE_IDS.has(x.id))) {
    const [w, , e] = a.bbox;
    assert.ok(turf.distance([w, FIELD[1]], [e, FIELD[1]]) > 100 + 10, `bbox wide enough: ${a.bbox}`);
  }
  const r = record.tobler_run;
  assert.equal(record.type, "FeatureCollection");
  assert.equal(r.schema, RUN_SCHEMA);
  assert.equal(r.skill.version, skill.version);
  assert.equal(r.site.confidence, "high");
  assert.equal(r.site.anchor_source.publisher, "North Sea Transition Authority");
  assert.equal(r.fetched_to_km, 50);
  // Evidence: 3 pipelines (inside, 1.5, 30 km) + 2 wrecks (2, 45 km), kept to 50 km for the slider, plus the baseline:
  // the Faroe–UK boundary (12 km), a protected area (20 km) and MARPOL's North West European waters, which the field
  // lies within: "around the site", not "on site". The UK layers add a SAC (from NatureScot and from JNCC) and the
  // Sponge Belt again from JNCC: evidence keeps each source's feature (provenance); the checks count each site once.
  // The subsea pipelines check (Crown Estate Scotland, to 10 km) adds the two near lines again, under its own source.
  const ev = record.features.filter((f) => f.properties.role === "evidence");
  assert.equal(ev.length, 13, ev.map((f) => `${f.properties.name} ${f.properties.distance_km}`).join("; "));
  const nwe = ev.find((f) => f.properties.name === "North West European waters").properties;
  assert.equal(nwe.band, "around the site");
  assert.equal(nwe.surrounds, true);
  assert.ok(nwe.area_km2 > 1000);
  assert.match(model.calls[0].messages[0].content, /North West European waters \(a wide area it lies within\)/);
  assert.match(model.calls[0].system, /around_site/);
  for (const f of ev) for (const k of ["fid", "dataset", "publisher", "licence", "checked_at", "theme", "band", "distance_km"]) assert.ok(f.properties[k] != null && f.properties[k] !== "", `${k} on ${f.properties.name}`);
  assert.equal(ev.find((f) => /TROLDFOS/i.test(f.properties.name)).properties.theme, "heritage");
  assert.equal(ev.find((f) => /flowline/.test(f.properties.name)).properties.band, "on site");
  assert.equal(record.features[0].properties.role, "site");
  // Flags: sorted by confidence; evidence cited by id, filled in from the run's features; the regional-knowledge
  // flag cites nothing the run holds, so it isn't raised: it's a gap, with what it cited (25 Nov).
  assert.deepEqual(r.flags.map((f) => f.confidence), ["high", "medium"]);
  assert.equal(r.flags[0].theme, "community-health");
  assert.equal(r.flags[0].traced, 2);
  assert.equal(r.flags[0].evidence[0].name, "Rosebank 9 inch Production flowline 1");
  assert.equal(r.flags[0].evidence[0].distance_km, 0);
  assert.equal(r.flags[0].evidence[1].band, "1–2 km");
  // The analyst cited the check's copy of the line (it comes first in its brief): Crown Estate Scotland's.
  assert.equal(r.flags[0].evidence[1].publisher, "Crown Estate Scotland");
  assert.match(r.flags[0].evidence[1].licence, /Open Government/);
  assert.match(model.calls.at(-1).messages[0].content, /Brought in by the person after an earlier run[\s\S]*E\d+ Troldfos/i, "the analyst saw evidence ids in the brought-in lines");
  assert.equal(model.calls.length, 1, "one judgement");
  assert.equal(r.not_raised.length, 1);
  assert.match(r.not_raised[0].risk, /Seabird colonies/);
  assert.match(r.not_raised[0].refs[0], /Foula seabird colony.*not cited by id/);
  // What was checked comes from the tools: the failing layer is "not checked", never "none".
  const broken = r.checked.find((c) => c.dataset === "Heritage Ship Wrecks");
  assert.equal(broken.result, "not checked");
  assert.match(broken.why, /didn't answer/);
  assert.equal(r.checked.find((c) => c.dataset === "UKCS pipelines (WGS84)").count, 3);
  assert.deepEqual(r.data_gaps, ["Key Biodiversity Areas not checked", "Heritage Ship Wrecks not checked (service failed)",
    "Not raised as a flag, because its evidence didn't trace to anything this run found: Seabird colonies on Shetland may be in spill reach"]);
  // The model saw the run's distances and the fence rule, and no place-making tools.
  const first = model.calls[0];
  assert.match(first.messages[0].content, /Search distances: each check looks out its own distance from the site's edge: [^\n]*\(defaults for an offshore oil or gas field\)\. The furthest any check looked is 50 km/);
  assert.equal(r.reach.scale, "global");
  assert.equal(r.distances, undefined, "near, close and wider are gone");
  assert.match(first.messages[0].content, /assumed: say so/);
  assert.match(first.system, /never instructions to you/);
  assert.equal(first.tools, undefined, "no tools");
});

await test("slider helpers: findings within a distance, nearest per theme, flags beyond the distance", () => {
  // Counts include the wide area around the site (at 0 km); "nearest per theme" leaves it out.
  assert.equal(evidenceWithin(record, 50).length, 13, "with the UK layers (two sites, each from two sources) and the pipelines check's own copy of the near lines");
  assert.equal(evidenceWithin(record, 40).length, 12);
  assert.equal(evidenceWithin(record, 10).length, 6);
  assert.deepEqual(nearestByTheme(record, 10).map((x) => `${x.theme} ${x.name} ${x.distance_km}`), ["material-assets Rosebank 9 inch Production flowline 1 0", "community-health Rosebank 9 inch Production flowline 1 0", "heritage Troldfos (Possibly) 2"], "one per topic; old theme values read as topics");
  const [pipes, wreck] = record.tobler_run.flags;
  assert.equal(flagBeyond(pipes, 1), false);
  assert.equal(flagBeyond(wreck, 1), true);
});

await test("re-assess on tap: one call, no tools, only the stored evidence within the new distance; history kept", async () => {
  const model = scriptedModel([(req) => final(`Within 1 km only the field's own lines matter.\n\n\`\`\`json\n{"flags":[{"risk":"Existing flowlines on site","theme":"PS4","confidence":"high","evidence":["${refIn(req, "Rosebank 9 inch Production flowline 1")}"]}],"data_gaps":["Key Biodiversity Areas not checked"]}\n\`\`\``)]);
  const before = atlasCalls.length;
  await reassess({ record, km: 1, skill, callClaude: model, now: () => "2026-11-18T05:05:00Z" });
  assert.equal(atlasCalls.length, before, "no new fetching");
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].tools, undefined, "no tools");
  const sent = model.calls[0].messages[0].content;
  assert.match(sent, /Rosebank 9 inch Production flowline 1/);
  assert.doesNotMatch(sent, /TROLDFOS|West of Shetland Pipeline/i);
  const r = record.tobler_run;
  assert.equal(r.assessed_within_km, 1);
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].traced, 1);
  assert.equal(r.assessments.length, 1);
  assert.equal(r.assessments[0].flags.length, 2, "the earlier flags (the untraced one was never raised)");
  assert.equal(r.reach.furthest_km, 50, "each check's reach is kept: the slider only changes what the flags are written for");
  assert.match(sent, /Distances now: findings within 1 km of the site's edge/);
  assert.equal(r.fetched_to_km, 50, "the slider can still go back out to 50 km");
});

await test("a point site is screened as a footprint circle, and the run says so", () => {
  const d = chooseAsset(table, { asset_type: "platform", offshore: true });
  const fp = footprintOf(turf.point(FIELD), d);
  assert.equal(fp.feature.geometry.type, "Polygon");
  assert.ok(Math.abs(turf.area(fp.feature) / 1e6 - Math.PI * 0.25) < 0.02);
  assert.match(fp.note, /0.5 km footprint/);
});

await test("screen_site from the conversation: needs a place, runs sealed, returns the headline, get_run gives detail", async () => {
  const h = host();
  const list = [{ name: "Area 1", feature: square, origin: site.origin, status: "accepted", edits: [] }];
  h.places = () => list;
  h.findPlace = (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase());
  const shown = [];
  h.screening = createScreening({ host: h, table, skill, callClaude: standardScript(), onRun: (rec) => shown.push(rec) });
  const t = createPlaceTools(h);
  await assert.rejects(t.exec("screen_site", { place: "Area 9", asset_type: "oil-gas-field" }), /No place called "Area 9"/);
  const out = await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field", assumed: true });
  assert.equal(out.run, "R1");
  // Run from the conversation, with nothing brought in: the pipelines come from their check; the wreck the result cites
  // was never fetched, so that flag isn't raised.
  assert.equal(out.flags, 1);
  assert.deepEqual(out.by_confidence, { high: 1, medium: 0, low: 0 });
  assert.match(out.distances, /each check looks out its own distance/);
  assert.equal(out.asset, "offshore oil or gas field (assumed)");
  assert.ok(shown[0].tobler_run.not_raised.some((n) => /wreck/i.test(n.risk)));
  assert.ok(!JSON.stringify(out).includes("coordinates"), "no geometry to the conversation");
  assert.equal(shown.length, 1);
  const g = await t.exec("get_run", {});
  assert.equal(g.run, "R1");
  assert.equal(g.flags[0].evidence[0].traced, true);
  assert.equal(g.flags[0].theme, "community-health", "PS codes from the IFC skill read as topics");
});

await test("outside the profile (housing): screened at once as a general screen; the caveat is in the run, the analyst's brief and a re-run", async () => {
  const h = host();
  const p = { id: "p1", name: "Area 1", feature: square, origin: site.origin, status: "accepted", edits: [] };
  h.places = () => [p];
  h.findPlace = (n) => (String(n).toLowerCase() === "area 1" ? p : null);
  h.profile = () => ({ id: "energy", wording: { outside: "A general screen: built for environmental and energy sites." } });
  const shown = [], firsts = [];
  const script = standardScript();
  h.screening = createScreening({ host: h, table, skill, callClaude: (req) => { if (req.messages.length === 1) firsts.push(String(req.messages[0].content)); return script(req); }, onRun: (rec) => shown.push(rec) });
  const t = createPlaceTools(h);
  const out = await t.exec("screen_site", { place: "Area 1", asset_type: "other", planned: "  housing   estate " });
  assert.equal(out.asset, "housing estate");
  const r = shown[0].tobler_run;
  assert.equal(r.site.asset_label, "housing estate");
  assert.equal(r.site.asset_assumed, false, "the person said what's planned");
  assert.equal(r.site.outside_profile, "A general screen: built for environmental and energy sites.");
  assert.equal(r.inputs.planned, "housing estate");
  assert.match(firsts[0], /outside what the method was built for/);
  assert.equal(rerunInput(shown[0]).planned, "housing estate", "a re-run keeps it");
  // A general screen with nothing planned stays as before: no caveat.
  await t.exec("screen_site", { place: "Area 1", asset_type: "other" });
  assert.equal(shown[1].tobler_run.site.outside_profile, undefined);
  assert.equal(shown[1].tobler_run.site.asset_label, "site of unknown type");
});

await test("a rerun on an unchanged site is linked to the run before and says what changed (25 Nov)", async () => {
  const h = host();
  const p = { id: "p1", name: "Area 1", feature: square, origin: site.origin, status: "accepted", edits: [] };
  h.places = () => [p];
  h.findPlace = (n) => (String(n).toLowerCase() === "area 1" ? p : null);
  const shown = [];
  let model = standardScript();
  h.screening = createScreening({ host: h, table, skill, callClaude: (...a) => model(...a), onRun: (rec) => shown.push(rec) });
  const t = createPlaceTools(h);
  await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field" });
  model = standardScript();
  const head = await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field" });
  const r2 = shown[1].tobler_run;
  assert.equal(r2.replaces.run, "R1");
  assert.equal(r2.replaces.why, "run again on the same site");
  assert.deepEqual(r2.replaces.diff.lines, ["Nothing changed: same request, same checks, same result."]);
  assert.deepEqual(head.replaces.changed, r2.replaces.diff.lines);
  assert.equal(shown[0].tobler_run.replaced_by, "R2");
  // A different skill on the same place isn't compared with the screen.
  assert.equal(shown.length, 2);
});

await test("out-of-date runs: a re-run records its inputs and replaces the run made before the site was edited", async () => {
  const h = host();
  const p = { id: "p1", name: "Area 1", feature: square, origin: site.origin, status: "accepted", edits: [] };
  h.places = () => [p];
  h.findPlace = (n) => (String(n).toLowerCase() === "area 1" ? p : null);
  const shown = [];
  let model = standardScript(); // a fresh script for each screen
  h.screening = createScreening({ host: h, table, skill, callClaude: (...a) => model(...a), onRun: (rec) => shown.push(rec) });
  const t = createPlaceTools(h);
  await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field", stage: "appraisal", distances: [{ what: "heritage", value: 2, unit: "km" }] });
  const r1 = shown[0];
  assert.equal(r1.tobler_run.place_id, "p1");
  assert.deepEqual(r1.tobler_run.inputs, { asset_type: "oil-gas-field", assumed: false, stage: "appraisal", focus: "", distances: [{ what: "heritage", value: 2, unit: "km" }] });
  assert.equal(siteChange(r1, p), null, "unchanged site: still current");
  // The person drags the square 2 km north: the run is out of date and says what changed.
  p.feature = G.roundCoords(G.move(square, 2, 0));
  const ch = siteChange(r1, p);
  assert.match(ch.text, /moved 2 km north/);
  const input = rerunInput(r1);
  assert.deepEqual(input, { asset_type: "oil-gas-field", stage: "appraisal", distances: [{ what: "heritage", value: 2, unit: "km" }], replaces: "R1" });
  model = standardScript();
  const head = await h.screening.screen(input, p);
  assert.equal(head.run, "R2");
  assert.equal(head.replaces.run, "R1");
  assert.match(head.replaces.why, /^the site was edited after it ran \(moved 2 km north/);
  assert.equal(r1.tobler_run.replaced_by, "R2");
  assert.equal(shown[1].tobler_run.replaces.run, "R1");
  // Which checks moved: the square moved 2 km north, so the WDPA sponge belt is 2 km nearer.
  assert.ok(Array.isArray(shown[1].tobler_run.replaces.checks_changed));
  assert.ok(shown[1].tobler_run.replaces.checks_changed.some((l) => /^Marine and coastal protected areas: .* → .*Faroe-Shetland Sponge Belt/.test(l)), JSON.stringify(shown[1].tobler_run.replaces.checks_changed));
  assert.ok(head.replaces.checks_changed.some((l) => /^Marine and coastal protected areas: /.test(l)), "the headline carries which checks changed, as data");
  assert.equal(siteChange(shown[1], p), null, "the new run is current");
  assert.match((await t.exec("get_run", { run: "R1" })).replaced_by, /^R2/);
  // The analyst screening an edited place itself (no replaces given) links the runs too.
  p.feature = G.roundCoords(G.move(p.feature, 1, 90));
  model = standardScript();
  await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field" });
  assert.equal(shown[2].tobler_run.replaces.run, "R2");
  assert.equal(shown[1].tobler_run.replaced_by, "R3");
  // Lines for the project summary.
  const lines = runLines(shown.map((record) => ({ record, change: siteChange(record, p), replacedBy: record.tobler_run.replaced_by })));
  assert.match(lines[0], /R1: Area 1.*\(replaced by R2\)/);
  assert.match(lines[2], /R3: .*replaces R2 \(current\)/);
});

await test("out-of-date runs: undoing the edit clears it, a deleted site says so, and the share link carries it", async () => {
  const p = { id: "p1", feature: square };
  const rec = { type: "FeatureCollection", features: [], tobler_run: { id: "R1", place_geometry_at_run: JSON.stringify(square.geometry) } };
  assert.equal(siteChange(rec, p), null);
  const moved = { id: "p1", feature: G.roundCoords(G.move(square, 0.5, 90)) };
  assert.ok(siteChange(rec, moved));
  // Back where it was (to the 7-decimal rounding edits use): current again.
  assert.equal(siteChange(rec, { id: "p1", feature: G.roundCoords(square) }), null);
  const gone = siteChange(rec, null);
  assert.equal(gone.deleted, true);
  assert.match(outOfDateText(gone), /deleted after this screen/);
  assert.match(outOfDateText({ text: "area 3 → 3.4 km²" }), /^Out of date: the site was edited after this screen \(area 3 → 3.4 km²\)/);
  assert.match(outOfDateText({ text: "x" }, { replacedBy: "R2" }), /^Replaced by R2/);
  // A run made before inputs were recorded still re-runs from its site fields.
  assert.deepEqual(rerunInput({ tobler_run: { id: "R4", extent: "inside", site: { asset_type: "solar", asset_assumed: false, capacity_mw: 20, tip_height_m: null } } }),
    { asset_type: "solar", capacity_mw: 20, extent: "inside", replaces: "R4" });
  const { slimRun } = await import("../js/share.js");
  const full = { type: "FeatureCollection", features: [{ type: "Feature", geometry: square.geometry, properties: { role: "site" } }],
    tobler_run: { id: "R1", site: {}, flags: [], checked: [], data_gaps: [], out_of_date: { change: "moved 1 km east" }, replaces: { run: "R0", why: "x" } } };
  const slim = slimRun(full).tobler_run;
  assert.equal(slim.out_of_date.change, "moved 1 km east");
  assert.equal(slim.replaces.run, "R0");
});

await test("a sealed run has no tools to call, and a missing JSON block is reported, not hidden", async () => {
  // A model that tries a tool anyway gets nothing run: no tools are offered and none is carried out.
  const model = scriptedModel([toolTurn(use("x", "make_place", { anchor: "Area 1", shape: "circle", radius_km: 5, words: "x", match: "none", reason: "x" })), final("I looked but couldn't finish.")]);
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const h = host();
  let added = 0;
  h.addPlace = () => { added++; };
  const rec = await runScreening({ host: h, site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  assert.equal(added, 0);
  assert.ok(model.calls.every((c) => !c.tools), "no call offers tools, the repairs included");
  assert.equal(rec.tobler_run.flags.length, 0);
  assert.match(rec.tobler_run.parse_error, /no readable JSON/);
  assert.match(headline(rec).problem, /no readable JSON/);
});

// One evidence feature, E1, 3 km away, and one check of each state, for the unit tests of tracing.
const EV1 = [{ type: "Feature", properties: { role: "evidence", fid: "E1", name: "Loch Fleet SAC", distance_km: 3, dataset: "Special Areas of Conservation", publisher: "NatureScot", licence: "OGL", checked_at: "t" } }];
const CHK = [
  { id: "land.alc", label: "Agricultural land class", answer: "classes", state: "found", classes: [{ label: "Grade 2", on_site: true, coverage: 0.6 }], source: { dataset: "ALC", publisher: "Natural England", licence: "OGL", checked_at: "t" } },
  { id: "bio.sac", label: "Special Areas of Conservation", answer: "count_by_band", state: "none", reach_km: 5 },
  { id: "water.flood-zones", label: "Flood zones", answer: "classes", state: "not_checked", why: "didn't answer" },
];
const D20 = { near: 1, close: 5, wider: 20 };

await test("traceFlags reads a flag's topic (the skill since 24 Nov), and keeps PS codes and old themes readable", () => {
  const f = traceFlags([{ risk: "a", topic: "water", confidence: "high", evidence: ["E1"] }, { risk: "b", theme: "PS8", confidence: "high", evidence: ["E1"] },
    { risk: "c", theme: "land", confidence: "high", evidence: ["E1"] }, { risk: "d", topic: "made-up", confidence: "high", evidence: ["E1"] }], EV1, D20);
  assert.deepEqual(f.map((x) => `${x.risk} ${x.theme}`).sort(), ["a water", "b heritage", "c land-use", "d context"]);
});

await test("evidence by id: code fills in names, distances and sources; a flag with nothing traced isn't raised (25 Nov)", () => {
  const { flags, not_raised } = traceResult([
    { risk: "SAC nearby", theme: "PS6", confidence: "medium", evidence: ["E1", "E99", { name: "Nowhere", distance_km: 0.2 }] },
    { risk: "Prime farmland", topic: "land-use", confidence: "high", evidence: ["[land.alc]"] },
    { risk: "Floods", topic: "water", confidence: "high", evidence: ["water.flood-zones", "bio.sac"] },
    { risk: "Wind farms nearby", topic: "landscape-visual", confidence: "medium", evidence: [{ name: "wind farm records (24 within 20 km)", distance_km: null }] },
  ], EV1, D20, { checks: CHK });
  assert.equal(flags.length, 2);
  const sac = flags.find((x) => x.risk === "SAC nearby");
  assert.equal(sac.theme, "biodiversity");
  assert.deepEqual(sac.evidence.map((e) => [e.name, e.distance_km, e.band, e.publisher]), [["Loch Fleet SAC", 3, "2–5 km", "NatureScot"]]);
  assert.equal(sac.nearest_km, 3, "from traced evidence only: the retyped 0.2 km is gone");
  assert.equal(sac.untraced, 2);
  assert.deepEqual(sac.untraced_refs, ["E99 (not in this run)", "Nowhere (not cited by id)"]);
  const alc = flags.find((x) => x.risk === "Prime farmland");
  assert.equal(alc.evidence[0].check, "land.alc");
  assert.match(alc.evidence[0].name, /^Agricultural land class: on the site: Grade 2 \(60%\)/);
  assert.equal(alc.evidence[0].distance_km, 0);
  assert.equal(alc.evidence[0].band, "on site");
  assert.equal(alc.evidence[0].publisher, "Natural England");
  assert.deepEqual(not_raised.map((n) => n.risk), ["Floods", "Wind farms nearby"]);
  assert.deepEqual(not_raised[0].refs, ["water.flood-zones (the check came back not checked)", "bio.sac (the check came back none found)"], "a check that found nothing can't support a flag");
  assert.equal(notRaisedGap(not_raised[1]), "Not raised as a flag, because its evidence didn't trace to anything this run found: Wind farms nearby");
});

await test("findings get IDs in the order shown; severity sorts before confidence; next steps and the decision are kept", async () => {
  const f = traceFlags([
    { risk: "a", theme: "PS4", confidence: "high", severity: "low", evidence: ["E1"] },
    { risk: "b", theme: "PS6", confidence: "low", severity: "high", next_step: " walkover survey ", evidence: ["E1"] },
    { risk: "c", theme: "PS8", confidence: "medium", evidence: ["E1"] },
  ], EV1, D20);
  assert.deepEqual(f.map((x) => [x.id, x.risk]), [["F-01", "b"], ["F-02", "a"], ["F-03", "c"]]);
  assert.equal(f[0].next_step, "walkover survey");
  assert.equal(f[2].severity, null, "an unrated flag isn't given a severity");
  const { readDecision } = await import("../js/industry.js");
  assert.deepEqual(readDecision("Progress with targeted investigation", " wreck nearby "), { value: "progress with targeted investigation", why: "wreck nearby" });
  assert.equal(readDecision("go for it", "x"), null, "a decision outside the list is dropped, not guessed");
  // No tool rounds, so the only evidence is the checks': the flag cites a SAC the checks found.
  const model = scriptedModel([(req) => final(RESULT(`,{"risk":"SAC to the north-west","theme":"PS6","confidence":"medium","evidence":["${refIn(req, "Wyville Thomson Ridge")}"]}`).replace('"flags":[', '"decision":"major issue","decision_why":"wreck on the route","flags":['))]);
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), profile: () => ({ id: "energy", decisions: ["progress", "major issue"] }) }, site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  assert.deepEqual(rec.tobler_run.decision, { value: "major issue", why: "wreck on the route" });
  assert.equal(rec.tobler_run.industry, "energy");
  assert.equal(rec.tobler_run.flags[0].id, "F-01");
  assert.equal(headline(rec).decision, "major issue");
});

await test("a result cut off at the length cap is asked for again, as JSON only, from a compact summary first", async () => {
  const cut = { stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "long", signature: "sig" }, { type: "text", text: "Long summary…\n\n```json\n{\"flags\":[{\"risk\":\"x" }], usage: { input_tokens: 10, output_tokens: 8000 } };
  const model = scriptedModel([cut, (req) => final(RESULT("", (n) => refIn(req, n)))]);
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT.slice(1, 2), host: host(), site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  assert.equal(model.calls.length, 2);
  const last = model.calls[1].messages;
  assert.equal(last.length, 1, "one message: the summary, not the whole history");
  assert.match(last[0].content, /What the tools found/);
  assert.match(last[0].content, /cut off before its JSON block/);
  assert.match(last[0].content, /only the JSON block/);
  assert.equal(model.calls[1].tools, undefined, "no tools for the summary repair");
  assert.ok(!JSON.stringify(last).includes('"thinking"'));
  // The wrecks (brought in) and the pipelines (their check) trace; the repair sees the evidence ids too.
  assert.equal(rec.tobler_run.flags.length, 2);
  assert.match(last[0].content, /E\d+ Troldfos/i, "the repair's summary lines carry evidence ids");
  // The summary comes from the repaired result, not the cut-off draft, so it can't disagree with the flags (Kelso, 20 Nov).
  assert.doesNotMatch(rec.tobler_run.summary, /Long summary/);
  for (const f of rec.tobler_run.flags) assert.ok(rec.tobler_run.summary.includes(f.risk), `summary names "${f.risk}"`);
  assert.match(rec.tobler_run.summary, /put together from its result/);
  assert.equal(rec.tobler_run.debug.cut_off_summary, "Long summary…");
  assert.match(rec.tobler_run.note, /cut off/);
  assert.equal(rec.tobler_run.parse_error, undefined);
  assert.deepEqual(rec.tobler_run.debug.repairs.map((r) => [r.how, r.json]), [["summary", true]]);
  assert.equal(rec.tobler_run.debug.final_stop, "max_tokens");
  assert.ok(model.calls.every((c) => c.maxTokens === 16000), "every call in a screening asks for the larger reply limit");
});

await test("if the summary repair fails too, the full history is tried, and both attempts are in the debug", async () => {
  const cut = { stop_reason: "max_tokens", content: [{ type: "text", text: "Long summary…" }], usage: { input_tokens: 10, output_tokens: 8000 } };
  const model = scriptedModel([
    cut,
    { stop_reason: "max_tokens", content: [{ type: "text", text: "{ half" }], usage: { input_tokens: 5, output_tokens: 8000 } },
    (req) => final(RESULT("", (n) => refIn(req, n))),
  ]);
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ host: host(), site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const last = model.calls[2].messages;
  assert.equal(last.at(-2).role, "assistant");
  assert.deepEqual(rec.tobler_run.debug.repairs.map((r) => [r.how, r.json]), [["summary", false], ["history", true]]);
  assert.equal(rec.tobler_run.flags.length, 1, "only the pipelines (their check) can be cited; the wreck and the seabirds become gaps");
  assert.equal(rec.tobler_run.not_raised.length, 2);
});

await test("baseline before the analyst: boundaries and the must-check layers, as evidence, in the first message", async () => {
  atlasCalls.length = 0;
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const r = rec.tobler_run;
  const ev = rec.features.filter((f) => f.properties.role === "evidence");
  const line = ev.find((f) => /Faeroe/.test(f.properties.name));
  assert.ok(line, "maritime boundary kept as evidence");
  assert.ok(Math.abs(line.properties.distance_km - 12) < 0.5, `boundary 12 km from the edge (${line.properties.distance_km})`);
  assert.equal(line.properties.theme, "context");
  assert.equal(line.properties.details.sides, "Faeroe / United Kingdom");
  assert.match(line.properties.details.caveat, /no legal standing/);
  assert.ok(!ev.some((f) => /Alaska/.test(f.properties.name)), "far-away lines dropped");
  assert.ok(ev.some((f) => f.properties.name === "Faroe-Shetland Sponge Belt" && f.properties.theme === "biodiversity"));
  // Offshore west of Shetland: European, so WDPA, CDDA, Natura 2000 apply; sea layers apply; tropical corals and US habitat don't.
  assert.ok(r.baseline.layers.includes("IUCN Important Marine Mammal Areas"));
  assert.ok(r.baseline.layers.some((t) => /World Database on Protected Areas/.test(t)));
  assert.ok(!r.baseline.layers.some((t) => /Coral Reefs|NMFS/.test(t)));
  const imma = r.checked.find((c) => c.dataset === "IUCN Important Marine Mammal Areas");
  assert.equal(imma.result, "none in dataset");
  assert.equal(r.checked.find((c) => /Maritime Boundaries/.test(c.dataset)).result, "features");
  const first = model.calls[0].messages[0].content;
  assert.match(first, /The checks, by topic: your evidence/);
  assert.match(first, /Faeroe \(Denmark\) - United Kingdom \[Faeroe \/ United Kingdom, Treaty\] 1[12]\.\d+ km/);
  assert.match(first, /Important Marine Mammal Areas: none found within 50 km \[IUCN Important Marine Mammal Areas/);
  assert.match(first, /MARPOL special areas: the site is inside North West European waters \(a wide area it lies within\)/);
  // UK waters: the UK's own layers (NatureScot and JNCC offshore) beside the EU one; the same SAC in two counts once;
  // JNCC's NCMPA isn't a SAC; the same MPA in JNCC and WDPA (no code) counts once.
  assert.match(first, /Special Areas of Conservation \(must\): 1 within 50 km \(1 at 20–30 km\); nearest E\d+ Wyville Thomson Ridge \d+(\.\d+)? km \[Special Areas of Conservation \(SAC\), Scotland \(NatureScot\); UK offshore Marine Protected Areas \(JNCC\); Natura 2000: Habitats/);
  assert.match(first, /Special Protection Areas \(birds\) \(must\): none found within 50 km/);
  assert.match(first, /Marine and coastal protected areas \(must\): 1 within 50 km \(1 at 10–20 km\); nearest E\d+ Faroe-Shetland Sponge Belt/);
  assert.match(first, /- \[bio\.sac\] Special Areas of Conservation/, "each check's line carries its id, for flags to cite");
  assert.match(r.disclaimer, /not evidence of absence/);
  // The boundary is cited by its evidence id, from the checks' line; the run fills in the line's own name.
  const fb = ev.find((f) => /Faeroe \(Denmark\)/.test(f.properties.name)).properties;
  assert.match(first, new RegExp(`${fb.fid} Faeroe \\(Denmark\\)`), "the boundary's id is in the checks' line");
  const t = traceFlags([{ risk: "Maritime boundary close", theme: "context", confidence: "medium", evidence: [fb.fid] }], ev, d);
  assert.equal(t[0].traced, 1);
  assert.equal(t[0].evidence[0].name, fb.name);
});

await test("offshore baseline also reads water depth and AIS vessel traffic, in the record, the first message and the evidence", async () => {
  atlasCalls.length = 0;
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const asked = [];
  const fetchFn = async (url) => {
    asked.push(url);
    if (/getSamples/.test(url)) return { ok: true, json: async () => ({ samples: [-140, -150, -160].map((v) => ({ value: String(v), resolution: 0.004 })) }) };
    if (/emodnet-humanactivities/.test(url)) { const v = /allavg/.test(url) ? 0.8 : 0.1; const o = { features: [{ properties: { GRAY_INDEX: v } }] }; return { ok: true, text: async () => JSON.stringify(o) }; }
    return { ok: true, json: async () => [] };
  };
  const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), fetchFn }, site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const r = rec.tobler_run;
  assert.equal(r.sea.depth.typical_m, 150);
  assert.equal(r.sea.traffic.at_site, 0.8);
  assert.equal(r.checked.find((c) => c.evidence === "water depth").result, "features");
  assert.equal(r.checked.find((c) => c.evidence === "vessel traffic (AIS)").result, "features");
  const first = model.calls[0].messages[0].content;
  assert.match(first, /Water depth about 150 m \(140–160 m/);
  assert.match(first, /Vessel traffic \(AIS, 2023 annual average\): 0\.8 hours per km² a month on the site \(moderate\)/);
  const vt = rec.features.find((f) => f.properties.type === "vessel traffic density (AIS)");
  assert.ok(vt, "busiest traffic point kept as evidence");
  assert.equal(vt.properties.theme, "material-assets", "the vessel traffic check's topic");
  assert.match(vt.properties.licence, /CC-BY 4\.0/);
  // A flag on depth or traffic traces to the values the run read (there's no feature for depth).
  // A flag on depth or traffic cites the value checks by id (there's no feature for depth).
  const t = traceFlags([{ risk: "Deepwater", theme: "context", confidence: "medium", evidence: ["[topo.water-depth]", "material.vessel-traffic", "E999"] }], rec.features.filter((f) => f.properties.role === "evidence"), d, { checks: r.checks, sea: r.sea });
  assert.equal(t[0].traced, 2);
  assert.equal(t[0].evidence[0].from_values, "water depth");
  assert.equal(t[0].evidence[0].distance_km, 0);
  assert.equal(t[0].evidence[1].from_values, "vessel traffic");
  assert.equal(t[0].evidence[1].distance_km, r.sea.traffic.busiest.distance_km);
  assert.equal(t[0].untraced, 1);
  const readKm = checksCat.checks.find((c) => c.id === "material.vessel-traffic").read_km.global;
  assert.ok(r.sea.traffic.busiest.distance_km <= readKm + 0.2, `ring within the traffic check's read_km of the edge (${r.sea.traffic.busiest.distance_km} km)`);
});

await test("offshore depth and traffic services down: not checked, and the analyst is told", async () => {
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const fetchFn = async (url) => { if (/getSamples|emodnet/.test(url)) throw new Error("network down"); return { ok: true, json: async () => [] }; };
  const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), fetchFn }, site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const r = rec.tobler_run;
  assert.equal(r.sea, undefined);
  assert.equal(r.checked.find((c) => c.evidence === "water depth").result, "not checked");
  assert.equal(r.checked.find((c) => c.evidence === "vessel traffic (AIS)").result, "not checked");
  assert.match(model.calls[0].messages[0].content, /Water depth: not checked: network down \[DEM Global Mosaic/);
});

await test("on land, elevation is recorded every time but reported only when it matters (low-lying, high altitude)", async () => {
  // A 2 km square near Baarle (onshore, sea out of reach), as a solar farm.
  const land = { name: "Baarle 4 km²", feature: G.squareAround([4.93, 51.49], 4, 0), origin: { method: "drawn" } };
  const d = chooseAsset(table, { asset_type: "solar", offshore: false });
  const run = async (vals) => {
    const model = standardScript();
    const fetchFn = async (url) => (/getSamples/.test(url) ? { ok: true, json: async () => ({ samples: vals.map((v) => ({ value: String(v), resolution: 0.004 })) }) } : { ok: true, json: async () => [] });
    const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), fetchFn }, site: land, asset: d, skill, callClaude: model, inputs: { asset_type: "solar", asset_label: "solar farm" } });
    return { r: rec.tobler_run, first: model.calls[0].messages[0].content };
  };
  const plain = await run([20, 25, 30]);
  assert.equal(plain.r.elevation.typical_m, 25);
  assert.equal(plain.r.elevation.significance, undefined);
  assert.equal(plain.r.sea, undefined);
  // A check measures every time: the value is reported, and the analyst judges whether it matters.
  assert.match(plain.first, /Topography and bathymetry:\n- \[topo\.elevation\] Elevation: about 25 m, 20–30 m across the site\n/);
  assert.doesNotMatch(plain.first, /Elevation about 25 m above sea level/, "the long line only when it matters");
  assert.equal(plain.r.checks.find((c) => c.id === "topo.elevation").state, "found");
  assert.equal(plain.r.checked.find((c) => c.evidence === "elevation").result, "features");
  const low = await run([1, 3, 4, 6]);
  assert.equal(low.r.elevation.significance.kind, "low-lying");
  assert.match(low.first, /Elevation about 4 m above sea level, 1–6 m across the site \(low-lying: flooding, storm surge and sea-level rise\)/);
  const t = traceFlags([{ risk: "Low-lying site", theme: "context", confidence: "medium", evidence: ["topo.elevation"] }], [], d, { checks: low.r.checks });
  assert.equal(t[0].traced, 1);
  assert.equal(t[0].evidence[0].from_values, "elevation");
  assert.match(t[0].evidence[0].name, /^Elevation.*: .*4 m/);
  const high = await run([3700, 3800, 3900]);
  assert.equal(high.r.elevation.significance.kind, "very high altitude");
  assert.match(high.first, /very high altitude: much less oxygen/);
  const down = await (async () => { const model = standardScript(); const fetchFn = async (url) => { if (/getSamples/.test(url)) throw new Error("timed out"); return { ok: true, json: async () => [] }; }; await runScreening({ broughtIn: BROUGHT, host: { ...host(), fetchFn }, site: land, asset: d, skill, callClaude: model, inputs: { asset_type: "solar", asset_label: "solar farm" } }); return model.calls[0].messages[0].content; })();
  assert.match(down, /Elevation: not checked: timed out \[DEM Global Mosaic/, "a failed elevation read is said, not hidden");
});

await test("onshore far from the sea: no maritime call, a neighbouring country is measured from the reference", async () => {
  atlasCalls.length = 0;
  const { nearestBoundaries } = await import("../js/boundaries.js");
  // A 2 km square on the Netherlands side, about 5 km from the Belgian border near Baarle (51.44 N, 4.93 E).
  const sq = G.squareAround([4.93, 51.49], 4, 0);
  const out = await nearestBoundaries({ ref, site: sq, withinKm: 20, atlas, sea: false });
  assert.ok(!atlasCalls.length, "no atlas call without sea in reach");
  const be = out.evidence.find((e) => e.name === "Belgium");
  assert.ok(be && be.distance_km < 15, `Belgium within reach (${be?.distance_km})`);
  assert.match(be.type, /neighbouring country/);
  assert.ok(!out.evidence.some((e) => e.name === "Netherlands"), "own country isn't evidence");
  assert.match(out.checked.find((c) => /Maritime/.test(c.dataset)).why, /no sea within 20 km/);
});


await test("a mistyped dataset id isn't reported as a source not checked; offshore far from land says so; baseline is logged", async () => {
  const model = scriptedModel([toolTurn(use("x", "get_data", { dataset: "C1", place: "Area 1" })), final(RESULT())]);
  const events = [];
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" }, onEvent: (e) => events.push(e) });
  assert.ok(!rec.tobler_run.checked.some((c) => c.dataset === "C1" || c.dataset === undefined), JSON.stringify(rec.tobler_run.checked.map((c) => c.dataset)));
  assert.match(model.calls[0].messages[0].content, /No land within any check's reach \(the coast is about \d+ km away\)/);
  assert.ok(events.some((e) => e.type === "tool" && e.name === "nearest_boundaries" && e.baseline));
  assert.ok(events.filter((e) => e.type === "tool" && e.name === "get_data" && e.baseline).length >= 8, "the UK and EU layers, each fetched once");
});


await test("non-commercial data (WDPA) is left out by default and shown as not checked, with the reason", async () => {
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(false), site, asset: d, skill, callClaude: standardScript(), inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const w = rec.tobler_run.checked.find((c) => /World Database on Protected Areas/.test(c.dataset));
  assert.equal(w.result, "not checked");
  assert.match(w.why, /non-commercial/);
  assert.ok(!rec.features.some((f) => f.properties.name === "Faroe-Shetland Sponge Belt" && /World Database/.test(f.properties.dataset)), "no WDPA evidence without the switch");
});


await test("licence rule applies to every catalogue search: Esri MLA and non-commercial layers are left out by default", async () => {
  const { classifyLicence, licenceBlock } = await import("../js/licence.js");
  const { pickLayers } = await import("../js/atlasfeatures.js");
  assert.equal(classifyLicence("No commercial use: Neither (a) the WDPCA Materials nor (b) any work derived").class, "non-commercial");
  assert.equal(licenceBlock("non-commercial", {}) != null, true);
  assert.equal(licenceBlock("non-commercial", { nonCommercial: true }), null);
  const finds = [{ results: [
    { id: "a", title: "WDPA - Marine and Coastal Protected Areas", publisher: "UNEP-WCMC", licence: "No commercial use: Neither …" },
    { id: "b", title: "Living Atlas copy", publisher: "Esri", licence: "Esri Master License Agreement" },
    { id: "c", title: "NatureScot SSSI", publisher: "NatureScot", licence: "Open Government Licence v3" }] }];
  const off = pickLayers(finds, {});
  assert.deepEqual(off.layers.map((d) => d.id), ["c"]);
  assert.equal(off.left_out.length, 2);
  const on = pickLayers(finds, { allow: { esri: true, nonCommercial: true } });
  assert.equal(on.layers.length, 3);
});


await test("named field search: a national outline and a tracker's points both come back, outline first; other kinds stop at the first match", async () => {
  const { atlasFindNamed } = await import("../js/atlasfeatures.js");
  const layers = Array.from({ length: 15 }, (_, i) => ({ id: `L${i}`, title: i === 0 ? "Gas fields" : i === 12 ? "Global Oil and Gas Extraction Tracker (fields)" : `Other field layer ${i}`,
    publisher: i === 0 ? "Federal Ministry of Power (Nigeria)" : i === 12 ? "Global Energy Monitor" : "Someone", publisher_type: i === 0 ? "central-gov" : "ngo", capabilities: ["query"], licence: "not stated" }));
  const asked = [];
  const call = async (tool, a) => {
    if (tool === "find_datasets") return { matches: layers.length, results: layers };
    asked.push(a.id);
    if (a.id === "L0") return { returned: 1, features: [{ type: "Feature", geometry: turf.circle([4.47, 4.37], 5).geometry, properties: { name: "Bonga Main" } }] };
    if (a.id === "L12") return { returned: 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: [4.61, 4.59] }, properties: { name: "Bonga North Oil and Gas Field (Nigeria)" } }] };
    return { returned: 0, features: [] };
  };
  const r = await atlasFindNamed(["Bonga"], "oil or gas field", [0, 2, 17, 16], { call });
  assert.deepEqual(r.candidates.map((c) => c.name), ["Bonga Main", "Bonga North Oil and Gas Field (Nigeria)"]);
  asked.length = 0;
  const p = await atlasFindNamed(["Bonga"], "protected area", [0, 2, 17, 16], { call });
  assert.equal(asked.length, 10, "one batch only for kinds without trackers");
  assert.equal(p.candidates.length, 1);
});

await test("inside the area only (asked for): fetches only inside, measures nothing outside, records the scope", async () => {
  atlasCalls.length = 0;
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: model, runId: "R2",
    inputs: { asset_type: "oil-gas-field", asset_label: "offshore oil or gas field", extent: "inside" }, now: () => "2026-11-18T20:00:00Z" });
  // Every data fetch is the site's own box (about 10 km across), not the 50 km band. (The boundary lookup pads its
  // box by 5 km on purpose, then keeps only lines within 0 km.)
  for (const [, a] of atlasCalls.filter(([t, x]) => t === "fetch_features" && x.bbox && x.id !== "9760b5061ea298eb")) {
    const [w, , e] = a.bbox;
    assert.ok(turf.distance([w, FIELD[1]], [e, FIELD[1]]) < 12, `inside-only bbox: ${a.bbox}`);
  }
  const r = rec.tobler_run;
  assert.equal(r.extent, "inside");
  assert.equal(r.fetched_to_km, 0);
  assert.equal(r.assessed_within_km, 0);
  assert.match(r.site.footprint, /inside the area only/);
  const ev = rec.features.filter((f) => f.properties.role === "evidence");
  assert.ok(ev.length >= 1 && ev.every((f) => f.properties.distance_km === 0), ev.map((f) => `${f.properties.name} ${f.properties.distance_km}`).join("; "));
  assert.ok(ev.some((f) => /flowline/.test(f.properties.name)));
  const first = model.calls[0].messages[0].content;
  assert.match(first, /inside the area only/);
  assert.doesNotMatch(first, /wider 50 km/);
  assert.equal(headline(rec).scope, "inside the area only");
});

await test("inside only is ignored for a point (screened with its surroundings, and said)", async () => {
  const h = host();
  const list = [{ name: "Point 1", feature: turf.point(FIELD), origin: { method: "drawn" }, status: "accepted", edits: [] }];
  h.places = () => list; h.findPlace = () => list[0];
  let rec;
  h.screening = createScreening({ host: h, table, skill, callClaude: standardScript(), onRun: (x) => { rec = x; } });
  await createPlaceTools(h).exec("screen_site", { place: "Point 1", asset_type: "platform", extent: "inside" });
  assert.equal(rec.tobler_run.extent, "around");
  assert.match(rec.tobler_run.note_scope, /only applies to areas/);
});

await test("re-assess inside the area (the card's switch): only inside evidence, worded as inside", async () => {
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: standardScript(), runId: "R3",
    inputs: { asset_type: "oil-gas-field", asset_label: "offshore oil or gas field" } });
  const model = scriptedModel([(req) => final(`Inside the field, the flowline.\n\n\`\`\`json\n{"flags":[{"risk":"Flowline on site","theme":"PS4","confidence":"high","evidence":["${refIn(req, "Rosebank 9 inch Production flowline 1")}"]}],"data_gaps":[]}\n\`\`\``)]);
  await reassess({ record: rec, km: 0, skill, callClaude: model });
  const sent = model.calls[0].messages[0].content;
  assert.match(sent, /inside the area/);
  assert.doesNotMatch(sent, /West of Shetland Pipeline|TROLDFOS/i);
  assert.equal(rec.tobler_run.assessed_within_km, 0);
  assert.equal(rec.tobler_run.fetched_to_km, 50, "can switch back out");
  assert.equal(rec.tobler_run.flags[0].traced, 1);
});

await test("a search area (no outline found): nothing is 'on site'; findings inside say where, confidence capped, words changed", async () => {
  const { SEARCH_BAND } = await import("../js/siterole.js");
  const model = standardScript();
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const searchSite = { ...site, origin: { ...site.origin, match: "type_near_clues", shape: "square", offset: true, anchor: { name: "Shetland" } } };
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site: searchSite, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "offshore oil or gas field" } });
  const r = rec.tobler_run;
  assert.equal(r.site.role, "search_area");
  assert.match(r.site.footprint, /search area of .* \(built from clues round Shetland\), standing in for an outline that wasn't found/);
  assert.match(r.method, /search area/);
  assert.match(model.calls[0].messages[0].content, /This is a search area, not the site's outline/);
  const flow = rec.features.find((f) => /flowline/.test(f.properties.name)).properties;
  assert.equal(flow.band, SEARCH_BAND);
  assert.equal(flow.in_search_area, true);
  const pipes = r.flags.find((f) => /pipelines/.test(f.risk));
  assert.equal(pipes.relation, SEARCH_BAND);
  assert.equal(pipes.confidence, "medium", "high capped to medium inside a search area");
  assert.match(pipes.confidence_capped, /high → medium/);
  assert.match(pipes.risk, /in and near the search area/, "'on and near site' reworded");
  assert.doesNotMatch(pipes.risk, /on site/);
  assert.equal(pipes.evidence[0].band, SEARCH_BAND);
  const wreck = r.flags.find((f) => /Wreck/.test(f.risk));
  assert.equal(wreck.confidence, "medium");
  assert.equal(wreck.relation, "outside the search area");
  assert.match(headline(rec).site_is, /search area/);
  // The share link keeps it.
  const { slimRun } = await import("../js/share.js");
  const slim = slimRun(rec);
  assert.equal(slim.tobler_run.site.role, "search_area");
  assert.equal(slim.tobler_run.flags.find((f) => /pipelines/.test(f.risk)).relation, SEARCH_BAND);
});

await test("a published outline stays a site: 'on site' and no cap", async () => {
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: chooseAsset(table, { asset_type: "oil-gas-field", offshore: true }), skill, callClaude: standardScript(), inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  assert.equal(rec.tobler_run.site.role, "footprint");
  assert.equal(rec.tobler_run.flags.find((f) => /pipelines/.test(f.risk)).confidence, "high");
});

await test("display units: conversions, text in km shown in miles or nautical miles, metric untouched", async () => {
  const U = await import("../js/units.js");
  U.setUnits("metric");
  assert.equal(U.dist(12.4), "12.4 km");
  assert.equal(U.localise("10 km² block, 3.5 km from the coast"), "10 km² block, 3.5 km from the coast");
  U.setUnits("imperial");
  assert.equal(U.dist(16.09344), "10 mi");
  assert.equal(U.area(1), "247 acres");
  assert.equal(U.area(25.9), "10 sq mi");
  assert.equal(U.localise("near 2 km · wider 50 km"), "near 1.24 mi · wider 31.1 mi");
  assert.ok(Math.abs(U.fromDist(U.toDist(7)) - 7) < 1e-9);
  U.setUnits("nautical");
  assert.equal(U.dist(18.52), "10 nm");
  assert.match(U.unitsNote(), /nautical miles/);
  U.setUnits("bogus");
  assert.equal(U.getUnits(), "metric");
  assert.equal(U.unitsNote(), "");
});

await test("the run record (tobler-run/2) carries every check with its source, and the decision rule reads them", async () => {
  const d = chooseAsset(table, { asset_type: "oil-gas-field", offshore: true });
  const rec = await runScreening({ broughtIn: BROUGHT, host: host(), site, asset: d, skill, callClaude: standardScript(), inputs: { asset_type: "oil-gas-field", asset_label: "x" } });
  const r = rec.tobler_run;
  assert.equal(r.schema, "tobler-run/2");
  assert.equal(r.checks_scale, "global");
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(by["bio.sac"].state, "found");
  assert.equal(by["bio.sac"].count, 1, "NatureScot and JNCC give the same SAC: counted once");
  assert.deepEqual(by["bio.sac"].sources.map((x) => x.region), ["Scotland", "UK offshore, beyond 12 nm", "EU (not UK since 2021)"]);
  assert.ok(by["bio.sac"].sources.every((x) => x.state === "answered" && x.checked_at && x.licence));
  assert.equal(by["bio.marine-protected"].state, "found");
  assert.equal(by["bio.marine-protected"].count, 1, "JNCC's NCMPA and WDPA's copy: counted once");
  assert.ok(by["bio.marine-protected"].sources.some((x) => x.atlas_id === "154dfce48e32f9ee" && /WDPA/.test(x.licence)));
  assert.ok(!by["bio.ramsar"] || by["bio.ramsar"].state === "none");
  assert.ok(!by["bio.ancient-woodland"], "a land check doesn't run offshore");
  // JNCC's layer was fetched once for the SAC, SPA and marine checks.
  assert.equal(r.calls.filter((c) => c.tool === "get_data" && c.input.dataset === r.calls.find((x) => x.input?.fields?.includes("SITE_STATU"))?.input.dataset).length, 1);
  assert.equal(by["bio.national-sites"].state, "none");
  assert.equal(by["material.marpol-special-areas"].inside, true);
  assert.equal(by["context.boundaries"].reach_km, 50, "100 km wanted, the tools fetch 50");
  assert.ok(!by["bio.coral-reefs"] && !by["bio.us-critical-habitat"], "checks that don't apply aren't listed");
  assert.ok(r.no_check_topics.includes("heritage") && r.no_check_topics.includes("indigenous"));
  // WDPA switched off: in UK waters the UK's own layers answer, so the marine check still stands (supplementary).
  const off = (await runScreening({ broughtIn: BROUGHT, host: host(false), site, asset: d, skill, callClaude: standardScript(), inputs: { asset_type: "oil-gas-field", asset_label: "x" } })).tobler_run;
  const m = off.checks.find((c) => c.id === "bio.marine-protected");
  assert.equal(m.state, "found");
  assert.equal(m.partly, undefined, "a supplementary source left out isn't a partly-checked note");
  assert.equal(m.sources.find((x) => x.atlas_id === "154dfce48e32f9ee").state, "not_checked");
  // Every biodiversity must-check failing: insufficient evidence, said on the card.
  const down = async (tool, args) => { if (tool === "fetch_features" && BASELINE_IDS.has(args.id) && args.id !== "751ddc65885f897d") throw new Error("atlas: fetch failed"); return atlas(tool, args); };
  const model = scriptedModel([final('Nothing much.\n```json\n{"decision":"progress","decision_why":"clear","flags":[],"checked":[],"data_gaps":[]}\n```')]);
  const bad = (await runScreening({ broughtIn: BROUGHT, host: { ...host(), atlas: down }, site, asset: d, skill, callClaude: model, inputs: { asset_type: "oil-gas-field", asset_label: "x" } })).tobler_run;
  assert.equal(bad.decision.value, "insufficient evidence");
  assert.match(bad.decision.changed, /none of the must-checks for biodiversity could be checked/);
  assert.equal(bad.checks.find((c) => c.id === "bio.national-sites").reason, "failed");
});

await test("the contamination desk study: only its checks, at its own distances, one judgement with no tools; grouped as sources, pathways, receptors", async () => {
  const C = [-1.08, 53.9];
  const yard = { name: "Old works", feature: G.squareAround(C, 0.04, 0), origin: { method: "drawn" } };
  const F = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const asked = [];
  const ukAtlas = async (tool, args) => {
    if (tool !== "fetch_features") return atlas(tool, args);
    asked.push(args.id);
    if (args.id === "3a4c49302d01deb3") return { returned: 1, features: [F(turf.circle(turf.destination(C, 0.3, 0).geometry.coordinates, 0.05).geometry, { site_name: "Station Road tip", hld_ref: "EAHLD1" })] };
    if (args.id === "6c3e0babf56f294e") return { returned: 1, features: [F(turf.bboxPolygon([-1.1, 53.89, -1.06, 53.91]).geometry, { number: "2" })] };
    return { returned: 0, features: [] };
  };
  const profile = JSON.parse(read("../catalogue/industries/energy.json"));
  const entry = profile.skills_offered.find((x) => x.id === "contamination-desk-study");
  const desk = parseSkill(read("../skills/contamination-desk-study/SKILL.md"));
  const model = scriptedModel([(req) => final(`A possible linkage from the old tip.

\`\`\`json
{"decision":"possible linkages: investigate","decision_why":"A historic landfill 300 m north, and the site is in a source protection zone.",
 "flags":[{"risk":"Historic landfill 300 m north could affect groundwater in the source protection zone","topic":"ground-soil",
   "linkage":{"source":"Station Road tip (historic landfill)","pathway":"groundwater (source protection zone)","receptor":"public water supply","rating":"possible"},
   "severity":"medium","confidence":"medium","evidence":["${refIn(req, "Station Road tip")}"],
   "why":"landfill leachate","next_step":"historical maps and a commercial environmental search"}],
 "checked":[],"data_gaps":[]}
\`\`\``)]);
  const d = { id: null, label: "contamination desk study", row: false, scale: entry.scale, footprint_km: 0.1, extends: [], scale_why: "the study's own scale" };
  const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), atlas: ukAtlas, profile: () => profile, fetchFn: async () => ({ ok: true, json: async () => ({ samples: [] }) }) },
    site: yard, asset: d, skill: desk, study: entry, callClaude: model, inputs: { asset_type: "other", asset_label: "contamination desk study" } });
  const r = rec.tobler_run;
  assert.equal(r.kind, "contamination-desk-study");
  assert.equal(r.checks_scale, "local");
  const ids = new Set(entry.groups.flatMap((g) => g.checks));
  assert.ok(r.checks.length && r.checks.every((c) => ids.has(c.id)), `only the study's checks ran: ${r.checks.map((c) => c.id).join(", ")}`);
  assert.ok(!r.checks.some((c) => c.id === "heritage.listed-buildings"));
  // One call, no tools.
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].tools, undefined);
  assert.match(model.calls[0].system, /no tools/);
  assert.match(model.calls[0].messages[0].content, /Contamination desk study for Old works/);
  assert.match(model.calls[0].messages[0].content, /Station Road tip/);
  // The linkage is a finding, traced to the checks' features; the decision is the study's own.
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].linkage.rating, "possible");
  assert.equal(r.flags[0].theme, "ground-soil");
  assert.equal(r.flags[0].traced, 1);
  assert.equal(r.decision.value, "possible linkages: investigate");
  // The card and report group the checks as sources, pathways and receptors.
  const view = K.checksView(r);
  assert.deepEqual(view.groups.map((g) => g.label), ["Potential sources", "Pathways", "Receptors"]);
  assert.ok(view.groups[0].items.some((i) => i.id === "ground.landfill" && i.state === "found"));
  assert.ok(r.study.full_study_adds.some((x) => /historical maps/.test(x)));
  // Every source record failing: insufficient evidence, whatever was written.
  const down = async (tool, args) => { if (tool === "fetch_features") throw new Error("atlas: fetch failed"); return atlas(tool, args); };
  const clean = scriptedModel([final('Nothing.\n```json\n{"decision":"no linkages identified in open records","decision_why":"none","flags":[],"checked":[],"data_gaps":[]}\n```')]);
  const bad = (await runScreening({ broughtIn: BROUGHT, host: { ...host(), atlas: down, profile: () => profile, fetchFn: async () => ({ ok: true, json: async () => ({ samples: [] }) }) },
    site: yard, asset: d, skill: desk, study: entry, callClaude: clean, inputs: { asset_type: "other", asset_label: "contamination desk study" } })).tobler_run;
  assert.equal(bad.decision.value, "insufficient evidence");
  assert.match(bad.decision.changed, /none of the source records could be checked/);
});

await test("the UK pack on land: flood zones and farmland by share of the site, the IRZ read for solar, heritage counted", async () => {
  // A 1 km square solar farm south of York. England's layers answer; the rest of the UK isn't in reach.
  const C = [-1.08, 53.9];
  const yard = { name: "York solar", feature: G.squareAround(C, 1, 0), origin: { method: "drawn" } };
  const half = (side) => { const [w, so, e, n] = turf.bbox(yard.feature); const mid = (w + e) / 2; return turf.bboxPolygon(side === "west" ? [w - 0.01, so - 0.01, mid, n + 0.01] : [mid, so - 0.01, e + 0.01, n + 0.01]).geometry; };
  const irzTable = JSON.parse(read("../catalogue/sssi_irz_codes.json"));
  const asked = [];
  const ukAtlas = async (tool, args) => {
    if (tool !== "fetch_features") return atlas(tool, args);
    asked.push(args);
    const F = (geometry, properties) => ({ type: "Feature", geometry, properties });
    if (args.id === "5ffe9c81924b8082") return { returned: 1, features: [F(half("west"), { flood_zone: "FZ3" })] };
    if (args.id === "5e7c583217c03078") return { returned: 2, features: [F(half("west"), { ALC_GRADE: "Grade 3a", JOB_NUMBER: "1" }), F(half("east"), { ALC_GRADE: "Grade 3b", JOB_NUMBER: "2" })] };
    if (args.id === "05ca97cc51458e33") return { returned: 1, features: [F(turf.bboxPolygon([-1.2, 53.8, -1.0, 54.0]).geometry, { IRZURL: "https://irz.geodata.org.uk/IRZ/step2.html?irzcode=0010000000000" })] };
    if (args.id === "983f6d4fe0ad19b7") return { returned: 2, features: [F({ type: "Point", coordinates: turf.destination(C, 0.6, 90).geometry.coordinates }, { Name: "Church of St Mary", ListEntry: "1001", Grade: "I" }),
      F({ type: "Point", coordinates: turf.destination(C, 1.8, 0).geometry.coordinates }, { Name: "Barn", ListEntry: "1002", Grade: "II" })] };
    return { returned: 0, features: [] };
  };
  const profile = JSON.parse(read("../catalogue/industries/energy.json"));
  const d = chooseAsset(table, { asset_type: "solar", offshore: false, area_km2: 1 });
  const model = standardScript();
  const rec = await runScreening({ broughtIn: BROUGHT, host: { ...host(), atlas: ukAtlas, irz: irzTable, profile: () => profile, fetchFn: async () => ({ ok: true, json: async () => ({ samples: [] }) }) },
    site: yard, asset: d, skill, callClaude: model, inputs: { asset_type: "solar", asset_label: "solar farm" } });
  const r = rec.tobler_run;
  const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
  assert.equal(r.checks_scale, "regional");
  assert.equal(K.checkLine(by["water.flood-zones"]), "on the site: Flood Zone 3 (50%)");
  assert.equal(K.checkLine(by["land.farmland-grade"]), "on the site: Grade 3a (50%), Grade 3b (50%)");
  assert.equal(by["bio.sssi-irz"].inside, true);
  assert.deepEqual(by["bio.sssi-irz"].irz.map((z) => [z.key, z.consult]), [["ac", false], ["ws", true]]);
  assert.equal(K.checkLine(by["bio.sssi-irz"]), "inside a risk zone; consult Natural England for: wind and solar");
  assert.equal(K.checkLine(by["heritage.listed-buildings"]), "2 within 2 km (1 at 0–100 m, 1 at 1–2 km); nearest Church of St Mary, 100 m", "one ladder: 0–100 m first");
  assert.equal(by["heritage.listed-buildings"].count, 2);
  // Scotland's, Wales's and Northern Ireland's layers aren't in a 2 km reach of York; their pending lines don't appear.
  assert.ok(!by["water.flood-zones"].sources.some((x) => x.region !== "England"), JSON.stringify(by["water.flood-zones"].sources.map((x) => x.region)));
  assert.ok(!r.checks.some((c) => /^not checked: .*Northern Ireland/.test(K.checkLine(c))));
  // The analyst gets the check lines and Natural England's own wording for solar.
  const first = model.calls[0].messages[0].content;
  assert.match(first, /Water:\n- \[water\.flood-zones\] Flood zones \(rivers and sea\) \(must\): on the site: Flood Zone 3 \(50%\)/);
  assert.match(first, /Natural England's wording, Wind and Solar: /);
  // Class layers and listed buildings were fetched only to their own reach, not the 20 km wider band.
  const widthKm = (b) => turf.distance([b[0], C[1]], [b[2], C[1]]);
  for (const id of ["5ffe9c81924b8082", "5e7c583217c03078", "983f6d4fe0ad19b7"]) {
    const a = asked.find((x) => x.id === id);
    assert.ok(a && widthKm(a.bbox) < 6, `${id} fetched to its own reach (${a && widthKm(a.bbox).toFixed(1)} km across)`);
  }
  assert.ok(widthKm(asked.find((x) => x.id === "0c53cecc65701f0c").bbox) < 15, "SSSIs to their own 5 km reach too (24 Nov)");
  // Each check lists the features it counted, nearest first, with map ids, details and publishers.
  const lb = by["heritage.listed-buildings"].features;
  assert.deepEqual(lb.map((f) => [f.name, f.detail, f.publisher, !!f.fid]), [["Church of St Mary", "Grade I", "Historic England", true], ["Barn", "Grade II", "Historic England", true]]);
  assert.ok(lb[0].distance_km < lb[1].distance_km);
  assert.deepEqual(by["water.flood-zones"].features.map((f) => [f.detail, f.coverage]), [["Flood Zone 3", 0.5]]);
  // Every topic has a check on an English site since the coverage drive (24 Nov). England's permitted sites are a
  // download only, so that check is honestly not checked, with the reason.
  assert.equal(r.no_check_topics, undefined);
  assert.equal(by["air.permitted-sites"].state, "not_checked");
  assert.match(by["air.permitted-sites"].why, /downloads/);
  // The contamination checks carry one caveat, shown once on the card and in the report.
  assert.ok(by["ground.landfill"] && by["community.radon"]);
  const view = K.checksView(r);
  assert.deepEqual(view.caveats, ["An early screen of open records, not a contaminated land report. If anything here matters, the next step is a full environmental search."]);
  // OpenStreetMap answered with nothing here: none found, from OpenStreetMap, never a must.
  const pl = by["material.power-lines"];
  assert.equal(pl.state, "none");
  assert.match(pl.sources?.[0]?.dataset || pl.source?.dataset || "", /^OpenStreetMap: power lines/);
  assert.equal(pl.must, false);
  assert.ok(by["community.homes"] && by["hazards.coal-mining"] && by["water.source-protection"], "the new UK and OpenStreetMap checks run on a site in England");
});

await test("package A end to end: Barnston housing on the general defaults, no 10 km rings; \"look out to 5 km\" from the conversation", async () => {
  // A 10 ha field by Barnston on the Wirral. Every layer answers empty; OpenStreetMap answers empty.
  const C = [-3.08, 53.345];
  const field = { id: "b1", name: "Barnston field", feature: G.squareAround(C, 0.32, 0), origin: { method: "drawn" }, status: "accepted", edits: [] };
  const quiet = async (tool, args) => (tool === "fetch_features" ? { returned: 0, features: [] } : atlas(tool, args));
  const fetchFn = async (url) => ({ ok: true, json: async () => (/overpass|interpreter|kumi/i.test(String(url)) ? { elements: [] } : { samples: [] }) });
  const h = { ...host(), atlas: quiet, fetchFn, osmSnapshot: null };
  const svc = createScreening({ host: h, table, skill, callClaude: async () => final("Nothing found.\n\n```json\n{\"flags\":[],\"data_gaps\":[],\"checked\":[]}\n```"), onRun: () => {} });
  await svc.screen({ asset_type: "other", planned: "housing" }, field);
  const r = [...svc.runs.values()].at(-1).tobler_run;
  assert.equal(r.reach.scale, "local");
  assert.equal(r.reach.asset.row, false);
  assert.match(r.reach.asset.note, /No distances are set for housing yet/);
  assert.equal(r.fetched_to_km, 5, "the furthest check (aerodromes, 5 km)");
  const rings = runRings(r);
  assert.deepEqual(rings, [0.1, 0.25, 0.5, 1, 2, 5]);
  assert.ok(!rings.some((k) => k > 5), "no 10 km ring");
  assert.equal(r.checks.find((c) => c.id === "bio.sac").reach_km, 2);
  assert.ok(r.checks.every((c) => c.reach_km == null || c.reach_km <= 5));
  assert.equal(r.distances, undefined);
  // "Look out to 5 km": every count check looks out 5 km, and the record keeps what was said and what it was.
  await svc.screen({ asset_type: "other", planned: "housing", distances: [{ what: "all", value: 5, unit: "km" }] }, field);
  const r2 = [...svc.runs.values()].at(-1).tobler_run;
  for (const c of r2.checks.filter((x) => x.answer === "count_by_band")) assert.equal(c.reach_km, 5, c.id);
  assert.equal(r2.checks.find((c) => c.id === "community.homes").reach_from, "person");
  assert.equal(r2.checks.find((c) => c.id === "community.homes").reach_default_km, 0.5);
  assert.equal(r2.reach.changes[0].said, "5 km");
  assert.equal(r2.reach.changes[0].line, "every count check to 5 km (was 250 m to 5 km, by check)");
  assert.equal(r2.checks.find((c) => c.id === "water.flood-zones")?.reach_km ?? 0.25, 0.25, "a class check keeps its reach");
  assert.deepEqual(r2.inputs.distances, [{ what: "all", value: 5, unit: "km" }]);
  assert.match(r2.replaces.diff.lines.join(" "), /distances the defaults \(250 m to 5 km, by check\) then, every count check to 5 km \(was 250 m to 5 km, by check\) now/);
});

await test("the developable area: the skill's rules for the asset type, the checks within each buffer, one area budget, no model call", async () => {
  // A 1 km square solar site south of York, built on the ground (laea), so the true gross is 100 ha.
  const C = [-1.08, 53.9];
  const inv = laeaInverse(C);
  const kmBox = (x0, y0, x1, y1) => ({ type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(inv)] });
  const field = { id: 7, name: "Home Farm", feature: { type: "Feature", properties: {}, geometry: kmBox(-0.5, -0.5, 0.5, 0.5) }, origin: { method: "drawn" } };
  const F = (geometry, properties) => ({ type: "Feature", geometry, properties });
  const ukAtlas = async (tool, args) => {
    if (tool !== "fetch_features") return atlas(tool, args);
    // An SSSI over the western 20%; Flood Zone 3 along the south (200 m) and Flood Zone 2 over the next 200 m; grade 2 farmland everywhere.
    if (args.id === "0c53cecc65701f0c") return { returned: 1, features: [F(kmBox(-2, -2, -0.3, 2), { NAME: "Ings Meadow SSSI" })] };
    if (args.id === "5ffe9c81924b8082") return { returned: 2, features: [F(kmBox(-2, -2, 2, -0.3), { flood_zone: "FZ3" }), F(kmBox(-2, -0.3, 2, -0.1), { flood_zone: "FZ2" })] };
    if (args.id === "5e7c583217c03078") return { returned: 1, features: [F(kmBox(-2, -2, 2, 2), { ALC_GRADE: "Grade 2", JOB_NUMBER: "1" })] };
    return { returned: 0, features: [] };
  };
  // OpenStreetMap: a 132 kV line north–south through x = 0.3 km, in two pieces; one building; residential land 20 m off the east edge.
  let osmAsked = "";
  const node = (x, y) => { const [lon, lat] = inv([x, y]); return { lon, lat }; };
  const overpass = { elements: [
    { type: "way", id: 1, tags: { power: "line", voltage: "132000" }, geometry: [node(0.3, -1), node(0.3, 0)] },
    { type: "way", id: 2, tags: { power: "line", voltage: "132000" }, geometry: [node(0.3, 0), node(0.3, 1)] },
    { type: "way", id: 3, tags: { building: "barn" }, geometry: [node(0, 0.2), node(0.1, 0.2), node(0.1, 0.3), node(0, 0.3), node(0, 0.2)] },
    { type: "way", id: 4, tags: { landuse: "residential" }, geometry: [node(0.52, -0.2), node(0.8, -0.2), node(0.8, 0.2), node(0.52, 0.2), node(0.52, -0.2)] },
    { type: "relation", id: 5, tags: { natural: "water" }, center: node(-0.1, 0.4) },
  ] };
  const fetchFn = async (url, opts = {}) => {
    if (/overpass|kumi|interpreter/i.test(String(url))) { osmAsked = decodeURIComponent(String(opts.body || "")); return { ok: true, json: async () => overpass }; }
    return { ok: true, json: async () => ({ samples: [] }) };
  };
  const profile = JSON.parse(read("../catalogue/industries/energy.json"));
  const entry = profile.skills_offered.find((x) => x.id === "developable-area");
  assert.equal(entry.status, "ready");
  const sk = parseSkill(read("../skills/developable-area/SKILL.md"));
  const calls = [];
  const svc = createScreening({ host: { ...host(), atlas: ukAtlas, profile: () => profile, fetchFn }, table, skill, skillFor: (n) => (n === "developable-area" ? sk : null),
    callClaude: async (a) => { calls.push(a); throw new Error("no model call expected"); }, onRun: () => {} });
  const head = await svc.study(entry, field, { asset_type: "solar" });
  assert.equal(calls.length, 0, "no model call");
  const rec = [...svc.runs.values()].at(-1);
  const r = rec.tobler_run, b = r.budget;
  assert.equal(r.kind, "developable-area");
  assert.equal(r.decision, null);
  near(b.gross_ha, 100, 0.1);
  const row = (id) => [...b.rows, ...b.soft].find((x) => x.id === id);
  near(row("nature-sites").ha, 20, 0.1);
  assert.equal(row("nature-sites").state, "found");
  // The power line, both pieces, 30 m each side: 1 km × 60 m = 6 ha, none of it under the SSSI.
  near(row("power-lines").ha, 6, 0.15);
  assert.ok(row("buildings").ha > 0.9 && row("buildings").ha < 1.1, `building ${row("buildings").ha}`);
  // Residential land 20 m off the east edge, 50 m buffer for solar: a 30 m strip about 490 m long (the buffer's rounded ends).
  assert.ok(row("homes").ha > 1.3 && row("homes").ha < 1.55, `homes ${row("homes").ha}`);
  // Flood Zone 3 over the south 200 m, outside the SSSI and line already taken.
  assert.ok(row("flood-zone-3").ha > 12 && row("flood-zone-3").ha < 16, `fz3 ${row("flood-zone-3").ha}`);
  const taken = b.rows.reduce((t, x) => t + x.ha, 0);
  near(taken + b.net_ha, b.gross_ha, 0.1);
  // Soft: Flood Zone 2 first, then grade 2 farmland on the rest; slope not checked; the lake as a relation is counted apart.
  assert.ok(row("flood-zone-2").ha > 10, `fz2 ${row("flood-zone-2").ha}`);
  near(row("flood-zone-2").ha + row("bmv-farmland").ha, b.net_ha, 0.15);
  assert.equal(row("slope").state, "not_checked");
  assert.equal(row("water-bodies").centre_only, 1);
  assert.equal(row("water-bodies").ha, 0);
  // Not for this asset type: no listed-buildings deduction for... (solar has one), and wind's homes buffer isn't used.
  assert.equal(row("homes").buffer_m, 50);
  // Each check looked only as far as its buffer: homes 50 m, not a screen's 500 m.
  assert.equal(r.checks.find((c) => c.id === "community.homes").reach_km, 0.05);
  assert.ok(!r.checks.some((c) => c.id === "community.schools"), "only the budget's checks");
  assert.match(osmAsked, /way\["building"\]/);
  // Shapes for the map and the headline for the analyst: names and numbers, never coordinates.
  const net = rec.features.find((f) => f.properties.role === "budget" && f.properties.part === "net");
  near(turf.area(net) / 1e4, b.net_ha, 0.5);
  assert.ok(rec.features.some((f) => f.properties.part === "taken" && f.properties.deduction === "nature-sites"));
  assert.equal(head.net_ha, b.net_ha);
  assert.ok(!/\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]/.test(JSON.stringify(head)), "no coordinates in the headline");
  assert.match(r.summary, /^Net developable area for a solar farm: /);
  // The person's own rules: 100 m from homes, leave out the barn, Flood Zone 3 usable on raised panels.
  const head2 = await svc.study(entry, field, { asset_type: "solar", buffers: [{ id: "homes", buffer_m: 100 }], leave_out: ["buildings"], as_soft: ["flood-zone-3"] });
  const b2 = [...svc.runs.values()].at(-1).tobler_run.budget;
  const row2 = (id) => [...b2.rows, ...b2.soft].find((x) => x.id === id);
  assert.ok(!row2("buildings"));
  assert.equal(row2("flood-zone-3").kind, "soft");
  assert.ok(row2("homes").ha > row("homes").ha);
  assert.ok(b2.changes.some((c) => /Homes: 100 m, as you asked \(default 50 m\)/.test(c)));
  assert.ok(head2.your_changes.length === 3);
  // The one input for distances (package A): "keep 80 m from homes" is the homes buffer, and no search changes;
  // "look out to 5 km" means nothing to an area budget, and says so.
  await svc.study(entry, field, { asset_type: "solar", distances: [{ what: "homes", value: 80, unit: "m" }, { what: "all", value: 5, unit: "km" }] });
  const r3 = [...svc.runs.values()].at(-1).tobler_run;
  const b3 = r3.budget;
  assert.equal([...b3.rows, ...b3.soft].find((x) => x.id === "homes").buffer_m, 80);
  assert.equal(r3.checks.find((c) => c.id === "community.homes").reach_km, 0.08, "the homes check looks only as far as its buffer");
  assert.equal(r3.checks.find((c) => c.id === "bio.national-sites")?.reach_km ?? 0, r.checks.find((c) => c.id === "bio.national-sites")?.reach_km ?? 0, "no other reach moved");
  assert.match(r3.reach.changes.map((c) => c.line).join(" "), /Homes: 80 m, as you asked \(default 50 m\)/);
  assert.match(r3.reach.not_used[0].why, /each deduction's buffer/);
  assert.deepEqual(r3.inputs.distances, [{ what: "homes", value: 80, unit: "m" }, { what: "all", value: 5, unit: "km" }]);
  // A point or a search area is refused politely.
  const pt = await svc.study(entry, { name: "Pin", feature: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: C } }, origin: { method: "drawn" } }, {});
  assert.match(pt.not_available, /needs an outline/);
  const sa = await svc.study(entry, { name: "Somewhere", feature: field.feature, origin: { method: "words", match: "name_only", anchor: { name: "x" } } }, {});
  assert.match(sa.not_available, /search area/);
});

await test("the developable area: the analyst's rule ids and asset types match the skill's", async () => {
  const rules = budgetRules(parseSkill(read("../skills/developable-area/SKILL.md")));
  assert.deepEqual(rules.deductions.map((d) => d.id).sort(), [...BUDGET_RULE_IDS].sort());
  assert.deepEqual(Object.keys(rules.asset_types).sort(), [...BUDGET_ASSETS].sort());
  for (const d of rules.deductions) for (const c of d.checks) assert.ok(checksCat.checks.some((x) => x.id === c), `${d.id}: no check ${c}`);
  // A general site skips the asset-specific buffers; an unknown asset type is general, and says so.
  const g = resolveDeductions(rules, { asset_type: "spaceport" });
  assert.equal(g.asset_type, "general"); assert.equal(g.asset_assumed, true);
  assert.ok(!g.deductions.some((d) => d.id === "homes"));
  assert.deepEqual(resolveDeductions(rules, { asset_type: "solar", leave_out: ["hedges"] }).unknown, ["hedges"]);
  // A check used only by the budget is left out of a screen's plan.
  const plan = K.planChecks(checksCat, { bbox: [-1.09, 53.89, -1.07, 53.91], countries: ["United Kingdom"], offshore: false }, "local");
  assert.ok(!plan.some((p) => p.check.id === "material.buildings"));
  assert.ok(K.planChecks(checksCat, { bbox: [-1.09, 53.89, -1.07, 53.91], countries: ["United Kingdom"], offshore: false }, "local", { skill: "developable-area" }).some((p) => p.check.id === "material.buildings"));
  assert.ok(classMatches("Flood Zone 3 (rivers)", ["Flood Zone 3"]) && !classMatches("Grade 3a", ["Grade 3"]) && classMatches("Grade 3 (provisional map)", ["Grade 3"]));
});

await test("the sealed screen (26 Nov): one judgement with no tools, then the atlas is searched for the gaps, and layers come in only on a yes", async () => {
  const h = host();
  const p = { id: "p1", name: "Area 1", feature: square, origin: site.origin, status: "accepted", edits: [] };
  h.places = () => [p];
  h.findPlace = (n) => (String(n).toLowerCase() === "area 1" ? p : null);
  let changed = 0;
  h.onRunChanged = () => { changed++; };
  const sealedResult = `Rosebank screened as an offshore oil field.

\`\`\`json
{"decision":"progress with targeted investigation","decision_why":"A SAC in the wider band.",
 "flags":[{"risk":"Special Area of Conservation in the wider band","topic":"biodiversity","severity":"medium","confidence":"medium","why":"Appropriate assessment may be needed","next_step":"Ask the regulator","evidence":["[bio.sac]"]}],
 "checked":[],"data_gaps":["Shipwrecks weren't checked"],
 "look_for":[{"what":"Shipwrecks","words":["wreck"],"topic":"heritage"},{"what":"Nothing useful","words":["zz"],"topic":"bogus"}]}
\`\`\``;
  const model = scriptedModel([final(sealedResult)]);
  const shown = [];
  atlasCalls.length = 0;
  h.screening = createScreening({ host: h, table, skill, callClaude: model, onRun: (rec) => shown.push(rec) });
  const t = createPlaceTools(h);
  const out = await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field", assumed: true });
  assert.equal(out.run, "R1");
  // One model call, no tools offered, and the brief asks for look_for.
  assert.equal(model.calls.length, 1);
  assert.equal(model.calls[0].tools, undefined);
  assert.match(model.calls[0].system, /you have no tools/);
  assert.match(model.calls[0].system, /look_for/);
  assert.doesNotMatch(model.calls[0].messages[0].content, /in tool calls/);
  const r = shown[0].tobler_run;
  assert.equal(r.flags.length, 1);
  assert.equal(r.flags[0].traced > 0, true);
  // look_for is read and cleaned: words of 3+ letters only, unknown topics become context.
  assert.deepEqual(r.look_for, [{ what: "Shipwrecks", words: ["wreck"], topic: "heritage" }]);
  // The analyst fetched nothing: every atlas call before the offer was the run's own checks.
  const finds = atlasCalls.filter(([tool]) => tool === "find_datasets");
  assert.ok(finds.length >= 1, "the offer searched the atlas");
  assert.ok(finds.every(([, a]) => a.bbox && a.limit === 25));
  // The offer: the wreck layer, searched over the site itself, not fetched.
  const item = r.offer.items.find((x) => x.label === "Shipwrecks");
  assert.ok(item, JSON.stringify(r.offer));
  assert.equal(item.dataset.atlas_id, "wreck");
  assert.equal(item.state, "offered");
  // Looked at once before it was offered (2 within 50 km), but nothing kept or added until the yes.
  assert.equal(atlasCalls.filter(([tool, a]) => tool === "fetch_features" && a.id === "wreck").length, 1);
  assert.deepEqual([item.preview.count, item.preview.within_km, item.preview.nearest[0].name], [2, 50, "Troldfos (Possibly)"]);
  assert.ok(!shown[0].features.some((f) => f.properties.role === "added"), "nothing added before a yes");
  // The reply after the run, written in code, offers it and says nothing comes in unasked.
  const reply = finishTurn(h.screening)("screen_site", {}, out);
  assert.match(reply, /\*\*Worldwide wreck locations \(UK Hydrographic Office\)\*\* \(EMODnet Human Activities; CC BY 4\.0\), for shipwrecks/);
  assert.match(reply, /Nothing is added unless you say so/);
  // Follow-ups can see it.
  const g = await t.exec("get_run", { run: "R1" });
  assert.equal(g.offered_after_run.find((x) => x.for === "Shipwrecks").dataset, "Worldwide wreck locations (UK Hydrographic Office)");
  // A yes: fetched out to the run's wider band, kept with its source, on the record; the reply is code's.
  const got = await t.exec("bring_in_layers", { run: "R1", layers: [item.id] });
  const fetched = atlasCalls.filter(([tool, a]) => tool === "fetch_features" && a.id === "wreck");
  assert.equal(fetched.length, 2, "the look before the offer, then the fetch on the yes");
  assert.equal(got.added[0].within_km, 50);
  assert.equal(got.added[0].count, 2);
  assert.equal(got.added[0].publisher, "EMODnet Human Activities");
  assert.equal(got.added[0].nearest[0].name, "Troldfos (Possibly)");
  assert.equal(r.added.length, 1);
  assert.equal(item.state, "brought_in");
  // The features travel with the run, marked as added and kept apart from its evidence, with their provenance.
  const extra = shown[0].features.filter((f) => f.properties.role === "added");
  assert.equal(extra.length, 2);
  for (const f of extra) for (const k of ["fid", "dataset", "publisher", "licence", "checked_at", "band"]) assert.ok(f.properties[k], `${k} on ${f.properties.name}`);
  assert.equal(extra[0].properties.offer, item.id);
  assert.ok(!shown[0].features.some((f) => f.properties.role === "evidence" && /Troldfos/i.test(f.properties.name)), "not added to the run's evidence");
  assert.equal(changed, 1);
  const said = finishTurn(h.screening)("bring_in_layers", {}, got);
  assert.match(said, /Brought in for R1:\n- \*\*Worldwide wreck locations/);
  assert.match(said, /2 features within 50 km; nearest Troldfos \(Possibly\), 2 km away/);
  assert.match(said, /decision and flags were made without it\. Explore it on the map; to have it judged, ask me to re-run the screen, which will include it\./);
  // Asking again: nothing left on offer for it.
  const again = await t.exec("bring_in_layers", { run: "R1", layers: [item.id] });
  assert.match(again.not_available, /already been brought in or declined/);
  // A re-run takes what came in as evidence the analyst can cite, listed apart, and doesn't offer it again (Rob, 26 Nov).
  const before = atlasCalls.length;
  await t.exec("screen_site", { place: "Area 1", asset_type: "oil-gas-field", assumed: true });
  const brief = model.calls.at(-1).messages[0].content;
  assert.match(brief, /Brought in by the person after an earlier run[^\n]*\n- Worldwide wreck locations \(UK Hydrographic Office\) \(EMODnet Human Activities\), for shipwrecks: 2 within 50 km; nearest E\d+ Troldfos \(Possibly\) 2 km/);
  const r2 = shown[1].tobler_run;
  assert.equal(r2.brought_in[0].count, 2);
  assert.equal(r2.brought_in[0].atlas_id, "wreck");
  assert.ok(shown[1].features.some((f) => f.properties.role === "evidence" && /Troldfos/i.test(f.properties.name)), "now part of the run's evidence");
  assert.ok(!r2.offer.items.some((x) => x.dataset.atlas_id === "wreck"), "not offered again");
  assert.match(r2.replaces.diff.lines.join(" "), /This run also judged what you brought in: Worldwide wreck locations/);
  assert.ok(atlasCalls.slice(before).some(([tool, a]) => tool === "fetch_features" && a.id === "wreck" && a.limit === 500));
});

console.log(`${passed} ntrrun tests passed`);
