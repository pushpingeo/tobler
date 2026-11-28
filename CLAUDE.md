# Tobler: rules for building

Tobler is an AI-first geospatial screening tool for environmental consultants (asktobler.com). Before working, read
the plan, `tobler-workspace-plan.md` in the claude.ai project ("Where things are", "Next"), the latest entries in
`docs/decisions.md`, and the last three sections here (how things run, decisions that stand, lessons).

## Where new code goes

The conceptual model in short (full version, with what's built: `docs/conceptual-model.md`; widened 26 Nov). Put new
work under the noun it belongs to. Don't build a noun ahead of the plan, or bend working code to fit a part that
isn't built.

- **Tools do.** Deterministic and generic, no judgement (`js/placetools.js`, `js/datatools.js`, `js/geometry.js`,
  `js/epsgtools.js`, `js/transform.js`).
- **Checks measure.** One report line each, always found, none found or not checked; data, not code
  (`catalogue/checks.json`, read by `js/checks.js`). A new must-check is a line there, not code in the run.
- **Skills judge.** Which checks matter, the decision, the write-up (`skills/*/SKILL.md`). The model's severity
  rating is due to go (plan).
- **The asset says what's proposed; the profile says who's asking.** A number that depends on what's being built
  (a reach, a protection distance) belongs in the shared asset table (`catalogue/assets.json`, read by
  `js/reach.js`), never the profile. Reach extensions live there now, and protection distances where a source
  gives one (its `protection` rows, package D, 27 Nov); the developable area skill's own buffers are the first cuts. The project holds the place, the proposal and the
  person's overrides (*not built*).
- **Three kinds of distance, kept apart:** search (the check's reach), protection (a skill's deduction), impact
  pathway (not a number). A shape someone drew, above all a published zone, beats a buffer Tobler computes.
- **The record is metric; units are for display.** Code converts, with exact factors (`js/units.js`); the model
  never does.
- **A place says where** (role set in code, how it was made recorded); **data says what exists** (the atlas, with
  publisher and licence).
- **Frameworks map topics to report headings**, per job; each skill owns its report shape and says which frameworks
  fit. *IFC only, hard-wired* (plan item 3).

## Invariants

These must always be true. `test/invariants.test.mjs` checks the ones marked *tested*, and `npm test` runs it. If a
change would bend one, **stop and ask Rob first**, even when it seems sensible or temporary. Don't add to the
test's `KNOWN` list or loosen a check without his say-so. Explaining it afterwards in `docs/decisions.md` isn't asking.

1. **One way for geodesy** (*tested*). Datum transformations are chosen from the EPSG registry, by
   `js/epsgtools.js`, for where the data is, and applied by `js/transform.js`. No other file holds datum shift
   parameters or picks a transformation. Projection maths on a single datum (proj4 in `js/fileimport.js`, grid
   references in `js/coords.js`) may live elsewhere. The coordinate-reference skill decides when to ask the person.
2. **WGS84 in storage; true measures and true shapes.** Places and findings are stored as WGS84 longitude and
   latitude. Distances and areas are geodesic (turf) or worked out in a local equal-area projection, never in raw
   degrees. Web Mercator is for display only. Which country or region a place is in, and what it overlaps, are
   decided with real outlines, never boxes or centre points; a box may only narrow a search before the real test.
   *Checked by review and the place tests.* UK nations and councils are matched on ONS outlines
   (`data/ref/uk-areas.json`, `js/ukareas.js`) since 26 Nov; the boxes that missed England's border strip are gone.
3. **The model never does geometry** (*tested*: tool inputs and the summaries it reads). The analyst sees names,
   sizes and at most a centre, never coordinate lists. All geometry is done by tools in code. The one exception is `transform.points`: numbers the
   person typed, copied as given.
4. **Honest about gaps.** A source that failed or wasn't checked is reported as "not checked", never "none found".
   A licence that isn't stated stays "unknown". *Tested in `data.test.mjs` and `ntrrun.test.mjs` (not checked,
   licence classes, non-commercial and Esri data left out by default).*
5. **Provenance travels.** Every place records how it was made (`origin.method`: words, drawn, file or service), and every
   run feature carries its source, licence and date. Known gaps in tracing are listed in the plan's small fixes;
   don't add new ones.
6. **No CDN at run time** (*tested*). Pages load only vendored files.
7. **The person's files stay in their browser** (*tested*). Site files are read in the page. Only EPSG codes and
   registry lookups go to the Worker.
8. **One model setting** (*tested*). The model id is set in `js/config.js` and the Worker's environment only.
9. **Rules live in skills, not prompts.** Expertise goes in `skills/*/SKILL.md`; tools stay deterministic and
   generic. Don't add a rule to fix one evaluation case.
10. **One presentation CRS per run** (Rob, 28 Nov; *tested*: chosen once by `js/presentation.js` from
   `catalogue/grids.json`, set only by the run, kept by the share link; outputs project only through its
   `projectorFor`). The coordinate system
   that outputs show is chosen once, in code, from where the site is (the country's standard grid where it has one,
   from a data table; WGS 84 / UTM elsewhere), recorded in the run record with the operation that reaches it, and read
   by every output: report maps, map series, coordinates in tables, the data pack's map files. No output picks its
   own, and none shows coordinates in any other system. Getting there obeys invariant 1.

