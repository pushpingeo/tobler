// Units (package C, 27 Nov). The record is metric: every stored value, tool and run stays in km and km², and the
// analyst works in km. Units are for display and for reading what the person typed. This file is the only place in
// Tobler that holds a conversion factor (test/units.test.mjs checks that), and code does every conversion: the
// model never does. No DOM, so the tests can use it.
//
// Not here: the US survey foot. It belongs to coordinates (a state plane file's own unit), so it stays with the one
// geodesy path (js/fileimport.js and its EPSG definitions, invariant 1), never with display units.
import { fmtNum, fmtArea } from "./reference.js";

// Exact factors, by definition (international yard and pound agreement, 1959; the nautical mile, 1929).
export const M_PER = Object.freeze({ m: 1, km: 1000, ft: 0.3048, yd: 0.9144, mi: 1609.344, nmi: 1852 });
export const M2_PER = Object.freeze({
  m2: 1, ha: 10000, km2: 1e6,
  ft2: 0.09290304, // 0.3048²
  acre: 4046.8564224, // 43,560 ft²
  mi2: 2589988.110336, // 1,609.344²
  nmi2: 3429904, // 1,852²
});

// Round off floating-point noise (0.3048 × 150 is 45.720000000000006 in a double): 12 significant figures, finer
// than a micrometre on 50 km, so never a real digit.
const clean = (v) => +v.toPrecision(12);

export const UNIT_SETS = {
  metric: { label: "Metric (km)", dist: "km", area: "km²", scale: "metric", main: "km", areaMain: "km2" },
  imperial: { label: "Imperial (miles)", dist: "mi", area: "sq mi", scale: "imperial", main: "mi", areaMain: "mi2" },
  nautical: { label: "Nautical (nautical miles)", dist: "nm", area: "sq nm", scale: "nautical", main: "nmi", areaMain: "nmi2" },
};


let current = "metric";
export const setUnits = (u) => { current = UNIT_SETS[u] ? u : "metric"; return current; };
export const getUnits = () => current;
export const distUnit = () => UNIT_SETS[current].dist;
export const areaUnit = () => UNIT_SETS[current].area;

// Numbers both ways in the set's main unit, for inputs (the resize box) and the slider.
const kmPer = () => M_PER[UNIT_SETS[current].main] / 1000;
const km2Per = () => M2_PER[UNIT_SETS[current].areaMain] / 1e6;
export const toDist = (km) => km / kmPer();
export const fromDist = (v) => clean(v * kmPer());
export const toArea = (km2) => km2 / km2Per();
export const fromArea = (v) => clean(v * km2Per());

// Short distances. Metric and nautical: metres under 1 km (sea practice gives safety zones and passing distances in
// metres). Imperial: feet under 1,000 ft (about 305 m), miles from there. The switch is Rob's to confirm.
export const FEET_BELOW_FT = 1000;
const nearest = (v) => (v < 100 ? Math.round(v) : Math.round(v / 10) * 10);
const group = (v) => v.toLocaleString("en-GB");

export function dist(km, units = current) {
  if (km == null || !Number.isFinite(+km)) return "";
  const m = +km * 1000;
  if (units === "imperial") {
    const ft = m / M_PER.ft;
    if (ft < FEET_BELOW_FT) return `${group(nearest(ft))} ft`;
    return `${fmtNum(m / M_PER.mi)} mi`;
  }
  if (m < 1000) return `${group(nearest(m))} m`;
  return units === "nautical" ? `${fmtNum(m / M_PER.nmi)} nm` : `${fmtNum(+km)} km`;
}

// The same distance in the person's units with the metric value after it, for anything the model reads: it can
// quote both and never has to convert ("1.2 mi (1.9 km)"). Metric shows the metric value alone.
export function distBoth(km, units = current) {
  if (km == null || !Number.isFinite(+km)) return "";
  const shown = dist(km, units);
  return units === "metric" ? shown : `${shown} (${dist(km, "metric")})`;
}

const acres = (n) => `${n} ${n === "1" || n === "1.0" ? "acre" : "acres"}`;

