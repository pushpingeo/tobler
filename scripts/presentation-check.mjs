// The presentation CRS and the cross-check against the real EPSG registry (the unit tests use a fake one). For a place
// in each region of catalogue/grids.json and a few outside them: which CRS a run would show, and the operation the
// registry gives. Then Historic England's control points (test/fixtures/control-points) cross-checked through the real
// registry, and, with --live, the same check on listed buildings read from Historic England's service now.
// No Anthropic cost. Run by .github/workflows/presentation-check.yml (the workspace can't reach apps.epsg.org).
//
//   node scripts/presentation-check.mjs [--live]     (EPSG_PROXY=<Worker /epsg URL> to read through the Worker)
import { readFileSync } from "node:fs";
import * as R from "../js/reference.js";
import { presentationCrs, presentationLine, projectorFor } from "../js/presentation.js";
import { crossCheck, servicePairs } from "../js/crosscheck.js";

const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const grids = json("catalogue/grids.json");
const ref = R.createReference(async (n) => json(`data/ref/${n}.json`));
const UA = { "User-Agent": "tobler-presentation-check/1.0 (+https://github.com/pushpingeo/tobler)" };
const seen = new Map();
const epsg = ({ path, query = {} }) => {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const key = `${path}?${q}`;
  if (!seen.has(key)) seen.set(key, (async () => {
    const r = process.env.EPSG_PROXY
      ? await fetch(process.env.EPSG_PROXY, { method: "POST", headers: { "content-type": "application/json", origin: "https://asktobler.com" }, body: JSON.stringify({ path, query }) })
      : await fetch(`https://apps.epsg.org/api/v1/${path}/${q.size ? `?${q}` : ""}`, { headers: { accept: "application/json", ...UA } });
    if (!r.ok) throw new Error(`EPSG answered ${r.status} for ${path}`);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  })());
  return seen.get(key);
};

const pt = (lon, lat) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [lon, lat] } });
// [label, site, expected code, the most a transformation may be off (m)]
const PLACES = [
  ["Culham (R21)", json("eval/replay/R21/site.geojson").features[0], 27700, 2],
  ["Linlithgow", pt(-3.6, 55.98), 27700, 2],
  ["Belfast", pt(-5.93, 54.6), 2157, 3],
  ["Amsterdam", pt(4.9, 52.37), 28992, 3],
  ["Sydney", pt(151.2, -33.87), 7856, 3],
  ["Perth", pt(115.86, -31.95), 7850, 3],
  ["Brussels", pt(4.35, 50.85), 32631, 0],
  ["Miri", pt(113.99, 4.4), 32649, 0],
  ["Central North Sea", pt(2, 56.5), 32631, 0],
];
let failed = 0;
const fail = (m) => { failed++; console.log(`   FAIL: ${m}`); };

for (const [label, feature, want, maxM] of PLACES) {
  const pc = await presentationCrs({ feature, ref, grids, epsg });
  console.log(`${label}: ${pc.code ? presentationLine(pc) : pc.why}`);
  if (pc.code !== want) fail(`${label}: EPSG:${pc.code}, expected EPSG:${want} (${pc.why})`);
  if (pc.fallback_from) fail(`${label}: fell back from ${pc.fallback_from.name}: ${pc.fallback_from.reason}`);
  if (pc.accuracy_m == null || pc.accuracy_m > maxM) fail(`${label}: accuracy ${pc.accuracy_m} m, more than ${maxM} m`);
  if (pc.code && pc.kind === "national grid") {
    // A round trip through the projector every output will use returns the start point.
    try {
      const P = await projectorFor(pc, { grids, epsg });
      const c = feature.geometry.type === "Point" ? feature.geometry.coordinates : feature.geometry.coordinates[0][0];
      const back = P.inverse(P.forward(c));
      const m = Math.hypot((back[0] - c[0]) * 111320 * Math.cos((c[1] * Math.PI) / 180), (back[1] - c[1]) * 110574);
      console.log(`   round trip ${m.toFixed(4)} m; ${P.forward(c).map((v) => v.toFixed(1)).join(", ")}`);
      if (m > 0.01) fail(`${label}: round trip ${m} m`);
    } catch (e) { fail(`${label}: projector: ${e.message}`); }
  }
}

const cp = json("test/fixtures/control-points/historic-england-listed.json");
const fixture = await crossCheck({ points: cp.points.map((p) => ({ id: p.list_entry, native: p.geometry_27700, wgs84: p.service_wgs84 })), nativeCrs: 27700, grids, epsg });
console.log(`\nControl points (fixture, ${cp.source.queried}): ${fixture.verdict}; median ${fixture.median_m} m, max ${fixture.max_m} m, by ${fixture.operation?.name} (EPSG:${fixture.operation?.code})`);
if (fixture.verdict !== "agree") fail(`fixture: ${fixture.what}`);

if (process.argv.includes("--live")) {
  const url = cp.source.service;
  for (const [name, envelope] of [["Cornwall", [140000, 20000, 200000, 80000]], ["Kent", [580000, 130000, 640000, 180000]], ["Northumberland", [380000, 560000, 440000, 620000]]]) {
    try {
      const pairs = await servicePairs({ url, n: 10, envelope, fetchFn: (u) => fetch(u, { headers: UA }) });
      const r = await crossCheck({ points: pairs.points, nativeCrs: pairs.native_crs, grids, epsg });
      console.log(`Live, ${name}: ${pairs.points.length} points from "${pairs.layer}": ${r.verdict}; median ${r.median_m} m, max ${r.max_m} m`);
      if (r.verdict !== "agree") fail(`live ${name}: ${r.what}`);
    } catch (e) { fail(`live ${name}: ${e.message}`); }
  }
}

console.log(failed ? `\n${failed} problem(s)` : "\nAll as expected.");
process.exitCode = failed ? 1 : 0;
