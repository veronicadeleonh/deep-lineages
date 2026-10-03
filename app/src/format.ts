import { formatLocale } from "d3";
import type { Family, Genus, Range } from "./types";

const fmt = formatLocale({ decimal: ".", thousands: ",", grouping: [3], currency: ["$", ""] });

export const fNum = fmt.format(",d");
const f1 = fmt.format(",.1f");
/** 77.9 / 66 — one decimal only when needed. */
export const fMa = (v: number) => (v % 1 ? f1(v) : fNum(v));
export const fMa1 = f1;
export const fRange = ([a, b]: Range) => `${fMa(a)}–${fMa(b)} Ma`;

export const round1 = (v: number) => Math.round(v * 10) / 10;
export const isAlive = (range: Range, t: number) => t <= range[0] && t >= range[1];

/** Keys of a count map, most frequent first. */
export const byCount = (m: Record<string, number>) => Object.keys(m).sort((a, b) => m[b] - m[a]);

/* Two readings of a range. "Core": where most fossils fall (family: periods with ≥5% of its fossils; genus: without
   the most extreme 10% when it has 5+). "Record": first to last fossil on record, outliers included.
   Neither is when the group lived: it surely appeared before its first fossil and lasted after its last. */
export const famRecord = (f: Family): Range => f.range_ma_all ?? f.range_ma;
export const genusRecord = (g: Genus): Range =>
  g.pbdb_range ? [Math.max(g.range_ma[0], g.pbdb_range[0]), Math.min(g.range_ma[1], g.pbdb_range[1])] : g.range_ma;
