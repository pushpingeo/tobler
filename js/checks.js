// Checks (plan item 1): which checks apply to a site, how far each looks, and how each answer is read, all from
// catalogue/checks.json. A check is a measurement, not a judgement: it comes back as found, none found, or not checked
// with the reason, and the analyst judges what it means. Pure (no DOM, no fetching), so the run, the card, the report
// and the tests share it. The run (js/ntrrun.js) does the fetching with the existing tools and hands the outputs here.

export const STATES = { found: "found", none: "none found", not_checked: "not checked" };
// Why a check wasn't checked. "no_check" is for a topic, not a check: nothing standard checks it yet.
export const REASONS = {
  no_source: "no source for this region",
  pending: "source on its way",
  licence: "licence",
  failed: "the source didn't answer",
  no_check: "no standard check yet",
};

const overlaps = (a, b) => !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);

// The screening scale for the check reaches. Until plan item 3 puts scale bands in the profile, it's read off the
// distances the run already chose from the asset type, the site's size and the request (catalogue/distances.json):
// a wider band up to 10 km is a local screen, up to 25 km regional, beyond that global (large licences, offshore
// fields and wind farms). A site of 100 km² or more is global whatever its distances.
export function screenScale(distances = {}, areaKm2 = 0) {
  if (areaKm2 >= 100) return "global";
  const w = +distances.wider || 0;
  return w <= 10 ? "local" : w <= 25 ? "regional" : "global";
}

// The bands inside a reach: the scale's band edges up to the reach, closed at the reach itself.
export function bandsFor(edges = [], reachKm) {
  if (!(reachKm > 0)) return [];
  const out = edges.filter((e) => e < reachKm - 1e-9);
  out.push(reachKm);
  return out;
}

