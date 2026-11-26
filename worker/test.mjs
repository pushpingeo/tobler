// Local tests for tobler-api: runs worker.js in workerd (Miniflare, what `wrangler dev` uses) with real
// Durable Object counters and fake upstreams for Claude and the atlas. No network, no cost.
//   cd worker && npm install && npm test
import { Miniflare } from "miniflare";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const upstreamCalls = { claude: [], atlas: [] };
const mf = new Miniflare({
  scriptPath: new URL("./worker.js", import.meta.url).pathname,
  modules: true,
  compatibilityDate: "2026-08-01",
  durableObjects: { COUNTER: "Counter", LOGS: { className: "LogStore", useSQLite: true } },
  bindings: {
    MODEL: "claude-haiku-5-5", MAX_TOKENS: "16000",
    ALLOWED_ORIGINS: "https://asktobler.com,https://pushpingeo.github.io,http://localhost:8000",
    // Small limits so they can be reached in a test.
    PER_VISITOR_DAILY: "5", TOTAL_DAILY: "8", ATLAS_PER_VISITOR_DAILY: "25",
    ANTHROPIC_API_KEY: "sk-test", ATLAS_MCP_KEY: "atlas-test", FIRMS_MAP_KEY: "firmskey123", FIRMS_PER_VISITOR_DAILY: "3", EPSG_PER_VISITOR_DAILY: "6", ARCGIS_PER_VISITOR_DAILY: "6",
    LOGS_ENABLED: "yes", LOGS_PER_VISITOR_DAILY: "4", LOG_RETENTION_DAYS: "90",
  },
  // Fake atlas, behind the service binding.
  serviceBindings: {
    ATLAS: async (req) => {
      const body = await req.json();
      upstreamCalls.atlas.push({ url: req.url, auth: req.headers.get("authorization"), body });
      await new Promise((ok) => setTimeout(ok, 20));
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { echo: body.params.name } } }), { headers: { "content-type": "application/json" } });
    },
  },
  // Fake Anthropic: every outbound fetch lands here.
  outboundService: async (req) => {
    if (req.url.includes("apps.epsg.org")) {
      upstreamCalls.epsg = [...(upstreamCalls.epsg || []), req.url];
      if (req.url.includes("/Transformation/999999/")) return new Response("", { status: 404 });
      if (req.url.includes("/export/")) return new Response('GEOGCRS["OSGB36"]', { status: 200 });
      return new Response(JSON.stringify({ Code: 1314, Accuracy: 2 }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (req.url.includes("/rest/services/")) {
      upstreamCalls.arcgis = [...(upstreamCalls.arcgis || []), { url: req.url, cookie: req.headers.get("cookie"), auth: req.headers.get("authorization") }];
      if (req.url.includes("/Redirect/")) return new Response("", { status: 302, headers: { location: "https://login.example.com/" } });
      if (req.url.includes("/export")) return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
      if (req.url.includes("/Html/")) return new Response("<html>", { headers: { "content-type": "text/html" } });
      return new Response(JSON.stringify({ layers: [{ id: 0, name: "Parcels" }] }), { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (req.url.includes("firms")) {
      upstreamCalls.firms = [...(upstreamCalls.firms || []), req.url];
      if (req.url.includes("/MODIS_NRT/")) return new Response("Invalid MAP_KEY firmskey123.", { status: 400 });
      if (req.url.includes("/VIIRS_NOAA21_NRT/")) return new Response("latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n", { status: 200 });
      return new Response("latitude,longitude,bright_ti4,acq_date,acq_time,satellite,confidence,frp,daynight\n28.17,-89.20,330.5,2026-11-16,0712,N20,n,4.2,N\n28.30,-89.10,301.2,2026-11-15,1904,N20,l,1.1,D\n", { status: 200 });
    }
    const body = await req.json();
    upstreamCalls.claude.push({ url: req.url, key: req.headers.get("x-api-key"), body });
    return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }], model: body.model }), { headers: { "content-type": "application/json" } });
  },
});

