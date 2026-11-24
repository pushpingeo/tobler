// Tests for the catalogue tools (find_data, get_data) and confidence inherited from a place, with the atlas faked.
// The Mars case (17 Nov): a platform point, a 20 km circle round it, then "any thermal anomalies?".
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { createPlaceTools } from "../js/placetools.js";
import { keyAttributes, geometryDistanceKm } from "../js/datatools.js";
import { rateConfidence } from "../js/confidence.js";
import * as G from "../js/geometry.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const trusted = JSON.parse(readFileSync(new URL("../catalogue/trusted.json", import.meta.url)));
const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));

const MARS = [-89.2229, 28.1698];
const VIIRS = { id: "cddf4d1585ae354c", title: "Satellite (VIIRS) Thermal Hotspots and Fire Activity", publisher: "NASA", publisher_type: "curated-collection", coverage: "global", capabilities: ["query", "time"], licence: "This work is licensed under the Esri Master License Agreement. View Summary | View Terms of Use" };
const WMS = { id: "wms1", title: "Thermal Stress Percentage", publisher: "NOAA", capabilities: ["render"], licence: "x" };
const OPEN = { id: "open1", title: "Biologically Sensitive Underwater Feature", publisher: "NOAA National Centers for Environmental Information", capabilities: ["query"], licence: "Public domain: a work of the U.S. federal government" };
const LOCAL = { id: "loc1", title: "Thermal springs", publisher: "Some County", capabilities: ["query"], licence: "not stated" };
const firmsCalls = [];
let firmsDown = false;
async function firms({ source, bbox, days }) {
  firmsCalls.push({ source, bbox, days });
  if (firmsDown) throw new Error("NASA FIRMS didn't answer: timeout");
  const at = (km, brg) => turf.destination(MARS, km, brg).geometry.coordinates;
  if (source !== "VIIRS_NOAA20_NRT") return { type: "FeatureCollection", features: [] };
  return { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: at(2, 45) }, properties: { acquired_utc: "2026-11-16 07:12 UTC", frp: 6.3, confidence: "n", satellite: "N20" } },
    { type: "Feature", geometry: { type: "Point", coordinates: at(60, 270) }, properties: { acquired_utc: "2026-11-15 19:04 UTC", frp: 1.1, confidence: "l", satellite: "N20" } },
  ] };
}
const atlasCalls = [];
let overloadOnce = false;
async function atlas(tool, args) {
  atlasCalls.push([tool, args]);
  if (overloadOnce) { overloadOnce = false; throw new Error("atlas: D1_ERROR: D1 DB is overloaded. Too many resources consumed within a 10 second window."); }
  if (tool === "find_datasets" && args.concept === "pipeline") return { matches: 1, results: [{ id: "pipe", title: "UKCS pipelines", publisher: "North Sea Transition Authority", publisher_type: "regulator", capabilities: ["query"], geometry: ["line"], licence: "NSTA Open User Licence" }] };
  if (tool === "find_datasets" && args.concept) return { matches: 0, results: [] };
  if (tool === "fetch_features" && args.id === "pipe") {
    // A 10 km square field at Mars: 4 lines inside, 8 just outside its east edge (0.5–4 km), 3 far away (25 km).
    const east = turf.destination(MARS, 5, 90).geometry.coordinates[0];
    const kmE = (km) => east + km / 98.2; // degrees of longitude per km at 28° N, near enough for a fixture
    const line = (x, name) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[x, MARS[1] - 0.01], [x, MARS[1] + 0.01]] }, properties: { name } });
    const inside = [0, 1, 2, 3].map((i) => line(MARS[0] + i * 0.01, `Flowline ${i}`));
    const near = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((km) => line(kmE(km), `Export ${km}`));
    const far = [25, 26, 27].map((km) => line(kmE(km), `Far ${km}`));
    return { returned: 15, features: [...far, ...near, ...inside] };
  }
  if (tool === "find_datasets") {
    if (/viirs|thermal/i.test(args.text)) return { matches: 5, results: [WMS, VIIRS, { ...VIIRS, id: "dup" }, LOCAL, OPEN] };
    if (/sensitive/i.test(args.text)) return { matches: 2, results: [LOCAL, OPEN] };
    return { matches: 0, results: [] };
  }
  if (tool === "fetch_features") {
    if (args.id === "broken") throw new Error("atlas: Couldn't fetch features");
    // Three detections: one 3 km from the platform, one 15 km, one 40 km (outside a 20 km circle).
    const at = (km, brg) => turf.destination(MARS, km, brg).geometry.coordinates;
    return { returned: 3, features: [
      { type: "Feature", geometry: { type: "Point", coordinates: at(15, 90) }, properties: { OBJECTID: 2, acq_date: 1763337600000, confidence: "nominal", frp: 3.1, satellite: "N" } },
      { type: "Feature", geometry: { type: "Point", coordinates: at(3, 0) }, properties: { OBJECTID: 1, acq_date: 1763337600000, confidence: "high", frp: 12.4, satellite: "N", daynight: "N" } },
      { type: "Feature", geometry: { type: "Point", coordinates: at(40, 180) }, properties: { OBJECTID: 3, acq_date: 1763337600000 } },
    ] };
  }
  throw new Error(`unexpected ${tool}`);
}

