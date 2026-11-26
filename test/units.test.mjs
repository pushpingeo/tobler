// Units (package C): exact factors in one place, short distances, units as said, the default from the country.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as U from "../js/units.js";

let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

ok("every factor is exact, by definition", () => {
  assert.equal(U.M_PER.ft, 0.3048);
  assert.equal(U.M_PER.yd, 0.9144);
  assert.equal(U.M_PER.mi, 1609.344);
  assert.equal(U.M_PER.nmi, 1852);
  assert.equal(U.M2_PER.acre, 4046.8564224);
  assert.equal(U.M2_PER.ha, 10000);
  // The derived ones agree with their parts.
  assert.equal(+(U.M_PER.ft ** 2).toPrecision(12), U.M2_PER.ft2);
  assert.equal(+(43560 * U.M2_PER.ft2).toPrecision(12), U.M2_PER.acre);
  assert.equal(+(U.M_PER.mi ** 2).toPrecision(15), U.M2_PER.mi2);
  assert.equal(U.M_PER.mi, 5280 * U.M_PER.ft);
});

ok("no other file holds a conversion factor", () => {
  const factors = /(?<![\d.])(0\.3048|1\.609344?|1\.852|0\.9144|247\.10?5|2\.4710?5|4046\.8|0\.621\d*|3\.2808\d*|1200\s*\/\s*3937)(?!\d)/;
  const hits = [];
  for (const dir of ["js", "scripts"]) {
    for (const f of readdirSync(dir)) {
      if (!/\.(m?js)$/.test(f) || f === "units.js") continue;
      readFileSync(`${dir}/${f}`, "utf8").split("\n").forEach((line, i) => { if (factors.test(line)) hits.push(`${dir}/${f}:${i + 1}`); });
    }
  }
  assert.deepEqual(hits, []);
});

ok("there and back without drift (to 12 significant figures, under a micrometre on 50 km)", () => {
  for (const u of ["metric", "imperial", "nautical"]) {
    U.setUnits(u);
    for (const km of [0, 0.01, 0.04572, 0.25, 1, 1.609344, 5, 12.4, 50]) {
      assert.equal(U.fromDist(U.toDist(km)), km, `${u} ${km} km`);
    }
    for (const km2 of [0.0001, 0.1, 2.58998811034, 30]) assert.equal(U.fromArea(U.toArea(km2)), km2, `${u} ${km2} km²`);
  }
  U.setUnits("imperial");
  assert.equal(U.toDist(1.609344), 1);
  assert.equal(U.fromDist(3), 4.828032);
  U.setUnits("metric");
});

ok("\"150 feet\" becomes 0.04572 km and the record keeps both", () => {
  const p = U.parseLength("150", "feet");
  assert.equal(p.km, 0.04572);
  assert.deepEqual(p.said, { value: 150, unit: "feet" });
  assert.equal(p.unit, "ft");
  assert.equal(U.parseLength(5, "km").km, 5);
  assert.equal(U.parseLength("50", "metres").km, 0.05);
  assert.equal(U.parseLength("1", "mile").km, 1.609344);
  assert.equal(U.parseLength("0.25", "miles").km, 0.402336);
  assert.equal(U.parseLength("2", "nautical miles").km, 3.704);
  assert.equal(U.parseLength("1,000", "ft").km, 0.3048);
  assert.equal(U.parseLength("100", "yards").km, 0.09144);
});

ok("accepted spellings, and anything else is refused, never guessed", () => {
  for (const [u, ws] of Object.entries(U.ACCEPTED_UNITS)) for (const w of ws) assert.equal(U.unitOf(w), u, w);
  for (const w of ["Feet", " MILES ", "Kilometers", "nautical  miles", "Metres."]) assert.ok(U.unitOf(w), w);
  for (const w of ["", "furlongs", "chains", "us survey feet", "cm", "inches", "parsecs"]) assert.equal(U.unitOf(w), null, w);
  assert.equal(U.parseLength("abc", "m"), null);
  assert.equal(U.parseLength(-5, "m"), null);
  assert.equal(U.parseLength(5, "furlongs"), null);
});

