// Tool results are data: no instructions to the model in them (plan item 1, the handover sweep, 26 Nov).
// What must always happen is in code (runreply.js finishTurn ends the turn); how to report is in the system prompt
// and the skills. This scans the strings tools put in their results' note-like fields for words that steer.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const FILES = ["placetools", "datatools", "epsgtools", "ntrrun", "licence", "fileimport", "gazetteer", "checks"].map((f) => `js/${f}.js`);
const FIELD = /\b(next|note|hint|why|dense|about_them|what_it_is|[a-z]+_note|near_ignored)\s*:\s*(`[^`]*`|"[^"]*")/g;
const STEER = /\b(tell the person|say so|say what|say which|say in|report the|end your turn|don't (screen|build|run|list|place)|ask the person|ask how|load the|use the candidate|look for another|try (other|another)|before saying|check it|pick by|cite the|show (both|them)|call [a-z_]+)\b/i;

const hits = [];
for (const f of FILES) {
  const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  for (const m of src.matchAll(FIELD)) if (STEER.test(m[2])) hits.push(`${f}: ${m[1]}: ${m[2].slice(0, 90)}`);
}
// The licence notes reach the analyst through get_data.
const { LICENCE_NOTE } = await import("../js/licence.js");
for (const [k, v] of Object.entries(LICENCE_NOTE)) if (STEER.test(v)) hits.push(`LICENCE_NOTE.${k}: ${v}`);
const { AROUND_NOTE } = await import("../js/datatools.js");
if (STEER.test(AROUND_NOTE) || /\bmention\b/i.test(AROUND_NOTE)) hits.push(`AROUND_NOTE: ${AROUND_NOTE}`);

assert.deepEqual(hits, [], `tool results that steer the model:\n${hits.join("\n")}`);
console.log("ok tool results carry no instructions to the model");
console.log("1 steering test passed");
