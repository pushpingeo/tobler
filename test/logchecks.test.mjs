// The weekly digest's trust checks (scripts/log-checks.mjs) and its failure handling (scripts/log-digest.mjs),
// on made-up sessions. Real logs never come into this repo.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replyNumbers, traced, recordNumbers, trustChecks, trustSection, LONG_REPLY_WORDS } from "../scripts/log-checks.mjs";
import { readingFrom, earlierWeeks } from "../scripts/log-digest.mjs";

let n = 0;
const test = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };

test("reply numbers: units, precision, and ids, years and list numbers left out", () => {
  const got = replyNumbers("1. Run R1 found F-01 at 4.28 km, 3 flags, 37,000 km² in 2023, 5 km (3.1 mi).");
  assert.deepEqual(got.map((x) => x.text), ["4.28 km", "37,000 km²", "5 km", "3.1 mi"]);
  assert.equal(got[1].decimals, -3); // to the nearest thousand
});

test("traced allows the rounding the reply implies, and km/m", () => {
  const vals = recordNumbers({ nearest_km: 4.283, area_km2: 36912, d: 0.48 });
  assert.ok(traced(replyNumbers("4.3 km")[0], vals));
  assert.ok(traced(replyNumbers("37,000 km²")[0], vals));
  assert.ok(traced(replyNumbers("480 m")[0], vals));
  assert.ok(!traced(replyNumbers("5.1 km")[0], vals));
});

test("a figure in miles, feet or acres traces through the exact factors (package C)", () => {
  const vals = recordNumbers({ nearest_km: 1.609344, edge_m: 45.72, area_ha: 40.468564224 });
  assert.ok(traced(replyNumbers("1 mi")[0], vals));
  assert.ok(traced(replyNumbers("150 ft")[0], vals));
  assert.ok(traced(replyNumbers("100 acres")[0], vals));
  assert.ok(!traced(replyNumbers("1.2 mi")[0], vals), "a wrong conversion stays untraced");
  assert.ok(!traced(replyNumbers("1.61 mi")[0], vals), "km passed off as miles stays untraced");
});

const screenTurn = (reply, extra = {}) => ({ log: {
  user: "Screen it", reply, ms: 30000,
  events: [
    { tool: "screen_site", input: { place: "Area 1" }, ms: extra.ms ?? 60000, output: { run: "R1", flags: 2 } },
    { screen_tool: "find_data", input: {}, output: { datasets: extra.datasets || [] } },
    { screen_result: { run: "R1", flags: [{ evidence: ["School 1.2 km", "Wind farm records null km (not traced)"] }],
      checked: extra.checked || ["Natural England SSSI: none"], gaps: [] } },
  ],
} });

test("trust checks count each kind of fault", () => {
  const sessions = [{ session: "a", turns: [
    screenTurn("Two flags; the school is 1.2 km away."),
    screenTurn("word ".repeat(LONG_REPLY_WORDS + 1) + "It is 9.9 km away.", {
      ms: 200000,
      checked: ["Natural England SSSI: none", "NatureScot SSSI: none"],
      datasets: [{ id: "D1", title: "SSSI", publisher: "Natural England", licence_class: "stated" },
                 { id: "D2", title: "Parks", publisher: "Some council", licence_class: "stated" }],
    }),
    "a stray string event is ignored",
  ].map((t) => (typeof t === "string" ? { log: { user: "hi", reply: "Hello.", events: [t] } } : t)) }];
  const { counts, examples } = trustChecks(sessions);
  assert.equal(counts.screens, 2);
  assert.equal(counts.long_replies, 1);
  assert.equal(counts.untraced_numbers, 1, "9.9 km isn't in the record; 1.2 km is");
  assert.match(examples.untraced_numbers[0], /turn 2: 9\.9 km/);
  assert.equal(counts.untraced_evidence, 2);
  assert.equal(counts.mixed_nations, 1);
  assert.equal(counts.licence_mismatch, 1, "only the known open publisher counts");
  assert.equal(counts.slow_runs, 1);
});

test("the section shows earlier weeks beside this one", () => {
  const week = trustChecks([{ session: "a", turns: [screenTurn("Fine.")] }]);
  const s = trustSection(week, [{ label: "11-23", counts: { ...week.counts, slow_runs: 3 } }]);
  assert.match(s, /\| Check \| 11-23 \| this week \|/);
  assert.match(s, /Screens over 120 s \| 3 of 1 \| 0 of 1 \|/);
});

test("earlier weeks are read from the private repo's files, oldest first, this week left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "digests-"));
  for (const d of ["2026-11-30", "2026-11-23", "2026-12-07"]) writeFileSync(join(dir, `${d}-checks.json`), JSON.stringify({ counts: { screens: +d.slice(8) } }));
  writeFileSync(join(dir, "2026-11-23.md"), "x");
  assert.deepEqual(earlierWeeks(dir, "2026-12-07").map((w) => w.label), ["11-23", "11-30"]);
  assert.deepEqual(earlierWeeks(join(dir, "missing"), "2026-12-07"), []);
});

test("a reply with no text is a failure, never a blank digest (23 Nov)", () => {
  const r = readingFrom({ content: [{ type: "thinking", thinking: "…" }], stop_reason: "max_tokens", usage: { output_tokens: 8000 } });
  assert.ok(r instanceof Error);
  assert.match(r.message, /no text.*max_tokens.*8000.*thinking used the whole limit/);
  assert.equal(readingFrom({ content: [{ type: "text", text: "## 1" }], stop_reason: "end_turn" }), "## 1");
  assert.match(readingFrom({ content: [{ type: "text", text: "## 1" }], stop_reason: "max_tokens" }), /cut off/);
});

console.log(`${n} log check tests passed`);