ok("short distances: metres under 1 km, feet under 1,000 ft", () => {
  assert.equal(U.dist(0.25, "metric"), "250 m");
  assert.equal(U.dist(0.04572, "metric"), "46 m");
  assert.equal(U.dist(0.999, "metric"), "1,000 m");
  assert.equal(U.dist(1, "metric"), "1 km");
  assert.equal(U.dist(12.4, "metric"), "12.4 km");
  assert.equal(U.dist(0.04572, "imperial"), "150 ft");
  assert.equal(U.dist(0.05, "imperial"), "160 ft");
  assert.equal(U.dist(0.3, "imperial"), "980 ft");
  assert.equal(U.dist(0.3048, "imperial"), "0.19 mi");
  assert.equal(U.dist(1.609344, "imperial"), "1 mi");
  assert.equal(U.dist(0.5, "nautical"), "500 m");
  assert.equal(U.dist(1.852, "nautical"), "1 nm");
  assert.equal(U.dist(null), "");
});

ok("figures for the model carry both, so it never converts", () => {
  assert.equal(U.distBoth(1.609344, "imperial"), "1 mi (1.61 km)");
  assert.equal(U.distBoth(0.05, "imperial"), "160 ft (50 m)");
  assert.equal(U.distBoth(5, "metric"), "5 km");
  U.setUnits("imperial");
  assert.match(U.unitsNote(), /never convert/);
  assert.doesNotMatch(U.unitsNote(), /km in brackets/);
  U.setUnits("metric");
  assert.equal(U.unitsNote(), "");
});

ok("areas: acres under a square mile, exact", () => {
  assert.equal(U.area(U.M2_PER.acre / 1e6, "imperial"), "1 acre");
  assert.equal(U.area(U.M2_PER.mi2 / 1e6, "imperial"), "1 sq mi");
  assert.equal(U.hectares(1, "imperial"), "2.5 acres");
  assert.equal(U.hectares(40.468564224, "imperial"), "100 acres");
  assert.equal(U.hectares(12.34, "metric"), "12.3 ha");
});

ok("a US site defaults to imperial and a Scottish one to metric; the person's choice wins", () => {
  assert.equal(U.unitsFor({ country: "United States of America" }).units, "imperial");
  assert.equal(U.unitsFor({ country: "US" }).units, "imperial");
  assert.equal(U.unitsFor({ country: "United Kingdom" }).units, "metric");
  for (const c of ["Australia", "Netherlands", "GB", "NL", "AU"]) assert.equal(U.unitsFor({ country: c }).units, "metric", c);
  assert.equal(U.unitsFor({}).units, "metric");
  assert.equal(U.unitsFor({ offshore: true }).offer_nautical, true);
  assert.equal(U.unitsFor({ country: "United States of America", chosen: "metric" }).units, "metric");
  assert.equal(U.unitsFor({ country: "United Kingdom", chosen: "imperial" }).units, "imperial");
  assert.equal(U.unitsFor({ country: "United Kingdom", chosen: "nonsense" }).units, "metric");
});

ok("the report says which units it shows", () => {
  assert.match(U.unitsLine("imperial"), /feet and miles/);
  assert.match(U.unitsLine("metric"), /metres and kilometres/);
});

ok("two ladders: metric, and round imperial values (Rob: B everywhere in imperial)", () => {
  for (const u of ["metric", "imperial", "nautical"]) {
    const l = U.ladder(u);
    assert.equal(l.length, 10);
    l.forEach((e, i) => i && assert.ok(e.km > l[i - 1].km, `${u} ordered`));
    assert.ok(l.at(-1).km <= 50, `${u} stops by 50 km`);
  }
  assert.deepEqual(U.ladder("imperial").map((e) => e.km).slice(0, 5), [0.09144, 0.3048, 0.402336, 0.804672, 1.609344]);
  assert.deepEqual(U.ladder("nautical").map((e) => e.km), U.ladder("metric").map((e) => e.km));
  assert.deepEqual(U.ladderBands(5, "imperial").map((b) => b.label), ["0–300 ft", "300–1,000 ft", "1,000 ft–¼ mi", "¼–½ mi", "½–1 mi", "1–2 mi", "2–3.11 mi"]);
  assert.deepEqual(U.ladderBands(1.609344, "imperial").map((b) => b.label), ["0–300 ft", "300–1,000 ft", "1,000 ft–¼ mi", "¼–½ mi", "½–1 mi"]);
  assert.deepEqual(U.ladderBands(2, "metric").map((b) => b.label), ["0–100 m", "100–250 m", "250–500 m", "500 m–1 km", "1–2 km"]);
  assert.deepEqual(U.ladderBands(0.05, "metric").map((b) => b.label), ["0–50 m"]);
  const b = U.ladderBands(2, "imperial");
  assert.equal(b.at(-1).label, "1–1.24 mi");
  assert.equal(b.at(-1).to_km, 2);
});

console.log(`${n} units tests passed`);
