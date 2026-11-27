// Tests for search distance (package A, 26 Nov): each check's reach is the only search distance, extended by the
// asset table where there's a stated reason, overridden by the person's own distances; one reporting ladder.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as K from "../js/checks.js";
import * as D from "../js/reach.js";
import { toKm } from "../js/units.js";
import { areasNear } from "../js/ukareas.js";
import { budgetRules } from "../js/developable.js";
import { parseSkill } from "../js/converse.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const cat = read("../catalogue/checks.json");
const assets = read("../catalogue/assets.json");
const UK = read("../data/ref/uk-areas.json");
const rules = budgetRules(parseSkill(readFileSync(new URL("../skills/developable-area/SKILL.md", import.meta.url), "utf8")));

// A site as the run sees it, and its plans with the reaches the run would use.
function siteAt(lon, lat, ha, countries = ["United Kingdom"]) {
  const side = Math.sqrt(ha * 1e4) / 2 / 1000;
  const poly = turf.bboxPolygon(turf.bbox(turf.buffer(turf.point([lon, lat]), side, { units: "kilometers" })));
  const bbox = turf.bbox(poly);
  return { poly, area_km2: turf.area(poly) / 1e6, site: { bbox, countries, offshore: false, sea: false, coast_km: 30,
    areas: areasNear(UK, poly, 60, { onLand: countries.includes("United Kingdom") }) } };
}
function planFor(s, { asset_type = "other", planned = null, capacity_mw = null, tip_height_m = null, distances = [], skill = "screen" } = {}) {
  const asset = D.chooseAsset(assets, { asset_type, planned, offshore: false, capacity_mw, tip_height_m, area_km2: s.area_km2 });
  const said = D.readDistances(distances, { catalogue: cat });
  const reaches = D.resolveReaches(cat, { scale: asset.scale, asset, search: said.search });
  const defaults = D.resolveReaches(cat, { scale: asset.scale, asset });
  const plans = K.planChecks(cat, s.site, asset.scale, { skill, reachOf: (id) => reaches.get(id)?.km });
  const reach = D.reachRecord({ asset, scale: asset.scale, plans, reaches, changes: D.changeLines(said.search, plans, defaults), notUsed: said.not_used });
  return { asset, plans, reach, reaches, by: (id) => plans.find((p) => p.check.id === id) };
}

const BARNSTON = siteAt(-3.08, 53.345, 10);
const WIND = siteAt(-4.25, 55.68, 400); // a wind farm on the moors south of Glasgow, like Whitelee

await test("the ladder: within the site, 0–100 m … 30–50 km, closed at a reach; nothing beyond 50 km", () => {
  assert.deepEqual(D.LADDER, [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 50]);
  assert.deepEqual(D.ladderTo(2), [0.1, 0.25, 0.5, 1, 2]);
  assert.deepEqual(D.ladderTo(45), [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 45]);
  assert.deepEqual(D.ladderTo(80), D.LADDER);
  assert.deepEqual(D.ladderTo(0), []);
  assert.equal(D.ladderBand(0, 5), "on site");
  assert.equal(D.ladderBand(0.07, 5), "0–100 m");
  assert.equal(D.ladderBand(0.6, 5), "500 m–1 km");
  assert.equal(D.ladderBand(3, 5), "2–5 km");
  assert.equal(D.ladderBand(6, 5), "beyond");
  assert.equal(D.bandLabel(0.25, 0.5), "250–500 m");
  assert.equal(D.bandLabel(30, 45), "30–45 km");
});

