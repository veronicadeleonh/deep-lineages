"""Timeline data (local only, no network).

Outputs in data/processed/:
  fossils.json    body fossils (no footprints/eggs), compact column format
  diversity.json  genera "alive" every 1 Ma (range-through: first→last appearance of each genus)
  periods.json    periods/epochs for the timeline bands
  stages.json     ICS stages (ages) with PBDB boundaries, for zooming
Usage:  .venv/bin/python scripts/build_timeline.py
"""
import json
from pathlib import Path
import pandas as pd
from build_families import PERIODS, TRACE_FAM

ROOT = Path(__file__).resolve().parents[1]
STAGES = ["Olenekian", "Anisian", "Ladinian", "Carnian", "Norian", "Rhaetian", "Hettangian", "Sinemurian",
          "Pliensbachian", "Toarcian", "Aalenian", "Bajocian", "Bathonian", "Callovian", "Oxfordian", "Kimmeridgian",
          "Tithonian", "Berriasian", "Valanginian", "Hauterivian", "Barremian", "Aptian", "Albian", "Cenomanian",
          "Turonian", "Coniacian", "Santonian", "Campanian", "Maastrichtian"]
OUT = ROOT / "data/processed"

def main():
    raw = pd.read_csv(ROOT / "data/raw/dinos_pbdb.csv")
    trace = raw.family.isin(TRACE_FAM) | raw.genus.str.contains(r"ool|pus$|podus$|ichnus$|^Grallator$|^Eubrontes$", na=False)
    body = raw[~trace].copy()
    body["mid"] = ((body.max_ma + body.min_ma) / 2).round(2)
    body["loc"] = body.lat.round(2).astype(str) + "," + body.lng.round(2).astype(str)
    locs = {k: i for i, k in enumerate(body["loc"].unique())}
    body["loc_id"] = body["loc"].map(locs)
    fam = body.family.where(body.family != "NO_FAMILY_SPECIFIED")
    fossils = {
        "columns": ["genus", "family", "max_ma", "min_ma", "loc_id", "pbdb_paleolng", "pbdb_paleolat"],
        "rows": [[g, f if isinstance(f, str) else None, float(a), float(b), int(l),
                  None if pd.isna(x) else round(float(x), 2), None if pd.isna(y) else round(float(y), 2)]
                 for g, f, a, b, l, x, y in zip(body.genus, fam, body.max_ma, body.min_ma, body.loc_id, body.paleolng, body.paleolat)],
        "locs": [[float(k.split(",")[1]), float(k.split(",")[0])] for k in locs],  # present-day [lng, lat]
    }
    (OUT / "fossils.json").write_text(json.dumps(fossils, ensure_ascii=False, separators=(",", ":")))

    g = body.groupby("genus").agg(first=("max_ma", "max"), last=("min_ma", "min"))
    div = [{"ma": t, "genera": int(((g["first"] >= t) & (g["last"] <= t)).sum())} for t in range(252, 65, -1)]
    (OUT / "diversity.json").write_text(json.dumps(div))

    periods = [{"name": n, "start": a, "end": b} for a, b, n in PERIODS]

    # ICS stages (ages), with the boundaries used by the PBDB, taken from the CSV itself
    iv = raw[raw.late_interval.isna() | (raw.late_interval == raw.early_interval)] \
        .groupby("early_interval").agg(start=("max_ma", "max"), end=("min_ma", "min"))
    stages = [{"name": n, "start": round(float(iv.loc[n, "start"]), 2), "end": round(float(iv.loc[n, "end"]), 2)}
              for n in STAGES if n in iv.index]
    (OUT / "stages.json").write_text(json.dumps(stages, ensure_ascii=False))
    (OUT / "periods.json").write_text(json.dumps(periods, ensure_ascii=False))
    print(f"fossils: {len(body)} ({len(locs)} localities) · diversity: {len(div)} steps · periods: {len(periods)} · stages: {len(stages)}")

if __name__ == "__main__":
    main()
