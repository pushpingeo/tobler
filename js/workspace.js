// The workspace page: map, drawing and editing tools, and the conversation with the analyst.
// Places are the record; cards are views of them. The analyst sees a compact project summary each turn.
import { TerraDraw, TerraDrawMapLibreGLAdapter, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode,
  TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from "./vendor/draw.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { placeToolDefs, createPlaceTools, projectSummary } from "./placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn, activityFor } from "./converse.js";
import { callClaude, LimitReached } from "./claude.js";
import { atlasViaWorker, firmsViaWorker, epsgViaWorker } from "./atlasclient.js";
import { CONFIG } from "./config.js";
import { THEMES, THEME_SHORT, themeFor, bandOf, BAND_OPACITY, BIG_AREA_KM2, chooseLabels, ringDistances } from "./findings.js";
import { createScreening, evidenceOf, evidenceWithin, nearestByTheme, flagBeyond, reassess, isArea, THEME_CODE } from "./ntrrun.js";
import { groupGaps, gapSummary, GAP_GROUPS } from "./gaps.js";
import * as U from "./units.js";
import { pickExamples } from "./examples.js";
import { chooseIndustry, industryNote } from "./industry.js";
import { getUserKey, setUserKey } from "./claude.js";
import { distancesLine, bandFor } from "./distances.js";
import { DISCLAIMER, DISCLAIMER_SHORT } from "./disclaimer.js";
import { seaShort, seaMatters } from "./seavalues.js";
import { placeRole, whereText, searchHeadline, SEARCH_BAND } from "./siterole.js";
import { elevationShort } from "./elevation.js";
import { createLogSharer } from "./sharelog.js";
import { feedbackRow } from "./feedback.js";
import { settlementNear } from "./gazetteer.js";
import { coordinateNote } from "./coords.js";
import { picksFor, pickMessage } from "./assetpicks.js";
import { shareCode } from "./share.js";
import { siteChange, rerunInput, outOfDateText, runLines } from "./outofdate.js";
import { readFiles, placesFromFile, LIST_MAX } from "./fileimport.js";
import { setupFileDrop } from "./filedrop.js";

const $ = (id) => document.getElementById(id);
// Version-stamped URLs for fetched files (written into the page by scripts/stamp.mjs).
const ASSETS = (() => { try { return JSON.parse($("asset-versions")?.textContent || "{}"); } catch { return {}; } })();
const asset = (path) => ASSETS[path] || path;
const C = { ink: "#15303c", pole: "#d1352a", white: "#ffffff", sea: "#2b6a80" };

// ---- settings (the gear): saved in this browser; the key for this tab only (js/claude.js) --------------------
const store = {
  get(k, d = null) { try { return localStorage.getItem(`tobler.${k}`) ?? d; } catch { return d; } },
  set(k, v) { try { v == null ? localStorage.removeItem(`tobler.${k}`) : localStorage.setItem(`tobler.${k}`, v); } catch { /* storage blocked */ } },
};
U.setUnits(store.get("units", "metric"));
const savedColour = store.get("shapeColour");
if (/^#[0-9a-f]{6}$/i.test(savedColour || "")) C.pole = savedColour;
applyColourCss();
function applyColourCss() {
  document.documentElement.style.setProperty("--pole", C.pole);
  // A pale wash of the same colour for the selected card's ring.
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(C.pole.slice(i, i + 2), 16));
  document.documentElement.style.setProperty("--pole-wash", `rgb(${[r, g, b].map((v) => Math.round(v + (255 - v) * 0.88)).join(",")})`);
}
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";

// ---- reference data -------------------------------------------------------------
const ref = R.createReference(async (name) => {
  activity(`Loading ${name === "places" ? "towns and cities" : name}…`, true);
  const r = await fetch(asset(`data/ref/${name}.json`));
  if (!r.ok) throw new Error(`Couldn't load the ${name} layer (${r.status}).`);
  return r.json();
});

// ---- map ---------------------------------------------------------------------------
const map = new maplibregl.Map({
  container: "map", style: BASEMAP, center: [8, 30], zoom: 1.6, attributionControl: false,
  boxZoom: false, // Shift-drag rotates a selected shape instead
});
// On a phone the sheet covers the bottom of the map, so the attribution moves to the top.
const phone = innerWidth <= 720;
map.addControl(new maplibregl.AttributionControl({ compact: true }), phone ? "top-right" : "bottom-right");
// MapLibre stacks bottom-corner controls upwards, so the scale bar goes in first to sit below the zoom buttons.
const scaleCtl = new maplibregl.ScaleControl({ unit: U.UNIT_SETS[U.getUnits()].scale });
map.addControl(scaleCtl, "bottom-right");
if (!phone) map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

// If the basemap can't be reached, fall back to the reference countries on a plain background so the tools still work.
// Start on "style.load", not "load": a hidden tab doesn't render, so "load" may never come (lesson from demo 1).
let started = false, fellBack = false;
// A hidden tab may not finish loading the style at all, so the wait only counts while the page is visible.
let fallbackTimer = setTimeout(fallbackIfVisible, 15000);
function fallbackIfVisible() {
  if (document.hidden) fallbackTimer = setTimeout(fallbackIfVisible, 15000);
  else useFallbackBasemap();
}
map.on("error", (e) => { if (!started && /style|fetch|Failed|NetworkError/i.test(String(e?.error?.message || ""))) useFallbackBasemap(); });
map.once("style.load", start);

async function useFallbackBasemap() {
  if (started || fellBack || map.isStyleLoaded()) return;
  fellBack = true;
  map.off("style.load", start);
  const countries = await ref.get("countries").catch(() => null);
  map.setStyle({
    version: 8, sources: countries ? { ne: { type: "geojson", data: countries, attribution: "Natural Earth" } } : {},
    layers: [{ id: "bg", type: "background", paint: { "background-color": "#dce7ea" } },
      ...(countries ? [{ id: "land", type: "fill", source: "ne", paint: { "fill-color": "#f6f7f5" } },
        { id: "borders", type: "line", source: "ne", paint: { "line-color": "#b9c6c9", "line-width": 0.6 } }] : [])],
  });
  map.once("style.load", start);
  note("The background map couldn't be loaded, so a plain outline map is shown. Drawing still works.");
  activity("");
}

const viewBounds = () => map.getBounds().toArray().flat();

// ---- places ---------------------------------------------------------------------------
// A place: { id (Terra Draw id), name, kind, feature, status: drawn | proposed | accepted, origin, edits, scale, scaleFrom, card }
let draw;
const places = new Map();
const counts = { Point: 0, Line: 0, Area: 0 };
let selectedId = null;
let focusName = null;

const kindOf = (geom) => (geom.type === "Point" ? "Point" : /LineString/.test(geom.type) ? "Line" : "Area");
// A place answers to its name and to the "Area 1" it was counted as, so either works in tool calls.
const placeByName = (name) => {
  const n = String(name).trim().toLowerCase();
  return [...places.values()].find((p) => p.name.toLowerCase() === n)
    || [...places.values()].find((p) => p.alias?.toLowerCase() === n || p.given?.toLowerCase() === n || p.former?.some((f) => f.toLowerCase() === n));
};
// Names stay unique: a second "Jackdaw 3 km²" becomes "Jackdaw 3 km² (2)".
function uniqueName(name, self = null) {
  let out = name, k = 2;
  while ([...places.values()].some((p) => p !== self && p.name.toLowerCase() === out.toLowerCase())) out = `${name} (${k++})`;
  return out;
}

