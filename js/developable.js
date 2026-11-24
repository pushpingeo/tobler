// The developable area skill's rules (skills/developable-area/SKILL.md, its "Rules" JSON block), made ready for one run:
// the deductions for an asset type, with the person's own buffers, leave-outs and soft calls applied, and each change
// recorded so the card can say what changed. The rules are the skill's; this file only reads and applies them.
// No DOM, so it runs in the page and the tests.

export function budgetRules(skill) {
  const m = String(skill?.body || "").match(/## Rules[\s\S]*?```json\s*\n([\s\S]*?)\n```/);
  if (!m) throw new Error("The developable area method has no rules block.");
  const rules = JSON.parse(m[1]);
  if (!rules.asset_types || !Array.isArray(rules.deductions)) throw new Error("The developable area rules are missing their asset types or deductions.");
  return rules;
}

const BUFFER_MAX_M = 2000;
// i: { asset_type, buffers: [{ id, buffer_m }], leave_out: [ids], as_soft: [ids] } from the conversation's run_study.
export function resolveDeductions(rules, i = {}) {
  const asset = rules.asset_types[i.asset_type] ? i.asset_type : "general";
  const assumed = !rules.asset_types[i.asset_type];
  const leave = new Set((i.leave_out || []).map(String));
  const soft = new Set((i.as_soft || []).map(String));
  const over = new Map((i.buffers || []).filter((b) => b && Number.isFinite(+b.buffer_m) && +b.buffer_m >= 0).map((b) => [String(b.id), Math.min(BUFFER_MAX_M, Math.round(+b.buffer_m))]));
  const known = new Set(rules.deductions.map((d) => d.id));
  const unknown = [...leave, ...soft, ...over.keys()].filter((id) => !known.has(id));
  const out = [];
  const changes = [];
  for (const d of rules.deductions) {
    const def = typeof d.buffer_m === "object" && d.buffer_m !== null ? d.buffer_m[asset] : d.buffer_m;
    if (leave.has(d.id)) { changes.push(`${d.label}: left out, as you asked`); continue; }
    let buffer = def, kind = d.kind, changed = null;
    if (over.has(d.id)) {
      buffer = over.get(d.id);
      changed = def == null ? `${buffer} m, as you asked (none by default for a ${rules.asset_types[asset]})` : `${buffer} m, as you asked (default ${def} m)`;
    }
    if (buffer == null) continue; // doesn't apply to this asset type
    if (soft.has(d.id) && kind !== "soft") { kind = "soft"; changed = [changed, "counted as usable at a cost, as you asked"].filter(Boolean).join("; "); }
    if (changed) changes.push(`${d.label}: ${changed}`);
    out.push({ id: d.id, label: d.label, kind, checks: d.checks, ...(d.classes ? { classes: d.classes } : {}), buffer_m: buffer, reason: d.reason, ...(changed ? { changed } : {}) });
  }
  // Hard, then buffers, then avoided: the order they're taken off in. Soft last.
  const rank = { hard: 0, buffer: 1, avoid: 2, soft: 3 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return { asset_type: asset, asset_label: rules.asset_types[asset], asset_assumed: assumed, deductions: out, changes, ...(unknown.length ? { unknown } : {}), not_checked: rules.not_checked || [] };
}

// Does a class label match one of a deduction's classes: the same, or that followed by a space.
export const classMatches = (label, classes) => !classes?.length || (label != null && classes.some((c) => label === c || label.startsWith(`${c} `)));

// How far out each check must look for this budget: its largest buffer (a feature further out can't touch the site).
export function reachByCheck(deductions) {
  const m = new Map();
  for (const d of deductions) for (const c of d.checks) m.set(c, Math.max(m.get(c) ?? 0, (d.buffer_m || 0) / 1000));
  return m;
}

// The budget in a few plain sentences: the card's and report's summary, and nothing the table doesn't say.
const fmtHa = (v) => (v >= 100 ? `${Math.round(v)} ha` : `${v.toFixed(1)} ha`);
export function budgetSummary(b) {
  const pct = Math.round(b.net_share * 100);
  const out = [`Net developable area for ${/^general/.test(b.asset_label) ? "a general site" : `a ${b.asset_label}`}${b.asset_assumed ? " (no asset type given)" : ""}: ${fmtHa(b.net_ha)} of ${fmtHa(b.gross_ha)} gross (${pct}%).`];
  const taken = b.rows.filter((r) => r.ha > 0).sort((x, y) => y.ha - x.ha);
  if (taken.length) out.push(`The biggest deduction is ${taken[0].label.toLowerCase()}${taken[0].buffer_m ? ` with a ${taken[0].buffer_m} m buffer` : ""} (${fmtHa(taken[0].ha)}).`);
  else out.push("Nothing in the data checked takes any of the site.");
  const soft = b.soft.filter((r) => r.ha > 0);
  if (soft.length) out.push(`${fmtHa(b.soft_ha)} of what's left is under soft constraints (${soft.map((r) => r.label.toLowerCase()).join(", ")}).`);
  const nc = [...b.rows, ...b.soft].filter((r) => r.state === "not_checked");
  if (nc.length) out.push(`Not checked: ${nc.map((r) => r.label.toLowerCase()).join(", ")}.`);
  return out.join(" ");
}
