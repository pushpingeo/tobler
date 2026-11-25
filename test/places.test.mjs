// Tests for place finding tools and the conversation loop, with the network and the model faked.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { createPlaceTools, placeToolDefs, projectSummary, cleanName, placeName } from "../js/placetools.js";
import { buildMessages, runTurn, parseSkill } from "../js/converse.js";
import { BLOCK_REF, findFeaturesNear } from "../js/gazetteer.js";
import { rateConfidence, runCheck } from "../js/confidence.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));
const anchors = JSON.parse(readFileSync(new URL("../catalogue/anchors.json", import.meta.url))).sources;
const skill = parseSkill(readFileSync(new URL("../skills/place-finding/SKILL.md", import.meta.url), "utf8"));

// Fake network: NSTA answers for Jackdaw and block 30/2, Nominatim finds nothing.
const calls = [];
const fetchFn = async (url) => {
  calls.push(String(url));
  const u = decodeURIComponent(String(url));
  const json = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
  if (u.includes("nominatim")) return json([]);
  if (u.includes("Offshore_hydrocarbon_fields") && u.includes("JACKDAW")) return json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: turf.bboxPolygon([2.33, 56.86, 2.43, 56.93]).geometry, properties: { FIELDNAME: "JACKDAW", FIELDTYPE: "GAS" } }] });
  if (u.includes("surface points") && u.includes("JACKDAW")) return json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [2.37924, 56.90038] }, properties: { NAME: "JACKDAW", INF_TYPE: "PLATFORM", CRS_NAME: "TM 0 N, ED50" } }] });
  if (u.includes("UKCS_blocks") && u.includes("'30/2'")) return json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: turf.bboxPolygon([2.1985, 56.8327, 2.3985, 56.9994]).geometry, properties: { BLOCK_REF: "30/2", TYPE: "OFFSHORE" } }] });
  return json({ type: "FeatureCollection", features: [] });
};

function memoryHost() {
  const list = [];
  return {
    ref, anchors, fetchFn, headers: {}, list,
    places: () => list,
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    skillText: () => skill.body,
    addPlace({ feature, origin, scale }) { const p = { name: `Area ${list.length + 1}`, feature, origin, status: "proposed", edits: [], ...(scale ? { scale, scaleFrom: "request" } : {}) }; list.push(p); return p; },
    updatePlace(name, feature, words) { const p = this.findPlace(name); p.feature = feature; p.edits.push({ change: words }); },
    renamePlace(name, to) { this.findPlace(name).name = to; },
  };
}

await test("typed coordinates are a place: read in code, not searched as a name (Rob's log, 20 Nov)", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  calls.length = 0;
  const out = await t.exec("find_place", { query: "55.522759, -5.650122" });
  assert.equal(out.candidates.length, 1);
  const c = out.candidates[0];
  assert.equal(c.name, "55.52276° N, 5.65012° W");
  assert.equal(c.type, "coordinates you typed");
  assert.deepEqual([c.lat, c.lon], [55.5228, -5.6501]);
  assert.equal(c.details.read_as, "decimal degrees");
  assert.match(c.details.other_reading, /other way round/);
  assert.match(out.note, /not searched for as a name/);
  assert.ok(!calls.some((u) => /nominatim\.openstreetmap\.org\/search|wikidata/.test(u)), "no name search for coordinates");
  // A point there, as the person asked: high confidence, exactly what was typed.
  const p = await t.exec("make_place", { anchor: c.id, shape: "point", words: "a point marker at these coordinates", match: "named_place", reason: "typed" });
  assert.equal(p.confidence, "high");
  assert.deepEqual(host.list[0].feature.geometry.coordinates, [-5.650122, 55.522759], "not rounded");
  assert.equal(host.list[0].origin.role, "point");
  // Coordinates straight in make_place's anchor work too (the analyst skipping find_place).
  const q = await t.exec("make_place", { anchor: "NT 002 774", shape: "circle", radius_km: 1, words: "1 km round NT 002 774", match: "named_place", reason: "typed" });
  const ctr = turf.centroid(host.list[1].feature).geometry.coordinates;
  assert.ok(Math.abs(ctr[1] - 55.9796) < 0.002 && Math.abs(ctr[0] + 3.6002) < 0.002, `a 1 km circle on Linlithgow Palace's grid square (${ctr})`);
  assert.ok(q.place);
  // Typed longitude first: read the usual way it's in the Indian Ocean, so the land reading is taken, and said.
  const lf = await t.exec("find_place", { query: "-5.650122, 55.522759" });
  assert.equal(lf.candidates.length, 1);
  assert.equal(lf.candidates[0].name, "55.52276° N, 5.65012° W");
  assert.match(lf.note, /Read longitude first/);
  // Nairobi read the other way round would be in the Mediterranean: just Nairobi.
  assert.equal((await t.exec("find_place", { query: "-1.2921, 36.8219" })).candidates.length, 1);
  // Both readings on land (Nigeria and Niger): both offered.
  const both = await t.exec("find_place", { query: "12.5, 13.5" });
  assert.equal(both.candidates.length, 2);
  assert.match(both.note, /Both readings are plausible/);
  // Mixed with a name: the coordinates come first, and the name is still searched.
  calls.length = 0;
  const m = await t.exec("find_place", { query: "Bellochantuy", also: ["55.5167, -5.7"] });
  assert.equal(m.candidates[0].type, "coordinates you typed");
  assert.ok(calls.some((u) => /nominatim/.test(u)), "the name was searched");
});

await test("skill file parses", () => {
  assert.equal(skill.name, "place-finding");
  assert.match(skill.description, /Turn words into a place/);
  assert.ok(skill.body.includes("## Confidence"));
});

await test("block references are recognised", () => {
  assert.deepEqual("block 30/2a".match(BLOCK_REF).slice(1, 4), ["30", "2", "a"]);
  assert.equal("the 3 km² square".match(BLOCK_REF), null);
});

await test("find_place finds Jackdaw in the NSTA layer", async () => {
  const t = createPlaceTools(memoryHost());
  const r = await t.exec("find_place", { query: "Jackdaw platform" });
  const c = r.candidates.find((x) => x.name === "JACKDAW");
  assert.ok(c, JSON.stringify(r));
  assert.match(c.source, /North Sea Transition Authority/);
  assert.ok(calls.some((u) => u.includes("nominatim")), "OpenStreetMap searched too");
});

