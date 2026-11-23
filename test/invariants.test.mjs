// Invariants (CLAUDE.md): the few things that must always be true of Tobler, checked so that drift fails a test
// instead of relying on someone noticing. Each known breach is listed in KNOWN with its reason; a new breach fails.
// To change a rule or add to KNOWN, ask Rob first (Rob, 23 Nov: "how do you build applications with intent?").
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { placeToolDefs, projectSummary } from "../js/placetools.js";
import { readFiles, fileSummary } from "../js/fileimport.js";
import * as R from "../js/reference.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const ROOT = new URL("..", import.meta.url).pathname;
const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  if (/^(node_modules|vendor|\.git|fixtures|eval|data)$/.test(n)) return [];
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const files = walk(ROOT).map((p) => relative(ROOT, p));
const read = (f) => readFileSync(join(ROOT, f), "utf8");
const pageCode = files.filter((f) => /^js\/.*\.js$/.test(f));

// Known breaches, waiting for Rob's decision. Each entry: file → why it's allowed for now.
const KNOWN = {
  geodesy: {
    "js/fileimport.js": "site files fall back to built-in shifts (OSGB36, TM65, ED50 general) when the EPSG registry can't be reached (23 Nov)",
  },
  cdn: {
    "lab.html": "lab page, moving to asktobler-lab (plan item 7)",
    "tools.html": "lab page, moving to asktobler-lab (plan item 7)",
  },
};
const unexpected = (hits, allowed = {}) => hits.filter((f) => !allowed[f]);

await test("I1 geodesy: only epsgtools.js and transform.js hold datum shifts or choose transformations", () => {
  // Datum shift parameters or a pinned transformation: towgs84 strings, Helmert parameter literals, EPSG operation picks.
  const SHIFT = /towgs84|datum_params\s*[:=]\s*\[|\btx\s*:\s*-?\d+(\.\d+)?\s*,\s*ty\s*:|446\.448|-125\.157|482\.53?\b/;
  const hits = pageCode.filter((f) => !["js/epsgtools.js", "js/transform.js"].includes(f) && SHIFT.test(read(f)));
  assert.deepEqual(unexpected(hits, KNOWN.geodesy), [], "datum shifts outside the registry path; ask Rob before adding one");
  // Known breaches that have been fixed should leave the list, so it stays honest.
  for (const f of Object.keys(KNOWN.geodesy)) assert.ok(hits.includes(f), `${f} no longer breaks I1: remove it from KNOWN`);
});

await test("I3 the model never does geometry: no tool takes coordinate lists (one exception, the person's own typed points), and the summaries carry none", async () => {
  const defs = placeToolDefs([]);
  const takesGeometry = (schema, path = "") => Object.entries(schema?.properties || {}).flatMap(([k, v]) => {
    const p = `${path}${k}`;
    if (v.type === "array" && v.items?.type === "array") return [p];
    if (/^(geometry|coordinates|geojson|polygon|ring)s?$/i.test(k)) return [p];
    return v.type === "object" ? takesGeometry(v, `${p}.`) : [];
  });
  const found = defs.flatMap((d) => takesGeometry(d.input_schema).map((p) => `${d.name}.${p}`));
  // transform.points: latitude and longitude the person typed, copied exactly; the maths is done in code.
  assert.deepEqual(found, ["transform.points"]);
  // And what the analyst sees each turn: the project summary and a dropped file's summary carry no coordinate pairs.
  const PAIR = /\[\s*-?\d+\.\d+\s*,\s*-?\d+\.\d+\s*\]/;
  const fix = (n) => ({ name: n, bytes: new Uint8Array(readFileSync(join(ROOT, "test/fixtures/import", n))) });
  const file = await readFiles([fix("areas.shp"), fix("areas.dbf")]);
  const ref = R.createReference(async (n) => JSON.parse(read(`data/ref/${n}.json`)));
  const place = { name: "Area A", status: "accepted", feature: { type: "Feature", properties: {}, geometry: file.features[0].geometry }, origin: { method: "drawn" }, edits: [] };
  const summary = await projectSummary(ref, [place], "Area A", null, [], file);
  assert.ok(!PAIR.test(summary), "coordinates in the project summary");
  assert.ok(!PAIR.test(JSON.stringify(fileSummary(file))), "coordinates in the file summary");
});

await test("I6 no CDN at run time: pages load only vendored files", () => {
  const CDN = /https?:\/\/(unpkg\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|cdn\.skypack\.dev|fonts\.googleapis\.com|ga\.jspm\.io)/;
  const hits = files.filter((f) => /\.(html|js|css|mjs)$/.test(f) && !/^(scripts|test)\//.test(f) && CDN.test(read(f)));
  assert.deepEqual(unexpected(hits, KNOWN.cdn), [], "a page loads from a CDN");
});

await test("I7 the person's files stay in the browser: the file readers make no network calls", () => {
  for (const f of ["js/fileimport.js", "js/filedrop.js"]) {
    const src = read(f).replace(/\/\/.*$/gm, "");
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|import\(\s*["']https?:/.test(src), `${f} reaches the network`);
  }
});

await test("I8 one model setting: the model id lives only in js/config.js (and the Worker's env)", () => {
  const hits = pageCode.filter((f) => f !== "js/config.js" && /["'`]claude-(haiku|sonnet|opus|fable|mythos)-[\d-]+["'`]/.test(read(f)));
  assert.deepEqual(hits, []);
});

console.log(`${passed} invariant tests passed`);
