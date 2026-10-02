/* The timeline: 252 Ma (left) to 66 Ma (right), with a draggable cursor, zoom/pan,
   geological stages, and families grouped by lineage that unfold into their genera. */
import {
  area, curveMonotoneX, curveStepAfter, easeCubicOut, interpolate, line, max, scaleLinear, timer, type Timer,
} from "d3";
import { useCallback, useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { DIET, EXTINCTIONS, GROUPS, TIME, dietOf, groupOf, type Group } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, fMa, fMa1, fNum, fRange, isAlive } from "../format";
import { useLatest, useWidth } from "../hooks";
import { MIN_SPAN, clampView, useStore } from "../state";
import type { Family, Genus, Range } from "../types";
import { useTooltip } from "./Tooltip";
import s from "./Timeline.module.css";

const M = { r: 18, t: 26 };
const BAND = 22, STAGE = 18, AREA = 84, GAP = 16, AXIS = 26, HEAD = 26, GROW = 22, SUB = 20;
const FULL_SPAN = TIME[0] - TIME[1];

type Item =
  | { type: "head"; gr: Group | null; y: number }
  | { type: "fam"; f: Family; y: number }
  | { type: "sub"; f: Family; name: string; count: number; y: number }   // subfamily/tribe header inside an unfolded family
  | { type: "genus"; f: Family; gn: Genus; y: number };

export function TimelineCard() {
  const { data, state, dispatch } = useStore();
  const viewRef = useLatest(state.view);
  const anim = useRef<Timer | null>(null);

  /** Animated change of the visible window. */
  const animateTo = useCallback((to: Range) => {
    const target = clampView(to);
    anim.current?.stop();
    const ip = interpolate(viewRef.current, target);
    anim.current = timer((ms) => {
      const k = Math.min(1, ms / 260);
      dispatch({ type: "view", view: ip(easeCubicOut(k)) as Range });
      if (k === 1) anim.current?.stop();
    });
  }, [dispatch, viewRef]);
  useEffect(() => () => anim.current?.stop(), []);

  /** Zoom by a factor around a center time, keeping that point in place. */
  const zoomBy = useCallback((factor: number, center: number, animate = true) => {
    const v = viewRef.current, span = v[0] - v[1];
    const c = Math.min(v[0], Math.max(v[1], center));
    const sp = span * factor, r = (v[0] - c) / span;
    const to: Range = [c + r * sp, c - (1 - r) * sp];
    if (animate) animateTo(to); else dispatch({ type: "view", view: to });
  }, [animateTo, dispatch, viewRef]);

  const fam = data.families.find((f) => f.family === state.selected);
  const fitFamily = () => {
    if (!fam) return;
    const gs = data.genera[fam.family]?.genera ?? [];
    const a = Math.max(fam.range_ma[0], ...gs.map((g) => g.range_ma[0]));
    const b = Math.min(fam.range_ma[1], ...gs.map((g) => g.range_ma[1]));
    const p = (a - b) * 0.08;
    animateTo([a + p, b - p]);
  };
  const span = state.view[0] - state.view[1];
  const usedDiets = new Set(data.families.map((f) => dietOf(f).label));

  return (
    <section className={`card ${s.card}`} aria-label="Timeline">
      <div className="card-head">
        <h2>Dominant families</h2>
        <ul className={s.legend}>
          {Object.values(DIET).filter((d, i, a) => usedDiets.has(d.label) && a.findIndex((x) => x.label === d.label) === i).map((d) => (
            <li key={d.label}><i className="swatch" style={{ background: d.color }} />{d.label}</li>
          ))}
        </ul>
      </div>
      <div className={s.zoomBar}>
        <div className={s.zoom} role="group" aria-label="Timeline zoom">
          <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(2, state.t)} disabled={span >= FULL_SPAN - 0.01}>−</button>
          <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(0.5, state.t)} disabled={span <= MIN_SPAN + 0.01}>+</button>
          <button title="Show all (0)" onClick={() => animateTo(TIME)} disabled={span >= FULL_SPAN - 0.01}>All</button>
          {fam && <button onClick={fitFamily}>Fit {fam.family}</button>}
        </div>
        {span < FULL_SPAN - 0.1 && <span className="muted" data-testid="zoom-level">{fMa1(state.view[0])}–{fMa1(state.view[1])} Ma</span>}
        <span className={s.zoomHint}>⌘/Ctrl + scroll or pinch to zoom · swipe sideways to pan · click a period or stage to zoom in</span>
      </div>
      <Timeline animateTo={animateTo} zoomBy={zoomBy} />
      <p className="note">
        Bars: each family's range in the PBDB (periods holding ≥5% of its fossils). Area: genera on record (first → last
        appearance), excluding footprints and eggs.
      </p>
    </section>
  );
}

