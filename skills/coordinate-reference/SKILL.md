---
name: coordinate-reference
version: 1.2-draft
description: Get coordinates right. Use whenever coordinates come in (typed, pasted, in a file, from a service), a result must be measured, overlaid or exported, or data in different datums meet, so every position says what system it's in, every change between systems is the right one for where the site is, and the accuracy accepted is recorded.
---

# Coordinate reference

A position is only a pair of numbers until you know its coordinate reference system (CRS). The same numbers can mean
places hundreds of kilometres apart (latitude and longitude swapped), and the same place has different numbers in
different datums: about 70–125 m between OSGB36 and WGS 84 across Great Britain, 110–125 m between ED50 and WGS 84
in the North Sea (EPSG:1311, measured with PROJ 9.8.1). Screening at 1 km bands tolerates metres; it doesn't tolerate a pin in the wrong country, a protected
area shifted 100 m onto a site, or an area measured in Web Mercator (inflated about 3.4 times at 57°N).

This skill follows the conceptual model of ISO 19111 (Referencing by coordinates), the model behind the EPSG Geodetic
Parameter Dataset maintained by IOGP (epsg.org). Use its words, so a geodesist reading the record understands it.

You never do coordinate maths in your head. Tools read, look up and transform; you choose and explain.

## 1. The model, in brief
- **Coordinate reference system (CRS)** = a **coordinate system** (its axes, their order, direction and units) plus a
  **datum** that ties it to the Earth. Kinds you'll meet: *geographic* (latitude and longitude on an ellipsoid; 2D or
  3D), *projected* (eastings and northings in metres or feet, made from a geographic CRS by a map projection),
  *vertical* (heights or depths against a surface: mean sea level, a chart datum, the ellipsoid), and *compound*
  (horizontal plus vertical).
- **Geodetic datum** = an **ellipsoid** (the Earth's shape: Airy 1830, International 1924, GRS 1980, WGS 84) positioned
  and oriented to the Earth, with a **prime meridian** (almost always Greenwich). Different datums give the same place
  different coordinates.
- **Datum ensemble:** some datums are a family of realisations treated as one. *WGS 84* (EPSG datum 6326) is an
  ensemble of eight realisations, accurate as a whole to about **2 m**; *ETRS89* (6258) to about 0.1 m. For screening
  the ensemble is fine; for survey work the realisation and **epoch** matter, because plates move (Europe drifts about
  2.5 cm a year relative to WGS 84, so ETRS89 and WGS 84 now differ by nearly a metre).
- **Coordinate operations** change coordinates from one CRS to another:
  - a **conversion** changes coordinates *within one datum* (a map projection, e.g. OSGB36 latitude/longitude to
    British National Grid). It's exact by definition: no accuracy, no area limit beyond where the projection is sensible.
  - a **transformation** moves coordinates *between datums* (OSGB36 to WGS 84). It's empirical: it has a stated
    **accuracy** and an **area of use**, and there are often several for the same pair of CRSs.
  - a **concatenated operation** chains them (ED50 → ETRS89 → WGS 84).
- **Identifiers:** EPSG codes (`EPSG:27700` British National Grid; `EPSG:4326` WGS 84 geographic, latitude first;
  `EPSG:3857` Web Mercator), `OGC:CRS84` (WGS 84 longitude first, what GeoJSON means). Full definitions as **WKT2**
  (ISO 19162) or **PROJJSON**. Prefer a code plus its name ("EPSG:27700, OSGB36 / British National Grid"): codes alone
  get mistyped.
- **Area of use:** every CRS and every transformation is valid over an area, given as a description and a bounding box
  (and, in the full EPSG dataset, a polygon). Outside it, the definition may still compute numbers; they are not valid.

## 2. Reading coordinates you're given
1. **Recognise the form:** decimal degrees (`55.522759, -5.650122`), degrees-minutes-seconds (`55°31'22"N 5°39'00"W`),
   a national grid reference (`NR 6853 2836`), eastings and northings (`168530, 628360`), or labelled
   (`lat … lon …`, `x= y=`). Use `read_coordinates`; never parse by eye.
2. **Say how you read them**, in words: "read as 55.52276° N, 5.65012° W (decimal degrees, WGS 84 assumed)".
3. **Axis order.** Latitude-first is how most people and EPSG:4326 write it; GeoJSON, `OGC:CRS84` and most software
   store longitude first. When both numbers could be latitudes and nothing says which is which, the tool reads
   latitude first and keeps the other reading. If one reading falls at sea and the other on land for a land project
   (or the reverse), the plausible one wins, and you say so. If both are plausible, show both and let the person pick.
   Never pick silently between two plausible places.
4. **Datum.** Coordinates rarely say their datum. Assume **WGS 84** for latitude/longitude typed by a person or from a
   phone or web map, and say "assumed". Assume otherwise only from evidence, and say what it was:
   - a British National Grid reference or eastings/northings → OSGB36 (EPSG:27700);
   - an Irish Grid reference → TM75 (EPSG:29903); Irish Transverse Mercator → IRENET95 (EPSG:2157);
   - North Sea well, licence or platform positions from older records → often ED50 (EPSG:4230 or ED50 / UTM);
   - US State Plane or UTM in older US records → NAD27 or NAD83 (check the source);
   - an oil and gas concession's own documents → its stated datum (Minna in Nigeria, Camacupa in Angola, Timbalai 1948
     in Brunei and Sabah/Sarawak; see `datums.md`).
   If the datum matters and the evidence doesn't settle it, ask.
