// Share links and the report (js/share.js, js/report.js): what travels in a link, that it comes back the same, and
// what the report shows from it.
import assert from "node:assert/strict";
import { slimRun, encodeRun, decodeRun, shareCode, simplifyGeometry, SHARE_PREFIX } from "../js/share.js";
import { findingLabels, findingRows, evidenceRows, sourcesOf, summaryBlocks, decisionText, changeLog, checksOf, gapsOf } from "../js/report.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };

const square = (x, y, d) => ({ type: "Polygon", coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
const wiggly = (n) => ({ type: "LineString", coordinates: Array.from({ length: n }, (_, i) => [-1 + i * 1e-4, 55 + Math.sin(i) * 1e-6]) });
const ev = (fid, name, geometry, extra = {}) => ({ type: "Feature", geometry, properties: { role: "evidence", fid, name, theme: "heritage", distance_km: 1.2, band: "near", dataset: "Wrecks", publisher: "UKHO", licence: "OGL", checked_at: "2026-11-20T10:00:00Z", run: "R1", details: { big: "x".repeat(500) }, ...extra } });
const record = () => ({
  type: "FeatureCollection",
  tobler_run: {
    schema: "tobler-run/1", id: "R1", kind: "ntr-screen", skill: { name: "ntr-screening", version: "3.8-draft" }, model: "claude-haiku-5-5", industry: "energy",
    started_at: "2026-11-20T10:00:00Z", finished_at: "2026-11-20T10:01:00Z",
    decision: { value: "progress with targeted investigation", why: "A wreck needs a survey." },
    site: { name: "Area 1", summary: "1 km² offshore", asset_label: "Offshore wind", asset_assumed: false, stage: "greenfield", setting: "offshore", footprint: "screened on the area itself", how_found: "drawn" },
    extent: "around", distances: { near: 2, close: 10, wider: 50, reasons: ["default"] }, fetched_to_km: 50, assessed_within_km: 50, method: "Geodesic.",
    flags: [
      { id: "F-01", risk: "Wreck nearby", theme: "heritage", severity: "medium", confidence: "medium", why: "heritage", next_step: "Marine archaeology review", nearest_km: 1.2, fids: ["E1"],
        evidence: [{ name: "TROLDFOS", distance_km: 1.2, band: "near", dataset: "Wrecks", publisher: "UKHO", licence: "OGL", checked: "2026-11-20T10:00:00Z", traced: true, fid: "E1" }] },
      { id: "F-02", risk: "Cable on the route", theme: "community", severity: "low", confidence: "high", why: "", next_step: "", nearest_km: 0, fids: ["E1", "E2"],
        evidence: [{ name: "Cable", distance_km: 0, dataset: "Cables", publisher: "KIS-ORCA", traced: true, fid: "E2" }, { name: "Made up", distance_km: 3, traced: false }] },
    ],
    checked: [{ dataset: "Wrecks", publisher: "UKHO", licence: "OGL", result: "features", count: 3 }, { dataset: "Cables", publisher: "KIS-ORCA", result: "features", count: 1 },
      { dataset: "Seabed habitats", publisher: "EMODnet", result: "not checked", why: "timed out" }, { dataset: "Coral", publisher: "UNEP-WCMC", result: "none in dataset" }],
    data_gaps: ["Seabed habitats not checked", "Stage assumed"], summary: "**Decision:** progress.\n\n- Wreck at 1.2 km\n- Cable on site\n\nMore text.",
    disclaimer: "Indicative.", calls: [{ big: "y".repeat(5000) }], usage: { input_tokens: 9 }, debug: { raw: "z" },
    assessments: [{ at: "2026-11-20T10:05:00Z", within_km: 10, flags: [{}, {}, {}], decision: { value: "major issue" } }],
  },
  features: [
    { type: "Feature", geometry: square(-1, 55, 0.01), properties: { role: "site", name: "Area 1", run: "R1" } },
    ev("E1", "TROLDFOS", { type: "Point", coordinates: [-0.98123456, 55.02123456] }),
    ev("E2", "Cable", wiggly(400), { theme: "community" }),
    ev("E3", "Unflagged wreck", { type: "Point", coordinates: [-0.9, 55.1] }),
  ],
});

await test("a share link holds the site and the evidence behind the flags, not everything fetched or the run's workings", () => {
  const s = slimRun(record(), { now: () => "2026-11-20T11:00:00Z" });
  assert.deepEqual(s.features.map((f) => f.properties.fid || f.properties.role), ["site", "E1", "E2"]);
  assert.equal(s.tobler_run.calls, undefined); assert.equal(s.tobler_run.usage, undefined); assert.equal(s.tobler_run.debug, undefined);
  assert.equal(s.features[1].properties.details, undefined, "bulky details left out");
  assert.deepEqual(s.features[1].geometry.coordinates, [-0.98123, 55.02123], "coordinates to about a metre");
  assert.ok(s.features[2].geometry.coordinates.length < 50, "a wiggly line is simplified for display");
  assert.equal(s.tobler_run.evidence_total, 3);
  assert.match(s.tobler_run.shared.evidence, /2 features behind the flags, of 3 found/);
  assert.equal(s.tobler_run.assessments[0].flags, 3);
  assert.equal(s.tobler_run.decision.value, "progress with targeted investigation");
});

await test("a link round-trips exactly, and says when it's long", async () => {
  const s = slimRun(record(), { now: () => "x" });
  const code = await encodeRun(s);
  assert.ok(code.startsWith(SHARE_PREFIX) && /^[A-Za-z0-9._-]+$/.test(code), "URL-safe");
  assert.deepEqual(await decodeRun(`#${code}`), s);
  const sc = await shareCode(record());
  assert.ok(sc.chars < 3000 && !sc.long && !sc.tooLong, `small run, short link (${sc.chars})`);
  await assert.rejects(decodeRun("#hello"), /isn't a Tobler report link/);
});

await test("simplifying keeps polygons closed and valid", () => {
  const g = simplifyGeometry(square(0, 0, 1), 5);
  assert.equal(g.coordinates[0].length, 4);
  assert.deepEqual(g.coordinates[0][0], g.coordinates[0].at(-1));
});

await test("the report: numbered labels on the features, one row per finding, failures first, sources once", () => {
  const rec = record();
  const labels = findingLabels(rec);
  assert.deepEqual(labels.features.map((f) => f.properties.label), ["F-01, F-02", "F-02"], "a feature behind two flags carries both IDs");
  const rows = findingRows(rec.tobler_run);
  assert.equal(rows[0].id, "F-01"); assert.equal(rows[0].severity, "medium"); assert.equal(rows[0].next_step, "Marine archaeology review");
  assert.match(rows[0].theme, /Cultural heritage \(PS8\)/);
  assert.equal(rows[1].evidence[1].traced, false);
  const evr = evidenceRows(rec.tobler_run);
  assert.equal(evr[0].source, "Seabed habitats"); assert.ok(evr[0].failed);
  assert.equal(evr.at(-1).result, "none in dataset");
  assert.deepEqual(sourcesOf(rec).map((x) => x.dataset), ["Cables", "Coral", "Wrecks"]);
  assert.deepEqual(decisionText(rec.tobler_run), { head: "Progress with targeted investigation.", why: "A wreck needs a survey." });
  assert.deepEqual(decisionText({ decision: { value: "insufficient evidence", why: "Nothing found.", changed: "from progress: no biodiversity source could be checked" } }),
    { head: "Insufficient evidence.", why: "Nothing found. Set by Tobler's rules, from progress: no biodiversity source could be checked." }, "a decision changed by the rules says so in the report");
  assert.deepEqual(summaryBlocks(rec.tobler_run.summary), [{ text: "Decision: progress." }, { list: true, items: ["Wreck at 1.2 km", "Cable on site"] }, { text: "More text." }]);
  assert.deepEqual(changeLog(rec.tobler_run), [{ at: "2026-11-20 10:05", within_km: 10, flags: 3, decision: "major issue" }]);
});

await test("checks travel in a share link and the report shows them by topic; old links have none", async () => {
  const rec = record();
  assert.equal(checksOf(rec.tobler_run), null, "a tobler-run/1 link: no checks section");
  Object.assign(rec.tobler_run, {
    schema: "tobler-run/2", checks_scale: "global", no_check_topics: ["heritage", "water"],
    topic_labels: { biodiversity: "Biodiversity", heritage: "Heritage", water: "Water", topography: "Topography and bathymetry" },
    checks: [
      { id: "topo.water-depth", topic: "topography", label: "Water depth", must: false, answer: "value_at_site", scale: "global", state: "found", text: "about 30 m", source: { tool: "depth", dataset: "DEM", publisher: "NOAA" } },
      { id: "bio.sac", topic: "biodiversity", label: "Special Areas of Conservation", must: true, answer: "count_by_band", scale: "global", reach_km: 50, state: "found", count: 2,
        bands: [{ from_km: 0, to_km: 10, label: "0–10 km", count: 1 }, { from_km: 10, to_km: 20, label: "10–20 km", count: 1 }], nearest: { name: "Dogger Bank SAC", distance_km: 4 },
        source: { atlas_id: "2764f9d94e700980", dataset: "Natura 2000", publisher: "EEA", licence: "attribution", checked_at: "2026-11-23T10:00:00Z" }, why_reach: "long text that stays in the full run" },
      { id: "bio.spa", topic: "biodiversity", label: "Special Protection Areas (birds)", must: true, answer: "count_by_band", scale: "global", reach_km: 50, state: "not_checked", reason: "pending", why: "JNCC SPAs, asked of the atlas" },
    ],
  });
  const back = (await decodeRun(`#${await encodeRun(slimRun(rec))}`)).tobler_run;
  assert.equal(back.checks.length, 3);
  assert.equal(back.checks[1].source.atlas_id, "2764f9d94e700980");
  assert.equal(back.checks[1].why_reach, undefined, "only what the report needs travels");
  const v = checksOf(back);
  assert.equal(v.summary, "Checks: 3 (2 found, 1 not checked)");
  assert.deepEqual(v.groups.map((g) => g.label), ["Biodiversity", "Topography and bathymetry"], "the catalogue's topic order");
  assert.equal(v.groups[0].items[0].line, "2 within 50 km (1 at 0–10 km, 1 at 10–20 km); nearest Dogger Bank SAC, 4 km");
  assert.equal(v.groups[0].items[0].source, "Natura 2000 (EEA)");
  // Several sources travel too, and the report names them all.
  rec.tobler_run.checks[1].sources = [{ region: "Scotland", atlas_id: "7d382e1686a08bff", dataset: "SAC, Scotland", publisher: "NatureScot", licence: "OGL", state: "answered", why_extra: "x" },
    { region: "UK offshore", atlas_id: "1d6371b702df0abc", dataset: "UK offshore MPAs", publisher: "JNCC", state: "answered" }];
  const back2 = (await decodeRun(`#${await encodeRun(slimRun(rec))}`)).tobler_run;
  assert.equal(back2.checks[1].sources[0].why_extra, undefined);
  assert.equal(checksOf(back2).groups[0].items[0].source, "SAC, Scotland (NatureScot); UK offshore MPAs (JNCC)");
  assert.equal(v.groups[0].items[1].line, "not checked: JNCC SPAs, asked of the atlas");
  assert.match(v.noCheck.line, /^2 topics have no standard check yet: heritage, water$/);
  assert.match(gapsOf(back).couldnt[0], /^No standard check yet for heritage, water/);
});

console.log(`${passed} report tests passed`);
