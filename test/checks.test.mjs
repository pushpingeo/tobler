// Tests for checks as data (catalogue/checks.json, js/checks.js) and the decision rule restated in terms of checks.
// The run's own use of the checks (fetching, the analyst's lines, the record) is tested in ntrrun.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as K from "../js/checks.js";
import { settleDecision } from "../js/industry.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const cat = JSON.parse(readFileSync(new URL("../catalogue/checks.json", import.meta.url), "utf8"));
const box = (lon, lat, d = 0.05) => [lon - d, lat - d, lon + d, lat + d];
const ids = (plans) => plans.map((p) => p.check.id);

await test("the catalogue: twelve topics plus Indigenous Peoples for global work; every check sound", () => {
  const topics = cat.topics.map((t) => t.id);
  assert.equal(topics.filter((t) => t !== "indigenous").length, 12);
  assert.ok(topics.includes("topography") && topics.includes("hazards"));
  assert.deepEqual(Object.keys(cat.scales).filter((k) => k !== "about"), ["local", "regional", "global"]);
  assert.deepEqual(cat.scales.global, [10, 20, 50, 100]);
  const seen = new Set();
  for (const c of cat.checks) {
    assert.ok(!seen.has(c.id), `${c.id} is unique`); seen.add(c.id);
    assert.ok(topics.includes(c.topic), `${c.id}: topic ${c.topic}`);
    assert.ok(["count_by_band", "value_at_site", "inside"].includes(c.answer), `${c.id}: answer`);
    assert.ok(c.sources.length, `${c.id} has sources`);
    if (c.answer === "value_at_site") assert.equal(c.reach_km, null, `${c.id}: values read the site`);
    else for (const s of ["local", "regional", "global"]) assert.ok(s in c.reach_km, `${c.id}: reach at ${s}`);
    for (const s of c.sources) {
      assert.ok(s.atlas_id || s.tool || s.pending, `${c.id}: each source is an atlas layer, a tool or pending`);
      if (s.atlas_id) { assert.match(s.atlas_id, /^[0-9a-f]{16}$/); assert.ok(s.record?.title && s.record?.publisher && s.record?.licence && s.record?.as_of, `${c.id}: record kept`); }
    }
  }
});

await test("scale from the screening distances and the site's size", () => {
  assert.equal(K.screenScale({ wider: 5 }), "local");
  assert.equal(K.screenScale({ wider: 10 }), "local");
  assert.equal(K.screenScale({ wider: 20 }), "regional");
  assert.equal(K.screenScale({ wider: 50 }), "global");
  assert.equal(K.screenScale({ wider: 20 }, 150), "global", "a big licence is global whatever its distances");
});

await test("bands inside a reach, and their labels", () => {
  assert.deepEqual(K.bandsFor(cat.scales.regional, 10), [2, 5, 10]);
  assert.deepEqual(K.bandsFor(cat.scales.regional, 7), [2, 5, 7]);
  assert.deepEqual(K.bandsFor(cat.scales.local, 2), [0.05, 0.25, 0.5, 2]);
  assert.deepEqual(K.bandsFor(cat.scales.local, 0), []);
  assert.equal(K.bandLabel(0, 0.05), "0–50 m");
  assert.equal(K.bandLabel(0.05, 0.25), "50–250 m");
  assert.equal(K.bandLabel(0.5, 2), "500 m–2 km");
  assert.equal(K.bandLabel(2, 5), "2–5 km");
});

