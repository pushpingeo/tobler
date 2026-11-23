# Decisions log

Judgement calls made while building, newest first. Bigger product decisions live in the plan doc (`tobler-workspace-plan.md` in the claude.ai project).

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
