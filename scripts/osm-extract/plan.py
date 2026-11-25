"""Which Geofabrik extracts make up a market, and (with --sizes) how big they are.

Reads Geofabrik's index (download.geofabrik.de/index-v1.json: every extract's id, parent, outline and download
links) and expands a market's roots (catalogue/osm-snapshot.json "markets") to the smallest extracts under them, so
each build job handles a county or a state rather than a whole country.

    python3 scripts/osm-extract/plan.py --market uk --index index-v1.json --out regions.json --shards 6
    python3 scripts/osm-extract/plan.py --sizes --index index-v1.json --out sizes.json   # HEAD every extract
"""
import argparse, json, sys, urllib.request
from build import load_spec

UA = "Tobler OSM extract builder (github.com/pushpingeo/tobler)"


def leaves(index, roots):
    feats = {f["properties"]["id"]: f for f in index["features"]}
    kids = {}
    for f in index["features"]:
        p = f["properties"].get("parent")
        if p: kids.setdefault(p, []).append(f["properties"]["id"])
    out = []
    def walk(i):
        if i not in feats: raise SystemExit(f"Geofabrik has no extract called {i}")
        if kids.get(i): [walk(k) for k in sorted(kids[i])]
        else: out.append(feats[i])
    for r in roots: walk(r)
    return out, feats


def head_size(url):
    req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return int(r.headers.get("Content-Length") or 0)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", required=True)
    ap.add_argument("--market")
    ap.add_argument("--out", required=True)
    ap.add_argument("--shards", type=int, default=6)
    ap.add_argument("--sizes", action="store_true")
    a = ap.parse_args(argv)
    spec = load_spec()
    index = json.load(open(a.index))
    if a.sizes:
        report = {}
        for m, md in spec["markets"].items():
            ls, feats = leaves(index, md["roots"])
            rows = []
            for f in ls:
                p = f["properties"]
                try: b = head_size(p["urls"]["pbf"])
                except Exception as e: b = None; print(f"{p['id']}: {e}", file=sys.stderr)
                rows.append({"id": p["id"], "bytes": b})
            roots = []
            for r in md["roots"]:
                try: roots.append({"id": r, "bytes": head_size(feats[r]["properties"]["urls"]["pbf"])})
                except Exception: roots.append({"id": r, "bytes": None})
            report[m] = {"name": md["name"], "extracts": len(rows), "leaf_bytes": sum(x["bytes"] or 0 for x in rows),
                         "roots": roots, "leaves": rows}
            print(f"{m}: {len(rows)} extracts, {report[m]['leaf_bytes'] / 1e9:.2f} GB")
        json.dump(report, open(a.out, "w"), indent=1)
        return 0
    if a.market not in spec["markets"]: ap.error(f"no market {a.market}; known: {', '.join(spec['markets'])}")
    ls, _ = leaves(index, spec["markets"][a.market]["roots"])
    regions = [{"id": f["properties"]["id"], "name": f["properties"]["name"], "parent": f["properties"].get("parent"),
                "pbf": f["properties"]["urls"]["pbf"], "shard": i % a.shards, "geometry": f["geometry"]} for i, f in enumerate(ls)]
    json.dump({"market": a.market, "regions": regions}, open(a.out, "w"))
    print(f"{a.market}: {len(regions)} extracts in {min(a.shards, len(regions))} shards")
    return 0


if __name__ == "__main__":
    sys.exit(main())
