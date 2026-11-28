---
name: cartography
version: 0.7-draft
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
- Report maps: overview maps inside the report's A4 pages. They carry less (Rob, 28 Nov): no coordinate ticks or
  labels; a north arrow by the same corner rule as the series; a simple scale bar (a round length, labelled once,
  no ratio, since nobody measures from them) in whichever bottom corner is quieter and not taken by the arrow. The
  page's caption names the bands; the report's back pages carry sources and the coordinate statement.
- Each sheet stands alone. No "map 3 of 8" in the title; the run id and date are in the panel's small print, with
  the product's address (asktobler.com) there too, discreetly. No product logo on the sheet.
- Leave white space outside the map frame for the coordinate labels.
- The panel reads from both ends (Rob, 28 Nov): title, legend, locator and sources from the top; the scale, the
  coordinate statement, the disclaimer and the small print sit on the bottom edge, whatever is above them. Spare
  room falls between the two, never under the small print.

## 2. Projection (always)
- **One presentation CRS per run**, chosen once in code from where the site is, recorded in the run record with the
  operation that gets there, and used by every output: report maps, map series, coordinates in tables, the data
  pack's map files. No output picks its own. A run shown in UTM never shows British National Grid anywhere, and the
  reverse.
- **The country's standard grid where it has one, UTM elsewhere.** The table of national grids is data (country,
  outline, EPSG code), not code: Great Britain, British National Grid (EPSG:27700); Northern Ireland, Irish
  Transverse Mercator (EPSG:2157); the Netherlands, RD New (EPSG:28992); Australia, GDA2020 / MGA by zone. Anywhere
  else: WGS 84 / UTM for the zone holding the site's centre (EPSG 326zz north, 327zz south), Norway's and Svalbard's
  zone exceptions applied; a site across a zone line takes the zone holding most of its area. Membership is decided
  on real outlines, never a box.
- Codes come from the EPSG registry, never typed in from memory.
- **Getting there:** to UTM from WGS 84 is a conversion on one datum, with nothing to choose. To a national grid on
  another datum is a transformation, chosen by the coordinate-reference skill's pipeline for where the site is, and
  the sheet names it with its accuracy (for example "OSGB36 to WGS 84 (6), EPSG:1314, about 2 m"). No map code holds
  datum parameters.
- The basemap is drawn in Web Mercator and warped into the presentation CRS. Its labels turn by the grid convergence
  (a degree or two); vector layers are drawn directly in the presentation CRS.
- These maps are never for navigation, and grid lines over a screening map suggest more accuracy than its sources
  have (Rob, 28 Nov). So: no grid lines, no graticule, no true-north correction.

## 3. Furniture every map-series sheet carries (always)
- **Title** from the place, the asset and the topic: "Culham BESS: heritage". A subtitle with what's planned, the
  site's area and the date screened.
- **North arrow** (grid north), on the map face. A simple arrow split down its length, one half black and one white,
  with a black outline (like the scale bar), so it reads on light and dark ground; an N above; no halo or circle;
  no convergence note. **Placement:** try the corners in order, top left, top right, bottom left, bottom right, and
  take the first quiet one: the site doesn't touch it and under 5% of it is drawn on. Top left comes first because it
  balances the panel on the right. If none is quiet, take the least busy.
- **Scale bar** in the panel, near the bottom, beside the coordinate statement; the scale as a ratio for the paper
  size printed ("1:25,000 at A3"). Always one of the standard round scales in section 5.
- **Coordinate ticks** outside the map frame, in the map CRS's eastings and northings: ticks only, no lines across
  the map. The interval is the first of 100, 200, 250, 500 m, 1, 2, 5, 10 km that puts ticks at least 30 mm apart
  (1 km at 1:25,000). Labels in full metres, grouped in threes ("622 000"), on the left and bottom edges; the corner
  labels carry the units ("mE", "mN").
- **Coordinate statement:** the CRS by name and EPSG code, and the tick interval.
- **Locator:** a small map placing the site in its country, filling the panel's width.
- **Sources:** each layer drawn, with publisher, licence and the date it was queried, one line per publisher and
  licence; a caveat every layer in the line shares is printed once. A licence that isn't stated is
  printed as "licence not stated". The basemap's attribution, as its licence asks.
- **Small print:** the run id, the skill and its version, the date printed, the paper size, asktobler.com.
- **Disclaimer in the panel's small print**, beside the run details, exactly: "Made with Tobler from public web services,
  each named under Sources. A screening map: boundaries may have been generalised. Not a survey, title plan or legal
  boundary." It says what the map is for without talking it down.

## 4. The legend (always)
- Only what draws inside the frame. A layer with no feature in the map's extent gets no patch, even if it was
  checked. Whether something draws is tested on real shapes against the frame, not on boxes.
- The site first, then the distance bands, then the topic's layers, then context layers, each named in plain
  words: the check's own name for the layer where a check read it ("Flood zones (rivers and sea)"), otherwise the
  source's title without its publisher, caveats or dates. The source's full title is under Sources.
- One patch per thing: layers that read the same (same name, colour and kind of mark) share a patch.
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
