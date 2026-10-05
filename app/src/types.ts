/* Shapes of the JSON files produced by scripts/ (data/processed/). */

/** [older, younger] in millions of years ago (Ma). */
export type Range = [number, number];

export type LineageKey = "theropoda" | "sauropodomorpha" | "ornithischia";

export interface PbdbInfo {
  taxon_name?: string;
  taxon_attr?: string;
  parent_name?: string;
  firstapp_max_ma?: number;
  lastapp_min_ma?: number;
  diet?: string;
  life_habit?: string;
  motility?: string;
  n_occs?: number;
}

export interface Phylopic {
  source?: string; // taxon whose silhouette is used (a genus or parent group if the family had none)
  uuid?: string;
  attribution?: string | null;
  license?: string | null;
  page?: string;
  svg: string | null;
}

export interface Wikipedia {
  lang: string;
  title?: string;
  description?: string;
  extract?: string;
  url?: string;
  thumbnail?: string;
  license?: string;
}

export interface Family {
  family: string;
  lineage: LineageKey | null;
  clade?: string;
  n_genera: number;
  n_occurrences: number;
  range_ma: Range;
  range_ma_all?: Range;
  periods: string[];
  top_genera: string[];
  continents: Record<string, number>;
  pbdb: PbdbInfo | null;
  phylopic: Phylopic | null;
  wikipedia: Wikipedia | null;
}

export interface Species {
  name: string;
  n: number;              // fossils identified to this species
  attr?: string | null;   // authority, e.g. "Osborn 1905"
}

export interface Genus {
  genus: string;
  range_ma: Range;
  n: number;
  continents: Record<string, number>;
  species: Species[];
  group?: string | null;                          // subfamily or tribe used to group genera
  below?: { name: string; rank: string }[];       // groups between the family and the genus, top-down
  attr?: string | null;                           // authority
  pbdb_range?: Range | null;                      // PBDB first/last appearance
  wikipedia?: Wikipedia | null;
  phylopic?: Phylopic | null;
}

export interface FamilyGenera {
  path: string[];
  earliest?: { genus: string; max_ma: number; min_ma: number; continent: string };
  groups?: string[];       // subfamilies/tribes in order of first appearance
  genera: Genus[];
}

export type GeneraByFamily = Record<string, FamilyGenera>;

/** Silhouette of a group on the ancestry paths; `depicts` is the taxon actually drawn. */
export interface CladeSilhouette { depicts?: string | null; uuid?: string; attribution?: string | null; license?: string | null; page?: string; svg: string }
export type CladeSilhouettes = Record<string, CladeSilhouette>;

/** A genus in a family's parent clade that belongs to no selected family (e.g. Guanlong, in Tyrannosauroidea). */
export interface Relative {
  genus: string;
  family: string | null;    // its family in the PBDB, if any
  range_ma: Range;          // without the most extreme 10% of fossils when it has 5+
  record: Range;            // first to last fossil
  n: number;
  continents: Record<string, number>;
}
export interface RelativesGroup { families: string[]; path: string[]; genera: Relative[] }
export type Relatives = Record<string, RelativesGroup>;

export interface Interval { name: string; start: number; end: number }

export interface DiversityPoint { ma: number; genera: number }

export interface FossilsFile {
  columns: string[];
  rows: (string | number | null)[][];
  locs: [number, number][];
}

/** A body fossil, ready for the map. */
export interface Fossil {
  genus: string;
  family: string | null;
  mid: number;              // midpoint of its dating (Ma)
  loc: number;              // locality id (index into FossilsFile.locs)
  here: [number, number] | null; // where the locality is today [lng, lat]
  pbdb: [number, number] | null; // PBDB paleocoordinates [lng, lat], fallback when no paleomap
  snap: number;             // paleomap snapshot it belongs to (Ma)
}

export interface PaleoIndex { model: string; times: number[] }

export interface AppData {
  families: Family[];
  genera: GeneraByFamily;
  clades: CladeSilhouettes;
  relatives: Relatives;
  fossils: Fossil[];
  diversity: DiversityPoint[];
  periods: Interval[];
  stages: Interval[];
  paleo: PaleoIndex | null;
  times: number[];
  nearestSnap: (ma: number) => number;
}
