// The presentation CRS (invariant 10) and the geodetic checks: which grid a site gets, on real outlines; the record;
// the projector every output uses, against control points with published coordinates in both systems; and the
// cross-check of a service's WGS 84 against Tobler's transformation of its native coordinates.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../js/reference.js";
import { chooseRegion, presentationCrs, projectorFor, presentationLine, utmZone, samplePoints, ellipsoidalOf } from "../js/presentation.js";
import { crossCheck, nativeDefinition, servicePairs } from "../js/crosscheck.js";
import { gridRefToEN, osgbToLatLon } from "../js/coords.js";
import { fakeEpsg, box } from "./fake-epsg.mjs";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const ROOT = new URL("..", import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const grids = json("catalogue/grids.json");
const ref = R.createReference(async (n) => json(`data/ref/${n}.json`));
const layers = { "uk-areas": await ref.get("uk-areas"), countries: await ref.get("countries") };
const pt = (lon, lat) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } });
const sq = (w, s, e, n) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const region = (f) => { const c = chooseRegion(f, { grids, layers }); return c.grid ? `${c.grid.id} ${c.crs.code}` : `utm ${c.utm.code}`; };

// ---- a registry for these tests: the shared fake (real OSGB36 records), plus the other grids' CRSs ----------------
// Transformations for Ireland, the Netherlands and Australia are stand-ins with test codes (99000x), so nothing here
// passes for a real EPSG record; the real ones are read in scripts/presentation-check.mjs (an Action).
const shared = fakeEpsg();
const EXT = {
  4390: { Name: "UK - Britain and UKCS", ...box(-9, 49.75, 2.01, 61.01) },
  1305: { Name: "Europe - Ireland (Republic and Ulster) - onshore", ...box(-10.56, 51.39, -5.34, 55.43) },
  1275: { Name: "Netherlands - onshore", ...box(3.2, 50.75, 7.22, 53.7) },
  4177: { Name: "Australia - GDA", ...box(93.41, -60.55, 173.35, -8.47) },
  1262: { Name: "World", ...box(-180, -90, 180, 90) },
};
const PROJ = {
  27700: ["OSGB36 / British National Grid", 4277, "OSGB36", 4390], 2157: ["IRENET95 / Irish Transverse Mercator", 4173, "IRENET95", 1305],
  28992: ["Amersfoort / RD New", 4289, "Amersfoort", 1275], 7856: ["GDA2020 / MGA zone 56", 7844, "GDA2020", 4177], 7850: ["GDA2020 / MGA zone 50", 7844, "GDA2020", 4177],
};
const GEOG = { 4173: [6173, "IRENET95", 7019], 4289: [6289, "Amersfoort", 7004], 7844: [1168, "Geocentric Datum of Australia 2020", 7019] };
const ELL = { 7004: { Name: "Bessel 1841", SemiMajorAxis: 6377397.155, InverseFlattening: 299.1528128 } };
const tr = (Code, Name, Accuracy, src, ext, ParameterValues, method = { Code: 9603, Name: "Geocentric translations (geog2D domain)" }) => ({ Code, Name, Accuracy, Method: method,
  SourceCrs: { Code: src, Name: GEOG[src][1] }, TargetCrs: { Code: 4326, Name: "WGS 84" }, Usage: [{ Extent: { Code: ext, Name: EXT[ext].Name } }], ParameterValues });
