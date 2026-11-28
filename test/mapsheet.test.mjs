// The map engine (js/mapsheet.js) and the basemap warp (js/basemapwarp.js), plan step 2b. No DOM: the sheet's plan
// and SVG from a run, and the warp's control grid against the exact projection.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as R from "../js/reference.js";
import { presentationCrs, projectorFor } from "../js/presentation.js";
import * as S from "../js/mapsheet.js";
import * as W from "../js/basemapwarp.js";
import { fakeEpsg } from "./fake-epsg.mjs";
import * as turf from "../js/vendor/turf.js";

let passed = 0;
const test = async (name, fn) => { await fn(); passed++; console.log(`ok ${name}`); };
const ROOT = new URL("..", import.meta.url).pathname;
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const grids = json("catalogue/grids.json");
const ref = R.createReference(async (n) => json(`data/ref/${n}.json`));
const epsg = fakeEpsg();

// A site near Culham (Oxfordshire): about 20 ha. Its presentation CRS is British National Grid, by EPSG:1314.
const sq = (w, s, e, n, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const pt = (lon, lat, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });
const site = sq(-1.235, 51.652, -1.229, 51.655, { role: "site" });
const pcGB = await presentationCrs({ feature: site, ref, grids, epsg });
const PGB = await projectorFor(pcGB, { grids, epsg });
// The same place in UTM 30N (a conversion: no registry needed).
const pcUTM = { code: 32630, name: "WGS 84 / UTM zone 30N", base: { code: 4326 }, operation: { kind: "conversion" } };
const PUTM = await projectorFor(pcUTM, { grids });

const record = (features, run = {}) => ({ type: "FeatureCollection", features: [site, ...features], tobler_run: {
  id: "run-test", skill: { name: "ntr-screening", version: "0.9" }, finished_at: "2026-11-28T12:00:00Z",
  site: { name: "Culham", asset_label: "battery storage", area_km2: 0.2 }, presentation_crs: pcGB,
  reach: { furthest_km: 10, ladder: [0.1, 0.25, 0.5, 1, 2, 5, 10] }, flags: [], checked: [], ...run } });
const ev = (geom, props) => ({ type: "Feature", properties: { role: "evidence", ...props }, geometry: geom });
const heritage = ev({ type: "Point", coordinates: [-1.2, 51.66] }, { name: "Listed barn", theme: "heritage", dataset: "Listed buildings", publisher: "Historic England", licence: "OGL v3.0", checked_at: "2026-11-28T11:00:00Z", distance_km: 2.3 });
const wood = ev(sq(-1.26, 51.645, -1.25, 51.65).geometry, { name: "Ancient wood", theme: "biodiversity", dataset: "Ancient woodland", publisher: "Natural England", licence: "", distance_km: 1.2 });
const far = ev({ type: "Point", coordinates: [-1.1, 51.66] }, { name: "Far monument", theme: "heritage", dataset: "Scheduled monuments", publisher: "Historic England", licence: "OGL v3.0", distance_km: 9.3 });

await test("the presentation CRS here is British National Grid by EPSG:1314 (the fake registry's records)", () => {
  assert.equal(pcGB.code, 27700);
  assert.equal(pcGB.operation.epsg, "EPSG:1314");
});

await test("scale: the next standard scale up from the extent; ticks at least 30 mm apart; round scale bars", () => {
  const F = S.frameBox();
  assert.equal(F.w, 420 - 18 - 8 - 95);
  assert.equal(S.scaleFor(5000, 3000, F), 25000); // 5 km across needs 1:16,722; next up 1:25,000
  assert.equal(S.scaleFor(700, 300, F), 2500);
  assert.equal(S.scaleFor(70000, 50000, F), 250000);
  assert.equal(S.scaleFor(110000, 100000, F), 500000); // beyond the skill's list: every finding stays on its map
  assert.equal(S.tickInterval(25000), 1000);
  assert.equal(S.tickInterval(2500), 100);
  assert.equal(S.tickInterval(10000), 500);
  assert.equal(S.tickInterval(250000), 10000);
  assert.equal(S.scaleBarLength(25000), 1000);
  assert.equal(S.scaleBarLength(10000), 500);
  assert.equal(S.groupMetres(622000), "622 000");
  assert.equal(S.groupMetres(1234567.4), "1 234 567");
  assert.equal(S.scaleText(25000), "1:25,000 at A3");
});

