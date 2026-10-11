// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { CharacterListItem } from "../../../lib/characters/api";
import { characterFace } from "../../../lib/characters/face";
import CharacterList from "./CharacterList";

vi.mock("../../../lib/characters/face", () => ({ characterFace: vi.fn() }));
vi.mock("../../../lib/account/api", () => ({ minecraftHeadUrl: () => "https://api.test/account/minecraft/head" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const characters = [
  { id: "c1", name: "Vaelthir", status: "ALIVE" },
  { id: "c2", name: "Brin", status: "ALIVE" },
  { id: "c3", name: "Mira", status: "pending" },
] as CharacterListItem[];

function portrait(name: string): HTMLImageElement | null {
  return screen.getByText(name).closest("li")!.querySelector("img");
}

it("shows each character's skin face, else the player's head", async () => {
  vi.mocked(characterFace).mockImplementation(async (_token, id) =>
    id === "c1" ? "data:image/png;base64,face" : null,
  );
  render(<CharacterList characters={characters} aliveCount={2} maxSlots={5} sessionToken="t" playerUuid="p-1" />);
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toBe("data:image/png;base64,face"));
  await waitFor(() => expect(portrait("Brin")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1"));
  expect(portrait("Mira")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1");
  // A pending character has no wardrobe to read yet.
  expect(characterFace).toHaveBeenCalledTimes(2);
});

it("falls back to the player's head when the wardrobe can't be read", async () => {
  vi.mocked(characterFace).mockRejectedValue(new Error("down"));
  render(
    <CharacterList characters={characters.slice(0, 1)} aliveCount={1} maxSlots={5} sessionToken="t" playerUuid="p-1" />,
  );
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1"));
});

it("offers a new character only while a slot is free", () => {
  const { rerender } = render(<CharacterList characters={characters} aliveCount={2} maxSlots={5} />);
  expect(screen.getByText("2 of 5 slots used")).toBeTruthy();
  expect(screen.getByRole("link", { name: /New character/ }).getAttribute("href")).toBe("/character/create");
  rerender(<CharacterList characters={characters} aliveCount={2} maxSlots={2} />);
  expect(screen.queryByRole("link", { name: /New character/ })).toBeNull();
  expect(screen.getByText("No free slot")).toBeTruthy();
});
