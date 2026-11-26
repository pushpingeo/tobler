// Bring in a layer after a run (plan item 1, 26 Nov): which gaps are searched, which layer is offered, what the reply
// says, and what happens on a yes or a no. The end-to-end screen is in ntrrun.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import { gapsToSearch, wordsForCheck, licenceLabel, namesEnough, latestEditions, pickLayer, offerFor, offerLines, offerSummary, bringIn, bringInReply } from "../js/bringin.js";

const checksCat = JSON.parse(readFileSync(new URL("../catalogue/checks.json", import.meta.url), "utf8"));
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };

const site = turf.circle([-2.9, 53.28], 0.5, { units: "kilometers" });
site.properties = { role: "site", name: "Stanlow" };
const nc = (id, label, topic, extra = {}) => ({ id, label, topic, state: "not_checked", reason: "pending", why: "not in Tobler's data", ...extra });
const run = (over = {}) => ({ tobler_run: {
  id: "R1", site: { name: "Stanlow" }, extent: "around", distances: { near: 1, close: 5, wider: 20, footprint_km: 1 },
  checks: [
    { id: "bio.sac", label: "Special Areas of Conservation", topic: "biodiversity", state: "found", sources: [{ atlas_id: "sac-eng", dataset: "SAC England", publisher: "Natural England" }] },
    nc("ground.landfill", "Landfill (historic and authorised)", "ground-soil"),
    nc("water.surface-water", "Surface water flooding", "water", { must: true }),
    nc("topo.elevation", "Elevation", "topography", { answer: "value_at_site", reason: "failed" }),
    nc("community.schools", "Schools and nurseries", "community-health", { reason: "failed" }),
    nc("air.permitted-sites", "Permitted industrial and waste sites", "air-climate", { why: "Natural Resources Wales doesn't grant re-use of its full data: not used until Rob decides" }),
  ],
  checked: [], look_for: [{ what: "Important Bird Areas", words: ["important bird area"], topic: "biodiversity" }],
  no_check_topics: [],
  ...over,
}, features: [site] });

await test("gaps: must-checks first, then what the analyst named, then other checks; values, OpenStreetMap kinds and licence holds left out", () => {
  const g = gapsToSearch(run().tobler_run, checksCat);
  assert.deepEqual(g.map((x) => x.label), ["Surface water flooding", "Important Bird Areas", "Landfill (historic and authorised)"]);
  assert.deepEqual(g[2].words, ["landfill"], "the label without its brackets (this test's check has no search words of its own)");
  assert.equal(g[1].why, "the analyst named it as missing here");
  assert.deepEqual(wordsForCheck({ label: "Surface water flooding", search: ["surface water", "pluvial", "extra"] }), ["surface water", "pluvial"]);
});

await test("editions: the newest of a series is kept; a title with no year is its own series", () => {
  const list = [
    { id: "a", title: "Built-up areas (2011)", publisher: "ONS" },
    { id: "b", title: "Built-up areas (2022)", publisher: "ONS" },
    { id: "c", title: "Built up Areas December 2022 v2", publisher: "Someone else" },
    { id: "d", title: "Historic landfill sites", publisher: "Environment Agency" },
  ];
  assert.deepEqual(latestEditions(list).map((d) => d.id), ["b", "c", "d"]);
});

await test("licences in a line: the licence's own name where known, else the publisher's words cut short", () => {
  assert.equal(licenceLabel("No limitations on public access; Creative Commons CC-BY 4.0 https://creativecommons.org/licenses/by/4.0/; This data was downloaded", "open"), "CC BY 4.0");
  assert.equal(licenceLabel("Use of this data is subject to the Open Government Licence: www.nationalarchives.gov.uk", "open"), "Open Government Licence");
  assert.equal(licenceLabel("", "unknown"), "licence not stated");
  assert.equal(licenceLabel("https://historicengland.org.uk/terms/", "stated"), "licence given as a link");
  assert.ok(!namesEnough("Surface water bodies failing good ecological status", "Surface-water flood risk, England") && namesEnough("Risk of Flooding from Surface Water", "Surface-water flood risk, England"), "the analyst's look-for needs most of its words in the title");
  assert.equal(licenceLabel("© EEA, Copenhagen, 2014-2015. Reproduction is authorised provided the source is acknowledged, save where otherwise stated", "stated"), "© EEA, Copenhagen, 2014-2015. Reproduction is authorised…");
});

