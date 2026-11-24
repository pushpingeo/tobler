// Sites and screens: the words on the strip and on each run line (js/sitetree.js).
import assert from "node:assert/strict";
import { treeSummary, runLine } from "../js/sitetree.js";
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
test("the strip counts sites and screens", () => {
  assert.equal(treeSummary([{ runs: [] }]), "1 site");
  assert.equal(treeSummary([{ runs: [{}, {}] }, { runs: [{}] }]), "2 sites · 3 screens");
});
test("a current run says its flags and decision", () => {
  assert.deepEqual(runLine({ id: "R2", time: "14:05", flags: 2, decision: "proceed with conditions" }), { id: "R2", time: "14:05", state: "2 flags · Proceed with conditions", stale: false });
  assert.equal(runLine({ id: "R1", flags: 1 }).state, "1 flag");
});
test("out of date and replaced come first, and mark the run stale", () => {
  assert.deepEqual(runLine({ id: "R1", flags: 3, decision: "progress", outdated: true }), { id: "R1", time: undefined, state: "Out of date: site edited", stale: true });
  assert.equal(runLine({ id: "R1", flags: 3, outdated: true, replacedBy: "R2" }).state, "Replaced by R2");
});
console.log(`${passed} sitetree tests passed`);
