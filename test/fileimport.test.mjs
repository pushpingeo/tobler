// Site boundaries from the person's own files (js/fileimport.js). Fixtures: test/fixtures/import (make.py builds them).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import { proj4 } from "../js/vendor/fileread.js";
import { readFiles, placesFromFile, fileSummary, fileOriginText, converterFor, resolveLayer, epsgFromPrj } from "../js/fileimport.js";
import { createEpsgTools } from "../js/epsgtools.js";
import { fakeEpsg, TF } from "./fake-epsg.mjs";
import { osgbToWgs84 } from "../js/coords.js";
import { placeRole } from "../js/siterole.js";
import * as R from "../js/reference.js";
import { createPlaceTools, projectSummary } from "../js/placetools.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const DIR = new URL("./fixtures/import/", import.meta.url);
const file = (name, as = name) => ({ name: as, bytes: new Uint8Array(readFileSync(new URL(name, DIR))) });
const shp = (stem, exts = ["shp", "shx", "dbf", "prj"], folder = "") => exts.map((e) => { try { return file(`${stem}.${e}`, `${folder}${stem}.${e}`); } catch { return null; } }).filter(Boolean);
const metres = ([lon1, lat1], [lon2, lat2]) => turf.distance([lon1, lat1], [lon2, lat2], { units: "kilometers" }) * 1000;

await test("a shapefile dropped as its files: British National Grid read from the .prj and shifted to WGS84", async () => {
  const f = await readFiles(shp("redline"));
  assert.equal(f.features.length, 1);
  const [feat] = f.features;
  assert.equal(feat.kind, "polygon");
  assert.equal(feat.label, "Linlithgow test site");
  assert.ok(Math.abs(feat.size.area_ha - 4) < 0.05, `area ${feat.size.area_ha}`);
  // Same corner as Tobler's own OSGB36 maths (coords.js, Helmert), so the datum shift was applied, not skipped (~100 m).
  const corner = feat.geometry.coordinates[0][0];
  assert.ok(metres(corner, osgbToWgs84(300200, 677400)) < 1, `corner ${corner}`);
  assert.match(f.layers[0].crs.how, /7-parameter datum shift/);
});

await test("a zip with a folder inside and Mac junk reads the same", async () => {
  const f = await readFiles([file("redline.zip")]);
  assert.equal(f.features.length, 1);
  assert.equal(f.skipped.length, 0);
  assert.equal(f.features[0].label, "Linlithgow test site");
});

await test("no .prj: British National Grid is guessed from the numbers, and the guess is said", async () => {
  const f = await readFiles(shp("areas", ["shp", "dbf"]));
  assert.deepEqual(f.features.map((x) => x.label), ["Area A", "Area B", "Area C"]);
  assert.equal(f.layers[0].crs.guessed, true);
  assert.match(f.layers[0].crs.how, /assumed/);
});

await test("a .dbf alone, or a .prj alone, is explained rather than silently ignored", async () => {
  const f = await readFiles([file("areas.dbf")]);
  assert.equal(f.features.length, 0);
  assert.match(f.skipped[0], /no matching \.shp/);
  const g = await readFiles([file("redline.prj")]);
  assert.match(g.skipped[0], /only its \.prj arrived/);
});

await test("ED50 / UTM 31N gets EPSG's general ED50 shift, done with Tobler's own transform maths", async () => {
  const f = await readFiles(shp("block_ed50"));
  const corner = f.features[0].geometry.coordinates[0][0];
  // Independent check: proj4 with the same three parameters written as a towgs84 string.
  const ref = proj4("+proj=utm +zone=31 +ellps=intl +towgs84=-87,-98,-121 +units=m", "WGS84", [500000, 6200000]);
  assert.ok(metres(corner, ref) < 0.5, `ED50 corner ${corner} vs ${ref}`);
  const unshifted = proj4("+proj=utm +zone=31 +ellps=intl +units=m", "+proj=longlat +ellps=intl", [500000, 6200000]);
  assert.ok(metres(corner, unshifted) > 50, "the shift was applied");
  assert.match(f.layers[0].crs.how, /ED50.*1133.*10 m/);
});