// Renaming keeps the old names as aliases, so the analyst and earlier messages still find the place.
function renameTo(p, to, by) {
  const clean = String(to || "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean || clean === p.name) return false;
  const was = p.name;
  p.former = [...new Set([...(p.former || []), was])];
  p.name = uniqueName(clean, p);
  if (focusName === was) focusName = p.name;
  p.card.querySelector("h2 .name").textContent = p.name;
  logEdit(p, `renamed from ${was} to ${p.name}${by ? ` (${by})` : ""}`);
  scheduleRefresh();
  return true;
}

// A drawn shape is named after the settlement it's in or near ("Point near Linlithgow"), once that's known; until
// then, and at sea or when nothing is named nearby, it stays "Point 1". Never overrides a name someone gave.
async function nameFromSettlement(p) {
  try {
    const at = p.kind === "Point" ? p.feature.geometry.coordinates : turf.centroid(p.feature).geometry.coordinates;
    const town = await settlementNear(at, { headers: host.headers });
    if (town && places.has(p.id) && p.name === p.alias) renameTo(p, `${p.kind} near ${town}`);
  } catch { /* no name to give: keep the counted one */ }
}
const featureOf = (id) => { const f = draw.getSnapshotFeature(id); return f && { type: "Feature", properties: {}, geometry: f.geometry }; };

// Multi-part outlines (a field or protected area published in pieces, e.g. Bonga Main, 18 Nov): the drawing tool
// edits single shapes only, so it holds the largest part and the place keeps the rest beside it. The place, the map,
// the card and every analysis use the whole outline.
function splitParts(geometry) {
  const single = { MultiPolygon: "Polygon", MultiLineString: "LineString" }[geometry.type];
  if (!single) return { main: geometry, extra: [] };
  const parts = geometry.coordinates.map((c) => ({ type: single, coordinates: c }));
  const size = (g) => (single === "Polygon" ? turf.area(g) : turf.length(turf.feature(g)));
  parts.sort((a, b) => size(b) - size(a));
  return { main: parts[0], extra: parts.slice(1) };
}
const withExtras = (p, geometry) => (p?.extraParts?.length && geometry.type === p.extraParts[0].type
  ? { type: `Multi${geometry.type}`, coordinates: [geometry.coordinates, ...p.extraParts.map((g) => g.coordinates)] } : geometry);

// Scale is worked out (the analyst asks only when it's genuinely unclear): from the request if it says, else the shape's size; a point has no size,
// so a drawn point takes its scale from the zoom level when it was dropped. The person can change it on the card.
function newPlace(id, feature, { status = "drawn", origin = { method: "drawn", at: new Date().toISOString() }, scale = null, extraParts = [], name = null, given = null } = {}) {
  const kind = kindOf(feature.geometry);
  const alias = `${kind} ${++counts[kind]}`;
  const p = { id, kind, name: name ? uniqueName(name) : alias, alias, feature, status, origin, edits: [], scaleFrom: "size", extraParts, ...(given && given !== name ? { given } : {}) };
  if (scale && R.SCALES[scale]) { p.scale = scale; p.scaleFrom = "request"; }
  else if (kind === "Point" && origin.method === "drawn") { p.scale = R.scaleForKm(R.viewKm(viewBounds())); p.scaleFrom = "zoom"; }
  places.set(id, p);
  paintChips();
  p.card = makeCard(p);
  focusName = p.name;
  refreshCard(p);
  scheduleRefresh();
  return p;
}

function start() {
  if (started) return;
  started = true;
  clearTimeout(fallbackTimer);

  // Your places, drawn as ranging-pole bands. Terra Draw's own layers sit above these, for handles.
  map.addSource("aoi", { type: "geojson", data: turf.featureCollection([]) });
  const proposed = ["==", ["get", "status"], "proposed"];
  // A search area (a stand-in for an outline nobody found) is drawn lighter: a thin dashed line, no ranging pole.
  const search = ["==", ["get", "role"], "search_area"];
  const solid = ["all", ["!=", ["geometry-type"], "Point"], ["!", search]];
  map.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], paint: { "fill-color": C.pole, "fill-opacity": ["case", search, 0.03, proposed, 0.04, 0.07] } });
  map.addLayer({ id: "aoi-halo", type: "line", source: "aoi", filter: solid, paint: { "line-color": C.ink, "line-width": 6.5, "line-opacity": ["case", proposed, 0.45, 0.85] } });
  map.addLayer({ id: "aoi-white", type: "line", source: "aoi", filter: solid, paint: { "line-color": C.white, "line-width": 4.5 } });
  map.addLayer({ id: "aoi-red", type: "line", source: "aoi", filter: solid, paint: { "line-color": C.pole, "line-width": 4.5, "line-dasharray": [1.6, 1.6], "line-opacity": ["case", proposed, 0.6, 1] } });
  map.addLayer({ id: "aoi-search-halo", type: "line", source: "aoi", filter: ["all", ["!=", ["geometry-type"], "Point"], search], paint: { "line-color": C.white, "line-width": 4, "line-opacity": 0.85 } });
  map.addLayer({ id: "aoi-search", type: "line", source: "aoi", filter: ["all", ["!=", ["geometry-type"], "Point"], search], paint: { "line-color": C.pole, "line-width": 2.2, "line-dasharray": [2.5, 2], "line-opacity": ["case", proposed, 0.7, 1] } });
  // Candidates the analyst found: small, quiet markers so you can see what it was choosing between.
  map.addSource("cands", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "cands-line", type: "line", source: "cands", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.sea, "line-width": 1.2, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "cands-pt", type: "circle", source: "cands", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": C.white, "circle-stroke-color": C.sea, "circle-stroke-width": 2 } });
  // A dropped site file, before the person picks from it: every feature quiet, the picked ones in ranging-pole red.
  map.addSource("sitefile", { type: "geojson", data: turf.featureCollection([]) });
  const picked = ["==", ["get", "picked"], true];
  map.addLayer({ id: "sitefile-fill", type: "fill", source: "sitefile", filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], paint: { "fill-color": ["case", picked, C.pole, C.sea], "fill-opacity": ["case", picked, 0.18, 0.06] } });
  map.addLayer({ id: "sitefile-line", type: "line", source: "sitefile", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": ["case", picked, C.pole, C.sea], "line-width": ["case", picked, 3, 1.6] } });
  map.addLayer({ id: "sitefile-pt", type: "circle", source: "sitefile", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["case", picked, 7, 5], "circle-color": ["case", picked, C.pole, C.white], "circle-stroke-color": ["case", picked, C.white, C.sea], "circle-stroke-width": 2 } });
  for (const id of ["sitefile-fill", "sitefile-line", "sitefile-pt"]) {
    map.on("click", id, (e) => { const fid = e.features?.[0]?.properties?.fid; if (fid) toggleFileFeature(fid); });
    map.on("mouseenter", id, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", id, () => { map.getCanvas().style.cursor = ""; });
  }
  // Findings: features from data searches, drawn by screening theme (js/findings.js). They stay for the session,
  // until the person clears them; a later search never wipes them (Rosebank, 17 Nov). Big areas sit underneath,
  // quiet; distance from the site sets the emphasis.
  const themeColour = ["match", ["get", "theme"], ...Object.entries(THEMES).flatMap(([k, t]) => [k, t.colour]), THEMES.context.colour];
  const emphasis = ["match", ["get", "band"], "near", BAND_OPACITY.near, "close", BAND_OPACITY.close, BAND_OPACITY.wider];
  const big = [">", ["coalesce", ["get", "area_km2"], 0], BIG_AREA_KM2];
  map.addSource("rings", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "rings-line", type: "line", source: "rings", paint: { "line-color": C.ink, "line-width": 1, "line-opacity": 0.35, "line-dasharray": [3, 3] } });
  map.addSource("findings", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "find-fill", type: "fill", source: "findings", filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]],
    layout: { "fill-sort-key": ["-", 0, ["coalesce", ["get", "area_km2"], 0]] },
    // Operating context (blocks, licences, infrastructure) is background: outlines with a whisper of fill.
    paint: { "fill-color": themeColour, "fill-opacity": ["case", big, 0.03, ["==", ["get", "theme"], "context"], ["*", 0.05, emphasis], ["*", 0.14, emphasis]] } });
  map.addLayer({ id: "find-line", type: "line", source: "findings", filter: ["!=", ["geometry-type"], "Point"],
    paint: { "line-color": themeColour, "line-width": ["case", big, 1, 2], "line-opacity": emphasis } });
  map.addLayer({ id: "find-pt", type: "circle", source: "findings", filter: ["==", ["geometry-type"], "Point"],
    paint: { "circle-radius": ["match", ["get", "band"], "near", 6, 5], "circle-color": themeColour, "circle-opacity": emphasis, "circle-stroke-color": C.white, "circle-stroke-width": 1.5 } });
  // Inside the area only (a run card's switch): everything outside the site is dimmed.
  map.addSource("mask", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "mask-fill", type: "fill", source: "mask", paint: { "fill-color": C.ink, "fill-opacity": 0.22 } });
  // The evidence behind one flag, picked out on the map when the flag is opened on the run card.
  map.addSource("hl", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "hl-line", type: "line", source: "hl", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": C.ink, "line-width": 5, "line-opacity": 0.55 } }, "find-line");
  map.addLayer({ id: "hl-pt", type: "circle", source: "hl", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": C.ink, "circle-stroke-width": 2.5 } });
  // Tap a point or an outline to see what it is (not a big area's inside: that would get in the way of the site).
  for (const id of ["find-pt", "find-line"]) map.on("click", id, (e) => findingPopup(e));
  if (map.getStyle().glyphs) {
    const text = { "text-size": 12, "text-font": ["Noto Sans Bold"], "text-offset": [0, 1.3], "text-anchor": "top", "text-optional": true };
    map.addLayer({ id: "find-label", type: "symbol", source: "findings", filter: ["==", ["get", "label_on"], true], layout: { ...text, "text-field": ["get", "label"], "text-size": 11 }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });
    map.addLayer({ id: "rings-label", type: "symbol", source: "rings", layout: { "symbol-placement": "line", "text-field": ["get", "label"], "text-size": 10, "text-font": ["Noto Sans Bold"] }, paint: { "text-color": C.ink, "text-opacity": 0.6, "text-halo-color": C.white, "text-halo-width": 1.4 } });
    map.addLayer({ id: "sitefile-label", type: "symbol", source: "sitefile", layout: { ...text, "text-field": ["get", "label"], "text-size": 11.5 }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });
    map.addLayer({ id: "cands-label", type: "symbol", source: "cands", layout: { ...text, "text-field": ["get", "label"], "text-size": 11 }, paint: { "text-color": C.sea, "text-halo-color": C.white, "text-halo-width": 1.4 } });
    map.addLayer({ id: "aoi-label", type: "symbol", source: "aoi", layout: { ...text, "text-field": ["get", "label"] }, paint: { "text-color": C.ink, "text-halo-color": C.white, "text-halo-width": 1.6 } });
  }

  const st = drawStyles();
  draw = new TerraDraw({
    adapter: new TerraDrawMapLibreGLAdapter({ map }),
    modes: [
      new TerraDrawSelectMode({
        flags: Object.fromEntries(["point", "linestring", "polygon", "rectangle", "circle"].map((m) => [m, {
          feature: {
            draggable: true, rotateable: m !== "point", scaleable: m !== "point",
            coordinates: m === "point" ? undefined : m === "polygon" || m === "linestring"
              ? { midpoints: true, draggable: true, deletable: true }
              : { draggable: true, resizable: "center" },
          },
        }])),
        keyEvents: { deselect: "Escape", delete: "Delete", rotate: ["Shift"], scale: null },
        styles: st.select,
      }),
      new TerraDrawPointMode({ styles: st.point }),
      new TerraDrawLineStringMode({ styles: st.linestring }),
      new TerraDrawPolygonMode({ styles: st.polygon }),
      new TerraDrawRectangleMode({ styles: st.rectangle }),
      new TerraDrawCircleMode({ styles: st.circle }),
    ],
  });
  draw.start();
  draw.on("finish", onFinish);
  draw.on("change", (ids, type, ctx) => {
    if (pointerDown && type === "update" && ctx?.target === "geometry" && places.has(ids[0])) liveEdit = ids[0];
    scheduleRefresh();
    if (type === "delete") ids.forEach(onDeleted);
  });
  // A drag on the map: Terra Draw draws the shape as it moves. Our copy goes through MapLibre's worker and would trail
  // a frame or two behind as a "shadow", so it's left out until the pointer lifts, then redrawn where the shape landed.
  map.getCanvasContainer().addEventListener("pointerdown", () => { pointerDown = true; });
  const lift = () => { pointerDown = false; if (liveEdit) { liveEdit = null; scheduleRefresh(); } };
  window.addEventListener("pointerup", lift);
  window.addEventListener("pointercancel", lift);
  draw.on("select", onSelect);
  draw.on("deselect", () => onSelect(null));
  setMode("select");
  window.__ws = { map, draw, places, ref, host, runs }; // for testing in the browser console
}

// Terra Draw's styles, in the shape colour (rebuilt when the colour changes in settings).
function drawStyles() {
  const thin = { outlineWidth: 1, outlineColor: C.ink, fillOpacity: 0, fillColor: C.pole };
  const handle = { closingPointColor: C.white, closingPointOutlineColor: C.pole, closingPointOutlineWidth: 2, closingPointWidth: 6 };
  return {
    select: {
      selectedPolygonColor: C.pole, selectedPolygonFillOpacity: 0.12, selectedPolygonOutlineColor: C.ink, selectedPolygonOutlineWidth: 1.5,
      selectedLineStringColor: C.ink, selectedLineStringWidth: 1.5,
      selectedPointColor: C.pole, selectedPointOutlineColor: C.ink, selectedPointWidth: 9, selectedPointOutlineWidth: 2,
      selectionPointColor: C.white, selectionPointOutlineColor: C.ink, selectionPointWidth: 5, selectionPointOutlineWidth: 2,
      midPointColor: C.pole, midPointOutlineColor: C.white, midPointWidth: 4, midPointOutlineWidth: 1.5,
    },
    point: { pointColor: C.pole, pointOutlineColor: C.white, pointWidth: 8, pointOutlineWidth: 2.5 },
    linestring: { lineStringColor: C.ink, lineStringWidth: 1.5, closingPointColor: C.white, closingPointOutlineColor: C.pole, closingPointOutlineWidth: 2 },
    polygon: { ...thin, ...handle }, rectangle: thin, circle: thin,
  };
}
function setShapeColour(colour) {
  C.pole = colour;
  store.set("shapeColour", colour);
  applyColourCss();
  if (!started) return;
  for (const [layer, prop] of [["aoi-fill", "fill-color"], ["aoi-red", "line-color"], ["aoi-search", "line-color"]]) if (map.getLayer(layer)) map.setPaintProperty(layer, prop, colour);
  if (draw) for (const [mode, styles] of Object.entries(drawStyles())) { try { draw.updateModeOptions(mode, { styles }); } catch { /* mode not present */ } }
}

let refreshQueued = false;
let pointerDown = false, liveEdit = null; // the place being dragged on the map, if any
function scheduleRefresh() {
  if (refreshQueued || !draw) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    const feats = draw.getSnapshot().filter((f) => f.id !== liveEdit && (places.has(f.id) || !isGuide(f))).map((f) => {
      const p = places.get(f.id);
      const role = p ? placeRole(p.origin || {}, p.feature?.geometry || f.geometry).role : "";
      return { type: "Feature", geometry: withExtras(p, f.geometry), properties: { label: p ? `${p.name}${role === "search_area" ? " · search area" : ""}${p.status === "proposed" ? " (proposed)" : ""}` : "", status: p?.status || "", role } };
    });
    map.getSource("aoi")?.setData(turf.featureCollection(feats));
  });
}
const isGuide = (f) => ["selectionPoint", "midPoint", "closingPoint", "snappingPoint", "coordinatePoint"].some((k) => f.properties?.[k]);

function showCandidates(list) {
  const feats = list.map((c) => ({ type: "Feature", geometry: c.geometry, properties: { label: c.name || c.type || "" } }));
  map.getSource("cands")?.setData(turf.featureCollection(feats));
}

// Findings stay until cleared, one entry per feature id, drawn by theme; the analyst can bring them into view with
// show_on_map. The legend (#key) lists the themes with counts and lets the person switch each off.
const findings = new Map();
const hiddenThemes = new Set();
let ringsAround = null;
// A run's evidence is fetched out to its widest band once; the run card's slider sets how far is shown.
let findingLimit = Infinity;
function drawFindings() {
  const feats = [...findings.values()].filter((f) => !hiddenThemes.has(f.properties.theme) && !(f.properties.run && f.properties.distance_km > findingLimit + 1e-9));
  chooseLabels(feats);
  map.getSource("findings")?.setData(turf.featureCollection(feats));
  drawKey();
}
function addFindings(list, meta = {}) {
  const theme = meta.theme || themeFor({});
  for (const c of list) {
    findings.set(c.id, { type: "Feature", geometry: c.geometry, properties: {
      id: c.id, label: c.name || c.type || "", theme, band: bandOf(c.distance_km), distance_km: c.distance_km ?? null,
      area_km2: c.area_km2 ?? null, dataset: meta.dataset || "", publisher: meta.publisher || c.source?.publisher || "",
    } });
  }
  if (meta.place) drawRings(meta.place);
  drawFindings();
}
let ringsArgs = null; // to redraw the rings when the units change
async function drawRings(place, kms = null) {
  ringsArgs = [place, kms];
  const key = JSON.stringify(place.geometry).slice(0, 200) + (kms || []).join(",") + U.getUnits();
  if (ringsAround === key) return;
  ringsAround = key;
  let offshore = false;
  if (!kms) { try { offshore = !!(await R.describe(ref, place)).offshore; } catch { /* reference not loaded */ } }
  const rings = (kms || ringDistances(offshore)).map((km) => {
    const b = turf.buffer(place, km, { units: "kilometers", steps: 32 });
    const line = turf.polygonToLine(b);
    const f = line.type === "FeatureCollection" ? line.features[0] : line;
    f.properties = { label: U.dist(km) };
    return f;
  });
  map.getSource("rings")?.setData(turf.featureCollection(rings));
}
function clearFindings() {
  findings.clear(); hiddenThemes.clear(); ringsAround = null; findingLimit = Infinity;
  shownRun = null; paintMask();
  map.getSource("hl")?.setData(turf.featureCollection([]));
  map.getSource("rings")?.setData(turf.featureCollection([]));
  drawFindings();
}
function showFindings(ids) {
  const feats = ids?.length ? ids.map((id) => findings.get(String(id).toUpperCase())).filter(Boolean) : [...findings.values()];
  if (!feats.length) return { shown: 0 };
  feats.forEach((f) => hiddenThemes.delete(f.properties.theme));
  drawFindings();
  const focus = places.get(selectedId) || [...places.values()].at(-1);
  const all = turf.featureCollection([...feats, ...(focus ? [focus.feature] : [])]);
  map.fitBounds(turf.bbox(all), { padding: fitPadding(), maxZoom: 14 });
  return { shown: feats.length, on_map: findings.size };
}
// The map key: one row per theme on the map, with a count and a switch; doubles as the list of what's shown.
function drawKey() {
  const key = $("key");
  if (!key) return;
  const counts = new Map();
  for (const f of findings.values()) counts.set(f.properties.theme, (counts.get(f.properties.theme) || 0) + 1);
  key.hidden = !counts.size;
  if (!counts.size) return;
  const list = key.querySelector("ul");
  list.replaceChildren(...Object.entries(THEMES).filter(([k]) => counts.has(k)).map(([k, t]) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = !hiddenThemes.has(k);
    box.addEventListener("change", () => { box.checked ? hiddenThemes.delete(k) : hiddenThemes.add(k); drawFindings(); });
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = t.colour;
    label.append(box, sw, document.createTextNode(` ${t.label} `), Object.assign(document.createElement("span"), { className: "count", textContent: counts.get(k) }));
    li.append(label);
    return li;
  }));
}

$("key-clear")?.addEventListener("click", () => clearFindings());
if (phone) $("key")?.removeAttribute("open");

// Tap a finding: its name, theme, distance and source.
function findingPopup(e) {
  if (draw && draw.getMode() !== "select") return;
  const f = e.features?.[0];
  if (!f) return;
  const p = f.properties;
  const box = document.createElement("div");
  box.className = "finding-pop";
  const name = document.createElement("b"); name.textContent = p.label || "Unnamed feature";
  const what = document.createElement("span");
  const km = p.surrounds ? "around the site (a wide area it lies within) · " : p.in_search_area ? `${whereText(p)} · ` : p.distance_km == null || p.distance_km === "null" ? "" : +p.distance_km === 0 ? "on site · " : `${U.dist(+p.distance_km)} from the site · `;
  what.textContent = `${THEMES[p.theme]?.label || ""} · ${km}${p.dataset}${p.publisher ? ` (${p.publisher})` : ""}`;
  box.append(name, what);
  new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(e.lngLat).setDOMContent(box).addTo(map);
}

