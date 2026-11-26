// How a feature sits against the site (js/relation.js, package B): within, crosses the edge, covers, adjacent
// (within 50 m of the edge) or outside, with the overlap; and the zone answer. Shapes are built in metres on the
// ground round a centre near Linlithgow, so the expected numbers are exact.
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { fromLocal } from "../js/geometry.js";
import { relationOf, zonesAtSite, ADJACENT_KM, RELATIONS, relationFields, relationFieldsAll, whereWords, isOnSite } from "../js/relation.js";
import { laea } from "../js/siterole.js";
import { planarKm2 } from "../js/areabudget.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
const C = [-3.6, 55.97];
const at = (x, y) => fromLocal([x / 1000, y / 1000], C); // metres east and north of C
const box = (x0, y0, x1, y1) => [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)];
const poly = (...rings) => ({ type: "Polygon", coordinates: rings });
const line = (...pts) => ({ type: "LineString", coordinates: pts.map(([x, y]) => at(x, y)) });
const pt = (x, y) => ({ type: "Point", coordinates: at(x, y) });
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

// The site: 400 m by 400 m, centred on C (16 ha).
const site = { type: "Feature", properties: {}, geometry: poly(box(-200, -200, 200, 200)) };
const SITE_KM2 = 0.16;

test("the adjacent rule is 50 m, the same for every check", () => {
  assert.equal(ADJACENT_KM, 0.05);
  assert.deepEqual(RELATIONS, ["within", "crosses", "covers", "adjacent", "outside"]);
});

test("the site's area is a true area (equal-area plane agrees with turf's geodesic area)", () => {
  const r = relationOf(site, poly(box(-50, -50, 50, 50)));
  near(r.site_km2, SITE_KM2, SITE_KM2 * 0.002);
  near(r.site_km2, turf.area(site) / 1e6, SITE_KM2 * 0.002);
});

test("a polygon wholly inside is within, with its share of the site", () => {
  const r = relationOf(site, poly(box(-50, -50, 50, 50)));
  assert.equal(r.relation, "within");
  assert.equal(r.distance_km, 0);
  near(r.overlap_km2, 0.01, 1e-4);
  near(r.site_share, 0.0625, 1e-3);
  near(r.feature_share, 1, 1e-6);
});

test("a polygon crossing the edge reports its share of the site, not 0 km", () => {
  const r = relationOf(site, poly(box(150, -50, 250, 50)));
  assert.equal(r.relation, "crosses");
  assert.equal(r.distance_km, 0);
  near(r.overlap_km2, 0.005, 5e-5);
  near(r.site_share, 0.03125, 5e-4);
  near(r.feature_share, 0.5, 5e-3);
});

test("a line crossing reports its length inside", () => {
  const r = relationOf(site, line([-300, 10], [100, 10]));
  assert.equal(r.relation, "crosses");
  near(r.length_km, 0.4, 0.002);
  near(r.length_inside_km, 0.3, 0.002);
  near(r.line_share, 0.75, 0.005);
});

test("a line going in and out several times counts each piece inside", () => {
  // A zigzag: in at x=-200, out at x=200; a second leg back across.
  const r = relationOf(site, line([-300, 0], [300, 0], [300, 100], [-300, 100]));
  assert.equal(r.relation, "crosses");
  near(r.length_inside_km, 0.8, 0.003);
});

test("a line wholly inside is within, all of it", () => {
  const r = relationOf(site, line([-100, 0], [100, 0], [100, 100]));
  assert.equal(r.relation, "within");
  near(r.length_inside_km, 0.3, 0.002);
  near(r.line_share, 1, 1e-6);
});

test("a feature 30 m outside is adjacent and one 80 m outside isn't", () => {
  const a = relationOf(site, poly(box(230, -20, 260, 20)));
  assert.equal(a.relation, "adjacent");
  near(a.distance_km, 0.03, 0.0005);
  const b = relationOf(site, poly(box(280, -20, 300, 20)));
  assert.equal(b.relation, "outside");
  near(b.distance_km, 0.08, 0.0005);
  assert.equal(relationOf(site, pt(230, 0)).relation, "adjacent");
  assert.equal(relationOf(site, pt(280, 0)).relation, "outside");
  assert.equal(relationOf(site, line([249, -300], [249, 300])).relation, "adjacent");
  assert.equal(relationOf(site, line([251, -300], [251, 300])).relation, "outside");
});

