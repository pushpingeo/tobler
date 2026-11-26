# Tobler's conceptual model

Agreed in outline with Rob on 23 Nov 2026; frameworks and report shapes refined 24 Nov; distances, the asset table,
the project, units and the model's two roles agreed 26 Nov. This is the target design, and parts of it aren't built
yet: the status column says what exists today. `CLAUDE.md` holds the short version, as a rule for where new code
goes. The plan's "Next" list (in the claude.ai project) says what gets built when.

## The nouns

Tools do, checks measure, skills judge. A place says where; data says what exists. The asset says what's proposed;
the profile says who's asking; the framework sets the headings. The project holds the job.

The first version counted six nouns. Framework and project were already here without being counted, and the asset
was inside the profile, so there are nine named things now.

| Noun | What it is | What it owns | Built today |
|---|---|---|---|
| **Place** | A shape whose role is set in code: footprint, area, search area or point (later a corridor). It records how it was made: words, drawn, file or service. A site-selection candidate is an area, recorded as made by site selection. | Where. Its own width, when it's built from a point or a line (the 10/30/50/100 m footprint buffer) | Yes: `js/placetools.js`, `js/siterole.js`, `js/fileimport.js`, `js/servicesite.js` |
| **Data** | What exists. Either from the catalogue (the atlas and country packs, with publisher, licence and health) or brought in by the person (their own, their organisation's, or a public layer they chose). | Published zones, where a body has drawn how far its concern extends | Yes: `js/atlasclient.js`, `js/atlasfeatures.js`, `js/datatools.js`, `catalogue/trusted.json`; brought in: `js/bringin.js`, `js/servicesite.js` |
| **Tool** | A deterministic, generic operation: buffer, clip, measure, count in bands, read a value, say how a feature sits against the site, transform coordinates, convert units. No judgement. Later: a downstream trace, a viewshed, a route. | The reporting ladder and the unit factors (fixed conventions, not settings) | Yes: `js/placetools.js`, `js/datatools.js`, `js/geometry.js`, `js/epsgtools.js`, `js/transform.js`, `js/elevation.js`, `js/seavalues.js`, `js/units.js`. Not yet: how a feature sits against the site (only the class checks work out coverage), the pathway tools |
| **Check** | One report line: a neutral topic, the layers per region, the kind of answer (a count per band, a value at the site, or inside a zone), its default reach with the reason, and how its receptor can be reached. Always found, none found or not checked. Data, not code. | Search distance (its default) | Yes: `catalogue/checks.json`, `js/checks.js`. Reach is per scale today; reach by asset and "reached by" aren't built |
| **Skill** | Judgement for a job: which checks matter, whether a pathway is credible, the decision and its language, the write-up. Used directly (a chip), underneath another skill, or both. Site first ("what's here?") or criteria first ("where could it go?"); criteria-first skills produce places. Each skill owns its report shape and says which frameworks fit it. A method standard the skill follows (LCRM, ASTM Phase I) belongs to the skill. | Protection distances (its deductions); the decision | Yes: `skills/*/SKILL.md`. Three skills. `ntr-screening` still holds a distance table and asks for a severity, both due to go |
| **Asset** | What a kind of development is like: its names as people say them, where it extends a check's reach and why, its default protection distances, and the effects it sends out (sight, noise, glare, traffic). One shared table, the same whoever asks. | Search and protection distances, where the development type changes them | Not yet. Today: `asset_type` on a run, `catalogue/distances.json` by asset type, and `find_place` reading a kind from a name |
| **Profile** | Who's asking: skills offered, checks on by default, default framework, wording, which assets are suggested first. | Nothing about distance | Partly: `catalogue/industries/`, `js/industry.js`. It still holds asset defaults too |
| **Framework** | Maps the neutral topics to report headings and their order, for the job: UK EIA topic chapters (the UK default), IFC (global or lender work), later World Bank ESF, EBRD, TNFD. It lists the headings it expects, so one no check covers shows as "not covered by Tobler". It changes words and order, never the analysis or the decision. | Headings | Not yet. Flags, the map and the report use the neutral topics (`js/findings.js`) |
| **Project** | One job: the place, the proposal (asset type, size, height and so on), the person's overrides, the framework and units chosen, the data brought in. | Every override, with the default it replaced | Not yet. Sites and screens are kept in the browser one by one |

Receptor importance stays as separate checks: listed buildings, scheduled monuments and World Heritage Sites are
three checks with three reaches, so each report line has one reach and one reason.

## Distances

Distance decides whether to look. The receptor's sensitivity and importance, and the impact pathway, decide how much
to care. A search area isn't the predicted extent of an effect.

Three kinds, kept apart. Only two are numbers with a home.

| Kind | The question | Lives in | Default from | Changed by |
|---|---|---|---|---|
| **Search** (reach) | How far does this check look? | The check | The check; the asset extends it where there's a stated reason | The project ("look out to 5 km") |
| **Protection** | What separation to keep once something is found? | The skill's deduction | The asset | The project ("keep 50 m from homes"), or a drawn shape |
| **Impact pathway** | How could an effect get from here to there? | Not a number: see below | | |

**Impact pathway** is split across four nouns:
- the **check** says how its receptor can be reached (by water, by sight, by flight, through the ground, by road);
- the **asset** says what effects a development sends out;
- the **skill** judges whether a credible pathway joins the two;
- a **tool** will one day measure it (downstream trace, viewshed, route).

Until those tools exist a circle stands in for the pathway, and the line says "pathway-dependent" instead of letting
distance settle it. The contamination desk study already works this way (source, pathway, receptor).

**Reporting bands.** One ladder for every run and check: within the site, 0–100 m, 100–250 m, 250–500 m,
500 m–1 km, 1–2 km, 2–5 km, 5–10 km, 10–20 km, 20–30 km, 30–50 km. A check reports in the bands up to its own reach
and always gives the actual nearest distance. Bands are for reporting, never risk. Nothing is fetched beyond 50 km.

**Scale** (local, regional, global) stays only as the coarse way to pick a check's default reach from the site's
size and the request. It no longer has bands of its own.

**How a feature sits against the site:** within, crosses the edge (with the share or length inside), adjacent
(within 50 m of the edge), outside (with its distance). Never "0 km".

**Changing distances in words.** "Look out to X km" sets every count check to X, cutting as well as stretching. It
doesn't stretch a zone check. "Keep X m from homes" changes a deduction and no search. The card has one line saying
what changed and what it was.

**Not built:** today the run's near/close/wider (`catalogue/distances.json`) and each check's reach disagree. The
design is in the claude.ai project (`claude/distances-design.md`).

## A drawn shape beats a computed buffer

Where someone has deliberately drawn the area that matters, Tobler uses that shape and doesn't apply a distance of
its own. The card says whose shape it is.

| Shape | Whose judgement | The card says |
|---|---|---|
| A published zone (SSSI impact risk zones, flood zones, groundwater source protection zones, pipeline consultation zones, aerodrome safeguarding) | The responsible body's | Publisher, licence, date |
| Brought in or drawn by the person (a client's exclusion area, a "keep clear" shape) | Theirs or their organisation's | "Your own data", kept apart as added |
| A buffer | Tobler's default | The number, its reason, and "no published zone available" |

The same thing can have two homes. A gas pipeline's consultation zone is data when the zone is published, and a
labelled buffer round the line when it isn't. The buffer is never passed off as the zone. A drawn exclusion area can
replace a deduction's buffer in the developable area.

**Built today:** SSSI impact risk zones in England. The rest isn't.

## The proposal and asset types

- The asset comes from the person's words first ("a 200-home scheme", "a distribution warehouse"), matched to the
  asset table.
- It's confirmed before the run, like the place: "Screening as: housing development, about 10 ha".
- An asset with no row still runs on the general defaults for its size, and the card says so.
- Chips are suggestions, not the list. The profile only changes which are suggested first.

## Units

- **The record is metric.** Every stored value, tool and run is in km and km², measured geodesically or in a local
  equal-area projection (invariant 2). Units are for display and for reading what the person typed.
- **Converted once, in code, with exact factors** (the international foot and mile, the nautical mile, the acre).
  The model never converts. When the person says "keep 150 feet from homes", the tool takes the number and the unit
  as said, code converts, and the record keeps both.
- **Unit sets:** metric (m, km, ha, km²), imperial (ft, mi, acres, sq mi), nautical (nautical miles, for work at
  sea).
- **The default comes from where the place is,** from a table in code: imperial in the United States, metric in the
  UK, Australia and the Netherlands. The person's own choice in Settings wins, and the project keeps it.
- **The US survey foot** is a matter for coordinates (state plane systems), handled by the one geodesy path
  (invariant 1). It's never a display unit.

**Built today:** the three unit sets and their display (`js/units.js`). Not yet: the default by country, feet and
metres for short distances, units in the person's words, bands in the person's units.

## Defaults by country

The place's country is worked out in code from real outlines. It picks, from tables with their sources: the units,
the default framework, the method standard a skill follows, the layers a check asks, and any reach that practice in
that country sets differently. Where there's no entry for a country, the general default is used and the card says
so. No model call advises on this at run time: the tables are researched ahead, with a source for each row, and
reviewed before they go in.

## The model's two roles

- **The conversation agent** directs. It finds and confirms the place and the proposal, picks the skill, and turns
  the person's words into overrides. After a run it presents the gaps and the candidate layers that code found. It
  proposes; the person decides. It never measures and never gives a verdict.
- **The skill's judge** is one sealed call with no tools, on the checks and whatever the person brought in before a
  re-run.

Code does everything else: the geometry, the search for layers, the look before offering, the replies that state
facts.

## Data the person brings in

- It keeps its origin: the address, layer, date, publisher and licence where known ("unknown" stays unknown; "your
  own or your organisation's data" for secured sources).
- It never quietly becomes a check's source. It's held to the run's distances, shown apart as added, and judged only
  on a re-run.
- A secured address never goes to the atlas or the model.
- A site from a service is data turned into a place by a tool. The place keeps the geometry and the origin record,
  and drops the service.
- Imagery is data the person looks at. Tools read values from it; the model doesn't describe it.

## Report shapes and frameworks

Every check and finding carries one of the neutral topics in `catalogue/checks.json`; that's the spine every skill
shares. How a report is laid out depends on the skill:

| Report shape | Example skill | What a framework does to it |
|---|---|---|
| Findings by topic | Constraints screen | Headings and order (the main use) |
| Source, pathway, receptor; records by distance band | Contamination desk study (LCRM in the UK, ASTM Phase I in the US) | Nothing: the method standard sets the shape, chosen by country |
| Area budget: gross area, each deduction and why | Area discounting | Each deduction's topic label only |
| Sites against topics | Ranking several sites | Column labels |

A skill states its shape and which frameworks fit; a framework is offered only where it fits.

## Wording

Relevance classes are facts, set in code: direct interaction, within the check's screening range, within an extended
range the person asked for, pathway-dependent, outside the typical range. They read the same for every user. A line
reads "Scheduled monument, 4.2 km: within the 5 km range used for nationally important heritage (reason, source)",
not "medium risk".

Decision language (an indicative IFC category, EIA "likely significant effect", ASTM "recognised environmental
condition") is the skill's, because it's a judgement, shown with its evidence. The model's severity rating goes;
runs made before then keep theirs. **Not built:** the screen still asks for a severity and its headline depends on it.

## Defaults and overrides

The order, most specific first: the project's override, a drawn shape, the asset's default, the check's or skill's
default. The framework is chosen per job: it defaults from the place's country and the profile, Settings can set the
person's default, and the project holds the choice. Overrides are set in words or a pasted table, and the card says
what changed. **Not built.** Later, a framework saved per organisation.

## How it carries to other users

Checks, the asset table, the ladder and the relevance classes are shared. A new group of users (developers and site
finders, planners, lenders, property) adds:
- **checks** to the one catalogue (lenders: settlements and population, community land, conflict, country context;
  property: ground, radon, subsidence);
- **assets** to the table (housing, warehouses);
- a **profile** (what's on, what's offered, the wording);
- sometimes a **skill** with its own report shape and decision language, and a **framework**.

An existing check doesn't change for a new group. Reach depends on the asset, the receptor and the method standard,
never on who's asking. Non-technical risk leans least on distance: land take, worker influx and displacement aren't
physical travel, so most of its lines are pathway-dependent and the category is the skill's judgement.

## Building towards it

- New code goes where its noun says. A tool that starts choosing, or a rule that creeps into a tool, is the drift to
  avoid. Judgement belongs in a skill; anything that must always be checked belongs in a check.
- A number that depends on what's being built goes in the asset table, never the profile.
- Don't build a noun ahead of the plan, and don't "fix" working code to match a part of the model that isn't built.
  Where code and model disagree, note it in the plan's small fixes or ask Rob.
- Credible answers come from established practice: published zones first, then study areas from EIA scoping reports,
  and example sites with published documents as ground truth.