// ---- modes and hints ---------------------------------------------------------------
const HINTS = {
  select: "",
  point: "Click the map to drop a point.",
  linestring: "Click to add points. Click the last point again to finish.",
  polygon: "Click to add corners. Click the first corner to close the area.",
  rectangle: "Click one corner, then the opposite corner.",
  circle: "Click the centre, then click again to set the size.",
};
const SELECTED_HINT = matchMedia("(pointer: coarse)").matches
  ? "Drag the shape on the map to move it. Drag a corner to reshape, or a midpoint to add one. Rotate and resize with the buttons below."
  : "Drag the shape on the map to move it. Drag a corner to reshape, or a midpoint to add one. Shift-drag to rotate, or use the buttons below.";

function setMode(mode) {
  draw.setMode(mode);
  document.querySelectorAll(".tools [data-mode]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
  if (mode !== "select") openTray(true);
  showHint();
}
// The hint over the map shows only while drawing, with Cancel. Moving and reshaping are explained on the card,
// after Adjust (Rob, 18 Nov: the banner was too prominent).
function showHint() {
  const mode = draw?.getMode() || "select";
  const text = mode === "select" ? "" : HINTS[mode];
  const h = $("hint");
  h.querySelector(".hint-text").textContent = text;
  h.querySelector('[data-hint="cancel"]').hidden = mode === "select";
  h.hidden = !text;
}
$("hint").querySelector('[data-hint="cancel"]').addEventListener("click", () => draw && setMode("select"));

// Adjust: a shape gets its drag handles (and the card its rotate and resize controls) only when the person asks,
// so a stray drag can't move it. Clicking a shape on the map just brings its card forward.
let adjustingId = null;
function startAdjust(p) {
  if (!places.has(p.id) || !draw) return;
  if (adjustingId && adjustingId !== p.id) endAdjust();
  adjustingId = p.id;
  if (draw.getMode() !== "select") setMode("select");
  p.card.querySelector(".adjust").hidden = false;
  p.card.querySelector('[data-op="adjust"]').setAttribute("aria-expanded", "true");
  p.card.querySelector('[data-op="adjust"]').classList.add("on");
  draw.selectFeature(p.id);
}
function endAdjust() {
  const p = adjustingId && places.get(adjustingId);
  adjustingId = null;
  if (p) {
    p.card.querySelector(".adjust").hidden = true;
    p.card.querySelector('[data-op="adjust"]').setAttribute("aria-expanded", "false");
    p.card.querySelector('[data-op="adjust"]').classList.remove("on");
  }
  if (selectedId && draw) { try { draw.deselectFeature(selectedId); } catch { /* already deselected */ } }
}
// The place being talked about: its card lights up and the Screen chip names it.
function focusPlace(p) {
  focusName = p.name;
  places.forEach((q) => q.card.classList.toggle("active", q === p));
  p.card.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// The drawing tools sit in a tray above the input, opened by the Draw button beside it.
function openTray(open) {
  $("tools").hidden = !open;
  $("drawbtn").setAttribute("aria-expanded", String(open));
  $("drawbtn").classList.toggle("on", open);
}
$("drawbtn").addEventListener("click", () => {
  const open = $("tools").hidden;
  openTray(open);
  if (!open && draw && draw.getMode() !== "select") setMode("select");
});
document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => draw && setMode(b.dataset.mode)));
document.querySelector('.tools [data-action="delete"]').addEventListener("click", () => { if (selectedId) removePlace(selectedId); });
document.querySelector('.tools [data-action="done"]').addEventListener("click", () => { if (draw) setMode("select"); openTray(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && draw && draw.getMode() !== "select") setMode("select"); });

// ---- drawing events ----------------------------------------------------------------------
function onFinish(id, ctx) {
  const feature = featureOf(id);
  if (!feature) return;
  if (ctx?.action === "draw" && !places.has(id)) {
    const p = newPlace(id, feature);
    setMode("select");
    focusPlace(p);
    nameFromSettlement(p);
    return;
  }
  const p = places.get(id);
  if (!p) return;
  feature.geometry = withExtras(p, feature.geometry);
  const change = G.describeChange(p.feature, feature);
  p.feature = feature;
  if (change) logEdit(p, `${change} (on the map)`);
  refreshCard(p);
  checkRuns();
}

function onSelect(id) {
  const p = id && places.get(id);
  // A click on a shape that isn't being adjusted: focus its card, leave the shape alone.
  if (p && id !== adjustingId) {
    if (adjustingId) endAdjust();
    selectedId = null;
    setTimeout(() => { try { draw.deselectFeature(id); } catch { /* gone */ } }, 0);
    focusPlace(p);
    return;
  }
  selectedId = p ? id : null;
  if (p) focusPlace(p);
  // Deselected (Escape, or a click on the empty map) while adjusting: adjusting ends.
  if (!selectedId && adjustingId) endAdjust();
  document.querySelector('.tools [data-action="delete"]').disabled = !selectedId;
}

function onDeleted(id, by = null) {
  const p = places.get(id);
  if (!p) return;
  if (adjustingId === id) { adjustingId = null; p.card.querySelector(".adjust").hidden = true; }
  p.card.classList.add("gone");
  p.card.classList.remove("active");
  p.card.querySelector(".summary").textContent = by ? `Removed by the analyst${by.reason ? `: ${by.reason}` : ""}.` : "Deleted.";
  places.delete(id);
  paintChips();
  if (by) logEdit(p, `removed by the analyst: ${by.reason || "no reason given"}`);
  remember(by ? "assistant" : "user", by ? `(I removed ${p.name}: ${by.reason || ""})` : `(I deleted ${p.name}.)`);
  if (selectedId === id) onSelect(null);
  checkRuns();
}
function removePlace(id, by = null) { onDeleted(id, by); draw.removeFeatures([id]); scheduleRefresh(); }

// Editing from the card or the analyst goes through the same deterministic functions.
function applyGeometry(p, raw, words) {
  const feature = G.roundCoords(raw);
  const { main, extra } = splitParts(feature.geometry);
  try { draw.updateFeatureGeometry(p.id, main); } catch (e) { activity(`That edit didn't work: ${e.message}`); return false; }
  p.extraParts = extra;
  p.feature = { type: "Feature", properties: {}, geometry: feature.geometry };
  logEdit(p, words);
  refreshCard(p);
  scheduleRefresh();
  checkRuns();
  return true;
}

function logEdit(p, words) {
  const li = document.createElement("li");
  li.textContent = words;
  p.card.querySelector(".history").append(li);
  p.edits.push({ at: new Date().toISOString(), change: words });
}

// ---- the host: what the analyst's tools can see and do -------------------------------------
const skills = {};
let anchors = [];
let trusted = { services: [], publishers: { patterns: [] } };
const host = {
  ref,
  get anchors() { return anchors; },
  fetchFn: (...a) => fetch(...a),
  atlas: atlasViaWorker,
  firms: firmsViaWorker,
  epsg: epsgViaWorker,
  // Settings (the gear): pick datum transformations for the person ("choose", default) or offer them ("ask").
  // Datum transformations are chosen for the person (Rob, 20 Nov late night: simple and largely hidden). The tools still
  // ask when the best option is worse than 25 m. The old "Ask me" setting is gone.
  transformationChoice: () => "choose",
  get trusted() { return trusted; },
  // Settings (the gear): whether the person holds an Esri licence, so Esri-licensed layers can be used.
  esriLicence: () => store.get("esriLicence") === "yes",
  // Non-commercial data (e.g. WDPA): off by default; on only for people whose use allows it (Rob, 18 Nov).
  nonCommercial: () => store.get("nonCommercial") === "yes",
  view: () => viewBounds(),
  headers: {},
  places: () => [...places.values()],
  findPlace: placeByName,
  skillText: (name) => skills[name]?.body || "",
  onCandidates: showCandidates,
  addFindings,
  showFindings,
  clearFindings,
  offerChoices: (o) => makeChoiceCard(o),
  // A file the person dropped, waiting for them to pick the site from it; forgotten once used.
  loadedFile: () => siteFile?.file || null,
  fileUsed: () => closeSiteFile("used"),
  addPlace({ feature, origin, scale, name, given, status = "proposed" }) {
    const id = crypto.randomUUID();
    const mode = feature.geometry.type === "Point" ? "point" : /LineString/.test(feature.geometry.type) ? "linestring" : "polygon";
    const { main, extra } = splitParts(feature.geometry);
    const bad = draw.addFeatures([{ id, type: "Feature", geometry: main, properties: { mode } }]).find((v) => !v.valid);
    if (bad) throw new Error(`The shape couldn't be drawn: ${bad.reason}`);
    const p = newPlace(id, feature, { status, origin, scale, extraParts: extra, name, given });
    if (extra.length) logEdit(p, `Published in ${extra.length + 1} parts; the map's edit handles move the largest part only.`);
    zoomTo(p);
    return p;
  },
  updatePlace(name, feature, words) {
    const p = placeByName(name);
    if (!p) return;
    applyGeometry(p, feature, words);
    // A changed proposal is asked about again, next to the reply that asks.
    if (p.status !== "drawn") {
      p.status = "proposed"; paintStatus(p); scheduleRefresh();
      if (pendingReply?.isConnected) $("conversation").insertBefore(p.card, pendingReply);
    }
  },
  removePlace(name, by) {
    const p = placeByName(name);
    if (p) removePlace(p.id, by || { by: "analyst" });
  },
  personSaid: () => said.join("\n"),
  lastPersonText: () => said.at(-1) || "",
  renamePlace(name, to) {
    const p = placeByName(name);
    if (p) renameTo(p, to);
  },
  askAssetType: (name, question) => askAssetType(name, question),
};
// Screening runs: sealed NTR runs with their own tools; the conversation gets the headline, the card the detail.
let distTable = null;
// The industry profile in use (Settings → Industry; catalogue/industries/). Only Environment and Energy is ready so far.
let industries = null, profile = null;
host.profile = () => profile;
const assetPicks = () => profile?.asset_picks || null;
const screenSkill = () => skills[profile?.skill || "ntr-screening"];
let runLog = null, runSteps = null; // the turn a run belongs to, for the log and "How I worked this out"
host.screening = createScreening({
  host, table: () => distTable, skill: screenSkill, callClaude, model: CONFIG.model,
  onRun: (record) => {
    const r = record.tobler_run;
    // The log keeps what the card shows, so a downloaded log explains the card on its own.
    runLog?.events.push({ screen_result: { run: r.id, distances: r.distances, baseline: r.baseline, sea: r.sea, flags: r.flags.map((f) => ({ risk: f.risk, theme: f.theme, confidence: f.confidence, nearest_km: f.nearest_km, evidence: f.evidence.map((e) => `${e.name} ${e.distance_km} km${e.traced ? "" : " (not traced)"}`) })),
      checked: r.checked.map((c) => `${c.dataset}: ${c.result}${c.count ? ` ${c.count}` : ""}${c.why ? ` (${c.why})` : ""}`), gaps: r.data_gaps, ...(r.parse_error ? { problem: r.parse_error } : {}),
      ...(r.debug ? { debug: r.debug } : {}), ...(r.note ? { note: r.note } : {}), usage: r.usage } });
    stopProgress(record);
    const site = placeByName(r.site?.name || "");
    if (site && r.site.asset_type) site.assetType = r.site.asset_type;
    showRun(record);
  },
  onEvent: (ev) => {
    progressEvent(ev);
    if (ev.type === "tool_start") activity(`Screening: ${activityFor(ev.name, ev.input)}…`, true);
    if (ev.type === "round") runLog?.events.push({ screen_model_round: ev.round, ms: ev.ms, tokens_in: ev.input_tokens, tokens_out: ev.output_tokens, tool_calls: ev.tools });
    if (ev.type === "tool") {
      runLog?.events.push({ screen_tool: ev.name, ...(ev.baseline ? { baseline: true } : {}), input: ev.input, ms: ev.ms, ...(ev.error ? { error: ev.error } : { output: ev.output }) });
      runSteps?.append(el("li", `Screen${ev.baseline ? " (baseline)" : ""}: ${ev.name === "nearest_boundaries" ? `Checked boundaries within ${ev.input.within_km} km: ${ev.output?.found?.length ? ev.output.found.join("; ") : "none in reach"}` : traceLine(ev)}`, ev.error ? "err" : ""));
    }
  },
});
const tools = createPlaceTools(host);
// The conversation doesn't load the NTR method itself: screen_site runs it as a sealed run.
const conversationSkills = () => Object.values(skills).filter((s) => s.name !== (profile?.skill || "ntr-screening"));

// Loads the industry index and the chosen (ready) profile, its screening skill if not already loaded, and puts its
// wording and examples on the page. Called at start and when Settings → Industry changes.
async function loadIndustry(stored) {
  industries = industries || await fetch(asset("catalogue/industries/index.json")).then((r) => r.json());
  const id = chooseIndustry(industries, stored);
  const entry = industries.industries.find((i) => i.id === id);
  if (!entry) throw new Error("no industry profile is ready");
  const next = await fetch(asset(entry.file)).then((r) => r.json());
  if (next.skill_file && !skills[next.skill]) { const sk = parseSkill(await fetch(asset(next.skill_file)).then((r) => r.text())); skills[sk.name] = sk; }
  profile = next;
  const chip = document.querySelector(".chip[data-screen]");
  if (chip && profile.wording?.screen_chip) chip.textContent = profile.wording.screen_chip;
  paintExamples();
  return profile;
}