const t3 = (x, y, z) => [x, y, z].map((v, i) => ({ ParameterCode: 8605 + i, ParameterValue: v, ParamValueFileRef: null, Unit: { Code: 9001 }, SignReversible: true }));
const TR = {
  990001: tr(990001, "IRENET95 to WGS 84 (test)", 1, 4173, 1305, t3(0, 0, 0)),
  990002: tr(990002, "Amersfoort to WGS 84 (test)", 1, 4289, 1275, t3(593, 26, 478)),
  990003: tr(990003, "GDA2020 to WGS 84 (test)", 3, 7844, 4177, t3(0, 0, 0)),
};
const PAIRS = { "4173,4326": [990001], "4289,4326": [990002], "4326,7844": [990003] };
function testEpsg({ baseOf = {} } = {}) {
  const calls = [];
  const f = async ({ path, query }) => {
    calls.push(path);
    let m;
    if ((m = path.match(/^CoordRefSystem\/(\d+)$/))) {
      const c = +m[1];
      if (PROJ[c]) return { Code: c, Kind: "projected", Name: PROJ[c][0], Usage: [{ Extent: { Code: PROJ[c][3] } }] };
      if ((c > 32600 && c <= 32660) || (c > 32700 && c <= 32760)) return { Code: c, Kind: "projected", Name: `WGS 84 / UTM zone ${c % 100}${c > 32700 ? "S" : "N"}`, Usage: [{ Extent: { Code: 1262 } }] };
      if (GEOG[c]) return { Code: c, Kind: "geographic 2D", Name: GEOG[c][1] };
    }
    if ((m = path.match(/^ProjectedCoordRefSystem\/(\d+)$/))) {
      const c = +m[1];
      if (PROJ[c]) { const b = baseOf[c] ?? PROJ[c][1]; return { BaseCoordRefSystem: { Code: b, Name: GEOG[b]?.[1] || PROJ[c][2] } }; }
      if (c > 32600 && c <= 32760) return { BaseCoordRefSystem: { Code: 4326, Name: "WGS 84" } };
    }
    if ((m = path.match(/^GeodeticCoordRefSystem\/(\d+)$/)) && GEOG[m[1]]) return { Datum: { Code: GEOG[m[1]][0], Name: GEOG[m[1]][1] } };
    if ((m = path.match(/^Datum\/(\d+)$/))) { const g = Object.values(GEOG).find((x) => x[0] === +m[1]); if (g) return { Code: g[0], Name: g[1], Ellipsoid: { Code: g[2] }, PrimeMeridian: { Code: 8901 } }; }
    if ((m = path.match(/^Ellipsoid\/(\d+)$/)) && ELL[m[1]]) return { Code: +m[1], ...ELL[m[1]], Unit: { Code: 9001 } };
    if ((m = path.match(/^Extent\/(\d+)$/)) && EXT[m[1]]) return { Code: +m[1], ...EXT[m[1]] };
    if (path === "Transformation/crs") {
      const k = [query.sourceCRSCode, query.targetCRSCode].map(Number).sort((a, b) => a - b).join();
      if (PAIRS[k]) return { Results: PAIRS[k].map((c) => ({ Code: c, Name: TR[c].Name, Deprecated: false })) };
    }
    if ((m = path.match(/^Transformation\/(\d+)$/)) && TR[m[1]]) return TR[m[1]];
    return shared({ path, query });
  };
  f.calls = calls;
  return f;
}

// ---- which grid, on real outlines -------------------------------------------------------------------------------
await test("grids: a site gets its region's standard grid, on real outlines", () => {
  const culham = json("eval/replay/R21/site.geojson").features[0];
  assert.equal(region(culham), "great-britain 27700");
  assert.equal(region(pt(-3.6, 55.98)), "great-britain 27700"); // Linlithgow
  assert.equal(region(pt(-4.06, 52.41)), "great-britain 27700"); // Aberystwyth
  assert.equal(region(pt(-5.93, 54.6)), "northern-ireland 2157"); // Belfast
  assert.equal(region(pt(4.9, 52.37)), "netherlands 28992"); // Amsterdam
  assert.equal(region(pt(151.2, -33.87)), "australia 7856"); // Sydney, MGA zone 56
  assert.equal(region(pt(115.86, -31.95)), "australia 7850"); // Perth, MGA zone 50
  assert.equal(region(pt(147.3, -42.88)), "australia 7855"); // Hobart, Tasmania
});

