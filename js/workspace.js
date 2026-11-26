// The workspace page: map, drawing and editing tools, and the conversation with the analyst.
// Places are the record; cards are views of them. The analyst sees a compact project summary each turn.
import { TerraDraw, TerraDrawMapLibreGLAdapter, TerraDrawSelectMode, TerraDrawPointMode, TerraDrawLineStringMode,
  TerraDrawPolygonMode, TerraDrawRectangleMode, TerraDrawCircleMode } from "./vendor/draw.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { placeToolDefs, createPlaceTools, projectSummary } from "./placetools.js";
import { parseSkill, systemPrompt, buildMessages, runTurn, activityFor } from "./converse.js";
import { finishTurn, runReply } from "./runreply.js";
import { offerSummary, lower as lowerLabel } from "./bringin.js";
import * as SV from "./servicesite.js";
import { callClaude, LimitReached } from "./claude.js";
import { atlasViaWorker, firmsViaWorker, epsgViaWorker } from "./atlasclient.js";
import { CONFIG } from "./config.js";
import { TOPICS, topicOf, topicInfo, colourExpression, themeFor, bandOf, BAND_OPACITY, BIG_AREA_KM2, chooseLabels, ringDistances } from "./findings.js";
import { createScreening, evidenceOf, evidenceWithin, nearestByTheme, flagBeyond, reassess, isArea } from "./ntrrun.js";
import { groupGaps, gapSummary, GAP_GROUPS } from "./gaps.js";
import { checksView, noCheckGap } from "./checks.js";
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
import { buildTree } from "./sitetree.js";
import { saveProject, loadProject, listProjects, placeSnapshot, projectName, newProjectId } from "./projectstore.js";
import { readFiles, placesFromFile, resolveLayer, LIST_MAX } from "./fileimport.js";
import { createEpsgTools } from "./epsgtools.js";
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
  // Findings: features from data searches, drawn by topic (js/findings.js). They stay for the session,
  // until the person clears them; a later search never wipes them (Rosebank, 17 Nov). Big areas sit underneath,
  // quiet; distance from the site sets the emphasis.
  const themeColour = colourExpression();
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
  // An area budget's shapes (the developable area): what was taken off, by topic; soft constraints dashed; what's left
  // outlined strongly. Its own layer: it changes only when another run is shown.
  map.addSource("budget", { type: "geojson", data: turf.featureCollection([]) });
  map.addLayer({ id: "budget-taken", type: "fill", source: "budget", filter: ["==", ["get", "part"], "taken"], paint: { "fill-color": themeColour, "fill-opacity": 0.42 } });
  map.addLayer({ id: "budget-net", type: "fill", source: "budget", filter: ["==", ["get", "part"], "net"], paint: { "fill-color": C.sea, "fill-opacity": 0.16 } });
  map.addLayer({ id: "budget-soft", type: "line", source: "budget", filter: ["==", ["get", "part"], "soft"], paint: { "line-color": themeColour, "line-width": 1.6, "line-dasharray": [2, 2] } });
  map.addLayer({ id: "budget-net-line", type: "line", source: "budget", filter: ["==", ["get", "part"], "net"], paint: { "line-color": C.sea, "line-width": 2.4 } });
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
  window.__ws = { map, draw, places, ref, host, runs, project: () => project }; // for testing in the browser console
  restoreProject();
}

// ---- projects kept in this browser (js/projectstore.js) ---------------------------------------------------------
// The places and screens are saved as they change and put back on reload. Nothing leaves the browser. A new project
// keeps the old one, which the sites-and-screens strip can open again.
const project = { id: store.get("project") || null, created_at: null, restoring: false, earlier: [] };
let saveTimer = null;
let resumeOffer = null; // { saved, card } while the person hasn't chosen Resume or Start new
function saveSoon() {
  if (project.restoring) return;
  // New work before the person chose Resume or Start new: it's a new project, and the old one stays as it was.
  if (resumeOffer) startFresh();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!places.size && !runs.size) return;
    if (!project.id) { project.id = newProjectId(); project.created_at = new Date().toISOString(); store.set("project", project.id); }
    const list = [...places.values()];
    try {
      await saveProject({ id: project.id, name: projectName(list), created_at: project.created_at || new Date().toISOString(), updated_at: new Date().toISOString(),
        places: list.map(placeSnapshot), runs: [...runs.values()].map((e) => e.record), counts: { ...counts } });
    } catch (e) { console.warn("Couldn't save the project in this browser:", e); }
  }, 700);
}
async function restoreProject() {
  try { project.earlier = (await listProjects()).filter((p) => p.id !== project.id); } catch { project.earlier = []; }
  if (!project.id) { paintTree(); return; }
  let saved = null;
  try { saved = await loadProject(project.id); } catch { /* no store: start empty */ }
  if (!saved || (!saved.places?.length && !saved.runs?.length)) { paintTree(); return; }
  // Ask first (Rob, 24 Nov): restored run cards without their conversation looked like stray old runs. The page opens
  // empty, with one line offering the last project back.
  let chosen = null;
  try { chosen = sessionStorage.getItem("tobler-open-project"); sessionStorage.removeItem("tobler-open-project"); } catch { /* no session storage */ }
  if (chosen === project.id) { applyRestore(saved); return; }
  offerResume(saved);
  paintTree();
}
function offerResume(saved) {
  const nSites = saved.places?.length || 0, nRuns = saved.runs?.length || 0;
  const card = el("div", null, "msg analyst resume");
  const when = saved.updated_at ? new Date(saved.updated_at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  card.append(el("p", `Pick up where you left off? ${saved.name || "Your last project"}: ${nSites} site${nSites === 1 ? "" : "s"}${nRuns ? `, ${nRuns} screen${nRuns === 1 ? "" : "s"}` : ""}${when ? `, last changed ${when}` : ""}.`));
  const row = el("div", null, "picks");
  const resume = el("button", "Resume", "chip primary"); resume.type = "button"; resume.dataset.op = "resume";
  const fresh = el("button", "Start new", "chip"); fresh.type = "button"; fresh.dataset.op = "fresh";
  resume.addEventListener("click", () => { const s = resumeOffer?.saved; card.remove(); resumeOffer = null; if (s) applyRestore(s); });
  fresh.addEventListener("click", () => startFresh());
  row.append(resume, fresh);
  card.append(row);
  $("conversation").prepend(card); // first, above the welcome card: someone coming back sees it before the pitch
  resumeOffer = { saved, card };
  expandSheet(); // on a phone the sheet starts lowered; the question needs to be seen
}
// Start new without a reload: the last project stays saved and listed under Sites and screens.
function startFresh() {
  if (!resumeOffer) return;
  const { saved, card } = resumeOffer;
  resumeOffer = null;
  card.remove();
  project.id = null; project.created_at = null;
  store.set("project", null);
  project.earlier = [{ id: saved.id, name: saved.name, updated_at: saved.updated_at, sites: saved.places?.length || 0, screens: saved.runs?.length || 0 }, ...project.earlier.filter((x) => x.id !== saved.id)];
  paintTree();
}
function applyRestore(saved) {
  project.restoring = true;
  project.created_at = saved.created_at;
  try {
    for (const snap of saved.places || []) {
      const mode = snap.feature.geometry.type === "Point" ? "point" : /LineString/.test(snap.feature.geometry.type) ? "linestring" : "polygon";
      const { main } = splitParts(snap.feature.geometry);
      const bad = draw.addFeatures([{ id: snap.id, type: "Feature", geometry: main, properties: { mode } }]).find((v) => !v.valid);
      if (bad) continue;
      const p = newPlace(snap.id, snap.feature, { status: snap.status, origin: snap.origin, extraParts: snap.extraParts || [], name: snap.name, given: snap.given });
      Object.assign(p, { alias: snap.alias, edits: snap.edits || [], former: snap.former, scale: snap.scale, scaleFrom: snap.scaleFrom || p.scaleFrom });
      paintStatus(p);
      refreshCard(p);
    }
    Object.assign(counts, saved.counts || {});
    for (const record of saved.runs || []) {
      host.screening.restore(record);
      showRun(record);
    }
    checkRuns();
    // Back to where they were: the newest screen on the map, or the last site, once the map has settled.
    const last = [...runs.values()].at(-1);
    const lastPlace = [...places.values()].at(-1);
    const back = () => {
      if (last) showRunOnMap(last.record, { instant: true });
      else if (lastPlace) map.fitBounds(turf.bbox(lastPlace.feature), { padding: fitPadding(), maxZoom: 14, duration: 0 });
    };
    back();
    map.once("idle", back);
    const nSites = saved.places?.length || 0, nRuns = saved.runs?.length || 0;
    note(`Picked up where you left off: ${nSites} site${nSites === 1 ? "" : "s"}${nRuns ? ` and ${nRuns} screen${nRuns === 1 ? "" : "s"}` : ""}, kept in this browser.`);
  } finally {
    project.restoring = false;
  }
  paintTree();
}
// A new project: the current one stays saved; the page starts again empty.
function newProject() {
  store.set("project", null);
  location.reload();
}
function openProject(id) {
  store.set("project", id);
  // Opened from the list on purpose: restore it at once, without asking (js/workspace.js offerResume).
  try { sessionStorage.setItem("tobler-open-project", id); } catch { /* private mode: it asks instead */ }
  location.reload();
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
    paintTree();
  });
}
const isGuide = (f) => ["selectionPoint", "midPoint", "closingPoint", "snappingPoint", "coordinatePoint"].some((k) => f.properties?.[k]);

function showCandidates(list) {
  const feats = list.map((c) => ({ type: "Feature", geometry: c.geometry, properties: { label: c.name || c.type || "" } }));
  map.getSource("cands")?.setData(turf.featureCollection(feats));
}

