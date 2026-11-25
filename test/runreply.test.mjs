// The reply after a run, written in code (plan item 1, 25 Nov): every name and number from the record, short, and
// the turn ends without asking the model to write it.
import assert from "node:assert/strict";
import { runReply, screenReply, studyReply, budgetReply, finishTurn } from "../js/runreply.js";
import { runTurn } from "../js/converse.js";
import * as F from "./fixtures/runreply-records.mjs";
import { headline, budgetHeadline } from "../js/ntrrun.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const clean = (t) => assert.ok(!/undefined|null|NaN|\[object/.test(t), `no holes in: ${t}`);

await test("screen: decision, why, distances, at most three flags most serious first, gaps musts first", () => {
  const t = screenReply(F.oracleSolar);
  clean(t);
  assert.match(t, /^\*\*Constraints screen of Oracle campus, Linlithgow \(R1\)\*\*: \*\*progress with targeted investigation\*\*\./);
  assert.match(t, /Heritage assets sit at the site's edge/);
  assert.match(t, /Screened for a solar farm, looking out to 20 km \(bands at 1, 5 and 20 km, the default for a solar farm onshore\)\./);
  assert.match(t, /The 3 most serious of 4 flags/);
  assert.match(t, /- F-01 Listed buildings and a scheduled monument at the site's edge: high severity, high confidence; 40 m away/);
  assert.match(t, /- F-02 .*: medium severity, medium confidence; on the site/);
  assert.ok(!/F-04/.test(t), "the fourth is on the card");
  assert.match(t, /Not checked: flood zones and peat\./, "a must-check comes first");
  assert.ok(t.split(/\s+/).length < 160, "short");
});

await test("screen on a search area, with a decision changed in code", () => {
  const t = runReply(F.kelsoSearchArea);
  clean(t);
  assert.match(t, /Tobler changed the decision from progress, because none of the must-checks for biodiversity could be checked\./);
  assert.match(t, /Screened a 3\.1 km² search area \(a default 1 km footprint round a point\)/);
  assert.match(t, /- F-01 Homes and schools in the search area: high severity, low confidence; in the search area/);
  assert.match(t, /One flag/);
});

await test("screen outside the profile, distances the person set, no flags", () => {
  const t = runReply(F.housingOutside);
  clean(t);
  assert.match(t, /Screened for a housing estate, looking out to 10 km \(bands at 0\.5, 2 and 10 km, as you set them\)\. A general screen/);
  assert.match(t, /No flags raised\./);
  assert.ok(!/Not checked/.test(t));
});

await test("desk study: linkages, the study's own distances, what a full study adds", () => {
  const t = studyReply(F.stanlowStudy);
  clean(t);
  assert.match(t, /^\*\*Contamination desk study of Stanlow Refinery \(R4\)\*\*: \*\*possible linkages: investigate\*\*\./);
  assert.match(t, /Checked the open records on the site and out to 2 km from its edge \(bands at 0\.25, 0\.5 and 2 km, the study's own distances\)\./);
  assert.match(t, /2 possible linkages/);
  assert.match(t, /- F-01 Historic landfill .* \(possible linkage\): high severity, medium confidence; 300 m away/);
  assert.match(t, /the 5 things a full desk study would add/);
  assert.equal(runReply(F.stanlowStudy), t);
});

await test("developable area: the budget's own summary", () => {
  const t = budgetReply(F.barnstonBudget);
  clean(t);
  assert.match(t, /Net developable area for a solar farm: 7\.4 ha of 10\.2 ha gross \(73%\)\./);
  assert.match(t, /The biggest deduction is railway with a 30 m buffer \(1\.9 ha\)\./);
  assert.match(t, /Not checked: flood zone 3\./);
  assert.equal(runReply(F.barnstonBudget), t);
});

await test("a result that couldn't be read says so", () => {
  const t = runReply(F.brokenResult);
  clean(t);
  assert.match(t, /couldn't be read, so there are no structured flags/);
});

await test("finishTurn: a run or a refusal ends the turn; anything else carries on", () => {
  const screening = { runs: new Map([["R1", F.oracleSolar]]) };
  const fin = finishTurn(screening);
  assert.match(fin("screen_site", {}, { run: "R1" }), /Constraints screen of Oracle campus/);
  assert.equal(fin("run_study", {}, { not_available: "The developable area needs an outline, and Point 1 is a point" }), "The developable area needs an outline, and Point 1 is a point.");
  assert.equal(fin("find_place", {}, { candidates: [] }), null);
  assert.equal(fin("screen_site", {}, { run: "R9" }), null, "no record: let the model answer");
});

await test("runTurn: after screen_site the turn ends with the code's reply; the model isn't asked again", async () => {
  let calls = 0;
  const callClaude = async () => {
    calls++;
    return { stop_reason: "tool_use", usage: {}, content: [{ type: "text", text: "Screening it now." }, { type: "tool_use", id: "t1", name: "screen_site", input: { place: "Oracle campus, Linlithgow", asset_type: "solar" } }] };
  };
  const screening = { runs: new Map([["R1", F.oracleSolar]]) };
  const res = await runTurn({ system: "s", messages: [{ role: "user", content: "screen it" }], tools: [], callClaude,
    exec: async () => ({ run: "R1", flags: 4 }), finish: finishTurn(screening) });
  assert.equal(calls, 1);
  assert.equal(res.stopReason, "finished_in_code");
  assert.match(res.text, /^\*\*Constraints screen of Oracle campus/);
  assert.ok(!/Screening it now/.test(res.text), "the model's own line before the call isn't the reply");
  // A failed run is an error, not an ending: the model is asked again and can say what failed.
  let n = 0;
  const res2 = await runTurn({ system: "s", messages: [{ role: "user", content: "screen it" }], tools: [],
    callClaude: async () => (n++ ? { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "The screen failed: no place." }] }
      : { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "t1", name: "screen_site", input: {} }] }),
    exec: async () => { throw new Error("No place called x"); }, finish: finishTurn(screening) });
  assert.equal(n, 2);
  assert.equal(res2.text, "The screen failed: no place.");
});

await test("the run tools' results are data: no instructions to the model", () => {
  const STEER = /\b(reply|say|tell the person|don't repeat|end your turn|mention)\b/i;
  for (const rec of [F.oracleSolar, F.kelsoSearchArea, F.stanlowStudy]) {
    const h = headline(rec);
    assert.equal(h.note, undefined);
    const strings = JSON.stringify(h).match(/"[^"]*"/g) || [];
    assert.ok(!strings.some((x) => STEER.test(x)), JSON.stringify(h));
  }
  const b = budgetHeadline(F.barnstonBudget);
  assert.equal(b.note, undefined);
  assert.ok(!(JSON.stringify(b).match(/"[^"]*"/g) || []).some((x) => STEER.test(x)));
});

console.log(`${passed} run reply tests passed`);
