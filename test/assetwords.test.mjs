// What's planned, read from the person's words in code (js/assetwords.js, package E, 27 Nov).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readAsset, readMessage, settleAsset } from "../js/assetwords.js";
import { picksFor, pickMessage } from "../js/assetpicks.js";

const table = JSON.parse(readFileSync(new URL("../catalogue/assets.json", import.meta.url)));
const picks = JSON.parse(readFileSync(new URL("../catalogue/industries/energy.json", import.meta.url))).asset_picks;
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log(`ok ${name}`); };
const read = (t, o) => readAsset([t], table, o);

ok("names with a word that sets them up are read", () => {
  assert.equal(read("Screen my drawn site as a 200-home scheme").planned, "housing development");
  assert.equal(read("Screen my drawn site as a 200-home scheme").words, "a 200-home scheme");
  assert.equal(read("Find Barnston and screen it for housing").planned, "housing development");
  assert.equal(read("screen Area 1 for a solar farm").asset_type, "solar");
  assert.equal(read("We're looking at a proposed distribution warehouse off the M8").planned, "warehouse or logistics site");
  assert.equal(read("a 49.9 MW battery storage site near Bathgate").planned, "battery energy storage site");
  assert.equal(read("it's a wind farm, 12 turbines").asset_type, "wind-onshore");
  assert.equal(read("screen this housing site").planned, "housing development");
  assert.equal(read("Screen Lethen for wind").asset_type, "wind-onshore");
  assert.equal(read("I would like to screen a warehouse location in Livingston").planned, "warehouse or logistics site");
  assert.equal(read("I would like to screen a warehouse location in Livingston").words, "screen a warehouse location");
  assert.equal(read("Screen Linlithgow Loch for floating solar").asset_type, "solar");
});

ok("the front page's starters are read, with a project's name in between", () => {
  assert.equal(read("Screen a 5 ha housing site on the edge of Linlithgow").planned, "housing development");
  const nh = read("Screen a 10 km² area 6 km south-east of Gifford, East Lothian, for the proposed Newlands Hill wind farm");
  assert.equal(nh.asset_type, "wind-onshore");
  assert.equal(nh.words, "the proposed Newlands Hill wind farm");
  assert.equal(read("Screen the Reventazón hydropower dam in Costa Rica against IFC standards").asset_type, "hydro");
  assert.equal(read("Screen Whitelee wind farm"), null, "a bare name: could be what's already there");
  assert.equal(read("Screen my site, it's near the Whitelee wind farm"), null);
  assert.equal(read("Screen Area 1 next to the proposed Newlands Hill wind farm"), null);
  assert.equal(read("my site is near a proposed wind farm"), null);
});

ok("names beside the site, or denied, are not", () => {
  assert.equal(read("Screen Area 1, it's near the wind farm"), null);
  assert.equal(read("keep 50 m from homes"), null);
  assert.equal(read("how far is it to the nearest homes?"), null);
  assert.equal(read("screen it, there's an existing substation next door"), null);
  assert.equal(read("it's not a wind farm"), null);
  assert.equal(read("Screen the site off the A9 road"), null);
  assert.equal(read("this site of mine in Fife"), null, "'mine' the word, not a mine");
  assert.equal(read("Screen Port Glasgow"), null);
  assert.equal(read("Screen Linlithgow"), null);
  assert.equal(read("A wind farm is next door. Screen my site"), null);
  assert.equal(read("There's a solar farm near the site, screen it"), null);
  assert.equal(read("screen the site near the wind farm"), null);
  assert.equal(read("screen Area 1, it's next to a warehouse"), null);
});

ok("what's planned wins over what's beside it, in one message", () => {
  const r = read("Screen it for a solar farm, next to the existing wind farm");
  assert.equal(r.asset_type, "solar");
});

ok("two things planned in one message: several, to ask", () => {
  const r = read("Screen it for a solar farm with battery storage");
  assert.ok(r.several, "solar and battery storage are both planned: ask, don't pick one");
  assert.deepEqual(r.several.map((x) => x.label).sort(), ["battery energy storage site", "solar farm"]);
});

ok("capacity comes with a row's reading", () => {
  assert.equal(read("screen it as a 50 MW solar farm").capacity_mw, 50);
  assert.equal(read("a 1.2 GW offshore wind farm", { offshore: true }).capacity_mw, 1200);
  assert.equal(read("for a 200-home scheme").capacity_mw, undefined);
});

