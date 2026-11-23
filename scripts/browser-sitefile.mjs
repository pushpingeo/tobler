// Headless browser check of site files (Rob, 23 Nov): a shapefile zip or loose files picked or dropped on the page are
// read in the browser, shown on the map, picked from a card (or in words), and copied into places. The model is
// scripted, so this checks the page and tools, not the model. Desktop and phone. Folder drops (a real person dragging
// a folder from their file manager) can't be simulated headless; a drop of loose files can.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-sitefile.mjs [chrome path].
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { fakeEpsg } from "../test/fake-epsg.mjs";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const FIX = new URL("../test/fixtures/import/", import.meta.url).pathname;
const toolUse = (name, input) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: `t${Date.now()}`, name, input }], usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
let lastSummary = "";
const asked = [];
const epsg = fakeEpsg();
function model(body) {
  const last = body.messages.at(-1);
  if (typeof last.content === "string" || last.content.some((b) => b.type === "text")) {
    const t = typeof last.content === "string" ? last.content : last.content.map((b) => b.text || "").join("\n");
    lastSummary = t;
    if (/use Area B/i.test(t)) return toolUse("use_file_features", { features: ["F2"] });
    if (/coordinates need a decision/.test(t)) { asked.push(t); return text("Its datum isn't one I can match in EPSG. Use it with no datum shift (could be out by tens of metres)?"); }
    if (/without a shift/i.test(t)) return toolUse("set_file_transformation", { layer: "odd_grid", operation: "none" });
    return text("OK.");
  }
  const res = last.content.find((b) => b.type === "tool_result");
  const out = JSON.parse(typeof res.content === "string" ? res.content : res.content[0].text);
  return text(out.made ? `Made ${out.made.map((m) => m.place).join(", ")} from your file.` : "Hmm.");
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);
// Drop files the way a browser does: a drop event with a DataTransfer holding File objects.
async function drop(page, names) {
  const files = names.map((n) => ({ name: n, b64: readFileSync(FIX + n).toString("base64") }));
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    for (const f of files) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name));
    const target = document.querySelector("#map");
    target.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
    window.__overlayShown = document.getElementById("drop-overlay").classList.contains("on");
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, files);
}
const places = (page) => page.evaluate(() => window.__ws.host.places().map((p) => ({ name: p.name, type: p.feature.geometry.type, status: p.status, method: p.origin?.method, role: p.origin?.role, width: p.origin?.buffer_m })));
const lastCard = (page) => page.evaluate(() => { const c = [...document.querySelectorAll(".filecard")].at(-1); return c && { text: c.textContent.replace(/\s+/g, " "), done: c.classList.contains("done") }; });

