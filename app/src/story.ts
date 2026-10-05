/* The time machine's chapters: the rise and fall of the dinosaurs, after Brusatte. Each stop pauses the journey for a
   moment; `families` are the ones to look for on the map then (the visitor can open them). */

/** Something that happened at a place: drawn on the map with a pulse while its chapter starts.
    lon/lat are where the place was then (PALEOMAP), estimated from the reconstructed fossil sites nearby. */
export interface MapEvent {
  name: string;
  lon: number;
  lat: number;
}

export interface Chapter {
  t: number;          // Ma
  title: string;
  text: string;
  families?: string[];
  events?: MapEvent[];
}

/** How long (Myr) after a chapter starts its events stay on the map. */
export const EVENT_SPAN = 6;

export const CHAPTERS: Chapter[] = [
  {
    t: 252,
    title: "After the Great Dying",
    text: "The worst extinction in Earth's history has just wiped out most life on the planet. All land is one supercontinent, Pangaea. The dinosaurs' ancestors are small, quick reptiles, easy to miss.",
    events: [{ name: "Siberian Traps", lon: 60, lat: 64 }],
  },
  {
    t: 231,
    title: "The first dinosaurs",
    text: "In what is now Argentina and Brazil, the first true dinosaurs appear: dog-sized, two-legged and still rare. Crocodile relatives rule the land.",
    families: ["Herrerasauridae", "Saturnaliidae"],
  },
  {
    t: 210,
    title: "Long necks, early days",
    text: "Plant-eaters like Plateosaurus spread across Pangaea, the first dinosaurs to get big. Slender hunters such as Coelophysis run in the drier lands.",
    families: ["Plateosauridae", "Coelophysidae"],
  },
  {
    t: 201.4,
    title: "The end-Triassic extinction",
    text: "Pangaea starts to tear apart and huge volcanic eruptions change the climate. Many of the dinosaurs' rivals vanish; the dinosaurs survive, and the world is theirs.",
    events: [{ name: "Central Atlantic eruptions", lon: -10, lat: 20 }],
  },
  {
    t: 175,
    title: "A continent splits",
    text: "The Atlantic begins to open between North America and Africa. Sauropods keep growing, and new groups of meat-eaters appear.",
    families: ["Megalosauridae", "Mamenchisauridae", "Cetiosauridae"],
  },
  {
    t: 150,
    title: "The age of giants",
    text: "Late Jurassic floodplains, like those preserved in the western United States, are home to Brachiosaurus, Diplodocus, Stegosaurus and the predators that hunted them.",
    families: ["Brachiosauridae", "Diplodocidae", "Stegosauridae", "Metriacanthosauridae"],
  },
  {
    t: 125,
    title: "Feathers everywhere",
    text: "Lake beds in northeastern China preserve dinosaurs with feathers, among them early tyrannosaur relatives. Flowering plants start to spread.",
    families: ["Dromaeosauridae", "Troodontidae", "Ankylosauridae"],
  },
  {
    t: 97,
    title: "Giants of the south",
    text: "In North Africa and South America, enormous predators like Carcharodontosaurus and Spinosaurus share rivers and coasts with titanosaurs.",
    families: ["Carcharodontosauridae", "Spinosauridae", "Rebbachisauridae"],
  },
  {
    t: 75,
    title: "Duck-bills, horns and tyrants",
    text: "Herds of duck-billed and horned dinosaurs roam North America and Asia. Tyrannosaurs are the top predators there; abelisaurs, in the southern continents.",
    families: ["Hadrosauridae", "Ceratopsidae", "Tyrannosauridae", "Abelisauridae"],
  },
  {
    t: 66,
    title: "The asteroid",
    text: "A rock about ten kilometres wide hits what is now Mexico. Within a short time every dinosaur is gone, except one branch: the birds, still with us today.",
    events: [{ name: "Chicxulub impact", lon: -69.8, lat: 25.8 }, { name: "Deccan Traps", lon: 54.7, lat: -27 }],
  },
];

/** The chapter in effect at time t: the last one the journey has passed. */
export const chapterAt = (t: number) => [...CHAPTERS].reverse().find((c) => c.t >= t - 1e-6) ?? CHAPTERS[0];
