// A site from a map or feature service (26 Nov; claude/site-from-service-spec.md): reading the address, signing in
// without Tobler's Worker, Esri geometry, the datum through the file pipeline, and what the record and the model see.
import assert from "node:assert/strict";
import * as turf from "../js/vendor/turf.js";
import * as SV from "../js/servicesite.js";
import { readFiles, placesFromFile } from "../js/fileimport.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };

await test("addresses: MapServer or FeatureServer, service or layer; a token is taken out; other text isn't one", () => {
  const a = SV.findServiceUrl("my site is in https://gis.example.gov.uk/arcgis/rest/services/Planning/Parcels/MapServer/3?f=pjson please");
  assert.deepEqual([a.base, a.url, a.kind, a.layerId, a.host, a.token], ["https://gis.example.gov.uk/arcgis/rest/services/Planning/Parcels/MapServer", "https://gis.example.gov.uk/arcgis/rest/services/Planning/Parcels/MapServer/3", "MapServer", 3, "gis.example.gov.uk", null]);
  const b = SV.findServiceUrl("https://services1.arcgis.com/AbC/arcgis/rest/services/Assets/FeatureServer?token=SECRET123");
  assert.equal(b.kind, "FeatureServer");
  assert.equal(b.layerId, null);
  assert.equal(b.token, "SECRET123");
  assert.ok(!b.url.includes("SECRET"), "the token isn't part of the address kept");
  assert.equal(SV.findServiceUrl("Screen Area 1 for a solar farm"), null);
  assert.equal(SV.findServiceUrl("https://www.arcgis.com/home/item.html?id=abc"), null);
  assert.equal(SV.redactService("use https://gis.example.gov.uk/arcgis/rest/services/A/MapServer/0 for it"), "use [a service address] for it");
});

await test("signing in: plain first; a sign-in error tries the browser's own login; a token goes only with the token; nothing through the Worker", async () => {
  const asked = [];
  const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  // A company portal: no answer without the login, an answer with it.
  const portal = async (url, init) => { asked.push([url, init.credentials]); return init.credentials === "include" ? reply({ name: "Assets", layers: [] }) : reply({ error: { code: 499, message: "Token Required" } }); };
  const state = {};
  const got = await SV.serviceJson("https://gis.corp.example/arcgis/rest/services/Assets/MapServer", {}, state, { fetchFn: portal });
  assert.equal(got.name, "Assets");
  assert.deepEqual(asked.map((x) => x[1]), ["omit", "include"]);
  assert.ok(state.credentialed && state.secured);
  assert.ok(asked.every(([u]) => u.startsWith("https://gis.corp.example/")), "straight to the service");
  // A token: sent with the token only, never without.
  asked.length = 0;
  const online = async (url, init) => { asked.push([url, init.credentials]); return /token=T0K/.test(url) ? reply({ name: "Blocks" }) : reply({ error: { code: 499 } }); };
  const s2 = { token: "T0K" };
  await SV.serviceJson("https://services.arcgis.com/x/arcgis/rest/services/B/FeatureServer/0", {}, s2, { fetchFn: online });
  assert.equal(asked.length, 1);
  assert.ok(s2.secured);
  // Blocked by the browser (no CORS): said plainly, with the admin setting.
  const blocked = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(SV.serviceJson("https://x.example/arcgis/rest/services/A/MapServer", {}, {}, { fetchFn: blocked }), (e) => e.blocked && /allowed origin/.test(e.message));
  const refused = async () => reply({ error: { code: 498, message: "Invalid token" } });
  await assert.rejects(SV.serviceJson("https://x.example/arcgis/rest/services/A/MapServer", {}, { token: "old" }, { fetchFn: refused }), (e) => e.needsSignIn && /refused/.test(e.message));
});

