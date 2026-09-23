import type { Recipe, Slot, WikiCommandSet, WikiSection } from "./types";
import { constructionStations } from "./vehicle-construction";
import { T, V } from "./helpers";
import modelCatalogue from "../../../public/wiki/models/vehicles/catalogue.json";

// Source: https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/g-gadgets.md sections 0, 3 and 4.
// Speeds are raw configuration rankings, not measured travel speeds.
export interface VehicleSkin { id: string; name: string; modelUrl?: string; skinUvUrl?: string; textures?: Record<string, string> }
export interface VehicleInfo {
  id: string; slug: string; name: string; kind: string; seats: string; components: string;
  fuel: string; speed: string; turn: string; weapons: string; cargo: string;
  category: string; requirement: string; buildTime: string; inputs: string; station: string;
  fuelStats?: { capacity: string; burn: string; items: string; runtime: string };
  skins: VehicleSkin[];
}

export const vehicles: VehicleInfo[] = [
  {
    "id": "small_car",
    "name": "Small Car",
    "kind": "Land, terrain-following",
    "seats": "1/0/0",
    "components": "geared_engine 200, hull 150",
    "fuel": "Arcane Fuel",
    "speed": "0.45 (3rd gear) ≈ 9 b/s",
    "turn": "0.70",
    "weapons": "N/A",
    "cargo": "N/A",
    "slug": "small-car",
    "category": "cars",
    "requirement": "Engineer I",
    "buildTime": "12 min",
    "inputs": "32 Oak Log, 32 Iron Ingot, 2 Lantern, 2 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "500",
      "burn": "1",
      "items": "5",
      "runtime": "~8 min 20 s"
    },
    "skins": [
      {
        "id": "small_car",
        "name": "Small Car"
      }
    ]
  },
  {
    "id": "wooden_cart",
    "name": "Wooden Cart",
    "kind": "Land, horse-drawn, towable",
    "seats": "1/0/2",
    "components": "harness 100, hull 150",
    "fuel": "none (horses)",
    "speed": "n/a",
    "turn": "0.40",
    "weapons": "N/A",
    "cargo": "Cart Inventory, 54 slots",
    "slug": "wooden-cart",
    "category": "carts",
    "requirement": "Engineer I",
    "buildTime": "6 min",
    "inputs": "64 Oak Log, 16 Iron Ingot, 16 Stick",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "wooden_cart",
        "name": "Wooden Cart"
      }
    ]
  },
  {
    "id": "horse_cart",
    "name": "Horse Cart",
    "kind": "Land, horse-drawn, can tow",
    "seats": "1/0/1",
    "components": "harness 100, hull 150",
    "fuel": "none (horses)",
    "speed": "n/a",
    "turn": "0.20",
    "weapons": "Rear Rifle",
    "cargo": "N/A",
    "slug": "horse-cart",
    "category": "carts",
    "requirement": "Engineer I",
    "buildTime": "24 min",
    "inputs": "64 Oak Log, 16 Iron Ingot, 16 Stick, 8 Steel Ingot",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "horse_cart",
        "name": "Horse Cart"
      }
    ]
  },
  {
    "id": "simple_locomotive",
    "name": "Simple Locomotive",
    "kind": "Train (tracked)",
    "seats": "1/0/0",
    "components": "engine 200, hull 30",
    "fuel": "Coal Blocks",
    "speed": "0.60 ≈ 12 b/s",
    "turn": "0.20",
    "weapons": "N/A",
    "cargo": "N/A",
    "slug": "simple-locomotive",
    "category": "train",
    "requirement": "Engineer I",
    "buildTime": "24 min",
    "inputs": "32 Oak Log, 32 Iron Ingot, 8 Furnace, 16 Stick",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "4800",
      "burn": "5",
      "items": "48",
      "runtime": "~16 min"
    },
    "skins": [
      {
        "id": "simple_locomotive",
        "name": "Simple Locomotive"
      }
    ]
  },
  {
    "id": "coal_car",
    "name": "Coal Car",
    "kind": "Train car (tracked)",
    "seats": "0/0/1",
    "components": "hull 30",
    "fuel": "N/A",
    "speed": "n/a",
    "turn": "N/A",
    "weapons": "N/A",
    "cargo": "Coal Bunker, 27 slots, only accepts Coal Blocks",
    "slug": "coal-car",
    "category": "train",
    "requirement": "Engineer I",
    "buildTime": "12 min",
    "inputs": "16 Oak Log, 16 Iron Ingot, 8 Stick",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "coal_car",
        "name": "Coal Car"
      }
    ]
  },
  {
    "id": "passenger_car",
    "name": "Passenger Car",
    "kind": "Train car (tracked)",
    "seats": "0/0/8",
    "components": "hull 30",
    "fuel": "N/A",
    "speed": "n/a",
    "turn": "N/A",
    "weapons": "N/A",
    "cargo": "N/A",
    "slug": "passenger-car",
    "category": "train",
    "requirement": "Engineer I",
    "buildTime": "12 min",
    "inputs": "16 Oak Log, 16 Iron Ingot, 8 Stick, 16 Cyan Wool",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "passenger_car",
        "name": "Passenger Car"
      }
    ]
  },
  {
    "id": "gunboat",
    "name": "Gunboat",
    "kind": "Sailing ship",
    "seats": "1/1/3",
    "components": "sails 140, hull 290 (sinkable)",
    "fuel": "none: wind",
    "speed": "0.37 ≈ 7.4 b/s",
    "turn": "0.24",
    "weapons": "Front Cannon",
    "cargo": "N/A",
    "slug": "gunboat",
    "category": "wooden_ships",
    "requirement": "Engineer II",
    "buildTime": "24 min",
    "inputs": "64 Oak Log, 64 White Wool, 4 Steel Ingot",
    "station": "Dockyard",
    "skins": [
      {
        "id": "gunboat",
        "name": "Gunboat"
      }
    ]
  },
  {
    "id": "sloop",
    "name": "Sloop",
    "kind": "Sailing ship",
    "seats": "1/1/10",
    "components": "sails 200, hull 400 (sinkable), pump 80",
    "fuel": "none: wind",
    "speed": "0.30 ≈ 6 b/s",
    "turn": "0.20",
    "weapons": "4 × Naval Cannon (2 per broadside)",
    "cargo": "N/A",
    "slug": "sloop",
    "category": "wooden_ships",
    "requirement": "Engineer II",
    "buildTime": "48 min",
    "inputs": "128 Oak Log, 128 White Wool, 16 Steel Ingot",
    "station": "Dockyard",
    "skins": [
      {
        "id": "sloop",
        "name": "Sloop"
      }
    ]
  },
  {
    "id": "torpedoboat",
    "name": "Torpedoboat",
    "kind": "Steamship",
    "seats": "1/1/1",
    "components": "engine 200, hull 400, pump 80",
    "fuel": "Coal Blocks",
    "speed": "0.40 ≈ 8 b/s",
    "turn": "0.35",
    "weapons": "Torpedo Launcher (fixed)",
    "cargo": "N/A",
    "slug": "torpedoboat",
    "category": "iron_ships",
    "requirement": "Engineer II",
    "buildTime": "48 min",
    "inputs": "64 Iron Ingot, 4 Furnace, 8 Steel Ingot",
    "station": "Dockyard",
    "fuelStats": {
      "capacity": "600",
      "burn": "2",
      "items": "6",
      "runtime": "~5 min"
    },
    "skins": [
      {
        "id": "torpedoboat",
        "name": "Torpedoboat"
      }
    ]
  },
  {
    "id": "ironclad",
    "name": "Ironclad",
    "kind": "Steamship",
    "seats": "1/5/6",
    "components": "engine 200, hull 400, pump 80",
    "fuel": "Coal Blocks",
    "speed": "0.30 ≈ 6 b/s",
    "turn": "0.20",
    "weapons": "Front Cannon, Anti-Air Turret",
    "cargo": "N/A",
    "slug": "ironclad",
    "category": "iron_ships",
    "requirement": "Engineer II",
    "buildTime": "1 h 12 min",
    "inputs": "128 Iron Ingot, 8 Furnace, 16 Steel Ingot",
    "station": "Dockyard",
    "fuelStats": {
      "capacity": "1200",
      "burn": "5",
      "items": "12",
      "runtime": "~4 min"
    },
    "skins": [
      {
        "id": "ironclad",
        "name": "Ironclad"
      }
    ]
  },
  {
    "id": "cruiser",
    "name": "Cruiser",
    "kind": "Steamship",
    "seats": "1/4/10",
    "components": "engine 500, hull 800, pump 150",
    "fuel": "Coal Blocks",
    "speed": "0.22 ≈ 4.4 b/s",
    "turn": "0.14",
    "weapons": "Front Turret, Back Turret, 2 × Anti-Air Turret",
    "cargo": "N/A",
    "slug": "cruiser",
    "category": "iron_ships",
    "requirement": "Engineer II",
    "buildTime": "1 h 36 min",
    "inputs": "256 Iron Ingot, 16 Furnace, 32 Steel Ingot",
    "station": "Dockyard",
    "fuelStats": {
      "capacity": "2400",
      "burn": "10",
      "items": "24",
      "runtime": "~4 min"
    },
    "skins": [
      {
        "id": "cruiser",
        "name": "Cruiser"
      }
    ]
  },
  {
    "id": "monoplane",
    "name": "Monoplane",
    "kind": "Aircraft",
    "seats": "1/0/0",
    "components": "engine 200, hull 400, wings 200 (lift)",
    "fuel": "Arcane Fuel",
    "speed": "0.70 ≈ 14 b/s",
    "turn": "0.20",
    "weapons": "Front Rifles, Bomb Bay",
    "cargo": "N/A",
    "slug": "monoplane",
    "category": "planes",
    "requirement": "Engineer III",
    "buildTime": "24 min",
    "inputs": "16 Oak Log, 16 White Wool, 16 Iron Ingot, 8 Steel Ingot, 8 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "900",
      "burn": "1",
      "items": "9",
      "runtime": "~15 min"
    },
    "skins": [
      {
        "id": "monoplane",
        "name": "Monoplane"
      },
      {
        "id": "monoplane_black",
        "name": "Monoplane (Black)"
      },
      {
        "id": "monoplane_chinese",
        "name": "Monoplane (Yellow)"
      },
      {
        "id": "monoplane_purple",
        "name": "Monoplane (Purple Imvata)"
      },
      {
        "id": "monoplane_revenor",
        "name": "Monoplane (Revenor)"
      },
      {
        "id": "monoplane_domenia",
        "name": "Monoplane (Domenia)"
      },
      {
        "id": "monoplane_sabarissa",
        "name": "Monoplane (Sabarissa)"
      },
      {
        "id": "monoplane_sabarissa_brown",
        "name": "Monoplane (Brown)"
      },
      {
        "id": "monoplane_pirate",
        "name": "Monoplane (Pirate)"
      },
      {
        "id": "monoplane_prism",
        "name": "Monoplane (Prism)"
      },
      {
        "id": "monoplane_norain",
        "name": "Monoplane (Norain)"
      },
      {
        "id": "monoplane_zerratoris",
        "name": "Monoplane (Zerratoris)"
      },
      {
        "id": "monoplane_oseni",
        "name": "Monoplane (Oseni)"
      }
    ]
  },
  {
    "id": "biplane",
    "name": "Biplane",
    "kind": "Aircraft",
    "seats": "1/1/0",
    "components": "engine 200, hull 400, wings 200 (lift 6.1)",
    "fuel": "Arcane Fuel",
    "speed": "0.80 ≈ 16 b/s: fastest vehicle",
    "turn": "0.30",
    "weapons": "Front Rifles, Rear Rifle, Bomb Bay",
    "cargo": "N/A",
    "slug": "biplane",
    "category": "planes",
    "requirement": "Engineer III",
    "buildTime": "48 min",
    "inputs": "32 Oak Log, 32 White Wool, 32 Iron Ingot, 16 Steel Ingot, 16 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "2200",
      "burn": "3",
      "items": "22",
      "runtime": "~12 min 13 s"
    },
    "skins": [
      {
        "id": "biplane",
        "name": "Biplane"
      },
      {
        "id": "biplane_black",
        "name": "Biplane (Black)"
      },
      {
        "id": "biplane_chinese",
        "name": "Biplane (Yellow)"
      },
      {
        "id": "biplane_purple",
        "name": "Biplane (Purple Imvata)"
      },
      {
        "id": "biplane_revenor",
        "name": "Biplane (Revenor)"
      },
      {
        "id": "biplane_domenia",
        "name": "Biplane (Domenia)"
      },
      {
        "id": "biplane_sabarissa",
        "name": "Biplane (Sabarissa)"
      },
      {
        "id": "biplane_sabarissa_brown",
        "name": "Biplane (Brown)"
      },
      {
        "id": "biplane_pirate",
        "name": "Biplane (Pirate)"
      },
      {
        "id": "biplane_prism",
        "name": "Biplane (Prism)"
      },
      {
        "id": "biplane_norain",
        "name": "Biplane (Norain)"
      },
      {
        "id": "biplane_zerratoris",
        "name": "Biplane (Zerratoris)"
      },
      {
        "id": "biplane_oseni",
        "name": "Biplane (Oseni)"
      }
    ]
  },
  {
    "id": "bomber",
    "name": "Bomber",
    "kind": "Aircraft",
    "seats": "1/2/0",
    "components": "engine 450, hull 800, wings 600",
    "fuel": "Arcane Fuel",
    "speed": "0.60 ≈ 12 b/s",
    "turn": "0.10",
    "weapons": "Front Rifle, Rear Rifle, Bomb Bay (bomb racks)",
    "cargo": "N/A",
    "slug": "bomber",
    "category": "planes",
    "requirement": "Engineer III",
    "buildTime": "1 h 36 min",
    "inputs": "64 Oak Log, 64 White Wool, 64 Iron Ingot, 32 Steel Ingot, 32 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "4500",
      "burn": "5",
      "items": "45",
      "runtime": "~15 min"
    },
    "skins": [
      {
        "id": "bomber",
        "name": "Bomber"
      }
    ]
  },
  {
    "id": "cloudskimmer",
    "name": "Cloudskimmer",
    "kind": "Airship",
    "seats": "1/1/3",
    "components": "engine 180, hull 290, balloon 240",
    "fuel": "Arcane Fuel",
    "speed": "0.37 ≈ 7.4 b/s",
    "turn": "0.24",
    "weapons": "Anti-Air Turret, Bomb Bay",
    "cargo": "Cargo Hold, 54 slots",
    "slug": "cloudskimmer",
    "category": "airships",
    "requirement": "Engineer III",
    "buildTime": "12 min",
    "inputs": "32 Oak Log, 32 White Wool, 32 Iron Ingot, 2 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "1800",
      "burn": "1",
      "items": "18",
      "runtime": "~30 min"
    },
    "skins": [
      {
        "id": "cloudskimmer",
        "name": "Cloudskimmer"
      },
      {
        "id": "cloudskimmer_prism",
        "name": "Cloudskimmer (Prism)"
      },
      {
        "id": "cloudskimmer_norain",
        "name": "Cloudskimmer (Norain)"
      }
    ]
  },
  {
    "id": "gyrobomber",
    "name": "Gyrobomber",
    "kind": "Airship",
    "seats": "1/1/5",
    "components": "engine 400, hull 900, balloon 2000",
    "fuel": "Arcane Fuel",
    "speed": "0.15 ≈ 3 b/s",
    "turn": "0.12",
    "weapons": "2 × Bomb Bay, 4 × Rifle turret (front/rear/left/right)",
    "cargo": "N/A",
    "slug": "gyrobomber",
    "category": "airships",
    "requirement": "Engineer III",
    "buildTime": "48 min",
    "inputs": "64 Oak Log, 64 White Wool, 64 Iron Ingot, 16 Steel Ingot, 16 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "5000",
      "burn": "5",
      "items": "50",
      "runtime": "~16 min 40 s"
    },
    "skins": [
      {
        "id": "gyrobomber",
        "name": "Gyrobomber"
      },
      {
        "id": "gyrobomber_prism",
        "name": "Gyrobomber (Prism)"
      }
    ]
  },
  {
    "id": "behemoth",
    "name": "Behemoth",
    "kind": "Airship, flagship",
    "seats": "1/2/13",
    "components": "engine 580, hull 1150, balloon 2000 (lift 0.2)",
    "fuel": "Arcane Fuel",
    "speed": "0.27 ≈ 5.4 b/s",
    "turn": "0.16",
    "weapons": "Front Cannon (autocannon), Left + Right Cannon, 4 × Anti-Air Turret",
    "cargo": "4 × Cargo Hold, 54 slots each",
    "slug": "behemoth",
    "category": "airships",
    "requirement": "Engineer III",
    "buildTime": "1 h 36 min",
    "inputs": "128 Oak Log, 128 White Wool, 128 Iron Ingot, 32 Steel Ingot, 32 Arcane Crystal",
    "station": "Engineering Table",
    "fuelStats": {
      "capacity": "16000",
      "burn": "12",
      "items": "160",
      "runtime": "~22 min 13 s"
    },
    "skins": [
      {
        "id": "behemoth",
        "name": "Behemoth"
      }
    ]
  },
  {
    "id": "aa_turret",
    "name": "Anti-Air Turret",
    "kind": "Emplacement",
    "seats": "1/0/0",
    "components": "hull 30",
    "fuel": "N/A",
    "speed": "static",
    "turn": "N/A",
    "weapons": "Anti-Air Turret",
    "cargo": "N/A",
    "slug": "aa-turret",
    "category": "fixed",
    "requirement": "Engineer I",
    "buildTime": "24 min",
    "inputs": "16 Iron Ingot, 8 Oak Log, 8 Steel Ingot",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "aa_turret",
        "name": "Anti-Air Turret"
      }
    ]
  },
  {
    "id": "anti_air",
    "name": "Anti-Air",
    "kind": "Emplacement",
    "seats": "1/0/0",
    "components": "hull 50",
    "fuel": "N/A",
    "speed": "static",
    "turn": "N/A",
    "weapons": "Flak Cannon",
    "cargo": "N/A",
    "slug": "anti-air",
    "category": "fixed",
    "requirement": "Engineer I",
    "buildTime": "1 h 36 min",
    "inputs": "64 Iron Ingot, 32 Oak Log, 32 Steel Ingot",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "anti_air",
        "name": "Anti-Air"
      }
    ]
  },
  {
    "id": "field_artillery",
    "name": "Field Artillery",
    "kind": "Emplacement, towable",
    "seats": "1/0/0",
    "components": "hull 40",
    "fuel": "N/A",
    "speed": "static",
    "turn": "N/A",
    "weapons": "Field Artillery (naval cannon)",
    "cargo": "N/A",
    "slug": "field-artillery",
    "category": "fixed",
    "requirement": "Engineer I",
    "buildTime": "48 min",
    "inputs": "32 Iron Ingot, 16 Oak Log, 16 Steel Ingot",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "field_artillery",
        "name": "Field Artillery"
      }
    ]
  },
  {
    "id": "fixed_artillery",
    "name": "Fixed Artillery",
    "kind": "Emplacement",
    "seats": "1/0/0",
    "components": "hull 80",
    "fuel": "N/A",
    "speed": "static",
    "turn": "N/A",
    "weapons": "Flak Cannon (naval cannon template)",
    "cargo": "N/A",
    "slug": "fixed-artillery",
    "category": "fixed",
    "requirement": "Engineer I",
    "buildTime": "1 h 36 min",
    "inputs": "64 Iron Ingot, 32 Oak Log, 32 Steel Ingot",
    "station": "Engineering Table",
    "skins": [
      {
        "id": "fixed_artillery",
        "name": "Fixed Artillery"
      }
    ]
  }
];

