import type { Family, LineageKey } from "./types";

export const TIME: [number, number] = [252, 66]; // [oldest, youngest] Ma shown on the timeline
export const DEFAULT_SNAPS = [250, 240, 230, 220, 210, 200, 190, 180, 170, 160, 150, 140, 130, 120, 110, 100, 90, 80, 70, 66];

export const EXTINCTIONS = [
  { ma: 201.4, label: "End-Triassic extinction", short: "T–J" },
  { ma: 66, label: "K–Pg extinction", short: "K–Pg" },
];

export interface Diet { label: string; color: string }
export const DIET: Record<string, Diet> = {
  herbivore: { label: "Herbivore", color: "var(--herb)" },
  carnivore: { label: "Carnivore", color: "var(--carn)" },
  omnivore: { label: "Omnivore", color: "var(--unknown)" },
  none: { label: "No data", color: "var(--unknown)" },
};
export const dietOf = (f: Family): Diet => DIET[f.pbdb?.diet ?? "none"] ?? DIET.none;

// Main lineages (Brusatte: saurischians = theropods + sauropodomorphs; ornithischians)
export interface Group { key: LineageKey; label: string; clade: string; hint: string }
export const GROUPS: Group[] = [
  { key: "theropoda", label: "Theropods", clade: "Saurischians", hint: "bipedal meat-eaters" },
  { key: "sauropodomorpha", label: "Sauropodomorphs", clade: "Saurischians", hint: "long-necked giants" },
  { key: "ornithischia", label: "Ornithischians", clade: "Ornithischians", hint: "beaked plant-eaters" },
];

// Fallback lineage for families the PBDB does not place, plus notes on debated positions.
export const LINEAGE_NOTES: Record<string, { group: LineageKey; disputed?: string }> = {
  Herrerasauridae: { group: "theropoda", disputed: "Debated position: sometimes placed as early saurischians, outside theropods." },
  Silesauridae: {
    group: "ornithischia",
    disputed: "Debated position: possibly close relatives of dinosaurs rather than dinosaurs; some studies place them at the base of the ornithischians.",
  },
};
export const groupOf = (f: Family): Group | undefined =>
  GROUPS.find((g) => g.key === (f.lineage ?? LINEAGE_NOTES[f.family]?.group));

// Common names shown on hover in the ancestry path
export const COMMON_NAMES: Record<string, string> = {
  Archosauria: "archosaurs", Avemetatarsalia: "bird-line archosaurs", Dinosauria: "dinosaurs", Saurischia: "saurischians",
  Theropoda: "theropods", Sauropodomorpha: "sauropodomorphs", Ornithischia: "ornithischians",
};
