// "Bring in a layer", after a run (plan item 1, 26 Nov). The screen no longer searches the catalogue on its own: the
// run carries out its checks, the analyst judges them with no tools, and then code looks in the atlas for what wasn't
// checked and offers what it finds. Nothing is fetched until the person says yes; what comes in keeps its publisher,
// licence and date, and is held to the run's distances. No DOM, so the page, the replay script and the tests share it.
import * as turf from "./vendor/turf.js";
import { classifyLicence, licenceBlock } from "./licence.js";
import { bandFor } from "./distances.js";

export const MAX_GAPS = 6; // gaps searched per run
export const MAX_WORDS = 2; // wordings per gap
export const MAX_OFFER = 4; // layers offered per run
export const SEARCH_TIMEOUT_MS = 12000;
export const MAX_KEPT = 200; // features kept on the record per layer brought in, nearest first

// Short text, cut at a word.
const clip = (t, n) => { const s = String(t || "").replace(/\s+/g, " ").trim(); return s.length <= n ? s : `${s.slice(0, n).replace(/[\s,;:]+\S*$/, "")}…`; };

// A licence as the person reads it in a line: the licence's own name where it's a known one, otherwise the
// publisher's words cut short (the card and the record keep them whole).
export function licenceLabel(text, cls) {
  const t = String(text || "");
  if (cls === "unknown" || !t.trim()) return "licence not stated";
  const m = t.match(/\bCC[- ]?BY(?:[- ](?:SA|NC|ND))*(?:[- ]\d\.\d)?\b|\bCC0\b|Open Government Licen[cs]e(?: v(?:ersion)? ?\d(?:\.\d)?)?|\bOGL(?: v?\d(?:\.\d)?)?\b|\bODbL\b|Open Database Licen[cs]e|public domain|Licence Ouverte(?: v?\d\.\d)?|Environment Agency Conditional Licence|Esri Master Licen[cs]e Agreement/i);
  if (m) return m[0].replace(/^cc[- ]?by/i, "CC BY").replace(/^cc0$/i, "CC0").replace(/creative commons /i, "");
  return clip(t, 60);
}

// A check's search words: its own (catalogue/checks.json "search"), or its label without the brackets.
export function wordsForCheck(check) {
  if (Array.isArray(check?.search) && check.search.length) return check.search.slice(0, MAX_WORDS);
  const label = String(check?.label || "").replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  return label ? [label.toLowerCase()] : [];
}

// A gap that a published layer can't fill: a value read over the site (depth, elevation, traffic), the boundaries
// (Tobler's own reference), the everyday OpenStreetMap kinds, and a source held back for a licence decision.
const LICENCE_HOLD = /until Rob decides|doesn't grant re-use|licen[cs]e/i;
function fillable(c, def) {
  if (c.answer === "value_at_site" || c.id === "context.boundaries") return false;
  if ((def?.sources || []).length && def.sources.every((s) => s.osm || s.tool)) return false;
  if (c.reason === "licence" || (c.reason === "pending" && LICENCE_HOLD.test(c.why || ""))) return false;
  return true;
}