## Geodetic integrity

How Tobler keeps positions right with a model in the loop (Rob, 28 Nov). The invariants above enforce parts of it.

- **The model never touches a coordinate** (invariant 3). It reads names, sizes and distances; tools compute.
- **Each decision happens in one place, from the registry, and is recorded.** Transformations are chosen by
  `js/epsgtools.js` (invariant 1); the presentation CRS by one module from a grid table (invariant 10). Each writes
  what it chose, its EPSG code and its accuracy into the run record: provenance for coordinates, as for data.
- **Skills hold the conventions; code enforces what must always hold.** `skills/coordinate-reference/` says when to
  ask and how to choose; `skills/cartography/` says how maps show position (ticks, not grid lines; the accuracy a
  sheet claims). Tests make the "always" parts true.
- **Check against independent truth.** Control points with published coordinates in both systems (Historic England's
  easting and northing fields, for example) must come through the pipeline within the operation's stated accuracy, as
  unit tests. Where a service gives native coordinates, compare its WGS 84 output with Tobler's own transformation:
  about 100 m in Great Britain means one side skipped the OSGB36 shift (lesson 12); 1 to 2 m is two valid
  transformations disagreeing. Round trips return the start point. The replay gate scores positions against documents.
- **Say what isn't known.** A file converted elsewhere without saying how is recorded as "conversion unknown" and the
  sheet says so; a clean grid over a possible 100 m error is a false claim of accuracy.
- **Don't claim more accuracy than the sources have.** No grid lines or graticule on screening maps; ticks only;
  distances to the metre only where the sources support it.

## Ask Rob first

- Anything that bends an invariant.
- Changes under `worker/`: a push deploys the Worker.
- A new dependency, external service or data source, or a change to licence handling.
- Deleting files or features, rewriting history, or force-pushing. Never delete branches.

## Approximations

End each piece of work by saying what was approximated and whether it can change an answer. One that can change an
answer (which data a site gets, a count, a decision) is asked about first, not parked as a small fix.

## Before pushing to main

- `node scripts/stamp.mjs`, then `npm test` (which includes the invariants).
- **The replay gate**, for any push that can change an answer (checks, the catalogue, skills, reach, the run, data
  tools): push a change to `.github/replay-gate-request`, wait for the Action, and put the top of its
  `report.md` in the push note. A regression is fixed or explained to Rob before the next push. Never open or tune
  to `eval/replay/*/expected.json`: it's the answer sheet (`eval/replay/README.md`).
- Run the browser checks the change touches (`scripts/browser-*.mjs`, with `python3 -m http.server 8000` running)
  and look at the phone screenshots.
- Search for the commercial site-report product's name before any push touching checks, distances or skills. It
  must never appear in the repo.
- Tell Rob what was and wasn't tested, and log judgement calls in `docs/decisions.md`.

## How things run

- **Tests:** `npm test`, and `npm test` in `worker/`. In a fresh clone run `npm ci` first. Read the exit code: the
  tests are chained with `&&`, and a thrown assertion stops the chain without printing "fail".
