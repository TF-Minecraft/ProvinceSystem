import { T } from "./helpers";
import { stationRecipe } from "./station-recipes";
import type { InstrumentInfo, InstrumentKey, Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- Musical Instruments ----------

/** Playable instruments from the server recipes, registered by `stationsSection`. */
export const instrumentRecipes: Recipe[] = [
  "flute",
  "lute",
  "vielle",
  "trumpet",
  "celtic-harp",
  "kalimba",
  "dulcimer",
  "accordion",
  "bagpipe",
].map((slug) => stationRecipe(`gen-instrument-station-${slug}`));

/** The craft for one instrument, by its `InstrumentInfo.slug`. */
export function getInstrumentRecipe(slug: string): Recipe | undefined {
  return instrumentRecipes.find((r) => r.key === `gen-instrument-station-${slug}`);
}

// ---------- Instrument keyboards ----------

const NOTE_LETTERS = ["c", "d", "e", "f", "g", "a", "b", "c"];

function instrumentKeys(folder: string, mode: "chord" | "octave"): { row1: InstrumentKey[]; row2: InstrumentKey[] } {
  const S = (num: number, letter: string, suffix: "single" | "chord") =>
    `/wiki/sounds/instruments/${folder}/${folder}_${num}${letter}_${suffix}.ogg`;

  const row1 = NOTE_LETTERS.map((letter, i) => ({
    num: i + 1,
    note: letter.toUpperCase(),
    sound: S(i + 1, letter, "single"),
  }));

  const row2 =
    mode === "chord"
      ? NOTE_LETTERS.map((letter, i) => ({
          num: i + 1,
          note: letter.toUpperCase(),
          sound: S(i + 1, letter, "chord"),
        }))
     : NOTE_LETTERS.map((letter, i) => ({
          num: i + 9,
          note: letter.toUpperCase(),
          sound: S(i + 9, letter, "single"),
        }));

  return { row1, row2 };
}

const instrumentDefs: Array<{ slug: string; name: string; folder: string; mode: "chord" | "octave" }> = [
  { slug: "flute", name: "Flute", folder: "flute", mode: "octave" },
  { slug: "lute", name: "Lute", folder: "lute", mode: "chord" },
  { slug: "vielle", name: "Vielle", folder: "vielle", mode: "chord" },
  { slug: "trumpet", name: "Trumpet", folder: "trumpet", mode: "octave" },
  { slug: "celtic-harp", name: "Celtic Harp", folder: "celtic_harp", mode: "chord" },
  { slug: "kalimba", name: "Kalimba", folder: "kalimba", mode: "chord" },
  { slug: "dulcimer", name: "Dulcimer", folder: "dulcimer", mode: "chord" },
  { slug: "accordion", name: "Accordion", folder: "accordion", mode: "chord" },
  { slug: "bagpipe", name: "Bagpipe", folder: "bagpipe", mode: "octave" },
];

export const instruments: InstrumentInfo[] = instrumentDefs.map((d) => ({
  slug: d.slug,
  name: d.name,
  icon: T(`instruments/${d.folder}.png`),
  mode: d.mode,
  ...instrumentKeys(d.folder, d.mode),
}));

export function getInstrumentBySlug(slug: string): InstrumentInfo | undefined {
  return instruments.find((i) => i.slug === slug);
}

/**
 * The Instrument Station is shared with four MMOItems `LUTES`: Bard *weapons*, not
 * MusicalInstruments content. They cannot be played as instruments. Source:
 * `plugins\MMOItems\crafting-stations\instrument-station.yml:12-108`.
 *
 * Their exact ingredient lists were not captured in the research, so they are deliberately
 * not modelled as `Recipe`s here: only named, so the page can disambiguate them.
 */
export const bardWeaponLutes = [
  { name: "Iron Lute", id: "IRON_LUTE", altRecipe: false },
  { name: "Steel Lute", id: "STEEL_LUTE", altRecipe: true },
  { name: "Abyssalite Lute", id: "ABYSSALITE_LUTE", altRecipe: true },
  { name: "Mythril Lute", id: "MYTHRIL_LUTE", altRecipe: true },
] as const;

/**
 * Source: `musicalinstruments-2.3.jar` `plugin.yml`: `/instruments` has no
 * aliases, and both player subcommands sit behind `instruments.use`
 * (`default: true`), so no normal player is ever blocked.
 */
export const instrumentCommands: WikiCommandSet = {
  system: "Musical Instruments",
  href: "/wiki/musical-instruments",
  commands: [
    {
      command: "/instruments keybinds",
      description:
        "Prints the full note and chord layout for the instrument currently in your off-hand.",
      notes:
        "You must be holding an instrument in your off-hand, or it just tells you so. " +
        "Permission instruments.use, default true - no normal player is ever blocked.",
    },
    {
      command: "/instruments list",
      description: "Prints the name of every instrument that exists on the server.",
      notes:
        "Needs nothing in hand. Permission instruments.use, default true - no normal player " +
        "is ever blocked.",
    },
  ],
  excludedStaffCommands: ["/instruments give <instrument>", "/instruments reload"],
};

export const instrumentsSection: WikiSection = {
  nav: {
    href: "/wiki/musical-instruments",
    label: "Musical Instruments",
    category: "social",
    blurb:
      "Nine instruments turn your hotbar into a keyboard. Only Bards can craft them - anyone can play one.",
  },
  // `instrumentRecipes` are server recipes registered by `stationsSection`;
  // listing them again here would put them in the recipe index twice.
  commands: instrumentCommands,
};
