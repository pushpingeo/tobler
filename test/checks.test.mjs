// Tests for checks as data (catalogue/checks.json, js/checks.js) and the decision rule restated in terms of checks.
// The run's own use of the checks (fetching, the analyst's lines, the record) is tested in ntrrun.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as K from "../js/checks.js";
import * as turf from "../js/vendor/turf.js";
import { areasNear } from "../js/ukareas.js";
import { settleDecision } from "../js/industry.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log("ok", name); };
import { OSM_KINDS } from "../js/osmchecks.js";
const cat = JSON.parse(readFileSync(new URL("../catalogue/checks.json", import.meta.url), "utf8"));
const box = (lon, lat, d = 0.05) => [lon - d, lat - d, lon + d, lat + d];
// UK nations and councils on their real outlines (data/ref/uk-areas.json), as the run measures them.
const UK = JSON.parse(readFileSync(new URL("../data/ref/uk-areas.json", import.meta.url), "utf8"));
const withAreas = (site) => ("areas" in site ? site : { ...site,
  areas: areasNear(UK, turf.bboxPolygon(site.bbox), 60, { onLand: !site.offshore && (site.countries || []).includes("United Kingdom") }) });
const P = (site, scale, opts) => K.planChecks(cat, withAreas(site), scale, opts);
const ids = (plans) => plans.map((p) => p.check.id);

await test("the catalogue: twelve topics plus Indigenous Peoples for global work; every check sound", () => {
  const topics = cat.topics.map((t) => t.id);
  assert.equal(topics.filter((t) => t !== "indigenous").length, 12);
  assert.equal(cat.version, "8");
  assert.ok(topics.includes("topography") && topics.includes("hazards"));
  assert.deepEqual(Object.keys(cat.scales).filter((k) => k !== "about"), ["local", "regional", "global"]);
  assert.deepEqual(cat.scales.global, [10, 20, 50, 100]);
  const seen = new Set();
  for (const c of cat.checks) {
    assert.ok(!seen.has(c.id), `${c.id} is unique`); seen.add(c.id);
    assert.ok(topics.includes(c.topic), `${c.id}: topic ${c.topic}`);
    assert.ok(["count_by_band", "value_at_site", "inside", "classes"].includes(c.answer), `${c.id}: answer`);
    assert.ok(c.sources.length, `${c.id} has sources`);
    if (c.answer === "value_at_site") assert.equal(c.reach_km, null, `${c.id}: values read the site`);
    else for (const s of ["local", "regional", "global"]) assert.ok(s in c.reach_km, `${c.id}: reach at ${s}`);
    for (const s of c.sources) {
      assert.ok(s.atlas_id || s.tool || s.osm || s.pending, `${c.id}: each source is an atlas layer, a tool, an OpenStreetMap kind or pending`);
      // OpenStreetMap's completeness varies by place, so it never decides a topic on its own (24 Nov).
      if (s.osm) { assert.ok(OSM_KINDS[s.osm], `${c.id}: OpenStreetMap kind ${s.osm} is known`); assert.equal(c.must, false, `${c.id}: an OpenStreetMap check is never a must`); }
      if (s.atlas_id) { assert.match(s.atlas_id, /^[0-9a-f]{16}$/); assert.ok(s.record?.title && s.record?.publisher && s.record?.licence && s.record?.as_of, `${c.id}: record kept`); }
    }
  }
});

await test("scale from the screening distances and the site's size", () => {
  assert.equal(K.screenScale({ wider: 5 }), "local");
  assert.equal(K.screenScale({ wider: 10 }), "local");
  assert.equal(K.screenScale({ wider: 20 }), "regional");
  assert.equal(K.screenScale({ wider: 50 }), "global");
  assert.equal(K.screenScale({ wider: 20 }, 150), "global", "a big licence is global whatever its distances");
});

await test("bands inside a reach, and their labels", () => {
  assert.deepEqual(K.bandsFor(cat.scales.regional, 10), [2, 5, 10]);
  assert.deepEqual(K.bandsFor(cat.scales.regional, 7), [2, 5, 7]);
  assert.deepEqual(K.bandsFor(cat.scales.local, 2), [0.05, 0.25, 0.5, 2]);
  assert.deepEqual(K.bandsFor(cat.scales.local, 0), []);
  assert.equal(K.bandLabel(0, 0.05), "0–50 m");
  assert.equal(K.bandLabel(0.05, 0.25), "50–250 m");
  assert.equal(K.bandLabel(0.5, 2), "500 m–2 km");
  assert.equal(K.bandLabel(2, 5), "2–5 km");
});

