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

// The baseline layers a profile's screens must check: its own list, or the trusted services' list.
export function baselineFor(profile, trusted) {
  return Array.isArray(profile?.baseline) ? profile.baseline : trusted?.baseline || [];
}

// The overall decision, kept to the profile's words; anything else is dropped rather than guessed.
export const DECISIONS = ["progress", "progress with targeted investigation", "major issue", "insufficient evidence"];
export function readDecision(value, why, allowed = DECISIONS) {
  const v = String(value || "").trim().toLowerCase();
  return allowed.includes(v) ? { value: v, why: String(why || "").trim() } : null;
}

// "Insufficient evidence" only when no biodiversity source was checked at all (Rob, 22 Nov), not because one layer
// failed. A source counts as checked when a tool reached it (features found or none in the dataset). Settled in code
// after the analyst writes its decision, and the card says so when it changes. Without any biodiversity source, a
// clean-looking "progress" becomes insufficient evidence; a major issue stays, because something serious was found.
export const biodiversityChecked = (checked = []) => checked.some((c) => c?.evidence === "biodiversity" && c.result && c.result !== "not checked");
export function settleDecision(decision, { checked = [], flags = [] } = {}) {
  if (!decision) return decision;
  const bio = biodiversityChecked(checked);
  if (decision.value === "insufficient evidence" && bio) {
    const major = flags.some((f) => f.severity === "high" && (f.confidence === "high" || f.confidence === "medium"));
    const value = major ? "major issue" : "progress with targeted investigation";
    return { ...decision, value, changed: `from insufficient evidence: biodiversity sources were checked, so the sources that failed are listed as gaps instead` };
  }
  if (!bio && (decision.value === "progress" || decision.value === "progress with targeted investigation")) {
    return { ...decision, value: "insufficient evidence", changed: `from ${decision.value}: no biodiversity source could be checked` };
  }
  return decision;
}
