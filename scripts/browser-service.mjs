// Headless browser check of a site from a service (26 Nov; claude/site-from-service-spec.md). A fake ArcGIS map service
// (a council parcels layer in British National Grid, one parcel and one well) answers at a made-up address. Pasting the
// address opens the panel with no model call and nothing about the address in the log; a click picks the parcel; it
// comes in as the site through the file pipeline, the datum from the (fake) EPSG registry; the record keeps where it
// came from and the service isn't kept. A secured service: the browser's own login is tried, then a token, which is
// never saved or logged. A point needs a buffer. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-service.mjs [chrome path].
import { chromium } from "playwright-core";
import { fakeEpsg } from "../test/fake-epsg.mjs";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const epsg = fakeEpsg();
const BASE = "https://gis.example-council.gov.uk/arcgis/rest/services/Planning/Parcels/MapServer";
const SECURE = "https://gis.corp.example/arcgis/rest/services/Assets/MapServer";
// A 100 m parcel and a well, near Linlithgow, in British National Grid (EPSG:27700).
const [E, N] = [300000, 677000];
const PARCEL = { attributes: { OBJECTID: 41, PARCEL_NAME: "Field 7" }, geometry: { rings: [[[E, N], [E, N + 100], [E + 100, N + 100], [E + 100, N], [E, N]]] } };
const WELL = { attributes: { OBJECTID: 7, WELL_NAME: "Well W-3" }, geometry: { x: E + 400, y: N + 400 } };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
let modelCalls = 0, serviceCalls = [], modelBodies = [], proxied = [];
const reply = (route, body, headers = {}) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", ...headers }, body: JSON.stringify(body) });