await test("which layer: words in the title, fetchable, licences switched off left out, a layer the run used not offered again, trusted and open first", () => {
  const res = [
    { id: "pic", title: "Historic landfill sites (map image)", publisher: "Environment Agency", capabilities: [], licence: "Open Government Licence" },
    { id: "esri", title: "Landfill sites", publisher: "Esri UK", capabilities: ["query"], licence: "Esri Master License Agreement" },
    { id: "nc", title: "Landfill points", publisher: "X", capabilities: ["query"], licence: "CC BY-NC 4.0" },
    { id: "stray", title: "Waste transfer stations", publisher: "Landfill Ltd", capabilities: ["query"], licence: "OGL" },
    { id: "unknown", title: "Landfill (council)", publisher: "Cheshire West", publisher_type: "local-gov", capabilities: ["query"] },
    { id: "ea", title: "Historic Landfill Sites", publisher: "Environment Agency", publisher_type: "regulator", capabilities: ["query"], licence: "Open Government Licence v3.0" },
  ];
  assert.equal(pickLayer(res, { words: ["landfill"] }).id, "ea");
  assert.equal(pickLayer(res, { words: ["landfill"], used: new Set(["ea"]) }).id, "unknown");
  assert.equal(pickLayer(res, { words: ["landfill"], allow: { esri: true }, used: new Set(["ea", "unknown"]) }).id, "esri");
  assert.equal(pickLayer(res, { words: ["landfill"], used: new Set(["ea", "unknown"]) }), null, "Esri and non-commercial stay out by default");
});

