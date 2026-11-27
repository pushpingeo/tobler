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

// The protection distance for one deduction and asset at this place (package D, 27 Nov): a reviewed row from the
// asset table's protection block (catalogue/assets.json) whose country and, where it names one, nation or state the
// site is in. where: { countries: [world outline names], areas: { England: 0, … } from js/ukareas.js, or null when
// the outlines couldn't be loaded }. A row naming a state Tobler has no outlines for can't be decided, so it isn't
// applied and comes back in skipped. Several rows matching (a site across a border): the largest, and it says so.
export function protectionFor(protection, deductionId, asset, where = {}) {
  const countries = new Set(where.countries || []);
  const areas = where.areas;
  const hits = [], skipped = [];
  for (const r of protection?.rows || []) {
    if (r.deduction !== deductionId || r.status !== "reviewed") continue;
    if (r.assets !== "all" && !(r.assets || []).includes(asset)) continue;
    if (r.countries?.length && !r.countries.some((c) => countries.has(c))) continue;
    if (r.in?.length) {
      if (!r.in.every((n) => UK_AREA_NAMES.has(n))) { skipped.push({ row: r, why: "Tobler can't yet tell which state a site is in there" }); continue; }
      if (!areas) { skipped.push({ row: r, why: "the UK's nation outlines couldn't be loaded" }); continue; }
      if (!r.in.some((n) => areas[n] === 0)) continue;
    }
    hits.push(r);
  }
  hits.sort((a, b) => b.m - a.m);
  return { row: hits[0] || null, also: hits.slice(1), skipped };
}
// The nations Tobler has real outlines for (data/ref/uk-areas.json). A row in one of these is decided from the
// outlines; a row in anything else (Victoria, California) can't be yet.
const UK_AREA_NAMES = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);

const BASIS = { reg: "law or regulation", gov: "government guidance", prof: "professional guidance", plan: "local policy", case: "practice in a named case" };
const fmtM = (m) => (Math.round(m * 10) / 10).toString();
// The line under a buffer on the card: where the distance comes from.
export function distanceNote(d) {
  if (!d) return "";
  if (d.basis === "first cut") return "A first cut for site finding, not from a rule or guidance.";
  return `${d.as_published}: ${d.publisher || d.title} (${BASIS[d.basis] || d.basis}${d.secondary ? ", from a secondary source" : ""}).`;
}

// i: { asset_type, buffers: [{ id, buffer_m }], leave_out: [ids], as_soft: [ids] } from the conversation's run_study.
// opts: { protection: the asset table's protection block, where: see protectionFor }.
export function resolveDeductions(rules, i = {}, opts = {}) {
  const asset = rules.asset_types[i.asset_type] ? i.asset_type : "general";
  const assumed = !rules.asset_types[i.asset_type];
  const leave = new Set((i.leave_out || []).map(String));
  const soft = new Set((i.as_soft || []).map(String));
  const over = new Map((i.buffers || []).filter((b) => b && Number.isFinite(+b.buffer_m) && +b.buffer_m >= 0).map((b) => [String(b.id), Math.min(BUFFER_MAX_M, Math.round(+b.buffer_m))]));
  const known = new Set(rules.deductions.map((d) => d.id));
  const unknown = [...leave, ...soft, ...over.keys()].filter((id) => !known.has(id));
  const out = [];
  const changes = [];
  const notes = [];
  for (const d of rules.deductions) {
    const first = typeof d.buffer_m === "object" && d.buffer_m !== null ? d.buffer_m[asset] : d.buffer_m;
    if (leave.has(d.id)) { changes.push(`${d.label}: left out, as you asked`); continue; }
    // A sourced protection distance beats the skill's first cut; only buffers, never a deduction's own land.
    const p = opts.protection ? protectionFor(opts.protection, d.id, asset, opts.where) : { row: null, also: [], skipped: [] };
    for (const { row: r, why } of p.skipped) notes.push(`${d.label}: the distance for ${r.in.join(" and ")} (${r.as_published}) isn't applied, because ${why}`);
    if (p.row && p.also.length) notes.push(`${d.label}: the site is in ${[p.row, ...p.also].map((r) => r.in?.join(" and ") || r.countries.join(", ")).join(" and ")}; the larger distance (${fmtM(p.row.m)} m) is used for the whole site`);
    else if (p.row?.in && opts.where?.areas && Object.entries(opts.where.areas).filter(([n, km]) => km === 0 && UK_AREA_NAMES.has(n)).length > 1)
      notes.push(`${d.label}: the distance for ${p.row.in.join(" and ")} (${fmtM(p.row.m)} m) is used for the whole site, which crosses a border`);
    const def = p.row ? Math.round(p.row.m * 10) / 10 : first;
    const distance = p.row
      ? { basis: p.row.basis, as_published: p.row.as_published, title: p.row.source?.title, publisher: p.row.source?.publisher, url: p.row.source?.url, ...(p.row.secondary ? { secondary: true } : {}), row: p.row.id }
      : (first ? { basis: "first cut" } : null);
    const reason = p.row?.reason || d.reason;
    let buffer = def, kind = d.kind, changed = null;
    if (over.has(d.id)) {
      buffer = over.get(d.id);
      changed = def == null ? `${buffer} m, as you asked (none by default for a ${rules.asset_types[asset]})` : `${buffer} m, as you asked (default ${def} m)`;
    }
    if (buffer == null) continue; // doesn't apply to this asset type
    if (soft.has(d.id) && kind !== "soft") { kind = "soft"; changed = [changed, "counted as usable at a cost, as you asked"].filter(Boolean).join("; "); }
    if (changed) changes.push(`${d.label}: ${changed}`);
    out.push({ id: d.id, label: d.label, kind, checks: d.checks, ...(d.classes ? { classes: d.classes } : {}), buffer_m: buffer, reason, ...(distance && buffer ? { distance } : {}), ...(changed ? { changed } : {}) });
  }
  // Hard, then buffers, then avoided: the order they're taken off in. Soft last.
  const rank = { hard: 0, buffer: 1, avoid: 2, soft: 3 };
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return { asset_type: asset, asset_label: rules.asset_types[asset], asset_assumed: assumed, deductions: out, changes, ...(notes.length ? { notes } : {}), ...(unknown.length ? { unknown } : {}), not_checked: rules.not_checked || [] };
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