await test("selection by setting, region and scale; sources by country and box", () => {
  // Onshore in the Netherlands, regional: the EU Natura layers, CDDA, US habitat and sea checks left out.
  const nl = P({ bbox: box(4.93, 51.49), countries: ["Netherlands"], offshore: false, sea: false }, "regional");
  // Since the coverage drive (24 Nov), OpenStreetMap's infrastructure and receptors and the global active faults
  // apply everywhere on land; Indigenous territories only where Native Land Digital maps them (not Europe).
  assert.deepEqual(ids(nl), ["bio.sac", "bio.spa", "bio.national-sites", "community.homes", "community.schools", "community.health-care", "hazards.active-faults",
    "material.power-lines", "material.substations", "material.pipelines", "material.main-roads", "material.railways", "material.aerodromes", "material.wind-turbines",
    "topo.elevation", "context.boundaries"], "no UK-only checks in the Netherlands");
  assert.deepEqual(nl[0].sources.map((x) => x.atlas_id), ["2764f9d94e700980"]);
  assert.equal(nl[0].reach_km, 10);
  const regions = (plans, id) => plans.find((p) => p.check.id === id).sources.map((x) => x.region);
  // Linlithgow, local: Scotland's layers only (England's are out of a 2 km reach; JNCC is for the sea; EU not in the UK).
  const sc = P({ bbox: box(-3.6, 55.97), countries: ["United Kingdom"], offshore: false, sea: false }, "local");
  assert.deepEqual(regions(sc, "bio.sac"), ["Scotland"]);
  assert.deepEqual(regions(sc, "bio.national-sites"), ["Scotland"]);
  assert.deepEqual(regions(sc, "bio.ancient-woodland"), ["Scotland"]);
  assert.ok(ids(sc).includes("bio.ramsar"));
  // Berwick, regional (10 km): both nations, because the reach crosses the border.
  const bw = P({ bbox: box(-2.0, 55.77, 0.01), countries: ["United Kingdom"], offshore: false, sea: true, coast_km: 0.5 }, "regional");
  assert.deepEqual(regions(bw, "bio.sac"), ["England", "Scotland", "UK offshore, beyond 12 nm"]);
  // Belfast: Northern Ireland; ancient woodland there has no layer (pending), so the check says so.
  const bf = P({ bbox: box(-5.93, 54.6), countries: ["United Kingdom"], offshore: false, sea: false }, "local");
  assert.ok(regions(bf, "bio.sac").includes("Northern Ireland"));
  const awNI = bf.find((p) => p.check.id === "bio.ancient-woodland");
  assert.equal(K.unsourced({ ...awNI, sources: awNI.sources.filter((x) => x.region === "Northern Ireland") }).reason, "pending");
  // Northern France, inside the UK's boxes: the country decides on land (EU layer, no UK-only checks).
  const fr = P({ bbox: box(1.85, 50.9), countries: ["France"], offshore: false, sea: true, coast_km: 3 }, "regional");
  assert.ok(fr.find((p) => p.check.id === "bio.sac").sources.some((x) => x.atlas_id === "2764f9d94e700980"));
  assert.ok(!ids(fr).includes("bio.ramsar") && !ids(fr).includes("bio.ancient-woodland"));
  // Dogger Bank, global: JNCC's offshore layer and the EU's (the Dutch Doggersbank), and England's in its box.
  const ns = P({ bbox: box(1.9, 54.8, 0.3), countries: [], offshore: true, sea: true }, "global");
  const sac = regions(ns, "bio.sac");
  assert.ok(sac.includes("UK offshore, beyond 12 nm") && sac.includes("EU (not UK since 2021)"), sac.join());
  assert.ok(ids(ns).includes("topo.water-depth") && !ids(ns).includes("topo.elevation") && !ids(ns).includes("bio.ancient-woodland"));
  // Kenya onshore: Natura doesn't apply at all; national sites apply but have no source here.
  const ke = P({ bbox: box(36.8, -1.3), countries: ["Kenya"], offshore: false, sea: false }, "regional");
  assert.ok(!ids(ke).includes("bio.sac"));
  const nat = ke.find((p) => p.check.id === "bio.national-sites");
  assert.equal(nat.source, null);
  assert.equal(K.unsourced(nat).reason, "no_source");
  // Tropical sea: coral reefs apply; marine mammal areas have no reach at local scale.
  const tr = P({ bbox: box(39.5, -4), countries: [], offshore: true, sea: true }, "local");
  assert.ok(!ids(tr).includes("bio.marine-mammal-areas") && !ids(tr).includes("bio.coral-reefs"), "no local reach");
  assert.ok(ids(P({ bbox: box(39.5, -4), countries: [], offshore: true, sea: true }, "regional")).includes("bio.coral-reefs"));
  // Inside only: every count looks inside.
  assert.ok(P({ bbox: box(4.93, 51.49), countries: ["Netherlands"], offshore: false, sea: false }, "regional", { inside: true }).filter((p) => p.reach_km != null).every((p) => p.reach_km === 0));
});

const plan = (id, scale = "regional", reach) => {
  const check = cat.checks.find((c) => c.id === id);
  return { check, source: check.sources.at(-1), reach_km: reach ?? check.reach_km?.[scale] ?? null, scale };
};