await test("make_place builds a 3 km² square on the anchor and records how", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  const id = r.candidates.find((x) => x.name === "JACKDAW").id;
  const out = await t.exec("make_place", { anchor: id, shape: "square", area_km2: 3, words: "a 3 km² block around Jackdaw", match: "named_place", reason: "NSTA platform matched by name" });
  assert.equal(out.place, "Area 1");
  near(host.list[0].feature && turf.area(host.list[0].feature) / 1e6, 3, 0.01, "area");
  near(turf.distance(turf.centroid(host.list[0].feature), [2.37924, 56.90038]), 0, 0.01, "centred on the platform (km)");
  assert.equal(host.list[0].origin.anchor.source.publisher, "North Sea Transition Authority");
  assert.equal(out.offshore, true);
  // The person asked for this square round the platform: their area, not a search area.
  assert.equal(host.list[0].origin.role, "area");
  assert.equal(out.what_it_is, undefined);
  // The same square standing in for something the clues only point at is a search area, and the tool says so.
  const s2 = await t.exec("make_place", { anchor: id, shape: "circle", radius_km: 2, offset_km: 2, bearing_deg: 90, words: "a wind farm east of Jackdaw", match: "type_near_clues", reason: "x" });
  assert.equal(host.list[1].origin.role, "search_area");
  assert.match(s2.what_it_is, /^A search area \(built from clues round JACKDAW\)/);
  assert.equal(s2.role, "search_area");
  assert.equal(s2.next, undefined, "no instructions in the result");
  assert.match(await projectSummary(host.ref, host.list, null), /a search area \(the site's outline wasn't found\)/);
});

await test("feature shape uses the block outline; edits resize and rotate on the ground", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "30/2" });
  const blk = r.candidates.find((x) => x.name === "30/2");
  assert.ok(blk && blk.area_km2 > 200, JSON.stringify(r));
  await t.exec("make_place", { anchor: blk.id, shape: "feature", words: "block 30/2", match: "named_place", reason: "NSTA block reference" });
  const e = await t.exec("edit_place", { place: "Area 1", resize_to: 100, rotate_deg: 30 });
  near(e.area_km2, 100, 0.5, "resized area");
  assert.match(e.changed, /rotated 30°.*resized to 100/);
  const g = await t.exec("get_place", { place: "Area 1" });
  assert.equal(g.how_made.words, "block 30/2");
  assert.equal(g.edits.length, 1);
});

await test("offset and circle", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  const id = r.candidates.find((x) => x.name === "JACKDAW").id;
  await t.exec("make_place", { anchor: id, shape: "circle", radius_km: 2, offset_km: 10, bearing_deg: 0, words: "2 km circle 10 km north of Jackdaw", match: "settlement_or_region", reason: "offset from a single anchor" });
  const c = turf.centroid(host.list[0].feature).geometry.coordinates;
  near(turf.distance(c, [2.37924, 56.90038]), 10, 0.05, "10 km away");
  near(turf.bearing([2.37924, 56.90038], c), 0, 1, "to the north");
  near(turf.area(host.list[0].feature) / 1e6, Math.PI * 4, 0.1, "area of a 2 km circle");
});

await test("offer_choices passes the candidates and the recommendation to the page", async () => {
  const host = memoryHost();
  let shown = null;
  host.offerChoices = (o) => { shown = o; };
  const t = createPlaceTools(host);
  await t.exec("find_place", { query: "Jackdaw" });
  const ids = [...t.candidates.keys()];
  assert.ok(ids.length >= 2, "Jackdaw platform and field found");
  const out = await t.exec("offer_choices", { candidates: ids.slice(0, 2), recommended: ids[1], reason: "the field outline" });
  assert.equal(out.offered, 2);
  assert.equal(shown.recommended.id, ids[1]);
  await assert.rejects(() => t.exec("offer_choices", { candidates: [ids[0], ids[1]], recommended: "C99", reason: "x" }), /must be one of the candidates/);
});

