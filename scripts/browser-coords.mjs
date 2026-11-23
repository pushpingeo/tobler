// Headless browser check of coordinates typed into the chat (Rob, 20 Nov): the page reads them in code and tells the
// analyst; find_place returns them as a place, not a name search; the point lands exactly where typed. The model is
// scripted (it does what the note says), so this checks the page and tools, not the model. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-coords.mjs [chrome path].
import { chromium } from "playwright-core";
import { fakeEpsg } from "../test/fake-epsg.mjs";
const epsg = fakeEpsg();

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const seen = [];
function model(body) {
  const msgs = body.messages;
  const first = msgs.find((m) => m.role === "user" && typeof m.content === "string" && /Read by the page/.test(m.content)) || msgs.findLast((m) => m.role === "user" && typeof m.content === "string");
  const last = msgs.at(-1);
  if (typeof last.content === "string") { seen.push(last.content); const q = /Pass "([^"]+)" to find_place/.exec(last.content)?.[1]; return q ? toolUse(["find_place", { query: q }]) : text("No coordinates seen."); }
  const res = last.content.find((b) => b.type === "tool_result");
  const out = JSON.parse(typeof res.content === "string" ? res.content : res.content[0].text);
  if (out.candidates) return toolUse(["make_place", { anchor: out.candidates[0].id, shape: "point", words: "a point at these coordinates", match: "named_place", reason: "typed coordinates" }]);
  return text(`Done: ${first ? "point placed" : ""}`);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [], searched = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|overpass|wikidata/, (r) => { searched.push(r.request().url()); r.abort(); });
  await page.route(/nominatim/, (r) => { searched.push(r.request().url()); r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: /reverse/.test(r.request().url()) ? JSON.stringify({ address: { hamlet: "Bellochantuy" } }) : "[]" }); });
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/epsg/, async (r) => {
    try { const j = await epsg(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: "application/json", body: typeof j === "string" ? j : JSON.stringify(j) }); }
    catch (e) { r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route(/tobler-api.*\/(atlas|logs)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  check(/coordinates/.test(await page.getAttribute("#say", "placeholder")), `${label}: the input hint mentions coordinates`);
  await page.fill("#say", "55.522759, -5.650122");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => window.__ws.host.places?.().length || document.querySelector(".shape"), null, { timeout: 30000 });
  await page.waitForTimeout(500);
  check(/Read by the page: "55\.522759, -5\.650122" is 55\.52276° N, 5\.65012° W, decimal degrees/.test(seen.at(-1) || ""), `${label}: the analyst is told how the page read them`);
  const placed = await page.evaluate(() => { const p = window.__ws.host.places().at(-1); return { name: p.name, at: p.feature.geometry.coordinates, type: p.feature.geometry.type }; });
  check(placed.type === "Point" && placed.at[0] === -5.650122 && placed.at[1] === 55.522759, `${label}: a point exactly where typed (${placed.at})`);
  check(!searched.some((u) => /nominatim.*\/search|wikidata|overpass/.test(u)), `${label}: no name search for the coordinates`);
  const card = await page.evaluate(() => document.querySelector(".shape")?.textContent || "");
  check(/coordinates you typed|You/.test(card) || /55\.52/.test(card), `${label}: the place card shows it (${placed.name})`);
  // A British National Grid reference: converted to WGS84 with the registry's transformation, as site files are.
  await page.fill("#say", "NT 002 774");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => window.__ws.host.places().length === 2, null, { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 30000 });
  check(/British National Grid reference, E 300250, N 677450/.test(seen.at(-1) || ""), `${label}: the grid reference is read as eastings and northings for the analyst`);
  const grid = await page.evaluate(() => { const p = window.__ws.host.places().at(-1); return { at: p.feature.geometry.coordinates, datum: p.origin.anchor?.extra?.datum || "" }; });
  // Reference: OSGB36 → WGS84 with EPSG:1314's parameters, worked out independently (proj4) for E 300250 N 677450.
  const refLon = -3.60015, refLat = 55.97963;
  check(Math.abs(grid.at[0] - refLon) < 0.00005 && Math.abs(grid.at[1] - refLat) < 0.00005, `${label}: placed at the converted position (${grid.at})`);
  check(/EPSG:1314/.test(grid.datum), `${label}: the place records the registry's transformation (${grid.datum.slice(0, 80)})`);
  await page.screenshot({ path: `/tmp/coords-${label}.png` });
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