// What to look for, in order: must-checks not checked, other checks not checked, what the analyst asked for
// (look_for), then the topics that have no standard check. At most MAX_GAPS.
export function gapsToSearch(run, catalogue = {}) {
  const defs = new Map((catalogue.checks || []).map((c) => [c.id, c]));
  const topics = new Map((catalogue.topics || []).map((t) => [t.id, t]));
  const out = [];
  const seen = new Set();
  const add = (g) => { const k = g.words.join("|").toLowerCase(); if (!g.words.length || seen.has(k)) return; seen.add(k); out.push(g); };
  const nc = (run.checks || []).filter((c) => c.state === "not_checked");
  const fromCheck = (c) => { const def = defs.get(c.id); if (fillable(c, def)) add({ key: c.id, label: c.label, topic: c.topic, words: wordsForCheck(def || c), why: c.why || "not checked" }); };
  // Must-checks first; then what the analyst named for this site (it knows what matters here); then the rest.
  nc.filter((x) => x.must).forEach(fromCheck);
  for (const l of Array.isArray(run.look_for) ? run.look_for : []) {
    const words = (Array.isArray(l.words) ? l.words : [l.words]).map((w) => String(w || "").trim()).filter((w) => w.length >= 3).slice(0, MAX_WORDS);
    if (l.what && words.length) add({ key: `look:${String(l.what).slice(0, 40)}`, label: clip(l.what, 60), topic: l.topic || "context", words, why: "the analyst named it as missing here" });
  }
  nc.filter((x) => !x.must).forEach(fromCheck);
  for (const t of run.no_check_topics || []) {
    const def = topics.get(t);
    if (def?.search?.length) add({ key: `topic:${t}`, label: def.label, topic: t, words: def.search.slice(0, MAX_WORDS), why: "no standard check for this topic yet" });
  }
  return out.slice(0, MAX_GAPS);
}

// One series often has several editions in the atlas (ONS built-up areas: 2011, 2022, …): keep the newest, by the
// year in the title. A title with no year is its own series.
const yearOf = (t) => Math.max(0, ...(String(t).match(/\b(19|20)\d{2}\b/g) || []).map(Number));
const seriesOf = (d) => `${String(d.title || "").toLowerCase().replace(/\b(19|20)\d{2}(\/\d{2,4})?\b/g, "").replace(/\bv?\d+(\.\d+)*\b/g, "").replace(/[^a-z]+/g, " ").trim()}|${String(d.publisher || "").toLowerCase()}`;
export function latestEditions(list) {
  const best = new Map();
  for (const d of list) {
    const k = seriesOf(d);
    const was = best.get(k);
    if (!was || yearOf(d.title) > yearOf(was.title)) best.set(k, d);
  }
  return list.filter((d) => best.get(seriesOf(d)) === d);
}

// The words must be in the title (the atlas also matches publishers and descriptions, which brings in strays).
const inTitle = (title, words) => words.some((w) => String(title || "").toLowerCase().includes(String(w).toLowerCase()));

// Layers that stand in for the real shapes (a centroid for each site, labels) don't answer a gap.
const STAND_IN = /centroid|label|annotation|\bpoints? of\b|index map|footprint grid/i;

// Which result to offer for one gap, or null. Fetchable only; licences the person hasn't switched on are left out;
// a layer the run already used isn't offered again; then trusted and national publishers, open licences.
export function pickLayer(results, { words, used = new Set(), allow = {}, trusted = null }) {
  const ok = latestEditions((results || []).filter((d) => !d.extent_may_be_overstated && (d.capabilities || []).includes("query") && inTitle(d.title, words) && !STAND_IN.test(d.title || "")
    && !used.has(String(d.id)) && !used.has(`${d.title}|${d.publisher}`.toLowerCase())
    && !licenceBlock(classifyLicence(d.licence).class, allow)));
  const rank = (d) => (trusted && trusted.test(d.publisher || "") ? 0 : 2)
    + (/central-gov|regional-gov|public-body|intergov|national|regulator|mapping-agency/i.test(d.publisher_type || "") ? 0 : 1)
    + ({ open: 0, stated: 1, unknown: 2 }[classifyLicence(d.licence).class] ?? 3);
  return ok.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d) - rank(b.d) || a.i - b.i)[0]?.d || null;
}

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error(`no answer in ${Math.round(ms / 1000)} s`)), ms))]);

