// Gap grouping on the run card. Run with: npm test
import assert from "node:assert/strict";
import { gapKind, groupGaps, gapSummary } from "../js/gaps.js";

const cases = [
  ["Key Biodiversity Areas not checked", "couldnt"],
  ["Heritage not checked because Historic Environment Scotland fetches fail in the atlas", "couldnt"],
  ["OpenStreetMap timed out, so schools and clinics weren't checked", "couldnt"],
  ["NASA FIRMS service didn't respond", "couldnt"],
  ["No Indigenous Peoples data in the catalogue for Portugal", "nodata"],
  ["Fishing effort is not in the catalogue", "nodata"],
  ["No mapped data on land tenure or informal settlement here", "nodata"],
  ["Hindsight: today's map shows the built project", "caveat"],
  ["Stage assumed to be greenfield", "caveat"],
  ["The surroundings were not screened (inside the area only, as asked)", "caveat"],
  ["Seabird colonies from regional knowledge, not mapped data", "nodata"],
  ["Natural Earth borders are good to about a kilometre", "caveat"],
];
for (const [line, kind] of cases) assert.equal(gapKind(line), kind, line);

const g = groupGaps(
  ["Key Biodiversity Areas not checked", "No Indigenous Peoples data in the catalogue for Portugal", "Stage assumed"],
  [
    { dataset: "Key Biodiversity Areas", result: "not checked", why: "Service failed." },
    { dataset: "Scheduled monuments", publisher: "Historic Environment Scotland", result: "not checked", why: "The publisher's service didn't answer: 500. Report it as not checked." },
    { dataset: "Natura 2000", result: "features", count: 3 },
  ]);
assert.deepEqual(g.couldnt, ["Scheduled monuments (Historic Environment Scotland): The publisher's service didn't answer: 500.", "Key Biodiversity Areas not checked"], "tool failures first, not repeated when the analyst named them");
assert.deepEqual(g.nodata, ["No Indigenous Peoples data in the catalogue for Portugal"]);
assert.deepEqual(g.caveat, ["Stage assumed"]);
assert.equal(gapSummary(g), "What still needs checking: 2 couldn't check, 1 no data, 1 caveat");
assert.equal(gapSummary(groupGaps([], [])), "What still needs checking: nothing flagged");
console.log("gap tests passed");
