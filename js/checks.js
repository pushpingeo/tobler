// Checks (plan item 1): which checks apply to a site, how far each looks, and how each answer is read, all from
// catalogue/checks.json. A check is a measurement, not a judgement: it comes back as found, none found, or not checked
// with the reason, and the analyst judges what it means. Pure (no DOM, no fetching), so the run, the card, the report
// and the tests share it. The run (js/ntrrun.js) does the fetching with the existing tools and hands the outputs here.

export const STATES = { found: "found", none: "none found", not_checked: "not checked" };
// Why a check wasn't checked. "no_check" is for a topic, not a check: nothing standard checks it yet.
export const REASONS = {
  no_source: "no source for this region",
  partly: "only partly checked",
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
function settingFits(setting, site, reach = 0) {
  if (setting === "land") return !site.offshore;
  // On land, or at sea with the coast within the check's reach (designated landscapes and heritage seen from offshore).
  if (setting === "land_or_coast") return !site.offshore || (site.coast_km != null && site.coast_km <= (reach || 0));
  if (setting === "offshore") return !!site.offshore;
  if (setting === "sea") return !!site.sea;
  return true;
}
// A box grown by km on every side (degrees, widened in longitude by latitude): what a check's reach can touch.
export function growBox([w, so, e, n], km = 0) {
  if (!(km > 0)) return [w, so, e, n];
  const dLat = km / 111.32, mid = Math.min(85, Math.max(Math.abs(so), Math.abs(n)));
  const dLon = km / (111.32 * Math.cos((mid * Math.PI) / 180));
  return [w - dLon, so - dLat, e + dLon, n + dLat];
}
// where_any: several boxes, any of which will do (England, drawn round Wales and Scotland).
const inAny = (boxes, box) => !boxes || boxes.some((b) => overlaps(b, box));
function sourceFits(src, site, box) {
  if (src.setting && !settingFits(src.setting, site)) return false;
  if (!inAny(src.where_any, box)) return false;
  const countries = site.countries || [];
  if (src.not_countries?.some((c) => countries.includes(c))) return false;
  if (!site.offshore && src.countries?.length && countries.length) return src.countries.some((c) => countries.includes(c));
  if (src.countries?.length && !src.where) return false;
  return !src.where || overlaps(src.where, box);
}
const appliesHere = (a = {}, site, reach = 0) => {
  if (!settingFits(a.setting || "any", site, reach)) return false;
  if (a.where && !overlaps(a.where, site.bbox)) return false;
  if (!inAny(a.where_any, site.bbox)) return false;
  // On land, a check for some countries only (the UK pack) applies only there; at sea the box decides.
  if (a.countries?.length && !site.offshore && site.countries?.length && !a.countries.some((c) => site.countries.includes(c))) return false;
  return true;
};

// The checks that apply to a site at a scale, each with every source that covers what its reach can touch (a site
// near a border needs both nations' layers; Dogger Bank needs JNCC's and the EU's). Checks that don't apply (the
// wrong setting or place, or no reach at this scale) are left out: they aren't gaps.
// inside: the person asked to screen inside the area only, so every count looks inside (reach 0).
export function planChecks(catalogue, site, scale, { inside = false } = {}) {
  const out = [];
  for (const c of catalogue?.checks || []) {
    let reach = null;
    if (c.answer !== "value_at_site") {
      const r = c.reach_km?.[scale];
      if (r == null) continue;
      reach = inside ? 0 : r;
    }
    if (!appliesHere(c.applies, site, reach)) continue;
    const box = growBox(site.bbox, reach || 0);
    const sources = (c.sources || []).filter((s) => sourceFits(s, site, box));
    // A tool check (boundaries, values) has one source; the first that covers the site, as before.
    const tool = sources.find((s) => s.tool);
    out.push({ check: c, sources: tool ? [tool] : sources, source: tool || sources.find((s) => !s.pending) || sources[0] || null, reach_km: reach, scale });
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
    ...(c.answer !== "value_at_site" ? { reach_km: plan.reach_km } : {}), ...(c.reach_why ? { why_reach: c.reach_why } : {}), ...(c.caveat ? { caveat: c.caveat } : {}) };
};
const srcOf = (plan, extra = {}, s = plan.source || {}) => {
  return { region: s.region || null, ...(s.atlas_id ? { atlas_id: s.atlas_id } : {}), ...(s.tool ? { tool: s.tool } : {}),
    dataset: extra.dataset || s.record?.title || null, publisher: extra.publisher || s.record?.publisher || null,
    licence: extra.licence || s.record?.licence || null, ...(extra.checked_at ? { checked_at: extra.checked_at } : {}) };
};

// A check that couldn't be run before any fetching: no source for the region, or only pending ones.
export function unsourced(plan) {
  const list = plan.sources || (plan.source ? [plan.source] : []);
  if (!list.length) return { ...base(plan), state: "not_checked", reason: "no_source", why: REASONS.no_source };
  if (list.every((x) => x.pending)) return { ...base(plan), state: "not_checked", reason: "pending", why: [...new Set(list.map((x) => x.pending))].join("; "), source: srcOf(plan, {}, list[0]) };
  return null;
}

// Not checked, from a tool's own words: a licence that's switched off, or a service that didn't answer.
export function notChecked(plan, why, extra = {}) {
  const reason = /licen[cs]e|non-commercial|Master License/i.test(why || "") ? "licence" : "failed";
  return { ...base(plan), state: "not_checked", reason, why: String(plainWhy(why) || REASONS[reason]).split(/(?<=(?:\w{2}|\))\.)\s+(?=[A-Z])/)[0].slice(0, 200), source: srcOf(plan, extra) };
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

// Two features' own extents ([w, s, e, n] in degrees) describe the same thing: boxes that overlap almost completely
// (intersection over union 0.9 or more), or, for points, within about 50 m. Only used across different sources: one
// layer's separate parts of a site have different extents.
export function sameExtent(a, b, { iou = 0.9, pointDeg = 0.0005 } = {}) {
  if (!a || !b) return false;
  const pt = (x) => x[2] - x[0] < 1e-9 && x[3] - x[1] < 1e-9;
  if (pt(a) || pt(b)) return pt(a) && pt(b) && Math.abs(a[0] - b[0]) <= pointDeg && Math.abs(a[1] - b[1]) <= pointDeg;
  const iw = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), ih = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  if (iw <= 0 || ih <= 0) return false;
  const inter = iw * ih, area = (x) => (x[2] - x[0]) * (x[3] - x[1]);
  return inter / (area(a) + area(b) - inter) >= iou;
}