await test("grids: elsewhere WGS 84 / UTM, zone holding the site, with Norway's and Svalbard's exceptions", () => {
  assert.equal(region(pt(4.35, 50.85)), "utm 32631"); // Brussels
  assert.equal(region(pt(-6.26, 53.35)), "utm 32629"); // Dublin: the Republic has no row yet
  assert.equal(region(pt(113.99, 4.4)), "utm 32649"); // Miri, just west of 114° E
  assert.equal(region(pt(18.42, -33.92)), "utm 32734"); // Cape Town
  assert.equal(region(pt(5.32, 60.39)), "utm 32632"); // Bergen: zone 32, not 31
  assert.equal(utmZone([15.6, 78.2]), 33); // Longyearbyen
  assert.equal(utmZone([8.9, 78]), 31);
  assert.equal(region(pt(2, 56.5)), "utm 32631"); // the central North Sea: at sea, not the UK's grid
  // Across a zone line: the zone holding most of the site (France, 0.3° west of the 0° line and 0.1° east of it).
  assert.equal(region(sq(-0.3, 47, 0.1, 47.1)), "utm 32630");
});

await test("grids: a site across a border takes the region holding most of it, against other countries too", () => {
  // Across England and Scotland (Gretna): one grid either side.
  assert.equal(region(sq(-3.1, 54.97, -3.0, 55.03)), "great-britain 27700");
  // Mostly Belgium (88%), the rest in the Netherlands: UTM, not RD New. And the other way round near Maastricht.
  const be = chooseRegion(sq(4.6, 51.2, 5.0, 51.47), { grids, layers });
  assert.equal(be.grid, null);
  assert.match(be.why, /^Most of the site is in Belgium/);
  const nl = chooseRegion(sq(5.65, 50.8, 5.85, 51.05), { grids, layers });
  assert.equal(nl.crs.code, 28992);
  assert.match(nl.why, /^70% of the site is in the Netherlands/);
});

await test("grids: at sea, a grid only within the outlines' accuracy of its region", () => {
  // The most easterly vertex of England's outline (Lowestoft), moved out to sea.
  const eng = layers["uk-areas"].features.find((f) => f.properties.name === "England");
  const ring = eng.geometry.coordinates.flat(eng.geometry.type === "Polygon" ? 1 : 2);
  const east = ring.reduce((a, b) => (b[0] > a[0] ? b : a));
  const near = chooseRegion(pt(east[0] + 0.006, east[1]), { grids, layers });
  assert.equal(near.grid?.id, "great-britain", near.why);
  assert.match(near.why, /touches no land outline/);
  assert.equal(region(pt(east[0] + 0.05, east[1])), "utm 32631"); // about 3.5 km out
});

// ---- the record --------------------------------------------------------------------------------------------------
await test("record: Great Britain is British National Grid, reached by the registry's choice (EPSG:1314, reversed)", async () => {
  const pc = await presentationCrs({ feature: pt(-1.25, 51.65), ref, grids, epsg: testEpsg() });
  assert.equal(pc.code, 27700);
  assert.equal(pc.kind, "national grid");
  assert.equal(pc.name, "OSGB36 / British National Grid");
  assert.equal(pc.region, "Great Britain");
  assert.equal(pc.operation.kind, "transformation");
  assert.equal(pc.operation.code, 1314); // the best one that can be applied; OSTN15 (7710, a grid file) can't
  assert.equal(pc.operation.direction, "reverse");
  assert.equal(pc.accuracy_m, 2);
  assert.equal(pc.operation.epsg_version, "13.106");
  assert.equal(pc.registry_checked, true);
  assert.ok(!/towgs84/.test(JSON.stringify(pc)), "no datum shift in the record");
  assert.equal(presentationLine(pc), "OSGB36 / British National Grid (EPSG:27700), reached from WGS 84 by OSGB36 to WGS 84 (6) (EPSG:1314, run in reverse, about 2 m).");
});