test("a feature touching the edge from outside is adjacent at 0 m, not on the site", () => {
  const r = relationOf(site, poly(box(200, -20, 260, 20)));
  assert.equal(r.relation, "adjacent");
  assert.equal(r.distance_km, 0);
  assert.equal(r.overlap_km2, 0);
});

test("a point on the site, or on its edge, is within", () => {
  assert.equal(relationOf(site, pt(10, 10)).relation, "within");
  assert.equal(relationOf(site, pt(200, 0)).relation, "within");
});

test("a multi-part feature with one part inside is partly on the site", () => {
  const g = { type: "MultiPolygon", coordinates: [[box(-50, -50, 50, 50)], [box(1000, 0, 1100, 100)]] };
  const r = relationOf(site, g);
  assert.equal(r.relation, "crosses");
  assert.equal(r.parts, 2);
  assert.equal(r.parts_on_site, 1);
  near(r.overlap_km2, 0.01, 1e-4);
  near(r.feature_share, 0.5, 5e-3);
  const m = relationOf(site, { type: "MultiPoint", coordinates: [at(0, 0), at(900, 0)] });
  assert.equal(m.relation, "crosses");
  assert.equal(m.parts_on_site, 1);
  const ml = relationOf(site, { type: "MultiLineString", coordinates: [[at(-100, 0), at(100, 0)], [at(900, 0), at(1000, 0)]] });
  assert.equal(ml.relation, "crosses");
  near(ml.length_inside_km, 0.2, 0.002);
  assert.equal(ml.parts_on_site, 1);
});

test("a feature the site lies wholly inside covers it", () => {
  const r = relationOf(site, poly(box(-1000, -1000, 1000, 1000)));
  assert.equal(r.relation, "covers");
  near(r.site_share, 1, 1e-6);
  near(r.feature_share, 0.04, 1e-3);
});

test("a feature in a hole of the site is off it, measured to the hole's edge", () => {
  const holed = { type: "Feature", properties: {}, geometry: poly(box(-200, -200, 200, 200), box(-100, -100, 100, 100)) };
  const r = relationOf(holed, poly(box(-20, -20, 20, 20)));
  assert.equal(r.relation, "outside");
  near(r.distance_km, 0.08, 0.0005);
  const a = relationOf(holed, pt(-70, 0));
  assert.equal(a.relation, "adjacent");
  // Shares are of the site's own area, holes taken off.
  const w = relationOf(holed, poly(box(120, -20, 160, 20)));
  assert.equal(w.relation, "within");
  near(w.site_km2, 0.12, 3e-4);
  near(w.site_share, 0.0016 / 0.12, 1e-4);
});

test("a feature on both sides of a hole's edge crosses it", () => {
  const holed = { type: "Feature", properties: {}, geometry: poly(box(-200, -200, 200, 200), box(-100, -100, 100, 100)) };
  const r = relationOf(holed, line([0, 0], [150, 0]));
  assert.equal(r.relation, "crosses");
  near(r.length_inside_km, 0.05, 0.001);
});

test("a multi-part site: a feature on the second part is within", () => {
  const two = { type: "MultiPolygon", coordinates: [[box(-200, -200, 200, 200)], [box(1000, 0, 1200, 200)]] };
  const r = relationOf(two, poly(box(1050, 50, 1100, 100)));
  assert.equal(r.relation, "within");
  near(r.site_km2, 0.2, 4e-4);
});

test("geometry or feature, either way; a site with no area is refused", () => {
  assert.equal(relationOf(site.geometry, { type: "Feature", properties: {}, geometry: pt(0, 0) }).relation, "within");
  assert.throws(() => relationOf(pt(0, 0), pt(10, 0)), /outline/);
  assert.equal(relationOf(site, { type: "GeometryCollection", geometries: [] }), null);
  assert.equal(relationOf(site, null), null);
});

