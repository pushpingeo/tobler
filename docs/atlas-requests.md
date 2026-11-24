# Requests to the atlas

Tobler and the atlas are worked on in separate chats (decided 17 Nov). Tobler doesn't edit the atlas repo.
What Tobler can rely on is written down in the atlas repo's `docs/mcp-tools.md`. When Tobler needs something
new from the atlas, add it here (newest first), tell Rob, and he passes it to the atlas chat.

- **24 Nov (late night): past land use, for the contamination desk study.** The study's biggest gap is past land
  use: today only Northern Ireland's database and four councils' contaminated-land records cover it. Please look for
  open layers of past or potentially contaminative land use, or of features derived from old maps (old gasworks,
  works, quarries, filled ground), by country: the UK first (councils' contaminated land registers and Part 2A
  determinations, Historic England or HES industrial heritage, BGS made ground and artificial ground), then the US,
  Australia and the Netherlands (Bodemloket). Also BGS aquifer designations as a feature or value service, for
  pathways. Licence first, as ever. The study's checks and their ids are in the energy profile's `skills_offered`.
- **24 Nov (late evening): more records now used as checks** (Rob's licence calls): Crown Estate Scotland
  `d769096b70ee72bb` (ScotWind, `Lead_App`), `2b0ba4d2646c0a50` (INTOG), `16a401bb82d4d010` (cables),
  `c026fa004eab396c` (pipelines); The Crown Estate `0db236263e88622b` (wind cable agreements, `Name_Prop`),
  `b19662f3493ef9a3` (Round 5 PDAs), `d562171a3698a42b` (gas storage pipelines); and the contamination records of
  your hand-back (EA landfill, closed mining waste, council records, NI land use, SEPA, DAERA incidents, radon, the
  US EPA ten). Please keep these ids stable. NRW's landfill and permits are held back on licence (Rob to decide).
  For elevation, Tobler reads ArcGIS `getSamples` only; Scotland's lidar (cloud GeoTIFFs on AWS), Geoscience
  Australia's 5 m DEM (map service) and AHN (WCS) would need value services Tobler can sample: worth a note in the
  contract if the atlas finds image services for them.
- **24 Nov (evening): the coverage drive** (Rob: "as complete as possible"; audit in the project,
  `claude/coverage-audit-2026-11-24.md`). Tobler now uses these records as checks: `ec38ddbef814026b` (coal high risk
  area), `6c3e0babf56f294e` and `5d4037034edc4d37` (source protection zones, class fields `number` and `NUMBER`),
  `0b6ff37a18b1aab2` (GEM active faults, `name`, `slip_type`), `a38e968b2ce8d36a` (EMODnet offshore installations),
  `f70f5adfc354d387` (EMODnet wind farm polygons), `4e485998501cde5f` and `4d4f3f1290943689` (Crown Estate Scotland and
  The Crown Estate wind leases, `Property_Description`, `Name_Prop`), `6f36ead7970b8386` (EMODnet UK telecom cables),
  `33835b94806a7d64` (Native Land Digital, `Name`). Please keep them stable, and tell us the name fields for the three
  EMODnet layers. Asks, most useful first:
  1. **UK infrastructure, national and open:** electricity transmission lines and substations (National Grid ET,
     SPEN, SSEN Transmission; NESO if published), NSTA offshore pipelines and surface infrastructure (the wells record
     is a map service only), UK power cables at sea (interconnectors and wind export cables: EMODnet holds other
     countries' power cables, not the UK's).
  2. **UK hazards and air:** BGS landslides, historical and instrumental earthquakes as features (OGC API Features or
     WFS; the atlas has them as WMS only); England's coastal erosion (NCERM 2024); a national AQMA layer (Defra UK-AIR;
     the atlas has council copies only); England and Wales peat maps.
  3. **Elevation as value services** (Tobler reads ArcGIS image services with `getSamples`, and could read WCS):
     England's LIDAR Composite DTM 1 m (Environment Agency, OGL), EMODnet Bathymetry DTM (~115 m, to LAT), USGS 3DEP,
     AHN (NL), Geoscience Australia's 5 m lidar DEM and Australian bathymetry. Rob's go is still needed for these.
  4. **National packs for the other focus markets**, curated like the UK pack (fixed ids, named fields, licence
     verbatim, `coverage`): **US** (FEMA NFHL flood zones, PAD-US, NWI wetlands, USFWS critical habitat onshore, NPS
     National Register of Historic Places, Census AIANNH tribal lands, EPA nonattainment areas, HIFLD transmission lines
     and substations, USFS wildfire hazard potential); **Netherlands** (Rijksmonumenten, flood risk, BRO soil,
     Natura 2000 from the national publisher); **Australia** (CAPAD, EPBC matters of national environmental
     significance, native title determinations (NNTT), national and state heritage lists). The US wave holds mostly
     county copies with licences not stated, so national records are what's needed.