await test("when Overpass is down, schools come from Nominatim, nearest first, and the next call fails fast", async () => {
  const seen = [];
  const f = async (url) => {
    seen.push(String(url));
    if (/interpreter/.test(String(url))) return { ok: false, status: 502, text: async () => "Bad gateway", json: async () => ({}) };
    return { ok: true, status: 200, json: async () => [
      { name: "Far School", category: "amenity", type: "school", lat: "55.97", lon: "-3.19", osm_type: "way", osm_id: 1 },
      { name: "Near School", category: "amenity", type: "school", lat: "55.955", lon: "-3.19", osm_type: "way", osm_id: 2 },
      { name: "A Cafe", category: "amenity", type: "cafe", lat: "55.954", lon: "-3.19", osm_type: "node", osm_id: 3 }] };
  };
  const r = await findFeaturesNear([-3.19, 55.953], "school", 3, { fetchFn: f });
  assert.deepEqual(r.candidates.map((c) => c.name), ["Near School", "Far School"]);
  assert.match(r.note, /Overpass was busy/);
  const t0 = Date.now();
  await assert.rejects(() => findFeaturesNear([-3.19, 55.953], "substation", 3, { fetchFn: f }), /isn't answering right now/);
  assert.ok(Date.now() - t0 < 1000, "failed fast");
});

await test("unknown anchors give a useful error", async () => {
  const t = createPlaceTools(memoryHost());
  await assert.rejects(() => t.exec("make_place", { anchor: "C99", shape: "point", words: "x", match: "none", reason: "x" }), /Use find_place first/);
});

await test("scale is worked out: size, map view, and the request when it says", async () => {
  assert.equal(R.deduceScale(turf.point([0, 0])), "local");
  assert.equal(R.deduceScale(turf.bboxPolygon([2.2, 56.8, 2.4, 57.0])), "local"); // a licence block
  assert.equal(R.deduceScale(turf.bboxPolygon([-3, 55, 2, 58])), "regional");
  assert.equal(R.deduceScale(turf.bboxPolygon([30, -27, 41, -10])), "global"); // Mozambique-sized
  // Map view widths: a street, Scotland, the world (including a view wider than 360°).
  assert.equal(R.scaleForKm(R.viewKm([-3.62, 55.97, -3.58, 55.99])), "local");
  assert.equal(R.scaleForKm(R.viewKm([-7, 54.5, 0, 59])), "regional");
  assert.equal(R.scaleForKm(R.viewKm([-400, -80, 400, 80])), "global");
  near(R.viewKm([0, 0, 1, 0.5]), 55.7, 0.5, "1° wide, half a degree tall at the equator");
  // The request can set the scale; the summary says where it came from and gives the map view.
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  await t.exec("make_place", { anchor: r.candidates[0].id, shape: "point", words: "screen the whole North Sea from Jackdaw", match: "named_place", reason: "x", scale: "regional" });
  const s = await projectSummary(ref, host.list, "Area 1", [-7, 54.5, 0, 59]);
  assert.match(s, /scale regional \(from request\)/);
  assert.match(s, /Map view: about \d+ km across \(regional scale\)/);
  assert.match(await projectSummary(ref, [], null, [-3.62, 55.97, -3.58, 55.99]), /No places yet\.\nMap view: about \d+ km across \(local scale\)/);
});

await test("confidence is worked out from the evidence, not chosen", async () => {
  const wd = { name: "Reko Diq Mine", type: "mine", source: { id: "wikidata", publisher: "Wikidata contributors" } };
  const nsta = { name: "JACKDAW", type: "PLATFORM", source: { id: "nsta-surface", atlas_id: "x", publisher: "North Sea Transition Authority" } };
  const village = { name: "Sembehun", type: "village", source: { id: "osm-nominatim" } };
  const salar = { name: "Salar del Rincón", type: "salt flat", source: { id: "wikidata" } };
  const ok = { pass: true, tight: true, direction: "E" }, ring = { pass: true, tight: true }, far = { pass: true, tight: false, direction: "SE" }, bad = { pass: false };
  assert.equal(rateConfidence({ cand: nsta, match: "name_and_type", shape: "point" }).confidence, "high");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", shape: "point" }).confidence, "medium", "a gazetteer point on its own");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", checks: [ok], shape: "point" }).confidence, "high", "confirmed by a check");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", checks: [ok, bad], shape: "point" }).confidence, "low", "Reko Diq: a failed check");
  assert.equal(rateConfidence({ cand: nsta, match: "name_and_type", checks: [bad], shape: "point" }).confidence, "low", "even authoritative");
  assert.equal(rateConfidence({ cand: village, match: "name_and_type", shape: "point" }).confidence, "low", "Sierra Rutile: a village isn't the mine");
  assert.equal(rateConfidence({ cand: salar, match: "name_and_type", checks: [ok], shape: "point" }).confidence, "medium", "a point for a salt flat");
  assert.equal(rateConfidence({ cand: salar, match: "name_and_type", checks: [ok], shape: "feature" }).confidence, "high", "its outline is fine");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", checks: [ring], shape: "point" }).confidence, "medium", "a distance alone is a ring");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", checks: [ring, ring], shape: "point" }).confidence, "high", "two rings cross");
  assert.equal(rateConfidence({ cand: wd, match: "name_and_type", checks: [far], shape: "point" }).confidence, "medium", "Nachtigal: 250 km downstream pins nothing");
  assert.equal(rateConfidence({ cand: wd, match: "type_near_clues", checks: [ok], shape: "point" }).confidence, "medium");
  assert.equal(rateConfidence({ cand: wd, match: "type_near_clues", checks: [ok, ring], shape: "point" }).confidence, "high");
  assert.equal(rateConfidence({ cand: nsta, match: "name_and_type", offset: true, shape: "circle" }).confidence, "medium", "offset caps at medium");
  assert.equal(rateConfidence({ cand: village, match: "settlement_or_region", offset: true, checks: [ok], shape: "point" }).confidence, "medium");
  assert.equal(rateConfidence({ cand: village, match: "named_place", shape: "circle" }).confidence, "high", "the person asked for the village itself");
  assert.equal(rateConfidence({ cand: wd, match: "name_only", shape: "point" }).confidence, "low");
  // Checks: distance within max(3 km, 35%); direction from the site within 45°.
  const site = [0, 0], east25 = { lonlat: turf.destination(site, 25, 90).geometry.coordinates, name: "X" };
  assert.equal(runCheck(site, east25, { expected_km: 25, direction: "E" }).pass, true);
  assert.equal(runCheck(site, east25, { expected_km: 30, direction: "ENE" }).pass, true);
  assert.equal(runCheck(site, east25, { expected_km: 80, direction: "E" }).pass, false);
  assert.equal(runCheck(site, east25, { expected_km: 25, direction: "W" }).pass, false);
  // Through the tool: Jackdaw with a check against the block it sits in.
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  const b = await t.exec("find_place", { query: "30/2" });
  const out = await t.exec("make_place", { anchor: r.candidates.find((x) => x.name === "JACKDAW").id, shape: "point", words: "the Jackdaw platform, about 4 km from block 30/2's centre", match: "name_and_type", reason: "x",
    checks: [{ against: b.candidates[0].id, expected_km: 60 }] });
  assert.equal(out.confidence, "low");
  assert.equal(out.checks[0].pass, false);
  assert.equal(host.list[0].origin.confidence, "low");
});

await test("project summary has no coordinates", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Jackdaw" });
  await t.exec("make_place", { anchor: r.candidates[0].id, shape: "square", area_km2: 3, words: "3 km² around Jackdaw", match: "named_place", reason: "x" });
  const s = await projectSummary(ref, host.list, "Area 1");
  assert.match(s, /Area 1 \[in focus\] \(proposed\): 3 km², offshore/);
  assert.doesNotMatch(s, /56\.9|2\.379/);
});

await test("messages alternate and start with the user", () => {
  const m = buildMessages({ recent: [{ role: "assistant", text: "hi" }, { role: "user", text: "(I accepted Area 1.)" }, { role: "user", text: "make it bigger" }, { role: "assistant", text: "done" }], summary: "- Area 1", userText: "rotate it" });
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant", "user"]);
  assert.match(m[0].content, /accepted Area 1[\s\S]*make it bigger/);
  assert.match(m.at(-1).content, /^<project>\n- Area 1\n<\/project>\n\nrotate it$/);
});

