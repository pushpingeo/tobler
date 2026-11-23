---
name: ntr-screening
version: 3.9-draft
description: Screen a site, onshore or offshore, for non-technical risk (NTR) from published spatial data. Flags anything that could become a risk, concern or delay (land and livelihoods, biodiversity, Indigenous Peoples, cultural heritage, community health and safety, and the operating context), with traced evidence and what wasn't checked. Use when someone asks what risks, sensitivities or constraints a site, block, field, route or area might raise.
---

# NTR screening

A desk-based first look at a site, the way a GIS analyst supports an opportunity manager: **flag anything that might be a risk, a concern or a cause of delay**, show the evidence, and say how confident you are. The person decides what to act on. A missed risk costs far more than a flag that turns out not to matter, so when in doubt, flag it and say the evidence is weak.

It is a screen, not an impact assessment. The themes follow IFC's Performance Standards (PS4–PS8), because they give the result a structure people recognise; the screen is not an IFC review and doesn't need IFC's language unless asked. This version works onshore and offshore, and finds its own data: it says *what evidence to look for*, and the analyst searches for the best published sources for this place. (The IFC-calibrated, evaluated version is `ntr-screening-ifc`.)

## Inputs
- **Site:** a point, line or area that's already been found or drawn. If there's none yet, find it first (place-finding skill).
- **Asset type:** e.g. solar, wind (onshore or offshore), hydro, thermal plant, mine, oil and gas field or platform, pipeline or cable, port or terminal, exploration block, seismic survey. Ask if it isn't clear and it changes the answer; otherwise say what you assumed.
- **Stage:** greenfield, expansion of an existing site, or an existing asset. If it isn't given, assume **greenfield** and say so. *Most risk comes from new land or sea-bed take and construction.*
- **Onshore or offshore:** from the site itself (the place's details say whether it's offshore). A coastal site screens both ways.
- **Footprint:** when the screen runs as its own run, the run gives the footprint (a point becomes a circle of a radius set by the asset type) and says so; use it. Otherwise, if there's only a point, use a footprint radius and say so: thermal, substation or terminal 0.5 km; solar 1 km; oil and gas plant or platform 1 km; wind 3 km; mine 3 km; hydro 5 km (the reservoir and the dried-out reach run along the river); oil and gas field 5 km. Screen linear assets along the whole line.

## Distances (defaults; the person can change any of them)
Distances are measured from the footprint edge. When the screen runs as its own run, the run gives the distances, chosen from the asset type and size (or set by the person), with the reason: use those and quote the reason. Otherwise use the table below unless the person gives others; when they do, use theirs, say so, and keep them for the rest of the conversation.

| Band | Onshore | Offshore | Why |
|---|---|---|---|
| On site | 0 km | 0 km | Direct take, direct impact |
| Near | up to 1 km | up to 2 km | Construction, safety zones (500 m around installations), anchor spreads |
| Close | 1–5 km | 2–10 km | Noise, dust or discharges, traffic and vessel movements, influx of workers |
| Wider | 5–20 km | 10–50 km | Context: protected sites, communities, fisheries and spill reach are named, not flagged as direct |

State the distances used at the top of the result, and offer to change them.

## Steps
0. **Start from the checks.** The run has already carried out the standard checks before you start, grouped by topic: each is found, none found, or not checked with the reason, and "must" marks a check its topic can't be called clear without. Use them as evidence and don't fetch them again; spend your searches on what's specific to this site, and on the topics the run says have no standard check yet where they matter here. At sea the checks include the water depth over the site and, in European waters, AIS vessel traffic at and around it; on land, the elevation. Judge whether a value matters (low-lying land is a flooding hazard; deep water rules out fixed foundations); the check only measures it. You can read elevation yourself for any place with the elevation operation.
1. **Confirm the site:** location, onshore/offshore, asset type, stage, footprint and distances used.
2. **Plan the evidence.** For each theme below, decide which kinds of evidence apply to this site (onshore, offshore or both).
3. **Find the data.** For each kind of evidence, search for datasets with short, distinctive words (the "search words" below), two or three wordings at a time. Choose, in this order: trusted services and national or intergovernmental publishers; open licences; datasets whose features can be fetched; the most specific coverage (a national layer beats a global one where both exist). Use the everyday feature search for settlements, schools, hospitals, places of worship and cemeteries.
4. **Fetch and measure.** Fetch each chosen dataset for the footprint **out to the wider band** (20 km onshore, 50 km offshore, unless the person set others), then sort what comes back into bands; don't fetch a shorter distance and call the rest clear. A protected area at 20 km offshore is still named. Say which theme each fetch is for (biodiversity, land, indigenous, heritage, community, context), so the result can be shown by theme. Record name, distance, band, source, licence and date for every feature used.
5. **Raise flags** (below), one per distinct risk, most serious first.
6. **State the gaps:** every kind of evidence that applies but wasn't found, failed, or was left out for licence reasons.

