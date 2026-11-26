// Prints every reply Tobler writes in code after a run or a hold, from the test fixtures, as markdown: the wording
// sheet Rob reviews before it goes live (plan item 1, 25 Nov). Run: node scripts/reply-samples.mjs
import * as F from "../test/fixtures/runreply-records.mjs";
import { runReply, heldReply, finishTurn } from "../js/runreply.js";
import { runDiff } from "../js/rundiff.js";
import { notRaisedGap } from "../js/ntrrun.js";
import { bringInReply } from "../js/bringin.js";

const withDiff = (rec, old, why = "run again on the same site", siteChanged = null) => {
  const r = JSON.parse(JSON.stringify(rec));
  r.tobler_run.replaces = { run: old.tobler_run.id, why, diff: runDiff(old, r, { siteChanged }) };
  return r;
};
const quote = (t) => t.split("\n").map((l) => `> ${l}`).join("\n");
const out = [];
const add = (title, text, note = "") => out.push(`### ${title}${note ? `\n\n*${note}*` : ""}\n\n${quote(text)}\n`);

out.push("## After a run\n");
add("Constraints screen", runReply(F.oracleSolar), "Oracle campus, solar: four flags, two checks not reached.");
add("Constraints screen on a search area, decision changed in code", runReply(F.kelsoSearchArea));
add("General screen outside the profile, your distances, no flags", runReply(F.housingOutside));
add("Contamination desk study", runReply(F.stanlowStudy));
add("Developable area", runReply(F.barnstonBudget), "Unchanged: this is the budget summary the card and report already use.");
add("A result that couldn't be read", runReply(F.brokenResult));
add("Something that can't run here", "The developable area needs an outline, and Kelso is a point. Draw the site or bring in its boundary file.", "Already code's own words (not_available); shown as they are.");

// Layers offered after the run (26 Nov): one found, one gap the atlas had nothing for, one search that failed.
const withOffer = (rec) => {
  const r = JSON.parse(JSON.stringify(rec));
  r.tobler_run.offer = { at: "2026-11-26T03:00:00Z", searched: [{}, {}, {}], state: "open", why_failed: "no answer in 12 s",
    items: [{ id: "L1", label: "Flood zones", topic: "water", state: "offered", preview: { count: 4, within_km: 20, nearest: [{ name: "Flood Zone 3", distance_km: 0.8 }] }, dataset: { atlas_id: "x", title: "Flood Map for Planning (Rivers and Sea) - Flood Zone 3", publisher: "Environment Agency", licence: "Open Government Licence v3.0", licence_class: "open", licence_short: "Open Government Licence v3.0", capabilities: ["query"] } },
      { id: "L2", label: "Peat", topic: "ground-soil", state: "offered", preview: { count: 1, within_km: 20, nearest: [{ name: "Blanket bog", distance_km: 0 }] }, dataset: { atlas_id: "y", title: "Carbon and Peatland 2016", publisher: "NatureScot", licence: "", licence_class: "unknown", licence_short: "licence not stated", capabilities: ["query"] } }],
    empty: [{ label: "Subsea pipelines and pipeline agreements", title: "Pipelines", publisher: "EMODnet Human Activities" }],
    nothing: ["Important Bird Areas"], failed: ["Surface water flooding"] };
  return r;
};
out.push("## After a run, with layers offered\n");
add("Constraints screen, layers offered for the gaps", runReply(withOffer(F.oracleSolar)), "Buttons under the reply: one per layer, All of them, No thanks.");
add("Layers brought in", bringInReply({ run: "R1", site: "Oracle campus, Linlithgow", added: [
  { dataset: "Flood Map for Planning (Rivers and Sea) - Flood Zone 3", publisher: "Environment Agency", licence: "Open Government Licence v3.0", licence_class: "open", checked_at: "2026-11-26T08:10:00Z", within_km: 20, measured_from: "the site's edge", count: 4, inside: 0, nearest: [{ name: "Flood Zone 3", distance_km: 0.8 }, { name: "Flood Zone 3", distance_km: 2.4 }] },
  { dataset: "Carbon and Peatland 2016", publisher: "NatureScot", licence: "licence not stated", licence_class: "unknown", checked_at: "2026-11-26T08:10:00Z", within_km: 20, measured_from: "the site's edge", not_checked: "The publisher's service didn't answer: 503." }] }));