// Generated asset mappings are authoritative, including texture IDs whose order
// differs from the slot index and skins sharing the base vehicle skeleton.
for (const vehicle of vehicles) {
  for (const skin of vehicle.skins) {
    const asset = (modelCatalogue as Record<string, Partial<VehicleSkin>>)[skin.id];
    if (asset) Object.assign(skin, asset);
  }
}

export function getVehicleBySlug(slug: string): VehicleInfo | undefined {
  return vehicles.find((vehicle) => vehicle.slug === slug);
}
export const vehicleCommands: WikiCommandSet = {
  system: "Vehicles & Construction", href: "/wiki/vehicles",
  commands: [
    { command: "/vf keybinds", description: "Prints controls for your current vehicle and its current state. Sit in a vehicle first." },
    { command: "/vf findvehicles", description: "Lists your vehicles and their world coordinates. An unloaded vehicle can show location unknown (stored)." },
  ],
  excludedStaffCommands: ["/vf ammo", "/vf kill <radius>", "/vf spawn <vehicle>", "/vf takeover", "/vf reload", "/vf tracktest", "/vf trackcheck", "/vfbuilders reload"],
};
// Every distinct ingredient name across `vehicles[].inputs`. Vanilla items live under
// `vanilla/`, server-added ones under `materials/`, so the root cannot be derived from
// the name. Every configured ingredient has a matching icon.
const vehicleInputTextures: Record<string, string> = {
  "Oak Log": V("oak_log.png"),
  "White Wool": V("white_wool.png"),
  "Cyan Wool": V("cyan_wool.png"),
  // Exact vanilla 1.21.10 client textures: block/furnace_front.png and item/lantern.png.
  "Furnace": V("furnace.png"),
  "Lantern": V("lantern.png"),
  "Iron Ingot": V("iron_ingot.png"),
  "Stick": V("stick.png"),
  "Steel Ingot": T("materials/steel_ingot.png"),
  "Arcane Crystal": T("materials/arcane_crystal.png"),
};

