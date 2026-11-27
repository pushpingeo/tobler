// The replay gate's scoring (plan, next step 1): a screen's run record against a site's expected.json, worked out in
// code. No network, no model. Pure functions, so test/replayscore.test.mjs can check them on made-up records.
//
// expected.json (Rob's replay set, eval/replay/<id>/): facts the planning documents state about a real site, each
// { feature, kind, topic, relation, distance_km, direction, weight, note, source }. weight is "must" (on the site,
// next to it, or within 5 km), "should" (further, or position not stated) or "none_expected" (the document says
// there are none within distance_km). They record what's there, not what mattered.
//
// Each fact gets one outcome:
//   found            the check that covers its kind surfaced a feature by that name (or, for a class such as homes or
//                    peat, found something of that class) at about the stated position
//   found_elsewhere  surfaced, but not where the document puts it (a different distance, or not on site)
//   missed           the check ran and answered, and didn't surface it: the outcome the gate exists to catch
//   beyond_reach     the check ran, but not out as far as the document's distance
//   not_checked      the check's sources didn't answer, so Tobler said "not checked" (honest, but a gap)
//   check_not_run    Tobler has a check for this kind, but the run didn't include it (scale, setting, asset)
//   no_check         Tobler has no check for this kind of feature (a core path, a landscape character type)
// and a none_expected fact: agrees, contradicted (the run found one within the distance), not_checked or no_check.
//
// The headline is recall of must facts that Tobler has a check for: found and found_elsewhere over those plus missed
// and beyond_reach. not_checked, check_not_run and no_check are counted apart, so a gap is never scored as a pass
// or hidden as a miss.

// Expected kind → the checks that should find it (catalogue/checks.json ids), and how a match is made: by name, or
// by class (any feature the check returns, for kinds that are a class rather than a named feature).
export const KIND_CHECKS = [
  [/^(potential )?SPA$/i, ["bio.spa"], "name"],
  [/^SAC$/i, ["bio.sac"], "name"],
  [/^Ramsar/i, ["bio.ramsar"], "name"],
  [/^SSSI$/i, ["bio.national-sites"], "name"],
  [/^world heritage site$/i, ["heritage.world-heritage"], "name"],
  [/^scheduled monument/i, ["heritage.scheduled-monuments"], "name"],
  [/^listed building/i, ["heritage.listed-buildings"], "name"],
  [/^(garden and designed landscape|registered park and garden)$/i, ["heritage.parks-gardens"], "name"],
  [/^battlefield/i, ["heritage.battlefields"], "name"],
  [/^wild land area$/i, ["landscape.wild-land"], "name"],
  [/^national park$/i, ["landscape.national-parks"], "name"],
  [/^(national scenic area|AONB|national landscape)$/i, ["landscape.national-landscapes"], "name"],
  [/^(special landscape area|local landscape designation)$/i, ["landscape.local-designations"], "name"],
  [/^ancient woodland$/i, ["bio.ancient-woodland"], "name"],
  [/^(A road|B road|trunk road|road|motorway)$/i, ["material.main-roads"], "name"],
  [/^railway$/i, ["material.railways"], "class"],
  [/^overhead line$/i, ["material.power-lines"], "class"],
  [/^substation$/i, ["material.substations"], "class"],
  [/^(airport|airfield|aerodromes?)$/i, ["material.aerodromes"], "name"],
  [/^wind farm$/i, ["material.wind-turbines"], "class"],
  [/^(loch|reservoir|lake)$/i, ["water.water-bodies"], "name"],
  [/^(river|main river|watercourse)$/i, ["water.watercourses"], "name"],
  [/^homes$/i, ["community.homes"], "class"],
  [/^(peat|peat habitat)$/i, ["ground.peat"], "class"],
  [/^agricultural land (class|grade)$/i, ["land.farmland-grade"], "class"],
  [/^flood zone/i, ["water.flood-zones"], "class"],
];

// A combined kind ("SAC / SSSI", "substation / river") takes every part's checks.
export function checksFor(kind) {
  const parts = String(kind || "").split(/\s*\/\s*/).map((p) => p.trim()).filter(Boolean);
  const ids = new Set(), modes = new Set();
  for (const part of parts) {
    const hit = KIND_CHECKS.find(([re]) => re.test(part));
    if (hit) { hit[1].forEach((x) => ids.add(x)); modes.add(hit[2]); }
  }
  return { ids: [...ids], mode: modes.has("name") ? "name" : modes.size ? "class" : null };
}

