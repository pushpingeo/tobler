// Relevance classes set in code (js/relevance.js, package E): the badge, order and headline of a constraints screen
// without the analyst's severity or confidence. The last tests replay three saved gate runs and check they read the
// way Rob approved on 27 Nov (claude/package-e-samples-2026-11-27.md).
import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyEvidence, relevanceOf, checkMaps, compareFlags, relevanceLine, sourceNote, headlineOf, headlineText, shortLabel, CLASSES } from "../js/relevance.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
const m = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${Math.round(km * 10) / 10} km`);

const checks = [
  { id: "bio.sssi", label: "Nationally designated sites (SSSI and equivalents)", must: true, reach_km: 2, state: "found", features: [{ fid: "E1" }] },
  { id: "material.pipelines", label: "Pipelines", must: false, reach_km: 0.5, state: "found", features: [{ fid: "E2" }, { fid: "E9" }] },
  { id: "water.flood-zones", label: "Flood zones (rivers and sea)", must: true, reach_km: 1, state: "found", reached_by: ["water"], features: [{ fid: "E3" }] },
  { id: "landscape.wind", label: "Existing wind turbines", must: false, reach_km: 20, reach_from: "person", reach_default_km: 10, state: "found", features: [{ fid: "E4" }] },
  { id: "heritage.listed", label: "Listed buildings", must: true, reach_km: 0.5, state: "not_checked" },
];
const ctx = checkMaps(checks);
const ev = (o) => ({ traced: true, dataset: "A dataset", ...o });

test("on the site, crossing it or covering it is on site", () => {
  for (const relation of ["within", "crosses", "covers"]) assert.equal(classifyEvidence(ev({ fid: "E1", relation, distance_km: 0 }), ctx).class, "on_site");
});
test("within 50 m outside is at edge; 80 m is in range", () => {
  assert.equal(classifyEvidence(ev({ fid: "E2", relation: "adjacent", distance_km: 0.03 }), ctx).class, "at_edge");
  assert.equal(classifyEvidence(ev({ fid: "E2", relation: "outside", distance_km: 0.08 }), ctx).class, "in_range");
});
test("a check that found something on the site is on site, and keeps its own words", () => {
  const r = classifyEvidence(ev({ ref: "water.flood-zones", check: "water.flood-zones", name: "Flood zones (rivers and sea): on the site: Flood Zone 3 (4%)", distance_km: 0 }), ctx);
  assert.equal(r.class, "on_site"); assert.equal(r.said, "on the site: Flood Zone 3 (4%)");
});
test("further than the check's reach is beyond range", () => {
  assert.equal(classifyEvidence(ev({ fid: "E9", relation: "outside", distance_km: 0.9 }), ctx).class, "beyond_range");
});
test("only a distance the person widened is extended; inside the default it's in range", () => {
  assert.equal(classifyEvidence(ev({ fid: "E4", relation: "outside", distance_km: 15 }), ctx).class, "extended");
  assert.equal(classifyEvidence(ev({ fid: "E4", relation: "outside", distance_km: 5 }), ctx).class, "in_range");
});
test("off the site, a check reached only by water is pathway-dependent; on the site it isn't", () => {
  const off = classifyEvidence(ev({ fid: "E3", relation: "outside", distance_km: 0.4 }), ctx);
  assert.equal(off.class, "pathway");
  assert.match(relevanceLine(off, m), /Pathway-dependent: by water\./);
  assert.equal(classifyEvidence(ev({ fid: "E3", relation: "within", distance_km: 0 }), ctx).class, "on_site");
});
test("search-area evidence is its own direct class and never reads as on the site", () => {
  const r = classifyEvidence(ev({ fid: "E1", in_search_area: true, coverage: 0.2, distance_km: 0 }), ctx);
  assert.equal(r.class, "in_search_area");
  assert.equal(relevanceLine(r, m), "Nationally designated sites: in the search area, covering 20% of it.");
  assert.ok(!/\bon (the )?site\b/i.test(relevanceLine(r, m)));
});
test("a flag takes the class of its closest traced evidence", () => {
  const rel = relevanceOf([ev({ fid: "E2", relation: "outside", distance_km: 0.3 }), ev({ fid: "E1", relation: "crosses", distance_km: 0, site_share: 0.05 }), { fid: "E3", traced: false }], ctx);
  assert.equal(rel.class, "on_site"); assert.equal(rel.check, "bio.sssi"); assert.equal(rel.must, true);
  assert.equal(relevanceOf([{ ref: "x", traced: false }], ctx), null);
});
test("order: class, then nearest, then must-checks, then topic order; severity plays no part", () => {
  const f = (id, cls, km, must, theme, severity) => ({ id, theme, nearest_km: km, severity, relevance: { class: cls, must } });
  const flags = [f("a", "in_range", 0.08, false, "material-assets", "high"), f("b", "on_site", 0, false, "land-use", "low"), f("c", "on_site", 0, true, "water", "low"),
    f("d", "in_range", 0.19, true, "heritage", "high"), f("e", "on_site", 0, false, "biodiversity", "low")];
  flags.forEach((x, i) => { x._i = i; });
  assert.deepEqual(flags.sort(compareFlags(["biodiversity", "water", "land-use", "heritage", "material-assets"])).map((x) => x.id), ["c", "e", "b", "a", "d"]);
});
test("the class line names the range it was measured against", () => {
  const r = classifyEvidence(ev({ fid: "E2", relation: "outside", distance_km: 0.078 }), ctx);
  assert.equal(relevanceLine(r, m), "Pipelines: 78 m away, within the 500 m range for pipelines.");
  assert.equal(shortLabel("Nationally designated sites (SSSI and equivalents)"), "Nationally designated sites");
  assert.match(relevanceLine({ class: "in_range", label: "Special Areas of Conservation", distance_km: 18.3, reach_km: 50 }, m), /range for Special Areas of Conservation\.$/);
});
test("the source note comes from the closest evidence, with the dataset's own caveat", () => {
  const flag = { evidence: [ev({ fid: "E2", dataset: "OpenStreetMap: pipelines (completeness varies)", publisher: "OpenStreetMap contributors" }), ev({ fid: "E5", dataset: "Another" })] };
  flag.relevance = relevanceOf(flag.evidence, ctx);
  assert.equal(sourceNote(flag), "Source: OpenStreetMap: pipelines (completeness varies), and 1 other source.");
});
test("headline: what's on the site, how many more in range, what couldn't be answered", () => {
  const flags = [{ relevance: { class: "on_site", label: "Flood zones (rivers and sea)" } }, { relevance: { class: "at_edge", label: "Pipelines" } }, { relevance: { class: "in_range", label: "Listed buildings" } }];
  const h = headlineOf(flags, checks);
  assert.equal(headlineText(h), "On the site or at its edge: Flood zones and pipelines. 1 more flag within range. 1 of 5 checks couldn't be answered, 1 of them must-checks.");
  assert.equal(headlineText(headlineOf([], checks.slice(0, 4))), "No flags raised. All 4 checks answered.");
  assert.ok(!/major issue|severity|confidence/i.test(headlineText(h)));
});

// The three runs Rob approved: the order he saw (by the ids those runs had then).
const dir = new URL("../eval/replay/runs/gate-2026-11-27-size-keeps/", import.meta.url);
const approved = { R6: ["F-01", "F-03", "F-02", "F-05", "F-08", "F-06", "F-04", "F-07"], R17: ["F-01", "F-04", "F-03", "F-02", "F-05", "F-08", "F-06", "F-07"], R19: ["F-02", "F-04", "F-05", "F-01", "F-06", "F-03", "F-07"] };
for (const [site, order] of Object.entries(approved)) {
  test(`${site} reads in the order Rob approved`, () => {
    const r = JSON.parse(fs.readFileSync(new URL(`${site}.json`, dir))).record.tobler_run;
    const maps = checkMaps(r.checks);
    const flags = r.flags.map((f, i) => ({ ...f, _i: i, relevance: relevanceOf(f.evidence, maps) }));
    flags.sort(compareFlags(Object.keys(r.topic_labels)));
    assert.deepEqual(flags.map((f) => f.id), order);
    assert.ok(flags.every((f) => CLASSES[f.relevance?.class]));
  });
}

// The far end (lesson 8): a screen ordered by relevance reads without any rating in the reply, the report rows, the
// headline and the share link. R19 as it would be recorded now.
const { screenReply } = await import("../js/runreply.js");
const { findingRows, decisionText } = await import("../js/report.js");
const { slimRun } = await import("../js/share.js");
const { findingId } = await import("../js/ntrrun.js");
const rec19 = JSON.parse(fs.readFileSync(new URL("R19.json", dir))).record;
{
  const r = rec19.tobler_run; const maps = checkMaps(r.checks);
  r.flags = r.flags.map(({ severity, confidence, ...f }, i) => ({ ...f, _i: i, relevance: relevanceOf(f.evidence, maps) })).sort(compareFlags(Object.keys(r.topic_labels)))
    .map(({ _i, ...f }, i) => ({ ...f, id: findingId(i) }));
  r.order = "relevance"; r.headline = headlineOf(r.flags, r.checks); r.decision = null;
}
test("the reply leads with the headline and gives each flag's class line, with no rating", () => {
  const t = screenReply(rec19);
  assert.match(t, /^\*\*Constraints screen of Learielaw BESS, near Broxburn \(R1\)\.\*\* On the site or at its edge: Surface water flooding, farmland grade and main roads\. 4 more flags within range\./);
  assert.match(t, /The first 3 of 7 flags, on the site first:\n- F-01 Surface water flooding/);
  assert.ok(!/major issue|severity|confidence|most serious/i.test(t), t);
});
test("F numbers follow the card's order", () => {
  assert.deepEqual(rec19.tobler_run.flags.map((f) => f.id), ["F-01", "F-02", "F-03", "F-04", "F-05", "F-06", "F-07"]);
  assert.match(rec19.tobler_run.flags[3].risk, /Gas pipeline/);
});
test("the report's rows carry the class and source note; its decision line is the headline", () => {
  const rows = findingRows(rec19.tobler_run);
  assert.equal(rows[3].relevance_badge, "In range");
  assert.match(rows[3].source_note, /^Source: OpenStreetMap: pipelines/);
  assert.equal(rows[3].severity, undefined);
  const d = decisionText(rec19.tobler_run);
  assert.ok(d.headline && /^On the site or at its edge/.test(d.head));
});
test("the share link keeps the order, the headline and each flag's class", () => {
  const slim = slimRun(rec19).tobler_run;
  assert.equal(slim.order, "relevance");
  assert.equal(slim.headline.direct, 3);
  assert.equal(slim.flags[3].relevance.class, "in_range");
  assert.ok(!("severity" in slim.flags[0]) && !("confidence" in slim.flags[0]));
});

console.log(`relevance: ${passed} passed`);
