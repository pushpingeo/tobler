// Trust checks on logged sessions, worked out in code (plan item 1). Each one counts a kind of fault a consultant
// would care about; the weekly digest prints the counts beside last weeks', so progress shows.
// Pure functions over the compact sessions that scripts/log-digest.mjs builds. No network, no model.
//
// What each check means, and why its threshold is what it is:
//   long_replies       a reply after a screen longer than LONG_REPLY_WORDS words: the card holds the detail, the reply
//                      should point to it.
//   untraced_numbers   a reply that states a number (a distance, a count, an area) found nowhere in the session's
//                      record so far (what the person typed, and every tool and run output). Rounding is allowed,
//                      and a figure in feet, miles, nautical miles or acres is traced through the exact factors
//                      in js/units.js (package C: code gives the model both, so a quoted conversion traces).
//   untraced_evidence  evidence on a run's flags that the run itself marked "(not traced)".
//   mixed_nations      a run whose checks and gaps name bodies from more than one UK nation. Right near a border,
//                      wrong elsewhere (Stanlow, 24 Nov): worth a look, not always a fault.
//   licence_mismatch   a dataset from a publisher known to publish under an open licence, classed as something else.
//   slow_runs          a screen that took longer than SLOW_RUN_S seconds.

import { M_PER, M2_PER } from "../js/units.js";
export const LONG_REPLY_WORDS = 250;
export const SLOW_RUN_S = 120;

// Publishers whose layers are open (Open Government Licence, CC BY or similar) as a rule. A mismatch is a lead to
// follow, not proof: one layer can differ from its publisher's norm.
export const KNOWN_OPEN = [
  /^Natural England$/i, /^Environment Agency$/i, /^Historic England$/i, /^NatureScot$/i,
  /^Scottish Environment Protection Agency$/i, /^Historic Environment Scotland$/i, /^Natural Resources Wales$/i,
  /^Cadw$/i, /^Ordnance Survey$/i, /^JNCC$/i, /^European Environment Agency$/i, /^EMODnet/i, /^NASA\b/i,
  /^Office for National Statistics$/i, /^Scottish Government\b/i, /^Defra\b/i,
];

// Bodies that only publish for one UK nation (Defra and JNCC cover more than one, so they aren't here).
export const NATIONS = {
  England: /\b(Natural England|Environment Agency|Historic England)\b/i,
  Scotland: /\b(NatureScot|Scottish Natural Heritage|SEPA|Scottish Environment Protection Agency|Historic Environment Scotland|Scottish Government)\b/i,
  Wales: /\b(Natural Resources Wales|NRW|Cadw|Welsh Government|DataMapWales)\b/i,
  "Northern Ireland": /\b(DAERA|Northern Ireland Environment Agency|NIEA)\b/i,
};

const isObj = (e) => e && typeof e === "object";
const words = (s) => String(s || "").trim().split(/\s+/).filter(Boolean).length;

// Numbers in a reply worth tracing: with a decimal point, or with a unit, or 10 and over. Leaves out list numbers,
// run and finding ids (R1, F-01), dates and times.
export function replyNumbers(text) {
  const t = String(text || "")
    .replace(/\b[RF]-?\d+\b/g, " ")                    // run and finding ids
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")            // dates
    .replace(/\b(19|20)\d{2}\b/g, " ")                 // years
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")                // times
    .replace(/^\s*\d+[.)]\s/gm, " ");                  // numbered list items
  const out = [];
  for (const m of t.matchAll(/(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?\s*(sq mi|km²|km2|km|mi|miles?|ft|feet|nm|m²|m2|m|ha|hectares?|%|acres?)?(?![a-z])/gi)) {
    const raw = (m[1] + (m[2] || "")).replace(/,/g, "");
    const value = +raw;
    // Precision as written: "4.28" to 0.01, "37,000" to the nearest 1,000 (trailing zeros of a whole number).
    const decimals = m[2] ? m[2].length - 1 : -((raw.match(/0+$/) || [""])[0].length);
    if (!Number.isFinite(value)) continue;
    if (!m[2] && !m[3] && value < 10) continue;
    out.push({ text: m[0].trim(), value, decimals, unit: (m[3] || "").toLowerCase() });
  }
  return out;
}

// Every number anywhere in the record, as values.
export function recordNumbers(record) {
  const s = typeof record === "string" ? record : JSON.stringify(record);
  return [...s.matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Math.abs(+m[0]));
}

// A reply number is traced if some record number rounds to it at the reply's precision, or matches it in another
// unit (km and m, ha and km²).
export function traced(n, values) {
  const tol = 0.5 * 10 ** -n.decimals + 1e-9;
  const near = (x) => Math.abs(x - n.value) <= tol;
  // Record values are km, m, ha and km²; a figure in another unit is compared after converting them exactly.
  const u = n.unit || "";
  const alt = /^(mi|miles?)$/.test(u) ? [1000 / M_PER.mi, 1 / M_PER.mi]
    : /^(ft|feet)$/.test(u) ? [1000 / M_PER.ft, 1 / M_PER.ft]
    : u === "nm" ? [1000 / M_PER.nmi, 1 / M_PER.nmi]
    : /^acres?$/.test(u) ? [M2_PER.ha / M2_PER.acre, M2_PER.km2 / M2_PER.acre]
    : u === "sq mi" ? [M2_PER.km2 / M2_PER.mi2, M2_PER.ha / M2_PER.mi2]
    : [1, 1000, 0.001, 100, 0.01];
  return values.some((v) => alt.some((k) => near(v * k)));
}