export function area(km2, units = current) {
  if (km2 == null || !Number.isFinite(+km2)) return "";
  if (units === "metric") return fmtArea(+km2);
  const m2 = +km2 * 1e6;
  // Small areas in acres for imperial (a site, a field); square miles or square nautical miles above that.
  if (units === "imperial" && m2 < M2_PER.mi2) return acres(fmtNum(clean(m2 / M2_PER.acre)));
  return units === "imperial" ? `${fmtNum(m2 / M2_PER.mi2)} sq mi` : `${fmtNum(m2 / M2_PER.nmi2)} sq nm`;
}

export function areaBoth(km2, units = current) {
  if (km2 == null || !Number.isFinite(+km2)) return "";
  const shown = area(km2, units);
  return units === "metric" ? shown : `${shown} (${area(km2, "metric")})`;
}

// Formatters to hand to code that writes a line (reference.summaryLine): for the page, the person's units; for
// anything the model reads, both, so it quotes and never converts.
export const forPage = () => ({ dist: (km) => dist(km), area: (km2) => area(km2) });
export const forModel = () => ({ dist: (km) => distBoth(km), area: (km2) => areaBoth(km2) });

// Site-sized areas (the area budget, 25 Nov): hectares, or acres for imperial. Always one decimal under 100.
export function hectares(ha, units = current) {
  if (ha == null || !Number.isFinite(+ha)) return "";
  const v = units === "imperial" ? clean((+ha * M2_PER.ha) / M2_PER.acre) : +ha;
  const n = v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1);
  return units === "imperial" ? acres(n) : `${n} ha`;
}

// Reporting ladders. One metric ladder to 50 km (Rob, 26 Nov evening); in imperial a second ladder in round values
// that fall on US practice's search distances, ½ and 1 mile (Rob, 26 Nov: "B everywhere in imperial"; 40 CFR
// 312.26). Nautical uses the metric ladder. Bands are for reporting only: each finding keeps its own distance in
// metres, so changing units regroups the same findings. Edges are exact metres (300 ft is 91.44 m).
// Not wired yet: the rings, the slider and the band lines move onto these with package A.
const LADDER_SAID = {
  metric: [[100, "m"], [250, "m"], [500, "m"], [1, "km"], [2, "km"], [5, "km"], [10, "km"], [20, "km"], [30, "km"], [50, "km"]],
  imperial: [[300, "ft"], [1000, "ft"], [0.25, "mi"], [0.5, "mi"], [1, "mi"], [2, "mi"], [5, "mi"], [10, "mi"], [20, "mi"], [30, "mi"]],
};
const FRACTION = { 0.25: "¼", 0.5: "½", 0.75: "¾" };
const said = (v, u) => `${u === "mi" && FRACTION[v] ? FRACTION[v] : v.toLocaleString("en-GB")}`;
export function ladder(units = current) {
  return (LADDER_SAID[units] || LADDER_SAID.metric).map(([v, u]) => ({ km: clean((v * M_PER[u]) / 1000), value: said(v, u), unit: u }));
}
// The bands inside a reach, closed at the reach itself: [{ from_km, to_km, label }], e.g. "1,000 ft–¼ mi", "1–1.24 mi".
export function ladderBands(reachKm, units = current) {
  const steps = ladder(units).filter((e) => e.km < reachKm - 1e-9);
  const top = ladder(units).find((e) => Math.abs(e.km - reachKm) < 1e-9);
  const end = top || (() => { const t = dist(reachKm, units).split(" "); return { km: reachKm, value: t[0], unit: t[1] }; })();
  const edges = [{ km: 0, value: "0", unit: null }, ...steps, end];
  return edges.slice(1).map((e, i) => {
    const a = edges[i];
    const label = a.unit == null || a.unit === e.unit ? `${a.value}–${e.value} ${e.unit}` : `${a.value} ${a.unit}–${e.value} ${e.unit}`;
    return { from_km: a.km, to_km: e.km, label };
  });
}

