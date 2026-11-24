---
name: developable-area
version: 0.1-draft
description: How much of a site could actually be built on. Starts from the gross area, takes off what can't be used and what should be kept clear, each with its reason and source, and shows what's left on the map, with soft constraints (usable at a cost) measured but not taken off. Use when someone asks for the developable area, net area, usable area, area discounting or "how many hectares can I really use", or picks the developable area.
---

# Developable area (area budget)

## What this is
An area budget for a site outline: the gross area, each deduction in hectares and as a share of the gross, the net developable area, and the soft constraints inside it. It's a measure with stated rules, not a judgement on whether the site is good. There's no decision line. The numbers are worked out in code by the `area_budget` tool; nothing here is estimated.

It answers the early site-finding question: "the field is 40 ha, but how much is really usable?" It doesn't design a layout. Access tracks, panel spacing, substations and drainage come later and take more off.

## What it needs
- **An outline.** An area or footprint the person drew, brought in a file, or that was found as a published outline. A point or a search area (a shape standing in for an outline nobody found) is refused: a budget on a guessed boundary would read as fact.
- **An asset type:** solar, battery storage (BESS), onshore wind, warehouse or industrial, or general. It sets which deductions apply and their buffers. If the person hasn't said, ask with buttons or use general and say so.
- **The person's own rules, if they give them.** "Keep 100 m from homes", "leave out the buildings, they're coming down", "count flood zone 3 as usable". These override the defaults and the card says what changed.

## How to read the conversation into the run
- Map the person's words to the rule ids below. A buffer change goes in `buffers` (`{"id": "homes", "buffer_m": 100}`); a deduction they want ignored goes in `leave_out`; one they'd treat as usable at a cost goes in `as_soft`.
- Only use what they actually said. Never add a rule of your own to the person's list.
- If they ask for something no rule covers (a 30 m stand-off from a hedge), say it isn't one of the deductions Tobler can measure yet.

## Order and overlaps
Deductions are applied in the order below: what can't be built first, then what's kept clear, then what's avoided by default. Each takes only what's still left, so ground under two constraints is counted once, against the first. Soft constraints are measured on the net area, each counted once, and aren't taken off.

## The defaults and why
Buffers are first cuts for site finding, to be changed: none of them is a planning rule unless the reason says it is. A buffer of `null` means the deduction doesn't apply to that asset type.