await test("Esri geometry: clockwise rings are outer, anticlockwise holes; lines and points", () => {
  const outer = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]; // clockwise (y up)
  const hole = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]; // anticlockwise
  const other = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]];
  const g = SV.esriToGeoJSON({ rings: [outer, hole, other] });
  assert.equal(g.type, "MultiPolygon");
  assert.equal(g.coordinates[0].length, 2, "the hole stays with its outer ring");
  const signed = (r) => r.reduce((a, [x1, y1], i) => { const [x2, y2] = r[(i + 1) % r.length]; return a + (x1 * y2 - x2 * y1); }, 0);
  assert.ok(signed(g.coordinates[0][0]) > 0 && signed(g.coordinates[0][1]) < 0, "GeoJSON: outer rings anticlockwise, holes clockwise");
  assert.deepEqual(SV.esriToGeoJSON({ x: 1, y: 2 }), { type: "Point", coordinates: [1, 2] });
  assert.equal(SV.esriToGeoJSON({ paths: [[[0, 0], [1, 1]]] }).type, "LineString");
  assert.equal(SV.wkidOf({ extent: { spatialReference: { wkid: 102100, latestWkid: 3857 } } }), 3857);
  assert.equal(SV.wkidOf({ sourceSpatialReference: { wkid: 27700 } }), 27700);
});

await test("the datum: British National Grid from the service goes through the file pipeline; the record says where it came from, and a secured service's address doesn't reach the model", async () => {
  // A 100 m square parcel near Linlithgow in British National Grid, as the service holds it.
  const [e, n] = [300000, 677000];
  const esri = { rings: [[[e, n], [e, n + 100], [e + 100, n + 100], [e + 100, n], [e, n]]] };
  const file = await readFiles([SV.asFile({ name: "Parcels" }, [{ attributes: { PARCEL_NAME: "Field 7", OBJECTID: 41 }, geojson: SV.esriToGeoJSON(esri) }], 27700, "Parcels")]);
  assert.equal(file.features.length, 1);
  assert.equal(file.layers[0].crs.epsg, 27700);
  assert.match(file.layers[0].crs.how, /British National Grid/);
  const [b] = placesFromFile(file, { fids: "all" });
  const area = turf.area(b.feature);
  assert.ok(Math.abs(area - 10000) < 150, `about a hectare (${Math.round(area)} m²)`);
  const [lon, lat] = turf.centroid(b.feature).geometry.coordinates;
  assert.ok(lon > -3.7 && lon < -3.5 && lat > 55.9 && lat < 56.1, `near Linlithgow (${lon}, ${lat})`);
  const meta = { url: "https://gis.corp.example/arcgis/rest/services/Assets/MapServer/2", host: "gis.corp.example", kind: "MapServer", layer: "Parcels", layerId: 2, ids: [41], at: "2026-11-26T03:00:00Z", wkid: 27700, secured: true };
  const o = SV.serviceOrigin(b.origin, meta);
  assert.equal(o.method, "service");
  assert.deepEqual([o.service.url, o.service.layer, o.service.feature_ids, o.service.native_wkid, o.service.secured], [meta.url, "Parcels", [41], 27700, true]);
  assert.equal(o.service.licence, "your own or your organisation's data");
  assert.ok(o.crs?.how, "the conversion travels");
  const line = SV.serviceOriginText(o);
  assert.match(line, /your organisation's secured service, layer Parcels/);
  assert.ok(!line.includes("gis.corp.example") && !line.includes("http"), "no address or host for a secured service");
  const pub = SV.serviceOriginText(SV.serviceOrigin(b.origin, { ...meta, secured: false, licence: undefined }));
  assert.match(pub, /the layer Parcels on gis\.corp\.example/);
  assert.equal(SV.serviceOrigin(b.origin, { ...meta, secured: false }).service.licence, "unknown", "licence unknown stays unknown");
});

await test("points and lines need a buffer from 10, 30, 50 or 100 m; the original and the distance are kept", async () => {
  const file = await readFiles([SV.asFile({ name: "Wells" }, [{ attributes: { WELL: "W-3" }, geojson: SV.esriToGeoJSON({ x: -3.6, y: 55.98 }) }], 4326, "Wells")]);
  assert.throws(() => placesFromFile(file, { fids: "all" }), /need a width/);
  const [b] = placesFromFile(file, { fids: "all", buffer_m: SV.BUFFERS_M[1] });
  const o = SV.serviceOrigin(b.origin, { url: "u", host: "h", layer: "Wells", ids: [1], at: "t", wkid: 4326, secured: false });
  assert.equal(o.buffer_m, 30);
  assert.match(SV.serviceOriginText(o), /30 m round it/);
  assert.deepEqual(SV.BUFFERS_M, [10, 30, 50, 100]);
});

console.log(`${passed} service site tests passed`);