await test("Barnston (10 ha housing): local scale, checks to their own reach, rings stop at the furthest check, no 10 km ring", () => {
  const p = planFor(BARNSTON, { planned: "housing" });
  assert.equal(p.reach.scale, "local");
  assert.equal(p.by("bio.sac").reach_km, 2);
  assert.equal(p.by("community.homes").reach_km, 0.5);
  assert.equal(p.by("heritage.listed-buildings").reach_km, 0.25);
  // The furthest a screen at this scale looks is aerodrome safeguarding (5 km); nature and heritage stop at 2 km.
  assert.equal(p.reach.furthest_km, 5);
  assert.ok(p.plans.every((x) => x.reach_km == null || x.reach_km <= 5));
  assert.deepEqual(p.reach.ladder, [0.1, 0.25, 0.5, 1, 2, 5]);
  assert.ok(!p.reach.ladder.includes(10) && !p.reach.ladder.includes(20));
  assert.equal(p.reach.range, "250 m to 5 km, by check");
  assert.deepEqual(D.runRings({ reach: p.reach }), p.reach.ladder);
  // Bands reported by a 2 km check stop at 2 km.
  const r = K.fromFeatures(p.by("bio.sac"), [{ name: "Dee Estuary", distance_km: 1.4 }], D.LADDER);
  assert.deepEqual(r.bands.map((b) => b.label), ["0–100 m", "100–250 m", "250–500 m", "500 m–1 km", "1–2 km"]);
  assert.match(K.checkLine(r), /^1 within 2 km \(1 at 1–2 km\); nearest Dee Estuary, 1\.4 km$/);
});

await test("an asset with no row runs on the general defaults for its size, and says so", () => {
  const p = planFor(BARNSTON, { planned: "housing" });
  assert.equal(p.reach.asset.row, false);
  assert.match(p.reach.asset.note, /No distances are set for housing yet, so the checks use the general defaults for a site of this size/);
  assert.match(D.reachLine(p.reach), /general defaults for a site of this size/);
  const none = D.chooseAsset(assets, { asset_type: "other", area_km2: 5 });
  assert.equal(none.scale, "regional");
  assert.match(none.note, /No asset type given/);
  assert.equal(D.chooseAsset(assets, { area_km2: 0.5, offshore: true }).scale, "regional");
  assert.equal(D.chooseAsset(assets, { area_km2: 150 }).scale, "global", "a big licence is global whatever it is");
  assert.equal(D.chooseAsset(assets, { area_km2: 150 }).keeps, "regional", "and keeps the checks it would have had");
  assert.equal(D.chooseAsset(assets, { asset_type: "mine", area_km2: 150 }).keeps, "regional");
  assert.equal(D.chooseAsset(assets, { asset_type: "mine", area_km2: 35 }).keeps, "regional", "a size rule that widens keeps what it had");
  assert.equal(D.chooseAsset(assets, { asset_type: "solar", capacity_mw: 2 }).keeps, undefined, "a rule that narrows keeps nothing");
  // A row for one setting only: solar at sea is general too.
  const odd = D.chooseAsset(assets, { asset_type: "solar", offshore: true });
  assert.equal(odd.row, false);
  assert.equal(odd.scale, "global");
});

await test("a large wind farm keeps the regional checks at global scale, each at the further reach (Rob, 27 Nov)", () => {
  const big = D.chooseAsset(assets, { asset_type: "wind-onshore", capacity_mw: 432 });
  const m = D.resolveReaches(cat, { scale: big.scale, asset: big });
  const g = D.resolveReaches(cat, { scale: "global", asset: { ...big, keeps: undefined } });
  for (const id of ["community.homes", "material.main-roads", "heritage.listed-buildings", "water.flood-zones"]) {
    assert.ok(m.has(id), `${id} kept`); assert.ok(!g.has(id), `${id} not at global alone`);
  }
  // Each check takes the further of its two defaults, then the asset's extension: nothing wide is cut.
  for (const [id, r] of g) assert.ok(m.get(id).km >= r.km, `${id} not cut`);
  assert.equal(m.get("heritage.scheduled-monuments").km, 10, "the 10 km heritage extension now applies");
  assert.equal(m.get("community.homes").km, 2);
  const rec = D.reachRecord({ asset: big, scale: big.scale, plans: [], reaches: m });
  assert.equal(rec.keeps, "regional");
});

