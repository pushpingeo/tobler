// Display units (a setting): metric, imperial or nautical. Display only: every stored value, tool and run stays in
// km and km², and the analyst works in km. No DOM, so the tests can use it.
import { fmtNum, fmtArea } from "./reference.js";

const KM_PER = { metric: 1, imperial: 1.609344, nautical: 1.852 };
export const UNIT_SETS = {
  metric: { label: "Metric (km)", dist: "km", area: "km²", scale: "metric" },
  imperial: { label: "Imperial (miles)", dist: "mi", area: "sq mi", scale: "imperial" },
  nautical: { label: "Nautical (nautical miles)", dist: "nm", area: "sq nm", scale: "nautical" },
};

let current = "metric";
export const setUnits = (u) => { current = UNIT_SETS[u] ? u : "metric"; return current; };
export const getUnits = () => current;
export const distUnit = () => UNIT_SETS[current].dist;
export const areaUnit = () => UNIT_SETS[current].area;

// Numbers both ways, for inputs (the resize box) and the slider.
export const toDist = (km) => km / KM_PER[current];
export const fromDist = (v) => v * KM_PER[current];
export const toArea = (km2) => km2 / KM_PER[current] ** 2;
export const fromArea = (v) => v * KM_PER[current] ** 2;

export function dist(km) {
  if (km == null || !Number.isFinite(+km)) return "";
  return `${fmtNum(toDist(+km))} ${distUnit()}`;
}
export function area(km2) {
  if (km2 == null || !Number.isFinite(+km2)) return "";
  if (current === "metric") return fmtArea(+km2);
  // Small areas in acres for imperial (a site, a field); square miles or square nautical miles above that.
  if (current === "imperial" && km2 < 2.59) return `${fmtNum(km2 * 247.105)} acres`;
  return `${fmtNum(toArea(+km2))} ${areaUnit()}`;
}

// Text written in km (summary lines, distance lines) shown in the person's units: "12.4 km" → "7.7 mi".
export function localise(text) {
  if (current === "metric") return String(text ?? "");
  return String(text ?? "").replace(/(\d[\d,]*(?:\.\d+)?)\s?(km²|km2|km)(?![a-z])/g, (_, n, u) => {
    const v = +n.replace(/,/g, "");
    return u === "km" ? dist(v) : area(v);
  });
}

// One line for the conversation agent, so its replies match the card. Empty for metric.
export function unitsNote() {
  if (current === "imperial") return "The person reads distances in miles: give miles first, with km in brackets (tools and runs stay in km).";
  if (current === "nautical") return "The person reads distances in nautical miles: give nautical miles first, with km in brackets (tools and runs stay in km).";
  return "";
}

// Site-sized areas (the area budget, 25 Nov): hectares, or acres for imperial. Always one decimal under 100.
export function hectares(ha) {
  if (ha == null || !Number.isFinite(+ha)) return "";
  const v = current === "imperial" ? +ha * 2.47105 : +ha;
  const n = v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1);
  return `${n} ${current === "imperial" ? "acres" : "ha"}`;
}
