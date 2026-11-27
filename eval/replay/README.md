# The replay gate

Eight development-set sites from Rob's replay set, each with its boundary (`site.geojson`) and what its planning
documents say is on, next to and around it (`expected.json`). The gate screens each boundary through the same sealed
screen as the page and scores the run against `expected.json` (`scripts/replay-score.mjs`).

**Build chats don't open `expected.json` or tune to it.** It's the answer sheet. A fix that makes one site's fact
appear is a rule added to fix one case (CLAUDE.md, invariant 9). Read the gate's report, not the answers. The
held-back sites (R4, R7, R13, R16, R20, R24) never come into this repo.

## Running it

- **Push a change to `.github/replay-gate-request`** (the last line is the arguments), or run the "Replay gate"
  Action by hand. Results land in `runs/<label>/`: one run record per site (without feature geometry),
  `scores.json` and `report.md`.
- `node scripts/replay-gate.mjs --offline --label=offline` checks the plumbing here with no network and no model:
  every fact should score not checked or no check. Don't commit its output.
- `--score-only --label=<label>` re-scores saved runs (after a scoring change), with no network.

## What the report says

For each fact: **found**, **found elsewhere** (not where the document puts it), **missed** (the check ran and
didn't surface it: what the gate is for), **beyond reach**, **not checked** (a source didn't answer), **check not
run** (Tobler has the check but this run didn't include it) or **no check** (Tobler has nothing for that kind:
a core path, a landscape character type). A none-expected fact **agrees** or is **contradicted**.

The headline is recall of `must` facts Tobler has a check for. Gaps are counted apart, never as passes.

**Pass or fail:** a complete run is compared with the last complete one (`runs/latest.json`). The gate fails on a
regression (a must fact surfaced before and not now, or a none-expected fact newly contradicted) or a site that
didn't run. The first run sets the baseline. There's no fixed recall threshold yet: Rob sets one once the baseline
is seen.

## The data

- Boundaries come from Rob's georeferencing tool (`properties.provenance` in each `site.geojson`). R6, R17 and R19
  were exported in British National Grid and converted here by EPSG's "OSGB36 to WGS 84 (6)" (±2 m), the
  operation the tool itself names. This is test data preparation, not Tobler's geodesy (CLAUDE.md, invariant 1).
- R17's polygon is 2,392 ha against 1,765 ha decided: distances under about 1 km there are approximate.
- Documents measure from the boundary or the nearest turbine. A run finding something closer than stated counts as
  in place; further than stated by more than 30% (at least 500 m) is "found elsewhere".
- Battery storage has no asset type yet, so R19 and R21 run as `other`, planned "battery energy storage".
- The documents themselves stay in Rob's folder (`~/Desktop/tobler`), not here.