/**
 * The output slot for a vehicle: a live 3D preview of its first (base) skin.
 * `VehicleSkin.modelUrl`/`textures` map onto `Slot.model`'s `url`/`textures`.
 * `skinUvUrl` has no equivalent in the `Slot` model shape, so a skin that needs
 * one is not previewable here; base skins do not use it.
 */
function vehicleOutputSlot(vehicle: VehicleInfo): Slot {
  const skin = vehicle.skins[0];
  if (!skin?.modelUrl || skin.skinUvUrl) return { name: vehicle.name, qty: 1 };
  return { name: vehicle.name, qty: 1, model: { url: skin.modelUrl, textures: skin.textures } };
}

export const vehicleRecipes: Recipe[] = vehicles.map((vehicle) => ({
  key: `vehicle-${vehicle.slug}`, title: vehicle.name, station: vehicle.station,
  time: (Number(vehicle.buildTime.match(/(\d+) h/)?.[1] ?? 0) * 60 + Number(vehicle.buildTime.match(/(\d+) min/)?.[1] ?? 0)) * 60,
  requirement: vehicle.requirement,
  ingredients: vehicle.inputs.split(", ").map((input) => {
    const [qty, ...rest] = input.split(" ");
    const name = rest.join(" ");
    const texture = vehicleInputTextures[name];
    return texture ? { name, qty: Number(qty), texture } : { name, qty: Number(qty) };
  }),
  output: vehicleOutputSlot(vehicle),
  note: `Construction takes ${vehicle.buildTime}; the vehicle spawns in the world.`,
}));
export const vehiclesSection: WikiSection = {
  nav: { href: "/wiki/vehicles", label: "Vehicles & Construction", category: "vehicles",
    blurb: "Build, crew, fuel and repair all 21 vehicles, with 3D previews and complete blueprints." },
  commands: vehicleCommands, recipes: [...vehicleRecipes, ...constructionStations],
};