Promise.all([
  ...["skills/place-finding/SKILL.md", "skills/ntr-screening/SKILL.md", "skills/coordinate-reference/SKILL.md"].map((f) => fetch(asset(f)).then((r) => r.text()).then((t) => { const s = parseSkill(t); skills[s.name] = s; })),
  fetch(asset("catalogue/anchors.json")).then((r) => r.json()).then((j) => { anchors = j.sources; }),
  fetch(asset("catalogue/trusted.json")).then((r) => r.json()).then((j) => { trusted = j; }),
  fetch(asset("catalogue/distances.json")).then((r) => r.json()).then((j) => { distTable = j; }),
  loadIndustry(store.get("industry")),
]).catch((e) => note(`Something the analyst needs didn't load: ${e.message}`));

// ---- cards ----------------------------------------------------------------------------
function makeCard(p) {
  const card = $("shape-card").content.firstElementChild.cloneNode(true);
  card.dataset.id = p.id;
  const sw = document.createElement("span");
  sw.className = `swatch ${p.kind === "Line" ? "line" : p.kind === "Point" ? "point" : ""}`;
  const nm = el("span", p.name, "name");
  nm.title = "Rename"; nm.tabIndex = 0; nm.setAttribute("role", "button");
  card.querySelector("h2").append(sw, nm);
  // Tap the name to rename it in place: Enter or leaving the box saves, Escape cancels.
  const startRename = () => {
    if (card.querySelector("h2 input.rename")) return;
    const box = Object.assign(document.createElement("input"), { className: "rename", value: p.name, maxLength: 60 });
    box.setAttribute("aria-label", "Name");
    nm.hidden = true; nm.after(box); box.focus(); box.select();
    let done = false;
    const finish = (save) => {
      if (done) return; done = true;
      if (save) renameTo(p, box.value, "by you");
      box.remove(); nm.hidden = false;
    };
    box.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); finish(true); } if (e.key === "Escape") { e.preventDefault(); finish(false); } });
    box.addEventListener("blur", () => finish(true));
  };
  nm.addEventListener("click", startRename);
  nm.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); startRename(); } });
  if (p.kind === "Point") card.querySelectorAll('[data-op="rotate"], .resize').forEach((e) => e.remove());
  else card.querySelector(".unit").textContent = p.kind === "Area" ? U.areaUnit() : U.distUnit();
  paintOrigin(p, card);
  paintStatus(p, card);

  card.querySelector('[data-op="zoom"]').addEventListener("click", () => zoomTo(p));
  card.querySelector(".adjust-help").textContent = p.kind === "Point" ? "Drag the point on the map to move it." : SELECTED_HINT;
  card.querySelector('[data-op="adjust"]').addEventListener("click", () => {
    if (adjustingId === p.id) endAdjust();
    else { startAdjust(p); zoomTo(p); }
  });
  card.querySelector('[data-op="adjust-done"]').addEventListener("click", () => endAdjust());
  // Delete from the card, without going to the map's tools (handy for shapes the analyst made).
  card.querySelector('[data-op="delete"]').addEventListener("click", () => { if (places.has(p.id)) removePlace(p.id); });
  card.querySelectorAll('[data-op="rotate"]').forEach((b) => b.addEventListener("click", () => {
    const deg = +b.dataset.deg;
    applyGeometry(p, G.rotate(p.feature, deg), `rotated ${Math.abs(deg)}° ${deg > 0 ? "clockwise" : "anticlockwise"}`);
  }));
  card.querySelector(".resize")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const shown = parseFloat(e.target.querySelector("input").value);
    if (!(shown > 0)) return;
    // The box is in the person's units; the geometry tools work in km and km².
    const v = p.kind === "Area" ? U.fromArea(shown) : U.fromDist(shown);
    const before = p.kind === "Area" ? turf.area(p.feature) / 1e6 : turf.length(p.feature);
    applyGeometry(p, G.resizeTo(p.feature, v), `resized from ${R.fmtNum(before)} to ${R.fmtNum(v)} ${p.kind === "Area" ? "km²" : "km"}`);
  });
  // The answer buttons count as a reply in the conversation.
  card.querySelector('[data-op="accept"]').addEventListener("click", () => {
    if (busy) return;
    p.status = "accepted"; paintStatus(p); scheduleRefresh();
    send(`Yes, use ${p.name}.`);
  });
  card.querySelector('[data-op="revise"]').addEventListener("click", () => {
    if (busy) return;
    p.status = "revising"; paintStatus(p);
    send(`${p.name} isn't quite right.`);
  });
  card.addEventListener("click", (e) => {
    if (e.target.closest("button, input, form, a, summary") || !places.has(p.id)) return;
    focusPlace(p);
  });
  // A place the analyst makes goes above its reply, so the reply reads as the caption.
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  card.scrollIntoView({ block: "end", behavior: "smooth" });
  expandSheet();
  return card;
}

// A carousel of candidates: flick through them on the map, each with its source; the pick is your reply.
// ---- site files (Rob, 23 Nov) ------------------------------------------------------------------------------
// A shapefile or GeoJSON dropped anywhere on the page (or picked from the drawing tray) is read in the browser,
// shown on the map, and the person picks the site from it. The picked features are copied into places; the file is
// then forgotten. One polygon is the site straight away. Points and lines need a width.
let siteFile = null; // { file, card, picked: Set of fids, width }
const kindWord = (k, n) => `${k}${n === 1 ? "" : "s"}`;
const fileSize = (f) => (f.size.area_ha != null ? U.area(f.size.area_ha / 100) : f.size.length_km != null ? U.dist(f.size.length_km) : f.size.points > 1 ? `${f.size.points} points` : "a point");

async function openSiteFile(files) {
  openTray(false);
  closeSiteFile("replaced");
  activity("Reading your file…", true);
  let file;
  try { file = await readFiles(files); }
  catch (e) { activity(""); note(`That file couldn't be read: ${e.message}`); expandSheet(); return; }
  activity("");
  const problems = [...file.skipped, ...file.notes];
  if (!file.features.length) {
    const m = el("div", null, "msg analyst");
    m.append(el("p", `Nothing in ${file.name} could be used as a site.`));
    if (problems.length) { const ul = el("ul"); problems.forEach((t) => ul.append(el("li", t))); m.append(ul); }
    $("conversation").append(m); expandSheet(); m.scrollIntoView({ block: "end", behavior: "smooth" });
    return;
  }
  showFileCard(file, problems);
}

function showFileCard(file, problems) {
  const card = $("file-card").content.firstElementChild.cloneNode(true);
  siteFile = { file, card, picked: new Set(), width: null };
  const counts = {};
  for (const f of file.features) counts[f.kind] = (counts[f.kind] || 0) + 1;
  const contents = Object.entries(counts).map(([k, n]) => `${n} ${kindWord(k, n)}`).join(", ");
  card.querySelector(".question").textContent = file.features.length === 1 ? `${file.name}: one ${file.features[0].kind}.`
    : `${file.name}: ${contents}. Which is the site? Tick them here or tap them on the map.`;
  const crs = [...new Set(file.layers.map((l) => l.crs.how))];
  const crsLine = card.querySelector(".crs");
  crsLine.textContent = `Coordinates: ${crs.join("; ")}.`;
  if (file.layers.some((l) => l.crs.guessed || l.crs.warning)) crsLine.classList.add("warn");
  const ul = card.querySelector(".feats");
  for (const f of file.features.slice(0, LIST_MAX)) {
    const box = Object.assign(document.createElement("input"), { type: "checkbox", value: f.fid });
    box.addEventListener("change", () => toggleFileFeature(f.fid, box.checked));
    const label = el("label");
    label.append(box, el("span", f.label), el("span", `${f.kind === "polygon" ? "" : `${f.kind}, `}${fileSize(f)}`, "size"));
    const li = el("li"); li.append(label); ul.append(li);
  }
  if (file.features.length > LIST_MAX) {
    const more = card.querySelector(".more");
    more.hidden = false;
    more.textContent = `${file.features.length - LIST_MAX} more aren't listed. Tell me which you want in words (by name or by a field's value).`;
  }
  card.querySelector(".notes").textContent = problems.join(" ");
  const widthIn = card.querySelector(".widths input");
  card.querySelectorAll("[data-w]").forEach((b) => b.addEventListener("click", () => { siteFile.width = +b.dataset.w; widthIn.value = ""; paintFileCard(); }));
  widthIn.addEventListener("input", () => { const v = parseFloat(widthIn.value); siteFile.width = v >= 0.5 && v <= 50000 ? v : null; paintFileCard(); });
  card.querySelector('[data-op="parts"]').addEventListener("click", () => usePicked("parts"));
  card.querySelector('[data-op="separate"]').addEventListener("click", () => usePicked("separate"));
  card.querySelector('[data-op="cancel"]').addEventListener("click", () => closeSiteFile("cancelled"));
  $("conversation").append(card);
  expandSheet();
  const fc = turf.featureCollection(file.features.map((f) => ({ type: "Feature", geometry: f.geometry, properties: {} })));
  map.fitBounds(turf.bbox(fc), { padding: fitPadding(), maxZoom: 16, duration: 0 });
  if (file.features.length === 1) siteFile.picked.add(file.features[0].fid);
  paintFileCard();
  card.scrollIntoView({ block: "end", behavior: "smooth" });
  // One outline is the site: nothing to choose.
  if (file.features.length === 1 && file.features[0].kind === "polygon") usePicked("parts");
}

function paintFileCard() {
  if (!siteFile) return;
  const { file, card, picked, width } = siteFile;
  card.querySelectorAll(".feats input").forEach((b) => { b.checked = picked.has(b.value); });
  const chosen = file.features.filter((f) => picked.has(f.fid));
  const thin = [...new Set(chosen.filter((f) => f.kind !== "polygon").map((f) => `${f.kind}s`))];
  card.querySelector(".width").hidden = !thin.length;
  card.querySelector(".width .what").textContent = thin.join(" and ");
  card.querySelectorAll("[data-w]").forEach((b) => b.classList.toggle("on", +b.dataset.w === width));
  const ready = chosen.length > 0 && (!thin.length || width > 0);
  const parts = card.querySelector('[data-op="parts"]'), sep = card.querySelector('[data-op="separate"]');
  parts.disabled = sep.disabled = !ready;
  parts.textContent = chosen.length > 1 ? "Use as one site in parts" : "Use as the site";
  sep.hidden = chosen.length < 2;
  map.getSource("sitefile")?.setData(turf.featureCollection(file.features.map((f) => ({ type: "Feature", geometry: f.geometry, properties: { fid: f.fid, label: f.label, picked: picked.has(f.fid) } }))));
}

function toggleFileFeature(fid, on) {
  if (!siteFile) return;
  const has = siteFile.picked.has(fid);
  if (on ?? !has) siteFile.picked.add(fid); else siteFile.picked.delete(fid);
  paintFileCard();
}

function usePicked(combine) {
  if (!siteFile) return;
  if (busy) { siteFile.card.querySelector(".notes").textContent = "The analyst is busy; try again in a moment."; return; }
  const { file, picked, width, card } = siteFile;
  let built;
  try { built = placesFromFile(file, { fids: [...picked], combine, buffer_m: width }); }
  catch (e) { card.querySelector(".notes").textContent = e.message; return; }
  const made = built.map((b) => host.addPlace({ ...b, status: "accepted" }));
  const sizes = made.map((p) => `${p.name} (${/Polygon/.test(p.feature.geometry.type) ? U.area(turf.area(p.feature) / 1e6) : "a point"})`);
  const result = card.querySelector(".result");
  result.hidden = false;
  result.textContent = `${made.length > 1 ? `${made.length} sites` : "Site"} set from ${file.name}: ${sizes.join(", ")}.${built.some((b) => b.origin.steps.some((t) => /simplified|filled/.test(t))) ? ` ${built.flatMap((b) => b.origin.steps.filter((t) => /simplified|filled/.test(t))).join("; ")}.` : ""} Ask me to screen ${made.length > 1 ? "them" : "it"} when you're ready.`;
  closeSiteFile("used");
}

function closeSiteFile(why) {
  if (!siteFile) return;
  const { card } = siteFile;
  siteFile = null;
  map?.getSource("sitefile")?.setData(turf.featureCollection([]));
  if (!card) return;
  card.classList.add("done");
  const result = card.querySelector(".result");
  if (why !== "used" || result.hidden) {
    result.hidden = false;
    result.textContent = why === "cancelled" ? "Cancelled; nothing was kept." : why === "replaced" ? "Replaced by the next file you dropped." : "Used: see the reply below.";
  }
}

setupFileDrop({ overlay: $("drop-overlay"), input: $("site-file"), onFiles: openSiteFile, onError: (e) => note(`The files couldn't be read: ${e.message || e}`) });
document.querySelector('.tools [data-action="file"]').addEventListener("click", () => $("site-file").click());

function makeChoiceCard({ choices, recommended, reason, question }) {
  const card = $("choice-card").content.firstElementChild.cloneNode(true);
  let i = 0;
  card.querySelector(".question").textContent = question || "Which one do you mean?";
  const show = () => {
    const c = choices[i];
    card.querySelector("h2").textContent = c.name || c.id;
    card.querySelector(".kind").textContent = c.type || "";
    const src = card.querySelector(".src");
    src.replaceChildren(document.createTextNode("Source: "), Object.assign(el("a", `${c.source.publisher}, ${c.source.title}`), { href: c.source.url, target: "_blank", rel: "noopener" }), document.createTextNode(` (${c.source.licence})`));
    const bits = [c.extra?.place || c.extra?.description, c.extra?.country, c.area_km2 != null ? U.area(c.area_km2) : null, c.distance_km != null ? `${U.dist(c.distance_km)} from the reference` : null].filter(Boolean);
    card.querySelector(".detail").textContent = bits.join(" · ");
    const isRec = c === recommended;
    card.querySelector(".rec").hidden = !isRec;
    card.querySelector(".why").textContent = isRec ? reason : "";
    card.querySelector('[data-op="lucky"]').hidden = isRec;
    card.querySelector(".count").textContent = `${i + 1} of ${choices.length}`;
    showCandidates([c]);
    const f = { type: "Feature", properties: {}, geometry: c.geometry };
    if (c.geometry.type === "Point") map.flyTo({ center: c.geometry.coordinates, zoom: Math.max(map.getZoom(), 12), padding: fitPadding() });
    else map.fitBounds(turf.bbox(f), { padding: fitPadding(), maxZoom: 14 });
  };
  card.querySelector('[data-op="prev"]').addEventListener("click", () => { i = (i - 1 + choices.length) % choices.length; show(); });
  card.querySelector('[data-op="next"]').addEventListener("click", () => { i = (i + 1) % choices.length; show(); });
  card.addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") card.querySelector('[data-op="prev"]').click(); if (e.key === "ArrowRight") card.querySelector('[data-op="next"]').click(); });
  const pick = (c) => {
    if (busy) return;
    card.classList.add("done");
    const said = `Use ${c.name || "that one"} (${c.source.publisher}).`;
    send(said, `${said}\n[Picked from the choices you offered: candidate ${c.id}, still available. Build it with make_place, anchor ${c.id}, match named_place (the person chose it); no need to search again. Don't mention the id.]`);
  };
  card.querySelector('[data-op="use"]').addEventListener("click", () => pick(choices[i]));
  card.querySelector('[data-op="lucky"]').addEventListener("click", () => pick(recommended));
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  i = Math.max(0, choices.indexOf(recommended));
  show();
  expandSheet();
}