await test("every state: found by band, none found, not checked for each reason", () => {
  const sac = plan("bio.sac");
  const f = K.fromFeatures(sac, [
    { name: "Inside SAC", distance_km: 0 }, { name: "Near SAC", distance_km: 1.5 }, { name: "Mid SAC", distance_km: 6 },
    { name: "Beyond", distance_km: 15 }, { name: "Wide area", distance_km: 0, around_site: true }], cat.scales.regional,
  { dataset: "Natura", publisher: "EEA", licence: "attribution", checked_at: "2026-11-23", fetched_km: 20 });
  assert.equal(f.state, "found");
  assert.equal(f.count, 4, "beyond the reach isn't counted");
  assert.deepEqual(f.bands.map((b) => [b.label, b.count]), [["on site", 1], ["0–2 km", 1], ["2–5 km", 0], ["5–10 km", 1]]);
  assert.equal(f.around, 1);
  assert.equal(f.nearest.name, "Inside SAC");
  assert.equal(f.source.publisher, "EEA");
  assert.equal(K.checkLine(f), "4 within 10 km (1 on site, 1 at 0–2 km, 1 at 5–10 km, 1 around the site); nearest Inside SAC (on site)");
  const n = K.fromFeatures(sac, [{ name: "Far", distance_km: 30 }], cat.scales.regional, { fetched_km: 20 });
  assert.equal(n.state, "none");
  assert.equal(K.checkLine(n), "none found within 10 km");
  // Reach longer than the tools fetch: cut, and said.
  const b = K.fromFeatures(plan("context.boundaries", "global"), [{ name: "Belgium", distance_km: 40 }], cat.scales.global, { fetched_km: 50 });
  assert.equal(b.reach_km, 50);
  assert.match(K.checkLine(b), /within 50 km \(of 100 km: the tools fetch to 50 km\)/);
  // Not checked: licence, failure, pending, no source.
  const lic = K.notChecked(plan("bio.marine-protected"), "This dataset's licence is non-commercial (e.g. WDPA). Tobler leaves it out unless the person switches on non-commercial data in settings.");
  assert.equal(lic.state, "not_checked"); assert.equal(lic.reason, "licence");
  assert.doesNotMatch(lic.why, /Tobler leaves/, "first sentence only");
  assert.equal(K.notChecked(sac, "The publisher's service didn't answer: 503").reason, "failed");
  assert.equal(K.unsourced({ ...sac, sources: [{ region: "X", pending: "not in yet" }] }).reason, "pending");
  assert.match(K.checkLine(K.unsourced({ ...sac, source: null })), /^not checked: no source for this region$/);
  // Inside.
  const m = K.fromFeatures(plan("material.marpol-special-areas"), [{ name: "North West European waters", distance_km: 0, around_site: true }], [], {});
  assert.equal(m.inside, true);
  assert.equal(K.checkLine(m), "the site is inside North West European waters (a wide area it lies within)");
  assert.equal(K.checkLine(K.fromFeatures(plan("material.marpol-special-areas"), [], [], {})), "the site isn't inside one");
  // A search area is never "on site".
  assert.equal(K.checkLine({ ...f, search_area: true }), "4 within 10 km (1 in the search area, 1 at 0–2 km, 1 at 5–10 km, 1 around the site); nearest Inside SAC (in the search area)");
  // Values.
  const v = K.fromValue(plan("topo.elevation"), { text: "about 25 m", meta: { dataset: "DEM", publisher: "NOAA" } });
  assert.equal(K.checkLine(v), "about 25 m");
});

await test("several sources: filtered, counted once by code or name, partly checked, supplementary", () => {
  const sac = plan("bio.sac");
  const [ne, ns, , , jncc] = sac.check.sources;
  const site = (name, km, extra = {}) => ({ name, distance_km: km, extra });
  const meta = (dataset) => ({ dataset, publisher: "p", licence: "OGL", checked_at: "2026-11-24", fetched_km: 20 });
  const r = K.fromSources(sac, [
    { source: ne, features: [site("Berwickshire and North Northumberland Coast", 3, { SAC_CODE: "UK0017072" })], meta: meta("NE SAC") },
    { source: ns, features: [site("Berwickshire and North Northumberland Coast", 2.5, { PA_CODE: "UK0017072" }), site("River Tweed", 0, { PA_CODE: "UK0012691" })], meta: meta("NS SAC") },
    { source: jncc, features: [site("Some MCZ", 6, { SITE_CODE: "UKMCZ0001", SITE_STATU: "MCZ - Secretary of State" })], meta: meta("JNCC") },
  ], cat.scales.regional);
  assert.equal(r.state, "found");
  assert.equal(r.count, 2, "same code in two nations' layers counts once; the MCZ isn't a SAC");
  assert.equal(r.nearest.name, "River Tweed");
  assert.deepEqual(r.bands.find((b) => b.label === "2–5 km").count, 1);
  assert.equal(r.sources.length, 3);
  // One nation's layer failed: a found result says so; a none-found result becomes not checked (partly).
  const down = { source: ne, not_checked: "The publisher's service didn't answer: 503. Report it as not checked." };
  const f2 = K.fromSources(sac, [down, { source: ns, features: [site("River Tweed", 0, { PA_CODE: "UK0012691" })], meta: meta("NS SAC") }], cat.scales.regional);
  assert.equal(f2.state, "found");
  assert.equal(f2.partly, "Natural England didn't answer");
  const n2 = K.fromSources(sac, [down, { source: ns, features: [], meta: meta("NS SAC") }], cat.scales.regional);
  assert.equal(n2.state, "not_checked");
  assert.equal(n2.reason, "partly");
  assert.equal(K.checkLine(n2), "not checked: Natural England didn't answer (none in the others)");
  // Every source down: not checked, failed; every source licence-blocked: not checked, licence.
  assert.equal(K.fromSources(sac, [down, { ...down, source: ns }], cat.scales.regional).reason, "failed");
  // WDPA is supplementary: switched off beside the UK's own layers, "none found" stands; alone (French waters), not checked.
  const mp = plan("bio.marine-protected");
  const wdpa = mp.check.sources.find((x) => x.supplementary);
  const lic = { source: wdpa, not_checked: "This dataset's licence is non-commercial (e.g. WDPA)." };
  const uk = K.fromSources(mp, [{ source: mp.check.sources[0], features: [], meta: meta("NE MCZ") }, lic], cat.scales.regional);
  assert.equal(uk.state, "none");
  assert.equal(uk.partly, undefined);
  const fr = K.fromSources(mp, [lic], cat.scales.regional);
  assert.equal(fr.state, "not_checked"); assert.equal(fr.reason, "licence");
  // A source with no code: the same name within half a kilometre counts once.
  const mpJncc = mp.check.sources.find((x) => x.atlas_id === "1d6371b702df0abc");
  const both = K.fromSources(plan("bio.marine-protected", "global"), [{ source: mpJncc, features: [site("Sponge Belt", 20, { SITE_CODE: "X1", SITE_STATU: "NCMPA" })], meta: meta("JNCC") },
    { source: wdpa, features: [site("Sponge Belt", 20.2)], meta: meta("WDPA") }], cat.scales.global);
  assert.equal(both.count, 1);
  // The card and report list every source.
  assert.equal(K.checksView({ checks: [r], topic_labels: { biodiversity: "Biodiversity" } }).groups[0].items[0].source, "NE SAC (p); NS SAC (p); JNCC (p)");
});