function host() {
  const list = [];
  let shown = [];
  return {
    ref, anchors: [], headers: {}, list, atlas, firms, trusted, esri: false, esriLicence() { return this.esri; }, fetchFn: async () => ({ ok: true, json: async () => [] }),
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: () => "",
    onCandidates: (l) => { shown = l; },
    shown: () => shown,
    addPlace({ feature, origin }) { const p = { name: `${feature.geometry.type === "Point" ? "Point" : "Area"} ${list.length + 1}`, feature, origin, status: "proposed", edits: [] }; list.push(p); return p; },
    view: () => [-90, 27.5, -88.5, 28.8],
  };
}

await test("a circle built on a high-confidence point is high confidence (was low)", async () => {
  const h = host();
  h.list.push({ name: "Point 1", feature: turf.point(MARS), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const r = await t.exec("make_place", { anchor: "Point 1", shape: "circle", radius_km: 20, words: "20 km", match: "settlement_or_region", reason: "round the platform" });
  assert.equal(r.confidence, "high", JSON.stringify(r.why));
  assert.match(r.why[0], /built on Point 1/);
});

await test("inherited confidence: drawn places count as high, offsets cap at medium, failed checks at low", () => {
  assert.equal(rateConfidence({ inherit: { name: "Area 1", drawn: true } }).confidence, "high");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "medium" } }).confidence, "medium");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "high" }, offset: true }).confidence, "medium");
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "high" }, checks: [{ pass: false }] }).confidence, "low");
  // A medium place doesn't rise to high from checks on a shape built round it.
  assert.equal(rateConfidence({ inherit: { name: "Area 1", confidence: "medium" }, checks: [{ pass: true, tight: true, direction: "N" }] }).confidence, "medium");
});

