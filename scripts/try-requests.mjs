// Plays a list of requests through the workspace's analyst (same skill, tools and turn loop as the page),
// with the atlas on, and prints each conversation. For finding problems by using it, not for scoring.
// Each line of REQUESTS is one conversation; " >> " separates follow-up turns.
import { readFileSync } from "node:fs";
import * as turf from "@turf/turf";
import * as R from "../js/reference.js";
import { createPlaceTools, placeToolDefs, projectSummary } from "../js/placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn } from "../js/converse.js";
import { coordinateNote } from "../js/coords.js";
import { chooseIndustry, industryNote } from "../js/industry.js";
import { atlasCall } from "./atlas-client.mjs";
import { createScreening, evidenceOf } from "../js/ntrrun.js";
import { siteChange, runLines } from "../js/outofdate.js";
import { firmsCall } from "./firms-client.mjs";

const UA = { "User-Agent": "tobler-try/1.0 (+https://github.com/pushpingeo/tobler)" };
const ref = R.createReference(async (n) => JSON.parse(readFileSync(`data/ref/${n}.json`, "utf8")));
const anchors = JSON.parse(readFileSync("catalogue/anchors.json", "utf8")).sources;
const trusted = JSON.parse(readFileSync("catalogue/trusted.json", "utf8"));
const checks = JSON.parse(readFileSync("catalogue/checks.json", "utf8"));
const irz = JSON.parse(readFileSync("catalogue/sssi_irz_codes.json", "utf8"));
// The industry profile, as the page uses it (Energy until another is ready).
const industries = JSON.parse(readFileSync("catalogue/industries/index.json", "utf8"));
const profile = JSON.parse(readFileSync(industries.industries.find((i) => i.id === chooseIndustry(industries, process.env.INDUSTRY)).file, "utf8"));
const skill = parseSkill(readFileSync("skills/place-finding/SKILL.md", "utf8"));
const ntr = parseSkill(readFileSync("skills/ntr-screening/SKILL.md", "utf8"));
const crs = parseSkill(readFileSync("skills/coordinate-reference/SKILL.md", "utf8"));
const allSkills = [skill, ntr, crs];
// EPSG registry through the live Worker, as the page does (the Worker serves Tobler's origin only).
const epsgCall = async ({ path, query }) => {
  const r = await fetch("https://tobler-api.robdunfey.workers.dev/epsg", { method: "POST", headers: { "content-type": "application/json", origin: "https://asktobler.com" }, body: JSON.stringify({ path, query }) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = null; }
  // A path the deployed Worker doesn't serve yet (a branch ahead of the Worker): read the registry directly instead,
  // so a replay can test new tools before the Worker is deployed. Printed, so the log says which route was used.
  if (r.status === 400 && /isn't served here/.test(j?.message || "")) {
    console.log(`   (EPSG ${path}: not on the deployed Worker yet; read from apps.epsg.org directly)`);
    const q = new URLSearchParams(Object.entries(query || {}).map(([k, v]) => [k, String(v)]));
    const d = await fetch(`https://apps.epsg.org/api/v1/${path}/${q.size ? `?${q}` : ""}`, { headers: { accept: "application/json" } });
    if (!d.ok) throw new Error(`EPSG answered ${d.status}`);
    return d.json();
  }
  if (!r.ok) throw new Error(j?.message || `EPSG answered ${r.status}`);
  return j ?? t;
};
// The conversation doesn't load the NTR method itself: screen_site runs it as a sealed run (as in the page).
const convSkills = [skill, crs];
const distTable = JSON.parse(readFileSync("catalogue/distances.json", "utf8"));
let spend = { input: 0, output: 0 };

async function callClaude({ system, messages, tools, maxTokens }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-haiku-5-5", max_tokens: maxTokens || 8000, system, messages, tools }),
    });
    if (r.ok) { const j = await r.json(); spend.input += j.usage?.input_tokens || 0; spend.output += j.usage?.output_tokens || 0; return j; }
    if (r.status === 429 || r.status >= 500) { await new Promise((ok) => setTimeout(ok, 5000 * (attempt + 1))); continue; }
    throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 300)}`);
  }
  throw new Error("API kept failing");
}

const convs = (process.env.REQUESTS || "").split("\n").map((l) => l.trim()).filter(Boolean);
for (const conv of convs) {
  const list = [];
  const host = {
    ref, anchors, headers: UA, list, trusted, checks, irz, profile: () => profile,
    firms: process.env.FIRMS_MAP_KEY ? firmsCall : null,
    epsg: epsgCall,
    transformationChoice: () => (process.env.TRANSFORMATION_CHOICE === "ask" ? "ask" : "choose"),
    esriLicence: () => process.env.ESRI_LICENCE === "yes",
    nonCommercial: () => process.env.NON_COMMERCIAL === "yes",
    addFindings(l, g) { this.findings = (this.findings || 0) + l.length; },
    showFindings(ids) { return { shown: ids?.length || this.findings || 0 }; },
    clearFindings() { this.findings = 0; },
    // As in the page, a pick from the asset buttons comes back as the person's next message (write it as the next turn).
    askAssetType(name) { console.log(`   [asset type buttons shown for ${name}]`); return { place: name }; },
    offerChoices(o) { console.log(`   [choices offered: ${o.question || ""} ${(o.options || []).map((x) => x.label || x).join(" / ")}]`); },
    fetchFn: (url, opts = {}) => fetch(url, { ...opts, headers: { ...UA, ...(opts.headers || {}) } }),
    atlas: process.env.ATLAS_MCP_KEY ? (tool, args) => atlasCall(tool, args) : null,
    places: () => list,
    // As in the page: a place answers to its name and to the "Area N" it was counted as.
    findPlace: (n) => list.find((p) => p.name.toLowerCase() === String(n).toLowerCase()) || list.find((p) => p.alias.toLowerCase() === String(n).toLowerCase() || p.given?.toLowerCase() === String(n).toLowerCase()),
    skillText: (n) => (allSkills.find((x) => x.name === n) || skill).body,
    addPlace({ feature, origin, name, given }) {
      const alias = `Area ${list.length + 1}`;
      let nm = name || alias;
      for (let k = 2; name && list.some((q) => q.name.toLowerCase() === nm.toLowerCase()); k++) nm = `${name} (${k})`;
      const p = { id: `p${list.length + 1}-${Date.now()}`, name: nm, alias, given, feature, origin, status: "proposed", edits: [] }; list.push(p); return p;
    },
    updatePlace(name, feature, words) { const p = this.findPlace(name); p.feature = feature; p.edits.push({ change: words }); },
    renamePlace(name, to) { this.findPlace(name).name = to; },
    removePlace(name, by) { const i = list.findIndex((p) => p.name.toLowerCase() === String(name).toLowerCase()); if (i >= 0) { console.log(`   [removed ${list[i].name}: ${by?.reason || ""}]`); list.splice(i, 1); } },
    personSaid: () => said.join("\n"),
    lastPersonText: () => said.at(-1) || "",
  };
  const said = [];
  host.screening = createScreening({
    host, table: distTable, skill: ntr, callClaude, model: "claude-haiku-5-5",
    onEvent: (ev) => {
      if (ev.type === "round") console.log(`     [screen round ${ev.round + 1}: ${(ev.ms / 1000).toFixed(1)} s, ${ev.input_tokens} in / ${ev.output_tokens} out, ${ev.tools} tool calls]`);
      if (ev.type === "tool") { const o = ev.output || {}; console.log(`     · screen ${ev.name} (${(ev.ms / 1000).toFixed(1)} s) ${JSON.stringify(ev.input).slice(0, 140)} → ${ev.error ? `ERROR ${ev.error}` : ev.name === "get_data" ? (o.not_checked ? `NOT CHECKED ${String(o.not_checked).slice(0, 120)}` : `${o.dataset}: ${o.within_distance} within ${o.within_km} km`) : ev.name === "find_data" ? (o.datasets || []).map((d) => `${d.id} ${d.title} (${d.publisher})`).join("; ").slice(0, 300) : ev.name === "find_features_near" ? `${o.found} found` : JSON.stringify(o).slice(0, 160)}`); }
    },
    onRun: (rec) => {
      const r = rec.tobler_run;
      console.log(`   [RUN CARD ${r.id}: ${r.site.name}; ${r.site.asset_label}${r.site.asset_assumed ? " (assumed)" : ""}; ${r.site.footprint}; ${r.distances.near}/${r.distances.close}/${r.distances.wider} km (${r.distances.reasons[0]})]`);
      if (r.replaces) console.log(`     REPLACES ${r.replaces.run}: ${r.replaces.why}`);
      if (r.sea) console.log(`     SEA ${JSON.stringify(r.sea).slice(0, 900)}`);
      console.log(`     DECISION: ${r.decision ? `${r.decision.value} (${r.decision.why})` : "none given"}`);
      for (const f of r.flags) console.log(`     ${f.id} ${f.severity ? `sev ${f.severity}, ` : ""}${f.confidence.toUpperCase()} [${f.theme}]${f.next_step ? ` next: ${f.next_step} |` : ""} ${f.risk} | nearest ${f.nearest_km} km | evidence ${f.traced} traced, ${f.untraced} not traced: ${f.evidence.map((e) => `${e.name} ${e.distance_km} km${e.traced ? "" : " (untraced)"}`).join("; ").slice(0, 400)}`);
      console.log(`     checked: ${r.checked.map((c) => `${c.dataset} → ${c.result}${c.count ? ` ${c.count}` : ""}`).join("; ").slice(0, 900)}`);
      console.log(`     gaps: ${r.data_gaps.join(" | ").slice(0, 600)}`);
      console.log(`     evidence features: ${evidenceOf(rec).length}; tokens ${r.usage.input_tokens} in / ${r.usage.output_tokens} out${r.parse_error ? `; PROBLEM ${r.parse_error}` : ""}`);
      console.log(`     summary: ${r.summary.replace(/\s+/g, " ").slice(0, 700)}`);
      if (r.debug) console.log(`     DEBUG ${JSON.stringify(r.debug).slice(0, 4000)}`);
      if (r.debug?.repairs?.length) console.log(`     RAW END (why the result needed a repair): ${JSON.stringify(String(r.debug.raw_tail || "").slice(-900))}`);
    },
  });
  const tools = createPlaceTools(host);
  const recent = [];
  let loaded = [];
  console.log(`\n==================== ${conv}`);
  for (const text of conv.split(" >> ")) {
    const t0 = Date.now();
    const timing = { model: 0, rounds: 0, tools: [] };
    console.log(`\n> ${text}`);
    tools.newTurn();
    said.push(text);
    try {
      const res = await runTurn({
        system: systemPrompt({ skills: convSkills, loaded, comingSoon: ["net developable area and constraints-and-access analysis"], industryRule: profile.other_requests }),
        messages: buildMessages({ recent, summary: [await projectSummary(ref, list, list.at(-1)?.name, null, runLines([...host.screening.runs.values()].map((record) => ({ record, change: siteChange(record, list.find((q) => q.id === record.tobler_run.place_id) || null), replacedBy: record.tobler_run.replaced_by })))), industryNote(profile, industries)].join("\n"), userText: coordinateNote(text) ? `${text}\n\n${coordinateNote(text)}` : text }),
        tools: placeToolDefs(convSkills),
        maxRounds: 14,
        exec: (name, input) => tools.exec(name, input),
        callClaude,
        onEvent: (ev) => {
          if (ev.type === "round") { timing.model += ev.ms; timing.rounds++; console.log(`   [model round ${ev.round + 1}: ${(ev.ms / 1000).toFixed(1)} s, ${ev.input_tokens} in / ${ev.output_tokens} out, ${ev.tools} tool calls]`); return; }
          if (ev.type !== "tool") return;
          timing.tools.push([ev.name, ev.ms]);
          if (ev.name === "load_skill") { const k = allSkills.find((x) => x.name === ev.input?.name); if (k && !loaded.includes(k)) loaded = [...loaded, k]; }
          const o = ev.output || {};
          const brief = ev.error ? `ERROR ${ev.error}`
            : ev.name === "find_features_near" ? `${o.found} found; sources ${JSON.stringify(o.sources)}; top: ${(o.candidates || []).slice(0, 5).map((c) => `${c.name} (${c.distance_km} km, ${c.source})`).join("; ")}`
            : ev.name === "find_place" ? `${(o.candidates || []).length} found: ${(o.candidates || []).slice(0, 5).map((c) => `${c.id} ${c.name} [${c.type}] ${c.source}`).join("; ")}`
            : ev.name === "find_data" ? `${o.matches ?? 0} matches: ${(o.datasets || []).map((d) => `${d.id} ${d.title} (${d.publisher}${d.can_fetch ? "" : ", picture only"})`).join("; ")}${o.not_checked ? ` NOT CHECKED: ${o.not_checked}` : ""}`
            : ev.name === "get_data" ? (o.not_checked ? `NOT CHECKED: ${o.not_checked}` : `${o.dataset}: ${o.inside_or_touching} inside, ${o.within_distance} within ${o.within_km} km; nearest: ${(o.nearest || []).slice(0, 4).map((c) => `${c.name} ${c.distance_km} km ${JSON.stringify(c.details || {})}`).join("; ")}`)
            : ev.name === "transform" ? (o.error ? `ERROR ${o.error}` : `${o.from?.name} → ${o.to?.name} by EPSG:${o.operation?.code} (${o.operation?.direction}, ${o.operation?.accuracy_m} m); ${(o.points || []).map((p) => `${p.input.lat},${p.input.lon} → ${p.output.lat},${p.output.lon} moved ${p.moved_m} m${p.outside_area_of_use ? " OUTSIDE area of use" : ""}`).join("; ")}; ${o.epsg_version}`)
            : ev.name === "transformation_options" ? (o.error ? `ERROR ${o.error}` : `at ${JSON.stringify(o.at)}; ${o.setting}: chosen ${o.chosen}, recommended ${o.recommended}, ask ${o.ask}; options ${(o.options || []).map((x) => `${x.code} ${x.accuracy_m} m ${x.area}${x.can_apply ? "" : " (grid)"}`).join("; ")}; ${o.why}`)
            : ev.name === "make_place" ? `${o.summary} | ${o.how} | ${o.confidence}: ${(o.why || []).join("; ")}`
            : JSON.stringify(o).slice(0, 200);
          console.log(`   · ${ev.name} (${(ev.ms / 1000).toFixed(1)} s) ${JSON.stringify(ev.input).slice(0, 160)}\n     → ${brief.slice(0, 700)}`);
        },
      });
      recent.push({ role: "user", text }, { role: "assistant", text: res.text });
      const total = (Date.now() - t0) / 1000;
      console.log(`\n${res.text}\n   (${total.toFixed(0)} s: model ${(timing.model / 1000).toFixed(0)} s over ${timing.rounds} rounds; tools ${(total - timing.model / 1000).toFixed(0)} s wall; slowest tools ${timing.tools.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, ms]) => `${n} ${(ms / 1000).toFixed(1)} s`).join(", ")})`);
    } catch (e) { console.log(`TURN FAILED: ${e.message}`); }
    console.log(`   [places now: ${list.map((p) => `${p.name} (${p.origin?.confidence || "drawn"})`).join(", ") || "none"}]`);
  }
}
console.log(`\nTokens: ${spend.input} in, ${spend.output} out`);
