# Deep Lineages

*Dinosaur families of the Mesozoic.*

A personal project to revisit and expand on *The Rise and Fall of the Dinosaurs* (Steve Brusatte): an interactive timeline of the dominant dinosaur families, their genera and species, their ancestry, and where their fossils were found — on maps of the world as it was at the time.

## Structure
```
data/raw/            downloaded data, untouched (+ api_cache/)
data/processed/      app-ready data (families, genera, timeline, paleomaps, silhouettes)
scripts/             data pipeline
notebooks/           exploration
app/                 the app (React + TypeScript + Vite)
prototype/           first prototype (plain HTML + D3), legacy
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
.venv/bin/python scripts/build_genera.py        # network (--offline: local data + cache only)
.venv/bin/python scripts/build_timeline.py      # local
.venv/bin/python scripts/build_paleomaps.py     # network (GPlates)
```

**`build_families.py` → `families.json`.** For each period, the 2 families with the most genera in each lineage (theropods, sauropodomorphs, ornithischians; birds excluded; at least 3 genera in that period), plus a few iconic families (`ALWAYS`), minus doubtful ones (`EXCLUDE`). Footprints and eggs are excluded. Lineage comes from each family's parent groups in the PBDB. Enriched with PBDB (appearance, diet, life habit), PhyloPic (SVG silhouette, author, license; falls back to a genus or parent group when the family has none) and Wikipedia (en → es). Silhouette licenses are stored in the JSON and credited in the app.

**`build_genera.py` → `genera.json`.** Genera and species of each selected family, its ancestry from Archosauria down (from the `pbdb_parents_*` cache), and the earliest genera. Each family's subtree from the PBDB adds subfamilies and tribes (used to group genera) and who named each genus and species. Each genus gets a Wikipedia summary and a PhyloPic silhouette when available. Genus ranges drop the most extreme 10% of fossils when there are 5 or more.

**`build_timeline.py` → `fossils.json`, `diversity.json`, `periods.json`, `stages.json`.** Body fossils for the map, genus diversity per million years, and periods and ICS stages with the boundaries used by the PBDB.

**`build_paleomaps.py` → `paleomap/`.** Coastlines and fossil localities reconstructed every 10 Myr with the PALEOMAP model. These are present-day coastlines moved to their past position, not the coastlines of the time.

## Setup
```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## App (React + TypeScript)
```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build in app/dist/
```
Built with Vite, React, TypeScript, D3 (scales, shapes, map projections) and CSS Modules. Vite serves `data/processed/` as the app's static files, so the app and the pipeline share one copy of the data. Without paleomaps, the map falls back to PBDB paleocoordinates.

```
app/src/
  types.ts            shapes of the JSON files
  data.ts             loading, fossils, paleomap snapshots
  state.tsx           app state: time, selection, unfolded families, zoom
  constants.ts        lineages, diets, extinctions
  components/
    Timeline.tsx      timeline with zoom, stages and unfoldable genera
    PaleoMap.tsx      the world at the cursor's time
    FamilyPanel.tsx   what's alive now / family profile
    Tooltip.tsx
```

## Prototype (legacy)
`prototype/` is the first version in plain HTML + D3, kept for comparison until the React app replaces it. Serve the project root (`python3 -m http.server 8000`) and open `/prototype/`.

## Sources and licenses
- Fossil data: [Paleobiology Database](https://paleobiodb.org) (CC BY 4.0)
- Silhouettes: [PhyloPic](https://www.phylopic.org) (per-image licenses, credited in the app)
- Family summaries: [Wikipedia](https://www.wikipedia.org) (CC BY-SA 4.0)
- Paleogeography: [GPlates Web Service](https://gwsdoc.gplates.org), PALEOMAP model (Scotese)

## License
Code: [MIT](LICENSE). Data and images keep their original licenses listed above.
