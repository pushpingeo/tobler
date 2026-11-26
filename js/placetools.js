// Tools the conversation agent uses to find places and build areas from words.
// The model works with ids (C3 for a found candidate, "Area 1" for a place); geometry stays here.
// A host object supplies the project's places and reference data, so the same code runs in the page and in the evaluation.
import { bringIn } from "./bringin.js";
import { placeRole, notASite } from "./siterole.js";
import { placesFromFile, fileSummary, fileOriginText, builtinToWgs84 } from "./fileimport.js";
import { serviceOriginText } from "./servicesite.js";
import * as turf from "./vendor/turf.js";
import * as G from "./geometry.js";
import * as R from "./reference.js";
import { rateConfidence, runCheck, MATCHES } from "./confidence.js";
import { atlasFindNamed, NAMED_KINDS, describeChecked } from "./atlasfeatures.js";
import { DATA_TOOL_DEFS, createDataTools, geometryDistanceKm } from "./datatools.js";
import { EPSG_TOOL_DEFS, createEpsgTools } from "./epsgtools.js";
import { elevationFrom, elevationSignificance } from "./elevation.js";
import { themeFor, TOPIC_IDS } from "./findings.js";
import { ASSET_TYPES } from "./reach.js";
import { searchAnchors, searchNominatim, searchNaturalEarth, searchWikidata, findFeaturesNear, featureOutline, FEATURE_TYPES, candidate, settlementNear } from "./gazetteer.js";
import { parseCoordinates, formatLatLon } from "./coords.js";

// The developable area skill's asset types and rule ids (skills/developable-area/SKILL.md "Rules"; a test checks they
// match), so the analyst can pass only what the skill knows.
export const BUDGET_ASSETS = ["solar", "bess", "wind-onshore", "warehouse", "general"];
export const BUDGET_RULE_IDS = ["nature-sites", "monuments", "world-heritage", "ancient-woodland", "water-bodies", "buildings", "roads-rail", "watercourses", "power-lines", "pipelines", "homes", "listed-buildings", "flood-zone-3", "flood-zone-2", "surface-water", "bmv-farmland", "grade-3-unsplit", "peat"];

// Common names that aren't Natural Earth's own, and seas (energy basins especially) by rough box.
const COUNTRY_ALIASES = { "united states": "united states of america", us: "usa", america: "united states of america", "u.s.": "usa", "u.s.a.": "usa",
  uk: "united kingdom", britain: "united kingdom", "great britain": "united kingdom", "russian federation": "russia",
  "democratic republic of the congo": "dem. rep. congo", drc: "dem. rep. congo", "ivory coast": "côte d'ivoire", "south korea": "south korea", uae: "united arab emirates" };
const box = (label, bbox) => ({ label, bbox });
const GOM = box("the Gulf of Mexico (Gulf of America)", [-98, 17.5, -80, 31]);
const SEAS = {
  "gulf of mexico": GOM, "gulf of america": GOM, gom: GOM,
  "north sea": box("the North Sea", [-4.5, 50.5, 12, 62]), "central north sea": box("the central North Sea", [-2, 55, 6, 58.5]),
  "irish sea": box("the Irish Sea", [-7, 51.5, -2.5, 55]), "celtic sea": box("the Celtic Sea", [-11, 48, -4, 52]),
  "norwegian sea": box("the Norwegian Sea", [-5, 62, 20, 72]), "barents sea": box("the Barents Sea", [15, 68, 60, 81]),
  "baltic sea": box("the Baltic Sea", [9, 53, 31, 66]), "mediterranean": box("the Mediterranean", [-6, 30, 36.5, 46]), "mediterranean sea": box("the Mediterranean", [-6, 30, 36.5, 46]),
  "gulf of guinea": box("the Gulf of Guinea", [-10, -6, 12, 7]), "persian gulf": box("the Persian Gulf", [47.5, 23, 57, 31]), "arabian gulf": box("the Persian Gulf", [47.5, 23, 57, 31]),
  "red sea": box("the Red Sea", [32, 12, 44, 30]), "caspian sea": box("the Caspian Sea", [46, 36, 55.5, 47.5]), "black sea": box("the Black Sea", [27, 40.5, 42, 47.5]),
  "caribbean": box("the Caribbean", [-88, 9, -59, 23]), "caribbean sea": box("the Caribbean", [-88, 9, -59, 23]),
  "south china sea": box("the South China Sea", [99, -3, 122, 25]), "timor sea": box("the Timor Sea", [122, -15.5, 133, -8]), "bass strait": box("Bass Strait", [143, -41.5, 149, -38]),
  "bay of bengal": box("the Bay of Bengal", [79, 5, 95, 23]), "arabian sea": box("the Arabian Sea", [51, 5, 77, 26]),
  "gulf of thailand": box("the Gulf of Thailand", [99, 5, 105.5, 14]), "java sea": box("the Java Sea", [105, -7.5, 119, -3]),
  "santos basin": box("the Santos Basin", [-49, -28, -40, -22]), "campos basin": box("the Campos Basin", [-42.5, -24, -39, -20.5]),
};

// A named project ("The Droves solar farm", "Newlands Hill wind farm"): the atlas is asked too, by the kind its name
// says, even when the analyst didn't give one (25 Nov: "Droves solar farm" by name only never reached the Planning
// Inspectorate's outline). Only names that say plainly what they are.
export const PROJECT_KINDS = [
  [/\b(wind ?farms?|wind ?parks?|wind energy|wind turbines?)\b/i, "wind farm or lease"],
  [/\b(solar ?(farms?|parks?|pv|scheme|project)|photovoltaic|battery (energy )?storage|bess|power (station|plant)|energy (park|centre|center)|hydro(electric|power)? (scheme|station|plant)|gas[- ]fired|biomass plant|energy from waste)\b/i, "power plant"],
  [/\b(mines?|quarry|quarries|colliery|opencast)\b/i, "mine or quarry"],
];
export function projectKind(names = []) {
  for (const n of names) for (const [re, k] of PROJECT_KINDS) if (re.test(n)) return k;
  return null;
}
const GENERIC_WORDS = /^(the|of|a|an|platform|platforms|field|fields|block|blocks|licen[cs]e|lease|mine|mines|farm|wind|solar|offshore|onshore|oil|gas|plant|power|station|project|site|terminal|port|harbour|harbor|tlp|spar|fpso|installation|facility|development|area|park|reserve)$/i;

const walkCoords = (g) => { const out = []; const w = (c) => (typeof c[0] === "number" ? out.push(c) : c.forEach(w)); w(g.coordinates); return out; };

const round = (v, d = 3) => (v == null ? v : Math.round(v * 10 ** d) / 10 ** d);