const ORIGIN = "https://asktobler.com";
const post = (path, body, { origin = ORIGIN, ip = "1.1.1.1" } = {}) =>
  mf.dispatchFetch(`https://tobler-api.example${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const msg = (extra = {}) => ({ model: "claude-opus-anything", max_tokens: 50000, system: "s", messages: [{ role: "user", content: "hi" }], ...extra });
const atlas = (name = "find_datasets") => ({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: { q: "x" } } });

let passed = 0;
async function t(name, fn) {
  await fn();
  passed++;
  console.log(`ok  ${name}`);
}

try {
  await t("health", async () => {
    const r = await mf.dispatchFetch("https://tobler-api.example/health");
    assert.equal(r.status, 200);
    assert.equal((await r.json()).service, "tobler-api");
  });

  await t("CORS preflight echoes an allowed origin", async () => {
    const r = await mf.dispatchFetch("https://tobler-api.example/v1/messages", { method: "OPTIONS", headers: { Origin: "https://pushpingeo.github.io" } });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("access-control-allow-origin"), "https://pushpingeo.github.io");
  });

  await t("other origins and no origin are refused", async () => {
    assert.equal((await post("/v1/messages", msg(), { origin: "https://evil.example" })).status, 403);
    assert.equal((await post("/v1/messages", msg(), { origin: null })).status, 403);
    assert.equal((await post("/atlas", atlas(), { origin: "https://evil.example" })).status, 403);
    assert.equal(upstreamCalls.claude.length + upstreamCalls.atlas.length, 0);
  });

  await t("unknown paths 404; bad JSON 400; oversize 413", async () => {
    assert.equal((await post("/other", {})).status, 404);
    assert.equal((await post("/v1/messages", "{nope")).status, 400);
    assert.equal((await post("/v1/messages", "x".repeat(120_001))).status, 413);
  });

  await t("Claude: model pinned, max_tokens capped, key added, CORS on reply", async () => {
    const r = await post("/v1/messages", msg({ tools: [{ name: "t" }], temperature: 2 }), { ip: "2.2.2.2" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    const sent = upstreamCalls.claude.at(-1);
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent.key, "sk-test");
    assert.equal(sent.body.model, "claude-haiku-5-5");
    assert.equal(sent.body.max_tokens, 16000);
    assert.equal(sent.body.temperature, undefined);
    assert.deepEqual(sent.body.tools, [{ name: "t" }]);
  });

  await t("Claude: per-visitor limit (5) is exact, even with calls at once", async () => {
    // 2.2.2.2 has used 1. Fire 10 at once: exactly 4 more get through.
    const rs = await Promise.all(Array.from({ length: 10 }, () => post("/v1/messages", msg(), { ip: "2.2.2.2" })));
    const codes = rs.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 200).length, 4, codes.join(","));
    assert.equal(codes.filter((c) => c === 429).length, 6);
    const j = await rs.find((r) => r.status === 429).json();
    assert.match(j.message, /today's limit/);
  });

  await t("Claude: daily total (8) across visitors", async () => {
    // 5 used so far in total. Another visitor gets 3, then the total stops everyone.
    const codes = [];
    for (let i = 0; i < 5; i++) codes.push((await post("/v1/messages", msg(), { ip: "3.3.3.3" })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const r = await post("/v1/messages", msg(), { ip: "4.4.4.4" });
    assert.equal(r.status, 429);
    assert.match((await r.json()).message, /daily limit/);
    assert.equal(upstreamCalls.claude.length, 8);
  });

  await t("Atlas: only read tools; key added; sent over the binding", async () => {
    assert.equal((await post("/atlas", atlas("reload_everything"))).status, 403);
    assert.equal((await post("/atlas", { method: "tools/list" })).status, 403);
    const r = await post("/atlas", atlas("vocabulary"), { ip: "5.5.5.5" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await r.json()).result.structuredContent.echo, "vocabulary");
    const sent = upstreamCalls.atlas.at(-1);
    assert.equal(sent.url, "https://atlas-mcp/mcp");
    assert.equal(sent.auth, "Bearer atlas-test");
    assert.equal(sent.body.id, 7);
  });

  await t("Atlas: per-visitor limit (25) is exact with 40 calls at once (the KV bug)", async () => {
    const rs = await Promise.all(Array.from({ length: 40 }, () => post("/atlas", atlas(), { ip: "6.6.6.6" })));
    const codes = rs.map((r) => r.status);
    assert.equal(codes.filter((c) => c === 200).length, 25);
    assert.equal(codes.filter((c) => c === 429).length, 15);
  });

  await t("Atlas and Claude allowances are separate", async () => {
    // 6.6.6.6 has used its atlas allowance but no Claude calls; the Claude total is used up though,
    // so check the reverse: 2.2.2.2 used its Claude allowance and can still use the atlas.
    assert.equal((await post("/atlas", atlas(), { ip: "2.2.2.2" })).status, 200);
  });

  await t("FIRMS: key added, CSV becomes GeoJSON, empty is empty, NASA's errors don't leak the key", async () => {
    const r = await post("/firms", { source: "VIIRS_NOAA20_NRT", bbox: [-90, 27.5, -88.5, 29], days: 5 }, { ip: "7.7.7.7" });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.features.length, 2);
    assert.deepEqual(j.features[0].geometry.coordinates, [-89.2, 28.17]);
    assert.equal(j.features[0].properties.acquired_utc, "2026-11-16 07:12 UTC");
    assert.equal(j.features[0].properties.frp, 4.2);
    assert.equal(j.features[0].properties.confidence, "n");
    assert.match(upstreamCalls.firms.at(-1), /\/api\/area\/csv\/firmskey123\/VIIRS_NOAA20_NRT\/-90,27.5,-88.5,29\/5$/);
    const empty = await (await post("/firms", { source: "VIIRS_NOAA21_NRT", bbox: [0, 0, 1, 1], days: 1 }, { ip: "7.7.7.7" })).json();
    assert.equal(empty.features.length, 0);
    const bad = await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], days: 1 }, { ip: "7.7.7.7" });
    assert.equal(bad.status, 502);
    assert.doesNotMatch(JSON.stringify(await bad.json()), /firmskey123/);
  });

  await t("FIRMS: checks inputs, and its own daily limit (3)", async () => {
    assert.equal((await post("/firms", { source: "EVIL", bbox: [0, 0, 1, 1] }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 30, 30] }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], days: 6 }, { ip: "8.8.8.8" })).status, 400);
    assert.equal((await post("/firms", { source: "MODIS_NRT", bbox: [0, 0, 1, 1], date: "17/11/2026" }, { ip: "8.8.8.8" })).status, 400);
    // 7.7.7.7 has used 3 (two OK, one NASA error): the next is refused.
    assert.equal((await post("/firms", { source: "VIIRS_NOAA20_NRT", bbox: [0, 0, 1, 1] }, { ip: "7.7.7.7" })).status, 429);
  });

  const readKey = createHash("sha256").update("tobler-logs:atlas-test").digest("hex");
  const today = new Date().toISOString().slice(0, 10);
  const getLogs = (q, key = readKey) => mf.dispatchFetch(`https://tobler-api.example/logs?${q}`, { headers: key ? { authorization: `Bearer ${key}` } : {} });
  const turn = (seq, extra = {}) => ({ session: "abc12345-0001", seq, page: "/", log: { user: `turn ${seq}`, events: [] }, ...extra });

  await t("ArcGIS: public map and feature services only, no token, no cookies passed on, images and JSON, own limit (6)", async () => {
    const get = (target, { origin = ORIGIN, ip = "7.7.7.1", cookie = null } = {}) => mf.dispatchFetch(`https://tobler-api.example/arcgis?url=${encodeURIComponent(target)}`, {
      headers: { ...(origin ? { Origin: origin } : {}), "CF-Connecting-IP": ip, ...(cookie ? { cookie } : {}) } });
    const base = "https://gis.example-council.gov.uk/arcgis/rest/services/Planning/Parcels/MapServer";
    const ok = await get(`${base}?f=json`, { cookie: "sso=yes" });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await ok.json()).layers[0].name, "Parcels");
    assert.equal(upstreamCalls.arcgis.at(-1).cookie, null, "the visitor's cookies aren't passed on");
    const img = await get(`${base}/export?bbox=0,0,1,1&bboxSR=3857&imageSR=3857&size=512,512&format=png32&transparent=true&f=image&layers=show:0`);
    assert.equal(img.headers.get("content-type"), "image/png");
    assert.equal((await img.arrayBuffer()).byteLength, 4);
    assert.equal((await get(`${base}/0/query?f=json&token=abc`)).status, 400, "a token is refused");
    assert.equal((await get(`${base}/0/applyEdits?f=json`)).status, 400, "only service, layer, query and export");
    assert.equal((await get(`${base}/0/query?f=json&callback=x`)).status, 400, "unknown parameters refused");
    assert.equal((await get("https://10.0.0.5/arcgis/rest/services/A/MapServer?f=json")).status, 400, "no IP addresses");
    assert.equal((await get("https://gis.corp/arcgis/rest/services/A/MapServer?f=json")).status, 400, "no local names");
    assert.equal((await get("http://gis.example.com/arcgis/rest/services/A/MapServer?f=json")).status, 400, "https only");
    assert.equal((await get(`${base}?f=json`, { origin: "https://evil.example" })).status, 403);
    assert.equal((await get("https://gis.example.com/arcgis/rest/services/Redirect/MapServer?f=json")).status, 502, "a redirect (a sign-in page) isn't followed");
    assert.equal((await get("https://gis.example.com/arcgis/rest/services/Html/MapServer?f=json")).status, 502, "only map data passed on");
    const statuses = [];
    for (let i = 0; i < 8; i++) statuses.push((await get(`${base}?f=json`, { ip: "7.7.7.9" })).status);
    assert.deepEqual(statuses, [200, 200, 200, 200, 200, 200, 429, 429]);
  });

  await t("EPSG: allowed paths only, query sorted, 404 passed on, own limit (6)", async () => {
    const ok = await post("/epsg", { path: "Transformation/crs", query: { targetCRSCode: 4326, sourceCRSCode: 4277 } }, { ip: "9.9.9.1" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { Code: 1314, Accuracy: 2 });
    assert.match(ok.headers.get("x-epsg-source"), /IOGP/);
    assert.equal(upstreamCalls.epsg.at(-1), "https://apps.epsg.org/api/v1/Transformation/crs/?sourceCRSCode=4277&targetCRSCode=4326");
    const wkt = await post("/epsg", { path: "/CoordRefSystem/4277/export", query: { format: "wkt", formatVersion: 2 } }, { ip: "9.9.9.1" });
    assert.equal(await wkt.text(), 'GEOGCRS["OSGB36"]');
    assert.equal((await post("/epsg", { path: "Transformation/999999" }, { ip: "9.9.9.1" })).status, 404);
    assert.equal((await post("/epsg", { path: "Account/login" }, { ip: "9.9.9.1" })).status, 400);
    assert.equal((await post("/epsg", { path: "../admin" }, { ip: "9.9.9.1" })).status, 400);
    assert.equal((await post("/epsg", { path: "Extent/2397", query: { evil: 1 } }, { ip: "9.9.9.1" })).status, 400);
    const before = upstreamCalls.epsg.length;
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post("/epsg", { path: "Extent/2397/polygon" }, { ip: "9.9.9.1" })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]); // 3 earlier allowed calls + 3 = 6
    assert.ok(upstreamCalls.epsg.length >= before + 1);
    assert.equal((await post("/epsg", { path: "Extent/2397" }, { ip: "9.9.9.1", origin: "https://evil.example" })).status, 403);
  });

  await t("EPSG: datum, ellipsoid, unit and version records for the transform tool", async () => {
    for (const path of ["Datum/6277", "DatumEnsemble/6326", "Ellipsoid/7001", "PrimeMeridian/8901", "Unit/9104"])
      assert.equal((await post("/epsg", { path }, { ip: "9.9.9.2" })).status, 200, path);
    assert.equal((await post("/epsg", { path: "VersionHistory", query: { pageSize: 1 } }, { ip: "9.9.9.3" })).status, 200);
    assert.equal((await post("/epsg", { path: "Ellipsoid/7001/alias" }, { ip: "9.9.9.3" })).status, 400);
    assert.equal((await post("/epsg", { path: "VersionHistory/446/export" }, { ip: "9.9.9.3" })).status, 400);
  });

  await t("Logs: stored from Tobler's pages only, with checks on the shape", async () => {
    assert.equal((await post("/logs", turn(0), { origin: "https://evil.example" })).status, 403);
    assert.equal((await post("/logs", turn(0, { session: "x" }))).status, 400);
    assert.equal((await post("/logs", turn(-1))).status, 400);
    assert.equal((await post("/logs", turn(0, { log: null }))).status, 400);
    const r = await post("/logs", turn(0), { ip: "9.9.9.9" });
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal((await r.json()).ok, true);
  });

  await t("Logs: read back only with the read key, oldest first, paged; no IP stored", async () => {
    assert.equal((await getLogs(`day=${today}`, null)).status, 401);
    assert.equal((await getLogs(`day=${today}`, "atlas-test")).status, 401);
    assert.equal((await getLogs("day=yesterday")).status, 400);
    await post("/logs", turn(1), { ip: "9.9.9.9" });
    await post("/logs", turn(2), { ip: "9.9.9.9" });
    const j = await (await getLogs(`day=${today}`)).json();
    assert.deepEqual(j.entries.map((e) => e.seq), [0, 1, 2]);
    assert.equal(j.entries[0].log.user, "turn 0");
    assert.equal(j.entries[0].session, "abc12345-0001");
    assert.match(j.entries[0].visitor, /^[0-9a-f]{24}$/);
    assert.doesNotMatch(JSON.stringify(j), /9\.9\.9\.9/);
    const page = await (await getLogs(`day=${today}&after=${j.entries[0].id}&limit=1`)).json();
    assert.deepEqual(page.entries.map((e) => e.seq), [1]);
    assert.equal(page.more, true);
    assert.equal((await (await getLogs("day=2020-01-01")).json()).entries.length, 0);
  });

  await t("Logs: own daily limit (4), separate from Claude's", async () => {
    // 9.9.9.9 has sent 3.
    assert.equal((await post("/logs", turn(3), { ip: "9.9.9.9" })).status, 200);
    assert.equal((await post("/logs", turn(4), { ip: "9.9.9.9" })).status, 429);
  });

  console.log(`\n${passed} passed`);
} finally {
  await mf.dispose();
}
