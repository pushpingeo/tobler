// Builds the small reference layers the workspace loads by default, from Natural Earth (public domain).
// Usage: node scripts/build-reference.mjs [folder with the Natural Earth .geojson files]
// Without a folder, the files are downloaded from the Natural Earth GitHub repository.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson";
const inDir = process.argv[2] || "/tmp/natural-earth";
const outDir = "data/ref";
mkdirSync(inDir, { recursive: true });
mkdirSync(outDir, { recursive: true });

const layers = [
  { src: "ne_10m_admin_0_countries", out: "countries", cmd: ["-filter-fields", "NAME,ISO_A3_EH,SOVEREIGNT", "-rename-fields", "name=NAME,iso=ISO_A3_EH,sovereign=SOVEREIGNT", "-simplify", "8%", "keep-shapes"] },
  { src: "ne_10m_coastline", out: "coastline", cmd: ["-filter-fields", "", "-filter", "remove-empty", "-simplify", "20%", "keep-shapes"], precision: "0.001" },
  { src: "ne_10m_populated_places_simple", out: "places", cmd: ["-filter-fields", "name,adm0name,adm1name,pop_max,scalerank", "-rename-fields", "country=adm0name,region=adm1name,pop=pop_max,rank=scalerank"] },
  { src: "ne_50m_rivers_lake_centerlines", out: "rivers", cmd: ["-filter", "featurecla != 'Lake Centerline'", "-filter-fields", "name,scalerank", "-rename-fields", "rank=scalerank", "-simplify", "30%"] },
  { src: "ne_50m_lakes", out: "lakes", cmd: ["-filter-fields", "name,scalerank", "-rename-fields", "rank=scalerank", "-simplify", "30%"] },
];

for (const l of layers) {
  const file = join(inDir, l.src + ".geojson");
  if (!existsSync(file)) {
    const r = await fetch(`${SRC}/${l.src}.geojson`);
    if (!r.ok) throw new Error(`${l.src}: ${r.status}`);
    writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  const out = join(outDir, l.out + ".json");
  execFileSync("npx", ["mapshaper", file, ...l.cmd, "-o", out, "format=geojson", "geojson-type=FeatureCollection", `precision=${l.precision || "0.0001"}`], { stdio: "inherit" });
  if (l.out === "places") compactPlaces(out);
  console.log(`${out}: ${(statSync(out).size / 1e6).toFixed(2)} MB`);
}

// Points are much smaller as rows: [lon, lat, name, country, region, population, rank].
function compactPlaces(file) {
  const fc = JSON.parse(readFileSync(file, "utf8"));
  const fields = ["lon", "lat", "name", "country", "region", "pop", "rank"];
  const rows = fc.features.map((f) => {
    const [lon, lat] = f.geometry.coordinates; const p = f.properties;
    return [+lon.toFixed(4), +lat.toFixed(4), p.name, p.country, p.region, p.pop, p.rank];
  });
  writeFileSync(file, JSON.stringify({ fields, rows }));
}

writeFileSync(join(outDir, "README.md"), `# Reference layers

Natural Earth (public domain, naturalearthdata.com), simplified for the browser by \`scripts/build-reference.mjs\`.

| File | Source | Kept |
|---|---|---|
| countries.json | 1:10m admin 0 countries | name, ISO code, sovereign state |
| coastline.json | 1:10m coastline | geometry |
| places.json | 1:10m populated places | name, country, region, population, rank |
| rivers.json | 1:50m rivers | name, rank |
| lakes.json | 1:50m lakes | name, rank |

These are made for regional and global views. Borders follow Natural Earth's de facto conventions, and the
coastline is accurate to roughly a kilometre, so site-scale work uses OpenStreetMap instead.

## UK nations and councils

\`uk-areas.json\`: the four nations and the councils that \`catalogue/checks.json\` names (\`in\`), from the Office for
National Statistics' Open Geography Portal: Countries (December 2025) and Local Authority Districts (May 2025),
generalised (BGC) outlines clipped to the coastline, simplified to within 100 m, islands under 0.5 km² left out.
Open Government Licence v3.0. Source: Office for National Statistics licensed under the Open Government Licence
v.3.0. Contains OS data © Crown copyright and database right 2025. Built by \`scripts/build-uk-areas.mjs\`; re-run it
when a check names a new council. The checks use it to decide which nation's or council's layers a site's reach
touches (\`js/ukareas.js\`).
`);
