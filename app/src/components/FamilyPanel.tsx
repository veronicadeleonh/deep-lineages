/* Right-hand panel: what is alive now (no selection), the selected family's profile, or the selected genus's profile. */
import { LINEAGE_NOTES, dietOf, groupOf } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, fMa, fNum, fRange, isAlive } from "../format";
import { useStore } from "../state";
import type { AppData, Family, Genus, Phylopic, Wikipedia } from "../types";
import { Lineage, type Step } from "./Lineage";
import { ancestry } from "../tree";
import s from "./FamilyPanel.module.css";

export function FamilyPanel() {
  const { data, state } = useStore();
  const fam = data.families.find((f) => f.family === state.selected);
  const gn = fam && state.genus ? data.genera[fam.family]?.genera.find((g) => g.genus === state.genus) : undefined;
  return (
    <section className={`card ${s.panel}`} aria-live="polite">
      {fam && gn ? <GenusProfile f={fam} g={gn} /> : fam ? <Profile f={fam} /> : <AliveNow />}
    </section>
  );
}

function Chip({ f }: { f: Family }) {
  const { dispatch } = useStore();
  return (
    <button className="chip" onClick={() => dispatch({ type: "select", family: f.family })}>
      <i className="swatch" style={{ background: dietOf(f).color }} />{f.family}
    </button>
  );
}

function AliveNow() {
  const { data, state } = useStore();
  const { t } = state;
  const living = data.families.filter((f) => isAlive(f.range_ma, t));
  const W = 5; // ±5 Myr window for "what is happening now"
  const born = data.families.filter((f) => Math.abs(f.range_ma[0] - t) <= W);
  const gone = data.families.filter((f) => Math.abs(f.range_ma[1] - t) <= W && f.range_ma[1] > 66);
  return (
    <div>
      <h3 className={s.title}>
        {living.length ? `${living.length} ${living.length === 1 ? "family" : "families"} alive` : "None of these families alive"}
      </h3>
      <p className={s.lede}>
        {living.length ? "Pick one to see its profile and its fossils on the map." : "Move through time or pick a family on the timeline."}
      </p>
      {born.length > 0 && <p className={s.event}><b>Appearing</b> {born.map((f) => f.family).join(", ")}</p>}
      {gone.length > 0 && <p className={s.event}><b>Disappearing</b> {gone.map((f) => f.family).join(", ")}</p>}
      <div className={s.chips}>{(living.length ? living : data.families).map((f) => <Chip key={f.family} f={f} />)}</div>
    </div>
  );
}

/** Silhouette + hover credit for one step of the ancestry line. */
type Sil = { svg?: string | null; depicts?: string | null; source?: string; attribution?: string | null; license?: string | null } | null | undefined;
const stepSil = (ph: Sil, name: string) => {
  if (!ph?.svg) return null;
  const depicts = ph.depicts ?? ph.source;
  return { svg: ph.svg, credit: `${depicts && depicts !== name ? `Drawn: ${depicts} · ` : ""}${ph.attribution || "unknown author"} · ${license(ph.license)} · PhyloPic` };
};

/** The ancestry line from Archosauria down to the family, with whatever silhouettes we have. */
function familySteps(f: Family, data: AppData): Step[] {
  return [
    ...ancestry(f.family, data).slice(0, -1).map((name) => ({ name, sil: stepSil(data.clades[name], name) })),
    { name: f.family, rank: "family", sil: stepSil(f.phylopic, f.family) },
  ];
}

const license = (url?: string | null) => {
  if (!url) return "";
  const m = url.match(/licenses\/([^/]+)\/([\d.]+)/);
  return m ? `CC ${m[1].toUpperCase()} ${m[2]}` : url.includes("zero") ? "CC0" : "license";
};

function Profile({ f }: { f: Family }) {
  const { data, dispatch } = useStore();
  const w = f.wikipedia, p = f.pbdb ?? {}, ph = f.phylopic;
  const fg = data.genera[f.family];
  const gs = fg?.genera ?? [];
  const note = LINEAGE_NOTES[f.family]?.disputed;
  const diet = dietOf(f);

  // the genera with the oldest records (same criterion as the genus bars)
  const first = gs.length ? gs.filter((g) => g.range_ma[0] === gs[0].range_ma[0]).slice(0, 3) : [];
  const firstWhere = [...new Set(first.map((g) => byCount(g.continents)[0]))];
  return (
    <div>
      <div className={s.head}>
        <div>
          <h3 className={s.title}>{f.family}</h3>
          <p className={s.sub}>{[groupOf(f)?.label, p.taxon_attr, p.parent_name && `within ${p.parent_name}`].filter(Boolean).join(" · ")}</p>
        </div>
        <button className={s.close} aria-label="Close" onClick={() => dispatch({ type: "select", family: null })}>✕</button>
      </div>

      <Silhouette ph={ph} name={f.family} />

      <dl className={s.stats}>
        <div><dt>Range</dt><dd>{fRange(f.range_ma)}</dd></div>
        <div><dt>Genera · fossils</dt><dd>{fNum(f.n_genera)} · {fNum(f.n_occurrences)}</dd></div>
        <div><dt>Diet</dt><dd className={s.diet}><i className="swatch" style={{ background: diet.color }} />{diet.label}</dd></div>
      </dl>

      {note && <p className={`${s.meta} ${s.disputed}`}>{note}</p>}
      {w?.extract && <p className={s.extract}>{w.extract} <a href={w.url} target="_blank" rel="noopener">Wikipedia →</a></p>}

      <Lineage key={f.family} steps={familySteps(f, data)} />

      <p className={s.meta}><b>Fossils by continent:</b> {byCount(f.continents).map((c) => `${c} ${fNum(f.continents[c])}`).join(" · ")}</p>
      {first.length > 0 && (
        <p className={s.meta}>
          <b>First to appear:</b> {first.map((g, i) => <span key={g.genus}>{i ? ", " : ""}<i>{g.genus}</i></span>)} · {firstWhere.join(", ")} · ~{fMa(first[0].range_ma[0])} Ma{" "}
          <span className="muted">(oldest records in the PBDB, not necessarily where the family originated)</span>
        </p>
      )}
      {(p.life_habit || p.motility) && <p className={s.meta}><b>Lifestyle:</b> {[p.life_habit, p.motility].filter(Boolean).join(", ")}</p>}
      {gs.length > 0 && <p className={s.meta}><b>Genera ({fNum(gs.length)})</b> <span className="muted">· unfolded on the timeline; click one to see its profile and fossils</span></p>}

      <Credits ph={ph} silOf={f.family} w={w} />
    </div>
  );
}

