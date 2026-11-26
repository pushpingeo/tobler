// Builds data/ref/uk-areas.json: the real outlines of the UK's four nations, and of the councils the checks name,
// from the Office for National Statistics' Open Geography Portal (Open Government Licence v3.0). The checks use them to
// decide which nation's or council's layers a site's reach touches (invariant 2: real outlines, never boxes).
// Usage: node scripts/build-uk-areas.mjs
// Councils: every name in an `in` list in catalogue/checks.json that isn't a nation.
//
// Source editions: Countries (December 2025) Boundaries UK BGC, and Local Authority Districts (May 2025) Boundaries
// UK BGC: generalised to 20 m and clipped to the coastline (mean high water). The portal stores them in British
// National Grid and serves them in WGS84 with its own OSGB36 to WGS84 shift (a few metres), which is well under the
// 100 m simplification below, so nothing here picks or applies a datum transformation (invariant 1).
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";
const NATIONS = { service: "Countries_December_2025_Boundaries_UK_BGC", code: "CTRY25CD", name: "CTRY25NM", edition: "Countries (December 2025) Boundaries UK BGC" };
const COUNCILS = { service: "LAD_MAY_2025_UK_BGC_V2", code: "LAD25CD", name: "LAD25NM", edition: "Local Authority Districts (May 2025) Boundaries UK BGC" };
export const NATION_NAMES = ["England", "Wales", "Scotland", "Northern Ireland"];

const tmp = "/tmp/uk-areas";
mkdirSync(tmp, { recursive: true });

const checks = JSON.parse(readFileSync("catalogue/checks.json", "utf8"));
const named = new Set();
for (const c of checks.checks) {
  for (const n of c.applies?.in || []) named.add(n);
  for (const s of c.sources || []) for (const n of s.in || []) named.add(n);
}
const councils = [...named].filter((n) => !NATION_NAMES.includes(n)).sort();

async function fetchOne(layer, name) {
  const where = encodeURIComponent(`${layer.name}='${name.replace(/'/g, "''")}'`);
  const url = `${BASE}/${layer.service}/FeatureServer/0/query?where=${where}&outFields=${layer.code},${layer.name}&outSR=4326&f=geojson&geometryPrecision=6&maxAllowableOffset=0.0001`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${name}: ${r.status}`);
  const fc = await r.json();
  if (!fc.features?.length) throw new Error(`${name}: not found in ${layer.service}`);
  return fc.features.map((f) => ({ type: "Feature", geometry: f.geometry,
    properties: { name: f.properties[layer.name], code: f.properties[layer.code], kind: layer === NATIONS ? "nation" : "council" } }));
}

const features = [];
for (const n of NATION_NAMES) features.push(...await fetchOne(NATIONS, n));
for (const n of councils) features.push(...await fetchOne(COUNCILS, n));
const raw = join(tmp, "raw.json");
writeFileSync(raw, JSON.stringify({ type: "FeatureCollection", features }));

const out = "data/ref/uk-areas.json";
// interval=100: shapes are simplified to within 100 m (the checks allow 100 m of slack for it); keep-shapes keeps every part; islands under 0.5 km² go (a site on one gets its nearest nation: js/ukareas.js).
execFileSync("npx", ["mapshaper", raw, "-simplify", "interval=100", "keep-shapes", "-filter-islands", "min-area=500000", "remove-empty",
  "-o", out, "format=geojson", "geojson-type=FeatureCollection", "precision=0.0001"], { stdio: "inherit" });
const fc = JSON.parse(readFileSync(out, "utf8"));
fc.about = {
  source: "Office for National Statistics, Open Geography Portal",
  editions: [NATIONS.edition, COUNCILS.edition],
  licence: "Open Government Licence v3.0",
  attribution: "Source: Office for National Statistics licensed under the Open Government Licence v.3.0. Contains OS data © Crown copyright and database right 2025",
  simplified: "to within 100 m (from generalised 20 m outlines, clipped to the coastline); islands under 0.5 km² left out",
  built: new Date().toISOString().slice(0, 10),
};
writeFileSync(out, JSON.stringify(fc));
console.log(`${out}: ${fc.features.length} areas (${councils.join(", ")}), ${(statSync(out).size / 1e6).toFixed(2)} MB`);
