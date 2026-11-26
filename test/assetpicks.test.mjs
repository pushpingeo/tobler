// Quick picks for what's planned at a site (the energy profile's asset_picks, js/assetpicks.js) and the ask_asset_type tool.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { picksFor, pickMessage } from "../js/assetpicks.js";
import { createPlaceTools, placeToolDefs } from "../js/placetools.js";

const config = JSON.parse(readFileSync(new URL("../catalogue/industries/energy.json", import.meta.url))).asset_picks;
const table = JSON.parse(readFileSync(new URL("../catalogue/assets.json", import.meta.url)));

// Every pick is an asset the asset table knows, in both settings.
for (const offshore of [false, true]) {
  const { shown, more } = picksFor(config, offshore);
  for (const p of [...shown, ...more]) assert.ok(table.assets[p.type], `${p.label} → ${p.type} is in assets.json`);
}
// Energy-led, by setting: six buttons, the rest under More.
const land = picksFor(config, false), sea = picksFor(config, true);
assert.deepEqual(land.shown.map((p) => p.type), ["solar", "wind-onshore", "oil-gas-onshore", "mine", "pipeline-cable", "substation"]);
assert.deepEqual(sea.shown.map((p) => p.type), ["wind-offshore", "oil-gas-field", "pipeline-cable", "platform", "port-terminal", "exploration-block"]);
assert.ok(land.more.length > 0 && !land.more.some((p) => p.type === "wind-offshore"));
assert.ok(sea.more.some((p) => p.type === "seismic-survey"));
assert.deepEqual(picksFor(null, false), { shown: [], more: [] });

// What the person sees, and what the analyst is told.
const m = pickMessage("Point near Linlithgow", { label: "Onshore wind", type: "wind-onshore" });
assert.equal(m.text, "Screen Point near Linlithgow as an onshore wind site.");
assert.match(m.forModel, /asset_type "wind-onshore" and assumed false/);
assert.equal(pickMessage("Area 1", { label: "Solar farm", type: "solar" }).text, "Screen Area 1 as a solar farm site.");
const g = pickMessage("Area 1", null);
assert.match(g.text, /general screen/);
assert.match(g.forModel, /asset_type "other"/);

// The tool: shows the buttons through the host; the turn ends in code (finishTurn), not by an instruction.
const shown = [];
const places = [{ name: "Point near Linlithgow", alias: "Point 1", feature: { type: "Feature", geometry: { type: "Point", coordinates: [-3.6, 55.97] } } }];
const tools = createPlaceTools({ places: () => places, findPlace: (n) => places.find((p) => p.name === n || p.alias === n), askAssetType: async (name) => { shown.push(name); return { place: name, setting: "onshore" }; } });
assert.ok(placeToolDefs([]).some((t) => t.name === "ask_asset_type"));
const out = await tools.exec("ask_asset_type", { place: "Point 1" });
assert.deepEqual(shown, ["Point near Linlithgow"]);
assert.equal(out.buttons_shown, true);
assert.equal(out.next, undefined, "no instructions in the tool result: the turn ends in code (runreply BUTTONS)");
console.log("asset pick tests passed");