5. **Precision.** A grid reference describes a square (`NR 6853 2836` is a 10 m square; `NR 685 283` 100 m): use its
   centre and record the size. Decimal degrees: 4 decimal places ≈ 11 m, 5 ≈ 1 m, 6 ≈ 0.1 m. Don't report more
   precision than was given.
6. **Units.** Projected CRSs may be in metres, international feet or US survey feet (they differ by 2 parts per
   million: about 0.6 m at 300 km). Take units from the CRS definition, never from the size of the numbers.

## 3. Choosing a CRS for each job
| Job | Use | Why |
|---|---|---|
| Store and exchange | WGS 84 longitude/latitude (`OGC:CRS84`) | What GeoJSON means; one system for everything stored |
| Display | Web Mercator (EPSG:3857) | Tiles use it; never measure in it |
| Distance and length | Geodesic on the WGS 84 ellipsoid (or a sphere, within ~0.5%) | Right anywhere, no zone edges |
| Area, overlay, union, share of an area | A Lambert azimuthal equal-area projection centred on the area | Equal-area anywhere on Earth |
| Buffers, rotation, shapes | A local projection centred on the shape | Keeps shapes true at any latitude |
| Slope and raster analysis | The raster's own projected CRS, or a local UTM zone | Cells must be square in metres |
| Export | WGS 84 by default; a national CRS on request, with the operation stated | The reader's GIS can take either |

## 4. Choosing a transformation (the part that's easy to get wrong)
There is rarely one transformation between two datums. EPSG lists nine live ones from OSGB36 to WGS 84, 36 from ED50,
78 from NAD27. Which is right depends on **where the site is** and **how accurate it needs to be**.

1. **Only those whose area of use contains the site.** Test the site's position (or its whole outline) against each
   area's extent, not against its name: EPSG's main UK offshore ED50 transformation (EPSG:1311, 1 m) has the area
   "Europe - common offshore". `transformation_options` does this test.
2. **Never deprecated ones; follow supersessions** to the replacement.
3. **Rank by stated accuracy, best first.** A smaller, regional area of use does *not* mean a better transformation.
   OSGB36 → WGS 84 at a site in Scotland:

   | EPSG | Name | Area of use | Accuracy |
   |---|---|---|---|
   | 7710 | OSGB36 to WGS 84 (9) | Britain and UKCS | 1 m (needs the OSTN15 grid) |
   | 5339 | OSGB36 to WGS 84 (7) | Great Britain onshore | 1 m (needs the OSTN02 grid) |
   | 1314 | OSGB36 to WGS 84 (6) | Great Britain onshore and nearshore | 2 m |
   | 1198 | OSGB36 to WGS 84 (4) | Scotland | 18 m |
   | 1195 | OSGB36 to WGS 84 (1) | Great Britain | 21 m |

   The regional Scotland transformation is worse than the national ones. And applied outside its area it is wrong but
   silent: EPSG:1198 used in London lands 16.8 m from EPSG:1314; EPSG:1196 (England) used at Linlithgow, 10.5 m off.
   Ignoring the datum shift altogether (treating OSGB36 numbers as WGS 84) is 70–125 m off. (Computed with PROJ 9.8.1,
   EPSG v12.029.)
4. **Only what you can apply.** A grid-based transformation (NTv2, NADCON, OSTN15) needs its grid file. If it isn't
   available, take the best one you can apply and record that the better one wasn't used and why.
5. **Ties:** the smaller area of use, then the more recent revision.
6. **Sites spanning areas:** prefer a transformation whose area covers the whole site. If none does, use the one at
   the site's centre and say the edges may be less accurate, or split the job.
