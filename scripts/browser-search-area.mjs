// Headless browser check of a search area (Cnoc Buidhe, 20 Nov): a place built from clues to stand in for an
// outline nobody found. The map draws it light and dashed and labels it; its card says what it is; a screen of it
// (model and atlas scripted, no network, no cost) leads with the search-area line, says "in the search area" with
// the share covered instead of "on site", caps the confidence of findings covering under 10% of it, and leaves out the onshore "At sea" row. The report
// says the same and draws the outline dashed. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-search-area.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const BELLOCHANTUY = [-5.7, 55.5167];
const CENTRE = turf.destination(BELLOCHANTUY, 2.5, 90).geometry.coordinates;
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const circle = turf.circle(CENTRE, 2.5, { units: "kilometers", steps: 48 });
const SEARCH = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [circle.geometry.coordinates[0].map((c) => c.map(r6))] } };
// A goose roost clipping the circle's eastern edge, and a monument point inside it.
const ROOST = turf.circle(turf.destination(CENTRE, 2.6, 90).geometry.coordinates, 0.8, { units: "kilometers", steps: 24 }).geometry;
const MONUMENT = turf.destination(CENTRE, 1, 300).geometry.coordinates;
// Peat across the western side: about a third of the search area, so its confidence isn't capped (Rob, 22 Nov: 10% or more).
const PEAT = turf.circle(turf.destination(CENTRE, 1, 270).geometry.coordinates, 1.5, { units: "kilometers", steps: 32 }).geometry;