await test("a turn runs tools and every tool_use gets a result", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const script = [
    { stop_reason: "tool_use", content: [{ type: "tool_use", id: "a", name: "load_skill", input: { name: "place-finding" } }, { type: "tool_use", id: "b", name: "find_place", input: { query: "Jackdaw" } }] },
    { stop_reason: "tool_use", content: [{ type: "text", text: "Found it." }, { type: "tool_use", id: "c", name: "make_place", input: { anchor: "C1", shape: "square", area_km2: 3, words: "w", match: "named_place", reason: "r" } }] },
    { stop_reason: "end_turn", content: [{ type: "text", text: "Here's a 3 km² square around JACKDAW. Is that what you meant?" }] },
  ];
  const seen = [];
  const res = await runTurn({
    system: "s", messages: [{ role: "user", content: "x" }], tools: placeToolDefs([skill]),
    exec: (n, i) => t.exec(n, i),
    callClaude: async ({ messages }) => { seen.push(messages); return script.shift(); },
  });
  assert.match(res.text, /Is that what you meant/);
  const toolResults = seen[1].at(-1).content;
  assert.deepEqual(toolResults.map((r) => r.tool_use_id), ["a", "b"]);
  assert.equal(host.list.length, 1);
});

await test("holes in a published outline are filled and reported, not swapped for another shape", async () => {
  const G = await import("../js/geometry.js");
  const outer = [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]], hole = [[0.04, 0.04], [0.06, 0.04], [0.06, 0.06], [0.04, 0.06], [0.04, 0.04]];
  const r = G.fillHoles({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [outer, hole] } });
  assert.equal(r.holes, 1);
  assert.equal(r.feature.geometry.coordinates.length, 1);
  assert.ok(r.addedKm2 > 4.8 && r.addedKm2 < 5.0, `hole area ${r.addedKm2}`);
  assert.equal(G.fillHoles(r.feature).holes, 0);
});

await test("feature search uses the atlas, and reports OpenStreetMap as not checked when it's down", async () => {
  const { atlasFeaturesNear } = await import("../js/atlasfeatures.js");
  const calls = [];
  const call = async (tool, args) => {
    calls.push(tool);
    if (tool === "find_datasets") return { results: [
      { id: "mrds", title: "Minerals Resource Data System", publisher: "U.S. Geological Survey", publisher_type: "public-body", licence: "public domain" },
      { id: "fake", title: "Pennsylvania mines", publisher: "PSU", publisher_type: "academic", extent_may_be_overstated: true },
      { id: "broken", title: "Global mining polygons", publisher: "WMU", publisher_type: "academic" },
    ] };
    if (args.id === "broken") throw new Error("atlas: Couldn't fetch features: Requested operation is not supported");
    if (args.id === "mrds") return { returned: 3, features: [
      { type: "Feature", geometry: { type: "Point", coordinates: [27.095, -11.255] }, properties: { site_name: "Kipoi Central", commod1: "Copper" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [27.073, -11.232] }, properties: { site_name: "Judeira", commod1: "Copper" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [29.5, -9.0] }, properties: { site_name: "Far away" } },
    ] };
    throw new Error("unexpected " + args.id);
  };
  const r = await atlasFeaturesNear([27.06, -11.21], "mine or quarry", 25, { call });
  assert.deepEqual(r.candidates.map((c) => c.name), ["Judeira", "Kipoi Central"], "nearest first, far one dropped");
  assert.equal(r.candidates[0].source.authoritative, true);
  assert.ok(!calls.includes("fake"), "overstated extents skipped");
  assert.ok(r.checked.some((x) => x.error && /not supported/.test(x.error)), "a broken layer is reported, not hidden");
  // Through the tool, with Overpass failing.
  const host = memoryHost();
  host.atlas = call;
  host.fetchFn = async (url) => { if (/overpass|interpreter/.test(url)) throw new Error("timed out"); return fetchFn(url); };
  const t = createPlaceTools(host);
  const town = await t.exec("find_place", { query: "Jackdaw" });
  const out = await t.exec("find_features_near", { anchor: town.candidates[0].id, feature_type: "mine or quarry", radius_km: 25 });
  const osm = out.sources.find((s) => s.source === "OpenStreetMap");
  assert.ok(osm.not_checked, "OpenStreetMap marked not checked");
  assert.ok(out.sources.find((s) => s.source === "AI Living World Atlas").found >= 0);
});

await test("an admin area anchors on its centre but builds as its outline, main part kept and the rest reported", async () => {
  const sq = (x, y, d) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
  const host = memoryHost();
  host.fetchFn = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("nominatim") && u.includes("q=Fife")) return { ok: true, status: 200, json: async () => [{ osm_type: "relation", osm_id: 1, category: "boundary", type: "administrative", addresstype: "county", name: "Fife", display_name: "Fife, Scotland, United Kingdom", lat: "56.33", lon: "-3.0", importance: 0.6, address: { country: "United Kingdom" }, geojson: { type: "MultiPolygon", coordinates: [sq(-3.6, 56.0, 0.8), sq(-2.56, 56.18, 0.02)] } }] };
    return fetchFn(url);
  };
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Fife" });
  const c = r.candidates.find((x) => x.has_outline);
  assert.ok(c, "outline offered");
  const out = await t.exec("make_place", { anchor: c.id, shape: "feature", words: "Fife", match: "named_place", reason: "x" });
  const g = host.list[0].feature.geometry;
  assert.equal(g.type, "Polygon");
  assert.match(out.how, /1 smaller part/);
  assert.equal(out.confidence, "high");
  const pt = await t.exec("make_place", { anchor: c.id, shape: "point", words: "Fife", match: "named_place", reason: "x" });
  assert.equal(pt.confidence, "medium", "a point for a county");
});

