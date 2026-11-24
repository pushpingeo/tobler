// How findings are drawn: by topic (the neutral topics in catalogue/checks.json), with distance as emphasis, big
// areas kept quiet underneath, and labels only where they help. No DOM, so it's testable; the page draws with it.
//
// Colours (24 Nov): a map puts every colour beside every other, and no set of more than three hues passes the dataviz
// validator's all-pairs checks. So the thirteen topics share six map colours, the same five hues as before plus grey,
// and the legend, labels and tap details carry the topic name. Related topics share a colour. Red is not used: it
// belongs to the person's own site. Worst all-pairs: blue and violet (CVD ΔE 4.5, normal 10.5), as before.
const GREEN = "#008300", BLUE = "#2a78d6", OCHRE = "#c98500", MAGENTA = "#d55181", VIOLET = "#6250d6", GREY = "#5f6b73";

// Labels match catalogue/checks.json (a test keeps them in step); short names are for the run card's flags.
export const TOPICS = {
  biodiversity: { label: "Biodiversity", short: "Biodiversity", colour: GREEN },
  "landscape-visual": { label: "Landscape and visual", short: "Landscape", colour: GREEN },
  water: { label: "Water", short: "Water", colour: BLUE },
  "ground-soil": { label: "Ground and soil", short: "Ground", colour: OCHRE },
  "land-use": { label: "Land use", short: "Land use", colour: OCHRE },
  hazards: { label: "Hazards", short: "Hazards", colour: OCHRE },
  "air-climate": { label: "Air and climate", short: "Air", colour: OCHRE },
  heritage: { label: "Heritage", short: "Heritage", colour: MAGENTA },
  "community-health": { label: "Community and health", short: "Community", colour: VIOLET },
  indigenous: { label: "Indigenous Peoples", short: "Indigenous Peoples", colour: VIOLET },
  "material-assets": { label: "Material assets", short: "Assets", colour: GREY },
  topography: { label: "Topography and bathymetry", short: "Topography", colour: GREY },
  context: { label: "Context", short: "Context", colour: GREY },
};
export const TOPIC_IDS = Object.keys(TOPICS);

// Records from before 24 Nov carry the six IFC-based themes; flags from the IFC skill carry PS codes. Both read as
// topics, so old share links and saved projects keep their colours and names.
const LEGACY = { land: "land-use", community: "community-health", PS4: "community-health", PS5: "land-use",
  PS6: "biodiversity", PS7: "indigenous", PS8: "heritage" };
export const topicOf = (t) => (TOPICS[t] ? t : LEGACY[t] || LEGACY[String(t || "").toUpperCase()] || "context");
export const topicInfo = (t) => TOPICS[topicOf(t)];

// A MapLibre colour expression on a feature's "theme" property (the field name is kept for old records).
export function colourExpression(prop = "theme") {
  const keys = [...TOPIC_IDS.map((k) => [k, TOPICS[k].colour]), ...Object.entries(LEGACY).map(([k, v]) => [k, TOPICS[v].colour])];
  return ["match", ["get", prop], ...keys.flat(), TOPICS.context.colour];
}

// When the analyst doesn't say which topic a search serves, take it from the feature type or the atlas concept.
const BY_FEATURE_TYPE = {
  "protected area": "biodiversity", river: "water", "park or green space": "biodiversity",
  "heritage site": "heritage", cemetery: "heritage",
  settlement: "community-health", "residential area": "community-health", school: "community-health", "hospital or clinic": "community-health", "place of worship": "community-health",
};
const BY_CONCEPT = {
  "protected-area": "biodiversity", habitat: "biodiversity", "seabed-habitat": "biodiversity", "species-occurrence": "biodiversity", greenspace: "biodiversity",
  river: "water", "heritage-site": "heritage",
  settlement: "community-health", school: "community-health", "health-facility": "community-health",
  "natural-hazard": "hazards", "air-quality": "air-climate",
  "marine-activity": "material-assets", farmland: "land-use", "land-cover": "land-use", fisheries: "material-assets",
  "indigenous-land": "indigenous",
};

export function themeFor({ theme, featureType, concepts = [] } = {}) {
  if (theme && (TOPICS[theme] || LEGACY[theme])) return topicOf(theme);
  if (featureType && BY_FEATURE_TYPE[featureType]) return BY_FEATURE_TYPE[featureType];
  for (const c of concepts || []) if (BY_CONCEPT[c]) return BY_CONCEPT[c];
  return "context";
}

// Emphasis by distance from the site's edge: on site or near is strong, close is medium, wider is faint.
export function bandOf(km) {
  if (km == null) return "wider";
  return km <= 1 ? "near" : km <= 5 ? "close" : "wider";
}
export const BAND_OPACITY = { near: 1, close: 0.75, wider: 0.45 };

// Areas over this size get an outline and the faintest fill, and are drawn under smaller ones.
export const BIG_AREA_KM2 = 200;

// Which findings get a label on the map: everything near the site, and the nearest three of each topic.
// The rest are named on tap. features: [{ properties: { theme, distance_km } }]; sets properties.label_on.
export function chooseLabels(features, { perTheme = 3, nearKm = 1 } = {}) {
  const byTheme = new Map();
  for (const f of features) {
    const t = f.properties.theme;
    if (!byTheme.has(t)) byTheme.set(t, []);
    byTheme.get(t).push(f);
  }
  for (const list of byTheme.values()) {
    list.sort((a, b) => (a.properties.distance_km ?? 1e9) - (b.properties.distance_km ?? 1e9));
    list.forEach((f, i) => { f.properties.label_on = i < perTheme || (f.properties.distance_km ?? 1e9) <= nearKm; });
  }
  return features;
}

// The distance rings drawn round the site that was searched from: the NTR skill's default bands.
export function ringDistances(offshore) {
  return offshore ? [2, 10, 50] : [1, 5, 20];
}