- **24 Nov: small corrections from the first live UK screens** (Linlithgow). (1) Historic Environment Scotland's World
  Heritage Sites record (`0d622d81aa3431a4`) **does hold buffer zones** ("Antonine Wall World Heritage Site Buffer
  Zone"); the contract note says it doesn't. Please correct the note, and say whether the other nations' WHS records do
  too, and in which field (Tobler now splits them by name: "buffer zone" in the name). (2) Tobler's checks now ask
  `fetch_features` for up to 500 features within each check's own reach; please say in the contract if any curated
  UK record can't return 500 (HES can't page: does it return 500 in one go?). (3) For the coming ground and pollution
  pack, see the reply in the project (`claude/contamination-tobler-reply.md`): fixed ids, named fields, licence,
  data date, and a `coverage` of national or partial on each record.
- **23 Nov: the UK pack, broadened beyond nature sites.** Adds to the 22 Nov request. Published decisions on UK
  wind, solar and battery sites were decided mostly by landscape, heritage, peat and farmland quality, not by
  protected nature sites, and Tobler has no checks for these yet. Asks: trusted records that return features
  (`fetch_features` with a bbox), licence and attribution verbatim, for: (1) **landscape:** National Parks, National
  Landscapes (AONBs), National Scenic Areas, Wild Land Areas, Dark Sky Parks, and regional or local landscape
  designations where councils publish them; (2) **heritage:** scheduled monuments, listed buildings, World Heritage
  Sites, registered parks and gardens, HES Inventory of Gardens and Designed Landscapes, Inventory of Historic
  Battlefields (and the Cadw and HED equivalents); (3) **NatureScot Carbon and Peatland 2016 map**; (4)
  **Agricultural Land Classification** (England provisional and post-1988; Scotland's Land Capability for
  Agriculture); (5) **flood zones** (EA Flood Map for Planning, SEPA flood maps); (6) **Natural England SSSI Impact
  Risk Zones** (OGL; `services.arcgis.com/JJzESW51TqeY9uat/.../SSSI_Impact_Risk_Zones_England/FeatureServer/0`) and
  please find and document how the 13-digit `irzcode` in its `IRZURL` field decodes into development categories.
  Tobler will turn each into a check (topic, layers per region, reach per scale).

- **22 Nov: UK protected sites as must-check layers, and three faults from a Dogger Bank screen.** Tobler's first
  audience is now environmental consultants (Rob, 22 Nov), and a screen of a 100 km² offshore wind site north of
  R4 Project 1 (Dogger Bank South West) found no protected areas at all, though Dogger Bank is a designated SAC.
  The EEA's Natura 2000 layers returned no features for UK waters (believed: UK sites dropped out after Brexit; please
  confirm), WDPA is off for licence reasons, and Natural England/JNCC Marine Conservation Zones returned nothing there.
  Asks: (1) **UK protected sites as trusted records that return features**, licence and attribution verbatim (all
  believed OGL): JNCC offshore SACs, SPAs and MCZs (and the inshore sets from Natural England, NatureScot, NRW and
  DAERA): SAC, SPA, Ramsar, SSSI/ASSI, MPA (Scotland), NCMPA, plus ancient woodland and priority habitats in England.
  Tobler will add them to its must-check baseline for UK sites, so they need to be reliable and quick
  (`fetch_features` with a bbox, no paging problems). (2) **"offshore platform" picks seismic layers:**
  `find_features_near` with type "offshore platform" near 54.75 N, 1.47 E asked NSTA seismic line and licensing-round
  prospect layers (97 "found"); check the concept tags on NSTA seismic and prospect layers. (3) **Named search by
  country missed The Crown Estate:** `find_place` for "R4 Project 1 Dogger Bank South West", kind "wind farm or lease",
  area "United Kingdom" asked 40 layers and missed Wind Site Agreements (England, Wales & NI); the same search over
  the map view found it. The layer picker by country should rank the national lease registers (Crown Estate, Crown
  Estate Scotland) first for wind. (4) **EMODnet Seabed Habitats WFS timeouts:** `fetch_features` on Collated EUNIS
  Habitat point data, Collated Habitat point data (all classifications) and Habitat point data bounding boxes each
  timed out after about 52 s for a 50 km box round the same site. A faster failure (or a smaller page) would help;
  worth a note in `mcp-check`.

