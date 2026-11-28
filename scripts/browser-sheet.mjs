// Headless browser check of a map sheet (sheet.html, plan step 2b), desktop and phone. The basemap is synthetic:
// vector tiles built here (geojson-vt and vt-pbf, dev only) holding dots at known places, served in place of
// OpenFreeMap, drawn by the page's own MapLibre (WebGL through SwiftShader) and warped into British National Grid
// through the run's projector. Each dot must come out within a pixel of where the projector puts it. The EPSG
// registry is the tests' fake (real OSGB36 records). It proves the page and the warp's positions; how the real positron
// basemap looks is for Rob's browser.
// Run: node --import ./scripts/route-local.mjs scripts/browser-sheet.mjs [chrome path]
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";
import geojsonvt from "geojson-vt";
import vtpbf from "vt-pbf";
import * as R from "../js/reference.js";
import { presentationCrs, projectorFor } from "../js/presentation.js";
import { encodeRun } from "../js/share.js";
import { fakeEpsg } from "../test/fake-epsg.mjs";

const CHROME = process.argv[2] || "/usr/bin/google-chrome";
const ROOT = new URL("..", import.meta.url).pathname;
const OUT = "/tmp/tobler-sheet"; mkdirSync(OUT, { recursive: true });
const json = (p) => JSON.parse(readFileSync(ROOT + p, "utf8"));
const grids = json("catalogue/grids.json");
const ref = R.createReference(async (n) => json(`data/ref/${n}.json`));
const epsg = fakeEpsg();
const results = [];
const check = (ok, what) => results.push(`${ok ? "PASS" : "FAIL"} ${what}`);

