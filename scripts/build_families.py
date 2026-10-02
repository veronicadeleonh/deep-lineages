"""Builds data/processed/families.json with the dominant families of each lineage.

Selection: for each period, the 2 families with the most genera in each lineage
(theropods, sauropodomorphs, ornithischians; no birds; at least 3 genera in that period),
plus a few iconic families (ALWAYS), minus doubtful families (EXCLUDE).

Sources:
  - data/raw/dinos_pbdb.csv  (local) -> genera, occurrences, range, continents
  - PBDB taxa API            -> first/last appearance, diet, life habit, authority
  - PhyloPic API v2          -> SVG silhouette + license + author
  - Wikipedia REST (en, es)  -> summary, image, link

Responses are cached in data/raw/api_cache/ (re-running does not repeat requests).
Usage:  .venv/bin/python scripts/build_families.py [--offline]
"""
import json, sys, time, re, urllib.parse, urllib.request
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CSV = ROOT / "data/raw/dinos_pbdb.csv"
CACHE = ROOT / "data/raw/api_cache"
OUT = ROOT / "data/processed"
SIL = OUT / "silhouettes"
OFFLINE = "--offline" in sys.argv
UA = {"User-Agent": "deep-lineages/0.1 (https://github.com/veronicadeleonh/deep-lineages)"}

# Boundaries from the time scale used by the PBDB (they match max_ma/min_ma in the CSV)
PERIODS = [(252, 247, "Early Triassic"), (247, 237, "Middle Triassic"), (237, 201.4, "Late Triassic"),
           (201.4, 174.7, "Early Jurassic"), (174.7, 161.5, "Middle Jurassic"), (161.5, 143.1, "Late Jurassic"),
           (143.1, 100.5, "Early Cretaceous"), (100.5, 66, "Late Cretaceous")]
TRACE_FAM = {"Grallatoridae", "Eubrontidae", "Anomoepodidae", "Otozoidae", "Brontopodidae", "Iguanodontipodidae",
             "Elongatoolithidae", "Megaloolithidae", "Faveoloolithidae", "Dendroolithidae", "Spheroolithidae",
             "Prismatoolithidae", "Ovaloolithidae"}
PER_LINEAGE = 2   # families per lineage and period (those with the most genera)
LINEAGES = [("theropoda", "Theropoda"), ("sauropodomorpha", "Sauropodomorpha"), ("ornithischia", "Ornithischia")]
EXCLUDE_BASE = "Avialae"  # birds are left out: the project is about non-avian dinosaurs
# Fallback for families the PBDB does not place in any of the three lineages (debated position)
LINEAGE_FALLBACK = {"Herrerasauridae": "theropoda", "Silesauridae": "ornithischia"}
MIN_GENERA = 3    # within the period; keeps a stray record from placing a family in the wrong period
# Families described from very fragmentary remains from Pakistan, considered doubtful by most authors
EXCLUDE = {"Pakisauridae", "Balochisauridae", "Gspsauridae", "Vitakrisauridae"}
# Always included even if not among those with the most genera (key players in Brusatte's book)
ALWAYS = ["Tyrannosauridae", "Carcharodontosauridae", "Spinosauridae", "Diplodocidae", "Brachiosauridae", "Stegosauridae", "Ceratopsidae"]
CORE_SHARE = 0.05  # a period counts if it holds ≥5% of the family's occurrences (filters outliers)


# ---------- local ----------
def continent(la, lo):
    if lo < -30: return "South America" if la < 12 else "North America"
    if la < -10 and lo > 110: return "Oceania"
    if -30 <= lo < 60: return "Africa" if la < 37 else "Europe"
    return "Asia"

def load():
    df = pd.read_csv(CSV)
    trace = df.family.isin(TRACE_FAM) | df.genus.str.contains(r"ool|pus$|podus$|ichnus$|^Grallator$|^Eubrontes$", na=False)
    df = df[~trace & (df.family != "NO_FAMILY_SPECIFIED") & df.family.notna()].copy()
    mid = (df.max_ma + df.min_ma) / 2
    df["period"] = pd.cut(mid, [p[1] for p in reversed(PERIODS)] + [252], labels=[p[2] for p in reversed(PERIODS)])
    df["continent"] = [continent(a, o) for a, o in zip(df.lat, df.lng)]
    return df