- **Statutory nature sites** (SAC, SPA, Ramsar, SSSI or ASSI): the designated land itself. Building inside one is very unlikely to be consented.
- **Scheduled monuments and World Heritage Sites:** the protected land itself. Works need consent and are rarely allowed.
- **Ancient woodland, with 15 m:** irreplaceable habitat; Natural England and the Forestry Commission's standing advice is a buffer of at least 15 m.
- **Open water:** lakes, ponds and reservoirs on the site.
- **Existing buildings:** what's already standing. Leave out if they're to be cleared.
- **Main roads and railways, 15 m from the centre line:** the corridor itself and a margin. Minor roads and tracks aren't in the data.
- **Watercourses, 8 m:** in England, work within 8 m of a main river needs a flood risk activity permit (16 m if tidal). OpenStreetMap doesn't say which streams are main rivers, so all get 8 m.
- **Overhead power lines, 30 m; pipelines, 10 m:** a first-cut easement either side. The real distance depends on the voltage or pressure and the operator's rules: ask them.
- **Homes:** solar 50 m, BESS 100 m, onshore wind 500 m, none for a warehouse or general. Rules of thumb for amenity (noise, glare, outlook, fire risk), not policy distances. Residential land from OpenStreetMap stands in for homes and includes gardens.
- **Listed buildings:** solar and BESS 50 m, onshore wind 250 m. A rough allowance for setting; setting is a judgement a heritage specialist makes, not a distance.
- **Flood Zone 3** (and Scotland's medium likelihood, 1 in 200 years): avoided by default. The sequential and exception tests apply. Solar can sometimes go here with raised panels; count it as soft if so.
- **Soft, measured but not taken off:** Flood Zone 2 (and Scotland's low likelihood); surface water flooding; best and most versatile farmland (grades 1, 2 and 3a; Scotland's classes 1 to 3.1), with unsplit grade 3 apart; peat (Scotland's classes 1, 2 and 5).
- **Not checked:** slope. Tobler can't read slope across an area yet, so steep ground is listed as not checked, never as none.

## Honest about gaps
- A deduction whose data wasn't checked (a service failed, no data for this country) is listed as **not checked** with the reason. It's never a zero.
- OpenStreetMap's completeness varies. Buildings, water and residential land mapped as a multipolygon relation are read only by their centre point, so their area isn't counted; the card says how many.
- Outside the UK most designations and the flood, farmland and peat layers have no source. The budget then rests on OpenStreetMap alone and says so.

## After the run
The card shows the budget table, the map shows what's left and what was taken off, and every row has its reason and source. In the conversation, reply in two or three sentences: the net area and its share, the biggest deduction, and the biggest gap (often slope). Don't repeat the table.

## Rules
The run reads this block. Kinds: `hard` (can't build), `buffer` (keep clear), `avoid` (taken off by default, could be argued), `soft` (measured on what's left, not taken off). `classes` keeps only features whose class is one of these, or one of these followed by a space ("Flood Zone 3" keeps "Flood Zone 3 (rivers)"; "Grade 3" doesn't keep "Grade 3a").

```json
{
  "asset_types": {
    "solar": "solar farm",
    "bess": "battery storage (BESS)",
    "wind-onshore": "onshore wind",
    "warehouse": "warehouse or industrial",
    "general": "general (no asset type)"
  },
  "deductions": [
    {"id": "nature-sites", "label": "Statutory nature sites", "kind": "hard", "checks": ["bio.sac", "bio.spa", "bio.ramsar", "bio.national-sites"], "buffer_m": 0,
     "reason": "Designated for nature (SAC, SPA, Ramsar, SSSI or ASSI): building inside is very unlikely to be consented."},
    {"id": "monuments", "label": "Scheduled monuments", "kind": "hard", "checks": ["heritage.scheduled-monuments"], "buffer_m": 0,
     "reason": "Works on a scheduled monument need consent, rarely given."},
    {"id": "world-heritage", "label": "World Heritage Sites", "kind": "hard", "checks": ["heritage.world-heritage"], "buffer_m": 0,
     "reason": "The inscribed property itself."},
    {"id": "ancient-woodland", "label": "Ancient woodland", "kind": "hard", "checks": ["bio.ancient-woodland"], "buffer_m": 15,
     "reason": "Irreplaceable habitat; standing advice is a buffer of at least 15 m."},
    {"id": "water-bodies", "label": "Open water", "kind": "hard", "checks": ["water.water-bodies"], "buffer_m": 0,
     "reason": "Lakes, ponds and reservoirs on the site."},
    {"id": "buildings", "label": "Existing buildings", "kind": "hard", "checks": ["material.buildings"], "buffer_m": 0,
     "reason": "Already built on. Leave out if they're to be cleared."},
    {"id": "roads-rail", "label": "Main roads and railways", "kind": "hard", "checks": ["material.main-roads", "material.railways"], "buffer_m": 15,
     "reason": "The corridor and a margin, from the centre line. Minor roads aren't in the data."},
    {"id": "watercourses", "label": "Watercourses", "kind": "buffer", "checks": ["water.watercourses"], "buffer_m": 8,
     "reason": "In England, work within 8 m of a main river needs a flood risk activity permit; all watercourses get 8 m here."},
    {"id": "power-lines", "label": "Overhead power lines", "kind": "buffer", "checks": ["material.power-lines"], "buffer_m": 30,
     "reason": "A first-cut easement each side; the operator sets the real distance by voltage."},
    {"id": "pipelines", "label": "Pipelines", "kind": "buffer", "checks": ["material.pipelines"], "buffer_m": 10,
     "reason": "A first-cut easement each side; the operator sets the real distance."},
    {"id": "homes", "label": "Homes", "kind": "buffer", "checks": ["community.homes"], "buffer_m": {"solar": 50, "bess": 100, "wind-onshore": 500, "warehouse": null, "general": null},
     "reason": "A rule of thumb for amenity (noise, glare, outlook, fire risk), not a policy distance. Residential land, gardens included."},
    {"id": "listed-buildings", "label": "Listed buildings", "kind": "buffer", "checks": ["heritage.listed-buildings"], "buffer_m": {"solar": 50, "bess": 50, "wind-onshore": 250, "warehouse": null, "general": null},
     "reason": "A rough allowance for setting; setting is a heritage specialist's judgement, not a distance."},
    {"id": "flood-zone-3", "label": "Flood Zone 3", "kind": "avoid", "checks": ["water.flood-zones"], "classes": ["Flood Zone 3", "River, medium", "Coastal, medium"], "buffer_m": 0,
     "reason": "Highest flood probability: the sequential and exception tests apply. Solar can sometimes go here on raised panels."},
    {"id": "flood-zone-2", "label": "Flood Zone 2", "kind": "soft", "checks": ["water.flood-zones"], "classes": ["Flood Zone 2", "River, low", "Coastal, low"], "buffer_m": 0,
     "reason": "Medium flood probability: usable, with a flood risk assessment."},
    {"id": "surface-water", "label": "Surface water flooding", "kind": "soft", "checks": ["water.surface-water"], "buffer_m": 0,
     "reason": "Ponding after heavy rain: drainage design, not usually a bar."},
    {"id": "bmv-farmland", "label": "Best and most versatile farmland", "kind": "soft", "checks": ["land.farmland-grade"], "classes": ["Grade 1", "Grade 2", "Grade 3a", "Class 1", "Class 2", "Class 3.1"], "buffer_m": 0,
     "reason": "Grades 1, 2 and 3a (Scotland 1 to 3.1): planning policy steers solar and other development away from it."},
    {"id": "grade-3-unsplit", "label": "Grade 3 farmland, not split into 3a and 3b", "kind": "soft", "checks": ["land.farmland-grade"], "classes": ["Grade 3"], "buffer_m": 0,
     "reason": "May be best and most versatile: only a field survey says whether it's 3a or 3b."},
    {"id": "peat", "label": "Peat and carbon-rich soils", "kind": "soft", "checks": ["ground.peat"], "classes": ["Class 1", "Class 2", "Class 5"], "buffer_m": 0,
     "reason": "Disturbing peat releases carbon and needs a peat management plan."}
  ],
  "not_checked": [
    {"id": "slope", "label": "Steep ground", "kind": "soft", "why": "Tobler can't read slope across an area yet"}
  ]
}
```
