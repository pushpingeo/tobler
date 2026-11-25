// Datum transformations applied in code (js/transform.js) and the transform tool (js/epsgtools.js) against a fake
// EPSG registry. Expected values were computed with PROJ 9 (pyproj) from the same parameters, independently of this
// code. The GIGS checks (tests 5203 and 5204) are in scripts/gigs-check.mjs, run against IOGP's own files, which this
// repo doesn't carry.
import assert from "node:assert/strict";
import { ellipsoid, toGeocentric, toGeographic, helmert, applyTransformation, readParameters, ellipsoidFromRecord, canApply, shiftMetres } from "../js/transform.js";
import { createEpsgTools } from "../js/epsgtools.js";
import { fakeEpsg } from "./fake-epsg.mjs";

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; console.log(`ok  ${name}`); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tolerance ${tol})`);

const AIRY = ellipsoid({ a: 6377563.396, invf: 299.3249646 }), INTL = ellipsoid({ a: 6378388, invf: 297 }), WGS = ellipsoid({ a: 6378137, invf: 298.257223563 });
const P1314 = { tx: 446.448, ty: -125.157, tz: 542.06, rx: 0.15, ry: 0.247, rz: 0.842, ds: -20.489 };
const P15929 = { tx: -106.8686, ty: 52.2978, tz: -103.7239, rx: -0.3366, ry: 0.457, rz: -1.8422, ds: -1.2747 };
const P1311 = { tx: -89.5, ty: -93.8, tz: -123.1, rx: 0, ry: 0, rz: -0.156, ds: 1.2 };
const D = 1e-8; // degrees, about 1 mm

await t("geographic ↔ geocentric round trip to well under a millimetre, at the poles and 10 km down", async () => {
  for (const [la, lo, h] of [[0, 0, 0], [57.5, 1.75, 100], [-89.9, 45, -10000], [89.99999, -120, 5000], [-37.65, 143.93, 1836.9]]) {
    const back = toGeographic(toGeocentric(la, lo, h, AIRY), AIRY);
    near(back[0], la, 1e-10, "lat"); near(back[1], lo, 1e-10, "lon"); near(back[2], h, 1e-6, "h");
  }
});

await t("Position Vector (OSGB36 → WGS 84 by 1314) and Coordinate Frame (BD72 → WGS 84 by 15929) agree with PROJ", async () => {
  const [a] = applyTransformation([[60, 120]], { method: 9606, params: P1314, from: AIRY, to: WGS });
  near(a[0], 60.005692943, D, "1314 lat"); near(a[1], 119.994358742, D, "1314 lon");
  assert.equal(a[2], null); // 2D method: no height back
  for (const [inp, out] of [[[70, -180], [69.998127949, 179.999397452]], [[60, 120], [59.998073368, 120.00197117]], [[25, -90], [24.998626708, -90.000605665]]]) {
    const [b] = applyTransformation([inp], { method: 9607, params: P15929, from: INTL, to: WGS });
    near(b[0], out[0], D, "15929 lat"); near(((b[1] - out[1] + 540) % 360) - 180, 0, D, "15929 lon");
  }
});

await t("ED50 → WGS 84 by 1311 in the North Sea: forward and reverse match PROJ; the well moves about 117.6 m", async () => {
  const [f] = applyTransformation([[57.5, 1.75]], { method: 9606, params: P1311, from: INTL, to: WGS });
  near(f[0], 57.499360448, D, "lat"); near(f[1], 1.748438508, D, "lon");
  near(shiftMetres([57.5, 1.75], f), 117.63, 0.01, "shift");
  const [r] = applyTransformation([[57.5, 1.75]], { method: 9606, params: P1311, from: INTL, to: WGS, reverse: true });
  near(r[0], 57.500639514, 2e-8, "reverse lat"); near(r[1], 1.751561486, 2e-8, "reverse lon");
});

await t("reverse is the exact inverse: a 3D round trip comes back within a micrometre", async () => {
  const p = [52.5, -1.5, 120];
  const [f] = applyTransformation([p], { method: 1037, params: P1314, from: AIRY, to: WGS });
  const [b] = applyTransformation([f], { method: 1037, params: P1314, from: AIRY, to: WGS, reverse: true });
  near(b[0], p[0], 1e-11, "lat"); near(b[1], p[1], 1e-11, "lon"); near(b[2], p[2], 1e-6, "h");
  const X = [3e6, 1e5, 5e6], Y = helmert(helmert(X, P15929, "coordinate_frame"), P15929, "coordinate_frame", true);
  X.forEach((x, i) => near(Y[i], x, 1e-6, "geocentric"));
});

await t("translations only, and Molodensky / abridged Molodensky, agree with PROJ", async () => {
  const T = { tx: -87, ty: -98, tz: -121 };
  const [g] = applyTransformation([[57.5, 1.75]], { method: 9603, params: T, from: INTL, to: WGS });
  const [m] = applyTransformation([[57.5, 1.75, 0]], { method: 9604, params: T, from: INTL, to: WGS });
  const [ab] = applyTransformation([[57.5, 1.75, 0]], { method: 9605, params: T, from: INTL, to: WGS });
  near(m[0], 57.499352838, D, "Molodensky lat"); near(m[1], 1.748410591, D, "Molodensky lon");
  near(ab[0], 57.499353892, D, "abridged lat"); near(ab[1], 1.748410591, D, "abridged lon");
  near(g[0], m[0], 2e-7, "translation vs Molodensky"); // within ~2 cm of each other
  assert.ok(canApply(9606) && canApply(1038) && !canApply(9615));
});

await t("parameters read by code with the registry's own units (milliarc-seconds, ppb); unknown units refused", async () => {
  const units = { 1031: { Type: "angle", FactorB: Math.PI, FactorC: 648000000 }, 1028: { Type: "scale", FactorB: 1, FactorC: 1e9 } };
  const p = readParameters([
    { ParameterCode: 8605, ParameterValue: 1.5, Unit: { Code: 9001 } }, { ParameterCode: 8610, ParameterValue: 842, Unit: { Code: 1031 } },
    { ParameterCode: 8611, ParameterValue: -20489, Unit: { Code: 1028 } }, { ParameterCode: 9999, ParameterValue: 7, Unit: { Code: 9001 } },
  ], units);
  near(p.tx, 1.5, 1e-12, "tx"); near(p.rz, 0.842, 1e-12, "rz in arc-seconds"); near(p.ds, -20.489, 1e-9, "ds in ppm");
  assert.throws(() => readParameters([{ ParameterCode: 8605, ParameterValue: 1, Unit: { Code: 9036, Name: "kilometre" } }]), /couldn't be read/);
  assert.throws(() => readParameters([{ ParameterCode: 8608, ParameterValue: 1, Unit: { Code: 9001, Name: "metre" } }]), /not a angle unit/);
  const clarke = ellipsoidFromRecord({ Name: "Clarke 1880 (IGN)", SemiMajorAxis: 6378249.2, SemiMinorAxis: 6356515, InverseFlattening: "NaN", Unit: { Code: 9001 } });
  near(1 / clarke.f, 293.4660213, 1e-6, "1/f from b");
});

// The tool, through the fake registry.
const typed = { C1: [1.75, 57.5], C9: [-3.6, 55.97] };
const T = () => createEpsgTools({ epsg: fakeEpsg(), transformationChoice: () => "choose" }, () => null, (ref) => (ref === "C1" ? typed.C1 : null));

await t("transform: the ED50 well by 1311 → WGS 84, with code, accuracy, direction and EPSG version recorded", async () => {
  const r = await T().transform({ operation: "1311", source: "4230", target: "4326", at: "C1" });
  assert.equal(r.applied, true);
  near(r.points[0].output.lat, 57.49936045, 2e-8, "lat"); near(r.points[0].output.lon, 1.74843851, 2e-8, "lon");
  near(r.points[0].moved_m, 117.6, 0.05, "moved");
  assert.equal(r.operation.code, 1311); assert.equal(r.operation.accuracy_m, 1); assert.equal(r.operation.direction, "forward");
  assert.equal(r.from.ellipsoid, "International 1924"); assert.equal(r.to.ellipsoid, "WGS 84");
  assert.match(r.epsg_version, /13\.106 \(2026-10-15\)/);
  assert.deepEqual(r.record, { operation: "EPSG:1311", name: "ED50 to WGS 84 (18)", accuracy_m: 1, direction: "forward", epsg_version: "13.106", applied_in: "Tobler (js/transform.js), from the EPSG record's parameters" });
  assert.match(r.note, /Applied in code with EPSG:1311/);
  assert.equal(r.warning, undefined);
});

await t("transform: reverse when asked the other way; Coordinate Frame with milliarc-second units; points as numbers", async () => {
  const r = await T().transform({ operation: "1311", source: "4326", target: "4230", points: [[57.5, 1.75]] });
  assert.equal(r.operation.direction, "reverse");
  near(r.points[0].output.lat, 57.500639514, 2e-8, "lat");
  const b = await T().transform({ operation: "15929", source: "4313", target: "4326", points: [[50.8, 4.35], [60, 120]] });
  near(b.points[1].output.lat, 59.998073368, D, "BD72 lat"); near(b.points[1].output.lon, 120.00197117, D, "BD72 lon");
  assert.equal(b.points[0].outside_area_of_use, undefined);
  assert.equal(b.points[1].outside_area_of_use, true); // GIGS-style point far outside Belgium
  assert.match(b.warning, /1 of 2 points? lies? outside the operation's area of use \(Belgium - onshore\)/);
});

await t("transform: refuses what it can't do honestly (grid, wrong pair, places already in WGS 84, projected numbers)", async () => {
  assert.match((await T().transform({ operation: "1613", source: "4230", points: [[57, 2]] })).error, /can't be applied here/);
  assert.match((await T().transform({ operation: "1311", source: "4277", points: [[57, 2]] })).error, /runs between EPSG:4230/);
  assert.match((await T().transform({ operation: "1311", source: "4230", at: "C9" })).error, /isn't coordinates the person typed/);
  assert.match((await T().transform({ operation: "1311", source: "4230", points: [[6400000, 450000]] })).error, /Projected coordinates/);
  assert.match((await T().transform({ operation: "1311", source: "4230" })).error, /No coordinates/);
  assert.match((await T().transform({ operation: "99999", source: "4230", points: [[57, 2]] })).hint, /transformation code/);
  assert.match((await createEpsgTools({}, () => null).transform({ operation: "1311", source: "4230", points: [[57, 2]] })).not_checked, /isn't connected/);
});

await t("transformation_options: a chosen operation is described as chosen, not applied, and points to transform", async () => {
  const r = await createEpsgTools({ epsg: fakeEpsg(), transformationChoice: () => "choose" }, () => [-3.6, 55.97]).transformation_options({ source: "4277", at: "x" });
  assert.equal(r.chosen, 1314);
  assert.match(r.why, /Chosen, not yet applied: coordinates move only when transform runs with operation 1314/);
});

console.log(`\n${pass} transform tests passed`);
