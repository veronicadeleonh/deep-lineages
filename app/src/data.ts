import { geoArea } from "d3";
import type { FeatureCollection, Geometry, Position } from "geojson";
import { DEFAULT_SNAPS } from "./constants";
import type {
  AppData, CladeSilhouettes, DiversityPoint, Relatives, Family, Fossil, FossilsFile, GeneraByFamily, Interval, PaleoIndex,
} from "./types";

const url = (path: string) => `${import.meta.env.BASE_URL}${path}`;

export async function getJSON<T>(path: string): Promise<T>;
export async function getJSON<T>(path: string, optional: true): Promise<T | null>;
export async function getJSON<T>(path: string, optional = false): Promise<T | null> {
  try {
    const r = await fetch(url(path));
    if (!r.ok) throw new Error(String(r.status));
    return (await r.json()) as T;
  } catch (e) {
    if (optional) return null;
    throw new Error(`Could not load ${path}: ${(e as Error).message}`);
  }
}

/** Absolute URL: a relative url() inside a CSS variable would resolve against the stylesheet, not the page. */
export const silhouetteUrl = (svg: string) => new URL(url(svg), document.baseURI).href;

export async function loadData(): Promise<AppData> {
  const [families, fossilsFile, diversity, periods, paleo, genera, stages, clades, relatives] = await Promise.all([
    getJSON<Family[]>("families.json"),
    getJSON<FossilsFile>("fossils.json"),
    getJSON<DiversityPoint[]>("diversity.json"),
    getJSON<Interval[]>("periods.json"),
    getJSON<PaleoIndex>("paleomap/index.json", true),
    getJSON<GeneraByFamily>("genera.json", true),
    getJSON<Interval[]>("stages.json", true),
    getJSON<CladeSilhouettes>("clades.json", true),
    getJSON<Relatives>("relatives.json", true),
  ]);
  families.sort((a, b) => b.range_ma[0] - a.range_ma[0] || b.range_ma[1] - a.range_ma[1]);

  const times = paleo?.times ?? DEFAULT_SNAPS;
  const nearestSnap = (m: number) => times.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

  const idx = Object.fromEntries(fossilsFile.columns.map((k, i) => [k, i])) as Record<string, number>;
  const fossils: Fossil[] = fossilsFile.rows.map((r) => {
    const mid = ((r[idx.max_ma] as number) + (r[idx.min_ma] as number)) / 2;
    const plng = r[idx.pbdb_paleolng] as number | null;
    return {
      genus: r[idx.genus] as string,
      family: (r[idx.family] as string | null) ?? null,
      mid,
      loc: r[idx.loc_id] as number,
      pbdb: plng == null ? null : [plng, r[idx.pbdb_paleolat] as number],
      snap: nearestSnap(mid),
    };
  });

  return { families, genera: genera ?? {}, clades: clades ?? {}, relatives: relatives ?? {}, fossils, diversity, periods, stages: stages ?? [], paleo, times, nearestSnap };
}

/* ---------- paleomaps ---------- */
export interface Snapshot { coast: FeatureCollection | null; locs: Record<string, [number, number]> | null }
const snapCache = new Map<number, Promise<Snapshot>>();

export function loadSnapshot(t: number, paleo: PaleoIndex | null): Promise<Snapshot> {
  if (!paleo?.times.includes(t)) return Promise.resolve({ coast: null, locs: null });
  let p = snapCache.get(t);
  if (!p) {
    p = Promise.all([
      getJSON<FeatureCollection>(`paleomap/coastlines_${t}.json`, true),
      getJSON<Record<string, [number, number]>>(`paleomap/locs_${t}.json`, true),
    ]).then(([coast, locs]) => ({ coast: coast ? rewind(coast) : null, locs }));
    snapCache.set(t, p);
  }
  return p;
}

/** d3 expects clockwise outer rings: a polygon that "covers the whole world" is reversed.
 *  Rings with <4 vertices break d3 and are dropped (the whole polygon if it is the outer ring). */
function rewind(fc: FeatureCollection): FeatureCollection {
  const valid = (rings: Position[][]) => (rings?.[0]?.length >= 4 ? rings.filter((r) => r.length >= 4) : null);
  const fix = (rings: Position[][]) =>
    geoArea({ type: "Polygon", coordinates: rings }) > 2 * Math.PI ? rings.map((r) => r.slice().reverse()) : rings;
  fc.features = fc.features.filter((f) => {
    const g = f.geometry as Geometry | null;
    if (!g) return false;
    if (g.type === "Polygon") {
      const r = valid(g.coordinates);
      if (!r) return false;
      g.coordinates = fix(r);
    }
    if (g.type === "MultiPolygon") {
      g.coordinates = g.coordinates.map(valid).filter((r): r is Position[][] => !!r).map(fix);
      if (!g.coordinates.length) return false;
    }
    return true;
  });
  return fc;
}
