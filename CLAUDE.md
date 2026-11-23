# Tobler: rules for building

Tobler is an AI-first geospatial screening tool for environmental consultants (asktobler.com). Before working, read
the plan, `tobler-workspace-plan.md` in the claude.ai project ("Where things are", "Next", "Decisions that stand"),
and the latest entries in `docs/decisions.md`.

## Invariants

These must always be true. `test/invariants.test.mjs` checks the ones marked *tested*, and `npm test` runs it. If a
change would bend one, **stop and ask Rob first**, even when it seems sensible or temporary. Don't add to the
test's `KNOWN` list or loosen a check without his say-so. Explaining it afterwards in `docs/decisions.md` isn't asking.

1. **One way for geodesy** (*tested*). Datum transformations are chosen from the EPSG registry, by
   `js/epsgtools.js`, for where the data is, and applied by `js/transform.js`. No other file holds datum shift
   parameters or picks a transformation. Projection maths on a single datum (proj4 in `js/fileimport.js`, grid
   references in `js/coords.js`) may live elsewhere. The coordinate-reference skill decides when to ask the person.
2. **WGS84 in storage; true measures.** Places and findings are stored as WGS84 longitude and latitude. Distances
   and areas are geodesic (turf) or worked out in a local equal-area projection, never in raw degrees. Web
   Mercator is for display only. *Checked by review and the place tests.*
3. **The model never does geometry** (*tested*). The analyst sees names, sizes and at most a centre, never
   coordinate lists. All geometry is done by tools in code. The one exception is `transform.points`: numbers the
   person typed, copied as given.
4. **Honest about gaps.** A source that failed or wasn't checked is reported as "not checked", never "none found".
   A licence that isn't stated stays "unknown". *Tested in `data.test.mjs` and `ntrrun.test.mjs` (not checked,
   licence classes, non-commercial and Esri data left out by default).*
5. **Provenance travels.** Every place records how it was made (`origin.method`: words, drawn or file), and every
   run feature carries its source, licence and date. Nothing is shown that the run record can't trace.
6. **No CDN at run time** (*tested*). Pages load only vendored files.
7. **The person's files stay in their browser** (*tested*). Site files are read in the page. Only EPSG codes and
   registry lookups go to the Worker.
8. **One model setting** (*tested*). The model id is set in `js/config.js` and the Worker's environment only.
9. **Rules live in skills, not prompts.** Expertise goes in `skills/*/SKILL.md`; tools stay deterministic and
   generic. Don't add a rule to fix one evaluation case.

## Ask Rob first

- Anything that bends an invariant.
- Changes under `worker/`: a push deploys the Worker.
- A new dependency, external service or data source, or a change to licence handling.
- Deleting files or features, rewriting history, or force-pushing. Never delete branches.

## Before pushing to main

- `node scripts/stamp.mjs`, then `npm test` (which includes the invariants).
- Run the browser checks the change touches (`scripts/browser-*.mjs`, with `python3 -m http.server 8000` running)
  and look at the phone screenshots.
- Search for the commercial site-report product's name before any push touching checks, distances or skills. It
  must never appear in the repo.
- Tell Rob what was and wasn't tested, and log judgement calls in `docs/decisions.md`.
