// The replay gate (plan, next step 1): each site in eval/replay/sites.json screened from its boundary, as a file the
// person brought in, through the same sealed screen as the page (js/ntrrun.js createScreening, with the atlas on).
// No conversation: the gate tests the screen, not place-finding. Each run is scored against the site's expected.json
// (scripts/replay-score.mjs) and the digest's trust checks (scripts/log-checks.mjs); results go to
// eval/replay/runs/<label>/, and the report is compared with the last gate run (eval/replay/runs/latest.json).
//
// node scripts/replay-gate.mjs --label=gate-2026-11-27 [--sites=R1,R5]   (needs ANTHROPIC_API_KEY and ATLAS_MCP_KEY)
// node scripts/replay-gate.mjs --score-only --label=...                     (re-score saved runs, no network)
// node scripts/replay-gate.mjs --offline --label=offline                    (plumbing check: every fetch fails and the
//   model returns an empty result, so every fact should score not_checked or no_check, never missed or found)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import * as R from "../js/reference.js";
import { parseSkill } from "../js/converse.js";
import { chooseIndustry } from "../js/industry.js";
import { createScreening } from "../js/ntrrun.js";
import { atlasCall } from "./atlas-client.mjs";
import { firmsCall } from "./firms-client.mjs";
import { CONFIG } from "../js/config.js";
import { scoreSite, regressions, gateReport, belowThreshold } from "./replay-score.mjs";
import { trustChecks } from "./log-checks.mjs";

const arg = (k, d = null) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : process.argv.includes(`--${k}`) ? true : d; };
const label = String(arg("label", `gate-${new Date().toISOString().slice(0, 10)}`)).replace(/[^\w.-]/g, "-");
const DIR = "eval/replay";
const OUT = `${DIR}/runs/${label}`;
const all = JSON.parse(readFileSync(`${DIR}/sites.json`, "utf8")).sites;
const pick = arg("sites") ? String(arg("sites")).split(",").map((s) => s.trim().toUpperCase()) : null;
const sites = pick ? all.filter((s) => pick.includes(s.id)) : all;
const scoreOnly = !!arg("score-only");
const offline = !!arg("offline");
mkdirSync(OUT, { recursive: true });

const UA = { "User-Agent": "tobler-replay-gate/1.0 (+https://github.com/pushpingeo/tobler)" };
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const model = CONFIG.model;
let spend = { input: 0, output: 0 };

async function callClaude({ system, messages, tools, maxTokens }) {
  if (offline) return { content: [{ type: "text", text: "Offline.\n```json\n{\"decision\":\"\",\"decision_why\":\"\",\"flags\":[],\"data_gaps\":[],\"checked\":[]}\n```" }], usage: { input_tokens: 0, output_tokens: 0 }, stop_reason: "end_turn" };
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: maxTokens || 8000, system, messages, tools }),
    });
    if (r.ok) { const j = await r.json(); spend.input += j.usage?.input_tokens || 0; spend.output += j.usage?.output_tokens || 0; return j; }
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1))); continue; }
    throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("API kept failing");
}

// The EPSG registry, read directly (as scripts/gigs-check.mjs does), for the presentation CRS. Remembered per run.
const epsgSeen = new Map();
function epsgCall({ path, query = {} }) {
  const q = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
  const key = `${path}?${q}`;
  if (!epsgSeen.has(key)) epsgSeen.set(key, (async () => {
    const r = await fetch(`https://apps.epsg.org/api/v1/${path}/${q.size ? `?${q}` : ""}`, { headers: { accept: "application/json", ...UA } });
    if (!r.ok) throw new Error(`EPSG answered ${r.status}`);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return t; }
  })().catch((e) => { epsgSeen.delete(key); throw e; }));
  return epsgSeen.get(key);
}

