// The area budget tool (js/areabudget.js): true areas, overlaps counted once, soft constraints not taken off,
// not checked kept apart from none, and the remaining shape back in WGS84.
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import { areaBudget, budgetLines, laeaInverse } from "../js/areabudget.js";
import { laea } from "../js/siterole.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b} (±${tol})`);

// A 1 km × 1 km square near Stamford (52.69 N), built on the ground so its true area is 100 ha.
const C = [-0.45, 52.69];
const kmBox = (x0, y0, x1, y1) => {
  const inv = laeaInverse(C);
  return { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(inv)] };
};
const site = { type: "Feature", properties: {}, geometry: kmBox(-0.5, -0.5, 0.5, 0.5) };
const found = (id, kind, geometries, extra = {}) => ({ id, label: id, kind, state: "found", geometries, buffer_m: 0, ...extra });

test("laea and its inverse round-trip", () => {
  const P = laea(C), Pi = laeaInverse(C);
  for (const p of [[-0.45, 52.69], [-0.3, 52.8], [1.2, 51.0], [-3.5, 56.1]]) {
    const q = Pi(P(p));
    near(q[0], p[0], 1e-9); near(q[1], p[1], 1e-9);
  }
});

test("gross area is the true area, and agrees with turf's geodesic area", () => {
  const b = areaBudget(site, []);
  near(b.gross_ha, 100, 0.05);
  near(b.gross_ha, turf.area(site) / 1e4, 0.3);
  near(b.net_ha, 100, 0.05);
  assert.equal(b.net_share, 1);
});

test("a polygon over the west half takes 50 ha; a polygon off the site takes nothing but is listed", () => {
  const b = areaBudget(site, [found("west", "hard", [kmBox(-2, -2, 0, 2)]), found("far", "hard", [kmBox(3, 3, 4, 4)])]);
  near(b.rows[0].ha, 50, 0.05);
  near(b.rows[0].share, 0.5, 0.001);
  assert.equal(b.rows[1].ha, 0);
  assert.equal(b.rows[1].takes_nothing, true);
  near(b.net_ha, 50, 0.05);
});

test("overlap is counted once, against the first deduction", () => {
  const b = areaBudget(site, [found("west", "hard", [kmBox(-2, -2, 0, 2)]), found("south", "buffer", [kmBox(-2, -2, 2, 0)])]);
  near(b.rows[0].ha, 50, 0.05);
  near(b.rows[1].ha, 25, 0.05); // the south-east quarter only
  near(b.net_ha, 25, 0.05);
  near(b.rows.reduce((t, r) => t + r.ha, 0) + b.net_ha, b.gross_ha, 0.05);
});

test("a buffered point and a buffered line take their true area", () => {
  const pt = { type: "Point", coordinates: laeaInverse(C)([0, 0]) };
  const b1 = areaBudget(site, [found("pt", "buffer", [pt], { buffer_m: 100 })]);
  near(b1.rows[0].ha, Math.PI, 0.1); // π × 100 m², turf's 8-step circle is a touch under
  const inv = laeaInverse(C);
  const line = { type: "LineString", coordinates: [inv([0, -1]), inv([0, 1])] }; // north–south through the middle
  const b2 = areaBudget(site, [found("line", "buffer", [line], { buffer_m: 50 })]);
  near(b2.rows[0].ha, 10, 0.1); // 100 m wide strip, 1 km long
});

test("points and lines with no buffer have no area and say so", () => {
  const inv = laeaInverse(C);
  const b = areaBudget(site, [found("line", "hard", [{ type: "LineString", coordinates: [inv([0, -1]), inv([0, 1])] }])]);
  assert.equal(b.rows[0].ha, 0);
  assert.equal(b.rows[0].no_area, 1);
});

test("soft constraints are measured on what's left and not taken off", () => {
  const b = areaBudget(site, [found("west", "hard", [kmBox(-2, -2, 0, 2)]), found("grade2", "soft", [kmBox(-2, -2, 2, 0)]), found("fz2", "soft", [kmBox(-2, -2, 2, 2)])]);
  near(b.net_ha, 50, 0.05);
  near(b.soft[0].ha, 25, 0.05); // south-east quarter: the west half is already gone
  near(b.soft[1].ha, 25, 0.05); // the rest of what's left, counted once
  near(b.soft_ha, 50, 0.05);
  near(b.clear_ha, 0, 0.05);
});

test("not checked stays not checked, never a zero deduction", () => {
  const b = areaBudget(site, [{ id: "flood", label: "Flood Zone 3", kind: "avoid", state: "not_checked", why: "the service didn't answer" }]);
  assert.equal(b.rows[0].state, "not_checked");
  assert.ok(budgetLines(b).some((l) => /Flood Zone 3: not checked \(the service didn't answer\)/.test(l)));
  assert.ok(!budgetLines(b).some((l) => /− Flood Zone 3/.test(l)));
});

test("the net shape comes back in WGS84 and has the net area", () => {
  const b = areaBudget(site, [found("west", "hard", [kmBox(-2, -2, 0, 2)])]);
  const g = b.shapes.net;
  assert.equal(g.type, "Polygon");
  for (const [x, y] of g.coordinates[0]) { assert.ok(x > -1 && x < 0); assert.ok(y > 52 && y < 53.5); }
  near(turf.area({ type: "Feature", properties: {}, geometry: g }) / 1e4, 50, 0.3);
  assert.ok(b.shapes.taken.west);
});

test("a site with a hole, and a multipolygon site", () => {
  const hole = kmBox(-0.5, -0.5, 0.5, 0.5);
  hole.coordinates.push(kmBox(-0.1, -0.1, 0.1, 0.1).coordinates[0].slice().reverse());
  const b = areaBudget({ type: "Feature", properties: {}, geometry: hole }, []);
  near(b.gross_ha, 96, 0.05);
  const multi = { type: "MultiPolygon", coordinates: [kmBox(-0.5, -0.5, 0, 0).coordinates, kmBox(0.2, 0.2, 0.5, 0.5).coordinates] };
  near(areaBudget({ type: "Feature", properties: {}, geometry: multi }, []).gross_ha, 34, 0.05);
});

test("a point or a line site is refused", () => {
  assert.throws(() => areaBudget({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: C } }), /needs a site outline/);
});

test("a large designation far bigger than the site is clipped before it's buffered (fast)", () => {
  const big = kmBox(-60, -60, 60, 60); // 120 km square, densified
  const ring = big.coordinates[0];
  const dense = [];
  for (let i = 0; i < ring.length - 1; i++) for (let k = 0; k < 500; k++) dense.push([ring[i][0] + (ring[i + 1][0] - ring[i][0]) * k / 500, ring[i][1] + (ring[i + 1][1] - ring[i][1]) * k / 500]);
  dense.push(dense[0]);
  const t0 = Date.now();
  const b = areaBudget(site, [found("sssi", "hard", [{ type: "Polygon", coordinates: [dense] }], { buffer_m: 15 })]);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  near(b.rows[0].ha, 100, 0.1);
  assert.equal(b.net_ha, 0);
  assert.equal(b.shapes.net, null);
});

console.log(`areabudget: ${passed} passed`);
