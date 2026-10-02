# Deep Lineages

*Dinosaur families of the Mesozoic.*

A personal project to revisit and expand on *The Rise and Fall of the Dinosaurs* (Steve Brusatte): an interactive timeline of the dominant dinosaur families, their genera and species, their ancestry, and where their fossils were found — on maps of the world as it was at the time.

## Structure
```
data/raw/            downloaded data, untouched (+ api_cache/)
data/processed/      app-ready data (families, genera, timeline, paleomaps, silhouettes)
scripts/             data pipeline
notebooks/           exploration
prototype/           the app (HTML + D3, no build step)
```

## Data
**Paleobiology Database (PBDB)** — CC BY 4.0. Dinosauria occurrences, Triassic–Cretaceous, resolved to genus.

```bash
curl -o data/raw/dinos_pbdb.csv "https://paleobiodb.org/data1.2/occs/list.csv?base_name=Dinosauria&interval=Triassic,Cretaceous&idreso=genus&show=coords,paleoloc,class,loc"
```
The current CSV was downloaded without `loc`, so it has no country (`cc`). Re-download with the command above to get it.

## Pipeline
Run from the project root, in this order. Network steps cache every response in `data/raw/api_cache/`, so re-runs only fetch what is new.

```bash
.venv/bin/python scripts/build_families.py      # network (--offline: local data + cache only)
.venv/bin/python scripts/build_genera.py        # local
.venv/bin/python scripts/build_timeline.py      # local
.venv/bin/python scripts/build_paleomaps.py     # network (GPlates)
```

**`build_families.py` → `families.json`.** For each period, the 2 families with the most genera in each lineage (theropods, sauropodomorphs, ornithischians; birds excluded; at least 3 genera in that period), plus a few iconic families (`ALWAYS`), minus doubtful ones (`EXCLUDE`). Footprints and eggs are excluded. Lineage comes from each family's parent groups in the PBDB. Enriched with PBDB (appearance, diet, life habit), PhyloPic (SVG silhouette, author, license; falls back to a genus or parent group when the family has none) and Wikipedia (en → es). Silhouette licenses are stored in the JSON and credited in the app.

**`build_genera.py` → `genera.json`.** Genera and species of each selected family, its ancestry from Archosauria down (from the `pbdb_parents_*` cache), and the earliest genera. Genus ranges drop the most extreme 10% of fossils when there are 5 or more.

**`build_timeline.py` → `fossils.json`, `diversity.json`, `periods.json`, `stages.json`.** Body fossils for the map, genus diversity per million years, and periods and ICS stages with the boundaries used by the PBDB.

**`build_paleomaps.py` → `paleomap/`.** Coastlines and fossil localities reconstructed every 10 Myr with the PALEOMAP model. These are present-day coastlines moved to their past position, not the coastlines of the time.

## Setup
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Prototype
```bash
python3 -m http.server 8000      # from the project root
```
Open http://localhost:8000/ (redirects to `prototype/`) — without paleomaps, the map falls back to PBDB paleocoordinates. The app is static, so it can be served as-is with GitHub Pages from the repository root.

- `index.html` + `app.js` — the timeline: draggable cursor, zoom and pan with geological stages, families that unfold into their genera
- `common.js` — data loading, state, paleomap and family panel
- `style.css`, `vendor/d3.min.js`

## Sources and licenses
- Fossil data: [Paleobiology Database](https://paleobiodb.org) (CC BY 4.0)
- Silhouettes: [PhyloPic](https://www.phylopic.org) (per-image licenses, credited in the app)
- Family summaries: [Wikipedia](https://www.wikipedia.org) (CC BY-SA 4.0)
- Paleogeography: [GPlates Web Service](https://gwsdoc.gplates.org), PALEOMAP model (Scotese)

## License
Code: [MIT](LICENSE). Data and images keep their original licenses listed above.
