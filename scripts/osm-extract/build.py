"""Tobler's own copy of OpenStreetMap: one OSM extract (a Geofabrik .osm.pbf) into one file per group of kinds.

Keeps only the kinds in catalogue/osm-snapshot.json, with the same tags the Overpass query asks for, so a lookup in
the copy and a live Overpass query give the same answer (the copy is as old as the extract). Each group is written as
FlatGeobuf with its spatial index (what the browser reads: a few small range requests per site) and, with --parquet,
as GeoParquet 1.1 with a bbox column (for DuckDB, QGIS and the atlas). Both are sorted along a Hilbert curve, so
features near each other on the ground sit near each other in the file.

Areas are built properly: a closed way or a multipolygon relation becomes a (multi)polygon, where Overpass's "out
center" gave a relation only a centre point. Run on the output of `osmium tags-filter` (see filter_expressions) to
keep memory small; it also works on a whole extract.

    python3 scripts/osm-extract/build.py --pbf wales.osm.pbf --region wales --out out/wales [--parquet]
"""
import argparse, json, os, sys, time
from datetime import datetime, timezone

# osmium, shapely, geopandas and pyogrio are imported where they're used, so plan.py and publish.py (which only need
# the spec) run without them.

HERE = os.path.dirname(os.path.abspath(__file__))
SPEC_PATH = os.path.join(HERE, "..", "..", "catalogue", "osm-snapshot.json")


def load_spec(path=SPEC_PATH):
    with open(path) as f:
        return json.load(f)


def filter_expressions(spec):
    """Expressions for `osmium tags-filter` (one per tag key, values joined): a coarse first cut that keeps every
    object any kind could match, plus the nodes and members they need. The exact test is matches() below."""
    by = {}
    for k in spec["kinds"].values():
        types = "".join(sorted(set(k["types"].replace("a", "wr"))))
        for alt in k["match"]:
            key, val = next(iter(alt.items()))  # the first tag is enough to filter on; matches() checks all of them
            e = by.setdefault(key, {"types": set(), "values": set(), "any": False})
            e["types"].update(types)
            if val is True: e["any"] = True
            else: e["values"].update(val if isinstance(val, list) else [val])
    out = []
    for key, e in sorted(by.items()):
        t = "".join(sorted(e["types"]))
        out.append(f"{t}/{key}" if e["any"] else f"{t}/{key}=" + ",".join(sorted(e["values"])))
    return out


def tag_ok(tags, key, want):
    v = tags.get(key)
    if v is None: return False
    if want is True: return v != "no"
    return v in want if isinstance(want, list) else v == want


def matches(spec, tags, kind_type):
    """The kinds (name, def) whose match and types allow this object. kind_type: n, w or a."""
    out = []
    for name, k in spec["kinds"].items():
        if kind_type not in k["types"]: continue
        if any(all(tag_ok(tags, key, want) for key, want in alt.items()) for alt in k["match"]):
            out.append((name, k))
    return out


def kept_tags(spec, tags):
    keep = spec["keep_tags"]
    return {k: tags[k] for k in keep if k in tags}


