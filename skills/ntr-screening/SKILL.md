---
name: ntr-screening
version: 4.3-draft
description: Screen a site, onshore or offshore, for non-technical risk (NTR) from published spatial data. Flags anything that could become a risk, concern or delay (land and livelihoods, biodiversity, Indigenous Peoples, cultural heritage, community health and safety, and the operating context), with traced evidence and what wasn't checked. Use when someone asks what risks, sensitivities or constraints a site, block, field, route or area might raise.
---

# NTR screening

A desk-based first look at a site, the way a GIS analyst supports an opportunity manager: **flag anything that might be a risk, a concern or a cause of delay**, show the evidence, and say plainly when it is weak. The person decides what to act on. A missed risk costs far more than a flag that turns out not to matter, so when in doubt, flag it and say the evidence is weak.

It is a screen, not an impact assessment. The themes follow IFC's Performance Standards (PS4–PS8), because they give the result a structure people recognise; the screen is not an IFC review and doesn't need IFC's language unless asked. This version works onshore and offshore. The run carries out the standard checks for the place in code and gives them to you; you judge them, with no tools of your own. The method says *what evidence matters*, so you can say what's missing: after the run, Tobler searches the atlas for what you name and asks the person before bringing anything in. (The IFC-calibrated, evaluated version is `ntr-screening-ifc`.)

## Inputs
- **Site:** a point, line or area that's already been found or drawn. If there's none yet, find it first (place-finding skill).
- **Asset type:** e.g. solar, wind (onshore or offshore), hydro, thermal plant, mine, oil and gas field or platform, pipeline or cable, port or terminal, exploration block, seismic survey. Ask if it isn't clear and it changes the answer; otherwise say what you assumed.
- **Stage:** greenfield, expansion of an existing site, or an existing asset. If it isn't given, assume **greenfield** and say so. *Most risk comes from new land or sea-bed take and construction.*
- **Onshore or offshore:** from the site itself (the place's details say whether it's offshore). A coastal site screens both ways.
- **Footprint:** when the screen runs as its own run, the run gives the footprint (a point becomes a circle of a radius set by the asset type) and says so; use it. Otherwise, if there's only a point, use a footprint radius and say so: thermal, substation or terminal 0.5 km; solar 1 km; oil and gas plant or platform 1 km; wind 3 km; mine 3 km; hydro 5 km (the reservoir and the dried-out reach run along the river); oil and gas field 5 km. Screen linear assets along the whole line.

## Search distances
Distances are measured from the footprint edge. **Each check looks out its own distance:** the check's default for the screen's scale, extended by the asset type where there's a stated reason (onshore wind's landscape, visual and cumulative checks to 45 km), or as the person set it. The run gives each check's reach on its line, says where the distances came from, and lists what the person changed. Use them as given: there is no separate table of bands, and a distance decides whether to look, not how much a feature matters. A feature's sensitivity and importance, and how an effect could reach it, decide that. Bands (within the site, 0–100 m, 100–250 m, … 30–50 km) are for reporting, never risk.

## Steps
0. **Start from the checks.** The run has carried out the standard checks before you start, grouped by topic: each is found, none found, or not checked with the reason, and "must" marks a check its topic can't be called clear without. They are your evidence. At sea the checks include the water depth over the site and, in European waters, AIS vessel traffic at and around it; on land, the elevation. Judge whether a value matters (low-lying land is a flooding hazard; deep water rules out fixed foundations); the check only measures it. Layers the person brought in after an earlier run are listed apart from the checks: they asked for them, so judge them like any evidence, citing their ids.
1. **Confirm the site:** location, onshore/offshore, asset type, stage and footprint.
2. **Plan the evidence.** For each theme below, decide which kinds of evidence apply to this site (onshore, offshore or both).
3. **Raise flags** (below) from the checks, one per distinct risk (the run orders them).
4. **State the gaps:** every kind of evidence that applies here but wasn't checked, failed, or was left out for licence reasons, in data_gaps. Not-checked checks are already on the card, so add them only with something to say.
5. **Name what to look for.** Of those gaps, name up to three that matter most for this site and that a published map layer could answer, in look_for, each with two or three short words that would be in such a layer's title (the "search words" below are starting points; adapt them to the place and language). Tobler searches the atlas for them after the run and offers what it finds to the person; nothing is brought in unless they say yes. Leave out what no layer could answer (a landowner's plans, a site visit).