await test("record: Northern Ireland, the Netherlands and Australia take their grids; elsewhere UTM, named by the registry", async () => {
  const at = async (f) => presentationCrs({ feature: f, ref, grids, epsg: testEpsg() });
  const ni = await at(pt(-5.93, 54.6));
  assert.deepEqual([ni.code, ni.operation.code, ni.accuracy_m], [2157, 990001, 1]);
  const nl = await at(pt(4.9, 52.37));
  assert.deepEqual([nl.code, nl.base.code, nl.operation.code], [28992, 4289, 990002]);
  const au = await at(pt(151.2, -33.87));
  assert.deepEqual([au.code, au.zone, au.operation.code, au.accuracy_m], [7856, 56, 990003, 3]);
  const be = await at(pt(4.35, 50.85));
  assert.deepEqual([be.kind, be.code, be.name, be.accuracy_m, be.registry_checked], ["utm", 32631, "WGS 84 / UTM zone 31N", 0, true]);
  assert.equal(be.operation.kind, "conversion");
  assert.match(presentationLine(be), /a conversion from WGS 84 on one datum/);
});

await test("record: what stops a grid falls back to UTM and says why (no registry, a table that disagrees with it)", async () => {
  const none = await presentationCrs({ feature: pt(-1.25, 51.65), ref, grids, epsg: null });
  assert.equal(none.code, 32630);
  assert.equal(none.fallback_from.code, 27700);
  assert.match(none.why, /registry wasn't connected/);
  assert.equal(none.registry_checked, false);
  const wrong = await presentationCrs({ feature: pt(4.9, 52.37), ref, grids, epsg: testEpsg({ baseOf: { 28992: 4173 } }) });
  assert.equal(wrong.kind, "utm");
  assert.match(wrong.fallback_from.reason, /base CRS in the registry is EPSG:4173, not EPSG:4289/);
  const broken = await presentationCrs({ feature: pt(-1.25, 51.65), ref, grids, epsg: async () => { throw new Error("EPSG answered 503"); } });
  assert.equal(broken.kind, "utm");
  assert.match(broken.why, /EPSG answered 503/);
});

// ---- control points: Historic England's listed buildings, both coordinate pairs -----------------------------------
const cp = json("test/fixtures/control-points/historic-england-listed.json");
const gb = await presentationCrs({ feature: pt(-1.25, 51.65), ref, grids, epsg: testEpsg() });
const P = await projectorFor(gb, { grids, epsg: testEpsg() });
const metres = (a, b) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos((b[1] * Math.PI) / 180), (a[1] - b[1]) * 110574);
// EPSG:1314 is stated as about 2 m; the service's own transformation (probably OSTN15) differs from it by up to about
// 4 m at the far south-west. Two and a half times the stated accuracy, as the cross-check's "agree".
const TOL = 2.5 * gb.accuracy_m;

await test("control points: the fixture's three British National Grid forms agree (fields, grid reference, geometry)", () => {
  for (const p of cp.points) {
    const m = p.ngr.replace(/\s+/g, "").match(/^([A-Z]{2})(\d+)$/);
    const g = gridRefToEN(m[1], m[2]);
    assert.ok(Math.hypot(g.e - p.easting, g.n - p.northing) <= 1, `${p.list_entry}: NGR ${p.ngr} vs fields`);
    assert.ok(Math.hypot(p.geometry_27700[0] - p.easting, p.geometry_27700[1] - p.northing) <= 1, `${p.list_entry}: geometry vs fields`);
  }
});

await test(`control points: Historic England's WGS 84 and ours agree within ${TOL} m both ways; with no shift they'd be 90 m and more apart`, () => {
  const fwd = [], inv = [];
  for (const p of cp.points) {
    const en = P.forward(p.service_wgs84);
    fwd.push(Math.hypot(en[0] - p.geometry_27700[0], en[1] - p.geometry_27700[1]));
    inv.push(metres(P.inverse(p.geometry_27700), p.service_wgs84));
    // The projection alone, read as WGS 84 (what a service that skipped the shift would give): about 100 m off.
    const raw = osgbToLatLon(p.geometry_27700[0], p.geometry_27700[1]);
    assert.ok(metres(raw, p.service_wgs84) > 80, `${p.list_entry}: the shift should matter here`);
  }
  console.log(`   forward: median ${fwd.sort((a, b) => a - b)[5].toFixed(2)} m, max ${Math.max(...fwd).toFixed(2)} m; inverse: max ${Math.max(...inv).toFixed(2)} m`);
  assert.ok(Math.max(...fwd) <= TOL, `forward ${Math.max(...fwd)} m`);
  assert.ok(Math.max(...inv) <= TOL, `inverse ${Math.max(...inv)} m`);
});

