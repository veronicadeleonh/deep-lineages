/* The timeline: 252 Ma (left) to 66 Ma (right), with a draggable cursor, zoom/pan, geological stages,
   and families grouped by lineage, ordered and connected as a time-calibrated family tree.
   Zooming in reveals detail: families that fill the window unfold into their genera (themselves
   connected by subfamily), and closer still each genus shows its species. */
import {
  area, curveMonotoneX, curveStepAfter, easeCubicOut, interpolate, line, max, scaleLinear, timer, type Timer,
} from "d3";
import { useCallback, useEffect, useId, useMemo, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DIET, EXTINCTIONS, GROUPS, TIME, dietOf, groupOf, type Group } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, fMa, fMa1, fNum, fRange, isAlive } from "../format";
import { useLatest, useWidth } from "../hooks";
import { MIN_SPAN, clampView, useStore } from "../state";
import { WELL_KNOWN, familyTree, genusTree, layout, leaves, pathTo, prune, type TNode } from "../tree";
import type { Family, Genus, Range } from "../types";
import { DeckMap } from "./PaleoMap";
import { useTooltip } from "./Tooltip";
import s from "./Timeline.module.css";

const M = { r: 18, t: 26 };
const BAND = 22, STAGE = 18, AREA = 84, GAP = 16, AXIS = 26, HEAD = 14, GROW = 22, SUB = 20, MORE = 18;
export const AUTO_SPAN = 45;    // at or below this many Myr on screen, families that fill the window unfold by themselves
const AUTO_MAX = 3;      // …but no more than this many at once, to keep the page readable
export const SPECIES_SPAN = 15; // at or below this, genera show their species
const FULL_SPAN = TIME[0] - TIME[1];

type Item =
  | { type: "head"; gr: Group | null; y: number }
  | { type: "fam"; f: Family; y: number }
  | { type: "sub"; f: Family; name: string; count: number; y: number }   // subfamily/tribe header inside an unfolded family
  | { type: "genus"; f: Family; gn: Genus; y: number }
  | { type: "more"; f: Family; count: number; y: number };                // genera of an open family outside the window

/** A tree to draw over the rows: families of one lineage, or the visible genera of an open family. */
interface Tree { root: TNode; f?: Family; famY?: number }

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
      <Timeline animateTo={animateTo} zoomBy={zoomBy} deckTop={
        <div className={s.zoomBar}>
          <div className={s.zoom} role="group" aria-label="Timeline zoom">
            <button aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomBy(2, state.t)} disabled={span >= FULL_SPAN - 0.01}>−</button>
            <button aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomBy(0.5, state.t)} disabled={span <= MIN_SPAN + 0.01}>+</button>
            <button title="Show all (0)" onClick={() => animateTo(TIME)} disabled={span >= FULL_SPAN - 0.01}>All</button>
            {fam && <button onClick={fitFamily}>Fit {fam.family}</button>}
          </div>
          {span < FULL_SPAN - 0.1 && <span className="muted" data-testid="zoom-level">{fMa1(state.view[0])}–{fMa1(state.view[1])} Ma</span>}
          <span className={s.zoomHint}>
            {span > AUTO_SPAN ? "Pinch or ⌘/Ctrl + scroll to zoom: families open into their genera below 45 Myr, species below 15"
              : span > SPECIES_SPAN ? "Zoom in further to see each genus's species" : "Species shown next to each genus"} · swipe sideways to pan
          </span>
          <ul className={s.legend}>
            {Object.values(DIET).filter((d, i, a) => usedDiets.has(d.label) && a.findIndex((x) => x.label === d.label) === i).map((d) => (
              <li key={d.label}><i className="swatch" style={{ background: d.color }} />{d.label}</li>
            ))}
          </ul>
        </div>
      } />
      <p className="note">
        Bars: each family's range in the PBDB (periods holding ≥5% of its fossils). Branches: each split is drawn just before
        the oldest fossil of its group (a minimum age); dotted where a lineage must have existed but has no fossils yet.
        Area: genera on record (first → last appearance), excluding footprints and eggs. Map: each dot is a fossil from the
        10-Myr slice around the cursor, placed where that spot was at the time; continents are present-day coastlines moved to
        their past position ({data.paleo?.model ?? "PALEOMAP"} model, GPlates), so inland seas of the time are not shown.
      </p>
    </section>
  );
}

