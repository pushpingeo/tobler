// Run records shaped like real ones, for the reply tests and the wording sheet (scripts/reply-samples.mjs).
// Names and numbers are made up in the style of the 18–24 Nov logs; nothing here is a real finding.
const run = (o) => ({ type: "FeatureCollection", features: [], tobler_run: {
  schema: "tobler-run/2", id: "R1", kind: "ntr-screen", flags: [], checked: [], data_gaps: [], checks: [], extent: "around",
  distances: { near: 1, close: 5, wider: 20, set_by: "table", asset_label: "solar farm", setting: "onshore", reasons: ["default"] },
  ...o, site: { setting: "onshore", role: "area", ...(o.site || {}) } } });

const check = (label, state, must = false, extra = {}) => ({ id: label.toLowerCase().replace(/\W+/g, "-"), label, state, must, ...extra });

export const oracleSolar = run({
  id: "R1",
  site: { name: "Oracle campus, Linlithgow", asset_label: "solar farm", asset_assumed: false, role: "area", area_km2: 0.121 },
  decision: { value: "progress with targeted investigation", why: "Heritage assets sit at the site's edge and the land class needs checking at field scale" },
  flags: [
    { id: "F-01", risk: "Listed buildings and a scheduled monument at the site's edge", severity: "high", confidence: "high", nearest_km: 0.04, traced: 2, untraced: 0 },
    { id: "F-02", risk: "Prime agricultural land (Class 2) mapped across the site", severity: "medium", confidence: "medium", nearest_km: 0, traced: 1, untraced: 0 },
    { id: "F-03", risk: "Linlithgow Loch SSSI downstream of site drainage", severity: "medium", confidence: "medium", nearest_km: 1.6, traced: 1, untraced: 0 },
    { id: "F-04", risk: "Homes along the eastern boundary", severity: "low", confidence: "high", nearest_km: 0.12, traced: 1, untraced: 0 },
  ],
  checks: [
    check("Listed buildings", "found", true), check("Special Areas of Conservation", "none", true),
    check("Flood zones", "not_checked", true, { why: "SEPA's service didn't answer" }), check("Peat", "not_checked", false, { why: "no layer for Scotland yet" }),
    check("Ancient woodland", "none"),
  ],
});

export const kelsoSearchArea = run({
  id: "R2",
  site: { name: "Kelso", asset_label: "onshore wind farm", asset_assumed: false, role: "search_area", role_why: "a default 1 km footprint round a point", area_km2: 3.14 },
  distances: { near: 2, close: 10, wider: 20, set_by: "table", asset_label: "onshore wind farm", setting: "onshore", reasons: ["default"] },
  decision: { value: "insufficient evidence", why: "The place is a town point, not a site", changed: "from progress: none of the must-checks for biodiversity could be checked" },
  flags: [{ id: "F-01", risk: "Homes and schools in the search area", severity: "high", confidence: "low", nearest_km: 0, traced: 3, untraced: 0 }],
  checks: [check("Special Areas of Conservation", "not_checked", true, { why: "NatureScot didn't answer" }), check("SSSIs", "not_checked", true, { why: "NatureScot didn't answer" })],
});

export const housingOutside = run({
  id: "R3",
  site: { name: "Edge of Linlithgow", asset_label: "housing estate", asset_assumed: false, role: "area", area_km2: 0.05,
    outside_profile: "A general screen: the method wasn't built for this kind of development, so treat it as a first look." },
  distances: { near: 0.5, close: 2, wider: 10, set_by: "person", asset_label: "site", setting: "onshore", reasons: ["person"] },
  decision: { value: "progress", why: "Nothing in the open data checked stands in the way at this stage" },
  flags: [],
  checks: [check("Listed buildings", "none", true)],
});

export const stanlowStudy = run({
  id: "R4", kind: "contamination-desk-study",
  study: { id: "contamination-desk-study", label: "Contamination desk study", groups: [], full_study_adds: ["historical maps", "geology", "abstractions", "unexploded ordnance", "a site walkover"] },
  site: { name: "Stanlow Refinery", asset_label: "contamination desk study", role: "area", area_km2: 7.9 },
  distances: { near: 0.25, close: 0.5, wider: 2, set_by: "skill", asset_label: "contamination desk study", setting: "onshore", reasons: ["skill"] },
  decision: { value: "possible linkages: investigate", why: "A historic landfill sits upslope of the Mersey estuary and the site is in flood zone 3" },
  flags: [
    { id: "F-01", risk: "Historic landfill 300 m south could reach the Mersey Estuary through flood water", severity: "high", confidence: "medium", nearest_km: 0.3,
      linkage: { source: "historic landfill", pathway: "flood water", receptor: "Mersey Estuary SPA", rating: "possible" }, traced: 1, untraced: 0 },
    { id: "F-02", risk: "Homes 400 m east downwind of the site", severity: "medium", confidence: "low", nearest_km: 0.4,
      linkage: { source: "the refinery", pathway: "air", receptor: "homes", rating: "possible" }, traced: 1, untraced: 0 },
  ],
  checks: [check("Permitted sites", "not_checked", true, { why: "no open layer for England yet" }), check("Pollution incidents", "not_checked", true, { why: "no open layer for England yet" }), check("Landfill", "found", true)],
});

