// Why a rerun changed (plan item 1, 25 Nov). The same request on the same site gave different decisions with no
// explanation (Oracle campus ×6, Évora ×2, Dogger Bank R1 → R2 in the 18–24 Nov logs). Each new run of a skill on
// a place is compared with the last one, in code: what was asked, the site, the checks' answers (found, none found,
// not checked) and the result. When the asking, the site and the checks are all the same, the difference can only
// be the analyst's judgement, and the reply says so. No DOM.
import { topicOf } from "./findings.js";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const STATE = { found: "found something", none: "none found", not_checked: "not checked" };

function askedLines(a, b) {
  const out = [];
  if (a.site.asset_label !== b.site.asset_label) out.push(`asked as ${a.site.asset_label} then, ${b.site.asset_label} now`);
  const d = (r) => (r.extent === "inside" ? "inside only" : `${r.distances.near}/${r.distances.close}/${r.distances.wider} km`);
  if (a.distances && b.distances && d(a) !== d(b)) out.push(`distances ${d(a)} then, ${d(b)} now`);
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
    if (o.state === "not_checked") reached.push(c.label.toLowerCase());
    else if (c.state === "not_checked") lost.push(c.label.toLowerCase());
    else answer.push(`${c.label.toLowerCase()} (${STATE[o.state]} then, ${STATE[c.state]} now)`);
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
  // The result.
  if (a.budget && b.budget) {
    if (a.budget.net_ha !== b.budget.net_ha) lines.push(`Net area ${a.budget.net_ha} ha then, ${b.budget.net_ha} ha now.`);
  } else {
    const dv = (r) => r.decision?.value || null;
    if (dv(a) !== dv(b)) lines.push(`Decision ${dv(a) || "none"} then, ${dv(b) || "none"} now.`);
    const topics = (r) => new Set((r.flags || []).map((f) => topicOf(f.theme)));
    const label = (t) => (b.topic_labels?.[t] || a.topic_labels?.[t] || t).toLowerCase();
    const ta = topics(a), tb = topics(b);
    const added = [...tb].filter((t) => !ta.has(t)).map(label), dropped = [...ta].filter((t) => !tb.has(t)).map(label);
    if (added.length || dropped.length || a.flags.length !== b.flags.length) {
      lines.push(`${plural(b.flags.length, "flag")} now, ${a.flags.length} then${added.length ? `; new on ${list(added)}` : ""}${dropped.length ? `; none now on ${list(dropped)}` : ""}.`);
    }
    // Nothing moved underneath, but the result did: say plainly where the difference comes from.
    const resultMoved = dv(a) !== dv(b) || added.length || dropped.length || a.flags.length !== b.flags.length;
    if (resultMoved && !asked.length && !siteChanged && sameChecks) {
      lines.push(b.study
        ? "The checks came back the same, so the difference is in the analyst's judgement of them, not in the data."
        : "The checks came back the same, so the difference is in the analyst's own searches and judgement, not in the standard checks.");
    }
  }
  if (!lines.length) lines.push("Nothing changed: same request, same checks, same result.");
  return { run: a.id, same_inputs: !asked.length, same_site: !siteChanged, same_checks: sameChecks, lines };
}