// Searches the atlas for a run's gaps and returns the offer for the record:
// { at, searched: [{ label, words }], items: [{ id: "L1", gap, label, topic, why, dataset }], nothing: [labels],
//   failed: [labels], state: "open" | "none" }. atlas(tool, args) is the page's atlas call.
// The search is over the site itself (a small margin round it): a layer is offered only if it covers the site,
// whatever the run's wider band.
export async function offerFor(record, { atlas, catalogue = {}, allow = {}, trusted = null, now = () => new Date().toISOString(), timeoutMs = SEARCH_TIMEOUT_MS } = {}) {
  const r = record.tobler_run;
  const gaps = gapsToSearch(r, catalogue);
  const offer = { at: now(), searched: gaps.map((g) => ({ label: g.label, words: g.words })), items: [], nothing: [], failed: [], state: "none" };
  if (!gaps.length) return offer;
  if (!atlas) { offer.failed = gaps.map((g) => g.label); offer.why_failed = "the atlas isn't connected here"; return offer; }
  const site = record.features.find((f) => f.properties?.role === "site");
  const bbox = turf.bbox(turf.buffer(site, 0.5, { units: "kilometers", steps: 8 })).map((v) => Math.round(v * 1e5) / 1e5);
  // What the run already read (by atlas id where the check kept it, else by title and publisher).
  const used = new Set();
  for (const c of r.checks || []) for (const s of [...(c.sources || []), ...(c.source ? [c.source] : [])]) {
    if (s.atlas_id) used.add(String(s.atlas_id));
    if (s.dataset) used.add(`${s.dataset}|${s.publisher || ""}`.toLowerCase());
  }
  for (const c of r.checked || []) if (c.dataset) used.add(`${c.dataset}|${c.publisher || ""}`.toLowerCase());
  const answers = await Promise.all(gaps.map(async (g) => {
    const got = await Promise.allSettled(g.words.map((text) => withTimeout(atlas("find_datasets", { text, bbox, limit: 25 }), timeoutMs)));
    const bad = got.find((x) => x.status === "rejected");
    return { g, results: got.filter((x) => x.status === "fulfilled").flatMap((x) => x.value?.results || []), ...(bad ? { failed: String(bad.reason?.message || bad.reason).slice(0, 120) } : {}) };
  }));
  const taken = new Set();
  for (const a of answers) {
    const d = offer.items.length < MAX_OFFER ? pickLayer(a.results, { words: a.g.words, used: new Set([...used, ...taken]), allow, trusted }) : null;
    // Nothing to offer: "found nothing" only when every wording was searched; if one failed, the search failed.
    if (!d && a.failed) { offer.failed.push(a.g.label); offer.why_failed = a.failed; continue; }
    if (!d) { if (offer.items.length < MAX_OFFER) offer.nothing.push(a.g.label); continue; }
    taken.add(String(d.id));
    const lic = classifyLicence(d.licence);
    offer.items.push({ id: `L${offer.items.length + 1}`, gap: a.g.key, label: a.g.label, topic: a.g.topic, why: a.g.why, state: "offered",
      dataset: { atlas_id: d.id, title: d.title, publisher: d.publisher || "", publisher_type: d.publisher_type || "", licence: d.licence || "not stated", licence_class: lic.class, licence_short: licenceLabel(d.licence, lic.class), coverage: d.coverage || "", capabilities: d.capabilities || [], concepts: d.concepts || [] } });
  }
  offer.state = offer.items.length ? "open" : "none";
  return offer;
}

const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// "Flood zones" → "flood zones" mid-sentence; a proper name ("Important Bird Areas", "SSSI Impact Risk Zones") stays.
export const lower = (s) => { const t = String(s || ""); return /\s[A-Z]/.test(t.replace(/\(.*?\)/g, "")) ? t : t.replace(/^[A-Z](?=[a-z])/, (c) => c.toLowerCase()); };
const licWords = (d) => (d.licence_class === "unknown" ? "licence not stated" : d.licence_class === "open" ? d.licence_short : `${d.licence_short}: not confirmed for commercial use`);