def pick_families(df, lineage_of):
    """For each period and lineage, the PER_LINEAGE families with the most genera (tie-break: more fossils)."""
    df = df.assign(lineage=df.family.map(lineage_of))
    df = df[~df.family.isin(EXCLUDE)]
    fams = []
    for *_, label in PERIODS:
        d = df[df.period == label]
        for key, _ in LINEAGES:
            top = (d[d.lineage == key].groupby("family")
                   .agg(g=("genus", "nunique"), n=("genus", "size"))
                   .query("g >= @MIN_GENERA")
                   .sort_values(["g", "n"], ascending=False).head(PER_LINEAGE).index)
            fams += [f for f in top if f not in fams]
    fams += [f for f in ALWAYS if f not in fams and f in set(df.family)]
    return fams

def local_stats(df, fam):
    d = df[df.family == fam]
    share = d.period.value_counts(normalize=True)
    order = [p[2] for p in PERIODS]
    core_periods = [p for p in order if share.get(p, 0) >= CORE_SHARE]
    core = d[d.period.isin(core_periods)]
    return {
        "clade": d["class"].mode().iat[0],
        "n_genera": int(d.genus.nunique()),
        "n_occurrences": int(len(d)),
        "range_ma": [round(float(core.max_ma.max()), 1), round(float(core.min_ma.min()), 1)],
        "range_ma_all": [round(float(d.max_ma.max()), 1), round(float(d.min_ma.min()), 1)],
        "periods": core_periods,
        "top_genera": d.genus.value_counts().head(5).index.tolist(),
        "continents": d.continent.value_counts().to_dict(),
    }