await test("control points: round trips return the start point, and our projection matches coords.js's own", async () => {
  for (const p of cp.points) {
    const back = P.forward(P.inverse(p.geometry_27700));
    assert.ok(Math.hypot(back[0] - p.geometry_27700[0], back[1] - p.geometry_27700[1]) < 0.01, `${p.list_entry} round trip`);
  }
  // Two implementations of the same projection (proj4 through the grid table; coords.js's own formulae): to a millimetre.
  const def = nativeDefinition(27700, grids);
  const { proj4 } = await import("../js/vendor/fileread.js");
  const pj = proj4(ellipsoidalOf(def.projection), def.projection);
  for (const p of cp.points) {
    const a = osgbToLatLon(p.easting, p.northing), b = pj.inverse([p.easting, p.northing]);
    assert.ok(metres(a, b) < 0.001, `${p.list_entry}: ${metres(a, b)} m between the two`);
  }
});

// ---- the cross-check --------------------------------------------------------------------------------------------
await test("cross-check: Historic England's WGS 84 agrees with ours; a skipped shift and a wrong CRS are told apart", async () => {
  const pts = cp.points.map((p) => ({ id: p.list_entry, native: p.geometry_27700, wgs84: p.service_wgs84 }));
  const ok = await crossCheck({ points: pts, nativeCrs: 27700, grids, epsg: testEpsg() });
  assert.equal(ok.verdict, "agree", ok.what);
  assert.equal(ok.operation.code, 1314);
  assert.ok(ok.max_m <= TOL);
  // A service that skipped the OSGB36 shift: its "WGS 84" is the OSGB36 latitude and longitude.
  const skipped = pts.map((p) => ({ ...p, wgs84: osgbToLatLon(p.native[0], p.native[1]) }));
  const bad = await crossCheck({ points: skipped, nativeCrs: 27700, grids, epsg: testEpsg() });
  assert.equal(bad.verdict, "service skipped the datum shift", bad.what);
  assert.ok(bad.median_m > 80);
  // Everything 1 km east: neither reading explains it.
  const off = await crossCheck({ points: pts.map((p) => ({ ...p, wgs84: [p.wgs84[0] + 0.014, p.wgs84[1]] })), nativeCrs: 27700, grids, epsg: testEpsg() });
  assert.equal(off.verdict, "disagree");
  assert.match((await crossCheck({ points: pts, nativeCrs: 3857, grids, epsg: testEpsg() })).error, /can't be cross-checked/);
});

await test("cross-check: servicePairs reads the same features twice from an ArcGIS layer and pairs them by object id", async () => {
  const p0 = cp.points[0], p1 = cp.points[1];
  const fetchFn = async (url) => {
    const u = new URL(url);
    const body = !/\/query$/.test(u.pathname) ? { name: "Listed Building points", objectIdField: "OBJECTID", extent: { spatialReference: { wkid: 27700, latestWkid: 27700 } } }
      : u.searchParams.get("outSR") === "4326"
        ? { features: [{ attributes: { OBJECTID: 2 }, geometry: { points: [p1.service_wgs84] } }, { attributes: { OBJECTID: 1 }, geometry: { points: [p0.service_wgs84] } }] }
        : { features: [{ attributes: { OBJECTID: 1 }, geometry: { points: [p0.geometry_27700] } }, { attributes: { OBJECTID: 2 }, geometry: { points: [p1.geometry_27700] } }] };
    return { json: async () => body };
  };
  const got = await servicePairs({ url: "https://example.arcgis.com/x/FeatureServer/0", n: 2, fetchFn });
  assert.equal(got.native_crs, 27700);
  assert.deepEqual(got.points.map((p) => [p.id, p.native, p.wgs84]), [[1, p0.geometry_27700, p0.service_wgs84], [2, p1.geometry_27700, p1.service_wgs84]]);
});

console.log(`${passed} presentation tests passed`);