test("a custom adjacent distance can be given (a check may ask), the default stays 50 m", () => {
  assert.equal(relationOf(site, pt(280, 0), { adjacentKm: 0.1 }).relation, "adjacent");
  assert.equal(relationOf(site, pt(280, 0)).relation, "outside");
});

test("the zone answer: which zones the site touches and how much of it each covers", () => {
  const zones = [
    { id: "z1", name: "Inner zone", geometry: poly(box(-300, -300, 300, 40)) }, // 60% of the site
    { id: "z2", name: "Outer zone", geometry: poly(box(-300, -40, 300, 400)) }, // 60% of the site, 20% shared with z1
    { id: "z3", name: "Far zone", geometry: poly(box(500, 0, 600, 100)) },
    { id: "z4", name: "A point", geometry: pt(0, 0) },
  ];
  const z = zonesAtSite(site, zones);
  assert.equal(z.inside, true);
  assert.equal(z.wholly, true);
  near(z.site_share, 1, 1e-6);
  assert.deepEqual(z.zones.map((x) => x.id), ["z1", "z2"]);
  near(z.zones[0].site_share, 0.6, 2e-3);
  near(z.zones[1].site_share, 0.6, 2e-3);
  assert.equal(z.zones[0].relation, "crosses");
  assert.equal(z.nearest.id, "z3");
  near(z.nearest.distance_km, 0.3, 0.001);
  assert.equal(z.not_areas, 1);
});

test("the zone answer when the site is partly in one zone, and when it's in none", () => {
  const z = zonesAtSite(site, [{ id: "a", geometry: poly(box(0, -500, 500, 500)) }]);
  assert.equal(z.inside, true);
  assert.equal(z.wholly, false);
  near(z.site_share, 0.5, 2e-3);
  const none = zonesAtSite(site, [{ id: "b", geometry: poly(box(230, 0, 300, 50)) }]);
  assert.equal(none.inside, false);
  assert.equal(none.zones.length, 0);
  assert.equal(none.site_share, 0);
  assert.equal(none.nearest.relation, "adjacent");
  const empty = zonesAtSite(site, []);
  assert.equal(empty.inside, false);
  assert.equal(empty.nearest, null);
});

test("trimming the site before the overlay changes nothing: a concave site with a hole, 60 shapes on its edge", () => {
  // A 3,000-vertex star with a hole; each overlap checked against the overlay of the whole, untrimmed outline.
  const ring = [];
  for (let i = 0; i < 3000; i++) { const a = (i / 3000) * 2 * Math.PI, r = 300 + 80 * Math.sin(a * 37); ring.push(at(Math.cos(a) * r, Math.sin(a) * r)); }
  ring.push(ring[0]);
  const hole = [];
  for (let i = 0; i < 60; i++) { const a = (-i / 60) * 2 * Math.PI; hole.push(at(Math.cos(a) * 60, Math.sin(a) * 60)); }
  hole.push(hole[0]);
  const star = poly(ring, hole);
  const P = laea(turf.centroid({ type: "Feature", properties: {}, geometry: star }).geometry.coordinates);
  const proj = (g) => { const w = (c) => (typeof c[0] === "number" ? P(c) : c.map(w)); return { type: "Feature", properties: {}, geometry: { type: g.type, coordinates: w(g.coordinates) } }; };
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 60; i++) {
    const a = rnd() * 6.28, d = rnd() * 420, x = Math.cos(a) * d, y = Math.sin(a) * d, w = 5 + rnd() * 150, h = 5 + rnd() * 150;
    const f = poly([at(x - w, y - h), at(x + w, y - h * 0.3), at(x + w, y + h), at(x - w * 0.2, y + h * 0.5), at(x - w, y - h)]);
    const whole = turf.intersect(turf.featureCollection([proj(star), proj(f)]));
    near(relationOf(star, f).overlap_km2 || 0, whole ? planarKm2(whole.geometry) : 0, 1e-6);
  }
});