await test("a named licence block is found by searching the catalogue's layers for that country", async () => {
  const sq = (x, y, d) => ({ type: "Polygon", coordinates: [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]] });
  const asked = [];
  const host = memoryHost();
  host.ref = { get: async (k) => (k === "countries" ? { type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Nigeria", iso: "NGA" }, geometry: sq(3, 4.3, 10) }] } : { type: "FeatureCollection", features: [] }) };
  host.atlas = async (tool, args) => {
    if (tool === "find_datasets") {
      assert.ok(args.bbox[1] < 4.3 - 2, "country search includes its waters");
      return { matches: 3, results: args.concept === "oil-gas" ? [
        { id: "wells", title: "Wells", publisher: "Ministry", publisher_type: "central-gov" },
        { id: "junk", title: "KY Oil and Gas Wells", publisher: "Kentucky", publisher_type: "unknown", extent_may_be_overstated: true },
        { id: "blocks", title: "Petroleum licence blocks", publisher: "Regulator", publisher_type: "regulator" },
      ] : [] };
    }
    asked.push(args.id);
    assert.equal(args.text, "145", "server search on the distinctive part");
    if (args.id === "blocks") return { returned: 2, features: [
      { type: "Feature", properties: { lic_type: "OML", number: "145", operator: "X" }, geometry: sq(5, 3.5, 0.3) },
      { type: "Feature", properties: { lic_type: "OML", number: "1450" }, geometry: sq(6, 3.5, 0.3) },
    ] };
    return { returned: 1, features: [{ type: "Feature", properties: { name: "OML 145 well" }, geometry: { type: "Point", coordinates: [5.1, 3.6] } }] };
  };
  host.fetchFn = async () => ({ ok: true, status: 200, json: async () => [] });
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "OML 145", kind: "licence block or concession", area: "Nigeria" });
  assert.equal(asked[0], "blocks", "licence layer asked first");
  assert.ok(!asked.includes("junk"), "overstated extents skipped");
  const c = r.candidates[0];
  assert.match(c.source, /licence blocks/);
  assert.ok(c.area_km2 > 0, "comes with its outline");
  assert.equal(r.atlas.found, 1, "1450 isn't 145; the well point is the wrong geometry");
  assert.equal(r.atlas.layers_checked.skipped_wrong_geometry, 1);
  assert.equal(r.atlas.layers_checked.asked, 2);
  assert.match(r.atlas.searched, /Nigeria and its waters/);
});

await test("with no licence layers there, the reply says so rather than pointing elsewhere", async () => {
  const host = memoryHost();
  host.ref = { get: async () => ({ type: "FeatureCollection", features: [] }) };
  host.view = () => [2, 3, 9, 7];
  host.atlas = async () => ({ matches: 0, results: [] });
  host.fetchFn = async () => ({ ok: true, status: 200, json: async () => [] });
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "OML 145", kind: "licence block or concession" });
  assert.equal(r.atlas.layers_found, 0);
  assert.match(r.atlas.note, /no licence block or concession layers covering the map view/);
});

await test("a road search skips junction-point layers and keeps going until it finds lines", async () => {
  const host = memoryHost();
  const asked = [];
  host.atlas = async (tool, args) => {
    if (tool === "find_datasets") return { matches: 25, results: [
      ...Array.from({ length: 22 }, (_, i) => ({ id: `j${i}`, title: `Motorway junctions ${i}`, publisher: "Roads agency", publisher_type: "central-gov" })),
      { id: "lines", title: "Open Roads", publisher: "Mapping agency", publisher_type: "mapping-agency" },
    ] };
    asked.push(args.id);
    if (args.id === "lines") return { returned: 1, features: [{ type: "Feature", properties: { road_number: "M9" }, geometry: { type: "LineString", coordinates: [[host.at[0] - 0.05, host.at[1]], [host.at[0] + 0.05, host.at[1] + 0.01]] } }] };
    return { returned: 1, features: [{ type: "Feature", properties: { name: "M9 J3" }, geometry: { type: "Point", coordinates: host.at } }] };
  };
  const t = createPlaceTools(host);
  const town = await t.exec("find_place", { query: "Jackdaw" });
  const { lon, lat } = town.candidates[0];
  host.at = [lon, lat];
  const out = await t.exec("find_features_near", { anchor: town.candidates[0].id, feature_type: "main road", radius_km: 50, name: "M9" });
  assert.equal(asked[0], "lines", "line layer asked before junction layers");
  const atl = out.sources.find((s) => s.source === "AI Living World Atlas");
  assert.ok(atl.found >= 1);
});

await test("lookups in one step run at the same time; map changes run after them, in order", async () => {
  const { runTurn } = await import("../js/converse.js");
  const log = [];
  let round = 0;
  const callClaude = async () => (round++ === 0
    ? { stop_reason: "tool_use", content: [
      { type: "tool_use", id: "a", name: "find_place", input: { query: "A" } },
      { type: "tool_use", id: "m", name: "make_place", input: {} },
      { type: "tool_use", id: "b", name: "find_place", input: { query: "B" } }] }
    : { stop_reason: "end_turn", content: [{ type: "text", text: "done" }] });
  const exec = async (name, input) => {
    log.push(`start ${name} ${input.query || ""}`.trim());
    await new Promise((ok) => setTimeout(ok, name === "find_place" ? 50 : 1));
    log.push(`end ${name} ${input.query || ""}`.trim());
    return { ok: true };
  };
  const t0 = Date.now();
  const r = await runTurn({ system: "s", messages: [{ role: "user", content: "x" }], tools: [], exec, callClaude });
  assert.ok(Date.now() - t0 < 95, "two 50 ms searches overlapped");
  assert.deepEqual(log.slice(0, 2), ["start find_place A", "start find_place B"]);
  assert.equal(log.indexOf("start make_place") > log.indexOf("end find_place B"), true);
  assert.deepEqual(r.history[2].content.map((x) => x.tool_use_id), ["a", "m", "b"], "results in the order asked");
});

await test("pieces of one road in one layer are joined, so a corridor follows the whole stretch", async () => {
  const host = memoryHost();
  const t = createPlaceTools(host);
  const town = await t.exec("find_place", { query: "Jackdaw" });
  const { lon, lat } = town.candidates[0];
  host.atlas = async (tool) => (tool === "find_datasets"
    ? { matches: 1, results: [{ id: "roads", title: "Open Roads", publisher: "Mapping agency", publisher_type: "mapping-agency", geometry: ["line"] }] }
    : { returned: 3, features: [0, 1, 2].map((i) => ({ type: "Feature", properties: { road_number: "M9" }, geometry: { type: "LineString", coordinates: [[lon - 0.1 + i * 0.05, lat], [lon - 0.05 + i * 0.05, lat]] } })) });
  const out = await t.exec("find_features_near", { anchor: town.candidates[0].id, feature_type: "main road", radius_km: 20, name: "M9" });
  const c = out.candidates.find((x) => x.name === "M9");
  assert.equal(c.details.pieces_joined, 3);
  const built = await t.exec("make_place", { anchor: c.id, shape: "buffer", buffer_km: 0.5, words: "corridor", match: "named_place", reason: "x" });
  assert.ok(built.area_km2 > 5, `corridor covers all three pieces (${built.area_km2} km²)`);
});

