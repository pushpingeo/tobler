// Search distance (package A, 26 Nov 2026): each check's reach is the only search distance. The check owns its
// default (catalogue/checks.json, by scale); the asset extends it where there's a stated reason
// (catalogue/assets.json); the person's own distances override both. One reporting ladder for every check, the map's
// rings and the card's slider. Replaces near/close/wider (catalogue/distances.json), which old runs still carry and
// still open with (read, not re-run). Pure, no DOM: the run, the page, the scripts and the tests share it.
import { toKm, ladder as unitLadder, bandText } from "./units.js";

// Tools fetch at most 50 km from a site's edge (nothing beyond 50 km for now: Rob, 26 Nov).
export const MAX_KM = 50;
// Within the site, then these upper edges in km (Rob, 26 Nov). Bands are for reporting, never risk.
export const LADDER = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30, 50];
// The asset types the screen's tool takes (catalogue/assets.json's rows, plus other). Kept here so the tool's schema
// doesn't wait on a fetch; test/reach.test.mjs checks they match the table.
export const ASSET_TYPES = ["solar", "wind-onshore", "wind-offshore", "hydro", "thermal", "substation", "mine", "oil-gas-onshore",
  "platform", "oil-gas-field", "exploration-block", "seismic-survey", "pipeline-cable", "road-rail", "port-terminal", "other"];

const r3 = (v) => Math.round(v * 1000) / 1000;
// "250 m", "1.5 km": a distance as the card and the replies write it (metric: package C does the person's units).
export const kmText = (km) => (km == null ? "" : km < 1 ? `${Math.round(km * 1000)} m` : `${+(+km).toFixed(1)} km`);

// The ladder for a reader's units: the metric one, or in imperial the round one (300 ft, 1,000 ft, ¼ mi, …; Rob,
// 26 Nov: "B everywhere in imperial"). Edges in km either way; the record keeps the metric ladder.
export const ladderFor = (units = "metric") => (units === "imperial" ? unitLadder("imperial").map((e) => e.km) : LADDER);

// The ladder's steps up to a reach, closed at the reach itself: 45 km → …, 20, 30, 45.
export function ladderTo(km, units = "metric") {
  if (!(km > 0)) return [];
  const top = Math.min(MAX_KM, km);
  const out = ladderFor(units).filter((e) => e < top - 1e-9);
  out.push(r3(top));
  return out;
}

// "0–100 m", "500 m–1 km", "2–5 km"; in imperial "0–300 ft", "1,000 ft–¼ mi".
export function bandLabel(from, to, units = "metric") {
  if (units !== "metric") return bandText(from, to, units);
  const f = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : `${+km.toFixed(1)} km`);
  if (to < 1) return `${from === 0 ? "0" : Math.round(from * 1000)}–${f(to)}`;
  return `${from === 0 ? "0" : from < 1 ? f(from) : +from.toFixed(1)}–${f(to)}`;
}

// The band a distance falls in, on the ladder up to top (the run's furthest reach): "on site", a band, or "beyond".
export function ladderBand(km, top = MAX_KM, units = "metric") {
  if (km == null) return "unknown";
  if (km <= 0) return "on site";
  const steps = ladderTo(top, units);
  for (let i = 0; i < steps.length; i++) if (km <= steps[i] + 1e-9) return bandLabel(i ? steps[i - 1] : 0, steps[i], units);
  return "beyond";
}