## Evidence to look for, by theme
Search words are starting points; adapt them to the place and language (e.g. "Natura 2000", "SSSI", "parque nacional").

**Land and livelihoods (PS5)**
- Onshore: settlements and homes; farmland, orchards, grazing (land cover); forest use; mining or other concessions; customary or community land. *Search words:* land cover, cropland, settlement, concession, cadastre.
- Offshore: fishing grounds and fishing effort; fisheries closures; aquaculture sites; other licences or leases overlapping the site (oil and gas, wind, cables, aggregates). *Search words:* fishing effort, fisheries, aquaculture, lease, licence, block.
- *PS5 covers physical displacement (homes) and economic displacement (farming, grazing, fishing, forest use, business). Most new land and sea has someone using it.*

**Biodiversity (PS6)**
- Check first (the run does this where it can): protected areas (national layers such as NatureScot, JNCC or a national cadastre; the EEA's designated areas and Natura 2000 in the EU; Ramsar and natural World Heritage sites; WDPA only where the person has switched on non-commercial data), IUCN Important Marine Mammal Areas, warm-water coral reefs, MARPOL special areas, and critical habitat where a national list exists (e.g. NOAA in the US).
- Search for Important Bird Areas and ecologically significant marine areas (EBSAs): they exist only as regional copies.
- Onshore: natural habitat in the footprint (forest, wetland, grassland, rivers, coast); threatened species records.
- Offshore: sensitive seabed habitats (coral, seagrass, sponge grounds, chemosynthetic communities); essential fish habitat and spawning or nursery grounds; marine mammal areas; seabird colonies on nearby coasts. *Search words:* protected, marine protected, Ramsar, coral, seagrass, sensitive, habitat, fish habitat, spawning, marine mammal, seabird.
- Key Biodiversity Areas aren't available under licence (IBAT). Say so once in the gaps, and name what was checked instead.

**Indigenous Peoples (PS7)**
- Mapped Indigenous, tribal or community land and waters (reserves, native title, customary marine tenure). *Search words:* indigenous, tribal, native title, reserve, community land.
- Nothing mapped but a strong regional signal: flag it, labelled *regional knowledge, not mapped data* in "why" (highland South and Southeast Asia; forest peoples of central Africa and the Amazon; Andean highlands; pastoralist drylands of East Africa and the Sahel; Arctic and boreal regions; coastal and island communities with customary fishing). *Absence from the map is not evidence of absence.*

**Cultural heritage (PS8)**
- Onshore: listed buildings, scheduled monuments, World Heritage (cultural), graves, cemeteries, shrines and places of worship on site.
- Offshore: shipwrecks, war graves and protected wrecks, submerged archaeology, sea-bed obstructions of historic interest. *Search words:* heritage, monument, listed, wreck, war grave, archaeology.
- Large earthworks or sea-bed works in areas with long settlement history: flag the need for a heritage survey and a chance-finds procedure.

**Community health, safety and security (PS4)**
- Onshore: schools, hospitals and clinics within about 1 km or by the likely access road; settlements within about 5 km; no main road within 10 km (new access needed).
- Offshore: vessel traffic from AIS (density by vessel type: the run reads it in European waters; elsewhere name it in look_for); shipping lanes, traffic separation schemes and fairways; ports and anchorages; other installations, pipelines and cables (simultaneous operations); military practice areas; unexploded ordnance; coastal communities in the wider band (spill reach).
- Both: existing industry nearby (cumulative effects); **thermal hotspots and gas flaring** from satellite detections as a sign of existing operations and emissions. *Search words:* shipping, AIS, vessel density, traffic separation, fairway, shipping lane, port, platform, pipeline, cable, military, ordnance, thermal, flaring.

**Cross-border (transboundary; context).** A land border, a maritime boundary or another country's coast within the check's reach is a flag.
- Why it matters: effects can cross it (spills, emissions, noise, sediment, river flows, migratory species); a second government and regulator may be involved; the neighbouring country may need to be notified or consulted (the Espoo Convention in Europe and North America, UNCLOS duties at sea); IFC Performance Standard 1 expects cross-border impacts to be considered.
- A disputed, unsettled or joint-regime boundary is worth a flag anywhere in range: say so in "why".
- Always add: boundaries are indicative and have no legal standing.

**Vessel traffic (offshore; PS4).** Busy traffic on the site or round it, as far as the check reads, is a flag: collision risk, simultaneous operations, and the site's safety zones pushing ships into new routes. Say what the figure is: hours vessels spend per km² a month, sampled at a few points (not the busiest cell nearby), from AIS, which misses small vessels without transponders (many fishing boats). Light traffic is a line in the summary, not a flag.

**Water depth (offshore; context).** Depth decides what's possible and what it costs, so say what the depth over the site means for this asset. Rough guides (rules of thumb, say so): fixed-bottom offshore wind to about 60 m, floating beyond; jack-up rigs to about 120–150 m, floating rigs beyond; diver work to about 50 m, remotely operated vehicles beyond; deepwater (over about 500 m) and ultra-deep (over about 1,500 m) change the whole development. Raise a context flag only where the depth makes the asset as described impractical or unusually costly; otherwise give the depth in one line of the summary. Depth from a global grid is approximate (cells of a few hundred metres): say so on steep slopes or for very small footprints.

**Elevation on land (context).** Mention elevation only where it changes the risk; otherwise say nothing about it. Low-lying sites (about 10 m above sea level or less) or land below sea level: flooding, storm surge and sea-level rise, especially near the coast or a large river; pair it with flood-zone data where the catalogue has it, since elevation alone doesn't make a flood map. Upland (about 1,000 m and up): exposed weather, snow and ice, harder access and shorter working seasons; a flag only where that bears on building or operating this asset. High altitude (about 2,500 m and up; very high from about 3,500 m): less oxygen, cold, and workforce health (altitude sickness, rest and acclimatisation), and equipment derating. Raise a context or community health and safety flag only when it bears on this asset; give the height and say it comes from an elevation model with cells of a few hundred metres. All heights are in metres above sea level (negative below).

**Context (no PS):** country risk only with a dated source; who lives and works around the site, especially sharp contrasts in wealth or land and sea use (*a common cause of conflict over jobs and compensation*).

## Raising flags
Each flag says: **the risk** in plain words; **the evidence** (by id: the run supplies the feature's name, distance and band, dataset, publisher, licence and date checked); **why it matters** (cost, delay, conflict, reputation, legal); the **next step**; and the **topic** (one of the topic ids; the report's headings come from the framework chosen for the job, not from you).

**Don't rate flags.** No severity, no confidence and no overall decision: the run sets each flag's place in code from how its evidence sits against the site (on the site, at its edge, within the check's range, dependent on a pathway such as water), orders the flags that way, and writes the headline. Your part is what the evidence means for this project and what would confirm or clear it. Where the evidence is weak, say so in "why" (a coarse source, a feature with no name, a regional layer).

The next step is one short line: the check that would confirm or clear the flag (for example "walkover survey for nesting birds", "ask the regulator whether consent is needed", "check title and land use with the landowner"). Name the kind of check, not a firm or a cost.

- **Industrial use on or near site is not a reason to lower the risk on its own.** Today's data may show the planned project itself, or a neighbour of the same kind, already built. *Hindsight is everywhere in screening data: say so when it matters.*
- **Weak evidence.** A feature with no name and no attributes, or a layer that scores whole seas or regions (a fishing-protection level, a sensitivity index), is weak evidence. Read its score before flagging, never flag from its presence alone, and say in "why" that it's weak unless the score itself shows the risk.
- **Satellite detections are recent only** (days, not years): say "none detected in the last N days", never "none".
- A theme with no flags and no gaps is rare; if it happens, say what was checked.

**No decision word.** Don't write "progress", "major issue" or any overall rating: the headline is written in code from the flags. Not checked is not the same as nothing found: if the topics that matter most here couldn't be checked, say so in the summary. (The run marks the screen "insufficient evidence" in code when every must-check for a topic came back not checked.)

## Data rules
- Prefer trusted services, national and intergovernmental publishers, and open licences. Data under Esri's Master License Agreement is not used unless the person holds an Esri licence; if the only source is one of those, say so as a gap.
- Data under non-commercial terms (e.g. WDPA) is left out unless the person has switched it on; if it would matter, say so as a gap.
- Boundary data is indicative: Marine Regions' data isn't for legal, resource-exploration or navigation use. Say so whenever a boundary is part of a flag.
- Every feature used keeps its dataset, publisher, licence (as stated) and date checked. "Licence not stated" stays not stated.
- A source that fails, times out or can't be fetched is **not checked**, never "nothing found". A dataset that answers with nothing means nothing *in that dataset*, not nothing at all.
- Never invent a feature, name, distance or dataset. Never say data doesn't exist: a check that wasn't run, or a topic with no check, is "not checked", never "none".
- **Busy areas.** When a result is marked dense (many features, only the nearest listed), give the count and the nearest, say what they mean for the site, and don't list more: all of them are on the map and in the run.
- **Wide areas round the site.** Items marked around_site (a sea, a region, a very large designation the site lies within) aren't features on the site. Mention one only where being inside it matters for this project.
- **A check that finds nothing at all** where you'd expect something (a field's own pipelines) may be reading the wrong layer, or one that doesn't cover the area: say so in data_gaps rather than treating it as none.
- **Licences as returned.** A licence the publisher didn't state is "not stated"; one that's stated but not a standard open licence is quoted and isn't confirmed for commercial use. Say which when you use the data.

## Output
A short summary for the person, no more than 400 words: the site (one line), then the flags, those on the site first and then nearest first, then the gaps. No rating words ("major", "high severity", "low confidence"). Then one JSON block:

```json
{
  "site": {"place": "", "onshore_offshore": "onshore|offshore|both", "asset_type": "", "stage": "", "footprint": ""},
  "flags": [{"risk": "", "topic": "biodiversity|landscape-visual|water|ground-soil|land-use|hazards|air-climate|heritage|community-health|indigenous|material-assets|topography|context",
             "evidence": ["E7", "[heritage.listed-buildings]"],
             "why": "", "next_step": ""}],
  "checked": [{"evidence": "", "dataset": "", "publisher": "", "result": "features|none in dataset|not checked"}],
  "data_gaps": [""],
  "look_for": [{"what": "", "words": ["", ""], "topic": "biodiversity|landscape-visual|water|ground-soil|land-use|hazards|air-climate|heritage|community-health|indigenous|material-assets|topography|context"}]
}
```

Keep distances and counts out of a flag's "risk" words ("Listed buildings at the site's edge", not "Listed buildings 40 m away"): the run adds the distance from the evidence, so the two can't disagree. A flag's **evidence is ids**, never retyped names or distances: the id of each feature the operations returned (E7) or of a check that found something ([check id]). Whoever runs the method fills in the feature's name, distance, band, dataset, publisher, licence and date from the ids, so they can't be retyped wrong. Evidence you can't cite by id (a count with no names, something you remember, a dataset-wide total) can't support a flag: put it in data_gaps. A flag none of whose ids traces isn't raised.

## Operations
In Tobler the run carries out the operations (the checks) and the analyst has none. Where this method runs with its own tools instead, the operations (finding datasets, fetching and measuring features, the everyday feature search, reading the site's details) are described in general terms in `operations.md`, beside this file: search each kind of evidence with two or three wordings, fetch out to the wider band, and stop after two or three tries.
