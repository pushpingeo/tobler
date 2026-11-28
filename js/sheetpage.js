// The map sheet page (sheet.html, plan step 2b): reads a run from the link's # part (js/share.js), works out one A3
// sheet with the map engine (js/mapsheet.js) in the run's presentation CRS, draws the basemap in that grid
// (js/basemapwarp.js) and shows the sheet as an SVG. ?kind=site | around | topic, &topic=<id> for a topic sheet.
// Not linked from the app yet: the map series (step 2c) adds the button.
import * as turf from "./vendor/turf.js";
import { decodeRun } from "./share.js";
import { projectorFor } from "./presentation.js";
import { epsgViaWorker } from "./atlasclient.js";
import { planSheet, sheetInputs, sheetSvg, frameBox, SHEET_KINDS } from "./mapsheet.js";
import { drawBasemap } from "./basemapwarp.js";
import { topicOf, topicInfo } from "./findings.js";

const $ = (id) => document.getElementById(id);
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const ATTRIBUTION = "© OpenFreeMap, OpenMapTiles, OpenStreetMap contributors (ODbL).";
const ASSETS = (() => { try { return JSON.parse($("asset-versions")?.textContent || "{}"); } catch { return {}; } })();
const asset = (p) => fetch(ASSETS[p] || p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
const status = (t, error = false) => { const s = $("status"); s.textContent = t; s.className = error ? "error" : ""; };
window.__sheet = { ready: false };

const q = new URLSearchParams(location.search);
const kind = SHEET_KINDS.includes(q.get("kind")) ? q.get("kind") : "around";
const topic = q.get("topic");

$("print").addEventListener("click", () => window.print());

try {
  if (!location.hash) throw new Error("This page draws a map sheet from a run link. Open a run card in Tobler and choose Report, then change report.html to sheet.html in the address.");
  const record = await decodeRun(location.hash.slice(1));
  const pc = record.tobler_run.presentation_crs;
  if (!pc?.code) throw new Error("This run has no presentation coordinate system (it was made before 28 Nov). Run the screen again to get one.");
  fillPicker(record);
  status("Working out the sheet…");
  const grids = await asset("catalogue/grids.json");
  const projector = await projectorFor(pc, { grids, epsg: epsgViaWorker });
  const site = record.features.find((f) => f.properties.role === "site");
  const countries = await asset("data/ref/countries.json").catch(() => null);
  const centre = site ? turf.centroid(site) : null;
  const locator = countries && centre ? countries.features.find((c) => { try { return turf.booleanPointInPolygon(centre, c); } catch { return false; } }) || null : null;
  const plan = planSheet(sheetInputs(record, { kind, topic, locator }), projector);
  window.__sheet.plan = plan;
  // A plain sheet first, so something is there while the basemap draws.
  $("sheet").innerHTML = sheetSvg(plan, { basemap: null });
  status("Drawing the basemap in the run's grid…");
  const bm = await drawBasemap({ maplibregl: window.maplibregl, style: BASEMAP, ground: plan.ground, frame: frameBox(plan.paper), inverse: projector.inverse });
  window.__sheet.warp = bm.error ? { error: bm.error } : { zoom: bm.plan.zoom, cssW: bm.plan.cssW, cssH: bm.plan.cssH, widthPx: bm.plan.widthPx, heightPx: bm.plan.heightPx };
  $("sheet").innerHTML = sheetSvg(plan, { basemap: bm.error ? { missing: bm.error } : { href: bm.href, attribution: ATTRIBUTION } });
  status(bm.error ? `The basemap couldn't be drawn (${bm.error}); the sheet is shown without it.` : "Ready. Save as PDF prints it on A3 landscape.", !!bm.error);
  $("print").disabled = false;
} catch (e) {
  status(e.message || String(e), true);
  window.__sheet.error = e.message || String(e);
} finally {
  window.__sheet.ready = true;
}

function fillPicker(record) {
  const sel = $("kind");
  const topics = [...new Set(record.features.filter((f) => f.properties.role === "evidence").map((f) => topicOf(f.properties.theme)))];
  const opts = [["site", "On the site"], ["around", "Around the site"], ...topics.map((t) => [`topic:${t}`, topicInfo(t).label])];
  sel.innerHTML = "";
  for (const [v, label] of opts) sel.append(new Option(label, v, false, v === (kind === "topic" ? `topic:${topicOf(topic)}` : kind)));
  sel.hidden = false;
  sel.addEventListener("change", () => {
    const [k, t] = sel.value.split(":");
    const u = new URL(location.href);
    u.searchParams.set("kind", k);
    if (t) u.searchParams.set("topic", t); else u.searchParams.delete("topic");
    location.href = u.href;
  });
}
