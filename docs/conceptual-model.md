# Tobler's conceptual model

Agreed in outline with Rob on 23 Nov 2026. This is the target design, and parts of it aren't built yet: the status
column says what exists today. `CLAUDE.md` holds the short version, as a rule for where new code goes. The plan's
"Next" list (in the claude.ai project) says what gets built when.

## Six nouns

Tools do, checks measure, skills judge, and the profile sets the defaults. A place says where; data says what exists.
Frameworks map topics to report headings.

| Noun | What it is | Built today |
|---|---|---|
| **Place** | A shape whose role is set in code: footprint, area, search area or point (later a corridor). Places record how they were made (words, drawn or file). A site-selection candidate is an area, recorded as made by site selection. | Yes: `js/placetools.js`, `js/siterole.js`, `js/fileimport.js` |
| **Data** | What exists, from the atlas and country packs, with publisher, licence and health. | Yes: `js/atlasclient.js`, `js/atlasfeatures.js`, `js/datatools.js`, `catalogue/trusted.json` |
| **Tool** | A deterministic, generic operation: buffer, clip, measure, count in bands, read a value, transform coordinates. No judgement. | Yes: `js/placetools.js`, `js/datatools.js`, `js/geometry.js`, `js/epsgtools.js`, `js/transform.js`, `js/elevation.js`, `js/seavalues.js` |
| **Check** | One report line: a neutral topic, the layers per region, the kind of answer (count per band, or value at the site) and its reach per scale. Always reported as found, none found or not checked. Data, not code. | **No** (plan item 1). The stand-in is `baseline` in `catalogue/trusted.json`, run by `js/ntrrun.js` |
| **Skill** | Judgement for a job: which checks matter, thresholds, severity, the decision, the write-up. Used directly (a chip), underneath another skill, or both. Site first ("what's here?") or criteria first ("where could it go?"); criteria-first skills produce places. | Yes: `skills/*/SKILL.md`. `ntr-screening` still holds distances and themes that belong elsewhere (plan item 4) |
| **Profile** | Sector and setting presets: skills offered, baseline checks, scale bands, wording, default framework. | Partly: `catalogue/industries/`, `js/industry.js`. Distances are by asset type in `catalogue/distances.json`, not scale bands (plan item 3) |
| **Framework** | Maps check topics to report headings: UK EIA topic chapters (the default), IFC (global or lender work), later LCRM, World Bank ESF, TNFD. The person can switch. | Partly: IFC only, hard-wired as six themes in `js/findings.js` and `js/ntrrun.js` (plan item 2) |

## Defaults and overrides

Skills and the profile hold the defaults. The project holds the consultant's overrides (reach, checks on or off,
framework), set in words or a pasted table, with the card saying what changed. **Not built** (plan item 8). Later, a
framework saved per organisation.

## Scale

The scale comes from the site's size and the request. Each check's reach defaults per scale, and the asset type
extends it only where there's a stated reason. "On site" means inside the polygon.

- Local: 0–50 m, 50–250 m, 250–500 m, 500 m–2 km.
- Regional: 0–2, 2–5, 5–10, 10–20 km.
- Global: 0–10, 10–20, 20–50, 50–100 km (for large licences).

**Not built** (plan item 3); until then `catalogue/distances.json` draft-1 is used.

## Building towards it

- New code goes where its noun says. A tool that starts choosing, or a rule that creeps into a tool, is the drift to
  avoid. Judgement belongs in a skill; anything that must always be checked belongs in a check.
- Don't build a noun ahead of the plan, and don't "fix" working code to match a part of the model that isn't built.
  Where code and model disagree, note it in the plan's small fixes or ask Rob.
- Credible answers come from established practice: SSSI Impact Risk Zones, study areas from EIA scoping reports, and
  example sites with published documents as ground truth.
