import type { WikiSection } from "./types";
import modelCatalogue from "../../../public/wiki/models/companion-pets/catalogue.json";

// Item names and pet selection checked against TFMCDev01 on 2026-10-02:
// plugins/CompanionPets/config.yml and plugins/MMOItems/item/pets.yml.
// TF Dev uses shared care supplies for all pet types. The user-specified roster
// and previews come from Downloads/nuevos modelos, including Husky/Maine Coon.
// Each companion has its own egg; eggs/supplies/toys come from the Animal Station.
// The shelter block and toy item names are awaiting their definitive assets.
const petNames: Record<keyof typeof modelCatalogue, string> = {
  beagle: "Beagle",
  chihuahua: "Chihuahua",
  corgi: "Corgi",
  golden: "Golden Retriever",
  husky: "Husky",
  mainecoon: "Maine Coon",
  catblack: "Black cat",
  catfunny: "Funny cat",
  catorange: "Orange cat",
  fox: "Fox",
  frog: "Frog",
};

export const companionPetTypes = Object.entries(petNames).map(([id, name]) => ({
  id,
  name,
  egg: `${name} Companion Egg`,
  ...modelCatalogue[id as keyof typeof modelCatalogue],
}));

export const companionPetsSection: WikiSection = {
  nav: {
    href: "/wiki/companion-pets",
    label: "Companion Pets",
    category: "character",
    blurb: "Hatch a companion, care for its needs, play fetch and teach it your own words for tricks.",
  },
  commands: {
    system: "CompanionPets",
    href: "/wiki/companion-pets",
    commands: [],
    excludedStaffCommands: ["/companionpets"],
  },
};
