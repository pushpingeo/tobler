---
name: place-finding
version: 4.14
description: Turn words into a place on the map. Use when someone names a place, an asset or a project ("the Jackdaw platform", "solar farm 10 km north of Mocuba"), or describes an area ("a 3 km² block around…", "a 5 km corridor along…"), so the result is a pin, line or area with its evidence and a confidence rating.
---

# Place finding and area definition

Finding where something is, and building the area someone means, the way a careful GIS analyst would: from evidence, with the method written down, and without guessing. Every later analysis depends on this step: a pin 30 km out puts the buffers on the wrong protected areas and communities.

You never do geometry in your head. Tools find anchors and build shapes; you choose which tool, with which numbers, and explain why.

## Steps
1. **Read the request for every clue:** named places, the asset and its type (platform, field, block, dam, mine, solar or wind farm, port, town), distances and bearings ("10 km north of"), sizes ("3 km²", "5 km wide"), and the country or sea.
   - **Decide what the main site is.** Many projects have several parts: a mine with a railway and a port, a dam with a power station and transmission line, a plant with a pipeline. Unless the person says otherwise, the main site is where the land is taken and the asset operates: the mine, the dam or reservoir, the plant or solar or wind farm. A port, an office, a capital city or a company's head office is not the site.
2. **Find the anchor** with `find_place`. Search for the asset itself before the nearest town: *an asset matched as a mapped feature is far more precise than a settlement.*
   - Try the asset's own name in a few forms in **one** `find_place` call: `query` plus up to three more in `also` (the distinctive word alone, "Tasiast"; with its type, "Tasiast mine"; the operator if it's a company name). Searches that don't depend on each other (the asset and the town it's described from) go in the same step; they run at the same time. Wikidata often has named mines, dams, power plants and ports with coordinates; OpenStreetMap often doesn't name them.
   - **Search the catalogue for things OpenStreetMap rarely holds.** For a licence block or concession, a field, a well, a wind lease, a protected area, an official boundary or a numbered road, pass `kind` and `area` (the country, or a found place) to `find_place`. It finds the published layers that hold that kind of thing there, anywhere in the world, and searches them for the name. Search with the reference as people write it ("OML 145", "30/2", "PEL 83").
   - Prefer authoritative sources (government, regulator or national mapping layers from the catalogue; NSTA and Crown Estate layers in UK waters), then a Wikidata or OpenStreetMap item **of the right type** (a mine for a mine, a dam or reservoir for hydro). Say which you used.
   - **If it isn't found, say what was searched,** from the `atlas` part of the reply: which kinds of layer covering which area, how many, and that none held it (or that the catalogue has none there). Don't point the person to a layer for another country. Then offer what you can do: they can draw the outline on the map, or you can find a nearby feature. Files and web services can't be loaded yet, so don't offer them.
   - A result of the wrong type (an airport, a viewpoint, an office, a village that shares the name) is only a clue for where to look next, never the site itself.
   - **Project and area names are often town names.** "The Sembehun mining area" or "the Kipoi project" may share a name with a village. The village tells you where to search; the site is the mine, lease or plant found near it. If only the village can be found, it's `settlement_or_region`.
   - If the asset isn't found by name, find the town or feature it's described from, then use `find_features_near` to look for the asset by type around it (e.g. solar farms within 15 km of Mocuba). A feature of the right type, size and bearing is strong evidence. For big assets (mines, dams, large plants), the largest feature of the right type near the named place is usually the one.
   - You may use what you already know (for example that a company mines near a particular town) to decide **where to search**, but the place itself must come from a found feature. Say when a clue came from your own knowledge.
3. **Triangulate** when there are two or more clues: the candidate should fit all of them (name, type, country, distance and bearing). Say which clues agree and which don't.
   - **Once the asset itself is found, distances in the description are checks, not moves.** "Village X lies 25 km east of the mine" tells you where the village is relative to the mine; it doesn't mean the mine is 25 km from where you found it. Use offsets to *place* something only when the asset can't be found and you're working out where it is from a named reference.
   - **Large features need their outline, not a point.** A salt flat, reservoir, lake, concession or district can be tens of kilometres across, and a gazetteer point is just somewhere in it, often the middle. Use the feature's outline (`shape: "feature"`) where the source has one; if the description says which part ("the south-eastern sector of the salar"), find that part. A point for a large feature can't be better than medium confidence.
   - **Gazetteer points can be rough.** A Wikidata or OpenStreetMap point for a mine, a salt flat, a reservoir or a port is sometimes the centre of a much larger feature, or a town's position reused. Check it against the other clues (distances to named villages, rivers, "the south-eastern part of the salar"). If it disagrees with them by more than about 5 km, look for a feature that fits all the clues (`find_features_near`), prefer that, and say why; if nothing better turns up, keep the point with low confidence.
4. **Build the shape** with `make_place`, using the anchor's id. Say how the anchor matched (`match`): when the person named the place itself and that's what you found ("5 km round Linlithgow Palace" → the palace; "block 30/2"; "Fife"), it's `named_place`, even if the source is Wikidata or OpenStreetMap, and pass **every distance clue** in the request as a `check` against the feature it names (find that feature first), with the person's own words it comes from (`quote`). Only clues the person gave: never make a check up from what you know (a landmark you think is nearby); one without the person's words is left out. The tool measures them from the place it builds and works out the confidence; you don't choose it. Choose the shape from the words:
   - "around", "centred on" with an area or size → square, circle or rectangle centred on the anchor. "Block" or "box" means a square unless the context says otherwise; "radius" or "within X km" means a circle.
   - A named area (a field, a licence block, a park) → the feature's own outline (`shape: "feature"`).
   - "X km north of" → offset from the anchor by distance and bearing. When the person defines the site itself by size and position ("a 1 km² site 5 km west of Évora"), nothing existing is meant: pass `site_defined: true`, and the shape is the site, not a search area.
   - "Along", "corridor" → a buffer around a line.
   - A bare point anchor with no size → a point.
   - **Scale is worked out, and asked only when it's genuinely unclear.** The shape's size usually decides it (up to ~50 km across is local, up to ~1,000 km regional). Pass `scale` only when the request itself says the scale of the work and the shape doesn't show it, e.g. "screen the whole country" around a capital's pin. The project summary also gives the map view's width, which tells you the scale the person is looking at when there's no place yet. If the request, the place's size and the view still leave it open (a country's name with no size, say), ask or confirm in one short question that can be answered in words.
