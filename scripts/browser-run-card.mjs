// Headless browser check of a screening run in the workspace: the conversation calls screen_site, the sealed run
// fetches (atlas and model scripted, no network, no cost), the run card appears with flags first, the slider filters
// the map, re-assess replaces the flags, a flag picks out its evidence, the card switches to inside the area only and
// back, an inside-only screen, and the settings gear (units, shape colour, licence switches). Screenshots at desktop
// and phone sizes.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-run-card.mjs [chrome path].
import { chromium } from "playwright-core";
import { cite } from "./scripted-refs.mjs";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const FIELD = [-3.95, 60.98];
const east = (km) => turf.destination(FIELD, 5 + km, 90).geometry.coordinates;
const half = 5 / 111.32, halfLon = 5 / (111.32 * Math.cos(FIELD[1] * Math.PI / 180));
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const SQUARE = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[FIELD[0] - halfLon, FIELD[1] - half], [FIELD[0] + halfLon, FIELD[1] - half], [FIELD[0] + halfLon, FIELD[1] + half], [FIELD[0] - halfLon, FIELD[1] + half], [FIELD[0] - halfLon, FIELD[1] - half]].map((c) => c.map(r6))] } };

const atlasLog = [];
function atlas(tool, args) {
  atlasLog.push({ tool, args });
  if (tool === "find_datasets" && /pipeline/i.test(args.text || "")) return { matches: 1, results: [{ id: "pipe", title: "UKCS pipelines (WGS84)", publisher: "North Sea Transition Authority", capabilities: ["query"], licence: "NSTA Open User Licence" }] };
  if (tool === "find_datasets" && /wreck/i.test(args.text || "")) return { matches: 1, results: [{ id: "wreck", title: "Worldwide wreck locations (UK Hydrographic Office)", publisher: "EMODnet Human Activities", capabilities: ["query"], licence: "Creative Commons CC-BY 4.0" }] };
  if (tool === "find_datasets") return { matches: 0, results: [] };
  // MARPOL's North West European waters: a wide area the field lies within ("around the site").
  if (tool === "fetch_features" && args.id === "751ddc65885f897d") return { returned: 1, features: [{ type: "Feature", geometry: turf.bboxPolygon([-15, 48, 10, 64]).geometry, properties: { name: "North West European waters" } }] };
  // Since 26 Nov the screen's analyst has no tools: the pipelines come from the subsea pipelines check (Crown Estate
  // Scotland's layer), and the wreck layer is offered after the run and fetched only on a yes.
  if (tool === "fetch_features" && (args.id === "pipe" || args.id === "c026fa004eab396c")) {
    const line = (a, name) => ({ type: "Feature", geometry: { type: "LineString", coordinates: [a, turf.destination(a, 2, 0).geometry.coordinates] }, properties: { PIPE_NAME: name, Lease_Description: name } });
    return { returned: 3, features: [line(FIELD, "Rosebank 9 inch Production flowline 1"), line(east(1.5), "West of Shetland Pipeline"), line(east(30), "Clair export")] };
  }
  if (tool === "fetch_features" && args.id === "wreck") return { returned: 2, features: [
    { type: "Feature", geometry: { type: "Point", coordinates: east(2) }, properties: { name: "TROLDFOS (POSSIBLY)" } },
    { type: "Feature", geometry: { type: "Point", coordinates: east(45) }, properties: { name: "FAR WRECK" } }] };
  // UK layers (24 Nov): JNCC's offshore layer has a SAC 25 km out; NatureScot's SPA layer is down, so the SPA check is
  // only partly checked and says so (none found in the rest isn't "none found").
  if (tool === "fetch_features" && args.id === "1d6371b702df0abc") return { returned: 1, features: [{ type: "Feature", geometry: turf.circle(turf.destination(FIELD, 30, -60).geometry.coordinates, 5).geometry, properties: { SITE_NAME: "Wyville Thomson Ridge", SITE_CODE: "UK0030354", SITE_STATU: "SAC" } }] };
  if (tool === "fetch_features" && args.id === "b10cb9d7a2892f7f") throw new Error("NatureScot's service didn't answer (503)");
  return { matches: 0, results: [], returned: 0, features: [] };
}

const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
const RESULT = "Screened as an offshore oil field (assumed, greenfield).\n\n" + json({ decision: "progress with targeted investigation", decision_why: "Live pipelines and a SAC need checking; nothing found so far should stop it.", flags: [
  { risk: "Existing pipelines on and near the site (simultaneous operations)", theme: "PS4", severity: "high", confidence: "high", next_step: "Agree crossing and proximity arrangements with the pipeline operators", why: "Work beside live lines needs SIMOPS planning.", evidence: [{ name: "Rosebank 9 inch Production flowline 1", distance_km: 0, dataset: "UKCS pipelines (WGS84)" }, { name: "West of Shetland Pipeline", distance_km: 1.5, dataset: "UKCS pipelines (WGS84)" }] },
  { risk: "A Special Area of Conservation in the wider band may need an appropriate assessment", theme: "PS6", severity: "medium", confidence: "medium", why: "Spill and noise reach.", evidence: [{ name: "Wyville Thomson Ridge" }] },
  { risk: "Seabird colonies on Shetland may be in spill reach", theme: "PS6", severity: "medium", confidence: "low", why: "Regional knowledge, not mapped data.", evidence: [{ name: "Foula seabird colony", distance_km: 40, dataset: "none (regional knowledge)" }] },
], checked: [], data_gaps: ["Key Biodiversity Areas not checked", "Fishing effort not checked", "No Indigenous Peoples data in the catalogue here", "Stage assumed to be greenfield"],
  look_for: [{ what: "Shipwrecks", words: ["wreck"], topic: "heritage" }] });
const REASSESS = "Within 1 km only the field's own lines matter.\n\n" + json({ flags: [{ risk: "Existing flowlines on site", theme: "PS4", confidence: "high", why: "SIMOPS.", evidence: [{ name: "Rosebank 9 inch Production flowline 1", distance_km: 0, dataset: "UKCS pipelines (WGS84)" }] }], data_gaps: ["Key Biodiversity Areas not checked"] });