await test("selection by setting, region and scale; sources by country and box", () => {
  // Onshore in the Netherlands, regional: the EU Natura layers, CDDA, US habitat and sea checks left out.
  const nl = K.planChecks(cat, { bbox: box(4.93, 51.49), countries: ["Netherlands"], offshore: false, sea: false }, "regional");
  assert.deepEqual(ids(nl), ["bio.sac", "bio.spa", "bio.national-sites", "topo.elevation", "context.boundaries"]);
  assert.equal(nl[0].source.atlas_id, "2764f9d94e700980");
  assert.equal(nl[0].reach_km, 10);
  // Onshore in Scotland: the UK source wins (pending), not the EU layer that no longer holds UK sites.
  const sc = K.planChecks(cat, { bbox: box(-3.6, 55.97), countries: ["United Kingdom"], offshore: false, sea: false }, "local");
  assert.ok(sc[0].source.pending);
  assert.equal(sc[0].reach_km, 2);
  // Northern France, inside the UK's sea box: the country decides on land.
  const fr = K.planChecks(cat, { bbox: box(1.85, 50.9), countries: ["France"], offshore: false, sea: true }, "regional");
  assert.equal(fr[0].source.atlas_id, "2764f9d94e700980");
  // Offshore UK North Sea: matched on the box.
  const ns = K.planChecks(cat, { bbox: box(1.9, 54.8, 0.3), countries: [], offshore: true, sea: true }, "global");
  assert.ok(ns.find((p) => p.check.id === "bio.sac").source.pending);
  assert.ok(ids(ns).includes("topo.water-depth") && !ids(ns).includes("topo.elevation"));
  // Offshore Dutch waters: the EU layer.
  assert.equal(K.planChecks(cat, { bbox: box(3.5, 53.5), countries: [], offshore: true, sea: true }, "global").find((p) => p.check.id === "bio.sac").source.atlas_id, "2764f9d94e700980");
  // Kenya onshore: Natura doesn't apply at all; national sites apply but have no source here.
  const ke = K.planChecks(cat, { bbox: box(36.8, -1.3), countries: ["Kenya"], offshore: false, sea: false }, "regional");
  assert.ok(!ids(ke).includes("bio.sac"));
  const nat = ke.find((p) => p.check.id === "bio.national-sites");
  assert.equal(nat.source, null);
  assert.equal(K.unsourced(nat).reason, "no_source");
  // Tropical sea: coral reefs apply; marine mammal areas have no reach at local scale.
  const tr = K.planChecks(cat, { bbox: box(39.5, -4), countries: [], offshore: true, sea: true }, "local");
  assert.ok(!ids(tr).includes("bio.marine-mammal-areas") && !ids(tr).includes("bio.coral-reefs"), "no local reach");
  assert.ok(ids(K.planChecks(cat, { bbox: box(39.5, -4), countries: [], offshore: true, sea: true }, "regional")).includes("bio.coral-reefs"));
  // Inside only: every count looks inside.
  assert.ok(K.planChecks(cat, { bbox: box(4.93, 51.49), countries: ["Netherlands"], offshore: false, sea: false }, "regional", { inside: true }).filter((p) => p.reach_km != null).every((p) => p.reach_km === 0));
});

const plan = (id, scale = "regional", reach) => {
  const check = cat.checks.find((c) => c.id === id);
  return { check, source: check.sources.at(-1), reach_km: reach ?? check.reach_km?.[scale] ?? null, scale };
};

await test("every state: found by band, none found, not checked for each reason", () => {
  const sac = plan("bio.sac");
  const f = K.fromFeatures(sac, [
    { name: "Inside SAC", distance_km: 0 }, { name: "Near SAC", distance_km: 1.5 }, { name: "Mid SAC", distance_km: 6 },
    { name: "Beyond", distance_km: 15 }, { name: "Wide area", distance_km: 0, around_site: true }], cat.scales.regional,
  { dataset: "Natura", publisher: "EEA", licence: "attribution", checked_at: "2026-11-23", fetched_km: 20 });
  assert.equal(f.state, "found");
  assert.equal(f.count, 4, "beyond the reach isn't counted");
  assert.deepEqual(f.bands.map((b) => [b.label, b.count]), [["on site", 1], ["0–2 km", 1], ["2–5 km", 0], ["5–10 km", 1]]);
  assert.equal(f.around, 1);
  assert.equal(f.nearest.name, "Inside SAC");
  assert.equal(f.source.publisher, "EEA");
  assert.equal(K.checkLine(f), "4 within 10 km (1 on site, 1 at 0–2 km, 1 at 5–10 km, 1 around the site); nearest Inside SAC (on site)");
  const n = K.fromFeatures(sac, [{ name: "Far", distance_km: 30 }], cat.scales.regional, { fetched_km: 20 });
  assert.equal(n.state, "none");
  assert.equal(K.checkLine(n), "none found within 10 km");
  // Reach longer than the tools fetch: cut, and said.
  const b = K.fromFeatures(plan("context.boundaries", "global"), [{ name: "Belgium", distance_km: 40 }], cat.scales.global, { fetched_km: 50 });
  assert.equal(b.reach_km, 50);
  assert.match(K.checkLine(b), /within 50 km \(of 100 km: the tools fetch to 50 km\)/);
  // Not checked: licence, failure, pending, no source.
  const lic = K.notChecked(plan("bio.marine-protected"), "This dataset's licence is non-commercial (e.g. WDPA). Tobler leaves it out unless the person switches on non-commercial data in settings.");
  assert.equal(lic.state, "not_checked"); assert.equal(lic.reason, "licence");
  assert.doesNotMatch(lic.why, /Tobler leaves/, "first sentence only");
  assert.equal(K.notChecked(sac, "The publisher's service didn't answer: 503").reason, "failed");
  assert.equal(K.unsourced({ ...sac, source: cat.checks[0].sources[0] }).reason, "pending");
  assert.match(K.checkLine(K.unsourced({ ...sac, source: null })), /^not checked: no source for this region$/);
  // Inside.
  const m = K.fromFeatures(plan("material.marpol-special-areas"), [{ name: "North West European waters", distance_km: 0, around_site: true }], [], {});
  assert.equal(m.inside, true);
  assert.equal(K.checkLine(m), "the site is inside North West European waters (a wide area it lies within)");
  assert.equal(K.checkLine(K.fromFeatures(plan("material.marpol-special-areas"), [], [], {})), "the site isn't inside one");
  // A search area is never "on site".
  assert.equal(K.checkLine({ ...f, search_area: true }), "4 within 10 km (1 in the search area, 1 at 0–2 km, 1 at 5–10 km, 1 around the site); nearest Inside SAC (in the search area)");
  // Values.
  const v = K.fromValue(plan("topo.elevation"), { text: "about 25 m", meta: { dataset: "DEM", publisher: "NOAA" } });
  assert.equal(K.checkLine(v), "about 25 m");
});