// ---- screening progress: how long it usually takes, and where it's got to ----------------------
// A screen takes a minute or two, so the reply shows it at once: an estimate from this browser's recent screens
// (by setting), a bar driven by the run's steps and the time so far, and the step in hand. A proxy, not a promise.
const TYPICAL_S = { offshore: 70, onshore: 100, inside: 45 };
const timesKey = "screenTimes";
const pastTimes = () => { try { return JSON.parse(store.get(timesKey) || "{}"); } catch { return {}; } };
function estimateFor(kind) {
  const past = pastTimes()[kind] || [];
  if (past.length >= 2) {
    const sorted = [...past].sort((a, b) => a - b);
    return { secs: sorted[Math.floor(sorted.length / 2)], basis: `from your last ${past.length} screens` };
  }
  return { secs: TYPICAL_S[kind], basis: kind === "inside" ? "typical inside an area" : `typical for an ${kind} site` };
}
const fmtSecs = (s) => (s < 75 ? `${Math.max(10, Math.round(s / 5) * 5)} seconds` : `${Math.round((s / 60) * 2) / 2} minutes`.replace(".5 ", "½ ").replace(/^1 minutes/, "1 minute"));
let progress = null;
function startProgress(ev) {
  stopProgress(null);
  const kind = ev.inside ? "inside" : ev.setting;
  const est = estimateFor(kind);
  const box = el("div", null, "progress");
  box.append(el("p", `Screening ${ev.site}. This usually takes about ${fmtSecs(est.secs)} (${est.basis}); you can keep looking at the map meanwhile.`, "progress-title"));
  const bar = el("div", null, "progress-bar"); bar.append(el("span"));
  bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-label", "Screening progress");
  box.append(bar, el("p", "Starting…", "progress-step"));
  const host = pendingReply?.isConnected ? pendingReply : $("conversation");
  host.append(box);
  box.scrollIntoView({ block: "end", behavior: "smooth" });
  progress = { box, kind, est: est.secs, t0: Date.now(), base: 0, baseDone: 0, round: 0, step: "Starting", writing: false };
  progress.timer = setInterval(paintProgress, 1000);
  paintProgress();
}
function progressEvent(ev) {
  if (ev.type === "screen_start") return startProgress(ev);
  const p = progress;
  if (!p) return;
  if (ev.type === "baseline") { p.base = ev.layers + 1; p.step = `Checking the must-check layers and boundaries (${ev.layers + 1})`; }
  if (ev.type === "tool" && ev.baseline) p.baseDone++;
  if (ev.type === "tool_start" && !p.writing && p.round > 0) p.step = `Analyst, step ${p.round + 1}: ${activityFor(ev.name, ev.input)}`;
  if (ev.type === "round") {
    p.round = ev.round;
    if (!ev.tools) { p.writing = true; p.step = "Writing up the flags"; }
    else if (p.round === 1 || !p.step.startsWith("Analyst")) p.step = `Analyst, step ${p.round + 1}: searching the catalogue and fetching data`;
  }
  paintProgress();
}
function paintProgress() {
  const p = progress;
  if (!p?.box.isConnected) return;
  const secs = (Date.now() - p.t0) / 1000;
  // Steps: the baseline is about a fifth; the analyst usually takes 5 to 8 rounds; writing up is the last bit.
  const stepFrac = p.writing ? 0.92 : p.round ? 0.2 + 0.65 * (1 - Math.exp(-p.round / 3)) : p.base ? 0.2 * (p.baseDone / p.base) : 0.02;
  const frac = Math.min(0.96, Math.max(stepFrac, 0.9 * Math.min(1, secs / p.est) * (p.writing ? 1 : 0.9)));
  p.box.querySelector(".progress-bar span").style.width = `${Math.round(frac * 100)}%`;
  p.box.querySelector(".progress-bar").setAttribute("aria-valuenow", String(Math.round(frac * 100)));
  const over = secs > p.est * 1.3;
  p.box.querySelector(".progress-step").textContent = `${p.step}… · ${Math.round(secs)} s${over ? " · taking longer than usual: busy areas need more searches" : ""}`;
}
// record: the finished run (its time is kept for the next estimate), or null when the turn failed.
function stopProgress(record) {
  const p = progress;
  if (!p) return;
  clearInterval(p.timer);
  progress = null;
  if (record) {
    const secs = Math.round((Date.now() - p.t0) / 1000);
    record.tobler_run.screen_seconds = secs;
    const all = pastTimes();
    all[p.kind] = [...(all[p.kind] || []), secs].slice(-5);
    store.set(timesKey, JSON.stringify(all));
  }
  p.box.remove();
}

// ---- run cards: a screening run, flags first --------------------------------------------------
const fmtKm = (km) => (km == null ? "" : km === 0 ? "on site" : U.dist(km));
const runs = new Map(); // run id → { record, card }
let shownRun = null;

// Put a run's evidence on the map (replacing other findings), up to the card's slider.
function showRunOnMap(record, { fit = true } = {}) {
  const r = record.tobler_run;
  findings.clear(); hiddenThemes.clear();
  for (const f of evidenceOf(record)) {
    const p = f.properties;
    const band = p.band === "on site" || p.band === SEARCH_BAND ? "near" : p.band === "beyond" || p.band === "unknown" ? "wider" : p.band;
    findings.set(`${r.id}:${p.fid}`, { type: "Feature", geometry: f.geometry, properties: {
      id: `${r.id}:${p.fid}`, run: r.id, label: p.name, theme: p.theme, band: p.surrounds ? "wider" : band, ...(p.surrounds ? { surrounds: true } : {}),
      ...(p.in_search_area ? { in_search_area: true, ...(p.coverage != null ? { coverage: p.coverage } : {}), ...(p.side ? { side: p.side } : {}) } : {}), distance_km: p.distance_km, area_km2: p.area_km2 ?? null, dataset: p.dataset, publisher: p.publisher,
    } });
  }
  shownRun = r.id;
  const site = record.features.find((f) => f.properties.role === "site");
  findingLimit = runs.get(r.id)?.km ?? r.assessed_within_km;
  ringsAround = null;
  map.getSource("hl")?.setData(turf.featureCollection([]));
  drawFindings();
  paintMask();
  const inside = r.extent === "inside" || findingLimit === 0;
  if (fit) map.fitBounds(turf.bbox(inside ? site : turf.buffer(site, Math.max(r.distances.close, 1), { units: "kilometers", steps: 16 })), { padding: fitPadding(), maxZoom: 13 });
}

// Distance rings for a run: none when it's looking inside the area only.
const ringsFor = (r) => (r.extent === "inside" ? [] : [r.distances.near, r.distances.close, r.fetched_to_km].filter((v, i, a) => v > 0 && a.indexOf(v) === i));

// Inside the area only: dim the world outside the site and drop the rings; otherwise the rings come back.
function paintMask() {
  const e = shownRun ? runs.get(shownRun) : null;
  const site = e?.record.features.find((f) => f.properties.role === "site");
  const on = !!(e && site && isArea(site) && e.km === 0);
  map.getSource("mask")?.setData(on ? maskOutside(site) : turf.featureCollection([]));
  if (!e || !site) return;
  if (on || e.record.tobler_run.extent === "inside") { ringsAround = null; ringsArgs = null; map.getSource("rings")?.setData(turf.featureCollection([])); }
  else drawRings(site, ringsFor(e.record.tobler_run));
}
// The world with the site cut out. MapLibre tells holes from outer rings by winding, so holes go clockwise.
function maskOutside(site) {
  const signed = (ring) => ring.reduce((a, [x1, y1], i) => { const [x2, y2] = ring[(i + 1) % ring.length]; return a + (x1 * y2 - x2 * y1); }, 0);
  const g = site.geometry;
  const outers = g.type === "Polygon" ? [g.coordinates[0]] : g.coordinates.map((poly) => poly[0]);
  const holes = outers.map((ring) => (signed(ring) > 0 ? [...ring].reverse() : ring));
  return turf.featureCollection([{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]], ...holes] } }]);
}

function highlight(record, fids) {
  const want = new Set(fids || []);
  const feats = evidenceOf(record).filter((f) => want.has(f.properties.fid));
  map.getSource("hl")?.setData(turf.featureCollection(feats));
  if (!feats.length) return;
  const site = record.features.find((f) => f.properties.role === "site");
  map.fitBounds(turf.bbox(turf.featureCollection([...feats, site])), { padding: fitPadding(), maxZoom: 14 });
}

// Feedback rows (js/feedback.js): each piece goes into the session log and the shared log, beside the turns.
function sendFeedback(entry) {
  sessionLog.push(entry);
  return sharer.share(entry) !== null;
}