function Timeline({ animateTo, zoomBy }: { animateTo: (to: Range) => void; zoomBy: (f: number, c: number, animate?: boolean) => void }) {
  const { data, state, dispatch } = useStore();
  const tip = useTooltip();
  const wrap = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const W = useWidth(wrap);
  const clip = useId().replace(/:/g, "");
  const { t, view, selected, genus, expanded } = state;
  const span = view[0] - view[1];

  /* ---------- layout ---------- */
  const compact = W < 600;
  const ROW = compact ? 26 : 32;
  const SIL = compact ? { w: 34, h: 20 } : { w: 48, h: 26 };
  const nameX = SIL.w + 8;
  const L = nameX + (compact ? 128 : 150) + 12; // left edge of the plot
  const stageTop = M.t + BAND, areaTop = stageTop + STAGE, rowsTop = areaTop + AREA + GAP;

  // rows: lineage header → families (by first appearance) → genera when unfolded
  const { items, H } = useMemo(() => {
    const items: Item[] = [];
    let y = rowsTop;
    [...GROUPS, null].forEach((gr) => {
      const fs = data.families.filter((f) => (groupOf(f) ?? null) === gr)
        .sort((a, b) => b.range_ma[0] - a.range_ma[0] || b.range_ma[1] - a.range_ma[1]);
      if (!fs.length) return;
      items.push({ type: "head", gr, y }); y += HEAD;
      fs.forEach((f) => {
        items.push({ type: "fam", f, y }); y += ROW;
        if (expanded.includes(f.family)) {
          const fg = data.genera[f.family];
          const gs = fg?.genera ?? [];
          const groups = fg?.groups ?? [];
          if (groups.length) {
            // genera grouped by subfamily/tribe (groups in order of first appearance), unplaced genera last
            [...groups, null].forEach((name) => {
              const members = gs.filter((g) => (g.group ?? null) === name);
              if (!members.length) return;
              items.push({ type: "sub", f, name: name ?? "Not placed in a subfamily", count: members.length, y }); y += SUB;
              members.forEach((gn) => { items.push({ type: "genus", f, gn, y }); y += GROW; });
            });
          } else {
            gs.forEach((gn) => { items.push({ type: "genus", f, gn, y }); y += GROW; });
          }
          y += 6;
        }
      });
    });
    return { items, H: y + AXIS };
  }, [data, expanded, rowsTop, ROW]);

  const x = useMemo(() => scaleLinear().domain(view).range([L, W - M.r]), [view, L, W]);
  const yDiv = useMemo(
    () => scaleLinear().domain([0, max(data.diversity, (d) => d.genera) ?? 1]).nice().range([areaTop + AREA, areaTop + 8]),
    [data.diversity, areaTop],
  );
  const vis = (a: number, b: number) => a > view[1] && b < view[0]; // is [a (older), b (younger)] in view?
  const X = (v: number) => Math.max(L - 2, Math.min(W - M.r + 2, x(v)));
  const curve = span < 40 ? curveStepAfter : curveMonotoneX;
  const areaPath = area<{ ma: number; genera: number }>().x((d) => x(d.ma)).y0(yDiv(0)).y1((d) => yDiv(d.genera)).curve(curve)(data.diversity) ?? "";
  const linePath = line<{ ma: number; genera: number }>().x((d) => x(d.ma)).y((d) => yDiv(d.genera)).curve(curve)(data.diversity) ?? "";

  /* ---------- interaction ---------- */
  const latest = useLatest({ x, L, W, view });
  const toT = (clientX: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    return x.invert(Math.max(L, Math.min(W - M.r, px)));
  };
  const dragging = useRef(false);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-stop]")) return; // rows and zoomable labels handle their own clicks
    const r = svgRef.current!.getBoundingClientRect();
    if (((e.clientX - r.left) / r.width) * W < L - 4) return;
    dragging.current = true;
    svgRef.current!.setPointerCapture(e.pointerId);
    tip.hide();
    dispatch({ type: "time", t: toT(e.clientX) });
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => { if (dragging.current) dispatch({ type: "time", t: toT(e.clientX) }); };
  const onPointerUp = () => { dragging.current = false; };

  // Ctrl/⌘ + wheel (or trackpad pinch) = zoom; horizontal wheel or Shift + wheel = pan
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { x, L, W, view } = latest.current;
      const r = el.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomBy(Math.exp(e.deltaY * 0.004), x.invert(Math.max(L, px)), false);
      } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
        const sp = view[0] - view[1];
        if (sp >= FULL_SPAN - 0.01) return;
        e.preventDefault();
        const d = ((e.shiftKey ? e.deltaY : e.deltaX) / (x.range()[1] - x.range()[0])) * sp;
        dispatch({ type: "view", view: [view[0] - d, view[1] - d] });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [dispatch, latest, zoomBy]);

  const onKeyDown = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 1;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => dispatch({ type: "time", t: t + step }),
      ArrowRight: () => dispatch({ type: "time", t: t - step }),
      "+": () => zoomBy(0.5, t), "=": () => zoomBy(0.5, t),
      "-": () => zoomBy(2, t), _: () => zoomBy(2, t),
      "0": () => animateTo(TIME),
      Escape: () => selected && dispatch({ type: "select", family: null }),
    };
    if (keys[e.key]) { keys[e.key](); e.preventDefault(); }
  };
  const zoomTo = (a: number, b: number) => { const p = (a - b) * 0.04; animateTo([a + p, b - p]); };

  /* ---------- tooltips ---------- */
  const famTip = (f: Family) => (
    <>
      {f.phylopic?.svg && <img className="sil" src={silhouetteUrl(f.phylopic.svg)} alt="" />}
      <b>{f.family}</b><br />
      <span>{fRange(f.range_ma)} · {fNum(f.n_genera)} genera · {dietOf(f).label.toLowerCase()}</span><br />
      <span>{expanded.includes(f.family) ? "Click to fold" : "Click to unfold its genera"}</span>
    </>
  );
  const genusTip = (f: Family, gn: Genus) => (
    <>
      {gn.phylopic?.svg && <img className="sil" src={silhouetteUrl(gn.phylopic.svg)} alt="" />}
      <b><i>{gn.genus}</i></b> <span>· {gn.group ?? f.family}</span><br />
      <span>{fRange(gn.range_ma)} · {fNum(gn.n)} fossils</span><br />
      <span>{byCount(gn.continents).map((c) => `${c} ${fNum(gn.continents[c])}`).join(" · ")}</span><br />
      <span>{gn.species.length ? gn.species.map((sp, i) => <i key={sp.name}>{i ? ", " : ""}{sp.name}</i>) : "species undetermined"}</span><br />
      <span>Click to see its profile</span>
    </>
  );

  /* ---------- cursor ---------- */
  const inView = t <= view[0] && t >= view[1];
  const cx = x(t);
  const cursorLabel = `${fMa(t)} Ma`;
  const cw = cursorLabel.length * 6.6 + 12;
  const hx = Math.max(L - 10 + cw / 2, Math.min(W - M.r + 10 - cw / 2, cx));
  const divNow = data.diversity.find((d) => d.ma === Math.round(t))?.genera ?? 0;
  const nearRight = cx > W - M.r - 80;

  const ticks = x.ticks(compact ? 3 : 8);
  const fmtTick = span < 12 ? fMa1 : fMa;

  return (
    <div
      ref={wrap} className={s.timeline} tabIndex={0} role="slider" onKeyDown={onKeyDown}
      aria-label="Time in millions of years" aria-valuenow={t} aria-valuemin={TIME[1]} aria-valuemax={TIME[0]}
      aria-valuetext={`${fMa(t)} million years ago`}
    >
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width={W} height={H}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <defs><clipPath id={clip}><rect x={L} y={0} width={W - M.r - L} height={H} /></clipPath></defs>

        <g clipPath={`url(#${clip})`}>
          {/* period bands (full height) */}
          {data.periods.filter((p) => vis(p.start, p.end)).map((p) => {
            const i = data.periods.indexOf(p);
            const x0 = X(p.start), x1 = X(p.end), w = x1 - x0;
            const short = `${p.name[0]}. ${p.name.split(" ")[1]}`;
            const label = w > 84 ? p.name : w > 40 ? short : w > 22 ? short.replace(". ", ".").slice(0, 3) : "";
            return (
              <g key={p.name}>
                <rect className={i % 2 ? s.bandAlt : s.band} x={x0} width={w} y={M.t} height={H - M.t - AXIS} />
                <text className={`${s.periodLabel} ${s.zoomable}`} x={(x0 + x1) / 2} y={M.t + 15} textAnchor="middle"
                  data-stop onPointerDown={() => zoomTo(p.start, p.end)}>
                  {label}<title>{`${p.name} · ${fRange([p.start, p.end])} · click to zoom in`}</title>
                </text>
              </g>
            );
          })}
          {/* stages */}
          {data.stages.filter((st) => vis(st.start, st.end)).map((st) => {
            const x0 = X(st.start), x1 = X(st.end), w = x1 - x0;
            const label = w > st.name.length * 6.2 + 8 ? st.name : w > 30 ? `${st.name.slice(0, Math.floor((w - 8) / 6.2))}.` : "";
            return (
              <g key={st.name}>
                <rect className={`${s.stage} ${s.zoomable}`} x={x0 + 0.5} width={Math.max(0, w - 1)} y={stageTop + 1} height={STAGE - 3} rx={3}
                  data-stop onPointerDown={() => zoomTo(st.start, st.end)}>
                  <title>{`${st.name} · ${fRange([st.start, st.end])} · click to zoom in`}</title>
                </rect>
                {label && <text className={s.stageLabel} x={(x0 + x1) / 2} y={stageTop + 11.5} textAnchor="middle">{label}</text>}
              </g>
            );
          })}
          {/* diversity */}
          <path className={s.area} d={areaPath} />
          <path className={s.areaLine} d={linePath} />
        </g>

        {/* diversity axis */}
        {yDiv.ticks(3).slice(1).map((v) => <line key={v} className={s.grid} x1={L} x2={W - M.r} y1={yDiv(v)} y2={yDiv(v)} />)}
        {yDiv.ticks(3).map((v) => <text key={v} className={s.axisText} x={L - 6} y={yDiv(v)} textAnchor="end" dominantBaseline="middle">{fNum(v)}</text>)}
        <text className={s.periodLabel} x={L - (compact ? 34 : 40)} y={areaTop + AREA / 2} textAnchor="end" dominantBaseline="middle">Genera</text>
        {!compact && <text className={s.periodLabel} x={L - 8} y={stageTop + 11.5} textAnchor="end">Stages</text>}

        {/* rows */}
        {items.map((it) => {
          if (it.type === "head") return (
            <g key={`h-${it.gr?.key}`} transform={`translate(0,${it.y})`} className={s.groupHead}>
              <text x={0} y={HEAD - 8}>
                <tspan>{it.gr?.label ?? "Other"}</tspan>
                {it.gr && !compact && <tspan className={s.groupHint} dx={8}>{`${it.gr.clade.toLowerCase()} · ${it.gr.hint}`}</tspan>}
              </text>
              <line x1={0} x2={W - M.r} y1={HEAD - 2} y2={HEAD - 2} />
            </g>
          );
          if (it.type === "sub") return (
            <g key={`${it.f.family}//${it.name}`} transform={`translate(0,${it.y})`} className={s.subHead}>
              <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={SUB} />
              <text x={nameX + 16} y={SUB - 6}>{it.name} <tspan className={s.subCount}>· {it.count}</tspan></text>
            </g>
          );
          if (it.type === "fam") {
            const f = it.f, on = isAlive(f.range_ma, t), sel = f.family === selected;
            const hasGenera = !!data.genera[f.family]?.genera.length;
            return (
              <g key={f.family} transform={`translate(0,${it.y})`} className={s.row} data-stop data-family={f.family}
                onPointerDown={() => { tip.hide(); dispatch({ type: "toggleFamily", family: f.family }); }}
                onPointerMove={(e) => tip.show(famTip(f), e)} onPointerLeave={tip.hide}>
                <rect className={`${s.hit} ${sel && !genus ? s.hitSel : ""}`} x={0} width={W - M.r} height={ROW} rx={4} />
                {f.phylopic?.svg && (
                  <image className={`sil ${s.rowSil} ${!on && !sel ? s.dim : ""}`} href={silhouetteUrl(f.phylopic.svg)}
                    x={0} y={(ROW - SIL.h) / 2} width={SIL.w} height={SIL.h} preserveAspectRatio="xMidYMid meet" />
                )}
                <text className={s.chev} x={nameX} y={ROW / 2} dominantBaseline="central">
                  {hasGenera ? (expanded.includes(f.family) ? "▾" : "▸") : ""}
                </text>
                <text className={`${s.rowLabel} ${!on ? s.labelDim : ""} ${sel ? s.labelSel : ""}`} x={nameX + 12} y={ROW / 2}
                  dominantBaseline="central" style={compact ? { fontSize: 11 } : undefined}>{f.family}</text>
                {vis(f.range_ma[0], f.range_ma[1]) && (
                  <rect className={`${s.bar} ${!on && !sel ? s.barDim : ""}`} clipPath={`url(#${clip})`}
                    x={x(f.range_ma[0])} width={Math.max(4, x(f.range_ma[1]) - x(f.range_ma[0]))}
                    y={(ROW - 12) / 2} height={12} rx={4} fill={dietOf(f).color} />
                )}
              </g>
            );
          }
          const { f, gn } = it, on = isAlive(gn.range_ma, t), sel = gn.genus === genus && f.family === selected;
          return (
            <g key={`${f.family}/${gn.genus}`} transform={`translate(0,${it.y})`} className={s.row} data-stop data-genus={gn.genus}
              onPointerDown={() => { tip.hide(); dispatch({ type: "genus", family: f.family, genus: gn.genus }); }}
              onPointerMove={(e) => tip.show(genusTip(f, gn), e)} onPointerLeave={tip.hide}>
              <rect className={`${s.hit} ${sel ? s.hitSel : ""}`} x={nameX} width={W - M.r - nameX} height={GROW} rx={4} />
              <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={GROW} />
              <text className={`${s.genusLabel} ${on ? s.genusAlive : ""} ${sel ? s.labelSel : ""}`} x={nameX + 16} y={GROW / 2} dominantBaseline="central">{gn.genus}</text>
              {!compact && <text className={s.genusN} x={L - 8} y={GROW / 2} dominantBaseline="central" textAnchor="end">{fNum(gn.n)}</text>}
              {vis(gn.range_ma[0], gn.range_ma[1]) && (
                <rect className={`${s.gbar} ${!on ? s.barDim : ""}`} clipPath={`url(#${clip})`}
                  x={x(gn.range_ma[0])} width={Math.max(3, x(gn.range_ma[1]) - x(gn.range_ma[0]))}
                  y={(GROW - 7) / 2} height={7} rx={3.5} fill={dietOf(f).color} />
              )}
            </g>
          );
        })}

        {/* extinctions */}
        <g clipPath={`url(#${clip})`} className={s.extinction}>
          {EXTINCTIONS.filter((e) => e.ma <= view[0] && e.ma >= view[1]).map((e) => (
            <g key={e.ma}>
              <line x1={x(e.ma)} x2={x(e.ma)} y1={areaTop} y2={H - AXIS} />
              <text x={x(e.ma) - 5} y={areaTop + AREA - 6} textAnchor="end">{compact ? e.short : e.label}</text>
            </g>
          ))}
        </g>

        {/* bottom axis: ticks adapt to the zoom */}
        <g transform={`translate(0,${H - AXIS + 4})`}>
          <line className={s.axisLine} x1={L} x2={W - M.r} />
          {ticks.map((v) => (
            <g key={v} transform={`translate(${x(v)},0)`}>
              <line className={s.axisLine} y2={4} />
              <text className={s.axisText} y={16} textAnchor="middle">{fmtTick(v)} Ma</text>
            </g>
          ))}
        </g>

        {/* cursor */}
        {inView && (
          <g pointerEvents="none">
            <line className={s.cursorLine} x1={cx} x2={cx} y1={M.t - 4} y2={H - AXIS} />
            <rect className={s.cursorHandle} x={hx - cw / 2} width={cw} y={M.t - 24} height={20} rx={5} />
            <text className={s.cursorLabel} x={hx} y={M.t - 10} textAnchor="middle">{cursorLabel}</text>
            <text className={s.cursorCount} x={cx + (nearRight ? -6 : 6)} y={yDiv(divNow) - 6} textAnchor={nearRight ? "end" : "start"}>
              {fNum(divNow)} genera
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