/* ---------- genus ---------- */
function GenusProfile({ f, g }: { f: Family; g: Genus }) {
  const { data, dispatch } = useStore();
  const own = g.phylopic?.svg ? g.phylopic : null;
  const sil = own ?? f.phylopic;
  const w = g.wikipedia;
  const steps: Step[] = [
    ...familySteps(f, data),
    ...(g.below ?? []).map((b) => ({ name: b.name, rank: b.rank, sil: stepSil(data.clades[b.name], b.name) })),
    { name: g.genus, rank: "genus", sil: stepSil(own, g.genus) },
  ];
  const back = () => dispatch({ type: "clearGenus" });
  const close = () => dispatch({ type: "select", family: null });

  return (
    <div>
      <button className={s.back} onClick={back}>← {f.family}</button>
      <div className={s.head}>
        <div>
          <h3 className={s.title}><i>{g.genus}</i></h3>
          <p className={s.sub}>
            {[groupOf(f)?.label, f.family, ...(g.below ?? []).map((b) => b.name)].filter(Boolean).join(" › ")}
            {g.attr && <> · named by {g.attr}</>}
          </p>
        </div>
        <button className={s.close} aria-label="Close" onClick={close}>✕</button>
      </div>

      <Silhouette ph={sil} name={g.genus} caption={own ? undefined : sil?.svg ? `${f.family} silhouette` : undefined} />

      <dl className={s.stats}>
        <div><dt>Range</dt><dd>{fRange(g.range_ma)}</dd></div>
        <div><dt>Fossils</dt><dd>{fNum(g.n)}</dd></div>
        <div><dt>Species</dt><dd>{g.species.length ? fNum(g.species.length) : "—"}</dd></div>
      </dl>

      {w?.extract && <p className={s.extract}>{w.extract} <a href={w.url} target="_blank" rel="noopener">Wikipedia →</a></p>}

      <Lineage key={`${f.family}/${g.genus}`} steps={steps} />

      <p className={s.meta}><b>Fossils by continent:</b> {byCount(g.continents).map((c) => `${c} ${fNum(g.continents[c])}`).join(" · ")}</p>

      <div className={s.species}>
        <p className={s.meta}><b>Species</b> <span className="muted">· fossils identified to species level</span></p>
        {g.species.length ? (
          <ul>
            {g.species.map((sp) => (
              <li key={sp.name}>
                <span><i>{sp.name}</i>{sp.attr && <span className="muted"> · {sp.attr}</span>}</span>
                <span className="muted">{fNum(sp.n)} {sp.n === 1 ? "fossil" : "fossils"}</span>
              </li>
            ))}
          </ul>
        ) : <p className={s.meta}><span className="muted">None of its fossils in the PBDB are identified to species level.</span></p>}
      </div>

      <Credits ph={sil} silOf={own ? g.genus : f.family} w={w} />
    </div>
  );
}

/* ---------- shared pieces ---------- */
function Silhouette({ ph, name, caption }: { ph: Phylopic | null | undefined; name: string; caption?: string }) {
  if (!ph?.svg) return <div className={s.noSil}>No PhyloPic silhouette</div>;
  return (
    <figure className={s.figure}>
      <div className={s.silhouette} style={{ ["--src" as string]: `url("${silhouetteUrl(ph.svg)}")` }} role="img" aria-label={`Silhouette of ${name}`} />
      {caption && <figcaption className="muted">{caption}</figcaption>}
    </figure>
  );
}

function Credits({ ph, silOf, w }: { ph: Phylopic | null | undefined; silOf: string; w: Wikipedia | null | undefined }) {
  const { data } = useStore();
  return (
    <p className={s.credits}>
      {ph && (
        <>
          Silhouette{ph.source && ph.source !== silOf ? <> of <i>{ph.source}</i></> : null}: {ph.attribution || "unknown author"} ·{" "}
          <a href={ph.license ?? undefined} target="_blank" rel="noopener">{license(ph.license)}</a> ·{" "}
          <a href={ph.page} target="_blank" rel="noopener">PhyloPic</a><br />
        </>
      )}
      {Object.keys(data.clades).length > 0 && <>Group silhouettes in the ancestry: PhyloPic contributors (hover one for its author and license)<br /></>}
      {w?.extract && <>Text: Wikipedia ({w.lang}) · CC BY-SA 4.0 · </>}Data: Paleobiology Database · CC BY 4.0
    </p>
  );
}