function showRun(record) {
  const card = $("run-card").content.firstElementChild.cloneNode(true);
  const r = record.tobler_run;
  const siteF = record.features.find((f) => f.properties.role === "site");
  const entry = { record, card, km: r.assessed_within_km, area: isArea(siteF), aroundKm: r.assessed_within_km || r.fetched_to_km };
  runs.set(r.id, entry);
  card.dataset.run = r.id;
  card.querySelector(".site").textContent = r.site.name;
  // Run id and time only: the method version and how long it took are in the report's Method section (Rob, 22 Nov).
  card.querySelector(".meta").textContent = `${r.id} · ${new Date(r.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  card.querySelector(".meta").title = `Method ${r.skill.version}${r.screen_seconds ? `, took ${r.screen_seconds} s` : ""}`;
  card.querySelector(".setup").textContent = [
    `${r.site.asset_label[0].toUpperCase()}${r.site.asset_label.slice(1)}${r.site.asset_assumed ? " (assumed)" : ""}`, r.site.stage, r.site.setting, r.site.footprint,
  ].filter(Boolean).join(" · ");
  // The short form on the card; the full wording is in the report and the downloaded run (Rob, 22 Nov).
  card.querySelector(".disclaimer").textContent = `${DISCLAIMER_SHORT} The report has the full wording.`;
  card.querySelector(".disclaimer").title = DISCLAIMER;
  card.querySelector(".disclaimer").before(feedbackRow({ on: "run", run: r.id, excerpt: `${r.id} ${r.site.name}: ${r.decision?.value || ""}, ${r.flags.length} flags`, send: sendFeedback }));
  { const o = card.querySelector(".outside"); o.hidden = !r.site.outside_profile; o.textContent = r.site.outside_profile || ""; }
  // A search area says so first: the site's outline wasn't found, so nothing on this card is "on site".
  if (r.site.role === "search_area") {
    const sn = card.querySelector(".search-note"); sn.hidden = false;
    sn.textContent = U.localise(searchHeadline(r.site));
  }
  // Water depth and vessel traffic, read in code for sites at sea (js/seavalues.js).
  // On land, elevation shows only when it matters (low-lying, high altitude); at sea it's the water depth.
  const elevText = r.elevation?.significance && !r.sea?.depth ? elevationShort(r.elevation, r.elevation.significance) : "";
  const seaText = [elevText, seaMatters(r) ? seaShort(r.sea, { units: (km) => U.dist(km) }) : ""].filter(Boolean).join(" ");
  if (seaText) { const p = card.querySelector(".sea"); p.hidden = false; p.textContent = seaText; }
  if (r.parse_error) { const pr = card.querySelector(".problem"); pr.hidden = false; pr.textContent = r.parse_error; }
  const slider = card.querySelector('input[type="range"]');
  slider.max = String(r.fetched_to_km);
  slider.step = r.fetched_to_km <= 10 ? "0.1" : "0.5";
  slider.value = String(r.assessed_within_km);
  const setKm = (km) => {
    entry.km = km;
    if (km > 0) entry.aroundKm = km;
    slider.value = String(km);
    paintReach(entry);
    if (shownRun === r.id) { findingLimit = km; drawFindings(); paintMask(); }
  };
  slider.addEventListener("input", () => setKm(+slider.value));
  // An area screened with its surroundings can be looked at inside the area only, from the same evidence.
  const scope = card.querySelector(".scope");
  if (r.extent === "inside") {
    const note = card.querySelector(".inside-note");
    note.hidden = false;
    note.textContent = "Screened inside the area only, as you asked. The surroundings weren't checked; ask me to screen around it to see them.";
  } else if (entry.area) {
    scope.hidden = false;
    scope.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
      if (b.dataset.scope === "inside") setKm(0);
      else setKm(entry.aroundKm > 0 ? entry.aroundKm : r.fetched_to_km);
      if (shownRun !== r.id) showRunOnMap(record);
      else if (b.dataset.scope === "inside") map.fitBounds(turf.bbox(siteF), { padding: fitPadding(), maxZoom: 13 });
    }));
  }
  card.querySelector('[data-op="reassess"]').addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Re-assessing…";
    activity(`Re-assessing ${r.site.name} ${entry.km === 0 && entry.area ? "inside the area" : `within ${U.dist(entry.km)}`}…`, true);
    const t0 = Date.now();
    try {
      await reassess({ record, km: entry.km, skill: screenSkill(), callClaude });
      const done = { at: new Date().toISOString(), reassess: r.id, within_km: entry.km, ms: Date.now() - t0, flags: r.flags.length };
      sessionLog.push(done);
      sharer.share(done);
      paintRun(entry);
      if (shownRun === r.id) showRunOnMap(record, { fit: false });
    } catch (err) {
      btn.textContent = was;
      const pr = card.querySelector(".problem"); pr.hidden = false;
      pr.textContent = err instanceof LimitReached ? err.message : `Re-assessing didn't work: ${err.message}. The flags are unchanged.`;
    } finally { btn.disabled = false; activity(""); }
  });
  card.querySelector('[data-op="show"]').addEventListener("click", () => { slider.value = String(entry.km); showRunOnMap(record); });
  // The More menu closes once something in it is used.
  card.querySelectorAll(".more-menu button").forEach((b) => b.addEventListener("click", () => { card.querySelector(".more").open = false; }));
  // The report and the share link are the same page: the run, slimmed and compressed into the link (js/share.js).
  // Nothing is stored. The report opens in a new tab, where "Save as PDF" prints it.
  const shareNote = card.querySelector(".share-note");
  card.querySelector('[data-op="report"]').addEventListener("click", async () => {
    const w = window.open("about:blank", "_blank"); // opened now, while it's still a click, so it isn't blocked
    try {
      const s = entry.shareReady || await entry.share;
      if (w) w.location.href = s.url; else location.assign(s.url);
      sessionLog.push({ at: new Date().toISOString(), report: r.id, chars: s.chars });
    } catch (e) { w?.close(); shareNote.hidden = false; shareNote.textContent = `The report couldn't be made: ${e.message}`; }
  });
  card.querySelector('[data-op="share"]').addEventListener("click", async () => {
    shareNote.hidden = false;
    try {
      // The link is made when the card is drawn, so copying happens inside the click: browsers (and the desktop
      // app's) refuse the clipboard once a click has turned into a wait (Rob, 20 Nov).
      const s = entry.shareReady || await entry.share;
      if (s.tooLong) { shareNote.textContent = "This run is too big to share as a link. Use Report and save it as a PDF instead."; return; }
      const how = await copyText(s.url);
      if (how === "shown") { showLinkToCopy(shareNote, s.url); return; }
      shareNote.textContent = `Link copied. It opens this run's report and holds the run itself, so nothing is stored online.${s.long ? " It's a long link: email is safer than some chat apps, which cut long links." : ""}`;
    } catch (e) { shareNote.textContent = `The link couldn't be made: ${e.message}`; }
  });
  card.querySelector('[data-op="download"]').addEventListener("click", () => {
    // The disclaimer travels with the data: first in the file, as well as in the run's record.
    const blob = new Blob([JSON.stringify({ type: record.type, disclaimer: DISCLAIMER, ...record }, null, 1)], { type: "application/geo+json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tobler-${r.id}-${r.site.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.geojson`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  paintRun(entry);
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  showRunOnMap(record);
  expandSheet();
  card.querySelector('[data-op="rerun"]').addEventListener("click", () => rerun(entry));
  checkRuns();
}

// ---- out-of-date runs (js/outofdate.js) ---------------------------------------------------------------------
// A run screens the site as it was. Once the place is edited (on the map, from its card or by the analyst) or
// deleted, its cards say so; undoing the edit clears it. Re-running makes a new run beside the old one.
function checkRuns() {
  for (const entry of runs.values()) {
    const r = entry.record.tobler_run;
    const change = siteChange(entry.record, places.get(r.place_id) || null);
    const state = `${change?.text || ""}|${r.replaced_by || ""}`;
    if (state === entry.outdatedState) continue;
    entry.outdatedState = state;
    entry.change = change;
    const strip = entry.card.querySelector(".outdated");
    entry.card.classList.toggle("is-outdated", !!change || !!r.replaced_by);
    strip.hidden = !change && !r.replaced_by;
    // Travels with the report and share link, so a report made now says the site has changed since.
    if (change || r.replaced_by) r.out_of_date = { noted_at: new Date().toISOString(), change: change?.text || "edited", ...(r.replaced_by ? { replaced_by: r.replaced_by } : {}) };
    else delete r.out_of_date;
    if (!strip.hidden) {
      strip.querySelector("span").textContent = U.localise(outOfDateText(change, { replacedBy: r.replaced_by }));
      const btn = strip.querySelector("button");
      btn.hidden = !!r.replaced_by || !!change?.deleted;
      if (!btn.disabled) btn.textContent = "Re-run on the edited site";
    }
    prepShare(entry);
  }
}
function runSummaryLines() {
  return runLines([...runs.values()].map((e) => ({ record: e.record, change: e.change, replacedBy: e.record.tobler_run.replaced_by })));
}
// The card's re-run: the same request on the place as it is now, without a model call to decide it. It still
// costs a screen (a minute or two), shown with the usual progress block, and the conversation hears about it.
async function rerun(entry) {
  const r = entry.record.tobler_run;
  const place = places.get(r.place_id);
  const btn = entry.card.querySelector('[data-op="rerun"]');
  if (!place || r.replaced_by || btn.disabled) return;
  if (busy) { activity("The analyst is busy; re-run once it has answered."); return; }
  busy = true; btn.disabled = true; btn.textContent = "Re-running…";
  $("ask").classList.add("busy");
  const reply = el("div", null, "msg analyst");
  reply.append(el("p", `Screening ${place.name} again on its edited outline (${entry.change?.text || "changed"}), with the same settings as ${r.id}.`));
  entry.card.after(reply);
  pendingReply = reply;
  const turnLog = { at: new Date().toISOString(), rerun: r.id, change: entry.change?.text || "", events: [] };
  sessionLog.push(turnLog);
  runLog = turnLog; runSteps = null;
  try {
    const input = rerunInput(entry.record);
    turnLog.input = input;
    const head = await host.screening.screen(input, place);
    const rec = runs.get(head.run)?.record.tobler_run;
    const was = r.flags.length, now = rec?.flags.length ?? 0;
    const text = `${head.run} replaces ${r.id}: ${now} flag${now === 1 ? "" : "s"} (was ${was})${rec?.decision?.value ? `, decision: ${rec.decision.value}` : ""}${r.decision?.value && rec?.decision?.value && r.decision.value !== rec.decision.value ? ` (was ${r.decision.value})` : ""}.`;
    reply.replaceChildren(el("p", text));
    turnLog.reply = text;
    remember("assistant", `(I re-ran ${r.id} on ${place.name}'s edited outline as ${head.run}. ${text})`);
  } catch (err) {
    btn.disabled = false; btn.textContent = "Re-run on the edited site";
    reply.replaceChildren(el("p", err instanceof LimitReached ? err.message : `The re-run didn't work: ${err.message}. ${r.id} is unchanged.`));
    reply.classList.add("error");
    turnLog.error = String(err.message || err);
  } finally {
    turnLog.ms = Date.now() - Date.parse(turnLog.at);
    sharer.share(turnLog);
    stopProgress(null);
    activity("");
    busy = false; pendingReply = null; runLog = null;
    $("ask").classList.remove("busy");
    checkRuns();
  }
}

// The run's report link (js/share.js), made as soon as the card is drawn and again after a re-assessment, so the
// Report and Copy share link buttons don't have to wait inside the click.
function prepShare(entry) {
  entry.shareReady = null;
  const p = shareCode(entry.record).then((s) => ({ url: new URL(`report.html#${s.code}`, location.href).href, ...s }));
  entry.share = p;
  p.then((s) => { if (entry.share === p) entry.shareReady = s; }).catch(() => {});
}
// Copy text: the clipboard API, then the older copy command, else the caller shows the text to copy by hand.
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return "copied"; } catch { /* refused: try the older way */ }
  const box = Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
  box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(box); box.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  box.remove();
  return ok ? "copied" : "shown";
}
function showLinkToCopy(where, url) {
  const input = Object.assign(document.createElement("input"), { value: url, readOnly: true, className: "share-link" });
  input.setAttribute("aria-label", "Report link");
  where.replaceChildren(document.createTextNode("This browser won't let Tobler copy for you. The link is selected here: copy it with Ctrl+C (Cmd+C on a Mac)."), input);
  input.focus(); input.select();
}
function paintRun(entry) {
  const { record, card } = entry;
  prepShare(entry);
  const r = record.tobler_run;
  const list = card.querySelector(".flags");
  list.replaceChildren(...r.flags.map((f) => {
    const li = el("li", null, "flag");
    li.dataset.conf = f.confidence;
    // The badge is severity, with confidence as a word under the flag (Rob, 22 Nov). Runs without a severity keep
    // the confidence badge they had.
    if (f.severity) li.dataset.sev = f.severity;
    const d = document.createElement("details");
    const s = document.createElement("summary");
    const sw = el("span", null, "swatch"); sw.style.background = THEMES[f.theme]?.colour || THEMES.context.colour; sw.title = THEMES[f.theme]?.label || "";
    const risk = el("span", null, "risk");
    if (f.id) risk.append(el("span", f.id, "fid"));
    risk.append(document.createTextNode(f.risk));
    // Under the flag: its topic in words (people think "heritage", not a colour) and, with a severity, the confidence.
    const sub = el("span", null, "sub");
    sub.append(el("span", THEME_SHORT[f.theme] || THEMES[f.theme]?.label || "Context", "th"));
    if (f.severity) sub.append(document.createTextNode(" · "), el("span", `${f.confidence} confidence${f.confidence_capped ? " (capped)" : ""}`, "cw"));
    risk.append(sub);
    s.append(el("span", f.severity || f.confidence, f.severity ? "sev" : "conf"), sw, risk, el("span", f.relation === SEARCH_BAND ? "in search area" : f.nearest_km == null ? "" : fmtKm(f.nearest_km), "dist"));
    s.title = `${f.severity ? `Severity ${f.severity}, ` : ""}confidence ${f.confidence}`;
    const body = el("div", null, "body");
    body.append(el("p", `${THEMES[f.theme]?.label || "Operating context"}${THEME_CODE[f.theme] && THEME_CODE[f.theme] !== "context" ? ` (${THEME_CODE[f.theme]})` : ""}.${f.severity ? ` Severity ${f.severity}, confidence ${f.confidence}.` : ""} ${f.why || ""}${f.confidence_capped ? ` (Confidence ${f.confidence_capped}.)` : ""}`, "why"));
    if (f.next_step) { const nx = el("p", null, "next"); nx.append(el("b", "Next step: "), document.createTextNode(f.next_step)); body.append(nx); }
    const ev = el("ul", null, "ev");
    for (const e of f.evidence) {
      const item = el("li");
      item.append(el("b", e.name || "Unnamed"), document.createTextNode(` · ${e.band === "around the site" ? "around the site (a wide area it lies within)" : e.band === SEARCH_BAND ? whereText(e) : e.distance_km == null ? "distance not given" : `${fmtKm(e.distance_km)}${e.band && e.band !== "on site" ? ` (${e.band})` : ""}`} `));
      item.append(el("span", `· ${[e.dataset, e.publisher && `(${e.publisher})`].filter(Boolean).join(" ")}${e.licence ? `, ${e.licence}` : ""}${e.checked ? `, checked ${String(e.checked).slice(0, 10)}` : ""} `, "src"));
      item.append(e.traced ? el("span", "· traced to the data", "src") : el("span", "· not traced to fetched data", "untraced"));
      ev.append(item);
    }
    body.append(ev);
    if (!f.evidence.length) body.append(el("p", "No evidence items given.", "note"));
    d.append(s, body);
    d.addEventListener("toggle", () => { if (d.open) { if (shownRun !== r.id) showRunOnMap(record, { fit: false }); highlight(record, f.fids); } });
    li.append(d);
    return li;
  }));
  if (!r.flags.length && !r.parse_error) list.replaceChildren(el("li", "No flags raised. See what still needs checking below.", "flag note"));
  // The decision first (from the ESIA read, 20 Nov): what the screen suggests, in the analyst's words, and why.
  const dec = card.querySelector(".decision");
  dec.hidden = !r.decision;
  if (r.decision) {
    dec.replaceChildren(el("b", `${r.decision.value.charAt(0).toUpperCase()}${r.decision.value.slice(1)}.`), document.createTextNode(r.decision.why ? ` ${r.decision.why}` : ""),
      ...(r.decision.changed ? [el("span", ` Set by Tobler's rules, ${r.decision.changed}.`, "changed")] : []));
    dec.title = "The analyst's overall reading of this screen. A screen, not a decision to build: see the disclaimer.";
  }
  // Distances in one line; the reasons open under it.
  const dists = card.querySelector(".dists");
  const why = r.distances.reasons?.length ? U.localise(`Why: ${r.distances.reasons.slice(0, 2).join("; ")}.`) : "";
  dists.querySelector("summary").textContent = r.extent === "inside"
    ? "Inside the area only: findings inside it or touching its edge."
    : entry.area && r.assessed_within_km === 0
      ? U.localise(`Flags written for inside the area only. Findings were fetched out to ${r.fetched_to_km} km, so you can switch back to the surroundings.`)
      : U.localise(`Distances from the site's edge: ${distancesLine(r.distances)}.`);
  dists.querySelector(".why-dists").textContent = why;
  dists.classList.toggle("no-why", !why || r.extent === "inside" || (entry.area && r.assessed_within_km === 0));
  const checked = card.querySelector(".checked");
  const nc = r.checked.filter((c) => c.result === "not checked");
  checked.querySelector("summary").textContent = `What was checked: ${r.checked.length} source${r.checked.length === 1 ? "" : "s"}${nc.length ? `, ${nc.length} not checked` : ""}`;
  checked.querySelector("ul").replaceChildren(...r.checked.map((c) => {
    const li = el("li", `${c.dataset}${c.publisher ? ` (${c.publisher})` : ""}: ${c.result === "features" ? `${c.count} found` : c.result}${c.why ? ` (${c.why.slice(0, 120)})` : ""}`);
    if (c.result === "not checked") li.className = "nc";
    return li;
  }));
  // Gaps in three groups: couldn't check (tools and the analyst), no data, caveats.
  const gaps = card.querySelector(".gaps");
  const groups = groupGaps(r.data_gaps, r.checked);
  gaps.querySelector("summary").textContent = gapSummary(groups);
  gaps.querySelector("ul").replaceChildren(...GAP_GROUPS.filter(([k]) => groups[k].length).map(([k, label]) => {
    const li = el("li", null, `gap-group ${k}`);
    const ul = el("ul");
    ul.append(...groups[k].map((g) => el("li", g)));
    li.append(el("p", label, "gap-head"), ul);
    return li;
  }));
  gaps.hidden = !GAP_GROUPS.some(([k]) => groups[k].length);
  card.querySelector('input[type="range"]').value = String(entry.km);
  paintReach(entry);
}

// The slider's line: how far, the nearest finding of each theme, flags whose evidence is all further out,
// and the offer to re-assess when the distance differs from the one the flags were written for.
function paintReach(entry) {
  const { record, card, km } = entry;
  const r = record.tobler_run;
  // Inside the area only: either the run was screened that way, or the card is switched to it (0 km for an area).
  const inside = entry.area && km === 0;
  const scope = card.querySelector(".scope");
  scope.querySelectorAll("button").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.scope === "inside") === inside)));
  card.querySelector(".reach-label").hidden = inside;
  card.querySelector('.reach input[type="range"]').hidden = inside;
  card.querySelector(".reach output").textContent = km === 0 ? (r.site.role === "search_area" ? "inside the search area" : "on site") : U.dist(km);
  const near = nearestByTheme(record, km);
  const within = evidenceWithin(record, km);
  const n = within.filter((f) => !f.properties.surrounds).length;
  // Wide areas the site lies within (seas, regions, very large designations) are counted apart from findings on it.
  const wide = [...new Set(within.filter((f) => f.properties.surrounds).map((f) => f.properties.name))];
  const where = inside ? (r.site.role === "search_area" ? "inside the search area or touching its edge" : "inside the area or touching its edge") : `within ${U.dist(km)}`;
  const wideLine = wide.length ? ` The site also lies within ${wide.length === 1 ? "a wide area" : `${wide.length} wide areas`}: ${wide.slice(0, 3).join("; ")}${wide.length > 3 ? ` and ${wide.length - 3} more` : ""}.` : "";
  card.querySelector(".nearest").textContent = (n
    ? `${n} finding${n === 1 ? "" : "s"} ${where}. ${inside ? "Found" : "Nearest"}: ${near.map((x) => `${(THEMES[x.theme]?.label || x.theme).toLowerCase()}, ${x.name}${inside ? "" : ` (${r.site.role === "search_area" && x.distance_km === 0 ? "in the search area" : fmtKm(x.distance_km)})`}`).join("; ")}.`
    : `Nothing found ${where} in the sources checked.`) + wideLine;
  card.querySelectorAll(".flag").forEach((li, i) => {
    const f = r.flags[i];
    if (!f) return;
    const beyond = flagBeyond(f, km);
    li.classList.toggle("beyond", beyond);
    li.title = beyond ? (inside ? "All of this flag's evidence is outside the area" : `All of this flag's evidence is beyond ${U.dist(km)}`) : "";
  });
  const stale = card.querySelector(".stale");
  const differs = Math.abs(km - r.assessed_within_km) > 1e-9;
  stale.hidden = !differs;
  if (differs) {
    const was = r.assessed_within_km === 0 && entry.area ? "inside the area only" : `findings up to ${U.dist(r.assessed_within_km)}`;
    stale.querySelector("span").textContent = `The flags were written for ${was}.`;
    stale.querySelector("button").textContent = inside ? "Re-assess inside the area" : `Re-assess at ${U.dist(km)}`;
  }
}