add("Offer declined", bringInReply({ run: "R1", declined: ["Flood Map for Planning (Rivers and Sea) - Flood Zone 3", "Carbon and Peatland 2016"] }));

out.push("## A rerun\n");
add("Same request, same checks, different result", runReply(withDiff(F.oracleSolarAgain, F.oracleSolar)), "The Oracle campus case from the logs.");
add("A source answered this time that didn't before", runReply(withDiff(F.evoraSecond, F.evoraFirst)), "The Évora case.");
add("Nothing changed", runReply(withDiff(F.evoraFirst, F.evoraFirst)));
add("After the site was edited", runReply(withDiff(F.evoraSecond, F.evoraFirst, "the site was edited after it ran (moved 0.6 km east)", "moved 0.6 km east")));

out.push("## Before a run\n");
add("Confirm a place found from words", heldReply({ held: "confirm", place: "Oracle campus, Linlithgow", anchor: "Oracle", source: "OpenStreetMap contributors", confidence: "medium", role: "footprint", geometry: "Polygon", area_km2: 0.121, queued: "a constraints screen for a solar farm" }), "The place card above it has Use this area and Not quite.");
add("Confirm a search area", heldReply({ held: "confirm", place: "Linlithgow housing 5 ha", anchor: "Linlithgow", source: "OpenStreetMap contributors", confidence: "low", role: "search_area", role_why: "built from clues round Linlithgow", geometry: "Polygon", area_km2: 0.05, queued: "a constraints screen for a housing site" }));
add("Confirm a point (a named feature)", heldReply({ held: "confirm", place: "Reventazón Dam", anchor: "Reventazón Dam", source: "Wikidata", confidence: "high", role: "point", geometry: "Point", queued: "a constraints screen for a hydropower scheme" }));
add("Which part: a lake", heldReply({ held: "which_part", place: "Lake Tekapo", kind: "water", what: "a lake or other water body", area_km2: 96.8, geometry: "Polygon", queued: "a constraints screen for an onshore oil or gas field" }), "The place card's button reads Use all of it.");
add("Which part: a country", heldReply({ held: "which_part", place: "New Zealand", kind: "region", what: "a whole country", area_km2: 412028, geometry: "Polygon", queued: "a constraints screen for an onshore oil or gas field" }));
add("Which part: a town point", heldReply({ held: "which_part", place: "Kelso", kind: "settlement", what: "a town or village", geometry: "Point", queued: "a constraints screen for an onshore wind farm" }));
add("Which part: a road", heldReply({ held: "which_part", place: "Linlithgow Road", kind: "line", what: "a road", geometry: "Point", queued: "a constraints screen for a warehouse" }));
add("No analysis chosen yet", heldReply({ held: "skills", place: "Shell House site" }), "The skill buttons are under it.");
// Buttons end the turn in code; these lines show only when the model wrote nothing in the step that showed them.
const fin = finishTurn({ runs: new Map() });
add("Under the skill buttons (fallback)", fin("offer_skills", {}, { buttons_shown: true }).text, "Only when the model wrote no line of its own.");
add("Under the asset-type buttons (fallback)", fin("ask_asset_type", {}, { buttons_shown: true }).text, "Only when the model wrote no line of its own.");
add("Under the choices (fallback)", fin("offer_choices", {}, { recommended_name: "Linlithgow Palace", reason: "Historic Environment Scotland's record of the palace itself", buttons_shown: true }).text, "Only when the model wrote no line of its own.");

out.push("## On the card, in the gaps\n");
add("A flag whose evidence didn't trace", notRaisedGap({ risk: "Seabird colonies on Shetland may be in spill reach" }));

console.log(out.join("\n"));