await test("find_data: trusted NASA FIRMS first, Esri-licensed copies left out (and said so), trusted publishers before local ones", async () => {
  const h = host();
  const t = createPlaceTools(h);
  const r = await t.exec("find_data", { text: "thermal" });
  assert.equal(r.datasets[0].title, "Active fires and thermal hotspots, VIIRS 375 m (NASA FIRMS)");
  assert.equal(r.datasets[0].trusted, true);
  assert.equal(r.datasets[0].licence_class, "open");
  assert.ok(!r.datasets.some((d) => d.title === VIIRS.title), "Esri copy left out");
  assert.match(r.left_out, /1 dataset under Esri's Master License Agreement/);
  const titles = r.datasets.map((d) => d.title);
  assert.ok(titles.indexOf(OPEN.title) < titles.indexOf(LOCAL.title), titles.join(" | "));
  assert.equal(r.datasets.find((d) => d.title === LOCAL.title).licence_class, "unknown");
  assert.equal(r.datasets.at(-1).can_fetch, false, "picture-only last");
  // With an Esri licence, the Esri copy comes back (once, duplicates folded).
  h.esri = true;
  const r2 = await t.exec("find_data", { text: "VIIRS" });
  assert.equal(r2.datasets.filter((d) => d.title === VIIRS.title).length, 1);
  assert.equal(r2.left_out, undefined);
});

await test("find_data says what was searched when nothing matches, and retries once when the atlas is overloaded", async () => {
  const h = host();
  const t = createPlaceTools(h);
  overloadOnce = true;
  const r = await t.exec("find_data", { text: "seismic" });
  assert.equal(r.datasets.length, 0);
  assert.match(r.note, /Nothing found for "seismic"/);
  assert.match(r.note, /Try other words/);
});

await test("get_data on NASA FIRMS: detections inside the circle, all sensors asked, days, attribution and time caveat", async () => {
  const h = host();
  h.list.push({ name: "Area 1", feature: turf.circle(MARS, 20, { units: "kilometers", steps: 64 }), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const f = await t.exec("find_data", { text: "gas flaring", area: "Area 1" });
  const viirs = f.datasets.find((d) => /VIIRS 375/.test(d.title));
  firmsCalls.length = 0;
  const r = await t.exec("get_data", { dataset: viirs.id, place: "Area 1", days: 3 });
  assert.deepEqual(firmsCalls.map((c) => c.source).sort(), ["VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "VIIRS_SNPP_NRT"]);
  assert.ok(firmsCalls.every((c) => c.days === 3));
  assert.equal(r.inside_or_touching, 1);
  assert.equal(r.nearest[0].details.acquired_utc, "2026-11-16 07:12 UTC");
  assert.equal(r.days_checked, 3);
  assert.match(r.attribution, /NASA FIRMS/);
  assert.match(r.time_note, /last 3 days only/);
  assert.equal(r.trusted, true);
  assert.equal(h.shown().length, 1);
  // From the point with a 70 km reach: both.
  h.list.push({ name: "Point 2", feature: turf.point(MARS), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const r2 = await t.exec("get_data", { dataset: viirs.id, place: "Point 2", within_km: 50 });
  assert.equal(r2.within_distance, 1, "the 60 km one is outside 50 km");
  firmsDown = true;
  assert.match((await t.exec("get_data", { dataset: viirs.id, place: "Area 1" })).not_checked, /NASA FIRMS didn't answer/);
  firmsDown = false;
});

await test("get_data on an atlas dataset: measured from the place's edge, nearest first, dates readable; Esri copies refused", async () => {
  const h = host();
  h.esri = true;
  h.list.push({ name: "Area 1", feature: turf.circle(MARS, 20, { units: "kilometers", steps: 64 }), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const f = await t.exec("find_data", { text: "VIIRS", area: "Area 1" });
  const esriCopy = f.datasets.find((d) => d.title === VIIRS.title);
  const r = await t.exec("get_data", { dataset: esriCopy.id, place: "Area 1" });
  assert.equal(r.inside_or_touching, 2);
  assert.equal(r.nearest[0].details.confidence, "high");
  assert.match(r.nearest[0].details.acq_date, /^\d{4}-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.match(r.time_note, /recent detections only/);
  assert.match(r.licence_note, /Esri licence/);
  const box = atlasCalls.filter(([tool]) => tool === "fetch_features").at(-1)[1].bbox;
  assert.ok(box[0] < -89.4 && box[2] > -89.03, box.join(","));
  h.list.push({ name: "Point 2", feature: turf.point(MARS), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const r2 = await t.exec("get_data", { dataset: esriCopy.id, place: "Point 2", within_km: 20 });
  assert.deepEqual(r2.nearest.map((c) => Math.round(c.distance_km)), [3, 15]);
  h.esri = false;
  assert.match((await t.exec("get_data", { dataset: esriCopy.id, place: "Area 1" })).not_checked, /Master License Agreement/);
});

await test("get_data: a picture-only dataset or a failed service is 'not checked', never 'nothing found'", async () => {
  const h = host();
  h.list.push({ name: "Area 1", feature: turf.circle(MARS, 20, { units: "kilometers" }), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const f = await t.exec("find_data", { text: "thermal" });
  const wms = f.datasets.find((d) => !d.can_fetch);
  assert.ok(wms, JSON.stringify(f.datasets.map((d) => d.title)));
  assert.match((await t.exec("get_data", { dataset: wms.id, place: "Area 1" })).not_checked, /picture service/);
  t.datasets.set("D99", { id: "broken", title: "Broken", publisher: "X", capabilities: ["query"] });
  assert.match((await t.exec("get_data", { dataset: "D99", place: "Area 1" })).not_checked, /didn't answer/);
  await assert.rejects(() => t.exec("get_data", { dataset: "D42", place: "Area 1" }), /Use find_data first/);
});

await test("catalogue areas: country aliases, the USA's main part (not the world), seas by name", async () => {
  const t = createPlaceTools(host());
  const boxes = [];
  for (const area of ["United States", "USA", "Gulf of America", "the North Sea", "United Kingdom"]) {
    await t.exec("find_data", { text: "VIIRS", area });
    const [, args] = atlasCalls.filter(([tool]) => tool === "find_datasets").at(-1);
    boxes.push(args.bbox);
  }
  const [us, usa, gom, ns, uk] = boxes;
  assert.ok(us[2] - us[0] < 70 && us[0] < -120 && us[2] > -70, `US box ${us}`);
  assert.deepEqual(us, usa);
  assert.deepEqual(gom, [-98, 17.5, -80, 31]);
  assert.ok(ns[0] < 0 && ns[2] > 5, `North Sea ${ns}`);
  assert.ok(uk[0] < -8 && uk[2] < 5, `UK ${uk}`);
  const r = await t.exec("find_data", { text: "VIIRS", area: "Gulf of America" });
  assert.match(r.searched.area, /Gulf of Mexico \(Gulf of America\)/);
});

await test("licence classes", async () => {
  const { classifyLicence } = await import("../js/licence.js");
  assert.equal(classifyLicence(VIIRS.licence).class, "esri-mla");
  assert.equal(classifyLicence("Contains OS data © Crown copyright; Open Government Licence v3.0").class, "open");
  assert.equal(classifyLicence("CC BY 4.0").class, "open");
  assert.equal(classifyLicence("UNEP-WCMC and IUCN: for non-commercial use only").class, "non-commercial");
  assert.equal(classifyLicence("not stated").class, "unknown");
  assert.equal(classifyLicence("").class, "unknown");
  assert.equal(classifyLicence("Geographic Information Network of Alaska (GINA) and BLM Alaska Fire Service").class, "stated");
});

await test("find_features_near from an area: distances from its edge, all found counted, findings kept on the map", async () => {
  const h = host();
  const added = [];
  h.addFindings = (list, meta) => added.push(...list.map((c) => [c.name, meta.theme, meta.place]));
  h.list.push({ name: "Area 1", feature: G.squareAround(MARS, 100, 0), origin: { method: "words", confidence: "high" }, status: "proposed", edits: [] });
  const t = createPlaceTools(h);
  const r = await t.exec("find_features_near", { anchor: "Area 1", feature_type: "pipeline", radius_km: 2.2 });
  assert.match(r.measured_from, /edge of Area 1/);
  const names = r.candidates.map((c) => c.name);
  assert.deepEqual(names.slice(0, 4).sort(), ["Flowline 0", "Flowline 1", "Flowline 2", "Flowline 3"]);
  assert.ok(r.candidates.slice(0, 4).every((c) => c.distance_km === 0));
  assert.deepEqual(names.slice(4), ["Export 0.5", "Export 1", "Export 1.5", "Export 2"]);
  assert.equal(r.found, 8);
  assert.equal(added.length, 8);
  assert.equal(added[0][1], "context");
  assert.equal(added[0][2].geometry.type, "Polygon");
  // Nothing found in a later search leaves the findings alone (no call that clears them).
  await t.exec("find_features_near", { anchor: "Area 1", feature_type: "river", radius_km: 2 });
  assert.equal(added.length, 8);
});

await test("show_on_map: fits to findings, or clears them", async () => {
  const h = host();
  let shown = null, cleared = false;
  h.showFindings = (ids) => { shown = ids; return { shown: ids?.length || 3, on_map: 3 }; };
  h.clearFindings = () => { cleared = true; };
  const t = createPlaceTools(h);
  assert.equal((await t.exec("show_on_map", {})).shown, 3);
  assert.equal(shown, undefined);
  assert.equal((await t.exec("show_on_map", { ids: ["C2"] })).shown, 1);
  assert.equal((await t.exec("show_on_map", { clear: true })).cleared, true);
  assert.ok(cleared);
});

await test("findings: themes from the analyst, the feature type or the atlas concept; bands; labels for the nearest and the near", async () => {
  const F = await import("../js/findings.js");
  assert.equal(F.themeFor({ theme: "heritage", featureType: "protected area" }), "heritage");
  assert.equal(F.themeFor({ featureType: "protected area" }), "biodiversity");
  assert.equal(F.themeFor({ concepts: ["marine-activity", "seabed-habitat"] }), "material-assets");
  assert.equal(F.themeFor({ concepts: ["oil-gas"] }), "context");
  assert.equal(F.themeFor({}), "context");
  assert.deepEqual([0, 0.9, 3, 12, null].map(F.bandOf), ["near", "near", "close", "wider", "wider"]);
  const feats = [7, 0.5, 2, 9, 30, 0.2].map((d, i) => ({ properties: { theme: i < 5 ? "biodiversity" : "community", distance_km: d } }));
  F.chooseLabels(feats);
  assert.deepEqual(feats.map((f) => f.properties.label_on), [true, true, true, false, false, true]);
  assert.deepEqual(F.ringDistances(true), [2, 10, 50]);
});

await test("names: source and project columns and short codes aren't names; descriptive fields are the fallback", async () => {
  const { pickName } = await import("../js/atlasfeatures.js");
  assert.equal(pickName({ PROJECT: "JNCC", SOURCE_NAME: "PC, JNCC", HAB_TYPE: "Deep-sea sponge aggregations" }), "Deep-sea sponge aggregations");
  assert.equal(pickName({ SITE_NAME: "Faroe-Shetland Sponge Belt", PROJECT: "JNCC" }), "Faroe-Shetland Sponge Belt");
  assert.equal(pickName({ PROJECT: "NOC" }), null);
  assert.equal(pickName({ name: "M9" }), "M9", "a real name field may be short");
  assert.equal(pickName({ ROUTE: "A803" }), "A803", "road numbers are names");
  assert.equal(pickName({ SITE_CODE: "UK0030" }), null, "other short codes aren't");
});

await test("make_place clip: a corridor cut to within 5 km of a town, or to an outline", async () => {
  const h = host();
  const town = [-3.6, 55.977];
  h.list.push({ name: "Road", feature: turf.lineString([[-3.9, 55.977], [-3.3, 55.977]]), origin: { method: "drawn" }, status: "drawn", edits: [] });
  h.list.push({ name: "Town", feature: turf.point(town), origin: { method: "drawn" }, status: "drawn", edits: [] });
  h.list.push({ name: "County", feature: turf.bboxPolygon([-3.7, 55.9, -3.5, 56.05]), origin: { method: "drawn" }, status: "drawn", edits: [] });
  const t = createPlaceTools(h);
  const full = await t.exec("make_place", { anchor: "Road", shape: "buffer", buffer_km: 0.5, words: "corridor", match: "named_place", reason: "x" });
  const cut = await t.exec("make_place", { anchor: "Road", shape: "buffer", buffer_km: 0.5, clip: { to: "Town", within_km: 5 }, words: "within 5 km", match: "named_place", reason: "x" });
  assert.ok(full.area_km2 > 35 && full.area_km2 < 40, `full ${full.area_km2}`);
  assert.ok(cut.area_km2 > 9 && cut.area_km2 < 10.5, `about 10 km long × 1 km: ${cut.area_km2}`);
  assert.match(cut.how, /clipped to within 5 km of Town/);
  const inCounty = await t.exec("make_place", { anchor: "Road", shape: "buffer", buffer_km: 0.5, clip: { to: "County" }, words: "only in the county", match: "named_place", reason: "x" });
  assert.ok(inCounty.area_km2 > 11 && inCounty.area_km2 < 13.5, `about 12.5 km × 1 km: ${inCounty.area_km2}`);
  await assert.rejects(() => t.exec("make_place", { anchor: "Road", shape: "buffer", buffer_km: 0.5, clip: { to: "Town" }, words: "x", match: "named_place", reason: "x" }), /needs within_km/);
});

await test("keyAttributes and geometryDistanceKm", () => {
  const k = keyAttributes({ OBJECTID: 5, Shape__Area: 3, acq_date: 1763337600000, name: "X", junk: "y" });
  assert.deepEqual(Object.keys(k), ["acq_date", "name"]);
  assert.match(k.acq_date, /UTC$/);
  const sq = turf.bboxPolygon([0, 0, 1, 1]).geometry;
  assert.equal(geometryDistanceKm(sq, { type: "Point", coordinates: [0.5, 0.5] }), 0);
  const d = geometryDistanceKm(sq, turf.bboxPolygon([1.1, 0, 2, 1]).geometry);
  assert.ok(Math.abs(d - 11.1) < 0.3, String(d));
});

await test("topics: names match the checks catalogue; old themes and PS codes read as topics, with the same colours", async () => {
  const F = await import("../js/findings.js");
  const cat = JSON.parse(readFileSync(new URL("../catalogue/checks.json", import.meta.url)));
  assert.deepEqual(cat.topics.map((t) => [t.id, t.label]).sort(), Object.entries(F.TOPICS).map(([k, t]) => [k, t.label]).sort(),
    "js/findings.js and catalogue/checks.json name the same topics");
  for (const [old, topic] of [["land", "land-use"], ["community", "community-health"], ["indigenous", "indigenous"], ["PS4", "community-health"],
    ["ps8", "heritage"], ["PS6", "biodiversity"], ["context", "context"], ["something else", "context"], [undefined, "context"]]) assert.equal(F.topicOf(old), topic, String(old));
  // The map's colour expression gives old records the colour of their topic.
  const expr = F.colourExpression();
  const colourOf = (v) => { const i = expr.indexOf(v, 2); return i > 0 && i % 2 === 0 ? expr[i + 1] : expr.at(-1); };
  assert.equal(colourOf("community"), F.TOPICS["community-health"].colour);
  assert.equal(colourOf("land"), F.TOPICS["land-use"].colour);
  assert.equal(colourOf("nonsense"), F.TOPICS.context.colour);
  // Six map colours at most (the dataviz all-pairs limit is the reason; the legend names the topic).
  assert.ok(new Set(Object.values(F.TOPICS).map((t) => t.colour)).size <= 6);
  // Red is the site's colour, never a topic's.
  assert.ok(!Object.values(F.TOPICS).some((t) => /^#(e3|eb|d9)[0-9a-f]{4}$/i.test(t.colour)));
});

console.log(`${passed} data tests passed`);