// Short reason for one source, for the partly-checked note: "Natural England: didn't answer".
// A licence reason in the words that fit any dataset (the tool's own wording names WDPA as its example).
const plainWhy = (t) => (/non-commercial/i.test(t || "") ? "non-commercial licence: off unless switched on in Settings" : /Master License/i.test(t || "") ? "Esri licence: off unless you hold one (Settings)" : t);
const firstSentence = (t) => String(plainWhy(t) || "").split(/(?<=(?:\w{2}|\))\.)\s+(?=[A-Z])/)[0].slice(0, 200);
const whoOf = (x) => String(x.source?.record?.publisher || x.source?.region || "a source").replace(/\s*\([^)]*\)\s*$/, "");
// What happened to a source that didn't answer, in a few words; the full reason is in the gaps list.
const shortWhy = (a) => (a.source.pending ? "isn't in Tobler's data yet" : /licen[cs]e|non-commercial|Master License/i.test(a.not_checked || "") ? "is left out (licence)" : "didn't answer");

// A count or inside check from every source that covers it. answers: one per source,
// { source, features?: [{ name, distance_km, around_site, extra }], meta?: { dataset, publisher, licence, checked_at,
// capped, fetched_km }, not_checked?: why }. Each source's filter keeps only its matching features (JNCC's offshore
// set holds SACs, SPAs and MCZs in one layer), and features with the same site code are counted once (sites in two
// nations' layers, or straddling 12 nm). Found if any source found something; none found only if every source that
// matters answered; otherwise not checked. A supplementary source (WDPA beside the UK's own layers) never stops a
// "none found" when another source answered.
// opts.sameShape(geometryA, geometryB): whether two features are the same feature (js/siterole.js sameShape), checked
// only after their boxes nearly match; leave it out (the Settings switch) and shapes aren't compared at all.
export function fromSources(plan, answers = [], edges = [], opts = {}) {
  const ok = answers.filter((a) => !a.not_checked && !a.source.pending);
  const missing = answers.filter((a) => a.not_checked || a.source.pending);
  const sources = answers.map((a) => ({ ...srcOf(plan, a.meta || {}, a.source), state: a.not_checked || a.source.pending ? "not_checked" : "answered",
    ...(a.not_checked || a.source.pending ? { why: firstSentence(a.not_checked || a.source.pending) } : {}) }));
  if (!ok.length) {
    const licence = missing.every((a) => /licen[cs]e|non-commercial|Master License/i.test(a.not_checked || ""));
    const pending = missing.every((a) => a.source.pending);
    const reason = !missing.length ? "no_source" : licence ? "licence" : pending ? "pending" : "failed";
    const why = missing.length ? [...new Set(missing.map((a) => firstSentence(a.not_checked || a.source.pending)))].join("; ") : REASONS.no_source;
    return { ...base(plan), state: "not_checked", reason, why, sources, source: sources[0] || null };
  }
  // The same site from two sources: the same code, the same name within half a kilometre (WDPA has no code field), or
  // the same shape (names differ between publishers: "Wyville Thomson Ridge" and "... SAC"), when the switch is on.
  if (plan.check.answer === "classes") return classesFrom(plan, ok, missing, sources, edges);
  const kept = [];
  const nm = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const [si, a] of ok.entries()) {
    for (const x of a.features || []) {
      if (!passes(a.source, x)) continue;
      const code = a.source.code_field && x.extra?.[a.source.code_field] != null ? String(x.extra[a.source.code_field]).trim().toUpperCase() : null;
      const y = { ...x, code, src: si, dataset: a.meta?.dataset || "", publisher: whoOf(a), detail: detailOf(a.source, x) };
      const i = kept.findIndex((k) => (code && k.code === code) || (nm(k.name) && nm(k.name) === nm(y.name) && Math.abs((k.distance_km ?? 0) - (y.distance_km ?? 0)) <= 0.5)
        || (opts.sameShape && k.src !== si && sameExtent(k.bbox, y.bbox) && opts.sameShape(k.geometry, y.geometry)));
      if (i < 0) kept.push(y);
      else if ((y.distance_km ?? 1e9) < (kept[i].distance_km ?? 1e9)) kept[i] = { ...y, code: y.code || kept[i].code };
    }
  }
  const fetched = ok.map((a) => a.meta?.fetched_km).filter((v) => v != null);
  const r = fromFeatures(plan, kept, edges, { capped: ok.some((a) => a.meta?.capped), ...(fetched.length ? { fetched_km: Math.min(...fetched) } : {}) });
  r.sources = sources;
  r.source = sources.find((x) => x.state === "answered");
  // The features the check counted, nearest first, for the card's list (the run turns them into map ids).
  r.members = kept.filter((x) => x.around_site || (x.distance_km != null && x.distance_km <= r.reach_km + 1e-9))
    .sort((a, b) => (a.around_site ? 1e9 : a.distance_km) - (b.around_site ? 1e9 : b.distance_km));
  const matters = missing.filter((a) => !a.source.supplementary);
  if (matters.length) r.partly = matters.map((a) => `${whoOf(a)} ${shortWhy(a)}`).join("; ");
  if (r.state === "none" && matters.length) return { ...r, state: "not_checked", reason: "partly", why: `${r.partly} (none in the others)` };
  return withPartial(r, ok);
}
// A source that covers only part of what it's about (a few councils' registers, EPA-funded brownfields: the atlas's
// completeness "partial", 24 Nov): its silence never reads as "none". The line says which records were read.
function withPartial(r, ok) {
  const part = ok.filter((a) => a.source.partial).map((a) => a.source.partial);
  if (!part.length) return r;
  return { ...r, partial: [...new Set(part)].join("; "), ...(ok.every((a) => a.source.partial) ? { only_partial: true } : {}) };
}

