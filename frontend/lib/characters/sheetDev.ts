/** UI-dev fixture for the read-only character sheet. */

import type { CharacterListItem } from "./api";
import { UI_DEV_LORE_CHARACTER_ID } from "./loreItemsDev";

export function uiDevSheetCharacter(characterId: string = UI_DEV_LORE_CHARACTER_ID): CharacterListItem {
  return {
    id: characterId || UI_DEV_LORE_CHARACTER_ID,
    name: "UI Dev Character",
    status: "ALIVE",
    race: "human",
    class: "warrior",
    race_name: "Human",
    class_name: "Warrior",
    age: "24",
    birthday: "326-09-26",
    gender: "female",
    description: "A quiet scout from the borderlands. Keeps to the trees and trusts few.",
    background: "Born under a red moon among the border hills.\nTrained with scouts who keep to the trees.",
    attributes: {
      strength: 2,
      dexterity: 3,
      constitution: 2,
      intelligence: 0,
      wisdom: 2,
      charisma: 1,
    },
    experience_modifiers: [
      { profession: "miner", alias: "Miner Experience", amount: -10 },
      { profession: "forester", alias: "Forester Experience", amount: 5 },
      { profession: "smith", alias: "Smith Experience", amount: 0 },
    ],
    traits: [
      { id: "cheerful", name: "Cheerful", key: "personality" },
      { id: "soft_spoken", name: "Soft Spoken", key: "personality" },
      { id: "cruel", name: "Cruel", key: "evil" },
    ],
    clues: ["Saw a red banner at dusk near the mill road.", "Heard wolves circling the eastern woods."],
    kit_status: "eligible",
    kit_statuses: { starter: "eligible" },
    source: "roster",
  };
}