// One screen, as the page runs it. Returns the run record and the log events the trust checks read.
async function screenSite(site) {
  const ref = R.createReference(async (n) => json(`data/ref/${n}.json`));
  const industries = json("catalogue/industries/index.json");
  const profile = json(industries.industries.find((i) => i.id === chooseIndustry(industries, process.env.INDUSTRY)).file);
  const ntr = parseSkill(readFileSync("skills/ntr-screening/SKILL.md", "utf8"));
  const fc = json(`${DIR}/${site.id}/site.geojson`);
  const place = { id: `replay-${site.id}`, name: site.name, alias: "Area 1", feature: { type: "Feature", properties: {}, geometry: fc.features[0].geometry },
    origin: { method: "file", file: "site.geojson", note: "replay gate" }, status: "accepted", edits: [] };
  const list = [place];
  const events = [];
  let record = null;
  const host = {
    ref, anchors: json("catalogue/anchors.json").sources, headers: UA, list, trusted: json("catalogue/trusted.json"), checks: json("catalogue/checks.json"),
    irz: json("catalogue/sssi_irz_codes.json"), profile: () => profile, grids: json("catalogue/grids.json"), epsg: offline ? null : epsgCall,
    firms: process.env.FIRMS_MAP_KEY ? firmsCall : null,
    transformationChoice: () => "choose", esriLicence: () => false, nonCommercial: () => false,
    fetchFn: offline ? async () => { throw new Error("offline"); } : (url, opts = {}) => fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }),
    atlas: offline ? async () => { throw new Error("offline"); } : process.env.ATLAS_MCP_KEY ? (tool, args) => atlasCall(tool, args) : null,
    places: () => list, findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()),
    addFindings() {}, showFindings: () => ({ shown: 0 }), clearFindings() {},
    personSaid: () => `Screen ${site.name}`, lastPersonText: () => `Screen ${site.name}`,
  };
  host.screening = createScreening({
    host, table: json("catalogue/assets.json"), skill: ntr, callClaude, model,
    onEvent: (ev) => { if (ev.type === "tool") events.push({ screen_tool: ev.name, input: ev.input, ms: ev.ms, ...(ev.error ? { error: ev.error } : { output: ev.output }) }); },
    onRun: (rec) => { record = rec; },
  });
  const t0 = Date.now();
  const head = await host.screening.screen(site.inputs, place);
  const ms = Date.now() - t0;
  const r = record.tobler_run;
  // The same compact screen result the page logs (js/workspace.js), so the digest's checks read it unchanged.
  events.unshift({ tool: "screen_site", input: site.inputs, ms, output: head });
  events.push({ screen_result: { run: r.id, flags: r.flags.map((f) => ({ risk: f.risk, theme: f.theme, ...(f.relevance ? { relevance: f.relevance.class } : { confidence: f.confidence }), nearest_km: f.nearest_km, evidence: f.evidence.map((e) => `${e.name} ${e.distance_km} km${e.traced ? "" : " (not traced)"}`) })),
    checked: r.checked.map((c) => `${c.dataset}: ${c.result}${c.count ? ` ${c.count}` : ""}${c.why ? ` (${c.why})` : ""}`), gaps: r.data_gaps } });
  return { record, events, ms };
}

// Saved runs keep the run record without feature geometry (the map's shapes aren't needed to score, and Whitelee's
// would be megabytes); the site's own outline is in site.geojson.
const slim = (rec) => ({ ...rec, features: rec.features.map((f) => ({ type: "Feature", geometry: null, properties: f.properties })) });

const scores = [], sessions = [], failed = [];
for (const site of sites) {
  const path = `${OUT}/${site.id}.json`;
  try {
    let saved;
    if (scoreOnly) {
      if (!existsSync(path)) { failed.push(`${site.id} (no saved run)`); continue; }
      saved = json(path);
    } else {
      console.log(`== ${site.id} ${site.name}`);
      const { record, events, ms } = await screenSite(site);
      saved = { site: site.id, ms, model, record: slim(record), events };
      writeFileSync(path, JSON.stringify(saved));
      console.log(`   ${record.tobler_run.id}: ${(ms / 1000).toFixed(0)} s, ${record.tobler_run.flags.length} flags, ${record.features.filter((f) => f.properties.role === "evidence").length} evidence features`);
      const pc = record.tobler_run.presentation_crs;
      console.log(`   presentation CRS: ${pc?.code ? `${pc.name} (EPSG:${pc.code})${pc.operation?.code ? ` by EPSG:${pc.operation.code}, ${pc.operation.accuracy_m} m` : ""}${pc.fallback_from ? `; not ${pc.fallback_from.name}: ${pc.fallback_from.reason}` : ""}` : `none (${pc?.why})`}`);
    }
    scores.push(scoreSite(json(`${DIR}/${site.id}/expected.json`), saved.record));
    sessions.push({ turns: [{ log: { user: `Screen ${site.name}`, reply: "", events: saved.events } }] });
  } catch (e) {
    failed.push(`${site.id} (${String(e.message || e).slice(0, 160)})`);
    console.log(`   FAILED: ${e.message}`);
  }
}

const latestPath = `${DIR}/runs/latest.json`;
const latest = existsSync(latestPath) ? json(latestPath) : null;
const before = latest && latest.label !== label && existsSync(`${DIR}/runs/${latest.label}/scores.json`) ? json(`${DIR}/runs/${latest.label}/scores.json`) : null;
const regressed = regressions(scores, before);
const trust = trustChecks(sessions);
const report = gateReport(scores, { label: `${label}${before ? ` (against ${latest.label})` : " (first run: sets the baseline)"}`, trust, regressed, failed });
writeFileSync(`${OUT}/scores.json`, JSON.stringify(scores, null, 1));
writeFileSync(`${OUT}/report.md`, report);
// A complete run becomes the baseline for the next; a partial or failed one doesn't.
if (!failed.length && !pick && !offline) writeFileSync(latestPath, JSON.stringify({ label, at: new Date().toISOString(), model }, null, 1) + "\n");
console.log(`\n${report}`);
if (!scoreOnly) console.log(`Tokens: ${spend.input} in, ${spend.output} out`);
// The gate fails on a regression, a site that didn't run, or a must fact with a check not surfaced (the threshold), so
// the Action shows red.
process.exitCode = regressed.length || failed.length || belowThreshold(scores).length ? 1 : 0;
