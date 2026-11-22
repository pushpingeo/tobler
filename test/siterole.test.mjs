// Site footprint vs search area (js/siterole.js), from Rob's Cnoc Buidhe screen (20 Nov).
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { placeRole, coverageIn, whereText, reword, applySearchArea, searchHeadline, SEARCH_BAND, LOW_COVERAGE } from "../js/siterole.js";
import { seaMatters } from "../js/seavalues.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

await test("roles come from how the place was built, not from the model", () => {
  const poly = { type: "Polygon" };
  assert.equal(placeRole({ method: "drawn" }, poly).role, "footprint");
  assert.equal(placeRole({}, { type: "Point" }).role, "point");
  assert.equal(placeRole({ method: "words", match: "name_and_type", shape: "feature", anchor: { name: "Rosebank" } }, poly).role, "footprint");
  assert.equal(placeRole({ method: "words", match: "named_place", steps: ["outline of 30/2"] }, poly).role, "footprint");
  assert.equal(placeRole({ method: "words", match: "named_place", shape: "square", anchor: { name: "Jackdaw" } }, poly).role, "area");
  // Cnoc Buidhe: a circle 2.5 km east of a village, standing in for a wind farm nobody found.
  const cb = placeRole({ method: "words", match: "type_near_clues", shape: "circle", offset: true, anchor: { name: "Bellochantuy" } }, poly);
  assert.equal(cb.role, "search_area");
  assert.equal(cb.why, "built from clues round Bellochantuy");
  // A published outline moved somewhere else isn't the outline any more; a region's outline stands in for a site.
  assert.equal(placeRole({ method: "words", match: "name_and_type", shape: "feature", offset: true }, poly).role, "search_area");
  assert.equal(placeRole({ method: "words", match: "settlement_or_region", shape: "feature" }, poly).role, "search_area");
  // Évora (Rob, 22 Nov): "a 1 km² site 5 km west of Évora" is a site the person defined, so an area, not a search area.
  const ev = placeRole({ method: "words", match: "settlement_or_region", shape: "square", offset: true, site_defined: true, anchor: { name: "Évora" } }, poly);
  assert.equal(ev.role, "area");
  assert.equal(ev.why, "the site as you described it, placed from Évora");
  assert.equal(placeRole({ method: "words", match: "settlement_or_region", shape: "square", offset: true, anchor: { name: "Évora" } }, poly).role, "search_area", "without the flag it stays a search area");
  assert.equal(placeRole({ method: "words", match: "settlement_or_region", shape: "feature", site_defined: true }, poly).role, "search_area", "an outline standing in for a site isn't a site the person sized");
  // A role already recorded wins.
  assert.equal(placeRole({ method: "words", role: "footprint", role_why: "x", match: "none" }, poly).role, "footprint");
});

await test("coverage: equal-area share of the search area, and which side", () => {
  const site = turf.circle([-5.66, 55.517], 2.5, { units: "kilometers", steps: 64 });
  const east = turf.circle([-5.62, 55.517], 1, { units: "kilometers", steps: 32 }); // centred on the east edge
  const c = coverageIn(site, east.geometry);
  near(c.km2, 1.4, 0.15, "a bit under half the small circle lies inside");
  near(c.coverage, c.km2 / (Math.PI * 2.5 ** 2), 0.01, "share of the search area");
  assert.equal(c.side, "eastern");
  assert.match(whereText(c), /^in the search area \(covers 7(\.\d)?% of it, on its eastern side\)$/);
  const half = coverageIn(site, turf.bboxPolygon([-5.66, 55.4, -5.5, 55.6]).geometry);
  near(half.coverage, 0.5, 0.02, "half");
  assert.equal(coverageIn(site, turf.bboxPolygon([-6, 55, -5, 56]).geometry).side, "most");
  assert.equal(whereText(coverageIn(site, turf.point([-5.66, 55.518]).geometry)), "in the search area (in its middle)");
  assert.equal(coverageIn(site, turf.point([-5, 55.5]).geometry), null, "outside");
  assert.equal(coverageIn(site, turf.circle([-5.3, 55.5], 1, { units: "kilometers" }).geometry), null, "an area outside");
  assert.match(whereText(coverageIn(site, turf.lineString([[-5.7, 55.517], [-5.6, 55.517]]).geometry)), /^in the search area/);
  // Same answer at high latitude: the overlay is equal-area wherever it is.
  const north = turf.circle([20, 70], 2.5, { units: "kilometers", steps: 64 });
  const nhalf = turf.polygon([[[20, 69], [21, 69], [21, 71], [20, 71], [20, 69]]]);
  near(coverageIn(north, nhalf.geometry).coverage, 0.5, 0.02, "half at 70°N");
});

