import { V } from "./helpers";
import type { Recipe } from "./types";

const iron = { name: "Iron Ingot", qty: 1, texture: V("iron_ingot.png") };
const oak = { name: "Oak Planks", qty: 1, texture: V("oak_planks.png") };
const stationTexture = (station: string, file: string) => `/wiki/textures/vehicle-stations/${station}/${file}.png`;
const dockyardModel = {
  url: "/wiki/models/vehicles/dockyard.json",
  textures: {
    bottom: stationTexture("dockyard", "bottom"),
    side: stationTexture("dockyard", "side"),
    front: stationTexture("dockyard", "front"),
    top: stationTexture("dockyard", "top"),
    particle: stationTexture("dockyard", "side"),
  },
};
export const constructionStations: Recipe[] = [
  {
    key: "engineering-table",
    title: "Engineering Table",
    station: "Crafting Table",
    ingredients: [iron, iron, iron, oak, oak, oak, oak, oak, oak],
    output: {
      name: "Engineering Table",
      qty: 1,
      sourceId: "itemsadder:engineering_table",
      texture: stationTexture("engineering_table", "front"),
    },
  },
  {
    key: "dockyard",
    title: "Dockyard",
    station: "Crafting Table",
    ingredients: [iron, iron, iron, oak, iron, oak, oak, oak, oak],
    output: {
      name: "Dockyard",
      qty: 1,
      sourceId: "itemsadder:dockyard",
      texture: stationTexture("dockyard", "front"),
      model: dockyardModel,
    },
  },
];
