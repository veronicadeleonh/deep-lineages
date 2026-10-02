"""Paleomaps via the GPlates Web Service (PALEOMAP model, Scotese).

For each snapshot (every 10 Ma, 250→70, + 66):
  - coastlines_<t>.json : present-day coastlines reconstructed to that age (GeoJSON, rounded coords)
  - locs_<t>.json       : {loc_id: [lng, lat]} position of the fossil localities in that time slice
Requires build_timeline.py to have run first. Cache in data/raw/api_cache/gplates/.
Usage:  .venv/bin/python scripts/build_paleomaps.py
"""
import json, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/processed/paleomap"
CACHE = ROOT / "data/raw/api_cache/gplates"
MODEL = "PALEOMAP"
TIMES = list(range(250, 69, -10)) + [66]
GWS = "https://gws.gplates.org/reconstruct"
UA = {"User-Agent": "deep-lineages/0.1 (https://github.com/veronicadeleonh/deep-lineages)"}
CHUNK = 300

def fetch(url, key, data=None):
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    body = urllib.parse.urlencode(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=UA)
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read())
    f.write_text(json.dumps(res))
    time.sleep(0.3)
    return res

def simplify(coords):
    """Rounds to 0.1° and removes repeated vertices (recursive, any geometry)."""
    if coords and isinstance(coords[0], (int, float)):
        return [round(coords[0], 1), round(coords[1], 1)]
    out = [simplify(c) for c in coords]
    if out and isinstance(out[0], list) and out[0] and isinstance(out[0][0], (int, float)):
        out = [p for i, p in enumerate(out) if i == 0 or p != out[i - 1]]
    return out

def clean_polygon(rings):
    """Closes each ring and drops rings left with fewer than 4 vertices after simplifying."""
    out = []
    for i, r in enumerate(rings):
        if r and r[0] != r[-1]:
            r = r + [r[0]]
        if len(r) >= 4:
            out.append(r)
        elif i == 0:
            return None  # no valid exterior ring: drop the polygon
    return out

def clean_geometry(g):
    if g["type"] == "Polygon":
        poly = clean_polygon(g["coordinates"])
        return {"type": "Polygon", "coordinates": poly} if poly else None
    if g["type"] == "MultiPolygon":
        polys = [p for p in (clean_polygon(p) for p in g["coordinates"]) if p]
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    return g

def points_list(res):
    if res.get("type") == "MultiPoint":
        return res["coordinates"]
    if res.get("type") == "FeatureCollection":
        return [(f.get("geometry") or {}).get("coordinates") for f in res["features"]]
    raise ValueError(f"Unexpected format: {str(res)[:200]}")

def main():
    OUT.mkdir(parents=True, exist_ok=True); CACHE.mkdir(parents=True, exist_ok=True)
    fos = json.loads((ROOT / "data/processed/fossils.json").read_text())
    c = fos["columns"]; imax, imin, iloc = c.index("max_ma"), c.index("min_ma"), c.index("loc_id")
    nearest = lambda m: min(TIMES, key=lambda t: abs(t - m))
    by_t = {t: set() for t in TIMES}
    for r in fos["rows"]:
        by_t[nearest((r[imax] + r[imin]) / 2)].add(r[iloc])

    for t in TIMES:
        gj = fetch(f"{GWS}/coastlines/?time={t}&model={MODEL}", f"coast_{t}")
        feats = gj["features"] if gj.get("type") == "FeatureCollection" else [{"type": "Feature", "properties": {}, "geometry": gj}]
        clean = []
        for ft in feats:
            geom = dict(ft["geometry"], coordinates=simplify(ft["geometry"]["coordinates"]))
            geom = clean_geometry(geom)
            if geom:
                clean.append({"type": "Feature", "properties": {}, "geometry": geom})
        feats = clean
        (OUT / f"coastlines_{t}.json").write_text(json.dumps({"type": "FeatureCollection", "features": feats}, separators=(",", ":")))

        ids = sorted(by_t[t]); res = {}
        for i in range(0, len(ids), CHUNK):
            chunk = ids[i:i + CHUNK]
            lons = ",".join(str(fos["locs"][k][0]) for k in chunk)
            lats = ",".join(str(fos["locs"][k][1]) for k in chunk)
            pts = points_list(fetch(f"{GWS}/reconstruct_points/", f"pts_{t}_{i}",
                                    {"lons": lons, "lats": lats, "time": t, "model": MODEL, "return_null_points": ""}))
            for k, p in zip(chunk, pts):
                if p and abs(p[0]) <= 180 and abs(p[1]) <= 90:
                    res[k] = [round(p[0], 2), round(p[1], 2)]
        (OUT / f"locs_{t}.json").write_text(json.dumps(res, separators=(",", ":")))
        print(f"{t:>3} Ma · {len(feats)} coastlines · {len(res)}/{len(ids)} localities")

    (OUT / "index.json").write_text(json.dumps({"model": MODEL, "times": TIMES}))
    print("OK → data/processed/paleomap/")

if __name__ == "__main__":
    main()
