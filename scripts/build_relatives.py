"""Close relatives of the selected families that the timeline would otherwise leave out: genera in each family's
parent clade (e.g. Tyrannosauroidea for Tyrannosauridae) that belong to no selected family. They fill in the
stretch where a lineage must have existed before its family shows up: Guanlong, Dilong or Yutyrannus long before
the first tyrannosaurid.

Inputs:  data/raw/dinos_pbdb.csv (all occurrences, including those with no family),
         data/processed/genera.json (the families' ancestry, written by build_genera.py)
Network (cached in data/raw/api_cache/, skipped with --offline):
  - PBDB taxa API -> the genera of each parent clade, with their family
Output:  data/processed/relatives.json
  {clade: {"families": [selected families in it], "path": [Archosauria … clade],
           "genera": [{"genus", "family", "range_ma", "record", "n", "continents"}]}}
  range_ma drops the most extreme 10% of fossils when there are 5+ (as for the families' genera); record is the full span.
A genus goes to the most specific clade that holds it. Clades that hold several lineages (Saurischia,
Sauropodomorpha…) are skipped: their "other members" would be most of the tree, not a family's relatives.
Usage:  .venv/bin/python scripts/build_relatives.py [--offline]
"""
import json, urllib.parse
import pandas as pd
from build_families import CSV, TRACE_FAM, continent, get_json, OFFLINE, OUT

MAX_FAMILIES = 3     # skip parent clades holding more selected families than this
BROAD = {"Dinosauria", "Saurischia", "Ornithischia", "Theropoda", "Sauropodomorpha"}


def occurrences():
    df = pd.read_csv(CSV)
    trace = df.family.isin(TRACE_FAM) | df.genus.str.contains(r"ool|pus$|podus$|ichnus$|^Grallator$|^Eubrontes$", na=False)
    df = df[~trace & df.genus.notna()].copy()
    df["continent"] = [continent(a, o) for a, o in zip(df.lat, df.lng)]
    return df


def genus_range(gd):
    if len(gd) >= 5:
        hi, lo = gd.max_ma.quantile(0.9), gd.min_ma.quantile(0.1)
    else:
        hi, lo = gd.max_ma.max(), gd.min_ma.min()
    return [round(float(hi), 1), round(float(lo), 1)]


def clade_genera(clade):
    """{genus: family or None} for the accepted genera in a clade."""
    q = urllib.parse.urlencode({"base_name": clade, "rank": "genus", "vocab": "pbdb", "taxon_status": "accepted", "show": "class"})
    d = get_json(f"https://paleobiodb.org/data1.2/taxa/list.json?{q}", f"pbdb_genera_{clade}")
    out = {}
    for r in (d or {}).get("records", []):
        name = r.get("taxon_name")
        if name and " " not in name:
            out[name] = r.get("family") or None
    return out


def main():
    genera = json.loads((OUT / "genera.json").read_text())
    selected = set(genera)
    # parent clade of each selected family, and how many selected families each clade holds
    holds = {}
    for fam, v in genera.items():
        for a in v["path"][:-1]:
            holds[a] = holds.get(a, 0) + 1
    parents = {}
    for fam, v in genera.items():
        p = v["path"][-2] if len(v["path"]) > 1 else None
        if p and p not in BROAD and holds[p] <= MAX_FAMILIES:
            parents.setdefault(p, {"families": [], "path": v["path"][:-1]})["families"].append(fam)

    df = occurrences()
    in_selected = set(df[df.family.isin(selected)].genus)
    taken, out = set(), {}
    # most specific clades first, so a genus lands in the closest one
    for clade, info in sorted(parents.items(), key=lambda kv: -len(kv[1]["path"])):
        members = clade_genera(clade)
        rows = []
        for g, fam in members.items():
            if g in taken or g in in_selected or fam in selected:
                continue
            gd = df[df.genus == g]
            if gd.empty:
                continue
            taken.add(g)
            rows.append({
                "genus": g,
                "family": fam if fam and fam not in ("NO_FAMILY_SPECIFIED",) else None,
                "range_ma": genus_range(gd),
                "record": [round(float(gd.max_ma.max()), 1), round(float(gd.min_ma.min()), 1)],
                "n": int(len(gd)),
                "continents": gd.continent.value_counts().to_dict(),
            })
        if rows:
            rows.sort(key=lambda r: (-r["record"][0], -r["record"][1]))
            out[clade] = {**info, "genera": rows}
        print(f"  {clade}: {len(rows)} genera ({len(members)} in the PBDB clade)")
    (OUT / "relatives.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"OK → data/processed/relatives.json · {len(out)} clades · {sum(len(v['genera']) for v in out.values())} genera")


if __name__ == "__main__":
    main()