export function placeToolDefs(skills) {
  return [
    {
      name: "load_skill",
      description: `Load a skill: a written method for a kind of GIS work. Load it before doing that work and follow it. Available: ${skills.map((s) => `${s.name} (${s.description})`).join("; ")}`,
      input_schema: { type: "object", properties: { name: { type: "string", enum: skills.map((s) => s.name) } }, required: ["name"] },
    },
    {
      name: "find_place",
      description: "Search for a named place, asset or feature. Always searches OpenStreetMap (Nominatim), Wikidata (good for named mines, dams, power plants and ports), Natural Earth towns and a few fast layers (NSTA offshore installations, fields and UK licensing blocks; Crown Estate and Crown Estate Scotland offshore wind lease areas). Give `kind` and `area` to also search the AI Living World Atlas catalogue: it finds the published layers that hold that kind of thing in that area (any country) and searches them for the name. Do that for things OpenStreetMap rarely holds: licence blocks and concessions, fields, wells, leases, protected areas, official boundaries, numbered roads. The reply lists the layers searched, so you can say what was and wasn't checked. Returns candidates with ids (C1, C2…), type, source, position and size. Coordinates in the query (decimal degrees, degrees-minutes-seconds, or a British National Grid reference or eastings and northings) are read in code and returned as a candidate at that position, not searched for as a name.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The name or reference to search for, e.g. 'Jackdaw', 'Mocuba', '30/2', 'OML 145', 'Lake Turkana'" },
          also: { type: "array", items: { type: "string" }, maxItems: 3, description: "Optional: up to three other spellings or forms searched at the same time, e.g. ['Tasiast mine', 'Tasiast gold'] or ['Oil Mining Lease 145']. Cheaper than separate calls." },
          near: { type: "string", description: "Optional: a candidate id or place name to search near" },
          country: { type: "string", description: "Optional ISO 3166 two-letter country code to restrict OpenStreetMap results" },
          kind: { type: "string", enum: Object.keys(NAMED_KINDS), description: "Optional: what kind of thing it is, to search the atlas catalogue for it" },
          area: { type: "string", description: "With kind: where to look. A country name (its waters are included), a candidate id or a place name. Leave it out to use the map view." },
        },
        required: ["query"],
      },
    },
    {
      name: "find_features_near",
      description: `Find features of a type (from the atlas catalogue and OpenStreetMap) within a radius of an anchor (a candidate or a place). For an area or line, distances are from its edge (0 = inside or touching); for a point, from the point, with bearing. Reports how many were found in all and how many are listed. Found features go on the map and stay there. Assets near a point come largest first, everything else nearest first. Use it for "schools near X" or "hospitals within 5 km of Area 1", and to find an asset once a town anchors the search. One call does the whole search: don't search by name for kinds of things. Types: ${Object.keys(FEATURE_TYPES).join(", ")}.`,
      input_schema: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Candidate id (e.g. C2) or place name (e.g. Area 1)" },
          feature_type: { type: "string", enum: Object.keys(FEATURE_TYPES) },
          radius_km: { type: "number", description: "Search radius, 0.5 to 50 km" },
          name: { type: "string", description: "Optional: part of the feature's name" },
          theme: { type: "string", enum: TOPIC_IDS, description: "Optional, when screening: which topic this search is for (sets the colour on the map): one of the topic ids, as for get_data." },
        },
        required: ["anchor", "feature_type", "radius_km"],
      },
    },
    {
      name: "make_place",
      description: "Build a place on the map from an anchor, with a deterministic geometry tool. Shapes: point; square (area_km2 or side_km); circle (radius_km or area_km2); rectangle (width_km, height_km); feature (the anchor's own outline, e.g. a field or block); buffer (buffer_km around the anchor's geometry, e.g. a corridor along a line). Any shape can be offset from the anchor by offset_km along bearing_deg, and rotated by rotation_deg (clockwise). The place is shown as a proposal for the person to accept or adjust.",
      input_schema: {
        type: "object",
        properties: {
          anchor: { type: "string", description: "Candidate id or existing place name" },
          also: { type: "array", items: { type: "string" }, description: "With shape 'feature': more candidate ids whose outlines are joined with the anchor's, e.g. the A, B and C parts of one wind farm. With shape 'buffer': more pieces of the same thing (road or river segments) buffered and joined into one corridor." },
          shape: { type: "string", enum: ["point", "square", "circle", "rectangle", "feature", "buffer"] },
          area_km2: { type: "number" }, side_km: { type: "number" }, radius_km: { type: "number" },
          width_km: { type: "number", description: "East–west size before rotation" }, height_km: { type: "number", description: "North–south size before rotation" },
          buffer_km: { type: "number" }, rotation_deg: { type: "number" },
          offset_km: { type: "number" }, bearing_deg: { type: "number", description: "Degrees clockwise from north for the offset" },
          words: { type: "string", description: "The person's own words that this place answers" },
          name: { type: "string", description: "Optional short name for the place, as the person would say it (e.g. 'Jackdaw', 'Linlithgow Palace 4 km²', 'M9 corridor'). Leave out to name it after the anchor and the shape. No candidate ids (C1) or source names in it. Refer to the place by the name the tool returns." },
          match: { type: "string", enum: MATCHES, description: "How the anchor relates to what the person wants. named_place: they asked for this place itself (a palace, a town, a block, a field). name_and_type: the asset itself, matched by name and of the right type (a mine for a mine). type_near_clues: a feature of the right type found where the clues point, its name not confirmed. name_only: the name matches but the type is wrong or unknown. settlement_or_region: a town, village or region stands in for the site. none: nothing specific." },
          checks: { type: "array", description: "Every distance clue the PERSON gave that the place can be checked against, e.g. 'Nok Kundi lies about 80 km south-east of the mine' → { against: <Nok Kundi's candidate id>, expected_km: 80, direction: 'SE', quote: 'Nok Kundi lies about 80 km south-east of the mine' }. Only clues in the person's own words: never make one up from what you know (a check without a quote from the person is left out). Direction is the way you travel FROM the site TO that feature. Give all the person gave; they are measured, not trusted.", items: { type: "object", properties: { against: { type: "string", description: "Candidate id" }, expected_km: { type: "number" }, direction: { type: "string", description: "Compass point from the site to it: N, NE, ENE… (optional)" }, quote: { type: "string", description: "The exact words in the person's message this clue comes from" } }, required: ["against", "expected_km", "quote"] } },
          site_defined: { type: "boolean", description: "True when the person defines the site themselves by its size and where it is ('a 1 km² site 5 km west of Évora', 'a 2 km square 10 km north of Ayr'): nothing existing is meant, so the shape you build IS the site. Leave out when they name or describe something that exists (a wind farm, a mine, a field) whose outline you're standing in for." },
          replaces: { type: "string", description: "Name of a place YOU proposed earlier in this conversation that this one replaces (a rebuild or a correction). The old one is removed, the new one takes its name, and the old one's distance checks carry over. Use it instead of leaving a duplicate on the map." },
          reason: { type: "string", description: "One line: the evidence for the location" },
          clip: { type: "object", description: "Optional: cut the shape to a limit, e.g. a corridor along the M9 'within 5 km of Linlithgow' → { to: <Linlithgow's candidate id>, within_km: 5 }. Without within_km it's cut to the outline of 'to' (a place or a candidate with an outline, e.g. 'only inside Fife').", properties: { to: { type: "string", description: "Candidate id or place name" }, within_km: { type: "number" } }, required: ["to"] },
          scale: { type: "string", enum: ["local", "regional", "global"], description: "Only when the request itself says the scale of the work (e.g. 'screen Mozambique' is global, 'the whole of the Moray Firth' regional) and it differs from the shape's size. Otherwise leave it out and the size decides." },
        },
        required: ["anchor", "shape", "words", "match", "reason"],
      },
    },
    {
      name: "remove_place",
      description: "Remove a place from the map and the project. Only when the person asks to remove or delete it, or to clear a proposal of your own that's no longer wanted (to rebuild one, use make_place with replaces instead). Places the person drew or accepted are removed only when the person asks in their latest message.",
      input_schema: { type: "object", properties: { place: { type: "string", description: "Place name" }, reason: { type: "string", description: "One short line: why it's being removed" } }, required: ["place", "reason"] },
    },
    {
      name: "offer_choices",
      description: "When several found candidates could be what the person means and the difference matters, show them as choices: the person flicks through them on the map, each with its source, and picks one or takes your recommendation. Give two to five candidate ids in order of preference, the one you recommend, and a one-line reason. The turn ends as soon as they're shown, so write any line for the person in the same step as this call; their pick comes back as their next message.",
      input_schema: {
        type: "object",
        properties: {
          candidates: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          recommended: { type: "string", description: "The candidate id you recommend" },
          reason: { type: "string", description: "One line: why you recommend it" },
          question: { type: "string", description: "Optional: what the person is choosing, e.g. 'Which Linlithgow Palace do you mean?'" },
        },
        required: ["candidates", "recommended", "reason"],
      },
    },
    {
      name: "edit_place",
      description: "Change a place: rotate (degrees clockwise), resize to an area (km²) or length (km), move (km along a bearing) or rename. Rotation and resizing keep the centre and are done on the ground, not on the map projection.",
      input_schema: {
        type: "object",
        properties: {
          place: { type: "string", description: "Place name, e.g. Jackdaw 3 km² or Area 1" },
          rotate_deg: { type: "number" }, resize_to: { type: "number" },
          move_km: { type: "number" }, move_bearing_deg: { type: "number" },
          rename: { type: "string" },
        },
        required: ["place"],
      },
    },
    {
      name: "get_place",
      description: "Full details of a place: size, where it is, how it was made and its edit history.",
      input_schema: { type: "object", properties: { place: { type: "string" } }, required: ["place"] },
    },
    {
      name: "use_file_features",
      description: "Make the site from a file the person dropped on the map (a shapefile, zip or GeoJSON; read in their browser, never uploaded). Only when the project summary says a file is loaded, and the person has said in words which features to use (they can also pick on the card themselves). The features are copied into places and the file is then forgotten. Polygons become the site's outline. Points and lines need width_m (metres either side: 1 m for the line itself, 30 m for a cable corridor); if the person hasn't said, ask them, don't choose. Several features: combine 'parts' makes one site in pieces (a wind farm's separate areas), 'separate' makes one place each; if they haven't said which, ask.",
      input_schema: {
        type: "object",
        properties: {
          features: { type: "array", items: { type: "string" }, description: "Feature ids from the file summary (F1, F2…), or [\"all\"]" },
          combine: { type: "string", enum: ["parts", "separate"] },
          width_m: { type: "number", description: "For points and lines only: the width round them in metres, as the person gave it" },
          name: { type: "string", description: "Optional: the site's name, if the person gave one" },
        },
        required: ["features"],
      },
    },
    {
      name: "set_file_transformation",
      description: "Settle the coordinates of a dropped file's layer that is waiting for a decision (the project summary lists it under waiting_for_a_decision, with its options). Only after the person has answered in their own words. operation: the EPSG code of the transformation they chose (one of the options, or another between the same CRSs that can be applied here), or \"none\" to use the coordinates with no datum shift (flagged; only if they accept that). Load the coordinate-reference skill first and follow its section 4.",
      input_schema: {
        type: "object",
        properties: {
          layer: { type: "string", description: "The layer's name, from the summary" },
          operation: { type: "string", description: "An EPSG transformation code, e.g. '1314', or 'none'" },
        },
        required: ["layer", "operation"],
      },
    },
    ...DATA_TOOL_DEFS,
    ...EPSG_TOOL_DEFS,
    {
      name: "get_elevation",
      description: "Elevation over a place or candidate, on land or at sea: typical, lowest and highest of up to 25 points sampled over it, in metres, positive up (land above sea level is positive, the seabed negative), from published elevation models. At sea it also gives the water depth (depth = -elevation). Use it when height or depth matters to the question (flooding, altitude, what can be built in that depth of water). Cells are a few hundred metres on land and in open ocean, so it's for screening, not design.",
      input_schema: { type: "object", properties: { place: { type: "string", description: "Place name (e.g. Area 1) or candidate id" } }, required: ["place"] },
    },
    {
      name: "screen_site",
      description: "Screen a place for environmental constraints and environmental and social (E&S) risk (themes: land and livelihoods, biodiversity, Indigenous Peoples, cultural heritage, community health and safety, operating context). Runs the screening method as its own sealed run with the data tools, then shows a run card (flags first, evidence on the map, the distances used with a slider, gaps) and returns the headline. Use it for any request to screen a site or ask what risks, sensitivities or constraints it raises. The place must already exist (find or build it first). Each check looks out its own distance (from the check, the asset type and size) unless the person gives their own. Call it as soon as the place is on the map, with everything they asked for, even for a place you built from their words in this turn: Tobler then shows them the place and asks (is it right, or which part of a lake, country, town or road) before anything runs, and keeps what was asked for their yes. Takes 30 to 90 seconds.",
      input_schema: {
        type: "object",
        properties: {
          place: { type: "string", description: "Place name, e.g. Jackdaw 3 km² or Area 1" },
          asset_type: { type: "string", enum: ASSET_TYPES, description: "What would be built or done there. Use 'other' if unknown." },
          assumed: { type: "boolean", description: "True if the person didn't say the asset type and you inferred it (e.g. an oil field's name)." },
          planned: { type: "string", description: "With asset_type other: what the person said is planned, in their words, when it isn't one of the asset types (housing, a warehouse, offices). The screen runs at once as a general screen, and the card says the method wasn't built for it." },
          stage: { type: "string", enum: ["greenfield", "expansion", "existing asset"], description: "Only if the person said; otherwise leave out (greenfield is assumed and said)." },
          capacity_mw: { type: "number", description: "Only if the person gave it" },
          tip_height_m: { type: "number", description: "Wind turbine tip height, only if the person gave it" },
          distances: { type: "array", description: "Only if the person gave distances. One item per thing they said, with the number and unit exactly as they said them; never convert. what: \"all\" for every check (\"look out to 5 km\"), a topic (heritage, water, biodiversity…), a check (\"listed buildings\", \"homes\"). Tobler converts the unit and decides whether it's a search or a protection distance.", items: { type: "object", properties: { what: { type: "string" }, value: { type: "number" }, unit: { type: "string", description: "as said: m, km, metres, miles, feet…" } }, required: ["what", "value", "unit"] } },
          focus: { type: "string", description: "Optional: what the person is most concerned about, in their words" },
          whole: { type: "boolean", description: "Only when the person, asked which part of a place to screen, said to use all of it as it is (the whole lake, the whole country)." },
          extent: { type: "string", enum: ["around", "inside"], description: "Areas only. around (default): the area and its surroundings, each check out to its own distance. inside: only what lies inside the area or touches its edge; use it only when the person asks to keep the screen within the area (\"only inside the block\", \"just within the boundary\"). An around screen of an area can also be switched to inside-only on the run card, with no new fetching." },
        },
        required: ["place", "asset_type"],
      },
    },
    {
      name: "ask_asset_type",
      description: "Before screening, when the person hasn't said what's planned at the place and it isn't clear from the place itself (a named oil field, a wind lease, their earlier words), show quick-pick buttons of asset types, with a general-screen option, instead of asking in words. The turn ends as soon as they're shown, so write any line for the person in the same step as this call; their pick comes back as their next message, and you screen then.",
      input_schema: { type: "object", properties: { place: { type: "string", description: "Place name" }, question: { type: "string", description: "Optional: the question above the buttons, if the default (\"What's planned at <place>?\") doesn't fit" } }, required: ["place"] },
    },
    {
      name: "run_study",
      description: "Run a study other than the constraints screen on a place that's on the map, as its own sealed run with a card. \"contamination-desk-study\": an early contaminated-land look from open records set out as sources, pathways and receptors, for sites on land; use it when the person asks about contamination, past land use, landfill, pollution or ground conditions (20 to 40 seconds). \"developable-area\": an area budget on the site's outline (gross area, each deduction with its reason, the net developable area, soft constraints), for an outline on land, not a point or a search area; use it when the person asks for the developable, net or usable area, area discounting or how many hectares they can use (10 to 30 seconds). Either study also runs when the person picks it from the skills. As with screen_site, call it as soon as the place is on the map: Tobler asks the person first if they haven't seen the place.",
      input_schema: { type: "object", properties: {
        place: { type: "string", description: "Place name" },
        study: { type: "string", enum: ["contamination-desk-study", "developable-area"] },
        focus: { type: "string", description: "Optional, desk study: what the person asked about especially" },
        whole: { type: "boolean", description: "Only when the person, asked which part of a place to use, said to use all of it as it is." },
        asset_type: { type: "string", enum: BUDGET_ASSETS, description: "Developable area: what would be built. general if the person hasn't said (the card says it was assumed)." },
        distances: { type: "array", description: "Only if the person gave distances. One item per thing they said, with the number and unit exactly as they said them; never convert. what: \"all\" for every check (\"look out to 5 km\"), a topic (heritage, water, biodiversity…), a check (\"listed buildings\", \"homes\"), or for the developable area a deduction to keep that far from (" + BUDGET_RULE_IDS.join(", ") + "). Tobler converts the unit and decides whether it's a search or a protection distance.", items: { type: "object", properties: { what: { type: "string" }, value: { type: "number" }, unit: { type: "string", description: "as said: m, km, metres, miles, feet…" } }, required: ["what", "value", "unit"] } },
        leave_out: { type: "array", items: { type: "string", enum: BUDGET_RULE_IDS }, description: "Developable area: deductions the person asked to ignore (buildings to be cleared)" },
        as_soft: { type: "array", items: { type: "string", enum: BUDGET_RULE_IDS }, description: "Developable area: deductions the person would treat as usable at a cost (flood zone 3 for raised solar panels)" },
      }, required: ["place", "study"] },
    },
    {
      name: "offer_skills",
      description: "When a place is settled but the person hasn't said which analysis they want (they named a place and what's planned, but not a screen or another skill), show the skills on offer as buttons under your reply instead of choosing one for them. The turn ends as soon as they're shown, so write any line for the person in the same step as this call; their pick comes back as their next message.",
      input_schema: { type: "object", properties: { place: { type: "string", description: "Place name" } }, required: ["place"] },
    },
    {
      name: "get_run",
      description: "Details of a screening run (R1, R2…; leave out for the latest): flags with their evidence, what was checked and the gaps. For follow-up questions about a screen; don't re-run to answer them.",
      input_schema: { type: "object", properties: { run: { type: "string" } } },
    },
    {
      name: "bring_in_layers",
      description: "After a screen or study, Tobler may offer atlas layers for what wasn't checked (the project summary lists them with ids L1, L2… under the run). When the person says yes to some or all of them, bring them in: each is fetched for the run's site, held to the run's distances, and put on the map with its source. An empty list means the person said no. Only for layers on offer, and only when the person has answered the offer; Tobler writes the reply.",
      input_schema: { type: "object", properties: { run: { type: "string", description: "The run the layers were offered for, e.g. R1" }, layers: { type: "array", items: { type: "string" }, description: "Offer ids (L1, L2…), or [\"all\"]; [] to decline" } }, required: ["run", "layers"] },
    },
    {
      name: "show_on_map",
      description: "Bring findings into view: fits the map to the given feature ids (from find_features_near or get_data), or to everything found so far, together with the place in focus. Findings already stay on the map; use this when the person asks to see them. clear: true removes all findings from the map.",
      input_schema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, description: "Feature ids; leave out for all findings" }, clear: { type: "boolean" } } },
    },
  ];
}