// Whether a source keeps a feature: its field filter (JNCC's designations, NI's listed grades) and its name filter
// (World Heritage Site buffer zones apart from the sites themselves), case-insensitive.
export function passes(source, x) {
  const f = source.filter;
  if (f && !f.values.includes(String(x.extra?.[f.field] ?? x.details?.[f.field] ?? ""))) return false;
  const n = source.name_filter;
  if (n?.include && !new RegExp(n.include, "i").test(x.name || "")) return false;
  if (n?.exclude && new RegExp(n.exclude, "i").test(x.name || "")) return false;
  return true;
}
// What a row in a check's list says beside the name: the grade, designation or class.
export function detailOf(source, x) {
  if (source.class || source.class_field) return classOf(source, x);
  const f = source.keep_fields?.[0] || source.filter?.field;
  const v = f ? x.extra?.[f] : null;
  return v != null && String(v).trim() ? `${source.detail_prefix || ""}${String(v).trim()}` : null;
}

// A class answer (flood zones, farmland grade, peat): which classes are on the site, and the nearest of each within
// reach. Each source gives the class from a field (class_field, mapped through classes; values not mapped are left
// out), or is one class itself (class: SEPA publishes one layer per likelihood). Features carry coverage, the share of
// the site they cover (worked out by the run in an equal-area projection); a polygon that only touches the edge isn't
// on the site. The check's class_order puts the most significant first.
export const ON_SITE_MIN = 0.005;
export function classOf(source, x) {
  if (source.class) return source.class;
  const v = String(x.extra?.[source.class_field] ?? "").trim();
  if (!v) return null;
  if (source.classes) return source.classes[v] ?? null;
  return `${source.class_prefix || ""}${v}`;
}
function classesFrom(plan, ok, missing, sources, edges) {
  const reach = plan.reach_km ?? 0;
  const by = new Map();
  const members = [];
  for (const a of ok) for (const x of a.features || []) {
    if (!passes(a.source, x)) continue;
    const label = classOf(a.source, x);
    if (!label || x.distance_km == null || x.distance_km > reach + 1e-9) continue;
    members.push({ ...x, dataset: a.meta?.dataset || "", publisher: whoOf(a), detail: label });
    const onSite = !(x.distance_km > 0) && (x.coverage == null || x.coverage >= ON_SITE_MIN);
    const c = by.get(label) || { label, on_site: false, coverage: 0, nearest_km: null };
    if (onSite) { c.on_site = true; if (x.coverage != null) c.coverage = Math.min(1, c.coverage + x.coverage); }
    else { const d = x.distance_km > 0 ? x.distance_km : 0; if (c.nearest_km == null || d < c.nearest_km) c.nearest_km = d; }
    by.set(label, c);
  }
  const order = plan.check.class_order || [];
  const rank = (l) => { const i = order.findIndex((o) => l.startsWith(o)); return i < 0 ? 99 : i; };
  const classes = [...by.values()].map((c) => ({ ...c, coverage: c.coverage ? Math.round(c.coverage * 1000) / 1000 : null }))
    .sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
  const fetched = ok.map((a) => a.meta?.fetched_km).filter((v) => v != null);
  const r = { ...base(plan), reach_km: fetched.length ? Math.min(reach, ...fetched) : reach, classes, count: classes.length,
    state: classes.length ? "found" : "none", sources, source: sources.find((x) => x.state === "answered"), ...(ok.some((a) => a.meta?.capped) ? { capped: true } : {}),
    members: members.sort((a, b) => (b.coverage || 0) - (a.coverage || 0) || a.distance_km - b.distance_km) };
  const matters = missing.filter((a) => !a.source.supplementary);
  if (matters.length) r.partly = matters.map((a) => `${whoOf(a)} ${shortWhy(a)}`).join("; ");
  if (r.state === "none" && matters.length) return { ...r, state: "not_checked", reason: "partly", why: `${r.partly} (none in the others)` };
  return withPartial(r, ok);
}