await test("the same feature from two layers: a near box first, then the same shape; and the switch", async () => {
  const { sameShape } = await import("../js/siterole.js");
  const sq = (w, so, e, n) => ({ type: "Polygon", coordinates: [[[w, so], [e, so], [e, n], [w, n], [w, so]]] });
  // Shapes: polygons covering each other 95% both ways; lines within 20 m; points within 10 m.
  assert.equal(sameShape(sq(-3.6, 54.8, -3.0, 55.0), sq(-3.6, 54.8, -3.0, 55.003)), true, "one edge a few hundred metres off on a 20 km site");
  const diamond = { type: "Polygon", coordinates: [[[-3.3, 54.8], [-3.0, 54.9], [-3.3, 55.0], [-3.6, 54.9], [-3.3, 54.8]]] };
  assert.equal(K.sameExtent([-3.6, 54.8, -3.0, 55.0], [-3.6, 54.8, -3.0, 55.0]), true);
  assert.equal(sameShape(sq(-3.6, 54.8, -3.0, 55.0), diamond), false, "the same box, a different shape: not the same feature");
  assert.equal(sameShape({ type: "Point", coordinates: [-1, 53] }, { type: "Point", coordinates: [-1.0001, 53] }), true, "about 7 m");
  assert.equal(sameShape({ type: "Point", coordinates: [-1, 53] }, { type: "Point", coordinates: [-1.0003, 53] }), false, "about 20 m");
  const line = (dy) => ({ type: "LineString", coordinates: [[-1, 53 + dy], [-0.9, 53.05 + dy], [-0.8, 53 + dy]] });
  assert.equal(sameShape(line(0), line(0.0001)), true, "11 m apart");
  assert.equal(sameShape(line(0), line(0.0005)), false, "55 m apart");
  assert.equal(sameShape(line(0), sq(-1, 53, -0.8, 53.05)), false, "a line isn't a polygon");
  // In a check: England's and Scotland's copy of one site (different names) count once with the switch on, twice off;
  // a different shape in the same box never merges; one layer's own parts never merge.
  const sac = plan("bio.sac");
  const [ne, ns] = sac.check.sources;
  const meta = { fetched_km: 20 };
  const f = (name, d, g) => ({ name, distance_km: d, geometry: g, bbox: [-3.6, 54.8, -3.0, 55.0], extra: {} });
  const answers = (g2) => [{ source: ne, features: [f("Solway Firth", 3, sq(-3.6, 54.8, -3.0, 55.0))], meta },
    { source: ns, features: [f("Solway Firth SAC", 3.1, g2), f("Solway Firth SAC (part)", 3.1, sq(-3.6, 54.8, -3.0, 55.0))], meta }];
  const on = { sameShape };
  assert.equal(K.fromSources(sac, answers(sq(-3.6, 54.8, -3.0, 55.0)), cat.scales.regional, on).count, 1, "the same shape twice in NatureScot's layer and once in England's: counted once");
  assert.equal(K.fromSources(sac, answers(diamond), cat.scales.regional, on).count, 2, "a diamond in the same box isn't the same site");
  assert.equal(K.fromSources(sac, answers(sq(-3.6, 54.8, -3.0, 55.0)), cat.scales.regional, {}).count, 3, "switched off: each copy counts");
});