7. **Accuracy unknown** stays unknown: never present it as good.

### Ask or choose
Who makes the choice is a setting (`transformation_choice`), because some users know their datums and some neither
know nor need to:
- **`choose` (default):** take the top-ranked option without asking. Record it and its stated accuracy, and say it in
  one line of the method ("OSGB36 to WGS 84 by EPSG:1314, stated accuracy 2 m"). Accept the inaccuracy silently only
  while it is small against the job: for screening, anything better than about 25 m.
- **`ask`:** when more than one option applies, offer them before using one: the recommended one first, each with its
  EPSG code, area of use and accuracy, and how far apart they put the site, in metres, when the tool can work it out.
  Then do as the person says and record it as their choice.
- **Either way, ask** when the best option available is worse than the job tolerates, when the source datum itself is
  uncertain, or when the person has said the work is survey-grade.
- `transformation_options` returns `ask: true` with the reason whenever one of these holds: then ask, and build nothing
  from the coordinates until the person chooses. If no transformation covers the place, say so; never apply one from
  elsewhere. If the best one needs a grid file the page can't apply, say so and ask before falling back to a less
  accurate one.

### Chosen is not applied
Choosing a transformation and applying it are two steps. Say an operation was **applied** only once a tool has
computed the coordinates with it, and give how far the points moved and the stated accuracy; until then it was
**chosen** or **recommended**. A shift quoted from a general figure ("110–125 m in the North Sea") is context, not the
shift at this site. Never move coordinates yourself, and never use an operation outside its area of use without saying
its stated accuracy doesn't hold there (`transform` warns when points lie outside it: say so, and don't rely on them).
When searching for a CRS by words, pick by area of use and kind, not name alone, and prefer ones that aren't deprecated.

## 5. Record it
Every result that used coordinates records, with the result (a run record, an export's metadata):
- the **source CRS** (code and name) and how it was known (stated by the source; assumed; inferred from a grid
  reference's form);
- how typed coordinates were **read** (form, order, precision);
- each **operation** applied: code, name, method, stated accuracy, area of use, and whether it was chosen by rule or by
  the person;
- the **target CRS**;
- the **EPSG dataset version** used (e.g. "EPSG v12.029, 2025-10-02").

A line a person can read: "Typed as British National Grid NR 6853 2836 (a 10 m square, OSGB36); moved to WGS 84 by
EPSG:1314, OSGB36 to WGS 84 (6), stated accuracy 2 m, chosen by rule; EPSG v12.029."

## 6. Pitfalls to check every time
- **Axis order:** EPSG:4326 is latitude first; WFS 2.0 and GML follow it, GeoJSON doesn't. A swapped pair lands in
  another hemisphere or ocean. Ask for `CRS84`, or check against the expected area.
- **Relabelling is not transforming.** Declaring that data is in WGS 84 (setting an SRID or a `.prj`) doesn't move it.
  If the source was ED50 and you only relabelled it, it's still 110–125 m off in the North Sea.
- **Measuring in the wrong CRS:** never measure distances or areas in degrees or in Web Mercator.
- **Longitudes 0–360** (some ocean and climate data): convert to −180–180; mind the date line.
- **Truncated false eastings** (an ED50 / UTM or Gauss–Krüger easting missing its zone number or leading digits): the
  EPSG remarks often name the truncated variant. Check the numbers against the zone's range.
- **Vertical datums:** heights against mean sea level, depths against lowest astronomical tide, and ellipsoidal heights
  from GNSS can differ by tens of metres. Say which; in Tobler, elevation is metres, positive up, against sea level.
- **Missing hemisphere letters** in degrees-minutes-seconds: the sign matters; don't assume north and east.
- **A datum in the name isn't proof:** layers labelled "WGS84" have been ED50 in practice. If a layer sits about
  100 m off where it should, suspect a datum before blaming the data.

## 7. Talking to the person
- Plain words: "I read those as 55.52° N, 5.65° W" rather than a code. Give codes in the record and when asked.
- Say what you assumed, once, briefly. Don't lecture about datums unless it changes the answer.
- When coordinates were moved between datums, one line is enough: "Read as ED50; moved to WGS 84, about 118 m
  (EPSG:1311)". The full record goes with the result, not into the conversation.
- In `ask` mode, one short question with the recommended option first.

## Operations
The operations named above (`read_coordinates`, `crs_lookup`, `transformation_options`, `transform`) are described in
general terms in `operations.md`, beside this file. `datums.md` lists the datums and transformations most often met in
energy and land work, with their EPSG codes, areas and accuracies.
