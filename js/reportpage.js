// The report page (report.html): reads a run from the link's # part (js/share.js) and draws the report. On screen it's
// a web page with live maps; printed or saved as PDF it's an A4 report, with the maps as pictures (labels drawn in).
import * as turf from "./vendor/turf.js";
import * as U from "./units.js";
import { THEMES } from "./findings.js";
import { decodeRun } from "./share.js";
import { distancesLine } from "./distances.js";
import { DISCLAIMER } from "./disclaimer.js";
import { seaLines, seaMatters } from "./seavalues.js";
import { whereText, searchHeadline, SEARCH_BAND } from "./siterole.js";
import { elevationLine } from "./elevation.js";
import { findingLabels, findingRows, evidenceRows, sourcesOf, gapsOf, checksOf, decisionText, summaryBlocks, changeLog } from "./report.js";

const $ = (id) => document.getElementById(id);
const BASEMAP = "https://tiles.openfreemap.org/styles/positron";
const store = (k) => { try { return localStorage.getItem(`tobler.${k}`); } catch { return null; } };
U.setUnits(store("units") || "metric");
const SITE = /^#[0-9a-f]{6}$/i.test(store("shapeColour") || "") ? store("shapeColour") : "#d1352a";
document.documentElement.style.setProperty("--site", SITE);
const INK = "#15303c";

