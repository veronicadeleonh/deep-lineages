/* The time machine's small profile: what was this animal (or family), in a few lines, unfolded under its family in
   the "On the map now" list.
   The full profile lives in the other views; this card only links to it. */
import { useEffect, useRef } from "react";
import { SOCIAL, dietOf, groupOf, socialOf } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, famRecord, fNum, fRange, genusRecord } from "../format";
import { useStore } from "../state";
import s from "./TimeMachine.module.css";

const DIVES = [
  { mode: "timeline", icon: "☰", name: "Timeline", ask: "When did it live?" },
  { mode: "tree", icon: "✺", name: "Family tree", ask: "Who are its relatives?" },
  { mode: "guide", icon: "◎", name: "Field guide", ask: "Where was it found?" },
] as const;

/** First sentence of a Wikipedia summary. */
const firstSentence = (t?: string) => (t ? (t.match(/^.+?[.!?](\s|$)/)?.[0] ?? t).trim() : "");

export function MachineCard({ compact = false }: { compact?: boolean }) {
  const { data, state, dispatch } = useStore();
  const ref = useRef<HTMLElement>(null);
  // the list may scroll: bring the card into view when it opens or changes
  useEffect(() => { ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [state.selected, state.genus]);
  const f = data.families.find((x) => x.family === state.selected);
  if (!f) return null;
  const g = state.genus ? data.genera[f.family]?.genera.find((x) => x.genus === state.genus) : undefined;
  const sil = g?.phylopic?.svg ?? f.phylopic?.svg;
  const diet = dietOf(f), social = socialOf(f);
  const where = byCount(g ? g.continents : f.continents);
  const blurb = firstSentence((g?.wikipedia ?? f.wikipedia)?.extract);
  return (
    <article ref={ref} className={s.mcard} aria-label={g ? g.genus : f.family}>
      <div className={s.mcardHead}>
        {sil && <i className={s.mcardSil} style={{ ["--src" as string]: `url("${silhouetteUrl(sil)}")` }} />}
        <div>
          <h3>{g ? <i>{g.genus}</i> : f.family}</h3>
          <p className={s.mcardSub}>{g ? <>{f.family} · </> : null}{groupOf(f)?.label}</p>
        </div>
      </div>
      <div className={s.mcardTags}>
        <span><i className="swatch" style={{ background: diet.color }} />{diet.label}</span>
        {social && <span>{SOCIAL[social]}</span>}
      </div>
      <dl className={s.mcardFacts}>
        <div><dt>Fossil record</dt><dd>{fRange(g ? genusRecord(g) : famRecord(f))}</dd></div>
        {g
          ? <div><dt>Fossils</dt><dd>{fNum(g.n)}</dd></div>
          : <div><dt>Genera · fossils</dt><dd>{fNum(f.n_genera)} · {fNum(f.n_occurrences)}</dd></div>}
        {where.length > 0 && !compact && <div className={s.mcardWide}><dt>Found in</dt><dd>{where.slice(0, 3).join(", ")}{where.length > 3 ? ` +${where.length - 3}` : ""}</dd></div>}
      </dl>
      {blurb && !compact && <p className={s.mcardBlurb}>{blurb}</p>}
      {/* go deeper, in whichever view: no order implied */}
      <div className={s.mcardDive}>
        <span>Dive deeper</span>
        {DIVES.map((d) => (
          <button key={d.mode} onClick={() => dispatch({ type: "mode", mode: d.mode })} title={d.ask}>
            <i aria-hidden>{d.icon}</i>{d.name}
          </button>
        ))}
      </div>
    </article>
  );
}