// Findings stay until cleared, one entry per feature id, drawn by topic; the analyst can bring them into view with
// show_on_map. The legend (#key) lists the topics with counts and lets the person switch each off. A finding's
// "theme" property holds its topic id, normalised as it comes in (older records carry the six IFC-based themes).
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
  const theme = topicOf(meta.theme || themeFor({}));
  for (const c of list) {
    findings.set(c.id, { type: "Feature", geometry: c.geometry, properties: {
      id: c.id, label: c.name || c.type || "", theme, band: bandOf(c.distance_km), distance_km: c.distance_km ?? null,
      area_km2: c.area_km2 ?? null, dataset: meta.dataset || "", publisher: meta.publisher || c.source?.publisher || "",
    } });
  }
  // No distance rings for a search: rings are a run's bands, drawn from its card (Rob, 25 Nov: a search for the solar
  // farm near Castle Acre drew 1/5/20 km rings there before any site was confirmed, and they read as a screen).
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
  setFocus(null);
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
// The map key: one row per topic on the map, with a count and a switch; doubles as the list of what's shown.
let keyOpen = null;
function drawKey() {
  const key = $("key");
  if (!key) return;
  const counts = new Map();
  for (const f of findings.values()) counts.set(f.properties.theme, (counts.get(f.properties.theme) || 0) + 1);
  key.hidden = !counts.size;
  if (!counts.size) return;
  const list = key.querySelector("ul");
  list.replaceChildren(...Object.entries(TOPICS).filter(([k]) => counts.has(k)).map(([k, t]) => {
    const li = document.createElement("li");
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox"; box.checked = !hiddenThemes.has(k);
    box.addEventListener("change", () => { box.checked ? hiddenThemes.delete(k) : hiddenThemes.add(k); drawFindings(); });
    const sw = document.createElement("span"); sw.className = "swatch"; sw.style.background = t.colour;
    label.append(box, sw);
    // The topic's name opens its findings by distance from the site, nearest first (24 Nov).
    const name = el("button", null, "key-name");
    name.type = "button";
    name.append(document.createTextNode(`${t.label} `), Object.assign(document.createElement("span"), { className: "count", textContent: counts.get(k) }));
    name.setAttribute("aria-expanded", String(keyOpen === k));
    name.addEventListener("click", () => { keyOpen = keyOpen === k ? null : k; if (focusOwner?.closest("#key")) setFocus(null); drawKey(); });
    li.append(label, name);
    if (keyOpen === k) {
      const items = [...findings.values()].filter((f) => f.properties.theme === k)
        .sort((a, b) => (a.properties.surrounds ? 1e9 : a.properties.distance_km ?? 1e9) - (b.properties.surrounds ? 1e9 : b.properties.distance_km ?? 1e9))
        .map((f) => ({ id: f.properties.id, name: f.properties.label, distance_km: f.properties.distance_km, around: !!f.properties.surrounds, dataset: f.properties.dataset }));
      li.append(featureList(items, { record: shownRun ? runs.get(shownRun)?.record : null, label: t.label }));
    }
    return li;
  }));
}

$("key-clear")?.addEventListener("click", () => clearFindings());
if (phone) $("key")?.removeAttribute("open");

// Tap a finding: its name, theme, distance and source, and which checks counted it.
let popup = null;
function findingPopup(e) {
  if (draw && draw.getMode() !== "select") return;
  const f = e.features?.[0];
  if (!f) return;
  openPopup(f.properties, e.lngLat);
}
function openPopup(p, lngLat) {
  const box = document.createElement("div");
  box.className = "finding-pop";
  const name = document.createElement("b"); name.textContent = p.label || "Unnamed feature";
  const what = document.createElement("span");
  const km = p.surrounds ? "around the site (a wide area it lies within) · " : p.in_search_area ? `${whereText(p)} · ` : p.distance_km == null || p.distance_km === "null" ? "" : +p.distance_km === 0 ? "on site · " : `${U.dist(+p.distance_km)} from the site · `;
  // The publisher only when the layer's title doesn't already name it ("... (JNCC)").
  const pub = p.publisher && !/\([^)]*\)\s*$/.test(p.dataset || "") && !String(p.dataset || "").includes(p.publisher) ? ` (${p.publisher})` : "";
  what.textContent = `${topicInfo(p.theme).label} · ${km}${p.dataset}${pub}`;
  box.append(name, what);
  // Which of the run's checks counted it: the way back from the map to the card.
  const [runId, fid] = String(p.id || "").split(":");
  const counted = fid ? (runs.get(runId)?.record.tobler_run.checks || []).filter((c) => c.features?.some((x) => x.fid === fid)).map((c) => c.label) : [];
  if (counted.length) box.append(el("span", `Counted in: ${counted.join("; ")}`, "counted"));
  if (p.added === true || p.added === "true") box.append(el("span", "Brought in after the run; not part of its judgement", "counted"));
  popup?.remove();
  popup = new maplibregl.Popup({ closeButton: true, maxWidth: "280px" }).setLngLat(lngLat).setDOMContent(box).addTo(map);
}

// A list of features by distance from the site (a check's, or one row of the map key's), the nearest ten first, with
// "Show all" and a way to put them all on the map. Tapping a row flies the map to it and opens its popup. items:
// { id (a findings id, when it's on the map), name, distance_km, around, coverage, detail, publisher | dataset }.
const LIST_FIRST = 10;
// The source as a row shows it: the layer's title without the publisher in brackets (the popup has the publisher).
const layerTitle = (f) => String(f.dataset || f.publisher || "").replace(/\s*\([^()]*\)\s*$/, "").trim();
// Rows with the same name from the same layer are one feature in parts (two outlines of Castledike Wood): one row,
// at its nearest part, saying how many (Rob, 24 Nov). Nearest first, as given.
function groupParts(items) {
  const rows = [], by = new Map();
  for (const f of items) {
    const k = `${String(f.name || "").toLowerCase()}|${layerTitle(f).toLowerCase()}`;
    const g = f.name ? by.get(k) : null;
    if (g) { g.parts++; if (f.id) g.ids.push(f.id); if (!g.id && f.id) g.id = f.id; continue; }
    const row = { ...f, parts: 1, ids: f.id ? [f.id] : [] };
    rows.push(row);
    if (f.name) by.set(k, row);
  }
  return rows;
}
function featureList(rawItems, { record = null, label = "" } = {}) {
  const box = el("div", null, "feat-list");
  const items = groupParts(rawItems);
  // One layer for the whole list: name it once above the rows instead of on each.
  const layers = [...new Set(items.map(layerTitle).filter(Boolean))];
  const one = layers.length === 1 ? (rawItems.find((f) => f.dataset || f.publisher)?.dataset || rawItems.find((f) => f.publisher)?.publisher) : null;
  const ol = el("ol");
  const row = (f) => {
    const li = el("li");
    const b = el("button", null, "feat");
    b.type = "button";
    const where = f.around ? "around the site" : f.coverage ? `${Math.max(1, Math.round(f.coverage * 100))}% of the site` : f.distance_km == null ? "" : f.distance_km === 0 ? "on site" : U.dist(f.distance_km);
    const name = f.name || "Unnamed";
    const layer = layerTitle(f);
    // The layer goes on the row only when the list mixes layers, and not when it's the feature's name already.
    const meta = [f.detail, f.parts > 1 ? `${f.parts} parts` : "", !one && layer && layer.toLowerCase() !== name.toLowerCase() ? layer : ""].filter(Boolean).join(" · ");
    const head = el("span", null, "feat-head");
    head.append(...(where ? [el("strong", where, "feat-dist")] : []), el("span", name, "feat-name"));
    b.append(head, ...(meta ? [el("span", meta, "feat-meta")] : []));
    if (!f.id) { b.disabled = true; b.title = "Not on the map in this view"; }
    b.addEventListener("click", (e) => { e.stopPropagation(); flyToFinding(f.id, record); });
    li.append(b);
    return li;
  };
  let all = false;
  const paint = () => {
    ol.replaceChildren(...(all ? items : items.slice(0, LIST_FIRST)).map(row));
    more.hidden = all || items.length <= LIST_FIRST;
  };
  const more = el("button", `Show all ${items.length}`, "feat-more");
  more.type = "button";
  more.addEventListener("click", (e) => { e.stopPropagation(); all = true; paint(); });
  const onMap = el("button", "Show these on the map", "feat-map");
  onMap.type = "button";
  onMap.addEventListener("click", (e) => {
    e.stopPropagation();
    if (focus && focusOwner === box) { setFocus(null); return; }
    const ids = [...new Set(items.flatMap((f) => f.ids || [f.id]).filter(Boolean))];
    if (innerWidth <= 720) setSheet(false);
    showFeatureSet(record, ids, { fit: true, ids: true });
    setFocus(ids, box);
  });
  box.setAttribute("aria-label", label ? `${label}: features by distance from the site` : "Features by distance from the site");
  box.append(...(one ? [el("p", `From ${one}`, "feat-src")] : []), ol, more, onMap);
  paint();
  return box;
}
// "Show these on the map" (Rob, 24 Nov: it seemed to do nothing, as the set was already on the map): only the set at
// full strength, every other finding faded, until "Show all findings" or the list closes. focus: finding ids.
let focus = null, focusOwner = null;
const FADED = 0.08;
const FOCUS_PAINT = [["find-fill", "fill-opacity"], ["find-line", "line-opacity"], ["find-pt", "circle-opacity"], ["find-pt", "circle-stroke-opacity"], ["find-label", "text-opacity"]];
const focusBase = new Map();
function paintFocus() {
  for (const [layer, prop] of FOCUS_PAINT) {
    if (!map.getLayer(layer)) continue;
    const k = `${layer}|${prop}`;
    if (!focusBase.has(k)) focusBase.set(k, map.getPaintProperty(layer, prop) ?? 1);
    const base = focusBase.get(k);
    map.setPaintProperty(layer, prop, focus ? ["case", ["in", ["get", "id"], ["literal", [...focus]]], base, FADED] : base);
  }
  document.querySelectorAll(".feat-map").forEach((b) => { b.textContent = focus && b.closest(".feat-list") === focusOwner ? "Show all findings" : "Show these on the map"; });
}
function setFocus(ids, owner = null) {
  focus = ids?.length ? new Set(ids) : null;
  focusOwner = focus ? owner : null;
  paintFocus();
}
// Outline a set of findings on the map (a check's, or a key row's) and fit to them with the site. A wide area the
// site merely lies within (a zone round it, a sea) is left out of the fit, so the map doesn't zoom out to it.
function showFeatureSet(record, idsOrFids, { fit = true, ids = false } = {}) {
  if (record && shownRun !== record.tobler_run.id) showRunOnMap(record, { fit: false });
  const keys = ids ? idsOrFids : idsOrFids.map((fid) => `${record.tobler_run.id}:${fid}`);
  const feats = keys.map((k) => findings.get(k)).filter(Boolean);
  map.getSource("hl")?.setData(turf.featureCollection(feats));
  if (!fit || !feats.length) return;
  const site = record?.features.find((f) => f.properties.role === "site");
  const near = feats.filter((f) => !f.properties.surrounds);
  map.fitBounds(turf.bbox(turf.featureCollection([...(near.length ? near : feats), ...(site ? [site] : [])])), { padding: fitPadding(), maxZoom: 15 });
}
// One feature: fly to it, outline it and open its popup. On a phone the sheet lowers so the map shows.
function flyToFinding(id, record) {
  if (!id) return;
  if (record && shownRun !== record.tobler_run.id) showRunOnMap(record, { fit: false });
  const f = findings.get(id);
  if (!f) return;
  if (innerWidth <= 720) setSheet(false);
  hiddenThemes.delete(f.properties.theme);
  if (f.properties.distance_km > findingLimit) { findingLimit = f.properties.distance_km; drawFindings(); }
  map.getSource("hl")?.setData(turf.featureCollection([f]));
  const at = f.geometry.type === "Point" ? f.geometry.coordinates : turf.pointOnFeature(f).geometry.coordinates;
  // The feature with the site, so it's seen where it is relative to it (a wide area around the site: just centre on it).
  const site = (record || (shownRun ? runs.get(shownRun)?.record : null))?.features.find((x) => x.properties.role === "site");
  if (f.properties.surrounds) map.flyTo({ center: at, zoom: Math.max(map.getZoom(), 8) });
  else map.fitBounds(turf.bbox(turf.featureCollection([f, ...(site ? [site] : [])])), { padding: fitPadding(), maxZoom: 15, duration: 600 });
  openPopup(f.properties, at);
}
// Which check's list is open on a run card (one at a time).
function paintChecksOpen(card, entry) {
  card.querySelectorAll(".checks li.has-feats").forEach((li) => {
    const open = li.dataset.check === entry.openCheck;
    li.classList.toggle("open", open);
    li.querySelector(".check-line")?.setAttribute("aria-expanded", String(open));
  });
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
  paintChips();
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
let checksCatalogue = { checks: [], topics: [], scales: {} };
let irzCodes = null;
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
  // The checks every screen runs before the analyst starts (catalogue/checks.json, plan item 1).
  get checks() { return checksCatalogue; },
  // Natural England's SSSI Impact Risk Zone codes, decoded (catalogue/sssi_irz_codes.json, from the atlas).
  get irz() { return irzCodes; },
  // Settings (the gear): whether the person holds an Esri licence, so Esri-licensed layers can be used.
  esriLicence: () => store.get("esriLicence") === "yes",
  // Non-commercial data (e.g. WDPA): off by default; on only for people whose use allows it (Rob, 18 Nov).
  nonCommercial: () => store.get("nonCommercial") === "yes",
  // Count the same shape from two layers once in the checks: on by default (Rob, 24 Nov).
  mergeShapes: () => store.get("mergeShapes") !== "no",
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
  async resolveFileLayer(layer, operation) {
    if (!siteFile) throw new Error("No file is waiting.");
    const r = await resolveLayer(siteFile.file, layer, operation, { geodesy: fileGeodesy });
    paintFileCard();
    const { file } = siteFile;
    // One outline and nothing left to decide: it becomes the site at once. Otherwise the person picks from the card.
    const made = file.features.length === 1 && file.features[0].kind === "polygon" && !file.layers.some((l) => l.crs.pending);
    if (made) usePicked("parts", { force: true });
    return { ...r, site_made: made, ...(made ? {} : { features_waiting: file.features.length }) };
  },
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
  offerSkills: (name) => offerSkills(name),
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
  host, table: () => distTable, skill: screenSkill, skillFor: (name) => skills[name], callClaude, model: CONFIG.model,
  onRun: (record) => {
    const r = record.tobler_run;
    // The log keeps what the card shows, so a downloaded log explains the card on its own.
    runLog?.events.push({ screen_result: { run: r.id, distances: r.distances, baseline: r.baseline, sea: r.sea, flags: r.flags.map((f) => ({ risk: f.risk, theme: f.theme, confidence: f.confidence, nearest_km: f.nearest_km, evidence: f.evidence.map((e) => `${e.name} ${e.distance_km} km${e.traced ? "" : " (not traced)"}`) })),
      checked: r.checked.map((c) => `${c.dataset}: ${c.result}${c.count ? ` ${c.count}` : ""}${c.why ? ` (${c.why})` : ""}`), gaps: r.data_gaps, ...(r.parse_error ? { problem: r.parse_error } : {}),
      ...(r.debug ? { debug: r.debug } : {}), ...(r.note ? { note: r.note } : {}), usage: r.usage } });
    stopProgress(record);
    const site = placeByName(r.site?.name || "");
    // A screen's asset type is the place's; a study's isn't (the developable area has its own few types).
    if (site && r.site.asset_type && !r.study) site.assetType = r.site.asset_type;
    showRun(record);
    if (r.offer?.items?.some((x) => x.state === "offered")) showOffer(record);
  },
  onEvent: (ev) => {
    progressEvent(ev);
    if (ev.type === "tool_start") activity(`Screening: ${activityFor(ev.name, ev.input)}…`, true);
    if (ev.type === "offer_start") activity(`${activityFor("offer_start")}…`, true);
    if (ev.type === "offer") runLog?.events.push({ offer: { run: ev.run, offered: ev.offered } });
    if (ev.type === "round") runLog?.events.push({ screen_model_round: ev.round, ms: ev.ms, tokens_in: ev.input_tokens, tokens_out: ev.output_tokens, tool_calls: ev.tools });
    if (ev.type === "tool") {
      runLog?.events.push({ screen_tool: ev.name, ...(ev.baseline ? { baseline: true } : {}), input: ev.input, ms: ev.ms, ...(ev.error ? { error: ev.error } : { output: ev.output }) });
      runSteps?.append(el("li", `Screen${ev.baseline ? " (baseline)" : ""}: ${ev.name === "nearest_boundaries" ? `Checked boundaries within ${ev.input.within_km} km: ${ev.output?.found?.length ? ev.output.found.join("; ") : "none in reach"}` : traceLine(ev)}`, ev.error ? "err" : ""));
    }
  },
});
const tools = createPlaceTools(host);
// The conversation doesn't load the NTR method itself: screen_site runs it as a sealed run.
// Nor the methods of studies that run sealed (the desk study, the developable area): loaded into the conversation, the
// desk study's Output section had the analyst rewrite the study in chat, JSON and all (review, 25 Nov).
const sealedSkills = () => new Set([profile?.skill || "ntr-screening", ...(profile?.skills_offered || []).map((s) => s.skill).filter(Boolean)]);
const conversationSkills = () => Object.values(skills).filter((s) => !sealedSkills().has(s.name));

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
  paintChips();
  return profile;
}