def build(pbf, region, out_dir, spec=None, parquet=False, source_bytes=None, log=print):
    import osmium
    from shapely import wkb
    import geopandas as gpd
    import pyogrio
    spec = spec or load_spec()
    t0 = time.time()
    groups = {g: [] for g in spec["groups"]}
    keys = sorted({key for k in spec["kinds"].values() for alt in k["match"] for key in alt})
    factory = osmium.geom.WKBFactory()
    skipped = {"bad_geometry": 0}

    def add(obj_type, obj_id, tags, geom_wkb, kinds):
        seen = set()
        for _, k in kinds:
            if k["group"] in seen: continue
            seen.add(k["group"])
            groups[k["group"]].append((obj_type, obj_id, json.dumps(kept_tags(spec, tags), ensure_ascii=False), geom_wkb))

    fp = osmium.FileProcessor(pbf).with_locations().with_areas().with_filter(osmium.filter.KeyFilter(*keys))
    for obj in fp:
        tags = dict(obj.tags)
        try:
            if obj.is_node():
                ks = matches(spec, tags, "n")
                if ks: add("node", obj.id, tags, factory.create_point(obj), ks)
            elif obj.is_way():
                closed = obj.is_closed()
                # A line kind keeps its line, closed or not. Other kinds: an open way stays a line (as Overpass gives
                # it); a closed one arrives again as an area below.
                ks = [(n, k) for n, k in matches(spec, tags, "w") if k.get("line") or not closed]
                if ks: add("way", obj.id, tags, factory.create_linestring(obj), ks)
            elif obj.is_area():
                ks = [(n, k) for n, k in matches(spec, tags, "a") if not k.get("line")]
                if ks: add("way" if obj.from_way() else "relation", obj.orig_id(), tags, factory.create_multipolygon(obj), ks)
        except (osmium.InvalidLocationError, RuntimeError):
            skipped["bad_geometry"] += 1
    read_s = time.time() - t0

    header = osmium.io.Reader(pbf, osmium.osm.osm_entity_bits.NOTHING)
    data_as_of = header.header().get("osmosis_replication_timestamp") or None
    header.close()

    os.makedirs(out_dir, exist_ok=True)
    stats = {"region": region, "data_as_of": data_as_of, "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
             "spec_version": spec["version"], "source_bytes": source_bytes or os.path.getsize(pbf), "filtered_bytes": os.path.getsize(pbf), "read_s": round(read_s, 1), "skipped": skipped, "groups": {}}
    for g, rows in groups.items():
        t1 = time.time()
        geoms = [wkb.loads(r[3], hex=True) for r in rows]
        gdf = gpd.GeoDataFrame({"osm_type": [r[0] for r in rows], "osm_id": [r[1] for r in rows], "tags": [r[2] for r in rows]},
                               geometry=gpd.GeoSeries(geoms, crs="EPSG:4326"))
        if len(gdf):
            gdf = gdf.iloc[gdf.geometry.hilbert_distance().argsort()].reset_index(drop=True)
        fgb = os.path.join(out_dir, f"{g}.fgb")
        # Mixed points, lines and polygons in one file: FlatGeobuf allows it (geometry type Unknown).
        pyogrio.write_dataframe(gdf, fgb, driver="FlatGeobuf", geometry_type="Unknown", layer_options={"SPATIAL_INDEX": "YES", "TITLE": f"OpenStreetMap {g}, {region}"})
        s = {"features": len(gdf), "fgb_bytes": os.path.getsize(fgb)}
        if parquet:
            pq = os.path.join(out_dir, f"{g}.parquet")
            gdf.to_parquet(pq, compression="zstd", schema_version="1.1.0", write_covering_bbox=True, row_group_size=20000)
            s["parquet_bytes"] = os.path.getsize(pq)
        s["write_s"] = round(time.time() - t1, 1)
        if len(gdf):
            b = gdf.total_bounds
            s["bbox"] = [round(float(x), 5) for x in b]
        stats["groups"][g] = s
        log(f"{region} {g}: {s['features']} features, {s['fgb_bytes'] / 1e6:.1f} MB fgb" + (f", {s.get('parquet_bytes', 0) / 1e6:.1f} MB parquet" if parquet else ""))
    stats["total_s"] = round(time.time() - t0, 1)
    with open(os.path.join(out_dir, "stats.json"), "w") as f:
        json.dump(stats, f, indent=1)
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pbf")
    ap.add_argument("--region")
    ap.add_argument("--out")
    ap.add_argument("--parquet", action="store_true")
    ap.add_argument("--source-bytes", type=int, help="size of the extract before osmium tags-filter, for the report")
    ap.add_argument("--print-filter", action="store_true", help="print the osmium tags-filter expressions and stop")
    a = ap.parse_args(argv)
    if a.print_filter:
        print(" ".join(filter_expressions(load_spec())))
        return 0
    if not (a.pbf and a.region and a.out): ap.error("--pbf, --region and --out are needed")
    build(a.pbf, a.region, a.out, parquet=a.parquet, source_bytes=a.source_bytes)
    return 0


if __name__ == "__main__":
    sys.exit(main())
