// OpenStreetMap as a check source (js/osmchecks.js): one query, sorted back into kinds, measured from the site's edge,
// pieces of one road counted once, and "not checked" when Overpass doesn't answer.
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { osmAnswers, osmQuery, OSM_KINDS, elementGeometry } from "../js/osmchecks.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const site = turf.bboxPolygon([-0.46, 52.69, -0.44, 52.70]);
const way = (id, tags, cs) => ({ type: "way", id, tags, geometry: cs.map(([lon, lat]) => ({ lon, lat })) });
const node = (id, tags, lon, lat) => ({ type: "node", id, tags, lon, lat });
const json = { elements: [
  way(1, { highway: "trunk", ref: "A1" }, [[-0.43, 52.68], [-0.43, 52.71]]),
  way(2, { highway: "trunk", ref: "A1" }, [[-0.43, 52.71], [-0.43, 52.73]]),
  way(3, { power: "line", voltage: "132000" }, [[-0.47, 52.695], [-0.43, 52.695]]),
  node(4, { amenity: "school", name: "Ryhall Primary" }, -0.452, 52.705),
  node(5, { amenity: "school", name: "Far School" }, -0.30, 52.69),
  { type: "relation", id: 6, tags: { amenity: "hospital", name: "Stamford Hospital" }, center: { lon: -0.47, lat: 52.71 } },
] };

await test("one query asks for every kind, inside the grown box", () => {
  const q = osmQuery(["power line", "school"], [-0.5, 52.6, -0.4, 52.7]);
  assert.match(q, /way\["power"="line"\]\(52\.60000,-0\.50000,52\.70000,-0\.40000\);/);
  assert.match(q, /nwr\["amenity"~"\^\(school\|kindergarten\|college\)\$"\]/);
  assert.match(q, /out geom qt 4000;rel\.a;out center qt 400;/);
});
await test("answers per kind: within each kind's own reach, nearest first, the road's pieces as one", async () => {
  let asked = 0;
  const wants = new Map([["main road", 2], ["power line", 0.5], ["school", 1], ["health care", 2]]);
  const got = await osmAnswers({ wants, site, query: async () => { asked++; return json; }, now: () => "2026-11-24T00:00:00Z" });
  assert.equal(asked, 1);
  const road = got.get("main road");
  assert.deepEqual(road.features.map((f) => f.name), ["A1"]);
  assert.ok(road.features[0].distance_km > 0.5 && road.features[0].distance_km < 1);
  assert.equal(got.get("power line").features[0].distance_km, 0, "a line across the site is on it");
  assert.equal(got.get("power line").features[0].name, "Power line (132 kV)");
  assert.deepEqual(got.get("school").features.map((f) => f.name), ["Ryhall Primary"], "the far school is beyond 1 km");
  assert.deepEqual(got.get("health care").features.map((f) => f.name), ["Stamford Hospital"], "a relation by its centre");
  assert.match(road.meta.dataset, /^OpenStreetMap: main roads \(completeness varies\)$/);
  assert.match(road.meta.licence, /ODbL/);
});
await test("Overpass not answering: every kind is not checked, with the reason", async () => {
  const got = await osmAnswers({ wants: new Map([["school", 1], ["railway", 1]]), site, query: async () => { throw new Error("OpenStreetMap's Overpass service isn't answering right now"); } });
  for (const k of ["school", "railway"]) assert.match(got.get(k).not_checked, /isn't answering/);
});
await test("shapes: a closed way is an area unless it's a line kind", () => {
  const ring = [[0, 0], [1, 0], [1, 1], [0, 0]];
  assert.equal(elementGeometry(way(1, {}, ring), false).type, "Polygon");
  assert.equal(elementGeometry(way(1, {}, ring), true).type, "LineString");
  assert.ok(Object.values(OSM_KINDS).every((k) => k.sel.length && typeof k.match === "function"));
});
await test("each kind asks only as far as its own reach (buildings on the site don't fetch a town)", async () => {
  let q = "";
  await osmAnswers({ wants: new Map([["building", 0], ["aerodrome", 5]]), site, query: async (x) => { q = x; return { elements: [] }; } });
  const boxes = [...q.matchAll(/\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\);/g)].map((m) => m.slice(1).map(Number));
  const bld = q.match(/way\["building"\]\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/).slice(1).map(Number);
  const aer = q.match(/nwr\["aeroway"="aerodrome"\]\(([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\)/).slice(1).map(Number);
  assert.ok(boxes.length >= 2);
  assert.ok(aer[0] < bld[0] - 0.04 && aer[2] > bld[2] + 0.04, "the aerodrome box is ~5 km wider than the building box");
});
await test("a line kind keeps its other pieces' shapes with its one row", async () => {
  const got = await osmAnswers({ wants: new Map([["main road", 2]]), site, query: async () => json });
  const road = got.get("main road").features[0];
  const pieces = json.elements.filter((e) => e.tags?.highway && (e.tags.ref === road.name)).length;
  assert.equal(1 + (road.parts?.length || 0), pieces);
  for (const p of road.parts || []) assert.ok(p.geometry?.type);
});
console.log(`${passed} osmchecks tests passed`);