export const vehicleAmmunition: string[][] = [
  [
    "Bullets",
    "bullet",
    "m.utils.bullet_box",
    "100",
    "15",
    "120 blocks",
    "Used by rifles and AA turrets"
  ],
  [
    "Flak Shells",
    "flak_bullet",
    "m.utils.flak_shells",
    "30",
    "20",
    "160 blocks, blast radius 10",
    "Explosive, yield: 0.0 (no terrain damage)"
  ],
  [
    "Cannonball",
    "cannonball",
    "m.utils.cannonball",
    "1",
    "20",
    "radius 8",
    "Explosive, sets fire, yield 2.0, applies Poison 10 s"
  ],
  [
    "Small Bomb",
    "small_bomb",
    "m.utils.small_bomb",
    "1",
    "20",
    "radius 10",
    "Fuse 20 ticks (1 s), yield 2.5"
  ],
  [
    "Small Bomb (rack)",
    "small_bomb_rack",
    "m.utils.small_bomb_rack",
    "8",
    "20",
    "radius 10",
    "Same bomb, 8 per load. Bomber, Cloudskimmer, Gyrobomber"
  ],
  [
    "Clusterbomb",
    "clusterbomb",
    "m.utils.clusterbomb",
    "1",
    "20 + 15 per sub",
    "radius 10, subs radius 8",
    "24 submunitions, spread 7.5, fuse 60 ticks (3 s). Behemoth, Cruiser, Fixed Artillery"
  ],
  [
    "Torpedo",
    "torpedo",
    "m.utils.torpedo",
    "1",
    "20",
    "radius 10",
    "Fuse 80 ticks (4 s). Torpedoboat only"
  ]
];