const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const calls = { screen: [], conversation: [] };
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  const n = body.messages.length;
  const first = String(body.messages[0]?.content || "");
  if (/one sealed screen/.test(sys)) {
    if (/^Re-assess/.test(first)) return text(cite(REASSESS, body));
    calls.screen.push(body);
    return { ...text(cite(RESULT, body)), held: true };
  }
  calls.conversation.push(body);
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Screened Area 1: live pipelines on and next to the field are the main flag, then a wreck 2 km east. Key Biodiversity Areas and fishing effort weren't checked.");
  const asked = JSON.stringify(body.messages);
  return toolUse(["screen_site", { place: "Area 1", asset_type: "oil-gas-field", assumed: true, ...(/only inside/.test(asked) ? { extent: "inside" } : {}) }]);
}

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader"] });
const results = [];
const check = (ok, what) => { results.push(`${ok ? "PASS" : "FAIL"} ${what}`); };
for (const [label, viewport] of [["desktop", { width: 1280, height: 820 }], ["phone", { width: 390, height: 844 }]]) {
  const log0 = atlasLog.length;
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|tiles|openfreemap/i.test(m.text())) errors.push(m.text()); });
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  // The sealed run's write-up is held back 3 s, so the progress block can be seen while it runs.
  await page.route(/tobler-api.*\/v1\/messages/, async (r) => {
    const out = model(JSON.parse(r.request().postData()));
    if (out.held) { delete out.held; await new Promise((ok) => setTimeout(ok, 3000)); }
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(out) });
  });
  // Water depth (NOAA) and vessel traffic (EMODnet), read in code for sites at sea.
  await page.route(/gis\.ngdc\.noaa\.gov/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ samples: [-110, -120, -130].map((v) => ({ value: String(v), resolution: 0.004 })) }) }));
  await page.route(/emodnet-humanactivities/, (r) => r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ features: [{ properties: { GRAY_INDEX: /allavg/.test(r.request().url()) ? 0.3 : 0.1 } }] }) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); let out; try { out = { result: { structuredContent: atlas(b.params.name, b.params.arguments) } }; } catch (e) { out = { error: { code: -32000, message: e.message } }; } r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...out }) }); });
  // Session logs the page sends while sharing is on.
  const logs = [];
  await page.route(/tobler-api.*\/logs/, (r) => { logs.push({ raw: r.request().postData(), body: JSON.parse(r.request().postData()) }); r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }); });
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // The welcome card's note about saving sessions, and its link into settings at the switch.
  const note = await page.evaluate(() => document.querySelector(".welcome .note")?.textContent || "");
  check(/Conversations are saved so we can improve it\. You can turn this off in settings\./.test(note), `${label}: welcome card says sessions are saved, with a way to turn it off`);
  await page.click(".welcome [data-open-settings]");
  await page.waitForSelector("#settings[open]");
  check(await page.evaluate(() => document.activeElement?.name === "shareSessions" && document.activeElement.checked), `${label}: "settings" in the note opens the dialog at the switch, on by default`);
  await page.click("#settings .close");
  // Drawing tools: a tray by the input; the hint has Cancel while drawing and stays clear of the panel.
  const rect = (sel) => page.evaluate((q) => { const e = document.querySelector(q); if (!e || e.hidden) return null; const r = e.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; }, sel);
  const overlap = (a, b) => !!(a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b);
  check(await page.evaluate(() => document.getElementById("tools").hidden), `${label}: drawing tools tucked away at first`);
  // No chips before there's a place (18 Nov, a quieter composer). Skill chips marked "soon" came back on 24 Nov (Rob),
  // but only in the row that shows once there's a place.
  check(await page.evaluate(() => document.querySelector(".chips").hidden && !document.querySelector(".composer .links") && ![...document.querySelectorAll(".chip.soon")].some((c) => c.offsetParent)), `${label}: no chips before there's a place; no links or visible "soon" chips under the input`);
  await page.click("#drawbtn");
  await page.click('#tools [data-mode="polygon"]');
  let h = await page.evaluate(() => ({ text: document.querySelector("#hint .hint-text").textContent, cancel: !document.querySelector('#hint [data-hint="cancel"]').hidden, mode: window.__ws.draw.getMode(), tray: !document.getElementById("tools").hidden }));
  check(h.tray && h.mode === "polygon" && h.cancel && /corners/.test(h.text), `${label}: tray open, drawing an area, hint with Cancel (${h.text.slice(0, 30)})`);
  check(label === "phone" || !overlap(await rect("#hint"), await rect("#panel")), `${label}: hint clear of the panel`);
  await page.screenshot({ path: `/tmp/ux-${label}-drawing.png` });
  await page.click('#hint [data-hint="cancel"]');
  h = await page.evaluate(() => ({ hidden: document.getElementById("hint").hidden, mode: window.__ws.draw.getMode() }));
  check(h.hidden && h.mode === "select", `${label}: Cancel stops drawing`);
  await page.click('#tools [data-action="done"]');
  check(await page.evaluate(() => document.getElementById("tools").hidden), `${label}: Done closes the tray`);
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "words", words: "Rosebank", confidence: "high", anchor: { name: "Rosebank", source: { title: "UKCS offshore hydrocarbon fields (WGS84)", publisher: "North Sea Transition Authority", licence: "not stated" } }, steps: ["outline of Rosebank"], at: new Date().toISOString() } }), SQUARE);
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  // A shape card: one row of actions; a click on the shape only focuses its card; Adjust gives handles and controls.
  const card = () => page.evaluate(() => { const c = document.querySelector(".shape"); const ws = window.__ws; return {
    accept: !c.querySelector('[data-op="accept"]').hidden, delInRow: !!c.querySelector('.actions [data-op="delete"]'), adjustOpen: !c.querySelector(".adjust").hidden,
    help: c.querySelector(".adjust-help").textContent, hint: !document.getElementById("hint").hidden, active: c.classList.contains("active"),
    selected: ws.draw.getSnapshot().some((f) => f.properties?.selected) }; });
  // The chip asks what's planned there first (no model call): quick picks for the setting, More…, a general screen.
  await page.click(".chip[data-screen]");
  await page.waitForSelector(".asset-pick");
  const chip = await page.evaluate(() => ({ shown: !document.querySelector(".chips").hidden, text: document.querySelector(".chip[data-screen]").textContent,
    picks: [...document.querySelectorAll(".asset-pick .picks button")].map((b) => b.textContent) }));
  check(chip.shown && chip.text === "Screen for environmental constraints" && chip.picks[0] === "Offshore wind" && chip.picks.length === 8 && chip.picks.includes("More…") && chip.picks.at(-1) === "Just a general screen",
    `${label}: one chip once there's a place; it asks what's planned, with picks for the sea (${chip.picks.join(", ")})`);
  await page.evaluate(() => document.querySelector(".asset-pick").remove());
  let c = await card();
  check(c.accept && c.delInRow && !c.adjustOpen && !c.hint, `${label}: card: Use this area, Adjust and delete in one row; no banner`);
  await page.evaluate(() => { const id = [...window.__ws.places.keys()][0]; window.__ws.draw.selectFeature(id); });
  await page.waitForTimeout(150);
  c = await card();
  check(c.active && !c.selected && !c.hint && !c.adjustOpen, `${label}: clicking the shape focuses its card, no handles, no banner`);
  await page.click('.shape [data-op="adjust"]');
  await page.waitForTimeout(150);
  c = await card();
  check(c.adjustOpen && c.selected && !c.hint && /reshape/.test(c.help), `${label}: Adjust: handles on, rotate and resize shown, help on the card, no banner`);
  await page.$eval(".shape", (e) => e.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: `/tmp/ux-${label}-adjust.png` });
  await page.click('.shape [data-op="adjust-done"]');
  await page.waitForTimeout(150);
  c = await card();
  check(!c.adjustOpen && !c.selected, `${label}: Done: controls closed, handles off`);
  await page.fill("#say", "Screen Area 1 for risks");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".progress", { timeout: 20000 });
  await page.waitForTimeout(1200);
  const pr = await page.evaluate(() => ({ title: document.querySelector(".progress-title")?.textContent || "", step: document.querySelector(".progress-step")?.textContent || "",
    width: parseFloat(document.querySelector(".progress-bar span")?.style.width || "0"), globe: document.getElementById("activity").classList.contains("busy") && getComputedStyle(document.querySelector("#activity .globe")).display !== "none" }));
  check(/usually takes about/.test(pr.title) && /\d+ s/.test(pr.step) && pr.width > 0, `${label}: progress shown while screening (${pr.title.slice(0, 60)} | ${pr.step.slice(0, 50)} | ${pr.width}%)`);
  check(pr.globe, `${label}: spinning globe while busy`);
  check(!/\b[CD]\d+\b/.test(pr.step), `${label}: no internal ids in the progress line (${pr.step.slice(0, 50)})`);
  await page.$eval(".progress", (e) => e.scrollIntoView({ block: "end" }));
  await page.screenshot({ path: `/tmp/ux-${label}-progress.png` });
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  check(await page.evaluate(() => !document.querySelector(".progress") && /^R1 · \d/.test(document.querySelector(".run .meta").textContent) && !/method/.test(document.querySelector(".run .meta").textContent) && /took \d+ s/.test(document.querySelector(".run .meta").title)), `${label}: progress gone; the card shows the run and time, the method and timing on hover`);
  await page.waitForTimeout(300);
  const lg = logs.find((l) => /Screen/.test(l.body.log?.user || ""));
  check(!!lg && lg.body.seq >= 0 && /^[0-9a-f-]{36}$/.test(lg.body.session) && lg.body.log.events.some((e) => e.tool === "screen_site") && lg.raw.length < 120_000 && !/"coordinates"/.test(lg.raw),
    `${label}: the screening turn's log was sent, trimmed (${lg ? Math.round(lg.raw.length / 1000) : 0} KB, ${lg?.body.log.events.length} events, no raw coordinates)`);
  await page.waitForTimeout(800);
  const st = () => page.evaluate(() => ({
    flags: [...document.querySelectorAll(".run .flag .risk")].map((e) => e.textContent),
    beyond: document.querySelectorAll(".run .flag.beyond").length,
    stale: !document.querySelector(".run .stale").hidden,
    out: document.querySelector(".run .reach output").textContent,
    nearest: document.querySelector(".run .nearest").textContent,
    onMap: window.__ws.map.getSource("findings")._data.features.length,
    hl: window.__ws.map.getSource("hl")._data.features?.length ?? 0,
    checked: document.querySelector(".run .checked summary").textContent,
    gaps: document.querySelector(".run .gaps summary").textContent,
    gapHeads: [...document.querySelectorAll(".run .gaps .gap-head")].map((e) => e.textContent),
    gapText: document.querySelector(".run .gaps")?.textContent || "",
    gapLines: [...document.querySelectorAll(".run .gaps .gap-group.couldnt li")].map((e) => e.textContent),
    checks: (() => { const c = document.querySelector(".run .checks"); if (!c || c.hidden) return null;
      return { summary: c.querySelector(":scope > summary").textContent, open: c.open, heads: [...c.querySelectorAll(".check-head")].map((e) => e.textContent),
        lines: [...c.querySelectorAll("li.check")].map((e) => ({ text: e.textContent, cls: e.className })), nocheck: c.querySelector(".nocheck summary").textContent,
        nocheckShown: !c.querySelector(".nocheck").hidden, visible: c.getBoundingClientRect().width > 0 }; })(),
    dists: document.querySelector(".run .dists").textContent,
    sea: document.querySelector(".run .sea").hidden ? "" : document.querySelector(".run .sea").textContent,
    scopeShown: !document.querySelector(".run .scope").hidden,
    insideChecked: document.querySelector('.run [data-scope="inside"]').getAttribute("aria-checked") === "true",
    sliderShown: !document.querySelector(".run input[type=range]").hidden,
    mask: window.__ws.map.getSource("mask")._data.features?.length ?? 0,
    rings: window.__ws.map.getSource("rings")._data.features?.length ?? 0,
    staleText: document.querySelector(".run .stale button").textContent,
    reply: [...document.querySelectorAll(".msg.analyst")].at(-1).textContent.slice(0, 120),
    decision: document.querySelector(".run .decision").hidden ? "" : document.querySelector(".run .decision").textContent,
    next: document.querySelector(".run .flag .next")?.textContent || "",
  }));
  let s = await st();
  // The seabird flag cites regional knowledge, nothing the run found, so it isn't raised (25 Nov): two flags.
  check(s.flags.length === 2 && /pipelines/.test(s.flags[0]), `${label}: two flags, high first; the untraced one isn't raised (${s.flags[0]})`);
  check(/^Progress with targeted investigation\. Live pipelines/.test(s.decision), `${label}: decision line first on the card (${s.decision.slice(0, 50)})`);
  check(/^F-01/.test(s.flags[0]) && /F-02/.test(s.flags[1]), `${label}: findings numbered F-01 to F-02`);
  // Bring in a layer after the run (plan item 1, 26 Nov): the screen's analyst had no tools, the reply offered the wreck
  // layer the analyst named in look_for, and nothing was fetched until the button.
  check(calls.screen.length > 0 && calls.screen.every((b) => !b.tools), `${label}: the screen's model call had no tools (${calls.screen.length} calls)`);
  const offer = await page.evaluate(() => {
    const card = document.querySelector(".layer-offer");
    const reply = card?.previousElementSibling;
    return { buttons: [...(card?.querySelectorAll("button") || [])].map((b) => b.textContent), title: card?.querySelector("button")?.title || "",
      replyText: reply?.textContent || "", afterReply: !!reply?.classList.contains("msg") && !reply.classList.contains("run") };
  });
  check(offer.buttons.join("|") === "Worldwide wreck locations (UK Hydrographic Office)|No thanks" && /EMODnet Human Activities · CC BY 4\.0 · for shipwrecks/.test(offer.title),
    `${label}: one button per layer offered, and No thanks (${offer.buttons.join("|")})`);
  check(offer.afterReply && /Bring it in\? Use the buttons below/.test(offer.replyText) && /Nothing is added unless you say so/.test(offer.replyText), `${label}: the offer sits under the reply that asks (${offer.replyText.slice(-120)})`);
  check(!atlasLog.slice(log0).some((a) => a.tool === "fetch_features" && a.args.id === "wreck" && a.args.limit > 1), `${label}: the wreck layer wasn't fetched before a yes`);
  const nConv = calls.conversation.length;
  await page.click(".layer-offer button");
  await page.waitForFunction(() => /Brought in for R1/.test(document.querySelector("#conversation .msg.analyst:last-of-type")?.textContent || "") || [...document.querySelectorAll("#conversation .msg.analyst")].some((m) => /Brought in for R1/.test(m.textContent)), null, { timeout: 20000 });
  const got = await page.evaluate(() => ({
    reply: [...document.querySelectorAll("#conversation .msg.analyst")].map((m) => m.textContent).find((t) => /Brought in for R1/.test(t)) || "",
    added: document.querySelector('.run[data-run="R1"] .added')?.hidden === false ? document.querySelector('.run[data-run="R1"] .added').textContent : "",
    done: document.querySelector(".layer-offer").classList.contains("done"),
  }));
  check(/Worldwide wreck locations \(UK Hydrographic Office\) \(EMODnet Human Activities; CC BY 4\.0; checked \d{4}-\d\d-\d\d\): 2 features within/.test(got.reply) && /made without it\. Explore it on the map; to have it judged, ask me to re-run the screen, which will include it\./.test(got.reply),
    `${label}: the reply after the button is code's, with source, licence and date (${got.reply.slice(0, 400)})`);
  check(calls.conversation.length === nConv, `${label}: no model call for the button (${calls.conversation.length - nConv})`);
  check(atlasLog.slice(log0).some((a) => a.tool === "fetch_features" && a.args.id === "wreck" && a.args.limit > 1), `${label}: the wreck layer was fetched on the yes`);
  check(/^Brought in after the run \(1\)/.test(got.added) && /made without these/.test(got.added) && got.done, `${label}: the run card lists what came in, apart from the run's own evidence; the offer is closed (${got.added.slice(0, 80)})`);
  await page.screenshot({ path: `/tmp/ux-${label}-bring-in.png` });
  check(/^Next step: Agree crossing/.test(s.next), `${label}: a flag shows its next step (${s.next.slice(0, 40)})`);
  // Feedback (Rob, 22 Nov): thumbs and a "Something's wrong?" box on the run card and on the reply, each sent to the
  // session log beside the turn. Thumbs down opens the box; an empty note isn't sent.
  {
    const n0 = logs.length;
    const fb = await page.evaluate(() => ({ run: !!document.querySelector(".run .feedback .fb-down"), reply: document.querySelectorAll(".msg.analyst:not(.run):not(.shape) .feedback").length }));
    check(fb.run && fb.reply >= 1, `${label}: feedback rows on the run card and the analyst's reply (${fb.reply} reply rows)`);
    await page.locator(".run .feedback .fb-down").scrollIntoViewIfNeeded();
    await page.click(".run .feedback .fb-down");
    const box = await page.evaluate(() => ({ open: !document.querySelector(".run .feedback .fb-box").hidden, focus: document.activeElement?.tagName, said: document.querySelector(".run .feedback .fb-said").textContent, pressed: document.querySelector(".run .feedback .fb-down").getAttribute("aria-pressed") }));
    check(box.open && box.focus === "TEXTAREA" && box.said === "Thanks." && box.pressed === "true", `${label}: thumbs down is marked, thanks you, and opens the note box`);
    await page.click(".run .feedback .fb-send");
    check(logs.length === n0 + 1, `${label}: an empty note isn't sent (only the thumbs went: ${logs.length - n0})`);
    await page.fill(".run .feedback textarea", "Missed the pipeline   crossing");
    await page.click(".run .feedback .fb-send");
    await page.waitForTimeout(300);
    const sent = logs.slice(n0).map((l) => l.body.log.feedback);
    check(sent.length === 2 && sent[0].on === "run" && sent[0].run === "R1" && sent[0].rating === "down" && !sent[0].note && sent[1].note === "Missed the pipeline crossing" && sent[1].rating === "down" && /^R1 Area 1/.test(sent[1].about || ""),
      `${label}: run-card feedback sent with its run, rating and note (${JSON.stringify(sent[1]).slice(0, 120)})`);
    check(await page.evaluate(() => document.querySelector(".run .feedback .fb-box").hidden && document.querySelector(".run .feedback .fb-said").textContent === "Thanks, that's sent."), `${label}: the box closes and says it's sent`);
    await page.locator(".msg.analyst:not(.run):not(.shape) > .feedback .fb-up").first().scrollIntoViewIfNeeded();
    await page.locator(".msg.analyst:not(.run):not(.shape) > .feedback .fb-up").first().click();
    await page.waitForTimeout(200);
    const up = logs.at(-1).body.log.feedback;
    check(up.on === "reply" && up.rating === "up" && !!up.turn_at, `${label}: thumbs up on a reply is sent with the turn it's about`);
    await page.locator(".run .feedback").screenshot({ path: `/tmp/feedback-${label}.png` }).catch(() => {});
  }
  // The report (and share link): opens in a new tab from the run's link, draws both maps, prints to A4.
  await page.context().route(/openfreemap/, (r) => r.abort());
  const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
  const repErrors = [];
  rp.on("pageerror", (e) => repErrors.push(e.message));
  await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 45000 }).catch(() => {});
  const rep = await rp.evaluate(() => ({
    url: location.href.length, h1: document.querySelector("h1")?.textContent, error: window.__report?.error || "",
    decision: document.querySelector(".decision")?.textContent || "",
    rows: [...document.querySelectorAll(".findings tbody tr")].map((tr) => tr.querySelector(".id").textContent),
    next: document.querySelector(".findings .next")?.textContent || "",
    imgs: [...document.querySelectorAll("figure img")].map((i) => i.src.length),
    failed: document.querySelectorAll(".checked tr.failed").length, sources: document.querySelectorAll(".sources li").length,
    disclaimer: document.querySelector(".disclaimer")?.textContent || "",
  }));
  check(!rep.error && rep.h1 === "Constraints screenArea 1" && /^Progress with targeted investigation\./.test(rep.decision), `${label}: report opens from the link with the site and decision (${rep.error || rep.h1}; ${rep.url} chars)`);
  check(rep.rows.join(",") === "F-01,F-02" && /^Next step: Agree crossing/.test(rep.next), `${label}: report has one row per finding with its next step (${rep.rows.join(",")})`);
  check(rep.imgs.length === 2 && rep.imgs.every((n) => n > 5000), `${label}: both maps drawn and copied as pictures for print (${rep.imgs.join(", ")})`);
  check(rep.sources > 0 && /Indicative desk screening/.test(rep.disclaimer), `${label}: sources and disclaimer in the report (${rep.sources} sources)`);
  check(!repErrors.length, `${label}: no errors on the report page${repErrors.length ? `: ${repErrors.join(" | ").slice(0, 200)}` : ""}`);
  await rp.screenshot({ path: `/tmp/report-${label}.png`, fullPage: true });
  if (label === "desktop") { await rp.emulateMedia({ media: "print" }); await rp.pdf({ path: "/tmp/report.pdf", format: "A4", printBackground: true, preferCSSPageSize: true }); }
  await rp.close();
  // Without clipboard permission (Rob's desktop app refused it, 20 Nov): the older copy command, or the link shown selected.
  await page.context().clearPermissions();
  await page.click('.run [data-op="share"]');
  await page.waitForFunction(() => /Link copied|won't let Tobler copy|couldn't/.test(document.querySelector(".run .share-note")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
  const denied = await page.evaluate(() => ({ note: document.querySelector(".run .share-note").textContent, shown: document.querySelector(".run .share-note .share-link")?.value || "" }));
  check(/^Link copied/.test(denied.note) || (/won't let Tobler copy/.test(denied.note) && /\/report\.html#v1\./.test(denied.shown)), `${label}: with the clipboard refused, the link is still copied or shown to copy (${denied.note.slice(0, 50)})`);
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://localhost:8000" });
  await page.click('.run [data-op="share"]');
  await page.waitForFunction(() => /Link copied|couldn't/.test(document.querySelector(".run .share-note")?.textContent || ""), null, { timeout: 10000 }).catch(() => {});
  const copied = await page.evaluate(async () => ({ note: document.querySelector(".run .share-note").textContent, clip: await navigator.clipboard.readText().catch(() => "") }));
  check(/^Link copied/.test(copied.note) && /\/report\.html#v1\./.test(copied.clip), `${label}: Copy share link copies the report's link (${copied.note.slice(0, 40)})`);
  check(s.out === "50 km" && s.onMap === 4, `${label}: slider at 50 km, 3 findings (two pipelines from the check, the UK SAC) and the wide area on the map (${s.out}, ${s.onMap})`);
  check(/near 2 km · close 10 km · wider 50 km/.test(s.dists), `${label}: distances and reason shown`);
  check(s.sea === "Water depth about 120 m, 110–130 m across the site (NOAA). Vessel traffic: light on the site (0.3 h/km² a month) (AIS 2023, EMODnet).", `${label}: water depth and vessel traffic on the card (${s.sea.slice(0, 80)})`);
  await page.$eval(".run", (e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: `/tmp/run-card-${label}-1.png` });
  await page.$eval(".run input[type=range]", (el) => { el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  s = await st();
  check(s.onMap === 2 && s.out === "1 km", `${label}: slider to 1 km leaves 1 finding and the wide area on the map (${s.onMap})`);
  check(s.stale && s.beyond === 1, `${label}: re-assess offered, wreck flag dimmed as beyond (${s.beyond})`);
  check(/Nearest: material assets, Rosebank 9 inch Production flowline 1 \(on site\)/.test(s.nearest), `${label}: nearest-by-topic line (the check's topic) (${s.nearest})`);
  check(/lies within a wide area: North West European waters\./.test(s.nearest) && !/Nearest:[^.]*North West European/.test(s.nearest), `${label}: a wide area around the site is counted apart, not as on site (${s.nearest})`);
  // Checks (plan item 1): UK waters, so the UK's own layers (24 Nov) beside the EU's; one SPA layer down; the run's
  // active faults (global, 24 Nov coverage drive) put Hazards in too;
  // checks by topic in three states; the topics nothing checks yet in one line; open on a desktop, closed on a phone.
  const ck = s.checks;
  await page.evaluate(() => { const c = document.querySelector(".run .checks"); c.open = true; c.querySelector(".nocheck").open = true; });
  await page.locator(".run .checks").screenshot({ path: `/tmp/run-card-${label}-checks.png` }).catch(() => {});
  await page.evaluate((open) => { const c = document.querySelector(".run .checks"); c.open = open; c.querySelector(".nocheck").open = false; }, ck?.open ?? false);
  check(ck && /^Checks: \d+ \(\d+ found, \d+ none found, \d+ not checked\)$/.test(ck.summary), `${label}: checks section with its summary (${ck?.summary})`);
  check(ck && ck.heads.join("|") === "Biodiversity|Hazards|Material assets|Topography and bathymetry|Context", `${label}: checks grouped by topic in order (${ck?.heads.join(", ")})`);
  check(ck && ck.lines.some((l) => /^Special Areas of Conservation\s*must: 1 within 50 km .*nearest Wyville Thomson Ridge/.test(l.text) && /found/.test(l.cls))
    && ck.lines.some((l) => /^Special Protection Areas \(birds\)\s*must: not checked: NatureScot didn't answer \(none in the others\)$/.test(l.text) && /\bnc\b/.test(l.cls))
    && ck.lines.some((l) => /^MARPOL special areas: the site is inside North West European waters/.test(l.text) && /found/.test(l.cls))
    && ck.lines.some((l) => /^Water depth: about 120 m/.test(l.text))
    && ck.lines.some((l) => /none found within/.test(l.text) && /\bnone\b/.test(l.cls)), `${label}: one check of each state (${ck?.lines.map((l) => l.text.slice(0, 40)).join(" | ")})`);
  check(ck && ck.nocheckShown && /^\d+ topics have no standard check yet$/.test(ck.nocheck), `${label}: topics with no check in one summary line (${ck?.nocheck})`);
  check(ck && ck.open === (label === "desktop"), `${label}: checks open on a desktop, closed on a phone (${ck?.open})`);
  check(s.gapLines.some((l) => /^No standard check yet for water, ground and soil/.test(l)) && s.gapLines.some((l) => /Special Protection Areas \(SPA\), Scotland \(NatureScot\)/.test(l)), `${label}: pending checks and unchecked topics in what still needs checking`);
  // Exploring the findings (24 Nov): a check line opens its features by distance; a row flies the map and opens a popup
  // that says which checks counted it; the map key's theme opens the same kind of list.
  await page.evaluate(() => { document.querySelector(".run .checks").open = true; });
  await page.locator('.run li.check[data-check="bio.sac"] .check-line').click();
  const opened = await page.evaluate(() => { const li = document.querySelector('.run li.check[data-check="bio.sac"]');
    return { open: li.classList.contains("open"), aria: li.querySelector(".check-line").getAttribute("aria-expanded"), rows: [...li.querySelectorAll(".feat")].map((b) => b.textContent),
      visible: li.querySelector(".feat-list").getBoundingClientRect().height > 0, hl: window.__ws.map.getSource("hl")._data.features.length,
      src: li.querySelector(".feat-src")?.textContent || "", bold: li.querySelector(".feat .feat-dist")?.textContent || "",
      others: [...document.querySelectorAll(".run li.check.open")].length }; });
  // Rows lead with the distance in bold; a list from one layer names it once above the rows, not on each (24 Nov).
  check(opened.open && opened.aria === "true" && opened.visible && /^\d[\d.,]* (km|mi)Wyville Thomson Ridge/.test(opened.rows[0] || "") && /^\d/.test(opened.bold)
    && /^From .*(JNCC|Joint Nature)/.test(opened.src) && opened.hl === 1 && opened.others === 1,
    `${label}: tapping a check line opens its features by distance, nearest in bold, the layer named once, and outlines them (${opened.src}: ${opened.rows.join(" | ")}; hl ${opened.hl})`);
  await page.locator('.run li.check[data-check="bio.sac"] .feat').first().click();
  await page.waitForTimeout(800);
  const flown = await page.evaluate(() => ({ pop: document.querySelector(".maplibregl-popup .finding-pop")?.textContent || "", hl: window.__ws.map.getSource("hl")._data.features.map((f) => f.properties.label),
    sheet: document.getElementById("panel").classList.contains("collapsed") }));
  check(/Wyville Thomson Ridge/.test(flown.pop) && /Counted in: Special Areas of Conservation/.test(flown.pop) && flown.hl.join() === "Wyville Thomson Ridge" && flown.sheet === (label === "phone"),
    `${label}: a row flies to the feature; the popup says which checks counted it${label === "phone" ? "; the sheet lowers" : ""} (${flown.pop.slice(0, 90)})`);
  await page.screenshot({ path: `/tmp/explore-${label}-flown.png` });
  if (label === "phone") { await page.click("#handle"); await page.waitForTimeout(300); }
  await page.locator('.run li.check[data-check="bio.sac"] .check-line').click();
  check(await page.evaluate(() => !document.querySelector('.run li.check[data-check="bio.sac"]').classList.contains("open") && !window.__ws.map.getSource("hl")._data.features.length), `${label}: tapping it again closes the list and clears the outline`);
  // The map key: a theme's name opens its findings, nearest first.
  await page.evaluate(() => { document.getElementById("key").open = true; });
  const keyName = page.locator("#key .key-name").first();
  await keyName.click();
  const key = await page.evaluate(() => ({ rows: [...document.querySelectorAll("#key .feat-name")].map((e) => e.textContent), dists: [...document.querySelectorAll("#key .feat-meta")].map((e) => e.textContent) }));
  check(key.rows.length > 0, `${label}: the map key's theme opens its findings by distance (${key.rows.slice(0, 3).join(", ")})`);
  await page.screenshot({ path: `/tmp/explore-${label}-key.png` });
  // "Show these on the map": the set is picked out, the rest of the findings fade, and the map fits to the set
  // without zooming out to a wide area the site merely lies within (Rob, 24 Nov: it seemed to do nothing).
  const baseOpacity = await page.evaluate(() => JSON.stringify(window.__ws.map.getPaintProperty("find-line", "line-opacity")));
  await page.locator("#key .feat-map").first().click();
  await page.waitForTimeout(900);
  const shown = await page.evaluate(() => ({ hl: window.__ws.map.getSource("hl")._data.features.length, rows: document.querySelectorAll("#key .feat").length,
    faded: JSON.stringify(window.__ws.map.getPaintProperty("find-line", "line-opacity")), btn: document.querySelector("#key .feat-map")?.textContent }));
  check(shown.hl >= 1 && /"case",\["in",\["get","id"\]/.test(shown.faded) && shown.btn === "Show all findings",
    `${label}: "Show these on the map" picks out the set and fades the other findings; the button undoes it (${shown.hl} outlined; ${shown.btn})`);
  await page.screenshot({ path: `/tmp/explore-${label}-shown.png` });
  if (label === "phone") { await page.click("#handle"); await page.waitForTimeout(300); await page.evaluate(() => { document.getElementById("key").open = true; }); }
  await page.locator("#key .feat-map").first().click();
  check(await page.evaluate((b) => JSON.stringify(window.__ws.map.getPaintProperty("find-line", "line-opacity")) === b && document.querySelector("#key .feat-map")?.textContent === "Show these on the map", baseOpacity),
    `${label}: "Show all findings" brings every finding back`);
  await keyName.click();
  await page.evaluate(() => { document.querySelector(".maplibregl-popup")?.remove(); });
  check(/^What still needs checking: \d+ couldn't check, 1 no data, 2 caveats$/.test(s.gaps) && /Not raised as a flag.*Seabird colonies/.test(s.gapText || "") && s.gapHeads.join("|") === "Not checked: check these yourself|No data here: may need a site visit or a local source|Assumptions and caveats", `${label}: what still needs checking, grouped (${s.gaps}; ${s.gapHeads.join(", ")})`);
  check(await page.evaluate(() => { const c = document.querySelector(".run"); const order = [...c.children].map((e) => e.className.split(" ")[0]); return document.querySelector(".run .gaps").open && order.indexOf("gaps") === order.indexOf("flags") + 1 && document.querySelector(".run .flag .th")?.textContent.length > 2; }), `${label}: still-to-check sits open right under the flags; each flag names its topic`);
  check(await page.evaluate(() => /^Indicative desk screening from public data\./.test(document.querySelector(".run .disclaimer").textContent) && document.querySelector(".run .disclaimer").textContent.length < 200 && !document.querySelector('.run [data-op="download"]').checkVisibility()), `${label}: short disclaimer on the card; download is under More`);
  await page.evaluate(() => { document.querySelector(".run .more").open = true; document.querySelector(".run .disclaimer").scrollIntoView({ block: "end" }); });
  await page.waitForTimeout(200);
  check(await page.evaluate(() => document.querySelector('.run [data-op="download"]').checkVisibility()), `${label}: More opens with Show on map and Download`);
  check(await page.evaluate(() => { const r = document.querySelector(".run"); const tops = [r.querySelector('[data-op="report"]'), r.querySelector('[data-op="share"]'), r.querySelector(".more > summary")].map((e) => Math.round(e.getBoundingClientRect().top)); const m = r.querySelector(".more-menu").getBoundingClientRect(); return new Set(tops).size === 1 && m.left >= 0 && m.right <= innerWidth; }), `${label}: Report, Copy share link and More on one row; the menu stays on screen`);
  await page.screenshot({ path: `/tmp/run-card-${label}-foot.png` });
  await page.evaluate(() => { document.querySelector(".run .more").open = false; });
  await page.evaluate(() => { document.querySelector(".run .gaps").open = true; document.querySelector(".run .nearest").scrollIntoView(); });
  await page.locator(".run .reach").screenshot({ path: `/tmp/run-card-${label}-reach.png` });
  await page.locator(".run .gaps").screenshot({ path: `/tmp/run-card-${label}-gaps.png` });
  await page.evaluate(() => { document.querySelector(".run .gaps").open = false; });
  await page.screenshot({ path: `/tmp/run-card-${label}-2.png` });
  await page.click(".run [data-op=reassess]");
  await page.waitForFunction(() => document.querySelectorAll(".run .flag").length === 1, null, { timeout: 10000 });
  s = await st();
  check(!s.stale && s.flags.length === 1, `${label}: re-assessed at 1 km: one flag, offer gone`);
  await page.$eval(".run input[type=range]", (el) => { el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); });
  s = await st();
  check(s.onMap === 6 && s.stale, `${label}: slider back to 50 km shows all 6 again (with the 2 wrecks brought in), offers re-assess (no refetch)`);
  await page.click(".run .flag summary");
  await page.waitForTimeout(300);
  s = await st();
  check(s.hl === 1, `${label}: opening a flag picks out its evidence on the map (${s.hl})`);
  await page.screenshot({ path: `/tmp/run-card-${label}-3.png` });
  // Inside the area only, from the same evidence, and back.
  check(s.scopeShown && !s.insideChecked && s.rings > 0 && s.mask === 0, `${label}: area run offers the inside switch; rings on, no mask`);
  await page.click('.run [data-scope="inside"]');
  await page.waitForTimeout(300);
  s = await st();
  check(s.insideChecked && s.onMap === 2 && s.mask === 1 && s.rings === 0 && !s.sliderShown, `${label}: inside only: 1 finding and the wide area, outside dimmed, no rings, slider hidden (${s.onMap}, mask ${s.mask}, rings ${s.rings})`);
  check(/inside the area or touching its edge/.test(s.nearest) && s.stale && s.staleText === "Re-assess inside the area", `${label}: inside wording and re-assess offer (${s.staleText})`);
  await page.screenshot({ path: `/tmp/run-card-${label}-4-inside.png` });
  await page.click(".run [data-op=reassess]");
  await page.waitForFunction(() => document.querySelector(".run .stale").hidden, null, { timeout: 10000 });
  s = await st();
  check(/^Flags written for inside the area only/.test(s.dists) && s.insideChecked, `${label}: re-assessed inside; distances line says so (${s.dists.slice(0, 45)})`);
  await page.click('.run [data-scope="around"]');
  await page.waitForTimeout(300);
  s = await st();
  check(!s.insideChecked && s.onMap === 6 && s.mask === 0 && s.rings > 0 && s.out === "50 km", `${label}: back to area and surroundings at 50 km (${s.onMap}, ${s.out})`);
  // Settings: units, colour, licence switches.
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.click("#gear");
  await page.waitForSelector("#settings[open]");
  check(await page.evaluate(() => !document.querySelector("#settings .links") && !document.querySelector('#settings a[href="lab.html"]')), `${label}: no links at the foot of Settings (Rob, 22 Nov)`);
  const about = await page.evaluate(() => document.querySelector("#settings p.about").textContent);
  check(about === "Tobler does the desk screening before the desk study: what's on or near a site, who says so, and what still needs checking.", `${label}: About says what Tobler does, in Rob's words, with no "Coming next"`);
  const ind = await page.evaluate(() => [...document.querySelectorAll('#settings select[name="industry"] option')].map((r) => `${r.value}:${r.selected ? "on" : ""}:${r.disabled ? "soon" : ""}`));
  check(ind.join(",") === "energy:on:,construction::soon,infrastructure::soon,property::soon,mining::soon,data-centres::soon", `${label}: Settings → Industry: Environment and Energy chosen, the five sectors coming soon (${ind.join(", ")})`);
  check(await page.evaluate(() => document.querySelector("#settings .industry-about").textContent.length > 10 && /coming soon/.test(document.querySelector('#settings option[value="mining"]').textContent)), `${label}: Industry is a dropdown with the chosen one's description under it`);
  await page.screenshot({ path: `/tmp/settings-${label}.png` });
  await page.check('#settings input[name="units"][value="imperial"]');
  await page.click('#settings [data-colour="#00a0b0"]');
  await page.check('#settings input[name="esri"]');
  // Counting the same shape once across layers: on by default (Rob, 24 Nov); switching it off is saved and reaches the host.
  check(await page.evaluate(() => document.querySelector('#settings input[name="mergeShapes"]').checked && window.__ws.host.mergeShapes() === true), `${label}: "count the same site once" is on by default`);
  await page.uncheck('#settings input[name="mergeShapes"]');
  check(await page.evaluate(() => localStorage.getItem("tobler.mergeShapes") === "no" && window.__ws.host.mergeShapes() === false), `${label}: switching it off is saved`);
  await page.check('#settings input[name="mergeShapes"]');
  check(await page.evaluate(() => !document.querySelector("#settings .advanced").open), `${label}: the key and sharing sit under a closed Advanced section`);
  await page.click("#settings .advanced > summary");
  await page.uncheck('#settings input[name="shareSessions"]');
  const set = await page.evaluate(() => ({
    out: document.querySelector(".run .reach output").textContent, dists: document.querySelector(".run .dists").textContent,
    unit: document.querySelector(".shape .unit").textContent, facts: document.querySelector(".shape .facts").textContent,
    line: window.__ws.map.getPaintProperty("aoi-red", "line-color"), css: document.documentElement.style.getPropertyValue("--pole"),
    esri: localStorage.getItem("tobler.esriLicence"), host: window.__ws.host.esriLicence(), units: localStorage.getItem("tobler.units"),
    rings: window.__ws.map.getSource("rings")._data.features.map((f) => f.properties.label).join(","),
  }));
  check(set.out === "31.1 mi" && /31.1 mi/.test(set.dists) && !/ km/.test(set.dists) && set.unit === "sq mi" && /sq mi/.test(set.facts) && /mi/.test(set.rings), `${label}: miles on the card, shape card and rings (${set.out}; ${set.unit}; ${set.rings})`);
  check(set.line === "#00a0b0" && set.css === "#00a0b0", `${label}: shape colour applied to the map and the page`);
  check(set.esri === "yes" && set.host === true && set.units === "imperial", `${label}: Esri switch and units saved`);
  const before = logs.length;
  await page.evaluate(() => window.toblerSharer.share({ user: "after switching off" }));
  await page.waitForTimeout(200);
  check(await page.evaluate(() => localStorage.getItem("tobler.shareSessions")) === "no" && logs.length === before, `${label}: sharing switched off is saved and nothing more is sent`);
  await page.click("#settings .close");
  check(await page.evaluate(() => !document.getElementById("settings").open), `${label}: settings close`);
  await page.evaluate(() => localStorage.clear());
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
// An inside-only screen, asked for in words.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/openfreemap|nominatim|wikidata|overpass/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, async (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); let out; try { out = { result: { structuredContent: atlas(b.params.name, b.params.arguments) } }; } catch (e) { out = { error: { code: -32000, message: e.message } }; } r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...out }) }); });
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "drawn", at: new Date().toISOString() } }), SQUARE);
  await page.fill("#say", "Screen Area 1, only inside the area");
  await page.click("#ask button[type=submit]");
  await page.waitForSelector(".run .flag", { timeout: 30000 });
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    note: document.querySelector(".run .inside-note").hidden ? "" : document.querySelector(".run .inside-note").textContent,
    scope: !document.querySelector(".run .scope").hidden, dists: document.querySelector(".run .dists").textContent,
    onMap: window.__ws.map.getSource("findings")._data.features.length, mask: window.__ws.map.getSource("mask")._data.features.length,
    rings: window.__ws.map.getSource("rings")._data.features.length,
  }));
  check(/inside the area only/.test(s.note) && !s.scope && /^Inside the area only/.test(s.dists), `inside screen: card says so, no switch (${s.note.slice(0, 50)})`);
  check(s.onMap === 2 && s.mask === 1 && s.rings === 0, `inside screen: only the on-site finding and the wide area, outside dimmed, no rings (${s.onMap}, ${s.mask}, ${s.rings})`);
  await page.$eval(".run", (e) => e.scrollIntoView({ block: "start" }));
  await page.screenshot({ path: "/tmp/run-card-inside-screen.png" });
  check(errors.length === 0, `inside screen: no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
if (results.some((r) => r.startsWith("FAIL"))) process.exit(1);