- **20 Nov (evening): finding a project's own outline.** Tobler screened the Cnoc Buidhe Wind Energy Hub (Kintyre,
  ECU00004767) against a stand-in circle because no outline was found; it now calls such a shape a search area and
  says so (see `docs/site-vs-search-area.md`), but screening needs the project's own outline. Asks: (1) named search
  by kind should reach NatureScot's Onshore Wind Farm Proposals (`renewables:windfarm`; ArcGIS item
  f8655816b2154565a56f157aa843cfb4): `find_place` with kind "wind farm or lease" in Kintyre asked 39 layers and found
  nothing, though the same layer came back from the feature search near the site (24 records within 20 km); record
  its name field (`NAME`) and status field (`STATUS`: Scoping, Application, Approved, Installed). (2) The data's own
  date per record (revision or last updated), apart from when the atlas checked the service: that layer's revision is
  20 Sept 2024, so it misses schemes submitted since, including Cnoc Buidhe (2025); Tobler should be able to say "this
  layer predates applications after Sept 2024" rather than "not found". (3) Any published GIS layer of current
  application boundaries: Section 36 and planning applications in Scotland (Energy Consents Unit, Scottish Government
  spatial data, council portals such as Argyll and Bute's), England's Planning Data platform and NSIP boundaries,
  Wales's DNS; licence first. (4) Name fields for project layers generally (the queued name index): wind, solar,
  mines, licence blocks, where a project's own outline lives; Tobler will use them to catch a project matching
  itself in a screen. Nothing waits on this.

- **20 Nov: a higher-resolution land elevation model (Rob is asking).** Tobler's land elevation today is ETOPO 2022 at
  15 arc-seconds (about 460 m) through NOAA's DEM Global Mosaic: fine for altitude and "low-lying", too coarse for slope
  (area discounting) or flood work. What Tobler needs is a service that returns **values**, not pictures (the `sample`
  capability in the request below): Copernicus GLO-30 (open, commercial use with attribution) or national lidar, as an
  ImageServer with identify/getSamples, a WCS, or Cloud-Optimised GeoTIFFs a browser can read (CORS). Note: the
  Copernicus GLO-30 COGs on AWS (`copernicus-dem-30m.s3.amazonaws.com`) send no CORS header (checked 20 Nov), so Tobler
  would read them through its Worker; a record saying so is still useful.

- **19 Nov (evening): water depth and AIS traffic as values, GEBCO first.** Rob asked for water depth (what's possible
  and what it costs changes with depth) and shipping lanes from historic AIS in offshore screens. What the atlas holds,
  checked from Tobler on 19 Nov: GEBCO only as WMS pictures (`5a361dd45cf15884`, `ed24a2a84f7c4236`, the GEBCO_2020
  copies; GetFeatureInfo on wms.gebco.net returns a service exception) and as Esri ImageServers with vertical
  exaggeration (`fc84255ab64d3aba`, `8cf2d150b94d0e0f`…); EMODnet Bathymetry mean depth 2022 (`ce9289d1701224ed`)
  as WMS with feature-info but **licence "not stated"**; EMODnet vessel density (`870fd6f7e0661d13` and per-type
  layers, CC-BY 4.0) in EU waters; nothing global for AIS density. NOAA NCEI's DEM Global Mosaic ImageServer
  (`gis.ngdc.noaa.gov/arcgis/rest/services/DEM_mosaics/DEM_global_mosaic/ImageServer`) returns depth values anywhere
  but isn't in the atlas. Asks: (1) a GEBCO record that returns depth **values** (its grid through a WCS or an
  un-exaggerated ImageServer), terms and attribution verbatim; add NOAA's DEM Global Mosaic too; (2) tag
  value-returning rasters with a capability such as `sample` (ImageServer identify/getSamples, WCS, WMS whose
  feature-info returns numbers), concept `bathymetry`, and leave it off picture-only and exaggerated services;
  (3) check EMODnet Bathymetry's licence (CC BY 4.0, as EMODnet publishes it) and record the attribution line;
  (4) a global AIS density layer if an openly licensed one exists (World Bank/IMF Global Shipping Traffic Density),
  licence checked. Note new fields in `docs/mcp-tools.md` before shipping. **Meanwhile** Tobler reads depth from
  NOAA's mosaic and traffic from EMODnet directly (`catalogue/trusted.json` "values", `js/seavalues.js`) and will
  switch to atlas records once they exist. Sent to Rob as a prompt for the atlas chat, 19 Nov.