await test("an unrecognised datum is converted but flagged, never passed off as exact", () => {
  const wkt = 'PROJCS["Odd",GEOGCS["GCS_Odd",DATUM["D_Odd",SPHEROID["Clarke_1880",6378249.145,293.465]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000],PARAMETER["False_Northing",0],PARAMETER["Central_Meridian",33],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0],UNIT["Meter",1]]';
  const c = converterFor(proj4, wkt);
  assert.equal(c.datum, "unknown");
  assert.match(c.how, /no datum shift was applied/);
});

await test("GeoJSON: WGS84 as it is; an old crs member naming EPSG:27700 is honoured", async () => {
  const w = await readFiles([file("evora.geojson")]);
  assert.equal(w.features[0].label, "Evora solar");
  assert.deepEqual(w.features[0].geometry.coordinates[0][0], [-7.98, 38.57]);
  const b = await readFiles([file("bng.geojson")]);
  assert.ok(metres(b.features[0].geometry.coordinates[0][0], osgbToWgs84(300200, 677400)) < 1);
  assert.match(b.layers[0].crs.name, /EPSG:27700/);
});

await test("one polygon becomes one footprint place, with the file in its provenance", async () => {
  const f = await readFiles(shp("redline"));
  const [p] = placesFromFile(f, {});
  assert.equal(p.name, "Linlithgow test site");
  assert.equal(p.origin.method, "file");
  assert.equal(p.origin.role, "footprint");
  assert.equal(placeRole(p.origin, p.feature.geometry).role, "footprint");
  assert.match(fileOriginText(p.origin), /from your file redline\.shp \("Linlithgow test site"\); converted from British National Grid/);
});

await test("several picked: one site in parts, or separate sites", async () => {
  const f = await readFiles(shp("areas", ["shp", "dbf"]));
  const [one] = placesFromFile(f, { fids: ["F1", "F3"], combine: "parts", name: "North and south" });
  assert.equal(one.feature.geometry.type, "MultiPolygon");
  assert.equal(one.name, "North and south");
  assert.ok(Math.abs(turf.area(one.feature) / 1e4 - 2) < 0.05);
  assert.match(one.origin.steps[0], /2 features joined/);
  const sep = placesFromFile(f, { fids: ["F1", "F2"], combine: "separate" });
  assert.deepEqual(sep.map((p) => p.name), ["Area A", "Area B"]);
  assert.throws(() => placesFromFile(f, { fids: ["F9"] }), /No feature F9/);
});

await test("points and lines need a width; with one they become an area of that width in metres", async () => {
  const f = await readFiles([...shp("cable"), ...shp("turbines")]);
  assert.deepEqual(f.features.map((x) => x.kind), ["line", "point", "point"]);
  assert.throws(() => placesFromFile(f, { fids: ["F1"] }), (e) => e.needs_width === true);
  const [corridor] = placesFromFile(f, { fids: ["F1"], buffer_m: 30 });
  assert.equal(corridor.origin.role, "area");
  assert.equal(corridor.origin.buffer_m, 30);
  // 1 km line, 30 m either side: about 60 m × 1 km plus round ends ≈ 6.3 ha.
  const ha = turf.area(corridor.feature) / 1e4;
  assert.ok(ha > 6.1 && ha < 6.4, `corridor ${ha} ha`);
  const [thin] = placesFromFile(f, { fids: ["F1"], buffer_m: 1 });
  assert.ok(turf.area(thin.feature) / 1e4 < 0.25);
  assert.throws(() => placesFromFile(f, { fids: ["F1"], buffer_m: 0.1 }), /between 0.5 m/);
});

await test("the analyst's view of a file has labels and sizes, never coordinates", async () => {
  const f = await readFiles(shp("areas", ["shp", "dbf"]));
  const s = fileSummary(f);
  assert.equal(s.contents, "3 polygons");
  assert.deepEqual(s.features.map((x) => x.fid), ["F1", "F2", "F3"]);
  assert.ok(!JSON.stringify(s).includes("coordinates\":[["));
});