- **Browser checks** (`scripts/browser-*.mjs`, 14): `node --import ./scripts/route-local.mjs scripts/browser-x.mjs`
  needs no server (a backgrounded `http.server` can be refused by the session's safety check). The model, network
  and ArcGIS are faked, so they prove the page, not the answer. A route that blocks outside services must match only
  `https://` addresses, or it blocks Tobler's own files. A scripted check must queue exactly the model calls the page
  will make.
- **Actions** start through the REST API (`gh workflow run` needs GraphQL, which isn't available):
  `gh api -X POST repos/pushpingeo/tobler/actions/workflows/<file>/dispatches -f ref=main …`. The digest:
  `log-digest.yml` with `-f 'inputs[days]=7'`, about 4 minutes.
- **Live replays:** `try-requests.yml` with `-f 'inputs[requests]=<one conversation per line; " >> " between turns>'`.
  A place found from words is held, so add `" >> Yes, go ahead"` or nothing runs. Read the log with
  `gh api repos/pushpingeo/tobler/actions/runs/<id>/logs` (a zip; unzip into a new empty folder).
- **The workspace** reaches GitHub, package registries and `*.arcgis.com` only (not data.asktobler.com). Check a
  deploy on asktobler.com with the cloud browser. It may open an ArcGIS authorize address to check a redirect URI;
  never sign in there.
- **Pushing:** fetch and rebase first (several chats push to main); `git -c push.negotiate=true push origin
  HEAD:main`. On a conflict in `index.html` or `report.html` take main's and re-run `node scripts/stamp.mjs`; in
  `package.json`'s test line take main's and add your test back. Bring a clone up to date with `git merge --ff-only
  origin/main`. If the session's safety check refuses a push to main, don't work round it: push a branch and tell
  Rob. Rerun tests and browser checks after every rebase.
- **ArcGIS app:** "Ask Tobler", client ID `4GhkbypqSzSYKEb2`, in Rob's own org (`linlithgow.maps.arcgis.com`), never
  an employer's. Redirects: asktobler.com, pushpingeo.github.io/tobler and localhost:8080, each `/oauth.html`.

## Decisions that stand

The dated history and reasons are in `docs/decisions.md`; these shape daily work.

- **Checks** report found, none found or not checked. A source that doesn't cover a place never answers for it. UK
  nations and councils are matched on ONS outlines (a source's `in`, touched by the site grown by the check's reach;
  a new council needs `node scripts/build-uk-areas.mjs`); `extent` boxes only at sea. A sea check applies on land
  only with the coast within its reach plus 1 km.
- **Runs are sealed.** A place found from words is shown and confirmed before anything runs; a pick on the choice
  card is that confirmation. The screen judges its checks with no tools. Nothing on the map looks like a screen until
  one has run.
- **The offer:** code searches the atlas for the named gaps, looks at each layer first and offers only those with
  something in reach, saying what they hold. Nothing comes in without a yes; what comes in keeps publisher, licence
  and date, is held to the run's distances and isn't judged until the person re-runs.
- **Distances:** three kinds, kept apart (search, protection, impact pathway). A check owns its default reach; the
  asset extends it with a reason and a source; the person overrides both; a skill's own reach wins in its run.
  "Look out to X" sets every count check. A drawn or published shape beats a computed buffer. One ladder (within
  the site, 0–100 m … 30–50 km; in imperial 300 ft, 1,000 ft, ¼ … 30 mi); bands are for reporting, never risk;
  nothing fetched beyond 50 km. A size rule that widens the scale to global (a large wind farm, mine or plant, any site
  of 100 km² or more) keeps the checks it had, each at the further reach (Rob, 27 Nov). Main roads are motorway,
  trunk and A roads everywhere, plus B roads in the UK (Rob, 27 Nov, night).
- **Relations:** within, crosses, covers, adjacent (within 50 m, touching included), outside. An overlap under 1 m² is
  a touch; class checks count any overlap over 1 m² except from sources marked `coarse`.
- **Units:** the record is metric; code converts with exact factors (`js/units.js`); the model never converts.
- **Severity:** the model's rating goes; relevance classes set in code replace it (plan, step 2).
- **Licences:** non-commercial and Esri MLA data off unless switched on; "unknown" stays unknown; no competitor or
  commercial product names in the repo.
- **Services and sign-in:** a site from a service keeps the geometry and drops the service. Tokens live in memory
  only and go only to https `arcgis.com` hosts; secured requests never go through the Worker; secured addresses never
  reach the atlas or the model. A public service that blocks browsers goes through the Worker only when the person
  asks.
- **Map colours:** at most eight; red is the site's alone; colour never carries identity alone.
- **The replay gate** fails on a regression, a site that didn't run, or any must fact with a check not surfaced
  (Rob, 27 Nov). Gaps are reported apart and never fail it.
- **Scope:** three skills stay visible, an early one marked. Quality means trust in the process, not scoring Tobler's
  decisions against a consultant's. New ideas go on `claude/enhancements.md`, not into the plan.

## Lessons worth keeping

1. Anything that must always be checked or said goes in code. Tool results carry facts, never instructions; when
   code holds a fact, the model points to it by id.
2. A turn can end in code: when a tool's result is the answer, let code write the reply. Buttons are an ending too.
3. Where the rules are written down and the geometry is code, don't call a model. A model asked to convert units or
   rate severity will, and the result has no source.
4. Don't offer what you haven't looked at. A catalogue record says a layer covers a place, not that it holds anything
   there. A capped answer is a sample in the server's order, never the nearest N.
5. Membership and overlap come from real shapes; a box only narrows which shapes get measured. Trim the big shape to
   the small one's box before an overlay, and measure the cheap thing first.
6. Answer per item and fall back per item: all-or-nothing fallbacks hide partial success. Public Overpass fails;
   our copy first.
7. When two parts each hold a default for the same thing, write down which wins. When a new rule lands, sweep for
   every place that answers the same question by the old rule.
8. A new field has to survive every copy to the person: record, card, map, evidence and the share link's allow-list.
   Test at the far end (the report).
9. Keep the record in values and build display lines at display time, so a units switch is a redraw. Count on every
   ladder you'll show while the features are in hand.
10. Words the person reads must match what the code did. Scripted browser checks prove the page; live replays, logs
    and the gate show the answer. Read them, and check `git status` and the live page before saying something is
    live.
11. Thinking counts against `max_tokens`; for a no-tool reading or writing job turn it off, and always handle a reply
    with no text.
12. Security: a proxy is a door (public only, on request, no tokens). An app's "Temporary Token" is the app, not the
    person: use user sign-in with PKCE, keep the verifier in the page, open the popup straight from the click. Don't
    trust a server's datum shift: take its native coordinates through Tobler's pipeline.