// Words that say what kind of thing a feature is, not which one. Left out before names are compared.
const KIND_WORDS = new Set(("sac spa sssi ssi ramsar site sites special area areas of conservation protection scientific " +
  "interest the and wild land wla national scenic nsa world heritage whs scheduled monument monuments listed building " +
  "buildings category garden gardens designed landscape gdl park parks registered sla local nature reserve nnr " +
  "proposed potential nearest house home river burn water loch reservoir airport aerodrome airfield wind farm farms " +
  "complex cluster to near").split(" "));
export function nameTokens(s) {
  return String(s || "").toLowerCase()
    .replace(/\((?:sm|lb|ref)?\s*\d+\)/g, " ")      // record numbers in brackets: (SM3304), (LB7160)
    .replace(/[^a-z0-9]+/g, " ").split(" ")
    .filter((w) => w && !KIND_WORDS.has(w) && !/^(sm|lb)\d+$/.test(w));
}
// Same feature by name: the distinctive words of the shorter name are in the longer one ("Caithness and Sutherland
// Peatlands SAC" and "Caithness & Sutherland Peatlands"). Two allowances, both seen in the baseline (27 Nov): a long
// word may differ by one letter (the document's "Lochgoin" is the register's "Lochgoyn"), and a shorter name of three
// or more words may have one word the other lacks ("Thame Lane railway bridge" and "Thame Lane Bridge"). Road
// numbers and short words must match exactly (A836 is not A83).
const oneEdit = (a, b) => {
  if (a === b) return true;
  if (a.length < 5 || b.length < 5 || Math.abs(a.length - b.length) > 1 || /\d/.test(a + b)) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
};
export function sameName(a, b) {
  const x = nameTokens(a), y = nameTokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  const hit = short.filter((w) => long.some((v) => oneEdit(w, v))).length;
  return hit === short.length || (short.length >= 3 && hit >= short.length - 1);
}

// Where the document puts a fact, against the nearest matching feature's distance (km from the site's edge, 0 on
// site). Documents often measure from the nearest turbine, which is further than from the boundary, so a found
// feature closer than stated is in place; one further than stated by more than the tolerance isn't.
export function inPlace(fact, km) {
  const r = fact.relation, d = fact.distance_km;
  if (r === "on_site") return km <= 0.05;
  if (r === "adjacent") return km <= 0.5;
  if (r === "distance") return km <= d + Math.max(0.5, 0.3 * d);
  if (r === "within") return km <= d + 0.5;
  return true; // position not stated
}

const evidenceOf = (record) => (record.features || []).filter((f) => f.properties?.role === "evidence").map((f) => f.properties);