await test("asset sizes pick the scale and footprint, as distances.json's draft did", () => {
  const s = (x) => D.chooseAsset(assets, x);
  assert.equal(s({ asset_type: "solar", capacity_mw: 2 }).scale, "local");
  assert.equal(s({ asset_type: "solar", capacity_mw: 2 }).footprint_km, 0.3);
  assert.equal(s({ asset_type: "solar", capacity_mw: 300 }).footprint_km, 2);
  assert.equal(s({ asset_type: "solar", capacity_mw: 300 }).scale, "regional");
  assert.equal(s({ asset_type: "wind-onshore", capacity_mw: 150 }).scale, "global");
  assert.equal(s({ asset_type: "wind-onshore", capacity_mw: 150 }).keeps, "regional");
  assert.equal(s({ asset_type: "wind-onshore", capacity_mw: 50 }).keeps, undefined);
  assert.equal(s({ asset_type: "mine", area_km2: 35 }).scale, "global");
  assert.equal(s({ asset_type: "mine", area_km2: 5 }).scale, "regional");
  assert.equal(s({ asset_type: "oil-gas-field", offshore: true }).scale, "global");
  assert.equal(s({ asset_type: "oil-gas-field", offshore: true }).footprint_km, 5);
  assert.equal(s({ asset_type: "substation" }).scale, "local");
  // The tool's list of asset types is the table's rows plus other.
  assert.deepEqual([...D.ASSET_TYPES].sort(), [...Object.keys(assets.assets), "other"].sort());
  for (const [id, a] of Object.entries(assets.assets)) {
    assert.ok(a.label && a.names?.length, `${id}: label and names`);
    for (const e of a.extends || []) {
      assert.ok(e.why && e.source, `${id}: every extension has a reason and a source`);
      for (const c of e.checks || []) assert.ok(cat.checks.some((x) => x.id === c), `${id}: extends ${c}, a real check`);
      assert.ok(e.to_km <= D.MAX_KM);
    }
  }
});

await test("a wind farm: landscape, visual and cumulative look out 45 km; heritage 10 km; watercourses and flood stay local", () => {
  const p = planFor(WIND, { asset_type: "wind-onshore" });
  assert.equal(p.reach.scale, "regional");
  for (const id of ["landscape.national-parks", "landscape.wild-land", "material.wind-turbines"]) {
    assert.equal(p.by(id)?.reach_km, 45, `${id} to 45 km`);
    assert.equal(p.reaches.get(id).from, "asset");
    assert.match(p.reaches.get(id).source, /NatureScot/);
  }
  assert.equal(p.by("heritage.scheduled-monuments").reach_km, 10);
  assert.equal(p.by("heritage.listed-buildings").reach_km, 2, "listed buildings keep the check's own reach");
  assert.equal(p.by("bio.spa").reach_km, 20);
  assert.equal(p.by("water.flood-zones").reach_km, 0.5);
  assert.equal(p.by("water.pollution-incidents").reach_km, 1);
  assert.equal(p.reach.furthest_km, 45);
  assert.equal(D.ladderTo(p.reach.furthest_km).at(-1), 45);
  assert.ok(p.reach.extended.some((e) => e.check === "landscape.national-parks" && e.from_km === 10 && e.to_km === 45));
  // With a tip height, NatureScot's table: 90 m turbines → 30 km.
  const small = planFor(WIND, { asset_type: "wind-onshore", tip_height_m: 90 });
  assert.equal(small.by("landscape.national-parks").reach_km, 30);
  // A solar farm on the same land keeps the checks' own reaches.
  const solar = planFor(WIND, { asset_type: "solar" });
  assert.equal(solar.by("landscape.national-parks").reach_km, 10);
  assert.equal(solar.reach.extended, undefined);
});

