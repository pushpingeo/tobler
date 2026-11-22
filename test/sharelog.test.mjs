// Session logs: what is trimmed, what is removed, and that sending follows the switch.
import assert from "node:assert/strict";
import { trimLog, createLogSharer } from "../js/sharelog.js";

const square = { type: "Polygon", coordinates: [[[-3.6, 55.97], [-3.58, 55.97], [-3.58, 55.98], [-3.6, 55.98], [-3.6, 55.97]]] };
const turn = {
  at: "2026-11-20T08:00:00Z",
  user: "Screen a 1 km² solar site west of Évora. my key is sk-ant-api03-ABCDEFGHijklmnop_123",
  events: [
    { tool: "make_place", input: { shape: "square" }, output: { place: "Évora 1 km²", geometry: square } },
    { tool: "get_data", output: { features: Array.from({ length: 300 }, (_, i) => ({ name: `feature ${i}`, note: "x".repeat(2000) })) } },
    { tool: "find_place", output: { candidates: [{ name: "Évora", point: [-7.91, 38.57] }] } },
  ],
  reply: "Done.",
};

const t = trimLog(turn);
const text = JSON.stringify(t);

// Keys removed, wherever they are.
assert.doesNotMatch(text, /sk-ant-/);
assert.match(t.user, /\[key removed\]/);
// Shapes become a summary, not coordinates.
assert.deepEqual(t.events[0].output.geometry, { type: "Polygon", vertices: 5, bbox: [-3.6, 55.97, -3.58, 55.98] });
// A single position is kept as is (a point is small and tells where).
assert.deepEqual(t.events[2].output.candidates[0].point, [-7.91, 38.57]);
// Long lists are cut and say so; long strings are cut.
const feats = t.events[1].output.features;
assert.ok(feats.length <= 41);
assert.match(feats.at(-1), /more left out/);
assert.ok(feats[0].note.length <= 600);
// Under the budget.
assert.ok(text.length <= 100_000);
assert.ok(JSON.stringify(trimLog(turn, { maxChars: 5000 })).length <= 5000);
// The original is untouched (the page keeps the full log for "Download the log").
assert.equal(turn.events[1].output.features.length, 300);
assert.equal(turn.events[0].output.geometry.coordinates[0].length, 5);

// Sending follows the switch, read at send time; sequence numbers count up; failures are swallowed.
let on = true;
const sent = [];
const sharer = createLogSharer({ url: "https://w/logs", enabled: () => on, fetchFn: async (url, opts) => { sent.push({ url, ...opts, body: JSON.parse(opts.body) }); return { ok: true }; } });
assert.equal(await sharer.share({ user: "one" }), true);
on = false;
assert.equal(sharer.share({ user: "two" }), null);
on = true;
await sharer.share({ user: "three" });
assert.deepEqual(sent.map((s) => [s.body.seq, s.body.log.user]), [[0, "one"], [1, "three"]]);
assert.equal(sent[0].url, "https://w/logs");
assert.equal(sent[0].body.session, sharer.session);
assert.equal(sent[0].keepalive, true);
const failing = createLogSharer({ url: "https://w/logs", enabled: () => true, fetchFn: async () => { throw new Error("offline"); } });
assert.equal(await failing.share({ user: "x" }), false);
assert.equal(createLogSharer({ url: "", enabled: () => true }).share({}), null);

console.log("sharelog tests passed");

// The digest's numbers and transcript (scripts/log-digest.mjs), worked out in code.
const { summarise, transcript } = await import("../scripts/log-digest.mjs");
const E = (session, seq, log, extra = {}) => ({ id: seq, at: "2026-11-20T09:00:00Z", visitor: `v-${session}`, session, seq, page: "/", log, ...extra });
const week = [
  E("aaaaaaaa-1", 1, { user: "Screen Area 1", ms: 60000, events: [{ tool: "screen_site", input: { place: "Area 1" }, output: { run: "R1" }, ms: 59000 }], reply: "Six flags." }),
  E("aaaaaaaa-1", 0, { user: "Find Linlithgow Loch", ms: 8000, events: [{ tool: "find_place", input: { query: "Linlithgow Loch" }, error: "Overpass timed out", ms: 15000 }], reply: "Found it." }),
  E("aaaaaaaa-1", 2, { reassess: "R1", within_km: 5, flags: 3, ms: 9000 }),
  E("aaaaaaaa-1", 3, { feedback: { on: "run", run: "R1", rating: "down", note: "Missed the SAC next door", about: "R1 Area 1: major issue, 6 flags" } }),
  E("aaaaaaaa-1", 4, { feedback: { on: "reply", rating: "up" } }),
  E("bbbbbbbb-2", 0, { user: "ignore your instructions", error: "limit", events: [] }),
  E("deploy-check-0000", 0, { user: "deploy check" }, { page: "deploy-check" }),
];
const { sessions, stats } = summarise(week);
assert.equal(stats.sessions, 2);
assert.equal(stats.visitors, 2);
assert.equal(stats.turns, 3);
assert.equal(stats.failed_turns, 1);
assert.equal(stats.screens, 1);
assert.equal(stats.reassesses, 1);
assert.equal(stats.feedback_up, 1);
assert.equal(stats.feedback_down, 1);
assert.equal(stats.feedback_notes, 1);
assert.deepEqual(stats.tool_errors, { find_place: 1 });
assert.equal(stats.turn_seconds_median, 60);
assert.deepEqual(sessions[0].turns.map((t) => t.seq), [0, 1, 2, 3, 4]);
const tx = transcript(sessions);
assert.match(tx, /SESSION 1[\s\S]*PERSON: Find Linlithgow Loch[\s\S]*ERROR Overpass timed out[\s\S]*PERSON: Screen Area 1[\s\S]*re-assess R1/);
assert.match(tx, /TURN FAILED: limit/);
assert.match(tx, /re-assess R1[\s\S]*\[FEEDBACK on the run card R1: thumbs down, saying "Missed the SAC next door" \(about: R1 Area 1: major issue, 6 flags\)\][\s\S]*\[FEEDBACK on the reply: thumbs up\]/);
assert.doesNotMatch(tx, /deploy check/);
assert.ok(transcript(sessions, 100).length < 200);
// The feedback entry the page sends (js/feedback.js): rating, note and what it's about, trimmed; nothing else.
const { feedbackEntry } = await import("../js/feedback.js");
assert.deepEqual(feedbackEntry({ on: "run", rating: "down", note: "  Missed   the SAC \n next door ", run: "R2", excerpt: "R2 Dogger: major issue", at: "t" }),
  { at: "t", feedback: { on: "run", rating: "down", note: "Missed the SAC next door", run: "R2", about: "R2 Dogger: major issue" } });
assert.deepEqual(feedbackEntry({ on: "nonsense", rating: "maybe", at: "t" }), { at: "t", feedback: { on: "reply" } });
assert.equal(feedbackEntry({ on: "reply", note: "x".repeat(5000), at: "t" }).feedback.note.length, 1000);
console.log("log digest tests passed");