await test("an around-the-site sheet: frame in the grid, standard scale, ticks in full metres on the interval, every finding inside", () => {
  const rec = record([heritage, wood, far]);
  const plan = S.planSheet(S.sheetInputs(rec, { kind: "around", printed: "2026-11-28T13:00:00Z" }), PGB);
  assert.ok(S.STANDARD_SCALES.includes(plan.scale));
  assert.equal(plan.scale, 100000); // 9.3 km round a site: about 19 km across, 1:100,000 on a 299 mm frame
  // The frame's ground matches the scale exactly.
  assert.ok(Math.abs((plan.ground.e1 - plan.ground.e0) - plan.frame.w * plan.scale / 1000) < 1e-6);
  for (const t of plan.ticks.e) assert.equal(t.v % plan.ticks.interval, 0);
  for (let i = 1; i < plan.ticks.e.length; i++) assert.ok(plan.ticks.e[i].x - plan.ticks.e[i - 1].x >= 30 - 1e-9);
  // Eastings near Culham in BNG are about 452 000; northings about 196 000.
  assert.ok(plan.ground.e0 > 430000 && plan.ground.e1 < 475000, JSON.stringify(plan.ground));
  assert.ok(plan.ground.n0 > 175000 && plan.ground.n1 < 220000);
  assert.ok(plan.layers.every((l) => l.draws), "every finding draws on map 2");
  assert.equal(plan.title, "Culham battery storage: around the site");
});

await test("the site's position on the sheet is the projector's: the site centre maps to the frame where BNG says", () => {
  const plan = S.planSheet(S.sheetInputs(record([heritage])), PGB);
  const [e, n] = PGB.forward([-1.2, 51.66]);
  const [x, y] = plan.layers[0].mm.points[0];
  assert.ok(Math.abs(x - (plan.frame.x + (e - plan.ground.e0) * 1000 / plan.scale)) < 1e-9);
  assert.ok(Math.abs(y - (plan.frame.y + (plan.ground.n1 - n) * 1000 / plan.scale)) < 1e-9);
});

await test("legend: only what draws in the frame, site first, then bands, then layers by source; sources likewise", () => {
  const rec = record([heritage, wood, far]);
  const topic = S.planSheet(S.sheetInputs(rec, { kind: "topic", topic: "biodiversity" }), PGB);
  assert.deepEqual(topic.legend.map((e) => e.kind), ["site", "band", "area"]);
  assert.equal(topic.legend[2].label, "Ancient woodland");
  assert.deepEqual(topic.sources.map((s) => s.dataset), ["Ancient woodland"]);
  assert.equal(topic.title, "Culham battery storage: biodiversity");
  // A site sheet (map 1): the heritage point 2.3 km away isn't in it, so isn't in the legend.
  const one = S.planSheet(S.sheetInputs(rec, { kind: "site" }), PGB);
  assert.ok(one.scale <= 10000, `site map at 1:${one.scale}`);
  assert.deepEqual(one.legend.map((e) => e.kind), ["site"]);
  // A layer whose box overlaps the frame but whose shape doesn't: an L-shaped line round the frame's corner.
  const F = one.frame, g = one.ground, s = one.scale;
  const ll = (x, y) => PGB.inverse([g.e0 + (x - F.x) * s / 1000, g.n1 - (y - F.y) * s / 1000]);
  const ell = ev({ type: "LineString", coordinates: [ll(F.x - 10, F.y + F.h / 2), ll(F.x - 10, F.y - 10), ll(F.x + F.w / 2, F.y - 10)] }, { theme: "water", dataset: "Rivers", distance_km: 0.5 });
  const two = S.planSheet(S.sheetInputs(record([ell]), { kind: "site" }), PGB);
  assert.ok(!two.layers[0].draws, "an L round the corner doesn't draw, though its box covers the corner");
});

