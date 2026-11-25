// Headless browser check of a study (the contamination desk study, 24 Nov): a site on land, the study's chip fills
// the input, the analyst calls run_study, the sealed run carries out only the study's checks and asks once for the
// judgement (atlas and model scripted, no network, no cost), and the card shows the linkage, the checks grouped as
// sources, pathways and receptors, and what a full desk study would add. The report opens with the study's title.
// Screenshots at desktop and phone sizes.
// Run: python3 -m http.server 8000 (in the repo), then node scripts/browser-study.mjs [chrome path].
import { chromium } from "playwright-core";
import { cite } from "./scripted-refs.mjs";
import * as turf from "@turf/turf";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const C = [-1.08, 53.9]; // south of York
const r6 = (v) => Math.round(v * 1e6) / 1e6;
const SITE = turf.bboxPolygon([C[0] - 0.002, C[1] - 0.0012, C[0] + 0.002, C[1] + 0.0012].map(r6));
SITE.geometry.coordinates = SITE.geometry.coordinates.map((ring) => ring.map((p) => p.map(r6)));
const F = (geometry, properties) => ({ type: "Feature", geometry, properties });

function atlas(tool, args) {
  if (tool === "fetch_features" && args.id === "3a4c49302d01deb3") return { returned: 1, features: [F(turf.circle(turf.destination(C, 0.3, 0).geometry.coordinates, 0.05).geometry, { site_name: "Station Road tip", hld_ref: "EAHLD1" })] };
  if (tool === "fetch_features" && args.id === "6c3e0babf56f294e") return { returned: 1, features: [F(turf.bboxPolygon([-1.1, 53.89, -1.06, 53.91]).geometry, { number: "2" })] };
  return { matches: 0, results: [], returned: 0, features: [] };
}

const json = (s) => "```json\n" + JSON.stringify(s) + "\n```";
const RESULT = "A possible linkage from the old tip.\n\n" + json({ decision: "possible linkages: investigate", decision_why: "A historic landfill 300 m north, and the site is in a source protection zone.",
  flags: [{ risk: "Historic landfill 300 m north could affect groundwater in the source protection zone", topic: "ground-soil",
    linkage: { source: "Station Road tip (historic landfill)", pathway: "groundwater (source protection zone 2)", receptor: "public water supply", rating: "possible" },
    severity: "medium", confidence: "medium", evidence: [{ name: "Station Road tip", distance_km: 0.3, dataset: "Historic Landfill Sites" }],
    why: "Leachate could reach groundwater.", next_step: "Historical maps and a commercial environmental search" }], checked: [], data_gaps: [] });

