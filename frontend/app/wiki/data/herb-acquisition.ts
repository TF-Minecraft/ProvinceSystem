import { T } from "./helpers";
import type { DropOnlyMaterial, MaterialAcquisition } from "./types";

export function collectorSource(): MaterialAcquisition {
  return {
    method: "Harvest with an Alchemist Collector",
    detail: "Gather this herb with an Alchemist Collector.",
  };
}

function collectorHerb(name: string, texture: string): DropOnlyMaterial {
  return {
    name,
    texture: T(texture),
    lore: "Herbal reagent gathered from the world.",
    acquisition: [collectorSource()],
  };
}

/** Every herb produced by an active TFMCCore Alchemist Collector drop rule. */
export const collectorHerbMaterials: DropOnlyMaterial[] = [
  collectorHerb("Dying Leaf", "herbs/icon29.png"),
  collectorHerb("Birch Seed", "mmoitems/birch_seed.png"),
  collectorHerb("Autumn Leaf", "herbs/icon4.png"),
  collectorHerb("Spot Leaf", "herbs/icon19.png"),
  collectorHerb("Fire Leaf", "herbs/icon2.png"),
  collectorHerb("Long Leaf", "herbs/icon14.png"),
  collectorHerb("Dwindle Leaf", "mmoitems/dwindle_leaf.png"),
  collectorHerb("Burrow Root", "herbs/icon32.png"),
  collectorHerb("Thorn Root", "herbs/icon41.png"),
  collectorHerb("Clover", "herbs/icon17.png"),
  collectorHerb("Pumpkin Spore", "mmoitems/pumpkin_spore.png"),
  collectorHerb("Kelpberry", "mmoitems/kelpberry.png"),
];