// One fact against one run record.
export function scoreFact(fact, record) {
  const run = record.tobler_run || {};
  const { ids, mode } = checksFor(fact.kind);
  if (!ids.length) return { outcome: "no_check" };
  const results = (run.checks || []).filter((c) => ids.includes(c.id));
  if (!results.length) return { outcome: "check_not_run", checks: ids };
  const answered = results.filter((c) => c.state !== "not_checked");
  const datasets = new Set(results.flatMap((c) => (c.sources || [c.source]).filter(Boolean).map((s) => s.dataset)).filter(Boolean));
  const ev = evidenceOf(record).filter((e) => datasets.has(e.dataset));
  // A class fact whose name says nothing beyond its kind ("Residential properties") is matched by class.
  const byName = mode === "name" && nameTokens(fact.feature).length > 0;
  const hits = byName ? ev.filter((e) => sameName(fact.feature, e.name)) : ev;
  const reach = Math.max(0, ...results.map((c) => c.reach_km ?? 0));

  if (fact.weight === "none_expected") {
    if (!answered.length) return { outcome: "not_checked", why: results.map((c) => c.why).filter(Boolean)[0] || null };
    const within = hits.filter((e) => e.distance_km != null && e.distance_km <= (fact.distance_km ?? 0) + 1e-9);
    // A class check that found something on site but has no evidence features (peat, farmland grade) still counts.
    const onSiteClass = !byName && (fact.distance_km ?? 0) === 0 && answered.some((c) => (c.classes || []).some((k) => k.on_site));
    return within.length || onSiteClass ? { outcome: "contradicted", found: within.slice(0, 3).map((e) => `${e.name} ${e.distance_km} km`) } : { outcome: "agrees" };
  }

  if (hits.length) {
    const near = hits.reduce((a, b) => ((b.distance_km ?? 1e9) < (a.distance_km ?? 1e9) ? b : a));
    const km = near.distance_km ?? null;
    return { outcome: km != null && inPlace(fact, km) ? "found" : "found_elsewhere", name: near.name, distance_km: km };
  }
  // Class checks such as peat or farmland grade answer with classes, not features.
  // Their position is the nearest class: 0 if any is on the site.
  const classHits = byName ? [] : answered.filter((c) => c.state === "found").flatMap((c) => (c.classes || []).map((k) => ({ name: k.label, km: k.on_site ? 0 : k.nearest_km })));
  if (classHits.length) {
    const near = classHits.reduce((a, b) => ((b.km ?? 1e9) < (a.km ?? 1e9) ? b : a));
    return { outcome: near.km != null && inPlace(fact, near.km) ? "found" : "found_elsewhere", name: near.name, distance_km: near.km };
  }
  if (!answered.length) return { outcome: "not_checked", why: results.map((c) => c.why).filter(Boolean)[0] || null };
  if (fact.distance_km != null && reach && reach < fact.distance_km) return { outcome: "beyond_reach", reach_km: reach };
  return { outcome: "missed", checked: answered.map((c) => `${c.id}: ${c.state}${c.count ? ` ${c.count}` : ""}`) };
}

// A whole site: every fact scored, and the counts.
export function scoreSite(expected, record) {
  const rows = (expected.expected || []).map((f) => ({ fact: f, ...scoreFact(f, record) }));
  const of = (w) => rows.filter((r) => r.fact.weight === w);
  const count = (list) => list.reduce((m, r) => ((m[r.outcome] = (m[r.outcome] || 0) + 1), m), {});
  const must = of("must");
  const hit = must.filter((r) => r.outcome === "found" || r.outcome === "found_elsewhere").length;
  const scored = hit + must.filter((r) => r.outcome === "missed" || r.outcome === "beyond_reach").length;
  return {
    id: expected.id, name: expected.name, rows,
    must: { total: must.length, scored, surfaced: hit, recall: scored ? hit / scored : null, ...count(must) },
    should: count(of("should")), none_expected: count(of("none_expected")),
  };
}

// Regressions against an earlier gate run: a must fact surfaced then and not now, or a none_expected fact that agreed
// then and is contradicted now. A first run has nothing to regress from; it sets the baseline.
export function regressions(now, before) {
  if (!before) return [];
  const key = (r) => `${r.fact.feature}|${r.fact.relation}|${r.fact.distance_km}`;
  const out = [];
  for (const site of now) {
    const old = before.find((b) => b.id === site.id);
    if (!old) continue;
    const was = new Map(old.rows.map((r) => [key(r), r.outcome]));
    for (const r of site.rows) {
      const w = was.get(key(r));
      const wasHit = w === "found" || w === "found_elsewhere";
      const isHit = r.outcome === "found" || r.outcome === "found_elsewhere";
      if (r.fact.weight === "must" && wasHit && !isHit) out.push(`${site.id}: ${r.fact.feature} was ${w}, now ${r.outcome}`);
      if (r.fact.weight === "none_expected" && w === "agrees" && r.outcome === "contradicted") out.push(`${site.id}: ${r.fact.feature} now contradicted`);
    }
  }
  return out;
}

const pct = (x) => (x == null ? "–" : `${Math.round(x * 100)}%`);
const where = (f) => f.relation === "on_site" ? "on site" : f.relation === "adjacent" ? "next to" : f.relation === "distance" ? `${f.distance_km} km` : f.relation === "within" ? `within ${f.distance_km} km` : f.relation === "absent" ? `none within ${f.distance_km} km` : "not stated";

// The threshold (Rob, 27 Nov): every must fact Tobler has a check for is surfaced. A miss or a fact beyond the check's
// reach fails the gate; gaps (not checked, check not run, no check) are reported apart and never fail it.
export function belowThreshold(scores) {
  return scores.flatMap((s) => s.rows.filter((r) => r.fact.weight === "must" && (r.outcome === "missed" || r.outcome === "beyond_reach")).map((r) => `${s.id}: ${r.fact.feature} ${r.outcome}`));
}