Promise.all([
  ...["skills/place-finding/SKILL.md", "skills/ntr-screening/SKILL.md", "skills/coordinate-reference/SKILL.md", "skills/contamination-desk-study/SKILL.md", "skills/developable-area/SKILL.md"].map((f) => fetch(asset(f)).then((r) => r.text()).then((t) => { const s = parseSkill(t); skills[s.name] = s; })),
  fetch(asset("catalogue/anchors.json")).then((r) => r.json()).then((j) => { anchors = j.sources; }),
  fetch(asset("catalogue/trusted.json")).then((r) => r.json()).then((j) => { trusted = j; }),
  fetch(asset("catalogue/checks.json")).then((r) => r.json()).then((j) => { checksCatalogue = j; }),
  fetch(asset("catalogue/sssi_irz_codes.json")).then((r) => r.json()).then((j) => { irzCodes = j; }),
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
    // A run held for this place: the yes runs exactly what was asked, from the page, with no model call (25 Nov).
    const held = tools.pendingFor(p);
    p.status = "accepted"; paintStatus(p); scheduleRefresh();
    if (held) {
      const whole = held.held === "which_part";
      send(whole ? `Use all of ${p.name}, as a rough first look.` : `Yes, use ${p.name}.`, undefined, { name: held.tool, input: { ...held.input, place: p.name, ...(whole ? { whole: true } : {}) } });
    } else send(`Yes, use ${p.name}.`);
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
// Datum transformations for files come from the live EPSG registry, chosen in code by where the data is, as for typed
// coordinates (js/epsgtools.js). Only a real judgement goes to the analyst and the coordinate-reference skill.
// Registry lookups are counted and timed per drop and shown on the card (Rob, 23 Nov: is a local copy worth it?).
let fileLookups = 0;
const fileGeodesy = createEpsgTools({ epsg: (q) => { fileLookups++; return epsgViaWorker(q); }, transformationChoice: () => "choose" }, () => null).fileGeodesy;
const kindWord = (k, n) => `${k}${n === 1 ? "" : "s"}`;
const fileSize = (f) => (f.size.area_ha != null ? U.area(f.size.area_ha / 100) : f.size.length_km != null ? U.dist(f.size.length_km) : f.size.points > 1 ? `${f.size.points} points` : "a point");

async function openSiteFile(files) {
  openTray(false);
  closeSiteFile("replaced");
  activity("Reading your file…", true);
  let file;
  const t0 = performance.now(), n0 = fileLookups;
  try { file = await readFiles(files, { geodesy: fileGeodesy }); file.lookup = { calls: fileLookups - n0, ms: Math.round(performance.now() - t0) }; }
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
  const waiting = file.layers.filter((l) => l.crs.pending);
  // One outline is the site: nothing to choose, unless its coordinates need a decision first.
  if (!waiting.length && file.features.length === 1 && file.features[0].kind === "polygon") { usePicked("parts"); return; }
  // A real judgement about the coordinates: the analyst asks, following the coordinate-reference skill.
  if (waiting.length && !busy) {
    const lines = waiting.map((l) => `${l.name}: ${l.crs.name}. ${l.crs.pending.why}${l.crs.pending.options?.length ? ` Options: ${l.crs.pending.options.map((o) => `EPSG:${o.code} ${o.name} (${o.accuracy_m ?? "?"} m${o.can_apply ? "" : ", can't be applied here"})`).join("; ")}.` : ""}`);
    send(`I've dropped ${file.name}.`, `I've dropped ${file.name}.\n[The page read the file but its coordinates need a decision before it can be used: ${lines.join(" | ")} Load the coordinate-reference skill and follow its section 4: ask the person one short question in words (recommended option first, with its accuracy; "none" means using it with no datum shift, flagged). When they answer, call set_file_transformation. Don't use the file's features until then.]`);
  }
}

function paintFileCard() {
  if (!siteFile) return;
  const { file, card, picked, width } = siteFile;
  const crsLine = card.querySelector(".crs");
  crsLine.textContent = `Coordinates: ${[...new Set(file.layers.map((l) => l.crs.how))].join("; ")}.${file.layers.some((l) => l.crs.pending) ? " Waiting for your answer in the chat." : ""}${file.lookup?.calls ? ` (Read in ${(file.lookup.ms / 1000).toFixed(1)} s, with ${file.lookup.calls} registry lookups.)` : ""}`;
  crsLine.classList.toggle("warn", file.layers.some((l) => l.crs.guessed || l.crs.warning || l.crs.pending || l.crs.fallback));
  card.querySelectorAll(".feats input").forEach((b) => { b.checked = picked.has(b.value); });
  const chosen = file.features.filter((f) => picked.has(f.fid));
  const thin = [...new Set(chosen.filter((f) => f.kind !== "polygon").map((f) => `${f.kind}s`))];
  card.querySelector(".width").hidden = !thin.length;
  card.querySelector(".width .what").textContent = thin.join(" and ");
  card.querySelectorAll("[data-w]").forEach((b) => b.classList.toggle("on", +b.dataset.w === width));
  const ready = chosen.length > 0 && (!thin.length || width > 0) && !chosen.some((f) => file.layers.find((l) => l.name === f.layer)?.crs.pending);
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

function usePicked(combine, { force = false } = {}) {
  if (!siteFile) return;
  if (busy && !force) { siteFile.card.querySelector(".notes").textContent = "The analyst is busy; try again in a moment."; return; }
  const { file, picked, width, card } = siteFile;
  let built;
  try { built = placesFromFile(file, { fids: [...picked], combine, buffer_m: width }); }
  catch (e) { card.querySelector(".notes").textContent = e.message; return; }
  // From a service, after a datum decision (js/servicesite.js): the place says it came from the service, not a file.
  if (file.service) for (const b of built) b.origin = SV.serviceOrigin(b.origin, file.service);
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

// ---- a site from a map or feature service (26 Nov; claude/site-from-service-spec.md) -----------------------------
// The person pastes an ArcGIS REST address. It doesn't go to the analyst: a panel opens with the service drawn in it,
// they click the feature(s) that are their site, and the outline comes in through the file pipeline (the datum chosen
// from the registry, not trusted to the server). The service isn't kept. Requests go straight from this page to the
// service, with the browser's own login if it needs one, or a token kept only in this closure.
let svcOpen = null;
const svcEl = (sel) => $("svc-panel").querySelector(sel);
const SVC_NAME_KEYS = [/^name$/i, /^site_?name$/i, /^title$/i, /^label$/i, /name/i, /^ref(erence)?$/i];
const svcLabel = (a, layer, id) => { const k = Object.keys(a || {}).find((x) => SVC_NAME_KEYS.some((re) => re.test(x)) && a[x] != null && String(a[x]).trim() && String(a[x]).length <= 80); return k ? String(a[k]).trim() : `${layer.name} ${id ?? ""}`.trim(); };
async function openServicePanel(svc) {
  closeServicePanel();
  const panel = $("svc-panel");
  const state = { token: svc.token || null, credentialed: false, secured: false };
  const S = { svc, state, info: null, layer: null, picked: new Map(), buffer: null, map: null, shown: null };
  svcOpen = S;
  panel.hidden = false;
  svcEl(".svc-title").textContent = `${svc.host} · ${svc.url.split("/rest/services/")[1] || svc.url}${svc.token ? " (the token in the address is used here, not kept)" : ""}`;
  svcEl(".svc-signin").hidden = true; svcEl(".svc-layers").hidden = true; svcEl(".svc-picked").hidden = true;
  svcEl('[data-op="svc-use"]').disabled = true;
  const status = (t) => { svcEl(".svc-status").textContent = t; };
  status("Reading the service…");
  const c = map.getCenter();
  // The same background as the main map; a plain one if that can't be reached (as the main map falls back).
  const plain = { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef2f1" } }] };
  S.map = new maplibregl.Map({ container: "svc-map", style: fellBack ? plain : BASEMAP, center: [c.lng, c.lat], zoom: Math.max(map.getZoom(), 2), attributionControl: false,
    // The browser's own login, or the token, on the service's tiles; nothing for anyone else's.
    transformRequest: (url) => (url.startsWith(svc.base) ? { url: state.token && !/[?&]token=/.test(url) ? `${url}&token=${encodeURIComponent(state.token)}` : url, credentials: state.credentialed ? "include" : "omit" } : undefined) });
  S.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
  let styled = false;
  const ready = new Promise((ok) => S.map.once("style.load", () => { styled = true; ok(); }));
  S.map.on("error", (e) => { if (!styled && /style|fetch|Failed|NetworkError/i.test(String(e?.error?.message || ""))) { styled = true; S.map.setStyle(plain); S.map.once("style.load", () => ready.then(() => {})); } });
  const loaded = Promise.race([ready, new Promise((ok) => S.map.once("styledata", () => setTimeout(ok, 50)))]).then(() => new Promise((ok) => (S.map.isStyleLoaded() ? ok() : S.map.once("style.load", ok))));
  try {
    S.info = await SV.describeService(svc, state);
  } catch (e) { if (svcOpen === S) showSignIn(S, e); return; }
  await loaded;
  if (svcOpen !== S) return;
  status(`${S.info.name}: ${S.info.layers.length === 1 ? "one layer" : `${S.info.layers.length} layers`}. Click a feature to pick it; click again to drop it.`);
  for (const id of ["svc-pick-fill", "svc-pick-line"]) if (S.map.getLayer(id)) S.map.removeLayer(id);
  S.map.addSource("svc-pick", { type: "geojson", data: turf.featureCollection([]) });
  S.map.addSource("svc-feat", { type: "geojson", data: turf.featureCollection([]) });
  S.map.addLayer({ id: "svc-feat-fill", type: "fill", source: "svc-feat", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#0b6e8a", "fill-opacity": 0.12 } });
  S.map.addLayer({ id: "svc-feat-line", type: "line", source: "svc-feat", paint: { "line-color": "#0b6e8a", "line-width": 1.2 } });
  S.map.addLayer({ id: "svc-feat-pt", type: "circle", source: "svc-feat", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 4, "circle-color": "#0b6e8a" } });
  S.map.addLayer({ id: "svc-pick-fill", type: "fill", source: "svc-pick", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": "#e4572e", "fill-opacity": 0.3 } });
  S.map.addLayer({ id: "svc-pick-line", type: "line", source: "svc-pick", paint: { "line-color": "#e4572e", "line-width": 2.5 } });
  S.map.addLayer({ id: "svc-pick-pt", type: "circle", source: "svc-pick", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": "#e4572e", "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
  const layers = svcEl(".svc-layers");
  layers.replaceChildren();
  if (S.info.layers.length > 1) {
    layers.hidden = false;
    for (const l of S.info.layers) { const b = el("button", `${l.name} (${l.geometry}s)`); b.type = "button"; b.dataset.layer = l.id; b.addEventListener("click", () => setServiceLayer(S, l)); layers.append(b); }
  }
  setServiceLayer(S, S.info.layers.find((l) => l.geometry === "polygon") || S.info.layers[0]);
  S.map.on("moveend", () => drawServiceLayer(S));
  S.map.on("click", (e) => pickServiceFeature(S, e));
}
function setServiceLayer(S, layer) {
  if (S.layer && S.layer !== layer && S.picked.size) { S.picked.clear(); paintServicePicks(S); svcEl(".svc-status").textContent = `Switched to ${layer.name}: picks from the other layer were dropped (pick from one layer at a time).`; }
  S.layer = layer;
  svcEl(".svc-layers").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.layer === layer.id));
  if (S.map.getLayer("svc-img")) S.map.removeLayer("svc-img");
  if (S.map.getSource("svc-img")) S.map.removeSource("svc-img");
  // A map service draws itself, reprojected to Web Mercator by the server; a feature service's features in view are drawn here.
  if (S.svc.kind === "MapServer") {
    S.map.addSource("svc-img", { type: "raster", tileSize: 512, tiles: [`${S.svc.base}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=512,512&dpi=96&format=png32&transparent=true&f=image&layers=show:${layer.id}`] });
    S.map.addLayer({ id: "svc-img", type: "raster", source: "svc-img" }, "svc-feat-fill");
    S.map.getSource("svc-feat").setData(turf.featureCollection([]));
  } else drawServiceLayer(S);
}
let svcDrawSeq = 0;
async function drawServiceLayer(S) {
  if (svcOpen !== S || S.svc.kind !== "FeatureServer" || !S.layer) return;
  const b = S.map.getBounds();
  const seq = ++svcDrawSeq;
  try {
    const got = await SV.featuresInBox(S.svc, S.layer, [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((v) => Math.round(v * 1e5) / 1e5), S.state);
    if (seq !== svcDrawSeq || svcOpen !== S) return;
    S.map.getSource("svc-feat").setData(turf.featureCollection(got.features));
    if (got.capped) svcEl(".svc-status").textContent = "Only some features are drawn at this zoom; zoom in to see them all. Clicking still finds any feature.";
  } catch (e) { if (svcOpen === S) svcEl(".svc-status").textContent = `The features couldn't be drawn: ${e.message}`; }
}
async function pickServiceFeature(S, e) {
  if (!S.layer) return;
  const mpp = 40075016.686 * Math.cos(e.lngLat.lat * Math.PI / 180) / (512 * 2 ** S.map.getZoom());
  svcEl(".svc-status").textContent = "Looking at what's there…";
  let got;
  try { got = await SV.featuresAt(S.svc, S.layer, [e.lngLat.lng, e.lngLat.lat], 6 * mpp, S.state); }
  catch (err) { svcEl(".svc-status").textContent = `That didn't work: ${err.message}`; return; }
  if (!got.features.length) { svcEl(".svc-status").textContent = `Nothing on ${S.layer.name} there. Zoom in and click on a feature.`; return; }
  // The smallest feature under the click (a parcel inside a bigger zone).
  const f = got.features[0];
  const key = `${S.layer.id}:${f.id}`;
  if (S.picked.has(key)) S.picked.delete(key);
  else S.picked.set(key, { layer: S.layer, id: f.id, attributes: f.attributes, esri: f.geometry, wkid: got.wkid, label: svcLabel(f.attributes, S.layer, f.id), kind: f.geometry.rings ? "polygon" : f.geometry.paths ? "line" : "point" });
  await paintServicePicks(S);
}
async function paintServicePicks(S) {
  const picks = [...S.picked.values()];
  const box = svcEl(".svc-picked");
  box.hidden = !picks.length;
  svcEl(".svc-list").textContent = picks.length ? `Picked: ${picks.map((p) => p.label).join("; ")}.` : "";
  const thin = picks.some((p) => p.kind !== "polygon");
  svcEl(".svc-buffer").hidden = !thin;
  svcEl(".svc-buffer").querySelectorAll("[data-b]").forEach((b) => b.classList.toggle("on", +b.dataset.b === S.buffer));
  svcEl('[data-op="svc-use"]').disabled = !picks.length || (thin && !S.buffer);
  svcEl('[data-op="svc-use"]').textContent = picks.length > 1 ? `Bring in ${picks.length} features as the site` : "Bring in as the site";
  svcEl(".svc-status").textContent = picks.length ? "Click more to add them, or bring them in." : "Click a feature to pick it.";
  // Drawn from the server's WGS84 copy: for the highlight only.
  try {
    const shown = picks.length ? await SV.featuresWgs84(S.svc, S.layer, picks.map((p) => p.id), S.state) : [];
    if (svcOpen === S) S.map.getSource("svc-pick").setData(turf.featureCollection(shown.map((f) => ({ type: "Feature", properties: {}, geometry: f.geometry }))));
  } catch { /* the highlight is a nicety */ }
}
function showSignIn(S, err) {
  svcEl(".svc-status").textContent = "";
  const box = svcEl(".svc-signin");
  box.hidden = false;
  svcEl(".svc-why").textContent = err.needsSignIn
    ? `${err.message} If it's on your organisation's network, it should use your login when you're signed in to its portal; otherwise paste a token for it below.`
    : err.message;
}
function closeServicePanel() {
  const S = svcOpen;
  svcOpen = null;
  if (S) { S.state.token = null; try { S.map?.remove(); } catch { /* already gone */ } }
  $("svc-panel").hidden = true;
  svcEl(".svc-signin input").value = "";
}
async function useServicePicks() {
  const S = svcOpen;
  if (!S || busy) return;
  const picks = [...S.picked.values()];
  if (!picks.length) return;
  const btn = svcEl('[data-op="svc-use"]');
  btn.disabled = true;
  svcEl(".svc-status").textContent = "Bringing it in…";
  const meta = { url: S.svc.url, host: S.svc.host, kind: S.svc.kind, layer: S.layer.name, layerId: S.layer.id, ids: picks.map((p) => p.id), at: new Date().toISOString(),
    wkid: picks[0].wkid || S.layer.wkid || null, secured: !!S.state.secured, licence: "unknown" };
  // The service's own coordinates through the file pipeline; if Tobler can't convert them, the server's WGS84 copy.
  const asGeo = picks.map((p) => ({ attributes: { ...p.attributes, _label: p.label }, geojson: SV.esriToGeoJSON(p.esri) })).filter((p) => p.geojson);
  let file = null;
  try { file = await readFiles([SV.asFile(S.layer, asGeo, meta.wkid, S.layer.name)], { geodesy: fileGeodesy }); } catch { file = null; }
  if (!file?.features?.length) {
    try {
      const w = await SV.featuresWgs84(S.svc, S.layer, meta.ids, S.state);
      file = await readFiles([SV.asFile(S.layer, w.map((f) => ({ attributes: f.attributes, geojson: f.geometry })), 4326, S.layer.name)], {});
      meta.serverConverted = true;
    } catch (e) { svcEl(".svc-status").textContent = `It couldn't be brought in: ${e.message}`; btn.disabled = false; return; }
  }
  file.name = `${S.layer.name} (from the service)`;
  for (const f of file.features) f.label = f.props?._label || f.label;
  file.service = meta;
  closeServicePanel();
  // A datum that needs a judgement goes to the usual file card, where the analyst asks.
  if (file.layers.some((l) => l.crs.pending)) { showFileCard(file, [...file.skipped, ...file.notes]); return; }
  let built;
  try { built = placesFromFile(file, { fids: "all", combine: "parts", buffer_m: picks.some((p) => p.kind !== "polygon") ? S.buffer : null }); }
  catch (e) { note(`That couldn't become a site: ${e.message}`); return; }
  const made = built.map((b) => host.addPlace({ ...b, origin: SV.serviceOrigin(b.origin, meta), status: "accepted" }));
  const p = made[0];
  const reply = el("div", null, "msg analyst");
  reply.append(el("p", `Site set from ${meta.secured ? "your organisation's service" : S.svc.host}, layer ${meta.layer}: ${p.name} (${/Polygon/.test(p.feature.geometry.type) ? U.area(turf.area(p.feature) / 1e6) : "a point"}${picks.length > 1 ? `, ${picks.length} features joined` : ""}${p.origin.buffer_m ? `, ${p.origin.buffer_m} m round ${picks.length > 1 ? "them" : "it"}` : ""}). Coordinates: ${p.origin.crs?.how || "as given"}${meta.serverConverted ? "; converted to WGS 84 by the service itself, because Tobler couldn't convert its own coordinates: check the outline against the map" : ""}. The service isn't kept. Ask me to screen it when you're ready.`));
  $("conversation").append(reply);
  expandSheet();
  reply.scrollIntoView({ block: "end", behavior: "smooth" });
  sessionLog.push({ at: new Date().toISOString(), user: "[picked a site from a service]", events: [{ service_site: { layer: meta.secured ? "[secured]" : meta.layer, features: picks.length, wkid: meta.wkid, secured: meta.secured, server_converted: !!meta.serverConverted } }], reply: "[site set from a service]" });
}
document.querySelectorAll('#svc-panel [data-op="svc-close"]').forEach((b) => b.addEventListener("click", () => closeServicePanel()));
svcEl('[data-op="svc-use"]').addEventListener("click", () => useServicePicks());
svcEl(".svc-buffer").querySelectorAll("[data-b]").forEach((b) => b.addEventListener("click", () => { if (svcOpen) { svcOpen.buffer = +b.dataset.b; paintServicePicks(svcOpen); } }));
svcEl('[data-op="svc-token"]').addEventListener("click", () => {
  const S = svcOpen; const t = svcEl(".svc-signin input").value.trim();
  if (!S || !t) return;
  svcEl(".svc-signin input").value = "";
  const svc = { ...S.svc, token: t };
  openServicePanel(svc);
});
svcEl('[data-op="svc-file"]').addEventListener("click", () => { closeServicePanel(); $("site-file").click(); });

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
const TYPICAL_S = { offshore: 70, onshore: 100, inside: 45, study: 35 };
const timesKey = "screenTimes";
const pastTimes = () => { try { return JSON.parse(store.get(timesKey) || "{}"); } catch { return {}; } };
function estimateFor(kind) {
  const past = pastTimes()[kind] || [];
  if (past.length >= 2) {
    const sorted = [...past].sort((a, b) => a - b);
    return { secs: sorted[Math.floor(sorted.length / 2)], basis: `from your last ${past.length} screens` };
  }
  return { secs: TYPICAL_S[kind], basis: kind === "inside" ? "typical inside an area" : kind === "study" ? "typical for a desk study" : `typical for an ${kind} site` };
}
const fmtSecs = (s) => (s < 75 ? `${Math.max(10, Math.round(s / 5) * 5)} seconds` : `${Math.round((s / 60) * 2) / 2} minutes`.replace(".5 ", "½ ").replace(/^1 minutes/, "1 minute"));
let progress = null;
function startProgress(ev) {
  stopProgress(null);
  const kind = ev.study ? "study" : ev.inside ? "inside" : ev.setting;
  const est = estimateFor(kind);
  const box = el("div", null, "progress");
  const studyLabel = ev.study ? (profile?.skills_offered || []).find((x) => x.id === ev.study)?.label || "study" : null;
  box.append(el("p", `${studyLabel ? `Running the ${studyLabel.toLowerCase()} for` : "Screening"} ${ev.site}. This usually takes about ${fmtSecs(est.secs)} (${est.basis}); you can keep looking at the map meanwhile.`, "progress-title"));
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

// ---- sites and screens (js/sitetree.js): the places and the runs on each, like a GIS project's folders ----------
// Under the header, closed until there's a place; it keeps itself open or closed as the person left it.
let treeOpen = false;
function treeModel() {
  const size = (p) => {
    if (p.kind === "Point") return "";
    const g = withExtras(p, p.feature.geometry);
    if (p.kind === "Line") return U.dist(turf.length({ type: "Feature", properties: {}, geometry: g }, { units: "kilometers" }));
    return U.area(turf.area(g) / 1e6);
  };
  const runOf = (e) => {
    const r = e.record.tobler_run;
    return { id: r.id, time: new Date(r.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      flags: r.flags?.length ?? null, decision: r.decision?.value || "", outdated: !!e.change, replacedBy: r.replaced_by || null, shown: shownRun === r.id };
  };
  const all = [...runs.values()].reverse();
  // A suggestion the person hasn't taken up isn't a site yet, unless it's been screened.
  const model = [...places.values()].map((p) => ({
    id: p.id, name: p.name, kind: p.kind, size: size(p), proposed: p.status === "proposed", runs: all.filter((e) => e.record.tobler_run.place_id === p.id).map(runOf),
  })).filter((m) => !m.proposed || m.runs.length);
  // Runs whose place has gone (deleted) stay listed under the name they screened.
  const orphans = all.filter((e) => !places.has(e.record.tobler_run.place_id));
  for (const e of orphans) {
    const name = `${e.record.tobler_run.site.name} (removed)`;
    let s = model.find((m) => m.orphan && m.name === name);
    if (!s) model.push((s = { id: null, orphan: true, name, kind: "", size: "", runs: [] }));
    s.runs.push(runOf(e));
  }
  return model;
}
function paintTree() {
  const slot = $("sitetree");
  if (!slot) return;
  const model = treeModel();
  slot.hidden = !model.length;
  if (!model.length) { slot.replaceChildren(); return; }
  saveSoon();
  const tree = buildTree(model, {
    site: (id) => {
      const p = places.get(id);
      if (!p) return;
      focusPlace(p);
      if (innerWidth <= 720) setSheet(false);
      map.fitBounds(turf.bbox(p.feature), { padding: fitPadding(), maxZoom: p.kind === "Point" ? 13 : 15 });
    },
    run: (id) => {
      const e = runs.get(id);
      if (!e) return;
      showRunOnMap(e.record);
      e.card.scrollIntoView({ block: "start", behavior: "smooth" });
      paintTree();
    },
  }, { open: treeOpen, project: { earlier: project.earlier, onNew: newProject, onOpen: openProject } });
  tree.addEventListener("toggle", () => { treeOpen = tree.open; });
  slot.replaceChildren(tree);
}

// Put a run's evidence on the map (replacing other findings), up to the card's slider.
function showRunOnMap(record, { fit = true, instant = false } = {}) {
  const r = record.tobler_run;
  if (shownRun !== r.id) setFocus(null);
  findings.clear(); hiddenThemes.clear();
  // Layers brought in after the run (js/bringin.js) show with it, marked as added.
  for (const f of [...evidenceOf(record), ...record.features.filter((x) => x.properties?.role === "added")]) {
    const p = f.properties;
    const band = p.band === "on site" || p.band === SEARCH_BAND ? "near" : p.band === "beyond" || p.band === "unknown" ? "wider" : p.band;
    findings.set(`${r.id}:${p.fid}`, { type: "Feature", geometry: f.geometry, properties: {
      id: `${r.id}:${p.fid}`, run: r.id, label: p.name, theme: topicOf(p.theme), band: p.surrounds ? "wider" : band, ...(p.surrounds ? { surrounds: true } : {}),
      ...(p.in_search_area ? { in_search_area: true, ...(p.coverage != null ? { coverage: p.coverage } : {}), ...(p.side ? { side: p.side } : {}) } : {}), distance_km: p.distance_km, area_km2: p.area_km2 ?? null, dataset: p.dataset, publisher: p.publisher,
      ...(p.role === "added" ? { added: true } : {}),
    } });
  }
  shownRun = r.id;
  const site = record.features.find((f) => f.properties.role === "site");
  map.getSource("budget")?.setData(turf.featureCollection(record.features.filter((f) => f.properties.role === "budget")));
  findingLimit = runs.get(r.id)?.km ?? r.assessed_within_km;
  ringsAround = null;
  map.getSource("hl")?.setData(turf.featureCollection([]));
  drawFindings();
  paintMask();
  const inside = r.extent === "inside" || findingLimit === 0 || !!r.budget;
  if (fit) map.fitBounds(turf.bbox(inside ? site : turf.buffer(site, Math.max(r.distances.close, 1), { units: "kilometers", steps: 16 })), { padding: fitPadding(), maxZoom: 13, ...(instant ? { duration: 0 } : {}) });
  paintTree();
}

// Distance rings for a run: none when it's looking inside the area only.
const ringsFor = (r) => (r.extent === "inside" || r.budget ? [] : [r.distances.near, r.distances.close, r.fetched_to_km].filter((v, i, a) => v > 0 && a.indexOf(v) === i));

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
  queueMicrotask(paintTree);
  card.dataset.run = r.id;
  paintAdded(entry);
  card.querySelector(".site").textContent = r.site.name;
  if (r.study) card.querySelector(".kind").textContent = r.study.label;
  // Run id and time only: the method version and how long it took are in the report's Method section (Rob, 22 Nov).
  card.querySelector(".meta").textContent = `${r.id} · ${new Date(r.finished_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  card.querySelector(".meta").title = `Method ${r.skill.version}${r.screen_seconds ? `, took ${r.screen_seconds} s` : ""}`;
  // A study has no asset type or stage: its title says what it is.
  card.querySelector(".setup").textContent = (r.budget ? [`For a ${r.budget.asset_label}${r.budget.asset_assumed ? " (no asset type given)" : ""}`, "on the site's outline"]
    : r.study ? [r.site.setting, r.site.footprint] : [
    `${r.site.asset_label[0].toUpperCase()}${r.site.asset_label.slice(1)}${r.site.asset_assumed ? " (assumed)" : ""}`, r.site.stage, r.site.setting, r.site.footprint,
  ]).filter(Boolean).join(" · ");
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
  let moved = false;
  for (const entry of runs.values()) {
    const r = entry.record.tobler_run;
    const change = siteChange(entry.record, places.get(r.place_id) || null);
    const state = `${change?.text || ""}|${r.replaced_by || ""}`;
    if (state === entry.outdatedState) continue;
    moved = true;
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
  if (moved) paintTree();
}
function runSummaryLines() {
  const list = [...runs.values()];
  // Layers offered after a run and not yet answered (js/bringin.js), so a "yes" in words can be acted on.
  const offers = list.filter((e) => !e.record.tobler_run.replaced_by).map((e) => offerSummary(e.record.tobler_run)).filter(Boolean).map((l) => `- ${l}`);
  return [...runLines(list.map((e) => ({ record: e.record, change: e.change, replacedBy: e.record.tobler_run.replaced_by }))), ...offers];
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
    const studyEntry = r.study ? (profile?.skills_offered || []).find((x) => x.id === r.study.id) : null;
    const head = studyEntry ? await host.screening.study(studyEntry, place, { ...(r.inputs || {}), replaces: r.id }) : await host.screening.screen(input, place);
    // The same reply as any run, written from the record, with what changed from the run it replaces (25 Nov).
    const rec = runs.get(head.run)?.record;
    const text = rec ? runReply(rec) : `${head.run || "The re-run"} didn't return a run.`;
    reply.replaceChildren(renderText(text));
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
    const sw = el("span", null, "swatch"); sw.style.background = topicInfo(f.theme).colour; sw.title = topicInfo(f.theme).label;
    const risk = el("span", null, "risk");
    if (f.id) risk.append(el("span", f.id, "fid"));
    risk.append(document.createTextNode(f.risk));
    // Under the flag: its topic in words (people think "heritage", not a colour) and, with a severity, the confidence.
    const sub = el("span", null, "sub");
    sub.append(el("span", f.linkage ? `${topicInfo(f.theme).short} · ${f.linkage.rating} linkage` : topicInfo(f.theme).short, "th"));
    if (f.severity) sub.append(document.createTextNode(" · "), el("span", `${f.confidence} confidence${f.confidence_capped ? " (capped)" : ""}`, "cw"));
    risk.append(sub);
    s.append(el("span", f.severity || f.confidence, f.severity ? "sev" : "conf"), sw, risk, el("span", f.relation === SEARCH_BAND ? "in search area" : f.nearest_km == null ? "" : fmtKm(f.nearest_km), "dist"));
    s.title = `${f.severity ? `Severity ${f.severity}, ` : ""}confidence ${f.confidence}`;
    const body = el("div", null, "body");
    body.append(el("p", `${topicInfo(f.theme).label}.${f.severity ? ` Severity ${f.severity}, confidence ${f.confidence}.` : ""} ${f.why || ""}${f.confidence_capped ? ` (Confidence ${f.confidence_capped}.)` : ""}`, "why"));
    // A contaminant linkage (the desk study): source, pathway and receptor, each in the analyst's words.
    if (f.linkage) {
      const lk = el("p", null, "linkage");
      [["Source", f.linkage.source], ["Pathway", f.linkage.pathway], ["Receptor", f.linkage.receptor]].filter(([, v]) => v)
        .forEach(([k, v], i) => { if (i) lk.append(document.createTextNode(" → ")); lk.append(el("b", `${k}: `), document.createTextNode(v)); });
      body.append(lk);
    }
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
  // An area budget (the developable area): a table instead of flags, and no distance slider.
  card.classList.toggle("is-budget", !!r.budget);
  if (r.budget) { paintBudget(entry); list.replaceChildren(); }
  else if (!r.flags.length && !r.parse_error) list.replaceChildren(el("li", r.study ? "No contaminant linkages identified in the open records. See what a full desk study would add below." : "No flags raised. See what still needs checking below.", "flag note"));
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
  const groups = groupGaps(r.data_gaps, r.checked, [noCheckGap(r)]);
  gaps.querySelector("summary").textContent = gapSummary(groups);
  gaps.querySelector("ul").replaceChildren(...GAP_GROUPS.filter(([k]) => groups[k].length).map(([k, label]) => {
    const li = el("li", null, `gap-group ${k}`);
    const ul = el("ul");
    ul.append(...groups[k].map((g) => el("li", g)));
    li.append(el("p", label, "gap-head"), ul);
    return li;
  }));
  // A study's fixed list of what open records can't give (the desk study: historical maps, geology, a walkover).
  if (r.study?.full_study_adds?.length) {
    const li = el("li", null, "gap-group adds");
    const ul = el("ul"); ul.append(...r.study.full_study_adds.map((g) => el("li", g)));
    li.append(el("p", `What a full ${r.study.label.toLowerCase().replace(/^contamination /, "")} would add`, "gap-head"), ul);
    gaps.querySelector("ul").append(li);
  }
  gaps.hidden = !GAP_GROUPS.some(([k]) => groups[k].length) && !r.study?.full_study_adds?.length;
  // Checks (plan item 1): one line per check, by topic, in three states; the topics nothing checks yet in one line
  // that opens into the list (Rob, 23 Nov). Open on a desktop, closed on a phone. Runs from before checks have none.
  const cv = checksView(r);
  const ck = card.querySelector(".checks");
  ck.hidden = !cv;
  if (cv) {
    ck.querySelector(":scope > summary").textContent = cv.summary;
    ck.querySelector(":scope > ul").replaceChildren(...cv.groups.map((g) => {
      const li = el("li", null, "check-topic");
      const ul = el("ul");
      ul.append(...g.items.map((c) => {
        const item = el("li", null, `check ${c.state === "not_checked" ? "nc" : c.state}`);
        const line = el("div", null, "check-line");
        line.append(el("span", c.label, "check-name"), ...(c.must ? [el("span", "must", "must")] : []), document.createTextNode(`: ${U.localise(c.line)}`));
        if (c.source && c.state !== "not_checked") line.title = c.source;
        item.append(line);
        // A check that found something opens into its features, nearest first, and drives the map (24 Nov).
        const feats = r.checks.find((x) => x.id === c.id)?.features || [];
        if (feats.length) {
          item.classList.add("has-feats");
          line.setAttribute("role", "button"); line.tabIndex = 0;
          const open = () => entry.openCheck === c.id;
          line.setAttribute("aria-expanded", String(open()));
          const toggle = () => {
            entry.openCheck = open() ? null : c.id;
            if (focusOwner?.closest(".run")) setFocus(null);
            paintChecksOpen(card, entry);
            if (open()) showFeatureSet(record, feats.map((f) => f.fid).filter(Boolean), { fit: !phone });
            else map.getSource("hl")?.setData(turf.featureCollection([]));
          };
          line.addEventListener("click", toggle);
          line.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } });
          item.append(featureList(feats.map((f) => ({ ...f, id: f.fid ? `${r.id}:${f.fid}` : null })), { record, label: c.label }));
          item.dataset.check = c.id;
        }
        return item;
      }));
      li.append(el("p", g.label, "check-head"), ul);
      return li;
    }));
    const nc = ck.querySelector(".nocheck");
    nc.hidden = !cv.noCheck;
    if (cv.noCheck) { nc.querySelector("summary").textContent = cv.noCheck.line.split(":")[0]; const list = cv.noCheck.topics.map((t, i) => (i ? t.toLowerCase() : t)).join(", ");
      nc.querySelector("p").textContent = `${list}. Not checked by Tobler yet: search for these where they matter.`; }
    ck.querySelectorAll(":scope > p.caveat").forEach((p) => p.remove());
    for (const c of cv.caveats || []) nc.after(el("p", c, "caveat"));
    if (!ck.dataset.painted) { ck.open = !phone; ck.dataset.painted = "1"; }
    paintChecksOpen(card, entry);
  }
  card.querySelector('input[type="range"]').value = String(entry.km);
  paintReach(entry);
}

// The area budget (the developable area, 25 Nov): gross, each deduction with its hectares and share, the net, the soft
// constraints inside it, and what wasn't checked. A row opens into its reason and source and picks its area out on
// the map. Numbers only from the run: nothing is worked out here.
function paintBudget(entry) {
  const { record, card } = entry;
  const r = record.tobler_run, b = r.budget;
  const box = card.querySelector(".budget");
  box.hidden = false;
  const pct = (v) => (v >= 0.995 ? "100%" : v > 0 && v < 0.005 ? "<1%" : `${Math.round(v * 100)}%`);
  const shapeOf = (id) => record.features.find((f) => f.properties.role === "budget" && f.properties.deduction === id);
  const line = (cls, label, ha, share, x = {}) => {
    const li = el("li", null, `brow ${cls}`);
    const head = el(x.body ? "summary" : "div", null, "bhead");
    if (x.topic) { const sw = el("span", null, "swatch"); sw.style.background = topicInfo(x.topic).colour; sw.title = topicInfo(x.topic).label; head.append(sw); }
    head.append(el("span", label, "blabel"), el("span", ha, "bha"), el("span", share, "bpct"));
    if (!x.body) { li.append(head); return li; }
    const d = document.createElement("details");
    d.append(head, x.body);
    d.addEventListener("toggle", () => {
      if (!d.open) return;
      if (shownRun !== r.id) showRunOnMap(record, { fit: false });
      const g = x.shape;
      map.getSource("hl")?.setData(turf.featureCollection(g ? [g] : []));
      if (g && !phone) map.fitBounds(turf.bbox(turf.featureCollection([g, record.features.find((f) => f.properties.role === "site")])), { padding: fitPadding(), maxZoom: 16 });
    });
    li.append(d);
    return li;
  };
  const bodyOf = (row) => {
    const body = el("div", null, "bbody");
    body.append(el("p", row.reason || "", "why"));
    const facts = [];
    if (row.buffer_m) facts.push(`Buffer ${row.buffer_m} m${row.changed ? "" : " (the default)"}.`);
    if (row.changed) facts.push(`Changed: ${row.changed}.`);
    if (row.count) facts.push(`${row.count} feature${row.count === 1 ? "" : "s"} within reach.`);
    if (row.centre_only) facts.push(`${row.centre_only} more mapped only as a centre point in OpenStreetMap, so their area isn't counted.`);
    if (row.no_area) facts.push(`${row.no_area} point${row.no_area === 1 ? "" : "s"} or line${row.no_area === 1 ? "" : "s"} with no buffer, so no area.`);
    if (row.unread) facts.push(`${row.unread} shape${row.unread === 1 ? "" : "s"} couldn't be read.`);
    if (row.partly) facts.push(`Partly checked: ${row.partly}.`);
    if (facts.length) body.append(el("p", facts.join(" "), "facts"));
    const src = (row.source || []).map((x) => `${x.dataset}${x.publisher && !String(x.dataset).includes(x.publisher) ? ` (${x.publisher})` : ""}${x.licence ? `, ${x.licence}` : ""}`);
    if (src.length) body.append(el("p", src.join("; "), "src"));
    return body;
  };
  const ol = el("ol", null, "brows");
  ol.append(line("gross", "Gross site area", U.hectares(b.gross_ha), "100%"));
  const KIND = { hard: "can't build", buffer: "keep clear", avoid: "avoided by default" };
  for (const row of b.rows.filter((x) => x.state === "found" && x.ha > 0)) {
    ol.append(line(`minus ${row.kind}`, `− ${row.label}${row.buffer_m ? ` + ${row.buffer_m} m` : ""}`, U.hectares(row.ha), pct(row.share),
      { topic: row.topic, body: (() => { const bd = bodyOf(row); const k = KIND[row.kind] || row.kind; bd.prepend(el("p", k.charAt(0).toUpperCase() + k.slice(1), "kindtag")); return bd; })(), shape: shapeOf(row.id) }));
  }
  ol.append(line("net", "Net developable", U.hectares(b.net_ha), pct(b.net_share), { body: (() => { const bd = el("div", null, "bbody"); bd.append(el("p", "What's left after the deductions above, outlined in blue on the map. Access, layout and drainage take more off later.", "why")); return bd; })(),
    shape: record.features.find((f) => f.properties.role === "budget" && f.properties.part === "net") }));
  const soft = b.soft.filter((x) => x.state === "found" && x.ha > 0);
  if (soft.length) {
    ol.append(line("softhead", "Of which, usable at a cost", U.hectares(b.soft_ha), ""));
    for (const row of soft) ol.append(line("soft", row.label, U.hectares(row.ha), pct(row.share), { topic: row.topic, body: bodyOf(row), shape: shapeOf(row.id) }));
  }
  const notes = [];
  const nc = [...b.rows, ...b.soft].filter((x) => x.state === "not_checked");
  if (nc.length) notes.push(el("p", `Not checked: ${nc.map((x) => `${x.label.toLowerCase()} (${x.why})`).join("; ")}.`, "bnc"));
  const clear = [...b.rows, ...b.soft].filter((x) => x.state === "none" || (x.state === "found" && !(x.ha > 0)));
  if (clear.length) notes.push(el("p", `Checked, nothing taken off: ${clear.map((x) => x.label.toLowerCase()).join(", ")}.`, "bclear"));
  if (b.changes?.length) notes.push(el("p", `Your changes: ${b.changes.join("; ")}.`, "bchanges"));
  if (b.unknown?.length) notes.push(el("p", `Not something Tobler measures yet, so ignored: ${b.unknown.join(", ")}.`, "bchanges"));
  box.replaceChildren(el("p", U.localise(r.summary), "bsummary"), ol, ...notes);
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
    ? `${n} finding${n === 1 ? "" : "s"} ${where}. ${inside ? "Found" : "Nearest"}: ${near.map((x) => `${topicInfo(x.theme).label.toLowerCase()}, ${x.name}${inside ? "" : ` (${r.site.role === "search_area" && x.distance_km === 0 ? "in the search area" : fmtKm(x.distance_km)})`}`).join("; ")}.`
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
  stale.hidden = !differs || !!r.study; // a study is judged once from its checks; the slider only shows more or less of them
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
  // Asked which part of a lake, a country, a town or a road: the button uses all of it, said as a rough look.
  const accept = card.querySelector('[data-op="accept"]');
  let held = null;
  try { held = tools.pendingFor(p); } catch { held = null; } // the tools may not be made yet while the page starts
  if (accept) accept.textContent = held?.held === "which_part" ? "Use all of it" : "Use this area";
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
  if (o?.method === "service") {
    const sv = o.service || {};
    box.querySelector("summary").textContent = `From ${sv.secured ? "your organisation's service" : "a published service"}: ${sv.layer}`;
    const body = box.querySelector("div");
    body.append(el("p", `Features: ${o.features.map((f) => f.label).join(", ")}${o.buffer_m ? `, with ${o.buffer_m} m round ${o.features.length > 1 ? "them" : "it"}` : ""}.`));
    body.append(el("p", `Coordinates: ${o.crs?.how || "as given"}${sv.native_wkid ? ` (the service's own: EPSG:${sv.native_wkid})` : ""}.${sv.converted_by ? ` Converted by ${sv.converted_by}.` : ""}`, o.crs?.warning || sv.converted_by ? "warn" : "quiet"));
    body.append(el("p", `Source: ${sv.host}, layer ${sv.layer}${sv.feature_ids?.length ? `, feature ${sv.feature_ids.length > 1 ? "ids" : "id"} ${sv.feature_ids.join(", ")}` : ""}; fetched ${String(sv.retrieved_at || "").slice(0, 16).replace("T", " ")}. Licence: ${sv.licence}.`, "quiet"));
    if (o.steps?.length) body.append(el("p", `Built: ${o.steps.join(", then ")}.`, "quiet"));
    body.append(el("p", "The outline was copied into this project; the service isn't kept or asked again.", "quiet"));
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
    // A lead-in line and then a list ("2 flags, most serious first:" then "- F-01 …"): the line, then the list.
    if (lines.length > 1 && !/^\s*[-*] /.test(lines[0]) && lines.slice(1).every((l) => /^\s*[-*] /.test(l))) {
      box.append(inline(el("p"), lines[0]));
      const ul = el("ul");
      lines.slice(1).forEach((l) => ul.append(inline(el("li"), l.replace(/^\s*[-*] /, ""))));
      box.append(ul);
    } else if (lines.every((l) => /^\s*[-*] /.test(l))) {
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
// direct: { name, input } runs that one tool and lets code write the reply, with no model call: the card's answer to a
// held run (plan item 1, 25 Nov), which runs exactly what was asked.
async function send(text, forModel = text, direct = null) {
  if (!text || busy || !draw) return;
  // A service address opens the service panel and isn't sent to the analyst (it may be a private address).
  const svc = !direct && forModel === text ? SV.findServiceUrl(text) : null;
  if (svc) {
    const shown = svc.token ? text.replace(/([?&])token=[^&\s]*/i, "$1token=…") : text;
    $("conversation").append(el("div", shown, "msg user"));
    say.value = ""; grow();
    sessionLog.push({ at: new Date().toISOString(), user: SV.redactService(text), events: [{ service_panel: { kind: svc.kind, layer: svc.layerId != null } }], reply: "[opened the service panel]" });
    openServicePanel(svc);
    return;
  }
  // Coordinates in what the person typed are read in code, and the analyst is told so it uses them as a place
  // rather than searching for them as a name (Rob, 20 Nov).
  if (forModel === text) { const note = coordinateNote(text); if (note) forModel = `${text}\n\n${note}`; }
  busy = true;
  tools.newTurn();
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
    const waiting = tools.pendingLines();
    const summary = [await projectSummary(ref, host.places(), focusName, viewBounds(), runSummaryLines(), host.loadedFile()), waiting.length ? ["Asked for and waiting:", ...waiting].join("\n") : "", U.unitsNote(), industryNote(profile, industries)].filter(Boolean).join("\n");
    const skillList = conversationSkills();
    runLog = turnLog; runSteps = steps;
    const res = direct ? await runDirect(direct, turnLog, steps) : await runTurn({
      system: systemPrompt({ skills: skillList, loaded: skillList.filter((s) => loadedSkills.has(s.name)), comingSoon: ["constraints-and-access analysis"], industryRule: profile?.other_requests || "" }),
      messages: buildMessages({ recent, summary, userText: forModel }),
      tools: placeToolDefs(skillList),
      maxRounds: CONFIG.workspaceRounds || 10,
      exec: (name, input) => tools.exec(name, input),
      finish: finishTurn(host.screening),
      callClaude,
      onEvent: (ev) => {
        if (ev.type === "round") turnLog.events.push({ model_round: ev.round, ms: ev.ms, tokens_in: ev.input_tokens, tokens_out: ev.output_tokens, tool_calls: ev.tools });
        if (ev.type === "tool_start") activity(`${activityFor(ev.name, ev.input)}…`, true);
        if (ev.type === "tool" && ev.name === "load_skill" && !ev.error) loadedSkills.add(ev.input?.name);
        if (ev.type === "tool") toolEvent(ev, turnLog, steps);
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

function toolEvent(ev, turnLog, steps) {
  turnLog.events.push({ tool: ev.name, input: ev.input, ms: ev.ms, ...(ev.error ? { error: ev.error } : { output: ev.output }) });
  steps.append(el("li", traceLine(ev), ev.error ? "err" : ""));
  // A held run changes what the place card's buttons say (all of a lake, or this area).
  if (ev.output?.held) { const p = host.findPlace(ev.output.place); if (p?.card) paintStatus(p); }
  activity("Thinking…", true);
}
// One tool, run from the page, with the reply written in code: the same shape runTurn returns.
async function runDirect({ name, input }, turnLog, steps) {
  activity(`${activityFor(name, input)}…`, true);
  const t0 = Date.now();
  const out = await tools.exec(name, input);
  toolEvent({ name, input, output: out, ms: Date.now() - t0 }, turnLog, steps);
  const text = finishTurn(host.screening)(name, input, out) || "Done.";
  return { text, usage: { input_tokens: 0, output_tokens: 0 }, stopReason: "finished_in_code" };
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

const HELD_WHY = { confirm: "you hadn't seen the place yet, so I asked first", which_part: "the place isn't a site, so I asked which part", skills: "no analysis was chosen, so the options were offered" };
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
    case "screen_site": return o.run ? `Screened ${o.site} (${o.run}): ${o.flags} flags; ${o.distances}` : o.held ? `Not screened yet: ${HELD_WHY[o.held] || "held"}` : `Screening: ${o.not_available || "no result"}`;
    case "run_study": return o.run ? `Ran ${i.study?.replace(/-/g, " ")} on ${o.site} (${o.run})` : o.held ? `Not run yet: ${HELD_WHY[o.held] || "held"}` : `Not run: ${o.not_available || "no result"}`;
    case "offer_skills": return o.not_available || `Offered the skills for ${o.place}`;
    case "get_run": return `Read the screen ${o.run || ""}`;
    case "bring_in_layers": return o.not_available || (o.declined ? `Left out the layers offered for ${o.run}` : `Brought in for ${o.run}: ${(o.added || []).map((a) => `${a.dataset} (${a.not_checked ? "not checked" : `${a.count} ${a.scope}`})`).join("; ")}`);
    case "remove_place": return `Removed ${o.removed}`;
    case "ask_asset_type": return `Asked what's planned at ${o.place}`;
    case "get_elevation": return o.not_checked ? `Elevation: not checked (${String(o.not_checked).slice(0, 80)})` : o.water_depth_m?.typical != null ? `Water depth about ${o.water_depth_m.typical} m (${o.dataset})` : `Elevation about ${o.elevation_m?.typical} m (${o.dataset})`;
    case "sea_values": return [...(o.lines || []), ...(o.not_found || [])].join(" ") || "Read water depth and vessel traffic: nothing returned";
    default: return ev.name;
  }
}

// The skill chips (the profile's skills_offered), shown only while there's a place. "Screen for environmental
// constraints" (the profile's wording) fills the input with the place in focus (or the latest place), ready to send
// or add to. A skill that isn't built yet is a quieter "soon" chip: a tap says what it will do, with no model call
// (Rob, 24 Nov: show the potential, never pretend to run). A chip that doesn't suit the place's role is hidden.
// Finding is typing; drawing is the Draw button.
function focusedOrLatest() {
  return (focusName && placeByName(focusName)) || [...places.values()].at(-1) || null;
}
// The developable area's words for a place's screened asset type, when it has one of its own.
const BUDGET_WORDS = { solar: "a solar farm", "wind-onshore": "onshore wind" };
const assetLabelOf = (t) => BUDGET_WORDS[t] || null;
function paintChips() {
  const row = document.querySelector(".chips");
  row.hidden = !places.size;
  const p = focusedOrLatest();
  const role = p ? placeRole(p.origin || {}, p.feature.geometry).role : null;
  row.querySelectorAll(".chip[data-skill]").forEach((b) => b.remove());
  for (const s of profile?.skills_offered || []) {
    if (s.id === "screen") continue; // the screen's chip is in the page, with its asset-type questions
    const soon = s.status !== "ready";
    const b = el("button", s.label, soon ? "chip soon" : "chip");
    if (soon) { b.append(el("span", "soon", "soon-tag")); b.title = "Coming soon"; }
    b.type = "button";
    b.dataset.skill = s.id;
    b.hidden = !!(s.roles && role && !s.roles.includes(role));
    // A ready study fills the input for the place in focus, like the screen chip: ready to send or add to.
    b.addEventListener("click", () => {
      if (soon) { skillSoon(s); return; }
      const q = focusedOrLatest();
      if (!q || busy) return;
      // The developable area depends on what's planned: say it when the place already knows (from a screen).
      const planned = s.kind === "budget" && assetLabelOf(q.assetType) ? ` for ${assetLabelOf(q.assetType)}` : "";
      say.value = `Run the ${s.label.toLowerCase()} for ${q.name}${planned}`; grow(); say.focus();
      say.setSelectionRange(say.value.length, say.value.length);
    });
    row.append(b);
  }
}
function skillSoon(s) {
  const card = el("div", null, "msg analyst soon-note");
  const p = el("p");
  p.append(el("b", s.label), document.createTextNode(` isn't built yet. ${s.about}`));
  card.append(p);
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  expandSheet();
}
// When what's planned there isn't known yet, the chip asks with quick picks first (no model call); once a place
// has been screened, it fills the input as before.
document.querySelector(".chip[data-screen]").addEventListener("click", () => {
  const p = focusedOrLatest();
  if (!p || busy) return;
  if (!p.assetType) { askAssetType(p.name); return; }
  say.value = `Screen ${p.name} for environmental constraints`; grow(); say.focus();
  say.setSelectionRange(say.value.length, say.value.length);
});

// "What would you like for <place>?": the profile's skills as buttons, when the person hasn't said which analysis
// (Rob, 24 Nov). A ready skill sends its request as the person's next message; a "soon" one says what it will do.
function offerSkills(name) {
  const p = placeByName(name);
  if (!p) throw new Error(`No place called "${name}".`);
  const card = el("div", null, "msg analyst skill-pick");
  card.append(el("p", `What would you like for ${p.name}?`));
  const row = el("div", null, "picks");
  const offered = (profile?.skills_offered || []).filter((s) => !s.roles || s.roles.includes(placeRole(p.origin || {}, p.feature.geometry).role));
  for (const s of offered) {
    const ready = s.status === "ready";
    const label = s.id === "screen" ? (profile.wording?.screen_chip || "Screen for environmental constraints") : s.label;
    const b = el("button", label, ready ? "chip" : "chip soon");
    b.type = "button";
    if (!ready) b.append(el("span", "soon", "soon-tag"));
    b.addEventListener("click", () => {
      if (busy) return;
      if (!ready) { skillSoon(s); return; }
      card.classList.add("done");
      card.querySelectorAll("button").forEach((x) => { x.disabled = true; });
      send(s.id === "screen" ? `Screen ${p.name} for environmental constraints.` : `Run the ${s.label.toLowerCase()} for ${p.name}.`);
    });
    row.append(b);
  }
  card.append(row);
  if (pendingReply?.isConnected) $("conversation").insertBefore(card, pendingReply);
  else $("conversation").append(card);
  card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  expandSheet();
  return { place: p.name, offered: offered.map((s) => `${s.label || "screen"}${s.status === "ready" ? "" : " (not built yet)"}`) };
}

// Layers offered after a run (plan item 1, 26 Nov; js/bringin.js): one button per layer, all of them, or no. A tap runs
// bring_in_layers with no model call, and code writes the reply, as the held-run buttons do.
const offerCards = new Map(); // run id → the offer's card
function showOffer(record) {
  const r = record.tobler_run;
  const open = r.offer.items.filter((x) => x.state === "offered");
  const card = el("div", null, "msg analyst layer-offer");
  card.dataset.run = r.id;
  card.append(el("p", `Bring in from the atlas, for ${r.id}?`));
  const row = el("div", null, "picks");
  const go = (layers, words) => {
    if (busy) return;
    card.classList.add("done");
    card.querySelectorAll("button").forEach((b) => { b.disabled = true; });
    send(words, words, { name: "bring_in_layers", input: { run: r.id, layers } });
  };
  const button = (label, layers, words, cls = "chip") => { const b = el("button", label, cls); b.type = "button"; b.addEventListener("click", () => go(layers, words)); return b; };
  for (const x of open) {
    const b = button(x.dataset.title, [x.id], `Bring in ${x.dataset.title}`);
    b.title = `${x.dataset.publisher || "Publisher not stated"} · ${x.dataset.licence_short} · for ${lowerLabel(x.label)}`;
    row.append(b);
  }
  if (open.length > 1) row.append(button("All of them", ["all"], "Bring in all of them", "chip primary"));
  row.append(button("No thanks", [], "No thanks, leave them out", "chip general"));
  card.append(row);
  offerCards.set(r.id, card);
  // Under the reply, which says "use the buttons below".
  if (pendingReply?.isConnected) pendingReply.after(card);
  else $("conversation").append(card);
  expandSheet();
}
// A run changed after it was shown (layers brought in, or the offer answered in words): the card's list, the offer's
// buttons, and the saved project.
function runChanged(record) {
  const r = record.tobler_run;
  const entry = runs.get(r.id);
  if (entry) paintAdded(entry);
  // What came in shows with the run (it replaces the plain search results the fetch put on the map).
  if (r.added?.length && entry) showRunOnMap(record, { fit: false });
  const card = offerCards.get(r.id);
  if (card && !r.offer?.items?.some((x) => x.state === "offered")) { card.classList.add("done"); card.querySelectorAll("button").forEach((b) => { b.disabled = true; }); }
  else if (card) card.querySelectorAll("button").forEach((b) => { const x = r.offer.items.find((y) => b.textContent === y.dataset.title); if (x && x.state !== "offered") b.disabled = true; });
  saveSoon();
}
host.onRunChanged = runChanged;
function paintAdded(entry) {
  const r = entry.record.tobler_run;
  const box = entry.card.querySelector(".added");
  if (!box) return;
  const added = r.added || [];
  box.hidden = !added.length;
  if (!added.length) return;
  box.querySelector("summary").textContent = `Brought in after the run (${added.length})`;
  const ul = box.querySelector("ul");
  ul.replaceChildren(...added.map((a) => el("li", `${a.dataset} (${a.publisher || "publisher not stated"}; ${a.licence_class === "unknown" ? "licence not stated" : a.licence}; checked ${String(a.checked_at).slice(0, 10)}): ${a.not_checked ? `not checked (${a.not_checked})` : a.count ? `${a.count} within ${U.dist(a.within_km)}${a.nearest?.[0] ? `, nearest ${a.nearest[0].name} ${U.dist(a.nearest[0].distance_km)}` : ""}` : `none within ${U.dist(a.within_km)}`}. For ${lowerLabel(a.for)}.`)));
  box.querySelector(".added-note").textContent = "Fetched after the run, at your request. The decision and flags above were made without these.";
}

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
  form.mergeShapes.checked = host.mergeShapes();
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
form.mergeShapes.addEventListener("change", () => store.set("mergeShapes", form.mergeShapes.checked ? null : "no"));
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
