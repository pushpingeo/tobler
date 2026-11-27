// The replay gate's scoring (scripts/replay-score.mjs), on made-up run records. The real replay set's answers are
// in eval/replay/ and aren't read here.
import assert from "node:assert/strict";
import { checksFor, sameName, nameTokens, inPlace, scoreFact, scoreSite, regressions, gateReport, belowThreshold } from "../scripts/replay-score.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

const ev = (name, dataset, km) => ({ type: "Feature", geometry: null, properties: { role: "evidence", name, dataset, distance_km: km } });
const record = (checks, evidence = []) => ({ tobler_run: { checks }, features: [{ type: "Feature", properties: { role: "site" } }, ...evidence] });
const chk = (id, state, dataset, extra = {}) => ({ id, state, reach_km: 10, sources: [{ dataset, state: state === "not_checked" ? "not_checked" : "answered" }], ...extra });
const fact = (o) => ({ feature: "X", kind: "SAC", relation: "on_site", distance_km: null, weight: "must", ...o });

test("kinds map to checks; combined kinds take both; unknown kinds have none", () => {
  assert.deepEqual(checksFor("SAC / SSSI").ids, ["bio.sac", "bio.national-sites"]);
  assert.equal(checksFor("SAC / SSSI").mode, "name");
  assert.equal(checksFor("homes").mode, "class");
  assert.deepEqual(checksFor("core path").ids, []);
  assert.deepEqual(checksFor("potential SPA").ids, ["bio.spa"]);
});

test("names match on their distinctive words, not the designation words", () => {
  assert.ok(sameName("Caithness and Sutherland Peatlands SAC", "Caithness & Sutherland Peatlands"));
  assert.ok(sameName("East Halladale Flows Wild Land Area", "East Halladale Flows"));
  assert.ok(sameName("Halladale Bridge hut circles (SM3304)", "Halladale Bridge, hut circles 700m NNW of"));
  assert.ok(!sameName("Caithness Lochs SPA", "Caithness and Sutherland Peatlands"), "one shared word isn't a match");
  assert.ok(!sameName("A836", "A83"), "road numbers match exactly");
  assert.ok(sameName("Lochgoin Monument (LB12509)", "Lochgoyn Monument"), "a long word may differ by one letter");
  assert.ok(sameName("Thame Lane railway bridge (Grade II)", "Thame Lane Bridge (DCL5657)"), "one extra word in a name of three or more");
  assert.ok(!sameName("Loch Ulagadale", "Loch Ulladale Farm"), "two-word names get no allowance for a missing word");
  assert.ok(!sameName("Moss", "Mose"), "short words must match exactly");
  assert.deepEqual(nameTokens("Residential properties"), ["residential", "properties"]);
  assert.deepEqual(nameTokens("Special Area of Conservation"), []);
});

test("in place: closer than a turbine-measured distance is fine; much further isn't", () => {
  assert.ok(inPlace({ relation: "distance", distance_km: 3 }, 2.1));
  assert.ok(inPlace({ relation: "distance", distance_km: 3 }, 3.8));
  assert.ok(!inPlace({ relation: "distance", distance_km: 3 }, 4.5));
  assert.ok(inPlace({ relation: "adjacent" }, 0.3));
  assert.ok(!inPlace({ relation: "on_site" }, 0.2));
});

test("found, found elsewhere, missed and not checked are told apart", () => {
  const ds = "Special Areas of Conservation (Scotland)";
  const f = fact({ feature: "Caithness and Sutherland Peatlands SAC" });
  assert.equal(scoreFact(f, record([chk("bio.sac", "found", ds)], [ev("Caithness and Sutherland Peatlands", ds, 0)])).outcome, "found");
  assert.equal(scoreFact(f, record([chk("bio.sac", "found", ds)], [ev("Caithness and Sutherland Peatlands", ds, 1.2)])).outcome, "found_elsewhere");
  assert.equal(scoreFact(f, record([chk("bio.sac", "found", ds)], [ev("River Thurso", ds, 2)])).outcome, "missed");
  assert.equal(scoreFact(f, record([chk("bio.sac", "none", ds)])).outcome, "missed");
  assert.equal(scoreFact(f, record([chk("bio.sac", "not_checked", ds, { why: "NatureScot didn't answer" })])).outcome, "not_checked");
  assert.equal(scoreFact(f, record([])).outcome, "check_not_run");
  assert.equal(scoreFact(fact({ kind: "core path" }), record([])).outcome, "no_check");
});

