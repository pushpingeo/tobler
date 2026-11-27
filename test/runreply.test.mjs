// The reply after a run, written in code (plan item 1, 25 Nov): every name and number from the record, short, and
// the turn ends without asking the model to write it.
import assert from "node:assert/strict";
import { runReply, screenReply, studyReply, budgetReply, finishTurn, heldReply } from "../js/runreply.js";
import { runTurn } from "../js/converse.js";
import * as F from "./fixtures/runreply-records.mjs";
import { headline, budgetHeadline } from "../js/ntrrun.js";
import { runDiff } from "../js/rundiff.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const clean = (t) => assert.ok(!/undefined|null|NaN|\[object/.test(t), `no holes in: ${t}`);

// Short, for a phone (Rob, 27 Nov): the headline and a pointer to the card above. The flags, distances and gaps are
// the card's; the reply repeats none of them.
const short = (t) => { assert.ok(t.split(/\s+/).length < 90, `short: ${t}`); assert.ok(!/card below|\n- F-\d|Not checked:|each check looks out/.test(t), `nothing the card says: ${t}`); };

await test("screen: decision and why, the count, and the card above", () => {
  const t = screenReply(F.oracleSolar);
  clean(t); short(t);
  assert.match(t, /^\*\*Constraints screen of Oracle campus, Linlithgow \(R1\)\*\*: \*\*progress with targeted investigation\*\*\./);
  assert.match(t, /Heritage assets sit at the site's edge/);
  assert.match(t, /\n\n4 flags\.\n\n/);
  assert.match(t, /The card above has the flags, their evidence and what wasn't checked\. Ask me about any flag\.$/);
});

await test("screen ordered by relevance: the headline is the summary of what's on site", () => {
  const rec = structuredClone(F.oracleSolar);
  Object.assign(rec.tobler_run, { order: "relevance", decision: null,
    headline: { flags: 4, direct: 2, direct_names: ["Listed buildings", "Flood zones"], in_range: 2, beyond_range: 0, checks: 40, not_checked: 7, not_checked_must: 0 } });
  const t = screenReply(rec);
  clean(t); short(t);
  assert.match(t, /^\*\*Constraints screen of Oracle campus, Linlithgow \(R1\)\.\*\* On the site or at its edge: Listed buildings and flood zones\. 2 more flags within range\. 7 of 40 checks couldn't be answered\.\n\nThe card above/);
  assert.ok(!/4 flags\./.test(t), "the headline counts them");
});

await test("screen on a search area, with a decision changed in code", () => {
  const t = runReply(F.kelsoSearchArea);
  clean(t); short(t);
  assert.match(t, /Tobler changed the decision from progress, because none of the must-checks for biodiversity could be checked\./);
  assert.match(t, /This was a search area, not the site's outline, so nothing on the card is known to be on the site itself\./);
});

await test("screen with no flags", () => {
  const t = runReply(F.housingOutside);
  clean(t); short(t);
  assert.match(t, /No flags raised\./);
  assert.match(t, /The card above has what was checked\.$/);
});

await test("desk study: decision, the count, what a full study adds is on the card", () => {
  const t = studyReply(F.stanlowStudy);
  clean(t); short(t);
  assert.match(t, /^\*\*Contamination desk study of Stanlow Refinery \(R4\)\*\*: \*\*possible linkages: investigate\*\*\./);
  assert.match(t, /2 possible linkages in the open records checked\./);
  assert.match(t, /The card above sets out the sources, pathways and receptors checked, and what a full desk study would add\./);
  assert.equal(runReply(F.stanlowStudy), t);
});

await test("developable area: the budget's own summary", () => {
  const t = budgetReply(F.barnstonBudget);
  clean(t);
  assert.match(t, /Net developable area for a solar farm: 7\.4 ha of 10\.2 ha gross \(73%\)\./);
  assert.match(t, /The biggest deduction is railway with a 30 m buffer \(1\.9 ha\)\./);
  assert.match(t, /Not checked: flood zone 3\./);
  assert.match(t, /The card above has each deduction/);
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

await test("buttons end the turn in code: the model's own line is kept, code's line is the fallback", async () => {
  const fin = finishTurn({ runs: new Map() });
  assert.deepEqual(fin("offer_skills", { place: "Area 1" }, { place: "Area 1", offered: ["screen"], buttons_shown: true }), { text: "Pick one above, or tell me in words what you'd like.", soft: true });
  assert.equal(fin("offer_choices", {}, { recommended_name: "Linlithgow Palace", reason: "Historic Environment Scotland's record, the one people mean", buttons_shown: true }).text,
    "I'd go with **Linlithgow Palace**. Historic Environment Scotland's record, the one people mean. Flick through them on the map and pick one.");
  assert.equal(fin("ask_asset_type", {}, { not_available: "Ask in words" }), null, "no buttons, no ending");
  const step = (said) => async () => ({ stop_reason: "tool_use", usage: {}, content: [...(said ? [{ type: "text", text: said }] : []), { type: "tool_use", id: "t1", name: "ask_asset_type", input: { place: "Area 1" } }] });
  for (const [said, want] of [["Found it: a 12 ha field.", "Found it: a 12 ha field."], [null, "Pick one above, or tell me in words what's planned."]]) {
    let calls = 0;
    const cc = step(said);
    const res = await runTurn({ system: "s", messages: [{ role: "user", content: "x" }], tools: [], callClaude: async () => { calls++; return cc(); },
      exec: async () => ({ place: "Area 1", buttons_shown: true }), finish: fin });
    assert.equal(calls, 1, "the model isn't asked again after the buttons");
    assert.equal(res.stopReason, "finished_in_code");
    assert.equal(res.text, want);
  }
  // A run in the same step wins over buttons.
  const both = await runTurn({ system: "s", messages: [{ role: "user", content: "x" }], tools: [],
    callClaude: async () => ({ stop_reason: "tool_use", usage: {}, content: [{ type: "text", text: "On it." }, { type: "tool_use", id: "a", name: "offer_skills", input: {} }, { type: "tool_use", id: "b", name: "screen_site", input: {} }] }),
    exec: async (n) => (n === "screen_site" ? { not_available: "Nothing to screen offshore here" } : { buttons_shown: true }), finish: fin });
  assert.equal(both.text, "Nothing to screen offshore here.");
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

await test("held runs: code asks, with what was found and what will run on a yes", () => {
  const c = heldReply({ held: "confirm", place: "Oracle campus, Linlithgow", anchor: "Oracle", source: "OpenStreetMap contributors", confidence: "medium", role: "footprint", geometry: "Polygon", area_km2: 0.121, queued: "a constraints screen for a solar farm" });
  clean(c);
  assert.equal(c, "I've put **Oracle campus, Linlithgow** on the map: from Oracle (OpenStreetMap contributors), 12 ha, medium confidence. Is that the right place? If it is, say so (or use it from the card) and I'll run a constraints screen for a solar farm. If not, tell me what to change, or draw the site.");
  const sa = heldReply({ held: "confirm", place: "Linlithgow housing 5 ha", anchor: "Linlithgow", confidence: "low", role: "search_area", role_why: "built from clues round Linlithgow", geometry: "Polygon", area_km2: 0.05, queued: "a constraints screen for a housing site" });
  assert.match(sa, /It's a search area \(built from clues round Linlithgow\), because the site's own outline wasn't found/);
  const w = heldReply({ held: "which_part", place: "Lake Tekapo", kind: "water", what: "a lake or other water body", area_km2: 83, geometry: "Polygon", queued: "a constraints screen for an onshore oil or gas field" });
  clean(w);
  assert.match(w, /^\*\*Lake Tekapo\*\* is a lake or other water body \(83 km²\), so it isn't a site yet\. Which part of it is the site\?/);
  assert.match(w, /use the whole of Lake Tekapo as a rough first look\. Then I'll run a constraints screen for an onshore oil or gas field\.$/);
  const nz = heldReply({ held: "which_part", place: "New Zealand", kind: "region", what: "a whole country", area_km2: 268021, geometry: "Polygon", queued: "a constraints screen" });
  assert.match(nz, /is a whole country \(268,021 km²\)/);
  const town = heldReply({ held: "which_part", place: "Kelso", kind: "settlement", geometry: "Point", queued: "a constraints screen for an onshore wind farm" });
  assert.match(town, /^\*\*Kelso\*\* is a town or village, so it isn't a site yet\. What's on the map is its centre point\. Where in or around it is the site\?/);
  const road = heldReply({ held: "which_part", place: "Linlithgow Road", kind: "line", what: "a road", geometry: "Point", queued: "a constraints screen" });
  assert.match(road, /is a road, so it isn't a site yet\. Where along it is the site\?/);
  assert.match(heldReply({ held: "skills", place: "Area 1" }), /Which analysis would you like/);
  // A building is a few hundred square metres, not "0 ha" (Shell House, Perth, replay 26 Nov).
  assert.match(heldReply({ held: "confirm", place: "Shell House", anchor: "Shell House", confidence: "medium", role: "footprint", geometry: "Polygon", area_km2: 0.000437, queued: "a constraints screen" }), /: from Shell House, 440 m², medium confidence\./);
  assert.equal(finishTurn({ runs: new Map() })("screen_site", {}, { held: "skills", place: "Area 1" }), heldReply({ held: "skills", place: "Area 1" }));
});

await test("a rerun says what changed, and when nothing underneath did, that it's the analyst's judgement", () => {
  const same = runDiff(F.oracleSolar, F.oracleSolarAgain);
  assert.equal(same.same_checks, true);
  assert.deepEqual(same.lines, [
    "Decision: was progress with targeted investigation, now major issue.",
    "Flags: was 4, now 2; none now on biodiversity or community and health.",
    "The checks came back the same, so the difference is in the analyst's judgement of them, not in the data.",
  ]);
  const ev = runDiff(F.evoraFirst, F.evoraSecond);
  assert.deepEqual(ev.lines, [
    "Reached this time but not before: Homes.",
    "Decision: was insufficient evidence, now progress with targeted investigation.",
    "Flags: was 1, now 2; new on community and health.",
  ]);
  const back = runDiff(F.evoraSecond, F.evoraFirst);
  assert.match(back.lines[0], /^Not reached this time: Homes\.$/);
  assert.deepEqual(runDiff(F.evoraFirst, F.evoraFirst).lines, ["Nothing changed: same request, same checks, same result."]);
  const edited = runDiff(F.evoraFirst, F.evoraFirst, { siteChanged: "moved 2 km north" });
  assert.deepEqual(edited.lines, ["The site changed: moved 2 km north."]);
  // In the reply, right after the distances.
  const rec = JSON.parse(JSON.stringify(F.oracleSolarAgain));
  rec.tobler_run.replaces = { run: "R1", why: "run again on the same site", diff: same };
  const t = runReply(rec);
  clean(t);
  assert.match(t, /\n\nCompared with R1: Decision: was progress with targeted investigation, now major issue\. .* not in the data\.\n\n/);
});

console.log(`${passed} run reply tests passed`);
