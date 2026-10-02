"""Genera and species of each selected family, plus its ancestry (local only, no network).

Inputs:  data/raw/dinos_pbdb.csv, data/processed/families.json,
         data/raw/api_cache/pbdb_parents_<family>.json (written by build_families.py)
Output:  data/processed/genera.json
  {family: {"path": [Archosauria … family],
            "earliest": {"genus", "max_ma", "min_ma", "continent"},   # oldest well-dated fossil
            "genera": [{"genus", "range_ma": [max, min], "n", "continents", "species": [{"name", "n"}]}]}}
Usage:  .venv/bin/python scripts/build_genera.py
"""
import json
from pathlib import Path
import pandas as pd
from build_families import load, continent

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data/raw/api_cache"
OUT = ROOT / "data/processed"
PATH_FROM = "Archosauria"  # ancestry is shown from here (everything above is shared by all reptiles)

def path_of(fam):
    f = CACHE / f"pbdb_parents_{fam}.json"
    if not f.exists():
        return []
    names = [r.get("taxon_name") for r in json.loads(f.read_text()).get("records", []) if r.get("taxon_name")]
    return names[names.index(PATH_FROM):] if PATH_FROM in names else names[-6:]

def genus_range(gd):
    """Genus range. With ≥5 fossils the most extreme 10% on each side is dropped,
    so a single loosely dated fossil does not stretch the range."""
    if len(gd) >= 5:
        hi, lo = gd.max_ma.quantile(0.9), gd.min_ma.quantile(0.1)
    else:
        hi, lo = gd.max_ma.max(), gd.min_ma.min()
    return [round(float(hi), 1), round(float(lo), 1)]

def earliest(d):
    """Oldest fossil of the family, among well-dated ones only (uncertainty ≤ 10 Ma)."""
    good = d[(d.max_ma - d.min_ma) <= 10]
    pool = good if len(good) else d
    mid = (pool.max_ma + pool.min_ma) / 2
    r = pool.loc[mid.idxmax()]
    return {"genus": r.genus, "max_ma": round(float(r.max_ma), 1), "min_ma": round(float(r.min_ma), 1), "continent": r.continent}

def main():
    df = load()
    fams = [r["family"] for r in json.loads((OUT / "families.json").read_text())]
    out = {}
    for fam in fams:
        d = df[df.family == fam]
        genera = []
        for g, gd in d.groupby("genus"):
            sp = gd[gd.accepted_rank == "species"].accepted_name.value_counts()
            genera.append({
                "genus": g,
                "range_ma": genus_range(gd),
                "n": int(len(gd)),
                "continents": gd.continent.value_counts().to_dict(),
                "species": [{"name": n, "n": int(c)} for n, c in sp.items()],
            })
        genera.sort(key=lambda x: (-x["range_ma"][0], -x["range_ma"][1]))
        out[fam] = {
            "path": path_of(fam),
            "earliest": earliest(d),
            "genera": genera,
        }
    (OUT / "genera.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    n_g = sum(len(v["genera"]) for v in out.values())
    n_s = sum(len(g["species"]) for v in out.values() for g in v["genera"])
    no_path = [f for f, v in out.items() if not v["path"]]
    print(f"OK → data/processed/genera.json · {len(out)} families · {n_g} genera · {n_s} species"
          + (f" · no ancestry: {', '.join(no_path)}" if no_path else ""))

if __name__ == "__main__":
    main()
