// Site boundaries from the person's own files (js/fileimport.js). Fixtures: test/fixtures/import (make.py builds them).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import { proj4 } from "../js/vendor/fileread.js";
import { readFiles, placesFromFile, fileSummary, fileOriginText, converterFor } from "../js/fileimport.js";
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

console.log(`${passed} fileimport tests passed`);