for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const page = await browser.newPage({ viewport });
  const errors = [], uploads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  // Registry lookups (/epsg) carry an EPSG code or a record path, never the file or its coordinates.
  page.on("request", (r) => {
    if (r.method() !== "POST" || /v1\/messages|\/logs/.test(r.url())) return;
    if (/\/epsg$/.test(r.url()) && !/coordinates|\d+\.\d{4,}/.test(r.postData() || "") && (r.postData() || "").length < 300) return;
    uploads.push(`${r.url()} ${(r.postData() || "").slice(0, 80)}`);
  });
  await page.route(/openfreemap|overpass|wikidata/, (r) => r.abort());
  await page.route(/nominatim/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: /reverse/.test(r.request().url()) ? JSON.stringify({ address: { town: "Linlithgow" } }) : "[]" }));
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/epsg/, async (r) => {
    try { const j = await epsg(JSON.parse(r.request().postData())); r.fulfill({ status: 200, contentType: "application/json", body: typeof j === "string" ? j : JSON.stringify(j) }); }
    catch (e) { r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: e.message }) }); }
  });
  await page.route(/tobler-api.*\/(atlas|logs)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));

  // 1. A zip picked with the tray's file button: one outline, so it's the site straight away.
  await page.click("#drawbtn");
  check(await page.isVisible('.tools [data-action="file"]'), `${label}: the drawing tray has a site-file button`);
  await page.setInputFiles("#site-file", FIX + "redline.zip");
  await page.waitForFunction(() => window.__ws.host.places().length === 1, null, { timeout: 15000 });
  let ps = await places(page);
  check(ps[0].name === "Linlithgow test site" && ps[0].method === "file" && ps[0].role === "footprint" && ps[0].status === "accepted", `${label}: zip → one accepted footprint (${JSON.stringify(ps[0])})`);
  let card = await lastCard(page);
  check(card?.done && /Site set from redline\.zip: Linlithgow test site \(4(\.0)? ha\)/.test(card.text) && /EPSG:1314, OSGB36 to WGS 84 \(6\), good to about 2 m, chosen from the EPSG registry/.test(card.text), `${label}: the card says what was made and how the coordinates were converted (${card?.text.slice(-260)})`);
  const origin = await page.evaluate(() => document.querySelector(".shape .origin summary")?.textContent || "");
  check(/From your file redline\.zip/.test(origin), `${label}: the place card says it came from the file`);
  if (label === "phone") await page.screenshot({ path: `/tmp/sitefile-${label}-1-zip.png` });

  // 2. Loose files dropped (no .prj): the card lists three named areas; two picked as one site in parts.
  await drop(page, ["areas.shp", "areas.dbf"]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 2, null, { timeout: 15000 });
  check(await page.evaluate(() => window.__overlayShown), `${label}: dragging files over the page shows the drop overlay`);
  card = await lastCard(page);
  check(/areas\.shp: 3 polygons\. Which is the site\?/.test(card.text) && /British National Grid \(EPSG:27700\) was assumed from the numbers/.test(card.text), `${label}: the card lists the file and says the coordinate system was guessed`);
  check(await page.evaluate(() => [...document.querySelectorAll(".filecard")].at(-1).querySelector('[data-op="parts"]').disabled), `${label}: nothing picked yet, so nothing to use`);
  await page.evaluate(() => { const c = [...document.querySelectorAll(".filecard")].at(-1); c.querySelectorAll(".feats input")[0].click(); c.querySelectorAll(".feats input")[2].click(); });
  const btn = await page.evaluate(() => { const c = [...document.querySelectorAll(".filecard")].at(-1); return [c.querySelector('[data-op="parts"]').textContent, c.querySelector('[data-op="separate"]').hidden]; });
  check(btn[0] === "Use as one site in parts" && btn[1] === false, `${label}: two picked offers one site in parts or separate sites`);
  const mapPicked = await page.evaluate(() => (window.__ws.map.getSource("sitefile").serialize().data.features || []).filter((f) => f.properties.picked).length);
  check(mapPicked >= 2, `${label}: the picked features are picked out on the map (${mapPicked})`);
  if (label === "phone") await page.screenshot({ path: `/tmp/sitefile-${label}-2-pick.png` });
  await page.evaluate(() => [...document.querySelectorAll(".filecard")].at(-1).querySelector('[data-op="parts"]').click());
  ps = await places(page);
  check(ps.length === 2 && ps[1].name === "areas" && ps[1].type === "MultiPolygon", `${label}: one site in two parts (${JSON.stringify(ps[1])})`);
  check(await page.evaluate(() => (window.__ws.map.getSource("sitefile").serialize().data.features || []).length === 0), `${label}: the file is cleared from the map once used`);

  // 3. A cable line: it needs a width before it can be used; 30 m makes a corridor.
  await page.setInputFiles("#site-file", ["cable.shp", "cable.dbf", "cable.prj", "cable.shx"].map((n) => FIX + n));
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 3, null, { timeout: 15000 });
  const w = await page.evaluate(() => { const c = [...document.querySelectorAll(".filecard")].at(-1); return { hidden: c.querySelector(".width").hidden, what: c.querySelector(".width .what").textContent, disabled: c.querySelector('[data-op="parts"]').disabled }; });
  check(!w.hidden && w.what === "lines" && w.disabled, `${label}: a line asks for a width first (${JSON.stringify(w)})`);
  await page.evaluate(() => [...document.querySelectorAll(".filecard")].at(-1).querySelector('[data-w="30"]').click());
  await page.evaluate(() => [...document.querySelectorAll(".filecard")].at(-1).querySelector('[data-op="parts"]').click());
  ps = await places(page);
  check(ps.length === 3 && ps[2].role === "area" && ps[2].width === 30 && ps[2].type === "Polygon", `${label}: 30 m corridor made (${JSON.stringify(ps[2])})`);

  // 4. Picking in words: the analyst sees the file in the project summary and uses it.
  await drop(page, ["areas.shp", "areas.dbf"]);
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 4, null, { timeout: 15000 });
  await page.fill("#say", "use Area B");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => window.__ws.host.places().length === 4, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 15000 });
  check(/A file is loaded and waiting/.test(lastSummary) && /"label":"Area B"/.test(lastSummary), `${label}: the analyst was told what's in the file (labels, not coordinates)`);
  check(!/coordinates":\[\[/.test(lastSummary), `${label}: no coordinates in what the analyst sees`);
  ps = await places(page);
  card = await lastCard(page);
  check(ps[3].name === "Area B" && ps[3].status === "accepted" && card.done, `${label}: Area B made from words, and the card closed`);

  // 5. A datum EPSG can't be matched: the analyst asks in words (coordinate-reference skill), then settles it.
  await page.setInputFiles("#site-file", ["odd_grid.shp", "odd_grid.dbf", "odd_grid.prj"].map((n) => FIX + n));
  await page.waitForFunction(() => document.querySelectorAll(".filecard").length === 5, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 15000 });
  card = await lastCard(page);
  check(!card.done && /needs a decision.*Waiting for your answer in the chat/.test(card.text), `${label}: a layer needing a judgement waits on the card (${card.text.slice(0, 160)})`);
  check(/coordinate-reference skill/.test(asked.at(-1) || "") && /I've dropped odd_grid/.test(await page.evaluate(() => [...document.querySelectorAll(".msg.user")].at(-1).textContent)), `${label}: the analyst is asked to put the question, with the skill`);
  await page.waitForTimeout(800);
  if (label === "phone") await page.screenshot({ path: `/tmp/sitefile-${label}-2b-decision.png` });
  await page.fill("#say", "go ahead without a shift");
  await page.click("#ask button[type=submit]");
  await page.waitForFunction(() => window.__ws.host.places().length === 5, null, { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector("#ask.busy"), null, { timeout: 15000 });
  ps = await places(page);
  const oddCrs = await page.evaluate(() => window.__ws.host.places().at(-1).origin.crs);
  check(ps[4].name === "Odd block" && /no datum shift/.test(oddCrs.warning || "") && oddCrs.chosen_by === "the person", `${label}: settled in words, made the site, and flagged (${JSON.stringify(oddCrs).slice(0, 120)})`);

  // 6. Something unusable is explained.
  await drop(page, ["areas.dbf"]);
  await page.waitForFunction(() => /Nothing in/.test(document.querySelector("#conversation").lastElementChild.textContent), null, { timeout: 15000 });
  const last = await page.evaluate(() => document.querySelector("#conversation").lastElementChild.textContent);
  check(/no matching \.shp/.test(last), `${label}: a .dbf on its own is explained`);
  if (label === "phone") await page.screenshot({ path: `/tmp/sitefile-${label}-3-end.png` });
  else await page.screenshot({ path: `/tmp/sitefile-${label}.png` });

  check(!uploads.length, `${label}: nothing was uploaded${uploads.length ? `: ${uploads.join(", ")}` : ""}`);
  check(!errors.length, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
const failed = results.filter((r) => r.startsWith("FAIL")).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