// A run at Culham, in British National Grid by EPSG:1314.
const sq = (w, s, e, n, props = {}) => ({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const site = sq(-1.235, 51.652, -1.229, 51.655, { role: "site" });
const pc = await presentationCrs({ feature: site, ref, grids, epsg });
const P = await projectorFor(pc, { grids, epsg });
const evid = (geometry, p) => ({ type: "Feature", properties: { role: "evidence", ...p }, geometry });
const record = { type: "FeatureCollection", features: [site,
  evid({ type: "Point", coordinates: [-1.2, 51.66] }, { fid: "a", name: "Listed barn", theme: "heritage", dataset: "Listed buildings", publisher: "Historic England", licence: "OGL v3.0", checked_at: "2026-11-28T11:00:00Z", distance_km: 2.3 }),
  evid(sq(-1.26, 51.645, -1.25, 51.65).geometry, { fid: "b", name: "Ancient wood", theme: "biodiversity", dataset: "Ancient woodland", publisher: "Natural England", distance_km: 1.2 })],
  tobler_run: { id: "run-browser", skill: { name: "ntr-screening", version: "0.9" }, finished_at: "2026-11-28T12:00:00Z",
    site: { name: "Culham", asset_label: "battery storage", area_km2: 0.2 }, presentation_crs: pc,
    reach: { furthest_km: 5, ladder: [0.1, 0.25, 0.5, 1, 2, 5] }, flags: [], checked: [] } };
const code = await encodeRun(record);

// Synthetic basemap: a dot every 0.02° round the site.
const dots = [];
for (let lon = -1.40; lon <= -1.06; lon += 0.02) for (let lat = 51.56; lat <= 51.75; lat += 0.02) dots.push([+lon.toFixed(4), +lat.toFixed(4)]);
const index = new geojsonvt({ type: "FeatureCollection", features: dots.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) }, { maxZoom: 18, indexMaxZoom: 6, buffer: 64 });
const STYLE = { version: 8, sources: { dots: { type: "vector", tiles: ["https://tiles.openfreemap.org/synthetic/{z}/{x}/{y}.pbf"], minzoom: 0, maxzoom: 18 } },
  layers: [{ id: "bg", type: "background", paint: { "background-color": "#ffffff" } },
    { id: "dots", type: "circle", source: "dots", "source-layer": "dots", paint: { "circle-radius": 2.5, "circle-color": "#000000", "circle-blur": 0 } }] };

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
for (const [label, viewport, touch] of [["desktop", { width: 1400, height: 900 }, false], ["phone", { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 3 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let tiles = 0;
  await page.route(/^https:\/\//, async (route) => {
    const u = new URL(route.request().url());
    if (u.href === "https://tiles.openfreemap.org/styles/positron") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STYLE) });
    let m;
    if ((m = u.pathname.match(/^\/synthetic\/(\d+)\/(\d+)\/(\d+)\.pbf$/))) {
      tiles++;
      const t = index.getTile(+m[1], +m[2], +m[3]);
      return route.fulfill({ status: 200, contentType: "application/x-protobuf", body: Buffer.from(vtpbf.fromGeojsonVt({ dots: t || { features: [] } }, { version: 2 })) });
    }
    if (u.href.endsWith("/epsg")) {
      try { return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(await epsg(JSON.parse(route.request().postData()))) }); }
      catch (e) { return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ message: e.message }) }); }
    }
    return route.abort();
  });
  // A link cut short (as pasted at about 4,096 characters) says so plainly.
  await page.goto(`http://localhost:8000/sheet.html?kind=around#${code.slice(0, Math.floor(code.length * 0.6))}`);
  await page.waitForFunction(() => window.__sheet?.ready, null, { timeout: 30000 });
  const cut = await page.evaluate(() => document.getElementById("status").textContent);
  check(/looks cut short or changed/.test(cut), `${label}: a cut-short link says so ("${cut.slice(0, 70)}")`);
  // From the report: its Map sheet button opens this run's sheet, around the site.
  await page.goto(`http://localhost:8000/report.html?u=metric#${code}`);
  await page.waitForSelector("#sheet:not([hidden])", { timeout: 30000 });
  await page.click("#sheet");
  await page.waitForURL(/sheet\.html\?u=metric&kind=around#v1\./, { timeout: 30000 });
  check(true, `${label}: the report's Map sheet button opens the sheet for the same run`);
  await page.waitForFunction(() => window.__sheet?.ready, null, { timeout: 90000 });
  const st = await page.evaluate(() => ({ error: window.__sheet.error || null, warp: window.__sheet.warp, status: document.getElementById("status").textContent,
    ground: window.__sheet.plan?.ground, scale: window.__sheet.plan?.scale, svg: !!document.querySelector("#sheet svg image"),
    text: document.querySelector("#sheet svg")?.textContent || "" }));
  check(!st.error && !st.warp?.error && st.svg, `${label}: the sheet drew with a warped basemap (${st.error || st.warp?.error || st.status}); ${tiles} synthetic tiles`);
  check(/EPSG:27700/.test(st.text) && /1:\d[\d,]* at A3/.test(st.text) && /mE/.test(st.text), `${label}: the sheet names EPSG:27700, its scale and the tick units`);
  check(/Basemap: © OpenFreeMap/.test(st.text), `${label}: the basemap's attribution is under Sources`);

  if (st.ground && st.warp?.widthPx) {
    // Where each dot should be in the warped picture, from the projector (node side).
    const m = (st.ground.e1 - st.ground.e0) / st.warp.widthPx;
    const want = dots.map((d) => { const [e, n] = P.forward(d); return [(e - st.ground.e0) / m, (st.ground.n1 - n) / m]; })
      .filter(([x, y]) => x > 20 && y > 20 && x < st.warp.widthPx - 20 && y < st.warp.heightPx - 20);
    const found = await page.evaluate(async (want) => {
      const img = document.querySelector("#sheet svg image");
      const im = new Image(); im.src = img.getAttribute("href"); await im.decode();
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height;
      const x2 = c.getContext("2d"); x2.drawImage(im, 0, 0);
      const d = x2.getImageData(0, 0, c.width, c.height).data;
      return want.map(([ex, ey]) => {
        let sx = 0, sy = 0, w = 0;
        for (let y = Math.floor(ey - 9); y < ey + 9; y++) for (let x = Math.floor(ex - 9); x < ex + 9; x++) {
          const v = 255 - d[(y * c.width + x) * 4]; if (v > 20) { sx += (x + 0.5) * v; sy += (y + 0.5) * v; w += v; }
        }
        return w ? Math.hypot(sx / w - ex, sy / w - ey) : null;
      });
    }, want);
    const ok = found.filter((v) => v != null), worst = Math.max(...ok), mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    check(ok.length === want.length && worst < 1, `${label}: ${ok.length} of ${want.length} synthetic dots found, each within a pixel of the projector's place (worst ${worst.toFixed(2)} px, mean ${mean.toFixed(2)} px at 200 dpi, ${(worst * 25.4 / 200).toFixed(2)} mm)`);
  }
  check(errors.length === 0, `${label}: no page errors${errors.length ? ` (${errors.join("; ")})` : ""}`);
  await page.screenshot({ path: `${OUT}/sheet-${label}.png`, fullPage: false });
  if (label === "desktop") {
    await page.pdf({ path: `${OUT}/sheet.pdf`, format: "A3", landscape: true, printBackground: true }).catch(() => {});
  }
  await ctx.close();
}
await browser.close();
console.log(results.join("\n"));
console.log(`Screenshots in ${OUT}`);
process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
