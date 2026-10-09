import type { WikiSection } from "./types";
import modelCatalogue from "../../../public/wiki/models/companion-pets/catalogue.json";
import housePreview from "../../../public/wiki/models/companion-pets/pet-house-preview.json";

// Pet types, egg names and crafting requirements checked against TFMCDev01
// CompanionPets, MMOItems Animal Station and LuckPerms on 2026-10-09.
// plugins/CompanionPets/config.yml and plugins/MMOItems/item/pets.yml.
// TF Dev uses shared care supplies for all pet types. The user-specified roster
// and previews come from Downloads/nuevos modelos, including Husky/Maine Coon.
// Eggs, food, grooming supplies, treats and toys come from the Animal Station;
// Pet Medicine is crafted by a Physician at the Medicine Station.
// Care includes Fish Snack and the five custom toys now configured on TF Dev.
// The user named the new shelter Pet House; its preview is pethouse.bbmodel from
// the same Downloads folder. The server owner confirmed Pet House is available
// on 2026-10-03.
export const petHousePreview = housePreview;

const itemTexture = (file: string) => `/wiki/textures/companion-pets/items/${file}.png`;
export const companionPetItems = {
  meatMeal: { name: "Meat Meal", texture: itemTexture("meat_meal") },
  fishMeal: { name: "Fish Meal", texture: itemTexture("fish_meal") },
  brush: { name: "Pet Brush", texture: itemTexture("pet_brush") },
  medicine: { name: "Pet Medicine", texture: itemTexture("pet_medicine") },
  fishSnack: { name: "Fish Snack", texture: itemTexture("fish_snack") },
  biscuit: { name: "Biscuit Treat", texture: itemTexture("biscuit_treat") },
  ball: { name: "Pet Ball", texture: itemTexture("pet_ball") },
  bone: { name: "Chew Bone", texture: itemTexture("pet_chew_bone") },
  rope: { name: "Tug Rope", texture: itemTexture("pet_tug_rope") },
  mouse: { name: "Mouse Plush", texture: itemTexture("pet_mouse_plush") },
  teddy: { name: "Teddy Bear Plush", texture: itemTexture("pet_teddy_plush") },
  house: { name: "Pet House", texture: "/wiki/thumbnails/companion-pets/pet-house.webp" },
};

// Configured eggs retain their vanilla material appearance: no pack overrides.
// All seventeen modeled companions are registered in TF Dev.
const eggMaterials: Record<keyof typeof modelCatalogue, string> = {
  beagle: "wolf", chihuahua: "wolf", corgi: "wolf", golden: "wolf", husky: "wolf",
  mainecoon: "cat", catblack: "cat", catfunny: "cat", catorange: "cat",
  fox: "fox", frog: "frog",
  bernesse: "wolf", bordercollie: "wolf", catgray: "cat", cattabby: "cat",
  lagottoromagnolo: "wolf", yorkshire: "wolf",
};

type PetUnlock = "Pet Master" | "Noble" | "Gilded" | "Ascended" | "Legacy";
const petDetails: Record<keyof typeof modelCatalogue, { name: string; egg: string; unlock: PetUnlock }> = {
  beagle: { name: "Beagle", egg: "Beagle Companion Egg", unlock: "Pet Master" },
  chihuahua: { name: "Chihuahua", egg: "Chihuahua Companion Egg", unlock: "Pet Master" },
  corgi: { name: "Corgi", egg: "Corgi Companion Egg", unlock: "Pet Master" },
  golden: { name: "Golden Retriever", egg: "Golden Companion Egg", unlock: "Pet Master" },
  husky: { name: "Husky", egg: "Husky Companion Egg", unlock: "Noble" },
  mainecoon: { name: "Maine Coon", egg: "Maine Coon Companion Egg", unlock: "Noble" },
  catblack: { name: "Black cat", egg: "Catblack Companion Egg", unlock: "Pet Master" },
  catfunny: { name: "Funny cat", egg: "Catfunny Companion Egg", unlock: "Pet Master" },
  catorange: { name: "Orange cat", egg: "Catorange Companion Egg", unlock: "Pet Master" },
  fox: { name: "Fox", egg: "Fox Companion Egg", unlock: "Pet Master" },
  frog: { name: "Frog", egg: "Frog Companion Egg", unlock: "Pet Master" },
  bernesse: { name: "Bernese Mountain Dog", egg: "Bernese Mountain Dog Companion Egg", unlock: "Ascended" },
  bordercollie: { name: "Border Collie", egg: "Border Collie Companion Egg", unlock: "Legacy" },
  catgray: { name: "Gray cat", egg: "Gray Cat Companion Egg", unlock: "Gilded" },
  cattabby: { name: "Tabby cat", egg: "Tabby Cat Companion Egg", unlock: "Gilded" },
  lagottoromagnolo: { name: "Lagotto Romagnolo", egg: "Lagotto Romagnolo Companion Egg", unlock: "Noble" },
  yorkshire: { name: "Yorkshire Terrier", egg: "Yorkshire Terrier Companion Egg", unlock: "Ascended" },
};

export const companionPetTypes = Object.entries(petDetails).map(([id, details]) => ({
  id,
  ...details,
  eggTexture: `/wiki/textures/vanilla/${eggMaterials[id as keyof typeof modelCatalogue]}_spawn_egg.png`,
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
