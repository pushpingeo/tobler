# Decisions log

Judgement calls made while building, newest first. Bigger product decisions live in the plan doc (`tobler-workspace-plan.md` in the claude.ai project).

## 27 Nov 2026: the replay gate (plan, next step 1)

Built `scripts/replay-gate.mjs`, `scripts/replay-score.mjs` and `eval/replay/` with Rob's go on where the data
lives (here, development sites only), which sites (R1, R2, R5, R6, R11, R17, R19, R21) and pushing. Judgement calls:

- **The gate screens the boundary directly, not through a chat.** Each `site.geojson` becomes a place made from a
  file and goes to `host.screening.screen`, the sealed screen the page runs. Place-finding has its own evaluation;
  mixing it in would make a miss hard to place. The alternative was a `try-requests` line per site.
- **Scoring is in code, by kind.** Each expected kind maps to the check that should find it (`KIND_CHECKS`); a
  feature counts only from that check's own datasets, matched on its distinctive name words (designation words and
  record numbers left out; road numbers exact). Classes (homes, peat, farmland grade, railways, wind farms) match
  by any feature or class the check returns. No model judges a match.
- **Gaps aren't misses.** Not checked, check not run and no check are reported apart and left out of recall, so an
  honest "not checked" never scores as a pass or a fail.
- **Position tolerance:** documents often measure from the nearest turbine, so closer than stated is in place;
  further by more than 30% (at least 500 m) is "found elsewhere", still surfaced.
- **Pass or fail is against the last complete run**, not a fixed threshold, until Rob sets one from the baseline.
- **Battery storage runs as `other`** (no asset type for it yet), as the page would.
- Already visible offline: Kirkton's peat check is off by default (its source is non-commercial), and the
  watercourses check doesn't run for onshore wind, so Halladale River scores "check not run".
- R5's outcome was redone from the real decision letter and Kirkton's own summary: 39 facts, all matched to the page.
- **Baseline (`gate-2026-11-27-baseline`):** 44 of 44 must facts surfaced where Tobler has a check, but that's 44 of
  93; the rest are check not run (19), no check (27) or not checked (3). Two first-run misses were the scorer's
  (Lochgoin/Lochgoyn; "Thame Lane railway bridge"/"Thame Lane Bridge"), so names now allow one letter's difference
  in a long word, and one missing word in a name of three or more. Re-scored; only those two facts changed.
- **Leads from the baseline, for Rob (can change answers, not fixed):** onshore wind of 100 MW or more is screened
  at global scale (`catalogue/assets.json`), and the global scale has 17 checks against 39 to 45, with no heritage,
  homes, roads or water: Lethen and Scoop Hill lost them. Kirkton's A836 is found at 1.66 km though the turning-area
  exclaves sit beside it. Three none-expected facts read as contradicted, two of them because the document measures
  from the turbines and the run from the boundary (R2, R5 homes), one because R17's polygon is larger than decided
  (the railway). Whitelee's run names both Scotland and England.

## 26 Nov 2026 (night, last): fixes from Rob's Heswall log (Brimstage Road, screened as a mine)

Rob's log (asktobler.com, 21:34–21:40) turned up seven faults, three of them from this week's changes. Fixed:

- **The offer said a gap had a layer and had none** (`js/bringin.js`). The analyst's look-for "surface water flood
  risk" and the check "Surface water flooding" were one gap in two wordings, searched twice; the looser search found
  a layer and the stricter said "found no layer". Now a look-for that names a not-checked check (most of its words,
  either way round, `namesEnough`) is dropped and the check's curated words search it.
- **A capped look gave a wrong nearest.** The look before offering reads 500 features from the run's reach, in the
  server's order, so "nearest 12 km" for surface water on the Wirral. When it's capped, Tobler looks again within
  2 km (`NEAR_LOOK_KM`) and gives the nearest only if that look isn't capped too; a feature with no name of its own
  isn't named after its layer ("nearest 400 m away").
- **The same data offered again under another title.** "Permitted Waste Sites - Authorised Landfill Site
  Boundaries" was offered after the run had read "Authorised Landfill Site Boundaries, England". A layer whose title
  holds a used title's core (no brackets, no nation), from the same publisher, counts as read.
- **Class checks used a share cut-off, not package B's relation** (`js/checks.js`). Flood zones crossing about 2 ha
  of the 8 km² buffer (0.13% and 0.25%) read "none on the site; nearby: … at the edge" beside evidence saying they
  crossed it: the 0.5% cut-off. Judgement call: a class feature is now on the site by its relation (any overlap over
  1 m², B's rule), except from a source marked `coarse` in `catalogue/checks.json` (the 1 km radon grid, the
  provisional and predictive farmland maps, Hutton's 1:250,000 land capability, the Carbon and Peatland map), which
  keep the 0.5% cut-off because a sliver may be the map's resolution. Under 1% now reads "(under 1%)", not "(1%)".
  **Can change an answer:** small overlaps of flood zones and source protection zones now count as on the site.
- **A road became a point, called an outline** (`js/gazetteer.js`, `js/placetools.js`). Nominatim's line was thrown
  away (only polygons were kept). A road, railway or river now keeps its line, anchored on Nominatim's own point, and
  `make_place`'s steps say what the shape is ("the line of …", "the point for … (the source gives no outline)").
- **Ids and near-duplicates in the choices** (`offer_choices`). Ids in the analyst's reason are replaced by names in
  code; names that repeat get their locality ("Brimstage Road, Heswall"); candidates of one name and kind within
  300 m (`SAME_PLACE_KM`) are one choice. A platform and its field share a name but are different kinds, so stay two.
- **A pick is the yes** (Rob: the route to the site was protracted). A place built on a candidate the person picked
  from the choice card, as they saw it (its own shape or point, not moved, grown, joined or clipped), is accepted
  straight away: the pick was the confirmation. Decided from the page's record of the pick (`pickedCandidate`), not
  the analyst's word. A buffer or square round a pick is still a proposal.
- **"X near Y"** (place-finding 4.19): find both; the X by Y is the one, and the place meant is the part of X by Y.
- **The OpenStreetMap copy wasn't used** (`js/osmsnapshot.js`, `js/osmchecks.js`). The copy answered only if the box
  round all kinds together lay inside its outline; a mine's aerodrome check (15 km) reached into Liverpool Bay, so
  every kind went to Overpass, which was down: ten checks not checked. Now each kind's own box is tested; the copy
  answers the kinds it can and Overpass is asked only for the rest. Not confirmed against the live manifest (this
  workspace can't reach data.asktobler.com); the live replay is the check.
- **A flag joining two kinds of evidence** says which is that near ("SSSI Impact Risk Zones: on site"), so "SSSI
  close to the site … ; on the site" no longer reads as an SSSI on the site.
- **Live replay (run 45903282663, on main):** "brimstage road near the train station" found Heswall station on
  Brimstage Road in one turn (the new "X near Y" step) and screened a 1-mile circle there as a mine. The
  OpenStreetMap checks came from Tobler's copy (homes, schools, health care, power lines, roads, railways); only
  aerodromes and wind turbines, whose boxes leave the copy, went to Overpass (down again: not checked). The offer
  had no contradiction and didn't offer the landfill layer again. It showed one more fault, fixed in the next commit:
  a brought-in layer's fetch is capped too, so its "nearest" ("11.9 km" for surface water) now comes from the look
  before the offer, and a feature named after its layer is given as a distance alone.
- **Map colours:** nothing to fix. This run found nothing under hazards or air and climate, the two topics whose
  colours changed on 26 Nov.
- **Left:** the headline sentence is still the model's (it named the Dee Estuary, not in the top three): package E.
  "none in dataset" in the checked list means none within the check's reach; renaming the state touches four modules
  and their tests, so it waits. "Nearest town Liverpool" for Heswall: the known fault.
- **Tested:** `npm test` (new tests in bringin, checks, places, osmsnapshot, runreply); all 14 browser checks with
  `route-local` (no server could be started in this session), desktop and phone, `browser-choice` now replaying the
  Heswall pick. **Not tested:** a real browser on a real phone; the copy against the live manifest (see the replay).

## 26 Nov 2026 (late night): imperial wired into rings, slider, bands and check lines (package C's last part)

- **Rings and slider** sit on the reader's ladder: in feet and miles, 300 ft, 1,000 ft, ¼, ½, 1, 2, 5, 10, 20, 30 mi, cut at the run's furthest reach (`runRings`, `sliderSteps`, `ladderTo` in `js/reach.js` take the units). Ring labels use the ladder's own words (`U.ringText`: "¼ mi", not "0.25 mi"). Changing units redraws a run's rings; nothing is re-measured. Old runs keep their near/close/wider rings in any units.
- **Each check is counted on both ladders at run time:** `bands` (metric, as before) and `bands_imperial` (counts, edges in km). Counts aren't a unit, so the record stays metric; the share link carries both. An older run without `bands_imperial` shows its metric bands with the words converted (0–330 ft, 0.31–0.62 mi), the only honest regrouping without the features' distances.
- **Check lines are built in the reader's units** when drawn (`checkLine(r, { units })`, `checksView(run, units)`), on the card and the report. Metric lines are unchanged. The sealed judge still reads metric (the record); `get_run` gives the conversation agent both ("6.21 mi (10 km)").
- **Short distances:** 1,000 ft now shows as "1,000 ft" (feet up to and including 1,000 ft), so the ladder's edge and the distance agree.
- **localise** (the last resort, for text the record holds as words: the reach line, changes, sea, elevation, the analyst's summary) now converts metres and ranges ("1–2 km" → "0.62–1.24 mi"), not only km. Package A's record lines (`range`, `changes`) stay metric words in the record and pass through it.
- **Approximations:** none that change an answer. Counts in imperial bands come from the same features and distances as the metric ones. Densities ("hours per km²") stay in km²: converting a rate isn't a distance and is left as the publisher gave it.
- **Tested:** `npm test` (new tests in `test/checks.test.mjs`, `test/reach.test.mjs`, `test/units.test.mjs`); all 14 browser checks, desktop and phone; `browser-run-card` now switches a finished run to feet and miles and back (rings on the round ladder with its words, the slider redrawn, check lines with no km left, back to metric as it was). **Not tested:** a live replay in imperial on a US site; a real phone.

## 26 Nov 2026 (night, later): how a feature sits against the site, wired in (package B, second half)
- **Rob's yes (26 Nov, 20:28)** to the five calls below ("covers"; a multi-part feature partly on the site is
  "crosses"; touching from outside is adjacent at 0 m; a point on the edge is on the site; under 1 m² is a touch).
- **Measured where distances are measured:** `fetch_features` (`js/datatools.js`), the OpenStreetMap checks
  (`js/osmchecks.js`: a road's or river's pieces taken together, `relationFieldsAll`) and the offer's look before
  offering (`js/bringin.js`). Each feature carries `relation` and, on the site, `site_share` or `length_inside_km`
  (and `parts`/`parts_on_site` for a multi-part feature). Only features within 50 m are measured further; the rest
  are "outside" from the distance already found. A point site has no outline, so it gets none (its run measures
  from the point, as before). The tool result gives the analyst `on_site` and `next_to_site` counts beside
  `inside_or_touching`.
- **What changes in answers:** a feature that only touches the site's edge from outside is no longer "on site": it
  counts in the first band (0–100 m), the check says "(n next to the site)", and its map band is the first band. An
  inside check (MARPOL, coal mining risk, IRZs, World Heritage buffers) is inside only when a zone is on the site,
  not touching it; it now says how much of the site the zones cover together ("about 40% of it", each piece once,
  `zonesAtSite`), and when it isn't inside, a zone next to the site is named. A check's nearest is something on
  the site before anything off it.
- **Where it shows:** the check line ("nearest X (crosses the site's edge, 5 km of it on site)"), the map's tap
  details, the card's feature lists and flag evidence, the report, the share link (it now keeps the fields) and the
  code-written replies ("next to the site, 40 m"; "crosses the site's edge, 40% of the site"). The words are
  `whereWords` in `js/relation.js`, in the person's units; package E may reword them. A search area keeps its own
  words ("in the search area"), and a wide area the site lies within keeps "around the site".
- **Left as they were:** class checks (flood zones, farmland) still use `coverageIn` with their own minimum share;
  `coverageIn` for search areas. Both could move onto `relationOf` later. The point-site fault (brought-in layers
  measured from the point) stays: it's about which shape a point run measures from, not the relation.
- **Tested:** `npm test` (relation 25 tests; a sealed run with a pipeline crossing the edge, a SAC touching it and
  MARPOL over 40% of the site; replies with relation evidence); all 14 browser checks on desktop and phone, with
  `browser-run-card`'s flowline now crossing the edge and checked on the card's check line and in the report.
  **Not tested:** a live replay; the map's tap details by a real tap (the words come from the same function the
  report uses); a site with thousands of features on its edge in a real browser (node: 500 features on a
  4,688-vertex edge in about 0.3 s).

## 26 Nov 2026 (evening, later): how a feature sits against the site, as a tool (package B, first half)
- **What:** `js/relation.js`, new and not yet wired in. `relationOf(site, feature)` says **within**, **crosses**,
  **covers**, **adjacent** (off the site, within 50 m of its edge: `ADJACENT_KM`) or **outside**, with the distance;
  for an area, the overlap in km² and its share of the site (holes taken off) and of the feature; for a line, its
  length inside; for a multi-part feature, how many parts are on the site. `zonesAtSite(site, zones)` is the zone
  answer: the zones the site touches, largest share first, the share of the site they cover together (each piece
  counted once), whether the site is wholly inside, and the nearest zone off the site. 21 tests in
  `test/relation.test.mjs`, now in `npm test`.
- **Judgement calls (Rob to confirm):**
  - **A fifth relation, "covers":** the site lies wholly inside the feature (a flood zone, a national park). The
    package named four; calling that "crosses the edge" or "within" would be wrong. Close to what `around_site`
    already does for very wide areas, which stays as it is.
  - **A multi-part feature with one part on the site and one off is "crosses"**, with `parts_on_site`, even though
    no edge is crossed. The words for it ("partly on the site") are package E's.
  - **Touching from outside is adjacent at 0 m**, not on the site: a field that shares a hedge with the site isn't on
    it. A point on the edge is on the site (a point has no other way to touch).
  - **An overlap under 1 m² is a touch**, not a crossing (the same sliver rule as the area budget).
  - A check may pass its own adjacent distance (`adjacentKm`); none does, and the default stays 50 m.
- **How it measures (invariant 2):** distances from `js/nearness.js` (geodesic); overlays and areas in the
  equal-area plane centred on the site (`laea`); lengths inside are each segment's geodesic length times the share
  of it inside. The overlay runs only for features that touch the site. Before it, the site is trimmed to the
  feature's box (a hand-written rectangle clip; the vendored Turf has no `bboxClip`): on a 4,688-vertex outline the
  overlay took about 60 ms a feature untrimmed and under 1 ms trimmed. A test checks 60 shapes on a concave site
  with a hole against the untrimmed overlay (same to the square metre).
- **Not done yet (waits for package A on main):** wiring into the count checks, the card, the report, the map's tap
  details and the code-written replies. The point-site fault (brought-in layers measured from the point) is tied to
  `distances.wider` in `js/bringin.js`, which A rewrites, so it's left for the wiring.
- **Tested:** `npm test`. Nothing in the page uses it yet, so no browser check applies.
## 26 Nov 2026 (night): units, package C (claude/work-packages-2026-11-26.md)

- **One place for factors.** `js/units.js` holds the exact ones (foot 0.3048 m, yard, mile 1,609.344 m, nautical mile 1,852 m, acre 4,046.8564224 m², square mile); `test/units.test.mjs` fails if any other file in `js/` or `scripts/` holds one. `js/elevation.js` now takes its foot from there. Floating-point noise is rounded at 12 significant figures (under a micrometre on 50 km).
- **Short distances:** metres under 1 km (metric and nautical: sea practice gives safety zones in metres); feet under 1,000 ft in imperial, miles from there. This changes metric too: "250 m", not "0.25 km". The 1,000 ft switch is mine, matching the imperial ladder's second edge; Rob to confirm.
- **Units as said:** `parseLength("150", "feet")` → `{ km: 0.04572, said: { value: 150, unit: "feet" }, unit: "ft" }`. The usual spellings; anything else (furlongs, "US survey feet", cm) is refused, never guessed. Package A's distances-in-words input calls it.
- **Default from the country:** `unitsFor`: imperial in the United States, metric elsewhere, nautical offered at sea; the person's choice wins. The page follows the place in view until the person chooses in Settings, which now has "From the site's country" (the default; forgets the choice) beside the three units. A switch is said once on the activity line, with why. The choice is kept in the browser.
- **The model never converts.** The conversation agent's note no longer says "give miles first, with km in brackets". The project summary and `find_place`/`describe_place` summaries carry figures code converted, in both units ("1.37 mi (2.2 km)"), and the note says to quote them and never convert; a figure given only in km stays in km. Code-written replies (`js/runreply.js`) give distances and sizes in the person's units (metric replies keep the whole hectares of the approved wording). The digest's number check now traces a figure in miles, feet, nautical miles, acres or square miles through the exact factors, so a quoted conversion traces and km passed off as miles doesn't.
- **localise** stays only as the last resort: the place card's line and the activity line are now built from values (`summaryLine` takes formatters). Still through `localise`: check lines, the distances line, sea and elevation lines, the search headline. They come from `js/checks.js`, `js/ntrrun.js` and `js/siterole.js`, which package A rewrites; it should build them with `U.dist`.
- **Report and share link** say which units they show: the link carries `?u=` (the units it was made in) and the report has a Units line.
- **Bands in imperial (Rob, 26 Nov 18:47: "B everywhere in imperial"):** a second ladder in round values, 300 ft, 1,000 ft, ¼, ½, 1, 2, 5, 10, 20, 30 mi (30 mi is 48.3 km), because US practice searches to ½ and 1 mile (40 CFR 312.26) and the metric ladder puts both mid-band. Nautical uses the metric ladder. `ladder()` and `ladderBands(reach)` in `js/units.js`, cut at the reach ("1–1.24 mi"). Not wired: rings, slider and band lines move onto them after package A. The comparison Rob saw was drawn on the former GE plant, Pittsfield, Massachusetts, with EPA records.
- **US survey foot:** not a display unit. A shapefile whose .prj is in US survey feet (EPSG:2249, as ArcGIS writes it) converts exactly through proj4 (new test in `test/fileimport.test.mjs`; read as international feet it would be 0.4 m off there). Gaps found: a GeoJSON naming a state plane code is refused (only a few codes are built in), and a service in a state plane wkid falls back to the server's WGS84 copy, flagged. Both need EPSG definitions from the registry, not a units change. NAD83 is also treated as WGS84 (no shift, about 1–2 m): flag it with the datum work.
- **Rebased onto package A, step 1 (`e304aea`):** A's `toKm` (metres and kilometres) now goes through `parseLength`, so A's distances in words read feet, yards, miles and nautical miles with the exact factors; `js/reach.js`'s refusal now names what it reads; two lines of `test/reach.test.mjs` moved with it. A's `LADDER` in `js/reach.js` is the metric one; when A wires rings, slider and bands, the imperial edges and labels come from `ladder()`/`ladderBands()` here.
- **Tested:** `npm test` (new `test/units.test.mjs`, 11 tests; log checks; file import); all 14 browser checks on desktop and phone, including the new `browser-units` (a US site in acres and miles with nothing chosen, a Scottish one back to metric, a choice that's kept and wins, handing it back) and `browser-run-card`'s report link and Units line. **Not tested:** a live replay with imperial; a real phone.
## 26 Nov 2026 (night): package A, reach, ladder and the asset table (plan item 1)
- **One search distance.** Each check's reach is the only search distance (`js/reach.js` `resolveReaches`): the
  check's default for the scale, extended by the asset where `catalogue/assets.json` has a stated reason, overridden
  by the person. The run's near/close/wider, `catalogue/distances.json`, `js/distances.js`, the screening skill's
  1/5/20 table and the desk study's 0.25/0.5/2 are gone. Each layer still fetches to its own check's reach;
  brought-in layers, the rings and the slider go to the furthest any check looked (capped at 50 km). The run record
  has `reach` (scale and why, the asset, the range, the furthest, the ladder, extensions, changes, what wasn't used)
  in place of `distances`; each check result says `reach_from` and `reach_default_km` when its reach isn't its own.
- **The scale** still picks which of a check's three reaches applies. It now comes from the asset table: each row's
  scale and size rules are distances.json's draft-1 values carried over unchanged (the old wider band mapped through
  the old thresholds: up to 10 km local, up to 25 km regional, beyond that global), marked as first-cut defaults
  awaiting package D. One change: an asset row with no entry for the setting (solar at sea) now uses the general
  defaults for its size, as an asset with no row does. A site of 100 km² or more is global, as before.
- **The asset table's extensions, each with a source** (claude/research-reach-evidence.md; Rob's EIA review):
  onshore wind's National Parks, National Landscapes, wild land and wind turbines (cumulative) to 45 km, or by
  NatureScot's tip-height table when the height is given; its scheduled monuments, parks and gardens, battlefields
  and World Heritage Sites to 10 km; its SPAs to 20 km. Judgement calls: listed buildings stay at their own reach
  (towns have hundreds, and the fetch limit would undercount them); local landscape designations aren't extended
  (the sources speak of designated landscapes); offshore wind gets no extension yet (the 45 km source is onshore).
  An extension never shortens a check. Effects (sight, flight) are recorded for wind with sources; nothing reads
  them yet.
- **An asset with no row** (housing, a warehouse, nothing said) runs on the general defaults for its size, and the
  card, the report and the analyst's brief say "No distances are set for housing yet, so the checks use the general
  defaults for a site of this size."
- **One ladder** (`LADDER` in `js/reach.js`): within the site, 0–100 m, 100–250 m, 250–500 m, 500 m–1 km, 1–2, 2–5,
  5–10, 10–20, 20–30, 30–50 km, closed at a check's reach (a 45 km reach ends 30–45 km). `checks.json`'s per-scale
  band sets are gone (version 8). The map's rings are the ladder's steps up to the furthest reach; the card's
  slider steps along it (an index, so 0, 100 m, 250 m, …). The map's emphasis (strong near, fainter out) is by
  distance alone, for display.
- **Distances in words**, one input for all three skills: `distances: [{what, value, unit}]` on `screen_site` and
  `run_study`, the number and unit as said. `what` is `all`, a topic, a check, or a developable-area deduction;
  exact names first, then words ("heritage" is the topic, not World Heritage Sites; "homes" is Nearest homes in a
  screen and the homes deduction in a budget). "All" sets every count check (cutting as well as stretching), never a
  zone (inside) or class check; a check named outright can take a class check with a reach. In the developable area
  every distance is a protection distance, and a search distance there is said as not used. Metres and kilometres
  only (`toKm` in `js/units.js`); anything else comes back as "not used: only metres and kilometres are read for
  now" until package C. The old `buffers` and near/close/wider inputs are still read (held runs, re-runs of old runs:
  an old `wider` becomes "all").
- **Changes on the card:** "You changed: every count check to 5 km (was 250 m to 5 km, by check)", and anything not used,
  on the card's distance line, in the reply, the report and the rerun comparison. The record keeps what was said and
  the metric value.
- **Reached by** (`reached_by` in checks.json) on 38 checks where it's clear: water, sight, flight, ground, road.
  Left out where it isn't clear (air permits, most nature sites, homes' noise: there's no "sound" in the list yet).
- **Vessel traffic** read "out to the close band"; it now has its own `read_km` (2, 5, 10 km by scale, the old close
  bands), which "look out to" doesn't change.
- **A check whose own reach is past 50 km** (boundaries at global scale, 100 km) keeps it; the fetch is cut to 50 km
  and its line says so, as before.
- **Skill wording:** ntr-screening 4.2-draft drops the distances table and `distances_km`, and restates its
  confidence and receptor rules that named near/close/wider bands in the old defaults' kilometres (high within about
  1 km, 2 km at sea; transboundary high within 5 km, 10 km at sea). developable-area 0.3-draft names the new input.
- **Old runs** in people's browsers keep `distances` and open as they were (`isLegacy`, `runBand`,
  `legacyDistancesLine`); re-assessing one narrows its bands as before.
- **Barnston:** the brief's test said Barnston reports to 2 km. At site scale aerodrome safeguarding looks out 5 km,
  so the rings stop at 5 km; nature and heritage at 2 km; no 10 km ring. The tests say that.
- **Tested:** `npm test` (new `test/reach.test.mjs`; ntrrun end to end: Barnston on the general defaults, "look out
  to 5 km" from the conversation, "keep 80 m from homes" in the developable area); all 13 browser checks, desktop and
  phone. Live replay on main (run 45881070635): Whitelee for 200 m turbines (regional, 500 m to 45 km, the
  landscape checks to 45 km); Barnston housing with "look out to 5 km" (the change on the card and in the reply); the
  developable area on Whitelee keeping 80 m from homes (homes buffer 80 m, no search moved). The replay showed
  "every check to 5 km" beside a range that still started at 250 m (flood zones keep their reach), so the line says
  "every count check". **Not tested:** ring labels (the test basemap has no glyphs).

## 26 Nov 2026 (afternoon, later): sea checks on land need the sea within reach; named projects ask the atlas (plan item 1)
- **Sea checks on a coastal land site:** a check for the sea (`setting: "sea"`) now applies on land only when the
  coast is within the check's own reach, plus 1 km for the coastline's accuracy (Natural Earth, about a kilometre).
  Before, any land site with the coast inside the run's wider band (20 km) got them, so the Oracle campus, Stanlow
  and Riccarton Road listed "subsea pipelines" (reach 2 km) as not checked from several kilometres inland. Marine
  protected areas and offshore wind farms (10 km at regional scale) still apply to those sites. Value checks with no
  reach (vessel traffic) keep the run's rule. Offshore sites are unchanged. `js/checks.js` `settingFits`.
- **Named projects:** when `find_place` gets a name that says plainly what it is ("… solar farm", "… wind farm",
  "battery storage", "power station", "… quarry") and no `kind`, code asks the atlas for that kind too (`projectKind`
  in `js/placetools.js`), in the call's area or country, or a map view no wider than 15°; otherwise it says it
  wasn't searched. The report says `kind_from_name`. Rob's Droves log (25 Nov): the analyst searched by name only, so
  the Planning Inspectorate's outline was never asked for. Only the main query is read: in a replay (run
  45826101833) the analyst added "Riccarton solar farm" as an alternative to a Riccarton Road search, and the extra
  UK-wide atlas search made a 3 s search take 34 s. An atlas search by kind takes about 30 s either way.
- **Live replay on main** (run 45824550185, real outlines, before these two): the Stanlow desk study and a Barnston
  housing screen asked England's layers only; their not-checked lines are England's own pending sources (permits,
  pollution incidents, surface water flooding), with no Welsh source among them.
