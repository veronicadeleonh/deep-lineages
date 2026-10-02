"""Genera and species of each selected family: ranges, subfamilies, authorities and genus profiles.

Inputs:  data/raw/dinos_pbdb.csv, data/processed/families.json,
         data/raw/api_cache/pbdb_parents_<family>.json (written by build_families.py)
Network (cached in data/raw/api_cache/, skipped with --offline):
  - PBDB taxa API      -> each family's subtree: subfamilies/tribes, who named each genus and species, and when
  - Wikipedia REST     -> genus summary (en → es)
  - PhyloPic API v2    -> genus silhouette (the app falls back to the family's when there is none)
Output:  data/processed/genera.json
  {family: {"path": [Archosauria … family],
            "earliest": {"genus", "max_ma", "min_ma", "continent"},   # oldest well-dated fossil
            "groups": [subfamily or tribe names, in order of appearance],
            "genera": [{"genus", "range_ma": [max, min], "n", "continents",
                        "group", "below": [{"name", "rank"}],      # groups between the family and the genus
                        "attr", "pbdb_range",                      # authority ("Osborn 1905"), PBDB first/last appearance
                        "species": [{"name", "n", "attr"}],
                        "wikipedia": {...} | null, "phylopic": {...} | null}]}}
Usage:  .venv/bin/python scripts/build_genera.py [--offline]
"""
import json, urllib.parse
from pathlib import Path
from build_families import load, get_json, phylopic, OFFLINE, SIL, CACHE

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/processed"
PATH_FROM = "Archosauria"  # ancestry is shown from here (everything above is shared by all reptiles)
GROUP_RANKS = ("subfamily", "tribe", "infrafamily", "supertribe", "subtribe")  # named levels used to group genera
# Misspellings found in the PBDB tree, mapped to the accepted name
GROUP_ALIASES = {"Centrasaurinae": "Centrosaurinae"}


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


# ---------- PBDB: the family's subtree ----------
def subtree(fam):
    """{name: record} for every accepted taxon below the family (subfamilies, tribes, genera, species)."""
    q = urllib.parse.urlencode({"base_name": fam, "vocab": "pbdb", "taxon_status": "accepted", "show": "parent,attr,app"})
    d = get_json(f"https://paleobiodb.org/data1.2/taxa/list.json?{q}", f"pbdb_subtree_{fam}")
    out = {}
    for r in (d or {}).get("records", []):
        name = r.get("taxon_name")
        # keep the accepted record if a name appears twice
        if name and (name not in out or r.get("accepted_name", name) == name):
            out[name] = r
    return out

def rank_of(record):
    """Rank of a group. The PBDB list does not always return it, but zoological names carry it in their ending."""
    if record.get("taxon_rank"):
        return record["taxon_rank"]
    name = record.get("taxon_name", "")
    for suffix, rank in (("oidea", "superfamily"), ("inae", "subfamily"), ("ini", "tribe"), ("ina", "subtribe")):
        if name.endswith(suffix):
            return rank
    return "unranked clade"

def below(tree, fam, genus):
    """Groups between the family and the genus, top-down, e.g. [{"name": "Tyrannosaurinae", "rank": "subfamily"}]."""
    chain, name, seen = [], tree.get(genus, {}).get("parent_name"), set()
    while name and name != fam and name in tree and name not in seen:
        seen.add(name)
        chain.append({"name": GROUP_ALIASES.get(name, name), "rank": rank_of(tree[name])})
        name = tree[name].get("parent_name")
    if name != fam:  # the genus does not hang from this family in the PBDB tree
        return []
    return chain[::-1]

def attr(tree, name):
    a = tree.get(name, {}).get("taxon_attr")
    return a.strip("()") if a else None


# ---------- Wikipedia: genus summary ----------

