// Tobler's own copy of OpenStreetMap (js/osmsnapshot.js, catalogue/osm-snapshot.json): the copy keeps the same tags
// the Overpass query asks for; a lookup reads only the parts of the files near the site; outside the copy, or when it
// can't be read, the checks go to Overpass; and the answer says which source gave it and how old it is.
// Fixtures in test/fixtures/osm-copy were made by scripts/osm-extract/build.py and publish.py from a small test file.
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync, statSync } from "node:fs";
import * as turf from "../js/vendor/turf.js";
import { OSM_KINDS, osmAnswers } from "../js/osmchecks.js";
import { osmSnapshot, covers, forgetManifests } from "../js/osmsnapshot.js";

console.debug = () => {}; // the FlatGeobuf reader logs every range request
let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const spec = JSON.parse(readFileSync(new URL("../catalogue/osm-snapshot.json", import.meta.url)));

// A static server that answers range requests, as R2 does; it counts requests and bytes.
const root = new URL("./fixtures/osm-copy/", import.meta.url);
const served = { requests: 0, bytes: 0, refuse: false };
const server = http.createServer((req, res) => {
  served.requests++;
  if (served.refuse) { res.writeHead(503); return res.end(); }
  const path = new URL(req.url.replace(/^\//, ""), root);
  let size;
  try { size = statSync(path).size; } catch { res.writeHead(404); return res.end(); }
  const buf = readFileSync(path);
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
  if (m) {
    const a = +m[1], b = Math.min(size - 1, m[2] ? +m[2] : size - 1);
    served.bytes += b - a + 1;
    res.writeHead(206, { "Content-Range": `bytes ${a}-${b}/${size}`, "Content-Length": b - a + 1, "Accept-Ranges": "bytes" });
    return res.end(buf.subarray(a, b + 1));
  }
  served.bytes += size;
  res.writeHead(200, { "Content-Length": size, "Content-Type": path.pathname.endsWith(".json") ? "application/json" : "application/octet-stream" });
  res.end(buf);
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;

// A site 30-odd metres east of the test railway (lon -3.10), with the building and the school close by.
const site = turf.bboxPolygon([-3.0995, 53.302, -3.096, 53.305]);
const overpassNever = async () => { throw new Error("Overpass should not have been asked"); };

// The selectors in js/osmchecks.js, read back into tag sets, to compare with the copy's spec.
function parseSel(sel) {
  const type = sel.match(/^(\w+)/)[1];
  const alt = {};
  for (const [, k, op, v] of sel.matchAll(/\["([^"]+)"(?:(=|~)"([^"]+)")?\]/g)) {
    alt[k] = !op ? true : op === "=" ? v : v.replace(/^\^\(|\)\$$/g, "").split("|");
  }
  return { type, alt };
}
const norm = (alt) => JSON.stringify(Object.keys(alt).sort().map((k) => [k, Array.isArray(alt[k]) ? [...alt[k]].sort() : alt[k]]));

await test("the copy keeps every kind the checks ask Overpass for, with the same tags", () => {
  assert.deepEqual(Object.keys(spec.kinds).sort(), Object.keys(OSM_KINDS).sort());
  for (const [name, k] of Object.entries(OSM_KINDS)) {
    const s = spec.kinds[name];
    const parsed = k.sel.map(parseSel);
    assert.deepEqual(parsed.map((p) => norm(p.alt)).sort(), s.match.map(norm).sort(), `${name}: tags differ`);
    for (const p of parsed) {
      const need = p.type === "node" ? "n" : p.type === "way" ? (k.line ? "w" : "wa") : "nwa";
      for (const t of need) if (!(t === "a" && p.type === "way")) assert.ok(s.types.includes(t), `${name}: the copy leaves out ${t}`);
      if (p.type === "way" && !k.line) assert.ok(/[wa]/.test(s.types), `${name}: ways`);
    }
    assert.equal(!!s.line, !!k.line, `${name}: line or area`);
    assert.ok(spec.groups.includes(s.group), `${name}: group ${s.group}`);
    // Each tag set, written out, is matched by the check's own rule too, and every tag it reads is kept.
    for (const alt of s.match) {
      const tags = Object.fromEntries(Object.entries(alt).map(([key, v]) => [key, v === true ? "yes" : Array.isArray(v) ? v[0] : v]));
      assert.ok(k.match(tags), `${name}: ${JSON.stringify(tags)}`);
      for (const key of Object.keys(alt)) assert.ok(spec.keep_tags.includes(key), `${name}: ${key} not kept`);
    }
  }
});

await test("the outline test uses the real outline: a box over its edge isn't covered", () => {
  const outline = turf.bboxPolygon([0, 0, 1, 1]).geometry;
  assert.equal(covers(outline, [0.2, 0.2, 0.4, 0.4]), true);
  assert.equal(covers(outline, [0.9, 0.2, 1.1, 0.4]), false);
  const ell = turf.polygon([[[0, 0], [1, 0], [1, 0.5], [0.5, 0.5], [0.5, 1], [0, 1], [0, 0]]]).geometry;
  assert.equal(covers(ell, [0.6, 0.6, 0.8, 0.8]), false, "inside the outline's box but not the outline");
  assert.equal(covers(null, [0, 0, 1, 1]), false);
});

await test("inside the copy: answers come from it, measured as before, with the railway once and the lake whole", async () => {
  forgetManifests(); served.requests = 0; served.bytes = 0;
  const wants = new Map([["railway", 0.5], ["building", 0.5], ["school", 1], ["water body", 3], ["aerodrome", 5], ["wind turbine", 1]]);
  const got = await osmAnswers({ wants, site, snapshot: osmSnapshot({ base, markets: ["uk"] }), query: overpassNever, now: () => "2026-11-25T08:00:00Z" });
  const rail = got.get("railway");
  assert.deepEqual(rail.features.map((f) => f.name), ["Borderlands Line"], "once, though both extracts hold it");
  assert.ok(!rail.features[0].parts, "no duplicate pieces");
  assert.ok(rail.features[0].distance_km > 0.02 && rail.features[0].distance_km < 0.05, `${rail.features[0].distance_km}`);
  assert.equal(rail.meta.via, "copy");
  assert.equal(rail.meta.data_as_of, "2026-11-24T20:21:02Z");
  assert.equal(rail.meta.release, "2026-11-25");
  assert.match(rail.meta.dataset, /^OpenStreetMap: railways \(completeness varies; Tobler's copy, data as of 2026-11-24\)$/);
  assert.match(rail.meta.licence, /ODbL/);
  assert.equal(got.get("building").features.length, 1, "the building 400 m east");
  assert.equal(got.get("building").features[0].geometry.type, "Polygon");
  const lake = got.get("water body").features[0];
  assert.equal(lake.name, "Big Lake");
  assert.equal(lake.geometry.type, "Polygon", "a multipolygon relation as its area, not a centre point");
  assert.deepEqual(got.get("school").features.map((f) => f.name), ["Barnston Primary"]);
  assert.equal(got.get("wind turbine").features.length, 1, "the wind generator, not the solar one");
  assert.equal(got.get("aerodrome").features.length, 0, "none found, from the copy");
  assert.ok(served.requests < 40, `${served.requests} requests`);
});

await test("outside the copy's outline: straight to Overpass", async () => {
  forgetManifests();
  let asked = 0;
  const far = turf.bboxPolygon([-1.0, 52.0, -0.99, 52.01]);
  const got = await osmAnswers({ wants: new Map([["railway", 1]]), site: far, snapshot: osmSnapshot({ base, markets: ["uk"] }),
    query: async () => { asked++; return { elements: [] }; } });
  assert.equal(asked, 1);
  assert.equal(got.get("railway").meta.via, "overpass");
  assert.match(got.get("railway").meta.dataset, /^OpenStreetMap: railways \(completeness varies\)$/);
});

await test("a box over the outline's edge goes to Overpass too (the copy doesn't hold all of it)", async () => {
  forgetManifests();
  let asked = 0;
  const edge = turf.bboxPolygon([-3.205, 53.30, -3.19, 53.31]);
  await osmAnswers({ wants: new Map([["railway", 0.1]]), site: edge, snapshot: osmSnapshot({ base, markets: ["uk"] }),
    query: async () => { asked++; return { elements: [] }; } });
  assert.equal(asked, 1);
});

await test("the copy can't be read: Overpass answers, and the record says the copy failed", async () => {
  forgetManifests(); served.refuse = true;
  try {
    let asked = 0;
    const got = await osmAnswers({ wants: new Map([["railway", 1]]), site, snapshot: osmSnapshot({ base, markets: ["uk"] }),
      query: async () => { asked++; return { elements: [] }; } });
    assert.equal(asked, 1);
    assert.equal(got.get("railway").meta.via, "overpass");
    assert.match(got.get("railway").meta.copy_failed, /couldn't be read \(503\)/);
  } finally { served.refuse = false; }
});

await test("both fail: not checked, saying why for each", async () => {
  forgetManifests(); served.refuse = true;
  try {
    const got = await osmAnswers({ wants: new Map([["railway", 1]]), site, snapshot: osmSnapshot({ base, markets: ["uk"] }),
      query: async () => { throw new Error("OpenStreetMap's Overpass service isn't answering right now"); } });
    assert.match(got.get("railway").not_checked, /copy of OpenStreetMap couldn't be read.*then OpenStreetMap's Overpass service isn't answering/);
  } finally { served.refuse = false; }
});

await test("switched off (no base URL): no request, straight to Overpass", async () => {
  served.requests = 0;
  const s = osmSnapshot({ base: "", markets: ["uk"] });
  assert.equal(await s(["railway"], () => [0, 0, 1, 1]), null);
  assert.equal(served.requests, 0);
});

await test("a kind the copy doesn't hold: the whole query goes to Overpass", async () => {
  forgetManifests();
  const s = osmSnapshot({ base, markets: ["uk"] });
  assert.equal(await s(["railway", "ferry terminal"], () => turf.bbox(site)), null);
});

server.close();
console.log(`${passed} osmsnapshot tests passed`);