test("a detailed site and many features stay quick", () => {
  // A 4,688-vertex round site (Mallard Pass's size) and 500 features on and near its edge: about 60 ms a feature
  // before the trim, so this took half a minute; now a few seconds at most.
  const round = { type: "Feature", properties: {}, geometry: turf.circle(C, 0.3, { steps: 4688, units: "kilometers" }).geometry };
  const t0 = Date.now();
  for (let i = 0; i < 500; i++) {
    const a = (i / 500) * 2 * Math.PI, d = 200 + (i % 5) * 50; // all near the 300 m edge
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    relationOf(round, i % 2 ? poly(box(x - 20, y - 20, x + 20, y + 20)) : line([x - 50, y], [x + 50, y]));
  }
  const ms = Date.now() - t0;
  console.log(`  500 features on a 4,688-vertex edge: ${ms} ms`);
  assert.ok(ms < 2000, `${ms} ms`);
});

test("the fields a measured feature carries: nothing more to work out for a feature off the site", () => {
  assert.deepEqual(relationFields(site, poly(box(400, 0, 450, 50)), 0.2), { relation: "outside" });
  assert.deepEqual(relationFields(site, poly(box(230, 0, 260, 50)), 0.03), { relation: "adjacent" });
  assert.deepEqual(relationFields(site, poly(box(200, 0, 260, 50)), 0), { relation: "adjacent" });
  const c = relationFields(site, poly(box(150, -50, 250, 50)), 0);
  assert.equal(c.relation, "crosses");
  near(c.site_share, 0.03125, 5e-4);
  const l = relationFields(site, line([-300, 10], [100, 10]), 0);
  near(l.length_inside_km, 0.3, 0.002);
  assert.deepEqual(relationFields(pt(0, 0), poly(box(-50, -50, 50, 50)), 0), {}); // a point site: no outline, no relation
  assert.deepEqual(relationFields(site, null, 0), {});
});

test("on site means within, crosses or covers; touching from outside isn't; old records fall back to 0 km", () => {
  assert.equal(isOnSite({ relation: "crosses", distance_km: 0 }), true);
  assert.equal(isOnSite({ relation: "adjacent", distance_km: 0 }), false);
  assert.equal(isOnSite({ distance_km: 0 }), true);
  assert.equal(isOnSite({ distance_km: 0.2 }), false);
});

test("one thing in several pieces is measured as a whole (an OpenStreetMap road)", () => {
  const road = [line([-300, 0], [-100, 0]).coordinates, line([-100, 0], [300, 0]).coordinates].map((c) => ({ type: "LineString", coordinates: c }));
  const r = relationFieldsAll(site, road, 0);
  assert.equal(r.relation, "crosses");
  near(r.length_inside_km, 0.4, 0.003);
  assert.equal(r.parts, undefined);
  assert.equal(relationFieldsAll(site, [line([-100, 0], [0, 0]), line([0, 0], [100, 0])], 0).relation, "within");
  assert.equal(relationFieldsAll(site, [line([-100, 0], [0, 0]), pt(600, 0)], 0).relation, "crosses");
  assert.equal(relationFieldsAll(site, [line([210, 0], [220, 0]), pt(600, 0)], 0.01).relation, "adjacent");
});

test("where a feature is, in words", () => {
  const m = (km) => `${Math.round(km * 1000)} m`;
  assert.equal(whereWords({ relation: "within" }), "on site");
  assert.equal(whereWords({ relation: "covers" }), "the site lies within it");
  assert.equal(whereWords({ relation: "crosses", site_share: 0.12 }), "crosses the site's edge, 12% of the site");
  assert.equal(whereWords({ relation: "crosses", site_share: 0.004 }), "crosses the site's edge, under 1% of the site");
  assert.equal(whereWords({ relation: "crosses", length_inside_km: 0.3 }, m), "crosses the site's edge, 300 m of it on site");
  assert.equal(whereWords({ relation: "crosses", parts: 3, parts_on_site: 1, site_share: 0.05 }), "partly on site (1 of 3 parts), 5% of the site");
  assert.equal(whereWords({ relation: "adjacent", distance_km: 0 }), "next to the site (touching its edge)");
  assert.equal(whereWords({ relation: "adjacent", distance_km: 0.03 }, m), "next to the site, 30 m");
  assert.equal(whereWords({ relation: "outside", distance_km: 2 }), null);
  assert.equal(whereWords({ distance_km: 0 }), null);
});

console.log(`relation: ${passed} passed`);