// The gate's report, for the push note and the committed results.
export function gateReport(scores, { label = "", trust = null, regressed = [], failed = [] } = {}) {
  const tot = scores.reduce((a, s) => ({ scored: a.scored + s.must.scored, hit: a.hit + s.must.surfaced, total: a.total + s.must.total }), { scored: 0, hit: 0, total: 0 });
  const below = belowThreshold(scores);
  const n = (s, k) => s.must[k] || 0;
  const L = [`# Replay gate${label ? `: ${label}` : ""}`, "",
    `**Must facts surfaced:** ${tot.hit} of ${tot.scored} that Tobler has a check for (${pct(tot.scored ? tot.hit / tot.scored : null)}); ${tot.total} must facts in all.`,
    `**Threshold (every must fact with a check surfaced):** ${below.length ? `failed, ${below.length} not surfaced` : "met"}.`,
    `**Regressions against the last gate run:** ${regressed.length ? regressed.length : "none"}.`, ...(failed.length ? [`**Sites that didn't run:** ${failed.join("; ")}.`] : []), "",
    "| Site | Must surfaced | Recall | Found elsewhere | Missed | Beyond reach | Not checked | Check not run | No check | None-expected contradicted |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...scores.map((s) => `| ${s.id} ${s.name} | ${s.must.surfaced} of ${s.must.scored} | ${pct(s.must.recall)} | ${n(s, "found_elsewhere")} | ${n(s, "missed")} | ${n(s, "beyond_reach")} | ${n(s, "not_checked")} | ${n(s, "check_not_run")} | ${n(s, "no_check")} | ${s.none_expected.contradicted || 0} |`),
    ""];
  if (regressed.length) L.push("## Regressions", "", ...regressed.map((r) => `- ${r}`), "");
  const missed = scores.flatMap((s) => s.rows.filter((r) => r.fact.weight === "must" && (r.outcome === "missed" || r.outcome === "beyond_reach")).map((r) => `- ${s.id}: **${r.fact.feature}** (${r.fact.kind}, ${where(r.fact)}): ${r.outcome}${r.checked ? `; ${r.checked.join(", ")}` : ""}${r.reach_km ? `; reach ${r.reach_km} km` : ""}`));
  if (missed.length) L.push("## Must facts missed", "", ...missed, "");
  const off = scores.flatMap((s) => s.rows.filter((r) => r.outcome === "found_elsewhere").map((r) => `- ${s.id}: ${r.fact.feature}: document ${where(r.fact)}, run ${r.distance_km} km (${r.name})`));
  if (off.length) L.push("## Found, not where the document puts it", "", ...off, "");
  const contra = scores.flatMap((s) => s.rows.filter((r) => r.outcome === "contradicted").map((r) => `- ${s.id}: ${r.fact.feature} (${where(r.fact)}): run found ${r.found.join("; ")}`));
  if (contra.length) L.push("## Document says none; the run found some", "", ...contra, "");
  const gaps = scores.flatMap((s) => s.rows.filter((r) => r.fact.weight === "must" && r.outcome === "not_checked").map((r) => `- ${s.id}: ${r.fact.feature}${r.why ? `: ${r.why}` : ""}`));
  if (gaps.length) L.push("## Must facts not checked (a source didn't answer)", "", ...gaps, "");
  if (trust) {
    const t = trust.counts;
    L.push("## Trust checks (scripts/log-checks.mjs)", "",
      `- Evidence not traced: ${t.untraced_evidence} of ${t.evidence}`, `- Runs naming more than one UK nation: ${t.mixed_nations} of ${t.screens}`,
      `- Open publishers not classed open: ${t.licence_mismatch} of ${t.datasets}`, `- Screens over the slow limit: ${t.slow_runs} of ${t.screens}`,
      "- Reply checks (long replies, untraced numbers) don't apply: the gate screens without a conversation.", "",
      ...Object.entries(trust.examples).filter(([k, v]) => v.length && k !== "long_replies" && k !== "untraced_numbers").flatMap(([k, v]) => [`**${k}:**`, ...v.slice(0, 6).map((e) => `- ${e}`), ""]));
  }
  return L.join("\n") + "\n";
}