function Timeline({ animateTo, zoomBy, deckTop }: { animateTo: (to: Range) => void; zoomBy: (f: number, c: number, animate?: boolean) => void; deckTop: ReactNode }) {
  const { data, state, dispatch } = useStore();
  const tip = useTooltip();
  const wrap = useRef<HTMLDivElement>(null);
  const W = useWidth(wrap);
  const clip = useId().replace(/:/g, "");
  const { t, view, selected, genus, expanded } = state;
  const span = view[0] - view[1];

  /* ---------- layout ---------- */
  const compact = W < 600;
  const ROW = compact ? 26 : 32;
  const SIL = compact ? { w: 34, h: 20 } : { w: 48, h: 26 };
  const GUT = compact ? 18 : 22; // left gutter for the vertical lineage labels
  const nameX = GUT + SIL.w + 8;
  // left edge of the plot; on wide screens the column is wider, to give the paleomap in the deck room
  const L = compact ? nameX + 140 : Math.max(nameX + 162, Math.min(380, Math.round(W * 0.27)));
  const stageTop = M.t + BAND, areaTop = stageTop + STAGE, rowsTop = areaTop + AREA + GAP;

  // which families are unfolded: the ones the user opened, plus (when zoomed in) the ones filling the window
  const famTree = useMemo(() => familyTree(data), [data]);
  const open = useMemo(() => {
    const set = new Set(expanded);
    if (span <= AUTO_SPAN) {
      // the families that fill the window, richest in genera there first; at most AUTO_MAX open by themselves
      const inView = (r: Range) => r[0] > view[1] && r[1] < view[0];
      data.families
        .filter((f) => {
          if (state.collapsed.includes(f.family) || !data.genera[f.family]?.genera.length) return false;
          const overlap = Math.min(f.range_ma[0], view[0]) - Math.max(f.range_ma[1], view[1]);
          return overlap >= 0.35 * span || (overlap > 0 && overlap >= 0.8 * (f.range_ma[0] - f.range_ma[1]));
        })
        .map((f) => ({ f, n: data.genera[f.family].genera.filter((g) => inView(g.range_ma)).length }))
        .filter((c) => c.n > 0)
        .sort((a, b) => b.n - a.n)
        .slice(0, AUTO_MAX)
        .forEach((c) => set.add(c.f.family));
    }
    return set;
  }, [data, expanded, state.collapsed, view, span]);

  // rows: per lineage, families in family-tree order; an open family lists its genera in the window, by subfamily
  const { items, spans, trees, H } = useMemo(() => {
    const items: Item[] = [], trees: Tree[] = [];
    let y = rowsTop;
    const inView = (g: Genus) => g.range_ma[0] > view[1] && g.range_ma[1] < view[0];
    [...GROUPS, null].forEach((gr) => {
      const sub = prune(famTree, (l) => !!l.family && (groupOf(l.family) ?? null) === gr);
      if (!sub) return;
      const { root } = layout(sub);
      trees.push({ root });
      items.push({ type: "head", gr, y }); y += HEAD;
      for (const lf of leaves(root)) {
        const f = lf.family!;
        items.push({ type: "fam", f, y }); y += ROW;
        if (!open.has(f.family)) continue;
        const famY = y - ROW / 2;
        const all = data.genera[f.family]?.genera ?? [];
        const gt = prune(genusTree(f, data), (l) => !!l.genus && inView(l.genus));
        const shown = gt ? leaves(gt).length : 0;
        if (gt) {
          const { root: g } = layout(gt);
          // the family node may have been merged into its only group; then that group is the whole list
          const top = g.name === f.family ? g.children : [g];
          const groups = top.filter((c) => c.children.length), direct = top.filter((c) => !c.children.length);
          const hasGroups = (data.genera[f.family]?.groups ?? []).length > 0;
          groups.forEach((c) => {
            const ls = leaves(c);
            items.push({ type: "sub", f, name: c.name, count: ls.length, y }); y += SUB;
            ls.forEach((l) => { items.push({ type: "genus", f, gn: l.genus!, y }); y += GROW; });
          });
          if (direct.length && hasGroups) { items.push({ type: "sub", f, name: "Not placed in a subfamily", count: direct.length, y }); y += SUB; }
          direct.forEach((l) => { items.push({ type: "genus", f, gn: l.genus!, y }); y += GROW; });
          trees.push({ root: g, f, famY });
        }
        if (all.length > shown) { items.push({ type: "more", f, count: all.length - shown, y }); y += MORE; }
        y += 6;
      }
    });
    // vertical extent of each lineage, for its label in the gutter
    const heads = items.filter((i) => i.type === "head");
    const spans = heads.map((h, k) => ({ gr: (h as { gr: Group | null }).gr, y0: h.y + HEAD, y1: k + 1 < heads.length ? heads[k + 1].y : y }));
    return { items, spans, trees, H: y + AXIS };
  }, [data, famTree, open, view, rowsTop, ROW]);

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

  /* ---------- family tree over the rows ---------- */
  const showSpecies = span <= SPECIES_SPAN;
  const branches = useMemo(() => {
    const rowY = new Map<string, number>(); // "family" or "family/genus" -> row center
    const bars: { y: number; a: number; b: number; h: number }[] = [];
    for (const it of items) {
      if (it.type === "fam") {
        rowY.set(it.f.family, it.y + ROW / 2);
        bars.push({ y: it.y + ROW / 2, a: x(it.f.range_ma[0]), b: x(it.f.range_ma[1]), h: 7 });
      } else if (it.type === "genus") {
        rowY.set(`${it.f.family}/${it.gn.genus}`, it.y + GROW / 2);
        const end = x(it.gn.range_ma[1]) + (showSpecies && it.gn.species.length ? 120 : 0); // room for the species names
        bars.push({ y: it.y + GROW / 2, a: x(it.gn.range_ma[0]), b: end, h: 5 });
      }
    }
    const lines: { x1: number; y1: number; x2: number; y2: number; hot: boolean; ghost?: boolean }[] = [];
    const nodes: { n: TNode; x: number; y: number; hot: boolean; depth: number }[] = [];
    const track: TNode[] = []; // ancestors of the selection, oldest first
    for (const tr of trees) {
      const target = tr.f ? (tr.f.family === selected ? genus : null) : selected;
      const path = target ? pathTo(tr.root, target) : [];
      track.push(...path.slice(0, -1)); // for a genus, this continues through its family, subfamily and tribe
      const hot = new Set<TNode>();
      const leafY = (l: TNode) => rowY.get(tr.f ? `${tr.f.family}/${l.name}` : l.name) ?? 0;
      const walk = (n: TNode, px: number, depth: number): number => {
        if (!n.children.length) {
          const yy = leafY(n);
          lines.push({ x1: px, x2: x(n.range![0]), y1: yy, y2: yy, hot: hot.has(n), ghost: true }); // lineage before its first fossil
          return yy;
        }
        const nx = x(n.t);
        const ys = n.children.map((c) => walk(c, nx, depth + 1));
        const y0 = Math.min(...ys), y1 = Math.max(...ys), yy = (ys[0] + ys[ys.length - 1]) / 2;
        lines.push({ x1: nx, x2: nx, y1: y0, y2: y1, hot: false });
        lines.push({ x1: px, x2: nx, y1: yy, y2: yy, hot: hot.has(n) });
        nodes.push({ n, x: nx, y: yy, hot: hot.has(n), depth });
        return yy;
      };
      if (tr.f) {
        // genera hang from their family's row: one vertical drop just before the oldest of them
        const xr = Math.min(x(tr.root.t), x(tr.f.range_ma[0]) - 4);
        const kids = tr.root.name === tr.f.family ? tr.root.children : [tr.root];
        const ys = kids.map((c) => walk(c, xr, 1));
        lines.push({ x1: xr, x2: xr, y1: tr.famY!, y2: Math.max(...ys), hot: false });
      } else {
        walk(tr.root, x(tr.root.t) - 14, 0);
      }
    }
    // the selection's lineage as one track along its own row: from the oldest ancestor's split to its first fossil,
    // with a stop at every split on the way (names alternate above and below the track)
    let lineage: { y: number; x0: number; x1: number; stops: { name: string; x: number; above: boolean }[] } | null = null;
    const selRow = selected ? (genus ? rowY.get(`${selected}/${genus}`) : rowY.get(selected)) : undefined;
    const selRange = selected && (genus ? data.genera[selected]?.genera.find((g) => g.genus === genus)?.range_ma : data.families.find((f) => f.family === selected)?.range_ma);
    if (selRow != null && selRange && track.length) {
      const stops: { name: string; x: number; above: boolean }[] = [];
      const last = { true: -Infinity, false: -Infinity } as Record<string, number>;
      for (const n of track) {
        const nx = x(n.t), w = n.name.length * 5.6;
        // try above, then below; skip the name if both sides are taken (the dot stays)
        const side = [true, false].find((a) => nx - w / 2 > last[String(a)] + 6 && nx - w / 2 > L);
        if (side === undefined) { stops.push({ name: "", x: nx, above: true }); continue; }
        last[String(side)] = nx + w / 2;
        stops.push({ name: n.name, x: nx, above: side });
      }
      lineage = { y: selRow, x0: x(track[0].t) - 10, x1: x(selRange[0]), stops };
    }

    // clade names sit just above (or below) the branch into each split, only where they overlap nothing
    const segs = [...lines.filter((l) => l.y1 === l.y2).map((l) => ({ y: l.y1, a: Math.min(l.x1, l.x2), b: Math.max(l.x1, l.x2), h: 1 })), ...bars];
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    const labels = nodes
      .sort((p, q) => Number(q.hot) - Number(p.hot) || Number(WELL_KNOWN.has(q.n.name)) - Number(WELL_KNOWN.has(p.n.name)) || p.depth - q.depth)
      .flatMap(({ n, x: nx, y: ny, hot }) => {
        const r = nx - 4, l = r - n.name.length * (hot ? 5.9 : 5.3);
        for (const below of [false, true]) {
          const top = below ? ny + 2 : ny - 12, bot = top + 10;
          const clash = l < L + 2 || r > W - M.r
            || (!hot && segs.some((g) => g.y + g.h + (below ? 0 : 2) > top && g.y - g.h - (below ? 2 : 0) < bot && g.a < r && g.b > l))
            || boxes.some((o) => o.l < r && o.r > l && o.t < bot && o.b > top);
          if (clash) continue;
          boxes.push({ l, r, t: top, b: bot });
          return [{ name: n.name, x: r, y: bot - 2, hot }];
        }
        return [];
      });
    return { lines, nodes, labels, lineage };
  }, [items, trees, x, ROW, selected, genus, showSpecies, L, W, data]);

  /* ---------- interaction ---------- */
  const latest = useLatest({ x, L, W, view });
  const toT = (clientX: number) => {
    const r = wrap.current!.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    return x.invert(Math.max(L, Math.min(W - M.r, px)));
  };
  const dragging = useRef(false);
  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest("[data-stop]")) return; // rows and zoomable labels handle their own clicks
    const r = e.currentTarget.getBoundingClientRect();
    if (((e.clientX - r.left) / r.width) * W < L - 4) return;
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
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
      <span>{f.family === selected ? "Click to deselect" : "Click to follow its lineage and see its profile"} · ▸ unfolds its genera</span>
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

  /* period bands and extinction lines run through both the deck and the rows */
  const bands = (y0: number, y1: number, labels: boolean) => data.periods.filter((p) => vis(p.start, p.end)).map((p) => {
    const i = data.periods.indexOf(p);
    const x0 = X(p.start), x1 = X(p.end), w = x1 - x0;
    const short = `${p.name[0]}. ${p.name.split(" ")[1]}`;
    const label = w > 84 ? p.name : w > 40 ? short : w > 22 ? short.replace(". ", ".").slice(0, 3) : "";
    return (
      <g key={p.name}>
        <rect className={i % 2 ? s.bandAlt : s.band} x={x0} width={w} y={y0} height={y1 - y0} />
        {labels && (
          <text className={`${s.periodLabel} ${s.zoomable}`} x={(x0 + x1) / 2} y={M.t + 15} textAnchor="middle"
            data-stop onPointerDown={() => zoomTo(p.start, p.end)}>
            {label}<title>{`${p.name} · ${fRange([p.start, p.end])} · click to zoom in`}</title>
          </text>
        )}
      </g>
    );
  });
  const extinctions = (y0: number, y1: number, labels: boolean) => (
    <g clipPath={`url(#${clip})`} className={s.extinction}>
      {EXTINCTIONS.filter((e) => e.ma <= view[0] && e.ma >= view[1]).map((e) => (
        <g key={e.ma}>
          <line x1={x(e.ma)} x2={x(e.ma)} y1={y0} y2={y1} />
          {labels && <text x={x(e.ma) - 5} y={areaTop + AREA - 6} textAnchor="end">{compact ? e.short : e.label}</text>}
        </g>
      ))}
    </g>
  );
  const svgEvents = { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp };
  const mapW = L - 12, mapH = rowsTop - 10;

  return (
    <div
      ref={wrap} className={s.timeline} tabIndex={0} role="slider" onKeyDown={onKeyDown}
      aria-label="Time in millions of years" aria-valuenow={t} aria-valuemin={TIME[1]} aria-valuemax={TIME[0]}
      aria-valuetext={`${fMa(t)} million years ago`}
    >
      {/* the deck stays on screen while the rows scroll: zoom controls, periods, stages, diversity, cursor and the paleomap */}
      <div className={s.deck}>
        {deckTop}
        <div className={s.deckPlot}>
          <svg viewBox={`0 0 ${W} ${rowsTop}`} width={W} height={rowsTop} {...svgEvents}>
            <defs><clipPath id={clip}><rect x={L} y={0} width={W - M.r - L} height={H} /></clipPath></defs>
            <g clipPath={`url(#${clip})`}>
              {bands(M.t, rowsTop, true)}
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
            {/* diversity axis, inside the plot (the map sits to its left) */}
            {yDiv.ticks(3).slice(1).map((v) => <line key={v} className={s.grid} x1={L} x2={W - M.r} y1={yDiv(v)} y2={yDiv(v)} />)}
            {yDiv.ticks(3).slice(1).map((v, i, a) => (
              <text key={v} className={s.axisInside} x={L + 4} y={yDiv(v) - 3}>{fNum(v)}{i === a.length - 1 ? " genera" : ""}</text>
            ))}
            {extinctions(areaTop, rowsTop, true)}
            {inView && (
              <g pointerEvents="none">
                <line className={s.cursorLine} x1={cx} x2={cx} y1={M.t - 4} y2={rowsTop} />
                <rect className={s.cursorHandle} x={hx - cw / 2} width={cw} y={M.t - 24} height={20} rx={5} />
                <text className={s.cursorLabel} x={hx} y={M.t - 10} textAnchor="middle">{cursorLabel}</text>
                <text className={s.cursorCount} x={cx + (nearRight ? -6 : 6)} y={yDiv(divNow) - 6} textAnchor={nearRight ? "end" : "start"}>
                  {fNum(divNow)} genera
                </text>
              </g>
            )}
          </svg>
          <div className={s.deckMap} style={{ width: mapW, height: mapH }}>
            <DeckMap width={mapW} height={mapH} />
          </div>
        </div>
      </div>

      <svg viewBox={`0 ${rowsTop} ${W} ${H - rowsTop}`} width={W} height={H - rowsTop} {...svgEvents}>
        <g clipPath={`url(#${clip})`}>{bands(rowsTop, H - AXIS, false)}</g>

        {/* lineage labels, vertical in the left gutter, spanning their rows */}
        {spans.map(({ gr, y0, y1 }) => {
          const mid = (y0 + y1) / 2, lx = GUT - 8;
          return (
            <g key={`lab-${gr?.key}`} className={s.lineage}>
              <title>{gr ? `${gr.label}: ${gr.clade.toLowerCase()} · ${gr.hint}` : "Other"}</title>
              <line x1={GUT - 3} x2={GUT - 3} y1={y0 + 3} y2={y1 - 3} />
              <text transform={`translate(${lx},${mid}) rotate(-90)`} textAnchor="middle">{gr?.label ?? "Other"}</text>
            </g>
          );
        })}

        {/* family tree: branches join each group at the age of its oldest fossil */}
        <g clipPath={`url(#${clip})`} className={s.tree} pointerEvents="none">
          {branches.lines.map((l, i) => <line key={i} className={`${l.hot ? s.branchHot : selected ? s.branchFaded : s.branch} ${l.ghost ? s.ghost : ""}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} />)}
          {branches.nodes.map(({ n, x: nx, y: ny, hot }) => <circle key={`${n.name}-${ny}`} className={hot ? s.nodeHot : s.node} cx={nx} cy={ny} r={2.4} />)}
          {branches.labels.map((l) => <text key={`${l.name}-${l.y}`} className={`${s.clade} ${selected ? s.cladeFaded : ""}`} x={l.x} y={l.y} textAnchor="end">{l.name}</text>)}
        </g>

        {/* rows */}
        {items.map((it) => {
          if (it.type === "head") return (
            <g key={`h-${it.gr?.key}`} className={s.groupHead}>
              <line x1={0} x2={W - M.r} y1={it.y + HEAD / 2} y2={it.y + HEAD / 2} />
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
              <g key={f.family} transform={`translate(0,${it.y})`} className={`${s.row} ${selected && !sel ? s.faded : ""}`} data-stop data-family={f.family}
                onPointerDown={() => { tip.hide(); dispatch({ type: "toggleFamily", family: f.family }); }}
                onPointerMove={(e) => tip.show(famTip(f), e)} onPointerLeave={tip.hide}>
                <rect className={`${s.hit} ${sel && !genus ? s.hitSel : ""}`} x={GUT} width={W - M.r - GUT} height={ROW} rx={4} />
                {f.phylopic?.svg && (
                  <image className={`sil ${s.rowSil} ${!on && !sel ? s.dim : ""}`} href={silhouetteUrl(f.phylopic.svg)}
                    x={GUT} y={(ROW - SIL.h) / 2} width={SIL.w} height={SIL.h} preserveAspectRatio="xMidYMid meet" />
                )}
                <text className={s.chev} x={nameX} y={ROW / 2} dominantBaseline="central">
                  {hasGenera ? (open.has(f.family) ? "▾" : "▸") : ""}
                </text>
                {hasGenera && (
                  <rect className={s.chevHit} x={nameX - 5} y={0} width={16} height={ROW}
                    onPointerDown={(e) => { e.stopPropagation(); tip.hide(); dispatch({ type: "fold", family: f.family, open: !open.has(f.family) }); }}>
                    <title>{open.has(f.family) ? "Fold its genera" : "Unfold its genera"}</title>
                  </rect>
                )}
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
          if (it.type === "more") return (
            <g key={`${it.f.family}//more`} transform={`translate(0,${it.y})`} className={s.moreRow}>
              <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={MORE / 2} />
              <text x={nameX + 16} y={MORE / 2} dominantBaseline="central">+{fNum(it.count)} {it.count === 1 ? "genus" : "genera"} outside this time window</text>
            </g>
          );
          const { f, gn } = it, on = isAlive(gn.range_ma, t), sel = gn.genus === genus && f.family === selected;
          const spText = showSpecies && gn.species.length
            ? gn.species.slice(0, 4).map((sp) => sp.name.replace(/^(\S)\S*\s/, "$1. ")).join(", ") + (gn.species.length > 4 ? ` +${gn.species.length - 4}` : "")
            : "";
          const xe = x(gn.range_ma[1]), spRight = xe + 6 + spText.length * 5.6 < W - M.r;
          return (
            <g key={`${f.family}/${gn.genus}`} transform={`translate(0,${it.y})`} className={`${s.row} ${selected && f.family !== selected ? s.faded : ""}`} data-stop data-genus={gn.genus}
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
              {spText && vis(gn.range_ma[0], gn.range_ma[1]) && (
                <text className={s.species} x={spRight ? xe + 6 : x(gn.range_ma[0]) - 6} y={GROW / 2} dominantBaseline="central"
                  textAnchor={spRight ? "start" : "end"} clipPath={`url(#${clip})`}>{spText}</text>
              )}
            </g>
          );
        })}

        {/* the selection's lineage, on top of the rows */}
        <g clipPath={`url(#${clip})`} pointerEvents="none">
          {branches.lineage && (
            <g className={s.lineageTrack}>
              <line x1={branches.lineage.x0} x2={branches.lineage.x1} y1={branches.lineage.y} y2={branches.lineage.y} />
              {branches.lineage.stops.map((st) => (
                <g key={`${st.x}-${st.name}`}>
                  <circle cx={st.x} cy={branches.lineage!.y} r={3.5} />
                  {st.name && <text x={st.x} y={branches.lineage!.y + (st.above ? -8 : 15)} textAnchor="middle">{st.name}</text>}
                </g>
              ))}
            </g>
          )}
        </g>
        {extinctions(rowsTop, H - AXIS, false)}

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
        {inView && <line className={s.cursorLine} x1={cx} x2={cx} y1={rowsTop} y2={H - AXIS} pointerEvents="none" />}
      </svg>
    </div>
  );
}
