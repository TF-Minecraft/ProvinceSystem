// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { characterFigure, type CharacterListItem, type CreationCatalog } from "../../../lib/characters/api";
import CharacterSheet from "./CharacterSheet";

vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof import("../../../lib/characters/api")>()),
  characterFigure: vi.fn(async () => null),
}));
vi.mock("../../../lib/account/api", () => ({ minecraftHeadUrl: () => "https://api.test/account/minecraft/head" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CATALOG = {
  attribute_point_buy: {
    pool: 12,
    max_rank: 4,
    cost_for_rank: [1, 1, 1, 1],
    attributes: ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"],
  },
} as unknown as CreationCatalog;

const VAELTHIR = {
  id: "c1",
  name: "Vaelthir",
  status: "ALIVE",
  race_name: "Elf",
  class_name: "Archer",
  age: "112",
  gender: "Male",
  description: "Tall and lean.",
  background: "Raised in the eastern woods.",
  attributes: { charisma: 0, dexterity: 4, strength: 1, constitution: 2, intelligence: 2, wisdom: 3 },
  experience_modifiers: [
    { profession: "forester", alias: "Forester Experience", amount: 10 },
    { profession: "miner", alias: "Miner Experience", amount: -10 },
  ],
  traits: [
    { id: "patient", name: "Patient", key: "personality" },
    { id: "cruel", name: "Cruel", key: "evil" },
    { id: "drunk", name: "Drunk", key: "personality", duration_remaining_ms: 5_400_000 },
  ],
  clues: ["Saw a red banner at dusk."],
  kit_status: "ineligible",
} as CharacterListItem;

it("leads with who the character is and where to dress and equip them", () => {
  render(<CharacterSheet character={VAELTHIR} catalog={CATALOG} sessionToken="t" playerUuid="p-1" />);
  expect(screen.getByRole("heading", { level: 2, name: "Vaelthir" })).toBeTruthy();
  expect(screen.getByText("Elf · Archer")).toBeTruthy();
  expect(screen.getByText("112")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Wardrobe" }).getAttribute("href")).toBe("/character/c1/wardrobe");
  const kits = screen.getByRole("link", { name: "Kits" });
  expect(kits.getAttribute("href")).toBe("/character/c1/kits");
  // Legacy "ineligible" reads like the Kits page.
  expect(document.getElementById(kits.getAttribute("aria-describedby")!)!.textContent).toBe(
    "Starter kit: Not yet claimed",
  );
  expect(characterFigure).toHaveBeenCalledWith("t", "c1");
});

it("lists attributes in the catalogue's order with their rank out of the maximum", () => {
  render(<CharacterSheet character={VAELTHIR} catalog={CATALOG} />);
  const tiles = within(screen.getByRole("heading", { name: "Attributes" }).parentElement!).getAllByRole("listitem");
  expect(tiles.map((t) => t.textContent)).toEqual([
    "Strength1 of 4",
    "Dexterity4 of 4",
    "Constitution2 of 4",
    "Intelligence2 of 4",
    "Wisdom3 of 4",
    "Charisma0 of 4",
  ]);
});

it("signs profession EXP and sets timed traits apart", () => {
  render(<CharacterSheet character={VAELTHIR} catalog={CATALOG} />);
  expect(screen.getByText("Forester").nextSibling!.textContent).toBe("+10%");
  expect(screen.getByText("Miner").nextSibling!.textContent).toBe("−10%");
  expect(screen.getByRole("heading", { name: "Evil" })).toBeTruthy();
  expect(screen.getByText("Drunk").nextSibling!.textContent).toBe("1h remaining");
  expect(screen.getByRole("heading", { name: "Temporary" })).toBeTruthy();
});

it("says plainly what a new character doesn't have yet, and hides an empty story", () => {
  render(<CharacterSheet character={{ id: "c2", name: "Mira", status: "pending" }} />);
  expect(screen.getByText("No profession EXP modifiers.")).toBeTruthy();
  expect(screen.getByText("No traits recorded.")).toBeTruthy();
  expect(screen.getByText("No clues discovered yet.")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Story" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Attributes" })).toBeNull();
  // A pending character has no wardrobe to read yet.
  expect(characterFigure).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("Being added to the server.");
});

it("cancels a pending character only after confirming", () => {
  const cancel = vi.fn();
  const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<CharacterSheet character={{ id: "c2", name: "Mira", status: "PENDING" }} onCancelPending={cancel} />);
  const button = screen.getByRole("button", { name: "Cancel submission" });
  fireEvent.click(button);
  expect(cancel).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(cancel).toHaveBeenCalledTimes(1);
  confirm.mockRestore();
});

it("opens a long background on an excerpt and shows it whole on request", () => {
  const first = "He kept the eels. ".repeat(40).trim();
  const rest = "He swore to rebuild the Marsh. ".repeat(30).trim();
  render(<CharacterSheet character={{ ...VAELTHIR, background: `${first}\n\n${rest}` }} catalog={CATALOG} />);
  const more = screen.getByRole("button", { name: "Read full background" });
  const story = document.getElementById(more.getAttribute("aria-controls")!)!;
  expect(story.textContent).not.toContain("rebuild");
  fireEvent.click(more);
  expect(story.querySelectorAll("p")).toHaveLength(2);
  expect(story.textContent).toContain("rebuild");
  expect(more.textContent).toBe("Show less");
  expect(more.getAttribute("aria-expanded")).toBe("true");
});