await test("class answers: flood zones and farmland by class, with the share of the site; edge-touching isn't on site", () => {
  const fz = plan("water.flood-zones");
  const ea = fz.check.sources.find((x) => x.region === "England");
  const sepa = fz.check.sources.find((x) => x.class && /River, medium/.test(x.class));
  const r = K.fromSources(fz, [{ source: ea, features: [
    { name: "a", distance_km: 0, coverage: 0.3, extra: { flood_zone: "FZ3" } }, { name: "b", distance_km: 0, coverage: 0.2, extra: { flood_zone: "FZ2" } },
    { name: "c", distance_km: 0, coverage: 0.001, extra: { flood_zone: "FZ3" } }, { name: "d", distance_km: 0.3, extra: { flood_zone: "FZ2" } },
    { name: "e", distance_km: 0, coverage: 0.1, extra: { flood_zone: "??" } }], meta: { fetched_km: 0.5 } }], cat.scales.regional);
  assert.equal(r.state, "found");
  assert.deepEqual(r.classes.map((c) => [c.label, c.on_site, c.coverage]), [["Flood Zone 3", true, 0.3], ["Flood Zone 2", true, 0.2]], "a sliver touching the edge (0.1%) is not on the site");
  assert.equal(K.checkLine(r), "on the site: Flood Zone 3 (30%), Flood Zone 2 (20%)");
  const near = K.fromSources(fz, [{ source: sepa, features: [{ name: "x", distance_km: 0.2, extra: {} }, { name: "y", distance_km: 0, coverage: 0.002, extra: {} }], meta: {} }], cat.scales.regional);
  assert.equal(K.checkLine(near), "none on the site; nearby: River, medium likelihood (1 in 200 years) at the edge", "a sliver touching the edge is nearest, not on the site");
  const near2 = K.fromSources(fz, [{ source: sepa, features: [{ name: "x", distance_km: 0.2, extra: {} }], meta: {} }], cat.scales.regional);
  assert.equal(K.checkLine(near2), "none on the site; nearby: River, medium likelihood (1 in 200 years) at 200 m");
  assert.equal(K.checkLine(K.fromSources(fz, [{ source: sepa, features: [], meta: {} }], cat.scales.regional)), "none within 500 m");
  // Farmland: England's detailed survey and the provisional map side by side; Hutton by prefix; Wales mapped.
  const fg = plan("land.farmland-grade");
  const src = (re) => fg.check.sources.find((x) => re.test(x.record?.title || ""));
  const g = K.fromSources(fg, [
    { source: src(/post-1988/), features: [{ name: "s", distance_km: 0, coverage: 0.6, extra: { ALC_GRADE: "Grade 3a" } }, { name: "t", distance_km: 0, coverage: 0.4, extra: { ALC_GRADE: "Grade 3b" } }], meta: {} },
    { source: src(/Provisional/), features: [{ name: "u", distance_km: 0, coverage: 1, extra: { ALC_GRADE: "Grade 3" } }, { name: "v", distance_km: 0, coverage: 0.2, extra: { ALC_GRADE: "Exclusion" } }], meta: {} }], cat.scales.local);
  assert.equal(K.checkLine(g), "on the site: Grade 3a (60%), Grade 3 (provisional map) (100%), Grade 3b (40%)");
  assert.equal(K.classOf(src(/Land Capability/), { extra: { LCCODE: "3.1" } }), "Class 3.1");
  assert.equal(K.classOf(src(/Predictive/), { extra: { predictive: "3a" } }), "Grade 3a (predictive map)");
  // Peat is non-commercial: switched off, not checked, licence.
  const pt = plan("ground.peat");
  const peat = K.fromSources(pt, [{ source: pt.check.sources[0], not_checked: "This dataset's licence is non-commercial (e.g. WDPA). Tobler leaves it out." }], cat.scales.local);
  assert.equal(peat.reason, "licence");
  assert.equal(K.checkLine(peat), "not checked: non-commercial licence: off unless switched on in Settings");
});

await test("SSSI Impact Risk Zones: the code read for the development, in Natural England's words", () => {
  const table = JSON.parse(readFileSync(new URL("../catalogue/sssi_irz_codes.json", import.meta.url), "utf8"));
  assert.equal(K.irzCodeOf("https://irz.geodata.org.uk/IRZ/step2.html?irzcode=0300000630000&x=1"), "0300000630000");
  assert.equal(K.irzCodeOf("nothing"), null);
  const d = K.decodeIrz(["0300000630000", "0010000000000"], table, ["ws"]);
  assert.deepEqual(d.map((x) => [x.key, x.consult]), [["ac", false], ["ws", true]]);
  assert.ok(d[1].texts.length === 1 && d[1].texts[0].length > 10);
  assert.equal(K.decodeIrz(["0300000630000"], table, ["in"])[1].texts[0], table.positions[1].levels["3"]);
  const irz = plan("bio.sssi-irz", "local");
  const r = K.fromSources(irz, [{ source: irz.check.sources[0], features: [{ name: "zone", distance_km: 0, extra: {} }], meta: {} }], []);
  r.irz = d;
  assert.equal(K.checkLine(r), "inside a risk zone; consult Natural England for: wind and solar");
  r.irz = K.decodeIrz(["0300000630000"], table, ["ws"]);
  assert.equal(K.checkLine(r), "inside a risk zone; no consultation needed for this kind of development");
});