await test("licence not stated stays not stated on the sheet; the disclaimer is the skill's exact words", () => {
  const plan = S.planSheet(S.sheetInputs(record([heritage, wood])), PGB);
  const svg = S.sheetSvg(plan, { basemap: null });
  assert.match(svg, /Ancient woodland, Natural England; licence not stated/);
  assert.match(svg, /Listed buildings, Historic England; OGL v3\.0; queried 2026-11-28/);
  assert.ok(svg.includes(S.SHEET_DISCLAIMER.slice(0, 40)));
  assert.match(svg, /Basemap not drawn/);
  assert.match(svg, /British National Grid|OSGB36/);
  assert.match(svg, /EPSG:27700/);
  assert.match(svg, /1:\d{1,3}(,\d{3})* at A3/);
  assert.match(svg, /mE<\/text>/);
  assert.match(svg, /mN<\/text>/);
  assert.doesNotMatch(svg, /map \d of \d/i);
  assert.match(svg, /asktobler\.com/);
});

await test("north arrow: top left when quiet; moves on when the site or a feature fills it", () => {
  const plan = S.planSheet(S.sheetInputs(record([heritage])), PGB);
  assert.equal(plan.arrow.corner, "top left");
  assert.ok(plan.arrow.quiet);
  // A big polygon over the top-left corner of the frame.
  const F = plan.frame, g = plan.ground, s = plan.scale;
  const ll = (x, y) => PGB.inverse([g.e0 + (x - F.x) * s / 1000, g.n1 - (y - F.y) * s / 1000]);
  const blob = ev({ type: "Polygon", coordinates: [[ll(F.x - 5, F.y - 5), ll(F.x + 40, F.y - 5), ll(F.x + 40, F.y + 40), ll(F.x - 5, F.y + 40), ll(F.x - 5, F.y - 5)]] }, { theme: "water", dataset: "Flood zone", distance_km: 2 });
  const busy = S.planSheet({ ...S.sheetInputs(record([heritage, blob])), extent_km: 2.3 }, PGB);
  assert.notEqual(busy.arrow.corner, "top left");
  assert.equal(busy.arrow.corner, "top right");
});

await test("a site across nothing: the plan needs a site", () => {
  assert.throws(() => S.planSheet({ site: null }, PGB), /site's outline/);
});

// ---- the warp ------------------------------------------------------------------------------------------------------

const frame = S.frameBox();
const px = W.pixelsFor(frame);
await test("print size: 200 dpi over the A3 frame is about 2,350 by 2,180 px", () => {
  assert.equal(px.widthPx, Math.round(frame.w / 25.4 * 200));
  assert.ok(px.widthPx > 2300 && px.widthPx < 2400 && px.heightPx > 2100 && px.heightPx < 2250, JSON.stringify(px));
});

for (const [name, P, scale] of [["British National Grid", PGB, 25000], ["British National Grid", PGB, 250000], ["UTM 30N", PUTM, 10000], ["UTM 30N", PUTM, 100000]]) {
  await test(`warp, ${name} at 1:${scale.toLocaleString("en-GB")}: the 64 px control grid is within 0.05 px of the exact projection`, () => {
    const [ce, cn] = P.forward([-1.232, 51.6535]);
    const hw = frame.w * scale / 2000, hh = frame.h * scale / 2000;
    const ground = { e0: ce - hw, e1: ce + hw, n0: cn - hh, n1: cn + hh };
    const plan = W.warpPlan({ ground, ...px, inverse: P.inverse });
    let worst = 0;
    for (let k = 0; k < 4000; k++) {
      const x = ((k * 7919) % px.widthPx) + 0.37, y = ((k * 104729) % px.heightPx) + 0.61;
      const a = W.gridSource(plan, x, y), b = W.exactSource(plan, ground, P.inverse, x, y);
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1]));
    }
    assert.ok(worst < 0.05, `worst ${worst.toFixed(4)} px`);
    // Every node lands on the canvas MapLibre is asked to draw.
    for (let k = 0; k < plan.sx.length; k++) {
      assert.ok(plan.sx[k] >= 0 && plan.sx[k] <= plan.cssW * plan.pixelRatio && plan.sy[k] >= 0 && plan.sy[k] <= plan.cssH * plan.pixelRatio);
    }
    // A device pixel of the source is about a pixel of the output (within the grid's scale factor and Mercator's).
    const mercPerDevPx = (2 * Math.PI * 6378137 * Math.cos(51.6535 * Math.PI / 180)) / (512 * 2 ** plan.zoom * plan.pixelRatio);
    assert.ok(Math.abs(mercPerDevPx / plan.mPerPx - 1) < 0.01);
  });
}