// The offer's lines in the reply after a run (js/runreply.js), written from the record.
export function offerLines(r) {
  const o = r.offer;
  if (!o || !o.searched?.length) return [];
  const out = [];
  const open = o.items.filter((x) => x.state === "offered");
  if (open.length) {
    const reach = r.extent === "inside" ? "inside the area" : `out to ${r.distances.wider} km`;
    out.push([`The atlas has ${open.length === 1 ? "a layer" : "layers"} that may fill ${open.length === 1 ? "a gap" : "some of these gaps"}:`,
      ...open.map((x) => `- **${x.dataset.title}** (${x.dataset.publisher || "publisher not stated"}; ${licWords(x.dataset)}), for ${lower(x.label)}`)].join("\n"));
    out.push(`Bring ${open.length === 1 ? "it" : "them"} in? Use the buttons below, or tell me which. I'll fetch ${reach} and put what's there on the map, with its source. Nothing is added unless you say so.`);
  }
  if (o.nothing.length) out.push(`I looked in the atlas for ${list(o.nothing.map(lower))} and found no layer to offer.`);
  if (o.failed.length) out.push(`The atlas search for ${list(o.failed.map(lower))} didn't answer (${o.why_failed || "no reply"}), so there's nothing to offer for ${o.failed.length === 1 ? "it" : "them"} yet.`);
  return out;
}

// For the project summary the conversation agent reads: what's on offer and waiting for the person.
export function offerSummary(r) {
  const open = (r.offer?.items || []).filter((x) => x.state === "offered");
  return open.length ? `${r.id}: layers offered after the run, waiting for the person (bring_in_layers): ${open.map((x) => `${x.id} ${x.dataset.title} (${x.dataset.publisher}), for ${lower(x.label)}`).join("; ")}` : null;
}

// Bringing layers in: get(dataset, opts) is the data tools' get_data on the run's place (js/datatools.js), which
// puts the features on the map as findings with their source, licence and date. Returns what came in, for the record
// (run.added) and for the reply. ids: offer item ids (L1), or ["all"]; an empty list declines the offer.
export async function bringIn(record, ids, { get, keep, placeName, placeIsPoint = false, now = () => new Date().toISOString() }) {
  const r = record.tobler_run;
  const o = r.offer;
  if (!o?.items?.length) return { run: r.id, not_available: `Nothing was offered after ${r.id}.` };
  const open = o.items.filter((x) => x.state === "offered");
  const want = (ids || []).map((x) => String(x).trim().toUpperCase());
  if (!want.length) {
    for (const x of open) x.state = "declined";
    o.state = "declined";
    return { run: r.id, declined: open.map((x) => x.dataset.title) };
  }
  const chosen = want.includes("ALL") ? open : open.filter((x) => want.includes(x.id));
  const unknown = want.filter((x) => x !== "ALL" && !o.items.some((y) => y.id === x));
  if (!chosen.length) return { run: r.id, not_available: unknown.length ? `${list(unknown)} ${unknown.length === 1 ? "isn't" : "aren't"} on offer for ${r.id}.` : `What was offered for ${r.id} has already been brought in or declined.` };
  // Held to the run's distances, as the card now assesses them (a re-assessment narrows them): inside only stays inside;
  // a point's distances are from the point, so its footprint is added.
  const reach = r.extent === "inside" ? 0 : (r.assessed_within_km ?? r.distances.wider);
  const within = r.extent === "inside" ? 0 : Math.min(50, reach + (placeIsPoint && reach > 0 ? r.distances.footprint_km || 0 : 0));
  let k = record.features.filter((f) => f.properties?.role === "added").length;
  const added = await Promise.all(chosen.map(async (x) => {
    const id = keep({ id: x.dataset.atlas_id, title: x.dataset.title, publisher: x.dataset.publisher, licence: x.dataset.licence, capabilities: x.dataset.capabilities.length ? x.dataset.capabilities : ["query"], concepts: x.dataset.concepts || [] });
    let out;
    // The features themselves go on the record (role "added"), so the run shows them on the map with its own evidence,
    // apart from it, and they travel with the run's file.
    const collect = (list, meta) => {
      for (const c of list.slice(0, MAX_KEPT)) record.features.push({ type: "Feature", geometry: c.geometry, properties: {
        role: "added", fid: `A${++k}`, run: r.id, offer: x.id, name: c.name || c.type || "Unnamed feature", theme: x.topic, distance_km: c.distance_km,
        band: c.around_site ? "around the site" : bandFor(c.distance_km, r.distances), ...(c.around_site ? { surrounds: true } : {}),
        dataset: meta.dataset, publisher: meta.publisher, licence: meta.licence, checked_at: meta.checked_at, ...(c.extra && Object.keys(c.extra).length ? { details: c.extra } : {}) } });
    };
    try { out = await get({ dataset: id, place: placeName, within_km: within, theme: x.topic, limit: 500, collect }); }
    catch (e) { out = { not_checked: String(e.message || e).slice(0, 160) }; }
    x.state = out.not_checked ? "failed" : "brought_in";
    return {
      offer: x.id, for: x.label, topic: x.topic, dataset: x.dataset.title, publisher: x.dataset.publisher, licence: x.dataset.licence_short, licence_full: x.dataset.licence, licence_class: x.dataset.licence_class,
      atlas_id: x.dataset.atlas_id, checked_at: out.checked_at || now(), within_km: within, scope: r.extent === "inside" ? "inside the area" : within === 0 ? "on the site" : `within ${within} km`,
      measured_from: placeIsPoint ? "the point" : r.extent === "inside" ? "inside the area" : "the site's edge",
      ...(out.not_checked ? { not_checked: String(out.not_checked).split(/(?<=\.)\s/)[0].slice(0, 160) } : {
        count: out.within_distance ?? 0, inside: out.inside_or_touching ?? 0,
        nearest: (out.nearest || []).filter((n) => !n.around_site).slice(0, 3).map((n) => ({ name: n.name, distance_km: n.distance_km })),
        ...(out.capped ? { capped: true } : {}), ...(out.time_note ? { time_note: out.time_note } : {}),
      }),
    };
  }));
  r.added = [...(r.added || []), ...added];
  o.state = o.items.some((x) => x.state === "offered") ? "open" : "done";
  return { run: r.id, site: r.site.name, added, ...(unknown.length ? { not_on_offer: unknown } : {}) };
}