await test("the UK pack: where each check applies, and Northern Ireland's listed buildings filtered", () => {
  // Linlithgow, local: heritage, landscape, flood, farmland and peat all apply; the IRZ (England only) doesn't.
  const sc = P({ bbox: box(-3.6, 55.97), countries: ["United Kingdom"], offshore: false, sea: false, coast_km: 3 }, "local");
  for (const id of ["heritage.listed-buildings", "landscape.national-landscapes", "water.flood-zones", "land.farmland-grade", "ground.peat", "landscape.wild-land"]) assert.ok(ids(sc).includes(id), id);
  assert.ok(!ids(sc).includes("bio.sssi-irz"));
  assert.ok(sc.find((p) => p.check.id === "land.farmland-grade").sources.some((x) => /Hutton/.test(x.record?.licence || "")));
  // Leeds: the IRZ applies; Wild Land doesn't.
  const ld = P({ bbox: box(-1.55, 53.8), countries: ["United Kingdom"], offshore: false, sea: false, coast_km: 80 }, "local");
  assert.ok(ids(ld).includes("bio.sssi-irz") && !ids(ld).includes("landscape.wild-land"));
  // England-only: the IRZ, and England's missing layers as gaps, by the nation boxes (Kintyre is south of 55.8°N but Scottish).
  const at = (lon, lat) => P({ bbox: box(lon, lat, 0.01), countries: ["United Kingdom"], offshore: false, sea: false, coast_km: 5 }, "local");
  assert.ok(!ids(at(-5.6, 55.5)).includes("bio.sssi-irz"), "Kintyre");
  assert.ok(!ids(at(-3.18, 51.48)).includes("bio.sssi-irz"), "Cardiff");
  assert.ok(ids(at(-2.93, 54.89)).includes("bio.sssi-irz"), "Carlisle");
  assert.ok(ids(at(-0.13, 51.5)).includes("bio.sssi-irz"), "London");
  assert.ok(ids(at(-6.3, 49.92)).includes("bio.sssi-irz"), "Isles of Scilly");
  assert.ok(!at(-5.6, 55.5).find((p) => p.check.id === "water.surface-water").sources.some((x) => x.region === "England"), "no England gap in Kintyre");
  // A nation's layer covers the whole nation, not just its data's extent: Kintyre has no National Park, which is "none found".
  const np = P({ bbox: box(-5.6, 55.5, 0.01), countries: ["United Kingdom"], offshore: false, sea: false, coast_km: 5 }, "regional").find((p) => p.check.id === "landscape.national-parks");
  assert.ok(np.sources.length && np.sources.every((x) => x.region === "Scotland"), JSON.stringify(np.sources.map((x) => x.region)));
  assert.equal(K.unsourced(np), null);
  // Offshore: heritage and landscape only when the coast is within their reach.
  const far = P({ bbox: box(-3.95, 60.98, 0.1), countries: [], offshore: true, sea: true, coast_km: 139 }, "global");
  assert.ok(!far.some((p) => /^(heritage|landscape)\./.test(p.check.id)) && !ids(far).includes("water.flood-zones"));
  const near = P({ bbox: box(-3.2, 53.5, 0.05), countries: [], offshore: true, sea: true, coast_km: 12 }, "global");
  assert.ok(ids(near).includes("landscape.national-landscapes") && ids(near).includes("heritage.world-heritage"), "coast within 20 km");
  // Belfast: listed buildings from DfC, with only listed grades counted.
  const lb = plan("heritage.listed-buildings");
  const dfc = lb.check.sources.find((x) => x.region === "Northern Ireland");
  const r = K.fromSources(lb, [{ source: dfc, features: [{ name: "A house", distance_km: 1, extra: { CurrentGra: "B+" } }, { name: "Record only", distance_km: 1.2, extra: { CurrentGra: "Record Only" } }], meta: {} }], cat.scales.regional);
  assert.equal(r.count, 1);
  assert.ok(lb.check.sources.every((x) => x.dense), "listed buildings fetched only to their own reach");
});

await test("World Heritage Sites and their buffer zones apart; names tidied, not reworded; rows carry a grade", async () => {
  const whs = plan("heritage.world-heritage");
  const hes = whs.check.sources.find((x) => x.region === "Scotland");
  const feats = [{ name: "Antonine Wall World Heritage Site Buffer Zone", distance_km: 2.1, extra: {} }, { name: "Frontiers of the Roman Empire: Antonine Wall", distance_km: 4, extra: {} }];
  const r = K.fromSources(whs, [{ source: hes, features: feats, meta: {} }], cat.scales.regional);
  assert.equal(r.count, 1);
  assert.equal(r.nearest.name, "Frontiers of the Roman Empire: Antonine Wall");
  const bz = plan("heritage.whs-buffer", "regional");
  const inBuffer = K.fromSources(bz, [{ source: bz.check.sources.find((x) => x.region === "Scotland"), features: [{ ...feats[0], distance_km: 0 }], meta: {} }], []);
  assert.equal(K.checkLine(inBuffer), "the site is inside Antonine Wall World Heritage Site Buffer Zone");
  assert.equal(K.checkLine(K.fromSources(bz, [{ source: bz.check.sources[0], features: [], meta: {} }], [])), "the site isn't inside one");
  const { tidyName } = await import("../js/atlasfeatures.js");
  assert.equal(tidyName("BLACKNESS ROAD, BOGHALL LODGE"), "Blackness Road, Boghall Lodge");
  assert.equal(tidyName("Bonhard House,enclosure 500m SSW of"), "Bonhard House, enclosure 500m SSW of", "mixed case keeps its capitals");
  assert.equal(tidyName("CHURCH OF ST MICHAEL AND ALL ANGELS"), "Church of St Michael and All Angels");
  assert.equal(tidyName("WAR MEMORIAL, KING GEORGE V PARK"), "War Memorial, King George V Park");
  // A row's detail: the grade with its word.
  const lb = plan("heritage.listed-buildings");
  const hesLb = lb.check.sources.find((x) => x.region === "Scotland");
  const rows = K.fromSources(lb, [{ source: hesLb, features: [{ name: "Linlithgow Palace", distance_km: 0.4, extra: { CATEGORY: "A" } }], meta: { dataset: "HES LB" } }], cat.scales.regional).members;
  assert.equal(rows[0].detail, "Category A");
  assert.equal(rows[0].publisher, "Historic Environment Scotland");
});

await test("topics with no check, the summary lines, and grouping by topic", () => {
  const rs = [K.fromFeatures(plan("bio.sac"), [], cat.scales.regional, {}), K.fromValue(plan("topo.elevation"), { text: "x" })];
  const left = K.uncheckedTopics(cat, rs, "regional");
  assert.ok(!left.includes("biodiversity") && !left.includes("topography") && !left.includes("indigenous"));
  assert.ok(K.uncheckedTopics(cat, rs, "global").includes("indigenous"), "Indigenous Peoples for global work");
  assert.match(K.noCheckLine(cat, left), /^10 topics have no standard check yet: water, ground and soil/);
  assert.equal(K.noCheckLine(cat, []), null);
  assert.deepEqual(K.byTopic(cat, [rs[1], rs[0]]).map((g) => g.label), ["Biodiversity", "Topography and bathymetry"]);
  assert.equal(K.checksSummary([...rs, K.notChecked(plan("bio.spa"), "down")]), "Checks: 3 (1 found, 1 none found, 1 not checked)");
});