// "0–2 km", "50–250 m": a band's label from its lower and upper edge.
export function bandLabel(from, to) {
  const f = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${+km.toFixed(1)} km`);
  if (to < 1) return `${from === 0 ? "0" : Math.round(from * 1000)}–${f(to)}`;
  return `${from === 0 ? "0" : from < 1 ? f(from) : +from.toFixed(1)}–${f(to)}`;
}

// The site as the checks see it. bbox: the footprint's box; countries: from js/reference.js describe (empty
// offshore); offshore; sea: offshore or the coast within reach (today's rule in js/ntrrun.js).
function settingFits(setting, site) {
  if (setting === "land") return !site.offshore;
  if (setting === "offshore") return !!site.offshore;
  if (setting === "sea") return !!site.sea;
  return true;
}
function sourceFits(src, site) {
  const countries = site.countries || [];
  if (src.not_countries?.some((c) => countries.includes(c))) return false;
  if (!site.offshore && src.countries?.length && countries.length) return src.countries.some((c) => countries.includes(c));
  if (src.countries?.length && !src.where) return false;
  return !src.where || overlaps(src.where, site.bbox);
}

// The checks that apply to a site at a scale, each with the source to use (or why there's none). Checks that don't
// apply (the wrong setting, outside their own box, or no reach at this scale) are left out: they aren't gaps.
// inside: the person asked to screen inside the area only, so every count looks inside (reach 0).
export function planChecks(catalogue, site, scale, { inside = false } = {}) {
  const out = [];
  for (const c of catalogue?.checks || []) {
    if (!settingFits(c.applies?.setting || "any", site)) continue;
    if (c.applies?.where && !overlaps(c.applies.where, site.bbox)) continue;
    let reach = null;
    if (c.answer !== "value_at_site") {
      const r = c.reach_km?.[scale];
      if (r == null) continue;
      reach = inside ? 0 : r;
    }
    const src = (c.sources || []).find((s) => sourceFits(s, site)) || null;
    out.push({ check: c, source: src, reach_km: reach, scale });
  }
  return out;
}

// Topics with nothing checking them on this run: shown as one summary line ("7 topics have no standard check yet"),
// opening into the list (Rob, 23 Nov). A topic for one scale only (Indigenous Peoples: global) counts only there.
export function uncheckedTopics(catalogue, results, scale) {
  const have = new Set(results.map((r) => r.topic));
  return (catalogue?.topics || []).filter((t) => !have.has(t.id) && (!t.only_scale || t.only_scale === scale)).map((t) => t.id);
}

export const topicLabel = (catalogue, id) => (catalogue?.topics || []).find((t) => t.id === id)?.label || id;

const base = (plan) => {
  const c = plan.check;
  return { id: c.id, topic: c.topic, label: c.label, must: !!c.must, answer: c.answer, scale: plan.scale,
    ...(c.answer !== "value_at_site" ? { reach_km: plan.reach_km } : {}), ...(c.reach_why ? { why_reach: c.reach_why } : {}) };
};
const srcOf = (plan, extra = {}) => {
  const s = plan.source || {};
  return { region: s.region || null, ...(s.atlas_id ? { atlas_id: s.atlas_id } : {}), ...(s.tool ? { tool: s.tool } : {}),
    dataset: extra.dataset || s.record?.title || null, publisher: extra.publisher || s.record?.publisher || null,
    licence: extra.licence || s.record?.licence || null, ...(extra.checked_at ? { checked_at: extra.checked_at } : {}) };
};

// A check that couldn't be run before any fetching: no source for the region, or one still pending.
export function unsourced(plan) {
  if (!plan.source) return { ...base(plan), state: "not_checked", reason: "no_source", why: REASONS.no_source };
  if (plan.source.pending) return { ...base(plan), state: "not_checked", reason: "pending", why: plan.source.pending, source: srcOf(plan) };
  return null;
}

// Not checked, from a tool's own words: a licence that's switched off, or a service that didn't answer.
export function notChecked(plan, why, extra = {}) {
  const reason = /licen[cs]e|non-commercial|Master License/i.test(why || "") ? "licence" : "failed";
  return { ...base(plan), state: "not_checked", reason, why: String(why || REASONS[reason]).split(/(?<=(?:\w{2}|\))\.)\s+(?=[A-Z])/)[0].slice(0, 200), source: srcOf(plan, extra) };
}

// A count or inside check from the features the tool returned (each { name, distance_km, around_site }).
// meta: { dataset, publisher, licence, checked_at, capped, fetched_km }.
export function fromFeatures(plan, features, edges = [], meta = {}) {
  // The tools fetch at most 50 km from the edge: a longer reach is cut to what was fetched, and says so.
  const capped = meta.fetched_km != null && meta.fetched_km < plan.reach_km;
  const reach = capped ? meta.fetched_km : plan.reach_km;
  const within = features.filter((f) => f.distance_km != null && f.distance_km <= reach + 1e-9);
  const out = { ...base(plan), reach_km: reach, source: srcOf(plan, meta) };
  if (meta.capped) out.capped = true;
  if (capped) out.reach_wanted_km = plan.reach_km;
  if (plan.check.answer === "inside") {
    const hit = within.filter((f) => !(f.distance_km > 0));
    out.inside = hit.length > 0;
    out.state = hit.length ? "found" : "none";
    if (hit.length) out.nearest = { name: hit[0].name, distance_km: 0, ...(hit[0].around_site ? { around: true } : {}) };
    return out;
  }
  const around = within.filter((f) => f.around_site);
  const onSite = within.filter((f) => !f.around_site && !(f.distance_km > 0));
  const rest = within.filter((f) => !f.around_site && f.distance_km > 0);
  const tops = bandsFor(edges, reach);
  out.count = within.length;
  out.bands = [
    ...(onSite.length || reach === 0 ? [{ label: "on site", count: onSite.length }] : []),
    ...tops.map((to, i) => {
      const from = i ? tops[i - 1] : 0;
      return { from_km: from, to_km: to, label: bandLabel(from, to), count: rest.filter((f) => f.distance_km > from && f.distance_km <= to + 1e-9).length };
    }),
  ];
  if (around.length) out.around = around.length;
  const near = [...onSite, ...rest].sort((a, b) => a.distance_km - b.distance_km)[0] || around[0];
  if (near) out.nearest = { name: near.name, distance_km: near.around_site ? 0 : near.distance_km, ...(near.around_site ? { around: true } : {}) };
  out.state = within.length ? "found" : "none";
  return out;
}

// A value read over the site (elevation, depth, traffic). text: the line for the card; value: the numbers.
export function fromValue(plan, { text, value = null, meta = {} }) {
  return { ...base(plan), state: "found", text, ...(value ? { value } : {}), source: srcOf(plan, meta) };
}

// One line per check, for the card, the report, the analyst and the share link.
const km = (v) => (v < 1 ? `${Math.round(v * 1000)} m` : `${+(+v).toFixed(1)} km`);
export function checkLine(r, { nearest: withNearest = true } = {}) {
  if (r.state === "not_checked") return `not checked: ${r.why || REASONS[r.reason] || "no reason given"}`;
  if (r.answer === "value_at_site") return r.text || "read";
  const where = r.reach_km === 0 ? `inside or touching the ${r.search_area ? "search area" : "site"}` : `within ${km(r.reach_km)}${r.reach_wanted_km ? ` (of ${km(r.reach_wanted_km)}: the tools fetch to ${km(r.reach_km)})` : ""}`;
  if (r.answer === "inside") return r.inside ? `the ${r.search_area ? "search area" : "site"} is inside ${r.nearest?.name || "one"}${r.nearest?.around ? " (a wide area it lies within)" : ""}` : "the site isn't inside one";
  if (r.state === "none") return `none found ${where}`;
  const onSite = r.search_area ? "in the search area" : "on site";
  const bits = (r.bands || []).filter((b) => b.count).map((b) => `${b.count} ${b.from_km == null ? onSite : `at ${b.label}`}`);
  const nearest = withNearest && r.nearest ? `; nearest ${r.nearest.name}${r.nearest.around ? " (around the site)" : r.nearest.distance_km > 0 ? `, ${km(r.nearest.distance_km)}` : ` (${onSite})`}` : "";
  if (r.around) bits.push(`${r.around} around the site`);
  return `${r.count}${r.capped ? "+" : ""} ${where}${bits.length ? ` (${bits.join(", ")})` : ""}${nearest}`;
}

// The decision rule, in terms of checks (replaces "no biodiversity source was checked"): a topic can't be called
// clear when every must-check for it came back not checked. Returns the topics short of evidence.
export function topicsShort(results = []) {
  const byTopic = new Map();
  for (const r of results.filter((x) => x.must)) {
    if (!byTopic.has(r.topic)) byTopic.set(r.topic, []);
    byTopic.get(r.topic).push(r);
  }
  return [...byTopic.entries()].filter(([, rs]) => rs.every((r) => r.state === "not_checked")).map(([t]) => t);
}

// What changed between two runs' checks: for a re-run's card and the analyst's reply ("SAC: none → 1 at 2–5 km").
export function checksChanged(before = [], after = []) {
  const old = new Map(before.map((r) => [r.id, r]));
  const out = [];
  for (const r of after) {
    const o = old.get(r.id);
    const now = checkLine(r);
    if (!o) { out.push(`${r.label}: new check, ${now}`); continue; }
    const was = checkLine(o);
    if (was !== now) out.push(`${r.label}: ${was} → ${now}`);
    old.delete(r.id);
  }
  for (const o of old.values()) out.push(`${o.label}: not run this time (was ${checkLine(o)})`);
  return out;
}

// Grouped by topic in the catalogue's order, for the card and the report.
export function byTopic(catalogue, results = []) {
  const order = (catalogue?.topics || []).map((t) => t.id);
  const groups = new Map();
  for (const r of results) { if (!groups.has(r.topic)) groups.set(r.topic, []); groups.get(r.topic).push(r); }
  return [...groups.entries()].sort((a, b) => (order.indexOf(a[0]) + 1 || 99) - (order.indexOf(b[0]) + 1 || 99))
    .map(([topic, rs]) => ({ topic, label: topicLabel(catalogue, topic), results: rs }));
}

// "12 checks: 3 found, 6 none found, 3 not checked"
export function checksSummary(results = []) {
  const n = (s) => results.filter((r) => r.state === s).length;
  const bits = [n("found") && `${n("found")} found`, n("none") && `${n("none")} none found`, n("not_checked") && `${n("not_checked")} not checked`].filter(Boolean);
  return `Checks: ${results.length}${bits.length ? ` (${bits.join(", ")})` : ""}`;
}

// The line for topics nothing checks yet.
export function noCheckLine(catalogue, topics = []) {
  if (!topics.length) return null;
  const names = topics.map((t) => topicLabel(catalogue, t).toLowerCase());
  return `${topics.length} topic${topics.length === 1 ? " has" : "s have"} no standard check yet: ${names.join(", ")}`;
}

// The topic a check's evidence takes on the map, until frameworks replace the six IFC themes (plan item 2).
export const MAP_THEME = { biodiversity: "biodiversity", heritage: "heritage", "community-health": "community", "land-use": "land",
  "material-assets": "community", indigenous: "indigenous" };
export const mapTheme = (topic) => MAP_THEME[topic] || "context";

// What the card and the report show, from a run record alone (a share link has no catalogue): the checks by topic,
// each with its line and source, and the topics nothing checks yet. null for runs from before checks.
export function checksView(run) {
  if (!Array.isArray(run?.checks)) return null;
  const labels = run.topic_labels || {};
  const cat = { topics: Object.entries(labels).map(([id, label]) => ({ id, label })) };
  const groups = byTopic(cat, run.checks).map((g) => ({
    topic: g.topic, label: g.label,
    items: g.results.map((r) => ({ id: r.id, label: r.label, must: !!r.must, state: r.state, line: checkLine(r),
      source: [r.source?.dataset, r.source?.publisher && r.source.dataset && !r.source.dataset.includes(r.source.publisher) ? `(${r.source.publisher})` : null].filter(Boolean).join(" "),
      ...(r.partly ? { partly: r.partly } : {}) })),
  }));
  const noCheck = run.no_check_topics || [];
  return { summary: checksSummary(run.checks), scale: run.checks_scale || null, groups,
    noCheck: noCheck.length ? { line: noCheckLine(cat, noCheck), topics: noCheck.map((t) => topicLabel(cat, t)) } : null };
}

// The line for "what still needs checking": topics with no standard check, as work left to do.
export const noCheckGap = (run) => (run?.no_check_topics?.length
  ? `No standard check yet for ${run.no_check_topics.map((t) => (run.topic_labels?.[t] || t).toLowerCase()).join(", ")}: search for these where they matter`
  : null);