await test("the analyst can pick in words: use_file_features makes accepted places and the file is forgotten", async () => {
  const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));
  let loaded = await readFiles([...shp("cable"), ...shp("areas", ["shp", "dbf"])]);
  const list = [];
  const host = {
    ref, headers: {}, places: () => list, findPlace: (n) => list.find((p) => p.name === n),
    addPlace({ feature, origin, name, status }) { const p = { name, feature, origin, status, edits: [] }; list.push(p); return p; },
    loadedFile: () => loaded, fileUsed: () => { loaded = null; },
  };
  const summary = await projectSummary(ref, [], null, null, [], loaded);
  assert.match(summary, /A file is loaded and waiting/);
  assert.match(summary, /"label":"Area B"/);
  const t = createPlaceTools(host);
  const ask = await t.exec("use_file_features", { features: ["F1"] });
  assert.equal(ask.needs_width, true); // a line with no width: ask, don't choose
  assert.equal(list.length, 0);
  const out = await t.exec("use_file_features", { features: ["F2", "F3"], combine: "separate" });
  assert.deepEqual(out.made.map((m) => m.place), ["Area A", "Area B"]);
  assert.equal(list[0].status, "accepted");
  assert.equal(loaded, null);
  assert.match(await projectSummary(ref, list, null), /from your file .*"Area A"/);
  await assert.rejects(() => t.exec("use_file_features", { features: ["F1"] }), /No file is waiting/);
});

// ---- the EPSG registry chooses the transformation (Rob, 23 Nov: one way of choosing, as for typed coordinates) ----
const geodesyWith = (tfs) => createEpsgTools({ epsg: fakeEpsg(tfs), transformationChoice: () => "choose" }, () => null).fileGeodesy;
const geodesy = geodesyWith();

await test("a .prj's EPSG code: its own authority, or a well-known Esri name", () => {
  assert.equal(epsgFromPrj(readFileSync(new URL("redline.prj", DIR), "utf8")).code, 27700);
  assert.equal(epsgFromPrj(readFileSync(new URL("block_ed50.prj", DIR), "utf8")).code, 23031);
  assert.equal(epsgFromPrj(readFileSync(new URL("wgs_utm30.prj", DIR), "utf8")).code, 32630);
  assert.equal(epsgFromPrj('PROJCS["x",GEOGCS["y",AUTHORITY["EPSG","4277"]],AUTHORITY["EPSG","27700"]]').code, 27700);
  assert.equal(epsgFromPrj(readFileSync(new URL("odd_grid.prj", DIR), "utf8")), null);
});

await test("British National Grid: the registry picks EPSG:1314 (2 m) for Linlithgow; the 1 m grids can't be applied here", async () => {
  const f = await readFiles(shp("redline"), { geodesy });
  const crs = f.layers[0].crs;
  assert.equal(crs.transformation.code, 1314);
  assert.equal(crs.transformation.accuracy_m, 2);
  assert.match(crs.how, /EPSG:1314.*about 2 m.*EPSG registry/);
  assert.ok(metres(f.features[0].geometry.coordinates[0][0], osgbToWgs84(300200, 677400)) < 1);
  const [p] = placesFromFile(f, {});
  assert.equal(p.origin.crs.transformation.code, 1314);
});

await test("ED50 in the North Sea: the registry's 1 m EPSG:1311, not the general 10 m shift", async () => {
  const f = await readFiles(shp("block_ed50"), { geodesy });
  assert.equal(f.layers[0].crs.transformation.code, 1311);
  const corner = f.features[0].geometry.coordinates[0][0];
  const ref = proj4("+proj=utm +zone=31 +ellps=intl +towgs84=-89.5,-93.8,-123.1,0,0,-0.156,1.2 +units=m", "WGS84", [500000, 6200000]);
  assert.ok(metres(corner, ref) < 0.5, `1311 corner ${corner} vs ${ref}`);
  const general = (await readFiles(shp("block_ed50"))).features[0].geometry.coordinates[0][0];
  assert.ok(metres(corner, general) > 1, `differs from the general shift (${metres(corner, general)} m)`);
});