await test("words: nothing claims 'on site' for a search area", () => {
  assert.equal(reword("Special Protection Area on site: collision risk"), "Special Protection Area in the search area: collision risk");
  assert.equal(reword("On-site works need consent"), "In the search area works need consent");
  assert.equal(reword("Deep peat across the footprint"), "Deep peat across the search area");
  assert.equal(reword("Pipelines on and near site"), "Pipelines in and near the search area");
  assert.equal(reword("Scheduled monuments on the site"), "Scheduled monuments in the search area");
  assert.equal(reword("Two km from the site edge"), "Two km from the site edge");
  assert.equal(reword(null), null);
});

await test("flags inside a search area: relation, coverage; low under 10%, uncapped at 10% or more, points medium", () => {
  const ev = new Map([
    ["E1", { fid: "E1", in_search_area: true, coverage: 0.04, side: "eastern" }],
    ["E2", { fid: "E2", in_search_area: true, coverage: 0.3 }],
    ["E3", { fid: "E3", in_search_area: true }], // a point inside: no share
    ["E4", { fid: "E4", distance_km: 2 }],
  ]);
  const out = applySearchArea([
    { risk: "SPA on site", confidence: "high", fids: ["E1"], nearest_km: 0 },
    { risk: "Deep peat across the footprint", confidence: "high", fids: ["E2"], nearest_km: 0 },
    { risk: "Monument on site", confidence: "high", fids: ["E3", "E1"], nearest_km: 0 },
    { risk: "Wind farm 2 km away", confidence: "high", fids: ["E4"], nearest_km: 2 },
    { risk: "Low already", confidence: "low", fids: ["E1"], nearest_km: 0 },
  ], ev);
  assert.equal(out[0].relation, SEARCH_BAND);
  assert.equal(out[0].confidence, "low", `under ${LOW_COVERAGE * 100}% covered`);
  assert.equal(out[0].risk, "SPA in the search area");
  assert.equal(out[1].confidence, "high", "covering 30% of the search area is uncapped (Rob, 22 Nov)");
  assert.equal(out[1].confidence_capped, undefined);
  assert.equal(out[1].coverage, 0.3);
  assert.equal(out[2].confidence, "medium", "a point inside can't be sized, so medium");
  assert.equal(out[3].confidence, "high");
  assert.equal(out[3].relation, "outside the search area");
  assert.equal(out[4].confidence, "low");
  assert.equal(out[4].confidence_capped, undefined, "already at or below the cap");
  // The line itself: exactly 10% is uncapped; just under is low.
  const edge = (c) => applySearchArea([{ risk: "x", confidence: "high", fids: ["A"], nearest_km: 0 }], new Map([["A", { fid: "A", in_search_area: true, coverage: c }]]))[0].confidence;
  assert.equal(edge(LOW_COVERAGE), "high");
  assert.equal(edge(LOW_COVERAGE - 0.001), "low");
});

await test("headline and when the sea belongs in the write-up", () => {
  assert.match(searchHeadline({ area_km2: 19.62, role_why: "built from clues round Bellochantuy" }),
    /^Screened a 19\.6 km² search area \(built from clues round Bellochantuy\), because the site's outline wasn't found\./);
  assert.match(searchHeadline({ area_km2: 0.4, role_why: "x" }), /a 40 ha search area/);
  const traffic = { busiest: { distance_km: 5 } };
  assert.equal(seaMatters({ site: { setting: "onshore" }, sea: { traffic }, flags: [] }), false, "onshore, no flag on traffic");
  assert.equal(seaMatters({ site: { setting: "onshore" }, sea: { traffic }, flags: [{ evidence: [{ from_values: "vessel traffic" }] }] }), true);
  assert.equal(seaMatters({ site: { setting: "offshore" }, sea: { traffic }, flags: [] }), true);
  assert.equal(seaMatters({ site: { setting: "offshore" }, flags: [] }), false);
});

console.log(`${passed} siterole tests passed`);
