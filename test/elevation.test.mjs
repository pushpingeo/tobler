// Elevation for every skill (js/elevation.js and the get_elevation tool), with the services faked. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import * as R from "../js/reference.js";
import { toElevation, elevationOver, elevationFrom, sourceServes, depthFrom, elevationSignificance, elevationLine, elevationShort } from "../js/elevation.js";
import { createPlaceTools } from "../js/placetools.js";

const trusted = JSON.parse(readFileSync(new URL("../catalogue/trusted.json", import.meta.url), "utf8"));
const NOAA = trusted.values.elevation.find((x) => /NOAA/.test(x.publisher));
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
const samples = (vals, extra = {}) => json({ samples: vals.map((v, i) => ({ locationId: i, value: String(v), resolution: 0.0041666, attributes: { Name: "ETOPO_2022_v1_15s_surface_elev" }, ...extra })) });
const box = turf.bboxPolygon([1.4, 57.4, 1.6, 57.6]);

// One convention: metres, positive up. Every source declares its sign; depths (positive down) are flipped.
assert.equal(NOAA.sign, "up");
assert.equal(toElevation("-90.5", NOAA), -90.5);
const DEPTHS = { title: "A depth-positive survey", sign: "down", units: "m" };
assert.equal(toElevation(90.5, DEPTHS), -90.5);
assert.equal(toElevation(-3, DEPTHS), 3, "a negative depth is above the datum (drying ground)");
assert.equal(toElevation(100, { title: "Feet", sign: "up", units: "ft" }), 30.48);
assert.throws(() => toElevation(5, { title: "No sign" }), /elevations or depths/);
assert.throws(() => toElevation(5, { title: "Odd units", sign: "up", units: "fathoms" }), /unknown units/);
assert.equal(toElevation("NoData", NOAA), null);

// The same seabed from a depth-positive source and an elevation source comes out the same.
{
  const up = await elevationOver({ feature: box, source: { ...NOAA }, fetchFn: async () => samples([-80, -90, -100]) });
  const down = await elevationOver({ feature: box, source: { ...NOAA, sign: "down" }, fetchFn: async () => samples([80, 90, 100]) });
  assert.deepEqual([up.elevation.typical_m, up.elevation.min_m, up.elevation.max_m], [-90, -100, -80]);
  assert.deepEqual([down.elevation.typical_m, down.elevation.min_m, down.elevation.max_m], [-90, -100, -80]);
  assert.equal(up.elevation.convention, "metres, positive up, relative to sea level");
  const noTime = (d) => ({ ...d, checked_at: null });
  assert.deepEqual(noTime(depthFrom(up.elevation)), noTime(depthFrom(down.elevation)));
  assert.equal(depthFrom(up.elevation).typical_m, 90);
  assert.equal(depthFrom(up.elevation).max_m, 100);
  assert.equal(up.elevation.cell_m, 464);
  assert.deepEqual(up.elevation.rasters, ["ETOPO_2022_v1_15s_surface_elev"]);
}

// Depth at sea comes from the sea points only, not averaged with land; a dry site has no depth.
{
  const { elevation } = await elevationOver({ feature: box, source: NOAA, fetchFn: async () => samples([-80, -90, -91, -95, -120, 3]) });
  assert.equal(elevation.below_sea_level_points, 5);
  assert.equal(depthFrom(elevation).typical_m, 91);
  const dry = await elevationOver({ feature: box, source: NOAA, fetchFn: async () => samples([109, 120]) });
  assert.equal(depthFrom(dry.elevation), null);
}

