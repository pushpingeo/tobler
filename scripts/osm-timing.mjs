// Times real lookups in Tobler's copy of OpenStreetMap (js/osmsnapshot.js) against the same questions to Overpass
// (25 Nov). For each site, two scenarios with the checks' own reaches: the developable area's (solar buffers, each kind
// only as far as its largest buffer) and a constraints screen at local scale. Counts HTTP requests, bytes and seconds
// for the copy (cold: manifest not yet read; warm: the second lookup), and seconds and outcome for Overpass, quick
// (15 s) and patient (55 s). Also compares what each found, kind by kind.
// Run (Node 22, network): node scripts/osm-timing.mjs [base URL] > timing.json
// Used by .github/workflows/osm-timing.yml; the workspace can't reach data.asktobler.com or Overpass.
import * as turf from "../js/vendor/turf.js";
import { osmSnapshot, forgetManifests } from "../js/osmsnapshot.js";
import { osmAnswers, osmQuery } from "../js/osmchecks.js";
import { overpassQuery, resetOverpass } from "../js/gazetteer.js";

console.debug = () => {}; // the FlatGeobuf reader logs every range request
const base = process.argv[2] || "https://data.asktobler.com/osm/";
const H = { "User-Agent": "Tobler timing check (github.com/pushpingeo/tobler)" };

// Sites. Barnston: a ~10 ha box beside the Borderlands Line at Heswall station, by Barnston on the Wirral (not Rob's red
// line, which isn't on file). London: Barking Riverside, dense buildings. Highland: open moorland west of Lairg.
const SITES = [
  { name: "Barnston (Wirral), by the railway", box: [-3.0790, 53.3355, -3.0745, 53.3385] },
  { name: "London (Barking Riverside)", box: [0.1050, 51.5150, 0.1120, 51.5190] },
  { name: "Highland (west of Lairg)", box: [-4.4400, 58.0250, -4.4200, 58.0350] },
];
// km per kind. Developable area, solar: homes 50 m, power lines 30 m, pipelines 10 m, roads and rail 15 m,
// watercourses 8 m; buildings and open water on the site only.
const SCENARIOS = {
  "developable area": { building: 0, "water body": 0, watercourse: 0.008, homes: 0.05, "power line": 0.03, pipeline: 0.01, "main road": 0.015, railway: 0.015 },
  "constraints screen (local)": { homes: 0.5, school: 1, "health care": 1, "power line": 0.5, substation: 2, pipeline: 0.5, "main road": 0.5, railway: 0.5, aerodrome: 5, "wind turbine": 2 },
};

// Count what the copy fetches (manifest and range requests).
const realFetch = globalThis.fetch;
let tally = { requests: 0, bytes: 0 };
globalThis.fetch = async (url, init) => {
  const r = await realFetch(url, init);
  tally.requests++;
  tally.bytes += +(r.headers.get("content-length") || 0);
  return r;
};

const out = { base, at: new Date().toISOString(), runner: process.env.RUNNER_NAME || null, results: [] };
for (const s of SITES) {
  const site = turf.bboxPolygon(s.box);
  const ha = Math.round(turf.area(site) / 1e4);
  for (const [scenario, km] of Object.entries(SCENARIOS)) {
    const wants = new Map(Object.entries(km));
    const row = { site: s.name, ha, scenario };
    for (const pass of ["cold", "warm"]) {
      if (pass === "cold") forgetManifests();
      tally = { requests: 0, bytes: 0 };
      const t0 = performance.now();
      let got = null, err = null;
      try {
        got = await osmAnswers({ wants, site, snapshot: osmSnapshot({ base, markets: ["uk"], fetchFn: globalThis.fetch, timeoutMs: 60000 }),
          query: async () => { throw new Error("outside the copy (would go to Overpass)"); } });
      } catch (e) { err = String(e.message || e); }
      const one = got && [...got.values()][0];
      row[`copy_${pass}`] = {
        seconds: +((performance.now() - t0) / 1000).toFixed(2), requests: tally.requests, kb: Math.round(tally.bytes / 1024),
        via: one?.meta?.via || null, data_as_of: one?.meta?.data_as_of || null, error: err || (one?.not_checked ?? null),
        found: got ? Object.fromEntries([...got].map(([k, a]) => [k, a.not_checked ? "not checked" : a.features.length])) : null,
      };
    }
    // Overpass, the same question, both speeds. Each starts clean (no remembered answer, no down latch).
    const boxOf = (k) => { const [w, so, e, n] = turf.bbox(site); const dy = km[k] / 110.574, dx = km[k] / (111.32 * Math.cos(((so + n) / 2) * Math.PI / 180)); return [w - dx, so - dy, e + dx, n + dy]; };
    for (const patient of [false, true]) {
      resetOverpass();
      const t0 = performance.now();
      let got = null, err = null;
      try {
        got = await osmAnswers({ wants, site, timeoutS: patient ? 50 : 25,
          query: (q) => overpassQuery(q, realFetch, H, { patient }) });
      } catch (e) { err = String(e.message || e); }
      const failed = got && [...got.values()].find((a) => a.not_checked);
      row[patient ? "overpass_patient" : "overpass_quick"] = {
        seconds: +((performance.now() - t0) / 1000).toFixed(2), answered: !!got && !failed, error: err || failed?.not_checked || null,
        found: got && !failed ? Object.fromEntries([...got].map(([k, a]) => [k, a.features.length])) : null,
      };
      if (patient) row.query_chars = osmQuery([...wants.keys()], boxOf, { timeoutS: 50 }).length;
    }
    out.results.push(row);
    console.error(`${s.name} · ${scenario}: copy ${row.copy_cold.seconds}s/${row.copy_cold.requests} req/${row.copy_cold.kb} kB (warm ${row.copy_warm.seconds}s); overpass quick ${row.overpass_quick.answered ? row.overpass_quick.seconds + "s" : "failed"}, patient ${row.overpass_patient.answered ? row.overpass_patient.seconds + "s" : "failed"}`);
  }
}
process.stdout.write(JSON.stringify(out, null, 2) + "\n");
