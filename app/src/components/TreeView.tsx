/* The second view: the whole family tree as a radial poster. Dinosauria at the center, branches out to every genus
   on the rim; around it, rings name the families (in their diet color) and the three lineages. Time is not an axis
   here: each genus's dot is shaded by the period of its first fossil.
   Navigation is continuous: pinch (or ⌘/Ctrl + scroll) to zoom around the pointer, two-finger scroll or drag to move,
   double-click to zoom in. Names, silhouettes and species appear as there is room for them. Clicking a ring, a branch
   point or a crumb re-centers the poster on that group. */
import { arc as d3arc, cluster, hierarchy, type HierarchyPointNode } from "d3";
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { CLADE_NOTES, GROUPS, dietOf, groupOf } from "../constants";
import { silhouetteUrl } from "../data";
import { fNum, fRange, genusRecord } from "../format";
import { useLatest, useSize } from "../hooks";
import { useStore } from "../state";
import { findNode, lifeTree, periodOf, WELL_KNOWN, type RNode } from "../tree";
import { DeckMap } from "./PaleoMap";
import { useTooltip } from "./Tooltip";
import s from "./TreeView.module.css";

type P = HierarchyPointNode<RNode>;
interface View { k: number; x: number; y: number } // zoom, and pan in screen pixels from the canvas center

const PERIODS = [
  { key: "Triassic", color: "var(--tri)" },
  { key: "Jurassic", color: "var(--jur)" },
  { key: "Cretaceous", color: "var(--cre)" },
] as const;
const periodColor = (g: RNode["genus"]) => PERIODS.find((p) => g && p.key === periodOf(g))!.color;
const MAIN = new Set(["Theropoda", "Sauropodomorpha", "Ornithischia"]);
const K_MAX = 40;
const REST: View = { k: 1, x: 0, y: 0 };

/** Point at angle a (radians, 0 = top, clockwise) and radius r. */
const pt = (a: number, r: number): [number, number] => [r * Math.sin(a), -r * Math.cos(a)];