await test("places are named after what they were built from, not 'Area 1'", () => {
  const sq = turf.polygon([[[1.9, 57], [1.93, 57], [1.93, 57.016], [1.9, 57.016], [1.9, 57]]]);
  const cand = (name) => ({ cand: { name }, label: name });
  assert.equal(cleanName("JACKDAW"), "Jackdaw");
  assert.equal(cleanName("Bonga North Oil and Gas Field (Nigeria)"), "Bonga North");
  assert.equal(cleanName("30/2"), "30/2");
  assert.equal(cleanName("M9"), "M9");
  assert.match(placeName({ shape: "square" }, cand("JACKDAW"), sq), /^Jackdaw \d(\.\d)? km²$/);
  assert.equal(placeName({ shape: "feature" }, cand("Linlithgow Loch"), sq), "Linlithgow Loch");
  assert.equal(placeName({ shape: "buffer" }, cand("M9"), sq), "M9 corridor");
  assert.equal(placeName({ shape: "square", name: "the Jackdaw box" }, cand("JACKDAW"), sq), "the Jackdaw box");
  assert.equal(placeName({ shape: "square", name: "Tabernas solar site (placeholder)" }, cand("Tabernas"), sq), "Tabernas solar site (placeholder)", "the analyst's own name isn't rewritten");
  assert.equal(placeName({ shape: "point" }, { cand: { name: "" }, label: "C4" }, sq), null, "no name, no made-up one");
  assert.equal(placeName({ shape: "point", name: "Miri city (OpenStreetMap C29)" }, cand("Miri"), sq), "Miri city", "no candidate ids in names (Miri log, 18 Nov)");
  assert.equal(placeName({ shape: "point", name: "C29: Miri" }, cand("Miri"), sq), "Miri");
});

await test("'United Kingdom' is the UK itself, not its territories (Ben Nevis log, 20 Nov: labelled Dhekelia)", async () => {
  const host = memoryHost();
  let box = null;
  host.atlas = async (tool, args) => { if (tool === "find_datasets") { box = args.bbox; return { matches: 0, results: [] }; } return { returned: 0, features: [] }; };
  host.fetchFn = async () => ({ ok: true, status: 200, json: async () => [] });
  const t = createPlaceTools(host);
  const r = await t.exec("find_place", { query: "Ben Nevis", kind: "protected area", area: "United Kingdom" });
  assert.match(r.atlas.searched, /United Kingdom and its waters/);
  assert.doesNotMatch(r.atlas.searched, /Dhekelia|main part/);
  assert.ok(box[0] > -15 && box[2] < 5 && box[1] > 45, `Great Britain and Northern Ireland, not the Falklands or Cyprus (${box})`);
  // A territory by its own name still works, and a name with no country of its own falls back to the sovereign's.
  const g = await t.exec("find_place", { query: "x", kind: "protected area", area: "Gibraltar" });
  assert.match(g.atlas.searched, /Gibraltar and its waters/);
});