function screenEvents(log) {
  const ev = (log.events || []).filter(isObj);
  return {
    screens: ev.filter((e) => e.tool === "screen_site" || e.tool === "area_budget"),
    results: ev.filter((e) => e.screen_result).map((e) => e.screen_result),
    datasets: ev.filter((e) => (e.tool === "find_data" || e.screen_tool === "find_data") && isObj(e.output)).flatMap((e) => e.output.datasets || []),
  };
}

// The checks for one week of sessions. Returns counts (safe for the public Action log) and examples (private).
export function trustChecks(sessions) {
  const c = { screens: 0, replies_after_screen: 0, long_replies: 0, replies_with_numbers: 0, untraced_numbers: 0,
    evidence: 0, untraced_evidence: 0, mixed_nations: 0, datasets: 0, licence_mismatch: 0, slow_runs: 0 };
  const examples = { long_replies: [], untraced_numbers: [], untraced_evidence: [], mixed_nations: [], licence_mismatch: [], slow_runs: [] };
  const where = (si, ti) => `session ${si + 1}, turn ${ti + 1}`;
  const seenLicence = new Set();

  sessions.forEach((s, si) => {
    let record = []; // grows through the session: what the person typed and every output
    (s.turns || []).forEach((t, ti) => {
      const log = t.log || {};
      if (log.reassess || log.feedback) return;
      record.push(log.user || "");
      for (const e of (log.events || []).filter(isObj)) record.push(e.input ?? "", e.output ?? "", e.screen_result ?? "");
      const values = recordNumbers(record);
      const { screens, results, datasets } = screenEvents(log);

      for (const e of screens) {
        c.screens++;
        if ((e.ms || 0) > SLOW_RUN_S * 1000) { c.slow_runs++; examples.slow_runs.push(`${where(si, ti)}: ${Math.round(e.ms / 1000)} s`); }
      }
      if (screens.length && !log.error) {
        c.replies_after_screen++;
        const n = words(log.reply);
        if (n > LONG_REPLY_WORDS) { c.long_replies++; examples.long_replies.push(`${where(si, ti)}: ${n} words`); }
      }
      if (log.reply && !log.error) {
        const nums = replyNumbers(log.reply);
        if (nums.length) {
          c.replies_with_numbers++;
          const missing = nums.filter((n) => !traced(n, values));
          if (missing.length) { c.untraced_numbers++; examples.untraced_numbers.push(`${where(si, ti)}: ${missing.map((n) => n.text).slice(0, 5).join(", ")}`); }
        }
      }
      for (const r of results) {
        for (const f of r.flags || []) for (const ev of f.evidence || []) {
          c.evidence++;
          if (/\(not traced\)\s*$/.test(ev)) { c.untraced_evidence++; examples.untraced_evidence.push(`${where(si, ti)}: ${ev}`); }
        }
        const text = [...(r.checked || []), ...(r.gaps || [])].join("\n");
        const named = Object.entries(NATIONS).filter(([, re]) => re.test(text)).map(([k]) => k);
        if (named.length > 1) { c.mixed_nations++; examples.mixed_nations.push(`${where(si, ti)}: ${named.join(" and ")}`); }
      }
      for (const d of datasets) {
        const key = `${d.id}|${d.title}|${d.publisher}`;
        if (seenLicence.has(key)) continue;
        seenLicence.add(key);
        c.datasets++;
        const pub = String(d.publisher || "").trim();
        if (KNOWN_OPEN.some((re) => re.test(pub)) && d.licence_class !== "open") {
          c.licence_mismatch++;
          examples.licence_mismatch.push(`${pub}: "${String(d.title || "").slice(0, 80)}" classed ${d.licence_class || "(none)"}`);
        }
      }
    });
  });
  return { counts: c, examples };
}

// The digest's section: this week's counts beside earlier weeks', then the examples (private file only).
export function trustSection(thisWeek, earlier = []) {
  const rows = [
    ["Long replies after a screen", "long_replies", "replies_after_screen"],
    ["Replies with a number not in the record", "untraced_numbers", "replies_with_numbers"],
    ["Evidence not traced", "untraced_evidence", "evidence"],
    ["Runs naming more than one UK nation", "mixed_nations", "screens"],
    ["Open publishers not classed open", "licence_mismatch", "datasets"],
    [`Screens over ${SLOW_RUN_S} s`, "slow_runs", "screens"],
  ];
  const weeks = [...earlier.slice(-4), { label: "this week", counts: thisWeek.counts }];
  const cell = (w, k, of) => (w.counts && k in w.counts ? `${w.counts[k]} of ${w.counts[of]}` : "–");
  const L = ["## Trust checks (worked out in code)", "",
    `| Check | ${weeks.map((w) => w.label).join(" | ")} |`, `|---|${weeks.map(() => "---").join("|")}|`,
    ...rows.map(([name, k, of]) => `| ${name} | ${weeks.map((w) => cell(w, k, of)).join(" | ")} |`), ""];
  for (const [name, k] of rows) {
    const ex = thisWeek.examples[k];
    if (!ex?.length) continue;
    L.push(`**${name}:**`, ...ex.slice(0, 8).map((e) => `- ${e}`), ...(ex.length > 8 ? [`- …and ${ex.length - 8} more`] : []), "");
  }
  return L.join("\n") + "\n";
}
