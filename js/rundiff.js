// Why a rerun changed (plan item 1, 25 Nov). The same request on the same site gave different decisions with no
// explanation (Oracle campus ×6, Évora ×2, Dogger Bank R1 → R2 in the 18–24 Nov logs). Each new run of a skill on
// a place is compared with the last one, in code: what was asked, the site, the checks' answers (found, none found,
// not checked) and the result. When the asking, the site and the checks are all the same, the difference can only
// be the analyst's judgement, and the reply says so. No DOM.
import { topicOf } from "./findings.js";

const list = (xs, and = "and") => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} ${and} ${xs.at(-1)}`);
const STATE = { found: "found something", none: "none found", not_checked: "not checked" };

function askedLines(a, b) {
  const out = [];
  if (a.site.asset_label !== b.site.asset_label) out.push(`asked as ${a.site.asset_label} then, ${b.site.asset_label} now`);
  // How far the checks looked: an old run's near/close/wider, or a new run's range and the person's changes.
  const d = (r) => (r.extent === "inside" ? "inside only"
    : r.reach ? (r.reach.changes?.length ? r.reach.changes.map((c) => c.line).join("; ") : `the defaults (${r.reach.range})`)
    : r.distances ? `${r.distances.near}/${r.distances.close}/${r.distances.wider} km` : "");
  if ((a.reach || a.distances) && (b.reach || b.distances) && d(a) !== d(b)) out.push(`distances ${d(a)} then, ${d(b)} now`);
  const inp = (r) => JSON.stringify({ ...(r.inputs || {}), replaces: undefined, distances: undefined });
  if (!out.length && a.inputs && b.inputs && inp(a) !== inp(b)) out.push("asked with different settings");
  return out;
}

// Checks whose state moved: the ones that matter for "why did it change".
function checkMoves(a = [], b = []) {
  const old = new Map(a.map((c) => [c.id, c]));
  const reached = [], lost = [], answer = [];
  for (const c of b) {
    const o = old.get(c.id);
    if (!o || o.state === c.state) continue;
    if (o.state === "not_checked") reached.push(c.label);
    else if (c.state === "not_checked") lost.push(c.label);
    else answer.push(`${c.label} (was ${STATE[o.state]}, now ${STATE[c.state]})`);
  }
  return { reached, lost, answer };
}

// old, now: run records. Returns { same_inputs, same_site, same_checks, lines: [...] } for the record and the reply.
export function runDiff(oldRec, newRec, { siteChanged = null } = {}) {
  const a = oldRec.tobler_run, b = newRec.tobler_run;
  const lines = [];
  const asked = askedLines(a, b);
  if (asked.length) lines.push(`What was asked changed: ${list(asked)}.`);
  if (siteChanged) lines.push(`The site changed: ${siteChanged}.`);
  const moves = checkMoves(a.checks || [], b.checks || []);
  if (moves.lost.length) lines.push(`Not reached this time: ${list(moves.lost)}.`);
  if (moves.reached.length) lines.push(`Reached this time but not before: ${list(moves.reached)}.`);
  if (moves.answer.length) lines.push(`Different answers: ${list(moves.answer)}.`);
  const sameChecks = !moves.lost.length && !moves.reached.length && !moves.answer.length;
  // Layers the person brought in after the earlier run, judged in this one (26 Nov).
  const had = new Set((a.brought_in || []).map((x) => x.atlas_id));
  const newly = (b.brought_in || []).filter((x) => !had.has(x.atlas_id)).map((x) => x.dataset);
  if (newly.length) lines.push(`This run also judged what you brought in: ${list(newly)}.`);
  // The result.
  if (a.budget && b.budget) {
    if (a.budget.net_ha !== b.budget.net_ha) lines.push(`Net area: was ${a.budget.net_ha} ha, now ${b.budget.net_ha} ha.`);
  } else {
    const dv = (r) => r.decision?.value || null;
    // A screen from 27 Nov has no decision word (package E): an older run's isn't compared with it, and the reply says why.
    const byRel = (r) => r.order === "relevance";
    if (byRel(b) && !byRel(a)) { if (dv(a)) lines.push(`Screens no longer give a decision word, so ${a.id}'s "${dv(a)}" isn't compared: this one leads with what's on the site and in range.`); }
    else if (dv(a) !== dv(b)) lines.push(`Decision: was ${dv(a) || "none"}, now ${dv(b) || "none"}.`);
    const topics = (r) => new Set((r.flags || []).map((f) => topicOf(f.theme)));
    const label = (t) => (b.topic_labels?.[t] || a.topic_labels?.[t] || t).toLowerCase();
    const ta = topics(a), tb = topics(b);
    const added = [...tb].filter((t) => !ta.has(t)).map(label), dropped = [...ta].filter((t) => !tb.has(t)).map(label);
    if (added.length || dropped.length || a.flags.length !== b.flags.length) {
      lines.push(`Flags: was ${a.flags.length}, now ${b.flags.length}${added.length ? `; new on ${list(added)}` : ""}${dropped.length ? `; none now on ${list(dropped, "or")}` : ""}.`);
    }
    // Nothing moved underneath, but the result did: say plainly where the difference comes from.
    const resultMoved = (byRel(a) === byRel(b) && dv(a) !== dv(b)) || added.length || dropped.length || a.flags.length !== b.flags.length;
    if (resultMoved && !asked.length && !siteChanged && sameChecks && !newly.length) {
      lines.push("The checks came back the same, so the difference is in the analyst's judgement of them, not in the data.");
    }
  }
  if (!lines.length) lines.push("Nothing changed: same request, same checks, same result.");
  return { run: a.id, same_inputs: !asked.length, same_site: !siteChanged, same_checks: sameChecks, lines };
}