await test("distance checks must quote the person; a rebuild replaces its proposal and keeps its checks; removing places", async () => {
  const host = memoryHost();
  host.said = ["Ben Nevis, Scotland"];
  host.personSaid = () => host.said.join("\n");
  host.lastPersonText = () => host.said.at(-1);
  host.removePlace = (name) => { const i = host.list.findIndex((p) => p.name === name); host.list.splice(i, 1); };
  // As in the page: places keep the name they're given, made unique with (2).
  host.addPlace = ({ feature, origin, name }) => {
    let nm = name || `Area ${host.list.length + 1}`;
    for (let k = 2; host.list.some((q) => q.name === nm); k++) nm = `${name} (${k})`;
    const p = { name: nm, feature, origin, status: "proposed", edits: [] }; host.list.push(p); return p;
  };
  host.fetchFn = async (url) => {
    const u = decodeURIComponent(String(url));
    if (u.includes("wikidata") && /Distillery/i.test(u)) return { ok: true, status: 200, json: async () => ({ search: [] }) };
    return { ok: true, status: 200, json: async () => [] };
  };
  const t = createPlaceTools(host);
  // Two candidates by hand: the summit and the distillery 6 km NW of it.
  const cs = t.candidates;
  cs.set("C1", { id: "C1", name: "Ben Nevis", type: "natural: peak", lonlat: [-5.0035, 56.7969], geometry: { type: "Point", coordinates: [-5.0035, 56.7969] }, source: { title: "OSM", publisher: "OpenStreetMap contributors", tier: "community" }, licence: "ODbL" });
  cs.set("C4", { id: "C4", name: "Ben Nevis distillery", type: "whisky distillery", lonlat: [-5.0739, 56.8351], geometry: { type: "Point", coordinates: [-5.0739, 56.8351] }, source: { title: "Wikidata", publisher: "Wikidata contributors", tier: "community" }, licence: "CC0" });
  // An invented check (the person gave no distance clue) is left out, so it can't sink or lift the confidence.
  const a = await t.exec("make_place", { anchor: "C1", shape: "point", words: "Ben Nevis, Scotland", match: "name_and_type", reason: "x", name: "Ben Nevis", checks: [{ against: "C4", expected_km: 4, direction: "NE", quote: "4 km NE of the distillery" }, { against: "C4", expected_km: 4 }] });
  assert.equal(a.confidence, "medium");
  assert.ok(a.checks.every((c) => c.pass === null && /left out/.test(c.why)), JSON.stringify(a.checks));
  // A clue the person did give is measured; when it fails, a rebuild with replaces keeps it.
  host.said.push("the summit, about 4 km north-east of the Ben Nevis distillery");
  const b = await t.exec("make_place", { anchor: "C1", shape: "point", words: "the summit", match: "name_and_type", reason: "x", replaces: "Ben Nevis", checks: [{ against: "C4", expected_km: 4, direction: "NE", quote: "about 4 km north-east of the Ben Nevis distillery" }] });
  assert.equal(b.replaced, "Ben Nevis");
  assert.equal(b.place, "Ben Nevis", "the rebuild takes the old name");
  assert.equal(host.list.length, 1, "no duplicate left behind");
  assert.equal(b.confidence, "low");
  assert.equal(b.checks[0].pass, false);
  const c = await t.exec("make_place", { anchor: "C1", shape: "point", words: "the summit", match: "name_and_type", reason: "x", replaces: "Ben Nevis" });
  assert.equal(c.failed_checks_left_out[0].quote, "about 4 km north-east of the Ben Nevis distillery", "a dropped failed check is listed, not hidden");
  assert.match(c.about_them, /failed on the place this one replaces/);
  assert.equal(host.list.length, 1);
  // A corrected clue replaces the old one: nothing listed.
  host.said.push("sorry, about 6 km south-east of the distillery");
  const e = await t.exec("make_place", { anchor: "C1", shape: "point", words: "the summit", match: "name_and_type", reason: "x", replaces: "Ben Nevis", checks: [{ against: "C4", expected_km: 6, direction: "NW", quote: "about 6 km south-east of the distillery" }] });
  assert.equal(e.checks[0].pass, true, "6 km SE of the distillery, as the site is");
  assert.equal(e.failed_checks_left_out, undefined, "the earlier failed clue came from a previous rebuild, not this one");
  // A rebuild given the same name keeps it, rather than becoming "Ben Nevis (2)" (Cnoc Buidhe replay, 20 Nov).
  const same = await t.exec("make_place", { anchor: "C1", shape: "point", words: "the summit", match: "name_and_type", reason: "x", replaces: "Ben Nevis", name: "Ben Nevis" });
  assert.equal(same.place, "Ben Nevis");
  assert.equal(host.list.length, 1);
  assert.equal(host.list[0].name, "Ben Nevis");
  // Only the analyst's own proposals can be replaced or removed unasked.
  host.list[0].status = "accepted";
  await assert.rejects(() => t.exec("make_place", { anchor: "C1", shape: "point", words: "x", match: "name_and_type", reason: "x", replaces: "Ben Nevis" }), /isn't a proposal of yours/);
  await assert.rejects(() => t.exec("remove_place", { place: "Ben Nevis", reason: "tidy" }), /remove it only when they ask/);
  host.said.push("Can you remove Ben Nevis?");
  const rm = await t.exec("remove_place", { place: "Ben Nevis", reason: "the person asked" });
  assert.equal(rm.removed, "Ben Nevis");
  assert.deepEqual(rm.places_left, []);
  // Without a record of the person's words (older hosts), checks are measured as before.
  const plain = createPlaceTools({ ...memoryHost() });
  plain.candidates.set("C1", cs.get("C1")); plain.candidates.set("C4", cs.get("C4"));
  const d = await plain.exec("make_place", { anchor: "C1", shape: "point", words: "x", match: "name_and_type", reason: "x", checks: [{ against: "C4", expected_km: 6, direction: "NW" }] });
  assert.equal(d.checks[0].pass, true);
});

await test("a place found from words isn't screened in the same turn: shown and asked first (Livingston, 24 Nov)", async () => {
  const host = memoryHost();
  const screened = [];
  host.screening = { screen: async (i, p) => { screened.push(p.name); return { run: `R${screened.length}`, site: p.name }; } };
  const t = createPlaceTools(host);
  t.newTurn();
  const found = await t.exec("find_place", { query: "Jackdaw platform" });
  const c = found.candidates.find((x) => /JACKDAW/i.test(x.name));
  await t.exec("make_place", { anchor: c.id, shape: "square", area_km2: 3, words: "screen the Jackdaw platform", match: "named_place", reason: "found" });
  const name = host.list[0].name;
  const held = await t.exec("screen_site", { place: name, asset_type: "platform" });
  assert.equal(held.run, undefined, "not screened before the person has seen it");
  assert.equal(held.held, "confirm");
  assert.equal(held.place, name);
  assert.match(held.queued, /^a constraints screen for a platform/);
  assert.ok(!("next" in held) && !("not_yet" in held), "no instructions to the model: code writes the question");
  assert.equal(screened.length, 0);
  assert.match(t.pendingLines()[0], /constraints screen .* is waiting for the person's yes/);
  // Next message ("yes, that's it"): screened, with what was asked kept in code even if the analyst forgets it.
  t.newTurn();
  const asked = [];
  host.screening.screen = async (i, p) => { asked.push(i); screened.push(p.name); return { run: `R${screened.length}`, site: p.name }; };
  assert.equal((await t.exec("screen_site", { place: name, asset_type: "other" })).run, "R1");
  assert.equal(asked[0].asset_type, "other", "what's said now wins");
  assert.equal(t.pendingLines().length, 0, "nothing waiting once it ran");
  // Accepted with the card's button: screened, whatever the turn.
  await t.exec("make_place", { anchor: c.id, shape: "square", area_km2: 5, words: "5 km² round Jackdaw", match: "named_place", reason: "found" });
  host.list[1].status = "accepted";
  assert.equal((await t.exec("screen_site", { place: host.list[1].name, asset_type: "platform" })).run, "R2");
  // Typed coordinates are the person's own: screened at once.
  const typed = await t.exec("find_place", { query: "55.522759, -5.650122" });
  await t.exec("make_place", { anchor: typed.candidates[0].id, shape: "point", words: "screen 55.522759, -5.650122", match: "named_place", reason: "typed" });
  assert.equal((await t.exec("screen_site", { place: host.list[2].name, asset_type: "other" })).run, "R3");
  // A drawn place (not built by make_place) is screened at once too.
  host.list.push({ name: "Area 9", feature: host.list[0].feature, origin: { method: "drawn" }, status: "drawn", edits: [] });
  assert.equal((await t.exec("screen_site", { place: "Area 9", asset_type: "other" })).run, "R4");
});

await test("a proposal the person said 'Not quite' to stays the analyst's to replace or remove (Shell House, Perth, 24 Nov)", async () => {
  const host = memoryHost();
  host.said = ["it should be a rectangle"];
  host.lastPersonText = () => host.said.at(-1);
  host.removePlace = (name) => { const i = host.list.findIndex((p) => p.name === name); host.list.splice(i, 1); };
  host.addPlace = ({ feature, origin, name }) => { const p = { name: name || `Area ${host.list.length + 1}`, feature, origin, status: "proposed", edits: [] }; host.list.push(p); return p; };
  const t = createPlaceTools(host);
  const found = await t.exec("find_place", { query: "Jackdaw platform" });
  const c = found.candidates.find((x) => /JACKDAW/i.test(x.name));
  await t.exec("make_place", { anchor: c.id, shape: "square", area_km2: 3, words: "the Jackdaw platform", match: "named_place", reason: "found", name: "Jackdaw site" });
  host.list[0].status = "revising"; // the card's "Not quite"
  const r = await t.exec("make_place", { anchor: c.id, shape: "rectangle", width_km: 2, height_km: 1, words: "a rectangle, not a square", match: "named_place", reason: "asked", replaces: "Jackdaw site" });
  assert.equal(host.list.length, 1, "the rejected shape is replaced, not left beside the new one");
  assert.equal(r.place, "Jackdaw site");
  // An accepted place is still the person's.
  host.list[0].status = "accepted";
  await assert.rejects(() => t.exec("make_place", { anchor: c.id, shape: "square", area_km2: 1, words: "x", match: "named_place", reason: "x", replaces: "Jackdaw site" }), /isn't a proposal of yours/);
  host.list[0].status = "revising";
  assert.equal((await t.exec("remove_place", { place: "Jackdaw site", reason: "rejected" })).removed, "Jackdaw site");
});

await test("several skills on offer: no screen until the person asks for one; the analyst offers the skills (Shell House, Perth, 24 Nov)", async () => {
  const host = memoryHost();
  host.said = ["im interested in a change of land use at that location and would like to site a sub station on that parcel of land", "Yes, use Area 1."];
  host.personSaid = () => host.said.join("\n");
  const offered = [];
  host.offerSkills = (name) => { offered.push(name); return { place: name, offered: ["screen", "Developable area (not built yet)"] }; };
  host.screening = { screen: async (i, p) => ({ run: "R1", site: p.name }) };
  host.list.push({ name: "Area 1", feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[0, 0], [0.01, 0], [0.01, 0.01], [0, 0]]] } }, origin: { method: "drawn" }, status: "accepted", edits: [] });
  const t = createPlaceTools(host);
  const held = await t.exec("screen_site", { place: "Area 1", asset_type: "substation" });
  assert.equal(held.run, undefined, "saying what's planned isn't asking for a screen");
  assert.equal(held.held, "skills");
  assert.deepEqual(offered, ["Area 1"], "the skills are offered in code, not by telling the analyst to");
  // The screen chip, an asset pick or the person's own words ask for a screen.
  for (const ask of ["Screen Area 1 for environmental constraints.", "Screen Area 1 as a substation site.", "what are the risks here?", "any constraints?"]) {
    host.said.push(ask);
    assert.equal((await t.exec("screen_site", { place: "Area 1", asset_type: "substation" })).run, "R1", ask);
    host.said.pop();
  }
});

