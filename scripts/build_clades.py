"""Silhouettes for the groups on the ancestry paths (Archosauria … subfamilies and tribes), to illustrate
the family tree and the "Where it comes from" line.

Inputs:  data/processed/genera.json (written by build_genera.py)
Network (cached in data/raw/api_cache/, skipped with --offline):
  - PhyloPic API v2 -> the primary image PhyloPic picks for each group (always a member of that group)
Output:  data/processed/clades.json
  {group: {"depicts", "uuid", "attribution", "license", "page", "svg"}}
  "depicts" is the taxon actually drawn, e.g. Theropoda -> "Allosaurus fragilis".
Usage:  .venv/bin/python scripts/build_clades.py [--offline]
"""
import json
from build_families import get_json, get_file, phylopic_image_href, OFFLINE, SIL, OUT

DIR = SIL / "clades"


def clade_names(genera):
    names = []
    for fam, v in genera.items():
        path = v["path"][:-1]  # without the family itself (families have their own silhouettes)
        if "Theropoda" in path and "Saurischia" not in path:
            names.append("Saurischia")  # the app places Theropoda inside Saurischia
        names += path
        for g in v["genera"]:
            names += [b["name"] for b in g.get("below") or []]
    return list(dict.fromkeys(names))


def clade_phylopic(name):
    href = phylopic_image_href(name)
    img = get_json(f"https://api.phylopic.org{href}", f"phylopic_img_clade_{name}") if href else None
    if not img:
        return None
    links = img.get("_links", {})
    svg = (links.get("vectorFile") or {}).get("href")
    if not svg or not get_file(svg, DIR / f"{name}.svg"):
        return None
    return {
        "depicts": (links.get("specificNode") or {}).get("title"),
        "uuid": img.get("uuid"),
        "attribution": img.get("attribution"),
        "license": (links.get("license") or {}).get("href"),
        "page": f"https://www.phylopic.org/images/{img.get('uuid')}",
        "svg": f"silhouettes/clades/{name}.svg",
    }


def main():
    DIR.mkdir(parents=True, exist_ok=True)
    genera = json.loads((OUT / "genera.json").read_text())
    names = clade_names(genera)
    out = {}
    for i, n in enumerate(names, 1):
        ph = clade_phylopic(n)
        if ph:
            out[n] = ph
        if not OFFLINE and i % 20 == 0:
            print(f"  {i}/{len(names)} groups…")
    (OUT / "clades.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"OK → data/processed/clades.json · {len(out)}/{len(names)} groups with a silhouette")


if __name__ == "__main__":
    main()
