// Headless browser check of the developable area (25 Nov): a drawn site on land, the chip fills the input, the analyst
// calls run_study with the asset type, the run carries out only the budget's checks within their buffers and asks no
// model, and the card shows the area budget (gross, deductions, net, soft, not checked), the map shows what's left and
// what was taken off, and the report opens with the budget table. Atlas, OpenStreetMap and the model are scripted: no
// network, no cost. Screenshots at desktop and phone sizes.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-budget.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const C = [-1.08, 53.9]; // south of York
const r6 = (v) => Math.round(v * 1e6) / 1e6;
// About 650 m × 650 m (~42 ha).
const SITE = turf.bboxPolygon([C[0] - 0.005, C[1] - 0.003, C[0] + 0.005, C[1] + 0.003].map(r6));
SITE.geometry.coordinates = SITE.geometry.coordinates.map((ring) => ring.map((p) => p.map(r6)));
const F = (geometry, properties) => ({ type: "Feature", geometry, properties });
const box = (w, s, e, n) => turf.bboxPolygon([w, s, e, n]).geometry;

// An SSSI over the west fifth, Flood Zone 3 along the south, grade 2 farmland everywhere.
function atlas(tool, args) {
  if (tool === "fetch_features" && args.id === "0c53cecc65701f0c") return { returned: 1, features: [F(box(C[0] - 0.02, C[1] - 0.02, C[0] - 0.003, C[1] + 0.02), { NAME: "Ings Meadow SSSI" })] };
  if (tool === "fetch_features" && args.id === "5ffe9c81924b8082") return { returned: 1, features: [F(box(C[0] - 0.02, C[1] - 0.02, C[0] + 0.02, C[1] - 0.0018), { flood_zone: "FZ3" })] };
  if (tool === "fetch_features" && args.id === "5e7c583217c03078") return { returned: 1, features: [F(box(C[0] - 0.02, C[1] - 0.02, C[0] + 0.02, C[1] + 0.02), { ALC_GRADE: "Grade 2", JOB_NUMBER: "1" })] };
  return { matches: 0, results: [], returned: 0, features: [] };
}
// OpenStreetMap: an overhead line north–south, and a barn.
const OSM = { elements: [
  { type: "way", id: 1, tags: { power: "line", voltage: "132000" }, geometry: [{ lon: C[0] + 0.002, lat: C[1] - 0.01 }, { lon: C[0] + 0.002, lat: C[1] + 0.01 }] },
  { type: "way", id: 3, tags: { building: "barn" }, geometry: [[0, 0.001], [0.0008, 0.001], [0.0008, 0.0016], [0, 0.0016], [0, 0.001]].map(([x, y]) => ({ lon: C[0] + x, lat: C[1] + y })) },
] };