Stop searching a kind of evidence after two or three tries with different words. Say what was searched.

If a dataset returns no features at all where you'd expect some (a field's own pipelines, a coast's settlements), suspect the dataset before the site: read its title again ("removed", "proposed", "historic" layers hold something else) and try another source.

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
- Nothing mapped but a strong regional signal: flag at low or medium confidence, labelled *regional knowledge, not mapped data* (highland South and Southeast Asia; forest peoples of central Africa and the Amazon; Andean highlands; pastoralist drylands of East Africa and the Sahel; Arctic and boreal regions; coastal and island communities with customary fishing). *Absence from the map is not evidence of absence.*

**Cultural heritage (PS8)**
- Onshore: listed buildings, scheduled monuments, World Heritage (cultural), graves, cemeteries, shrines and places of worship on site.
- Offshore: shipwrecks, war graves and protected wrecks, submerged archaeology, sea-bed obstructions of historic interest. *Search words:* heritage, monument, listed, wreck, war grave, archaeology.
- Large earthworks or sea-bed works in areas with long settlement history: flag the need for a heritage survey and a chance-finds procedure.

**Community health, safety and security (PS4)**
- Onshore: schools, hospitals and clinics within the near band or by the likely access road; settlements in the close band; no main road within 10 km (new access needed).
- Offshore: vessel traffic from AIS (density by vessel type: the run reads it in European waters; elsewhere search for it); shipping lanes, traffic separation schemes and fairways; ports and anchorages; other installations, pipelines and cables (simultaneous operations); military practice areas; unexploded ordnance; coastal communities in the wider band (spill reach).
- Both: existing industry nearby (cumulative effects); **thermal hotspots and gas flaring** from satellite detections as a sign of existing operations and emissions. *Search words:* shipping, AIS, vessel density, traffic separation, fairway, shipping lane, port, platform, pipeline, cable, military, ordnance, thermal, flaring.

**Cross-border (transboundary; context).** A land border, a maritime boundary or another country's coast within the wider band is a flag.
- Why it matters: effects can cross it (spills, emissions, noise, sediment, river flows, migratory species); a second government and regulator may be involved; the neighbouring country may need to be notified or consulted (the Espoo Convention in Europe and North America, UNCLOS duties at sea); IFC Performance Standard 1 expects cross-border impacts to be considered.
- Confidence: high within the close band, medium in the wider band. A disputed, unsettled or joint-regime boundary is at least medium anywhere in range.
- Always add: boundaries are indicative and have no legal standing.

**Vessel traffic (offshore; PS4).** Busy traffic on the site or in the close band is a flag: collision risk, simultaneous operations, and the site's safety zones pushing ships into new routes. Confidence from distance and the source, as for any mapped feature. Say what the figure is: hours vessels spend per km² a month, sampled at a few points (not the busiest cell nearby), from AIS, which misses small vessels without transponders (many fishing boats). Light traffic is a line in the summary, not a flag.

**Water depth (offshore; context).** Depth decides what's possible and what it costs, so say what the depth over the site means for this asset. Rough guides (rules of thumb, say so): fixed-bottom offshore wind to about 60 m, floating beyond; jack-up rigs to about 120–150 m, floating rigs beyond; diver work to about 50 m, remotely operated vehicles beyond; deepwater (over about 500 m) and ultra-deep (over about 1,500 m) change the whole development. Raise a context flag only where the depth makes the asset as described impractical or unusually costly; otherwise give the depth in one line of the summary. Depth from a global grid is approximate (cells of a few hundred metres): say so on steep slopes or for very small footprints.

**Elevation on land (context).** Mention elevation only where it changes the risk; otherwise say nothing about it. Low-lying sites (about 10 m above sea level or less) or land below sea level: flooding, storm surge and sea-level rise, especially near the coast or a large river; pair it with flood-zone data where the catalogue has it, since elevation alone doesn't make a flood map. Upland (about 1,000 m and up): exposed weather, snow and ice, harder access and shorter working seasons; a flag only where that bears on building or operating this asset. High altitude (about 2,500 m and up; very high from about 3,500 m): less oxygen, cold, and workforce health (altitude sickness, rest and acclimatisation), and equipment derating. Raise a context or community health and safety flag only when it bears on this asset; give the height and say it comes from an elevation model with cells of a few hundred metres. All heights are in metres above sea level (negative below).