- **Tested:** `npm test` (a checks test for sea checks inland, on the shore, just past the slack and at sea; a place
  test for the kinds read from names and the wide-view refusal); browser checks choice, ux, run-card, search-area,
  study, desktop and phone. Replay 45826101833: Droves found the Planning Inspectorate's outline (the analyst gave
  the kind itself that time, so the new path wasn't needed); Riccarton Road showed the slow-search problem above,
  now fixed. **Not tested:** a live replay where the analyst leaves the kind out.

## 26 Nov 2026 (afternoon): real nation and council outlines in place of boxes (plan item 1, first part)
- **What:** which UK nation's or council's layers a site gets is now decided on real outlines, not boxes
  (invariant 2's known breach, now closed). `data/ref/uk-areas.json`: the ONS's Countries (December 2025) and Local
  Authority Districts (May 2025) for the four councils that publish records (Clackmannanshire, Derby, Lambeth,
  Sheffield), generalised outlines clipped to the coastline, simplified to within 100 m, islands under 0.5 km² left
  out; 0.8 MB (about 240 KB compressed), loaded only for a site near the UK. Open Government Licence v3.0 (Rob's yes,
  26 Nov). Built by `scripts/build-uk-areas.mjs`.
- **How:** `js/ukareas.js` `areasNear` measures the distance from the site's footprint to each nation and named
  council (`js/nearness.js`, exact on the edges; a box only narrows which outlines are measured). In
  `catalogue/checks.json` a UK source now says `in: ["England"]` (Great Britain: three nations; England and Wales:
  two) instead of copying the boxes; it's used when the site grown by the check's reach touches one of them.
  `extent` keeps the box of a source's own data, used only at sea (inshore marine layers). `applies.in`: England's
  SSSI Impact Risk Zones and the councils' records apply only where the site itself touches the area. The
  `regions` boxes are gone. The developable area's own buffers now choose the sources too (`reachOf`), not the
  wider scale reach.
- **Judgement calls:** 100 m of slack, the simplification's own tolerance, so a site within 100 m of a border gets
  both nations' layers (more asked, never fewer). A site on land in the UK that falls in no nation (an island or
  sliver the simplification lost) gets its nearest nation within 5 km. If the outlines can't load, every nation's
  layers are asked, so a pending source elsewhere can only make an answer "partly checked", never hide a find. The
  ONS portal serves WGS84 with its own OSGB36 shift (a few metres, well under the 100 m simplification), so nothing
  picks or applies a datum transformation (invariant 1).
- **What changes:** Stanlow (9 km from Wales) and Barnston (8 km across the Dee) no longer get Wales's layers at
  site scale: before, the fifth England box overlapped Wales, and Wales's pending landfill and permits turned clean
  English answers into "partly checked". At regional scale (10 km) the reach really does cross into Wales, so Wales's
  SACs are asked, rightly. England's layers are no longer asked for sites deep in Wales through their data's extent
  box (that was for the sea only).
- **Also fixed:** the browser checks `browser-study`, `browser-budget` and `browser-osmcopy` blocked any address
  containing "arcgis", which since midday includes Tobler's own `js/arcgisauth.js`, so the page never started. They
  now block only outside https addresses.
- **Tested:** `npm test` (a new checks test on real outlines: Stanlow, Barnston, Derby in and out, the IRZ by nation,
  the island fallback, outlines missing, Liverpool Bay at sea; the old border-strip test passes on outlines); all 13
  browser checks, desktop and phone. **Not tested:** a live run timing in a real browser (about 0.1–0.3 s in node).

