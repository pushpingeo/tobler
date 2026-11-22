// Out-of-date runs ("energy is done" item 2, 22 Nov). A run screens the site as it was; once the place is edited, the
// run no longer describes it. The card says so, with what changed and a one-tap re-run, and the analyst is told.
// Pure functions here; the page (js/workspace.js) wires them to the cards and the map.
import { describeChange } from "./geometry.js";

// Same shape, to about a centimetre: edits round coordinates to 7 decimals, so compare at that.
const key = (g) => JSON.stringify(g, (k, v) => (typeof v === "number" ? Math.round(v * 1e7) / 1e7 : v));

// What changed in the place since the run, in words, or null when it's still the shape that was screened.
// record: a run record (tobler-run/1); place: { id, feature } as it is now, or null when it has been deleted.
export function siteChange(record, place) {
  const r = record?.tobler_run;
  if (!r?.place_geometry_at_run) return null;
  if (!place) return { deleted: true, text: "the site was deleted" };
  const then = JSON.parse(r.place_geometry_at_run);
  if (key(then) === key(place.feature.geometry)) return null;
  let text = "";
  try { text = describeChange({ type: "Feature", properties: {}, geometry: then }, place.feature); } catch { /* odd geometry: fall back */ }
  return { deleted: false, text: text || "reshaped" };
}

// The screen_site input that repeats a run on the place as it is now: same asset, stage, size, focus and extent.
// Distances the person set carry over; defaults are worked out again, since they follow the site's size.
export function rerunInput(record) {
  const r = record.tobler_run;
  const i = r.inputs || {};
  return {
    asset_type: i.asset_type || r.site.asset_type || "other",
    ...(i.assumed || r.site.asset_assumed ? { assumed: true } : {}),
    ...(i.planned ? { planned: i.planned } : {}),
    ...(i.stage ? { stage: i.stage } : {}),
    ...(r.site.capacity_mw != null ? { capacity_mw: r.site.capacity_mw } : {}),
    ...(r.site.tip_height_m != null ? { tip_height_m: r.site.tip_height_m } : {}),
    ...(i.focus ? { focus: i.focus } : {}),
    ...(r.extent === "inside" ? { extent: "inside" } : {}),
    ...(i.distances && Object.keys(i.distances).length ? { distances: i.distances } : {}),
    replaces: r.id,
  };
}

// The card's line for an out-of-date run.
export function outOfDateText(change, { replacedBy = null } = {}) {
  if (replacedBy) return `Replaced by ${replacedBy}, screened after the site was edited (${change?.text || "changed"}).`;
  if (change?.deleted) return "The site was deleted after this screen, so these findings no longer describe anything on the map.";
  return `Out of date: the site was edited after this screen (${change.text}). The findings are for the earlier outline.`;
}

// For the project summary the analyst reads each turn: one line per run, saying which are out of date.
export function runLines(entries) {
  return entries.map(({ record, change, replacedBy }) => {
    const r = record.tobler_run;
    const state = replacedBy ? `replaced by ${replacedBy}` : change ? `OUT OF DATE: ${change.text}${change.deleted ? "" : " since it ran; offer to re-run it"}` : "current";
    return `- ${r.id}: ${r.site.name}, ${r.site.asset_label}, ${r.flags.length} flags${r.decision?.value ? `, ${r.decision.value}` : ""}${r.replaces ? `; replaces ${r.replaces.run}` : ""} (${state})`;
  });
}