ok("wind farm words for a site at sea read as offshore wind; oil and gas by setting", () => {
  assert.equal(read("screen it for a wind farm", { offshore: true }).asset_type, "wind-offshore");
  assert.equal(read("screen it as an offshore wind farm", { offshore: false }).asset_type, "wind-onshore");
  assert.equal(read("screen it for oil and gas", { offshore: true }).asset_type, "oil-gas-field");
  assert.equal(read("screen it for oil and gas").asset_type, "oil-gas-onshore");
});

ok("a general screen is the person's say", () => {
  assert.equal(read("Screen Area 1: a general screen, nothing particular planned.").general, true);
  assert.equal(read("I don't know what's planned yet, just screen it").general, true);
});

ok("newest message wins; earlier context counts when the latest says nothing", () => {
  assert.equal(readAsset(["I'm planning a solar farm near Perth", "I've drawn it. Screen it please"], table).asset_type, "solar");
  assert.equal(readAsset(["screen it for a solar farm", "now screen it as a wind farm"], table).asset_type, "wind-onshore");
  assert.equal(readAsset([], table), null);
});

ok("every quick pick reads back as its own asset (no loop of picks)", () => {
  for (const offshore of [false, true]) {
    const { shown, more } = picksFor(picks, offshore);
    for (const p of [...shown, ...more]) {
      const r = read(pickMessage("Area 1", p).text, { offshore });
      assert.equal(r?.asset_type, p.type, `${p.label} (${offshore ? "offshore" : "onshore"}) reads as ${p.type}, got ${JSON.stringify(r)}`);
    }
    assert.equal(read(pickMessage("Area 1", null).text, { offshore }).general, true);
  }
});

ok("each name in the table is read in a plain sentence that sets it up", () => {
  for (const [id, row] of Object.entries(table.assets)) for (const nm of row.names) {
    const r = readMessage(`Screen Area 1 for a ${nm}`, table, { offshore: !row.onshore });
    assert.ok(r.some((x) => x.asset_type === id), `"${nm}" → ${id}: got ${JSON.stringify(r)}`);
  }
  for (const g of table.general.planned) for (const nm of g.names) {
    const r = readMessage(`Screen Area 1 for ${nm}`, table);
    assert.ok(r.some((x) => x.planned === g.label), `"${nm}" → ${g.label}`);
  }
});

ok("settle: the person's words win over the analyst's choice, which is kept", () => {
  const s = settleAsset({ place: "Area 1", asset_type: "solar", assumed: true }, read("screen it for a 200-home scheme"), { table });
  assert.equal(s.input.asset_type, "other");
  assert.equal(s.input.planned, "housing development");
  assert.equal(s.input.assumed, false);
  assert.deepEqual(s.from, { by: "words", words: "a 200-home scheme", model: { asset_type: "solar", assumed: true } });
  const same = settleAsset({ asset_type: "solar" }, read("for a solar farm"), { table });
  assert.equal(same.from.model, undefined, "no disagreement, nothing extra kept");
  const mw = settleAsset({ asset_type: "solar" }, read("a 50 MW solar farm"), { table });
  assert.equal(mw.input.capacity_mw, 50);
  assert.equal(settleAsset({ asset_type: "solar", capacity_mw: 20 }, read("a 50 MW solar farm"), { table }).input.capacity_mw, 20, "the analyst's own figure stands");
});

ok("settle: not said is asked; the analyst's guess is offered first", () => {
  assert.deepEqual(settleAsset({ asset_type: "oil-gas-field", assumed: true }, null, { table }), { ask: "guess", model: { asset_type: "oil-gas-field", assumed: true } });
  assert.equal(settleAsset({ asset_type: "other" }, null, { table }).ask, "unsaid");
  assert.equal(settleAsset({ asset_type: "solar" }, null, { table }).ask, "guess", "the analyst named it, but the person's words don't: asked");
  assert.equal(settleAsset({ asset_type: "other" }, read("for a solar farm and a wind farm"), { table }).ask, "several");
  assert.equal(settleAsset({ asset_type: "solar" }, read("just a general screen"), { table }).input.asset_type, "other");
});

console.log(`${n} asset-words tests passed`);
