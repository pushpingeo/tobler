// Industry profiles (catalogue/industries/, js/industry.js): choosing one, what the analyst is told, and that each
// ready profile only names things that exist (its skill, asset types in the distances table, known themes).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { chooseIndustry, industryNote, readDecision, settleDecision, biodiversityChecked, DECISIONS } from "../js/industry.js";
import { parseSkill } from "../js/converse.js";
import { THEME_CODE } from "../js/ntrrun.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
const read = (rel) => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url)));
const index = read("catalogue/industries/index.json");
const table = read("catalogue/distances.json");
const trusted = read("catalogue/trusted.json");

await test("choosing an industry: a stored ready choice wins; anything else falls back to the default", () => {
  assert.equal(chooseIndustry(index, "energy"), "energy");
  assert.equal(chooseIndustry(index, "construction"), "energy", "coming soon can't be chosen");
  assert.equal(chooseIndustry(index, "nonsense"), "energy");
  assert.equal(chooseIndustry(index, null), index.default);
  assert.equal(chooseIndustry({ industries: [] }, "energy"), null);
});

await test("every ready profile names a skill that exists, picks the distances table knows, and known themes", () => {
  for (const entry of index.industries.filter((i) => i.status === "ready")) {
    const p = read(entry.file);
    assert.equal(p.id, entry.id);
    assert.ok(existsSync(new URL(`../${p.skill_file}`, import.meta.url)), `${p.id}: ${p.skill_file}`);
    assert.equal(parseSkill(readFileSync(new URL(`../${p.skill_file}`, import.meta.url), "utf8")).name, p.skill);
    for (const pick of p.asset_picks.picks) for (const t of [pick.type, pick.onshore, pick.offshore].filter(Boolean)) assert.ok(table.assets[t], `${p.id}: pick ${t} not in distances`);
    for (const th of p.themes) assert.ok(th.id in THEME_CODE, `${p.id}: theme ${th.id}`);
    assert.deepEqual(p.decisions, DECISIONS);
    for (const k of ["local", "regional", "global"]) assert.ok(p.examples[k]?.length, `${p.id}: ${k} examples`);
    assert.ok(p.wording.screen_chip && p.other_requests);
  }
  for (const entry of index.industries.filter((i) => i.status !== "ready")) assert.ok(entry.label && entry.about);
});

await test("the analyst is told the industry and what's coming; energy's checks are the checks catalogue", () => {
  const energy = read("catalogue/industries/energy.json");
  const line = industryNote(energy, index);
  assert.match(line, /^Industry: Environment and Energy \(screening method: environmental constraints and E&S risk/);
  assert.match(line, /Coming soon: Construction; Infrastructure; Property; Mining; Data centres\./);
  assert.equal(industryNote(null, index), "");
  assert.equal(energy.checks.from, "catalogue/checks.json");
  assert.equal(trusted.baseline, undefined, "the baseline layers moved to catalogue/checks.json");
  assert.deepEqual(readDecision("MAJOR ISSUE", ""), { value: "major issue", why: "" });
});

await test("insufficient evidence only when no biodiversity source was checked at all (Rob, 22 Nov)", () => {
  const bioOk = [{ evidence: "biodiversity", result: "none in dataset" }, { evidence: "biodiversity", result: "not checked", why: "timed out" }];
  const bioNone = [{ evidence: "biodiversity", result: "not checked" }, { evidence: "heritage", result: "features" }];
  assert.equal(biodiversityChecked(bioOk), true, "one layer failing doesn't count against the others");
  assert.equal(biodiversityChecked(bioNone), false);
  const ins = { value: "insufficient evidence", why: "EMODnet timed out." };
  const a = settleDecision(ins, { checked: bioOk, flags: [{ severity: "medium", confidence: "high" }] });
  assert.equal(a.value, "progress with targeted investigation");
  assert.equal(a.why, "EMODnet timed out.");
  assert.match(a.changed, /^from insufficient evidence: biodiversity sources were checked/);
  assert.equal(settleDecision(ins, { checked: bioOk, flags: [{ severity: "high", confidence: "medium" }] }).value, "major issue");
  assert.equal(settleDecision(ins, { checked: bioNone, flags: [] }), ins, "nothing on biodiversity: insufficient evidence stands");
  const clean = settleDecision({ value: "progress", why: "Nothing found." }, { checked: bioNone, flags: [] });
  assert.equal(clean.value, "insufficient evidence");
  assert.match(clean.changed, /no biodiversity source could be checked/);
  const major = { value: "major issue", why: "Pipeline on site." };
  assert.equal(settleDecision(major, { checked: bioNone, flags: [] }), major, "a major issue stays: something serious was found");
  assert.equal(settleDecision({ value: "progress", why: "" }, { checked: bioOk }).value, "progress");
  assert.equal(settleDecision(null, { checked: [] }), null);
});

console.log(`${passed} industry tests passed`);