await test("warp: the canvas the grid needs stays inside phone GPU limits at 1:250,000 (4,096 device px)", () => {
  const [ce, cn] = PGB.forward([-1.232, 51.6535]);
  const hw = frame.w * 250000 / 2000, hh = frame.h * 250000 / 2000;
  const plan = W.warpPlan({ ground: { e0: ce - hw, e1: ce + hw, n0: cn - hh, n1: cn + hh }, ...px, inverse: PGB.inverse });
  assert.ok(plan.cssW * plan.pixelRatio <= 4096 && plan.cssH * plan.pixelRatio <= 4096, `${plan.cssW} × ${plan.cssH} css`);
});

await test("warpPixels: a synthetic Mercator picture of known dots comes out where the projector puts them", () => {
  // Small: a 1:25,000 frame drawn at 40 dpi, so the test runs quickly.
  const P = PGB, small = W.pixelsFor(frame, 40);
  const [ce, cn] = P.forward([-1.232, 51.6535]);
  const hw = frame.w * 25000 / 2000, hh = frame.h * 25000 / 2000;
  const ground = { e0: ce - hw, e1: ce + hw, n0: cn - hh, n1: cn + hh };
  const plan = W.warpPlan({ ground, ...small, inverse: P.inverse });
  const sw = Math.round(plan.cssW * plan.pixelRatio), sh = Math.round(plan.cssH * plan.pixelRatio);
  // Paint dots (radius 2 px) on a Mercator canvas at known places.
  const dots = [[-1.26, 51.67], [-1.205, 51.635], [-1.232, 51.6535], [-1.25, 51.64]];
  const data = new Uint8ClampedArray(sw * sh * 4).fill(255);
  for (const d of dots) {
    const [wx, wy] = W.worldPx(d, plan.zoom);
    const cx = (wx - plan.origin[0]) * plan.pixelRatio, cy = (wy - plan.origin[1]) * plan.pixelRatio;
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++) for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= 2.2) { const o = (y * sw + x) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
    }
  }
  const out = W.warpPixels({ width: sw, height: sh, data }, plan);
  for (const d of dots) {
    const [e, n] = P.forward(d);
    const ex = (e - ground.e0) / plan.mPerPx, ey = (ground.n1 - n) / plan.mPerPx;
    // The dark blob's centroid near the expected place.
    let sx = 0, sy = 0, wsum = 0;
    for (let y = Math.max(0, Math.floor(ey - 6)); y < Math.min(small.heightPx, ey + 6); y++) for (let x = Math.max(0, Math.floor(ex - 6)); x < Math.min(small.widthPx, ex + 6); x++) {
      const v = 255 - out[(y * small.widthPx + x) * 4]; sx += (x + 0.5) * v; sy += (y + 0.5) * v; wsum += v;
    }
    assert.ok(wsum > 0, `dot at ${d} not found`);
    assert.ok(Math.hypot(sx / wsum - ex, sy / wsum - ey) < 0.35, `dot at ${d}: off by ${Math.hypot(sx / wsum - ex, sy / wsum - ey).toFixed(3)} px`);
  }
});

console.log(`${passed} map sheet tests passed`);
