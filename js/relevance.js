// Relevance classes: how a flag's evidence sits against the site, set in code from the run record. They replace the
// analyst's severity and confidence on a constraints screen (package E; samples approved by Rob, 27 Nov). Nothing
// here is a judgement of how much a feature matters: it says where the feature is, against the distance the check
// looks out to, and whether its effect needs a pathway (water, the ground, flight) that distance alone doesn't settle.
// The record keeps values; the words are built at display time, so a units switch is a redraw (lesson 9).
import { whereWords } from "./relation.js";

const SEARCH_BAND = "in the search area"; // js/siterole.js SEARCH_BAND; repeated so this file stays free of the page

// In the order a card lists them. on_site, at_edge and in_search_area are all "direct interaction" and rank together.
export const CLASSES = {
  on_site: { rank: 0, badge: "On site", words: "on the site" },
  at_edge: { rank: 0, badge: "At edge", words: "at the site's edge (within 50 m)" },
  in_search_area: { rank: 0, badge: "Search area", words: "in the search area (the site's outline wasn't found)" },
  in_range: { rank: 1, badge: "In range", words: "within the check's range" },
  pathway: { rank: 2, badge: "Pathway", words: "within range, if a pathway links it to the site" },
  extended: { rank: 3, badge: "Extended", words: "within a distance you widened" },
  beyond_range: { rank: 4, badge: "Beyond range", words: "further than the check usually looks" },
};
export const CLASS_IDS = Object.keys(CLASSES);
const DIRECT = new Set(["on_site", "at_edge", "in_search_area"]);
export const isDirect = (cls) => DIRECT.has(cls);
// Receptors reached only this way need a pathway to the site; sight and road don't (distance mostly settles them).
const PATHWAYS = new Set(["water", "ground", "flight"]);
const PATHWAY_WORDS = { water: "by water", ground: "through the ground", flight: "by flight" };
const ON = new Set(["within", "crosses", "covers"]);
// A check's label without its bracketed detail: "Nationally designated sites (SSSI and equivalents)" → "Nationally
// designated sites". "Nearest homes" reads as "Homes" in a list.
// Lower-case a label inside a sentence, unless it's a proper name ("Special Areas of Conservation", "SSSI").
export const inSentence = (l = "") => (/\s[A-Z]/.test(l) || /^[A-Z]{2}/.test(l) ? l : l.charAt(0).toLowerCase() + l.slice(1));
export const shortLabel = (l = "") => String(l).replace(/\s*\([^)]*\)\s*/g, " ").replace(/^Nearest homes$/i, "Homes").replace(/\s+/g, " ").trim();

// One evidence item (as traceResult resolves it). ctx: { byCheck: Map id → check result, fidCheck: Map fid → check id }.
export function classifyEvidence(e, { byCheck = new Map(), fidCheck = new Map() } = {}) {
  const cid = e.check || fidCheck.get(String(e.fid || e.ref || "").toUpperCase()) || null;
  const c = cid ? byCheck.get(cid) : null;
  const d = e.distance_km ?? null;
  const out = {
    ref: e.fid || e.ref || cid, check: cid, label: c?.label || null, distance_km: d, relation: e.relation || null,
    ...(c?.reach_km != null ? { reach_km: c.reach_km } : {}), must: !!c?.must,
    ...(c?.reached_by?.length ? { reached_by: c.reached_by } : {}),
    // A check that found something reads as its own line ("on the site: Flood Zone 3 (4%)"); kept as said.
    ...(e.check && e.name ? { said: String(e.name).split(": ").slice(1).join(": ") } : {}),
    ...(e.in_search_area && e.coverage != null ? { coverage: e.coverage } : {}),
  };
  if (e.in_search_area || e.band === SEARCH_BAND) return { ...out, class: "in_search_area" };
  if (ON.has(e.relation) || (d === 0 && (!e.relation || e.check))) return { ...out, class: "on_site" };
  if (e.relation === "adjacent") return { ...out, class: "at_edge" };
  if (d == null || e.band === "around the site") return { ...out, class: "in_range" };
  if (c?.reach_km != null && d > c.reach_km + 1e-9) return { ...out, class: "beyond_range" };
  if (c?.reach_from === "person" && c.reach_default_km != null && d > c.reach_default_km + 1e-9) return { ...out, class: "extended", reach_default_km: c.reach_default_km };
  if (c?.reached_by?.length && c.reached_by.every((b) => PATHWAYS.has(b))) return { ...out, class: "pathway" };
  return { ...out, class: "in_range" };
}

// The flag takes the class of its closest traced evidence: the best class, then the nearest. Returns the relevance
// record kept on the flag, or null when nothing traced.
export function relevanceOf(evidence, ctx) {
  const ev = (evidence || []).filter((e) => e.traced !== false).map((e) => classifyEvidence(e, ctx));
  if (!ev.length) return null;
  const best = [...ev].sort((a, b) => CLASSES[a.class].rank - CLASSES[b.class].rank || (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9))[0];
  return { ...best, must: ev.some((x) => x.must) };
}

export function checkMaps(checks = []) {
  const byCheck = new Map(checks.map((c) => [c.id, c]));
  const fidCheck = new Map();
  for (const c of checks) for (const f of c.features || []) if (f?.fid) fidCheck.set(String(f.fid).toUpperCase(), c.id);
  return { byCheck, fidCheck };
}

