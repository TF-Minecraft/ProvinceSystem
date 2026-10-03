import type { WikiSection } from "./types";
import modelCatalogue from "../../../public/wiki/models/companion-pets/catalogue.json";
import housePreview from "../../../public/wiki/models/companion-pets/pet-house-preview.json";

// Item names and pet selection checked against TFMCDev01 on 2026-10-02:
// plugins/CompanionPets/config.yml and plugins/MMOItems/item/pets.yml.
// TF Dev uses shared care supplies for all pet types. The user-specified roster
// and previews come from Downloads/nuevos modelos, including Husky/Maine Coon.
// Each companion has its own egg; eggs/supplies/toys come from the Animal Station.
// Care includes Fish Snack and the five custom toys now configured on TF Dev.
// The user named the new shelter Pet House; its preview is pethouse.bbmodel from
// the same Downloads folder. The server owner confirmed Pet House is available
// on 2026-10-03.
export const petHousePreview = housePreview;

const petDetails: Record<keyof typeof modelCatalogue, { name: string; egg: string }> = {
  beagle: { name: "Beagle", egg: "Beagle Companion Egg" },
  chihuahua: { name: "Chihuahua", egg: "Chihuahua Companion Egg" },
  corgi: { name: "Corgi", egg: "Corgi Companion Egg" },
  golden: { name: "Golden Retriever", egg: "Golden Companion Egg" },
  husky: { name: "Husky", egg: "Husky Companion Egg" },
  mainecoon: { name: "Maine Coon", egg: "Maine Coon Companion Egg" },
  catblack: { name: "Black cat", egg: "Catblack Companion Egg" },
  catfunny: { name: "Funny cat", egg: "Catfunny Companion Egg" },
  catorange: { name: "Orange cat", egg: "Catorange Companion Egg" },
  fox: { name: "Fox", egg: "Fox Companion Egg" },
  frog: { name: "Frog", egg: "Frog Companion Egg" },
};

export const companionPetTypes = Object.entries(petDetails).map(([id, details]) => ({
  id,
  ...details,
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