export function TreeCard() {
  const { data, state, dispatch } = useStore();
  const tip = useTooltip();
  const wrap = useRef<HTMLDivElement>(null);   // the canvas: the poster is drawn to its size
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, height] = useSize(wrap, [900, 640]);
  const [about, setAbout] = useState(false);
  const full = useMemo(() => lifeTree(data), [data]);
  const [focusId, setFocusId] = useState(full.id);
  const focus = findNode(full, focusId) ?? full;
  const [view, setViewState] = useState<View>(REST);
  // the latest view, updated synchronously: several wheel events can arrive before React re-renders
  const latest = useRef<View>(REST);
  const setView = (v: View) => { latest.current = v; setViewState(v); };

  // the canvas fills what the card leaves (the card fills the screen); on a phone it is square
  const W = width;
  const H = width < 520 ? width : Math.max(360, height);
  const hw = W / 2, hh = H / 2;
  const c = Math.min(hw, hh);                         // poster radius at rest
  const compact = c * 2 < 560;

  /* ---------- layout (poster units, before zoom) ---------- */
  const { root, leaves, rTips, labelsAtRest } = useMemo(() => {
    const h = hierarchy(focus);
    const n = h.leaves().length;
    const labelsAtRest = n <= (compact ? 60 : 140);
    const silsAtRest = labelsAtRest && n <= (compact ? 30 : 70);
    const band = labelsAtRest ? (silsAtRest ? (compact ? 120 : 178) : (compact ? 92 : 128)) : 0;
    const rTips = c - 6 - 40 - 6 - band;             // rings take 40px outside the names
    const root = cluster<RNode>().size([2 * Math.PI, rTips]).separation((a, b) => (a.parent === b.parent ? 1 : 1.8))(h);
    const r0 = compact ? 40 : 52;                    // keep the first splits clear of the center button
    root.each((nd) => { if (nd !== root) nd.y = r0 + (nd.y * (rTips - r0)) / rTips; });
    return { root, leaves: root.leaves(), rTips, labelsAtRest };
  }, [focus, c, compact]);
  const step = leaves.length > 1 ? (2 * Math.PI) / leaves.length : 2 * Math.PI;

  // a new focus starts from the whole poster
  useEffect(() => setView(REST), [focusId]);

  /* ---------- zoom: what has room to show ---------- */
  const { k } = view;
  const zoomed = k > 1.001;
  const spacing = step * rTips * k;                  // screen distance between neighbouring genera on the rim
  const showLabels = labelsAtRest || spacing >= 12;
  const showSils = showLabels && spacing >= 19;
  const showSpecies = showLabels && spacing >= 15;
  const band = showLabels ? (showSils ? (compact ? 120 : 178) : (compact ? 92 : 128)) : 0;
  // the rings follow the rim in screen space: same thickness at any zoom, and room for the names inside them
  const rFamS = rTips * k + 6 + band;
  const rLinS = rFamS + 24;
  /** Poster point → screen point (relative to the canvas center). */
  const tx = (p: [number, number]): [number, number] => [p[0] * k + view.x, p[1] * k + view.y];
  const onScreen = ([x, y]: [number, number], m = 60) => Math.abs(x) < hw + m && Math.abs(y) < hh + m;
  // do the rings cross the canvas? (zoomed far in they can be thousands of pixels away, and huge arcs render badly)
  const dMin = Math.hypot(Math.max(0, Math.abs(view.x) - hw), Math.max(0, Math.abs(view.y) - hh));
  const dMax = Math.hypot(Math.abs(view.x) + hw, Math.abs(view.y) + hh);
  const ringsVisible = rFamS <= dMax && rLinS + 16 >= dMin;

  /* ---------- input: pinch / ⌘-scroll zooms, scroll and drag move ---------- */
  const zoomAt = (factor: number, sx: number, sy: number) => {
    const v = latest.current;
    const k2 = Math.max(1, Math.min(K_MAX, v.k * factor));
    if (k2 === 1) return setView(REST);
    const f = k2 / v.k;
    setView({ k: k2, x: sx - (sx - v.x) * f, y: sy - (sy - v.y) * f });
  };
  const toLocal = (clientX: number, clientY: number): [number, number] => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((clientX - r.left) / r.width) * W - hw, ((clientY - r.top) / r.height) * H - hh];
  };
  const zoomRef = useLatest({ zoomAt, toLocal });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const { zoomAt, toLocal } = zoomRef.current;
      const [sx, sy] = toLocal(e.clientX, e.clientY);
      if (e.ctrlKey || e.metaKey) {                  // a trackpad pinch arrives as ctrl + wheel
        e.preventDefault();
        zoomAt(Math.exp(-Math.max(-30, Math.min(30, e.deltaY)) * 0.012), sx, sy); // mouse wheels jump ~100, pinches ~2–10
      } else if (latest.current.k > 1.001) {         // zoomed in: two-finger scroll moves the poster
        e.preventDefault();
        const v = latest.current;
        setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }                                              // at rest, scrolling scrolls the page
    };
    // Safari reports pinches as gesture events
    let g0 = 1;
    const onGestureStart = (e: Event) => { e.preventDefault(); g0 = 1; };
    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as Event & { scale: number; clientX: number; clientY: number };
      const { zoomAt, toLocal } = zoomRef.current;
      const [sx, sy] = toLocal(ge.clientX, ge.clientY);
      zoomAt(ge.scale / g0, sx, sy);
      g0 = ge.scale;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart);
    el.addEventListener("gesturechange", onGestureChange);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, [zoomRef]);

  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d || !zoomed) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) { d.moved = true; svgRef.current?.setPointerCapture(e.pointerId); tip.hide(); }
    setView({ ...latest.current, x: d.vx + dx, y: d.vy + dy });
  };
  const onPointerUp = () => { setTimeout(() => { drag.current = null; }, 0); };
  /** A click only counts when the pointer did not drag. */
  const click = (fn: () => void) => () => { if (!drag.current?.moved) fn(); };
  const hover = (content: React.ReactNode) => (e: RPointerEvent) => { if (!drag.current?.moved) tip.show(content, e); };

  /* ---------- the selection, and the path that leads to it ---------- */
  const selId = useMemo(() => {
    const target = (n: RNode): boolean => (state.genus ? n.genus?.genus === state.genus && n.famOf?.family === state.selected : !!n.family && n.family.family === state.selected);
    const walk = (n: RNode): RNode | null => (target(n) ? n : n.children.reduce<RNode | null>((hit, ch) => hit ?? walk(ch), null));
    return state.selected ? walk(focus)?.id ?? null : null;
  }, [focus, state.selected, state.genus]);
  const onPath = (n: P) => !!selId && (selId === n.data.id || selId.startsWith(`${n.data.id}/`));

  /* ---------- rings: families (diet color) and lineages ---------- */
  const span = (nodes: P[]) => {
    const as = nodes.flatMap((n) => n.leaves().map((l) => l.x));
    return [Math.min(...as) - step / 2 + 0.004, Math.max(...as) + step / 2 - 0.004] as const;
  };
  const famNodes = root.descendants().filter((n) => n.data.family);
  const famArcs = famNodes.map((n) => ({ n, f: n.data.family!, a: span([n]) }));
  const linArcs = GROUPS.map((gr) => {
    const ns = famNodes.filter((n) => groupOf(n.data.family!)?.key === gr.key);
    return ns.length ? { gr, ns, a: span(ns) } : null;
  }).filter(Boolean) as { gr: (typeof GROUPS)[number]; ns: P[]; a: readonly [number, number] }[];
  const arcPath = (a0: number, a1: number, r0: number, r1: number) =>
    d3arc()({ innerRadius: r0, outerRadius: r1, startAngle: a0, endAngle: a1 }) ?? "";
  /** Path along a ring, for a label; flipped on the lower half so the text reads left to right. */
  const textArc = (a0: number, a1: number, r: number) => {
    const mid = (a0 + a1) / 2, flip = Math.cos(mid) < 0;
    const [x0, y0] = pt(flip ? a1 : a0, r), [x1, y1] = pt(flip ? a0 : a1, r);
    return `M${x0},${y0} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} ${flip ? 0 : 1} ${x1},${y1}`;
  };
  const lca = (ns: P[]) => ns.reduce((a, b) => a.ancestors().find((x) => b.ancestors().includes(x)) ?? a);
  const refocus = (n: RNode) => { tip.hide(); setFocusId(n.id); };

  /* ---------- branches, computed in screen space (a scaled SVG group renders badly far in) ---------- */
  const links = useMemo(() => {
    const out: { d: string; hot: boolean }[] = [];
    const hot = (n: P) => !!selId && (selId === n.data.id || selId.startsWith(`${n.data.id}/`));
    const S2 = (a: number, r: number) => { const [x, y] = pt(a, r * k); return [x + view.x, y + view.y]; };
    const out2 = (x: number, y: number) => Math.abs(x) > hw + 4 || Math.abs(y) > hh + 4;
    const arcD = (a0: number, a1: number, r: number) => {
      const [x0, y0] = S2(a0, r), [x1, y1] = S2(a1, r);
      return `M${x0},${y0}A${r * k},${r * k} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1},${y1}`;
    };
    for (const n of root.descendants()) {
      if (n.parent) {
        const [x0, y0] = S2(n.x, n.parent.y), [x1, y1] = S2(n.x, n.y);
        // skip segments wholly off one side of the canvas
        const off = (x0 < -hw && x1 < -hw) || (x0 > hw && x1 > hw) || (y0 < -hh && y1 < -hh) || (y0 > hh && y1 > hh);
        if (!off) out.push({ d: `M${x0},${y0}L${x1},${y1}`, hot: hot(n) });
      }
      if (n.children && n.children.length > 1) {
        const a0 = Math.min(...n.children.map((ch) => ch.x)), a1 = Math.max(...n.children.map((ch) => ch.x));
        const [x0, y0] = S2(a0, n.y), [x1, y1] = S2(a1, n.y), [xm, ym] = S2((a0 + a1) / 2, n.y);
        if (!(out2(x0, y0) && out2(x1, y1) && out2(xm, ym) && k > 4)) out.push({ d: arcD(a0, a1, n.y), hot: false });
      }
      if (hot(n) && n.parent) {                      // the selected lineage follows the arcs too
        const a0 = Math.min(n.x, n.parent.x), a1 = Math.max(n.x, n.parent.x);
        if (a1 - a0 > 1e-6) out.push({ d: arcD(a0, a1, n.parent.y), hot: true });
      }
    }
    return out;
  }, [root, selId, k, view.x, view.y, hw, hh]);

  const internal = root.descendants().filter((n) => n.children && n !== root);
  const cladeNamed = (n: P) => !n.data.family && (
    compact ? MAIN.has(n.data.name) || leaves.length <= 40 || k >= 3
      : WELL_KNOWN.has(n.data.name) || leaves.length <= 140 || k >= 2.5);

  const crumbs = useMemo(() => {
    const out: RNode[] = [];
    const walk = (n: RNode, trail: RNode[]): boolean => {
      if (n.id === focus.id) { out.push(...trail, n); return true; }
      return n.children.some((ch) => walk(ch, [...trail, n]));
    };
    walk(full, []);
    return out;
  }, [full, focus]);

  /* ---------- the depth guide: from Dinosauria down to the selected genus (or the focus) and its species ---------- */
  const ranks = useMemo(() => {
    const m = new Map<string, string>();
    for (const fg of Object.values(data.genera)) for (const g of fg.genera) for (const b of g.below ?? []) m.set(b.name, b.rank);
    return m;
  }, [data]);
  const ladder = useMemo(() => {
    const target = (n: RNode) => (state.genus ? n.genus?.genus === state.genus && n.famOf?.family === state.selected
      : state.selected ? !!n.family && n.family.family === state.selected : n.id === focus.id);
    const out: RNode[] = [];
    const walk = (n: RNode, trail: RNode[]): boolean => {
      if (target(n)) { out.push(...trail, n); return true; }
      return n.children.some((ch) => walk(ch, [...trail, n]));
    };
    if (!walk(full, [])) out.push(...crumbs);
    return out;
  }, [full, focus, crumbs, state.selected, state.genus]);
  const rankOf = (n: RNode) => (n.genus ? "genus" : n.family ? "family" : ranks.get(n.name) ?? "group");
  const ladderGenus = ladder.at(-1)?.genus;

  const genusTip = (n: RNode) => {
    const g = n.genus!, f = n.famOf!;
    return (
      <>
        {g.phylopic?.svg && <img className="sil" src={silhouetteUrl(g.phylopic.svg)} alt="" />}
        <b><i>{g.genus}</i></b> <span>· {f.family}</span><br />
        <span>Fossil record {fRange(genusRecord(g))} · first in the {periodOf(g)}</span><br />
        <span>{fNum(g.n)} fossils · {g.species.length ? `${g.species.length} species` : "species undetermined"}</span><br />
        <span>Click to see its profile</span>
      </>
    );
  };
  const cladeTip = (n: RNode, leavesN: number) => (
    <>
      <b>{n.name}</b>{CLADE_NOTES[n.name] && <><br /><span>{CLADE_NOTES[n.name]}</span></>}<br />
      <span>{fNum(leavesN)} genera · click to center on it</span>
    </>
  );
  const [ccx, ccy] = tx([0, 0]);

  return (
    <section className={`card ${s.card}`} aria-label="Family tree">
      <div className={s.head}>
        <ul className={s.legend}>
          <li className={s.legendTitle}>First fossil</li>
          {PERIODS.map((p) => <li key={p.key}><i className={s.dot} style={{ background: p.color }} />{p.key}</li>)}
          <li className={s.legendTitle}>Ring</li>
          <li><i className="swatch" style={{ background: "var(--herb)" }} />Herbivore</li>
          <li><i className="swatch" style={{ background: "var(--carn)" }} />Carnivore</li>
        </ul>
      </div>

      <div className={s.stage}>
        {/* the left column: the map, and how deep in the tree we are */}
        <aside className={s.side}>
          <DeckMap width={230} height={132} />
          <nav className={s.ladder} aria-label="Depth in the tree">
            <p className={s.ladderTitle}>Where you are <span>· level {ladder.length + (ladderGenus?.species.length ? 1 : 0)}</span></p>
            <ol>
              {ladder.map((n, i) => {
                const isFocus = n.id === focus.id, inFocus = n.id.startsWith(focus.id);
                const canFocus = n.children.length > 0;
                return (
                  <li key={n.id} className={`${isFocus ? s.stepFocus : ""} ${inFocus ? "" : s.stepAbove}`} style={{ ["--d" as string]: i }}>
                    <span className={s.stepDot} />
                    {canFocus && !isFocus
                      ? <button onClick={() => refocus(n)} title="Center the tree on this group">{n.genus ? <i>{n.name}</i> : n.name}</button>
                      : <b>{n.genus ? <i>{n.name}</i> : n.name}</b>}
                    <span className={s.rank}>{isFocus ? "center" : rankOf(n)}</span>
                  </li>
                );
              })}
              {ladderGenus && ladderGenus.species.slice(0, 4).map((sp) => (
                <li key={sp.name} className={s.stepSpecies}>
                  <span className={s.stepDot} /><i>{sp.name}</i><span className={s.rank}>species</span>
                </li>
              ))}
              {ladderGenus && ladderGenus.species.length > 4 && <li className={s.stepMore}>+{ladderGenus.species.length - 4} more species</li>}
            </ol>
            {!state.selected && <p className={s.ladderHint}>Click a genus on the rim to follow its path down to its species.</p>}
            <p className={s.ladderCount}>{fNum(leaves.filter((l) => l.data.genus).length)} genera in this view</p>
          </nav>
        </aside>

        <div ref={wrap} className={s.canvas}>
        <div className={s.controls} role="group" aria-label="Zoom">
          <button aria-label="Zoom in" onClick={() => zoomAt(1.8, 0, 0)}>+</button>
          <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.8, 0, 0)} disabled={!zoomed}>−</button>
          <button aria-label="Whole tree" title="Whole tree" onClick={() => setView(REST)} disabled={!zoomed}>⟲</button>
          <button aria-label="How to read the tree" aria-expanded={about} onClick={() => setAbout(!about)} className={s.aboutBtn}>i</button>
        </div>
        {about && <p className={s.aboutPop} role="note" onClick={() => setAbout(false)}>Branches show which groups sit inside which (PBDB classification), not when they split: here time is only the
        shade of each genus's dot, the period of its first fossil. Rings: families in their diet color, and the three
        lineages. Pinch to zoom and drag to move; names, silhouettes and species appear as you get closer. Click a ring or
        a branch point to center the tree on that group, or a genus to open its profile and see its fossils on the map.</p>}
        <p className={s.hint}>{zoomed ? "Drag or scroll to move · pinch to zoom" : "Pinch or ⌘ + scroll to zoom in"}</p>

        <svg ref={svgRef} viewBox={`${-hw} ${-hh} ${W} ${H}`} width={W} height={H} className={`${s.svg} ${zoomed ? s.grab : ""}`}
          role="img" aria-label={`Radial family tree of ${focus.name}`}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          onDoubleClick={(e) => { const [sx, sy] = toLocal(e.clientX, e.clientY); zoomAt(2, sx, sy); }}>

          {/* rings, in screen space so they keep their thickness */}
          {ringsVisible && <g transform={`translate(${view.x},${view.y})`}>
            {linArcs.map(({ gr, ns, a }) => (
              <g key={gr.key} className={s.linArc} onClick={click(() => refocus(lca(ns).data))}>
                <path d={arcPath(a[0], a[1], rLinS, rLinS + 16)} />
                <path id={`lin-${gr.key}`} d={textArc(a[0], a[1], rLinS + 8)} fill="none" />
                {(a[1] - a[0]) * (rLinS + 8) > gr.label.length * 7 + 10 && (
                  <text dy="0.35em"><textPath href={`#lin-${gr.key}`} startOffset="50%" textAnchor="middle">{gr.label}</textPath></text>
                )}
                <title>{`${gr.label}: ${gr.clade.toLowerCase()} · ${gr.hint}`}</title>
              </g>
            ))}
            {famArcs.map(({ n, f, a }) => {
              const id = `fam-${n.data.id.replace(/\W/g, "_")}`, sel = state.selected === f.family;
              return (
                <g key={n.data.id} className={`${s.famArc} ${sel ? s.famSel : ""}`} onClick={click(() => refocus(n.data))}
                  onPointerMove={hover(<><b>{f.family}</b><br /><span>{fNum(n.leaves().length)} genera · {dietOf(f).label.toLowerCase()} · click to center on it</span></>)}
                  onPointerLeave={tip.hide}>
                  <path d={arcPath(a[0], a[1], rFamS, rFamS + 20)} style={{ fill: dietOf(f).color }} />
                  <path id={id} d={textArc(a[0], a[1], rFamS + 10)} fill="none" />
                  {(a[1] - a[0]) * (rFamS + 10) > f.family.length * 6.4 + 8 && (
                    <text dy="0.35em"><textPath href={`#${id}`} startOffset="50%" textAnchor="middle">{f.family}</textPath></text>
                  )}
                </g>
              );
            })}
          </g>}

          {/* branches */}
          <g className={s.links}>
            {links.map((l, i) => <path key={i} d={l.d} className={l.hot ? s.linkHot : undefined} />)}
          </g>

          {/* branch points and clade names, in screen space */}
          {internal.map((n) => {
            const p = tx(pt(n.x, n.y));
            if (!onScreen(p)) return null;
            const named = cladeNamed(n);
            return (
              <g key={n.data.id} className={`${s.node} ${onPath(n) ? s.nodeHot : ""} ${named ? "" : s.unnamed}`} onClick={click(() => refocus(n.data))}
                onPointerMove={hover(cladeTip(n.data, n.leaves().length))} onPointerLeave={tip.hide}>
                <circle cx={p[0]} cy={p[1]} r={named ? 3.5 : 5} />
                {named && <text x={p[0]} y={p[1] - 7} textAnchor="middle">{n.data.name}</text>}
              </g>
            );
          })}

          {/* genera on the rim */}
          {leaves.map((l) => {
            const n = l.data, p = tx(pt(l.x, l.y));
            if (!onScreen(p, showLabels ? 220 : 20)) return null;
            const open = () => { tip.hide(); if (n.genus) dispatch({ type: "genus", family: n.famOf!.family, genus: n.genus.genus }); else if (n.family) dispatch({ type: "select", family: n.family.family }); };
            const deg = (l.x * 180) / Math.PI - 90, flip = Math.cos(l.x - Math.PI / 2) < 0;
            const sil = n.genus?.phylopic?.svg;
            const [sx, sy] = tx(pt(l.x, l.y + 20 / k));
            const [lx, ly] = tx(pt(l.x, l.y + (showSils ? 38 : 9) / k));
            return (
              <g key={n.id} className={`${s.tip} ${onPath(l) ? s.tipSel : ""}`} onClick={click(open)}
                onPointerMove={n.genus ? hover(genusTip(n)) : undefined} onPointerLeave={tip.hide}>
                <circle cx={p[0]} cy={p[1]} r={showLabels ? 4 : 2.6} style={{ fill: n.genus ? periodColor(n.genus) : "var(--text-3)" }} />
                {showSils && sil && <image className="sil" href={silhouetteUrl(sil)} x={sx - 13} y={sy - 8} width={26} height={16} preserveAspectRatio="xMidYMid meet" />}
                {showLabels && (
                  <text transform={`translate(${lx},${ly}) rotate(${flip ? deg + 180 : deg})`} textAnchor={flip ? "end" : "start"} dy="0.35em"
                    className={n.genus ? s.genusName : s.famName}>
                    {n.name}{showSpecies && n.genus && n.genus.species.length > 1 ? <tspan className={s.spp}> · {n.genus.species.length} species</tspan> : null}
                  </text>
                )}
              </g>
            );
          })}

          {/* center: the focus, and a way back out */}
          <g className={s.center} transform={`translate(${ccx},${ccy})`}
            onClick={click(() => (zoomed ? setView(REST) : crumbs.length > 1 && refocus(crumbs[crumbs.length - 2])))}>
            <circle r={compact ? 30 : 40} />
            <text dy={zoomed || crumbs.length > 1 ? "-0.2em" : "0.35em"} className={s.centerName}>{focus.name}</text>
            {(zoomed || crumbs.length > 1) && <text dy="1.2em" className={s.centerBack}>{zoomed ? "⟲ whole tree" : "↑ zoom out"}</text>}
          </g>
        </svg>
        </div>
      </div>

    </section>
  );
}