const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const seen = [];
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  seen.push({ sys: sys.slice(0, 120), tools: (body.tools || []).length });
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("About two thirds of the site is developable for solar. The SSSI on the west side is the biggest deduction; slope wasn't checked.");
  return toolUse(["run_study", { place: "Area 1", study: "developable-area", asset_type: "solar" }]);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  seen.length = 0;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|nominatim|wikidata|environment\.data\.gov|arcgis|usgs|noaa/, (r) => r.abort());
  let osmQ = "";
  await page.route(/overpass/, (r) => { osmQ = decodeURIComponent(r.request().postData() || ""); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(OSM) }); });
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.waitForTimeout(800);
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "drawn" } }), SITE);
  await page.waitForTimeout(500);
  const chip = await page.evaluate(() => { const b = document.querySelector('.chips .chip[data-skill="developable-area"]'); return b ? { soon: b.classList.contains("soon"), hidden: b.hidden } : null; });
  check(chip && !chip.soon && !chip.hidden, `${label}: the developable area chip is ready (${JSON.stringify(chip)})`);
  await page.locator('.chips .chip[data-skill="developable-area"]').click();
  const typed = await page.inputValue("#say");
  check(/^Run the developable area for Area 1/.test(typed), `${label}: the chip fills the input (${typed})`);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".run", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const card = await page.evaluate(() => {
    const c = document.querySelector(".run");
    if (!c) return null;
    const rows = [...c.querySelectorAll(".brow")].map((li) => [li.className.replace("brow ", ""), li.querySelector(".blabel")?.textContent, li.querySelector(".bha")?.textContent, li.querySelector(".bpct")?.textContent]);
    return {
      title: c.querySelector("h2")?.textContent || "", setup: c.querySelector(".setup")?.textContent || "",
      summary: c.querySelector(".bsummary")?.textContent || "", rows,
      nc: c.querySelector(".bnc")?.textContent || "",
      flagsShown: getComputedStyle(c.querySelector(".flags")).display !== "none",
      reachShown: getComputedStyle(c.querySelector(".reach")).display !== "none",
      checks: c.querySelector(".checks")?.textContent || "",
    };
  });
  const map = await page.evaluate(() => { const s = window.__ws?.map?.getSource("budget"); const d = s?._data; return d ? (d.features || []).map((f) => f.properties.part + ":" + (f.properties.deduction || "")) : null; });
  check(card && card.title === "Developable area: Area 1", `${label}: the card names the skill (${card?.title})`);
  check(/For a solar farm/.test(card?.setup || ""), `${label}: the asset type is on the card (${card?.setup})`);
  check(/^Net developable area for a solar farm: /.test(card?.summary || ""), `${label}: the summary leads with the net area (${card?.summary?.slice(0, 90)})`);
  const lab = (card?.rows || []).map((r) => r[1]).join(" | ");
  check(/Gross site area/.test(lab) && /Statutory nature sites/.test(lab) && /Overhead power lines \+ 30 m/.test(lab) && /Existing buildings/.test(lab) && /Flood Zone 3/.test(lab) && /Net developable/.test(lab), `${label}: gross, the deductions with buffers, and the net (${lab.slice(0, 200)})`);
  check(/Best and most versatile farmland/.test(lab) && /Of which, usable at a cost/.test(lab), `${label}: soft constraints under the net`);
  check(/Not checked:.*steep ground/.test(card?.nc || ""), `${label}: slope not checked, said (${card?.nc?.slice(0, 80)})`);
  check(card && !card.flagsShown && !card.reachShown, `${label}: no flags list or distance slider on a budget`);
  check(/Can't build/.test(card?.checks || "") && /Keep clear/.test(card?.checks || "") && !/Nearest homes.*500 m/.test(card?.checks || ""), `${label}: the checks grouped by kind`);
  check(map && map.includes("net:") && map.some((x) => x.startsWith("taken:nature-sites")), `${label}: the map shows what's left and what was taken off (${(map || []).join(", ")})`);
  check(/way\["building"\]/.test(osmQ) && !/aerodrome/.test(osmQ), `${label}: one Overpass query, with buildings and only the budget's kinds`);
  check(!seen.some((x) => /sealed/.test(x.sys)), `${label}: no model call inside the run (${seen.length} calls, all the conversation's)`);
  // Open a deduction: its reason and source, and its area picked out on the map.
  await page.locator(".run .brow.minus details").first().evaluate((d) => { d.open = true; });
  await page.waitForTimeout(400);
  const opened = await page.evaluate(() => ({ why: document.querySelector(".run .brow.minus details .why")?.textContent || "", hl: (window.__ws?.map?.getSource("hl")?._data?.features || []).length }));
  check(/very unlikely to be consented|easement|Already built/.test(opened.why) && opened.hl === 1, `${label}: a row opens into its reason and picks out its area (${opened.why.slice(0, 60)}, ${opened.hl})`);
  await page.screenshot({ path: `/tmp/budget-${label}.png`, fullPage: false });
  await page.locator(".run").screenshot({ path: `/tmp/budget-card-${label}.png` });
  if (label === "desktop") {
    const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
    await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 45000 }).catch(() => {});
    const rep = await rp.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, error: window.__report?.error || "", body: document.body.textContent, rows: document.querySelectorAll("table.budget tbody tr").length }));
    check(!rep.error && rep.h1 === "Developable areaArea 1", `report opens with the skill's title (${rep.error || rep.h1})`);
    check(/Net developable: /.test(rep.body) && rep.rows >= 6 && /Not checked:.*steep ground/.test(rep.body), `the report has the budget table and what wasn't checked (${rep.rows} rows)`);
    await rp.screenshot({ path: "/tmp/budget-report.png", fullPage: true });
  }
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
