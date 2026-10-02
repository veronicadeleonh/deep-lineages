/* Time-calibrated cladograms drawn into the timeline: families within each lineage, genera within an open family. */
import type { AppData, Family, Genus, Range } from "./types";

export const WELL_KNOWN = new Set(["Dinosauria", "Saurischia", "Theropoda", "Sauropodomorpha", "Sauropoda", "Ornithischia", "Ornithopoda", "Ceratopsia", "Thyreophora", "Ankylosauria", "Stegosauria", "Coelurosauria", "Tetanurae"]);

export interface TNode {
  name: string;
  children: TNode[];
  range?: Range;            // leaves: first → last appearance
  t: number;                // branching age (internal nodes) or first appearance (leaves), in Ma
  family?: Family;          // family leaf
  genus?: Genus;            // genus leaf
  y?: number;               // row position, set by layout()
}

const leaf = (name: string, range: Range, extra: Partial<TNode>): TNode => ({ name, children: [], range, t: range[0], ...extra });

/** Builds a tree from root-first paths; the last element of each path is the leaf. */
function fromPaths(rootName: string, items: { path: string[]; node: TNode }[]): TNode {
  const root: TNode = { name: rootName, children: [], t: 0 };
  for (const { path, node } of items) {
    let cur = root;
    for (const name of path.slice(1, -1)) {
      let next = cur.children.find((c) => c.name === name && !c.range);
      if (!next) cur.children.push((next = { name, children: [], t: 0 }));
      cur = next;
    }
    cur.children.push(node);
  }
  return root;
}

/** Ancestry of a family, root first. The PBDB places Theropoda directly under Dinosauria; conventionally (and in Brusatte) it sits inside Saurischia. */
export function ancestry(fam: string, data: AppData): string[] {
  const path = [...(data.genera[fam]?.path ?? [])];
  const i = path.indexOf("Theropoda");
  if (i > 0 && path[i - 1] === "Dinosauria") path.splice(i, 0, "Saurischia");
  return path.length ? path : [fam];
}

function familyPath(fam: string, data: AppData): string[] {
  const p = ancestry(fam, data);
  const i = p.indexOf("Dinosauria");
  return i >= 0 ? p.slice(i) : ["Dinosauria", fam];
}

export const familyTree = (data: AppData) =>
  fromPaths("Dinosauria", data.families.map((f) => ({ path: familyPath(f.family, data), node: leaf(f.family, f.range_ma, { family: f }) })));

export function genusTree(fam: Family, data: AppData): TNode {
  const gs = data.genera[fam.family]?.genera ?? [];
  return fromPaths(fam.family, gs.map((g) => ({ path: [fam.family, ...(g.below ?? []).map((b) => b.name), g.genus], node: leaf(g.genus, g.range_ma, { genus: g }) })));
}

/** Same tree keeping only the leaves that pass `keep` (empty groups are dropped). */
export function prune(n: TNode, keep: (leaf: TNode) => boolean): TNode | null {
  if (!n.children.length) return keep(n) ? n : null;
  const children = n.children.map((c) => prune(c, keep)).filter((c): c is TNode => !!c);
  return children.length ? { ...n, children } : null;
}

export const leaves = (n: TNode): TNode[] => (n.children.length ? n.children.flatMap(leaves) : [n]);

/** Chain of nodes from the root down to `name` (empty if absent). */
export function pathTo(n: TNode, name: string): TNode[] {
  if (n.name === name) return [n];
  for (const c of n.children) {
    const p = pathTo(c, name);
    if (p.length) return [n, ...p];
  }
  return [];
}

/** Drops internal nodes with a single child (they are just points along a branch), dates the splits and orders the rows. */
export function layout(n: TNode): { root: TNode; rows: number } {
  const ls = leaves(n);
  const oldest = Math.max(...ls.map((l) => l.range![0]));
  const pad = Math.max(0.4, (oldest - 66) * 0.035); // a split sits just before its oldest fossil

  const simplify = (x: TNode): TNode => {
    if (!x.children.length) return { ...x };
    if (x.children.length === 1) {
      // a chain of single groups: keep the best-known name (Theropoda rather than Neotheropoda)
      const inner = simplify(x.children[0]);
      return inner.children.length && WELL_KNOWN.has(x.name) && !WELL_KNOWN.has(inner.name) ? { ...inner, name: x.name } : inner;
    }
    const children = x.children.map(simplify).sort((a, b) => b.t - a.t || a.name.localeCompare(b.name));
    return { ...x, children, t: Math.max(...children.map((c) => c.t)) + pad };
  };
  let root = n.children.length === 1 && n.children[0].children.length ? simplify(n.children[0]) : simplify(n);
  if (!root.children.length) root = { ...n, children: [root], t: root.t + pad };

  let row = 0;
  const place = (x: TNode): number => {
    if (!x.children.length) return (x.y = row++);
    const ys = x.children.map(place);
    return (x.y = (ys[0] + ys[ys.length - 1]) / 2);
  };
  place(root);
  return { root, rows: row };
}