- **18 Nov (evening): Global Energy Monitor oil and gas tracker fails intermittently.** `fetch_features` on "Global Oil
  and Gas Extraction Tracker (fields: extraction areas, development and discoveries)" (GEM) answered well at 17:20
  (3 Bonga fields near 4.5 N, 4.6 E) but failed twice at 17:35 with "geojson: tile 0_0 unreadable", in a named search
  over Nigeria's waters (bbox [0.2, 1.8, 17.2, 16.4], text "Bonga"). Tobler now asks trackers in its first batch for
  fields, plants, mines and wind, so this layer matters for place finding everywhere. Ask: find why the tile is
  unreadable (size, a partial write, a cache), and include GEM layers in `mcp-check`.

- **18 Nov (early): re-test of the 17 Nov fixes from Tobler, and two new faults.** Done and working from Tobler
  (atlas probe and a replayed Rosebank conversation, 03:38 UTC): `fetch_features` answers again (NatureScot
  protected areas, SEPA river flooding, NOAA EFH); UKHO worldwide wrecks through EMODnet finds 2 wrecks within 10 km
  of Rosebank (Troldfos, Bourbon Dolphin), CC-BY 4.0; NSTA "pipeline linear (WGS84)" now returns Rosebank's live
  flowlines, and the "– removed" twins come back empty as they should. **Still failing, new asks:**
  (1) **ArcGIS MapServers that don't support pagination.** `fetch_features` on Historic Environment Scotland
  Scheduled Monuments (`25ffbbeec3836e1a`) fails with "WFS offers GML only; arcgis-mapserver: Pagination is not
  supported", and on Hutton land capability (`bd18c4d31d168bf4`) with "Pagination is not supported". Both near
  Linlithgow (-3.60, 55.977, 10 km). Ask: when a layer says `supportsPagination: false`, query without
  `resultOffset`/`resultRecordCount` (one page, capped by `maxRecordCount`), and fall back to GML for WFS that offer
  nothing else if that's cheap. Scheduled monuments matter for every Scottish screen.
  (2) **Wrecks tagged as seabed habitat.** `d266bb32a493da90` (worldwide wrecks) has concepts `["seabed-habitat"]`,
  so a search by concept files wrecks under biodiversity. Ask: tag wreck layers `heritage-site` (and keep
  seabed-habitat only if there's a reason). Minor.
  (3) Once, in the replay, `fetch_features` on EMODnet Heritage Ship Wrecks (`ee41a8d58f1fe201`) failed instantly with
  "fetch failed" while the UKHO call beside it worked; the probe a minute earlier got a clean empty answer. Probably
  transient; worth a look if it recurs in `mcp-check`.

- **17 Nov (night): EMODnet as feature services, with their licences.** All 169 EMODnet Human Activities records in
  the atlas are WMS only (picture services) with "licence not stated" (find_datasets "EMODnet" around Shetland). EMODnet
  publishes the same layers as WFS at `https://ows.emodnet-humanactivities.eu/wfs?`, and its GeoNetwork records give
  the licence: e.g. "EMODnet Human Activities, Cultural Heritage, Ship wrecks"
  (https://emodnet.ec.europa.eu/geonetwork/srv/api/records/e965088b-a265-4517-84df-c49b156af8a7): CC-BY 4.0, no
  limitations on public access, WFS layer `emodnet:heritageshipwrecks`. Rob found it after Tobler reported wrecks
  as unfetchable at Rosebank. Asks: (1) harvest the EMODnet WFS endpoints (Human Activities first; then the other
  EMODnet portals) so wrecks, pipelines, installations, wind farms, military areas, dumped munitions and fishing
  effort can be fetched; (2) take licences from the GeoNetwork (ISO) metadata where the service doesn't state one;
  (3) more generally, when a WMS layer has a WFS sibling on the same server, prefer the WFS record.
- **17 Nov (night): a mislabelled NSTA layer.** Atlas record `bdb5d0a70436343e`, titled "UKCS offshore infrastructure
  pipeline linear (WGS84)", points at NSTA's `UKCS_offshore_infrastructure_pipeline_linear_removed_(WGS84)` service:
  *removed* pipelines. It returns nothing at Rosebank, while `29a134d61746d7dc` (the ED50 layer) returns Rosebank's
  live flowlines. Tobler's analyst chose the WGS84 one (sensibly) and reported "no pipelines". Asks: keep words like
  "removed", "decommissioned", "proposed", "historic" in titles when they're in the service name; and check whether
  other NSTA "(WGS84)" records point at "removed" services.
- **17 Nov (late evening), URGENT: `fetch_features` says "No dataset with id …" for ids that `find_datasets`
  and `get_dataset` return.** Seen from GitHub Actions at about 20:30 UTC: `get_dataset {"id":"4611b4343153c1b9"}`
  (NatureScot, 30 x 30 Protected Areas) answers, but `fetch_features` with the same id and a bbox near Linlithgow
  fails with "No dataset with id 4611b4343153c1b9". Same for SEPA river flooding (ce6e59e44174bf68), Historic
  Environment Scotland Scheduled Monuments (25ffbbeec3836e1a), Hutton land capability (bd18c4d31d168bf4) and others.
  Earlier the same evening `fetch_features` worked for NOAA layers (9383353f552e9482). Reading `worker/src/index.js`,
  `fetchFeatures` looks the id up in the published shards (`DATA_BASE` + `d/<first two chars>.json`) while
  `find_datasets` and `get_dataset` read D1, so a rebuild that's in D1 but not yet in the shards (or the other way
  round) would do this. **Likely cause, found later:** atlas commit `daf3023` (20:10 UTC, "Viewer: gzipped detail
  shards keyed by 3 characters (dz/)") changed the published detail files; `details()` in the MCP server still reads
  `d/<2 chars>.json`. A NOAA layer that fetched fine at 19:40 (9383353f552e9482) fails the same way since. This breaks
  the contract in `docs/mcp-tools.md` (`fetch_features`), so it blocks Tobler's feature searches, named searches and
  screening. Asks: (1) make the two agree (or have `fetch_features` fall back to D1); (2) note in
  `docs/mcp-tools.md` that ids from `find_datasets` are always fetchable. Tobler reports these as "not checked", so
  nothing is wrong on screen, but most screens come back mostly not checked until it's fixed.
- **17 Nov (late evening): NASA FIRMS and other trusted global services.** Tobler now calls NASA FIRMS (VIIRS and
  MODIS thermal hotspots, open under NASA's data policy, free MAP_KEY) through its own Worker, because the atlas holds
  only Esri's copy (Esri Master License Agreement) and a regional Alaska service. Longer term it would be better in
  the atlas: (1) catalogue key-gated services like FIRMS, with the key held server-side; (2) a "trusted global
  service" tier for publishers such as NASA, ESA/Copernicus, NOAA, USGS, UNEP-WCMC, GEBCO, EMODnet, FAO, so agents
  can ask for them first; (3) prefer a publisher's own service over an Esri Living Atlas copy (e.g. NOAA's own
  Essential Fish Habitat services, if they exist, over Esri's copies), and record the Esri Master License Agreement
  as its own licence class, since Tobler leaves those out unless the person holds an Esri licence.
- **17 Nov (evening): catalogue text search that copes with world-wide searches.** Tobler is adding an open
  "find data" tool for its analyst, built on `find_datasets` with `text` (e.g. "VIIRS", "thermal", "essential fish
  habitat") and an area that can be large (an ocean, a country, sometimes the world). In a test from GitHub Actions,
  3 of 7 world-wide text searches failed with "D1_ERROR: D1 DB is overloaded. Too many resources consumed within a
  10 second window" (VIIRS, fire and thermal worked; hotspot, MODIS and a plain Gulf of Mexico bbox search failed,
  run one after another). Asks: (1) text search that holds up for world-wide and large areas; (2) results ranked so
  the authoritative copy comes first and duplicates are folded (Esri and an Ontario portal both list "Wildfire
  Response Points"); (3) if useful, say in `docs/mcp-tools.md` what `text` matches (title and publisher today) and
  any limits Tobler should respect.
- **17 Nov (evening), unparked by Rob: a name index.** A nightly harvest of feature names and outlines from
  named-feature layers (licence blocks, fields, protected areas, wind leases, marine sanctuaries) into the atlas
  database, so a named search is one query instead of asking up to 40 live services. Wanted for speed: Tobler is now
  a screening tool and named lookups ("block GC 807", "Flower Garden Banks") should be quick. Needs a licence check
  first: it copies names and outlines rather than pointing at the services. Rob's call on the licence question.