5. **Show it and ask** whether it's what they meant. One short question, only about what's genuinely uncertain.
6. **Adjust** with `edit_place` when asked ("make it 5 km²", "rotate it 30°", "move it 2 km east").
7. **Keep the map tidy.** To rebuild or correct a place you proposed, call `make_place` with `replaces` set to its name: the old one is removed and the new one takes its name. Pass the person's clues again (corrected if they corrected them); any clue that failed before and is left out is listed in the result, and you say why. Never leave a duplicate for the person to delete. `remove_place` removes a place when the person asks, or a proposal of yours that's no longer wanted.

## Corridors along roads, rivers and lines
"A 1 km corridor along the M9 between Linlithgow and Falkirk": find both towns, then `find_features_near` with feature type `main road` (or `river`, `railway`, `pipeline`, `power line`) around a point between them, a radius that reaches both, and `name` set to the road number or river name. Roads and rivers come back in pieces: build one `buffer` with the nearest piece as the anchor and the others in `also`. Say which pieces were used and that the ends follow the pieces found, not the town boundaries exactly. When the words set a limit ("within 5 km of Linlithgow", "only inside Fife"), add `clip` to the same `make_place` call: `{ to: <the town's or area's id>, within_km: 5 }`, or `{ to: <the area's id> }` to cut to its outline. If no line is found, don't draw a straight line in its place: offer that the person draws it.

## Ambiguity: ask, don't guess
- **Several candidates fit** (two platforms of the same name, a town name in several countries, the same landmark in two sources): call `offer_choices` with the two to five best, in order, mark the one you recommend and give a one-line reason. The person flicks through them on the map, each with its source, and picks one or takes your recommendation. Don't build a place until they've chosen. Only offer choices when the difference matters: if two sources give the same thing within a few hundred metres, use the more authoritative one and say so.
- **One name, several parts:** a wind farm or field often comes as phases or parts (Dogger Bank A, B and C; extensions; a later leasing round nearby). Offer the choice of one part or all of them joined (`make_place` with `shape: "feature"` and the other parts in `also`), and say which parts are built, under construction or only proposed.
- **Words with two meanings:** in UK offshore work, "block" can mean a licensing block (e.g. 30/2). If someone says "the block around X" near a licensed area, offer both: the square they described and the licensing block the anchor sits in.
- **Only one vague anchor** (a district or region name) for something that needs a precise site: say the site can't be located from that, give the region as a low-confidence area if useful, and say what would pin it down.
- Never invent a location, and never move a pin to "where it probably is" without a found feature.

## Confidence (worked out by the tool)
`make_place` rates confidence from the evidence, and returns the rating and the rules behind it. Report what it says; don't overrule it.
- **Where it starts:** an authoritative layer matched by name, or the place the person named themselves, is high. Wikidata or OpenStreetMap matched by name and type, or a feature of the right type where the clues point, is medium. A settlement, a region, a name-only match or nothing specific is low.
- **Checks move it:** any failed check makes it low. Only tight checks (clues within about 14 km) raise it: a distance with a direction pins the site, a distance alone only puts it on a ring. A name-and-type match rises to high with one tight directional check or two tight ones. So pass the direction whenever the words give one.
- **Caps:** placed by an offset from a reference, or a point for a large feature, is at most medium.
- **When a check fails,** don't argue it away. Say which clue doesn't fit, look for a feature that fits all the clues (`find_features_near`), and rebuild if you find one. If nothing better turns up, keep the place at low confidence and say so.
- Pass all the clues, including ones you expect to fail. A check that isn't passed can't help, and one that's hidden makes the rating dishonest. Rebuilding without a failed check doesn't hide it: with `replaces`, the result lists failed checks you left out, and you tell the person unless they corrected the clue.

## Reporting
- Name the anchor the way the source names it, with its source and licence ("JACKDAW, platform, NSTA").
- Give the shape's size and where it is in plain words; the tools return these.
- Keep it short. The map shows the shape; the card holds the detail.
- **Directions:** when you say where the site is relative to a town, quote the check's `reads` line rather than working out the direction yourself.
- **Name features by their names.** Ids (C3) are handles for the tools only; the map labels features by name. Never write an id to the person; if two features share a name, add the source or a distance.
- **If a shape can't be built, say so.** Never put a different shape in its place (a circle of the same area instead of a published outline): that's an invented boundary presented as the publisher's.
- Only offer what the tools can actually do.
- **Distances to areas:** `nearest_edge_km` is to the area's edge (0 means the place is inside it, also shown as `contains_anchor`); `distance_km` is to its centre. For "within X km" use the edge.
- **Say what wasn't checked.** If a source was `not_checked`, or the atlas reports `more_layers_not_checked`, say the list may be incomplete and why, in one line.
- Coordinate data you're given is WGS84. If a source states another datum (e.g. ED50 positions in older North Sea data), mention it: ED50 and WGS84 differ by about 100 m there.

## Operations
The operations named above (`find_place`, `find_features_near`, `make_place` and the rest) are described in general terms in `operations.md`, beside this file, so the method can run in other settings with their own tools.