# ---------- network + cache ----------
def get_json(url, key):
    f = CACHE / f"{key}.json"
    if f.exists():
        return json.loads(f.read_text())
    if OFFLINE:
        return None
    try:
        req = urllib.request.Request(url, headers={**UA, "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read())
    except Exception as e:
        print(f"  ! {key}: {e}")
        return None
    f.write_text(json.dumps(data, ensure_ascii=False))
    time.sleep(0.3)
    return data

def get_file(url, dest):
    if dest.exists() or OFFLINE:
        return dest.exists()
    try:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            dest.write_bytes(r.read())
        return True
    except Exception as e:
        print(f"  ! {dest.name}: {e}")
        return False


# ---------- lineages (PBDB) ----------
# The PBDB ranks many modern families as "unranked clade" (e.g. Diplodocidae, Saltasauridae),
# so listing each lineage's families is not enough: for each candidate family we fetch all of
# its parent groups (rel=all_parents) and check which of the three lineages it falls in.
def parents_of(fam):
    q = urllib.parse.urlencode({"name": fam, "rel": "all_parents", "vocab": "pbdb"})
    d = get_json(f"https://paleobiodb.org/data1.2/taxa/list.json?{q}", f"pbdb_parents_{fam}")
    return [r.get("taxon_name") for r in (d or {}).get("records", []) if r.get("taxon_name")]

def lineage_map(df):
    """{family: lineage} for candidate families (≥ MIN_GENERA genera in some period), excluding birds."""
    per = df.groupby(["family", "period"], observed=True).genus.nunique()
    cands = sorted(set(per[per >= MIN_GENERA].index.get_level_values(0)) | set(ALWAYS) | set(LINEAGE_FALLBACK))
    out, missing = {}, []
    for fam in cands:
        ps = set(parents_of(fam))
        if not ps:
            missing.append(fam)
        if EXCLUDE_BASE in ps or "Aves" in ps:
            continue  # bird
        key = next((k for k, base in LINEAGES if base in ps), None) or LINEAGE_FALLBACK.get(fam)
        if key:
            out[fam] = key
    if missing:
        print(f"  ! no PBDB classification for {len(missing)} families: {', '.join(missing[:8])}…")
    return out


# ---------- PBDB ----------
def pbdb(fam):
    q = urllib.parse.urlencode({"name": fam, "vocab": "pbdb", "show": "app,ecospace,attr,parent,size"})
    d = get_json(f"https://paleobiodb.org/data1.2/taxa/single.json?{q}", f"pbdb_{fam}")
    if not d or not d.get("records"):
        return None
    r = d["records"][0]
    keys = ["taxon_name", "taxon_attr", "parent_name", "firstapp_max_ma", "firstapp_min_ma", "lastapp_max_ma",
            "lastapp_min_ma", "diet", "life_habit", "motility", "taxon_size", "n_occs"]
    return {k: r[k] for k in keys if k in r}


# ---------- PhyloPic ----------
_build = None
def phylopic_build():
    global _build
    if _build is None:
        d = get_json("https://api.phylopic.org/", "phylopic_root")
        _build = d.get("build") if d else None
    return _build

def phylopic_image_href(name):
    """First primary image of a PhyloPic node with that name (family, genus or clade)."""
    b = phylopic_build()
    if not b:
        return None
    q = urllib.parse.urlencode({"build": b, "filter_name": name.lower(), "page": 0, "embed_items": "true"})
    nodes = get_json(f"https://api.phylopic.org/nodes?{q}", f"phylopic_node_{name}")
    items = ((nodes or {}).get("_embedded") or {}).get("items") or []
    return next((it["_links"]["primaryImage"]["href"] for it in items
                 if (it.get("_links") or {}).get("primaryImage")), None)

def phylopic(fam, fallbacks=()):
    """Family silhouette; if missing, that of its most common genera or of its parent group."""
    source, img_href = fam, phylopic_image_href(fam)
    for name in fallbacks:
        if img_href:
            break
        source, img_href = name, phylopic_image_href(name)
    if not img_href:
        return None
    img = get_json(f"https://api.phylopic.org{img_href}", f"phylopic_img_{fam}")
    if not img:
        return None
    links = img.get("_links", {})
    svg = (links.get("vectorFile") or {}).get("href")
    out = {
        "source": source,  # taxon whose silhouette is used (≠ fam if it comes from a genus or parent group)
        "uuid": img.get("uuid"),
        "attribution": img.get("attribution"),
        "license": (links.get("license") or {}).get("href"),
        "page": f"https://www.phylopic.org/images/{img.get('uuid')}",
        "svg": None,
    }
    if svg and get_file(svg, SIL / f"{fam}.svg"):
        out["svg"] = f"silhouettes/{fam}.svg"
    return out


# ---------- Wikipedia ----------
def wikipedia(fam):
    for lang in ("en", "es"):
        d = get_json(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(fam)}", f"wiki_{lang}_{fam}")
        if d and d.get("extract") and d.get("type") != "disambiguation":
            return {
                "lang": lang,
                "title": d.get("title"),
                "description": d.get("description"),
                "extract": d.get("extract"),
                "url": ((d.get("content_urls") or {}).get("desktop") or {}).get("page"),
                "thumbnail": (d.get("thumbnail") or {}).get("source"),
                "license": "CC BY-SA 4.0",
            }
    return None


def main():
    for p in (CACHE, OUT, SIL):
        p.mkdir(parents=True, exist_ok=True)
    df = load()
    lineage_of = lineage_map(df)
    fams = pick_families(df, lineage_of)
    print(f"{len(fams)} families:", ", ".join(fams))
    result = []
    for fam in fams:
        print("·", fam)
        stats, info = local_stats(df, fam), pbdb(fam)
        fallbacks = stats["top_genera"][:3] + ([info["parent_name"]] if info and info.get("parent_name") else [])
        result.append({"family": fam, "lineage": lineage_of.get(fam), **stats,
                       "pbdb": info, "phylopic": phylopic(fam, fallbacks), "wikipedia": wikipedia(fam)})
    (OUT / "families.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
    ok = lambda k: sum(1 for r in result if r[k])
    print(f"\nOK → data/processed/families.json | PBDB {ok('pbdb')}/{len(result)} · "
          f"PhyloPic {ok('phylopic')}/{len(result)} · Wikipedia {ok('wikipedia')}/{len(result)}")

if __name__ == "__main__":
    main()