function el(tag, text, cls) { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : "");
const km = (v) => (v == null ? "" : v === 0 ? "on site" : U.dist(v));
const when = (iso) => { const d = new Date(iso); return Number.isNaN(+d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };

const main = $("report");
const pending = [];
window.__report = { ready: false, maps: [] };

// Maps in a hidden tab don't draw until it's shown, so any picture still missing is taken just before printing.
const captures = [];
const captureMissing = () => captures.forEach((c) => { if (!c.img.src && c.map.loaded()) capture(c.map, c.img, c.labels); });
$("print").addEventListener("click", async () => { await Promise.allSettled(pending); captureMissing(); await new Promise((ok) => setTimeout(ok, 150)); window.print(); });
addEventListener("beforeprint", captureMissing);
$("copy").addEventListener("click", async () => {
  let ok = false;
  try { await navigator.clipboard.writeText(location.href); ok = true; } catch { /* refused: try the older way */ }
  if (!ok) {
    const box = Object.assign(document.createElement("textarea"), { value: location.href, readOnly: true });
    box.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.append(box); box.select();
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    box.remove();
  }
  $("copy").textContent = ok ? "Link copied" : "Copy from the address bar";
  setTimeout(() => { $("copy").textContent = "Copy link"; }, 2500);
});

try {
  if (!location.hash) throw new Error("This page shows a screening report from a link. Open a run card in Tobler and choose Report.");
  const record = await decodeRun(location.hash.slice(1));
  render(record);
} catch (e) {
  main.replaceChildren(el("p", e.message || String(e), "error"), Object.assign(el("a", "Go to Tobler"), { href: "./" }));
  window.__report.ready = true;
  window.__report.error = e.message;
}

function render(record) {
  const r = record.tobler_run;
  const s = r.site;
  document.title = `Constraints screen: ${s.name} · Tobler`;
  const title = el("h1", "Constraints screen");
  title.append(el("span", s.name, "site-name"));
  const head = [el("p", "Tobler", "kicker"), title,
    el("p", [cap(s.asset_label) + (s.asset_assumed ? " (assumed)" : ""), s.setting, `screened ${when(r.finished_at)}`, `run ${r.id}`].filter(Boolean).join(" · "), "meta")];

  // 1. Decision and summary.
  const dec = decisionText(r);
  const decision = el("p", null, "decision");
  if (dec) decision.append(el("b", dec.head), document.createTextNode(dec.why ? ` ${dec.why}` : ""));
  else decision.append(el("span", "No overall decision was recorded for this run.", "none"));
  const searchArea = s.role === "search_area";
  const searchNote = searchArea ? el("p", U.localise(searchHeadline(s)), "search-note") : null;
  // Out of date (js/outofdate.js): the site was edited after this run, or a later run replaced it. Said first.
  const od = r.out_of_date;
  const oldNote = od ? el("p", U.localise(od.replaced_by
    ? `Replaced: the site was edited after this screen (${od.change}) and screened again as ${od.replaced_by}. This report shows the earlier outline's findings.`
    : `Out of date: the site was edited after this screen (${od.change}). The findings are for the earlier outline.`), "outdated-note") : null;
  const replNote = r.replaces ? el("p", `Replaces ${r.replaces.run}: ${r.replaces.why}.`, "replaces-note") : null;
  const summary = el("section", null, "summary");
  summary.append(el("h2", "Summary"));
  for (const b of summaryBlocks(r.summary)) {
    if (b.list) { const ul = el("ul"); b.items.forEach((t) => ul.append(el("li", U.localise(t)))); summary.append(ul); }
    else summary.append(el("p", U.localise(b.text)));
  }

  // 2. The site and what was screened.
  const siteSec = el("section");
  siteSec.append(el("h2", "The site and what was screened"));
  const facts = el("dl", null, "facts");
  const fact = (k, v) => { if (v) facts.append(el("dt", k), el("dd", cap(v))); };
  fact("Site", U.localise(s.summary));
  fact("How it was found", s.how_found);
  fact("Planned", `${s.asset_label}${s.asset_assumed ? " (assumed)" : ""}; stage ${s.stage}${s.outside_profile ? `. ${s.outside_profile}` : ""}`);
  fact("Screened", r.extent === "inside" ? "Inside the area only (the surroundings weren't screened)." : U.localise(`${s.footprint}; distances from the site's edge: ${distancesLine(r.distances)}.`));
  fact("Why these distances", (r.distances?.reasons || []).slice(0, 3).join("; "));
  if (seaMatters(r)) fact("At sea", U.localise(seaLines(r.sea).join(" ")));
  if (r.elevation?.significance) fact("Elevation", U.localise(elevationLine(r.elevation, r.elevation.significance)));
  fact("Data as of", when(r.finished_at));
  siteSec.append(facts);
  const siteFig = figure("site-map", searchArea
    ? "The search area and the distances screened. The site's outline wasn't found, so the dashed outline is where it probably is, not its boundary; dashed rings are the near, close and wider bands."
    : "The site and the distances screened. The site is outlined; dashed rings are the near, close and wider bands.",
    [["site", searchArea ? "The search area" : "The site"], ["ring", "Distance bands"]]);
  siteSec.append(siteFig.fig);

  // 3. Findings: the numbered map and one row per finding.
  const rows = findingRows(r);
  const findSec = el("section");
  findSec.append(el("h2", `Findings (${rows.length})`));
  const themesUsed = [...new Set(r.flags.map((f) => f.theme))];
  const findFig = figure("findings-map", "The evidence behind each finding, labelled with its number. Shapes are simplified for display.",
    [["site", searchArea ? "The search area" : "The site"], ...themesUsed.map((t) => [t, THEMES[t]?.label || "Operating context"])]);
  findSec.append(findFig.fig);
  if (!rows.length) findSec.append(el("p", "No findings were raised. See what was checked and the gaps below."));
  else {
    const t = el("table", null, "findings");
    const hr = el("tr"); ["", "Finding", "Rating", "Nearest"].forEach((h) => hr.append(el("th", h)));
    t.append(el("thead"), el("tbody"));
    t.tHead.append(hr);
    for (const f of rows) {
      const tr = el("tr");
      const what = el("td", null, "what");
      what.append(el("div", f.risk, "risk"));
      const th = el("div", null, "theme"); const sw = el("span", null, "sw"); sw.style.background = f.colour; th.append(sw, document.createTextNode(f.theme)); what.append(th);
      if (f.why) what.append(el("p", f.why, "why"));
      if (f.evidence.length) {
        const ul = el("ul", null, "ev");
        for (const e of f.evidence) {
          const li = el("li", `${e.name} · ${e.band === "around the site" ? "around the site" : e.band === SEARCH_BAND ? whereText(e) : km(e.distance_km)}${e.dataset ? ` · ${e.dataset}` : ""}${e.publisher ? ` (${e.publisher})` : ""}${e.checked ? `, ${e.checked}` : ""}`);
          if (!e.traced) li.append(el("span", " · not traced to fetched data", "untraced"));
          ul.append(li);
        }
        what.append(ul);
      }
      if (f.next_step) { const nx = el("p", null, "next"); nx.append(el("b", "Next step: "), document.createTextNode(f.next_step)); what.append(nx); }
      const rating = el("td", null, "rating");
      rating.append(el("span", `Severity ${f.severity}`), el("span", `Confidence ${f.confidence}${f.confidence_capped ? " (capped)" : ""}`));
      if (f.confidence_capped) rating.title = `Confidence ${f.confidence_capped}`;
      tr.append(el("td", f.id, "id"), what, rating, el("td", f.relation === SEARCH_BAND ? "in the search area" : km(f.nearest_km), "dist"));
      t.tBodies[0].append(tr);
    }
    findSec.append(t);
  }

  // 3b. Checks (plan item 1): one line per check, by topic, found, none found or not checked. Runs from before checks
  // (old share links) have none, and the section is left out.
  const cv = checksOf(r);
  const ckSec = cv ? el("section", null, "checks") : null;
  if (cv) {
    ckSec.append(el("h2", "Checks"));
    ckSec.append(el("p", `${cv.summary.replace(/^Checks: (\d+)/, (m, n) => `${n} check${n === "1" ? "" : "s"}`)}, run in code before the analyst started, at ${cv.scale || "the"} scale. Each looks out to its own distance from the site's edge. "Must" marks a check its topic can't be called clear without. "Not checked" is not the same as "none found". ${r.checks_merge_shapes === false ? "The same site in two publishers' layers is counted once only by its code or name (the shape match was switched off)." : "The same site in two publishers' layers is counted once, by its code, its name or the same shape."}`));
    const t = el("table", null, "checks");
    const hr = el("tr"); [["Check", ""], ["Result", ""], ["Source", "src"]].forEach(([h, c]) => hr.append(el("th", h, c)));
    t.append(el("thead"), el("tbody")); t.tHead.append(hr);
    for (const g of cv.groups) {
      const gr = el("tr", null, "topic"); const td = el("td", g.label); td.colSpan = 3; gr.append(td); t.tBodies[0].append(gr);
      for (const c of g.items) {
        const tr = el("tr", null, c.state === "not_checked" ? "failed" : c.state);
        const name = el("td", c.label); if (c.must) name.append(el("span", " must", "must"));
        if (c.source) name.append(el("div", c.source, "made src-inline")); // the source column folds in here on a phone
        const res = el("td", U.localise(c.line), "res"); if (c.partly) res.append(el("div", U.localise(c.partly), "made"));
        tr.append(name, res, el("td", c.source, "made src"));
        t.tBodies[0].append(tr);
      }
    }
    ckSec.append(t);
    if (cv.noCheck) ckSec.append(el("p", `${cv.noCheck.line}. They are listed under "Couldn't check" below.`, "made"));
    for (const c of cv.caveats || []) ckSec.append(el("p", c, "made caveat"));
  }

  // 4. Evidence and gaps.
  const evSec = el("section");
  evSec.append(el("h2", "Evidence and gaps"));
  const ev = evidenceRows(r);
  const nc = ev.filter((x) => x.failed).length;
  evSec.append(el("p", `${ev.length} sources checked${nc ? `; ${nc} couldn't be checked` : ""}. "Not checked" is not the same as "nothing found".`));
  const ct = el("table", null, "checked");
  const ch = el("tr"); [["Source", ""], ["Result", ""], ["Checked", ""], ["Licence", "lic"]].forEach(([h, c]) => ch.append(el("th", h, c)));
  ct.append(el("thead"), el("tbody")); ct.tHead.append(ch);
  for (const x of ev) {
    const tr = el("tr", null, x.failed ? "failed" : "");
    const src = el("td"); src.append(el("div", x.source)); if (x.publisher) src.append(el("div", x.publisher, "made")); if (x.failed && x.why) src.append(el("div", x.why, "made"));
    tr.append(src, el("td", x.result, "res"), el("td", x.when, "when"), el("td", x.licence, "lic"));
    ct.tBodies[0].append(tr);
  }
  evSec.append(ct);
  const groups = gapsOf(r);
  const gaps = el("div", null, "gaps");
  for (const [k, label] of [["couldnt", "Couldn't check"], ["nodata", "No data"], ["caveat", "Caveats"]]) {
    if (!groups[k].length) continue;
    const ul = el("ul"); groups[k].forEach((g) => ul.append(el("li", U.localise(g))));
    gaps.append(el("h3", label), ul);
  }
  if (gaps.childElementCount) evSec.append(gaps);

  // 5. Method, change log, sources and licences.
  const meth = el("section", null, "method");
  meth.append(el("h2", "Method"));
  meth.append(el("p", `Method: ${r.skill?.name} ${r.skill?.version}${r.industry ? ` (${r.industry} profile)` : ""}, run by ${r.model || "the analyst"}. ${r.method}`));
  meth.append(el("p", "Themes follow IFC Performance Standards 4 to 8 where they fit; this is a screen, not an IFC review. Severity is how much a finding would matter if the evidence is right; confidence is how sure the evidence is."));
  const log = changeLog(r);
  if (log.length) meth.append(el("p", `Changes: ${log.map((a) => `${a.at}, written for ${km(a.within_km) || "inside the area"}: ${a.flags} findings${a.decision ? `, ${a.decision}` : ""}`).join("; ")}. This report shows the latest.`));
  if (r.shared) meth.append(el("p", `This link holds ${r.shared.evidence}. The full run (every feature found, ${r.evidence_total ?? "?"} in all) is in the run download from Tobler.`));
  const src = el("section", null, "sources");
  src.append(el("h2", "Sources and licences"));
  const ul = el("ul");
  for (const x of sourcesOf(record)) ul.append(el("li", `${x.dataset}${x.publisher ? `, ${x.publisher}` : ""}${x.licence ? `. ${x.licence}` : ". Licence not stated"}`));
  src.append(ul);
  src.append(el("p", "Basemap © OpenFreeMap, OpenMapTiles, OpenStreetMap contributors (ODbL).", "made"));

  const foot = el("footer");
  foot.append(el("p", r.disclaimer || DISCLAIMER, "disclaimer"), el("p", `Made with Tobler (asktobler.com) from run ${r.id}, ${when(r.finished_at)}.`, "made"));

  main.replaceChildren(...head, ...(oldNote ? [oldNote] : []), decision, ...(replNote ? [replNote] : []), ...(searchNote ? [searchNote] : []), summary, siteSec, findSec, ...(ckSec ? [ckSec] : []), evSec, meth, src, foot);
  const site = record.features.find((f) => f.properties.role === "site");
  const evid = record.features.filter((f) => f.properties.role === "evidence");
  pending.push(drawMap(siteFig, { site, rings: r.extent === "inside" ? [] : [r.distances.near, r.distances.close, r.distances.wider], evidence: [], labels: null, searchArea }));
  pending.push(drawMap(findFig, { site, rings: [], evidence: evid, labels: findingLabels(record), searchArea }));
  Promise.allSettled(pending).then(() => { window.__report.ready = true; });
}

function figure(id, caption, key) {
  const fig = el("figure");
  const box = el("div", null, "map"); box.id = id;
  const img = el("img"); img.alt = caption;
  const cap = el("figcaption", caption);
  const k = el("ul", null, "key");
  for (const [t, label] of key) {
    const li = el("li"); const sw = el("span", null, `sw ${t === "site" || t === "ring" ? t : ""}`);
    if (THEMES[t]) sw.style.background = THEMES[t].colour;
    li.append(sw, document.createTextNode(label)); k.append(li);
  }
  fig.append(box, img, cap, k);
  return { fig, box, img };
}

// A map that stays still enough to print: drawn once, fitted to what it shows, then copied into a picture with the
// labels painted on, for the PDF. Falls back to a plain outline map if the basemap can't be reached.
function drawMap(f, { site, rings, evidence, labels, searchArea = false }) {
  return new Promise((resolve) => {
    const map = new maplibregl.Map({ container: f.box, style: BASEMAP, attributionControl: false, preserveDrawingBuffer: true, interactive: true, cooperativeGestures: true, fadeDuration: 0 });
    window.__report.maps.push(map);
    captures.push({ map, img: f.img, labels });
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, 20000);
    let started = false;
    const start = () => {
      if (started) return; started = true;
      const ringFs = rings.filter((v) => v > 0).map((v) => { const b = turf.buffer(site, v, { units: "kilometers", steps: 48 }); return b; });
      const colour = ["match", ["get", "theme"], ...Object.entries(THEMES).flatMap(([k, t]) => [k, t.colour]), THEMES.context.colour];
      map.addSource("ev", { type: "geojson", data: turf.featureCollection(evidence) });
      map.addLayer({ id: "ev-fill", type: "fill", source: "ev", filter: ["in", ["geometry-type"], ["literal", ["Polygon", "MultiPolygon"]]], paint: { "fill-color": colour, "fill-opacity": ["case", ["==", ["get", "surrounds"], true], 0.03, 0.14] } });
      map.addLayer({ id: "ev-line", type: "line", source: "ev", filter: ["!=", ["geometry-type"], "Point"], paint: { "line-color": colour, "line-width": 2 } });
      map.addLayer({ id: "ev-pt", type: "circle", source: "ev", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": colour, "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
      map.addSource("rings", { type: "geojson", data: turf.featureCollection(ringFs) });
      map.addLayer({ id: "rings", type: "line", source: "rings", paint: { "line-color": INK, "line-width": 1, "line-opacity": 0.5, "line-dasharray": [3, 3] } });
      map.addSource("site", { type: "geojson", data: site || turf.featureCollection([]) });
      map.addLayer({ id: "site-fill", type: "fill", source: "site", filter: ["!=", ["geometry-type"], "Point"], paint: { "fill-color": SITE, "fill-opacity": searchArea ? 0.05 : 0.12 } });
      map.addLayer({ id: "site-line", type: "line", source: "site", paint: { "line-color": SITE, "line-width": searchArea ? 2 : 2.5, ...(searchArea ? { "line-dasharray": [3, 2] } : {}) } });
      map.addLayer({ id: "site-pt", type: "circle", source: "site", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 6, "circle-color": SITE, "circle-stroke-color": "#fff", "circle-stroke-width": 2 } });
      // Fit: the outer ring, or the site and the labelled evidence (wide areas the site lies within don't count).
      const near = evidence.filter((e) => !e.properties.surrounds);
      const fitTo = ringFs.length ? ringFs.at(-1) : turf.featureCollection([site, ...(labels?.features || []), ...near.filter((e) => e.geometry.type === "Point")].filter(Boolean));
      const b = turf.bbox(fitTo);
      if (b.every(Number.isFinite)) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 36, maxZoom: 15, animate: false });
      for (const l of labels?.features || []) new maplibregl.Marker({ element: el("div", l.properties.label, "map-label"), anchor: "bottom", offset: [0, -6] }).setLngLat(l.geometry.coordinates).addTo(map);
      map.once("idle", () => { capture(map, f.img, labels); finish(); });
    };
    map.once("style.load", start);
    map.on("error", async (e) => {
      if (started || !/style|fetch|Failed|NetworkError/i.test(String(e?.error?.message || ""))) return;
      const countries = await fetch("data/ref/countries.json").then((x) => x.json()).catch(() => null);
      map.setStyle({ version: 8, sources: countries ? { ne: { type: "geojson", data: countries } } : {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#dce7ea" } }, ...(countries ? [{ id: "land", type: "fill", source: "ne", paint: { "fill-color": "#f6f7f5" } }] : [])] });
      map.once("style.load", start);
    });
  });
}

// The map as a picture for print, with the finding labels painted where the markers sit.
function capture(map, img, labels) {
  try {
    const gl = map.getCanvas();
    const c = document.createElement("canvas");
    c.width = gl.width; c.height = gl.height;
    const ctx = c.getContext("2d");
    ctx.drawImage(gl, 0, 0);
    const dpr = gl.width / gl.clientWidth || 1;
    ctx.font = `600 ${11 * dpr}px "Public Sans", system-ui, sans-serif`;
    ctx.textBaseline = "middle";
    // Labels that would overlap are stacked upwards, so each number stays readable.
    const drawn = [];
    const hits = (a) => drawn.some((b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h);
    for (const l of labels?.features || []) {
      const p = map.project(l.geometry.coordinates);
      const text = l.properties.label;
      const w = ctx.measureText(text).width + 12 * dpr, h = 18 * dpr;
      const x = p.x * dpr - w / 2;
      let y = p.y * dpr - 6 * dpr - h;
      for (let k = 0; k < 6 && hits({ x, y, w, h }); k++) y -= h + 3 * dpr;
      drawn.push({ x, y, w, h });
      ctx.fillStyle = "#fff"; ctx.strokeStyle = INK; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 9 * dpr); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; ctx.fillText(text, x + 6 * dpr, y + h / 2);
    }
    img.src = c.toDataURL("image/png");
  } catch { /* a tainted or lost canvas: the print falls back to no picture */ }
}