await test("the offer: searched over the site, one layer per gap, nothing found and failed searches said", async () => {
  const calls = [];
  const atlas = async (tool, args) => {
    calls.push(args);
    // A council layer far away that the atlas says covers the site: probed, nothing there, so not offered.
    if (/landfill/.test(args.text)) return { results: [
      { id: "far", title: "Landfill sites (Runnymede)", publisher: "Runnymede Borough Council", publisher_type: "local-gov", capabilities: ["query"], licence: "OGL" },
      { id: "ea", title: "Historic Landfill Sites", publisher: "Environment Agency", publisher_type: "regulator", capabilities: ["query"], licence: "Open Government Licence v3.0" }] };
    if (/surface water/.test(args.text)) throw new Error("D1 DB is overloaded");
    // The EA's layer has a landfill 300 m from the site; the council's, nothing in reach.
    if (tool === "fetch_features") return args.id === "far" ? { returned: 0, features: [] }
      : { returned: 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: turf.destination([-2.9, 53.28], 0.8, 0).geometry.coordinates }, properties: { name: "Stanlow tip" } }] };
    if (/important bird/.test(args.text)) return { results: [{ id: "iba", title: "Important Bird Areas (centroids)", publisher: "BirdLife", capabilities: ["query"], licence: "CC BY 4.0" }] };
    return { results: [] };
  };
  const rec = run();
  const o = await offerFor(rec, { atlas, catalogue: checksCat, trusted: /Runnymede/, now: () => "2026-11-26T03:00:00Z" }); // the council ranked first, to test the probe
  assert.deepEqual(o.items.map((x) => [x.id, x.dataset.title, x.label]), [["L1", "Historic Landfill Sites", "Landfill (historic and authorised)"]]);
  assert.equal(o.items[0].dataset.licence_class, "open");
  assert.deepEqual(o.nothing, ["Important Bird Areas"], "a layer of centroids stands in for the sites, so it isn't offered");
  assert.deepEqual(o.failed, ["Surface water flooding"]);
  assert.equal(o.state, "open");
  // Each candidate is looked at, out to the run's 20 km, before it's offered; the council's had nothing, so it isn't.
  const looked = calls.filter((a) => a.id);
  assert.deepEqual(looked.map((a) => a.id), ["far", "ea"]);
  assert.ok(looked.every((a) => turf.distance([a.bbox[0], a.bbox[1]], [a.bbox[2], a.bbox[3]]) > 40), "looked at out to the run's reach");
  assert.deepEqual(o.empty, [{ label: "Landfill (historic and authorised)", title: "Landfill sites (Runnymede)", publisher: "Runnymede Borough Council" }]);
  assert.equal(o.items[0].preview.count, 1);
  assert.equal(o.items[0].preview.nearest[0].name, "Stanlow tip");
  assert.ok(Math.abs(o.items[0].preview.nearest[0].distance_km - 0.3) < 0.05);
  // The search box is the site and a small margin, not the run's 20 km.
  const [w, s, e, n] = calls[0].bbox;
  assert.ok(turf.distance([w, s], [e, n]) < 3, String(calls[0].bbox));
  rec.tobler_run.offer = o;
  const lines = offerLines(rec.tobler_run).join("\n\n");
  assert.match(lines, /The atlas has a layer with something in reach for a gap:\n- \*\*Historic Landfill Sites\*\* \(Environment Agency; Open Government Licence v3\.0\), for landfill \(historic and authorised\): 1 within 20 km, nearest Stanlow tip, 3\d0 m away/);
  assert.match(lines, /I'll put it on the map out to 20 km/);
  assert.match(lines, /For landfill \(historic and authorised\), the atlas has Landfill sites \(Runnymede\) \(Runnymede Borough Council\), but it has nothing within 20 km, so it isn't offered\./);
  assert.match(lines, /found no layer to offer/);
  assert.match(lines, /didn't answer \(D1 DB is overloaded\)/);
  assert.match(offerSummary(rec.tobler_run), /R1: layers offered after the run.*L1 Historic Landfill Sites/);
  // No atlas: said, not hidden.
  const none = await offerFor(run(), { atlas: null, catalogue: checksCat });
  assert.equal(none.why_failed, "the atlas isn't connected here");
});

await test("a no, a yes and ids not on offer; a point is held to its footprint, and a failed fetch is not checked", async () => {
  const offered = () => ({ at: "", searched: [{}], nothing: [], failed: [], state: "open", items: [
    { id: "L1", label: "Landfill", topic: "ground-soil", state: "offered", dataset: { atlas_id: "ea", title: "Historic Landfill Sites", publisher: "Environment Agency", licence: "OGL", licence_class: "open", licence_short: "OGL", capabilities: ["query"] } },
    { id: "L2", label: "Surface water flooding", topic: "water", state: "offered", dataset: { atlas_id: "sw", title: "Surface water", publisher: "EA", licence: "", licence_class: "unknown", licence_short: "licence not stated", capabilities: ["query"] } }] });
  const rec = run();
  rec.tobler_run.offer = offered();
  const no = await bringIn(rec, [], { get: async () => { throw new Error("not called"); }, keep: () => "D1", placeName: "Stanlow" });
  assert.deepEqual(no.declined, ["Historic Landfill Sites", "Surface water"]);
  assert.match(bringInReply(no), /nothing brought in/);
  rec.tobler_run.offer = offered();
  const asked = [];
  const get = async (i) => { asked.push(i); return i.dataset === "D2" ? { not_checked: "The publisher's service didn't answer: 503. Report it as not checked." } : { checked_at: "2026-11-26T03:00:00Z", within_distance: 3, inside_or_touching: 1, nearest: [{ name: "Stanlow tip", distance_km: 0 }] }; };
  let k = 0;
  const yes = await bringIn(rec, ["all", "L9"], { get, keep: () => `D${++k}`, placeName: "Stanlow", placeIsPoint: true });
  assert.deepEqual(asked.map((i) => i.within_km), [21, 21], "the wider band plus the footprint, from a point");
  assert.deepEqual(yes.not_on_offer, ["L9"]);
  assert.equal(rec.tobler_run.added.length, 2);
  assert.equal(rec.tobler_run.offer.state, "done");
  const said = bringInReply(yes);
  assert.match(said, /Historic Landfill Sites\*\* \(Environment Agency; OGL; checked 2026-11-26\): 3 features within 21 km \(1 on the site\); nearest Stanlow tip, on the site\./);
  assert.match(said, /Surface water\*\* \(EA; licence not stated; checked .*\): not checked\. The publisher's service didn't answer: 503\./);
  assert.doesNotMatch(said, /Report it as/, "the tool's own instruction doesn't reach the person");
  assert.match(said, /Distances are from the point/);
  const unknown = await bringIn(run({ offer: offered() }), ["L7"], { get, keep: () => "D1", placeName: "Stanlow" });
  assert.match(unknown.not_available, /L7 isn't on offer for R1/);
});

await test("Heswall (26 Nov): a look-for naming a not-checked check is the same gap, searched once; nothing for it isn't said", () => {
  const r = run({ look_for: [
    { what: "Surface water flood risk", words: ["surface water flood", "pluvial"], topic: "water" },
    { what: "Permitted industrial and waste sites", words: ["waste permit"], topic: "ground-soil" },
    { what: "Important Bird Areas", words: ["important bird area"], topic: "biodiversity" }] }).tobler_run;
  r.checks.push(nc("ground.permits-eng", "Permitted industrial and waste sites", "ground-soil"));
  const g = gapsToSearch(r, checksCat);
  assert.deepEqual(g.map((x) => x.label), ["Surface water flooding", "Important Bird Areas", "Landfill (historic and authorised)", "Permitted industrial and waste sites"]);
});

await test("Heswall (26 Nov): the same data under another title isn't offered again; a capped look gives no wrong nearest", async () => {
  const r = run({ checks: [nc("water.surface-water", "Surface water flooding", "water", { must: true }), nc("ground.landfill", "Landfill (historic and authorised)", "ground-soil")],
    checked: [{ dataset: "Authorised Landfill Site Boundaries, England (Environment Agency)", publisher: "Environment Agency" }], look_for: [] }).tobler_run;
  const far = turf.destination([-2.9, 53.28], 12, 90).geometry.coordinates;
  const near = turf.destination([-2.9, 53.28], 0.9, 90).geometry.coordinates;
  const looks = [];
  const atlas = async (tool, args) => {
    if (tool === "find_datasets") return /landfill/.test(args.text)
      ? { results: [{ id: "pws", title: "Permitted Waste Sites - Authorised Landfill Site Boundaries", publisher: "Environment Agency", publisher_type: "regulator", capabilities: ["query"], licence: "OGL" }] }
      : { results: [{ id: "rofsw", title: "Risk of Flooding from Surface Water Extent: 1 percent annual chance", publisher: "Defra Group", publisher_type: "central-gov", capabilities: ["query"], licence: "Open Government Licence" }] };
    looks.push(args);
    const wide = turf.distance([args.bbox[0], args.bbox[1]], [args.bbox[2], args.bbox[3]]) > 20;
    // Wide: 500 features in the server's order, the first one far off. Close: a few, nearest 400 m (900 m from the centre).
    const pt = (c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } });
    return wide ? { returned: 500, features: Array.from({ length: 500 }, () => pt(far)) } : { returned: 3, features: [pt(near), pt(far), pt(near)] };
  };
  const o = await offerFor({ tobler_run: r, features: [site] }, { atlas, catalogue: checksCat });
  assert.deepEqual(o.items.map((x) => x.dataset.title), ["Risk of Flooding from Surface Water Extent: 1 percent annual chance"], "the landfill layer the run read isn't offered again");
  const p = o.items[0].preview;
  assert.equal(p.capped, true);
  assert.ok(Math.abs(p.nearest[0].distance_km - 0.4) < 0.05, `nearest from the close look: ${p.nearest[0]?.distance_km}`);
  assert.equal(looks.length, 2, "one wide look, one close look");
  r.offer = o;
  const lines = offerLines(r).join("\n");
  assert.match(lines, /500\+ within 20 km, nearest 4\d0 m away/, "a nameless feature isn't named after its layer");
  assert.doesNotMatch(lines, /for surface water[^\n]*found no layer/, "a gap with an offer isn't also said to have none");
});

console.log(`${passed} bring-in tests passed`);
