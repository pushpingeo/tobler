// Coordinates typed into the chat (js/coords.js), from Rob's log of 20 Nov: "55.522759, -5.650122" went to the
// place-name search and came back as the Argyll and Bute county centre, 100 km away.
import assert from "node:assert/strict";
import { parseCoordinates, osgbToLatLon, gridRefToEN, coordinateNote } from "../js/coords.js";

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);
const at = (s) => { const c = parseCoordinates(s); assert.ok(c, `read ${s}`); return c; };

test("decimal degrees, as people write them", () => {
  const c = at("55.522759, -5.650122");
  assert.deepEqual([c.lat, c.lon], [55.522759, -5.650122]);
  assert.equal(c.read, "55.52276° N, 5.65012° W");
  assert.equal(c.system, "decimal degrees");
  assert.equal(c.input, "55.522759, -5.650122");
  assert.match(c.alternative.read, /5\.65012° S, 55\.52276° E/, "both numbers could be latitudes: the other reading is kept");
  for (const s of ["55.522759 -5.650122", "55.522759;-5.650122", "N55.5228 W5.6501", "55.5228N, 5.6501W", "55.5228° N 5.6501° W", "lat: 55.5228, lon: -5.6501", "lon -5.6501 lat 55.5228", "x=-5.6501 y=55.5228"]) {
    const d = at(s);
    near(d.lat, 55.5228, 1e-4, s); near(d.lon, -5.6501, 1e-4, s);
  }
  assert.equal(at("N55.5228 W5.6501").alternative, undefined, "hemisphere letters settle the order");
  // Longitude over 90 settles the order too.
  const w = at("-122.4194, 37.7749");
  assert.deepEqual([w.lat, w.lon, w.order], [37.7749, -122.4194, "lon, lat"]);
  // In a sentence.
  assert.equal(at("screen a 2 km² square centred on 55.5228, -5.6501 for onshore wind").input, "55.5228, -5.6501");
});

test("degrees, minutes and seconds", () => {
  const c = at(`55°31'22.1"N 5°39'00.4"W`);
  near(c.lat, 55.52281, 1e-5, "lat"); near(c.lon, -5.65011, 1e-5, "lon");
  assert.equal(c.system, "degrees, minutes and seconds");
  near(at("55 31 22 N 5 39 0 W").lon, -5.65, 1e-4, "spaces");
  near(at("55°31.37'N 5°39.01'W").lat, 55.52283, 1e-4, "degrees and decimal minutes");
});

test("British National Grid: the Ordnance Survey's own worked example, letters and numbers", () => {
  // OS guide to coordinate systems: TG 51409 13177 = 651409.903, 313177.270; OSGB36 52°39'27.2531"N 1°43'4.5177"E.
  // Projection only: the datum shift to WGS84 is chosen from the EPSG registry later (js/placetools.js).
  const g = gridRefToEN("TG", "5140913177");
  assert.deepEqual([Math.floor(g.e), Math.floor(g.n), g.square_m], [651409, 313177, 1]);
  const [lon, lat] = osgbToLatLon(651409.903, 313177.27);
  near(lat, 52 + 39 / 60 + 27.2531 / 3600, 1e-6, "OSGB36 lat (projection only, to a few cm)"); near(lon, 1 + 43 / 60 + 4.5177 / 3600, 1e-6, "OSGB36 lon");
  const c = at("TG 51409 13177");
  assert.equal(c.system, "British National Grid reference");
  assert.match(c.datum, /OSGB36/);
  assert.deepEqual(c.grid, { epsg: 27700, e: 651409.5, n: 313177.5 });
  assert.match(coordinateNote("screen NT 002 774"), /British National Grid reference, E 300250, N 677450\. Pass "NT 002 774" to find_place .* converted to WGS84 there/);
  // Six figures: the centre of a 100 m square. Linlithgow Palace.
  const p = at("NT 002 774");
  assert.equal(p.precision_m, 100);
  near(p.lat, 55.9796, 2e-3, "Linlithgow lat"); near(p.lon, -3.6002, 2e-3, "Linlithgow lon");
  near(at("nt002774").lat, p.lat, 1e-9, "one word, lower case");
  near(at("NR68532836").lon, at("NR 6853 2836").lon, 1e-9, "with or without spaces");
  const en = at("E 300200 N 677400");
  assert.equal(en.system, "British National Grid eastings and northings");
  near(en.lat, 55.979, 2e-3, "eastings and northings");
  assert.equal(at("168530, 628360").system, "British National Grid eastings and northings");
});

test("ordinary text isn't read as coordinates", () => {
  for (const s of ["make it 1.5, 2.5 km", "between 2.25 3.75 km", "rotate 30.5 degrees", "so 2026 was busy", "block 30/2", "3 km north of Linlithgow",
    "screen Area 1 for risks", "OML 145", "a 10 km² square round the Jackdaw platform", "12345 67890 is my reference"]) {
    assert.equal(parseCoordinates(s), null, s);
  }
  assert.equal(coordinateNote("screen Area 1"), null);
  assert.match(coordinateNote("55.522759, -5.650122"), /^\(Read by the page: "55\.522759, -5\.650122" is 55\.52276° N, 5\.65012° W, decimal degrees; or .* Pass "55\.522759, -5\.650122" to find_place/);
});

console.log(`${passed} coords tests passed`);