// The SSSI Impact Risk Zones: the 13-digit irzcode (the IRZURL field's query parameter) read for the categories that
// fit the development (the profile's irz_categories by asset type, plus "all consultations"). table: the atlas's
// vocab/sssi_irz_codes.json, copied into catalogue/. Natural England's own wording, verbatim. Pure lookup, no judgement.
export function irzCodeOf(v) {
  const m = String(v || "").match(/irzcode=(\d{13})/) || String(v || "").match(/^(\d{13})$/);
  return m ? m[1] : null;
}
export function decodeIrz(codes = [], table, keys = []) {
  const want = ["ac", ...keys.filter((k) => k !== "ac")];
  const out = [];
  for (const key of want) {
    const p = (table?.positions || []).find((x) => x.key === key);
    if (!p) continue;
    const texts = [...new Set(codes.map((c) => c[p.position - 1]).filter((d) => d && d !== "0").map((d) => p.levels[d]).filter(Boolean))];
    out.push({ key, category: p.category, consult: texts.length > 0, texts });
  }
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
  if (r.answer === "classes") {
    const where = r.search_area ? "in the search area" : "on the site";
    if (r.state === "none") return `none ${r.reach_km > 0 ? `within ${km(r.reach_km)}` : where}`;
    const on = (r.classes || []).filter((c) => c.on_site).map((c) => `${c.label}${c.coverage ? ` (${Math.max(1, Math.round(c.coverage * 100))}%)` : ""}`);
    const near = (r.classes || []).filter((c) => !c.on_site).map((c) => `${c.label} ${c.nearest_km > 0 ? `at ${km(c.nearest_km)}` : "at the edge"}`);
    return [on.length ? `${where}: ${on.join(", ")}` : `none ${where}`, near.length ? `nearby: ${near.join(", ")}` : null].filter(Boolean).join("; ");
  }
  if (r.irz) {
    if (!r.inside) return "the site isn't in a risk zone";
    const hit = r.irz.filter((x) => x.consult);
    return hit.length ? `inside a risk zone; consult Natural England for: ${hit.map((x) => x.category.toLowerCase()).join(", ")}` : "inside a risk zone; no consultation needed for this kind of development";
  }
  const where = r.reach_km === 0 ? `inside or touching the ${r.search_area ? "search area" : "site"}` : `within ${km(r.reach_km)}${r.reach_wanted_km ? ` (of ${km(r.reach_wanted_km)}: the tools fetch to ${km(r.reach_km)})` : ""}`;
  if (r.answer === "inside") return r.inside ? `the ${r.search_area ? "search area" : "site"} is inside ${r.nearest?.name || "one"}${r.nearest?.around ? " (a wide area it lies within)" : ""}` : "the site isn't inside one";
  if (r.state === "none") return r.only_partial ? `none found ${where} in the records read (${r.partial}); the records are partial, so this isn't a clear answer` : `none found ${where}${r.partial ? ` (partial records: ${r.partial})` : ""}`;
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
      source: (r.sources?.length ? r.sources.filter((x) => x.dataset) : r.source ? [r.source] : [])
        .map((x) => [x.dataset, x.publisher && !x.dataset.includes(x.publisher) ? `(${x.publisher})` : null].filter(Boolean).join(" ")).join("; "),
      ...(r.partly ? { partly: r.partly } : {}) })),
  }));
  const noCheck = run.no_check_topics || [];
  // A check's caveat (the contamination checks: "an early screen of open records…") travels with the run and is
  // shown once, whenever any check that carries it ran.
  const caveats = [...new Set(run.checks.map((r) => r.caveat).filter(Boolean))];
  return { summary: checksSummary(run.checks), scale: run.checks_scale || null, groups, ...(caveats.length ? { caveats } : {}),
    noCheck: noCheck.length ? { line: noCheckLine(cat, noCheck), topics: noCheck.map((t) => topicLabel(cat, t)) } : null };
}

// The line for "what still needs checking": topics with no standard check, as work left to do.
export const noCheckGap = (run) => (run?.no_check_topics?.length
  ? `No standard check yet for ${run.no_check_topics.map((t) => (run.topic_labels?.[t] || t).toLowerCase()).join(", ")}: search for these where they matter`
  : null);