// The asset for a run: its row (if any), the scale its size picks and why, its footprint radius, and its extensions.
// site: { asset_type, planned, offshore, capacity_mw, tip_height_m, area_km2 }.
const rank = (sc) => ["local", "regional", "global"].indexOf(sc);
export function chooseAsset(table, site = {}) {
  const setting = site.offshore ? "offshore" : "onshore";
  const row = table?.assets?.[site.asset_type] || null;
  const base = row?.[setting] || null;
  const area = +site.area_km2 || 0;
  let scale, footprint, why, note = null, keeps = null;
  const general = table?.general?.[setting] || { scale: setting === "offshore" ? "global" : "regional", footprint_km: 1, why: `general ${setting} default`, by_size: [] };
  if (base) {
    ({ scale, footprint_km: footprint, why } = base);
    why = `${row.label} ${setting}: ${why}`;
    for (const s of row.by_size || []) {
      const hit = (s.below_mw != null && site.capacity_mw != null && site.capacity_mw < s.below_mw)
        || (s.mw != null && site.capacity_mw != null && site.capacity_mw >= s.mw)
        || (s.area_km2 != null && area >= s.area_km2) || (s.below_km2 != null && area > 0 && area < s.below_km2);
      if (!hit) continue;
      // A size rule that widens the scale keeps the checks of the scale it had (Rob, 27 Nov: more reach, never fewer
      // checks); a rule may also name the scale it keeps.
      if (s.scale) { const k = s.keeps || (rank(s.scale) > rank(scale) ? scale : null); keeps = k && k !== s.scale ? k : null; scale = s.scale; }
      if (s.footprint_km != null) footprint = s.footprint_km;
      why = `${why}; ${s.why}`;
    }
  } else {
    ({ scale, footprint_km: footprint, why } = general);
    const rule = area > 0 ? (general.by_size || []).find((s) => area < s.below_km2) : null;
    if (rule) { scale = rule.scale; why = rule.why; }
    const what = row ? `${row.label} ${setting}` : site.planned || (site.asset_type && site.asset_type !== "other" ? site.asset_type : null);
    // An asset with no row runs on the general defaults for its size, and the card says so (Rob, 26 Nov).
    note = what ? `No distances are set for ${what} yet, so the checks use the general defaults for a site of this size.` : "No asset type given, so the checks use the general defaults for a site of this size.";
  }
  const globalFrom = table?.general?.global_from_km2 ?? 100;
  // A very large site is screened at global scale and keeps the checks of the scale it had (Rob, 27 Nov), as a large
  // wind farm does: more reach, never fewer checks.
  if (area >= globalFrom && scale !== "global") { keeps = keeps || scale; scale = "global"; why = `${why}; a site of ${globalFrom} km² or more is screened at global scale, keeping the ${keeps} checks`; }
  // Extensions apply only when the row is for this setting (onshore wind's landscape reach doesn't go to sea).
  const extends_ = base ? (row.extends || []).map((e) => {
    let to = e.to_km;
    if (e.by_tip_height && site.tip_height_m > 0) {
      const step = e.by_tip_height.find(([upTo]) => upTo == null || site.tip_height_m <= upTo);
      if (step) to = step[1];
    }
    return { checks: e.checks || [], topics: e.topics || [], to_km: Math.min(MAX_KM, to), why: e.why, source: e.source,
      ...(e.by_tip_height && site.tip_height_m > 0 ? { tip_height_m: site.tip_height_m } : {}) };
  }) : [];
  return { id: row && base ? site.asset_type : null, label: row?.label || site.planned || "site", row: !!(row && base), setting, scale, scale_why: why,
    ...(keeps ? { keeps } : {}),
    footprint_km: footprint, extends: extends_, ...(note ? { note } : {}), table_version: table?.version || null };
}

// Words the person used for "every check".
const ALL = /^(all|every(thing| check)?|all checks|everything)$/i;
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const words = (s) => norm(s).split(" ").filter(Boolean).map((w) => w.replace(/s$/, ""));
// Do all of what's words appear in a label (singular or plural)? "homes" in "Nearest homes".
const wordsIn = (what, label) => { const w = words(what), l = new Set(words(label)); return w.length > 0 && w.every((x) => l.has(x)); };