await test("\"look out to 5 km\": every count check looks out exactly 5 km, cutting as well as stretching; zone and class checks untouched", () => {
  const p = planFor(WIND, { asset_type: "wind-onshore", distances: [{ what: "all", value: 5, unit: "km" }] });
  for (const x of p.plans.filter((y) => y.check.answer === "count_by_band")) assert.equal(x.reach_km, 5, `${x.check.id} at 5 km`);
  assert.equal(p.by("water.flood-zones").reach_km, 0.5, "a class check keeps its reach");
  assert.equal(p.by("bio.sssi-irz")?.reach_km ?? 0, 0, "a zone check doesn't stretch");
  assert.equal(p.reach.furthest_km, 5);
  assert.equal(p.reaches.get("landscape.national-parks").from, "person");
  assert.equal(p.reach.set_by, "person");
  assert.equal(p.reach.changes.length, 1);
  assert.match(p.reach.changes[0].line, /^every count check to 5 km \(was 1 km to 45 km, by check\)$/);
  assert.match(D.changesLine(p.reach), /^You changed: every count check to 5 km/);
  // Metres too, and the record keeps what was said.
  const m = planFor(BARNSTON, { planned: "housing", distances: [{ what: "everything", value: 500, unit: "m" }] });
  assert.equal(m.by("bio.sac").reach_km, 0.5);
  assert.equal(m.reach.changes[0].said, "500 m");
  // Over 50 km is capped, and says so.
  const far = planFor(BARNSTON, { distances: [{ what: "all", value: 80, unit: "km" }] });
  assert.equal(far.reach.furthest_km, 50);
  assert.match(far.reach.changes[0].line, /capped at 50 km/);
});

await test("a topic or a check by name: heritage to 10 km; homes within 50 m is a search in a screen", () => {
  const p = planFor(BARNSTON, { planned: "housing", distances: [{ what: "heritage", value: 10, unit: "km" }, { what: "homes", value: 50, unit: "m" }] });
  assert.equal(p.by("heritage.scheduled-monuments").reach_km, 10);
  assert.equal(p.by("heritage.listed-buildings").reach_km, 10);
  assert.equal(p.by("bio.sac").reach_km, 2, "other topics untouched");
  assert.equal(p.by("community.homes").reach_km, 0.05);
  assert.match(p.reach.changes[0].line, /^heritage checks to 10 km \(was 250 m to 2 km, by check\)$/);
  assert.match(p.reach.changes[1].line, /^Nearest homes to 50 m \(was 500 m\)$/);
});

