# Builds the site-file fixtures for test/fileimport.test.mjs and the browser check (needs pyshp: pip install pyshp).
# Run from this folder: python3 make.py
import json, shapefile, zipfile, os
BNG = 'PROJCS["British_National_Grid",GEOGCS["GCS_OSGB_1936",DATUM["D_OSGB_1936",SPHEROID["Airy_1830",6377563.396,299.3249646]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",400000.0],PARAMETER["False_Northing",-100000.0],PARAMETER["Central_Meridian",-2.0],PARAMETER["Scale_Factor",0.9996012717],PARAMETER["Latitude_Of_Origin",49.0],UNIT["Meter",1.0]]'
ED50 = 'PROJCS["ED_1950_UTM_Zone_31N",GEOGCS["GCS_European_1950",DATUM["D_European_1950",SPHEROID["International_1924",6378388.0,297.0]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
def sq(e, n, s):  # clockwise ring (shapefile outer rings are clockwise)
    return [[e, n], [e, n + s], [e + s, n + s], [e + s, n], [e, n]]
def write(name, kind, shapes, fields, rows, prj):
    w = shapefile.Writer(name, shapeType=kind)
    for f in fields: w.field(*f)
    for s, r in zip(shapes, rows):
        if kind == shapefile.POLYGON: w.poly(s)
        elif kind == shapefile.POLYLINE: w.line(s)
        else: w.point(*s)
        w.record(*r)
    w.close()
    if prj: open(name + ".prj", "w").write(prj)
# 1. One red line near Linlithgow (200 m square, 4 ha), British National Grid with its .prj; also zipped.
write("redline", shapefile.POLYGON, [[sq(300200, 677400, 200)]], [("SITE", "C", 40)], [["Linlithgow test site"]], BNG)
with zipfile.ZipFile("redline.zip", "w") as z:
    for x in ["shp", "shx", "dbf", "prj"]: z.write(f"redline.{x}", f"Redline Boundary/redline.{x}")
    z.writestr("__MACOSX/._redline.shp", b"junk")
# 2. Three named areas, no .prj (guessed as British National Grid).
write("areas", shapefile.POLYGON, [[sq(300000, 678000, 100)], [sq(300300, 678000, 100)], [sq(305000, 690000, 100)]],
      [("NAME", "C", 40)], [["Area A"], ["Area B"], ["Area C"]], None)
# 3. A cable route (line) and two turbine points, British National Grid.
write("cable", shapefile.POLYLINE, [[[[300000, 677000], [301000, 677000]]]], [("NAME", "C", 40)], [["Export cable"]], BNG)
write("turbines", shapefile.POINT, [(300500, 677500), (300800, 677500)], [("ID", "N", 5)], [[1], [2]], BNG)
# 4. An offshore block in ED50 / UTM zone 31N.
write("block_ed50", shapefile.POLYGON, [[sq(500000, 6200000, 1000)]], [("NAME", "C", 40)], [["Block 1"]], ED50)
# 5. GeoJSON: WGS84, and one that names EPSG:27700 in the old crs member.
json.dump({"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"name": "Evora solar"}, "geometry": {"type": "Polygon", "coordinates": [[[-7.98, 38.57], [-7.97, 38.57], [-7.97, 38.58], [-7.98, 38.58], [-7.98, 38.57]]]}}]}, open("evora.geojson", "w"))
json.dump({"type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::27700"}},
           "features": [{"type": "Feature", "properties": {"name": "BNG polygon"}, "geometry": {"type": "Polygon", "coordinates": [sq(300200, 677400, 200)]}}]}, open("bng.geojson", "w"))
# 6. Registry cases: WGS 84 / UTM 30N (no datum change), ETRS89 / UTM 31N, and a datum EPSG can't be matched to.
WGSUTM = 'PROJCS["WGS_1984_UTM_Zone_30N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
ETRS = 'PROJCS["ETRS_1989_UTM_Zone_31N",GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
ODD = 'PROJCS["Odd_Local_Grid",GEOGCS["GCS_Odd",DATUM["D_Odd",SPHEROID["Clarke_1880",6378249.145,293.465]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",3.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]'
write("wgs_utm30", shapefile.POLYGON, [[sq(400000, 6200000, 1000)]], [("NAME", "C", 40)], [["UTM block"]], WGSUTM)
write("etrs_utm31", shapefile.POLYGON, [[sq(500000, 6200000, 1000)]], [("NAME", "C", 40)], [["ETRS block"]], ETRS)
write("odd_grid", shapefile.POLYGON, [[sq(500000, 6200000, 1000)]], [("NAME", "C", 40)], [["Odd block"]], ODD)
print("fixtures written")