const where = (km) => (km === 0 ? "on the site" : km < 1 ? `${Math.round(km * 1000)} m away` : `${Math.round(km * 10) / 10} km away`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The reply after layers come in, written in code from what came back.
export function bringInReply(out) {
  if (out.not_available) return out.not_available;
  if (out.declined) return `OK, nothing brought in. ${out.declined.length === 1 ? "The layer stays" : "The layers stay"} listed on ${out.run}'s card as not checked.`;
  const lines = out.added.map((a) => {
    const head = `**${a.dataset}** (${a.publisher || "publisher not stated"}; ${a.licence_class === "unknown" ? "licence not stated" : a.licence}${a.licence_class === "open" || a.licence_class === "unknown" ? "" : ": not confirmed for commercial use"}; checked ${String(a.checked_at).slice(0, 10)})`;
    if (a.not_checked) return `- ${head}: not checked. ${a.not_checked}`;
    const scope = a.scope || (a.within_km === 0 ? "inside the area" : `within ${a.within_km} km`);
    if (!a.count) return `- ${head}: nothing ${scope} in this layer.`;
    const near = a.nearest.length ? `; nearest ${a.nearest.map((n) => `${n.name}, ${where(n.distance_km)}`).join("; ")}` : "";
    return `- ${head}: ${plural(a.count, "feature")} ${scope}${a.inside && a.within_km > 0 ? ` (${a.inside} on the site)` : ""}${near}${a.capped ? ". The service hit its limit, so there may be more" : ""}.`;
  });
  const ok = out.added.filter((a) => !a.not_checked);
  const from = out.added[0]?.measured_from === "the point" ? " Distances are from the point, not the screen's footprint." : "";
  const tail = [ok.some((a) => a.count) ? "What came in is on the map with its source." : "", from.trim(),
    ok.length ? `${out.run}'s decision and flags were made without ${ok.length === 1 ? "this layer" : "these layers"}; ask me about what came in.` : ""].filter(Boolean).join(" ");
  return [`Brought in for ${out.run}:`, ...lines].join("\n") + (tail ? `\n\n${tail}` : "");
}
