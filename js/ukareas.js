// How far a site is from each UK nation and named council, on their real outlines (data/ref/uk-areas.json, ONS,
// built by scripts/build-uk-areas.mjs). The checks use it to choose which nation's or council's layers a site's reach
// touches (invariant 2: real outlines, never boxes; a box only narrows the search before the real measure).
// Pure (no DOM, no fetching): the run loads the file and passes it in, and the tests do the same.
import * as turf from "./vendor/turf.js";
import { nearestKm } from "./nearness.js";
import { growBox, SLACK_KM } from "./checks.js";

// { England: 0, Wales: 3.2, ... }: the distance in km from the site's footprint to each area within maxKm (0 when it
// touches or lies inside). onLand: the site is on land in the UK (from the world outlines). A small island or a coastal
// sliver the simplified outlines lost falls in no nation; it gets its nearest nation within 5 km, at 0, and says so.
export function areasNear(fc, footprint, maxKm, { onLand = false } = {}) {
  const geom = footprint?.geometry || footprint;
  if (!fc?.features?.length || !geom?.coordinates) return null;
  const sb = turf.bbox(geom);
  // A box only narrows which outlines are measured; the measure itself is on the whole outline (js/nearness.js).
  const clip = growBox(sb, maxKm + 2);
  const out = {};
  let nearestNation = null;
  for (const f of fc.features) {
    const name = f.properties?.name;
    if (!name) continue;
    const fb = f.bbox || (f.bbox = turf.bbox(f));
    const far = clip[2] < fb[0] || clip[0] > fb[2] || clip[3] < fb[1] || clip[1] > fb[3];
    if (far && !(onLand && f.properties.kind === "nation")) continue;
    const km = nearestKm(geom, f.geometry);
    if (km == null) continue;
    if (f.properties.kind === "nation" && (!nearestNation || km < nearestNation.km)) nearestNation = { name, km };
    if (km <= maxKm + SLACK_KM) out[name] = km <= SLACK_KM ? 0 : +km.toFixed(3);
  }
  // On land but in no nation: an island or sliver the simplification lost. Its nearest nation within 5 km is its own.
  if (onLand && nearestNation && nearestNation.km > SLACK_KM && nearestNation.km <= 5) out[nearestNation.name] = 0;
  return out;
}