await test("\"keep 50 m from homes\" in the developable area changes the homes buffer and no search", () => {
  const said = D.readDistances([{ what: "homes", value: 50, unit: "m" }], { catalogue: cat, deductions: rules.deductions, budget: true });
  assert.equal(said.search.length, 0);
  assert.deepEqual(said.protection.map((x) => [x.id, x.buffer_m]), [["homes", 50]]);
  const look = D.readDistances([{ what: "all", value: 5, unit: "km" }], { catalogue: cat, deductions: rules.deductions, budget: true });
  assert.equal(look.search.length, 0);
  assert.match(look.not_used[0].why, /each deduction's buffer/);
  // In a screen, the same words are a search, and no protection distance.
  const screen = D.readDistances([{ what: "homes", value: 50, unit: "m" }], { catalogue: cat });
  assert.equal(screen.protection.length, 0);
  assert.deepEqual(screen.search[0].ids, ["community.homes"]);
});

await test("what can't be read is said, not guessed; old inputs still come in", () => {
  const x = D.readDistances([{ what: "all", value: 3, unit: "furlongs" }, { what: "unicorns", value: 2, unit: "km" }], { catalogue: cat });
  assert.equal(x.search.length, 0);
  assert.match(x.not_used[0].why, /not a distance Tobler reads/);
  // Package C: miles are read, converted by code with the exact factor.
  assert.equal(D.readDistances([{ what: "all", value: 3, unit: "miles" }], { catalogue: cat }).search[0].km, 4.828032);
  assert.match(x.not_used[1].why, /no check or topic/);
  assert.deepEqual(D.distancesFromInputs({ distances: { wider: 15 } }), [{ what: "all", value: 15, unit: "km" }]);
  assert.deepEqual(D.distancesFromInputs({ buffers: [{ id: "homes", buffer_m: 100 }] }), [{ what: "homes", value: 100, unit: "m" }]);
  assert.deepEqual(D.distancesFromInputs({ distances: [{ what: "all", value: 2, unit: "km" }] }), [{ what: "all", value: 2, unit: "km" }]);
});

await test("units: metres and kilometres as said, exactly; others wait for package C", () => {
  assert.equal(toKm(150, "m"), 0.15);
  assert.equal(toKm("5", "kilometres"), 5);
  assert.equal(toKm(2.5, "km"), 2.5);
  assert.equal(toKm(1200, "metres"), 1.2);
  assert.equal(toKm(3), 3, "no unit is km");
  assert.equal(toKm(150, "feet"), 0.04572, "package C: feet, miles and nautical miles, exact");
  assert.equal(toKm(5, "furlongs"), null);
  assert.equal(toKm("lots", "km"), null);
});

await test("old runs still open with their near/close/wider: rings, bands and the line", () => {
  const old = { distances: { near: 1, close: 5, wider: 20, set_by: "default", asset_label: "solar farm", setting: "onshore", reasons: [] }, fetched_to_km: 20, extent: "around" };
  assert.ok(D.isLegacy(old));
  assert.deepEqual(D.runRings(old), [1, 5, 20]);
  assert.equal(D.runBand(3, old), "close");
  assert.equal(D.runDistancesLine(old), "near 1 km · close 5 km · wider 20 km (default for solar farm onshore)");
  assert.equal(D.runFurthest(old), 20);
  assert.deepEqual(D.sliderSteps(old, true), [0, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20]);
});

await test("reached by: plain data on checks where it's clear", () => {
  const allowed = new Set(["water", "sight", "flight", "ground", "road"]);
  const withIt = cat.checks.filter((c) => c.reached_by);
  assert.ok(withIt.length >= 20, `${withIt.length} checks say how they're reached`);
  for (const c of withIt) for (const b of c.reached_by) assert.ok(allowed.has(b), `${c.id}: ${b}`);
  assert.deepEqual(cat.checks.find((c) => c.id === "landscape.national-parks").reached_by, ["sight"]);
  assert.ok(cat.checks.find((c) => c.id === "water.pollution-incidents").reached_by.includes("water"));
});

await test("rings, slider and a finding's band on the reader's ladder (package C: B in imperial)", () => {
  const run = { reach: { furthest_km: 5, ladder: D.ladderTo(5) } };
  assert.deepEqual(D.runRings(run), [0.1, 0.25, 0.5, 1, 2, 5]);
  assert.deepEqual(D.runRings(run, "imperial"), [0.09144, 0.3048, 0.402336, 0.804672, 1.609344, 3.218688, 5]);
  assert.deepEqual(D.sliderSteps(run, true, "imperial"), [0, 0.09144, 0.3048, 0.402336, 0.804672, 1.609344, 3.218688, 5]);
  assert.equal(D.runBand(0.7, run, "imperial"), "¼–½ mi");
  assert.equal(D.runBand(0.7, run), "500 m–1 km");
  assert.equal(D.bandLabel(0.3048, 0.402336, "imperial"), "1,000 ft–¼ mi");
  assert.deepEqual(D.runRings({ reach: { furthest_km: 0, ladder: [] } }, "imperial"), [], "inside only: no rings");
  // Old runs keep their near/close/wider whatever the units.
  const legacy = { distances: { near: 1, close: 5, wider: 20 }, fetched_to_km: 20 };
  assert.deepEqual(D.runRings(legacy, "imperial"), [1, 5, 20]);
});

console.log(`\n${passed} reach tests passed`);
