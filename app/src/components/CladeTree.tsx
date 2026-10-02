/* Time-calibrated family tree for the profile panel: close relatives by default, the whole tree on demand. */
import { scaleLinear } from "d3";
import { useMemo, useRef, useState, type ReactElement } from "react";
import { CLADE_NOTES, dietOf } from "../constants";
import { fMa, fRange } from "../format";
import { useWidth } from "../hooks";
import { useStore } from "../state";
import { familyTree, fold, genusTree, layout, leaves, neighbourhood, pathTo, type TNode } from "../tree";
import type { Family } from "../types";
import { useTooltip } from "./Tooltip";
import s from "./CladeTree.module.css";

const ROW = 18, TOP = 14, AXIS = 22, LABEL_W = 132, PAD_L = 4;

export function CladeTree({ f, genus }: { f: Family; genus?: string }) {
  const { data, dispatch } = useStore();
  const tip = useTooltip();
  const wrap = useRef<HTMLDivElement>(null);
  const width = useWidth(wrap, 440);
  const [wide, setWide] = useState(false);
  const focus = genus ?? f.family;
  const color = dietOf(f).color;

  const { root, rows, canWiden } = useMemo(() => {
    const full = genus ? genusTree(f, data) : familyTree(data);
    const near = neighbourhood(full, focus);
    const shown = fold(wide ? full : near, focus);
    return { ...layout(shown), canWiden: leaves(near).length < leaves(full).length };
  }, [data, f, genus, focus, wide]);

  const onPath = useMemo(() => new Set(pathTo(root, focus)), [root, focus]);
  const ls = leaves(root);
  const x = scaleLinear().domain([root.t, Math.min(...ls.map((l) => l.range![1]))]).range([PAD_L + root.name.length * 6.1 + 12, width - LABEL_W - 10]);
  const y = (n: TNode) => TOP + n.y! * ROW + ROW / 2;
  const h = TOP + rows * ROW + AXIS;
  const x1 = width - LABEL_W - 10;

  const edges: ReactElement[] = [], nodes: ReactElement[] = [];
  const segs: { y: number; a: number; b: number }[] = [];   // horizontal strokes, to keep clade names off them
  const cands: { n: TNode; nx: number; hot: boolean; depth: number }[] = [];
  const draw = (n: TNode, parentX: number, depth = 0) => {
    const hot = onPath.has(n);
    const cls = hot ? s.edgeHot : s.edge;
    if (n.children.length) {
      const nx = x(n.t), first = n.children[0], last = n.children[n.children.length - 1];
      edges.push(<line key={`h-${n.name}`} className={cls} x1={parentX} x2={nx} y1={y(n)} y2={y(n)} />);
      edges.push(<line key={`v-${n.name}`} className={s.edge} x1={nx} x2={nx} y1={y(first)} y2={y(last)} />);
      segs.push({ y: y(n), a: parentX, b: nx });
      n.children.forEach((c) => draw(c, nx, depth + 1));
      cands.push({ n, nx, hot, depth });
      nodes.push(
        <g key={`n-${n.name}`} onPointerMove={(e) => tip.show(<><b>{n.name}</b>{CLADE_NOTES[n.name] && <> · {CLADE_NOTES[n.name]}</>}<br />split before ~{fMa(Math.round(n.t))} Ma</>, e)} onPointerLeave={tip.hide}>
          <circle className={hot ? s.nodeHot : s.node} cx={nx} cy={y(n)} r={2.5} />
        </g>,
      );
      return;
    }
    const [a, b] = n.range!;
    const self = n.name === focus;
    const click = n.family ? () => dispatch({ type: "select", family: n.family!.family })
      : n.genus ? () => dispatch({ type: "genus", family: f.family, genus: n.genus!.genus }) : undefined;
    const c = n.family ? dietOf(n.family).color : color;
    segs.push({ y: y(n), a: parentX, b: x1 });
    nodes.push(
      <g key={`l-${n.name}`} className={click && !self ? s.leafLink : undefined} onClick={self ? undefined : click}
        onPointerMove={(e) => tip.show(<><b>{n.genus ? <i>{n.name}</i> : n.name}</b>{n.count ? ` · ${n.count} genera` : ""}<br />{fRange(n.range!)}</>, e)}
        onPointerLeave={tip.hide}>
        <rect className={s.hit} x={0} y={y(n) - ROW / 2} width={width} height={ROW} />
        <line className={cls} x1={parentX} x2={x(a)} y1={y(n)} y2={y(n)} />
        <line className={s.bar} x1={x(a)} x2={Math.max(x(b), x(a) + 3)} y1={y(n)} y2={y(n)} style={{ stroke: c, opacity: self ? 1 : 0.55 }} />
        {x(b) < x1 - 4 && <line className={s.leader} x1={x(b) + 4} x2={x1} y1={y(n)} y2={y(n)} />}
        <text className={[s.label, self && s.labelSelf, n.genus && s.italic, n.count && s.summary].filter(Boolean).join(" ")} x={x1 + 8} y={y(n)} dy="0.35em">
          {n.name}{n.count ? ` · ${n.count}` : ""}
        </text>
      </g>,
    );
  };
  draw(root, PAD_L);

  // clade names sit just above the branch leading into each split; one is shown only where it overlaps no branch or other name
  // (vertical lines are fine: the text halo masks them). Path to the focus first, then the broadest groups.
  const boxes: { l: number; r: number; t: number; b: number }[] = [];
  const labels = cands
    .sort((p, q) => Number(q.hot) - Number(p.hot) || p.depth - q.depth)
    .flatMap(({ n, nx, hot }) => {
      const r = nx - 4, l = r - n.name.length * (hot ? 6.1 : 5.4);
      for (const below of [false, true]) { // above the branch, else just under it
        const t = below ? y(n) + 2 : y(n) - 12, b = t + 10;
        const clash = l < 0 || segs.some((g) => g.y + (below ? 1 : 3) > t && g.y - (below ? 3 : 1) < b && g.a < r && g.b > l)
          || boxes.some((o) => o.l < r && o.r > l && o.t < b && o.b > t);
        if (clash) continue;
        boxes.push({ l, r, t, b });
        return [<text key={`c-${n.name}`} className={hot ? s.cladeHot : s.clade} x={r} y={b - 2} textAnchor="end">{n.name}</text>];
      }
      return [];
    });

  const ticks = x.ticks(width < 400 ? 3 : 5);
  const wideLabel = genus ? "Whole family" : "All dinosaurs";
  const nearLabel = genus ? "Closest genera" : "Close relatives";
  return (
    <div className={s.wrap} ref={wrap}>
      <div className={s.head}>
        <p className={s.title}><b>Family tree</b> <span className="muted">· click a {genus ? "genus" : "family"} to open it</span></p>
        {canWiden && (
          <div className={s.toggle} role="group" aria-label="Tree scope">
            <button aria-pressed={!wide} onClick={() => setWide(false)}>{nearLabel}</button>
            <button aria-pressed={wide} onClick={() => setWide(true)}>{wideLabel}</button>
          </div>
        )}
      </div>
      <svg width={width} height={h} role="img" aria-label={`Family tree around ${focus}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={s.grid} x1={x(t)} x2={x(t)} y1={TOP - 6} y2={h - AXIS + 2} />
            <text className={s.tick} x={x(t)} y={h - 6} textAnchor="middle">{fMa(t)} Ma</text>
          </g>
        ))}
        {edges}
        {nodes}
        <g className={s.labels}>{labels}</g>
      </svg>
      <p className={s.note}>Each split is drawn just before the oldest fossil of its group: a minimum age from the record, not a measured divergence date.</p>
    </div>
  );
}
