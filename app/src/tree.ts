/* Time-calibrated cladograms drawn into the timeline: families within each lineage, genera within an open family. */
import { famRecord, genusRecord } from "./format";
import type { AppData, Family, Genus, Range, RelativesGroup } from "./types";

export const WELL_KNOWN = new Set(["Dinosauria", "Saurischia", "Theropoda", "Sauropodomorpha", "Sauropoda", "Ornithischia", "Ornithopoda", "Ceratopsia", "Thyreophora", "Ankylosauria", "Stegosauria", "Coelurosauria", "Tetanurae"]);

export interface TNode {
  name: string;
  children: TNode[];
  range?: Range;            // leaves: first → last fossil on record
  t: number;                // branching age (internal nodes) or first appearance (leaves), in Ma
  family?: Family;          // family leaf
  genus?: Genus;            // genus leaf
  rel?: { clade: string; group: RelativesGroup }; // leaf for the other genera of a clade (relatives.json)
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

export const relLeafName = (clade: string) => `${clade} · others`;

/** Families, plus one leaf per clade for its genera outside the selected families (when relatives.json exists). */
export function familyTree(data: AppData): TNode {
  const fams = data.families.map((f) => ({ path: familyPath(f.family, data), node: leaf(f.family, famRecord(f), { family: f }) }));
  const rels = Object.entries(data.relatives).map(([clade, group]) => {
    const p = familyPath(group.families[0], data);
    const path = [...p.slice(0, p.indexOf(clade) + 1), relLeafName(clade)];
    const range: Range = [Math.max(...group.genera.map((g) => g.record[0])), Math.min(...group.genera.map((g) => g.record[1]))];
    return { path, node: leaf(relLeafName(clade), range, { rel: { clade, group } }) };
  });
  return fromPaths("Dinosauria", [...fams, ...rels]);
}

export function genusTree(fam: Family, data: AppData): TNode {
  const gs = data.genera[fam.family]?.genera ?? [];
  return fromPaths(fam.family, gs.map((g) => ({ path: [fam.family, ...(g.below ?? []).map((b) => b.name), g.genus], node: leaf(g.genus, genusRecord(g), { genus: g }) })));
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

/* ---------- the whole tree, for the radial view ---------- */
export interface RNode {
  id: string;               // path of names from the root: unique even when two groups share a name
  name: string;
  children: RNode[];
  family?: Family;          // the family's own node
  genus?: Genus;            // genus leaf
  famOf?: Family;           // genus leaf: its family
}

/** Dinosauria → … → families → subfamilies/tribes → genera. Groups with a single child are dropped (they are points
 *  along a branch), except families, which the rings need; a dropped well-known name replaces a lesser one. */
export function lifeTree(data: AppData): RNode {
  const root: RNode = { id: "Dinosauria", name: "Dinosauria", children: [] };
  const child = (parent: RNode, name: string): RNode => {
    let c = parent.children.find((x) => x.name === name && !x.genus);
    if (!c) parent.children.push((c = { id: `${parent.id}/${name}`, name, children: [] }));
    return c;
  };
  for (const f of data.families) {
    let cur = root;
    for (const name of familyPath(f.family, data).slice(1)) cur = child(cur, name);
    cur.family = f;
    for (const g of data.genera[f.family]?.genera ?? []) {
      let at = cur;
      for (const b of g.below ?? []) at = child(at, b.name);
      at.children.push({ id: `${at.id}/${g.genus}`, name: g.genus, children: [], genus: g, famOf: f });
    }
  }
  const simplify = (n: RNode): RNode => {
    if (!n.children.length) return n;
    const kids = n.children.map(simplify);
    if (kids.length === 1 && !n.family && n !== root && kids[0].children.length) {
      const inner = kids[0];
      return WELL_KNOWN.has(n.name) && !WELL_KNOWN.has(inner.name) && !inner.family ? { ...inner, name: n.name } : inner;
    }
    return { ...n, children: kids };
  };
  return simplify(root);
}

export const findNode = (n: RNode, id: string): RNode | null =>
  n.id === id ? n : n.children.reduce<RNode | null>((hit, c) => hit ?? findNode(c, id), null);

/** Period of a genus's first fossil: Triassic, Jurassic or Cretaceous. */
export function periodOf(g: Genus): "Triassic" | "Jurassic" | "Cretaceous" {
  const first = genusRecord(g)[0];
  return first > 201.4 ? "Triassic" : first > 143.1 ? "Jurassic" : "Cretaceous";
}