## 26 Nov 2026 (late morning): Sign in with ArcGIS in the service panel
- **What:** when a service on ArcGIS Online (`*.arcgis.com`) says it needs a sign-in, the service panel leads with
  "Sign in with ArcGIS". Above it is an optional field for the organisation's address (e.g. `shell.maps.arcgis.com`),
  so a company's own SAML page appears. OAuth 2.0 authorization code with PKCE, in a popup, with Tobler's app
  "Ask Tobler" (client ID `4GhkbypqSzSYKEb2`, in Rob's own org). No client secret. `js/arcgisauth.js`, `oauth.html`.
- **Hand-rolled, not ArcGIS REST JS** (Rob asked us to consider vendoring it). Its popup flow writes the PKCE verifier
  and state to localStorage, and puts the page's full address into the `state` it sends to ArcGIS. Its best feature,
  token exchange for federated servers, only matters for Enterprise. About 150 lines and no new dependency instead.
  Revisit for Enterprise portals.
- **Where things live:** the popup only hands the code back (to its opener, same origin only, and on a
  BroadcastChannel for when a sign-in page cuts the popup's link to the opener). This page holds the verifier,
  exchanges the code and keeps the token and refresh token in memory. A reload forgets the sign-in. `oauth.html`
  takes the code out of its address and history at once. The organisation's address (not a secret) is remembered in
  localStorage. The log records only "signed in", "cancelled" or "failed", with no name or org.
- **Where the token may go:** `tokenAllowed`, one rule used by the panel too (`SV.isOnline`): https, no port, an
  `arcgis.com` host. A company server, the Worker, the atlas and the model never get it (unit tests and
  `browser-service` check this). The sign-in is asked for only after the service says it needs one, so a public
  Online service is still read, and recorded, as public. ArcGIS Online gets no credentialed (browser-login) try.
- **The token field** stays, folded under "Other ways in" for Online services (open by default for other servers).
  Next to it: a portal's Generate Token works; an app item's "Temporary Token" doesn't, because it's the app's own.
- **Messages:** signed in but not shared → "Your ArcGIS sign-in doesn't open this service: it isn't shared with you,
  or it belongs to another organisation." Org declines the app / person cancels → "The sign-in was cancelled, or your
  organisation doesn't allow this app." Popup blocked → says to allow pop-ups.
- **Tested:** `npm test` (new `test/arcgisauth.test.mjs`: the token rule, org addresses, redirect, PKCE, the return
  by message and channel, wrong origin/state ignored, refusal, pop-up blocker, refresh); `browser-service` desktop and
  phone (new: a faked Online service, org sign-in page, popup, token exchange, pick, bring in; no token, code or name
  in storage or the log; token only to arcgis.com); `browser-ux`, `browser-sitefile`, `browser-run-card`.
  **Not tested:** real ArcGIS Online (the sign-in page, token endpoint and CORS are faked), a real SAML login, a real
  phone's popup handling, the registered redirect URIs.

## 26 Nov 2026 (morning, Rob's log): look at a layer before offering it
- **Rob's Riccarton Road log:** the offer put up EMODnet's Pipelines for "subsea pipelines" on a site in Linlithgow;
  brought in, it had nothing within 20 km. The offer only checked that a layer's extent covered the site.
- **Now each candidate is looked at first** (`offerFor`): its features out to the run's reach (the assessed distance;
  inside only stays inside), measured from the site, counted and the nearest named. Only a layer with something in
  reach is offered, and the offer says what it holds ("2 within 50 km, nearest Troldfos (Possibly), 2 km away").
  Up to three candidates per gap are tried in turn. One with nothing in reach is said ("I also looked at Pipelines
  (EMODnet Human Activities) for subsea pipelines: nothing within 20 km, so it isn't offered"). Nothing is put on the
  map or kept until the yes. The one-feature probe of council layers is gone: the look covers it.
- **Live replay on main** (run 45775099977): Riccarton Road 1 mile radius and the Oracle campus: Pipelines (EMODnet),
  a fishing-intensity layer and the NSTA's ED50 pipelines were looked at and not offered (nothing within 20 km);
  Stirling Council's historic environment records were offered for Riccarton Road (35 within 20 km, nearest 15.5 km).
  Empty layers are now said once per gap ("For subsea pipelines…, the atlas has 3 layers (…), but none has anything
  within 20 km").
- **Cost:** one `fetch_features` (up to 500 features) per candidate looked at, in parallel across gaps, 12 s each.
  The yes fetches again through `get_data` (the page's atlas client may answer it from its cache).
- **Approximations:** a layer that hits the 500-feature limit shows its count with a "+"; distances are from the run's
  site (the footprint, for a point).
- **Tested:** `npm test` (bring-in 6, ntrrun 41); `browser-run-card` (the layer is looked at once before the offer, the
  offer says what it holds, it comes in on the yes), `browser-search-area`, `browser-outofdate`, `browser-study`.

## 26 Nov 2026 (morning, later): a re-run takes what was brought in; the screen's old search code deleted (Rob's yes to both)
- **A re-run includes the layers brought in after the last run** of the same kind on the same place (and whatever that
  run carried over). They're fetched again, out to the new run's reach, become evidence the analyst can cite, and
  are listed apart from the standard checks in its brief ("Brought in by the person after an earlier run"). The record
  keeps them as `brought_in`, and the offer doesn't offer them again. The reply after a bring-in now ends "Explore it
  on the map; to have it judged, ask me to re-run the screen, which will include it" (the desk study likewise; the
  developable area has no offer). The card says "a re-run includes them". ntr-screening 4.1-draft: one sentence on
  judging them.
- **Deleted:** the screen's analyst searches (`analystSearches`, the tool loop, the tool-era system prompt, and the
  volume guard, evidence refs and search-area marks that only fed it). The lab has its own copy in asktobler-lab. Tests
  that used it now bring the same layers in (`BROUGHT` in `ntrrun.test.mjs`) or take them from the checks (the
  fixture's Crown Estate Scotland pipelines); counts that changed say why. The re-assess call uses the sealed
  screen's prompt.
- **A re-run says what it judged anew:** "This run also judged what you brought in: …" in the comparison with the run
  before; the old line blaming "the analyst's own searches" is now "the analyst's judgement of them".
- **Live replay on main** (run 45770920810): Stanlow solar, bring them all in, re-run: R2 fetched the two brought-in
  layers (Pipelines, Battlefields) to 20 km and judged them; no layer offered twice.
- **Tested:** `npm test` (ntrrun 41, a re-run including what was brought in), and the browser checks that run
  screens and studies (run-card, search-area, outofdate, choice, ux, study, budget, cards), desktop and phone.

## 26 Nov 2026 (morning): Rob's answers on item 1, and Tobler's server reads public services that block browsers
- **Rob:** a run isn't re-judged when layers are brought in; the person explores them first. Prompting a re-run is
  wanted, but a re-run doesn't yet take the brought-in layers, so the prompt waits for his yes on building that.
- **Invariant 5** now names `origin.method` as words, drawn, file or service (Rob's yes).
- **`GET /arcgis` on tobler-api (Rob's go for the `worker/` change).** A public ArcGIS REST service that doesn't let web
  pages read it (no CORS headers) can be read through Tobler's server, but only when the person presses "Read it
  through Tobler's server (public services only)" in the panel: a blocked service may be a company's internal one, and
  its address shouldn't leave the browser unasked. The Worker passes on only service, layer, query and export
  requests, only the parameters the page uses, only https and public hostnames (no IP addresses, no local names), no
  token (refused), no cookies or login, no redirects (a sign-in page), JSON or PNG/JPEG only, at most 5 MB; its own
  daily limit per visitor (3,000); nothing logged or stored. Through it, the panel's tiles and clicks go the same way.
  The place's record says it was read through Tobler's server.
- **Tested:** `npm test` in `worker/` (new test: allowed and refused requests, no cookies passed on, images, the
  limit); `npm test`; `browser-service` (44: a third case, a public service the browser refuses, read through the
  Worker only after the button), `browser-sitefile`, `browser-run-card`, `browser-ux`. **Not tested:** the deployed
  Worker against a real public service that blocks browsers.

## 26 Nov 2026 (night): a site from a map or feature service (plan item 1, second half; Rob's spec of 26 Nov, `claude/site-from-service-spec.md`)
- **Pasting an ArcGIS REST address opens a panel; it doesn't go to the analyst.** `js/servicesite.js` finds a
  MapServer or FeatureServer address (service or layer) in what the person types; the page shows their message, opens
  the panel, and makes no model call. The session log keeps "[a service address]", not the address (it may be
  private). A token in the address is taken out of it and used only in the panel.
- **The panel:** the service drawn over the same basemap (a map service through `export` in Web Mercator, the server
  reprojecting; a feature service's features in view, fetched as WGS84 for drawing only), a layer chip per layer when
  the address is a whole service, and a click picks the feature under it (6 px of tolerance), again to drop it. Picks
  come from one layer at a time (switching layer drops them, and says so). Points and lines need a buffer of 10, 30, 50
  or 100 m before the button works. The notice says what's kept and what the AI sees.
- **The datum isn't trusted to the server.** The picked features are asked for in the service's own coordinates (Esri
  JSON, no `outSR`), written as a GeoJSON naming its EPSG code, and read by the file pipeline (`readFiles`), which
  picks the transformation from the EPSG registry for where the data is, as for a dropped file. A datum that needs a
  judgement goes to the usual file card, where the analyst asks. If Tobler can't convert the service's coordinate
  system (only the built-in list: WGS 84, ETRS89, OSGB36, BNG, Irish grids, Web Mercator, UTM on WGS 84, ETRS89 and
  ED50), the server's WGS 84 copy is used and the place says so, with a warning. Rob's steer was to query with
  `outSR=4326`; this asks for the native coordinates instead, because that's how the datum gets checked.
- **Several features** come in as one site, joined, with each part's label and the service's feature ids in the
  record (ready for multi-site). **The record** (`origin.method: "service"`, a new value beside words, drawn and file):
  address, host, layer, layer id, feature ids, when, the native EPSG code, whether it was secured, the buffer, the
  conversion, and the licence: "unknown" for a public service until the atlas can look addresses up, "your own or your
  organisation's data" for a secured one. **Invariant 5 names the three old values; this adds a fourth, which keeps
  provenance travelling rather than bending it, but Rob may want the invariant's wording changed.**
- **Signing in, without the Worker:** a plain request first; if the service wants a sign-in, the same request with the
  browser's own login (`credentials: "include"`: a company portal's single sign-on, if it lists asktobler.com as an
  allowed origin; the error message names that setting); then a token field in the panel (a password box), kept in
  the panel's memory only and dropped when it closes, never saved, logged or sent to the model or the atlas. The
  panel also offers the file fallback (export as GeoJSON or a shapefile and drop it).
- **What the model sees:** the place's name (the feature's), its size and whereabouts, and one origin line: "the
  layer Parcels on gis.example-council.gov.uk" for a public service, "your organisation's secured service, layer
  Parcels" for a secured one. Never an address, a token or coordinates (checked in the browser).
- **Not built yet:** "Use as basemap" and the basemap switcher (the spec's secondary use); WMS/WFS; looking a public
  address up in the atlas for its licence and trust signals (an atlas request); OAuth for ArcGIS Online. A public
  service that blocks browser requests can't be read: going through tobler-api would be a `worker/` change, so it waits
  for Rob.
- **Tested:** `npm test` (new `test/servicesite.test.mjs`, 5: addresses, sign-in order, Esri rings, BNG through the
  file pipeline, buffers); new browser check `browser-service` (40, desktop and phone) against a fake council parcels
  service in BNG and a fake secured company service. **Not tested:** a real ArcGIS server, a real company portal's
  login, a real token, a MapServer export drawing a real map.

## 26 Nov 2026 (night): bring in a layer, after a run (plan item 1, first half; Rob: "it would be great if you could do 1")
- **The screen judges its checks with no tools.** The constraints screen is now one sealed judgement, like the desk
  study (`systemForScreen`, one call, no tools). Before, the analyst searched and fetched catalogue layers itself, out
  to the wider band, and brought in layers nobody asked for (Welsh layers at Stanlow, the digest of 18–24 Nov). Its
  searches are off in the product; `runScreening({ analystSearches: true })` keeps them for the tests of the evidence
  pipeline and for the lab. Not deleted: that's Rob's call.
- **ntr-screening 4.0-draft.** Steps: start from the checks, plan, flag, list the gaps, and name up to three things to
  look for (`look_for`: what, two or three title words, topic). The theme sections stay: they say what evidence
  matters, so the analyst can say what's missing. Tool-only rules went or were reworded.
- **After the run, code looks in the atlas for the gaps** (`js/bringin.js`, `offerFor`). In order: must-checks not
  checked, the analyst's look-fors, other checks not checked, topics with no check (where the topic has search words);
  at most 6, two wordings each, 12 s each. Left out: values read over the site (depth, elevation, traffic), the
  boundaries, OpenStreetMap kinds, and sources held for a licence decision (Natural Resources Wales). Searched over
  the site itself plus 500 m, not the wider band, so a layer is offered only if it covers the site. One layer per gap:
  its words in the title, fetchable, not a stand-in (centroids, labels), licences the person hasn't switched on left
  out (Esri, non-commercial), not a layer the run already read, the newest edition of a series (by the year in the
  title), then trusted and national publishers and open licences first. At most 4 offered. A search with a failed
  wording that found nothing is "didn't answer", not "found nothing".
- **The offer is in the reply code writes**, after the run's own lines: the layers with publisher and licence, then
  "Nothing is added unless you say so", then what the atlas had nothing for and what didn't answer. Buttons under the
  reply: one per layer, All of them, No thanks; a tap runs `bring_in_layers` with no model call. In words, the analyst
  calls the same tool (the project summary lists what's on offer, L1, L2…), and code writes the reply.
- **On a yes:** each layer is fetched with `get_data` for the run's place, held to the run's distances as the card now
  assesses them (inside only stays inside; a point adds its footprint). Features go on the record as role `added`
  (fid A1…, up to 200 a layer, nearest first) with dataset, publisher, licence and date, and show on the map with the
  run, marked "brought in after the run; not part of its judgement". The run card lists them apart. The decision and
  flags aren't re-judged: the reply says so. **For Rob:** whether a yes should also re-judge (a re-run that takes the
  added layers as checks) is the next choice here.
- **Search words in `catalogue/checks.json`** (`search`, 35 checks and 4 topics); without them the label is used.
- **Licences in a line:** the licence's own name where it's a known one (CC BY 4.0, Open Government Licence),
  otherwise the publisher's words cut to 60 characters. Display only: the class and the full text are unchanged.
- **Tested:** `npm test` (new `test/bringin.test.mjs`, 6; a sealed screen end to end in `ntrrun.test.mjs`); all 12
  browser checks on desktop and phone (`browser-run-card` now checks the screen's call has no tools, the offer's
  buttons sit under the reply, nothing is fetched before the yes, the button makes no model call, and the card lists
  what came in; `browser-search-area` and `browser-outofdate` take their evidence from the checks' own layers now).
  Live replays on the branch (runs 45731685148 and later): Oracle campus solar, Stanlow desk study, Rosebank.
- **Seen in the replays:** the Stanlow desk study was offered the Environment Agency's serious pollution incidents
  layer (the gap the atlas request is about; licence "Environment Agency Conditional Licence", classed stated). The
  Oracle campus (on land, 3 km from the Forth) was offered subsea pipelines: the sea checks on a coastal land site,
  plan item 2. "Surface water bodies failing good ecological status" was offered for surface water flooding; the
  search words are now "flooding from surface water" and "surface water flood".
- **Approximations:** title words decide relevance (a layer with the right words can still be the wrong thing: the
  person sees its title and publisher before saying yes); the newest edition is read from the year in the title;
  distances from a point site are from the point plus the footprint, not the footprint's edge. None of these changes
  the run's own answer; they change what's offered.

## 26 Nov 2026 (overnight): the handover sweep: tool results are data (plan item 1, first part; Rob: "Handover sweep")
- **What must always happen is in code.** The button tools (`offer_skills`, `ask_asset_type`, `offer_choices`) now end
  the turn through `runTurn`'s `finish` hook, so nothing runs or gets built until the person picks. They used to say
  "End your turn… don't screen until they pick" in their results. `finish` can now return `{ text, soft: true }`: the
  turn ends, but the model's own line from that step is kept; code's line ("Pick one above, or tell me in words…") is
  only the fallback. A run's reply in the same step still wins. The tool descriptions say to write any line in the same
  step as the call.
- **Facts stay in the results; how to report them moved out.** make_place (`next`, search-area wording, failed clues),
  the file tools (`next`, the needs-width and needs-decision messages), find_place (coordinates, grid references,
  "nothing found"), the EPSG tools (`note`, `decide`'s `why`, crs_lookup, `source_note`), find_data and get_data
  (`note`, `service_note`, `time_note`, around-site and licence notes) and the sealed screen's `dense` line now state
  facts only. New data fields where a rule needed one: make_place `role`/`role_why`/`shown_as`; use_file_features
  `confidence`/`why`; set_file_transformation `settled`, and `site_made`/`features_waiting` from the page;
  offer_choices `recommended_name`/`reason`.
- **Where the rules went:** the system prompt (coordinates read both ways → offer_choices; a grid reference or file
  needing a decision → coordinate-reference skill, ask, build nothing; dropped files; reporting time-aware layers,
  empty services, around-site areas and licences from get_data; buttons end the turn). Skills: place-finding 4.18
  (search areas, a search that finds nothing), ntr-screening 3.12-draft (busy areas, around-site, empty services,
  licences: the sealed screen reads these through `forAnalyst`), coordinate-reference 1.2-draft (`ask: true`, area of
  use, CRS search).
- **Kept:** error messages that name the right tool ("No place called X. Find or build the site first") are errors,
  not steering; left as they are. `get_place`'s `what_it_is` is a fact.
- **Guard:** `test/steering.test.mjs` (in `npm test`) scans the note-like fields of the tool files, the licence notes
  and the around-site note for words that steer ("tell the person", "say so", "end your turn"…). It fails on the old
  code with 20 hits. A word list, so it catches the usual phrasing, not every possible instruction.
- **Approximations that can change an answer:** none in code. The risk is behavioural: the model now gets reporting
  rules from the prompt and skills rather than at the moment of the result, so it may follow them less reliably (for
  example forgetting to say a layer is recent detections only). Checked with a live replay (below).
- **Tests:** `npm test`; all 12 browser checks (desktop and phone), served through a route wrapper because a local
  server couldn't be started; `browser-choice` and `browser-ux` now check the buttons end the turn with one model call
  (they had queued a second reply that leaked into the next turn). `reply-samples` prints the new fallback lines.
- **Live replays** (`try-requests` runs 45723004366 and 45723511252, on the branch `handover-sweep`): typed "12.5, 13.5"
  → both readings offered with offer_choices; the model wrote no line, so code's line was the reply, and the turn ended
  there (2 model rounds). Hotspots near Grangemouth: the reply still said "a 5-day window only, not a long record"
  with the time note now only a fact. Oracle campus: held for a confirm, then a solar screen ran with ntr-screening
  3.12-draft (8 flags, progress with targeted investigation). Not seen: the model chose `asset_type: other` and
  screen_site over ask_asset_type or offer_skills in both cases where they might fit (Oracle, Shell House), so the
  live button path is proven only for offer_choices. The Grangemouth reply offered "the older MODIS record for a
  longer history", which is wrong (FIRMS MODIS is recent too); not from this change.
- **Small fix from the replay:** the held reply said "0 ha" for Shell House (a 440 m² building). Under 1 ha it now gives
  m² (`runreply.js` `size`).

## 25 Nov 2026 (late night): no distance rings for a conversation search (Rob's Droves log)
- **Rob:** "Screen a 10 km² area between Swaffham and Castle Acre for the proposed Droves solar farm". While looking
  for the solar farm by type round Castle Acre (`find_features_near`), the page drew the default 1/5/20 km rings round
  Castle Acre, before any site was confirmed: they read as a screen on the wrong place. No screen ran.
- **Fix:** `addFindings` no longer draws rings. Rings are a run's bands and come only from its card. This also stops a
  search after a run from replacing the run's rings with defaults round the search point.
- **Test:** `browser-choice` (a search adds findings and no rings; fails on the old code with 3 rings).
- **Seen in the same log, not fixed:** the analyst searched "Droves solar farm" by name only, without `kind` and `area`,
  so the atlas wasn't asked; the Planning Inspectorate's outline of The Droves Solar Farm was found that way in an
  earlier session. It built a 10 km² square 3.1 km north of Swaffham, low confidence, and code asked before screening.

## 25 Nov 2026 (night): the handover from a run to the conversation, in code (plan item 1; Rob: "please proceed")
- **The reply after a run is written in code** (`js/runreply.js`): the decision and why, what was screened and how far,
  the three most serious flags with code's distances, what wasn't checked (musts first), and what changed from the run
  before. `runTurn` takes a `finish` hook: when `screen_site` or `run_study` returns a run, a hold or a refusal, the turn
  ends with code's reply and the model isn't asked to write one. The model answers follow-ups with `get_run`. The
  wording is in `scripts/reply-samples.mjs` (Rob saw it before it went live).
- **No instructions in the run tools' results.** The headline is data only (no `note`, no "say in a sentence"). The
  conversation can't load the desk study's or developable area's method (`sealedSkills` in `workspace.js`). The stale
  "developable area isn't available" line is gone. Other tools' `next` and `note` strings (make_place, the file tools,
  EPSG, find_data) still steer: the sweep is listed in the plan.
- **Flags cite evidence by id** (E7 from the tool output's `ref` or the checks' lines; a check id in brackets when the
  check found something). `traceResult` fills in name, distance, band, dataset, publisher, licence and date. A check
  that came back none found or not checked can't support a flag. **A flag with nothing traced isn't raised** (Rob's
  call: a gap line, not silence): it's kept in `not_raised` and shown in the gaps as "Not raised as a flag, because its
  evidence didn't trace…". Name matching after the fact (and its sea-value word lists) is gone. The skills ask for ids,
  and for risk words without distances, so the words and the number can't disagree: ntr-screening 3.11-draft,
  contamination-desk-study 0.3-draft.
- **Confirm and "which part?" in code.** `screen_site` and `run_study` hold a run when the place was built from words
  this turn and the person hasn't seen it, or when it isn't a site (`notASite` in `siterole.js`: a lake or water body,
  a country or administrative area, a town's point or outline, a road, railway or river; or anything over 2,500 km² on
  land unless its type names a licence, permit, lease, field or similar). Only places built straight on a found feature
  are asked about: a shape built round it, or drawn, typed or from a file, is already a choice. The request is kept in
  code (`pending`), listed in the project summary, merged into the next call for that place, and run exactly as asked
  by the place card's button with no model call ("Use all of it" for a which-part: Rob's call, a rough first look).
  The skills are offered in code when nothing was chosen. place-finding 4.17. The analyst is told to call the run as
  soon as the place exists, so the request is captured.
- **Reruns explain themselves** (`js/rundiff.js`): every new run of a skill on a place links to the last one, edited or
  not, and says what was asked differently, whether the site changed, which checks were or weren't reached, and the
  decision and flags by topic. When none of the asking, the site or the checks changed, it says the difference is the
  analyst's judgement. The card's re-run uses the same reply.
- **Approximations that can change an answer:** `notASite` reads the anchor's type words (Nominatim, Wikidata, OSM);
  an unusual type can slip through (asked about nothing) or catch a site (asked which part, and "Use all of it" runs it
  as before). The 2,500 km² threshold is a first cut. Dropping untraced flags removes flags the analyst would have
  raised from regional knowledge (the Shetland seabird case): they show as gap lines instead.
- **Tests:** `test/runreply.test.mjs` (new, 11), place tests for holds and `notASite`, ntrrun tests for ids, not raised
  and rerun links; browser checks: the study's reply is code's with no conversation call after it, the card's yes
  runs the held screen with no model call and the request intact, a lake gets "which part" and "Use all of it", the
  re-run reply says what changed. Scripted models cite ids through `scripts/scripted-refs.mjs`.

## 25 Nov 2026 (overnight): the developable area, an area budget with no model call (Rob asked)
- **What:** the developable area skill (0.1-draft) is ready: gross area, each deduction in hectares and share with
  its reason and source, the net developable area, soft constraints inside it, and what wasn't checked. Card, map,
  report and share link. Contract: `claude/skill-contracts.md` §2.
- **The tool:** `js/areabudget.js` `areaBudget(site, deductions)`. Features are clipped to the site's neighbourhood
  (a box, to narrow only), buffered with turf, then overlaid and measured in the site-centred Lambert azimuthal
  equal-area projection (`siterole.js` `laea`, plus a new inverse). Hard, then keep-clear, then avoided-by-default are
  taken off in order, each counted once against the first; soft constraints are measured on what's left and not taken
  off. Shapes come back as WGS84. Added `difference` to the vendored turf bundle (same package, one more export).
- **Rules in the skill:** the deductions, buffers per asset type (solar, BESS, onshore wind, warehouse, general) and
  reasons are a JSON block in `skills/developable-area/SKILL.md`; `js/developable.js` reads it and applies the
  person's own buffers, leave-outs and "count as soft". A test keeps the analyst's rule ids in `run_study` in step.
- **No model in the run.** The rules are written down and the geometry is code, so a model call would only add cost
  and a chance of error. The conversation agent picks the asset type and the person's changes, then writes two or
  three sentences from the headline (names and numbers only).
- **Each check looks only as far as its largest buffer** for the budget (homes 50 m for solar, not a screen's 500 m),
  always at local scale. New `used_by` field: checks for named skills only. Three new OpenStreetMap checks for the
  budget only (buildings, open water, watercourses); catalogue version 7, 62 checks.
- **OpenStreetMap:** each kind now asks Overpass only to its own reach (one query, a box per kind), so buildings on a
  site don't fetch a town; line and residential pieces folded into one row keep their other pieces' shapes (`parts`)
  for the budget. Counts are unchanged.
- **Defaults to look at (Rob):** homes solar 50 m, BESS 100 m, wind 500 m; listed buildings 50/50/250 m; power lines
  30 m; pipelines 10 m; watercourses 8 m (the EA permit distance, applied to all streams); roads and rail 15 m from the
  centre line; ancient woodland 15 m (standing advice). Flood Zone 3 is avoided by default; Flood Zone 2, surface water,
  BMV farmland (with unsplit grade 3 apart) and peat are soft. Slope is always "not checked".
- **Approximations that can change an answer (asked about in the handover, not parked):** OpenStreetMap relations
  (large lakes, some residential areas) come only as a centre point, so their area isn't counted (the card says how
  many); roads and rail are main roads only; buildings depend on OpenStreetMap's completeness; if Overpass hits its
  4,000-element cap the budget isn't told.
- **Tests:** `test/areabudget.test.mjs` (12: true areas, overlaps once, soft not taken off, not checked kept apart,
  holes and multipolygons, a 120 km designation in under 2 s); two ntrrun tests (an end-to-end budget near York with
  faked atlas and Overpass, the person's changes, a point and a search area refused); osmchecks per-kind boxes and
  parts. New browser check `scripts/browser-budget.mjs` (32 checks, desktop and phone, card, map, report);
  `browser-choice` updated (no "soon" chips left). `npm test`, and browser-budget, -study, -choice, -outofdate,
  -run-card and -ux pass. Not seen live.

## 24 Nov 2026 (late night): ask before restoring the last project (Rob)
- **Rob:** "old runs appear to be loaded when the website is loaded". It was the projects-in-the-browser restore,
  but run cards without their conversation read as stray old runs. Rob chose "ask first".
- **Now:** the page opens empty, with one line above the welcome card: "Pick up where you left off? <name>: n sites,
  m screens, last changed …", with Resume and Start new. On a phone the sheet opens so it's seen. Resume restores as
  before; Start new keeps the last project saved and listed under Sites and screens. Any new work before a choice
  counts as Start new, so the old project is never overwritten. Opening a project from the list restores it at once.
- **Tests:** `browser-outofdate`: the offer on reload with nothing restored, Resume brings the screens back, Start new
  stays empty and keeps the project listed. All ten browser checks pass.

## 24 Nov 2026 (late night): England's border strip; the site's own use as a source (Rob's Stanlow log)
- **Rob's log:** a contamination desk study of Stanlow refinery (Ellesmere Port) read only Wales's landfill, mining
  waste and source protection layers, so every source check was "not checked" and the decision fell to insufficient
  evidence. Rob: "a little disappointed".
- **Cause:** England's nation boxes (`catalogue/checks.json` `regions`, copied into each English source's
  `where_any`) left out the border strip west of 2.72°W and south of 53.3°N: the Wirral's south, Chester, Ellesmere
  Port, Shropshire's and Herefordshire's west. Natural England's layers still answered there through their own data
  extent; the contamination layers have none.
- **Fix:** a fifth England box, [-3.25, 51.6, -2.72, 53.3], in the regions and in all 30 copies. It overlaps Wales;
  that's safe, because an English layer answering nothing beside a Welsh source that's held back gives "not checked
  (partly)", never a clear none (`fromSources`). The real fix is nation outlines instead of boxes (small fixes).
- **The site's own use:** the run now says what the site was anchored on, with its type ("Stanlow Refinery, a
  landuse: industrial"), and the desk study skill (0.2-draft) treats an industrial site's own use as a potential source
  on site, even when no contamination layer covers it.
- **Still true after the fix:** England's permitted sites and pollution incidents are downloads only, so an operating
  refinery's own permit isn't read; the EA flood WFS timed out at 15 s for a 2.4 km² site (small fixes: timeouts).
- **Tests:** a checks test (Stanlow, Chester, Hereford and Oswestry ask England's layers; mid-Wales doesn't), which
  fails on the old boxes. All browser checks touched pass.

## 24 Nov 2026 (late night): the contamination desk study (first skill beyond the screen)
- **Rob:** "if you can build a contamination desk study, that would be great". Contract in `claude/skill-contracts.md`.
- **How it runs:** the profile's `skills_offered` entry (ready) names its skill file, its checks grouped as potential
  sources, pathways and receptors, its distances (0.25 / 0.5 / 2 km: local scale), its decision words and what a full
  desk study would add. `runScreening` takes a `study`: it runs only the study's checks, in code as for a screen, then
  asks once for the judgement with **no tools** (`systemForStudy`, `studyMessage`): the data is the checks, all measured
  in code, so the run is quicker, cheaper and repeatable. Alternative considered: let it search the atlas for extra
  local records, as the screen does; left out of v1 so results stay tied to the checks.
- **Output:** each plausible linkage is a finding (F-01…) with `linkage` {source, pathway, receptor, rating}, in the
  screen's JSON shape, so the map, slider, report, share link and download all work unchanged. The decision is the
  study's own (no linkages identified in open records; possible linkages: investigate; likely linkages: investigate
  before purchase or design; insufficient evidence), settled in code: every source check not checked, or none
  covering the place, means insufficient evidence (`settleStudy`).
- **Card and report:** the study's title, the linkage line under each finding, checks grouped by the study's groups
  (`checksView` reads `run.study.groups`), "what a full desk study would add" with the gaps, no re-assess button.
  The report's Method line says it's LCRM-shaped and open records only. The screen's Method line now names neutral
  topics, not IFC themes (missed in 3a).
- **Asking for it:** the study's chip is ready and fills the input; the analyst's new `run_study` tool (generic, so the
  next study needs no new tool) holds a place found from words this turn, as `screen_site` does, and refuses offshore.
- **Skill:** `skills/contamination-desk-study` 0.1-draft.
- **Tests:** an ntrrun test (only the study's checks, local scale, one call with no tools, a traced linkage, the
  groups, the settled decision); `scripts/browser-study.mjs` (new: chip, run, card, report, desktop and phone).
  All ten browser checks pass. Not run with the live model; no evaluation yet (example sites with published Phase 1
  reports are the plan).

## 24 Nov 2026 (night): a rejected proposal stays the analyst's; skills offered, not chosen (Rob's Perth log)
- **Rob's log (Shell House, Perth):** "site a sub station on that parcel", then "Not quite", "a rectangle not a
  triangle", then "Use this area". Two problems: the rejected outline stayed beside its replacement, and a screen ran
  though the person never asked for one.
- **Rejected proposals:** a place the analyst built from words is still its own while proposed *or* after the person
  said "Not quite" (status "revising"). Before, both `replaces` and `remove_place` refused it as the person's.
- **Skills offered, not chosen:** `screen_site` runs only when one of the person's messages asks for a screen or a
  judgement (screen, constraints, risks, issues, sensitivities, assess, due diligence, E&S, red flags; the screen
  chip and asset picks all say "screen"). Otherwise it returns `not_yet` and the analyst calls the new `offer_skills`
  tool, which shows the profile's skills as buttons; a ready one sends its request as the person's next message, a
  "soon" one explains. Judgement call: a word list is crude, but it fails safe (an unmatched request gets the buttons,
  one tap), and a tool result asking the model to ask wasn't enough before (Livingston).
- **Skill:** place-finding 4.16: saying what's planned isn't asking for a screen.
- **Tests:** place tests (rejected proposal replaced and removed; accepted one still refused; screen held until asked,
  then run for the chip, a pick and plain words). `browser-choice`: the skills as buttons, the screen button sends a
  screen request. All nine browser checks pass. Not tested with the live model.

## 24 Nov 2026 (night): skill contracts and the skill chips (plan item 3b)
- **Contracts:** `claude/skill-contracts.md` in the project. The contamination desk study (LCRM in the UK, an
  ASTM-style records review in the US; sources, pathways, receptors; no new tool) and developable area (an area budget;
  one new deterministic tool, `area_budget`; slope not checked yet). Neither needs a new noun; frameworks barely touch
  either, so step 3c stays small.
- **Chips (Rob: "start seeing some skills as chips"):** the profile's `skills_offered` lists the skills. The screen
  runs; the two contracted skills show as dashed chips with a visible "soon" tag. A tap says in one line what the skill
  will do and that it isn't built yet, with no model call. Developable area is hidden for points (`roles`). Hiding the
  contamination chip at sea waits until the skill is built (it needs the async onshore test).
- **Tests:** `browser-choice` (chips shown, a soon chip explains with no model call, hidden for a point). Phone
  screenshot looked at: the row scrolls sideways. This brings back "soon" chips, which Rob removed on 18 Nov for a quieter composer; they show only once there is a place, as before.

## 24 Nov 2026 (night): the neutral topics on flags, the map and the report (plan item 3a)
- **What:** the six IFC-based themes are gone from code. Flags, map features, the legend, popups and the report use
  the thirteen topics in `catalogue/checks.json`; `js/findings.js` holds their colours and short names, and a test
  keeps its names in step with the catalogue.
- **Colours (judgement call):** a map puts every colour beside every other, and the dataviz validator passes no set
  of more than three hues on all pairs. So the topics share six colours, today's five hues plus grey, and the legend,
  labels and tap details carry the name: green biodiversity and landscape; blue water; ochre ground, land use,
  hazards, air; magenta heritage; violet community and health, Indigenous Peoples; grey material assets, topography,
  context. Orange was tried for ground and dropped: against green it was worse for red-green colour blindness (CVD
  ΔE 3.2) than anything on today's map. Worst pair is unchanged (blue and violet, CVD 4.5).
- **Old records keep working:** a feature's or flag's `theme` field now holds a topic id; the field name stays so old
  share links and saved projects read. `topicOf` reads the six old themes and PS codes as topics (land → land use,
  community → community and health, PS4–PS8). Old IFC "community" pipelines therefore read as community and health.
- **Moved topic:** vessel traffic and fishing now sit under material assets (other users of the sea), not community or
  land and livelihoods. Rivers sit under water.
- **Skill:** ntr-screening 3.10-draft tags flags and fetches with a topic id; its evidence sections stay by PS theme
  until the skill split (item 5). Tool enums list the topic ids.
- **Lost for now:** the "(PS4)" codes on flags and in the report. IFC comes back as a framework choice in 3c.
- **Tests:** topic names match the catalogue; old themes and PS codes read as topics with the right colours; at most
  six colours; flags read a topic. All browser checks pass (the run-card check now expects the old record's pipeline
  as community and health).

## 24 Nov 2026 (night): a place found from words is shown before it's screened
- **Rob:** "screen a warehouse location in Livingston" found Livingston and went straight into the screen. It should
  stop and ask whether the place is right first.
- **In code** (`screen_site` in `js/placetools.js`): a place `make_place` built from words in the current turn, still
  a proposal, isn't screened. The tool returns `not_yet` and tells the analyst to show the place (anchor, size,
  confidence, search area or not), ask, keep what was asked for and screen once the person confirms. The page calls
  `tools.newTurn()` for each message, so a typed "yes", the card's "Use this area" or an asset-type pick all go ahead.
  A code guard rather than only a prompt line, because the make_place result already said "ask the person" and Haiku
  went past it when the request also asked for a screen.
- **Exempt:** typed or transformed coordinates, drawn shapes and site files: they're the person's own definition.
  (Judgement call: an authoritative match, e.g. a published red line found by name, is still asked about.)
- **Skill:** place-finding 4.15, step 5 says the same, so the method holds outside this page.
- **Tests:** `places.test.mjs` (held, then screened next turn, accepted, typed coordinates, drawn);
  `browser-choice.mjs` (the Livingston message: no run card, `not_yet` to the analyst, "Not screened yet" in the
  working-out). Both fail on the old code.

## 24 Nov 2026 (late evening): Rob's licence calls: Crown Estate, contamination, radon, lidar and bathymetry
- **Rob:** The Crown Estate's wind licence is fine; contamination on by default (the atlas checked the EA licence);
  radon OK; lidar where it exists, and bathymetry.
- **Crown Estate:** The Crown Estate's records now say "Open Data Licence (GIS) v1.1 (accepted for use, Rob)". More
  agreements from both Crown Estates: ScotWind offers and INTOG areas, Round 5 project development areas (wind
  leases); The Crown Estate's wind cable agreements and Crown Estate Scotland's cables (cables); a new check, subsea
  pipelines and pipeline agreements (Crown Estate Scotland, The Crown Estate's gas storage pipelines; NSTA pending).
- **Contamination, on by default** (catalogue version 6; the reply in `claude/contamination-tobler-reply.md`):
  landfill (EA historic and authorised, under the EA Conditional Licence as accepted: names and dates only), closed
  mining waste (EA, NRW), council records (Derby, Lambeth, Sheffield, Clackmannanshire: the check applies only inside
  those councils), Northern Ireland's past land use, permitted sites (SEPA, filtered to industrial, waste and
  radioactive), water pollution incidents (DAERA), and the US EPA layers (Superfund, other cleanup and hazardous waste
  sites, toxic release and major air sources, major water discharges). None is a must-check.
- **Natural Resources Wales held back:** NRW says it doesn't grant re-use of its full landfill and permit data, so
  Wales shows "not checked" for those, with the reason, until Rob decides. (Its closed mining waste is OGL and used.)
- **Partial sources** (`partial` on a source; the atlas's completeness "partial"): their silence never reads as a clear
  none. Only partial records answering nothing: "none found … in the records read (…); the records are partial, so
  this isn't a clear answer". Beside a complete source: "none found … (partial records: …)".
- **Caveat** (`caveat` on a check): "An early screen of open records, not a contaminated land report. If anything here
  matters, the next step is a full environmental search." Shown once in the Checks section on the card and in the
  report whenever a check carrying it ran.
- **Radon:** a classes check on the site (UKHSA 1 km grid, classes 1 to 6 by share of homes at the Action Level).
- **Elevation:** sources now carry `where` and `serves` (land or sea). Order: England's 1 m lidar DTM (EA image
  service, ODN), USGS 3DEP (NAVD 88), EMODnet bathymetry at sea (the EEA's image service, ~230 m, elevations; datum
  not stated, EMODnet's DTM is to LAT), then NOAA's mosaic. A lidar gap falls through and the record lists the finer
  sources tried. Cell size is read in metres where the service reports metres. `get_elevation` tries land sources,
  then sea sources when the place reads as all seabed. **Not yet:** Scotland's lidar (WMS and cloud GeoTIFFs only),
  Australia's 5 m DEM (a map service, not an image service), AHN (WCS); each needs another reader.
- **Tested:** `npm test` (new tests: partial sources and the caveat; source choice by place and setting, lidar gap
  fall-through, cell size in metres; the run test now finds every topic checked on an English site, permitted sites
  honestly not checked in England); browser checks all pass (run card 163, out of date 46 with the caveat shown once on
  an onshore card, search area 46, site files 44, ux 26, epsg 20, coords 18, cards 14, choice 8). **Not tested live:**
  any new layer or elevation service from the page (CORS on the EA, USGS and EEA image services is unknown; a refusal
  falls through to NOAA and is listed as tried).

## 24 Nov 2026 (night): the coverage drive, first batch (Rob: "fill the gaps… as complete as possible")
- **Audit:** `claude/coverage-audit-2026-11-24.md` in the project: the twelve topics by market, what the atlas
  already holds (searched in its crawl results), what's waiting on Rob, and what to ask the atlas for.
- **OpenStreetMap as a check source** (`js/osmchecks.js`): one Overpass query per run for every OpenStreetMap kind
  any applying check asks for (through the gazetteer's servers and fallbacks), each feature measured from the site's
  edge and handed back in the same shape as an atlas layer's answer, so counting, bands, lists and the map are
  unchanged. Roads, railways, power lines and homes come in pieces: one row per name, at its nearest piece. Never a
  must-check (completeness varies; the source title says so; a test enforces it). Licence ODbL 1.0, already used by
  the gazetteer. When Overpass doesn't answer, every OpenStreetMap check is "not checked", with the reason.
- **New checks (catalogue version 5, 47 checks):**
  - material assets, everywhere on land (OpenStreetMap): power lines, substations, pipelines, main roads, railways,
    aerodromes (also on the coast), existing wind turbines (also at sea);
  - community and health (OpenStreetMap): nearest homes, schools and nurseries, hospitals, clinics and care homes;
  - hazards: coal development high risk area (GB, OGL; Northern Ireland pending), active faults (GEM, CC BY 4.0, world);
  - water: groundwater source protection zones by zone (England, Wales; Scotland and NI pending);
  - material assets at sea: offshore installations and offshore wind farms (EMODnet, Europe), wind leases (Crown
    Estate Scotland, OGL; The Crown Estate for England, Wales and NI, licence written as "check its terms before
    commercial use" until Rob decides), subsea telecom cables (UK; UK power cables pending);
  - Indigenous territories (Native Land Digital, CC0, indicative): only in the Americas, Australia and New Zealand,
    where it has coverage, so it never answers "none" for land it doesn't map.
- **Reach values** are first cuts with their reasons in `reach_why`, to tune on the example sites (plan item 6).
- **Only air and climate** now has no check on a UK site. The plan's Dogger Bank must-checks (item 1c) are now
  checks, but not yet must: `must` is per check, not per asset type, so making them must for offshore wind needs a
  per-asset rule; Rob's call with item 3.
- **Waiting on Rob** (in the audit): contamination (landfill under the EA Conditional Licence, and the rest), radon
  (licence not settled), coal low risk area (licence not specified), The Crown Estate's licence, elevation sources.
- **Atlas requests** (`docs/atlas-requests.md`, 24 Nov evening): UK transmission lines, NSTA pipelines, UK power
  cables, BGS hazards as features, NCERM, AQMAs, peat, elevation services, and national packs for the US, the
  Netherlands and Australia.
- **Tested:** `npm test` (new `test/osmchecks.test.mjs`; the catalogue test checks OpenStreetMap sources are known
  kinds and never must; the run test checks the new checks run on an English site and that only air and climate has
  no check); browser checks all pass (run card 163, out of date 44, search area 46, site files 44, ux 26, cards 14).
  **Not tested:** any of the new layers live (the build workspace can't reach the atlas or Overpass): the field names
  for the curated records come from the atlas's own record notes, and the EMODnet layers' name fields are unknown (the
  data tool's usual name guess applies). Rob's next live screen is the first real test.

## 24 Nov 2026 (evening): sites and screens, and projects kept in the browser (plan item 8, first steps; Rob)
- **Rob:** managing runs should feel like the folders of a desktop GIS project, but discreet and intuitive.
- **Sites and screens** (`js/sitetree.js`): a closed strip under the header ("Sites and screens · 1 site · 2 screens"),
  shown once there's a place. Open, it's a short tree: each site with its size, and under it its screens, newest
  first, each with id, time and state (flags and decision; "Out of date: site edited" or "Replaced by R2" first,
  dimmed). The one on the map is marked. A site row flies to it and lights its card; a screen row puts it on the map
  and scrolls to its card. A suggestion the person hasn't taken up isn't listed unless it's been screened. A deleted
  site's screens stay listed under "<name> (removed)".
- **Projects kept in this browser** (`js/projectstore.js`, IndexedDB): places (with their ids, so runs still point
  at them) and run records, saved a moment after any change. On reload they come back: places redrawn, run cards
  rebuilt from their records, out-of-date states worked out again, the map on the newest screen, and a note
  ("Picked up where you left off: 1 site and 2 screens, kept in this browser."). The conversation text isn't kept;
  the analyst carries on from the project summary as it always does. Run numbering carries on after the restored
  runs (`createScreening().restore`), so ids never repeat. "Start a new project" keeps the current one; the strip
  lists earlier projects to open again. Nothing leaves the browser (invariant 7).
- **Not built yet (asked first, as it deletes):** deleting a saved project. **Not yet:** the consultant's
  overrides in the project (reach, checks on or off, framework), a name the person gives the project (it's named
  after its first site), and a setting to not keep projects on a shared computer.
- **Tested:** `npm test` (new `test/sitetree.test.mjs`); `browser-outofdate` 44/44 on desktop and phone, with new
  checks for the tree (run under its site, replaced marked, picking a run), a reload bringing the project back, a
  new project starting empty, and reopening the earlier one; all other browser checks pass. **Not tested:** a real
  browser over days (storage limits, a private window, where IndexedDB may be refused: the page then just doesn't
  keep the project).

## 24 Nov 2026 (afternoon): a run on a detailed red line froze the page; the feature lists (Rob's Mallard Pass screen)
- **What happened:** Rob screened the Mallard Pass solar DCO boundary (EN010127: 4 parts, 28 holes, 4,688
  vertices). The run took over 1,000 s with "page unresponsive" warnings. Cause: every fetched feature was measured
  against the site with `geometryDistanceKm`, up to 400 sampled vertices each way, each against every site edge, with
  the site's outline rebuilt for every vertex. About 90 ms a small polygon and 4.3 s a large zone (an Impact Risk
  Zone) on that site, on the main thread, for thousands of features.
- **Now:** `js/nearness.js`. The site is prepared once (projected with the existing local equal-area projection,
  `laea` in `js/siterole.js`; its edges in a bounding-box tree); each feature is tested for crossing, containment
  (even-odd, so a feature in a hole is outside) and then its nearest pair, which is measured with turf (geodesic), so
  invariant 2 holds. `geometryDistanceKm` uses it and keeps the old measure for shapes it can't take (wider than
  60° by 30°, or across the antimeridian). On the Mallard Pass boundary: polygons 2 ms (was 82), lines 1 ms (was 66),
  points 0.2 ms (was 2.2), a large zone 2 km off 27 ms (was 4,317). Agrees with an exhaustive geodesic measure to
  0.03%; never more than 0.1% above the old measure (which overstated by up to 94 m, from sampling); the same
  on-site/off-site calls on 600 random shapes.
- **Also:** country lookups for the place card use the same test (`js/reference.js`; `countrySplit` no longer runs
  the intersect twice): `describe` 690 ms → 117 ms on that site. The drop's longest main-thread freeze in a browser
  went from 0.8 s to 0.16 s.
- **Found on the way:** `edgeDistanceKm` (point to feature) failed on any polygon with holes (turf gives it as a
  MultiLineString), so such features went unmeasured. Fixed: every ring is measured.
- **Not done:** moving the measuring to a Web Worker. With the new measure a whole run's measuring should be seconds;
  revisit if a live run still stalls. `coverageIn` (share of a site a class polygon covers, turf intersect) is still
  ~30 ms a feature on that site; it runs only for class layers' on-site features.
- **Lists (Rob):** rows lead with the distance in bold; a list from one layer names it once above the rows ("From …"),
  a mixed list names the layer on each row without the publisher in brackets (the popup keeps it); a name the same
  as the layer isn't repeated; same-name features from one layer are one row ("2 parts", at the nearest part).
- **"Show these on the map" (Rob: didn't seem to work):** it did run, but the set was already on the map, the zoom
  didn't change and the highlight was a faint line under the findings' own. Now it picks out the set and fades every
  other finding until "Show all findings", the list closing, Clear, or another run; the fit leaves out wide areas the
  site lies within.
- **GeoJSON coordinates (Rob):** a GeoJSON with longitude and latitude and no `crs` is WGS 84 by its standard (RFC
  7946): no longer called assumed or told to add a .prj. Old-style GeoJSON in grid numbers is still a guess; its fix
  is to re-save as WGS 84 GeoJSON.
- **Tested:** `npm test` (new `test/nearness.test.mjs`: holes, parts, touching, containment, exhaustive comparison;
  fileimport test for the GeoJSON wording, which fails on the old code); all browser checks pass (run card 163 with
  new checks for the list layout and the fade, site files 44, search area 46, out of date 28, ux 26, epsg 20,
  coords 18, cards 14, choice 8); Rob's file dropped in a headless browser, timed before and after. The Mallard Pass
  file is not in the repo (licence not checked); the tests use a synthetic site with holes. **Not tested:** a full
  live screen on asktobler.com (services can't be reached from the build workspace); the phone with a real file.

## 23 Nov 2026 (late): typed grid references go through the EPSG registry (Rob: "move to the registry")
- **Before:** `js/coords.js` converted British National Grid references to WGS84 with a hard-coded OSGB36 Helmert
  shift (about 5 m). That was a known breach of invariant 1.
- **Now:** `js/coords.js` does the projection only (grid to OSGB36 latitude and longitude) and returns the eastings and
  northings. `js/placetools.js` converts each grid reference once, before any tool runs: `fileGeodesy.plan` picks
  the transformation from the registry for where it is (EPSG:1314, 2 m, across Britain) and `js/transform.js`
  applies it. The candidate is named after what was typed ("NT 002 774") and records the transformation.
- **Judgement and failure:** if only grid-file transformations cover it, there's no candidate and `find_place` says a
  decision is needed (coordinate-reference skill). If the registry can't be reached, the built-in shift from
  `js/fileimport.js` (the one remaining known breach) is used, and the candidate says so. The unshifted position is
  never used.
- **The analyst's note** for a typed grid reference now gives the eastings and northings, not a provisional
  latitude and longitude.
- `transform` won't take an already-converted grid candidate as raw numbers, so it can't be shifted twice.
- Tested: `npm test` (coords test now checks the projection against the OS worked example's OSGB36 values; new
  fileimport test for registry, fallback and decision cases); `browser-coords` 18/18 with a grid reference placed
  within 5e-5° of an independent proj4 value; all other browser checks pass. `js/coords.js` is off the known-breach
  list. **Not tested:** the live registry from the real page.

## 23 Nov 2026 (night): invariants, CLAUDE.md and their tests (Rob: "how do you build applications with intent?")
- **Why:** principles written only as prose drift. The site-file table on 23 Nov was a reasonable-looking shortcut
  that bent "one way for geodesy" without asking.
- **What:** `CLAUDE.md` (loaded at the start of every build session) lists nine invariants and when to ask Rob first.
  `test/invariants.test.mjs` (in `npm test`) checks five of them: one way for geodesy, no geometry for the model
  (tool inputs and the summaries it reads), no CDN, files stay in the browser, one model setting. Each check was
  shown to fail when broken on purpose.
- **Known breaches, for Rob to decide** (listed in the test's `KNOWN`, which must shrink when they're fixed):
  `js/coords.js` (typed BNG references use a hard-coded OSGB36 shift, since 20 Nov); `js/fileimport.js` (built-in
  fallback shifts when the registry is down); `lab.html` and `tools.html` (load MapLibre from unpkg; moving to the lab).
- **Registry timing:** not measurable from the build environment. The site-file card now shows the time and number of
  registry lookups for each drop. The live registry lists 9 OSGB36 and 37 ED50 transformations to WGS 84, so a first
  ED50 drop makes about 90 lookups. Options for a local copy are in `claude/epsg-local-copy-proposal.md`.

## 23 Nov 2026 (later): site files choose transformations from the EPSG registry (Rob: "go ahead")
- **Why:** the first version used a small built-in table, so Tobler had two ways of choosing a datum transformation,
  and the file way skipped the coordinate-reference skill's rules. Now files go the same way as typed coordinates.
- **How:** the .prj gives an EPSG code (its own AUTHORITY/ID, a well-known Esri name, or an exact name match in the
  registry). proj4 does the projection only, onto the file's own datum. `transformation_options` (now also callable
  with a position) picks the transformation for where the data is, and `prepareOperation` (shared with `transform`)
  applies it with `js/transform.js`. WGS 84-based CRSs need nothing. Only the EPSG code and record paths go to the
  Worker; the file and its coordinates stay in the browser.
- **The analyst only for judgements:** when the best applicable option is worse than 25 m, only grid files cover the
  site, or the CRS can't be matched to an EPSG code, the layer waits. The page sends "I've dropped <file>" with a note
  telling the analyst to load the coordinate-reference skill and ask one question; the answer is applied with the
  new `set_file_transformation` tool (an EPSG code, or "none", which is flagged). Until then the features show on the
  map with the built-in conversion but can't be used.
- **Fallback:** if the registry can't be reached, the built-in shifts are used and the card says so.
- **Seen in tests:** BNG at Linlithgow gets EPSG:1314 (2 m; OSTN15 is better but needs a grid file). ED50 in the
  North Sea gets EPSG:1311 (1 m) instead of the general 1133 (10 m); at the test block the two differ by 1.8 m, so the
  gain is mostly in the stated accuracy and the record, not a big shift. ETRS89 gets EPSG:1149.
- Tested: `npm test` (7 new fileimport tests, fake registry extended with ED50, ETRS89 and UTM records);
  `browser-sitefile` 44/44 (adds the registry choice on the card and an unmatched datum settled in words); all other
  browser checks pass. **Not tested:** the live registry with real files; the live analyst putting the question.

## 23 Nov 2026: site boundaries from the person's own files (Rob asked to fast-track it)
- **Why:** to test Tobler against EIA sites using the red-line boundaries published with them (it also unblocks the
  "site boundaries" part of the example-site evaluation).
- **What it is (Rob):** a way to define the site, not a data layer. The person picks features from the file; they're
  copied into places (WGS84) and the file is forgotten. Nothing is uploaded or kept: it's read in the browser, and
  the vendored reader (`js/vendor/fileread.js`: shpjs, proj4, fflate; 150 KB) loads only when a file arrives.
- **How files arrive:** dropped anywhere on the page (a folder, loose files together, or a .zip), or picked with the
  new file button in the drawing tray (the way on a phone). A browser can't fetch a .shp's neighbours, so the .dbf
  and .prj must come in the same drop. .shx isn't needed. GeoJSON too, including the old `crs` member for common codes.
- **Coordinates:** from the .prj with proj4. British National Grid and Irish Grid get proj4's 7-parameter shifts
  (BNG checked against Tobler's own OSGB36 maths, under 1 m). ED50 gets EPSG's general shift (1133, about 10 m),
  applied with `js/transform.js`; North Sea work may need a regional one, and the card says so. ETRS89/GRS80 data is
  treated as WGS84. An unrecognised datum is converted with no shift and flagged in amber. No .prj: lon/lat or BNG is
  guessed from the numbers and the guess is said; anything else is refused with a reason. *My call:* this uses a small
  built-in table rather than the live EPSG registry the typed-coordinate tools use, to keep the drop instant and
  offline; revisit if non-UK files need it.
- **Picking:** one polygon is the site at once. Otherwise a card lists the features (by a name-like field) and the map
  shows them; tick or tap to pick. Several picked: "one site in parts" (a multi-part place) or "separate sites".
  Points and lines need a width (1, 30 or 100 m, or typed; 0.5 m to 50 km), buffered in metres on the ground.
  The analyst can also pick in words with `use_file_features`; it sees labels and sizes, never coordinates, and
  asks for a width rather than choosing one.
- **Roles and provenance:** polygons are a footprint (high confidence, like a drawn outline); buffered points and
  lines are an area. `origin.method: "file"` keeps the file name, feature labels, the coordinate conversion, any
  width and any simplification (outlines over 5,000 corners are simplified, with the shift said). Holes are filled,
  as for other places. The run record's "how it was found" and the report carry it.
- Tested: `npm test` (12 new tests in `test/fileimport.test.mjs`, fixtures built by `test/fixtures/import/make.py`);
  new `scripts/browser-sitefile.mjs` 38/38 (desktop and phone: zip, dropped loose files, guessed CRS, parts,
  corridor width, picking in words, an orphan .dbf, nothing uploaded); the other browser checks all pass.
  **Not tested:** dragging a real folder from a file manager (can't be simulated headless); a real phone's file
  picker; a real EIA download; the live Haiku analyst with `use_file_features`.

## 22 Nov 2026: out-of-date runs ("energy is done" item 2; Rob chose it as next)
- **What makes a run out of date:** its place's outline no longer matches the one it was screened on (compared to
  about a centimetre, the 7-decimal rounding edits use). Any edit counts: a drag on the map, the card's rotate or
  resize, or the analyst's `edit_place`. Moving it back clears it. Deleting the place marks its runs too, with no re-run.
- **On the card:** a strip under the setup line ("Out of date: the site was edited after this screen (moved 0.6 km
  east). The findings are for the earlier outline.") and "Re-run on the edited site". Flags and decision dimmed.
  No error red: nothing failed.
- **Re-run (my call):** a new run beside the old one (R2 replaces R1), never overwriting, so they can be compared. The
  card's button repeats the request in code with the same asset type, stage, capacity, tip height, focus, extent and
  any distances the person set; default distances are worked out again, since they follow the site's size. No model
  call decides it; it still costs a screen, with the usual progress block, and a one-line result in the conversation.
- **The analyst:** the project summary lists every run and which are out of date or replaced. When the analyst
  screens an edited place itself, the new run is linked to the out-of-date one the same way, and the headline asks it
  to say what changed. `get_run` says when a run was replaced.
- **Report and share link:** carry `out_of_date` and `replaces`; a report made after the edit says so first.
- **Run record:** `inputs`, `replaces {run, why}`, `replaced_by`, `out_of_date {noted_at, change, replaced_by}`.
- Tested: `npm test` (two new ntrrun tests); new `scripts/browser-outofdate.mjs` 28/28 (desktop and phone); other
  browser checks pass (run-card 109, search-area 30, ux 26, choice 8, coords 12, epsg 20). Haiku replay on branch
  `outofdate` (Évora solar → "make the site 2 km²" → "is the screen still right?"): the analyst saw R1 was out of date,
  re-ran (R2 replaces R1, "area 1 → 2 km²") and compared them; asked to screen again, it said R2 was current.
  **Seen:** it re-ran without asking first. **Not tested:** a drag on the real map by hand; a real phone; live.

## 20 Nov 2026 (late night, later): datum transformations simple and largely hidden (Rob)
- Rob: for Tobler, transformations should be simple and mostly out of sight; reasonable accuracy is enough. The GIGS
  work moves to its own workstream.
- **Removed:** the "Ask me" / "Choose for me" setting. Transformations are always chosen for the person
  (`transformationChoice` returns "choose"); the tools still ask when the best option that can be applied is worse
  than 25 m. The tools keep their "ask" path (the skill is portable), but nothing in the page selects it.
- **Quieter:** the analyst moves coordinates in another datum quietly and says it in one line ("Read as ED50; moved to
  WGS 84, about 118 m (EPSG:1311)"); no option lists or datum explanations unless asked. The full record stays in the
  tool result, the place and the log. Prompt, `transform`'s note and the skill's "Talking to the person" say so.
- **Dropped from Tobler's plan:** grid transformations (OSTN15, NTv2), other projected grids, Molodensky against GIGS.
  Kept: the GIGS check Action as a cheap regression test (GIGS data stays out of the repo).
- Tested: `npm test`; `browser-epsg.mjs` 20/20 (no datum setting, 1314 chosen, the ED50 well moved and placed),
  `browser-run-card.mjs` 109/109, `browser-coords.mjs` no failures.

## 20 Nov 2026 (late night): the `transform` tool applies the chosen transformation (Rob)
- **Why:** `transformation_options` could choose an operation but nothing could apply it, so the analyst couldn't say
  how far a point moved, and once said 1314 "was applied" when it had only been chosen.
- **Built:** `js/transform.js` (pure maths, nothing copied from EPSG): geographic ↔ geocentric, geocentric
  translations (9603, 1035, 1031), Position Vector (9606, 1037, 1033), Coordinate Frame (9607, 1038, 1032),
  Molodensky and abridged Molodensky (9604, 9605). The `transform` tool (`js/epsgtools.js`) reads the operation's
  record, its parameters and their units (the registry's own `Unit` records), the source and target datums'
  ellipsoids (`GeodeticCoordRefSystem` → `Datum` → `Ellipsoid`) and the dataset version (`VersionHistory`, today
  13.106), then applies it forward or in reverse as the CRSs ask. It returns the moved coordinates, how far each moved,
  points outside the operation's area of use, and a record (operation code, name, accuracy, direction, EPSG version).
  Each moved point becomes a candidate, so `make_place` puts it on the map and the place keeps the transformation.
- **Only the person's own numbers:** `transform` takes a typed-coordinates candidate or numbers; a place already on
  the map (WGS 84) is refused, so nothing is shifted twice. Grid methods, a non-Greenwich prime meridian, unknown
  units and projected numbers are refused with a reason.
- **Reverse direction:** the exact inverse (X = R⁻¹(X' − T)/M), not EPSG's sign change. Both are within GIGS's
  tolerances on the reverse points (sign change fits GIGS's printed values slightly better: worst 2.0 cm vs 3.3 cm,
  the tolerance being 3.3 cm), but only the exact inverse round-trips: the sign change is about 1.5 cm off for 1314
  (its scale is 20 ppm), above GIGS's 6 mm round-trip tolerance. My call; one function to change.
- **Wording:** `transformation_options` says a chosen operation is "chosen, not yet applied" and names `transform`;
  the conversation prompt and the skill (1.1-draft, "Chosen is not applied") say "applied" only after `transform`.
- **Worker:** `/epsg` now also serves `Datum`, `DatumEnsemble`, `Ellipsoid`, `PrimeMeridian`, `Unit` records and the
  `VersionHistory` list (read-only, same cache and limit).
- **Tested:** `test/transform.test.mjs` (maths against PROJ 9 values computed independently: 1314, 15929, 1311 forward
  and reverse, Molodensky; the tool against the fake registry); Worker tests 17/17; `browser-epsg.mjs` 28/28 (an ED50
  well typed in the chat, moved 117.6 m by 1311 and placed, desktop and phone). **GIGS 5203 and 5204**
  (`scripts/gigs-check.mjs`, Action "GIGS check"): all 82 points (2D and 3D, forward and reverse) within GIGS's
  tolerances, with the parameters from GIGS's own objects and from the live registry through the tool; the 3D round
  trips come back exact. One 2D round trip (5203-01, at 80° N, 150° E) is 1.5 cm off against a 6 mm tolerance: a 2D
  method drops the height on the way (the point is 172 m above the OSGB36 ellipsoid there), which any 2D implementation
  does; reported, not hidden. Longitude differences are scaled by cos(latitude) so GIGS's 0.0000003° means about 3 cm
  everywhere; unscaled, PROJ misses it at ±70° too.
- **GIGS licence:** the dataset is cloned into the runner's temp folder by the Action; nothing from it is in this
  repo, and only differences are printed. IOGP acknowledged in the script.
- **Live checks (branch `transform`):** the branch's own `transform.js` and `epsgtools.js`, run in a browser against
  the live registry (EPSG 13.106) and IOGP's GIGS files: all 28 2D points of 5203 and 5204 within tolerance (worst
  2.1 and 2.7 cm against 3.3 cm), every one rightly flagged outside the operation's area of use (GIGS points are
  synthetic and global). Haiku replays (`try-requests`, registry read directly where the deployed Worker doesn't yet
  serve the new paths): the ED50 well question → 1311 chosen, applied, "moves about 118 m (117.6 m)", 1 m, EPSG 13.106;
  "put it on the map" → placed from the transformed candidate. Linlithgow: 1314 described as chosen, "I haven't
  applied it to any data yet". **Seen, not fixed:** on the second turn the analyst didn't know the first turn had run
  `transform` (tool results aren't replayed) and wrongly apologised for quoting figures before running it; the
  project summary could list transformed candidates.

## 20 Nov 2026 (late evening): coordinates typed into the chat are a place (Rob)
- **Why:** Rob typed "55.522759, -5.650122". `find_place` sent it to the name searches, Nominatim returned the Argyll
  and Bute county centre about 100 km away, `make_place` was refused, and the analyst told him to drop the pin himself.
  Rob wanted the chat to be the way in.
- **Built:** `js/coords.js` reads coordinates in code: decimal degrees (with or without hemisphere letters; labelled
  "lat … lon …" or "x= y="), degrees-minutes-seconds and degrees with decimal minutes, British National Grid
  references (letters, 2–10 digits, the centre of the square they describe) and eastings and northings (six figures, or
  labelled E/N). Grid positions go OSGB36 → WGS84 by inverse Transverse Mercator and the Helmert transformation EPSG:1314
  (OSGB36 to WGS 84 (6), stated accuracy 2 m); the OS worked example (TG 51409 13177) comes out within centimetres of
  the published WGS84 position. Plain numbers with a unit ("1.5, 2.5 km") or short unlabelled numbers aren't read.
- `find_place` returns typed coordinates as a candidate ("coordinates you typed", exactly as typed, not rounded), with
  how they were read and the settlement nearby (Nominatim reverse), and doesn't name-search them. `make_place` takes
  coordinates as an anchor too. The page (and `try-requests`) adds a line for the analyst saying how it read them.
- **Order:** two numbers that could both be latitudes are read latitude first, unless land and sea tell them apart (read
  the usual way it's at sea, the other way on land: the land one, said); if both are plausible, both go back and the
  analyst offers them as choices on the map.
- Analyst rule: coordinates are a place; a message that is only coordinates is a point there, then "what's planned?";
  never tell the person to drop the pin themselves. Input hint: "Where should we look? A place, an area or coordinates".
- Tested: `test/coords.test.mjs` (new), places tests (find_place, make_place, order), `scripts/browser-coords.mjs` 12/12
  (new, desktop and phone), existing browser checks no failures; Haiku replays on branch `coords`: bare decimal → point
  at once, high; a 2 km² square centred on coordinates screened for onshore wind; "1 km circle round NR 6853 2836";
  DMS then "what is it near?" (11 km NNW of Campbeltown); longitude-first → Kintyre; "12.5, 13.5" → two pins offered.
- **Not done:** other datums typed as latitude and longitude (ED50, OSGB36 lat/lon, NAD27) are assumed WGS84 and say
  so; that, and grid systems beyond the British National Grid, wait for the coordinate reference skill and its EPSG tools.

## 20 Nov 2026 (evening): site footprint vs search area (Rob: "please action")
- **Why:** Rob's Cnoc Buidhe screen. No outline was found, so `make_place` built a 19.6 km² circle 2.5 km east of
  Bellochantuy; the screen treated it as the site, and a goose-roost SPA clipping its edge became "SPA on site, high
  confidence". The reply said "placeholder"; the card, flags and report didn't.
- **Built:** `js/siterole.js`. Every place gets a role, set in code from how it was built (`make_place` records
  `origin.shape`, `origin.offset`, `origin.role`, `origin.role_why`): `footprint` (a published outline, or drawn),
  `area` (a shape the person asked for round a found place: `named_place`), `search_area` (built from clues round an
  anchor that isn't the asset, or a region or namesake's outline), `point`. A point site's default footprint circle
  is a search area too (my call: it stands in for an outline nobody has; one line to change in `js/ntrrun.js`).
- **Screens of a search area:** each feature inside gets `in_search_area`, `coverage` (share of the area, overlay in a
  Lambert azimuthal equal-area projection centred on it) and `side`; band "in the search area", never "on site".
  Flags resting on such evidence get `relation` and a confidence cap: medium, or low when every area inside covers
  under 10% (threshold for Rob); severity unchanged; the cap is recorded (`confidence_capped`). The analyst is told
  in its first message and sees the share in tool output; its "on site"/"across the footprint" wording is changed in
  code. Re-assess does the same. The headline tells the conversation to say so.
- **Shown:** the map draws a search area thin and dashed (no ranging pole) and labels it "· search area"; its card
  says what it is; the run card and report lead with "Screened a 19.6 km² search area (built from clues round
  Bellochantuy), because the site's outline wasn't found…"; evidence reads "in the search area (covers 3.9% of it, on
  its eastern side)"; the report draws and keys it dashed. The share link carries it.
- **Also:** the "At sea" line (card and report) shows onshore only when a flag rests on vessel traffic (`seaMatters`).
- **Not done:** the self-match check (a feature of the asset's own type with a similar name overlapping the search
  area, offered as the footprint) waits on the atlas request of the same day; the evaluation (known footprints rebuilt
  as search areas); "nearest town Ayr, 66 km" (Natural Earth's town list) at site scale.
- Tested: `npm test` (new `test/siterole.test.mjs`; new ntrrun and places tests), new `scripts/browser-search-area.mjs`
  30/30 (desktop and phone), `browser-run-card.mjs` 109 pass, `browser-ux.mjs` and `browser-choice.mjs` no failures.

## 18 Nov 2026 (22:30): welcome examples: global, calm, rotating (Rob)
- The examples (Jackdaw, block 30/2, Linlithgow) were UK and oil-and-gas. Now one of each kind (find, shape, screen)
  is picked at random on every load from a small pool (`js/examples.js`): find: Linlithgow Palace and 5 km around
  it; Lake Tekapo, New Zealand. Shape: a 2 km square round the Kinderdijk windmills; 10 km round Peggy's Cove,
  Nova Scotia; 3 km round Mont-Saint-Michel. Screen: a small wind farm site near Lemvig, Denmark; a small solar
  farm site near Évora, Portugal. The page's own HTML holds one set, so it still reads right before the script runs.
- Chosen by running candidates through the live analyst (`try-requests`, Haiku and the real atlas, three rounds):
  kept: Linlithgow 8 s; Lake Tekapo outline (OSM); Kinderdijk 10 s (centred on the village; the mills fall inside);
  Peggy's Cove 7 s; Mont-Saint-Michel as "mark out 3 km" (read as a radius; "draw 3 km around" was read as across);
  Lemvig: placed and screened in one go, 91 s, designated nature, a power line, Natura 2000 nearby; Évora 77 s,
  other solar farms nearby, Natura 2000 at 6.5 km. Dropped: "what's around Lake Tekapo" (30 s of searching, no
  shape); a solar farm "just outside Tucson" (the analyst's guessed spot fell in Saguaro National Park); "the Jutland
  coast" (too vague; the site ended up in a fjord); Marana (asked questions first); Red Rock, Arizona (three
  places of that name; the screen landed in a national forest); Herning (screened a town); Tabernas (centred on the
  town); Bakersfield (asked questions first). Places in Australia, northern Canada and the Amazon left out of the
  welcome on purpose (screens there rightly raise Indigenous land, which is heavy for a first click), as are
  places where the atlas is thin.
- Screening examples say where and how big ("Screen a 1 km² wind farm site 3 km south-east of Lemvig, Denmark";
  "a 1 km² solar farm site 5 km west of Évora, Portugal"): live in Rob's browser, "a small solar farm site near
  Évora" made the analyst ask where and how big, though the same words had gone straight ahead in Actions. The
  explicit wording went straight to a screen 4 times out of 4 (Évora 50–63 s, Lemvig 71–98 s, consistent flags).
- Found on the way: a name the analyst gives a place ("Tabernas solar site (placeholder)") is now used as given;
  tidying had cut the brackets, so its next call missed the place. `try-requests` now keeps place names as the
  page does.

## 18 Nov 2026 (22:00): a quieter composer (Rob)
- The links under the input (how the screening was tested, the earlier agent page, the code) moved into the
  settings dialog under "About", with one line on what Tobler does and what's coming next (draft wording, for Rob).
- Chips: "Find a place" and "Draw an area" removed (typing finds; the Draw button draws); the two "· soon" chips
  removed (now mentioned in About). One chip remains, "Screen this location for risks", shown only once there's a
  place; it fills "Screen <place in focus, or the latest place> for risks" in the input.
- Tested: headless Chrome 73 checks at desktop and phone sizes.

## 18 Nov 2026 (21:45): shape cards: Adjust instead of a banner (Rob)
- Rob found the drag/reshape/delete banner too prominent. Now the banner shows only while drawing (with Cancel).
- Each shape card has one row: "Use this area" and "Not quite" (while proposed), **Adjust**, then a zoom icon
  and the bin (moved down from the header). Adjust turns on the shape's drag handles on the map and opens a small
  panel on the card: how to drag and reshape, the rotate buttons and the resize box (all moved in from the always-on
  row), and Done. Adjust again, Done, Escape or a click on the empty map ends it.
- Clicking a shape on the map no longer gives it handles: it just brings its card forward and makes it the place
  in focus, so a stray drag can't move a site. A newly drawn shape is focused, not selected.
- Tested: headless Chrome 67 checks at desktop and phone sizes (card row, click focuses without handles, Adjust
  gives handles and controls without a banner, Done closes).

## 18 Nov 2026 (21:30): places named after what they were built from (Rob)
- Rob expected names, not "Area 1". The 17 Nov fix had put feature names on the map labels for findings; places
  themselves were still counted ("Area 1", "Point 2"). Now `make_place` names a place after its anchor and shape:
  a square, circle or rectangle as "Jackdaw 3 km²", a published outline by its own name ("Linlithgow Loch"), a
  corridor as "M9 corridor", a point by the anchor's name. The analyst can pass a shorter `name` in the person's
  words. Names are tidied (register capitals to title case, tracker suffixes like "Oil and Gas Field (Nigeria)"
  dropped, 40 characters at most) and kept unique ("(2)"). A shape the person draws keeps "Area 1" until renamed.
  Every place still answers to its counted name too, so "Area 1" in a tool call or the Screen chip still works.
- Tested: unit test of the naming rules; all suites; browser regression.

## 18 Nov 2026 (21:00): UX pass: screening progress, globe, tools by the input, hint placement (Rob)
- **A screen says it takes time, with an estimate.** When `screen_site` starts, the reply shows a progress block
  at once: "Screening Area 1. This usually takes about 70 seconds (typical for an offshore site)…", a bar and
  the step in hand with seconds so far. The estimate is the median of this browser's last screens of the same
  kind (offshore, onshore, inside only; kept in `tobler.screenTimes`, last 5 each), or a typical figure until
  there are two (offshore 70 s, onshore 100 s, inside 45 s, from the smoke tests). The bar is a proxy: the
  baseline is the first fifth, then the analyst's rounds (usually 5–8), then the write-up, never ahead of what's
  done and never past 96%; past 1.3× the estimate it says "taking longer than usual". The card's header then
  says how long it took. Engine events added: `screen_start`, `baseline`.
- **A spinning globe** replaces the pulsing dot in the activity line (meridians sweep while busy; still when idle).
- **Drawing tools moved from the map to a tray above the input**, opened by a Draw button at the left of the
  input (or the "Draw an area" chip). "Done" closes it. The map's top-right corner now belongs to the map key,
  which used to sit on top of the tools. On a phone the sheet still folds down while drawing, and the tray stays
  in view with the input.
- **The hint moved out from behind the panel**: on desktop it sits at the foot of the map, centred on the part
  the panel doesn't cover; on a phone, at the top. It carries Cancel while drawing and "Delete shape" when a shape
  is selected (the toolbar's select and delete buttons went with the toolbar).
- No ids in progress or activity lines ("Fetching heritage data for Area 1", not "Fetching D2").
- Tested: headless Chrome `scripts/browser-run-card.mjs` 63 checks at desktop and phone sizes (tray, Cancel,
  Done, hint clear of the panel, Delete on a selected shape, progress block with estimate and step, globe, no
  ids, progress gone and the time on the card), all unit suites.

## 18 Nov 2026 (20:00): inside-the-area option for area screens; the settings gear (Rob)
- **Area screens default to the area and its surroundings** (unchanged: fetched out to the wider band). Rob asked
  for the option to keep a screen within the polygon. Two ways in, one idea:
  - **On the run card (any area screen):** a switch, "Area and surroundings | Inside the area only". Inside uses
    the evidence already fetched (distance 0 = inside or touching the edge), so it's instant and free; the map dims
    everything outside the area, the rings go, the slider hides, and "Re-assess inside the area" rewrites the flags
    for the inside only (one model call, as the slider's re-assess). Switching back returns to the last distance.
    Chosen over asking up front: the default stays fast to start, and the person can compare both views of one run.
  - **Asked for in words** ("only inside the block"): `screen_site` takes `extent: "inside"` (areas only; a point
    or line is screened with its surroundings and the run says so). The run fetches only inside (within 0 km), so
    it's quicker on big areas; the analyst is told the surroundings weren't screened and to put that in the gaps;
    the card says so and has no switch (nothing outside was fetched). The record carries `extent`.
- **Settings gear** (panel header; a dialog; saved in the browser): the Esri licence and non-commercial switches
  (the existing `tobler.esriLicence` / `tobler.nonCommercial`, read live, so they apply to the next search);
  units (kilometres, miles, nautical miles: display only via `js/units.js`; cards, slider, rings, scale bar and
  shape cards convert; the analyst is told the person's units and still measures in km, giving both); shape
  colour (four presets chosen away from the findings' theme colours, plus any colour; map, drawing tool and
  page follow; errors now have their own fixed red); your own Anthropic key (kept for the tab only, as before;
  this is its first UI in the workspace). Basemap choice and web search left for later.
- Tested: 4 new unit tests (inside-only run, inside ignored for a point, re-assess inside, units); headless
  Chrome `scripts/browser-run-card.mjs` now 41 checks at 1280×820 and 390×844 (scope switch, re-assess inside and
  back, mask and rings, an inside-only screen, settings: miles, colour, Esri switch). Live in Rob's desktop-app
  browser (Haiku, real atlas): a 4 km² box round Linlithgow Palace screened as 20 MW solar (6 flags, 287 findings
  to 20 km); "Inside the area only" left 9, dimmed the outside and re-assessed in 37 s (5 flags); miles and the
  colour applied; settings put back afterwards. Fixed from that: after re-assessing inside, the distances line
  read "near 0 · close 0 · wider 0"; it now says the flags are for inside the area only. Seen, not changed: whole-sea
  and regional layers (North West European waters, "Eastern Scotland") count as "on site" for an onshore box.

## 18 Nov 2026 (19:00): NTR skill 3.4-draft live (Rob approved)
- Changes: start from the baseline; named biodiversity sources (national protected areas, EEA/Natura 2000, WDPA
  only when switched on, IMMAs, coral, MARPOL, national critical habitat; search for IBAs and EBSAs); KBAs "not
  available under licence" once, with what was checked instead; a cross-border (transboundary) flag under context
  with confidence rules and the "indicative, no legal standing" line; weak evidence (unnamed, attribute-less or
  whole-sea scoring layers) at low confidence unless the score shows the risk; non-commercial and boundary data rules.
- Smoke tests (Haiku, real atlas): Rosebank 88 s, 6 flags incl. the UK–Faroe boundary at 10.7 km (medium, traced);
  Bonga: the carousel offered the candidates (GEM answered this time), then the screen found Bonga Southwest Aparo
  at 7.7 km and Bonga North at 24.8 km as neighbours, FIRMS hotspots at 21 km, and the ProtectedSeas layer now low;
  Linlithgow solar 89 s, 6 flags (loch on site, Bo'mains Meadow 1.1 km, Firth of Forth SPA/Ramsar 3 km, cumulative
  solar, schools). Seen: Linlithgow Loch also used as "land" evidence; the analyst said the CDDA licence wasn't
  recorded; HES heritage still failing in the atlas.
- The disclaimer wording stays as drafted (live since late morning) until Rob changes it.

## 18 Nov 2026 (evening): non-commercial data switch; place finding keeps namesakes (Rob)
- **Non-commercial data off by default, like Esri's.** New licence class rule (`licenceBlock` in `js/licence.js`):
  "No commercial use" and similar now classify as non-commercial; such layers are left out of `find_data`,
  `get_data`, `find_features_near` and `find_place` unless the browser setting `tobler.nonCommercial` is "yes"
  (the settings gear will carry it, beside the Esri switch). Each search says what it left out and why. The licence
  rule now applies to the near-feature and named searches too; before, only `find_data`/`get_data` applied it, so
  Esri-licensed layers could come through `find_features_near`. The WDPA baseline layer shows as "not checked
  (non-commercial licence)" unless switched on. `NON_COMMERCIAL=yes` for `try-requests`.
- **Place finding keeps namesakes.** Bonga: the field search accepted outlines only, so Global Energy Monitor's
  field points were skipped and only the ministry's Bonga Main came back. Now fields (and wind farms) prefer
  outlines but accept points, outlines sorted first; for kinds global trackers hold (fields, plants, mines, wind)
  the search asks a second batch when only one layer matched. Live: Bonga 4.4–6.2 s with four candidates when the
  GEM layer answers; Jackdaw 2.1 s, unchanged; Linlithgow Loch 4.8 s (stops at the first match). The carousel
  (`offer_choices`) already exists; the skill offers it when several candidates fit. Not yet seen end to end: the GEM
  layer failed in the atlas on two of three tries ("tile 0_0 unreadable"; request filed).

## 18 Nov 2026 (17:00): fixes from Rob's Bonga log
- **Multi-part outlines.** Bonga Main (Nigeria's ministry layer) is a MultiPolygon; the drawing tool takes single
  shapes only, so `make_place` failed and the analyst fell back to a pin (a 77 km² field screened as a 5 km circle).
  Now the drawing tool holds the largest part and the place keeps the rest (`extraParts`); the place, the map, the
  card, edits from chat and screening use the whole outline; the card notes "published in N parts". Map fill
  layers take MultiPolygons too. Browser-tested headless: a two-part outline draws whole and survives a chat edit.
- **A mistyped id isn't a gap.** The analyst passed a candidate (C1) to `get_data`; the run listed "C1" as a
  source not checked. Now only real datasets and feature searches count as checked or not checked.
- **No land in reach.** Offshore with the coast beyond the wider band (Bonga: 124 km), the first message says
  onshore receptors are out of reach, so the analyst doesn't search for settlements or list them as gaps.
- **The log explains the card.** Baseline checks (boundaries and baseline layers) now appear in the session log and
  in "How I worked this out", marked baseline; the run's flags, checked list and gaps go in the log too.
- Seen, not fixed: the analyst flagged "fishing-protection area overlaps site" from ProtectedSeas' global Level of
  Fishing Protection layer (one unnamed polygon, no attributes shown; the layer scores 1–5 and covers whole seas),
  probably a false flag. The global WDPA in the atlas says "No commercial use" (as does WDPA's own licence): the
  EMODnet WDPA baseline layer carries the same underlying terms. Both raised with Rob.

## 18 Nov 2026 (late morning): screening baseline in code, boundaries, disclaimer (Rob)
- Rob: KBAs aren't the only biodiversity source, and a site near an international boundary is an NTR (effects spill
  over). Split agreed: **catalogue** names the must-check layers (`catalogue/trusted.json` "baseline"), **tools** fetch
  and measure them in code before the analyst starts, **skill** says what they mean (draft 3.4 sent to Rob first).
- Baseline layers (each tested 18 Nov at Rosebank, Mars and Linlithgow): WDPA via EMODnet (European seas and coasts
  only), EEA nationally designated areas (CDDA) and Natura 2000 (EU, not UK since 2021), IUCN Important Marine Mammal
  Areas, UNEP-WCMC coral reefs (tropics), MARPOL special areas, NOAA critical habitat (US). Each applies by box and
  setting ("sea" = offshore or coast within the wider band). Licences recorded with "check before commercial use"
  where the terms aren't open. Baseline datasets get B ids so the analyst's D ids don't shift.
- Boundaries (`js/boundaries.js`): other countries within the wider band from Natural Earth (Tobler's reference;
  onshore that's the land border), maritime boundary lines from VLIZ Maritime Boundaries v12 (CC-BY 4.0 per
  marineregions.org, though the atlas record says "contact VLIZ") with the territories either side and line type.
  Every boundary feature carries the caveat: indicative, no legal standing; VLIZ data isn't for legal,
  resource-exploration or navigation use. No maritime call when there's no sea within reach.
- The first message lists what the baseline found ("Already checked by the run…"); the run record keeps
  `baseline` and `disclaimer`. A boundary named by its territories traces to the line.
- Disclaimer (`js/disclaimer.js`, draft wording for Rob): on the run card and first in every run download; later
  exports and the PDF use the same text.
- Smoke tests (real atlas, Haiku): Rosebank flags the Faroe–UK treaty line at 10.7 km and the Sponge Belt at 20 km;
  Mars flags loggerhead critical habitat on site, no boundary in reach; Linlithgow picks up 59 nationally designated
  areas from the EEA layer. Heritage at Linlithgow still weak (HES layers fail in the atlas; request open).

## 18 Nov 2026 (10:30): FIRMS key on the live Worker
- Rob's live screen reported NASA FIRMS "API key missing". Cause: the Worker's last good deploy (17 Nov 18:34) came
  before `FIRMS_MAP_KEY` was a repo secret, and the two deploys after it (20:06, 20:07) failed their live FIRMS check
  because the secret was still empty. Redeployed (push under `worker/`): the key loaded and the live FIRMS check
  answers 200. Same deploy: the Worker accepts 1–5 days, NASA's limit (was 1–10). Lesson: after adding a repo secret
  the Worker needs, push under `worker/` (or run Worker deploy) and read the log.

## 18 Nov 2026 (05:10): chip, tagline, delete on the card (Rob)
- "Screen for risks" chip live: it fills "Screen <place in focus> for risks" (or "Screen " with no place) and waits
  for Send. Tagline: "Your geospatial screening analyst." Shape cards get a small trash button (deletes the shape
  and greys the card, as the map's delete does), so shapes the analyst made can go without the map tools.
- Tested headless at desktop and phone sizes: chip text with and without a place, delete removes the shape and the
  place, no page errors.

## 18 Nov 2026 (early): step 4 core — sealed NTR runs and the run card
- **Rob's calls (asked first):** the slider re-sorts evidence instantly and flags are re-assessed on tap (one model
  call on the stored evidence, no new fetching); one "show findings up to" slider, not three band handles (bands
  change in chat); smoke tests only, no IFC rerun; core first (out-of-date marking, tray and settings next).
- **Sealed runs (`js/ntrrun.js`).** `screen_site` (conversation tool) starts a run: its own `runTurn` loop with the NTR
  skill in the system prompt, the fence rule, and only `get_place`, `find_data`, `get_data`, `find_features_near`.
  Its tools get their own host: the only place is the site footprint, nothing can be built or renamed, and findings
  go into the run instead of the map. The conversation gets a headline (counts, top flags, what failed); detail
  through `get_run`. The conversation no longer loads the NTR skill itself.
- **Fetch once, to the wider band.** The run raises `get_data.within_km` and `find_features_near.radius_km` to the
  wider band (max 50 km) whatever the model asks, so the slider works inside what was fetched.
- **Run record = GeoJSON FeatureCollection** with a `tobler_run` member (schema `tobler-run/1`): skill and version,
  model, times, site (how found, confidence, anchor source, footprint, setting, asset, stage), distances with
  reasons, method line, flags, checked, gaps, the model's own checked list, usage, past assessments. Features: the
  site (role site) and every feature the tools returned (role evidence) with fid, theme, distance, band, dataset,
  publisher, licence, checked time. Downloadable from the card; the export schema builds on this.
- **Traced evidence.** Each evidence item the model gives is matched to a fetched feature (name, then dataset and
  distance within max(0.5 km, 15%)). Matched items take the fetched distance, band, dataset, licence and date;
  unmatched ones are shown as "not traced to fetched data" (regional knowledge is honestly untraced).
- **"What was checked" comes from the tools**, not the model: each `get_data`/`find_features_near` result is
  features (n), none in dataset, or not checked with the reason.
- **Scale-aware distances (`catalogue/distances.json`, `js/distances.js`), a draft for Rob:** near/close/wider and a
  footprint radius per asset type and setting, with size rules (solar under 5 MW smaller, 100 MW+ wider; wind near =
  10 × tip height, at least 1 km; mine 20 km²+ wider; thermal 500 MW+ wider; offshore wind 1 GW+ wider) and a reason
  shown on the card. The person's own distances win; wider is capped at 50 km (the tools' reach). Points are screened
  as a footprint circle, said on the card.
- **Run card:** flags first (confidence chip, theme swatch, risk, nearest distance), opening a flag picks out its
  evidence on the map; slider with the nearest finding per theme; flags whose evidence is all beyond the slider are
  dimmed; "Re-assess at X km" when the slider differs from the distance the flags were written for; distances and
  why; what was checked; gaps; show on map; download. Showing a run replaces other findings on the map.
- **NTR 3.3-draft:** distances and footprint come from the run when it gives them; method otherwise unchanged.
- **Tested:** `test/ntrrun.test.mjs` (11, atlas and model faked); `scripts/browser-run-card.mjs` in headless Chrome
  at 1280×820 and 390×844 (scripted model and atlas, outline basemap): 20 checks pass, no page errors.
- **Smoke tests (real atlas, Haiku, `try-requests`, 18 Nov ~05:30):** Rosebank (57 s, 6 flags, 43 evidence features;
  pipelines on site, wrecks at 1.9 and 2.4 km, Faroe-Shetland Sponge Belt at 20 km, all traced), Linlithgow Palace as a
  20 MW solar farm (116 s, 6 flags; Linlithgow Loch on site, Bo'mains Meadow 1.1 km, St Michael's Hospital; heritage
  layers not checked because HES fetches fail in the atlas), Mars (44 s, 5 flags; some evidence untraced because the
  model named leases by tool id). Fixes found on the way: (1) Haiku thinks by default and the thinking counts against
  the 8,000-token cap, so big screens were cut off before the JSON: the run now asks for a compact result and short
  thinking, and if the result is cut off asks once for the JSON alone from the same evidence (dropping signed thinking
  blocks); the card says so. (2) NASA FIRMS now accepts 1–5 days (was 10): trusted.json and `get_data` default to 5.
  (3) `find_data` with a concept that finds nothing searches the words alone (wrecks are tagged seabed habitat).
- **Seen, not fixed:** slow screens on busy onshore sites (Linlithgow 7 rounds, 427 evidence features); evidence
  named by tool id stays untraced; the analyst sometimes passes a stage the person didn't give.
- **Not done yet:** out-of-date marking when the site is edited; the places-and-runs tray; settings; per-receptor
  distances in the skill. The "Screen for risks · soon" chip is unchanged (public text: Rob's call).

## 17–18 Nov 2026 (overnight): cartography, step 3 closed
- **Findings by theme** (`js/findings.js`): biodiversity green, land and livelihoods ochre, Indigenous Peoples
  violet, cultural heritage pink, community health and safety blue, operating context slate; red stays for the
  person's site. Checked with the dataviz palette validator (lightness, chroma, normal-vision pass; green/ochre in
  the CVD 6–8 band, so the key and labels carry the theme too). The analyst tags each search with a theme
  (`theme` on `find_features_near` and `get_data`; NTR 3.2-draft says to); otherwise feature type or atlas concept
  decides, then "context".
- **Emphasis by distance from the site's edge:** on site or within 1 km strong, 1–5 km medium, beyond faint.
  Areas over 200 km² get an outline and the faintest fill and sit underneath; operating-context areas are quieter
  still. Labels only for features within 1 km and the nearest three per theme; tap a point or outline for its name,
  theme, distance and source. Dashed distance rings (1/5/20 km onshore, 2/10/50 km offshore) round the site searched.
- **Map key** ("On the map", top right; below the hint on phones, closed by default there): one row per theme with a
  count and a switch, and Clear. Rob's call to live with it for a day or two and revisit.
- **Corridor clipping:** `make_place` takes `clip { to, within_km }` (to within a distance of a feature, or to an
  outline). "A 1 km corridor along the M9 within 5 km of Linlithgow": 12.2 km² cut to 10.2 km², 25 s.
- **Labels:** source, project and supplier columns and short all-capital codes aren't taken as names (road numbers
  still are); descriptive fields (habitat, class, designation) are the fallback.
- **Turn speed measured** (model and tool time per round in the log and the replay): corridor 25 s (8 s model over
  4 rounds; was ~90 s), Rosebank screen 45 s (24 s model, 7 rounds), Linlithgow solar screen 28 s (16 s model,
  5 rounds). Slowest single searches 10–15 s (settlement and protected-area searches waiting on OpenStreetMap or many
  atlas layers). No further cuts needed now.
- **Step 3 closed.** Parked, with reasons: atlas name index and catalogue export (atlas chat); admin boundaries as
  places (OpenStreetMap outlines cover most asks); held-out confidence check and atlas-feature evaluation set (until a
  place-finding evaluation rerun is wanted).
- **Seen in testing, not fixed:** the analyst sometimes picks an odd theme (a place of worship as "indigenous",
  flood zones as "context"); the key opens on a desktop-sized load even if the window is later narrowed.

## 17 Nov 2026 (night): fixes from Rob's Rosebank test
- **Distances from the edge:** `find_features_near` measured from an area's centre; for areas and lines it now searches a
  circle covering the shape plus the radius and measures from the shape's edge (0 = inside), and reports `found` vs
  `listed` (nearest 15 listed) so counts don't drift.
- **Findings stay on the map:** features from `find_features_near` and `get_data` go to their own layer (orange,
  labelled by name) for the session; a later search never wipes them (before, one shared layer was replaced by each
  search, including empty ones). `show_on_map` fits the view to some or all findings, or clears them.
- **No ids for the person:** ids (C3, D2) are tool handles only; map labels are names. Place-finding 4.11.
- **Session log:** every turn's tool inputs and outputs are kept in the page (`window.toblerLog`) and can be saved
  from any "How I worked this out" ("Download the log"), so Rob can attach a log instead of pasting.
- **`get_data`** reports what the service returned for the box and hints when it returned nothing at all.
- **NTR 3.1-draft:** fetch out to the wider band (50 km offshore) then sort into bands; suspect the dataset when an
  expected layer comes back empty.
- **Atlas requests:** an NSTA "(WGS84)" pipeline record that points at *removed* pipelines (why Rosebank showed none);
  EMODnet layers held as WMS only with "licence not stated", though EMODnet offers WFS and CC-BY 4.0 (Rob's wrecks find).
- **Tested live:** Rosebank found and screened; "protected areas within 50 km … show them on the map" found 4 NatureScot
  features measured from the field edge (Faroe-Shetland Sponge Belt ~20 km) and fitted the map to them.
- **Rough edge:** layers without a name field get a poor label (e.g. "JNCC", taken from a source column).

## 17 Nov 2026 (late evening): NTR for the workspace, trusted services, licence rule, FIRMS
- **NTR split (Rob):** the evaluated IFC skill is frozen as `skills/ntr-screening-ifc` (method byte-identical; only the
  header name changed) for the lab page and the evaluation. A new `skills/ntr-screening` (3.0-draft) is the
  workspace skill: onshore and offshore, IFC themes kept as structure but not IFC's verdicts, and it says *what
  evidence to look for* (with search words) so the analyst finds the datasets itself with `find_data`/`get_data`.
  Few evaluations from here: smoke tests on hand-checked cases unless one adds real value.
- **Distances:** default bands per setting (onshore 1/5/20 km, offshore 2/10/50 km, the offshore ones a draft for Rob
  to correct); the person can change any of them in chat and the skill keeps theirs for the conversation. A settings
  editor comes with the run card in step 4.
- **Licence rule (Rob):** data under Esri's Master License Agreement isn't used unless the person holds an Esri
  licence (setting `tobler.esriLicence` = "yes" in the browser; the settings gear comes in step 4). Classes in
  `js/licence.js`: open, esri-mla, non-commercial, unknown (not stated), stated (other). `find_data` leaves Esri copies
  out and says how many; `get_data` refuses them. Open and trusted sources rank first.
- **Trusted global services (`catalogue/trusted.json`):** services Tobler calls directly (NASA FIRMS VIIRS and MODIS,
  because the atlas only has Esri's copy) and trusted publishers (NASA, ESA/Copernicus, NOAA, USGS, UNEP, FAO,
  GEBCO, EMODnet, national nature and heritage bodies…) ranked first among atlas results. Long term the atlas should
  carry a trusted tier (requested).
- **FIRMS:** `tobler-api` has `POST /firms` (sources allow-listed, box ≤ 400 square degrees, 1–10 days, CSV to GeoJSON,
  300 calls per visitor a day, NASA's error text never echoes the key). `get_data` on a FIRMS service asks all
  three VIIRS satellites at once. The key (`FIRMS_MAP_KEY`) wasn't visible in the repo secrets at the time of writing,
  so FIRMS is untested live; the deploy no longer loads empty secrets over ones set elsewhere.
- **find_place:** the catalogue also searches the name without kind words ("Mars platform" → "Mars").
- **Workspace analyst:** 14 rounds a turn (a screening asks many datasets); NTR no longer "coming soon" in the prompt.
  The "Screen for risks · soon" chip is unchanged (public text: Rob's call).
- **Blocked by the atlas (20:10 UTC):** `fetch_features` fails with "No dataset with id …" for nearly every dataset
  after the atlas's shard change (commit daf3023); requested as urgent. Replays after that are mostly "not checked":
  Linlithgow solar screen (settlements, schools and rivers found; SEPA flood, HES monuments, Hutton land capability
  not checked) and Mars (not found, because the NOAA platform layer couldn't be fetched).

## 17 Nov 2026 (evening): catalogue tools, confidence from the place, no false absence
- **`find_data`** (`js/datatools.js`): searches the atlas catalogue by words in dataset titles and publishers for an
  area (`find_datasets` with `text` and a bbox). One entry per title and publisher; fetchable datasets first; short
  ids (D1…); the Esri Master License Agreement is named and flagged for checking before commercial use. Retries once
  when the atlas says it's overloaded. When nothing matches it says what was searched and to try other words.
- **`get_data`**: fetches one dataset's features for a place's box plus a margin (`fetch_features` with `id`, `bbox`,
  limit 100), measures each from the place's edge (0 inside or touching; vertex-based, fine for screening), keeps
  those within `within_km` (default 0 for areas, 10 for points), nearest first (inside: nearest the centre), and puts
  them on the map as candidates. Returns a few key attributes (dates as ISO, ArcGIS epoch milliseconds converted),
  publisher, licence and the time checked. Picture-only datasets and failed services come back as "not checked",
  never as nothing found. Time-aware layers carry a note that they show recent detections only.
- **Confidence inherited:** a shape built on a place already on the map starts from that place's confidence (a
  drawing counts as high); offsets cap it at medium, failed checks at low; checks don't raise it. Mars: the 20 km
  circle was "low" because the anchor rules read the platform point as nothing specific.
- **No false absence:** the conversation prompt says never to claim data doesn't exist unless `find_data` searched
  for it, with the words and area; if no tool could check, say so. The "coming soon" line now offers the catalogue tools.
- **Areas for catalogue searches:** country aliases (United States, UK…); for countries spanning the date line
  (USA, Russia, Fiji, New Zealand) the largest part only, because the USA's box covered the world; common seas and
  basins by name (Gulf of Mexico/America, North Sea, Gulf of Guinea…); any other named area via OpenStreetMap;
  then the map view. This also fixes `find_place` with `kind` and `area`, which had silently searched nothing for
  "United States" and "Gulf of America".
- **Tested:** 8 unit tests (`test/data.test.mjs`, atlas faked); Rob's Mars conversation replayed through
  `try-requests` (Haiku, real atlas): VIIRS and MODIS found and checked, EFH 32 species areas inside the circle,
  failed services reported as not checked; after the area fix, Mars found in one search, 46 s and 11 s turns. Live on
  asktobler.com (desktop-app browser): "Put a 20 km circle round the Mars platform in the Gulf of America and check it
  for thermal anomalies" → high-confidence circle, NASA VIIRS checked, no detections, snapshot caveat given.
- **Known rough edges:** fetched features replace the map's candidate layer (two `get_data` calls at once show only
  the last); the analyst sometimes shows D ids to the person; NTR itself is still "coming soon", so "environmentally
  sensitive" is answered from whichever datasets the analyst picks, not from a written method.

## 17 Nov 2026 (evening): scope reset, Tobler is a screening tool
- After Rob's Mars test (the analyst wrongly said VIIRS isn't in the catalogue; the atlas holds 7 VIIRS datasets,
  including NASA's global thermal hotspots layer), Rob set the scope: Tobler is a geospatial screening tool, NTR first,
  area discounting after. Place finding supports screening. Speed and ease of use count as screening needs, so
  corridor clipping stays and the atlas name index is requested again.
- No tuning around the model; it stays one config setting. Quality comes from tools and skills.
- Modular: the atlas stands alone; tools stay in the page; skills are written to lift out (standard SKILL.md header,
  method in plain terms naming operations rather than Tobler functions, a short "Tools in Tobler" mapping, nothing about
  Tobler's screens). NTR's evaluated method stays word for word, or the evaluation is rerun.
- Next, in order: catalogue tools (find data, get data); confidence inherited from the anchor; never claim absence
  without a way to check; skills in the portable format; NTR on places; corridor clipping and turn speed; name index
  (atlas). Full list and the Mars test write-up in the plan doc's handover.

## 17 Nov 2026 (evening): Tobler's own Worker, tobler-api
- Tobler's Claude and atlas calls now go through `tobler-api` (code in `worker/`, see `worker/README.md`), not demo 1's `north-sea-geo-demo`. Switched in one line (`proxyUrl` in `js/config.js`); demo 1's Worker is untouched and still serves demo 1.
- Deployed by the **Worker deploy** Action on changes under `worker/`: tests, `wrangler deploy`, secrets loaded with `wrangler secret bulk` from the repo secrets, then a live check. Secrets used: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `ANTHROPIC_API_KEY`, `ATLAS_MCP_KEY` (checked first with the harmless **Worker secrets check** workflow).
- The Worker's Anthropic key is `ANTHROPIC_API_KEY`, the same secret the evaluations use (it was the only Anthropic secret in the repo). One key, one spend limit in the Console; split later if page use and evaluation spend need tracking separately.
- Counters in a Durable Object (SQLite-backed, one per visitor per day plus one daily total) instead of KV, so the caps are exact under parallel calls. Visitors are keyed by a hash of the IP. Calls are counted before going upstream (simpler and tighter than counting after; failed calls count).
- Same limits as demo 1 (200 Claude calls per visitor a day, 5,000 in total, 2,000 atlas calls per visitor), as vars in `worker/wrangler.toml`.
- Allowed origins: asktobler.com, www.asktobler.com, pushpingeo.github.io, localhost:8000. Not asktobler.ai/.io (they don't serve the site).
- Only `system`, `messages`, `tools` and a capped `max_tokens` are forwarded to Claude, as before.
- `compatibility_date` 2026-08-01, because local workerd (Miniflare 4) doesn't support later dates yet. Miniflare 4 is pinned for the tests because the Miniflare that ships with the latest wrangler is a beta with a different options format.
- `index.html` (the earlier agent page) also reads `js/config.js`, so it moved to tobler-api too.

## 17 Nov 2026 (early hours)

- **Place-finding v4 evaluation (skill 4.2, atlas on, Overpass down throughout):** 46 of 48 described sites placed (v3: 43), median 2.46 km, 70% within 5 km. On the 42 sites both placed, accuracy is unchanged (74–76% within 5 km, 86% within 10 km). What changed is confidence: low now means worse (median 5.6 km, against 1.6 for high), and 14 failed checks pulled placements to low. Two high-confidence misses remained (Nachtigal 22 km, Kinguélé Aval 11 km). The atlas supplied 8 anchors; 15 of 84 feature searches failed.
- **Only tight checks raise confidence (skill 4.7).** A check within max(3 km, 35%) of a 250 km clue passes almost anywhere; a distance without a direction is a ring. Tight (tolerance ≤ 5 km) directional checks count 2, tight distance-only 1; high needs 2. Replayed on the v4 results: high goes from 11 sites at 1.6 km median to 5 at 0.7 km; Nachtigal drops to medium. Drawn from the same 48 sites, so it needs a held-out check.
- **Atlas layer choice:** national and intergovernmental publishers first, local bodies and unknown publishers claiming global extents last, up to 20 of the top 100 layers; pieces of one site within a layer merged; `fetch_features` can search by name inside a layer (atlas change, same night).

## 16 Nov 2026 (night)

- **The atlas is a feature source alongside OpenStreetMap** (`js/atlasfeatures.js`). `find_features_near` asks both at once: the atlas finds layers with the right concept around the point (skipping layers flagged with an overstated extent), fetches from up to five, and the results are merged. Each source is reported as found, or "not checked" with the reason; a failed source is never reported as "none". The evaluation calls the atlas with `ATLAS_MCP_KEY`; the page calls it through the Worker's `/atlas` route, which doesn't exist yet (see `docs/worker-atlas-route.md`, for Rob), so on the live site the atlas shows as "not connected" until then.
- **Atlas features count as authoritative only when the publisher is a government or intergovernmental body.** A university's copy or a third-party summary counts like a gazetteer (medium until a check passes).
- **Holes in published outlines are filled, with the area it adds stated** (Beatrice: 2 holes, 0.06 km²). The map editor can't hold holes; before this the analyst swapped the outline for a circle of the same area and called it high confidence.
- **Checks spell out direction both ways** ("the site is 68 km NW of Lubumbashi; Lubumbashi is SE of the site"), after the analyst inverted one in a live test.

- **Place-finding skill v4: confidence is worked out in code (`js/confidence.js`), not chosen by the model.** v3 showed the model's "high" was less reliable than its "medium". The model now says how the anchor matched (`named_place`, `name_and_type`, `type_near_clues`, `name_only`, `settlement_or_region`, `none`) and passes every distance clue as a check; the tool measures each check from the place it built (pass if within max(3 km, 35%) and, beyond 2 km, within 45° of the stated direction). Rules: authoritative layer or the place the person named → high; Wikidata/OSM by name and type, or right type where clues point → medium; settlement, region, name only → low. Any failed check → low. Medium rises to high with one passing check (two for a type-only match). Offsets and points for large features cap at medium. A "name and type" match that is actually a village is treated as a settlement (the Sierra Rutile case). The thresholds are first guesses, to be judged on the v4 evaluation, not tuned to single sites.
- **Overpass from GitHub's runners:** a probe (`scripts/probe-overpass.mjs`, workflow `overpass-probe.yml`, no API cost) found all three public servers timing out on a trivial query at 14:13. The evaluation now probes before it starts and records the result and the count of failed feature searches in its summary, so a run without OpenStreetMap can't be mistaken for a method result.

- **Welcome panel copy v2 (Rob's text).** "Soon" chips answer in the conversation without calling the model, so tapping them costs nothing. "Draw an area" switches the map to polygon drawing and, on a phone, lowers the sheet so the map is free. Example quote marks are drawn by CSS, so the example is sent exactly as written. All three "soon" chips get the dimmed, dashed style for consistency. The tagline is indented to line up with the title text; on a phone it stays hidden, as before.

- **Scale is worked out, in Rob's order.** The request first (the analyst passes `scale` to `make_place` only when the words say it and the shape doesn't show it), then the shape's size (unchanged thresholds: up to ~50 km local, up to ~1,000 km regional), then the zoom level for a drawn point (a point has no size, so it takes the width of the map view when dropped). The card's tooltip says which. The project summary now gives the map view's width, so the analyst knows the scale being looked at before there's a place. Points found from words with no stated scale stay local. Place-finding skill 3.2 says this.

- **Version stamps from file content, through the import map.** `scripts/stamp.mjs` gives every module, the stylesheet and every fetched file (skills, catalogue, reference data) a `?v=` from a hash of its content, written into `workspace.html`. Only files that changed are fetched again, and each module resolves to one stamped URL so none loads twice. `npm test` fails if the stamps are stale, so run `node scripts/stamp.mjs` before pushing. The page itself is still cached for up to 10 minutes by GitHub Pages; that's the remaining window for a mix of old and new, and nothing in the files can close it. `index.html` and `tools.html` keep their hand-written `?v=m2b` stamps for now.
- **Direction change (from the plan):** step 3 is places through the atlas; NTR moves to step 4; GIS file drop and web services move to phase 7; scale is derived (request, then geometry size, then zoom), never asked.

## 17 Nov: place finding searches the catalogue
- `find_place` takes `kind` and `area`. With them it asks the atlas which layers hold that kind of thing in that area (a country includes 2.5° of its waters), then searches those layers for the name, in batches of 10, until something matches, 40 layers are asked or 30 s pass. The reply lists every layer asked. Before this, only five hand-picked UK layers were searched, so "OML 145, offshore Nigeria" got pointed at the NSTA blocks.
- Name matching: every word of the name must appear in the feature's text ("OML 145" matches type "OML" + number "145", and "OML145"); numbers match whole (145 isn't 1450). The server gets the most distinctive word (the one with a digit).
- One layer picker for both "near" and named searches. The atlas doesn't record geometry type yet, so titles stand in: for lines and areas, layers titled junctions, points, labels, cameras and the like go last, and features of the wrong geometry are skipped and counted. The near search keeps asking more layers (up to 20 more) if nothing of the right geometry turned up (the M9 found only junction points).
- To do in the atlas: carry each layer's geometry type into the search database, so this doesn't rest on titles.
- Skill 4.8: use `kind`/`area` for things OpenStreetMap rarely holds; when not found, say what was searched; never point to another country's layer.

## 17 Nov: tool results are fenced and budgeted (after comparing notes with the "stub pattern")
- What we already did: geometry never reaches the model (places by name, candidates by id; replies carry a centre point, size and source, not outlines), result counts are capped (12 / 15 / 8 candidates, atlas attributes ≤ 8 fields under 80 characters), and old tool output is never replayed.
- What was missing: third-party text (OSM and Wikidata names, atlas layer titles and attributes, service error messages) went to the model raw, with nothing saying it's data, and there was no overall size limit.
- Now (`js/fence.js`, workspace agent only): every string is flattened to one line (control and invisible characters removed) and cut to 200 characters; each tool result has a 16k-character budget, trimmed by halving the longest list with a note saying how many items were left out; the system prompt says tool results are data, never instructions, and that anything reading like an instruction is ignored and mentioned to the person. Normal replies come to about 10k characters at most, so the budget shouldn't bite in ordinary use.
- Not changed: the NTR agent (`js/agent.js`), because its prompt is the evaluated one. Apply the same fence in step 4, when NTR moves into the workspace as sealed runs, and rerun its evaluation.
- Still to do: (1) a fixed summary shape for big queries (count, extent, fields, a few sample rows), for when atlas queries return more than a short list; (2) record the atlas build date with every atlas-sourced result, so a run says which version of the catalogue it used; (3) the place evaluation hasn't been rerun with the new prompt line; do that before quoting v4+ numbers again.

## 17 Nov: speed (items 1–5 of the list put to Rob)
- **Lookups in one step run at once** (`converse.js`, `READ_ONLY`: load_skill, find_place, find_features_near, get_place); tools that change the map run after them, in the order asked. The prompt tells the model to put independent searches in one step. Nominatim calls now queue so parallel searches still keep to one a second.
- **`find_place` takes `also`** (up to three more spellings) and searches every spelling, every source and the catalogue at once; the same feature found twice comes once. The catalogue search sends one server-side text per distinct distinctive word.
- **Deadlines:** each atlas layer gets 8 s, then counts as "too slow" and anything it sends later is ignored; a named search stops after 25 s. Once the atlas has found something near a place, OpenStreetMap gets 3 more seconds instead of its full 15.
- **Atlas answers are remembered in the page for the session** (up to 400; failures aren't kept).
- **Shorter replies:** the layers asked are summarised (those that found something, a few failures by name, counts for the rest) instead of listed one by one.
- Skill 4.9: spellings in one call; don't offer files or web services, which can't be loaded yet.
- Road and river pieces from one layer are joined into one line (a corridor used one piece of 13 on the live M9 test); areas in pieces are still counted, not joined.

## 18 Nov (late evening): the workspace is the front page (Rob's call)
- `workspace.html` → `index.html` (asktobler.com). The earlier IFC agent page (was `index.html`) → `lab.html`; the lab results page (was `lab.html`) → `lab-results.html` (Rob chose this over `agent.html`).
- `workspace.html` stays as a tiny redirect to `/`, keeping `?query` and `#hash`, so old links and future share links still land.
- Links updated: About in settings → `lab-results.html` and `lab.html`; the results page's "Try the agent" → `lab.html`; the agent page now links to the results, the tools page and the workspace.
- `scripts/stamp.mjs` now stamps `index.html`; `scripts/browser-run-card.mjs` loads `/`. `noindex` header unchanged.
- Tested: `npm test`; browser checks 73/73 locally; redirect locally; live in Rob's desktop-app browser (front page is the workspace, no console errors, About links right, all four pages 200, `/workspace.html` redirects). Not tested: a real phone.

## 18 Nov (late evening): from Rob's Miri log
- **No candidate ids in front of the person.** Picking from the choices sent "Use C29: Miri (…)" as the person's message. Now the person sees "Use Miri (OpenStreetMap contributors)."; the analyst gets that plus a note with the candidate id and to build it as the person's choice (`match: named_place`), so it doesn't search again (it did in the log, and then said "Your C1 isn't in this search's results" although C1 was still there). `send(text, forModel)`; the log keeps both (`user`, `sent`).
- **No ids in place names.** The analyst named a place "Miri city (OpenStreetMap C29)". `placeName` drops candidate ids (and a bracket holding one); the place still answers to the analyst's own wording (`given`), so its next call finds it. The `make_place` name description says no ids or sources.
- **Countries only clipped at the edge.** Miri Division came out "across Indonesia, Malaysia and Brunei" (it borders both, and 1:10m borders clip its edge), and the analyst then told Rob the outline was probably wrong. `countrySplit` samples a grid over the area: countries under 2% are `touches_at_edge` ("in Malaysia, touching Brunei and Indonesia at its edge"). 20–60 ms on big areas. The screening baseline (`boundaries.js`) is unchanged and still sees every country touched.
- **Scale bar below the zoom buttons** (MapLibre stacks bottom controls upwards, so the scale goes in first).
- Tested: `npm test` (new cases in places and workspace tests), `browser-run-card.mjs` 73/73, new `scripts/browser-choice.mjs` (pick message, id to the analyst, scale bar position).

## 18 Nov (night): run card gaps grouped; wide areas "around the site"
- **Gaps in three groups** (`js/gaps.js`): "Couldn't check" (sources the tools couldn't check, first, unless the analyst already named them; then the analyst's lines about failures and things not checked), "No data" (nothing published or in the catalogue for it here), "Caveats" (everything else). Sorted by wording in code, so the analyst's output and the skill are unchanged. The summary reads "Gaps: 3 couldn't check, 1 no data, 1 caveat". The run record keeps `data_gaps` as written.
- **Wide areas the site lies within are "around the site", not "on site".** A polygon that contains or touches the site and is at least 1,000 km² and 200 times the site's area (`aroundSiteKm2` in `js/datatools.js`) gets `surrounds: true` and band "around the site" in the run record; `get_data` marks it `around_site` with its area and a note; the baseline summary says "(around the site: a wide area it lies within)"; the screening analyst is told such areas aren't findings on the site and to mention one only where being inside it matters (a large protected area, a MARPOL special area offshore). The card counts them apart ("The site also lies within a wide area: North West European waters"), leaves them out of "nearest per theme", and evidence and map pop-ups say "around the site". They stay on the map, faint, and still go to the analyst. Thresholds are a judgement: a large real designation the site sits in (a national park, a marine park) is labelled the same way, which is accurate.
- Tested: `npm test` (new `test/gaps.test.mjs`; ntrrun test now has MARPOL's NW European waters around the field), `browser-run-card.mjs` 77/77 (grouped gaps, the wide-area line, map counts).

## 19 Nov: Local / Regional / Global buttons removed from shape cards (Rob)
- They spilled out of the panel, and they did little: scale only goes into the analyst's project summary; screening distances come from the asset type and size. Scale is still worked out (from the request, the shape's size, or the zoom for a drawn point) and passed to the analyst; `make_place` can still set it when the request says so ("screen the whole country"). It's no longer shown or set on the card.
- Tested: `npm test`, `browser-run-card.mjs` 77/77, `browser-choice.mjs`; screenshots at desktop and phone sizes.

## 19 Nov (evening): water depth and AIS vessel traffic in screens at sea (Rob)
- **Rob reviewed the offshore part of the NTR skill:** working well; add water depth (what's possible and what it
  costs changes with depth) and shipping lanes from historic AIS. Review item closed.
- **Read in code as part of the baseline**, like boundaries (`js/seavalues.js`), not left to the analyst's searches:
  - **Water depth** on offshore sites: up to 25 points over the footprint in one `getSamples` call to NOAA NCEI's
    **DEM Global Mosaic** ImageServer (global; GEBCO-based in deep water, finer surveys where NOAA has them; US federal,
    public domain inferred, GEBCO attributed). Typical (median), shallowest and deepest; points above sea level counted.
  - **Vessel traffic (AIS)** when the sea is within the close band: EMODnet Human Activities' vessel density
    (hours per km² a month, 1 km cells, EU waters and neighbours, CC-BY 4.0), by WMS GetFeatureInfo at up to 9 points on
    the site and 24 on two rings (half the close band and the close band, from the site's edge); then fishing,
    passenger, cargo and tanker at the busiest point. **2023 asked for explicitly**: EMODnet's default year, 2024, lost
    satellite AIS from June (its own note). Outside coverage the service returns nothing: "no data here", never zero.
  - Why not through the atlas: GEBCO is there only as pictures (no values) or Esri ImageServers with vertical
    exaggeration; EMODnet's bathymetry record shows "licence not stated". Request in `docs/atlas-requests.md`; the
    sources sit in `catalogue/trusted.json` "values" until the atlas tags value-returning services.
  - Both services send CORS headers (checked from GitHub's runner with Origin asktobler.com), so the page calls them
    directly; no Worker change.
- **On the card:** one short line under the setup ("Water depth about 120 m, 110–130 m across the site (NOAA). Vessel
  traffic: light on the site (0.3 h/km² a month) (AIS 2023, EMODnet)."); the full lines, with sources, go to the
  analyst's baseline, `get_run` and the run record (`tobler_run.sea`); each source is in "What was checked".
  The busiest point sampled becomes a finding (community health and safety) only when traffic is at least moderate,
  so light traffic doesn't clutter "nearest per theme".
- **Words for density, a judgement for Rob to correct** (`trafficWord`): under 0.5 light, under 5 moderate, under 20
  busy, otherwise very busy. From sampled places: Rosebank 0.005, central North Sea 0.07, southern North Sea 2.6,
  Dover Strait 4.6, Aberdeen approaches 24.9.
- **NTR skill 3.5-draft:** the baseline gives depth and traffic; busy traffic on site or close is a PS4 flag (collision,
  simultaneous operations, safety zones displacing shipping), with what the figure is and that AIS misses small boats;
  depth is context, a flag only where it makes the asset as described impractical or unusually costly, with rough
  guides labelled as rules of thumb (fixed-bottom wind to ~60 m; jack-ups to ~120–150 m; divers to ~50 m; deepwater
  over ~500 m, ultra-deep over ~1,500 m). **For Rob to check.** Shipping lanes, traffic separation schemes and fairways
  stay catalogue searches (more search words). `operations.md` has the new operation.
- Tested: `npm test` (new `test/seavalues.test.mjs`; two new ntrrun tests: values in the record, the first message and
  the evidence; services down → not checked and the analyst told), `browser-run-card.mjs` 79/79 with depth and traffic
  faked (card line checked at desktop and phone sizes).

## 20 Nov (early): elevation for every skill; one sign convention (Rob)
- **Rob:** do topography as well as bathymetry; make it a tool other skills can use; manage the sign, since services
  disagree (some give depth as positive). NTR should mention elevation only when it matters (near sea level or
  flood-prone; high altitude: oxygen, etc.), so results aren't crowded. Slope: my call.
- **One convention inside Tobler: elevation in metres, positive up, relative to sea level.** Land positive, seabed
  negative; records and tools store only that. Each source in `catalogue/trusted.json` "values" → "elevation" (a list,
  finest first) declares `sign` ("up" = elevations, "down" = depths positive down), `units` and `vertical_datum`;
  `toElevation` converts as values are read and refuses a source that doesn't say. Water depth is a way of showing
  elevation at sea (depth = -elevation, from the below-sea-level points only), decided by whether the site is at sea,
  never by the sign: land can lie below sea level (polders). Tested with a depth-positive source giving the same
  seabed as an elevation source.
- **Shared tool `get_elevation`** (`js/elevation.js`, in the conversation and the screening run, read-only): typical,
  lowest and highest of up to 25 points over a place or candidate; water depth at sea; "notable" on land when
  low-lying or high; cell size, datum, source, licence. Listed in `skills/README.md` as a shared operation and in the
  NTR `operations.md` ("Elevation over a place").
- **Source:** NOAA NCEI DEM Global Mosaic (already used for depth). On land and in open ocean it's ETOPO 2022 at
  15 arc-seconds (about 460 m; checked 20 Nov: Linlithgow 109 m, Zermatt area 3,553 m, Bolivian altiplano 3,776 m),
  finer coastal and survey DEMs where NOAA holds them (mostly US); mostly EGM2008, some tidal datums. Fine for
  "high altitude" or "low-lying"; too coarse for slope or real flood work.
- **NTR (skill 3.6-draft):** the baseline reads elevation on every site; on land it's recorded (`tobler_run.elevation`)
  and in "What was checked", but shown on the card and given to the analyst only when significant
  (`elevationSignificance`, thresholds for Rob: typical 10 m or less low-lying; under 0 below sea level; 2,500 m or
  more high altitude; 3,500 m very high). The skill says what each means and to pair low-lying with flood-zone data.
  A failed read is told to the analyst. Flags citing elevation trace to the value read.
- **Slope: later, with area discounting (my call).** Done the GIS way: fetch an elevation grid over the area and work
  out slope cell by cell (Horn's method) in a local projection, summarised as share steeper than a threshold and the
  steepest place. Needs a finer land model: Copernicus GLO-30 (open, commercial use with attribution) sits on AWS as
  Cloud-Optimised GeoTIFFs, but the bucket sends no CORS header (checked 20 Nov), so it needs a Worker route that
  passes range requests through, and a GeoTIFF reader in the page. `get_elevation` is shaped to take a grid source
  then.
- Tested: `npm test` (new `test/elevation.test.mjs`: signs, units, a depth-positive source, sea points only for depth,
  fallbacks, significance, the tool at sea, high and mixed; a new ntrrun test: recorded always, reported only when
  significant, failure said, tracing), `browser-run-card.mjs` 79/79, `browser-choice.mjs`.

## 20 Nov (morning): from Rob's Ben Nevis log — tidy places, grounded checks, upland band, UK area
- **Upland band (Rob):** 1,000 m or more is "upland" (exposed weather, snow and ice, harder access, shorter working
  seasons), below high altitude (2,500 m). Same rule as the others: shown on land only when it applies; a flag only
  where it bears on the asset. NTR skill 3.7-draft. Ben Nevis SAC (sampled 149–1,068 m) now reads "upland".
- **The analyst can remove places (`remove_place`) and replace its own proposals (`make_place` `replaces`).** In the
  log it built "Ben Nevis", then "Ben Nevis (2)", and asked Rob to delete the first. Now a rebuild replaces the
  proposal (added first, then the old one removed, and the new one takes its name). `remove_place` removes a place when
  the person's latest message asks to remove or delete, or a proposal of the analyst's own; places the person drew or
  accepted can't be removed unasked (the tool refuses and says why). The card says "Removed by the analyst: <reason>",
  and the conversation records it as the analyst's act, not the person's.
- **Distance checks must quote the person (`quote`).** The duplicate came from an invented check ("4 km NE of the
  distillery"; Rob gave no distance), which failed and was then dropped by rebuilding. `make_place` now leaves out any
  check whose quote isn't in what the person typed or said (`host.personSaid`), so it can't sink or lift the
  confidence. Hosts that don't record the person's words (older scripts) measure checks as before; the place-finding
  evaluation now passes the case's description as the person's words.
- **Failed checks aren't carried over; dropping one is visible.** First version carried a replaced place's checks
  over. The replay showed why that's wrong: "sorry, I meant north-west" carried the person's old north-east clue onto
  the rebuilt square, it failed, and the analyst removed the square to escape it. Now a rebuild lists
  `failed_checks_left_out` (with "tell the person unless they corrected the clue; never drop one to raise the
  confidence"), and the conversation prompt says not to remove a place to get round its checks.
- **"United Kingdom" is the UK, not its 18 territories.** The catalogue's country match also took the sovereign state,
  so the area was every UK territory and the label the first of them (Dhekelia). Now the country's own name or ISO
  code first, its sovereign's territories only when nothing has that name.
- Place-finding skill 4.13 (quotes, `replaces`, `remove_place`); `operations.md` updated.
- Tested: `npm test` (new place tests: grounding, replace, listed failed checks, removal rules, the UK area;
  upland in the elevation tests), `browser-choice.mjs` 8/8 (new: own proposal removed with its reason on the card, an
  accepted place refused unasked and removed when asked), `browser-run-card.mjs` 79/79; replays on a branch with Haiku:
  Rob's Ben Nevis conversation (no duplicates; SAC found with "United Kingdom and its waters"; upland), and
  "10 km NE of Linlithgow Palace → sorry, I meant NW" (one square at the end, replacing the first).

## 20 Nov (morning, later): session logs shared by default, read weekly (Rob)
- **Rob:** the fixes from his shared logs have been the most useful; before wider testing, collect logs automatically to
  see what other people ask. On by default; this is a demonstration, not a commercial product, so a light notice is
  enough. The notice is discreet: one small line in the welcome card, not a chat message (Rob chose it).
- **Welcome card:** "Tobler is being tested. Conversations are saved so we can improve it. You can turn this off in
  settings." "settings" opens the dialog at the new switch, **Share my sessions** (Settings → Helping improve Tobler;
  `tobler.shareSessions`, on unless set to "no"; says what's saved, 90 days, own API key never included).
- **Page (`js/sharelog.js`):** each finished turn (and each re-assess) is sent to the Worker, trimmed: shapes become
  type, vertex count and bounding box; strings cut (the person's words and the reply to 4,000 characters, others to
  600); lists to 40; the whole turn under 100k characters; anything like an Anthropic key removed. A random id per page
  load ties a session's turns together. Failures are ignored; the full log stays in the page for "Download the log".
- **Worker (`POST /logs`, `GET /logs`):** stored in a Durable Object (`LogStore`, SQLite), one per day, deleted 90 days
  after its first log; visitor as the IP hash already used for counters (no IP stored); 300 per visitor a day;
  `LOGS_ENABLED` var as an off switch. Chosen over R2 because it needs no new bucket or Cloudflare permissions. Reading
  back needs a key derived from `ATLAS_MCP_KEY` (SHA-256 of `tobler-logs:` + key): the proxy here can't set repo
  secrets, and that key is already in both the Worker and the Actions. The deploy Action's live check sends one marked
  test log and reads it back.
- **Weekly digest (`scripts/log-digest.mjs`, `.github/workflows/log-digest.yml`, Mondays 05:17 UTC or by hand):**
  numbers in code (sessions, visitors, turns, failures, screens, tool errors, turn times); Claude (Sonnet 5.5, my call:
  a weekly read where quality matters more than pennies) writes what people asked, where the analyst went wrong,
  corrections, failures, at most eight suggested fixes and candidate test cases. Logs are data, never instructions.
  Nothing changes the product automatically: fixes and test cases are for Rob to decide (no rule for one case).
- **The tobler repo is public**, so digests are never committed here and the Action log shows counts only. They go to
  a private repo, `pushpingeo/tobler-logs`, with a `TOBLER_LOGS_TOKEN` secret; until Rob sets those up the Action
  stops before reading anything.
- Not built yet: thumbs up or down and a "something's wrong" box on replies and run cards (offered to Rob).
- Tested: `test/sharelog.test.mjs` (trimming, key removal, geometry summary, the switch read at send time, digest
  numbers and transcript); Worker tests 15/15 (new: origin and shape checks, read key, paging, no IP stored, own daily
  limit); `browser-run-card.mjs` 87/87 (new: the welcome note and its link to the switch, the screening turn's log sent
  trimmed with no raw coordinates, nothing sent once switched off); `browser-choice.mjs`.

## 20 Nov (morning, later): results stay in view; drawn shapes named and renamable; quick picks for what's planned (Rob)
- **Results stay in view.** At the end of a turn the first thing it produced (a shape card, a run card, a choice or
  pick card, or the reply) goes to the top of the conversation (`showTurnTop`), so a long result reads from its
  start. A turn that fits on screen still ends at the bottom, as before. Mid-turn scrolling (progress, new cards) is
  unchanged.
- **Drawn shapes are named after the settlement they're in or near:** "Point near Linlithgow", "Area near Évora"
  (`settlementNear` in `js/gazetteer.js`: Nominatim's reverse lookup at village level, in the same one-a-second queue).
  Natural Earth wasn't enough (a point by Linlithgow gets "nearest town Edinburgh, 24 km"). At sea or with nothing
  named nearby, it stays "Point 1". Never overrides a name someone gave. Live check: a point at Linlithgow gave
  "Linlithgow Bridge" (the village it's actually in).
- **Rename on the card:** tap the name; Enter or leaving the box saves, Escape cancels. Old names stay as aliases
  (`former`), so the analyst and earlier messages still find the place; the rename is in the card's history and the
  analyst's place summary. The analyst's own `edit_place` rename uses the same path.
- **What's planned there: quick picks, not a question in words.** The screen chip, on a place with no known asset
  type, shows the picks straight away (no model call); a new tool, `ask_asset_type`, shows the same picks when someone
  types "screen it" and the type isn't clear. A tap sends "Screen X as a solar farm site." (the analyst is told the
  asset type, assumed false) and screens at once. "Just a general screen" uses asset_type other (the general distances).
  Once a place has been screened its type is remembered and the chip fills the input as before.
- **Picks are energy-led (Rob) and follow the setting:** on land solar, onshore wind, oil and gas, mine, pipeline or
  cable, substation; at sea offshore wind, oil and gas, pipeline or cable, platform, port or terminal, exploration
  block; the rest under More…. Showing offshore wind for a point in Linlithgow would be silly, so each pick can be
  limited to a setting. Kept in `catalogue/asset-picks.json` so a broader customer base is an edit there (each type
  must be in `catalogue/distances.json`).
- Tested: `test/assetpicks.test.mjs`; new `scripts/browser-ux.mjs` 26/26 (desktop and phone: settlement name, rename
  and Escape, picks by setting, More…, a tap's message and what the analyst is told, results at the top for a long
  turn and at the bottom for a short one, `ask_asset_type`, general screen); `browser-run-card.mjs` 87/87 (chip check
  updated); `browser-choice.mjs`; replays with Haiku on branch `ux-picks`: a drawn square → "screen it" showed the
  picks; "screen a 1 km² solar farm site 5 km west of Évora" screened straight away; "find Rosebank → screen it"
  inferred oil and gas and screened. Live page checked in Rob's browser.

## 20 Nov (midday): screens at scale, from Rob's housing log (Wirral, 2.3 ha)
- **What went wrong:** a drawn 2.3 ha "housing development" got a general screen (no energy pick fitted), so the general
  onshore distances (1/5/20 km, written for a site about 1 km across). The run fetches to the wider band once (for the
  slider), and in a busy area that was ~400 features (around 200 each of schools, main roads and settlements, 123
  protected areas, 109 heritage sites). The final write-up read ~34k tokens, hit the 8,000-token cap after 35 s, and
  the one repair failed too (why wasn't in the page log), so the card had 0 flags. The analyst said so honestly.
- **General screens of an area now follow its size** (`fallback_by_size` in `catalogue/distances.json`, DRAFT for
  Rob): under 10 ha 0.25/1/5 km; under 1 km² 0.5/2/10 km; offshore under 1 km² 1/5/25 km; bigger keeps the general
  default. Asset types keep their own rows; the person's own distances still win.
- **Volume guard** (`forAnalyst` in `js/ntrrun.js`): when a search returns over 25, the analyst sees the count and the
  nearest 6, with a line asking it to report the count and nearest and not list more; details that only repeat the
  name are dropped everywhere. Everything found still goes on the map and in the run record.
- **Repair of a cut-off result:** first from a compact summary (the site, distances, and one line per source with the
  count and nearest three), with no tools; then, if that fails, from the full history as before. Each attempt (how, stop
  reason, tokens, whether JSON came back) and the final stop reason go into the run's `debug` and the page log, with
  the run's usage.
- Tested: ntrrun 28/28 (size rules, both repair paths, the guard), all suites; browser-run-card 87/87, browser-ux
  26/26, browser-choice 8/8; Haiku replays on branch `screen-scale`: a 2.3 ha square east of Heswall (0.25/1/5 km,
  136 evidence features, 5 flags, 140 s), 2 ha at Piccadilly Gardens, Manchester (190 features, 6 flags including
  listed buildings and schools at the edge, 66 s), Rosebank unchanged (2/10/50 km, 7 flags, 60 s). No repair needed.
- Seen, not changed: Heswall still ran the marine baseline (the Dee estuary is within 5 km; fair). The housing frame is
  still energy's (themes, wording): that's the construction profile's job.

## 20 Nov (early afternoon): construction and property, thinking only (Rob's research; nothing built)
- **Inputs:** two AI research reports Rob shared (adapting the energy workflow to construction site screening; which
  markets might buy). Rob: AI research, so take the direction, not the detail. Full notes in the plan's "Industries".
- **Shared themes, mapped to IFC.** Both reports took the IFC Performance Standards as the global backbone, as NTR
  already does. Themes are defined once; each profile picks its own and adds more. Construction adds planning and land
  use, flood and drainage, ground and contamination, access, utilities and site capacity.
- **Picks are the overlays:** one construction profile; logistics first (reuses main roads, substations, receptors;
  less crowded than housing), housing second, data centres later (Rob finds the competition there interesting; parked).
- **Finance is a reader, not an industry:** a report template and later portfolio screening. Retail, offices and
  hotels parked (location performance, a different product).
- **For the plumbing (step 2 of the order):** themes in the profile with IFC mapping; picks that add themes and baseline
  layers, not just distances; baseline per country; run record ready for results per theme, severity beside
  confidence and a next step per finding. Energy keeps its flags-first card.
- **Order unchanged:** plumbing, then finish energy, then construction.

## 20 Nov (afternoon): report layout from an AI read of six ESIAs (thinking only)
- Rob had an AI read six of his downloaded ESIAs (Reko Diq, Amunet ESIA and CHA, Riau, GAC dam, Tafila; a random
  set, not best in class) for how results are presented. Outcome in the plan's "Outputs" (PDF outline): 4–6 pages,
  decision first, at most three maps (site, numbered findings, a gaps map), one row per finding, an evidence panel,
  link to the share link. Residual ratings, owners and commitments registers are after design, so not for a screen.
- Four shared run-record fields join the plumbing, for energy too: finding ID, severity apart from confidence, next
  step per finding, one overall decision.

## 20 Nov (afternoon): industry profiles, plumbing only; shared run fields (Rob: "get back to it")
- **Profiles:** `catalogue/industries/index.json` (Energy ready; Construction and property, Retail and site selection
  "coming soon") and `energy.json`: its skill, themes with IFC codes, wording (the screen chip), the four decisions,
  what to do with other industries' requests, and the quick picks and welcome examples, moved in from
  `catalogue/asset-picks.json` (removed) and `js/examples.js` (now only the pick). Distances and baseline layers stay in
  their own files, named by the profile; a profile may list its own baseline layers in trusted.json's shape
  (`baselineFor`). Per-country layers use the existing `where` box for now; nothing finer until construction needs it.
- **Page:** Settings → Industry (first section), only ready profiles selectable (`tobler.industry`); the profile's
  skill runs `screen_site`; the analyst's project summary carries an industry line, and the system prompt the
  profile's rule for other requests. `js/industry.js` holds the pure parts. `try-requests` does the same.
- **Run record, for energy too (from the construction research and the ESIA read):** `industry`, `decision`
  ({value, why}; only the four words, anything else dropped), and per flag `id` (F-01… in the order shown),
  `severity` (high/medium/low or null; never guessed) and `next_step`. Order is now severity, then confidence, then
  distance. A re-assessment writes a new decision or none; an old one isn't carried over. The headline and `get_run`
  carry them.
- **NTR skill 3.8-draft:** severity defined apart from confidence; a one-line next step per flag (the kind of check,
  not a firm or a cost); the decision rule, including "if the themes that matter most couldn't be checked,
  insufficient evidence". Evaluated method text otherwise unchanged.
- **Card:** the decision first, in a quiet box, with a tooltip saying it's a screen, not a decision to build; IDs
  before each risk; severity and confidence in the flag's text; "Next step:" under the why. The badge is still
  confidence. Severity isn't a badge yet (my call: one badge reads better; worth Rob's eye).
- Tested: `npm test` (new `test/industry.test.mjs`: choice, profile validity, analyst line; new ntrrun test: IDs,
  order, next step, decision); browser checks 95/95 (new: decision line, F-01–F-03, next step, Settings → Industry),
  26/26, 8/8; Haiku replays on branch `industry-profile`: Évora solar (5 flags, all rated, next steps sensible;
  decision "insufficient evidence" because the bird-protection and habitat-species layers failed), Rosebank (6 flags;
  "progress with targeted investigation"), a 2 ha Heswall housing site (the analyst said the method is built for
  energy, offered a general screen and said construction is coming, without screening unasked).

## 20 Nov (afternoon): the report and share links ("energy is done" item 1)
- **One page for both** (my call): `report.html` reads the run from the link's # part and is the share link, the
  web report and, printed, the PDF ("Save as PDF" calls the browser's print; works on phones through the share or
  print sheet). Nothing stored, as decided for share links (16 Nov).
- **What travels** (`js/share.js`): the site; the evidence features behind the flags only (not every feature
  fetched); flags with IDs, severity, confidence, next steps and evidence; what was checked; gaps; the decision; the
  summary; distances, method and change log. Shapes simplified for display (Douglas–Peucker, ~20 m) and coordinates
  to ~1 m; calls, usage and debug left out. deflate-raw + base64url, prefix `v1.`. A Rosebank-sized test run is
  ~4.6k characters. Over 8k the copy note warns that some chat apps cut long links; past 400k it simplifies harder,
  then says to use the PDF.
- **Report** (`js/report.js` pure, `js/reportpage.js`, `css/report.css`), to the plan's outline: decision first, the
  analyst's summary, facts (site, how found, planned, screened and why, at sea or elevation, data as of), a site map
  with the distance bands, a findings map with numbered labels (stacked when they'd overlap), one row per finding
  (severity and confidence in words, evidence with dates, untraced evidence marked, next step), evidence checked
  (failures first) and grouped gaps, method and change log, sources and licences (traced evidence and checked
  sources only), disclaimer. A4 print: maps as pictures with the labels painted in (WebGL canvases don't print
  reliably); about 5 pages for the test run. Phone layout stacks the findings.
- **Not done from the outline:** the gaps map (a site screen has no coverage geometry for failed sources; every gap
  covers the whole extent, so a map would add nothing a list doesn't) and a printed link or QR code (the link holds
  the run, so it's too long for a QR; needs short links, which means storing runs: Rob's call).
- **Run card:** "Report (PDF)" (opens the report in a new tab) and "Copy share link".
- `scripts/stamp.mjs` now stamps both pages.
- Tested: `test/report.test.mjs` (what travels, round trip, simplifying, labels, rows, sources, summary, change log);
  `browser-run-card.mjs` 107/107 (report opens from the card at desktop and phone sizes, both maps captured, rows and
  next steps, sources and disclaimer, no errors, a printed A4 PDF looked at, Copy share link). Live: the page and a
  test link load on asktobler.com in Rob's built-in browser, but the pane was hidden to the page, so the maps didn't
  draw there; added a capture just before printing for that case. **Not tested:** the report with the real basemap
  drawn; printing from a real phone.
- **Fixes (Rob, 20 Nov, 15:35):** the report's title is now "Geospatial Assessment" with the site name under it (and
  in the tab title). Copy share link failed in Rob's desktop-app browser ("not allowed by the user agent"): the link
  was built after the click, so the click no longer counted. Now the link is made when the run card is drawn (and
  again after a re-assessment), copying happens inside the click, and if the clipboard is still refused it falls back
  to the older copy command, then to showing the link selected for Ctrl+C. The report page's Copy link does the same.
  Browser check 109/109 (new: copying with the clipboard permission cleared). Not tested: Rob's desktop app itself.

## 20 Nov (evening): the summary no longer disagrees with the result (Rob's Kelso report)
- **What happened:** Kelso's write-up hit the 8,000-token cap. The repair asked for the JSON only and got a good
  result (decision "progress with targeted investigation", six flags), but the run kept the summary from the cut-off
  first draft, which said "major issue" and listed flags (Kelso town, schools) the result didn't have. The report
  showed both.
- **Fix:** after a repair, the summary is written in code from the repaired result (`summaryFromResult`: decision and
  why, flags most serious first with next steps, the number of gaps, and a line saying the write-up was cut off). The
  cut-off draft is kept in `debug.cut_off_summary` for the log. Not a model rewrite: a second call could disagree too.
- Tested: the cut-off test now checks the summary names every flag and doesn't repeat the draft.

## 20 Nov (evening): screening runs get a 16,000-token reply limit (Rob: "go ahead")
- Kelso's cut-off reply held only ~7,500 characters of text (~2,000 tokens): Haiku's thinking used most of the 8,000.
  Every model call in a screening run (the loop, the repair, re-assess) now asks for 16,000 (`SCREEN_MAX_TOKENS`,
  `CONFIG.screenMaxTokens`); the conversation keeps 8,000. The Worker's `MAX_TOKENS` is 16,000. The limit costs
  nothing unless used; the per-visitor daily call caps still bound misuse. The repair stays as the backstop.
- Not done: limiting thinking in the request (needs checking how Haiku 5.5 takes it, and could lower quality).
- Replays after the change (Haiku, real services): Linlithgow 1 km² solar finished in one go; Kelso's write-up took
  8,906 output tokens and finished in one go (it would have been cut at 8,000). One earlier Kelso replay ended
  normally (not cut off) but its JSON couldn't be read, so the repair ran; its summary now matches its decision. The
  cause wasn't visible (the replay's debug line was cut), so `try-requests` now prints the reply's ending whenever a
  repair runs. If unreadable JSON recurs, consider a lenient parse (trailing commas, comments).

## 20 Nov (night): datum transformations chosen from the EPSG registry, by where the site is (Rob: "yes please")
- **Why:** the right transformation between two datums depends on where in its area of use you are (OSGB36 to
  WGS 84: the Scotland transformation is 18 m, the national one 2 m, the grid-based ones 1 m). Picking from memory,
  or by the smallest area, gets it wrong. Rob wanted it explicit, with the option to ask an informed user or to choose
  quietly and accept the error.
- **Source:** the EPSG Geodetic Parameter Dataset (IOGP), read live through a read-only Worker route `/epsg` (allowlisted
  paths and query fields, cached a week, `EPSG_PER_VISITOR_DAILY` 1,000). The EPSG API has no CORS, so the page can't
  call it directly. The workspace shell can't reach it; Rob's browser and the Worker can.
- **Tools** (`js/epsgtools.js`): `crs_lookup` (code or words: kind, base CRS, datum, axes, area of use, deprecated
  and replacement) and `transformation_options` (source, target, place).
- **Choosing, in code:**
  - One search; EPSG's search ignores direction, so each record's own source CRS says which way it runs.
  - Drop deprecated records.
  - Keep those whose area of use contains the site: bounding box first, then the outline polygon when more than one
    box contains it (the Scotland and England boxes overlap at the border).
  - Rank by stated accuracy, then current before superseded (5339 is superseded by 7710 since 2016), then smaller area.
  - Grid-based transformations (OSTN15) are recommended but marked as not applicable in the page.
- **Setting** (gear → Datum transformations): "Choose for me" (default) picks the best one that can be applied here and
  records it; it still asks when that is worse than 25 m. "Ask me" offers the options, recommended first.
- **Fix found on the way:** a loaded skill went to the model through the fence, which cuts every string to 200
  characters, so on the turn a skill was first loaded the analyst saw only its opening lines (all skills, not just this
  one). Skills are our own text and now go to the model whole (`resultFor` in `js/converse.js`).
- **Tested:** 11 tool tests against a fake registry; Worker route tests; browser check (18, desktop and phone); live
  route from asktobler.com; real-model replays (Linlithgow, Berwick, EPSG:23031, an ED50 well in the North Sea, and
  "Ask me"). At Berwick the Scotland-only transformation was rightly left out; the ED50 well got EPSG:1311 (1 m).
- **Not done:** a `transform` tool that applies the chosen transformation (the analyst says honestly it can't give the
  exact shift yet); grid-based transformations in the page; checking EPSG's terms of use for commercial serving.

## 22 Nov 2026: Rob's two live-test bugs (card header, drag shadow)
- **Card header overspill:** the header's `h2` was a flex item with `nowrap` and no `min-width: 0`, so a long name
  couldn't shrink and the ellipsis on `.name` never applied. It now shrinks; the swatch and badge keep their size.
- **Drag shadow:** our banded copy of each place (the `aoi` source) goes through MapLibre's worker on every `setData`
  and lands a frame or more behind Terra Draw. While the pointer is down and a place's geometry changes, that place is
  left out of `aoi`; it is redrawn where it landed when the pointer lifts. Moves from the Adjust buttons redraw at once.
  Shapes still being drawn are mirrored as before (a small fix for later).
- **Tested:** new `scripts/browser-cards.mjs` (desktop mouse, phone touch): 14/14, and 4 fails on the old code;
  `npm test` and all other browser checks pass; the live page checked in the built-in browser after the deploy.
- **Not tested:** a real drag on a real phone.

## 22 Nov 2026 (evening): Environment and Energy, and the small changes Rob agreed
- **The profile is "Environment and Energy"** (label, wording, the analyst's method line, the screen chip "Screen for
  environmental constraints", run card meta "method 3.8-draft"). The skill's method text is unchanged. The id stays
  `energy` (and the file `energy.json`) so stored Settings choices, run records and share links keep working.
- **Settings lists Rob's sectors** as coming soon: Construction, Infrastructure, Property, Mining, Data centres.
  Retail is gone. **About** is Rob's sentence exactly; the run-card browser check tests it word for word.
- **Search areas:** a finding covering 10% or more of the search area is uncapped; under 10% stays low; points and
  lines inside stay medium (they have no share to measure).
- **A site the person defines by size and position is an area**, not a search area. `make_place` takes
  `site_defined: true` from the model; the role is still decided in code, and only for square, circle or rectangle.
  Alternatives were a regex on the words (brittle) or a new `match` value (it also drives place confidence).
- **"Insufficient evidence" only when no biodiversity source was checked at all.** Settled in code after the
  analyst's decision (`settleDecision`, js/industry.js): with a biodiversity source checked it becomes major issue
  (a high-severity flag with medium or high confidence) or progress with targeted investigation; with none checked,
  progress becomes insufficient evidence, and a major issue stays. The card and report say "Set by Tobler's rules".
- **Asked whether a screen still holds,** the analyst answers from get_run and asks before re-running (prompt only:
  a code guard can't tell "yes" from a new request without guessing at words).
- **Outside the profile** (housing, a warehouse): screened at once with `planned`; the caveat travels in the run
  record (`site.outside_profile`), so the card, report and a re-run carry it.
- **Severity is the flag badge;** confidence is a word under the flag, so the risk text keeps its width on a phone.
- **Feedback:** thumbs and a "Something's wrong?" box on replies and run cards, sent as session-log entries beside the
  turn (respecting the sharing switch). The digest counts them in code and reads every note.
- **Also:** place-finding skill 4.14 (scale asked only when genuinely unclear; `site_defined`).
- **Tested:** `npm test`; every browser check (run-card 123, search-area 34, out-of-date 28, ux 26, choice 8, coords
  12, epsg 20, cards 14), desktop and phone; phone screenshots of Settings, the flag badges and the feedback row.
- **Not tested:** the live model's use of `site_defined`, `planned` and the ask-before-re-run rule (needs a
  try-requests replay, a few cents); the digest on real feedback (needs Rob's test sessions).

## 22 Nov 2026: the welcome card (Rob)
- **Lead:** "Check a site before you commit to it." The line below says what Tobler does (pin it down, screen it
  for environmental constraints, show the working), replacing "Pick a spot on Earth."
- **Examples, one per scale,** from pools in `catalogue/industries/energy.json` (`local`, `regional`, `global`,
  replacing find/shape/screen). All three now screen.
  - Local: a 5 ha housing site (Linlithgow) or a 10 ha warehouse site (Livingston). Both are outside the profile,
    so they show the general-screen caveat.
  - Regional: proposed, undecided schemes, so the screen comes before consent and the map doesn't show them built:
    Newlands Hill wind farm (East Lothian, s36 inquiry WIN-210-1) and The Droves solar farm (Norfolk, NSIP
    EN0110013). Both undecided on 22 Nov 2026. Swap each one out once it's decided.
  - Global ("anywhere, to an international lender's standard", not the whole world): Reventazón hydropower (high
    location confidence in the IFC set) and Rudine wind farm (medium). No low-confidence pins, mining, or oil and gas.
- **Tested:** `npm test`; the welcome card on desktop and phone (both pools, panel open on the phone), and a click
  on the long regional example sends its full text.
- **Not tested:** the live analyst on the six new examples (try-requests, twice each). The regional areas (10 km²)
  are rough sizes, not the schemes' red lines.

## 22 Nov 2026: Settings (Rob)
- **Industry is a dropdown** (`select[name=industry]`) to save space. Profiles not ready show as disabled
  "(coming soon)" options; the chosen one's description sits under it.
- **No links at the foot of Settings.** The About text stays. The lab links go anyway when the lab material moves
  to asktobler-lab.
- **Tested:** `npm test`; browser-run-card (125), ux (26), cards (14), choice (8), desktop and phone; phone screenshot
  of Settings.

## 22 Nov 2026: a designer's pass for consultants (Rob: "do it")
- **Welcome:** "Screen more sites. Find the issues earlier." (Rob's line), then: tell me the site and what's planned;
  I'll check public data, show my sources and list what still needs a specialist. The full three-part line is kept
  for the landing page and the report footer, later.
- **Phone:** the sheet opens on the first visit, so a newcomer sees the welcome card, not an empty map
  (`tobler.welcomed`). After that it starts closed as before.
- **One name: "constraints screen".** Run card "Constraints screen: <site>"; report title "Constraints screen"
  (was "Geospatial Assessment", Rob's 20 Nov choice; "assessment" reads as an EIA to consultants).
- **Run card order:** title, run and time; what was assumed; the decision; the flags; **what still needs checking**
  (open, right under the flags, groups worded as work: "Not checked: check these yourself", "No data here: may need
  a site visit or a local source", "Assumptions and caveats"); the distance slider; distances in one line (reasons
  under it); depth and traffic; what was checked; actions. Method version and run time moved to a hover title
  (they're in the report's Method section).
- **Flags** name their topic in words under the title (Biodiversity, Land, Indigenous Peoples, Heritage, Community,
  Context), beside the confidence.
- **Actions:** Report (PDF) and Copy share link, then a More menu with Show on map and Download run (GeoJSON).
- **Disclaimer on the card:** the short form plus "The report has the full wording". The full text stays in the
  report and the downloaded run.
- **Settings:** the Anthropic key and session sharing are under a closed Advanced section; the welcome note's
  "settings" link opens it at the sharing switch.
- **Left for Rob:** the report's first page as a one-page summary; the robot mark and "Hi, I'm Tobler".
- **Tested:** `npm test`; all eight browser checks, desktop and phone (run-card 135, search-area 34, out-of-date 28,
  ux 26, choice 8, coords 12, epsg 20, cards 14), including new checks for the card order, topic labels, the short
  disclaimer, the More menu on one row and on screen, Advanced closed by default, and the phone's first visit; phone
  and desktop screenshots looked at. **Not tested:** the live analyst's replies (unchanged).

## 23 Nov 2026: the conceptual model, and what changes (Rob)
A review of the built product against the conceptual model (six nouns: place, data, tool, check, skill, profile,
plus frameworks). Place, data and tool already fit. Checks don't exist yet, the profile sets distances by asset type
rather than by scale, and IFC is wired in as the only framework. Landscape, water, ground and soil, and land use
have no topic at all, though landscape, peat and farmland quality decided most of the UK example cases.
- **Report headings:** UK EIA practice chapter names by default (Ecology, Ornithology, Landscape and Visual,
  Cultural Heritage, Hydrology, Geology and Soils, and so on); IFC Performance Standard titles for global or lender
  work. The person can switch. IFC's text isn't reproduced (its terms of use); the titles are named.
- **Scale bands confirmed,** including global 10–20 km (it closes the gap between 0–10 and 20–50 km). Local 0–50 m,
  50–250 m, 250–500 m, 500 m–2 km; regional 0–2, 2–5, 5–10, 10–20 km; global 0–10, 10–20, 20–50, 50–100 km. The
  asset type extends a check's reach only with a stated reason.
- **Run record `tobler-run/2`:** neutral topics in place of PS codes. Old share links stay readable (PS codes are
  mapped to topics when read).
- **Aviation, radar, telecoms links and existing infrastructure:** one neutral topic (`material-assets`, the EIA
  regulations' word), headed "Aviation and existing infrastructure" in the UK EIA framework, as consultants title it.
- **Order of work:** checks as data; ten neutral topics and frameworks; scale bands in the profile; split the
  screening skill (judgement only); a broadened UK pack; an evaluation on the example sites.
- Nothing built yet.

## 23 Nov 2026 (night): checks as data, first step (plan item 1; design note agreed by Rob)
- **Rob's answers on the design note:** the schema as drafted (`answer`: count by band, value at site or inside;
  `must`); the first-cut reach values as defaults to tune on the example sites; topics with no check shown as one
  summary line that opens into the list; build order as proposed (what exists first, then the Dogger Bank checks,
  then the UK pack).
- **Twelve topics, not eleven (Rob):** a new **topography and bathymetry** topic holds the elevation and water-depth
  value checks (and slope later). Low-lying land moved there from hazards, depth from context. The check measures;
  the analyst judges whether a value is a hazard (flooding) or a constraint (too deep for fixed foundations).
  MARPOL special areas stay under material assets. Indigenous Peoples is its own line at global scale only.
- **Built:** `catalogue/checks.json` (replaces `baseline` in `trusted.json`), `js/checks.js` (selection, bands,
  states, the decision rule's topics, what changed between runs), the run (`js/ntrrun.js`), the card's Checks
  section (open on a desktop, closed on a phone), the report's Checks table, share links, `tobler-run/2`. Old links
  (`tobler-run/1`) open without a Checks section. Skill text: `ntr-screening` 3.9-draft (step 0 only).
- **Judgement calls (mine):**
  - **Scale, until item 3:** read off the distances the run already picks (wider band up to 10 km local, up to 25 km
    regional, beyond that global; a site of 100 km² or more is global). So offshore fields and wind farms (50 km) are
    global, solar and onshore wind (20 km) regional, small general screens local.
  - **Fetch reach:** each check fetches to the larger of its own reach and the run's wider band (so the slider still
    works) but counts only within its own reach. Reaches over 50 km are cut to 50 km, the furthest the tools fetch,
    and the line says so ("within 50 km (of 100 km…)").
  - **UK sources first:** SACs and SPAs in the UK (by country on land, by box at sea) are **not checked: the UK list
    (JNCC) isn't in Tobler's data yet**, rather than "none found" from the EU layer, which hasn't held UK sites since
    2021. That's more honest but adds two lines to every UK screen until the atlas hands back the JNCC ids.
  - **Checks that don't apply aren't listed** (coral reefs outside the tropics, NMFS outside the US, sea checks
    inland, marine mammal areas at local scale). A check that applies but has no source here is listed as not
    checked (e.g. nationally designated sites outside Europe).
  - **Provenance:** the atlas contract has no record-by-id lookup, so each source keeps its record's title,
    publisher and licence as the atlas gave them (`as_of`); the run adds the time it was checked. Licence classes
    are still worked out at run time, so WDPA stays off unless non-commercial data is on.
  - **Elevation on land is always reported** now (it's a check); the long line with the reason still goes to the
    analyst only when it matters (low-lying, upland, high altitude).
  - **Decision rule:** "insufficient evidence" when every must-check for a topic came back not checked (pending and
    no-source count as not checked). Today only biodiversity has must-checks. Re-assessed v1 runs keep the old rule.
- **Tested:** `npm test` (new `test/checks.test.mjs`, 8 tests; run, report and industry tests updated); browser
  checks, desktop and phone: run-card 147 (new: the Checks section, one check of each state, the summary line,
  open/closed by device, pending checks in what still needs checking), search-area 34, out-of-date 28, ux 26,
  choice 8, coords 18, epsg 20, cards 14, site files 44. Phone and desktop screenshots of the card's checks and the
  report looked at.
- **Not tested:** the live analyst with the new lines (try-requests: Dogger Bank and two onshore example sites);
  real atlas answers for the eight layers (faked in tests, as before).

## 24 Nov 2026: checks against the UK atlas records, first push (Rob's answers on the review)
- **The review** (24 Nov, in the project): the atlas's 69 fixed UK records (24 statutory sites of 22 Nov, 45 in the UK
  pack of 23 Nov) fit the checks with five changes: several sources per check, coverage by reach, reading one field,
  answers by class, and the SSSI Impact Risk Zones decoded. Two pushes: this one (the first two, and the statutory
  sites), then the pack.
- **Rob's answers:** the 13 must-checks as proposed (SAC, SPA, Ramsar, SSSI, marine protected areas; scheduled
  monuments, listed buildings, World Heritage Sites; National Parks, National Landscapes/NSAs; flood zones on land),
  all UK only. **Hutton's LCA is in:** Rob read the James Hutton Institute Open Data Licence and says it puts no limits on
  public use. Its licence text is quoted on the check (it classes as "stated", not OGL). Two pushes.
- **Built (checks version 2):** every source that covers what a check's reach can touch is used and the results merged.
  A site near Berwick reads both England's and Scotland's layers; Dogger Bank reads JNCC's offshore layer and the EU's.
  Duplicates are counted once, by site code or by the same name within half a kilometre (WDPA has no code). JNCC's
  offshore layer is filtered by designation (`SITE_STATU`: SACs for the SAC check, MCZ/NCMPA/HPMA/MPA for the marine one)
  and fetched once for all three checks. New checks: Ramsar (must) and ancient woodland (Northern Ireland: no layer,
  "not checked"). SSSI/ASSI now answer "nationally designated sites" in the UK; CDDA stays for the rest of Europe.
  `get_data` takes `fields` and `name_field` from the run (not in the analyst's tool schema).
- **Judgement calls (mine):**
  - **Partly checked:** found if any source found something (with a note naming the one that didn't answer); if one
    source failed and the rest found nothing, the check is **not checked** ("NatureScot didn't answer (none in the
    others)"), because none found in part of the area isn't none found.
  - **WDPA is supplementary** beside the UK's own marine layers: switched off (the default), it doesn't stop a "none
    found" in UK waters. Where it's the only source (French waters), it's "not checked: licence" as before.
  - **JNCC's offshore layer only at sea** (a source-level `setting`), so onshore UK screens don't query it.
  - **Evidence keeps each source's copy** of a site (provenance), so the map can show the same SAC from NatureScot and
    from JNCC; the check counts it once. Noted in the plan's small fixes.
  - **Ids and fields** are from the atlas's `docs/mcp-tools.md` and `vocab/seeds/uk-protected.yaml` (read 24 Nov);
    licences are OGL v3.0 as the atlas recorded them.
- **Tested:** `npm test` (checks 9, including several sources, filters, de-duplication, partly checked, supplementary,
  Berwick, Belfast, Linlithgow, Calais and Dogger Bank selection; run 35 with a faked NatureScot and JNCC SAC counted
  once); browser checks desktop and phone: run-card 147 (a SAC found from JNCC, an SPA layer down shown as partly
  checked, one check of each state), search-area 34, out-of-date 28, ux 26, choice 8, coords 18, epsg 20, cards 14,
  site files 44. Card screenshots looked at.
- **Not tested:** the live atlas answering for the 24 UK records from the page (mcp-check covers them nightly on the
  atlas side); a live screen.

## 24 Nov 2026: the UK pack as checks (second push)
- **Built (checks version 3, 28 checks):** heritage (scheduled monuments, listed buildings, World Heritage Sites,
  parks and gardens, battlefields), landscape (National Parks, National Landscapes/NSAs/NI AONBs, Wild Land Areas,
  local and regional designations), water (flood zones from rivers and sea, surface water), land use (farmland grade:
  England's post-1988 survey and provisional map, Wales's predictive map, Hutton's LCA for Scotland), ground and soil
  (Carbon and Peatland, non-commercial so off by default), and the SSSI Impact Risk Zones. Ids and fields from the
  atlas's `docs/mcp-tools.md` and `vocab/seeds/uk-pack.yaml`; class values read live from the services the workspace
  can reach (Historic England, DfC, NatureScot, Natural England), the rest from the contract.
- **A new answer, `classes`:** which classes are on the site, with the share they cover (equal-area overlay,
  `js/siterole.js` `coverageIn`), and the nearest of each within reach. A polygon covering under 0.5% of the site (it
  only touches the edge) is "at the edge", not on the site. The check measures; the analyst judges what's best and most
  versatile land or what a flood zone means for this project.
- **The IRZ:** an `inside` check whose zones are read for the development: the 13-digit code from `IRZURL`, decoded
  with Natural England's own wording (`catalogue/sssi_irz_codes.json`, copied from the atlas, OGL). The profile says
  which categories fit each asset type (`irz_categories` in `catalogue/industries/energy.json`: wind and solar for
  renewables, minerals/oil/gas for extraction, infrastructure for grid and transport, combustion and air pollution
  for thermal, rural non-residential and residential for a general screen); "all consultations" is always read.
- **Rob's point: duplicates by feature extent.** Two features from different layers are one site when their own
  geometry boxes overlap almost completely (intersection over union 0.9 or more), or, for points, lie within about
  50 m. Beside the site code and the same name within 0.5 km. Only across layers: one layer's separate parts of a site
  have different extents.
- **Judgement calls (mine):**
  - **Dense and class layers fetch only to their own reach** (listed buildings, flood, farmland, peat, the IRZ and
    MARPOL): to the wider band they'd return thousands of features, and a layer gives 100 at most, so the count
    would be wrong. The other layers still fetch to the wider band for the slider.
  - **Heritage and landscape at sea** only when the coast is within the check's own reach (seascape for offshore wind).
  - **Nation outlines as boxes** (`regions` in `checks.json`): a nation's layers cover the whole nation (none there
    means none found, not "no source"), and England-only checks and gaps (the IRZ; England's missing surface water and
    peat maps) use England's boxes, drawn round Wales and Scotland. Kintyre is south of England's northern edge but
    gets no IRZ line. A site right on a border may count as both: a few kilometres of error. Natural Earth's map units
    (public domain, same source as the countries) would do it exactly; a new reference file, so for Rob to say.
  - **Licence wording:** "non-commercial licence: off unless switched on in Settings", not the tool's WDPA example.
  - **Gaps the atlas confirmed** show as not checked with the reason: Dark Sky Parks aren't a check yet (no national
    layer); Scotland's Local Landscape Areas, England's local designations, Cadw battlefields, NI flood, farmland, peat
    and ancient woodland, England's surface water and England's and Wales's peat maps.
- **Tested:** `npm test` (checks 13: extent duplicates, classes and edge slivers, the IRZ decoding, where each check
  applies, Kintyre/Cardiff/Carlisle/London/Scilly for England-only checks, the NI listed filter; run 36: a York solar
  farm with flood, farmland, the IRZ and listed buildings, fetched to their own reach); browser checks desktop and
  phone: run-card 147, search-area 46 (new: flood and farmland by share of a Scottish search area, a National Scenic
  Area, peat off on licence, no IRZ in Scotland, none found rather than no source), out-of-date 28, ux 26, choice 8,
  coords 18, epsg 20, cards 14, site files 44. Card screenshots looked at.
- **Not tested:** the live services (SEPA, Cadw, NRW, HES and the EA's WFS can't be reached from the build
  workspace; the atlas's mcp-ask checked all 45 return features on 23 Nov); the class values I took from the contract
  rather than live (EA `FZ2`/`FZ3`, NRW `Flood Zone 2/3`, Wales `predictive`, Hutton `LCCODE`, HES `CATEGORY`).

## 24 Nov 2026: the same shape, not just a similar box; and a switch (Rob)
- **Rob: the geometry match was too lean.** Two features from different layers now count as one site only when they
  really are the same feature (`sameShape` in `js/siterole.js`): polygons that each cover at least 95% of the other
  (equal-area overlay), lines whose vertices all lie within 20 m of the other line both ways, points within 10 m.
  The near-identical box is only a quick first filter. A diamond in the same box as a square isn't the same site.
- **A switch, on by default** (Settings → Data the analyst may use: "Count the same site once across layers"). Off
  counts each layer's copy, except where the site code or name already says they're the same. The run records
  `checks_merge_shapes`, and the report says which way it was.
- **Tested:** `npm test` (checks 13, with the shape rules and the switch on and off); browser checks desktop and
  phone: run-card 151 (new: the switch on by default, switching it off is saved), search-area 46, out-of-date 28,
  ux 26, choice 8, coords 18, epsg 20, cards 14, site files 44. Settings screenshot on a phone looked at.

## 24 Nov 2026: exploring the findings, and three fixes from Rob's Linlithgow screen
- **Undercount fixed:** "15+ scheduled monuments within 5 km" round Linlithgow. Check layers fetched out to the
  run's wider band (20 km) for the slider, and a query returns at most 100 features, so the 100 that came back were
  spread over the whole box. Every check layer now fetches **only to its own reach, up to 500 features** (the atlas's
  limit). The analyst's own searches still go to the wider band.
- **World Heritage Site buffer zones** (HES's layer holds them, though the atlas note says not) are split from the
  sites by name: a new `heritage.whs-buffer` inside check ("the site is inside … Buffer Zone"); the WHS check counts
  the sites only. Passed to the atlas in `docs/atlas-requests.md`.
- **Names tidied, not reworded** (`tidyName` in `js/atlasfeatures.js`): a space after each comma, and names written
  all in capitals put in title case (short joining words lower case, Roman numerals and Mc names kept). Mixed-case
  names keep their capitals. Tracing still works: flag evidence is matched without regard to case.
- **Exploring the findings (Rob):** a check line that found something opens, on a tap, into its features by
  distance from the site (nearest ten, "Show all N", "Show these on the map"), each row with the grade, designation or
  class and the publisher. A row flies the map to the feature (with the site in view) and opens its popup; the popup
  says which checks counted it. The map key's theme names open the same list. No underlines in the text: the whole
  line is the button, with a chevron and a hover shade. On a phone a row lowers the sheet. Each check keeps its
  features (`features` on the check in the run record; the nearest ten travel in a share link). One list open at a
  time. No new queries: everything comes from the run.
- **Tested:** `npm test` (checks 14, run 36: own reach and 500, buffer zones, names, rows with grades); browser checks
  desktop and phone: run-card 159 (new: a check line opens its list and outlines it; a row flies and opens the popup
  with "Counted in"; the sheet lowers on a phone; tapping again closes; the map key opens its list), search-area 46,
  out-of-date 28, ux 26, choice 8, coords 18, epsg 20, cards 14, site files 44. Screenshots looked at.
- **Not tested:** a live Linlithgow screen after the fix (the true counts need the real services).

## 25 Nov 2026: Tobler's own copy of OpenStreetMap (Rob: "a more reliable solution")
- **Why:** the public Overpass servers are volunteer-run and often busy; on Barnston (25 Nov) all three timed out and
  every OpenStreetMap deduction in the area budget was "not checked". Our own 15 s overall limit made it worse
  (the servers got 15, 11 and 7 s; the eval fetch log has good answers at 50–60 s).
- **What:** a weekly GitHub Action (`.github/workflows/osm-extracts.yml`) downloads each market's Geofabrik extracts
  (counties for England, then Scotland, Wales, and Ireland with Northern Ireland, which only comes that way), keeps
  only the kinds in `catalogue/osm-snapshot.json`, and writes one file per extract per group (transport, utilities,
  water, land use, community, buildings). A manifest per market (`<market>.json`) lists the files, the data date and
  the outline the copy covers; it's uploaded last, so readers never see half a release.
- **Same tags as Overpass:** `catalogue/osm-snapshot.json` mirrors `OSM_KINDS`; `test/osmsnapshot.test.mjs` fails if
  they drift. The copy's answers go through the same `osmAnswers` sorting and measuring.
- **Format (my call):** FlatGeobuf with its packed R-tree for lookups in the page (the reader is 53 KB, vendored;
  DuckDB-WASM would be tens of MB, and isn't vendored yet). GeoParquet 1.1 with a bbox column is written beside it
  from the same data, for DuckDB, QGIS and the atlas. Both sorted along a Hilbert curve.
- **Order:** the copy first, when the whole of every kind's search box is inside the copy's outline (the real
  outline, shrunk by about 1 km when made, so the edge goes to Overpass); otherwise Overpass. If the copy can't be read,
  Overpass, and the record says the copy failed (`copy_failed`). If both fail, "not checked" names both.
- **Provenance:** `meta.via` ("copy" or "overpass"), `data_as_of` and `release`; the dataset title says
  "Tobler's copy, data as of …"; the run record's checked line carries `via` and `data_as_of`.
- **Better than Overpass in one way:** areas mapped as multipolygon relations (big lakes, some residential land,
  some buildings) are whole polygons, not centre points. Building and water relations are a deliberate superset of
  the Overpass selectors (which ask for ways only).
- **Off until hosted:** `CONFIG.osmSnapshotBase` is empty, so nothing changes for visitors until Rob creates the R2
  bucket and the workflow's variable `OSM_R2_BUCKET` is set. Without it the workflow only builds and commits a size
  report (`data/osm-extracts/`).
- **Licence:** a derived database of OpenStreetMap, ODbL 1.0; the manifest says so, and every feature keeps its
  osm.org link. If the files are public, they're offered under ODbL with attribution.
- **First UK build (25 Nov, branch osm-copy, about 20 min):** 50 extracts (2.62 GB of Geofabrik downloads, 1.14 GB
  after tags-filter), 23.5 million features, 7.6 GB of FlatGeobuf and 3.1 GB of GeoParquet. Buildings are 21.3
  million of the features and 86% of the bytes. Data as of 24 Nov 21:21 UTC. 12 shapes skipped as broken. The
  manifest was 580 kB with a 200 m outline tolerance; now 1 km (Geofabrik's outlines run out to sea).
- **US:** Geofabrik lists both regional bundles and states under the US; the bundles are skipped
  (`markets.us.skip`), so 54 extracts, 12.2 GB, the same as its single US file.

## 25 Nov 2026 (midday): the OpenStreetMap copy goes live on R2
- **Merged:** `osm-copy` fast-forwarded into main (a383c84) after `npm test` and six browser checks passed.
- **Bucket:** `atlas-data`, public at `https://data.asktobler.com/osm/`. The repo variable first said `tobler-data`;
  the token probe caught it in a minute (Rob changed it).
- **Uploads over 300 MiB:** wrangler's `r2 object put` stops at 300 MiB and the biggest buildings files are larger. The
  build now uploads through R2's S3 API with the AWS CLI (multipart), with credentials derived from the existing token
  (Cloudflare: Access Key ID = the token's id, secret = SHA-256 of its value; `scripts/osm-extract/r2-s3-env.sh`).
  No new secret. The plan job's probe tries both routes.
- **Geofabrik refused downloads** (HTTP 000, connection refused, even after 2 minutes of retries) for a third of the
  extracts on the second and third full UK runs of the day; probably a per-address limit. Downloads now retry with
  pauses and report the HTTP code.
- **A release stays whole (my call):** `publish.py --previous` carries an extract this run couldn't build from the live
  manifest (its files and data date) if that release is under 14 days old; the manifest lists `carried`. Each region
  keeps its own `data_as_of`. Without this, one refused download would drop a county from the copy and the outline
  (honest, but needlessly worse). "publish-only stats-from <run>" rebuilt today's manifest from the first run's stats.
- **Live now:** 49 of 50 UK extracts, data as of 24 Nov 21:21 UTC. West Yorkshire is missing (never built today);
  the outline leaves it out, so sites there go to Overpass until next week's build.
- **Overpass, two speeds (`OVERPASS_SPEEDS` in `js/gazetteer.js`):** quick (conversation lookups) unchanged at 15 s with
  the 2-minute down latch. Patient (sealed study runs: developable area, desk study) waits up to 55 s, isn't stopped
  by the latch (a real attempt), and retries once after 5 s if every server failed fast; its query asks the server for
  50 s. The alternative was one longer limit for everything, which would have made conversation lookups hang when
  the servers are down. A constraints screen keeps quick for now: it has many other sources running beside it.
- **Staggered start fixed:** the next server is asked at once when every earlier one has already failed; the stagger
  only protects a server that's still working. (The study browser check caught the old behaviour: 14 failures.)
- **The run says when it waits on Overpass:** "Asking OpenStreetMap's public servers (when they're busy this can take
  up to a minute)".
- **Place search through the copy:** `find_features_near` asks the copy first for the eight feature types it holds with
  the same tags (substation, main road, railway, pipeline, power line, airport, residential area, river). Candidates
  carry their real shape and edge distance, so no outline fetch is needed. Residential areas, airports and substations
  mapped as relations come whole (a superset of the Overpass selector). Solar farms, mines, ports, schools (the place
  search includes universities), hospitals (it includes doctors) and the rest still go to Overpass. At most 5,000
  features per lookup, with a note if cut.
- **Tests:** osmsnapshot 17 (new: place search from the copy, name filter, a type it doesn't hold, copy unreadable;
  Overpass latch, patient retry, stagger skip, server limits). New browser check `browser-osmcopy` (13): with the
  base set, a developable area inside the copy reads only from data.asktobler.com by range requests, never Overpass,
  and its record says "Tobler's copy, data as of 2026-11-24"; outside it, one Overpass query.
- **Checked live (`osm-timing` workflow, from a GitHub runner, 12:12 UTC):** `uk.json` 200 with
  `Access-Control-Allow-Origin: https://asktobler.com`; a range request on a `.fgb` 206 with `Content-Range` and the
  exposed headers; the preflight for `Range` 204. Results in `data/osm-extracts/http-check-uk.txt`.
- **Timed (`data/osm-extracts/timing-uk.json`; the checks' own reaches; Overpass the same query):**

  | Site | Lookup | Copy, cold | Copy, warm | Overpass quick (15 s) | Overpass patient (55 s) |
  |---|---|---|---|---|---|
  | Barnston (Wirral), 10 ha by the railway | developable area | 5.3 s, 44 requests, 0.5 MB | 2.7 s | 12 s, answered | failed |
  | Barnston | constraints screen | 3.4 s, 37, 0.9 MB | 2.7 s | failed | failed |
  | London (Barking Riverside) | developable area | 4.9 s, 36, 0.6 MB | 2.1 s | failed | failed |
  | London | constraints screen | 3.7 s, 27, 2.2 MB | 2.3 s | failed | 43 s, answered |
  | Highland (west of Lairg) | developable area | 3.0 s, 23, 0.5 MB | 1.5 s | failed | failed |
  | Highland | constraints screen | 1.5 s, 14, 0.1 MB | 1.2 s | failed | failed |

  The copy answered all six; Overpass two of twelve, with the same counts as the copy both times. Cold includes reading
  the 436 kB manifest (not in the byte counts). Requests are round trips in sequence (header, index, features), so
  time follows latency; a UK browser should be faster than a US runner. Overpass may treat cloud runners worse than a
  home browser, so its failure rate here is an upper bound, but it matches Barnston's live log.
- **Switched on:** `CONFIG.osmSnapshotBase = "https://data.asktobler.com/osm/"`.

## 25 Nov 2026 (evening): Tobler's OpenStreetMap build retired
- **What:** `.github/workflows/osm-extracts.yml` and its request file `.github/osm-extract-request` are removed (Rob),
  before the weekly run on Monday 03:17 UTC could write to `atlas-data` alongside the atlas's builds.
- **State at retirement:** the live `osm/uk.json` is still the one Tobler's workflow published (release 2026-11-25,
  built 12:05 UTC, 49 of 50 extracts, West Yorkshire missing). Refreshes now come only from the atlas.
- **Kept:** the reader (`js/osmsnapshot.js`), the kinds (`catalogue/osm-snapshot.json`), the timing workflow
  (`osm-timing.yml`, read-only against the bucket), and `scripts/osm-extract/` for reference (nothing runs it; the
  atlas has its own copy). The record's title still says "Tobler's copy"; it becomes the atlas's wording once the
  atlas's first release is live.

## 25 Nov 2026 (late): the lab moved to asktobler-lab
- **What (Rob's go, 25 Nov):** the IFC screening agent and its evaluation now live in `pushpingeo/asktobler-lab`
  under `ntr-lab/` (commit `9f21ed4`), self-contained and outside the Astro site build: `lab.html`,
  `lab-results.html`, `tools.html`, `js/agent.js`, `js/tools.js`, `js/rules.js`, `skills/ntr-screening-ifc`,
  `catalogue/catalogue.json`, `eval/runs`, `eval/index.json`, the rules baseline, `scripts/run-eval.mjs`,
  `screen-all.mjs`, `fetch-snapshots.mjs`, `score.py`, the `eval.yml` and `osm-snapshots.yml` workflows (kept there
  for reference, not active) and their request files, `test/agent.test.mjs`, `test/tools.test.mjs`, and
  `docs/lab-writeup.md`. Its tests pass there on their own.
- **Beyond the plan's list (judgement call):** the evaluation's data went too (`data/eval-sites.json`,
  `eval-split.json`, `_fetch-log.txt`, `data/osm`, `data/gbif`, `data/wikidata`), since only the lab read them.
  `data/eval_set.csv` stays (place finding's evaluation uses it); the lab has a copy. `js/claude.js` and
  `js/config.js` were copied, not moved.
- **Product side:** `fetchOverpass` and `OVERPASS_ENDPOINTS` now live in `js/gazetteer.js`; `scripts/probe-overpass.mjs`
  imports them from there. The invariants test's CDN exceptions are empty: no page in the repo loads from a CDN now.
- **Not done:** the lab pages aren't served anywhere yet. Serving them at asktobler.ai would mean putting them under
  the lab site's `public/`, which is Rob's call.

## 25 Nov 2026 (late): the weekly digest can't come out blank, and counts trust faults
- **Why it was blank (confirmed):** the 23 Nov run's Action log shows 8,000 tokens out of 8,000 and no text: the
  model thought until the limit. The reply limit is now 32,000, the prompt asks it to think briefly, and a reply with
  no text writes the digest with the numbers and "the reading failed", then fails the job.
- **Trust checks in code** (`scripts/log-checks.mjs`, plan item 1): long replies after a screen, numbers in a reply
  not found in the session's record, evidence the run marked "not traced", runs naming more than one UK nation's
  bodies, known open publishers not classed open, and screens over 120 s. Counts go to `<date>-checks.json` in
  tobler-logs; the digest shows them beside up to four earlier weeks. Examples stay in the private digest; the public
  Action log shows counts only.
- **Approximations:** a reply number is traced if any number in the session's record rounds to it at the precision
  written (or matches in m/km, ha/km²); a coincidence can pass a wrong number. Numbers from the place summary the
  analyst reads aren't in the log yet, so they show as untraced. "Known open publishers" is a short hand list; one
  layer can differ from its publisher's norm. None of these change an answer Tobler gives: they only steer the digest.
- **On last week's logs:** 7 of 59 replies with numbers had one not in the record (unit conversions done by the
  model, rounded country areas, place-summary numbers), 27 of 220 evidence items not traced, 1 of 18 runs naming two
  nations, 74 of 622 datasets from known open publishers not classed open (mostly the European Environment Agency),
  5 of 18 screens over 120 s.
- The digest's brief now covers all three skills.
- **Later, 25 Nov:** a 32,000 limit wasn't enough either (the model thought through all of it on 37 sessions), so
  the digest call now turns thinking off (`thinking: {type: "between_tools"}`; the API refused "disabled" for this model and named this instead) and the
  limit is back to 16,000. Rob reads the digest on the web, not by email (his call, 25 Nov: lowest upkeep wins). The
  workflow makes `digests/README.md` in tobler-logs the newest digest plus links to the rest, so
  github.com/pushpingeo/tobler-logs/tree/main/digests always opens on it. A failed run still emails him through
  GitHub.
- **Rob's go, 25 Nov:** the Worker now allows `https://asktobler.ai`, so the lab agent at asktobler.ai/ntr-lab/ runs
  through it, under the same per-visitor limits as Tobler.

## 26 Nov 2026 (morning, later still): hazards and air and climate get their own colours
- **Rob's ask:** four topics shared ochre in the legend. Hazards now take a warning yellow (`#d4b000`) and air and
  climate a teal (`#0f9e9e`); ground and soil and land use keep ochre. Eight map colours, up from six; the cap in
  `test/data.test.mjs` moves to eight with his say-so.
- **Why these:** red belongs to the person's site, and an orange or brown sat too close to it for red-blind readers
  (ΔE 1–4). Yellow is about as far from ochre as a warm colour can get here (ΔE 11 normal, 9.7 deuteranope), so the
  two are cousins and the legend name still does the work. Yellow is pale on white (2.1:1): fine for fills and 2 px
  outlines with labels, weak as a thin line alone. Teal clears blue and green by ΔE 15+; it's close to heritage's
  magenta only for deuteranopes (ΔE 5.2).
- **No public standard to copy:** INSPIRE gives each data theme its own portrayal rules, and agencies style their own
  layers (flood maps in blues, designated sites in greens), but there's no cross-topic palette for a constraints map.
  Consultants' maps vary by firm. Tobler's choices follow the common conventions where they exist (water blue,
  nature green, hazard yellow).
- **Not done (in the plan):** topic headings changeable in settings. It overlaps frameworks (topics to report
  headings, per job), so it waits for that design rather than adding a second way to rename topics.

## 26 Nov 2026 (evening): the conceptual model widened; distances, units and the asset table agreed
A thinking session with Rob, from his review of EIA screening practice. Docs only: no code changed.
- **Three kinds of distance, kept apart.** Search (a check's reach), protection (a skill's deduction) and impact
  pathway, which isn't a number: the check says how its receptor can be reached, the asset says what effects it
  sends out, the skill judges whether a pathway joins them, and tools will measure it later.
- **Rob's decisions:** the project is stated (place, proposal, overrides, framework, units, data brought in). The
  asset table is split from the profile, so the profile is only about who's asking. A drawn shape beats a computed
  buffer, a published zone above all, and the card says whose shape it is. Adjacent means within 50 m of the edge.
  One reporting ladder whose last band is 30–50 km; nothing is fetched beyond 50 km for now. The model's severity
  rating goes. Checks gain "reached by". Units need one coherent design: metric record, display in the person's
  units, defaults from the place's country.
- **Asset types** come from the person's words, are confirmed like the place, and aren't tied to the profile. An
  asset with no row runs on general defaults and says so.
- **Defaults by country** are tables with sources, picked in code from the place's country. No model call advises on
  practice at run time.
- **Why nine nouns, not six:** framework and project were already in the model uncounted, and the asset was inside
  the profile.
- `docs/conceptual-model.md` rewritten; `CLAUDE.md`'s "Where new code goes" brought into line. The build is split
  into four packages in the claude.ai project (`claude/work-packages-2026-11-26.md`).
- **Not tested:** nothing to test beyond `npm test` still passing; no page or answer changes.
