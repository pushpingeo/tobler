import { topicsShort } from "./checks.js";

// Industries (20 Nov): Settings → Industry picks a profile (catalogue/industries/<id>.json) that decides which
// screening method runs, its themes, quick picks, welcome examples, wording and must-check layers. Tools and the
// atlas are shared. Only "ready" profiles can be chosen; the others show as "coming soon". Pure, so it can be tested.

// The industry in use: the stored choice if it's ready, else the index's default.
export function chooseIndustry(index, stored) {
  const list = index?.industries || [];
  const ready = (id) => list.find((i) => i.id === id && i.status === "ready");
  return (ready(stored) || ready(index?.default) || list.find((i) => i.status === "ready") || null)?.id || null;
}

// What the analyst is told each turn, in the project summary.
export function industryNote(profile, index) {
  if (!profile) return "";
  const soon = (index?.industries || []).filter((i) => i.status !== "ready").map((i) => i.label);
  return `Industry: ${profile.label} (screening method: ${profile.wording?.method || profile.skill}).${soon.length ? ` Coming soon: ${soon.join("; ")}.` : ""}`;
}

// The overall decision, kept to the profile's words; anything else is dropped rather than guessed.
export const DECISIONS = ["progress", "progress with targeted investigation", "major issue", "insufficient evidence"];
export function readDecision(value, why, allowed = DECISIONS) {
  const v = String(value || "").trim().toLowerCase();
  return allowed.includes(v) ? { value: v, why: String(why || "").trim() } : null;
}

// The decision rule (Rob, 23 Nov; restated in terms of checks, plan item 1): "insufficient evidence" when every
// must-check for a topic came back not checked (js/checks.js topicsShort). A check counts as checked when its source
// was reached (found or none found). Settled in code after the analyst writes its decision, and the card says so when
// it changes. A clean-looking "progress" becomes insufficient evidence; a major issue stays, because something serious
// was found. Runs from before checks (tobler-run/1, re-assessed) keep the old rule: no biodiversity source checked.
export const biodiversityChecked = (checked = []) => checked.some((c) => c?.evidence === "biodiversity" && c.result && c.result !== "not checked");
export function settleDecision(decision, { checked = [], flags = [], checks = null, topicLabel = (t) => t } = {}) {
  if (!decision) return decision;
  const short = checks ? topicsShort(checks) : biodiversityChecked(checked) ? [] : ["biodiversity"];
  const names = short.map((t) => topicLabel(t).toLowerCase()).join(" and ");
  if (decision.value === "insufficient evidence" && !short.length) {
    const major = flags.some((f) => f.severity === "high" && (f.confidence === "high" || f.confidence === "medium"));
    const value = major ? "major issue" : "progress with targeted investigation";
    return { ...decision, value, changed: checks
      ? "from insufficient evidence: every topic's must-checks were reached, so the sources that failed are listed as gaps instead"
      : "from insufficient evidence: biodiversity sources were checked, so the sources that failed are listed as gaps instead" };
  }
  if (short.length && (decision.value === "progress" || decision.value === "progress with targeted investigation")) {
    return { ...decision, value: "insufficient evidence", changed: checks
      ? `from ${decision.value}: none of the must-checks for ${names} could be checked`
      : `from ${decision.value}: no biodiversity source could be checked` };
  }
  return decision;
}
