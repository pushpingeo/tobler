---
name: contamination-desk-study
version: 0.2-draft
description: An early contaminated-land look at a site on land, from open records: the potential sources on and around it, the pathways and the receptors, set out as a preliminary conceptual site model with the possible contaminant linkages, and what a full desk study would add. Use when someone asks about contamination, past land use, landfill, pollution or ground conditions at a site, or picks the contamination desk study.
---

# Contamination desk study (preliminary, from open records)

## What this is
The desk-study part of a preliminary risk assessment, in the shape of the Environment Agency's Land Contamination Risk Management (LCRM) Stage 1 in the UK, and of an ASTM-style records review in the US. A contaminant linkage needs all three of a source (a contaminant in, on or under the land), a pathway (a route) and a receptor (something that could be harmed). This study looks for plausible linkages in open records. It doesn't replace a full desk study: there's no walkover, no historical maps and no commercial environmental search, and the result must say so.

Write in plain words. Name the standard once ("in the shape of LCRM Stage 1"); don't quote it.

## What you're given
The run has already carried out the checks this study uses, before you start, grouped as **potential sources**, **pathways** and **receptors**. Each check is found, none found, or not checked with its reason, with the nearest features by name and distance. Distances are measured from the site's edge in code. You have no tools: work only from the checks, and never work out a distance yourself.

## How to judge
1. **Sources.** Start with the site itself: if it was found as an industrial feature (a refinery, works, depot, quarry, landfill or industrial land; the first message says what it was anchored on), its own current or past use is a potential source on site, from that record, even when no contamination layer covers it. Then list what's on site and nearby, nearest first. A landfill, mine waste or a permitted industrial site on the site or within 250 m matters most; a pollution incident record says something went wrong there once. Old records are still records. A source check that wasn't checked is a gap, never "no source".
2. **Pathways.** Groundwater protection zones (the site in a source protection zone, or over a principal aquifer when that's known), flooding (water moving contamination), surface water and peat (gas, soft ground). Geology and permeability aren't in open records here: say so rather than assume.
3. **Receptors.** People who live, learn or are cared for nearby; controlled waters (groundwater in a protection zone, rivers); protected nature sites; and the site's own future users. Radon is natural background, not contamination: mention it as a ground-gas consideration for buildings, not as a linkage.
4. **Linkages.** For each plausible source → pathway → receptor chain, raise one flag. Rate it:
   - **likely**: a source on or next to the site with an open pathway to a sensitive receptor (landfill on site over a source protection zone);
   - **possible**: the parts are there but further apart, or one link is uncertain;
   - don't flag chains you'd call unlikely; mention them in the summary in a line if they're worth knowing.
   Severity is how much it would matter if the linkage is real (high: could stop or redesign the project, or need remediation before use; medium: needs investigation and maybe mitigation; low: note it). Confidence comes from the evidence: high for an official record on or next to the site, medium for one further off or an approximate location, low when a key link is assumed.
5. **The decision**, in this study's own words:
   - **no linkages identified in open records**: nothing found that forms a plausible chain. Still say what a full study would add.
   - **possible linkages: investigate**: one or more possible linkages.
   - **likely linkages: investigate before purchase or design**: at least one likely linkage with medium or high confidence.
   - **insufficient evidence**: the source checks that matter here weren't checked (a service failed, or there's no source for this region).
   Past land use is the biggest gap almost everywhere. If the site looks previously developed (a town centre, industrial land) and no past land-use record covers it, say that the study can't rule out contamination from past uses.
6. **Next steps**, as kinds of check, never a firm or product: a site walkover; historical maps and a commercial environmental search; a Phase 1 desk study report; ground investigation if a likely linkage stands.

## Output
A short summary for the person, no more than 250 words: the decision and why (one line), then the linkages, most serious first, then the biggest gaps. Then one JSON block:

```json
{
  "decision": "no linkages identified in open records|possible linkages: investigate|likely linkages: investigate before purchase or design|insufficient evidence",
  "decision_why": "",
  "flags": [{"risk": "", "topic": "ground-soil|water|air-climate|community-health|biodiversity|hazards",
             "linkage": {"source": "", "pathway": "", "receptor": "", "rating": "likely|possible"},
             "severity": "high|medium|low", "confidence": "high|medium|low",
             "evidence": [{"name": "", "distance_km": 0, "dataset": ""}],
             "why": "", "next_step": ""}],
  "checked": [],
  "data_gaps": [""]
}
```

Each flag's "risk" is the linkage in plain words ("Landfill 120 m north could affect groundwater in the source protection zone"). Its "topic" is the source's topic. Evidence names features exactly as the checks gave them. At most 6 flags; "data_gaps" at most 8 short lines, and don't repeat checks already listed as not checked unless you add something.