// The person's distances, as said: [{ what, value, unit }]. what: "all", a topic, a check, or (in the developable
// area) a deduction. The tool decides from what whether it's a search or a protection distance, and code converts the
// unit (the model passes the number and unit as said and never converts). ctx: { catalogue, deductions (the developable
// area's rules, in a budget run), budget }. Returns { search: [...], protection: [...], not_used: [...] }.
export function readDistances(list, { catalogue = {}, deductions = null, budget = false } = {}) {
  const out = { search: [], protection: [], not_used: [] };
  for (const x of Array.isArray(list) ? list : []) {
    if (!x || typeof x !== "object") continue;
    const what = String(x.what ?? "all").trim() || "all";
    const said = `${x.value}${x.unit ? ` ${x.unit}` : ""}`.trim();
    const km = toKm(x.value, x.unit);
    if (km == null) { out.not_used.push({ what, said, why: "not a distance Tobler reads (metres, kilometres, feet, yards, miles or nautical miles)" }); continue; }
    if (km < 0) { out.not_used.push({ what, said, why: "a distance can't be negative" }); continue; }
    // A deduction (the developable area): a protection distance. Changing one doesn't change how far anything looks.
    const ded = (deductions || []).find((d) => d.id === what || norm(d.label) === norm(what)) || (deductions || []).find((d) => wordsIn(what, d.label) || wordsIn(what, d.id));
    if (budget) {
      if (ded) out.protection.push({ what, said, id: ded.id, label: ded.label, km, buffer_m: Math.round(km * 1000) });
      else out.not_used.push({ what, said, why: "the developable area looks only as far as each deduction's buffer; name the deduction" });
      continue;
    }
    if (ALL.test(what)) { out.search.push({ what: "all", said, km: Math.min(MAX_KM, km), scope: "all", ids: null, label: "every count check", ...(km > MAX_KM ? { capped: true } : {}) }); continue; }
    const topics = catalogue.topics || [], checks = catalogue.checks || [];
    const screenChecks = checks.filter((c) => !c.used_by);
    // Exact names first (a check, then a topic), then words: "heritage" is the topic, not World Heritage Sites.
    const check = screenChecks.find((c) => c.id === what || norm(c.label) === norm(what) || (c.search || []).some((s) => norm(s) === norm(what)));
    const topic = !check ? topics.find((t) => t.id === what || norm(t.label) === norm(what)) : null;
    const loose = !check && !topic ? screenChecks.find((c) => wordsIn(what, c.label)) : null;
    const looseTopic = !check && !topic && !loose ? topics.find((t) => wordsIn(what, t.label)) : null;
    const c1 = check || loose, t1 = topic || looseTopic;
    if (c1) {
      out.search.push({ what, said, km: Math.min(MAX_KM, km), scope: "check", ids: [c1.id], label: c1.label, ...(km > MAX_KM ? { capped: true } : {}) });
    } else if (t1) {
      out.search.push({ what, said, km: Math.min(MAX_KM, km), scope: "topic", topic: t1.id, ids: checks.filter((c) => c.topic === t1.id).map((c) => c.id), label: `${t1.label.toLowerCase()} checks`, ...(km > MAX_KM ? { capped: true } : {}) });
    } else out.not_used.push({ what, said, why: ded ? "that's a developable-area deduction, not a check" : "no check or topic by that name" });
  }
  return out;
}

// Old inputs still come in: a held run or an out-of-date re-run asked with near/close/wider ({ wider: 15 }), and the
// developable area's buffers ([{ id, buffer_m }]). Both become the one list.
export function distancesFromInputs(i = {}) {
  if (Array.isArray(i.distances)) return i.distances;
  const out = [];
  const old = i.distances && typeof i.distances === "object" ? i.distances : null;
  if (old && Number.isFinite(+old.wider) && old.wider !== null && old.wider !== "") out.push({ what: "all", value: +old.wider, unit: "km" });
  for (const b of Array.isArray(i.buffers) ? i.buffers : []) if (b && Number.isFinite(+b.buffer_m)) out.push({ what: String(b.id), value: +b.buffer_m, unit: "m" });
  return out;
}

// Which answers a distance change touches. "Look out to 5 km" sets every count check, cutting as well as stretching;
// a zone check (inside) never stretches (Rob, 26 Nov: a drawn shape beats a computed buffer); a check named outright can
// also be a class check with a reach (flood zones out to 1 km), but never one that reads only the land the site takes.
function touches(change, c, def) {
  if (c.answer === "value_at_site" || c.answer === "inside" || def == null) return false;
  if (change.scope === "all" || change.scope === "topic") return c.answer === "count_by_band" && (change.scope === "all" || c.topic === change.topic);
  return change.ids.includes(c.id) && (c.answer === "count_by_band" || def > 0);
}