function atlas(tool, args) {
  if (tool === "find_datasets" && /protection/i.test(args.text || "")) return { matches: 1, results: [{ id: "spa", title: "Special Protection Areas", publisher: "NatureScot", capabilities: ["query"], licence: "Open Government Licence" }] };
  if (tool === "find_datasets" && /monument/i.test(args.text || "")) return { matches: 1, results: [{ id: "sm", title: "Scheduled Monuments", publisher: "Historic Environment Scotland", capabilities: ["query"], licence: "Historic Environment Scotland" }] };
  if (tool === "find_datasets" && /peat/i.test(args.text || "")) return { matches: 1, results: [{ id: "peat", title: "Carbon and peatland map", publisher: "NatureScot", capabilities: ["query"], licence: "Open Government Licence" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  if (tool === "fetch_features" && args.id === "spa") return { returned: 1, features: [{ type: "Feature", geometry: ROOST, properties: { NAME: "Kintyre Goose Roosts" } }] };
  if (tool === "fetch_features" && args.id === "peat") return { returned: 1, features: [{ type: "Feature", geometry: PEAT, properties: { NAME: "Class 1 peat" } }] };
  if (tool === "fetch_features" && args.id === "sm") return { returned: 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: MONUMENT }, properties: { DES_TITLE: "Killocraw, cup marked stone" } }] };
  return { matches: 0, results: [], returned: 0, features: [] };
}
const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
const RESULT = "Screened as onshore wind. A Special Protection Area is on site and a scheduled monument is on the site.\n\n" + json({ decision: "major issue", decision_why: "A protected bird roost on site.", flags: [
  { risk: "Special Protection Area (Kintyre Goose Roosts) on site", theme: "PS6", severity: "high", confidence: "high", next_step: "Ornithology review", why: "Collision and displacement.", evidence: [{ name: "Kintyre Goose Roosts", distance_km: 0, dataset: "Special Protection Areas" }] },
  { risk: "Class 1 peat on site", theme: "PS6", severity: "medium", confidence: "high", next_step: "Peat depth survey", why: "Carbon-rich soil.", evidence: [{ name: "Class 1 peat", distance_km: 0, dataset: "Carbon and peatland map" }] },
  { risk: "Scheduled monument on the site", theme: "PS8", severity: "high", confidence: "high", next_step: "Setting assessment", why: "Consent needed.", evidence: [{ name: "Killocraw, cup marked stone", distance_km: 0, dataset: "Scheduled Monuments" }] },
], checked: [], data_gaps: ["The site's outline wasn't found"] });
const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const firsts = [];
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  const n = body.messages.length;
  if (/running one sealed screen/.test(sys)) {
    if (n === 1) { firsts.push(String(body.messages[0].content)); return toolUse(["find_data", { text: "protection", area: "Cnoc Buidhe" }], ["find_data", { text: "monument", area: "Cnoc Buidhe" }], ["find_data", { text: "peat", area: "Cnoc Buidhe" }]); }
    if (n === 3) return toolUse(["get_data", { dataset: "D1", place: "Cnoc Buidhe", theme: "biodiversity" }], ["get_data", { dataset: "D2", place: "Cnoc Buidhe", theme: "heritage" }], ["get_data", { dataset: "D3", place: "Cnoc Buidhe", theme: "biodiversity" }]);
    return text(RESULT);
  }
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Screened the search area for Cnoc Buidhe.");
  return toolUse(["screen_site", { place: "Cnoc Buidhe", asset_type: "wind-onshore" }]);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/gis\.ngdc\.noaa\.gov/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ samples: [150, 190, 240].map((v) => ({ value: String(v), resolution: 0.004 })) }) }));
  await page.route(/emodnet-humanactivities/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ features: [{ properties: { GRAY_INDEX: 0.04 } }] }) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // The place make_place builds for Cnoc Buidhe: a circle 2.5 km east of Bellochantuy.
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, name: "Cnoc Buidhe", origin: { method: "words", words: "Cnoc Buidhe Wind Energy Hub, 2.5 km east of Bellochantuy", confidence: "medium",
    match: "type_near_clues", shape: "circle", offset: true, anchor: { name: "Bellochantuy", source: { title: "Wikidata", publisher: "Wikidata contributors" } },
    steps: ["moved 2.5 km on a bearing of 90° from Bellochantuy", "circle of radius 2.5 km"], at: new Date().toISOString() } }), SEARCH);
  await page.waitForTimeout(400);
  const map = await page.evaluate(() => {
    const m = window.__ws.map;
    const d = m.getSource("aoi")._data?.features?.[0]?.properties || m.getSource("aoi").serialize().data.features?.[0]?.properties;
    return { role: d?.role, label: d?.label, solidFilter: JSON.stringify(m.getFilter("aoi-red")), dashed: !!m.getLayer("aoi-search") && JSON.stringify(m.getPaintProperty("aoi-search", "line-dasharray")) };
  });
  check(map.role === "search_area" && / · search area/.test(map.label || ""), `${label}: the map knows it's a search area and labels it (${map.label})`);
  check(/search_area/.test(map.solidFilter || "") && map.dashed === "[2.5,2]", `${label}: drawn thin and dashed, not as a ranging pole`);
  const what = await page.evaluate(() => { const c = document.querySelector(".shape .facts"); const dts = [...c.querySelectorAll("dt")].map((e) => e.textContent); return { first: dts[0], text: c.querySelector("dd").textContent }; });
  check(what.first === "What it is" && /^A search area \(built from clues round Bellochantuy\), standing in for an outline that wasn't found/.test(what.text), `${label}: the place card says what it is`);
  await page.fill("#say", "Screen Cnoc Buidhe for environmental constraints");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  const card = await page.evaluate(() => ({
    note: document.querySelector(".run .search-note").hidden ? "" : document.querySelector(".run .search-note").textContent,
    setup: document.querySelector(".run .setup").textContent,
    flags: [...document.querySelectorAll(".run .flag")].map((li) => ({ risk: li.querySelector(".risk").textContent, conf: li.dataset.conf, sev: li.querySelector(".sev")?.textContent || "", cw: li.querySelector(".cw")?.textContent || "", dist: li.querySelector(".dist").textContent, why: li.querySelector(".why").textContent, ev: li.querySelector(".ev li").textContent })),
    sea: document.querySelector(".run .sea").hidden ? "" : document.querySelector(".run .sea").textContent,
    body: document.querySelector(".run").textContent,
  }));
  check(/^Screened a 19\.\d km² search area \(built from clues round Bellochantuy\), because the site's outline wasn't found/.test(card.note), `${label}: the card leads with the search-area line`);
  { const m = card.body.replace(/none of them is known to be on the site itself/, "").match(/.{0,60}\bon (the )?site\b.{0,30}/i); check(!m, `${label}: nothing on the card says "on site"${m ? `: …${m[0]}…` : ""}`); }
  const spa = card.flags.find((f) => /Goose/.test(f.risk));
  const mon = card.flags.find((f) => /monument/i.test(f.risk));
  const peat = card.flags.find((f) => /peat/i.test(f.risk));
  check(peat && peat.conf === "high" && /in the search area \(covers \d+% of it/.test(peat.ev) && !/Confidence high →/.test(peat.why), `${label}: peat covering a third of it: 10% or more, so high confidence, not capped (${peat?.conf}, ${peat?.ev.slice(0, 60)})`);
  check(spa && spa.sev === "high" && spa.cw === "low confidence (capped)" && peat?.sev === "medium" && peat?.cw === "high confidence", `${label}: the badge is severity, with confidence as a word under the flag (${spa?.sev} / ${spa?.cw}; ${peat?.sev} / ${peat?.cw})`);
  check(spa && /in the search area/.test(spa.risk) && spa.dist === "in search area" && spa.conf === "low", `${label}: the roost: worded for a search area, low confidence (a sliver) (${spa?.conf}, ${spa?.dist})`);
  check(spa && /in the search area \(covers \d+(\.\d)?% of it, on its eastern side\)/.test(spa.ev) && /Confidence high → low/.test(spa.why), `${label}: the roost's evidence says how much it covers and where; the cap is explained (${spa?.ev.slice(0, 80)})`);
  check(mon && mon.conf === "medium" && /in the search area \(on its/.test(mon.ev), `${label}: the monument point: medium, inside, with where (${mon?.ev.slice(0, 70)})`);
  check(card.sea === "", `${label}: no "At sea" line for an onshore site`);
  check(/search area/.test(firsts.at(-1) || ""), `${label}: the analyst was told it's a search area`);
  await page.screenshot({ path: `/tmp/search-${label}-card.png` });
  await page.locator(".run .flags").screenshot({ path: `/tmp/search-${label}-flags.png` }).catch(() => {});
  // The report: the same line, a dashed outline, "in the search area".
  const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
  await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 40000 });
  const rep = await rp.evaluate(() => ({
    note: document.querySelector(".search-note")?.textContent || "",
    key: [...document.querySelectorAll(".key li")].map((e) => e.textContent),
    nearest: [...document.querySelectorAll("table.findings td.dist")].map((e) => e.textContent),
    ev: document.querySelector("table.findings .ev li")?.textContent || "",
    atSea: [...document.querySelectorAll(".facts dt")].some((e) => e.textContent === "At sea"),
    rating: document.querySelector("table.findings .rating")?.textContent || "",
    dash: JSON.stringify(window.__report.maps[0].getPaintProperty("site-line", "line-dasharray")),
  }));
  check(/^Screened a 19\.\d km² search area/.test(rep.note), `${label}: report leads with the search-area line`);
  check(rep.key.includes("The search area") && rep.dash === "[3,2]", `${label}: report draws and keys the search area dashed`);
  check(rep.nearest.every((t) => t === "in the search area") && /in the search area \(covers/.test(rep.ev) && /capped/.test(rep.rating), `${label}: report rows say "in the search area", with the share, and the capped confidence`);
  check(!rep.atSea, `${label}: report has no "At sea" row for an onshore site`);
  await rp.screenshot({ path: `/tmp/search-${label}-report.png`, fullPage: true });
  await rp.close();
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
