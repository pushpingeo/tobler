// The developable area's protection distances (package D, 27 Nov): reviewed rows from the asset table where a
// source gives one for the place, by country and UK nation; otherwise the skill's first cuts; the person's own
// distance beats both. Run: node test/developable.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { budgetRules, resolveDeductions, protectionFor, distanceNote } from "../js/developable.js";
import { parseSkill } from "../js/converse.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const rules = budgetRules(parseSkill(read("../skills/developable-area/SKILL.md")));
const table = JSON.parse(read("../catalogue/assets.json"));
const protection = table.protection;

let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`ok ${name}`); };
const plan = (asset, where, i = {}) => resolveDeductions(rules, { asset_type: asset, ...i }, { protection, where });
const ded = (p, id) => p.deductions.find((d) => d.id === id);
const ENGLAND = { countries: ["United Kingdom"], areas: { England: 0 } };
const SCOTLAND = { countries: ["United Kingdom"], areas: { Scotland: 0, England: 12.4 } };

test("every row is reviewed, names a deduction and assets the skill has, and has a source and its words", () => {
  const ids = new Set(rules.deductions.map((d) => d.id));
  for (const r of protection.rows) {
    assert.equal(r.status, "reviewed", r.id);
    assert.ok(ids.has(r.deduction), `${r.id}: no deduction ${r.deduction}`);
    assert.ok(r.assets === "all" || r.assets.every((a) => a in rules.asset_types), `${r.id}: unknown asset`);
    assert.ok(r.m > 0 && r.m <= 2000, `${r.id}: ${r.m}`);
    assert.ok(/^https:\/\//.test(r.source?.url) && r.as_published && r.reason && r.basis, r.id);
    assert.ok(r.countries?.length, `${r.id}: a row says where it applies`);
  }
  assert.ok(!JSON.stringify(protection).includes("Groundsure"));
});

test("England: ancient woodland and watercourses from their sources; homes from solar stay a first cut", () => {
  const p = plan("solar", ENGLAND);
  assert.equal(ded(p, "ancient-woodland").buffer_m, 15);
  assert.equal(ded(p, "ancient-woodland").distance.basis, "gov");
  assert.equal(ded(p, "watercourses").distance.basis, "reg");
  assert.match(ded(p, "watercourses").reason, /flood risk activity permit/);
  assert.equal(ded(p, "homes").buffer_m, 50);
  assert.deepEqual(ded(p, "homes").distance, { basis: "first cut" });
  assert.equal(ded(p, "nature-sites").distance, undefined, "a deduction of the land itself has no distance");
  assert.match(distanceNote(ded(p, "watercourses").distance), /^8 m from a main river \(16 m if tidal\): .* \(law or regulation\)\.$/);
  assert.equal(distanceNote(ded(p, "homes").distance), "A first cut for site finding, not from a rule or guidance.");
  assert.ok(!p.notes);
});

test("Scotland: the English rows don't answer for it, and the held-back 50 m isn't loaded", () => {
  const p = plan("wind-onshore", SCOTLAND);
  assert.deepEqual(ded(p, "watercourses").distance, { basis: "first cut" });
  assert.equal(ded(p, "watercourses").buffer_m, 8);
  assert.deepEqual(ded(p, "ancient-woodland").distance, { basis: "first cut" });
  assert.ok(!protection.rows.some((r) => r.deduction === "watercourses" && r.m === 50));
});

test("battery storage: 30 m from homes in the UK (a secondary source); the first cut elsewhere", () => {
  const uk = ded(plan("bess", SCOTLAND), "homes");
  assert.equal(uk.buffer_m, 30);
  assert.equal(uk.distance.secondary, true);
  assert.match(distanceNote(uk.distance), /from a secondary source/);
  const nl = ded(plan("bess", { countries: ["Netherlands"], areas: {} }), "homes");
  assert.equal(nl.buffer_m, 100);
  assert.equal(nl.distance.basis, "first cut");
});

test("the Netherlands: pipelines 5 m by law", () => {
  const p = plan("general", { countries: ["Netherlands"], areas: {} });
  assert.equal(ded(p, "pipelines").buffer_m, 5);
  assert.equal(ded(p, "pipelines").distance.basis, "reg");
  assert.equal(ded(plan("general", ENGLAND), "pipelines").buffer_m, 10);
});

test("a state Tobler can't place a site in: the row isn't applied, and the card says so", () => {
  const au = plan("wind-onshore", { countries: ["Australia"], areas: {} });
  assert.equal(ded(au, "homes").buffer_m, 500);
  assert.equal(au.notes.length, 2);
  assert.match(au.notes.join(" "), /Homes: the distance for Victoria \(1 km from a dwelling unless the owner consents in writing\) isn't applied, because Tobler can't yet tell which state a site is in there/);
  const ca = plan("warehouse", { countries: ["United States of America"], areas: {} });
  assert.ok(!ded(ca, "homes"), "no homes buffer for a warehouse by default");
  assert.match(ca.notes[0], /the distance for California \(1,000 ft/);
  assert.ok(!plan("solar", { countries: ["Australia"], areas: {} }).notes, "rows for other assets say nothing");
});

test("the UK outlines didn't load: a nation's row isn't guessed", () => {
  const p = plan("solar", { countries: ["United Kingdom"], areas: null });
  assert.deepEqual(ded(p, "watercourses").distance, { basis: "first cut" });
  assert.match(p.notes.join(" "), /nation outlines couldn't be loaded/);
  assert.equal(ded(p, "homes").buffer_m, 50, "a UK-wide row doesn't need the outlines");
  assert.equal(ded(plan("bess", { countries: ["United Kingdom"], areas: null }), "homes").buffer_m, 30);
});

test("a site across the border: England's row for the whole site, and it says so", () => {
  const p = plan("solar", { countries: ["United Kingdom"], areas: { England: 0, Scotland: 0 } });
  assert.equal(ded(p, "watercourses").distance.basis, "reg");
  assert.match(p.notes.join(" "), /Watercourses: the distance for England and Wales \(8 m\) is used for the whole site, which crosses a border/);
});

test("the person's own distance beats the source, and the change names the sourced default", () => {
  const p = plan("bess", ENGLAND, { buffers: [{ id: "homes", buffer_m: 50 }] });
  assert.equal(ded(p, "homes").buffer_m, 50);
  assert.ok(p.changes.some((c) => c === "Homes: 50 m, as you asked (default 30 m)"));
});

test("protectionFor only takes reviewed rows", () => {
  const draft = { rows: [{ ...protection.rows[0], status: "proposed" }] };
  assert.equal(protectionFor(draft, "ancient-woodland", "solar", ENGLAND).row, null);
});

console.log(`${passed} developable tests passed`);
