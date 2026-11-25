// The reply after a run, written in code from the run record (plan item 1, 25 Nov). The model never writes the first
// reply after a screen, a study or an area budget: every name, number and decision here comes from the record, so
// nothing can be retyped wrong, and the reply can't run long. The model answers follow-ups (get_run).
// No DOM, so the page, the replay script and the tests share it.
import { budgetSummary } from "./developable.js";
import { searchHeadline } from "./siterole.js";

const MAX_FLAGS = 3;
const MAX_GAPS = 4;

const km = (v) => (v == null ? null : v === 0 ? "on the site" : v < 1 ? `${Math.round(v * 1000)} m away` : `${Math.round(v * 10) / 10} km away`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const an = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
// "looking out to 20 km (bands at 1, 5 and 20 km, the default for a solar farm onshore)"
function reachLine(d) {
  const why = d.set_by === "person" ? "as you set them" : d.set_by === "skill" ? "the study's own distances" : `the default for ${an(`${d.asset_label} ${d.setting}`)}`;
  return `looking out to ${d.wider} km (bands at ${d.near}, ${d.close} and ${d.wider} km, ${why})`;
}
const sentence = (s) => { const t = String(s || "").trim(); return t ? (/[.!?]$/.test(t) ? t : `${t}.`) : ""; };

// Where the nearest traced evidence is, in the words the card uses.
function whereOf(f, searchArea) {
  if (f.nearest_km == null) return null;
  if (f.nearest_km === 0 && searchArea) return "in the search area";
  return km(f.nearest_km);
}

function flagLine(f, searchArea) {
  const rated = [f.severity ? `${f.severity} severity` : null, `${f.confidence} confidence`].filter(Boolean).join(", ");
  const where = whereOf(f, searchArea);
  const linkage = f.linkage ? ` (${f.linkage.rating} linkage)` : "";
  return `- ${f.id} ${String(f.risk).replace(/[.\s]+$/, "")}${linkage}: ${rated}${where ? `; ${where}` : ""}`;
}

// What wasn't checked: the checks that came back not checked, musts first, by their labels.
function gapsLine(r) {
  const nc = (r.checks || []).filter((c) => c.state === "not_checked");
  if (!nc.length) return null;
  const ordered = [...nc.filter((c) => c.must), ...nc.filter((c) => !c.must)];
  const names = [...new Set(ordered.map((c) => c.label.toLowerCase()))];
  const shown = names.slice(0, MAX_GAPS);
  const more = names.length - shown.length;
  return `Not checked: ${list(shown)}${more ? ` and ${plural(more, "other check")}` : ""}.`;
}

// The first line: what ran, on what, and the decision.
function header(r, what) {
  const decision = r.decision?.value ? `: **${r.decision.value}**` : "";
  return `**${what} of ${r.site.name} (${r.id})**${decision}.`;
}

function decisionLines(r) {
  const out = [];
  if (r.decision?.why) out.push(sentence(r.decision.why));
  if (r.decision?.changed) out.push(`Tobler changed the decision ${String(r.decision.changed).replace(": ", ", because ")}.`);
  return out;
}

function flagsBlock(r, { noun = "flag", none = "No flags raised." } = {}) {
  if (r.parse_error) return ["The analyst's result couldn't be read, so there are no structured flags. Its write-up is kept on the card."];
  if (!r.flags.length) return [none];
  const searchArea = r.site.role === "search_area";
  const shown = r.flags.slice(0, MAX_FLAGS);
  const more = r.flags.length - shown.length;
  return [`${more ? `The ${shown.length} most serious of ${plural(r.flags.length, noun)}` : r.flags.length === 1 ? `One ${noun}` : `${r.flags.length} ${noun}s`}, most serious first:`,
    ...shown.map((f) => flagLine(f, searchArea))];
}

// The constraints screen.
export function screenReply(record, { replaced = null } = {}) {
  const r = record.tobler_run;
  const asset = `${r.site.asset_label}${r.site.asset_assumed ? " (assumed: you didn't say what's planned)" : ""}`;
  const paras = [];
  paras.push([header(r, "Constraints screen"), ...decisionLines(r)].join(" "));
  const context = [
    `Screened for ${an(asset)}, ${r.extent === "inside" ? "inside the area only" : reachLine(r.distances)}.`,
    r.site.outside_profile || null,
    r.site.role === "search_area" ? searchHeadline(r.site) : null,
    r.note_scope || null,
  ].filter(Boolean);
  paras.push(context.join(" "));
  if (replaced) paras.push(replaced);
  paras.push(flagsBlock(r).join("\n"));
  const gaps = gapsLine(r);
  if (gaps) paras.push(gaps);
  paras.push("The card below has the evidence, next steps and the distance slider. Ask me about any flag.");
  return paras.join("\n\n");
}

// A study other than the screen: the contamination desk study.
export function studyReply(record, { replaced = null } = {}) {
  const r = record.tobler_run;
  const label = r.study?.label || "Study";
  const paras = [];
  paras.push([header(r, label), ...decisionLines(r)].join(" "));
  const context = [
    `Checked the open records on the site and ${reachLine(r.distances).replace(/^looking out to (\S+ km)/, "out to $1 from its edge")}.`,
    r.site.role === "search_area" ? searchHeadline(r.site) : null,
  ].filter(Boolean);
  paras.push(context.join(" "));
  if (replaced) paras.push(replaced);
  paras.push(flagsBlock(r, { noun: "possible linkage", none: "No contaminant linkages found in the open records checked." }).join("\n"));
  const gaps = gapsLine(r);
  if (gaps) paras.push(gaps);
  const adds = r.study?.full_study_adds?.length || 0;
  paras.push(`The card below sets out the sources, pathways and receptors checked${adds ? `, and the ${plural(adds, "thing")} a full desk study would add that open records don't hold` : ""}. Ask me about any linkage.`);
  return paras.join("\n\n");
}

// The developable area: the budget's own summary, which the card and report also use.
export function budgetReply(record, { replaced = null } = {}) {
  const r = record.tobler_run;
  const paras = [`**Developable area of ${r.site.name} (${r.id})**`, budgetSummary(r.budget)];
  if (r.budget.unknown?.length) paras.push(`These weren't deductions Tobler measures, so they were left out: ${r.budget.unknown.join(", ")}.`);
  if (replaced) paras.push(replaced);
  paras.push("The card below has each deduction with its reason and source, and the map shows what's left. Tell me to change a buffer, leave something out or treat it as usable at a cost, and I'll run it again.");
  return paras.join("\n\n");
}

export function runReply(record, opts = {}) {
  const r = record.tobler_run;
  if (r.budget) return budgetReply(record, opts);
  if (r.study) return studyReply(record, opts);
  return screenReply(record, opts);
}

// ---- held runs: the place is shown and confirmed, or narrowed, before anything runs ----------------------------
const size = (o) => (o.geometry === "Point" ? "a point" : o.area_km2 != null ? (o.area_km2 < 1 ? `${Math.round(o.area_km2 * 100)} ha` : `${Math.round(o.area_km2 * 10) / 10 > 100 ? Math.round(o.area_km2).toLocaleString("en-GB") : Math.round(o.area_km2 * 10) / 10} km²`) : o.length_km != null ? `${Math.round(o.length_km * 10) / 10} km long` : null);
const WHICH_PART = {
  water: (o) => ({ is: `is a lake or other water body${o.area_km2 ? ` (${size(o)})` : ""}`, ask: "Which part of it is the site?", ways: `draw it on the map, describe it ("a 2 km² block at the north end"), or use the whole of ${o.place} as a rough first look` }),
  region: (o) => ({ is: `is ${o.what}${o.area_km2 ? ` (${size(o)})` : ""}`, ask: "Which part of it is the site?", ways: `draw it, name a block, permit or parcel, or describe it ("a 10 km² area south-east of the capital"). I can run it on all of ${o.place} as a rough first look, but flags from anywhere in it won't say much about one site` }),
  settlement: (o) => ({ is: "is a town or village", note: o.geometry === "Point" ? "What's on the map is its centre point." : "The outline is the whole place.", ask: "Where in or around it is the site?", ways: `draw it, or describe it ("a 5 ha field on the north edge"), or screen around the ${o.geometry === "Point" ? "centre point" : "whole place"} as a rough first look` }),
  line: (o) => ({ is: "is a road, railway or river", ask: "Where along it is the site?", ways: "draw it, or describe it (\"a 2 ha plot on the east side, by the roundabout\")" }),
};

export function heldReply(o) {
  if (o.held === "skills") return `**${o.place}** is ready. Which analysis would you like? The options are under this message.`;
  if (o.held === "which_part") {
    const w = (WHICH_PART[o.kind] || WHICH_PART.region)(o);
    return `**${o.place}** ${w.is}, so it isn't a site yet.${w.note ? ` ${w.note}` : ""} ${w.ask} You can ${w.ways}. Then I'll run ${o.queued}.`;
  }
  // confirm
  const found = [
    o.anchor ? `built on ${o.anchor}${o.source ? ` (${o.source})` : ""}` : null,
    size(o),
    o.confidence ? `${o.confidence} confidence` : null,
  ].filter(Boolean).join(", ");
  const role = o.role === "search_area"
    ? o.geometry === "Point" ? " It's a point, so the run will treat a small area round it as a search area: findings in it may or may not be on the site."
      : ` It's a search area (${o.role_why}), because the site's own outline wasn't found: findings in it may or may not be on the site.`
    : o.role === "point" ? " It's a point, so the run will treat a small area round it as a search area: findings in it may or may not be on the site." : "";
  return `I've put **${o.place}** on the map: ${found}.${role} Is that the right place? If it is, say so (or use it from the card) and I'll run ${o.queued}. If not, tell me what to change, or draw the site.`;
}

// For runTurn's finish hook: the tools that end the conversation's turn, and the reply code writes for each.
// screening: the page's createScreening service (for the run records). Returns null when the model should carry on.
export function finishTurn(screening) {
  return (name, input, out) => {
    if (!out || typeof out !== "object") return null;
    if (name === "screen_site" || name === "run_study") {
      if (out.run) {
        const rec = screening?.runs?.get(out.run);
        return rec ? runReply(rec) : null;
      }
      // Couldn't run here (offshore, a point for an area budget, no such study): code already wrote why.
      if (out.not_available) return sentence(out.not_available);
      // Held until the person has seen the place, said which part of it is the site, or picked an analysis.
      if (out.held) return heldReply(out);
    }
    return null;
  };
}