await test("the decision rule: insufficient evidence when every must-check for a topic was not checked", () => {
  const nc = (id) => K.notChecked(plan(id), "down");
  const none = (id) => K.fromFeatures(plan(id), [], cat.scales.regional, {});
  const all = [nc("bio.sac"), nc("bio.spa"), nc("bio.national-sites"), none("context.boundaries")];
  assert.deepEqual(K.topicsShort(all), ["biodiversity"]);
  const d = settleDecision({ value: "progress", why: "" }, { checks: all, topicLabel: (t) => K.topicLabel(cat, t) });
  assert.equal(d.value, "insufficient evidence");
  assert.match(d.changed, /none of the must-checks for biodiversity could be checked/);
  // One must-check reached is enough; a non-must failure never decides.
  const one = [nc("bio.sac"), nc("bio.spa"), none("bio.national-sites"), nc("context.boundaries")];
  assert.deepEqual(K.topicsShort(one), []);
  assert.equal(settleDecision({ value: "progress", why: "" }, { checks: one }).value, "progress");
  const up = settleDecision({ value: "insufficient evidence", why: "" }, { checks: one, flags: [] });
  assert.equal(up.value, "progress with targeted investigation");
  assert.match(up.changed, /must-checks were reached/);
  assert.equal(settleDecision({ value: "major issue", why: "" }, { checks: all }).value, "major issue", "something serious stays");
  // Pending and no-source count as not checked.
  assert.deepEqual(K.topicsShort([K.unsourced({ ...plan("bio.sac"), sources: [{ region: "X", pending: "not in yet" }] })]), ["biodiversity"]);
  // A run from before checks keeps the old rule.
  assert.equal(settleDecision({ value: "progress", why: "" }, { checked: [] }).value, "insufficient evidence");
  assert.equal(settleDecision({ value: "progress", why: "" }, { checked: [{ evidence: "biodiversity", result: "none in dataset" }] }).value, "progress");
});

await test("a re-run says which checks changed", () => {
  const a = [K.fromFeatures(plan("bio.sac"), [], cat.scales.regional, {}), K.notChecked(plan("bio.spa"), "down")];
  const b = [K.fromFeatures(plan("bio.sac"), [{ name: "X SAC", distance_km: 3 }], cat.scales.regional, {}), K.notChecked(plan("bio.spa"), "down"), K.fromValue(plan("topo.elevation"), { text: "about 5 m" })];
  assert.deepEqual(K.checksChanged(a, b), [
    "Special Areas of Conservation: none found within 10 km → 1 within 10 km (1 at 2–5 km); nearest X SAC, 3 km",
    "Elevation: new check, about 5 m",
  ]);
  assert.deepEqual(K.checksChanged(b, a).at(-1), "Elevation: not run this time (was about 5 m)");
});

