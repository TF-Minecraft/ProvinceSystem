import { advancedCraftingSection } from "./advanced-crafting";
import { archaeologySection } from "./archaeology";
import { armorStatuesSection } from "./armor-statues";
import { armourShopSection } from "./armour-shop";
import { birdMailSection } from "./bird-mail";
import { brewingSection } from "./brewing";
import { charactersSection } from "./characters";
import { classesSection } from "./classes";
import { codexSection } from "./codex";
import { commandIndexSection } from "./command-index";
import { companionPetsSection } from "./companion-pets";
import { cookingSection } from "./cooking";
import { animalHusbandrySection } from "./animal-husbandry";
import { detectorSection } from "./detector";
import { drinkBuilderSection } from "./drink-builder";
import { economySection } from "./economy";
import { equipmentSlotsSection } from "./equipment-slots";
import { factionsSection } from "./factions";
import { farmingSection } from "./farming";
import { fishingSection } from "./fishing";
import { furnitureSection } from "./furniture";
import { woodworkingSection } from "./woodworking";
import { gamesSection } from "./games";
import { dowsingSection } from "./dowsing";
import { gatheringSection } from "./gathering";
import { gemInfusionSection } from "./gem-infusion";
import { gettingStartedSection } from "./getting-started";
import { gunsSection } from "./guns";
import { harvestingSection } from "./harvesting";
import { infestationsSection } from "./infestations";
import { instrumentsSection } from "./instruments";
import { magicSection } from "./magic";
import { marketBlockSection } from "./market-blocks";
import { materialsSection } from "./materials";
import { recyclerSection } from "./recycler";
import { researchSection } from "./research";
import { serverFeaturesSection } from "./server-features";
import { sittingSection } from "./sitting";
import { stationsSection } from "./stations";
import { thieverySection } from "./thievery";
import { vehiclesSection } from "./vehicles";
import type {
  DuplicateCommand,
  Recipe,
  RegisteredCommand,
  WikiCommandSet,
  WikiSection,
} from "./types";

/**
 * The single registration point for wiki content. Adding a `WikiSection` wires
 * up its sidebar entry, overview card, recipes and commands at `/wiki/commands`.
 * Deriving these from one list keeps station pages and materials' "used in"
 * lists in sync with navigation. Missing registration is visible as an absent
 * sidebar entry and overview card, even if the section's page renders directly.
 */
export const wikiSections: readonly WikiSection[] = [
  gettingStartedSection,
  charactersSection,
  classesSection,
  equipmentSlotsSection,
  serverFeaturesSection,
  sittingSection,
  armorStatuesSection,
  advancedCraftingSection,
  furnitureSection,
  woodworkingSection,
  gatheringSection,
  dowsingSection,
  harvestingSection,
  farmingSection,
  fishingSection,
  cookingSection,
  animalHusbandrySection,
  brewingSection,
  drinkBuilderSection,
  magicSection,
  researchSection,
  codexSection,
  gemInfusionSection,
  archaeologySection,
  detectorSection,
  gunsSection,
  armourShopSection,
  infestationsSection,
  thieverySection,
  vehiclesSection,
  factionsSection,
  economySection,
  marketBlockSection,
  birdMailSection,
  companionPetsSection,
  gamesSection,
  instrumentsSection,
  recyclerSection,
  materialsSection,
  stationsSection,
  commandIndexSection,
];

/** Every recipe in the wiki, derived from the registry. Never hand-maintained. */
export const allRecipes: readonly Recipe[] = wikiSections.flatMap((s) => s.recipes ?? []);

/** Every registered command set, derived from the registry. Never hand-maintained. */
export const allCommands: readonly WikiCommandSet[] = wikiSections.flatMap((s) =>
  s.commands ? [s.commands]: []
);

/** The command set registered by the section at `href`, if it registered one. */
export function getCommandsForHref(href: string): WikiCommandSet | undefined {
  return allCommands.find((set) => set.href === href);
}

/**
 * Every individual command row across the whole wiki, each tagged with the
 * system and page that registered it, sorted alphabetically by command.
 */
export const allCommandRows: readonly RegisteredCommand[] = allCommands
  .flatMap((set) => set.commands.map((row) => ({ row, system: set.system, href: set.href })))
  .sort((a, b) => (a.row.command < b.row.command ? -1: a.row.command > b.row.command ? 1: 0));

/**
 * Commands claimed by more than one section. This remains available for
 * internal validation and is not shown in the player guide.
 */
export function findDuplicateCommands(
  sets: readonly WikiCommandSet[] = allCommands
): DuplicateCommand[] {
  const byCommand = new Map<string, RegisteredCommand[]>();
  for (const set of sets) {
    for (const row of set.commands) {
      const key = row.command.trim().toLowerCase();
      const entry: RegisteredCommand = { row, system: set.system, href: set.href };
      const bucket = byCommand.get(key);
      if (bucket) bucket.push(entry);
      else byCommand.set(key, [entry]);
    }
  }
  return [...byCommand.entries()]
    .filter(([, entries]) => new Set(entries.map((e) => e.href)).size > 1)
    .map(([command, registrations]) => ({ command, registrations }))
    .sort((a, b) => a.command.localeCompare(b.command));
}

/** The conflicts in the live registry, retained for internal validation. */
export const duplicateCommands: readonly DuplicateCommand[] = findDuplicateCommands();