export const vehicleWeapons: string[][] = [
  [
    "gun_turret",
    "Mounted Rifle",
    "5 s",
    "4 ticks (0.2 s)",
    "bullet",
    "Cursor aim, 120 block range, 12 projectile damage, roll limited to ±60°"
  ],
  [
    "naval_cannon",
    "Naval Cannon",
    "5 s",
    "5 ticks (0.25 s)",
    "cannonball (+ clusterbomb on some)",
    "W/A/S/D traverse"
  ],
  [
    "aa_turret",
    "Anti-Air Turret",
    "10 s",
    "10 ticks (0.5 s)",
    "bullet",
    "W/A/S/D traverse"
  ],
  [
    "autocannon",
    "Autocannon",
    "5 s",
    "12 ticks (0.6 s)",
    "flak_bullet",
    "W/A/S/D traverse"
  ],
  [
    "flak_cannon",
    "Flak Cannon",
    "10 s",
    "15 ticks (0.75 s)",
    "flak_bullet",
    "W/A/S/D traverse"
  ]
];

export const vehicleArmour: string[][] = [
  [
    "aircraft",
    "0.0",
    "0.1",
    "1.3",
    "5.0",
    "5.0",
    "N/A",
    "5.0"
  ],
  [
    "airship",
    "0.0",
    "0.1",
    "2.0",
    "10.0",
    "1.8",
    "7.0",
    "2.0"
  ],
  [
    "armored",
    "0.0",
    "0.1",
    "1.5",
    "6.0",
    "1.3",
    "5.0",
    "N/A"
  ],
  [
    "wooden",
    "0.0",
    "0.1",
    "2.0",
    "10.0",
    "1.8",
    "7.0",
    "N/A"
  ],
  [
    "wagon",
    "0.0",
    "0.1",
    "1.5",
    "3.0",
    "1.3",
    "N/A",
    "N/A"
  ],
  [
    "emplacement",
    "N/A",
    "0.1",
    "1.3",
    "3.0",
    "2.0",
    "0.2",
    "N/A"
  ]
];

export const vehicleTrackItems: string[][] = [
  [
    "Track Small",
    "ia.tfmc:track_small",
    "lay a short segment"
  ],
  [
    "Track Medium",
    "ia.tfmc:track_medium",
    "lay a medium segment"
  ],
  [
    "Track Large",
    "ia.tfmc:track_large",
    "lay a long segment"
  ],
  [
    "Train Track",
    "ia.tfmc:train_track",
    "the track piece itself (64 per craft at the Block Station)"
  ],
  [
    "Railroad Switch",
    "ia.tfmc:railroad_switch",
    "switch/junction marker"
  ],
  [
    "Iron Shovel",
    "v.iron_shovel",
    "layer tool"
  ],
  [
    "Iron Pickaxe",
    "v.iron_pickaxe",
    "remover"
  ],
  [
    "Clock",
    "v.clock",
    "recorder"
  ],
  [
    "Diamond Shovel",
    "v.diamond_shovel",
    "junction tool"
  ]
];
