# Tobler's conceptual model

Agreed in outline with Rob on 23 Nov 2026; frameworks and skills' report shapes refined 24 Nov. This is the target design, and parts of it aren't built yet: the status
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
| **Check** | One report line: a neutral topic, the layers per region, the kind of answer (count per band, or value at the site) and its reach per scale. Always reported as found, none found or not checked. Data, not code. | **Yes** (23 Nov): `catalogue/checks.json` (twelve topics, the first twelve checks), `js/checks.js`, run by `js/ntrrun.js` before the analyst starts. The scale is read off the distances until plan item 4 |
| **Skill** | Judgement for a job: which checks matter, thresholds, severity, the decision, the write-up. Used directly (a chip), underneath another skill, or both. Site first ("what's here?") or criteria first ("where could it go?"); criteria-first skills produce places. Each skill owns its **report shape** and its decision language, and says which frameworks fit it (see below). A method standard the skill follows, such as LCRM or ASTM Phase I for a contamination desk study, belongs to the skill, not to a framework. | Yes: `skills/*/SKILL.md`. `ntr-screening` still holds distances and themes that belong elsewhere (plan item 4) |
| **Profile** | Sector and setting presets: skills offered, baseline checks, scale bands, wording, default framework. | Partly: `catalogue/industries/`, `js/industry.js`. Distances are by asset type in `catalogue/distances.json`, not scale bands (plan item 4) |
| **Framework** | Maps the neutral topics to report headings and their order, for the job: UK EIA topic chapters (the UK default), IFC (global or lender work), later World Bank ESF, EBRD, TNFD. It also lists the headings it expects, so a heading no check covers shows as "not covered by Tobler" instead of disappearing. It changes words and order, never the analysis or the decision. | Partly: IFC only, hard-wired as six themes in `js/findings.js` and `js/ntrrun.js` (plan item 3) |

## Report shapes and frameworks

Every check and finding carries one of the neutral topics in `catalogue/checks.json`; that's the spine every skill
shares. How a report is laid out depends on the skill:

| Report shape | Example skill | What a framework does to it |
|---|---|---|
| Findings by topic | Constraints screen | Headings and order (the main use) |
| Source, pathway, receptor; records by distance band | Contamination desk study (LCRM in the UK, ASTM Phase I in the US) | Nothing: the method standard sets the shape, chosen by country |
| Area budget: gross area, each deduction and why | Area discounting | Each deduction's topic label only |
| Sites against topics | Ranking several sites | Column labels |

A skill states its shape and which frameworks fit; a framework is offered only where it fits. Decision language
(IFC category A/B/C, EIA "likely significant effect", ASTM "recognised environmental condition") is the skill's,
because it's a judgement, not a label.

## Defaults and overrides

Skills and the profile hold the defaults. The framework is chosen per job (Rob, 24 Nov): it defaults from the
place's country and the profile (UK EIA in the UK, IFC for global or lender work), Settings can set the person's
default, and the project holds the choice. The project also holds the consultant's other overrides (reach, checks on
or off), set in words or a pasted table, with the card saying what changed. **Not built** (plan item 8). Later, a
framework saved per organisation.

## Scale

The scale comes from the site's size and the request. Each check's reach defaults per scale, and the asset type
extends it only where there's a stated reason. "On site" means inside the polygon.

- Local: 0–50 m, 50–250 m, 250–500 m, 500 m–2 km.
- Regional: 0–2, 2–5, 5–10, 10–20 km.
- Global: 0–10, 10–20, 20–50, 50–100 km (for large licences).

**Not built** (plan item 4); until then `catalogue/distances.json` draft-1 is used.

## Building towards it

- New code goes where its noun says. A tool that starts choosing, or a rule that creeps into a tool, is the drift to
  avoid. Judgement belongs in a skill; anything that must always be checked belongs in a check.
- Don't build a noun ahead of the plan, and don't "fix" working code to match a part of the model that isn't built.
  Where code and model disagree, note it in the plan's small fixes or ask Rob.
- Credible answers come from established practice: SSSI Impact Risk Zones, study areas from EIA scoping reports, and
  example sites with published documents as ground truth.