test("evidence counts only from the check's own datasets", () => {
  const f = fact({ feature: "Caithness and Sutherland Peatlands SAC" });
  const r = record([chk("bio.sac", "none", "SACs")], [ev("Caithness and Sutherland Peatlands", "SPAs", 0)]);
  assert.equal(scoreFact(f, r).outcome, "missed", "an SPA of the same name isn't the SAC");
});

test("beyond reach when the check didn't look out as far as the document", () => {
  const f = fact({ kind: "scheduled monument", feature: "The Borg", relation: "within", distance_km: 10 });
  assert.equal(scoreFact(f, record([chk("heritage.scheduled-monuments", "found", "SM", { reach_km: 5 })])).outcome, "beyond_reach");
});

test("class facts: homes by any feature, peat by its classes", () => {
  const homes = fact({ feature: "27 Upper Bighouse (nearest house)", kind: "homes", relation: "distance", distance_km: 1 });
  assert.equal(scoreFact(homes, record([chk("community.homes", "found", "OSM buildings")], [ev("house", "OSM buildings", 0.8)])).outcome, "found");
  const peat = fact({ feature: "Blanket bog", kind: "peat habitat" });
  assert.equal(scoreFact(peat, record([chk("ground.peat", "found", "Carbon and peatland 2016", { classes: [{ label: "Class 1", on_site: true }] })])).outcome, "found");
  assert.equal(scoreFact(peat, record([chk("ground.peat", "found", "Carbon and peatland 2016", { classes: [{ label: "Class 1", on_site: false, nearest_km: 2 }] })])).outcome, "found_elsewhere");
});

test("none expected: agrees, or contradicted by a feature within the distance", () => {
  const f = { feature: "Residential properties", kind: "homes", relation: "absent", distance_km: 1, weight: "none_expected" };
  assert.equal(scoreFact(f, record([chk("community.homes", "found", "B")], [ev("house", "B", 1.6)])).outcome, "agrees");
  assert.equal(scoreFact(f, record([chk("community.homes", "found", "B")], [ev("house", "B", 0.4)])).outcome, "contradicted");
  assert.equal(scoreFact(f, record([chk("community.homes", "not_checked", "B")])).outcome, "not_checked");
});

test("a site's recall leaves gaps out of the denominator, and regressions are found", () => {
  const ds = "SAC";
  const exp = { id: "T1", name: "Test", expected: [
    fact({ feature: "Alpha Moss SAC" }), fact({ feature: "Beta Moss SAC" }), fact({ kind: "core path", feature: "Path" }),
  ] };
  const s1 = scoreSite(exp, record([chk("bio.sac", "found", ds)], [ev("Alpha Moss", ds, 0), ev("Beta Moss", ds, 0)]));
  const s2 = scoreSite(exp, record([chk("bio.sac", "found", ds)], [ev("Alpha Moss", ds, 0)]));
  assert.equal(s1.must.recall, 1);
  assert.equal(s2.must.scored, 2); assert.equal(s2.must.surfaced, 1); assert.equal(s2.must.no_check, 1);
  assert.deepEqual(regressions([s2], [s1]), ["T1: Beta Moss SAC was found, now missed"]);
  assert.deepEqual(regressions([s2], null), []);
  const md = gateReport([s2], { label: "test", regressed: regressions([s2], [s1]) });
  assert.match(md, /1 of 2 that Tobler has a check for \(50%\)/);
  assert.match(md, /T1: \*\*Beta Moss SAC\*\* \(SAC, on site\): missed/);
  // The threshold: a missed must fact fails it; a gap (no check) never does.
  assert.deepEqual(belowThreshold([s1]), []);
  assert.deepEqual(belowThreshold([s2]), ["T1: Beta Moss SAC missed"]);
  assert.match(md, /Threshold \(every must fact with a check surfaced\):\*\* failed, 1 not surfaced/);
  assert.match(gateReport([s1]), /Threshold \(every must fact with a check surfaced\):\*\* met/);
});

console.log(`${n} replay-score tests passed`);
