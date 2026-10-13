// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { characterFace, requestWill, type CharacterListItem } from "../../../lib/characters/api";
import CharacterList from "./CharacterList";

vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof import("../../../lib/characters/api")>()),
  characterFace: vi.fn(),
  requestWill: vi.fn(),
}));
vi.mock("../../../lib/account/api", () => ({ minecraftHeadUrl: () => "https://api.test/account/minecraft/head" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const open = vi.fn();

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
  render(
    <CharacterList
      onOpen={open}
      characters={characters}
      aliveCount={2}
      maxSlots={5}
      sessionToken="t"
      playerUuid="p-1"
    />,
  );
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toBe("data:image/png;base64,face"));
  await waitFor(() => expect(portrait("Brin")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1"));
  expect(portrait("Mira")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1");
  // A pending character has no wardrobe to read yet.
  expect(characterFace).toHaveBeenCalledTimes(2);
});

it("falls back to the player's head when the wardrobe can't be read", async () => {
  vi.mocked(characterFace).mockRejectedValue(new Error("down"));
  render(
    <CharacterList
      onOpen={open}
      characters={characters.slice(0, 1)}
      aliveCount={1}
      maxSlots={5}
      sessionToken="t"
      playerUuid="p-1"
    />,
  );
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1"));
});

it("offers a new character only while a slot is free", () => {
  const { rerender } = render(<CharacterList onOpen={open} characters={characters} aliveCount={2} maxSlots={5} />);
  expect(screen.getByText("2 of 5 slots used")).toBeTruthy();
  expect(screen.getByRole("link", { name: /New character/ }).getAttribute("href")).toBe("/character/create");
  rerender(<CharacterList onOpen={open} characters={characters} aliveCount={2} maxSlots={2} />);
  expect(screen.queryByRole("link", { name: /New character/ })).toBeNull();
  expect(screen.getByText("No free slot")).toBeTruthy();
});

it("reads the faces again when the list reloads, and never shows another session's", async () => {
  vi.mocked(characterFace).mockResolvedValue("data:image/png;base64,old");
  const one = characters.slice(0, 1);
  const { rerender } = render(
    <CharacterList onOpen={open} characters={one} aliveCount={1} maxSlots={5} sessionToken="t" playerUuid="p-1" />,
  );
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toBe("data:image/png;base64,old"));
  // A re-render with the same list doesn't fetch again.
  rerender(
    <CharacterList onOpen={open} characters={one} aliveCount={1} maxSlots={5} sessionToken="t" playerUuid="p-1" />,
  );
  expect(characterFace).toHaveBeenCalledTimes(1);

  vi.mocked(characterFace).mockResolvedValue("data:image/png;base64,new");
  rerender(
    <CharacterList onOpen={open} characters={[...one]} aliveCount={1} maxSlots={5} sessionToken="t" playerUuid="p-1" />,
  );
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toBe("data:image/png;base64,new"));

  let resolve!: (face: string) => void;
  vi.mocked(characterFace).mockReturnValue(new Promise((r) => (resolve = r)));
  rerender(
    <CharacterList onOpen={open} characters={one} aliveCount={1} maxSlots={5} sessionToken="u" playerUuid="p-1" />,
  );
  // The new session's face is still loading: an empty square, not the old face.
  expect(portrait("Vaelthir")).toBeNull();
  resolve("data:image/png;base64,other");
  await waitFor(() => expect(portrait("Vaelthir")?.getAttribute("src")).toBe("data:image/png;base64,other"));
});

it("opens a character inside the tab, the dead read only, but not a rejected one", () => {
  render(
    <CharacterList
      onOpen={open}
      characters={[
        ...characters,
        { id: "c4", name: "Old Tamsin", status: "DEAD" } as CharacterListItem,
        { id: "c5", name: "Nope", status: "rejected", error: "No free slot" } as CharacterListItem,
      ]}
      aliveCount={2}
      maxSlots={5}
    />,
  );
  const card = screen.getByText("Vaelthir").closest("a")!;
  expect(card.getAttribute("href")).toBe("/profile?tab=characters&character=c1");
  fireEvent.click(card);
  expect(open).toHaveBeenCalledWith("c1");
  // A new-tab click follows the address instead.
  fireEvent.click(card, { ctrlKey: true });
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Mira").closest("a")).toBeTruthy();
  expect(screen.getByText("Old Tamsin").closest("a")?.getAttribute("href")).toBe(
    "/profile?tab=characters&character=c4",
  );
  expect(screen.getByText("Nope").closest("a")).toBeNull();
});

it("shows each living character's will under its card", () => {
  vi.mocked(characterFace).mockResolvedValue(null);
  const withWill = [
    { id: "c1", name: "Vaelthir", status: "ALIVE", will: { heir_id: "c9", heir_name: "Kira", revision: 1 } },
    { id: "c2", name: "Brin", status: "ALIVE", will: { heir_id: null, heir_name: null, revision: 0 } },
    { id: "c4", name: "Old Tamsin", status: "DEAD" },
  ] as CharacterListItem[];
  render(<CharacterList onOpen={open} characters={withWill} aliveCount={2} maxSlots={5} sessionToken="t" />);
  const vaelthir = screen.getByText("Vaelthir").closest("li")!;
  expect(vaelthir.textContent).toContain("Heir: Kira");
  // The will sits beside the card's link, not inside it.
  expect(screen.getByText("Kira").closest("a")).toBeNull();
  expect(screen.getByText("Brin").closest("li")!.textContent).toContain("No will");
  expect(screen.getByText("Old Tamsin").closest("li")!.textContent).not.toMatch(/will|Heir/);
});

it.each([true, false])("refreshes Profile after a will revoke with an explicit callback: %s", async (explicit) => {
  vi.mocked(characterFace).mockResolvedValue(null);
  vi.mocked(requestWill).mockResolvedValue({
    id: "request-1",
    heir_character_id: null,
    heir_name: null,
    base_revision: 3,
    status: "pending",
    result: null,
    created_at: "2026-10-13T17:00:00Z",
    acked_at: null,
  });
  const refresh = vi.fn();
  const changed = vi.fn();
  const character = {
    id: "c1",
    name: "Vaelthir",
    status: "ALIVE",
    will: { heir_id: "c9", heir_name: "Kira", revision: 3 },
  } as CharacterListItem;
  render(
    <CharacterList
      onOpen={open}
      characters={[character]}
      aliveCount={1}
      maxSlots={5}
      sessionToken="profile-session"
      onRefresh={refresh}
      onWillChanged={explicit ? changed : undefined}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(requestWill).toHaveBeenCalledWith("profile-session", "c1", null, 3));
  await waitFor(() => expect(explicit ? changed : refresh).toHaveBeenCalledTimes(1));
  expect(explicit ? refresh : changed).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
