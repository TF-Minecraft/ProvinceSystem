import type { WikiSection } from "./types";
import modelCatalogue from "../../../public/wiki/models/companion-pets/catalogue.json";
import housePreview from "../../../public/wiki/models/companion-pets/pet-house-preview.json";

// Item names, roles and textures checked against TFMCDev01 on 2026-10-03:
// plugins/CompanionPets/config.yml and plugins/MMOItems/item/pets.yml.
// TF Dev uses shared care supplies for all pet types. The user-specified roster
// and previews come from Downloads/nuevos modelos, including Husky/Maine Coon.
// Each companion has its own egg; eggs/supplies/toys come from the Animal Station.
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
  greenMedicine: { name: "Green Concoction", texture: itemTexture("greenconcoction") },
  redMedicine: { name: "Red Concoction", texture: itemTexture("redconcoction") },
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
// Husky/Maine Coon follow the owner's requested roster and corresponding family.
const eggMaterials: Record<keyof typeof modelCatalogue, string> = {
  beagle: "wolf", chihuahua: "wolf", corgi: "wolf", golden: "wolf", husky: "wolf",
  mainecoon: "cat", catblack: "cat", catfunny: "cat", catorange: "cat",
  fox: "fox", frog: "frog",
};

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