async function arcgis(route, { secure = false } = {}) {
  const req = route.request();
  const url = new URL(req.url());
  serviceCalls.push({ url: req.url(), cookie: req.headers().cookie || "" });
  // The secured portal answers its own login (a cookie) or the token TOK, and only for asktobler's origin.
  const cors = secure ? { "access-control-allow-origin": "http://localhost:8000", "access-control-allow-credentials": "true" } : {};
  if (secure && !/sso=yes/.test(req.headers().cookie || "") && url.searchParams.get("token") !== "TOK") return reply(route, { error: { code: 499, message: "Token Required" } }, cors);
  const p = url.pathname;
  if (/\/export$/.test(p)) return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*", ...cors }, body: PNG });
  const layer = /\/(\d+)(\/query)?$/.exec(p)?.[1];
  const which = layer === "1" ? WELL : PARCEL;
  if (/\/query$/.test(p)) {
    const toWgs = url.searchParams.get("outSR") === "4326";
    // The server's WGS84 copy is only for the highlight: deliberately 200 m off, so the test can tell it wasn't used.
    const g = toWgs ? (which.geometry.rings ? { rings: [[[-3.6, 55.98], [-3.6, 55.981], [-3.598, 55.981], [-3.598, 55.98], [-3.6, 55.98]]] } : { x: -3.594, y: 55.984 }) : which.geometry;
    if (url.searchParams.get("geometryType") === "esriGeometryEnvelope") return reply(route, { objectIdFieldName: "OBJECTID", features: [{ attributes: { OBJECTID: which.attributes.OBJECTID }, geometry: g }] }, cors);
    return reply(route, { objectIdFieldName: "OBJECTID", spatialReference: { wkid: toWgs ? 4326 : 27700 }, features: [{ attributes: which.attributes, geometry: g }] }, cors);
  }
  if (layer != null) return reply(route, { id: +layer, name: layer === "1" ? "Wells" : "Parcels", type: "Feature Layer", geometryType: layer === "1" ? "esriGeometryPoint" : "esriGeometryPolygon", sourceSpatialReference: { wkid: 27700 }, maxRecordCount: 1000, objectIdField: "OBJECTID" }, cors);
  return reply(route, { mapName: secure ? "Assets" : "Planning parcels", layers: [{ id: 0, name: "Parcels" }, { id: 1, name: "Wells" }], spatialReference: { wkid: 27700 } }, cors);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  modelCalls = 0; serviceCalls = [];
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [], logs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|overpass|wikidata|nominatim/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, (r) => { modelCalls++; modelBodies.push(r.request().postData() || ""); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "OK." }], usage: { input_tokens: 1, output_tokens: 1 } }) }); });
  await page.route(/tobler-api.*\/epsg/, async (r) => { try { const j = await epsg(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: "application/json", body: typeof j === "string" ? j : JSON.stringify(j) }); } catch (e) { r.fulfill({ status: 500, body: String(e.message) }); } });
  await page.route(/tobler-api.*\/logs/, (r) => { logs.push(r.request().postData() || ""); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await page.route(/tobler-api.*\/atlas/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"jsonrpc":"2.0","id":1,"result":{"structuredContent":{"results":[]}}}' }));
  await page.route(/gis\.example-council\.gov\.uk/, (r) => arcgis(r));
  await page.route(/gis\.corp\.example/, (r) => arcgis(r, { secure: true }));
  // A public service that doesn't let web pages read it (no CORS headers): the browser refuses it; Tobler's server reads it.
  await page.route(/gis\.nocors\.example/, (r) => r.abort("failed"));
  await page.route(/tobler-api.*\/arcgis\?/, (r) => {
    const target = new URL(r.request().url()).searchParams.get("url");
    proxied.push(target);
    return arcgis({ request: () => ({ url: () => target.replace("gis.nocors.example", "gis.example-council.gov.uk"), headers: () => ({}) }), fulfill: (o) => r.fulfill(o) });
  });
  await page.goto("http://localhost:8000/index.html");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.evaluate(() => window.__ws.map.jumpTo({ center: [-3.598, 55.981], zoom: 15 }));

  // 1. A public parcels service: paste, pick, bring in.
  await page.fill("#say", `Here's our site: ${BASE}/0`);
  await page.click("#ask button[type=submit]");
  await page.waitForSelector("#svc-panel:not([hidden])", { timeout: 10000 });
  await page.waitForFunction(() => /Click a feature/.test(document.querySelector(".svc-status")?.textContent || ""), null, { timeout: 15000 });
  check(modelCalls === 0, `${label}: pasting the address makes no model call (${modelCalls})`);
  const logText = await page.evaluate(() => JSON.stringify(window.toblerLog));
  check(!/example-council/.test(logText) && /\[a service address\]/.test(logText), `${label}: the address isn't in the session log`);
  check(serviceCalls.every((c) => c.url.startsWith("https://gis.example-council.gov.uk/")), `${label}: requests go straight to the service`);
  const box = await page.locator("#svc-map").boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction(() => /Picked: Field 7/.test(document.querySelector(".svc-list")?.textContent || ""), null, { timeout: 10000 });
  const nativeAsked = serviceCalls.some((c) => /\/0\/query/.test(c.url) && /geometryType=esriGeometryPoint/.test(c.url) && !/outSR/.test(c.url));
  check(nativeAsked, `${label}: the click asks for the feature in the service's own coordinates`);
  check(await page.evaluate(() => !document.querySelector('[data-op="svc-use"]').disabled && document.querySelector(".svc-buffer").hidden), `${label}: a polygon can come in with no buffer`);
  await page.screenshot({ path: `/tmp/svc-${label}-picked.png` });
  await page.click('[data-op="svc-use"]');
  await page.waitForFunction(() => /Site set from/.test(document.querySelector("#conversation")?.textContent || ""), null, { timeout: 15000 });
  const site = await page.evaluate(() => {
    const p = [...window.__ws.places.values()].at(-1);
    const c = window.turf ? null : p.feature.geometry.coordinates[0];
    return { name: p.name, method: p.origin.method, svc: p.origin.service, crs: p.origin.crs, first: p.feature.geometry.coordinates[0][0], panel: document.getElementById("svc-panel").hidden,
      card: document.querySelector(".place:last-of-type .origin")?.textContent || "", reply: [...document.querySelectorAll("#conversation .msg.analyst")].at(-1).textContent };
  });
  check(site.name === "Field 7" && site.method === "service" && site.panel, `${label}: the parcel is the site, from the service; the panel closed (${site.name}, ${site.method})`);
  check(site.svc?.layer === "Parcels" && site.svc.feature_ids?.[0] === 41 && site.svc.native_wkid === 27700 && site.svc.secured === false && site.svc.licence === "unknown" && /^\d{4}-/.test(site.svc.retrieved_at),
    `${label}: provenance: layer, feature id, native EPSG:27700, not secured, licence unknown, when (${JSON.stringify(site.svc).slice(0, 160)})`);
  check(site.crs?.epsg === 27700 && /EPSG:\d+/.test(site.crs.how || ""), `${label}: converted from the service's own coordinates by the registry's transformation (${(site.crs?.how || "").slice(0, 90)})`);
  check(Math.abs(site.first[0] - -3.6) > 0.0005 || Math.abs(site.first[1] - 55.98) > 0.0005, `${label}: not the server's own WGS84 copy (${site.first})`);
  check(/The service isn't kept/.test(site.reply) && /Field 7/.test(site.reply), `${label}: the reply says what came in (${site.reply.slice(0, 120)})`);
  const after = serviceCalls.length;
  await page.waitForTimeout(500);
  check(serviceCalls.length === after, `${label}: the service isn't asked again once the site is in`);

  // 2. A secured company service: the browser's login is tried; without it, a token field; the token is used and not kept.
  await ctx.clearCookies();
  await page.fill("#say", `${SECURE}/1`);
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".svc-signin:not([hidden])", { timeout: 15000 });
  const tried = serviceCalls.filter((c) => /corp\.example/.test(c.url));
  check(tried.length >= 2 && !tried.some((c) => /token=/.test(c.url)), `${label}: secured: a plain request, then the browser's own login, before asking (${tried.length} tries)`);
  check(/needs a sign-in/.test(await page.textContent(".svc-why")), `${label}: says it needs a sign-in and how`);
  await page.fill(".svc-signin input", "TOK");
  await page.click('[data-op="svc-token"]');
  await page.waitForFunction(() => /Click a feature/.test(document.querySelector(".svc-status")?.textContent || ""), null, { timeout: 15000 });
  const box2 = await page.locator("#svc-map").boundingBox();
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.waitForFunction(() => /Picked: Well W-3/.test(document.querySelector(".svc-list")?.textContent || ""), null, { timeout: 10000 });
  const needB = await page.evaluate(() => ({ shown: !document.querySelector(".svc-buffer").hidden, disabled: document.querySelector('[data-op="svc-use"]').disabled, opts: [...document.querySelectorAll(".svc-buffer [data-b]")].map((b) => b.dataset.b).join(",") }));
  check(needB.shown && needB.disabled && needB.opts === "10,30,50,100", `${label}: a point needs a buffer of 10, 30, 50 or 100 m first (${needB.opts})`);
  await page.click('.svc-buffer [data-b="30"]');
  await page.click('[data-op="svc-use"]');
  await page.waitForFunction(() => [...window.__ws.places.values()].some((p) => p.name === "Well W-3"), null, { timeout: 15000 });
  const sec = await page.evaluate(() => {
    const p = [...window.__ws.places.values()].find((x) => x.name === "Well W-3");
    return { svc: p.origin.service, buffer: p.origin.buffer_m, type: p.feature.geometry.type, stored: JSON.stringify(localStorage) + JSON.stringify(window.toblerLog) + document.body.innerHTML };
  });
  check(sec.svc.secured === true && sec.svc.licence === "your own or your organisation's data" && sec.buffer === 30 && /Polygon/.test(sec.type), `${label}: secured: marked as your organisation's data, 30 m round the well`);
  check(!/TOK/.test(sec.stored), `${label}: the token isn't in local storage, the log or the page`);
  // The model then sees the site, but not the secured address or host.
  await page.fill("#say", "What do we have so far?");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => !document.getElementById("ask").classList.contains("busy"), null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const sentLog = logs.join("\n");
  check(modelCalls === 1, `${label}: one model call, for the question (${modelCalls})`);
  await page.screenshot({ path: `/tmp/svc-${label}-done.png` });
  const summarySent = await page.evaluate(() => JSON.stringify(window.toblerLog.at(-1)));
  check(!/corp\.example|TOK/.test(sentLog + summarySent), `${label}: neither the secured host nor the token goes to the Worker's log`);
  const toModel = modelBodies.join("\n");
  check(/Well W-3/.test(toModel) && /your organisation's secured service, layer Wells/.test(toModel) && !/corp\.example|TOK|\[\s*-?\d+\.\d{4,}\s*,/.test(toModel) && /the layer Parcels on gis\.example-council\.gov\.uk/.test(toModel) && !/rest\/services/.test(toModel),
    `${label}: the model sees the sites' names and layers (a public service's host, not a secured one's), never an address, the token or an outline (${(toModel.match(/Well W-3[^"\\]{0,160}/) || [""])[0]})`);
  // 3. A public service that blocks web pages: offered through Tobler's server, used only once asked.
  proxied.length = 0;
  await page.fill("#say", "https://gis.nocors.example/arcgis/rest/services/Planning/Parcels/MapServer/0");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector('[data-op="svc-proxy"]:not([hidden])', { timeout: 20000 });
  check(proxied.length === 0, `${label}: blocked: Tobler's server isn't used until the person asks`);
  await page.click('[data-op="svc-proxy"]');
  await page.waitForFunction(() => /Click a feature/.test(document.querySelector(".svc-status")?.textContent || ""), null, { timeout: 15000 })
    .catch(async (e) => { console.log("DEBUG", await page.evaluate(() => [document.querySelector(".svc-status")?.textContent, document.querySelector(".svc-why")?.textContent, document.getElementById("svc-panel").hidden])); throw e; });
  const box3 = await page.locator("#svc-map").boundingBox();
  await page.mouse.click(box3.x + box3.width / 2, box3.y + box3.height / 2);
  await page.waitForFunction(() => /Picked: Field 7/.test(document.querySelector(".svc-list")?.textContent || ""), null, { timeout: 10000 });
  await page.click('[data-op="svc-use"]');
  await page.waitForFunction(() => [...window.__ws.places.values()].some((p) => p.origin?.service?.read_through), null, { timeout: 15000 });
  const via = await page.evaluate(() => [...window.__ws.places.values()].find((p) => p.origin?.service?.read_through).origin.service);
  check(proxied.length > 0 && proxied.every((u) => !/token=/.test(u)) && /Tobler's server/.test(via.read_through || "") && via.secured === false,
    `${label}: read through Tobler's server, public, and the record says so (${proxied.length} requests)`);
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