// host: { places(), addPlace({feature, origin}), updatePlace(name, feature, words), renamePlace(name, newName),
//         findPlace(name), ref, anchors (sources), fetchFn, headers, onCandidates(list), skillText(name) }
const norm = (t) => String(t || "").toLowerCase().replace(/[‘’“”"'`]/g, "").replace(/\s+/g, " ").trim();

// Words that ask for a screen or a judgement on the place, in any of the person's messages.
const SCREEN_ASKED = /\b(screen\w*|constraints?|risks?|sensitivit\w*|issues?|due diligence|e&s|environmental (check|assessment|review)|assess\w*|red flags?)\b/i;

export function createPlaceTools(host) {
  // The person's licence settings, for every catalogue search (Esri MLA and non-commercial data are off by default).
  const allowed = () => ({ esri: !!host.esriLicence?.(), nonCommercial: !!host.nonCommercial?.() });
  const cands = new Map();
  let n = 0;
  const keep = (c) => { const id = `C${++n}`; cands.set(id, { ...c, id }); return id; };
  // A place the analyst built from words is still the analyst's to rebuild or clear while it's a proposal, or after the
  // person said "Not quite" (status "revising"): a rejected proposal isn't the person's (Shell House, Perth, 24 Nov:
  // the rejected outline stayed beside its replacement, because both replace and remove refused it).
  const analystsOwn = (p) => p.origin?.method === "words" && ["proposed", "revising"].includes(p.status);
  // Places built from words in the current turn: the person hasn't seen them yet, so they aren't screened until the
  // person has looked (Rob, 24 Nov: "screen a warehouse location in Livingston" found Livingston and screened it at
  // once). Typed coordinates are exempt: they're exactly what the person gave. The page calls newTurn() per message.
  const unseen = new Set();
  // A run held back until the person has seen the place, or said which part of it (plan item 1, 25 Nov): what was
  // asked is kept here, in code, so a yes runs exactly that, whoever remembers it. Keyed by place id (or name).
  const pending = new Map();
  const pkey = (p) => p.id ?? p.name;
  // What the person will get on a yes, in words, from what was asked.
  const queued = (tool, i) => {
    if (tool === "run_study") {
      const entry = (host.profile?.()?.skills_offered || []).find((x) => x.id === i.study);
      return `${/^[aeiou]/i.test(entry?.label || "") ? "an" : "a"} ${(entry?.label || String(i.study || "study").replace(/-/g, " ")).toLowerCase()}`;
    }
    const what = (i.planned && String(i.planned).replace(/^(a|an|the)\s+/i, "")) || (i.asset_type && i.asset_type !== "other" ? host.screening?.assetLabel?.(i.asset_type) || i.asset_type.replace(/-/g, " ") : null);
    return `a constraints screen${what ? ` for ${/^[aeiou]/i.test(what) ? "an" : "a"} ${what}` : ""}`;
  };
  // Before a run: hold it if the place isn't a site, or the person hasn't seen it yet. Returns the held result, or null.
  async function holdRun(tool, p, i) {
    const k = pkey(p);
    if (!i.whole) {
      const d = await R.describe(host.ref, p.feature);
      const n = notASite(p.origin || {}, p.feature.geometry, { area_km2: d.area_km2 ?? null, offshore: !!d.offshore });
      if (n) {
        pending.set(k, { tool, input: { ...i }, held: "which_part", place: p.name });
        return { held: "which_part", place: p.name, kind: n.kind, what: n.what, ...(n.area_km2 ? { area_km2: n.area_km2 } : {}), geometry: p.feature.geometry.type, queued: queued(tool, i) };
      }
    }
    if (unseen.has(p) && p.status === "proposed") {
      pending.set(k, { tool, input: { ...i }, held: "confirm", place: p.name });
      const d = await R.describe(host.ref, p.feature);
      const role = placeRole(p.origin || {}, p.feature.geometry);
      const a = p.origin?.anchor || {};
      return { held: "confirm", place: p.name, anchor: a.name || a.place || null, source: a.source?.publisher || a.source?.title || null,
        confidence: p.origin?.confidence || null, role: role.role, role_why: role.why, geometry: p.feature.geometry.type,
        ...(d.area_km2 != null ? { area_km2: d.area_km2 } : {}), ...(d.length_km != null ? { length_km: d.length_km } : {}), queued: queued(tool, i) };
    }
    return null;
  }
  // What's asked and waiting, for the project summary: the person's yes runs it.
  const pendingLines = () => [...pending.values()].filter((x) => host.findPlace(x.place))
    .map((x) => `- ${x.place}: ${queued(x.tool, x.input)} is waiting for the person's ${x.held === "which_part" ? "answer on which part of it is the site" : "yes that the place is right"} (${x.tool} ${JSON.stringify(x.input)})`);

  const resolve = (ref) => {
    if (!ref) throw new Error("No anchor given.");
    const c = cands.get(String(ref).trim().toUpperCase());
    if (c) return { feature: { type: "Feature", properties: {}, geometry: c.geometry }, lonlat: c.lonlat, label: c.name || c.id, cand: c };
    const p = host.findPlace(ref);
    if (!p) {
      // The model sometimes passes a name instead of an id: take the most recent candidate with that name.
      const byName = [...cands.values()].reverse().find((x) => x.name && x.name.toLowerCase() === String(ref).trim().toLowerCase());
      if (byName) return resolve(byName.id);
    }
    if (p) {
      const at = p.feature.geometry.type === "Point" ? p.feature.geometry.coordinates : turf.centroid(p.feature).geometry.coordinates;
      return { feature: p.feature, lonlat: at, label: p.name, place: p };
    }
    // Coordinates given straight as the anchor are read in code, like find_place does.
    const typed = typedCandidate(ref);
    if (typed) return resolve(keep(typed));
    throw new Error(`"${ref}" isn't a candidate id from this conversation or a place name. Use find_place first.`);
  };

  // Coordinates the person typed (decimal degrees, degrees-minutes-seconds, British National Grid), read in code
  // (js/coords.js) and kept as a candidate like any found feature. Rob, 20 Nov: "55.522759, -5.650122" went to the
  // place-name search and came back as the county centre 100 km away.
  // Grid references (British National Grid) arrive on their own datum (OSGB36). They're converted to WGS84 the same
  // way as site files (Rob, 23 Nov): the transformation is chosen from the EPSG registry for where they are and applied
  // by js/transform.js. Done once per reference before any tool runs (exec below), and kept here.
  const typedWgs = new Map(); // input → { lon, lat, datum, transformation } | { ask }
  async function readTyped(q) {
    const c = parseCoordinates(q);
    if (!c?.grid || typedWgs.has(c.input)) return;
    let why = "the EPSG registry isn't connected here";
    const g = epsgTools.fileGeodesy;
    if (g?.available) {
      try {
        const pl = await g.plan({ source: c.grid.epsg, lonlat: [c.lon, c.lat] });
        if (pl.kind === "apply") {
          const [[lat, lon]] = pl.apply([[c.lat, c.lon]]);
          const o = pl.operation;
          typedWgs.set(c.input, { lon, lat, transformation: o, datum: `OSGB36, converted to WGS84 with EPSG:${o.code}, ${o.name} (good to about ${o.accuracy_m} m), chosen from the EPSG registry for where it is` });
          return;
        }
        if (pl.kind === "ask") { typedWgs.set(c.input, { ask: pl.why, options: pl.options }); return; }
        if (pl.kind === "none") { typedWgs.set(c.input, { lon: c.lon, lat: c.lat, datum: "already on WGS84" }); return; }
      } catch (e) { why = `the EPSG registry couldn't be reached (${String(e.message || e).slice(0, 80)})`; }
    }
    const [lon, lat] = await builtinToWgs84(c.grid.epsg, [c.grid.e, c.grid.n]);
    typedWgs.set(c.input, { lon, lat, fallback: true, datum: `OSGB36, converted to WGS84 with Tobler's built-in shift (good to a few metres), because ${why}` });
  }

  function typedCandidate(q) {
    const c = parseCoordinates(q);
    if (!c) return null;
    let { lon, lat, datum } = c;
    if (c.grid) {
      const w = typedWgs.get(c.input);
      if (!w || w.ask) return null; // not converted (yet), or it needs a decision: never use the unshifted position
      ({ lon, lat, datum } = w);
    }
    const cand = candidate({
      name: c.grid ? `${c.input} (${formatLatLon(lon, lat)})` : c.read, type: "coordinates you typed", geometry: { type: "Point", coordinates: [lon, lat] },
      source: { id: "typed", title: "coordinates you typed", publisher: "You", licence: "your own" },
      extra: { typed: c.input, read_as: c.system, ...(c.order ? { order: c.order } : {}), datum,
        ...(c.easting != null ? { easting: c.easting, northing: c.northing } : {}), ...(c.precision_m ? { grid_square_m: c.precision_m } : {}),
        ...(c.alternative ? { other_reading: `${c.alternative.read}, if the numbers were the other way round` } : {}) },
    });
    cand.lonlat = [lon, lat]; // exactly as typed (or as converted), not rounded
    return cand;
  }

  const compact = (c) => ({
    id: c.id, name: c.name, type: c.type, source: `${c.source.publisher} – ${c.source.title}`, licence: c.source.licence,
    lat: round(c.lonlat[1], 4), lon: round(c.lonlat[0], 4),
    ...(c.area_km2 != null ? { area_km2: c.area_km2 } : {}), ...(c.length_km != null ? { length_km: c.length_km } : {}),
    ...(c.distance_km != null ? { distance_km: c.distance_km, bearing_deg: c.bearing } : {}),
    ...(c.edge_km != null ? { nearest_edge_km: c.edge_km } : {}), ...(c.contains_anchor ? { contains_anchor: true } : {}),
    ...(c.outline ? { has_outline: true, note: "Anchors on its centre; its outline is used with shape \"feature\"." } : {}),
    ...(Object.keys(c.extra || {}).length ? { details: c.extra } : {}),
  });

  async function placeSummary(p) {
    const d = await R.describe(host.ref, p.feature);
    return { place: p.name, status: p.status, summary: R.summaryLine(d), scale: d.scale, area_km2: d.area_km2, length_km: d.length_km, countries: d.countries, offshore: d.offshore };
  }

  // Where to search the catalogue: a country (with a margin for its waters), a sea, a candidate or place, any other
  // named area via OpenStreetMap, or the map view. (Mars, 17 Nov: "United States" and "Gulf of America" weren't
  // recognised, so the catalogue was never searched, and the USA's box spanned the date line, so it covered the world.)
  async function catalogueArea(area, nearAt) {
    if (area) {
      const want = String(area).trim().toLowerCase().replace(/^the\s+/, "");
      const sea = SEAS[want];
      if (sea) return { bbox: sea.bbox, label: sea.label };
      try {
        const countries = await host.ref.get("countries");
        const name = COUNTRY_ALIASES[want] || want;
        // The country itself first; its sovereign's territories only when nothing has that name ("United Kingdom" had
        // pulled in all 18 UK territories and been labelled Dhekelia, Ben Nevis log, 20 Nov).
        const own = countries.features.filter((f) => [f.properties.name, f.properties.iso].some((v) => v && v.toLowerCase() === name));
        const hit = own.length ? own : countries.features.filter((f) => f.properties.sovereign?.toLowerCase() === name);
        if (hit.length) {
          let b = turf.bbox({ type: "FeatureCollection", features: hit });
          let note = "";
          if (b[2] - b[0] > 180) {
            // Crosses the date line or has far-flung parts (USA, Russia, Fiji, New Zealand): use the largest part.
            const parts = hit.flatMap((f) => (f.geometry.type === "MultiPolygon" ? f.geometry.coordinates.map((c) => turf.polygon(c)) : [f]));
            const big = parts.reduce((a, x) => (turf.area(x) > turf.area(a) ? x : a));
            b = turf.bbox(big); note = " (main part only)";
          }
          return { bbox: [b[0] - 2.5, b[1] - 2.5, b[2] + 2.5, b[3] + 2.5].map((v, i) => round(Math.max(Math.min(v, i % 2 ? 85 : 180), i % 2 ? -85 : -180), 3)), label: `${hit[0].properties.name} and its waters${note}` };
        }
      } catch { /* reference not loaded */ }
      try {
        const a = resolve(area);
        const b = /Polygon|Line/.test(a.feature.geometry.type) ? turf.bbox(a.feature) : null;
        const pad = 0.5;
        return { bbox: b ? [b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad] : [a.lonlat[0] - 1, a.lonlat[1] - 1, a.lonlat[0] + 1, a.lonlat[1] + 1], label: `around ${a.label}` };
      } catch { /* not a candidate or place */ }
      try {
        // Any other named area (a state, a province, a bay): OpenStreetMap's outline, or its centre ± 1.5°.
        const [g] = await searchNominatim(String(area), { fetchFn: host.fetchFn, headers: host.headers, limit: 1 });
        if (g) {
          const b = g.outline ? turf.bbox({ type: "Feature", properties: {}, geometry: g.outline }) : [g.lonlat[0] - 1.5, g.lonlat[1] - 1.5, g.lonlat[0] + 1.5, g.lonlat[1] + 1.5];
          if (b[2] - b[0] < 60) return { bbox: b.map((v) => round(v, 3)), label: `${g.name} (from OpenStreetMap)` };
        }
      } catch { /* OpenStreetMap down */ }
    }
    if (nearAt) return { bbox: [nearAt[0] - 1, nearAt[1] - 1, nearAt[0] + 1, nearAt[1] + 1], label: "around the 'near' anchor" };
    const v = host.view?.();
    if (v) return { bbox: v, label: `the map view${area ? ` ("${area}" wasn't recognised)` : ""}` };
    return null;
  }

  async function searchCatalogue(names, kind, area, nearAt, { maxSpanDeg = null } = {}) {
    if (!host.atlas) return { report: { not_checked: "The atlas isn't connected here." } };
    const where = await catalogueArea(area, nearAt);
    if (!where) return { report: { not_checked: `"${area}" isn't a country, candidate or place, and there's no map view: find the area first.` } };
    if (maxSpanDeg && Math.max(where.bbox[2] - where.bbox[0], where.bbox[3] - where.bbox[1]) > maxSpanDeg && !area) {
      return { report: { not_checked: `${kind} layers weren't searched: no area or country was given and the map view is too wide.` } };
    }
    try {
      const r = await atlasFindNamed(names, kind, where.bbox, { call: host.atlas, allow: allowed() });
      return { candidates: r.candidates, report: {
        searched: `${kind} layers covering ${where.label}`, found: r.candidates.length,
        layers_checked: describeChecked(r.checked), layers_found: r.layers_found,
        ...(r.layers_not_checked ? { more_layers_not_checked: r.layers_not_checked } : {}),
        ...(r.layers_found ? {} : { note: `The catalogue has no ${kind} layers covering ${where.label}.` }),
        ...(r.left_out?.length ? { left_out_for_licence: `${r.left_out.length} layer${r.left_out.length > 1 ? "s" : ""} (${r.left_out.slice(0, 2).map((x) => x.title).join("; ")}): ${r.left_out[0].why}` } : {}),
      } };
    } catch (e) {
      return { report: { not_checked: String(e.message || e).slice(0, 160) } };
    }
  }

  const run = {
    async load_skill({ name }) {
      return { skill: name, method: host.skillText(name) };
    },

    async find_place({ query, also = [], near, country, kind, area }) {
      // "near" is a hint: if it isn't a candidate or place yet, search without it rather than fail the call.
      let nearAt = null, nearNote = null;
      if (near) { try { nearAt = resolve(near).lonlat; } catch { nearNote = `"${near}" isn't a candidate id or place yet, so the search wasn't narrowed to it.`; } }
      const asked = [...new Set([query, ...(Array.isArray(also) ? also : [])].map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 4);
      // Coordinates aren't names: read them in code and keep them out of the name searches.
      const typed = [];
      for (const q of asked) { const c = typedCandidate(q); if (c) typed.push(c); }
      const names = asked.filter((q) => !parseCoordinates(q));
      const undecided = asked.map((q) => parseCoordinates(q)).filter((c) => c?.grid && typedWgs.get(c.input)?.ask)
        .map((c) => `${c.input}: ${typedWgs.get(c.input).ask}`);
      if (undecided.length && !typed.length && !names.length) {
        return { searched_for: asked, candidates: [], needs_decision: undecided,
          note: "The grid reference couldn't be converted to WGS84 without a decision, so nothing was placed." };
      }
      if (typed.length && !names.length) {
        // Two numbers that could be either way round: decided in code where land and sea tell them apart (a site
        // typed longitude first lands in the ocean read the usual way); otherwise both go back for the person to pick.
        let orderNote = null;
        for (let i = 0; i < typed.length; i++) {
          const c = typed[i], alt = c.extra.other_reading && parseCoordinates(c.extra.typed)?.alternative;
          if (!alt) continue;
          const other = typedCandidate(`${alt.lat}, ${alt.lon}`);
          if (!other) continue;
          other.extra = { ...c.extra, other_reading: `${c.name}, read the other way round`, order: c.extra.order === "lat, lon" ? "lon, lat" : "lat, lon" };
          let seaA = null, seaB = null;
          try { seaA = (await R.describe(host.ref, { type: "Feature", properties: {}, geometry: c.geometry })).offshore; seaB = (await R.describe(host.ref, { type: "Feature", properties: {}, geometry: other.geometry })).offshore; } catch { /* reference not loaded */ }
          if (seaA && seaB === false) { typed[i] = other; orderNote = `Read longitude first: as typed the other way it would be at sea (${c.name}), this way it's on land.`; }
          else if (seaA === seaB) { typed.splice(i + 1, 0, other); i++; orderNote = "Both readings are plausible (both on land or both at sea), so both are candidates."; }
        }
        const list = typed.map((c) => cands.get(keep(c)));
        // Where it is, in words: the settlement it's in or near (Nominatim reverse; skipped if that fails).
        await Promise.all(list.map(async (c) => { try { const near = await settlementNear(c.lonlat, { fetchFn: host.fetchFn, headers: host.headers }); if (near) c.extra.near = near; } catch { /* no name nearby */ } }));
        host.onCandidates?.(list);
        return { searched_for: asked, candidates: list.map(compact),
          note: `Coordinates, read in code, not searched for as a name.${orderNote ? ` ${orderNote}` : ""}` };
      }
      const errors = [];
      // Every source and every spelling at once, the catalogue too; results keep this order (authoritative first).
      const perName = (q) => Promise.allSettled([
        searchAnchors(host.anchors, q, { near: nearAt, fetchFn: host.fetchFn }),
        searchNominatim(q, { near: nearAt, country, fetchFn: host.fetchFn, headers: host.headers }),
        searchWikidata(q, { fetchFn: host.fetchFn, headers: host.headers }),
      ]);
      // The catalogue also gets the name without words that describe the kind of thing ("Mars platform" → "Mars"),
      // because a publisher's record rarely repeats them ("A-Mars TLP"; Mars missed on 17 Nov when the analyst
      // didn't happen to try "Mars TLP").
      const core = (n) => n.split(/\s+/).filter((w) => !GENERIC_WORDS.test(w)).join(" ").trim();
      const catalogueNames = [...new Set([...names, ...names.map(core).filter((c) => c && c.length >= 3)])].slice(0, 6);
      // A kind read from the name is searched where the call says (its area, or its country), or in a map view no
      // wider than a region: the whole world's power-plant layers would be slow and noisy.
      // Only the main query: a project name the analyst adds as an alternative spelling to an address search
      // ("Riccarton solar farm" beside "Riccarton Road") made a 3 s search take 34 s in a replay (26 Nov).
      const named = !kind ? projectKind([asked[0]]) : null;
      const namedSearch = named ? searchCatalogue(catalogueNames, named, area || country, nearAt, { maxSpanDeg: 15 }) : null;
      const [atlas, ...byName] = await Promise.all([kind ? searchCatalogue(catalogueNames, kind, area, nearAt) : namedSearch, ...names.map(perName)]);
      if (atlas?.report && named) atlas.report.kind_from_name = named;
      const anchors = [], others = [];
      byName.forEach(([an, nom, wd], i) => {
        const q = names[i];
        if (an.status === "fulfilled") for (const x of an.value) (x.error ? errors.push(x.error) : anchors.push(x));
        if (nom.status === "fulfilled") others.push(...nom.value); else errors.push(`OpenStreetMap search for "${q}": ${nom.reason?.message}`);
        if (wd.status === "fulfilled") others.push(...wd.value); else errors.push(`Wikidata search for "${q}": ${wd.reason?.message}`);
      });
      try { const pl = await host.ref.get("places"); for (const q of names) others.push(...searchNaturalEarth(pl, q)); } catch { /* reference not loaded */ }
      // The same feature found under two spellings comes once.
      const seen = new Set();
      const results = [...(atlas?.candidates || []), ...anchors, ...others].filter((c) => {
        const k = `${c.source?.id}|${c.source?.url || c.source?.atlas_id || ""}|${(c.name || "").toLowerCase()}|${c.lonlat.map((v) => v.toFixed(3))}`;
        if (seen.has(k)) return false; seen.add(k); return true;
      });
      const list = [...typed, ...results].map((c) => {
        if (nearAt) { c.distance_km = round(turf.distance(nearAt, c.lonlat), 1); c.bearing = Math.round((turf.bearing(nearAt, c.lonlat) + 360) % 360); }
        return cands.get(keep(c));
      });
      host.onCandidates?.(list);
      return { searched_for: names, candidates: list.slice(0, 12).map(compact), ...(list.length > 12 ? { more_candidates: list.length - 12 } : {}),
        ...(atlas ? { atlas: atlas.report } : {}), ...(errors.length ? { problems: [...new Set(errors)] } : {}), ...(nearNote ? { near_ignored: nearNote } : {}),
        note: list.length ? undefined : "Nothing found." };
    },

    async find_features_near({ anchor, feature_type, radius_km, name, theme }) {
      const a = resolve(anchor);
      const g = a.feature.geometry;
      const shaped = g.type !== "Point";
      // For an area or line, search a circle that covers the shape plus the radius, then measure each feature from
      // the shape's edge (Rosebank, 17 Nov: distances were from the field's centre and read as from its edge).
      const reach = shaped ? Math.max(...walkCoords(g).map((c) => turf.distance(a.lonlat, c))) : 0;
      const r = await findFeaturesNear(a.lonlat, feature_type, Math.min(radius_km + reach, 50), { name, fetchFn: host.fetchFn, headers: host.headers, atlas: host.atlas || null, limit: shaped ? 200 : 15, allow: allowed() });
      let found = r.candidates;
      if (shaped) {
        for (const c of found) { const d = geometryDistanceKm(g, c.geometry); c.distance_km = d == null ? null : round(d, 2); delete c.bearing; delete c.edge_km; }
        found = found.filter((c) => c.distance_km != null && c.distance_km <= radius_km).sort((x, y) => x.distance_km - y.distance_km);
      }
      const total = shaped ? found.length : r.total;
      const list = found.slice(0, 15).map((c) => cands.get(keep(c)));
      if (list.length) (host.addFindings ? host.addFindings(list, { theme: themeFor({ theme, featureType: feature_type }), dataset: feature_type, place: a.feature }) : host.onCandidates?.(list));
      return {
        anchor: a.label, feature_type, radius_km, measured_from: shaped ? `the edge of ${a.label} (0 = inside or touching)` : `the point ${a.label}`,
        found: total, listed: list.length, ...(total > list.length ? { not_listed: `${total - list.length} more found but not listed (nearest ${list.length} shown). Say "${total} found", not ${list.length}.` } : {}),
        ...(shaped && reach + radius_km > 50 ? { note_reach: "The shape is large, so the search was capped at 50 km from its centre; features further along it may be missed." } : {}),
        sources: r.sources, wind_turbines: r.wind_turbines, ...(r.note ? { note: r.note } : {}), candidates: list.map(compact),
      };
    },

    async make_place(i) {
      const a = resolve(i.anchor);
      let centre = a.lonlat;
      const steps = [];
      if (i.offset_km) {
        centre = turf.destination(centre, i.offset_km, i.bearing_deg ?? 0).geometry.coordinates;
        steps.push(`moved ${i.offset_km} km on a bearing of ${i.bearing_deg ?? 0}° from ${a.label}`);
      }
      let f;
      switch (i.shape) {
        case "point": f = turf.point(centre); steps.push("point"); break;
        case "square": {
          const area = i.area_km2 ?? (i.side_km ? i.side_km ** 2 : null);
          if (!area) throw new Error("A square needs area_km2 or side_km.");
          f = G.squareAround(centre, area, i.rotation_deg || 0); steps.push(`square of ${round(area)} km² centred there`); break;
        }
        case "circle": {
          const r = i.radius_km ?? (i.area_km2 ? Math.sqrt(i.area_km2 / Math.PI) : null);
          if (!r) throw new Error("A circle needs radius_km or area_km2.");
          f = G.circleAround(centre, { radiusKm: r }); steps.push(`circle of radius ${round(r, 2)} km`); break;
        }
        case "rectangle":
          if (!i.width_km || !i.height_km) throw new Error("A rectangle needs width_km and height_km.");
          f = G.rectangleAround(centre, i.width_km, i.height_km, i.rotation_deg || 0); steps.push(`rectangle ${i.width_km} × ${i.height_km} km`); break;
        case "feature":
          if (a.cand?.approx && a.cand.osm) {
            const g = await featureOutline(a.cand.osm, { fetchFn: host.fetchFn, headers: host.headers }).catch(() => null);
            if (g) { a.cand.geometry = g; a.cand.approx = false; a.feature = { type: "Feature", properties: {}, geometry: g }; }
            else steps.push("outline unavailable, so its bounding box was used");
          }
          f = JSON.parse(JSON.stringify(a.cand?.outline ? { type: "Feature", properties: {}, geometry: a.cand.outline } : a.feature));
          if (i.also?.length) {
            const parts = i.also.map(resolve);
            for (const p of parts) {
              if (!/Polygon/.test(p.feature.geometry.type) || !/Polygon/.test(f.geometry.type)) throw new Error("Only outlines (polygons) can be joined.");
              f = turf.union(turf.featureCollection([f, p.feature])) || f;
            }
            steps.push(`outlines of ${[a.label, ...parts.map((p) => p.label)].join(", ")}, joined`);
          } else steps.push(`outline of ${a.label}`);
          if (i.offset_km) f = G.move(f, i.offset_km, i.bearing_deg ?? 0);
          break;
        case "buffer":
          if (!i.buffer_km) throw new Error("A buffer needs buffer_km.");
          f = turf.buffer(i.offset_km ? G.move(a.feature, i.offset_km, i.bearing_deg ?? 0) : a.feature, i.buffer_km, { units: "kilometers", steps: 16 });
          if (i.also?.length) {
            // Several pieces of one thing (the segments of a road or river): buffer each and join them.
            const parts = i.also.map(resolve);
            for (const p of parts) f = turf.union(turf.featureCollection([f, turf.buffer(p.feature, i.buffer_km, { units: "kilometers", steps: 16 })])) || f;
            steps.push(`${i.buffer_km} km buffer around ${[a.label, ...parts.map((p) => p.label)].join(", ")}, joined`);
          } else steps.push(`${i.buffer_km} km buffer around ${a.label}`);
          break;
        default: throw new Error(`Unknown shape ${i.shape}.`);
      }
      if (i.clip?.to) {
        // Cut to a circle (or buffer) round another feature, or to its outline: "within 5 km of Linlithgow".
        const lim = resolve(i.clip.to);
        const limGeom = lim.cand?.outline || lim.feature.geometry;
        let limit;
        if (i.clip.within_km) {
          limit = limGeom.type === "Point" ? turf.circle(limGeom.coordinates, i.clip.within_km, { units: "kilometers", steps: 64 })
            : turf.buffer({ type: "Feature", properties: {}, geometry: limGeom }, i.clip.within_km, { units: "kilometers", steps: 32 });
        } else if (/Polygon/.test(limGeom.type)) limit = { type: "Feature", properties: {}, geometry: limGeom };
        else throw new Error(`${lim.label} is a ${limGeom.type === "Point" ? "point" : "line"}, so it needs within_km to clip to.`);
        if (!/Polygon/.test(f.geometry.type)) throw new Error("Only areas can be clipped (build the corridor or shape first, then clip it).");
        const cut = turf.intersect(turf.featureCollection([f, limit]));
        if (!cut) throw new Error(`The shape doesn't reach ${i.clip.within_km ? `within ${i.clip.within_km} km of ` : ""}${lim.label}, so clipping would leave nothing.`);
        const before = turf.area(f) / 1e6;
        f = cut;
        steps.push(`clipped to ${i.clip.within_km ? `within ${i.clip.within_km} km of ${lim.label}` : `the outline of ${lim.label}`} (${round(before, 1)} km² → ${round(turf.area(f) / 1e6, 1)} km²)`);
      }
      {
        // The map editor can't hold holes. Fill them, and say so with the area it adds, rather than
        // let the analyst swap the publisher's outline for an invented shape (Beatrice, 16 Nov).
        const filled = G.fillHoles(f);
        if (filled.holes) { f = filled.feature; steps.push(`${filled.holes} hole${filled.holes > 1 ? "s" : ""} in the outline filled (adds ${round(filled.addedKm2, 2)} km²), because the map can't edit holes yet`); }
        const main = G.largestPart(f);
        if (main.dropped) { f = main.feature; steps.push(`kept the main part; ${main.dropped} smaller part${main.dropped > 1 ? "s" : ""} (${round(main.droppedKm2, 2)} km², e.g. islands) left out, because the map can't edit multi-part shapes yet`); }
      }
      if (i.rotation_deg && !["square", "rectangle", "point"].includes(i.shape)) { f = G.rotate(f, i.rotation_deg); steps.push(`rotated ${i.rotation_deg}°`); }
      else if (i.rotation_deg && ["square", "rectangle"].includes(i.shape)) steps.push(`rotated ${i.rotation_deg}°`);
      f = G.roundCoords({ type: "Feature", properties: {}, geometry: f.geometry });
      // Confidence from the evidence, in code: checks are measured from the place just built.
      const site = f.geometry.type === "Point" ? f.geometry.coordinates : turf.centroid(f).geometry.coordinates;
      // Checks must come from the person's own words (Ben Nevis, 20 Nov: the analyst made one up, it failed, and it
      // rebuilt the place without it to get the confidence back). A rebuild doesn't carry old checks over (the person may
      // have corrected the clue: "sorry, I meant north-west"), but any that failed and are now left out are listed in
      // the result, so dropping one is visible and has to be explained.
      const old = i.replaces ? host.findPlace(i.replaces) : null;
      if (i.replaces) {
        if (!old) throw new Error(`No place called "${i.replaces}" to replace.`);
        if (!analystsOwn(old)) throw new Error(`"${old.name}" isn't a proposal of yours, so it can't be replaced; ask the person, or build a new place.`);
      }
      const given = [...(i.checks || [])];
      const dropped = (old?.origin?.checks || []).filter((c) => c.pass === false && c.quote && !given.some((g) => norm(g.quote) === norm(c.quote)))
        .map((c) => ({ quote: c.quote, against: c.against, was: c.why }));
      const said = host.personSaid ? norm(host.personSaid()) : null;
      const checks = [];
      for (const c of given) {
        if (said != null && !(c.quote && norm(c.quote).length >= 4 && said.includes(norm(c.quote)))) {
          checks.push({ against: c.against, expected_km: c.expected_km, pass: null, why: c.quote ? `"${String(c.quote).slice(0, 80)}" isn't in the person's words, so this check was left out` : "no quote from the person's words, so this check was left out: checks must come from distance clues the person gave" });
          continue;
        }
        try { const t = resolve(c.against); checks.push({ ...runCheck(site, { lonlat: t.lonlat, name: t.label }, c), quote: c.quote, target: c.against }); }
        catch { checks.push({ against: c.against, expected_km: c.expected_km, pass: null, why: "not a candidate id, so not checked" }); }
      }
      // Built on a place already on the map: it starts from that place's confidence (a person's drawing counts as high),
      // not from the anchor rules, which would read a platform point as "nothing specific" (Mars, 17 Nov).
      const inherit = !a.cand && a.place ? { name: a.place.name, confidence: a.place.origin?.method === "words" ? a.place.origin.confidence : "high", drawn: a.place.origin?.method !== "words" } : null;
      const rated = rateConfidence({ cand: a.cand, match: i.match, checks: checks.filter((c) => c.pass !== null), offset: !!i.offset_km, shape: i.shape, inherit });
      const origin = {
        method: "words", words: i.words, steps, confidence: rated.confidence, confidence_rules: rated.rules, match: i.match, checks, reason: i.reason,
        anchor: a.cand ? { name: a.cand.name, type: a.cand.type, source: a.cand.source, lonlat: a.cand.lonlat, extra: a.cand.extra } : { place: a.label },
        shape: i.shape, offset: !!i.offset_km, ...(i.site_defined === true ? { site_defined: true } : {}),
        at: new Date().toISOString(),
      };
      // What the place stands for, set in code from how it was built (js/siterole.js): a published outline, an area
      // the person asked for, or a search area standing in for an outline nobody found (Cnoc Buidhe, 20 Nov).
      { const r = placeRole(origin, f.geometry); origin.role = r.role; origin.role_why = r.why; }
      // Replacing: the old proposal goes first, so the new one can take its name.
      // Replacing: add the new place first (so a failure leaves the old one), then remove the old one and let the new
      // one take its name unless a new name was given.
      const p = host.addPlace({ feature: f, origin, scale: i.scale, name: placeName(i, a, f), given: i.name ? String(i.name).replace(/\s+/g, " ").trim() : null });
      if (!["typed", "transformed"].includes(a.cand?.source?.id)) unseen.add(p);
      if (old && host.removePlace) {
        const oldName = old.name;
        host.removePlace(oldName, { by: "analyst", reason: "replaced by a rebuilt place" });
        // It takes the old name back unless it was given a different one (giving the same name made "X (2)": Cnoc Buidhe, 20 Nov).
        if ((!i.name || norm(i.name) === norm(oldName)) && p.name !== oldName) host.renamePlace?.(p.name, oldName);
      }
      return { ...(await placeSummary(p)), ...(old ? { replaced: old.name } : {}), how: steps.join(", then "), confidence: rated.confidence, why: rated.rules,
        ...(origin.role === "search_area" ? { role: "search_area", role_why: origin.role_why, what_it_is: `A search area (${origin.role_why}), standing in for an outline that wasn't found. A screen of it reports findings by how much of the area they cover, not as on site.` } : {}),
        ...(checks.length ? { checks } : {}),
        ...(dropped.length ? { failed_checks_left_out: dropped, about_them: "These clues failed on the place this one replaces and aren't checked now." } : {}),
        shown_as: "proposal" };
    },

    async remove_place({ place, reason }) {
      const p = host.findPlace(place);
      if (!p) throw new Error(`No place called "${place}".`);
      if (!host.removePlace) return { not_available: "Places can't be removed here." };
      const own = analystsOwn(p);
      const asked = /\b(remove|delete|get rid of|bin|clear|drop|take away|lose)\b/i.test(host.lastPersonText?.() || "");
      if (!own && !asked) throw new Error(`"${p.name}" was drawn or accepted by the person; remove it only when they ask in their latest message.`);
      host.removePlace(p.name, { by: "analyst", reason });
      return { removed: p.name, places_left: host.places().map((x) => x.name) };
    },

    async use_file_features({ features, combine, width_m, name }) {
      const file = host.loadedFile?.();
      if (!file) throw new Error("No file is waiting. Ask the person to drop the site's file on the map (a shapefile folder or zip, or GeoJSON).");
      const fids = !features?.length || features.some((f) => String(f).toLowerCase() === "all") ? "all" : features;
      let built;
      try { built = placesFromFile(file, { fids, combine: combine || "parts", buffer_m: width_m ?? null, name: name || null }); }
      catch (e) { if (e.needs_width) return { needs_width: true, why: e.message }; if (e.needs_decision) return { needs_decision: true, why: e.message }; throw e; }
      const made = [];
      for (const b of built) made.push(await placeSummary(host.addPlace({ ...b, status: "accepted" })));
      host.fileUsed?.();
      return { made, coordinates: file.layers.map((l) => l.crs.how), how: built.map((b) => b.origin.steps.join(", ")).filter(Boolean),
        confidence: "high", why: "the person's own outline, from their file" };
    },

    async set_file_transformation({ layer, operation }) {
      if (!host.loadedFile?.()) throw new Error("No file is waiting.");
      if (!host.resolveFileLayer) return { not_available: "This can't be settled here." };
      const r = await host.resolveFileLayer(layer, operation);
      return { ...r, settled: true };
    },

    async run_study(i) {
      const p = host.findPlace(i.place);
      if (!p) throw new Error(`No place called "${i.place}". Find or build the site first.`);
      if (!host.screening?.study) return { not_available: "Studies can't be run here." };
      const entry = (host.profile?.()?.skills_offered || []).find((s) => s.id === i.study && s.status === "ready" && s.skill);
      if (!entry) return { not_available: `The ${String(i.study || "study").replace(/-/g, " ")} isn't available in this profile.` };
      const was = pending.get(pkey(p));
      if (was?.tool === "run_study" && was.input.study === i.study) i = { ...was.input, ...i };
      const held = await holdRun("run_study", p, i);
      if (held) return held;
      pending.delete(pkey(p));
      return host.screening.study(entry, p, i);
    },

    async offer_skills({ place }) {
      const p = host.findPlace(place);
      if (!p) throw new Error(`No place called "${place}".`);
      if (!host.offerSkills) return { not_available: "Ask in words which analysis they want." };
      const shown = host.offerSkills(p.name);
      return { ...shown, buttons_shown: true };
    },

    async ask_asset_type({ place, question }) {
      if (!host.findPlace(place)) throw new Error(`No place called "${place}".`);
      if (!host.askAssetType) return { not_available: "Ask in words which asset type, or offer a general screen (asset_type other)." };
      const shown = await host.askAssetType(host.findPlace(place).name, question);
      return { ...shown, buttons_shown: true };
    },

    async offer_choices({ candidates, recommended, reason, question }) {
      const list = (candidates || []).map((id) => cands.get(String(id).trim().toUpperCase())).filter(Boolean);
      if (list.length < 2) throw new Error("Give at least two candidate ids from this conversation.");
      const rec = cands.get(String(recommended).trim().toUpperCase());
      if (!rec || !list.includes(rec)) throw new Error("The recommended id must be one of the candidates.");
      host.offerChoices?.({ choices: list, recommended: rec, reason, question });
      return { offered: list.length, recommended: rec.id, recommended_name: rec.name, reason, buttons_shown: true };
    },

    async edit_place(i) {
      const p = host.findPlace(i.place);
      if (!p) throw new Error(`No place called "${i.place}".`);
      let f = p.feature;
      const words = [];
      if (i.rotate_deg) { f = G.rotate(f, i.rotate_deg); words.push(`rotated ${i.rotate_deg}°`); }
      if (i.resize_to) { f = G.resizeTo(f, i.resize_to); words.push(`resized to ${i.resize_to} ${/Polygon/.test(f.geometry.type) ? "km²" : "km"}`); }
      if (i.move_km) { f = G.move(f, i.move_km, i.move_bearing_deg ?? 0); words.push(`moved ${i.move_km} km on a bearing of ${i.move_bearing_deg ?? 0}°`); }
      if (words.length) host.updatePlace(p.name, G.roundCoords(f), `${words.join(", ")} (asked in chat)`);
      if (i.rename) { host.renamePlace(p.name, i.rename); words.push(`renamed to ${i.rename}`); }
      return { ...(await placeSummary(host.findPlace(i.rename || p.name))), changed: words.join(", ") || "nothing" };
    },

    async get_place({ place }) {
      const p = host.findPlace(place);
      if (!p) throw new Error(`No place called "${place}".`);
      const d = await R.describe(host.ref, p.feature);
      return {
        place: p.name, status: p.status, summary: R.summaryLine(d), ...pickD(d),
        how_made: p.origin?.method === "words" ? { words: p.origin.words, anchor: p.origin.anchor?.name || p.origin.anchor?.place, source: p.origin.anchor?.source?.title, steps: p.origin.steps, confidence: p.origin.confidence } : p.origin?.method === "file" ? { file: p.origin.file, features: p.origin.features, coordinates: p.origin.crs?.how, ...(p.origin.buffer_m ? { width_m: p.origin.buffer_m } : {}), steps: p.origin.steps }
          : p.origin?.method === "service" ? { from: serviceOriginText(p.origin), features: p.origin.features, ...(p.origin.buffer_m ? { buffer_m: p.origin.buffer_m } : {}), steps: p.origin.steps } : { method: "drawn on the map" },
        what_it_is: (({ role, why }) => `${role === "search_area" ? "search area" : role}: ${why}`)(placeRole(p.origin, p.feature.geometry)),
        edits: (p.edits || []).map((e) => e.change),
      };
    },
  };

  const data = createDataTools({
    atlas: host.atlas || null,
    firms: host.firms || null,
    get trusted() { return host.trusted; },
    esriLicence: () => !!host.esriLicence?.(),
    nonCommercial: () => !!host.nonCommercial?.(),
    resolve,
    area: (ref) => catalogueArea(ref, null),
    keep: (c) => keep(c),
    onCandidates: (list, meta) => { const l = list.map((c) => cands.get(c.id)); host.addFindings ? host.addFindings(l, meta) : host.onCandidates?.(l); },
    now: host.now,
  });
  run.find_data = (i) => data.find_data(i);
  run.show_on_map = async ({ ids, clear }) => {
    if (clear) { host.clearFindings?.(); return { cleared: true }; }
    const r = host.showFindings ? host.showFindings(ids) : { shown: 0 };
    return r.shown ? { ...r, note: "The map now shows these with the place in focus." } : { shown: 0, note: "Nothing to show: no findings with those ids are on the map." };
  };
  run.get_data = (i) => data.get_data(i);
  // Elevation for any skill (js/elevation.js): positive up, whatever sign the source uses; depth shown at sea.
  run.get_elevation = async ({ place }) => {
    const r = resolve(place);
    if (!r?.feature) throw new Error(`No place or candidate called "${place}".`);
    const sources = host.trusted?.values?.elevation || [];
    // Land sources first (lidar, then the global model); a place that reads as all seabed, or has no land value, is
    // read again from the sea sources (a bathymetry model) when there are any.
    const opt = { feature: r.feature, fetchFn: host.fetchFn || globalThis.fetch, ...(host.now ? { now: host.now } : {}) };
    let { elevation, checked } = await elevationFrom(sources, { ...opt, setting: "land" });
    if ((!elevation || elevation.below_sea_level_points === elevation.points) && sources.some((x) => x.serves === "sea")) {
      const sea = await elevationFrom(sources, { ...opt, setting: "sea" });
      if (sea.elevation) ({ elevation, checked } = sea);
    }
    if (!elevation) return { not_checked: checked.why || checked.result, dataset: checked.dataset };
    const sig = elevationSignificance(elevation);
    const atSea = elevation.below_sea_level_points === elevation.points;
    return {
      place, elevation_m: { typical: elevation.typical_m, lowest: elevation.min_m, highest: elevation.max_m, convention: elevation.convention },
      ...(elevation.below_sea_level_points ? { water_depth_m: atSea ? { typical: -elevation.below.typical_m, shallowest: -elevation.below.max_m, deepest: -elevation.below.min_m } : "part of the place is below sea level: it may be sea, or land below sea level (polders); check the coastline" } : {}),
      ...(sig && !atSea ? { notable: sig.why } : {}),
      points: elevation.points, cell_m: elevation.cell_m, vertical_datum: elevation.vertical_datum,
      dataset: elevation.dataset, publisher: elevation.publisher, licence: elevation.licence, checked_at: elevation.checked_at,
    };
  };
  run.screen_site = async (input) => {
    if (!host.screening) return { not_available: "Screening isn't connected here." };
    const p = host.findPlace(input.place);
    if (!p) throw new Error(`No place called "${input.place}". Find or build the site first.`);
    // A yes to a held screen runs what was asked then: what's given now adds to it or changes it.
    const was = pending.get(pkey(p));
    const i = was?.tool === "screen_site" ? { ...was.input, ...input } : input;
    const held = await holdRun("screen_site", p, i);
    if (held) return held;
    // Several skills are on offer (Rob, 24 Nov): the analyst runs a screen only when the person asked for one (in
    // words, with the screen chip or an asset-type pick, which all say "screen"), and otherwise offers the skills.
    // Shell House, Perth: "site a substation on that parcel", then "Use this area", and a screen ran unasked.
    // The skills are offered in code (25 Nov), not by telling the analyst to.
    if (host.offerSkills && host.personSaid && !SCREEN_ASKED.test(host.personSaid())) {
      host.offerSkills(p.name);
      return { held: "skills", place: p.name };
    }
    pending.delete(pkey(p));
    return host.screening.screen(i, p);
  };
  // Coordinate reference (EPSG registry via the Worker): js/epsgtools.js.
  // transform takes the person's own numbers only: a typed-coordinates candidate, never a place already in WGS 84.
  // A grid reference is already converted to WGS84 when it becomes a candidate, so it isn't the person's raw numbers.
  const typedAt = (ref) => { try { const r = resolve(ref); return r.cand?.source?.id === "typed" && !/National Grid/.test(r.cand.extra?.read_as || "") ? r.cand.lonlat : null; } catch { return null; } };
  const epsgTools = createEpsgTools(host, (ref) => resolve(ref).lonlat, typedAt);
  Object.assign(run, epsgTools);
  // Each transformed point becomes a candidate, so make_place can use it and the place keeps how it was transformed.
  const transformTool = run.transform;
  run.transform = async (i) => {
    const r = await transformTool(i);
    if (!r?.applied) return r;
    r.points.forEach((pt) => {
      const c = candidate({
        name: formatLatLon(pt.output.lon, pt.output.lat, 6), type: `coordinates transformed to ${r.to.name}`,
        geometry: { type: "Point", coordinates: [pt.output.lon, pt.output.lat] },
        source: { id: "transformed", title: `your coordinates, ${r.from.name} → ${r.to.name} by EPSG:${r.operation.code}`, publisher: "You", licence: "your own" },
        extra: { input: pt.input, from: r.from.name, transformation: r.record, moved_m: pt.moved_m, ...(pt.outside_area_of_use ? { outside_area_of_use: true } : {}) },
      });
      c.lonlat = [pt.output.lon, pt.output.lat];
      pt.candidate = keep(c);
    });
    r.next = "Each point is now a candidate (see candidate): use it with make_place to put it on the map; the place keeps the transformation.";
    return r;
  };
  // Layers offered after a run (js/bringin.js): fetched with get_data for the run's place, so they keep their source,
  // licence and date and go on the map as findings. The record keeps what came in (run.added).
  run.bring_in_layers = async ({ run: id, layers }) => {
    if (!host.screening?.runs) return { not_available: "Screening isn't connected here." };
    const key = String(id || "").trim().toUpperCase();
    const rec = host.screening.runs.get(key);
    if (!rec) throw new Error(`No run called "${id}".`);
    const r = rec.tobler_run;
    const p = (r.place_id != null && host.places().find((x) => x.id === r.place_id)) || host.findPlace(r.site.name);
    if (!p) return { run: r.id, not_available: `${r.site.name}, the site ${r.id} ran on, isn't on the map any more, so there's nothing to bring layers in for.` };
    const out = await bringIn(rec, Array.isArray(layers) ? layers : [layers].filter(Boolean), {
      get: (i) => data.get_data(i), keep: (d) => data.keepDataset(d), placeName: p.name, placeIsPoint: p.feature.geometry.type === "Point", now: host.now,
    });
    host.onRunChanged?.(rec);
    return out;
  };
  run.get_run = async ({ run: id }) => {
    if (!host.screening) return { not_available: "Screening isn't connected here." };
    return host.screening.getRun(id);
  };

  return {
    candidates: cands,
    datasets: data.datasets,
    newTurn: () => unseen.clear(),
    pendingLines,
    // The held run for a place, for the card's buttons: { tool, input, held } or null.
    pendingFor: (p) => (p ? pending.get(pkey(p)) || null : null),
    dropPending: (p) => { if (p) pending.delete(pkey(p)); },
    useDataset: data.keepDataset,
    async exec(name, input) {
      if (!run[name]) throw new Error(`Unknown tool ${name}`);
      // Grid references anywhere in the input are converted first, so every tool sees them in WGS84.
      const strings = Object.values(input || {}).flatMap((v) => (typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === "string") : []));
      for (const v of strings) await readTyped(v);
      return run[name](input || {});
    },
  };
}

// A place built from words is named after what it was built from, as the person would say it: "Jackdaw",
// "Linlithgow Palace 4 km²", "M9 corridor" (Rob, 18 Nov: "Area 1" says nothing). Drawn shapes keep "Area 1".
export function cleanName(raw) {
  let n = String(raw || "").replace(/\s+/g, " ").trim();
  // Tracker names carry the country and kind: "Bonga North Oil and Gas Field (Nigeria)" → "Bonga North".
  n = n.replace(/\s*\([^)]*\)\s*$/, "").replace(/\s+(oil and gas|oil|gas|wind|solar)( and gas)? (field|farm|project|plant|mine)$/i, "").trim();
  // Registers shout: "JACKDAW" → "Jackdaw" (short codes like "30/2" or "M9" stay as they are).
  if (/[A-Z]{3,}/.test(n) && n === n.toUpperCase()) n = n.toLowerCase().replace(/(^|[\s\-/])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return n.length > 40 ? `${n.slice(0, 39).trim()}…` : n;
}
export function placeName(i, a, f) {
  // A name the analyst gives is used as given (trimmed), so the name it then uses in tool calls matches.
  // Candidate ids (C29) are handles for the tools, never part of a name the person sees: "Miri city (OpenStreetMap
  // C29)" → "Miri city". The place still answers to the analyst's own wording (passed to the host as `given`).
  if (i.name && String(i.name).trim()) {
    const n = String(i.name).replace(/\s*\([^()]*\bC\d+\b[^()]*\)/gi, "").replace(/\bC\d+\b:?/gi, "").replace(/\s+/g, " ").trim().slice(0, 60);
    if (n) return n;
  }
  const base = cleanName(a.cand ? a.cand.name || a.cand.type : a.place?.name || a.label);
  if (!base || /^C\d+$/i.test(base)) return null;
  const km2 = turf.area(f) / 1e6;
  const size = km2 >= 10 ? `${Math.round(km2)} km²` : km2 >= 0.1 ? `${Math.round(km2 * 10) / 10} km²` : null;
  switch (i.shape) {
    case "square": case "circle": case "rectangle": return size ? `${base} ${size}` : base;
    case "buffer": return `${base} corridor`;
    default: return base; // point, feature (the publisher's own outline)
  }
}

const pickD = (d) => ({ scale: d.scale, area_km2: d.area_km2, length_km: d.length_km, extent_km: d.extent_km, countries: d.countries, ...(d.touches_at_edge ? { touches_at_edge: d.touches_at_edge } : {}), offshore: d.offshore, coast_km: d.coast_km, centre: { lat: round(d.centroid[1], 4), lon: round(d.centroid[0], 4) } });

// One line per place for the conversation agent's project summary. Coordinates stay out.
// runs: one line per screening run (js/outofdate.js runLines), so the analyst knows which are out of date.
export async function projectSummary(ref, places, focus, view = null, runs = [], file = null) {
  const viewLine = view ? `Map view: about ${Math.round(R.viewKm(view))} km across (${R.scaleForKm(R.viewKm(view))} scale).` : "";
  const runPart = runs.length ? ["Screening runs:", ...runs] : [];
  // A file the person dropped, shown on the map and waiting for them to pick the site from it (use_file_features).
  if (file) runPart.push(`A file is loaded and waiting for the person to pick the site from it (card shown; or use use_file_features if they say which in words): ${JSON.stringify(fileSummary(file))}`);
  if (!places.length) return ["No places yet.", ...runPart, viewLine].filter(Boolean).join("\n");
  const lines = [];
  for (const p of places) {
    const d = await R.describe(ref, p.feature);
    const how = p.origin?.method === "words" ? `from words "${p.origin.words}" (anchor: ${p.origin.anchor?.name || p.origin.anchor?.place}, ${p.origin.confidence} confidence)` : p.origin?.method === "file" ? fileOriginText(p.origin) : p.origin?.method === "service" ? serviceOriginText(p.origin) : "drawn on the map";
    const role = placeRole(p.origin, p.feature.geometry).role === "search_area" ? "; a search area (the site's outline wasn't found)" : "";
    const edits = p.edits?.length ? `; edited: ${p.edits.slice(-3).map((e) => e.change).join("; ")}` : "";
    lines.push(`- ${p.name}${p.name === focus ? " [in focus]" : ""} (${p.status}): ${R.summaryLine(d)}; scale ${p.scale || d.scale}${p.scaleFrom && p.scaleFrom !== "size" ? ` (from ${p.scaleFrom === "you" ? "the person" : p.scaleFrom})` : ""}; ${how}${role}${edits}`);
  }
  lines.push(...runPart);
  if (viewLine) lines.push(viewLine);
  return lines.join("\n");
}