await test("topics with no check, the summary lines, and grouping by topic", () => {
  const rs = [K.fromFeatures(plan("bio.sac"), [], cat.scales.regional, {}), K.fromValue(plan("topo.elevation"), { text: "x" })];
  const left = K.uncheckedTopics(cat, rs, "regional");
  assert.ok(!left.includes("biodiversity") && !left.includes("topography") && !left.includes("indigenous"));
  assert.ok(K.uncheckedTopics(cat, rs, "global").includes("indigenous"), "Indigenous Peoples for global work");
  assert.match(K.noCheckLine(cat, left), /^10 topics have no standard check yet: water, ground and soil/);
  assert.equal(K.noCheckLine(cat, []), null);
  assert.deepEqual(K.byTopic(cat, [rs[1], rs[0]]).map((g) => g.label), ["Biodiversity", "Topography and bathymetry"]);
  assert.equal(K.checksSummary([...rs, K.notChecked(plan("bio.spa"), "down")]), "Checks: 3 (1 found, 1 none found, 1 not checked)");
});

await test("the decision rule: insufficient evidence when every must-check for a topic was not checked", () => {
  const nc = (id) => K.notChecked(plan(id), "down");
  const none = (id) => K.fromFeatures(plan(id), [], cat.scales.regional, {});
  const all = [nc("bio.sac"), nc("bio.spa"), nc("bio.national-sites"), none("context.boundaries")];
  assert.deepEqual(K.topicsShort(all), ["biodiversity"]);
  const d = settleDecision({ value: "progress", why: "" }, { checks: all, topicLabel: (t) => K.topicLabel(cat, t) });
  assert.equal(d.value, "insufficient evidence");
  assert.match(d.changed, /none of the must-checks for biodiversity could be checked/);
  // One must-check reached is enough; a non-must failure never decides.
  const one = [nc("bio.sac"), nc("bio.spa"), none("bio.national-sites"), nc("context.boundaries")];
  assert.deepEqual(K.topicsShort(one), []);
  assert.equal(settleDecision({ value: "progress", why: "" }, { checks: one }).value, "progress");
  const up = settleDecision({ value: "insufficient evidence", why: "" }, { checks: one, flags: [] });
  assert.equal(up.value, "progress with targeted investigation");
  assert.match(up.changed, /must-checks were reached/);
  assert.equal(settleDecision({ value: "major issue", why: "" }, { checks: all }).value, "major issue", "something serious stays");
  // Pending and no-source count as not checked.
  assert.deepEqual(K.topicsShort([K.unsourced({ ...plan("bio.sac"), source: cat.checks[0].sources[0] })]), ["biodiversity"]);
  // A run from before checks keeps the old rule.
  assert.equal(settleDecision({ value: "progress", why: "" }, { checked: [] }).value, "insufficient evidence");
  assert.equal(settleDecision({ value: "progress", why: "" }, { checked: [{ evidence: "biodiversity", result: "none in dataset" }] }).value, "progress");
});

await test("a re-run says which checks changed", () => {
  const a = [K.fromFeatures(plan("bio.sac"), [], cat.scales.regional, {}), K.notChecked(plan("bio.spa"), "down")];
  const b = [K.fromFeatures(plan("bio.sac"), [{ name: "X SAC", distance_km: 3 }], cat.scales.regional, {}), K.notChecked(plan("bio.spa"), "down"), K.fromValue(plan("topo.elevation"), { text: "about 5 m" })];
  assert.deepEqual(K.checksChanged(a, b), [
    "Special Areas of Conservation: none found within 10 km → 1 within 10 km (1 at 2–5 km); nearest X SAC, 3 km",
    "Elevation: new check, about 5 m",
  ]);
  assert.deepEqual(K.checksChanged(b, a).at(-1), "Elevation: not run this time (was about 5 m)");
});

console.log(`${passed} checks tests passed`);
