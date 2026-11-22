// How findings are drawn: by screening theme (the NTR skill's themes), with distance as emphasis, big areas
// kept quiet underneath, and labels only where they help. No DOM, so it's testable; the page draws with it.
//
// Colours: a categorical set checked with the dataviz palette validator (light surface): all pass the lightness,
// chroma and normal-vision checks; green and ochre sit in the CVD 6–8 band, so the legend and the labels carry the
// theme too. Red is not used: it belongs to the person's own site.

export const THEMES = {
  biodiversity: { label: "Biodiversity", colour: "#008300" },
  land: { label: "Land and livelihoods", colour: "#c98500" },
  indigenous: { label: "Indigenous Peoples", colour: "#6250d6" },
  heritage: { label: "Cultural heritage", colour: "#d55181" },
  community: { label: "Community health and safety", colour: "#2a78d6" },
  context: { label: "Operating context", colour: "#5f6b73" },
};
// Short topic names for the run card's flags, where space is tight; the full names are in the flag's detail and the
// report.
export const THEME_SHORT = { biodiversity: "Biodiversity", land: "Land", indigenous: "Indigenous Peoples", heritage: "Heritage", community: "Community", context: "Context" };

export const THEME_IDS = Object.keys(THEMES);

// When the analyst doesn't say which theme a search serves, take it from the feature type or the atlas concept.
const BY_FEATURE_TYPE = {
  "protected area": "biodiversity", river: "biodiversity", "park or green space": "biodiversity",
  "heritage site": "heritage", cemetery: "heritage",
  settlement: "community", "residential area": "community", school: "community", "hospital or clinic": "community", "place of worship": "community",
};
const BY_CONCEPT = {
  "protected-area": "biodiversity", habitat: "biodiversity", "seabed-habitat": "biodiversity", "species-occurrence": "biodiversity", river: "biodiversity", greenspace: "biodiversity",
  "heritage-site": "heritage",
  settlement: "community", school: "community", "health-facility": "community", "natural-hazard": "community", "air-quality": "community",
  "marine-activity": "land", farmland: "land", "land-cover": "land", fisheries: "land",
  "indigenous-land": "indigenous",
};

export function themeFor({ theme, featureType, concepts = [] } = {}) {
  if (theme && THEMES[theme]) return theme;
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

// Which findings get a label on the map: everything near the site, and the nearest three of each theme.
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