def genus_phylopic(g):
    """Genus silhouette, only if the PhyloPic image really depicts that genus.
    A genus node's primary image can belong to a relative (e.g. Tarbosaurus -> "Tyrannosaurus magnus");
    those are dropped so the app falls back to the family silhouette."""
    ph = phylopic(g)
    if not ph:
        return None
    f = CACHE / f"phylopic_img_{g}.json"
    links = (json.loads(f.read_text()) if f.exists() else {}).get("_links", {})
    titles = [(links.get(k) or {}).get("title") or "" for k in ("specificNode", "generalNode")]
    if any(t == g or t.startswith(g + " ") for t in titles):
        return ph
    (SIL / f"{g}.svg").unlink(missing_ok=True)
    return None

def genus_wikipedia(genus):
    """Genus article; if the plain name is ambiguous or not about a dinosaur, try "<Genus> (dinosaur)".
    Redirects to another genus's article are rejected so a profile never shows another animal's text."""
    for lang in ("en", "es"):
        for title in (genus, f"{genus} (dinosaur)"):
            key = f"wiki_{lang}_{title.replace(' ', '_')}"
            d = get_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(title)}", key)
            text = (d or {}).get("extract") or ""
            # skip redirects to another article (e.g. a genus Wikipedia treats as a synonym of another one)
            same = (d or {}).get("title", "").lower().startswith(genus.lower())
            if text and same and d.get("type") != "disambiguation" and ("dinosaur" in text.lower() or "dinosaurio" in text.lower()):
                return {
                    "lang": lang, "title": d.get("title"), "extract": text,
                    "url": ((d.get("content_urls") or {}).get("desktop") or {}).get("page"),
                    "license": "CC BY-SA 4.0",
                }
    return None


def main():
    SIL.mkdir(parents=True, exist_ok=True)
    df = load()
    fams = [r["family"] for r in json.loads((OUT / "families.json").read_text())]
    total = sum(df[df.family == f].genus.nunique() for f in fams)
    done = 0
    out = {}
    for fam in fams:
        d = df[df.family == fam]
        tree = subtree(fam)
        genera = []
        for g, gd in d.groupby("genus"):
            sp = gd[gd.accepted_rank == "species"].accepted_name.value_counts()
            chain = below(tree, fam, g)
            # group by subfamily when there is one, otherwise by tribe
            group = next((c["name"] for c in chain if c["rank"] == "subfamily"), None) \
                or next((c["name"] for c in chain if c["rank"] in GROUP_RANKS), None)
            t = tree.get(g, {})
            genera.append({
                "genus": g,
                "range_ma": genus_range(gd),
                "n": int(len(gd)),
                "continents": gd.continent.value_counts().to_dict(),
                "group": group,
                "below": chain,
                "attr": attr(tree, g),
                "pbdb_range": [t["firstapp_max_ma"], t["lastapp_min_ma"]] if "firstapp_max_ma" in t and "lastapp_min_ma" in t else None,
                "species": [{"name": n, "n": int(c), "attr": attr(tree, n)} for n, c in sp.items()],
                "wikipedia": genus_wikipedia(g),
                "phylopic": genus_phylopic(g),
            })
            done += 1
            if not OFFLINE and done % 25 == 0:
                print(f"  {done}/{total} genera…")
        genera.sort(key=lambda x: (-x["range_ma"][0], -x["range_ma"][1]))
        groups = []
        for gn in genera:  # in order of first appearance
            if gn["group"] and gn["group"] not in groups:
                groups.append(gn["group"])
        out[fam] = {"path": path_of(fam), "earliest": earliest(d), "groups": groups, "genera": genera}

    (OUT / "genera.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    gs = [g for v in out.values() for g in v["genera"]]
    n_s = sum(len(g["species"]) for g in gs)
    ok = lambda k: sum(1 for g in gs if g.get(k))
    no_path = [f for f, v in out.items() if not v["path"]]
    print(f"OK → data/processed/genera.json · {len(out)} families · {len(gs)} genera · {n_s} species")
    print(f"   subfamily/tribe {ok('group')}/{len(gs)} · authority {ok('attr')}/{len(gs)} · "
          f"Wikipedia {ok('wikipedia')}/{len(gs)} · PhyloPic {ok('phylopic')}/{len(gs)}"
          + (f" · no ancestry: {', '.join(no_path)}" if no_path else ""))

if __name__ == "__main__":
    main()
