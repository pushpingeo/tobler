---
name: cartography
version: 0.4-draft
description: How to make a printed map from a site screen that a consultant can hand on: the sheet, the projection, the furniture every map must carry, what goes in the legend, how the extent and scale are chosen, and how the map says what it is and isn't. Use whenever a map leaves the screen as a page (a report page, a map series sheet, an image for a document).
---

# Cartography for screening maps

A screening map is read away from the tool that made it, often by someone who never saw the run. It has to say
where it is, what it shows, how far, from what sources and on what terms, on its own. These rules are for that.

The rules marked **always** are applied by the map template in code, not chosen per map. The rest are judgements the
template makes by the rules written here; a person can override them.

## 1. The sheet
- Map series: A3 landscape, one map per sheet, maps only. The map frame and the information panel share one outer
  border: the panel's edge is the map's edge, with no gap.
- Report maps: A4 portrait, inside the report's pages, with the same furniture in a smaller form.
- Each sheet stands alone. No "map 3 of 8" in the title; the run id and date are in the panel's small print, with
  the product's address (asktobler.com) there too, discreetly. No product logo on the sheet.
- Leave white space outside the map frame for the coordinate labels.

## 2. Projection (always)
- Printed maps are drawn in a projected CRS, never Web Mercator. The default is **WGS 84 / UTM** for the zone holding
  the site's centre (EPSG 326zz north, 327zz south), from the EPSG registry, never typed in from memory.
  Norway and Svalbard's zone exceptions apply; a site across a zone line takes the zone holding most of its area.
- WGS 84 to WGS 84 / UTM is a conversion on one datum: no transformation, nothing to choose, nothing lost. Data held
  in other datums reaches the map only through the coordinate-reference skill's pipeline.
- A national grid may replace UTM where a reporting profile asks for it (British National Grid for a UK planning
  report). That needs a transformation chosen by the coordinate-reference skill, and the map says which.
- The basemap is drawn in Web Mercator and warped into the map's CRS. Its labels turn by the grid convergence (a
  degree or two); vector layers are drawn directly in the map's CRS.
- These maps are never for navigation, and grid lines over a screening map suggest more accuracy than its sources
  have (Rob, 28 Nov). So: no grid lines, no graticule, no true-north correction.

## 3. Furniture every map carries (always)
- **Title** from the place, the asset and the topic: "Culham BESS: heritage". A subtitle with what's planned, the
  site's area and the date screened.
- **North arrow** (grid north), on the map face, in the top-left or top-right corner, whichever has less drawn
  there (the site counts most); the right when they're equal. A plain arrow and N: no halo, circle or
  convergence note.
- **Scale bar** in the panel, near the bottom, beside the coordinate statement; the scale as a ratio for the paper
  size printed ("1:25,000 at A3"). Always one of the standard round scales in section 5.
- **Coordinate ticks** outside the map frame, in the map CRS's eastings and northings: ticks only, no lines across
  the map. The interval is the first of 100, 200, 250, 500 m, 1, 2, 5, 10 km that puts ticks at least 30 mm apart
  (1 km at 1:25,000). Labels in full metres, grouped in threes ("622 000"), on the left and bottom edges; the corner
  labels carry the units ("mE", "mN").
- **Coordinate statement:** the CRS by name and EPSG code, and the tick interval.
- **Locator:** a small map placing the site in its country, filling the panel's width.
- **Sources:** each layer drawn, with publisher, licence and the date it was queried. A licence that isn't stated is
  printed as "licence not stated". The basemap's attribution, as its licence asks.
- **Small print:** the run id, the skill and its version, the date printed, the paper size, asktobler.com.
- **Disclaimer in the panel's small print**, beside the run details, exactly: "Made with Tobler from public web services,
  each named under Sources. A screening map: boundaries may have been generalised. Not a survey, title plan or legal
  boundary." It says what the map is for without talking it down.

## 4. The legend (always)
- Only what draws inside the frame. A layer with no feature in the map's extent gets no patch, even if it was
  checked. Whether something draws is tested on real shapes against the frame, not on boxes.
- The site first, then the distance bands, then the topic's layers, then context layers, each named as the source
  names it, in plain words.
- Colour never carries meaning alone: each patch has its name, and similar colours differ in pattern or outline.
- What was checked and found nothing is said in the report, not the legend.

## 5. Extent and scale
- Map 1 (on the site): the site fills most of the frame.
- Map 2 (around the site): the site grown by the furthest finding's distance, up to the run's furthest reach.
- Topic maps: the site grown by that topic's furthest finding, so every finding on the topic's list is on its map.
- Then the next standard scale up: 1:2,500, 1:5,000, 1:10,000, 1:25,000, 1:50,000, 1:100,000, 1:250,000. The frame
  is filled at that scale, so the map usually shows more than the minimum.

## 6. Drawing
- Red is the site's alone: a red line with a white casing, a faint fill.
- Distance bands are true buffers of the site's outline (geodesic), drawn faint and dashed, labelled by distance.
- Topic colours come from the shared topic palette (at most eight); context layers are drawn quieter than the
  topic's own.
- Labels for findings named in the report; others unlabelled unless the map is otherwise bare. Labels sit clear of
  lines and other labels, with a halo.

## 7. What a map never does
- Show a feature the run didn't fetch without saying where it came from.
- Hide that a check wasn't run: a topic map whose main check failed says so on the sheet.
- Use a scale bar or coordinate ticks that weren't computed in the map's CRS.