// A length as the person said it ("150", "feet") → km, with what was said kept beside it for the record. Accepts the
// usual spellings and abbreviations, singular or plural; anything else returns null (never a guess).
const SPELLINGS = {
  m: ["m", "metre", "metres", "meter", "meters", "mtr", "mtrs"],
  km: ["km", "kms", "kilometre", "kilometres", "kilometer", "kilometers", "k", "klick", "klicks"],
  ft: ["ft", "foot", "feet", "'", "′"],
  yd: ["yd", "yds", "yard", "yards"],
  mi: ["mi", "mile", "miles", "statute mile", "statute miles"],
  nmi: ["nm", "nmi", "nautical mile", "nautical miles", "nautical", "nm.", "n mile", "n miles"],
};
const UNIT_OF = new Map(Object.entries(SPELLINGS).flatMap(([u, ws]) => ws.map((w) => [w, u])));
export const ACCEPTED_UNITS = Object.freeze(Object.fromEntries(Object.entries(SPELLINGS).map(([u, ws]) => [u, [...ws]])));

export function unitOf(said) {
  const w = String(said ?? "").trim().toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
  return UNIT_OF.get(w) || UNIT_OF.get(w.replace(/s$/, "")) || null;
}

export function parseLength(value, unit) {
  const v = typeof value === "number" ? value : parseFloat(String(value ?? "").replace(/,/g, ""));
  const u = unitOf(unit);
  if (!Number.isFinite(v) || v < 0 || !u) return null;
  return { km: clean((v * M_PER[u]) / 1000), said: { value: v, unit: String(unit).trim() }, unit: u };
}

// Package A's input: a distance as the person said it, in km, or null. A unit left out means km. Same rules and
// factors as parseLength.
export function toKm(value, unit = "km") {
  if (value == null || value === "") return null;
  return parseLength(value, String(unit ?? "").trim() || "km")?.km ?? null;
}

// The default units for a place, from its country: imperial in the United States, metric elsewhere (the UK,
// Australia and the Netherlands among them), nautical offered at sea. The person's own choice in Settings always
// wins. `country` may be an ISO code or a Natural Earth name.
const IMPERIAL = new Set(["US", "USA", "UNITED STATES", "UNITED STATES OF AMERICA"]);
export function unitsFor({ country, offshore = false, chosen } = {}) {
  if (chosen && UNIT_SETS[chosen]) return { units: chosen, why: "your choice in Settings", offer_nautical: false };
  const c = String(country ?? "").trim().toUpperCase();
  if (IMPERIAL.has(c)) return { units: "imperial", why: "the usual units in the United States", offer_nautical: offshore };
  return { units: "metric", why: c ? "the usual units where the site is" : "metric, the default", offer_nautical: offshore };
}

// A line for the report and the share link: which units the page shows.
export function unitsLine(units = current) {
  return units === "metric" ? "Distances in metres and kilometres; areas in hectares and km²."
    : units === "imperial" ? "Distances in feet and miles; areas in acres and square miles. Tobler's record is metric; these are converted from it."
    : "Distances in metres and nautical miles; areas in hectares and square nautical miles. Tobler's record is metric; these are converted from it.";
}

// Text written in km shown in the person's units: "12.4 km" → "7.7 mi". The last resort only, for text that code
// didn't build from a value (catalogue prose, older runs); anything with a value to hand uses dist() or area().
export function localise(text) {
  if (current === "metric") return String(text ?? "");
  return String(text ?? "").replace(/(\d[\d,]*(?:\.\d+)?)\s?(km²|km2|km)(?![a-z])/g, (_, n, u) => {
    const v = +n.replace(/,/g, "");
    return u === "km" ? dist(v) : area(v);
  });
}

// One line for the conversation agent. It never converts: the summary it reads carries distances in the person's
// units with the metric value beside them (distBoth), and it quotes those as written.
export function unitsNote() {
  if (current === "metric") return "";
  const name = current === "imperial" ? "feet and miles" : "nautical miles";
  return `The person reads distances in ${name}. Where this summary gives a distance in their units, quote it as written; never convert a number yourself. A figure given only in km stays in km.`;
}
