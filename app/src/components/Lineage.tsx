/* "Where it comes from": the ancestry as a connected line, from the oldest, widest group down to this family or genus. */
import { useState } from "react";
import { CLADE_NOTES } from "../constants";
import { silhouetteUrl } from "../data";
import { WELL_KNOWN } from "../tree";
import s from "./Lineage.module.css";

export interface Step {
  name: string;
  rank?: string;
  sil?: { svg: string; credit: string } | null; // small illustration of the group
}

export function Lineage({ steps }: { steps: Step[] }) {
  const [all, setAll] = useState(false);
  if (!steps.length) return null;
  const last = steps.length - 1;
  // always shown: the first step, the well-known groups, the ranked ones (family and below) and the last three; the rest fold into "+N groups"
  const keep = (i: number) => all || i === 0 || i >= last - 2 || !!steps[i].rank || WELL_KNOWN.has(steps[i].name);
  const items: (Step & { i: number } | { gap: number; i: number })[] = [];
  for (let i = 0; i <= last; i++) {
    if (keep(i)) { items.push({ ...steps[i], i }); continue; }
    let j = i;
    while (j + 1 <= last && !keep(j + 1)) j++;
    if (j === i) items.push({ ...steps[i], i });           // a single hidden step is not worth a button
    else items.push({ gap: j - i + 1, i });
    i = j;
  }

  return (
    <div className={s.wrap}>
      <p className={s.head}>
        <b>Where it comes from</b> <span className="muted">· each group sits inside the one above it</span>
        {steps.length > 6 && <button className={s.toggle} onClick={() => setAll(!all)}>{all ? "Fewer steps" : `All ${steps.length} steps`}</button>}
      </p>
      <ol className={s.line}>
        {items.map((it) => "gap" in it ? (
          <li key={`gap-${it.i}`} className={`${s.step} ${s.gap}`}>
            <button className={s.more} onClick={() => setAll(true)}>+ {it.gap} more groups</button>
          </li>
        ) : (
          <li key={it.name} className={[s.step, WELL_KNOWN.has(it.name) && s.landmark, it.i === last && s.current].filter(Boolean).join(" ")}>
            {it.sil && <span className={`${s.sil} ${it.i === last ? s.silCurrent : ""}`} title={it.sil.credit}
              style={{ ["--src" as string]: `url("${silhouetteUrl(it.sil.svg)}")` }} role="img" aria-label={`Silhouette for ${it.name}`} />}
            <span className={s.name}>{it.rank === "genus" ? <i>{it.name}</i> : it.name}</span>
            {it.rank && <span className={s.rank}>{it.rank}</span>}
            {CLADE_NOTES[it.name] && <span className={s.note}>{CLADE_NOTES[it.name]}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}
