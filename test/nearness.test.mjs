// The fast site-to-feature distance (js/nearness.js): exact on edges, holes and parts, and true (geodesic) in value.
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { nearestKm } from "../js/nearness.js";
import { geometryDistanceKm, slowDistanceKm } from "../js/datatools.js";
import { edgeDistanceKm } from "../js/atlasfeatures.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
// A two-part site near Stamford: a square with a square hole, and a small square to the east.
const sq = (x, y, r) => [[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r], [x - r, y - r]];
const site = { type: "MultiPolygon", coordinates: [[sq(-0.45, 52.69, 0.02), sq(-0.45, 52.69, 0.005)], [sq(-0.40, 52.69, 0.004)]] };
const pt = (c) => ({ type: "Point", coordinates: c });
const near = (a, b, tol = 0.002) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);

test("in the hole is off the site, measured to the hole's edge", () => {
  const d = nearestKm(site, pt([-0.45, 52.69]));
  assert.ok(d > 0);
  near(d, turf.distance([-0.45, 52.69], [-0.445, 52.69]));
});
test("inside a part, on an edge, crossing, and round the whole site are all 0", () => {
  assert.equal(nearestKm(site, pt([-0.462, 52.69])), 0);
  assert.equal(nearestKm(site, pt([-0.47, 52.69])), 0);
  assert.equal(nearestKm(site, { type: "LineString", coordinates: [[-0.5, 52.69], [-0.46, 52.69]] }), 0);
  assert.equal(nearestKm(site, { type: "Polygon", coordinates: [sq(-0.43, 52.69, 0.1)] }), 0);
  assert.equal(nearestKm(site, { type: "Polygon", coordinates: [sq(-0.40, 52.69, 0.001)] }), 0);
});
test("a wood in the hole is outside; one round the hole's edge touches", () => {
  assert.ok(nearestKm(site, { type: "Polygon", coordinates: [sq(-0.45, 52.69, 0.002)] }) > 0);
  assert.equal(nearestKm(site, { type: "Polygon", coordinates: [sq(-0.45, 52.69, 0.006)] }), 0);
});
test("distances outside agree with an exhaustive geodesic measure, to every part", () => {
  for (const [c, r] of [[[-0.38, 52.70], 0.002], [[-0.50, 52.72], 0.004], [[-0.42, 52.60], 0.003]]) {
    const g = { type: "Polygon", coordinates: [sq(c[0], c[1], r)] };
    let e = Infinity;
    for (const v of g.coordinates[0]) for (const p of site.coordinates) e = Math.min(e, edgeDistanceKm(v, { type: "Polygon", coordinates: p }));
    for (const v of site.coordinates.flat(2)) e = Math.min(e, edgeDistanceKm(v, g));
    near(nearestKm(site, g), e, e * 0.001 + 1e-4);
  }
});
test("never meaningfully larger than the old sampled measure, and the same on/off-site calls", () => {
  for (let i = 0; i < 60; i++) {
    const c = [-0.5 + (i % 10) * 0.012, 52.66 + Math.floor(i / 10) * 0.012];
    const g = i % 2 ? pt(c) : { type: "Polygon", coordinates: [sq(c[0], c[1], 0.001)] };
    const f = geometryDistanceKm(site, g), s = slowDistanceKm(site, g);
    assert.equal(f === 0, s === 0, `${JSON.stringify(c)}: ${f} vs ${s}`);
    assert.ok(f <= s * 1.001 + 1e-6, `${f} vs ${s}`); // within 0.1%: the two find the nearest point along an edge slightly differently
  }
});
test("a point to a polygon with a hole is measured (it used to come back empty)", () => {
  near(edgeDistanceKm([-0.45, 52.69], { type: "Polygon", coordinates: site.coordinates[0] }), turf.distance([-0.45, 52.69], [-0.445, 52.69]));
});
test("continent-wide shapes are left to the old measure", () => {
  assert.equal(nearestKm({ type: "Polygon", coordinates: [sq(10, 0, 40)] }, pt([0, 0])), null);
});
console.log(`${passed} nearness tests passed`);