// The order a card lists flags in (Rob, 27 Nov): class, then nearest first, then must-checks, then the fixed topic
// order, then the analyst's order. Severity and confidence play no part.
export function compareFlags(topicOrder = []) {
  const t = (f) => { const k = topicOrder.indexOf(f.theme); return k < 0 ? 999 : k; };
  return (a, b) => (CLASSES[a.relevance?.class]?.rank ?? 9) - (CLASSES[b.relevance?.class]?.rank ?? 9)
    || (a.nearest_km ?? 1e9) - (b.nearest_km ?? 1e9)
    || Number(!!b.relevance?.must) - Number(!!a.relevance?.must)
    || t(a) - t(b) || (a._i ?? 0) - (b._i ?? 0);
}

const kmText = (km, dist) => (km === 0 ? "the site itself" : dist(km));

// The line under a flag: why it is in its class, from the check, never the model. dist formats a distance in km.
export function relevanceLine(rel, dist = (km) => `${Math.round(km * 1000)} m`) {
  if (!rel) return "Not classed: none of its evidence traced to this run.";
  const label = shortLabel(rel.label) || "This feature";
  const lower = inSentence(label);
  // Never "on the site": the outline wasn't found, so nothing is known to be there (browser-search-area checks it).
  // The card and report already lead with the search-area line, and the source note repeats the caveat.
  if (rel.class === "in_search_area") return `${label}: in the search area${rel.coverage != null ? `, covering ${Math.max(1, Math.round(rel.coverage * 100))}% of it` : ""}.`;
  if (rel.class === "on_site" || rel.class === "at_edge") {
    const where = rel.said ? rel.said.replace(/[.;\s]+$/, "") : whereWords(rel, dist) || "on the site";
    return `${label}: ${where}.`;
  }
  const at = rel.distance_km == null ? "within the run's distances" : `${dist(rel.distance_km)} away`;
  if (rel.class === "beyond_range") return `${label}: ${at}, beyond the ${kmText(rel.reach_km, dist)} this check usually looks.`;
  if (rel.class === "extended") return `${label}: ${at}, within the ${dist(rel.reach_km)} you asked for (the check's own range is ${dist(rel.reach_default_km)}).`;
  const range = rel.reach_km != null ? `, within the ${kmText(rel.reach_km, dist)} range for ${lower}` : "";
  const pw = rel.class === "pathway" ? ` Pathway-dependent: ${rel.reached_by.map((b) => PATHWAY_WORDS[b]).join(" or ")}.` : "";
  return `${label}: ${at}${range}.${pw}`;
}

// In place of the analyst's confidence (Rob, 27 Nov): where the closest evidence comes from, with the caveat the
// dataset itself carries, and how many other sources back the flag. Built from the evidence, never the model.
export function sourceNote(flag) {
  const ev = (flag?.evidence || []).filter((e) => e.traced !== false && e.dataset);
  if (!ev.length) return "";
  const first = ev.find((e) => (e.fid || e.ref || e.check) === flag.relevance?.ref) || ev[0];
  const others = new Set(ev.map((e) => e.dataset).filter((d) => d !== first.dataset)).size;
  const pub = first.publisher && !String(first.dataset).toLowerCase().startsWith(String(first.publisher).toLowerCase().split(" ")[0]) ? ` (${first.publisher})` : "";
  const area = flag.relevance?.class === "in_search_area" ? " Found in a search area that stands in for the site's outline, which wasn't found." : "";
  return `Source: ${first.dataset}${pub}${others ? `, and ${others} other source${others > 1 ? "s" : ""}` : ""}.${area}`;
}

// The screen's headline, as values (kept on the run) and as words. flags carry relevance; checks are the run's.
export function headlineOf(flags = [], checks = []) {
  const direct = flags.filter((f) => isDirect(f.relevance?.class));
  const names = [...new Set(direct.map((f) => shortLabel(f.relevance.label)).filter(Boolean))];
  const ranged = flags.filter((f) => f.relevance && !isDirect(f.relevance.class) && f.relevance.class !== "beyond_range");
  const nc = checks.filter((c) => c.state === "not_checked");
  return { flags: flags.length, direct: direct.length, direct_names: names, in_range: ranged.length,
    beyond_range: flags.filter((f) => f.relevance?.class === "beyond_range").length,
    checks: checks.length, not_checked: nc.length, not_checked_must: nc.filter((c) => c.must).length,
    search_area: direct.some((f) => f.relevance.class === "in_search_area") };
}
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export function headlineText(h) {
  if (!h) return "";
  const parts = [];
  if (h.direct) {
    const names = h.direct_names.map((n, i) => (i ? inSentence(n) : n));
    parts.push(`${h.search_area ? "In the search area or at the site's edge" : "On the site or at its edge"}: ${names.length ? list(names) : `${h.direct} flag${h.direct > 1 ? "s" : ""}`}`);
  }
  if (h.in_range) parts.push(`${h.in_range} ${h.direct ? "more " : ""}flag${h.in_range > 1 ? "s" : ""} within range`);
  if (h.beyond_range) parts.push(`${h.beyond_range} beyond the usual range`);
  if (!h.flags) parts.push("No flags raised");
  if (h.checks) parts.push(h.not_checked
    ? `${h.not_checked} of ${h.checks} checks couldn't be answered${h.not_checked_must ? `, ${h.not_checked_must} of them must-checks` : ""}`
    : `All ${h.checks} checks answered`);
  return `${parts.join(". ")}.`;
}

// A run ordered and badged by relevance (screens from 27 Nov). Older runs, and studies, keep their severity.
export const isRelevanceRun = (r) => r?.order === "relevance";