await test("WGS 84 / UTM needs no transformation; ETRS89 / UTM gets the registry's ETRS89 to WGS 84", async () => {
  const w = await readFiles(shp("wgs_utm30"), { geodesy });
  assert.match(w.layers[0].crs.how, /no datum transformation was needed/);
  assert.ok(metres(w.features[0].geometry.coordinates[0][0], proj4("+proj=utm +zone=30 +datum=WGS84", "WGS84", [400000, 6200000])) < 0.01);
  const e = await readFiles(shp("etrs_utm31"), { geodesy });
  assert.equal(e.layers[0].crs.transformation.code, 1149);
});

await test("only grid transformations cover the site: the layer waits for the person, and nothing can be used yet", async () => {
  let f = await readFiles(shp("redline"), { geodesy: geodesyWith({ 5339: TF[5339], 7710: TF[7710] }) });
  const crs = f.layers[0].crs;
  assert.ok(crs.pending);
  assert.match(crs.pending.why, /grid file/);
  assert.match(crs.how, /needs a decision/);
  assert.equal(fileSummary(f).waiting_for_a_decision[0].layer, "redline");
  assert.throws(() => placesFromFile(f, {}), (e) => e.needs_decision === true);
  // The person says go ahead without a shift: converted, flagged, usable.
  const r = await resolveLayer(f, "redline", "none", { geodesy });
  assert.match(r.warning, /no datum shift/);
  assert.ok(metres(f.features[0].geometry.coordinates[0][0], osgbToWgs84(300200, 677400)) > 50, "unshifted is visibly off");
  assert.equal(placesFromFile(f, {})[0].origin.crs.chosen_by, "the person");
  // Or names another applicable transformation between the same CRSs.
  f = await readFiles(shp("redline"), { geodesy: geodesyWith({ 5339: TF[5339], 7710: TF[7710] }) });
  await resolveLayer(f, "redline", "1314", { geodesy });
  assert.ok(metres(f.features[0].geometry.coordinates[0][0], osgbToWgs84(300200, 677400)) < 1);
  await assert.rejects(() => resolveLayer(f, "redline", "1314", { geodesy }), /doesn't need a decision/);
});

await test("a datum the registry can't be matched to waits for the person; an unreachable registry falls back and says so", async () => {
  const odd = await readFiles(shp("odd_grid"), { geodesy });
  assert.match(odd.layers[0].crs.pending.why, /couldn't be matched to an EPSG code/);
  const down = { ...geodesy, plan: async () => { throw new Error("EPSG answered 503"); } };
  const f = await readFiles(shp("redline"), { geodesy: down });
  assert.ok(!f.layers[0].crs.pending);
  assert.match(f.layers[0].crs.how, /registry couldn't be reached.*built-in shift/);
  assert.ok(metres(f.features[0].geometry.coordinates[0][0], osgbToWgs84(300200, 677400)) < 1);
});

await test("the analyst settles a waiting layer with set_file_transformation", async () => {
  const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));
  const loaded = await readFiles(shp("redline"), { geodesy: geodesyWith({ 5339: TF[5339], 7710: TF[7710] }) });
  const list = [];
  const host = { ref, headers: {}, places: () => list, findPlace: () => null, loadedFile: () => loaded,
    addPlace({ feature, origin, name, status }) { const p = { name, feature, origin, status, edits: [] }; list.push(p); return p; },
    resolveFileLayer: (layer, op) => resolveLayer(loaded, layer, op, { geodesy }) };
  const t = createPlaceTools(host);
  const early = await t.exec("use_file_features", { features: ["all"] });
  assert.equal(early.needs_decision, true);
  const out = await t.exec("set_file_transformation", { layer: "redline", operation: "1314" });
  assert.match(out.how, /EPSG:1314.*as you chose/);
  const made = await t.exec("use_file_features", { features: ["all"] });
  assert.equal(made.made.length, 1);
});

console.log(`${passed} fileimport tests passed`);
