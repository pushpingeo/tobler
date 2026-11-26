// Headless browser check of Tobler's copy of OpenStreetMap in the page (25 Nov): with CONFIG.osmSnapshotBase set to
// https://data.asktobler.com/osm/, a developable area on a site inside the copy reads its OpenStreetMap checks from the
// copy by range requests and never asks Overpass; the run's checked lines say "Tobler's copy, data as of …". A site
// outside the copy's outline goes to Overpass. The copy is served from test/fixtures/osm-copy under the real host name
// (as R2 would: 206 with CORS headers); the atlas, Overpass and the model are scripted. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-osmcopy.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";
import { readFileSync, statSync } from "node:fs";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const FIX = new URL("../test/fixtures/osm-copy/", import.meta.url);
// Inside the fixture copy (the test railway 30-odd metres west), and well outside it (south of York).
const INSIDE = turf.bboxPolygon([-3.0995, 53.302, -3.096, 53.305]);
const OUTSIDE = turf.bboxPolygon([-1.085, 53.897, -1.075, 53.903]);

const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const toolUse = (name, input) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${Date.now()}`, name, input }], usage: { input_tokens: 100, output_tokens: 10 } });
function model(body) {
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Done.");
  return toolUse("run_study", { place: "Area 1", study: "developable-area", asset_type: "solar" });
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
for (const [label, viewport, site, inside] of [["desktop", { width: 1280, height: 820 }, INSIDE, true], ["phone", { width: 390, height: 844 }, INSIDE, true], ["desktop outside", { width: 1280, height: 820 }, OUTSIDE, false]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/^https:\/\/.*(?:openfreemap|nominatim|wikidata|environment\.data\.gov|arcgis|usgs|noaa)/, (r) => r.abort());
  const copy = { requests: 0, ranges: 0 };
  await page.route(/^https:\/\/data\.asktobler\.com\/osm\//, (r) => {
    copy.requests++;
    const path = new URL(r.request().url().replace("https://data.asktobler.com/osm/", ""), FIX);
    let size; try { size = statSync(path).size; } catch { return r.fulfill({ status: 404, body: "" }); }
    const buf = readFileSync(path);
    const cors = { "access-control-allow-origin": "*", "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges, ETag", "accept-ranges": "bytes" };
    const m = /bytes=(\d+)-(\d*)/.exec(r.request().headers().range || "");
    if (m) { copy.ranges++; const a = +m[1], b = Math.min(size - 1, m[2] ? +m[2] : size - 1); return r.fulfill({ status: 206, headers: { ...cors, "content-range": `bytes ${a}-${b}/${size}` }, body: buf.subarray(a, b + 1) }); }
    return r.fulfill({ status: 200, headers: { ...cors, "content-type": path.pathname.endsWith(".json") ? "application/json" : "application/octet-stream" }, body: buf });
  });
  let overpass = 0;
  await page.route(/overpass/, (r) => { overpass++; r.fulfill({ status: 200, contentType: "application/json", body: '{"elements":[]}' }); });
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/atlas/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { structuredContent: { matches: 0, results: [], returned: 0, features: [] } } }) }));
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  const base = await page.evaluate(async () => (await import("./js/config.js")).CONFIG.osmSnapshotBase);
  if (label === "desktop") check(base === "https://data.asktobler.com/osm/", `the page's copy base is data.asktobler.com (${base})`);
  if (/phone/.test(label)) await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.waitForTimeout(600);
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "drawn" } }), site);
  await page.waitForTimeout(400);
  await page.locator('.chips .chip[data-skill="developable-area"]').click();
  await page.keyboard.press("Enter");
  await page.waitForSelector(".run", { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const card = await page.evaluate(() => document.querySelector(".run .checks")?.textContent || "");
  // The run record's checked lines (the budget card shows sources only inside a deduction).
  const rec = await page.evaluate(() => {
    const r = [...(window.__ws?.runs?.values() || [])].at(-1)?.record;
    const checked = r?.tobler_run?.checked || r?.checked || [];
    return JSON.stringify(checked.filter((c) => c.via || /OpenStreetMap/.test(c.dataset || "")));
  });
  if (inside) {
    check(overpass === 0, `${label}: Overpass never asked (${overpass})`);
    check(copy.requests >= 2 && copy.ranges >= 1, `${label}: the manifest and range requests from the copy (${copy.requests} requests, ${copy.ranges} ranges)`);
    check(/Tobler's copy, data as of 2026-11-24/.test(rec) && /"via":"copy"/.test(rec) && !/"via":"overpass"/.test(rec), `${label}: the run's OpenStreetMap lines say via copy, "Tobler's copy, data as of 2026-11-24" (${rec.slice(0, 160)})`);
  } else {
    check(overpass === 1, `${label}: outside the copy, one Overpass query (${overpass})`);
    check(copy.requests === 1 && copy.ranges === 0, `${label}: only the manifest read (${copy.requests}, ${copy.ranges})`);
    check(/"via":"overpass"/.test(rec) && !/"via":"copy"/.test(rec), `${label}: the run's OpenStreetMap lines say via overpass (${rec.slice(0, 120)})`);
  }
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.locator(".run").screenshot({ path: `/tmp/osmcopy-card-${label.replace(" ", "-")}.png` }).catch(() => {});
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
