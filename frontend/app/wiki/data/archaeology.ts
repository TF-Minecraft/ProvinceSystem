import { V } from "./helpers";
import { stationRecipe } from "./station-recipes";
import type { Recipe, Slot, WikiCommandSet, WikiSection } from "./types";
// Recipe source: live MMOItems crafting-station config. Player-flow source:
// the user-supplied Archaeo gameplay guide (September 2026).

const item = (name: string, texture: string, qty = 1): Slot => ({ name, qty, texture: V(texture) });

/** Crafted at a vanilla Crafting Table, not at a station: it has no server-config counterpart. */
export const archeologyTableRecipe: Recipe = { key:"archeology-table", title:"Archeology Table", station:"Crafting Table", ingredients:[item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Bone","bone.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png"),item("Oak Planks","oak_planks.png")], output:{name:"Archeology Table",qty:1,sourceId:"itemsadder:archeology_station",model:{url:"/wiki/models/archeology-station.json",texture:"/wiki/textures/stations/archeology-station.png"}}};

/** The crafting-table recipe plus workshop recipes registered by `stationsSection`. */
export const archaeologyRecipes: Recipe[] = [
  archeologyTableRecipe,
  ...[
    "archaeo-tracker",
    "archaeo-prospect",
    "archaeo-establish",
    "archaeo-pencil",
    "field-brush",
    "archeology-knife",
    "archeology-spoon",
    "archeology-handpick",
    "archeology-trowel",
    "archeology-pick",
    "archeology-shovel",
    "archeology-cabinet",
  ].map((key) => stationRecipe(`gen-archeology-station-${key}`)),
];
export const archaeologyCommands: WikiCommandSet = {system: "Archaeo", href: "/wiki/archaeology", commands: [], excludedStaffCommands: ["/archaeo give ...", "/archaeo ruin ...", "/archaeo workday ...", "/archaeo find ...", "/archaeo sketch ...", "/archaeo reload"]};
export const archaeologySection: WikiSection = {nav: {href: "/wiki/archaeology", label: "Archaeology", category: "magic", blurb: "Find a ruin, establish a field camp, excavate by sound, then clean, register, and display recovered finds."}, recipes: [archeologyTableRecipe], commands: archaeologyCommands};