function paintStatus(p, card = p.card) {
  card.classList.toggle("proposed", p.status === "proposed");
  const asking = p.status === "proposed";
  card.querySelectorAll('.question, [data-op="accept"], [data-op="revise"]').forEach((e) => { e.hidden = !asking; });
  card.querySelector(".badge").textContent = p.status === "proposed" ? "Proposed" : "";
}

function paintOrigin(p, card = p.card) {
  const o = p.origin, box = card.querySelector(".origin");
  if (o?.method === "file") {
    box.querySelector("summary").textContent = `From your file ${o.file}`;
    const body = box.querySelector("div");
    body.append(el("p", `Features: ${o.features.map((f) => f.label).join(", ")}${o.buffer_m ? `, ${o.buffer_m} m wide` : ""}.`));
    body.append(el("p", `Coordinates: ${o.crs?.how || "as given"}.`, o.crs?.warning || o.crs?.guessed ? "warn" : "quiet"));
    if (o.steps?.length) body.append(el("p", `Built: ${o.steps.join(", then ")}.`, "quiet"));
    body.append(el("p", "Read in your browser; the file wasn't uploaded or kept.", "quiet"));
    return;
  }
  if (o?.method !== "words") { box.remove(); return; }
  const a = o.anchor || {};
  const src = a.source ? Object.assign(el("a", `${a.source.publisher}, ${a.source.title}`), { href: a.source.url, target: "_blank", rel: "noopener" }) : null;
  box.querySelector("summary").textContent = `From your words, ${o.confidence} confidence`;
  const body = box.querySelector("div");
  body.append(el("p", `“${o.words}”`, "words"));
  if (a.name) {
    const line = el("p", `Anchor: ${a.name}${a.type ? ` (${a.type})` : ""}`);
    if (src) line.append(document.createTextNode(", from "), src);
    if (a.source?.licence) line.append(document.createTextNode(`, licence: ${a.source.licence}`));
    body.append(line);
  } else if (a.place) body.append(el("p", `Anchor: ${a.place}`));
  body.append(el("p", `Built: ${o.steps.join(", then ")}.`), el("p", `Why: ${o.reason}`));
  if (o.confidence_rules?.length) body.append(el("p", `Confidence: ${o.confidence_rules.join("; ")}.`));
  for (const c of o.checks || []) {
    const verdict = c.pass === true ? "fits" : c.pass === false ? `doesn't fit (${c.why})` : "not checked";
    body.append(el("p", `Check: ${c.against} about ${c.expected_km} km${c.direction ? ` ${c.direction}` : ""}: measured ${c.actual_km ?? "?"} km, ${verdict}.`, c.pass === false ? "warn" : "quiet"));
  }
  if (a.extra?.CRS_NAME && /ED50/i.test(a.extra.CRS_NAME)) body.append(el("p", `The source position was surveyed in ${a.extra.CRS_NAME}; the publisher supplies it in WGS84.`, "quiet"));
}

let refreshSeq = 0;
async function refreshCard(p) {
  const seq = ++refreshSeq; p.seq = seq;
  const sum = p.card.querySelector(".summary");
  sum.classList.add("loading");
  if (!p.described) sum.textContent = "Measuring…";
  try {
    const d = await R.describe(ref, p.feature);
    if (p.seq !== seq) return; // a newer edit overtook this one
    p.described = d;
    // Scale is worked out (from the request, the size or the zoom) and goes to the analyst; it isn't shown or
    // set on the card (Rob, 19 Nov: the Local/Regional/Global buttons spilled out of the panel and did little).
    if (p.scaleFrom === "size") p.scale = d.scale;
    sum.textContent = U.localise(R.summaryLine(d));
    sum.classList.remove("loading");
    const [lon, lat] = d.centroid;
    const role = placeRole(p.origin || {}, p.feature.geometry);
    const rows = [
      role.role === "search_area" && ["What it is", `A search area (${role.why}), standing in for an outline that wasn't found. A screen of it says how much of it each finding covers, not "on site". If you have the real outline, draw it.`],
      [p.kind === "Point" ? "Location" : "Centre", `${lat.toFixed(4)}, ${lon.toFixed(4)}`],
      d.area_km2 != null && ["Area", U.area(d.area_km2)],
      d.length_km != null && ["Length", U.dist(d.length_km)],
      d.extent_km != null && ["Across", U.dist(d.extent_km)],
      ["Country", d.offshore ? "None (offshore)" : d.countries.join(", ")],
      d.coast_km != null && ["Coast", U.dist(d.coast_km)],
      d.nearest_places.length && ["Towns", d.nearest_places.map((x) => `${x.name} ${U.dist(x.km)}`).join(", ")],
      d.places_inside && ["Cities", d.places_inside.count ? `${d.places_inside.largest.map((x) => x.name).join(", ")}${d.places_inside.count > 3 ? ` and ${d.places_inside.count - 3} more` : ""}` : "None mapped at this scale"],
    ].filter(Boolean);
    p.card.querySelector(".facts").replaceChildren(...rows.flatMap(([k, v]) => [el("dt", k), el("dd", v)]), el("dd", "Places, coast and borders from Natural Earth (1:10m), good to about a kilometre.", "src"));
    const input = p.card.querySelector(".resize input");
    if (input && document.activeElement !== input) input.value = p.kind === "Area" ? +U.toArea(d.area_km2).toPrecision(4) : +U.toDist(d.length_km).toPrecision(4);
    p.card.querySelector(".unit") && (p.card.querySelector(".unit").textContent = p.kind === "Area" ? U.areaUnit() : U.distUnit());
    if (!busy) activity(`${p.name}: ${U.localise(R.summaryLine(d))}`);
  } catch (e) {
    sum.textContent = `Couldn't place this shape: ${e.message}`;
  }
}

function zoomTo(p) {
  if (p.kind === "Point") map.flyTo({ center: p.feature.geometry.coordinates, zoom: Math.max(map.getZoom(), 11), padding: fitPadding() });
  else map.fitBounds(turf.bbox(p.feature), { padding: fitPadding(), maxZoom: 15 });
  if (places.has(p.id)) focusPlace(p);
}
function fitPadding() {
  if (innerWidth <= 720) return { top: 130, bottom: Math.min(innerHeight * 0.55, 420), left: 50, right: 50 };
  return { top: 140, bottom: 140, left: 560, right: 200 };
}

// ---- conversation ---------------------------------------------------------------------
function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
function note(text) { $("conversation").append(el("p", text, "msg note")); }
// The activity line under the conversation: a spinning globe while the analyst works, the text beside it.
function activity(text, isBusy = false) {
  const a = $("activity");
  a.querySelector(".activity-text").textContent = text;
  a.classList.toggle("busy", isBusy);
  a.classList.toggle("empty", !text);
}

// The last few exchanges as plain text; tool results are never replayed (see converse.js).
const recent = [];
function remember(role, text) { recent.push({ role, text }); while (recent.length > 8) recent.shift(); }

// Plain text with **bold** and "- " lists, safely.
function renderText(text) {
  const box = document.createElement("div");
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n");
    if (lines.every((l) => /^\s*[-*] /.test(l))) {
      const ul = el("ul");
      lines.forEach((l) => ul.append(inline(el("li"), l.replace(/^\s*[-*] /, ""))));
      box.append(ul);
    } else box.append(inline(el("p"), lines.join("\n")));
  }
  return box;
}
function inline(node, text) {
  text.split(/(\*\*[^*]+\*\*)/).forEach((part) => {
    if (/^\*\*[^*]+\*\*$/.test(part)) node.append(el("strong", part.slice(2, -2)));
    else node.append(document.createTextNode(part));
  });
  return node;
}

const say = $("say");
say.addEventListener("input", grow);
say.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("ask").requestSubmit(); } });
function grow() { say.style.height = "auto"; say.style.height = Math.min(say.scrollHeight, 140) + "px"; }

let busy = false;
let pendingReply = null;
// Once a skill is loaded, later turns carry it in the system prompt instead of spending a round on load_skill.
const loadedSkills = new Set();
$("ask").addEventListener("submit", (e) => { e.preventDefault(); send(say.value.trim()); });
// The welcome examples change on every load: one of each kind from a small pool (js/examples.js).
// Examples come from the industry profile once it has loaded (the page's own text stands until then).
function paintExamples() {
  if (!profile?.examples) return;
  pickExamples(profile.examples).forEach((text, i) => { const b = document.querySelectorAll("[data-example]")[i]; if (b) b.textContent = text; });
}
document.querySelectorAll("[data-example]").forEach((b) => b.addEventListener("click", () => send(b.textContent.trim())));

