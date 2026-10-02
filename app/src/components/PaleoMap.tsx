/* The world at the cursor's time: reconstructed coastlines (GPlates/PALEOMAP) and the fossils of that time slice. Lives in the timeline deck. */
import { geoEqualEarth, geoGraticule10, geoPath } from "d3";
import { memo, useEffect, useMemo, useState } from "react";
import { dietOf } from "../constants";
import { loadSnapshot, type Snapshot } from "../data";
import { fMa, fNum, round1 } from "../format";
import { useStore } from "../state";
import type { Fossil } from "../types";
import { useTooltip } from "./Tooltip";
import s from "./PaleoMap.module.css";

/** The paleomap inside the timeline deck: the world at the cursor's time, the selection's fossils in color. */
export function DeckMap({ width, height }: { width: number; height: number }) {
  const { data, state } = useStore();
  const snap = data.nearestSnap(state.t);

  // coastlines + reconstructed localities of the current snapshot (cached per snapshot)
  const [shot, setShot] = useState<{ t: number; data: Snapshot } | null>(null);
  useEffect(() => {
    let live = true;
    loadSnapshot(snap, data.paleo).then((d) => live && setShot({ t: snap, data: d }));
    return () => { live = false; };
  }, [snap, data.paleo]);
  const current = shot?.t === snap ? shot.data : null;

  const lo = snap + 5, hi = Math.max(66, snap - 5);
  const { selected, genus } = state;
  const label = genus ?? selected;
  const fam = data.families.find((f) => f.family === selected);
  const nSel = useMemo(
    () => (label ? data.fossils.filter((f) => f.snap === snap && (genus ? f.genus === genus : f.family === selected)).length : 0),
    [data.fossils, snap, genus, selected, label],
  );
  const nAll = useMemo(() => data.fossils.filter((f) => f.snap === snap).length, [data.fossils, snap]);

  return (
    <figure className={s.deck} aria-label={`Paleomap, ${snap} million years ago`}>
      <MapSvg W={width} H={height - 16} snap={snap} snapshot={current} fossils={data.fossils}
        selected={selected} genus={genus} color={fam ? dietOf(fam).color : undefined} />
      <figcaption>
        <b>{snap} Ma</b> · {fNum(nAll)} fossils {lo}–{hi} Ma
        {label && <> · <span className={s.selCount}>{fNum(nSel)} {genus ? <i>{label}</i> : label}</span></>}
        {!current?.coast && " · no paleomap yet"}
      </figcaption>
    </figure>
  );
}

interface MapProps {
  W: number; H: number; snap: number; snapshot: Snapshot | null; fossils: Fossil[];
  selected: string | null; genus: string | null; color?: string;
}

/** Only redraws when the snapshot, size or selection change — not on every cursor move. */
const MapSvg = memo(function MapSvg({ W, H, snap, snapshot, fossils, selected, genus, color }: MapProps) {
  const tip = useTooltip();
  const proj = useMemo(() => geoEqualEarth().fitExtent([[4, 4], [W - 4, H - 4]], { type: "Sphere" }), [W, H]);
  const path = useMemo(() => geoPath(proj), [proj]);
  const isSel = (f: Fossil) => (genus ? f.genus === genus : selected != null && f.family === selected);

  const pts = useMemo(() => {
    const locs = snapshot?.locs;
    return fossils
      .filter((f) => f.snap === snap)
      .map((f) => ({ f, xy: locs ? locs[f.loc] : f.pbdb }))
      .filter((d): d is { f: Fossil; xy: [number, number] } => !!d.xy)
      .map((d) => ({ ...d, p: proj(d.xy) }))
      .filter((d) => d.p)
      .sort((a, b) => Number(isSel(a.f)) - Number(isSel(b.f))); // selected on top
  }, [fossils, snap, snapshot, proj, selected, genus]);

  const lines = snapshot?.coast?.features[0]?.geometry?.type.includes("Line");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <path className={s.sphere} d={path({ type: "Sphere" }) ?? ""} />
      <path className={s.graticule} d={path(geoGraticule10()) ?? ""} />
      <g>{snapshot?.coast?.features.map((ft, i) => <path key={i} className={lines ? s.lines : s.land} d={path(ft) ?? ""} />)}</g>
      <g>
        {pts.map(({ f, p }, i) => {
          const hl = isSel(f);
          return (
            <circle key={i} className={hl ? s.dotHi : s.dot} r={hl ? 4.5 : 2.2} style={hl ? { fill: color } : undefined}
              transform={`translate(${p![0]},${p![1]})`}
              onPointerMove={(e) => tip.show(<><b>{f.genus}</b><br /><span>{f.family ?? "unassigned family"} · {fMa(round1(f.mid))} Ma</span></>, e)}
              onPointerLeave={tip.hide} />
          );
        })}
      </g>
    </svg>
  );
});