const toolUse = (...u) => ({ id: "m", type: "message", role: "assistant", stop_reason: "tool_use", content: u.map(([name, input], i) => ({ type: "tool_use", id: `t${Date.now()}${i}`, name, input })), usage: { input_tokens: 100, output_tokens: 10 } });
const text = (t) => ({ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: t }], usage: { input_tokens: 100, output_tokens: 10 } });
const seen = [];
function model(body) {
  const sys = (Array.isArray(body.system) ? body.system.map((b) => b.text).join("") : body.system) || "";
  seen.push({ sys: sys.slice(0, 120), tools: (body.tools || []).length });
  if (/writing one sealed contamination desk study/.test(sys)) return text(cite(RESULT, body));
  const last = body.messages.at(-1);
  if (Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result")) return text("Possible linkage: the old tip 300 m north and the source protection zone. Past land use isn't in the open records here.");
  return toolUse(["run_study", { place: "Area 1", study: "contamination-desk-study" }]);
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
  await page.route(/openfreemap|nominatim|wikidata|overpass|environment\.data\.gov|arcgis|usgs|noaa/, (r) => r.abort());
  await page.route(/tobler-api.*\/v1\/messages/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(model(JSON.parse(r.request().postData()))) }));
  await page.route(/tobler-api.*\/atlas/, async (r) => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result: { structuredContent: atlas(b.params.name, b.params.arguments) } }) }); });
  await page.route(/tobler-api.*\/logs/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
  await page.goto("http://localhost:8000/");
  await page.waitForFunction(() => window.__ws?.draw, null, { timeout: 40000 });
  if (label === "phone") await page.evaluate(() => document.getElementById("panel").classList.remove("collapsed"));
  await page.waitForTimeout(800);
  await page.evaluate((f) => window.__ws.host.addPlace({ feature: f, origin: { method: "drawn" } }), SITE);
  await page.waitForTimeout(500);
  // The study's chip is ready (not "soon") and fills the input for the place.
  const chip = await page.evaluate(() => { const b = document.querySelector('.chips .chip[data-skill="contamination-desk-study"]'); return b ? { soon: b.classList.contains("soon"), hidden: b.hidden } : null; });
  check(chip && !chip.soon && !chip.hidden, `${label}: the desk study chip is ready (${JSON.stringify(chip)})`);
  await page.locator('.chips .chip[data-skill="contamination-desk-study"]').click();
  const typed = await page.inputValue("#say");
  check(/^Run the contamination desk study for Area 1/.test(typed), `${label}: the chip fills the input (${typed})`);
  await page.keyboard.press("Enter");
  await page.waitForSelector(".run", { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const card = await page.evaluate(() => {
    const c = document.querySelector(".run");
    if (!c) return null;
    return {
      title: c.querySelector("h2")?.textContent || "",
      decision: c.querySelector(".decision")?.textContent || "",
      flag: c.querySelector(".flag .risk")?.textContent || "",
      linkage: c.querySelector(".flag .linkage")?.textContent || "",
      groups: [...c.querySelectorAll(".checks > ul > li")].map((li) => li.firstChild?.textContent || li.textContent.split("\n")[0]),
      checks: c.querySelector(".checks")?.textContent || "",
      adds: c.querySelector(".gaps .adds")?.textContent || "",
      stale: !c.querySelector(".stale") || c.querySelector(".stale").hidden,
    };
  });
  check(card && card.title === "Contamination desk study: Area 1", `${label}: the card names the study (${card?.title})`);
  check(/^Possible linkages: investigate\./.test(card?.decision || ""), `${label}: the study's own decision words (${card?.decision?.slice(0, 60)})`);
  check(/Historic landfill 300 m north/.test(card?.flag || "") && /possible linkage/.test(card?.flag || ""), `${label}: the linkage is a finding, with its rating (${card?.flag?.slice(0, 120)})`);
  check(/Source: Station Road tip.*→ Pathway: groundwater.*→ Receptor: public water supply/.test(card?.linkage || ""), `${label}: source → pathway → receptor in the finding (${card?.linkage})`);
  check(/Potential sources/.test(card?.checks || "") && /Pathways/.test(card?.checks || "") && /Receptors/.test(card?.checks || "") && !/Heritage/.test(card?.checks || ""), `${label}: checks grouped as sources, pathways and receptors, and only the study's (${(card?.groups || []).join(" | ").slice(0, 120)})`);
  check(/What a full desk study would add/.test(card?.adds || "") && /historical maps/.test(card?.adds || ""), `${label}: what a full desk study would add`);
  check(card?.stale !== false, `${label}: no re-assess offer on a study`);
  const studyCall = seen.find((s) => /contamination desk study/.test(s.sys));
  check(studyCall && studyCall.tools === 0, `${label}: the study's judgement is one call with no tools (${JSON.stringify(studyCall)})`);
  // The reply after the run is written in code from the record (plan item 1): no conversation call after the study.
  const reply = await page.evaluate(() => [...document.querySelectorAll(".msg.analyst")].at(-1)?.textContent || "");
  check(/^Contamination desk study of Area 1 \(R1\): possible linkages: investigate\./.test(reply) && /F-01 Historic landfill 300 m north/.test(reply), `${label}: the reply is written from the record (${reply.slice(0, 140)})`);
  const convAfter = seen.slice(seen.indexOf(studyCall) + 1).filter((s) => !/contamination desk study/.test(s.sys));
  check(convAfter.length === 0, `${label}: the model isn't asked to write the reply (${convAfter.length} conversation calls after the study)`);
  await page.locator(".run details.checks").evaluate((d) => { d.open = true; });
  await page.locator(".run .flag details").first().evaluate((d) => { d.open = true; });
  await page.screenshot({ path: `/tmp/study-${label}.png`, fullPage: false });
  await page.locator(".run").screenshot({ path: `/tmp/study-card-${label}.png` });
  if (label === "desktop") {
    const [rp] = await Promise.all([page.waitForEvent("popup"), page.click('.run [data-op="report"]')]);
    await rp.waitForFunction(() => window.__report?.ready, null, { timeout: 45000 }).catch(() => {});
    const rep = await rp.evaluate(() => ({ h1: document.querySelector("h1")?.textContent, error: window.__report?.error || "", body: document.body.textContent }));
    check(!rep.error && rep.h1 === "Contamination desk studyArea 1", `report opens with the study's title (${rep.error || rep.h1})`);
    check(/Source: Station Road tip/.test(rep.body) && /What a full desk study would add/.test(rep.body), "the report shows the linkage and what a full desk study would add");
    await rp.screenshot({ path: "/tmp/study-report.png", fullPage: true });
  }
  check(errors.length === 0, `${label}: no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  await page.close();
}
await browser.close();
console.log(results.join("\n"));
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