// Each check's reach for a run: { km, default_km, from: "check" | "asset" | "person", why, source? }. Checks that don't
// apply at this scale (null) aren't in the map. inside: every count looks inside (0). override(id): a skill's own reach
// for a check (the developable area's buffers), which wins over everything. asset.keeps: a scale whose checks the run
// also keeps (a large wind farm at global scale keeps the regional checks: Rob, 27 Nov); each check then takes the
// further of its two defaults, so nothing local is dropped and nothing wide is cut.
export function resolveReaches(catalogue, { scale, asset = null, search = [], inside = false, override = null } = {}) {
  const m = new Map();
  const also = asset?.keeps && asset.keeps !== scale ? asset.keeps : null;
  for (const c of catalogue?.checks || []) {
    if (c.answer === "value_at_site") continue;
    const own = c.reach_km?.[scale], kept = also ? c.reach_km?.[also] : null;
    const def = own == null ? kept ?? null : kept == null ? own : Math.max(own, kept);
    if (def == null) continue;
    let r = { km: def, default_km: def, from: "check", why: c.reach_why || "" };
    for (const e of asset?.extends || []) {
      if (!(e.checks.includes(c.id) || e.topics.includes(c.topic)) || !(e.to_km > r.km)) continue;
      r = { ...r, km: e.to_km, from: "asset", why: e.why, source: e.source };
    }
    // The person's last word on a check wins (a topic, then that check by name, in the order they said them).
    for (const ch of search) if (touches(ch, c, def)) r = { ...r, km: ch.km, from: "person", why: `you said ${ch.said}${ch.capped ? ` (capped at ${MAX_KM} km, the furthest the tools fetch)` : ""}`, asked: ch.said };
    const o = override?.(c.id);
    if (o != null) r = { ...r, km: o, from: "skill" };
    if (inside) r = { ...r, km: 0 };
    // A check's own default past 50 km (boundaries at global scale: 100 km) is kept: the fetch is cut to 50 km, and the
    // check's line says so ("of 100 km: the tools fetch to 50 km").
    r.km = r3(r.km);
    m.set(c.id, r);
  }
  return m;
}

// "250 m to 10 km, by check", or "500 m" when they're all the same.
export function rangeText(kms) {
  const v = kms.filter((x) => x != null && x > 0).map((x) => Math.min(MAX_KM, x));
  if (!v.length) return "on the site only";
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? kmText(lo) : `${kmText(lo)} to ${kmText(hi)}, by check`;
}

// The card's line of changes, one entry per thing the person said: "every check to 5 km (was 250 m to 10 km, by
// check)". plans: the run's plans (only checks that ran count for "was"); reaches: with the person's changes;
// defaults: without them.
export function changeLines(search, plans, defaults) {
  const ran = plans.filter((p) => p.reach_km != null);
  return search.map((ch) => {
    const hit = ran.filter((p) => touches(ch, p.check, defaults.get(p.check.id)?.km));
    const was = rangeText(hit.map((p) => defaults.get(p.check.id)?.km));
    const to = `${kmText(ch.km)}${ch.capped ? ` (capped at ${MAX_KM} km)` : ""}`;
    return { kind: "search", what: ch.what, said: ch.said, km: ch.km, ids: hit.map((p) => p.check.id),
      line: hit.length ? `${ch.label} to ${to} (was ${was})` : `${ch.label} to ${to}: no check here takes it` };
  });
}