// The whole session, tool inputs and outputs included, for checking what the analyst did. Kept in the page only;
// "Download the log" in any "How I worked this out" saves it as JSON, and window.toblerLog holds it for tests.
const sessionLog = [];
window.toblerLog = sessionLog;
// Each finished turn also goes, trimmed, to Tobler's Worker while "Share my sessions" is on (on unless turned off
// in settings; the welcome card says so). Read weekly to see what people ask and where the analyst goes wrong.
const sharer = createLogSharer({ url: CONFIG.proxyUrl && `${CONFIG.proxyUrl}/logs`, enabled: () => store.get("shareSessions") !== "no" });
window.toblerSharer = sharer; // for tests
function downloadLog() {
  const blob = new Blob([JSON.stringify({ page: location.href, saved: new Date().toISOString(), turns: sessionLog }, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `tobler-log-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// `forModel` is what the analyst reads when it needs more than the person sees (a picked candidate's id).
// Everything the person has typed or said in this project: distance checks must quote it (js/placetools.js).
const said = [];
async function send(text, forModel = text) {
  if (!text || busy || !draw) return;
  // Coordinates in what the person typed are read in code, and the analyst is told so it uses them as a place
  // rather than searching for them as a name (Rob, 20 Nov).
  if (forModel === text) { const note = coordinateNote(text); if (note) forModel = `${text}\n\n${note}`; }
  busy = true;
  said.push(text);
  $("ask").classList.add("busy");
  const asked = el("div", text, "msg user");
  $("conversation").append(asked);
  say.value = ""; grow();
  const reply = el("div", null, "msg analyst");
  const trace = el("details", null, "trace"); trace.append(el("summary", "How I worked this out"), el("ol"));
  $("conversation").append(reply);
  pendingReply = reply;
  reply.scrollIntoView({ block: "end", behavior: "smooth" });
  activity("Thinking…", true);
  showCandidates([]);
  const steps = trace.querySelector("ol");
  const save = el("button", "Download the log", "log-link");
  save.type = "button";
  save.addEventListener("click", downloadLog);
  trace.append(save);
  const turnLog = { at: new Date().toISOString(), user: text, ...(forModel !== text ? { sent: forModel } : {}), events: [] };
  sessionLog.push(turnLog);
  try {
    const summary = [await projectSummary(ref, host.places(), focusName, viewBounds(), runSummaryLines(), host.loadedFile()), U.unitsNote(), industryNote(profile, industries)].filter(Boolean).join("\n");
    const skillList = conversationSkills();
    runLog = turnLog; runSteps = steps;
    const res = await runTurn({
      system: systemPrompt({ skills: skillList, loaded: skillList.filter((s) => loadedSkills.has(s.name)), comingSoon: ["net developable area and constraints-and-access analysis"], industryRule: profile?.other_requests || "" }),
      messages: buildMessages({ recent, summary, userText: forModel }),
      tools: placeToolDefs(skillList),
      maxRounds: CONFIG.workspaceRounds || 10,
      exec: (name, input) => tools.exec(name, input),
      callClaude,
      onEvent: (ev) => {
        if (ev.type === "round") turnLog.events.push({ model_round: ev.round, ms: ev.ms, tokens_in: ev.input_tokens, tokens_out: ev.output_tokens, tool_calls: ev.tools });
        if (ev.type === "tool_start") activity(`${activityFor(ev.name, ev.input)}…`, true);
        if (ev.type === "tool" && ev.name === "load_skill" && !ev.error) loadedSkills.add(ev.input?.name);
        if (ev.type === "tool") {
          turnLog.events.push({ tool: ev.name, input: ev.input, ms: ev.ms, ...(ev.error ? { error: ev.error } : { output: ev.output }) });
          steps.append(el("li", traceLine(ev), ev.error ? "err" : ""));
          activity("Thinking…", true);
        }
        if (ev.type === "warning") { steps.append(el("li", ev.message, "err")); turnLog.events.push({ warning: ev.message }); }
      },
    });
    turnLog.reply = res.text;
    turnLog.usage = res.usage;
    reply.replaceChildren(renderText(res.text || "Done."));
    if (steps.children.length) reply.append(trace);
    reply.append(feedbackRow({ on: "reply", turnAt: turnLog.at, excerpt: res.text, send: sendFeedback }));
    remember("user", forModel);
    remember("assistant", res.text);
    activity("");
  } catch (err) {
    // Leave no half exchange behind: nothing is remembered from a failed turn.
    reply.replaceChildren(el("p", err instanceof LimitReached
      ? `${err.message} You can carry on drawing and editing; the analyst will be back tomorrow.`
      : `That didn't work: ${err.message}. Nothing was changed by this request; try again.`));
    reply.classList.add("error");
    turnLog.error = String(err.message || err);
    activity("");
  } finally {
    turnLog.ms = Date.now() - Date.parse(turnLog.at);
    sharer.share(turnLog);
    stopProgress(null);
    busy = false;
    pendingReply = null;
    runLog = null; runSteps = null;
    $("ask").classList.remove("busy");
    showTurnTop(asked);
  }
}

// At the end of a turn, the first thing it produced (a shape card, a run card, the reply) goes to the top of the
// conversation, so results can be read from the start without scrolling back up. Short turns that fit stay put.
function showTurnTop(asked) {
  const conv = $("conversation");
  const first = asked?.nextElementSibling;
  if (!first) return;
  const top = first.getBoundingClientRect().top - conv.getBoundingClientRect().top + conv.scrollTop - 8;
  const fits = conv.scrollHeight - top <= conv.clientHeight;
  conv.scrollTo({ top: fits ? conv.scrollHeight : top, behavior: "smooth" });
}

function traceLine(ev) {
  const i = ev.input || {};
  if (ev.error) return `${activityFor(ev.name, i)}: ${ev.error}`;
  const o = ev.output || {};
  switch (ev.name) {
    case "load_skill": return `Loaded the ${i.name} skill`;
    case "find_place": return `Searched for “${i.query}”: ${o.candidates?.length || 0} found${o.candidates?.length ? ` (${o.candidates.slice(0, 3).map((c) => `${c.name}, ${c.source.split(" – ")[0]}`).join("; ")})` : ""}`;
    case "find_features_near": return `Looked for ${i.feature_type} within ${i.radius_km} km of ${o.anchor}: ${o.found} found${o.not_listed ? ` (nearest ${o.listed} listed)` : ""}`;
    case "make_place": return `Built ${o.place}${o.replaced ? ` (replacing the earlier proposal)` : ""}: ${o.how}`;
    case "edit_place": return `Changed ${o.place}: ${o.changed}`;
    case "get_place": return `Read ${i.place}`;
    case "find_data": return `Searched the catalogue for “${i.text}”: ${o.datasets?.length || 0} datasets${o.not_checked ? " (catalogue not checked)" : ""}`;
    case "get_data": return o.not_checked ? `Fetched ${o.dataset || i.dataset}: not checked (${String(o.not_checked).slice(0, 80)})` : `Fetched ${o.dataset} (${o.publisher}): ${o.within_distance} within ${o.within_km} km`;
    case "screen_site": return o.run ? `Screened ${o.site} (${o.run}): ${o.flags} flags; ${o.distances}` : `Screening: ${o.not_available || "no result"}`;
    case "get_run": return `Read the screen ${o.run || ""}`;
    case "remove_place": return `Removed ${o.removed}`;
    case "ask_asset_type": return `Asked what's planned at ${o.place}`;
    case "get_elevation": return o.not_checked ? `Elevation: not checked (${String(o.not_checked).slice(0, 80)})` : o.water_depth_m?.typical != null ? `Water depth about ${o.water_depth_m.typical} m (${o.dataset})` : `Elevation about ${o.elevation_m?.typical} m (${o.dataset})`;
    case "sea_values": return [...(o.lines || []), ...(o.not_found || [])].join(" ") || "Read water depth and vessel traffic: nothing returned";
    default: return ev.name;
  }
}

// One chip, "Screen for environmental constraints" (the profile's wording), shown only while there's a place to screen. It fills the input with
// the place in focus (or the latest place), ready to send or add to. Finding is typing; drawing is the Draw button.
function focusedOrLatest() {
  return (focusName && placeByName(focusName)) || [...places.values()].at(-1) || null;
}
function paintChips() { document.querySelector(".chips").hidden = !places.size; }
// When what's planned there isn't known yet, the chip asks with quick picks first (no model call); once a place
// has been screened, it fills the input as before.
document.querySelector(".chip[data-screen]").addEventListener("click", () => {
  const p = focusedOrLatest();
  if (!p || busy) return;
  if (!p.assetType) { askAssetType(p.name); return; }
  say.value = `Screen ${p.name} for environmental constraints`; grow(); say.focus();
  say.setSelectionRange(say.value.length, say.value.length);
});

// "What's planned at <place>?": a few buttons, More… for the rest, and a general screen. A tap screens at once.
async function askAssetType(name, question) {
  const p = placeByName(name);
  if (!p) throw new Error(`No place called "${name}".`);
  let offshore = false;
  try { offshore = !!(await R.describe(ref, p.feature)).offshore; } catch { /* reference not loaded: on land */ }
  const { shown, more } = picksFor(assetPicks(), offshore);
  const card = el("div", null, "msg analyst asset-pick");
  card.append(el("p", question || `What's planned at ${p.name}? It sets how far the screen looks.`));
  const row = el("div", null, "picks");
  const go = (pick) => {
    if (busy) return;
    card.classList.add("done");
    card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    const m = pickMessage(p.name, pick);
    send(m.text, m.forModel);
  };
  const button = (pick, cls = "chip") => { const b = el("button", pick ? pick.label : "Just a general screen", cls); b.type = "button"; b.addEventListener("click", () => go(pick)); return b; };
  shown.forEach((k) => row.append(button(k)));
  if (more.length) {
    const m = el("button", "More…", "chip more"); m.type = "button";
    m.addEventListener("click", () => { m.remove(); more.forEach((k) => row.insertBefore(button(k), general)); });
    row.append(m);
  }
  const general = button(null, "chip general");
  row.append(general);
  card.append(row);
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  expandSheet();
  return { place: p.name, setting: offshore ? "offshore" : "onshore", options: [...shown, ...more].map((k) => k.type) };
}

// Speech: the browser's own recognition where it exists (Chrome, Edge, Safari). Typing always works.
const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Speech) {
  const mic = $("mic"); mic.hidden = false;
  let rec = null, base = "";
  mic.addEventListener("click", () => {
    if (rec) { rec.stop(); return; }
    rec = new Speech(); rec.lang = navigator.language || "en-GB"; rec.interimResults = true; rec.continuous = false;
    base = say.value ? say.value.replace(/\s*$/, " ") : "";
    rec.onresult = (e) => { say.value = base + Array.from(e.results).map((r) => r[0].transcript).join(""); grow(); };
    rec.onerror = (e) => activity(e.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : `Speech stopped: ${e.error}.`);
    rec.onend = () => { rec = null; mic.classList.remove("on"); mic.title = "Speak"; say.focus(); if (!busy) activity(""); };
    rec.start(); mic.classList.add("on"); mic.title = "Stop listening";
    activity("Listening…", true);
  });
}

// ---- phone: the panel is a bottom sheet -------------------------------------------------
const panel = $("panel"), handleBtn = $("handle");
handleBtn.addEventListener("click", () => setSheet(panel.classList.contains("collapsed")));
function setSheet(open) { panel.classList.toggle("collapsed", !open); handleBtn.setAttribute("aria-expanded", String(open)); }
function expandSheet() { if (innerWidth <= 720) setSheet(true); }
// On a phone the sheet starts closed so the map shows, except on the first visit, when the welcome card is the
// point: a newcomer otherwise sees an empty map and a handle (Rob, 22 Nov).
if (innerWidth <= 720) { const first = !store.get("welcomed"); setSheet(first); store.set("welcomed", "yes"); }
document.querySelectorAll(".tools [data-mode]").forEach((b) => b.addEventListener("click", () => {
  if (innerWidth <= 720 && b.dataset.mode !== "select") setSheet(false);
}));

// ---- settings: the gear on the panel ----------------------------------------------------------
const dlg = $("settings");
const form = dlg.querySelector("form");
function paintSettings() {
  // Industry: a dropdown to save space (Rob, 22 Nov). Profiles not ready yet show as disabled "coming soon" options.
  const list = industries?.industries || [];
  form.industry.replaceChildren(...list.map((i) => Object.assign(document.createElement("option"), {
    value: i.id, disabled: i.status !== "ready", selected: i.id === profile?.id,
    textContent: i.status === "ready" ? i.label : `${i.label} (coming soon)`,
  })));
  paintIndustryAbout();
  form.esri.checked = host.esriLicence();
  form.nonCommercial.checked = host.nonCommercial();
  form.shareSessions.checked = store.get("shareSessions") !== "no";
  form.querySelectorAll('input[name="units"]').forEach((r) => { r.checked = r.value === U.getUnits(); });
  const preset = [...form.querySelectorAll("[data-colour]")].find((b) => b.dataset.colour.toLowerCase() === C.pole.toLowerCase());
  form.querySelectorAll("[data-colour]").forEach((b) => b.setAttribute("aria-checked", String(b === preset)));
  form.colour.value = C.pole;
  form.querySelector(".pick").classList.toggle("on", !preset);
  const key = getUserKey();
  form.key.value = "";
  form.key.placeholder = key ? `Using your key (…${key.slice(-4)})` : "sk-ant-…";
  $("key-status").textContent = key
    ? "Your key is in use for this tab: calls go straight to Anthropic and are billed to you. Clear it to go back to Tobler's shared allowance."
    : "Optional. Without one, Tobler's shared daily allowance is used. A key is kept for this tab only and sent straight to Anthropic.";
}
function paintIndustryAbout() {
  const i = (industries?.industries || []).find((x) => x.id === form.industry.value);
  form.querySelector(".industry-about").textContent = i?.about || "";
}
form.industry.addEventListener("change", () => {
  const id = form.industry.value;
  paintIndustryAbout();
  store.set("industry", id);
  loadIndustry(id).catch((e) => note(`That industry didn't load: ${e.message}`));
});
$("gear").addEventListener("click", () => { paintSettings(); form.querySelector(".advanced").open = false; dlg.showModal(); });
// Click outside the box closes it.
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
form.esri.addEventListener("change", () => store.set("esriLicence", form.esri.checked ? "yes" : null));
form.nonCommercial.addEventListener("change", () => store.set("nonCommercial", form.nonCommercial.checked ? "yes" : null));
form.shareSessions.addEventListener("change", () => store.set("shareSessions", form.shareSessions.checked ? null : "no"));
// "settings" in the welcome card's note opens the dialog at the sharing switch.
document.querySelectorAll("[data-open-settings]").forEach((b) => b.addEventListener("click", () => {
  paintSettings(); dlg.showModal();
  form.querySelector(".advanced").open = true; // the sharing switch lives under Advanced
  form.shareSessions.closest("fieldset").scrollIntoView({ block: "nearest" });
  form.shareSessions.focus();
}));
form.querySelectorAll('input[name="units"]').forEach((r) => r.addEventListener("change", () => {
  if (!r.checked) return;
  store.set("units", U.setUnits(r.value));
  scaleCtl.setUnit(U.UNIT_SETS[U.getUnits()].scale);
  // Everything on screen that shows a distance or an area is redrawn; nothing is re-measured.
  places.forEach((p) => refreshCard(p));
  runs.forEach((e) => paintRun(e));
  if (ringsArgs) { ringsAround = null; drawRings(...ringsArgs); }
}));
form.querySelectorAll("[data-colour]").forEach((b) => b.addEventListener("click", () => { setShapeColour(b.dataset.colour); paintSettings(); }));
form.colour.addEventListener("input", () => { setShapeColour(form.colour.value); paintSettings(); });
form.querySelector('[data-op="key-save"]').addEventListener("click", () => {
  const k = form.key.value.trim();
  if (!k) return;
  if (!/^sk-ant-/.test(k)) { $("key-status").textContent = "That doesn't look like an Anthropic key (they start sk-ant-). Nothing was changed."; return; }
  setUserKey(k); paintSettings();
});
form.querySelector('[data-op="key-clear"]').addEventListener("click", () => { setUserKey(""); paintSettings(); });
form.key.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); form.querySelector('[data-op="key-save"]').click(); } });
