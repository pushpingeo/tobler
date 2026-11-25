"""The manifest for one market's build: which extracts were built, when their data is from, where each file is, and
the outline the copy covers. The browser reads it first (js/osmsnapshot.js).

The outline is the union of the extracts that built, simplified and then shrunk by the same tolerance (about 1 km; Geofabrik's
outlines run well out to sea, so the coast is still covered), so it never
claims ground the copy doesn't hold: a site near its edge goes to Overpass instead (honest about gaps).

    python3 scripts/osm-extract/publish.py --regions regions.json --stats-dir stats --release 2026-11-25 --out manifest.json --report report.json \
        [--previous live-manifest.json]

--previous (25 Nov): the manifest that's live now. An extract this run didn't build (Geofabrik refused the download, or the
upload failed) keeps its entry from there, files and data date included, if that release is under 14 days old, so one bad
download doesn't drop a county from the copy. Its files stay where they are (paths carry their release folder). Each
region keeps its own data_as_of, and the manifest lists what was carried.
"""
import argparse, glob, json, os, sys
from datetime import datetime, timezone, date
import shapely
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build import load_spec
from shapely.geometry import shape, mapping

CARRY_DAYS = 14  # an older release folder may be removed by the bucket's lifecycle rule (three weeks)
TOL = 0.01  # degrees, about 1 km: simplify, then shrink by as much (0.002 made a 580 kB UK manifest)


def rounded(geom, nd=5):
    def r(c):
        return [r(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], nd), round(c[1], nd)]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--regions", required=True)
    ap.add_argument("--stats-dir", required=True, action="append", help="repeatable; an extract's stats from the first dir that has them win")
    ap.add_argument("--release", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--base", default="", help="URL prefix of the files, if not beside the manifest")
    ap.add_argument("--previous", default=None, help="the live manifest, to carry extracts this run didn't build")
    a = ap.parse_args(argv)
    plan = json.load(open(a.regions))
    stats = {}
    for d in a.stats_dir:
        for p in sorted(glob.glob(os.path.join(d, "**", "stats.json"), recursive=True)):
            s = json.load(open(p))
            stats.setdefault(s["region"], s)
    prev = {}
    if a.previous and os.path.exists(a.previous):
        try:
            pm = json.load(open(a.previous))
            prev = {x["id"]: x for x in pm.get("regions", []) if pm.get("market") == plan["market"]}
        except (ValueError, KeyError):
            prev = {}
    today = date.fromisoformat(a.release)
    def carried_ok(x):
        try:
            rel = date.fromisoformat(next(iter(x["files"].values()))["path"].split("/")[0])
        except (StopIteration, ValueError, KeyError):
            return False
        return (today - rel).days <= CARRY_DAYS
    built, missing, carried, shapes = [], [], [], []
    for r in plan["regions"]:
        s = stats.get(r["id"])
        if not s:
            old = prev.get(r["id"])
            if old and carried_ok(old):
                shapes.append(shape(r["geometry"]))
                built.append(old)
                carried.append(r["id"])
            else:
                missing.append(r["id"])
            continue
        g = shape(r["geometry"])
        shapes.append(g)
        built.append({"id": r["id"], "name": r["name"], "data_as_of": s["data_as_of"], "bbox": [round(x, 5) for x in g.bounds],
                      "files": {k: {"path": f"{a.release}/{r['id']}/{k}.fgb", "features": v["features"], "bytes": v["fgb_bytes"]}
                                for k, v in s["groups"].items()}})
    outline = None
    if shapes:
        u = shapely.union_all(shapes).simplify(TOL, preserve_topology=True).buffer(-TOL).buffer(0)
        outline = rounded(u)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    dates = sorted(x["data_as_of"] for x in built if x["data_as_of"])
    manifest = {"about": "Tobler's own copy of OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors), built from Geofabrik extracts by scripts/osm-extract. Files are FlatGeobuf with a spatial index; GeoParquet copies sit beside them where built.",
                "version": 1, "spec_version": load_spec()["version"], "market": plan["market"],
                "kind_groups": {k: v["group"] for k, v in load_spec()["kinds"].items()}, "release": a.release, "built_at": now, "base": a.base,
                "data_as_of": {"oldest": dates[0] if dates else None, "newest": dates[-1] if dates else None},
                "outline": outline, "regions": built, "missing": missing, "carried": carried}
    json.dump(manifest, open(a.out, "w"), separators=(",", ":"))
    # The report (committed to the repo): sizes and timings, no outlines.
    tot = lambda key: sum(v.get(key, 0) for s in stats.values() for v in s["groups"].values())
    report = {"market": plan["market"], "release": a.release, "built_at": now, "extracts": len(plan["regions"]), "built": len(built) - len(carried), "carried": carried, "missing": missing,
              "source_bytes": sum(s["source_bytes"] for s in stats.values()), "filtered_bytes": sum(s["filtered_bytes"] for s in stats.values()), "fgb_bytes": tot("fgb_bytes"), "parquet_bytes": tot("parquet_bytes"),
              "features": tot("features"), "manifest_bytes": os.path.getsize(a.out),
              "by_group": {g: {"features": sum(s["groups"].get(g, {}).get("features", 0) for s in stats.values()),
                               "fgb_bytes": sum(s["groups"].get(g, {}).get("fgb_bytes", 0) for s in stats.values()),
                               "parquet_bytes": sum(s["groups"].get(g, {}).get("parquet_bytes", 0) for s in stats.values())}
                           for g in sorted({g for s in stats.values() for g in s["groups"]})},
              "regions": [{k: s[k] for k in ("region", "data_as_of", "source_bytes", "filtered_bytes", "read_s", "total_s", "skipped") if k in s} for s in stats.values()]}
    json.dump(report, open(a.report, "w"), indent=1)
    print(f"{plan['market']}: {len(built)}/{len(plan['regions'])} extracts ({len(carried)} carried from the live release), {report['fgb_bytes'] / 1e9:.2f} GB fgb, {report['parquet_bytes'] / 1e9:.2f} GB parquet, manifest {report['manifest_bytes'] / 1e3:.0f} kB")
    return 0 if not missing else 2


if __name__ == "__main__":
    sys.exit(main())