// Failures are "not checked"; the next source is tried; an unknown service kind is refused, not guessed.
{
  const fail = await elevationOver({ feature: box, source: NOAA, fetchFn: async () => { throw new Error("timed out"); } });
  assert.equal(fail.elevation, null);
  assert.equal(fail.checked.result, "not checked");
  const second = { ...NOAA, title: "Backup" };
  let n = 0;
  const r = await elevationFrom([NOAA, second], { feature: box, fetchFn: async () => (n++ === 0 ? { ok: false, status: 503 } : samples([12])) });
  assert.equal(r.elevation.dataset, "Backup");
  const odd = await elevationOver({ feature: box, source: { ...NOAA, kind: "wcs" }, fetchFn: async () => samples([1]) });
  assert.match(odd.checked.why, /can't read wcs/);
  const none = await elevationFrom([], { feature: box });
  assert.equal(none.checked.result, "not checked");
}

// When it matters on land (Rob, 20 Nov): low-lying, below sea level, high and very high altitude; otherwise quiet.
const E = (typical, min, max) => ({ typical_m: typical, min_m: min, max_m: max, points: 9, below_sea_level_points: 0, cell_m: 464, dataset: "DEM Global Mosaic", publisher: "NOAA", vertical_datum: "EGM2008" });
assert.equal(elevationSignificance(E(109, 95, 130)), null, "Linlithgow: nothing to say");
assert.equal(elevationSignificance(E(4, 1, 8)).kind, "low-lying");
assert.equal(elevationSignificance(E(-2, -4, 1)).kind, "below sea level");
assert.equal(elevationSignificance(E(740, 149, 1068)).kind, "upland", "Ben Nevis SAC as sampled (Rob, 20 Nov: a 1,000–2,500 m band)");
assert.equal(elevationSignificance(E(950, 900, 990)), null, "under 1,000 m: nothing to say");
assert.match(elevationSignificance(E(1200, 1100, 1300)).why, /exposed weather, snow and ice/);
assert.equal(elevationSignificance(E(2400, 2300, 2600)).kind, "high altitude", "the highest point counts");
assert.equal(elevationSignificance(E(3776, 3700, 3900)).kind, "very high altitude");
assert.equal(elevationShort(E(4, 1, 8), elevationSignificance(E(4, 1, 8))), "Elevation about 4 m, 1–8 m across the site: low-lying (NOAA).");
assert.equal(elevationShort(E(-2, -4, 1), elevationSignificance(E(-2, -4, 1))), "Elevation about 2 m below sea level, -4–1 m across the site: below sea level (NOAA).");
assert.match(elevationLine(E(3776, 3700, 3900), elevationSignificance(E(3776, 3700, 3900))), /^Elevation about 3776 m above sea level, 3700–3900 m across the site \(very high altitude: much less oxygen.*\)\. DEM Global Mosaic \(NOAA\), cells about 464 m; heights relative to EGM2008\.$/);

// The get_elevation tool any skill can call: elevation positive up, water depth at sea, the notable part on land.
{
  const ref = R.createReference(async (n) => JSON.parse(readFileSync(new URL(`../data/ref/${n}.json`, import.meta.url))));
  const list = [];
  let next = [-140, -150, -160];
  const host = {
    ref, anchors: [], headers: {}, trusted, list,
    fetchFn: async (url) => (/getSamples/.test(url) ? samples(next) : json([])),
    places: () => list, findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
  };
  list.push({ name: "Rosebank", feature: box, origin: { method: "drawn" }, edits: [] });
  list.push({ name: "La Paz", feature: turf.bboxPolygon([-68.2, -16.55, -68.1, -16.45]), origin: { method: "drawn" }, edits: [] });
  const tools = createPlaceTools(host);
  const sea = await tools.exec("get_elevation", { place: "Rosebank" });
  assert.deepEqual(sea.elevation_m.typical, -150);
  assert.deepEqual(sea.water_depth_m, { typical: 150, shallowest: 140, deepest: 160 });
  assert.equal(sea.notable, undefined);
  // All seabed from the land pass, so it's read again from EMODnet bathymetry (24 Nov).
  assert.match(sea.licence, /EMODnet \(CC BY 4\.0\)/);
  next = [3700, 3776, 3900];
  const high = await tools.exec("get_elevation", { place: "La Paz" });
  assert.equal(high.water_depth_m, undefined);
  assert.match(high.notable, /very high altitude/);
  next = [-2, 1, 3];
  const mixed = await tools.exec("get_elevation", { place: "La Paz" });
  assert.match(mixed.water_depth_m, /may be sea, or land below sea level/);
  await assert.rejects(() => tools.exec("get_elevation", { place: "Nowhere" }), /isn.t a candidate id from this conversation or a place name/);
}

{
  // National lidar first, where it covers the place (24 Nov): England's 1 m lidar for a site in England, falling through
  // to the global model where the lidar has a gap; the bathymetry model never answers for a site on land.
  const trusted = JSON.parse(readFileSync(new URL("../catalogue/trusted.json", import.meta.url), "utf8"));
  const srcs = trusted.values.elevation;
  assert.deepEqual(srcs.map((x) => x.serves || "both").slice(0, 3), ["land", "land", "sea"]);
  const lin = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-3.6, 55.98] } }; // Linlithgow, Scotland
  const peterborough = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-0.45, 52.69] } };
  const dogger = { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [2.0, 54.8] } };
  const names = (f, setting) => srcs.filter((x) => sourceServes(x, f, setting)).map((x) => x.publisher.split(" ")[0]);
  assert.deepEqual(names(peterborough, "land"), ["Environment", "NOAA"]);
  assert.deepEqual(names(lin, "land"), ["NOAA"], "England's lidar isn't asked about Scotland");
  assert.deepEqual(names(dogger, "sea"), ["European", "NOAA"]);
  const asked = [];
  const fake = (answers) => async (url) => { asked.push(url.split("/rest/services/")[1].split("/ImageServer")[0]); const a = answers.shift();
    return { ok: true, json: async () => ({ samples: a.map((v) => ({ value: v, resolution: 1, attributes: {} })) }) }; };
  // A lidar gap (no values) falls through to NOAA, and the record says the finer source was tried.
  const gap = await elevationFrom(srcs, { feature: peterborough, setting: "land", fetchFn: fake([["NoData"], [12]]), now: () => "t" });
  assert.equal(gap.elevation.typical_m, 12);
  assert.match(gap.checked.finer_tried[0], /^LIDAR Composite DTM 1 m, 2022 \(Environment Agency\): none in dataset/);
  // Lidar answers: its cell size is in metres, not degrees.
  asked.length = 0;
  const lidar = await elevationFrom(srcs, { feature: peterborough, setting: "land", fetchFn: fake([[23.4]]), now: () => "t" });
  assert.equal(lidar.elevation.dataset, "LIDAR Composite DTM 1 m, 2022 (Environment Agency)");
  assert.equal(lidar.elevation.cell_m, 1);
  assert.match(lidar.elevation.vertical_datum, /Newlyn/);
  assert.deepEqual(asked, ["SURVEY/LIDAR_Composite_1m_DTM_2022_Elevation"]);
}

console.log("elevation tests passed");
