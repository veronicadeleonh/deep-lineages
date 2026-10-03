/* The timeline: 252 Ma (left) to 66 Ma (right), with a draggable cursor, zoom/pan, geological stages,
   and families grouped by lineage, ordered and connected as a time-calibrated family tree.
   Zooming in reveals detail: families that fill the window unfold into their genera (themselves
   connected by subfamily), and closer still each genus shows its species. */
import {
  area, curveMonotoneX, curveStepAfter, easeCubicOut, interpolate, line, max, scaleLinear, timer, type Timer,
} from "d3";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { DIET, EXTINCTIONS, GROUPS, TIME, dietOf, groupOf, type Group } from "../constants";
import { silhouetteUrl } from "../data";
import { byCount, famRecord, fMa, fMa1, fNum, fRange, genusRecord, isAlive } from "../format";
import { useLatest, useWidth } from "../hooks";
import { MIN_SPAN, clampView, useStore } from "../state";
import { WELL_KNOWN, relLeafName, familyTree, genusTree, layout, leaves, pathTo, prune, type TNode } from "../tree";
import type { Family, Genus, Range, Relative, RelativesGroup } from "../types";
import { DeckMap } from "./PaleoMap";
import { useTooltip } from "./Tooltip";
import s from "./Timeline.module.css";

const M = { r: 18, t: 26 };
const BAND = 22, STAGE = 18, AREA = 84, GAP = 16, AXIS = 26, HEAD = 14, GROW = 22, SUB = 20, MORE = 18, SLIM = 14;
export const AUTO_SPAN = 45;    // at or below this many Myr on screen, families that fill the window unfold by themselves
const TAIL = 6;          // Myr of fade after the last fossil
const AUTO_MAX = 3;      // …but no more than this many at once, to keep the page readable
export const SPECIES_SPAN = 15; // at or below this, genera show their species
const FULL_SPAN = TIME[0] - TIME[1];