// The run record's reach (replaces run.distances): how far each check looked is on the check; this is the summary.
export function reachRecord({ asset, scale, plans, reaches, changes = [], protection = [], notUsed = [], inside = false, budget = false }) {
  const counted = plans.filter((p) => p.reach_km != null);
  const furthest = inside ? 0 : Math.min(MAX_KM, Math.max(0, ...counted.map((p) => p.reach_km)));
  const extended = counted.filter((p) => reaches.get(p.check.id)?.from === "asset")
    .map((p) => ({ check: p.check.id, label: p.check.label, from_km: reaches.get(p.check.id).default_km, to_km: p.reach_km, why: reaches.get(p.check.id).why, source: reaches.get(p.check.id).source }));
  return {
    scale, ...(asset?.keeps ? { keeps: asset.keeps } : {}), scale_why: asset?.scale_why || "", asset: { id: asset?.id || null, label: asset?.label || "site", row: !!asset?.row, ...(asset?.note ? { note: asset.note } : {}) },
    footprint_km: asset?.footprint_km ?? 1, furthest_km: furthest, ladder: inside || budget ? [] : ladderTo(furthest),
    range: inside ? "inside the area only" : rangeText(counted.map((p) => p.reach_km)),
    ...(extended.length ? { extended } : {}),
    changes: [...changes, ...protection.map((p) => ({ kind: "protection", what: p.what, said: p.said, id: p.id, buffer_m: p.buffer_m, line: p.line || `${p.label} kept ${kmText(p.km)} clear` }))],
    ...(notUsed.length ? { not_used: notUsed.map((n) => ({ ...n, line: `"${n.what}, ${n.said}" wasn't used: ${n.why}` })) } : {}),
    set_by: changes.length || protection.length ? "person" : "default",
  };
}

// One line for the card, the reply and the analyst: "Each check looks out its own distance from the site's edge: 250 m to
// 5 km, by check (general defaults for a site of this size)."
export function reachLine(reach) {
  if (!reach) return "";
  const an = (w) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
  const why = reach.asset?.row ? `defaults for ${an(reach.asset.label)}` : reach.asset?.note || !reach.scale_why ? "general defaults for a site of this size" : reach.scale_why;
  return `each check looks out its own distance from the site's edge: ${reach.range} (${why}${reach.set_by === "person" ? ", with your changes" : ""})`;
}
export const changesLine = (reach) => (reach?.changes?.length ? `You changed: ${reach.changes.map((c) => c.line).join("; ")}.` : "");

// For any run, new or old: how far it reaches, the rings, a distance's band and the distances line. Old runs
// (tobler-run/2 before 27 Nov) carry near/close/wider in run.distances and open as they were.
export const isLegacy = (run) => !run?.reach && !!run?.distances;
export const runFurthest = (run) => (run?.reach ? run.reach.furthest_km : run?.fetched_to_km ?? run?.distances?.wider ?? 0);
// units: the reader's; the rings in imperial sit on the imperial ladder, up to the same furthest reach.
export function runRings(run, units = "metric") {
  if (!run || run.extent === "inside" || run.budget) return [];
  if (run.reach) return units === "imperial" ? (run.reach.ladder.length ? ladderTo(run.reach.furthest_km, units) : []) : [...run.reach.ladder];
  const d = run.distances || {};
  return [d.near, d.close, run.fetched_to_km].filter((v, i, a) => v > 0 && a.indexOf(v) === i);
}
export function runBand(km, run, units = "metric") {
  if (run && isLegacy(run)) {
    const d = run.distances;
    if (km == null) return "unknown";
    if (km <= 0) return "on site";
    return km <= d.near ? "near" : km <= d.close ? "close" : km <= d.wider ? "wider" : "beyond";
  }
  return ladderBand(km, runFurthest(run) || MAX_KM, units);
}
export function legacyDistancesLine(d) {
  return `near ${d.near} km · close ${d.close} km · wider ${d.wider} km (${d.set_by === "person" ? "set by you" : `default for ${d.asset_label} ${d.setting}`})`;
}
export const runDistancesLine = (run) => (run?.reach ? reachLine(run.reach) : run?.distances ? legacyDistancesLine(run.distances) : "");
// The slider's steps: the ladder up to the run's furthest reach (0 first for an area: inside it).
export function sliderSteps(run, area = false, units = "metric") {
  const top = runFurthest(run);
  const steps = isLegacy(run) ? ladderTo(top) : ladderTo(top, units);
  return area ? [0, ...steps] : steps;
}
