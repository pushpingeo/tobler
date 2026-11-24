// Headless browser check of out-of-date runs (22 Nov, "energy is done" item 2). A drawn square near Linlithgow is
// screened (model and atlas scripted, no network, no cost); then the site is edited and the run card says it's out
// of date, with what changed, dimmed flags and a re-run button; moving it back clears that; the analyst's next turn
// is told; the report made now says so; a re-run makes R2 beside R1, which says it was replaced; deleting the site
// says so with no re-run. Desktop and phone.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-outofdate.mjs [chrome path].
import { chromium } from "playwright-core";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const CENTRE = [-3.6, 55.98];
const r7 = (v) => Math.round(v * 1e7) / 1e7;
const sq = turf.bboxPolygon(turf.bbox(turf.buffer(turf.point(CENTRE), 0.5, { units: "kilometers" })));
const SITE = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [sq.geometry.coordinates[0].map((c) => c.map(r7))] } };
const shift = (f, km, bearing) => {
  const t = turf.transformTranslate(f, km, bearing, { units: "kilometers" });
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [t.geometry.coordinates[0].map((c) => c.map(r7))] } };
};
const SCHOOL = turf.destination(CENTRE, 0.9, 45).geometry.coordinates;

function atlas(tool, args) {
  if (tool === "find_datasets" && /school/i.test(args.text || "")) return { matches: 1, results: [{ id: "sch", title: "Schools", publisher: "Scottish Government", capabilities: ["query"], licence: "Open Government Licence" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  if (tool === "fetch_features" && args.id === "sch") return { returned: 1, features: [{ type: "Feature", geometry: { type: "Point", coordinates: SCHOOL }, properties: { NAME: "Linlithgow Bridge Primary" } }] };
  return { matches: 0, results: [], returned: 0, features: [] };
}
const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
let screens = 0;
const result = () => "Screened as solar.\n\n" + json({ decision: screens > 1 ? "progress" : "progress with targeted investigation", decision_why: "A school nearby.", flags: [
  { risk: "Primary school close to the site", theme: "PS4", severity: "medium", confidence: "high", next_step: "Traffic plan", why: "Construction traffic.", evidence: [{ name: "Linlithgow Bridge Primary", distance_km: 0.4, dataset: "Schools" }] },
], checked: [], data_gaps: [] });
const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const asked = [];
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  const n = body.messages.length;
  if (/running one sealed screen/.test(sys)) {
    if (n === 1) { screens++; return toolUse(["find_data", { text: "school", area: "Area 1" }]); }
    if (n === 3) return toolUse(["get_data", { dataset: "D1", place: "Area 1", theme: "community" }]);
    return text(result());
  }
  const first = body.messages[0];
  asked.push(JSON.stringify(body.messages));
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Screened Area 1.");
  if (/how is it looking/i.test(JSON.stringify(last.content))) return text("R1 is out of date; I can re-run it.");
  void first;
  return toolUse(["screen_site", { place: "Area 1", asset_type: "solar", stage: "concept" }]);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  screens = 0; asked.length = 0;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/gis\.ngdc\.noaa\.gov/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ samples: [60, 70, 80].map((v) => ({ value: String(v), resolution: 0.004 })) }) }));
  await page.route(/emodnet-humanactivities/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ features: [] }) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  const open = () => (label === "phone" ? page.evaluate(() => document.getElementById("panel").classList.remove("collapsed")) : null);
  await open();
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, name: "Area 1", origin: { method: "drawn" } }), SITE);
  await page.fill("#say", "Screen Area 1 for a solar farm");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 20000 });
  await open();
  const strip = (i = 0) => page.evaluate((i) => {
    const c = document.querySelectorAll(".run")[i];
    const s = c.querySelector(".outdated");
    return { shown: !s.hidden, text: s.querySelector("span").textContent, btn: s.querySelector("button").hidden ? "" : s.querySelector("button").textContent, dim: c.classList.contains("is-outdated"), meta: c.querySelector(".meta").textContent };
  }, i);
  check(!(await strip()).shown, `${label}: a fresh run isn't marked out of date`);
  const tree = () => page.evaluate(() => {
    const t = document.querySelector("#sitetree");
    return { hidden: t.hidden, count: t.querySelector(".count")?.textContent || "", sites: [...t.querySelectorAll(".site-row .name")].map((e) => e.textContent),
      runs: [...t.querySelectorAll(".run-row")].map((e) => `${e.querySelector("b").textContent}|${e.querySelector(".state").textContent}|${e.classList.contains("stale") ? "stale" : ""}|${e.classList.contains("shown") ? "shown" : ""}`) };
  });
  // Sites and screens (24 Nov): the run sits under its site, the newest shown.
  let t = await tree();
  check(!t.hidden && t.count === "1 site · 1 screen" && t.sites[0] === "Area 1" && /^R1\|\d+ flags?/.test(t.runs[0] || "") && /\|shown$/.test(t.runs[0]),
    `${label}: the sites-and-screens strip lists the site with its run (${t.count}; ${t.runs.join(" ; ")})`);

  // The analyst (or the card's resize) changes the site: applyGeometry.
  await page.evaluate((f) => window.__ws.host.updatePlace("Area 1", f, "moved 0.6 km east"), shift(SITE, 0.6, 90));
  await page.waitForTimeout(200);
  let s = await strip();
  check(s.shown && /^Out of date: the site was edited after this screen \(moved 0\.6 km east\)/.test(s.text) && s.dim, `${label}: edited → out of date, with what changed, flags dimmed (${s.text.slice(0, 80)})`);
  check(s.btn === "Re-run on the edited site", `${label}: a re-run button`);
  await page.screenshot({ path: `/tmp/outofdate-${label}-card.png` });
  // Moved back where it was: current again.
  await page.evaluate((f) => window.__ws.host.updatePlace("Area 1", f, "moved back"), SITE);
  await page.waitForTimeout(200);
  s = await strip();
  check(!s.shown && !s.dim, `${label}: undoing the edit clears it`);
  // Edited again; the analyst's next turn hears about it.
  await page.evaluate((f) => window.__ws.host.updatePlace("Area 1", f, "moved 0.6 km east"), shift(SITE, 0.6, 90));
  await page.waitForTimeout(200);
  await page.fill("#say", "how is it looking now?");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 20000 });
  await open();
  check(/Screening runs:.*R1: Area 1.*OUT OF DATE: moved 0\.6 km east/.test(asked.at(-1) || ""), `${label}: the analyst's project summary says R1 is out of date`);
  // The report made now says so.
  const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
  await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 40000 });
  const note = await rp.evaluate(() => document.querySelector(".outdated-note")?.textContent || "");
  check(/^Out of date: the site was edited after this screen \(moved 0\.6 km east\)/.test(note), `${label}: the report says it's out of date (${note.slice(0, 60)})`);
  await rp.close();

  // Re-run from the card: R2 beside R1, with the same settings.
  await page.click('.run [data-op="rerun"]');
  await page.waitForFunction(() => document.querySelectorAll(".run").length === 2 && !document.querySelector("#ask.busy"), null, { timeout: 30000 });
  await open();
  const after = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".run")];
    const r2 = window.__ws.runs.get("R2")?.record.tobler_run;
    return { ids: cards.map((c) => c.dataset.run), reply: [...document.querySelectorAll(".msg.analyst:not(.run)")].map((e) => e.textContent).find((t) => /replaces R1/.test(t)) || "",
      r2: r2 && { replaces: r2.replaces, stage: r2.site.stage, asset: r2.site.asset_type, same: r2.place_geometry_at_run === JSON.stringify(window.__ws.places.values().next().value.feature.geometry) } };
  });
  check(after.ids.join() === "R1,R2", `${label}: the re-run is a new card, R2, beside R1 (${after.ids.join()})`);
  check(after.r2?.replaces?.run === "R1" && /moved 0\.6 km east/.test(after.r2.replaces.why) && after.r2.stage === "concept" && after.r2.asset === "solar" && after.r2.same, `${label}: R2 replaces R1, same asset and stage, on the edited outline`);
  check(/^R2 replaces R1: 1 flag \(was 1\), decision: progress \(was progress with targeted investigation\)\./.test(after.reply), `${label}: a short line in the conversation (${after.reply.slice(0, 90)})`);
  const line = await page.evaluate(() => document.getElementById("activity")?.textContent || "");
  check(!/Screening/.test(line), `${label}: the activity line is cleared after the re-run (${line.slice(0, 50)})`);
  s = await strip(0);
  check(s.shown && /^Replaced by R2/.test(s.text) && !s.btn, `${label}: R1 says it was replaced, no button`);
  check(!(await strip(1)).shown, `${label}: R2 is current`);
  await page.screenshot({ path: `/tmp/outofdate-${label}-rerun.png` });
  t = await tree();
  check(t.count === "1 site · 2 screens" && /^R2\|/.test(t.runs[0]) && !/stale/.test(t.runs[0]) && /^R1\|Replaced by R2\|stale/.test(t.runs[1] || ""),
    `${label}: R2 above R1 under the same site, R1 marked replaced (${t.runs.join(" ; ")})`);
  // Opening the strip and picking R1 puts it on the map and scrolls to its card.
  if (label === "phone") await page.evaluate(() => document.querySelector("#handle").getAttribute("aria-expanded") === "false" && document.querySelector("#handle").click());
  await page.evaluate(() => { const d = document.querySelector("#sitetree details"); if (d) d.open = true; });
  await page.locator('#sitetree .run-row[data-run="R1"]').click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  t = await tree();
  check(/^R1\|.*\|shown$/.test(t.runs[1] || "") && await page.evaluate(() => !!document.querySelector("#sitetree details")?.open),
    `${label}: picking R1 in the tree shows it on the map, and the strip stays open (${t.runs.join(" ; ")})`);
  await page.screenshot({ path: `/tmp/outofdate-${label}-tree.png` });
  // Kept in this browser (24 Nov): reload, and the site, both screens and their states come back.
  await page.waitForTimeout(1200);
  await page.reload();
  await page.waitForFunction(() => window.__ws?.draw && document.querySelectorAll(".run").length === 2, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);
  t = await tree();
  const back = await page.evaluate(() => ({ cards: [...document.querySelectorAll(".run")].map((c) => c.dataset.run), note: [...document.querySelectorAll(".msg.note")].map((n) => n.textContent).find((x) => /Picked up/.test(x)) || "",
    place: [...window.__ws.places.values()].map((p) => `${p.name}|${p.status}|${p.edits.length}`)[0] || "" }));
  check(back.cards.join() === "R1,R2" && t.count === "1 site · 2 screens" && /^R1\|Replaced by R2/.test(t.runs[1] || "") && /^Picked up where you left off: 1 site and 2 screens/.test(back.note) && /^Area 1\|/.test(back.place),
    `${label}: after a reload the project comes back from this browser (${back.cards.join()}; ${t.runs.join(" ; ")}; ${back.note})`);
  await page.screenshot({ path: `/tmp/outofdate-${label}-restored.png` });
  // Deleted: says so, no re-run.
  await page.evaluate(() => { const p = [...window.__ws.places.values()][0]; window.__ws.draw.removeFeatures([p.id]); });
  await page.waitForTimeout(300);
  s = await strip(1);
  check(s.shown && /deleted after this screen/.test(s.text) && !s.btn, `${label}: deleting the site marks R2, with no re-run`);
  t = await tree();
  check(t.sites[0] === "Area 1 (removed)" && t.runs.length === 2, `${label}: a deleted site's screens stay listed under it, marked removed (${t.sites.join()})`);
  // A new project: the page starts empty and the old one is listed, and opens again.
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const d = document.querySelector("#sitetree details"); if (d) d.open = true; });
  await Promise.all([page.waitForNavigation({ timeout: 20000 }).catch(() => {}), page.locator("#sitetree .new-project").click()]);
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(800);
  const fresh = await page.evaluate(() => ({ places: window.__ws.places.size, cards: document.querySelectorAll(".run").length, slot: document.querySelector("#sitetree").hidden }));
  check(fresh.places === 0 && fresh.cards === 0 && fresh.slot, `${label}: "Start a new project" starts an empty page (${JSON.stringify(fresh)})`);
  // Draw a point so the strip shows, then open the earlier project from it.
  await page.evaluate(() => window.__ws.host.addPlace({ feature: { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [-3.6, 55.98] } }, origin: { method: "drawn" }, status: "drawn" }));
  await page.waitForTimeout(400);
  await page.evaluate(() => { const d = document.querySelector("#sitetree details"); if (d) { d.open = true; d.querySelector(".earlier").open = true; } });
  const earlier = await page.evaluate(() => [...document.querySelectorAll("#sitetree .open-project")].map((b) => b.textContent));
  check(earlier.length === 1 && /2 screens/.test(earlier[0]), `${label}: the earlier project is listed (${earlier.join(" | ")})`);
  await page.waitForTimeout(900);
  await Promise.all([page.waitForNavigation({ timeout: 20000 }).catch(() => {}), page.locator("#sitetree .open-project").first().click()]);
  await page.waitForFunction(() => window.__ws?.draw && document.querySelectorAll(".run").length === 2, null, { timeout: 30000 }).catch(() => {});
  check(await page.evaluate(() => document.querySelectorAll(".run").length) === 2, `${label}: opening it brings its screens back`);
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
