/* The time machine's map. Time flows continuously here: the map shows the reconstruction nearest to the current time
   and crossfades briefly to the next one (blending two at once drew every coastline twice), and each fossil fades in and out around its own
   age. Every dot can be clicked to open the genus it belongs to. */
import { geoEqualEarth, geoGraticule10, geoPath } from "d3";
import { useEffect, useMemo, useRef, useState } from "react";
import { dietOf } from "../constants";
import { loadSnapshot, silhouetteUrl, type Snapshot } from "../data";
import { fMa, round1 } from "../format";
import { useStore } from "../state";
import { EVENT_SPAN, chapterAt } from "../story";
import type { Fossil } from "../types";
import { useTooltip } from "./Tooltip";
import s from "./TimeMachine.module.css";

export const FOSSIL_WINDOW = 5; // Myr on each side of the current time

export function MachineMap({ W, H }: { W: number; H: number }) {
  const { data, state, dispatch } = useStore();
  const tip = useTooltip();
  const t = state.t;

  // the reconstructions just older (a) and just younger (b) than t, and how far t is between them
  const times = useMemo(() => [...data.times].sort((x, y) => y - x), [data.times]);
  const a = times.filter((x) => x >= t).at(-1) ?? times[0];
  const b = times.find((x) => x <= t) ?? times.at(-1)!;
  const f = a === b ? 0 : (a - t) / (a - b);

  // snapshots, loaded around the current time (and the next ones ahead, so playback never waits)
  const [snaps, setSnaps] = useState<Record<number, Snapshot>>({});
  useEffect(() => {
    const want = times.filter((x) => x <= a + 10 && x >= b - 20);
    for (const x of want) if (!snaps[x]) loadSnapshot(x, data.paleo).then((sn) => setSnaps((p) => (p[x] ? p : { ...p, [x]: sn })));
  }, [a, b, times, data.paleo, snaps]);

  const proj = useMemo(() => geoEqualEarth().fitExtent([[6, 6], [W - 6, H - 6]], { type: "Sphere" }), [W, H]);
  const path = useMemo(() => geoPath(proj), [proj]);

  // coastline paths, computed once per snapshot and size
  const coastCache = useRef(new Map<string, string[]>());
  const coast = (x: number) => {
    const key = `${x}-${W}-${H}`, sn = snaps[x];
    if (!sn?.coast) return null;
    let d = coastCache.current.get(key);
    if (!d) { d = sn.coast.features.map((ft) => path(ft) ?? ""); coastCache.current.set(key, d); }
    return d;
  };
  const lines = snaps[a]?.coast?.features[0]?.geometry?.type.includes("Line");

  // where each fossil sits (at the reconstruction of its own slice), projected once per snapshot set and size
  const pos = useMemo(() => {
    const m = new Map<Fossil, [number, number]>();
    for (const fo of data.fossils) {
      const xy = snaps[fo.snap]?.locs?.[fo.loc] ?? fo.pbdb;
      const p = xy ? proj(xy) : null;
      if (p) m.set(fo, p as [number, number]);
    }
    return m;
  }, [data.fossils, snaps, proj]);

  const fam = data.families.find((x) => x.family === state.selected);
  const isSel = (fo: Fossil) => (state.genus ? fo.genus === state.genus : state.selected != null && fo.family === state.selected);
  const visible = data.fossils
    .filter((fo) => Math.abs(fo.mid - t) < FOSSIL_WINDOW && pos.has(fo))
    .sort((p, q) => Number(isSel(p)) - Number(isSel(q))); // selected on top

  // the family's silhouette, for the tooltip
  const silOf = (fo: Fossil) => (fo.family ? data.families.find((x) => x.family === fo.family)?.phylopic?.svg : null) ?? null;

  const open = (fo: Fossil) => {
    tip.hide();
    const family = fo.family && data.families.find((x) => x.family === fo.family);
    if (!family) return;
    const hasGenus = data.genera[family.family]?.genera.some((g) => g.genus === fo.genus);
    dispatch(hasGenus ? { type: "genus", family: family.family, genus: fo.genus } : { type: "select", family: family.family });
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className={s.map}>
      <path className={s.sphere} d={path({ type: "Sphere" }) ?? ""} />
      <path className={s.graticule} d={path(geoGraticule10()) ?? ""} />
      {/* one reconstruction at a time, the nearest to t; when it changes, a short crossfade (no permanent double outline) */}
      {[{ x: a, o: f < 0.5 ? 1 : 0 }, ...(a !== b ? [{ x: b, o: f < 0.5 ? 0 : 1 }] : [])].map(({ x, o }) => (
        <g key={x} className={s.snap} style={{ opacity: o }}>{coast(x)?.map((d, i) => <path key={i} className={lines ? s.lines : s.land} d={d} />)}</g>
      ))}
      {/* the chapter's events: an impact, an eruption, pulsing where it happened */}
      {t >= chapterAt(t).t - EVENT_SPAN && chapterAt(t).events?.map((ev) => {
        const p = proj([ev.lon, ev.lat]);
        if (!p) return null;
        const left = p[0] > W - 200; // keep the label inside the map
        return (
          <g key={ev.name} transform={`translate(${p[0]},${p[1]})`} className={s.event}>
            <circle r={7} className={s.eventPulse} />
            <circle r={7} className={s.eventPulse} style={{ animationDelay: ".9s" }} />
            <circle r={5} className={s.eventCore} />
            <text x={left ? -12 : 12} y={4} textAnchor={left ? "end" : "start"} className={s.eventLabel}>{ev.name}</text>
          </g>
        );
      })}
      <g>
        {visible.map((fo, i) => {
          const [px, py] = pos.get(fo)!;
          const hl = isSel(fo), known = !!fo.family && data.families.some((x) => x.family === fo.family);
          const o = Math.max(0.15, 1 - Math.abs(fo.mid - t) / FOSSIL_WINDOW); // strongest at its own age
          return (
            <g key={i} transform={`translate(${px},${py})`} className={known ? s.fossil : s.fossilOther}
              onClick={() => open(fo)}
              onPointerMove={(e) => tip.show(
                <>{silOf(fo) && <i className={s.tipSil} style={{ ["--src" as string]: `url("${silhouetteUrl(silOf(fo)!)}")` }} />}<b><i>{fo.genus}</i></b><br /><span>{fo.family ?? "family unknown"} · {fMa(round1(fo.mid))} Ma</span>{known && <><br /><span>Click to open</span></>}</>, e)}
              onPointerLeave={tip.hide}>
              <circle r={9} className={s.fossilHit} />
              <circle r={hl ? 5.5 : 3} className={hl ? s.dotSel : s.dot} style={{ opacity: hl ? 1 : o, ...(hl && fam ? { fill: dietOf(fam).color } : {}) }} />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