await test("a place that isn't a site is asked about first: which part? (plan item 1, 25 Nov)", async () => {
  const { notASite } = await import("../js/siterole.js");
  const words = (type, shape, extra = {}) => ({ method: "words", words: "x", shape, anchor: { name: "X", type }, ...extra });
  const poly = { type: "Polygon" }, pt = { type: "Point" }, line = { type: "LineString" };
  assert.equal(notASite(words("lake", "feature"), poly, { area_km2: 83 }).kind, "water");
  assert.equal(notASite(words("natural: water (lake)", "feature"), poly).kind, "water");
  assert.deepEqual(notASite(words("boundary: administrative (country)", "feature"), poly, { area_km2: 268000 }), { kind: "region", what: "a whole country", type: "boundary: administrative (country)", area_km2: 268000 });
  assert.equal(notASite(words("place: town", "point"), pt).kind, "settlement");
  assert.equal(notASite(words("town, small burgh", "point"), pt).kind, "settlement");
  assert.equal(notASite(words("highway: secondary", "point"), pt).kind, "line");
  assert.equal(notASite(words("highway: secondary", "feature"), line).kind, "line");
  assert.equal(notASite(words("landuse: commercial", "feature"), poly, { area_km2: 5000 }).kind, "region", "an area this big on land is a region, whatever it's called");
  // Sites, or choices already made: never asked about.
  assert.equal(notASite(words("landuse: industrial", "feature"), poly, { area_km2: 2.4 }), null, "Stanlow Refinery");
  assert.equal(notASite(words("castle", "point"), pt), null, "a named feature's point is a site (screened as a search area round it)");
  assert.equal(notASite(words("petroleum exploration permit", "feature"), poly, { area_km2: 4000 }), null, "a big permit is still a site");
  assert.equal(notASite(words("lake", "feature"), poly, { area_km2: 900, offshore: true }).kind, "water");
  assert.equal(notASite(words("place: town", "square"), poly), null, "a square the analyst built near a town is a choice of part");
  assert.equal(notASite(words("place: town", "point", { offset: true }), pt), null, "moved from the town");
  assert.equal(notASite({ method: "drawn" }, poly, { area_km2: 9000 }), null, "drawn by the person");
  assert.equal(notASite({ method: "words", shape: "feature", anchor: { type: "lake" } }, poly, {}).what, "a lake or other water body");

  // In the tool: held with code's question; "whole" runs it on all of it; the request is kept for the answer.
  const host = memoryHost();
  const screened = [];
  host.screening = { screen: async (i, p) => { screened.push(i); return { run: "R1", site: p.name }; }, assetLabel: (id) => ({ "oil-gas-onshore": "onshore oil or gas field" })[id] };
  const t = createPlaceTools(host);
  host.list.push({ name: "Lake Tekapo", feature: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[170.5, -43.9], [170.6, -43.9], [170.6, -43.8], [170.5, -43.9]]] } },
    origin: { method: "words", words: "Lake Tekapo", shape: "feature", match: "name_and_type", confidence: "high", anchor: { name: "Lake Tekapo", type: "lake", source: { publisher: "Wikidata" } } }, status: "accepted", edits: [] });
  const held = await t.exec("screen_site", { place: "Lake Tekapo", asset_type: "oil-gas-onshore" });
  assert.equal(held.held, "which_part");
  assert.equal(held.kind, "water");
  assert.match(held.queued, /constraints screen for an onshore oil or gas field/);
  assert.equal(screened.length, 0);
  assert.equal(t.pendingFor(host.list[0]).held, "which_part");
  assert.equal((await t.exec("screen_site", { place: "Lake Tekapo", whole: true })).run, "R1", "all of it, when the person says so");
  assert.equal(screened[0].asset_type, "oil-gas-onshore", "what was asked is kept");
});

console.log(`${passed} place tests passed`);
