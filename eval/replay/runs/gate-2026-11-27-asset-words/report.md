# Replay gate: gate-2026-11-27-asset-words (against gate-2026-11-27-relevance)

**Must facts surfaced:** 48 of 49 that Tobler has a check for (98%); 93 must facts in all.
**Threshold (every must fact with a check surfaced):** failed, 1 not surfaced.
**Regressions against the last gate run:** none.

| Site | Must surfaced | Recall | Found elsewhere | Missed | Beyond reach | Not checked | Check not run | No check | None-expected contradicted |
|---|---|---|---|---|---|---|---|---|---|
| R1 Lethen Wind Farm, Dava Moor | 6 of 7 | 86% | 1 | 1 | 0 | 2 | 2 | 0 | 0 |
| R2 Narachan Wind Farm, Kintyre | 3 of 3 | 100% | 0 | 0 | 0 | 1 | 2 | 4 | 1 |
| R5 Kirkton Energy Park, Strath Halladale | 8 of 8 | 100% | 1 | 0 | 0 | 1 | 1 | 10 | 1 |
| R6 Scoop Hill Community Wind Farm, near Moffat | 4 of 4 | 100% | 0 | 0 | 0 | 1 | 0 | 2 | 0 |
| R11 Whitelee Windfarm Repowering, Eaglesham Moor | 6 of 6 | 100% | 0 | 0 | 0 | 1 | 4 | 1 | 0 |
| R17 Great North Road Solar and Biodiversity Park | 11 of 11 | 100% | 0 | 0 | 0 | 0 | 2 | 2 | 1 |
| R19 Learielaw BESS, near Broxburn | 5 of 5 | 100% | 0 | 0 | 0 | 0 | 0 | 2 | 0 |
| R21 Culham BESS | 5 of 5 | 100% | 0 | 0 | 0 | 0 | 0 | 6 | 0 |

## Must facts missed

- R1: **B9007 road** (road, next to): missed; material.main-roads: none

## Found, not where the document puts it

- R1: Tom na Clach Wind Farm: document 3 km, run 4.82 km (Wind turbine)
- R5: A836: document next to, run 1.66 km (A836)

## Document says none; the run found some

- R2: Residential properties (none within 3 km): run found Homes (residential land) 0 km; Tayinloan 0.39 km; Killean 1.95 km
- R5: Residential properties (none within 1 km): run found Homes (residential land) 0.38 km
- R17: Railway (none within 0 km): run found Nottingham to Lincoln Line 0 km; East Coast Main Line 0 km; Railway 0 km

## Must facts not checked (a source didn't answer)

- R1: Drynachan, Lochindorb and Dava Moors Special Landscape Area: Scotland's Local Landscape Areas aren't in Tobler's data (on the Spatial Hub)
- R1: Deep peat, Class 1 and Class 2 peat: non-commercial licence: off unless switched on in Settings
- R2: Peat: non-commercial licence: off unless switched on in Settings
- R5: Blanket bog and heathland: non-commercial licence: off unless switched on in Settings
- R6: Moffat Hills Regional Scenic Area: Scotland's Local Landscape Areas aren't in Tobler's data (on the Spatial Hub)
- R11: East Ayrshire Local Landscape Area: Scotland's Local Landscape Areas aren't in Tobler's data (on the Spatial Hub)

## Trust checks (scripts/log-checks.mjs)

- Evidence not traced: 0 of 172
- Runs naming more than one UK nation: 1 of 8
- Open publishers not classed open: 0 of 0
- Screens over the slow limit: 0 of 8
- Reply checks (long replies, untraced numbers) don't apply: the gate screens without a conversation.

**mixed_nations:**
- session 4, turn 1: England and Scotland