await test("partial sources (council registers, EPA brownfields): silence is never a clear none; the caveat travels", () => {
  const p = plan("ground.council-records");
  const derby = p.check.sources.find((x) => x.region === "Derby");
  const meta = { dataset: "Potentially Contaminated Sites, Derby", publisher: "Derby City Council", licence: "not stated", checked_at: "2026-11-24", fetched_km: 0.5 };
  const none = K.fromSources(p, [{ source: derby, features: [], meta }], cat.scales.regional);
  assert.equal(none.state, "none");
  assert.equal(none.only_partial, true);
  assert.match(K.checkLine(none), /^none found within 500 m in the records read \(Derby City Council's potentially contaminated sites\); the records are partial, so this isn't a clear answer$/);
  const found = K.fromSources(p, [{ source: derby, features: [{ name: "Old gasworks", distance_km: 0.2, extra: {} }], meta }], cat.scales.regional);
  assert.equal(found.state, "found");
  // A complete source beside a partial one: none is a plain none, noting the partial records.
  const us = plan("ground.us-cleanup");
  const [tsd, brown] = us.check.sources;
  const m2 = (d) => ({ dataset: d, publisher: "EPA", licence: "Public domain", checked_at: "2026-11-24", fetched_km: 1 });
  const mixed = K.fromSources(us, [{ source: tsd, features: [], meta: m2("TSD") }, { source: brown, features: [], meta: m2("Brownfields") }], cat.scales.regional);
  assert.ok(!mixed.only_partial);
  assert.match(K.checkLine(mixed), /^none found within 1 km \(partial records: EPA-funded brownfields only\)$/);
  // Every contamination check carries the caveat; landfill and permitted sites are never must-checks.
  for (const id of ["ground.landfill", "ground.mining-waste", "ground.council-records", "air.permitted-sites", "water.pollution-incidents", "ground.us-superfund"]) {
    const c = cat.checks.find((x) => x.id === id);
    assert.match(c.caveat, /^An early screen of open records, not a contaminated land report/);
    assert.equal(c.must, false);
  }
});

await test("England's border strip: Stanlow, Chester and Hereford read England's layers, not only Wales's (Rob's Stanlow log, 24 Nov)", () => {
  for (const [name, lon, lat] of [["Stanlow", -2.84, 53.27], ["Chester", -2.89, 53.19], ["Hereford", -2.72, 52.06], ["Oswestry", -3.05, 52.86]]) {
    const plan = P({ bbox: box(lon, lat, 0.01), countries: ["United Kingdom"], offshore: false, sea: false }, "local");
    for (const id of ["ground.landfill", "water.source-protection", "ground.mining-waste"]) {
      const p = plan.find((x) => x.check.id === id);
      assert.ok(p?.sources.some((s) => s.region === "England" && s.atlas_id), `${name}: ${id} asks England's layer (${p?.sources.map((s) => s.region).join(", ")})`);
    }
  }
  // Deep in Wales, England's layers aren't asked.
  const plan = P({ bbox: box(-3.8, 52.4, 0.01), countries: ["United Kingdom"], offshore: false, sea: false }, "local");
  assert.ok(!plan.find((x) => x.check.id === "ground.landfill").sources.some((s) => s.region === "England"));
});

await test("real nation and council outlines (26 Nov): Stanlow and Barnston get England's layers alone; councils and England-only checks by outline", () => {
  const regionsOf = (plan, id) => (plan.find((x) => x.check.id === id)?.sources || []).map((s) => s.region);
  // Stanlow (8.5 km from Wales) and Barnston (7.9 km across the Dee): at site scale no Welsh layer is asked, so Wales's
  // pending sources can't turn a clean English answer into "partly checked", as the boxes did.
  for (const [name, lon, lat] of [["Stanlow", -2.84, 53.27], ["Barnston", -3.08, 53.345]]) {
    const site = withAreas({ bbox: box(lon, lat, 0.004), countries: ["United Kingdom"], offshore: false, sea: false });
    assert.equal(site.areas.England, 0, name);
    assert.ok(site.areas.Wales > 7 && site.areas.Wales < 10, `${name}: ${site.areas.Wales} km from Wales`);
    const local = P(site, "local");
    for (const id of ["ground.landfill", "water.source-protection", "ground.mining-waste", "bio.sac"]) {
      const r = regionsOf(local, id);
      assert.ok(r.includes("England") && !r.includes("Wales"), `${name} ${id}: ${r.join(", ")}`);
    }
    // At regional scale the 10 km reach really does cross into Wales, so Wales's SACs are asked too.
    assert.ok(regionsOf(P(site, "regional"), "bio.sac").includes("Wales"), name);
  }
  // England's SSSI Impact Risk Zones: England only, on the outline.
  const irz = (lon, lat) => P({ bbox: box(lon, lat, 0.004), countries: ["United Kingdom"], offshore: false, sea: false }, "local").some((x) => x.check.id === "bio.sssi-irz");
  assert.ok(irz(-2.84, 53.27) && !irz(-3.6, 55.97) && !irz(-3.8, 52.4), "Stanlow yes; Linlithgow and mid-Wales no");
  // Councils' own records: inside Derby, Derby's; 5 km outside, the check doesn't apply.
  assert.deepEqual(regionsOf(P({ bbox: box(-1.476, 52.922, 0.003), countries: ["United Kingdom"], offshore: false, sea: false }, "local"), "ground.council-records"), ["Derby"]);
  assert.ok(!P({ bbox: box(-1.476, 52.86, 0.003), countries: ["United Kingdom"], offshore: false, sea: false }, "local").some((x) => x.check.id === "ground.council-records"));
  // An island the simplified outlines dropped (under 0.5 km²) gets its nearest nation.
  const rock = areasNear({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Scotland", kind: "nation" }, geometry: turf.bboxPolygon(box(-3, 56, 0.1)).geometry }] },
    turf.bboxPolygon(box(-3, 56.13, 0.002)), 2, { onLand: true });
  assert.equal(rock.Scotland, 0);
  // Outlines that couldn't load: every nation's layers are asked (more, never fewer).
  assert.deepEqual(regionsOf(P({ bbox: box(-3.6, 55.97, 0.004), countries: ["United Kingdom"], offshore: false, sea: false, areas: null }, "local"), "bio.sac"), ["England", "Scotland", "Wales", "Northern Ireland"]);
  // At sea in Liverpool Bay, Wales's and England's inshore layers answer through their data's own extent.
  const bay = P({ bbox: box(-3.6, 53.6, 0.01), countries: [], offshore: true, sea: true }, "local");
  assert.ok(["England", "Wales"].every((n) => regionsOf(bay, "bio.sac").includes(n)), regionsOf(bay, "bio.sac").join());
  // No box is left for a UK nation or council in the catalogue.
  for (const c of cat.checks) for (const s of c.sources) if (s.in) assert.ok(!s.where_any && !s.where, `${c.id}: ${s.region} is matched on outlines`);
  assert.ok(!cat.regions);
});

await test("sea checks on a land site apply only with the sea within their own reach (26 Nov: subsea pipelines at Stanlow and Linlithgow)", () => {
  const site = (coast) => ({ bbox: box(-3.6, 55.97, 0.004), countries: ["United Kingdom"], offshore: false, sea: true, coast_km: coast });
  const has = (plan, id) => plan.some((x) => x.check.id === id);
  // 5 km inland, regional: subsea pipelines and cables (2 km) can't reach; marine protected areas (10 km) and wind farms can.
  const inland = P(site(5), "regional");
  assert.ok(!has(inland, "material.subsea-pipelines") && !has(inland, "material.cables"));
  assert.ok(has(inland, "bio.marine-protected") && has(inland, "material.offshore-wind-farms"));
  // On the shore, all of them; 1 km of slack for the coastline's accuracy.
  const shore = P(site(2.8), "regional");
  assert.ok(has(shore, "material.subsea-pipelines") && has(shore, "material.cables"));
  assert.ok(!has(P(site(3.2), "regional"), "material.subsea-pipelines"));
  // At sea, always.
  assert.ok(has(P({ ...site(30), offshore: true, countries: [] }, "regional"), "material.subsea-pipelines"));
});

console.log(`${passed} checks tests passed`);
