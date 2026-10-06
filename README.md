# 🦕 Deep Lineages

_186 million years of dinosaurs, on maps of the world as it was._

I read Steve Brusatte's _The Rise and Fall of the Dinosaurs_ and kept wanting to **see** it: who lived when, who
was related to whom, and where on Earth (on the Earth of back then) their bones turned up. So I built that. It's
a small, very personal data project that turned into a playful app: 29 dinosaur families and their 531 genera
in depth, plus every one of the 7,043 fossils (over 1,500 genera) from the Paleobiology Database on the map.

**Live Demo: [deep-lineages.vercel.app](https://deep-lineages.vercel.app)**

![Deep Lineages](docs/screenshots/hero.png)

---

## What's inside

The **Time machine** tells the story; the other three are a **deep dive** into it. Whatever you pick (a moment in
time, a family, a genus) comes with you from one view to the next: the header shows what you're _following_, so
you can look at the same animal as a story, a timeline, a tree and a map.

### ▶ Time machine

Press play and travel from the Great Dying (252 Ma) to the asteroid (66 Ma). The continents drift, fossils pop up
where they were buried, and the story is told in ten short chapters, like a little documentary. Each chapter
shows big events pulsing on the map (Siberian Traps, Chicxulub…), a mini chart of how many genera were around,
and the dinosaur with the most fossils in that stretch of time. On the right, the families on the map right now;
pick one and a small card unfolds with the essentials and a way to dive deeper.

![Time machine](docs/screenshots/time-machine.png)

### ☰ Timeline

When each family lived, with its family tree drawn right into the timeline. Zoom in with the trackpad and
families open into their genera, then species. Bars show where most of the fossils are, a thin line shows the
full record, and a fade after the last fossil reminds you that a family didn't vanish the day its last known bone
was buried. "Fossils at X Ma" (on by default) keeps only what was around at the cursor, and "Show close relatives"
adds each lineage's early cousins, like the little Jurassic tyrannosaur _Guanlong_.

![Timeline](docs/screenshots/timeline.png)

### ✺ Family tree

The whole tree as a round poster: Dinosauria in the middle, every genus on the rim, rings for families (in their
diet color) and the three big lineages. Pinch to zoom; click a group to center the tree on it, with its silhouette
in the middle. A "Where you are" guide on the side shows how deep you are, from Dinosauria all the way down to a
single species.

![Family tree](docs/screenshots/family-tree.png)

### ◎ Field guide: "What lived here?"

Start with the whole world, pick a continent, or click anywhere on today's map to draw a zone (S, M or L) and see
which dinosaurs were found there, and when: all of them, including families that aren't in the timeline (those
have no profile, but they're on the list). Hover a name to light up its sites. The search box autocompletes,
because nobody can spell _Mamenchisaurus_ on the first try.

![Field guide](docs/screenshots/field-guide.png)

---

## Run it locally

You need Node 20+ (and Python 3 only if you want to rebuild the data).

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

`npm run build` type-checks and builds into `app/dist/`. The processed data is already in the repo, so the app
works out of the box.

---

## Under the hood

**App:** React + TypeScript + Vite, D3 for scales, shapes and map projections, CSS Modules. No backend: it's all
static files. Vite serves `data/processed/` as the app's public folder, so the app and the data pipeline share
one copy of the data.

**Data pipeline:** a few Python scripts that download, clean and enrich the data. Every API response is cached
in `data/raw/api_cache/`, so re-runs only fetch what's new.

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# get the fossil occurrences from the PBDB
curl -o data/raw/dinos_pbdb.csv "https://paleobiodb.org/data1.2/occs/list.csv?base_name=Dinosauria&interval=Triassic,Cretaceous&idreso=genus&show=coords,paleoloc,class,loc"

# then, from the project root, in this order
.venv/bin/python scripts/build_families.py      # which families, + PhyloPic & Wikipedia
.venv/bin/python scripts/build_genera.py        # their genera, species and ancestry
.venv/bin/python scripts/build_clades.py        # silhouettes for the groups in the tree
.venv/bin/python scripts/build_relatives.py     # close relatives outside the chosen families
.venv/bin/python scripts/build_timeline.py      # fossils, diversity, periods and stages
.venv/bin/python scripts/build_paleomaps.py     # coastlines every 10 Myr (GPlates)
```

<details>
<summary>What each script does (the nerdy details)</summary>

- **`build_families.py` → `families.json`.** For each period, the 2 families with the most genera in each
  lineage (theropods, sauropodomorphs, ornithischians; birds excluded; at least 3 genera in that period), plus a
  few iconic ones (`ALWAYS`), minus doubtful ones (`EXCLUDE`). Footprints and eggs are left out. Enriched with
  the PBDB (diet, life habit), PhyloPic (silhouette, author, license) and Wikipedia.
- **`build_genera.py` → `genera.json`.** Genera and species of each family, their ancestry from Archosauria down,
  subfamilies and tribes, who named each one, a Wikipedia summary and a silhouette. A genus keeps a PhyloPic
  silhouette only if the image really is that genus or one of its species (also when PhyloPic files it under an
  older name, like _Tarbosaurus bataar_ as "Tyrannosaurus bataar"); otherwise the app borrows the family's, shown
  fainter. About a third of the genera have their own.
- **`build_clades.py` → `clades.json`, `silhouettes/clades/`.** A silhouette for each group along the ancestry
  paths.
- **`build_relatives.py` → `relatives.json`.** Close relatives that no chosen family covers (e.g. early
  tyrannosauroids like _Guanlong_ or _Yutyrannus_), so a lineage's early history has evidence and not just a
  dotted line.
- **`build_timeline.py` → `fossils.json`, `diversity.json`, `periods.json`, `stages.json`.** Body fossils for the
  maps, genus diversity per million years, and the periods and ICS stages the PBDB uses.
- **`build_paleomaps.py` → `paleomap/`.** Coastlines and fossil sites reconstructed every 10 million years with
  the PALEOMAP model. Heads-up: these are today's coastlines moved to where they were, not the actual coastlines
  of the time (so no inland seas).

</details>

<details>
<summary>Project structure</summary>

```
app/                 the app (React + TypeScript + Vite)
  src/components/    TimeMachine, Timeline, TreeView, FieldGuide, FamilyPanel, Welcome…
  src/story.ts       the time machine's ten chapters
  src/assets/        today's land (Natural Earth) for the field guide
data/raw/            downloaded data, untouched (+ api_cache/)
data/processed/      app-ready data: families, genera, fossils, paleomaps, silhouettes
scripts/             the data pipeline
notebooks/           exploration
prototype/           the very first version (plain HTML + D3), kept for nostalgia
```

</details>

---

## A few honest caveats

- **A fossil record isn't a lifespan.** Families surely appeared before their first known fossil and lasted
  after their last. The fades in the timeline are there to remind you.
- **The record is biased.** Big animals with sturdy bones, living where sediments piled up, fossilize much
  better. That's why a genus known almost only from teeth (_Richardoestesia_) can "win" a chapter.
- **Sizes aren't here (yet).** Lengths and weights you read online are estimates from partial skeletons, and
  vary a lot between sources; if they come, they'll come from one scientific dataset, with its uncertainty.
- **The maps are approximate.** Continents jump every 10 million years (with a crossfade in between), and the
  positions of the events on the map are estimated from nearby fossil sites.

---

## Credits

- Fossil data: [Paleobiology Database](https://paleobiodb.org) (CC BY 4.0)
- Paleogeography: [GPlates Web Service](https://gwsdoc.gplates.org), PALEOMAP model by C. R. Scotese
- Silhouettes: [PhyloPic](https://www.phylopic.org) (each image has its own license, credited in the app)
- Summaries: [Wikipedia](https://www.wikipedia.org) (CC BY-SA 4.0)
- Today's map: [Natural Earth](https://www.naturalearthdata.com) (public domain)
- Inspiration: Steve Brusatte, _The Rise and Fall of the Dinosaurs_ (2018)
