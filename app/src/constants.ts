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


/** One-line gloss for each clade on an ancestry path: what the name means or what unites the group. */
export const CLADE_NOTES: Record<string, string> = {
  Archosauria: "“ruling reptiles”: crocodiles, pterosaurs, dinosaurs and birds",
  Avemetatarsalia: "the bird line of archosaurs, after the split from the crocodile line",
  Ornithodira: "pterosaurs, dinosaurs and their common ancestor",
  Dinosauromorpha: "dinosaurs and their closest small, long-legged relatives",
  Dinosauriformes: "dinosaurs plus near-relatives such as silesaurids",
  Dinosauria: "the dinosaurs, birds included",
  Saurischia: "“lizard-hipped”: theropods and sauropodomorphs",
  Ornithischia: "“bird-hipped”: beaked plant-eaters",
  Parapredentata: "silesaurids plus all later ornithischians (a recent, debated grouping)",
  Saphornithischia: "the undisputed ornithischians, without silesaurids",
  Prionodontia: "heterodontosaurids plus all later ornithischians",
  Genasauria: "“cheeked lizards”: armored dinosaurs and neornithischians",
  Thyreophora: "“shield bearers”: ornithischians covered in bony armor",
  Thyreophoroidea: "later armored dinosaurs, from Scelidosaurus on",
  Eurypoda: "“broad feet”: stegosaurs and ankylosaurs",
  Stegosauria: "plated dinosaurs with spiked tails",
  Ankylosauria: "“fused lizards”: tank-like, fully armored",
  Euankylosauria: "nodosaurids and ankylosaurids",
  Neornithischia: "“new ornithischians”: ornithopods, ceratopsians and kin",
  Cerapoda: "ornithopods and marginocephalians",
  Ornithopoda: "“bird feet”: iguanodonts, duck-bills and kin",
  Iguanodontia: "Iguanodon and its relatives",
  Dryomorpha: "Dryosaurus and more advanced iguanodonts",
  Ankylopollexia: "“stiff thumb”: iguanodonts with a thumb spike",
  Hadrosauriformes: "duck-bills and their Iguanodon-like close relatives",
  Hadrosauroidea: "duck-billed dinosaurs and their nearest relatives",
  Marginocephalia: "“fringed heads”: ceratopsians and pachycephalosaurs",
  Ceratopsia: "“horned faces”: parrot-beaked, later horned and frilled",
  Theropoda: "“beast feet”: two-legged, mostly meat-eaters; birds included",
  Neotheropoda: "“new theropods”: all but the earliest theropods",
  Coelophysoidea: "slender early hunters such as Coelophysis",
  Averostra: "“bird snouts”: ceratosaurs and tetanurans",
  Ceratosauria: "Ceratosaurus, abelisaurids and kin",
  Tetanurae: "“stiff tails”: most large theropods, and birds",
  Megalosauroidea: "megalosaurs and spinosaurs",
  Allosauroidea: "Allosaurus and giants such as carcharodontosaurids",
  Coelurosauria: "“hollow tails”: tyrannosaurs, raptors and birds",
  Tyrannosauroidea: "tyrannosaurs and their smaller early relatives",
  Maniraptora: "“hand snatchers”: long-armed, feathered; birds included",
  Paraves: "dromaeosaurids, troodontids and birds",
  Deinonychosauria: "“terrible claws”: raptors with a sickle toe claw",
  Sauropodomorpha: "long-necked plant-eaters and their early relatives",
  Massopoda: "“bulky feet”: Massospondylus and later sauropodomorphs",
  Sauropodiformes: "sauropods and their closest relatives",
  Sauropoda: "giant four-legged long-necks",
  Gravisauria: "“heavy lizards”: Vulcanodon and later sauropods",
  Eusauropoda: "“true sauropods”",
  Neosauropoda: "“new sauropods”: diplodocoids and macronarians",
  Diplodocoidea: "Diplodocus and kin, with peg-like teeth",
  Diplodocimorpha: "diplodocids, rebbachisaurids and kin",
  Flagellicaudata: "“whip tails”: diplodocids and dicraeosaurids",
  Macronaria: "“big noses”: brachiosaurs and titanosaurs",
  Titanosauriformes: "brachiosaurs and titanosaurs",
  Somphospondyli: "“spongy vertebrae”: titanosaurs and close kin",
  Titanosauria: "the last sauropods, found on every continent",
  Lithostrotia: "titanosaurs with bony plates in the skin",
};

/** Social life, from the PBDB's life habit for the family ("gregarious" / "solitary"). The other lifestyle fields are
 *  the same for every family here (ground dwelling, actively mobile), so they tell nothing apart. */
export type Social = "groups" | "solitary";
export const socialOf = (f: Family): Social | null => {
  const h = f.pbdb?.life_habit ?? "";
  return h.includes("gregarious") ? "groups" : h.includes("solitary") ? "solitary" : null;
};
export const SOCIAL: Record<Social, string> = { groups: "Lived in groups", solitary: "Solitary" };
