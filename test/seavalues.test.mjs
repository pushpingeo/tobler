// Water depth and vessel traffic read off rasters (js/seavalues.js), with the services faked. Run with: npm test
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import { samplePoints, waterDepth, vesselTraffic, seaLines, seaShort, trafficWord } from "../js/seavalues.js";

const trusted = JSON.parse(readFileSync(new URL("../catalogue/trusted.json", import.meta.url), "utf8"));
const { elevation: ELEV, traffic: TRAFFIC } = trusted.values;
const json = (o) => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });

// Sample points: a point is itself; a line spreads along it; a polygon gives its centre plus points inside.
assert.deepEqual(samplePoints(turf.point([1, 57]), 25), [[1, 57]]);
const line = samplePoints(turf.lineString([[0, 57], [1, 57]]), 5);
assert.equal(line.length, 5);
assert.deepEqual(line[0], [0, 57]);
assert.deepEqual(line[4], [1, 57]);
const box = turf.bboxPolygon([1.4, 57.4, 1.6, 57.6]);
const pts = samplePoints(box, 25);
assert.ok(pts.length >= 13 && pts.length <= 25, `polygon points ${pts.length}`);
assert.ok(pts.every((p) => turf.booleanPointInPolygon(p, box)));

// Depth: median, range, land points; negative values are below sea level.
{
  let asked = "";
  const fetchFn = async (url) => { asked = url; return json({ samples: [-80, -90, -91, -95, -120, 3].map((v, i) => ({ locationId: i, value: String(v), resolution: 0.0041666 })) }); };
  const { depth, checked } = await waterDepth({ site: box, sources: ELEV, fetchFn });
  assert.match(asked, /ImageServer\/getSamples\?geometry=/);
  assert.match(asked, /esriGeometryMultipoint/);
  assert.equal(depth.typical_m, 91);
  assert.equal(depth.min_m, 80);
  assert.equal(depth.max_m, 120);
  assert.equal(depth.land_points, 1);
  assert.equal(depth.cell_m, 464);
  assert.equal(checked.result, "features");
  // At sea in European waters, EMODnet bathymetry answers before the global model (24 Nov).
  assert.equal(checked.publisher, ELEV.find((x) => x.serves === "sea").publisher);
  assert.equal(checked.evidence, "water depth");
}
// Depth: a failed service is "not checked", never zero; dry land is "none".
{
  const r = await waterDepth({ site: box, sources: ELEV, fetchFn: async () => { throw new Error("timed out"); } });
  assert.equal(r.depth, null);
  assert.equal(r.checked.result, "not checked");
  assert.match(r.checked.why, /timed out/);
  const dry = await waterDepth({ site: box, sources: ELEV, fetchFn: async () => json({ samples: [{ value: "109" }] }) });
  assert.equal(dry.checked.result, "none in dataset");
}

// Traffic: busiest sampled point near the site, its vessel types, and 2023 asked for explicitly.
{
  const urls = [];
  const site = turf.circle([1.5, 57.5], 1, { units: "kilometers" });
  const fetchFn = async (url) => {
    urls.push(url);
    const layer = /LAYERS=([^&]+)/.exec(url)[1];
    const x = +/BBOX=([-\d.]+)/.exec(url)[1];
    // A lane east of the site: busier further east.
    const v = layer === "vesseldensity_allavg" ? (x > 1.6 ? 12.5 : 0.2) : layer === "vesseldensity_10avg" ? 3.1 : 0.5;
    return json({ type: "FeatureCollection", features: [{ properties: { GRAY_INDEX: v } }] });
  };
  const { traffic, evidence, checked } = await vesselTraffic({ site, closeKm: 10, source: TRAFFIC, fetchFn });
  assert.ok(urls.every((u) => /TIME=2023-01-01/.test(u)), "asks for 2023");
  assert.equal(traffic.at_site, 0.2);
  assert.equal(traffic.at_site_word, "light");
  assert.equal(traffic.busiest.value, 12.5);
  assert.equal(traffic.busiest.word, "busy");
  assert.ok(traffic.busiest.distance_km > 0 && traffic.busiest.distance_km <= 10.5, `busiest at ${traffic.busiest.distance_km} km`);
  assert.equal(traffic.busiest.by_type.tanker, 3.1);
  assert.equal(evidence.length, 1);
  assert.match(evidence[0].name, /12\.5 h\/km² a month \(busy, AIS 2023\)/);
  assert.equal(evidence[0].source.licence, TRAFFIC.licence);
  assert.equal(checked.result, "features");
  const lines = seaLines({ traffic });
  assert.match(lines[0], /Vessel traffic \(AIS, 2023 annual average\): 0\.2 hours per km² a month on the site \(light\); busiest point sampled within 10 km: 12\.5 \(busy\)/);
  assert.match(lines[0], /tanker 3\.1/);
  assert.match(seaShort({ traffic }), /^Vessel traffic: light on the site \(0\.2 h\/km² a month\), busy \d+(\.\d)? km away \(12\.5\) \(AIS 2023, EMODnet\)\.$/);
}
// Traffic outside EMODnet's coverage: no data here, not zero; a dead service: not checked.
{
  const none = await vesselTraffic({ site: turf.point([5.3, 4.5]), source: TRAFFIC, fetchFn: async () => json({ type: "FeatureCollection", features: [] }) });
  assert.equal(none.traffic, null);
  assert.equal(none.checked.result, "none in dataset");
  assert.match(none.checked.why, /EU waters/);
  const dead = await vesselTraffic({ site: turf.point([1.5, 57.5]), source: TRAFFIC, fetchFn: async () => ({ ok: false, status: 503 }) });
  assert.equal(dead.checked.result, "not checked");
  const exception = await vesselTraffic({ site: turf.point([1.5, 57.5]), source: TRAFFIC, fetchFn: async () => ({ ok: true, text: async () => "<ServiceExceptionReport/>" }) });
  assert.equal(exception.checked.result, "not checked");
}
// Depth line for the card and the analyst.
assert.equal(
  seaLines({ depth: { typical_m: 91, min_m: 80, max_m: 120, points: 6, land_points: 0, dataset: "DEM Global Mosaic", publisher: "NOAA" } })[0],
  "Water depth about 91 m (80–120 m across the 6 points sampled). DEM Global Mosaic (NOAA).",
);
assert.deepEqual(seaLines(undefined), []);
assert.equal(trafficWord(0.07), "light");
assert.equal(trafficWord(24.9), "very busy");

console.log("seavalues tests passed");