**Context (no PS):** country risk only with a dated source; who lives and works around the site, especially sharp contrasts in wealth or land and sea use (*a common cause of conflict over jobs and compensation*).

## Raising flags
Each flag says: **the risk** in plain words; **the evidence** (feature name as the data gives it, type, distance and band, dataset, publisher, licence, date checked); **why it matters** (cost, delay, conflict, reputation, legal); **severity**; **confidence**; the **next step**; and the **theme** (PS4–PS8 or context).

Severity and confidence are separate: severity is how much it would matter if the evidence is right, confidence is how sure the evidence is. A possibly serious issue seen only in coarse global data is high severity, low confidence. **high** = could stop the project, force a redesign or move, or need a permit or consent that is hard to get; **medium** = likely to need specialist study, mitigation or engagement, adding cost or time; **low** = worth noting, unlikely to change the decision.

The next step is one short line: the check that would confirm or clear the flag (for example "walkover survey for nesting birds", "ask the regulator whether consent is needed", "check title and land use with the landowner"). Name the kind of check, not a firm or a cost.

Confidence: **high** = a mapped feature on site or in the near band, from a trusted or national source; **medium** = mapped but in the close or wider band, or several weak signals, or a source of unknown licence or quality; **low** = regional knowledge, or a gap in a place where the risk is common.

- **Industrial use on or near site is not a reason to lower the risk on its own.** Today's data may show the planned project itself, or a neighbour of the same kind, already built. *Hindsight is everywhere in screening data: say so when it matters.*
- **Weak evidence.** A feature with no name and no attributes, or a layer that scores whole seas or regions (a fishing-protection level, a sensitivity index), is weak evidence. Read its score before flagging, never flag from its presence alone, and keep it at low confidence unless the score itself shows the risk.
- **Satellite detections are recent only** (days, not years): say "none detected in the last N days", never "none".
- A theme with no flags and no gaps is rare; if it happens, say what was checked.

**The decision.** End with one overall decision for the site as screened, and one line saying why: **progress** (nothing found that should hold it up), **progress with targeted investigation** (flags that specialist checks could clear or manage), **major issue** (at least one high-severity flag with medium or high confidence), or **insufficient evidence** (too many key sources not checked, or no data, to say). Not checked is not the same as nothing found: if the themes that matter most here couldn't be checked, the decision is insufficient evidence, however clean the rest looks. (The run also settles this in code: when every must-check for a topic came back not checked, a "progress" becomes insufficient evidence.)

## Data rules
- Prefer trusted services, national and intergovernmental publishers, and open licences. Data under Esri's Master License Agreement is not used unless the person holds an Esri licence; if the only source is one of those, say so as a gap.
- Data under non-commercial terms (e.g. WDPA) is left out unless the person has switched it on; if it would matter, say so as a gap.
- Boundary data is indicative: Marine Regions' data isn't for legal, resource-exploration or navigation use. Say so whenever a boundary is part of a flag.
- Every feature used keeps its dataset, publisher, licence (as stated) and date checked. "Licence not stated" stays not stated.
- A source that fails, times out or can't be fetched is **not checked**, never "nothing found". A dataset that answers with nothing means nothing *in that dataset*, not nothing at all.
- Never invent a feature, name, distance or dataset. Never say data doesn't exist unless you searched for it, and then say what words and area you searched.

## Output
A short summary for the person, no more than 400 words: the decision and why (one line), the site and distances used (one line), then the flags, most serious first, then the gaps. Then one JSON block:

```json
{
  "site": {"place": "", "onshore_offshore": "onshore|offshore|both", "asset_type": "", "stage": "", "footprint": ""},
  "distances_km": {"near": 1, "close": 5, "wider": 20, "set_by": "default|person"},
  "decision": "progress|progress with targeted investigation|major issue|insufficient evidence",
  "decision_why": "",
  "flags": [{"risk": "", "theme": "PS4|PS5|PS6|PS7|PS8|context", "severity": "high|medium|low", "confidence": "high|medium|low",
             "evidence": [{"name": "", "distance_km": 0, "band": "on site|near|close|wider", "dataset": "", "publisher": "", "licence": "", "checked": ""}],
             "why": "", "next_step": ""}],
  "checked": [{"evidence": "", "dataset": "", "publisher": "", "result": "features|none in dataset|not checked"}],
  "data_gaps": [""]
}
```

## Operations
The operations this method uses (finding datasets, fetching and measuring features, the everyday feature search, reading the site's details) are described in general terms in `operations.md`, beside this file, so the method can run in other settings with their own tools.