type Item =
  | { type: "head"; gr: Group | null; y: number }
  | { type: "fam"; f: Family; y: number; h: number }                       // h: row height (slim when outside the window)
  | { type: "fold"; gr: Group; n: number; fams: Family[]; y: number }      // a collapsed lineage
  | { type: "sub"; f: Family; name: string; count: number; y: number }   // subfamily/tribe header inside an unfolded family
  | { type: "genus"; f: Family; gn: Genus; y: number }
  | { type: "more"; key: string; count: number; y: number }               // genera of an open row outside the window
  | { type: "rel"; clade: string; group: RelativesGroup; f: Family; y: number }   // other genera of a family's parent clade
  | { type: "relGenus"; clade: string; r: Relative; f: Family; y: number };

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
        Bars: where most of a family's fossils fall (periods holding ≥5% of them; for genera, without the most extreme 10%).
        Thin line: first to last fossil on record, isolated or doubtful finds included. The fade after it is a reminder that a
        group surely lived on after its last known fossil: these are records, not lifespans. Branches: each split is drawn just before
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
  const fadeId = `${clip}-fade`;
  // the hovered row; its highlight is drawn under the tree's branches so it never covers them
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const leave = () => { tip.hide(); setHoverKey(null); };
  const fadeColors = [...new Set(Object.values(DIET).map((d) => d.color))];
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
    const inView = (g: Genus) => { const r = genusRecord(g); return r[0] > view[1] && r[1] < view[0]; };
    const inWindow = (r: Range) => r[0] > view[1] && r[1] < view[0];
    const zoomedIn = view[0] - view[1] < FULL_SPAN - 0.1;
    const selFam = data.families.find((f) => f.family === selected);
    [...GROUPS, null].forEach((gr) => {
      const lineageOf = (l: TNode) => l.family ?? data.families.find((f) => f.family === l.rel?.group.families[0]);
      const sub = prune(famTree, (l) => { const f = lineageOf(l); return !!f && (groupOf(f) ?? null) === gr; });
      if (!sub) return;
      // a collapsed lineage is one row (the selection keeps it open)
      if (gr && state.foldedLineages.includes(gr.key) && !(selFam && groupOf(selFam)?.key === gr.key)) {
        const fams = leaves(sub).filter((l) => l.family).map((l) => l.family!);
        items.push({ type: "head", gr, y }); y += HEAD;
        items.push({ type: "fold", gr, n: fams.length, fams, y }); y += ROW;
        return;
      }
      const { root } = layout(sub);
      trees.push({ root });
      items.push({ type: "head", gr, y }); y += HEAD;
      for (const lf of leaves(root)) {
        if (lf.rel) {
          const { clade, group } = lf.rel, f = lineageOf(lf)!;
          items.push({ type: "rel", clade, group, f, y }); y += ROW;
          if (!expanded.includes(`rel:${clade}`)) continue;
          const shown = group.genera.filter((r) => r.record[0] > view[1] && r.record[1] < view[0]);
          shown.forEach((r) => { items.push({ type: "relGenus", clade, r, f, y }); y += GROW; });
          if (group.genera.length > shown.length) { items.push({ type: "more", key: `rel:${clade}`, count: group.genera.length - shown.length, y }); y += MORE; }
          y += 6;
          continue;
        }
        const f = lf.family!;
        // zoomed in, a family with no fossils in the window shrinks to a slim row: still there, out of the way
        // …and with "only alive now" on, so does every family without fossils at the cursor
        const away = (zoomedIn && !inWindow(famRecord(f))) || (state.focusNow && !isAlive(f.range_ma, t));
        const slim = away && f.family !== selected && !open.has(f.family);
        const h = slim ? SLIM : ROW;
        items.push({ type: "fam", f, y, h }); y += h;
        if (!open.has(f.family)) continue;
        const famY = y - h / 2;
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
        if (all.length > shown) { items.push({ type: "more", key: f.family, count: all.length - shown, y }); y += MORE; }
        y += 6;
      }
    });
    // vertical extent of each lineage, for its label in the gutter
    const heads = items.filter((i) => i.type === "head");
    const spans = heads.map((h, k) => ({ gr: (h as { gr: Group | null }).gr, y0: h.y + HEAD, y1: k + 1 < heads.length ? heads[k + 1].y : y }))
      .filter((sp) => !items.some((i) => i.type === "fold" && i.gr === sp.gr));
    return { items, spans, trees, H: y + AXIS };
  }, [data, famTree, open, view, rowsTop, ROW, state.foldedLineages, selected, state.focusNow, state.focusNow ? t : 0]);

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
        rowY.set(it.f.family, it.y + it.h / 2);
        bars.push({ y: it.y + it.h / 2, a: x(famRecord(it.f)[0]), b: x(famRecord(it.f)[1]) + 20, h: 7 });
      } else if (it.type === "rel") {
        const leafName = relLeafName(it.clade);
        rowY.set(leafName, it.y + ROW / 2);
        const r = famTree && leaves(famTree).find((l) => l.name === leafName)?.range;
        if (r) bars.push({ y: it.y + ROW / 2, a: x(r[0]), b: x(r[1]), h: 6 });
      } else if (it.type === "genus") {
        rowY.set(`${it.f.family}/${it.gn.genus}`, it.y + GROW / 2);
        const end = x(it.gn.range_ma[1]) + (showSpecies && it.gn.species.length ? 120 : 0); // room for the species names
        bars.push({ y: it.y + GROW / 2, a: x(genusRecord(it.gn)[0]), b: Math.max(end, x(genusRecord(it.gn)[1]) + 20), h: 5 });
      }
    }
    const lines: { x1: number; y1: number; x2: number; y2: number; hot: boolean; ghost?: boolean }[] = [];
    const nodes: { n: TNode; x: number; y: number; hot: boolean; depth: number }[] = [];
    for (const tr of trees) {
      const target = tr.f ? (tr.f.family === selected ? genus : null) : selected;
      const path = target ? pathTo(tr.root, target) : [];
      const hot = new Set<TNode>(path); // the selection's own branches light up: the same lines, brighter
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
        const k = n.children.findIndex((c) => hot.has(c));      // where the lineage continues
        if (hot.has(n) && k >= 0) lines.push({ x1: nx, x2: nx, y1: yy, y2: ys[k], hot: true });
        lines.push({ x1: px, x2: nx, y1: yy, y2: yy, hot: hot.has(n) });
        nodes.push({ n, x: nx, y: yy, hot: hot.has(n), depth });
        return yy;
      };
      if (tr.f) {
        // genera hang from their family's row: one vertical drop just before the oldest of them
        const xr = Math.min(x(tr.root.t), x(famRecord(tr.f)[0]) - 4);
        const kids = tr.root.name === tr.f.family ? tr.root.children : [tr.root];
        const ys = kids.map((c) => walk(c, xr, 1));
        lines.push({ x1: xr, x2: xr, y1: tr.famY!, y2: Math.max(...ys), hot: false });
        const k = kids.findIndex((c) => hot.has(c));
        if (k >= 0) lines.push({ x1: xr, x2: xr, y1: tr.famY!, y2: ys[k], hot: true });
      } else {
        walk(tr.root, x(tr.root.t) - 14, 0);
      }
    }
    // clade names sit just above (or below) the branch into each split
    const segs = [...lines.filter((l) => l.y1 === l.y2).map((l) => ({ y: l.y1, a: Math.min(l.x1, l.x2), b: Math.max(l.x1, l.x2), h: 1 })), ...bars];
    const boxes: { l: number; r: number; t: number; b: number }[] = [];
    // names only along the selection's lineage: by default the tree stays quiet
    const labels = nodes
      .filter((nd) => nd.hot)
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
    return { lines, nodes, labels };
  }, [items, trees, x, ROW, selected, genus, showSpecies, L, W, data, famTree]);

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
      <span>Fossil record {fRange(famRecord(f))}{fRange(famRecord(f)) !== fRange(f.range_ma) ? ` · most fossils ${fRange(f.range_ma)}` : ""}</span><br />
      <span>{fNum(f.n_genera)} genera · {dietOf(f).label.toLowerCase()}</span><br />
      <span>{f.family === selected ? "Click to deselect" : "Click to follow its lineage and see its profile"} · ▸ unfolds its genera</span>
    </>
  );
  const genusTip = (f: Family, gn: Genus) => (
    <>
      {gn.phylopic?.svg && <img className="sil" src={silhouetteUrl(gn.phylopic.svg)} alt="" />}
      <b><i>{gn.genus}</i></b> <span>· {gn.group ?? f.family}</span><br />
      <span>Fossil record {fRange(genusRecord(gn))} · {fNum(gn.n)} fossils</span><br />
      <span>{byCount(gn.continents).map((c) => `${c} ${fNum(gn.continents[c])}`).join(" · ")}</span><br />
      <span>{gn.species.length ? gn.species.map((sp, i) => <i key={sp.name}>{i ? ", " : ""}{sp.name}</i>) : "species undetermined"}</span><br />
      <span>Click to see its profile</span>
    </>
  );

  const relTip = (clade: string, g: RelativesGroup) => (
    <>
      <b>Other {clade}</b><br />
      <span>{fNum(g.genera.length)} genera outside {g.families.join(" and ")}, from {fMa(Math.max(...g.genera.map((r) => r.record[0])))} Ma</span><br />
      <span>{g.genera.slice(0, 6).map((r, i) => <i key={r.genus}>{i ? ", " : ""}{r.genus}</i>)}{g.genera.length > 6 ? "…" : ""}</span><br />
      <span>Click to {expanded.includes(`rel:${clade}`) ? "fold" : "list them"}</span>
    </>
  );
  const relGenusTip = (clade: string, r: Relative) => (
    <>
      <b><i>{r.genus}</i></b> <span>· {r.family ?? `${clade}, no family assigned`}</span><br />
      <span>Fossil record {fRange(r.record)} · {fNum(r.n)} {r.n === 1 ? "fossil" : "fossils"}</span><br />
      <span>{byCount(r.continents).map((c) => `${c} ${fNum(r.continents[c])}`).join(" · ")}</span>
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

  /** A range in three readings: a thin line from the first to the last fossil on record, a solid bar where most
   *  fossils fall, and a fade after the last fossil (the group probably outlived it; never past the K–Pg). */
  const rangeMarks = ({ core, record, y, h, color, dim, className }: { core: Range; record: Range; y: number; h: number; color: string; dim: boolean; className: string }) => {
    if (!vis(record[0], Math.max(66, record[1] - TAIL))) return null;
    const tail = Math.min(TAIL, record[1] - 66);
    const xe = x(record[1]), xt = x(record[1] - tail);
    return (
      <g className={`${className} ${dim ? s.barDim : ""}`} clipPath={`url(#${clip})`} style={{ color }}>
        <line className={s.recordLine} x1={x(record[0])} x2={xe} y1={y} y2={y} />
        {tail > 0.3 && <rect x={xe} width={Math.max(0, xt - xe)} y={y - 1} height={2} fill={`url(#${fadeId}-${fadeColors.indexOf(color)})`} />}
        <rect x={x(core[0])} width={Math.max(h / 3, x(core[1]) - x(core[0]))} y={y - h / 2} height={h} rx={Math.min(4, h / 2)} fill="currentColor" />
      </g>
    );
  };

  /* period bands and extinction lines run through both the deck and the rows; the cursor's period and stage light up */
  const now = (iv: { start: number; end: number }) => t <= iv.start && t > iv.end;
  const bands = (y0: number, y1: number, labels: boolean) => data.periods.filter((p) => vis(p.start, p.end)).map((p) => {
    const i = data.periods.indexOf(p);
    const x0 = X(p.start), x1 = X(p.end), w = x1 - x0;
    const short = `${p.name[0]}. ${p.name.split(" ")[1]}`;
    const label = w > 84 ? p.name : w > 40 ? short : w > 22 ? short.replace(". ", ".").slice(0, 3) : "";
    return (
      <g key={p.name}>
        <rect className={i % 2 ? s.bandAlt : s.band} x={x0} width={w} y={y0} height={y1 - y0} />
        {now(p) && <rect className={s.bandNow} x={x0} width={w} y={y0} height={y1 - y0} />}
        {labels && (
          <text className={`${s.periodLabel} ${s.zoomable} ${now(p) ? s.periodNow : ""}`} x={(x0 + x1) / 2} y={M.t + 15} textAnchor="middle"
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
  const aliveN = data.families.filter((f) => isAlive(f.range_ma, t)).length;
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
                <rect className={`${s.stage} ${s.zoomable} ${now(st) ? s.stageNow : ""}`} x={x0 + 0.5} width={Math.max(0, w - 1)} y={stageTop + 1} height={STAGE - 3} rx={3}
                  data-stop onPointerDown={() => zoomTo(st.start, st.end)}>
                  <title>{`${st.name} · ${fRange([st.start, st.end])} · click to zoom in`}</title>
                </rect>
                {label && <text className={`${s.stageLabel} ${now(st) ? s.stageLabelNow : ""}`} x={(x0 + x1) / 2} y={stageTop + 11.5} textAnchor="middle">{label}</text>}
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

      {/* how to show the list: everything, or only the families with fossils at the cursor (the rest collapses to slim rows).
          "Fossils at", not "alive at": the record shows where fossils were found, not when a group lived */}
      <div className={s.listBar} style={{ marginLeft: GUT, width: Math.max(220, L - GUT - 8) }} role="radiogroup" aria-label="Families in the list">
        {[false, true].map((on) => (
          <button key={String(on)} role="radio" aria-checked={state.focusNow === on} className={state.focusNow === on ? s.listOn : undefined}
            onClick={() => dispatch({ type: "focusNow", on })}
            title={on ? "Collapse the families with no fossils at the cursor; follows the cursor as you move through time" : undefined}>
            {on ? <>Fossils at {fMa(t)} Ma <span className={s.listN}>{aliveN}</span></> : <>All families <span className={s.listN}>{data.families.length}</span></>}
          </button>
        ))}
      </div>

      <svg viewBox={`0 ${rowsTop} ${W} ${H - rowsTop}`} width={W} height={H - rowsTop} {...svgEvents}>
        <defs>
          {/* one fade per diet color (a gradient's currentColor would come from <defs>, not from the bar using it) */}
          {fadeColors.map((c, i) => (
            <linearGradient key={c} id={`${fadeId}-${i}`}>
              <stop offset="0" style={{ stopColor: c }} stopOpacity={0.9} /><stop offset="1" style={{ stopColor: c }} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <g clipPath={`url(#${clip})`}>{bands(rowsTop, H - AXIS, false)}</g>

        {/* lineage labels, vertical in the left gutter, spanning their rows */}
        {spans.map(({ gr, y0, y1 }) => {
          const mid = (y0 + y1) / 2, lx = GUT - 8;
          return (
            <g key={`lab-${gr?.key}`} className={`${s.lineage} ${gr ? s.lineageBtn : ""}`} onPointerDown={() => gr && dispatch({ type: "foldLineage", lineage: gr.key })}>
              <title>{gr ? `${gr.label}: ${gr.clade.toLowerCase()} · ${gr.hint} · click to collapse` : "Other"}</title>
              <rect x={0} y={y0} width={GUT} height={Math.max(0, y1 - y0)} fill="transparent" />
              <line x1={GUT - 3} x2={GUT - 3} y1={y0 + 3} y2={y1 - 3} />
              <text transform={`translate(${lx},${mid}) rotate(-90)`} textAnchor="middle">{gr?.label ?? "Other"}</text>
            </g>
          );
        })}

        {/* row highlights (hover and selection), under the branches */}
        <g pointerEvents="none">
          {items.map((it) => {
            const k = it.type === "fam" ? it.f.family : it.type === "genus" ? `${it.f.family}/${it.gn.genus}`
              : it.type === "rel" ? `rel:${it.clade}` : it.type === "relGenus" ? `rel:${it.clade}/${it.r.genus}` : null;
            if (!k) return null;
            const sel = it.type === "fam" ? it.f.family === selected && !genus : it.type === "genus" && it.f.family === selected && it.gn.genus === genus;
            if (k !== hoverKey && !sel) return null;
            const wide = it.type === "fam" || it.type === "rel";
            return <rect key={`hl-${k}`} className={s.rowHighlight} x={wide ? GUT : nameX} y={it.y} width={W - M.r - (wide ? GUT : nameX)} height={it.type === "fam" ? it.h : wide ? ROW : GROW} rx={4} />;
          })}
        </g>

        {/* family tree: branches join each group at the age of its oldest fossil */}
        <g clipPath={`url(#${clip})`} className={s.tree} pointerEvents="none">
          {branches.lines.filter((l) => !l.hot).map((l, i) => <line key={i} className={`${selected ? s.branchFaded : s.branch} ${l.ghost ? s.ghost : ""}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} />)}
          {branches.nodes.filter((nd) => !nd.hot).map(({ n, x: nx, y: ny }) => <circle key={`${n.name}-${ny}`} className={s.node} cx={nx} cy={ny} r={2.4} />)}
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
          if (it.type === "fold") return (
            <g key={`fold-${it.gr.key}`} transform={`translate(0,${it.y})`} className={`${s.row} ${s.foldRow}`} data-stop
              onPointerDown={() => dispatch({ type: "foldLineage", lineage: it.gr.key })}
              onPointerEnter={() => setHoverKey(`fold:${it.gr.key}`)} onPointerLeave={leave}>
              <rect className={s.hit} x={GUT} width={W - M.r - GUT} height={ROW} rx={4} />
              <text className={s.chev} x={GUT + 4} y={ROW / 2} dominantBaseline="central">▸</text>
              <text className={s.foldLabel} x={GUT + 16} y={ROW / 2} dominantBaseline="central">
                {it.gr.label} <tspan className={s.foldCount}>· {it.n} families · click to show</tspan>
              </text>
              {/* the lineage at a glance: its families' bars, overlaid */}
              <g clipPath={`url(#${clip})`}>
                {it.fams.filter((f) => vis(f.range_ma[0], f.range_ma[1])).map((f) => (
                  <rect key={f.family} x={x(f.range_ma[0])} width={Math.max(3, x(f.range_ma[1]) - x(f.range_ma[0]))} y={ROW / 2 - 4} height={8} rx={4}
                    fill={dietOf(f).color} opacity={0.35} />
                ))}
              </g>
            </g>
          );
          if (it.type === "fam") {
            const f = it.f, on = isAlive(f.range_ma, t), sel = f.family === selected;
            const hasGenera = !!data.genera[f.family]?.genera.length;
            const ROW = it.h, slim = it.h < 20; // eslint-disable-line @typescript-eslint/no-shadow
            if (slim) return (
              <g key={f.family} transform={`translate(0,${it.y})`} className={`${s.row} ${s.slim}`} data-stop data-family={f.family}
                onPointerDown={() => { tip.hide(); dispatch({ type: "toggleFamily", family: f.family }); }}
                onPointerEnter={() => setHoverKey(f.family)} onPointerMove={(e) => tip.show(famTip(f), e)} onPointerLeave={leave}>
                <rect className={s.hit} x={GUT} width={W - M.r - GUT} height={ROW} rx={3} />
                <text className={s.slimLabel} x={nameX + 12} y={ROW / 2} dominantBaseline="central">{f.family}</text>
                {rangeMarks({ core: f.range_ma, record: famRecord(f), y: ROW / 2, h: 4, color: dietOf(f).color, dim: true, className: s.bar })}
              </g>
            );
            return (
              <g key={f.family} transform={`translate(0,${it.y})`} className={`${s.row} ${selected && !sel ? s.faded : ""}`} data-stop data-family={f.family}
                onPointerDown={() => { tip.hide(); dispatch({ type: "toggleFamily", family: f.family }); }}
                onPointerEnter={() => setHoverKey(f.family)} onPointerMove={(e) => tip.show(famTip(f), e)} onPointerLeave={leave}>
                <rect className={s.hit} x={GUT} width={W - M.r - GUT} height={ROW} rx={4} />
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
                {rangeMarks({ core: f.range_ma, record: famRecord(f), y: ROW / 2, h: 12, color: dietOf(f).color, dim: !on && !sel, className: s.bar })}
              </g>
            );
          }
          if (it.type === "rel") {
            const key = `rel:${it.clade}`, isOpen = expanded.includes(key);
            const sil = data.clades[it.clade]?.svg;
            const n = it.group.genera.length;
            return (
              <g key={key} transform={`translate(0,${it.y})`} className={`${s.row} ${s.relRow} ${selected && !it.group.families.includes(selected) ? s.faded : ""}`} data-stop data-rel={it.clade}
                onPointerDown={() => { tip.hide(); dispatch({ type: "fold", family: key, open: !isOpen }); }}
                onPointerEnter={() => setHoverKey(key)} onPointerMove={(e) => tip.show(relTip(it.clade, it.group), e)} onPointerLeave={leave}>
                <rect className={s.hit} x={GUT} width={W - M.r - GUT} height={ROW} rx={4} />
                {sil && <image className={`sil ${s.rowSil} ${s.dim}`} href={silhouetteUrl(sil)} x={GUT} y={(ROW - SIL.h) / 2} width={SIL.w} height={SIL.h} preserveAspectRatio="xMidYMid meet" />}
                <text className={s.chev} x={nameX} y={ROW / 2} dominantBaseline="central">{isOpen ? "▾" : "▸"}</text>
                <text className={s.relLabel} x={nameX + 12} y={ROW / 2} dominantBaseline="central" style={compact ? { fontSize: 11 } : undefined}>
                  Other {it.clade} <tspan className={s.relCount}>· {n}</tspan>
                </text>
                {/* each genus as a short mark: scattered evidence of the lineage, not one continuous range */}
                <g clipPath={`url(#${clip})`} style={{ color: dietOf(it.f).color }}>
                  {it.group.genera.filter((r) => vis(r.record[0], r.record[1])).map((r) => (
                    <rect key={r.genus} className={s.relMark} x={x(r.range_ma[0])} width={Math.max(3, x(r.range_ma[1]) - x(r.range_ma[0]))}
                      y={ROW / 2 - 3} height={6} rx={3} fill="currentColor" />
                  ))}
                </g>
              </g>
            );
          }
          if (it.type === "relGenus") {
            const r = it.r, on = isAlive(r.range_ma, t);
            return (
              <g key={`rel:${it.clade}/${r.genus}`} transform={`translate(0,${it.y})`} className={`${s.row} ${selected && !data.relatives[it.clade]?.families.includes(selected) ? s.faded : ""}`} data-stop
                onPointerEnter={() => setHoverKey(`rel:${it.clade}/${r.genus}`)} onPointerMove={(e) => tip.show(relGenusTip(it.clade, r), e)} onPointerLeave={leave}>
                <rect className={s.hit} x={nameX} width={W - M.r - nameX} height={GROW} rx={4} />
                <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={GROW} />
                <text className={`${s.genusLabel} ${on ? s.genusAlive : ""}`} x={nameX + 16} y={GROW / 2} dominantBaseline="central">{r.genus}</text>
                {!compact && <text className={s.genusN} x={L - 8} y={GROW / 2} dominantBaseline="central" textAnchor="end">{fNum(r.n)}</text>}
                {rangeMarks({ core: r.range_ma, record: r.record, y: GROW / 2, h: 7, color: dietOf(it.f).color, dim: !on, className: s.gbar })}
              </g>
            );
          }
          if (it.type === "more") return (
            <g key={`${it.key}//more`} transform={`translate(0,${it.y})`} className={s.moreRow}>
              <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={MORE / 2} />
              <text x={nameX + 16} y={MORE / 2} dominantBaseline="central">+{fNum(it.count)} {it.count === 1 ? "genus" : "genera"} outside this time window</text>
            </g>
          );
          const { f, gn } = it, on = isAlive(gn.range_ma, t), sel = gn.genus === genus && f.family === selected;
          const spText = showSpecies && gn.species.length
            ? gn.species.slice(0, 4).map((sp) => sp.name.replace(/^(\S)\S*\s/, "$1. ")).join(", ") + (gn.species.length > 4 ? ` +${gn.species.length - 4}` : "")
            : "";
          const xe = x(genusRecord(gn)[1]), spRight = xe + 6 + spText.length * 5.6 < W - M.r;
          return (
            <g key={`${f.family}/${gn.genus}`} transform={`translate(0,${it.y})`} className={`${s.row} ${selected && f.family !== selected ? s.faded : ""}`} data-stop data-genus={gn.genus}
              onPointerDown={() => { tip.hide(); dispatch({ type: "genus", family: f.family, genus: gn.genus }); }}
              onPointerEnter={() => setHoverKey(`${f.family}/${gn.genus}`)} onPointerMove={(e) => tip.show(genusTip(f, gn), e)} onPointerLeave={leave}>
              <rect className={s.hit} x={nameX} width={W - M.r - nameX} height={GROW} rx={4} />
              <line className={s.guide} x1={nameX + 4} x2={nameX + 4} y1={0} y2={GROW} />
              <text className={`${s.genusLabel} ${on ? s.genusAlive : ""} ${sel ? s.labelSel : ""}`} x={nameX + 16} y={GROW / 2} dominantBaseline="central">{gn.genus}</text>
              {!compact && <text className={s.genusN} x={L - 8} y={GROW / 2} dominantBaseline="central" textAnchor="end">{fNum(gn.n)}</text>}
              {rangeMarks({ core: gn.range_ma, record: genusRecord(gn), y: GROW / 2, h: 7, color: dietOf(f).color, dim: !on, className: s.gbar })}
              {spText && vis(...genusRecord(gn)) && (
                <text className={s.species} x={spRight ? xe + 6 : x(genusRecord(gn)[0]) - 6} y={GROW / 2} dominantBaseline="central"
                  textAnchor={spRight ? "start" : "end"} clipPath={`url(#${clip})`}>{spText}</text>
              )}
            </g>
          );
        })}

        {/* the selection's branches, lit up on top of the rows */}
        <g clipPath={`url(#${clip})`} pointerEvents="none">
          {branches.lines.filter((l) => l.hot).map((l, i) => <line key={i} className={`${s.branchHot} ${l.ghost ? s.ghost : ""}`} x1={l.x1} x2={l.x2} y1={l.y1} y2={l.y2} />)}
          {branches.nodes.filter((nd) => nd.hot).map(({ n, x: nx, y: ny }) => <circle key={`${n.name}-${ny}`} className={s.nodeHot} cx={nx} cy={ny} r={3.5} />)}
          {branches.labels.filter((l) => l.hot).map((l) => <text key={`${l.name}-${l.y}`} className={s.cladeHot} x={l.x} y={l.y} textAnchor="end">{l.name}</text>)}
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
