/* The third view: a field guide. One card per genus, grouped by family, with filters in one row above.
   It answers "what was this animal like?" in plain words; a card opens the same profile as the other views. */
import { useMemo, useState } from "react";
import { GROUPS, SOCIAL, dietOf, groupOf, socialOf, type Social } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, fMa, fNum, genusRecord } from "../format";
import { useStore } from "../state";
import { periodOf } from "../tree";
import type { Family, Genus } from "../types";
import { DeckMap } from "./PaleoMap";
import s from "./FieldGuide.module.css";

type Sort = "name" | "fossils" | "oldest" | "youngest";
const PERIODS = ["Triassic", "Jurassic", "Cretaceous"] as const;
const DIETS = [{ key: "herbivore", label: "Plant-eaters" }, { key: "carnivore", label: "Meat-eaters" }] as const;

/** First sentence of a Wikipedia summary. */
const firstSentence = (t?: string) => (t ? (t.match(/^.+?[.!?](\s|$)/)?.[0] ?? t).trim() : "");

export function FieldGuide() {
  const { data, state, dispatch } = useStore();
  const [q, setQ] = useState("");
  const [lineage, setLineage] = useState<string | null>(null);
  const [diet, setDiet] = useState<string | null>(null);
  const [period, setPeriod] = useState<string | null>(null);
  const [continent, setContinent] = useState<string | null>(null);
  const [social, setSocial] = useState<Social | null>(null);
  const [sort, setSort] = useState<Sort>("oldest");
  const [folded, setFolded] = useState<Set<string>>(new Set());

  const continents = useMemo(() => {
    const n: Record<string, number> = {};
    for (const fg of Object.values(data.genera)) for (const g of fg.genera) for (const c of Object.keys(g.continents)) n[c] = (n[c] ?? 0) + 1;
    return byCount(n);
  }, [data]);

  // families in their lineage order, each with the genera that pass the filters
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const order = (a: Genus, b: Genus) =>
      sort === "name" ? a.genus.localeCompare(b.genus)
        : sort === "fossils" ? b.n - a.n
          : sort === "oldest" ? genusRecord(b)[0] - genusRecord(a)[0] : genusRecord(a)[1] - genusRecord(b)[1];
    const fams = [...data.families].sort((a, b) =>
      GROUPS.findIndex((g) => g.key === groupOf(a)?.key) - GROUPS.findIndex((g) => g.key === groupOf(b)?.key) || b.range_ma[0] - a.range_ma[0]);
    return fams.map((f) => {
      if (lineage && groupOf(f)?.key !== lineage) return { f, gs: [] as Genus[] };
      if (diet && (f.pbdb?.diet ?? "none") !== diet) return { f, gs: [] as Genus[] };
      if (social && socialOf(f) !== social) return { f, gs: [] as Genus[] };
      const gs = (data.genera[f.family]?.genera ?? []).filter((g) =>
        (!period || periodOf(g) === period)
        && (!continent || g.continents[continent])
        && (!needle || g.genus.toLowerCase().includes(needle) || f.family.toLowerCase().includes(needle)
          || g.species.some((sp) => sp.name.toLowerCase().includes(needle))));
      return { f, gs: gs.sort(order) };
    }).filter((x) => x.gs.length);
  }, [data, q, lineage, diet, period, continent, social, sort]);
  const total = groups.reduce((n, g) => n + g.gs.length, 0);
  const anyFilter = q || lineage || diet || period || continent || social;
  const reset = () => { setQ(""); setLineage(null); setDiet(null); setPeriod(null); setContinent(null); setSocial(null); };

  const toggleFold = (fam: string) => setFolded((prev) => { const n = new Set(prev); n.has(fam) ? n.delete(fam) : n.add(fam); return n; });
  const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) =>
    <button className={`${s.chip} ${on ? s.chipOn : ""}`} aria-pressed={on} onClick={onClick}>{children}</button>;

  return (
    <section className={`card ${s.card}`} aria-label="Field guide">
      {/* filters stay on screen while the cards scroll */}
      <div className={s.bar}>
        <div className={s.filters}>
          <input className={s.search} type="search" placeholder="Search a dinosaur, family or species…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className={s.row}>
            {GROUPS.map((g) => <Chip key={g.key} on={lineage === g.key} onClick={() => setLineage(lineage === g.key ? null : g.key)}>{g.label}</Chip>)}
            <span className={s.divider} />
            {DIETS.map((d) => (
              <Chip key={d.key} on={diet === d.key} onClick={() => setDiet(diet === d.key ? null : d.key)}>
                <i className="swatch" style={{ background: d.key === "herbivore" ? "var(--herb)" : "var(--carn)" }} />{d.label}
              </Chip>
            ))}
            <span className={s.divider} />
            {(Object.keys(SOCIAL) as Social[]).map((k) => <Chip key={k} on={social === k} onClick={() => setSocial(social === k ? null : k)}>{SOCIAL[k]}</Chip>)}
            <span className={s.divider} />
            {PERIODS.map((p) => <Chip key={p} on={period === p} onClick={() => setPeriod(period === p ? null : p)}>{p}</Chip>)}
          </div>
          <div className={s.row}>
            {continents.map((c) => <Chip key={c} on={continent === c} onClick={() => setContinent(continent === c ? null : c)}>{c}</Chip>)}
            <span className={s.spacer} />
            <label className={s.sort}>Sort
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                <option value="oldest">Oldest first</option>
                <option value="youngest">Most recent first</option>
                <option value="fossils">Most fossils</option>
                <option value="name">A–Z</option>
              </select>
            </label>
          </div>
          <p className={s.count}>
            <b>{fNum(total)}</b> {total === 1 ? "dinosaur" : "dinosaurs"} in {fNum(groups.length)} {groups.length === 1 ? "family" : "families"}
            {anyFilter && <button className={s.reset} onClick={reset}>Clear filters</button>}
          </p>
        </div>
        <div className={s.map}><DeckMap width={220} height={124} /></div>
      </div>

      {groups.length === 0 && <p className={s.empty}>No dinosaur matches these filters.</p>}
      {groups.map(({ f, gs }) => {
        const open = !folded.has(f.family);
        return (
          <section key={f.family} className={s.family}>
            <header className={s.famHead}>
              <button className={s.famToggle} onClick={() => toggleFold(f.family)} aria-expanded={open}>
                <span className={s.chev}>{open ? "▾" : "▸"}</span>
                {f.phylopic?.svg && <span className={s.famSil} style={{ ["--src" as string]: `url("${silhouetteUrl(f.phylopic.svg)}")` }} />}
                <span className={s.famName}>{f.family}</span>
                <span className={s.famMeta}>{groupOf(f)?.label} · <i className="swatch" style={{ background: dietOf(f).color }} /> {dietOf(f).label.toLowerCase()} · {fNum(gs.length)}</span>
              </button>
              <button className={s.famProfile} onClick={() => dispatch({ type: "select", family: f.family })}>Family profile →</button>
            </header>
            {open && (
              <div className={s.grid}>
                {gs.map((g) => <Card key={g.genus} f={f} g={g} sel={state.selected === f.family && state.genus === g.genus}
                  onOpen={() => dispatch({ type: "genus", family: f.family, genus: g.genus })} />)}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}

function Card({ f, g, sel, onOpen }: { f: Family; g: Genus; sel: boolean; onOpen: () => void }) {
  const own = g.phylopic?.svg;
  const sil = own ?? f.phylopic?.svg;
  const r = genusRecord(g);
  const where = byCount(g.continents);
  return (
    <button className={`${s.cardItem} ${sel ? s.cardSel : ""}`} onClick={onOpen} aria-pressed={sel}>
      <div className={`${s.sil} ${own ? "" : s.silFamily}`} style={sil ? { ["--src" as string]: `url("${silhouetteUrl(sil)}")` } : undefined}>
        {!sil && <span className={s.noSil}>no silhouette</span>}
      </div>
      {sil && !own && <span className={s.silNote}>family silhouette</span>}
      <h3 className={s.name}>{g.genus}</h3>
      {g.wikipedia?.extract && <p className={s.blurb}>{firstSentence(g.wikipedia.extract)}</p>}
      <ul className={s.facts}>
        <li><b>{periodOf(g)}</b> · {fMa(r[0])}–{fMa(r[1])} Ma</li>
        <li><i className="swatch" style={{ background: dietOf(f).color }} />{dietOf(f).label}{socialOf(f) && <> · {SOCIAL[socialOf(f)!].toLowerCase()}</>}</li>
        <li>{where.slice(0, 2).join(", ")}{where.length > 2 ? ` +${where.length - 2}` : ""} · {fNum(g.n)} {g.n === 1 ? "fossil" : "fossils"}</li>
        {g.species.length > 0 && <li>{g.species.length === 1 ? <i>{g.species[0].name}</i> : `${g.species.length} species`}</li>}
      </ul>
    </button>
  );
}