export const barnstonBudget = run({
  id: "R5", kind: "developable-area",
  study: { id: "developable-area", label: "Developable area", groups: [], full_study_adds: [] },
  site: { name: "Barnston field", asset_label: "solar farm", role: "area", area_km2: 0.1 },
  budget: {
    asset_type: "solar", asset_label: "solar farm", asset_assumed: false, changes: [],
    gross_ha: 10.2, net_ha: 7.4, net_share: 0.7255, soft_ha: 1.1, clear_ha: 6.3,
    rows: [
      { id: "railway", label: "Railway", kind: "buffer", state: "found", ha: 1.9, share: 0.186, buffer_m: 30, reason: "safety clearance" },
      { id: "homes", label: "Homes", kind: "buffer", state: "found", ha: 0.9, share: 0.088, buffer_m: 50, reason: "residential amenity" },
      { id: "watercourses", label: "Watercourses", kind: "buffer", state: "none", ha: 0, share: 0, buffer_m: 8, reason: "" },
      { id: "flood-zone-3", label: "Flood zone 3", kind: "hard", state: "not_checked", ha: 0, why: "the Environment Agency didn't answer" },
    ],
    soft: [{ id: "agri-land", label: "Best and most versatile agricultural land", kind: "soft", state: "found", ha: 1.1, share: 0.108 }],
  },
});

export const brokenResult = run({
  id: "R6",
  site: { name: "Évora 2", asset_label: "solar farm", role: "area" },
  decision: null, flags: [], parse_error: "The analyst's result had no readable JSON block, so there are no structured flags.",
  checks: [],
});

// Oracle campus screened again, nothing changed underneath, a different result (as six times in the 18–24 Nov logs).
const clone = (r) => JSON.parse(JSON.stringify(r));
export const oracleSolarAgain = (() => {
  const r = clone(oracleSolar);
  Object.assign(r.tobler_run, { id: "R2", decision: { value: "major issue", why: "Listed buildings at the edge and prime farmland across the site" },
    flags: oracleSolar.tobler_run.flags.slice(0, 2).map((f) => ({ ...f, theme: f.id === "F-01" ? "heritage" : "land-use" })),
    topic_labels: { heritage: "Heritage", "land-use": "Land use", biodiversity: "Biodiversity", "community-health": "Community and health" } });
  return r;
})();
// The earlier run's flags carry topics too.
oracleSolar.tobler_run.flags.forEach((f, i) => { f.theme = ["heritage", "land-use", "biodiversity", "community-health"][i]; });
// Évora: the second run reached sources the first didn't.
export const evoraFirst = run({ id: "R1", site: { name: "Solar farm 5 km W of Évora", asset_label: "solar farm", role: "area", area_km2: 1 },
  decision: { value: "insufficient evidence", why: "Heritage and settlements couldn't be checked" },
  flags: [{ id: "F-01", risk: "Montado cork oak woodland on site", theme: "biodiversity", severity: "medium", confidence: "medium", nearest_km: 0, traced: 1, untraced: 0 }],
  checks: [check("Homes", "not_checked", true, { id: "community.homes" }), check("Heritage sites", "not_checked", false, { id: "heritage.sites" }), check("Natura 2000", "none", true, { id: "bio.sac" })],
  topic_labels: { biodiversity: "Biodiversity", "community-health": "Community and health" } });
export const evoraSecond = run({ id: "R2", site: { name: "Solar farm 5 km W of Évora", asset_label: "solar farm", role: "area", area_km2: 1 },
  decision: { value: "progress with targeted investigation", why: "Homes 600 m east; cork oak woodland on site" },
  flags: [{ id: "F-01", risk: "Montado cork oak woodland on site", theme: "biodiversity", severity: "medium", confidence: "medium", nearest_km: 0, traced: 1, untraced: 0 },
    { id: "F-02", risk: "Homes 600 m east", theme: "community-health", severity: "low", confidence: "high", nearest_km: 0.6, traced: 1, untraced: 0 }],
  checks: [check("Homes", "found", true, { id: "community.homes" }), check("Heritage sites", "not_checked", false, { id: "heritage.sites" }), check("Natura 2000", "none", true, { id: "bio.sac" })],
  topic_labels: { biodiversity: "Biodiversity", "community-health": "Community and health" } });
