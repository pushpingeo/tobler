// The report (20 Nov): what the report page shows, worked out from a run record (full or slimmed for a link).
// Layout follows the outline in the plan ("Outputs", PDF), from the ESIA read: decision first, a site map, a map of
// numbered findings, one row per finding, the evidence and gaps, the method, sources and licences, the disclaimer.
// No DOM, so it can be tested; js/reportpage.js draws it.
import { relationPart } from "./relation.js";
import * as turf from "./vendor/turf.js";
import { topicInfo } from "./findings.js";
import { groupGaps } from "./gaps.js";
import { noCheckGap, checksView } from "./checks.js";

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
// A finding's topic as the report names it. Frameworks (plan item 3c) will choose the heading; until then the neutral topic.
export const themeLabel = (t) => topicInfo(t).label;

// Where each finding's ID goes on the map: on each feature behind it, at the point nearest the site (a polygon the
// site sits in gets a point inside it). Features behind several flags carry all their IDs ("F-01, F-03").
export function findingLabels(record) {
  const r = record.tobler_run;
  const site = record.features.find((f) => f.properties.role === "site");
  const centre = site ? turf.centroid(site) : null;
  const byFid = new Map(record.features.filter((f) => f.properties.role === "evidence").map((f) => [f.properties.fid, f]));
  const ids = new Map();
  for (const fl of r.flags) for (const fid of fl.fids || []) {
    if (!byFid.has(fid)) continue;
    if (!ids.has(fid)) ids.set(fid, { ids: [], theme: fl.theme });
    if (!ids.get(fid).ids.includes(fl.id)) ids.get(fid).ids.push(fl.id);
  }
  return turf.featureCollection([...ids.entries()].map(([fid, v]) => {
    const f = byFid.get(fid);
    return turf.point(labelPoint(f, centre), { label: v.ids.join(", "), theme: v.theme, fid, name: f.properties.name });
  }));
}
function labelPoint(f, centre) {
  const g = f.geometry;
  if (g.type === "Point") return g.coordinates;
  if (g.type === "MultiPoint") return g.coordinates[0];
  try {
    if (/LineString/.test(g.type) && centre) return turf.nearestPointOnLine(f, centre).geometry.coordinates;
    if (/Polygon/.test(g.type) && centre) {
      if (turf.booleanPointInPolygon(centre, f)) return centre.geometry.coordinates;
      const line = turf.polygonToLine(f);
      const lines = line.type === "FeatureCollection" ? line.features : [line];
      return lines.map((l) => turf.nearestPointOnLine(l, centre)).sort((a, b) => a.properties.dist - b.properties.dist)[0].geometry.coordinates;
    }
  } catch { /* fall through */ }
  return turf.pointOnFeature(f).geometry.coordinates;
}

// One row per finding, in the order shown on the card.
export function findingRows(run) {
  return run.flags.map((f) => ({
    id: f.id || "", risk: f.risk, theme: themeLabel(f.theme), colour: topicInfo(f.theme).colour,
    severity: f.severity || "not rated", confidence: f.confidence, nearest_km: f.nearest_km, why: f.why || "", next_step: f.next_step || "",
    relation: f.relation || null, confidence_capped: f.confidence_capped || null, ...(f.linkage ? { linkage: f.linkage } : {}),
    evidence: (f.evidence || []).map((e) => ({ name: e.name || "Unnamed", distance_km: e.distance_km, band: e.band, ...relationPart(e), dataset: e.dataset || "", publisher: e.publisher || "", checked: e.checked ? String(e.checked).slice(0, 10) : "", traced: !!e.traced,
      ...(e.in_search_area ? { in_search_area: true, coverage: e.coverage ?? null, side: e.side ?? null } : {}) })),
  }));
}

// What was checked, failures first, then what was found, then what had nothing.
export function evidenceRows(run) {
  const order = { "not checked": 0, features: 1 };
  return [...run.checked].sort((a, b) => (order[a.result] ?? 2) - (order[b.result] ?? 2)).map((c) => ({
    source: c.dataset, publisher: c.publisher || "", result: c.result === "features" ? `${c.count ?? ""} found`.trim() : c.result,
    when: c.checked_at ? String(c.checked_at).slice(0, 10) : "", licence: c.licence || "", why: c.why || "", failed: c.result === "not checked",
  }));
}

// Every source the report relies on, once, with its licence.
export function sourcesOf(record) {
  const seen = new Map();
  const add = (dataset, publisher, licence) => {
    if (!dataset) return;
    const k = `${dataset}|${publisher || ""}`;
    if (!seen.has(k)) seen.set(k, { dataset, publisher: publisher || "", licence: licence || "" });
    else if (!seen.get(k).licence && licence) seen.get(k).licence = licence;
  };
  // Evidence the analyst named but the tools never returned isn't a source.
  for (const f of record.tobler_run.flags) for (const e of f.evidence || []) if (e.traced) add(e.dataset, e.publisher, e.licence);
  for (const c of record.tobler_run.checked) if (c.result !== "not checked") add(c.dataset, c.publisher, c.licence);
  return [...seen.values()].sort((a, b) => a.dataset.localeCompare(b.dataset));
}

export const gapsOf = (run) => groupGaps(run.data_gaps || [], run.checked || [], [noCheckGap(run)]);
// The checks table (null for runs from before checks): the table a consultant would otherwise build by hand.
export const checksOf = (run) => checksView(run);

export function decisionText(run) {
  return run.decision ? { head: `${cap(run.decision.value)}.`, why: [run.decision.why, run.decision.changed ? `Set by Tobler's rules, ${run.decision.changed}.` : ""].filter(Boolean).join(" ") } : null;
}

// The analyst's summary as paragraphs and lists (it writes light markdown).
export function summaryBlocks(text) {
  const blocks = [];
  for (const raw of String(text || "").split(/\n/)) {
    const line = raw.replace(/\*\*|__/g, "").replace(/^#+\s*/, "").trim();
    if (!line) { blocks.push(null); continue; }
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    const last = blocks.at(-1);
    if (item) { if (last?.list) last.items.push(item[1]); else blocks.push({ list: true, items: [item[1]] }); }
    else if (last && !last.list && last.text) last.text += ` ${line}`;
    else blocks.push({ text: line });
  }
  return blocks.filter(Boolean);
}

// The change log: earlier versions of this run's flags (re-assessments at other distances).
export function changeLog(run) {
  return (run.assessments || []).map((a) => ({ at: String(a.at || "").slice(0, 16).replace("T", " "), within_km: a.within_km,
    flags: Array.isArray(a.flags) ? a.flags.length : a.flags ?? 0, decision: a.decision?.value ?? a.decision ?? null }));
}
