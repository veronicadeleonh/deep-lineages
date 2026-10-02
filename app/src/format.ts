import { formatLocale } from "d3";
import type { Range } from "./types";

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
