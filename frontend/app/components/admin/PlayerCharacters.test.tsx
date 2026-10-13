// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PlayerProfile } from "../../../lib/admin/api";
import { characterFigure } from "../../../lib/characters/api";
import PlayerCharacters from "./PlayerCharacters";

const nav = vi.hoisted(() => ({ query: "tab=characters", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: nav.push }),
}));
vi.mock("../../../lib/admin/api", async (original) => ({
  ...(await original<typeof import("../../../lib/admin/api")>()),
  getPlayerCharacterCatalog: vi.fn(async () => null),
}));
vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof import("../../../lib/characters/api")>()),
  characterFigure: vi.fn(),
}));
vi.mock("../../../lib/account/api", () => ({ minecraftHeadUrl: () => "https://api.test/account/minecraft/head" }));

const profile = {
  uuid: "p-1",
  characters: [
    {
      id: "c1",
      character_id: "c1",
      realm_id: "main",
      name: "Hazel",
      status: "ALIVE",
      race_name: "Human",
      class_name: "Smith",
      description: "A traveller in green.",
      attributes: { strength: 4 },
      traits: [{ id: "patient", name: "Patient", key: "personality" }],
      background: "Raised in the woods.",
      clues: ["Carries a red banner."],
      updated_at: null,
    },
    { id: "c1", character_id: "c1", realm_id: "tutorial", name: "Tutorial Hazel", status: "ALIVE", updated_at: null },
    { id: "old", character_id: "old", realm_id: "main", name: "Old Hazel", status: "DEAD", updated_at: null },
  ],
} as PlayerProfile;
const base = "/admin/players/p-1?tab=characters";

beforeEach(() => {
  nav.query = "tab=characters";
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

it("opens portrait cards inside the staff player, including the realm and historical characters", () => {
  render(<PlayerCharacters profile={profile} active />);
  const card = screen.getByRole("link", { name: /Tutorial Hazel/ });
  const href = `${base}&character=c1&realm=tutorial`;
  expect(card.getAttribute("href")).toBe(href);
  expect(card.querySelector("img")?.getAttribute("src")).toBe(
    "https://api.test/admin/players/p-1/characters/c1/face?realm_id=tutorial",
  );
  expect(screen.getByRole("link", { name: /Old Hazel/ })).toBeTruthy();
  expect(
    within(screen.getByRole("heading", { name: "Dead" }).parentElement!).getByRole("link", { name: /Old Hazel/ }),
  ).toBeTruthy();
  expect(screen.queryByText(/^Alive/)).toBeNull();
  expect(screen.queryByText("New character")).toBeNull();
  expect(screen.getByText("Human · Smith")).toBeTruthy();
  fireEvent.click(card);
  expect(nav.push).toHaveBeenCalledWith(href, { scroll: false });
  fireEvent.click(card, { ctrlKey: true });
  expect(nav.push).toHaveBeenCalledTimes(1);
});

it("opens the shared full sheet from its address, focuses the name and keeps the back link", () => {
  nav.query = "tab=characters&character=c1&realm=main";
  render(<PlayerCharacters profile={profile} active />);
  const heading = screen.getByRole("heading", { name: "Hazel", level: 2 });
  expect(document.activeElement).toBe(heading);
  expect(screen.getByText("A traveller in green.")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Attributes" })).toBeTruthy();
  expect(screen.getByText("Patient")).toBeTruthy();
  expect(screen.getByText("Raised in the woods.")).toBeTruthy();
  expect(screen.getByText("Carries a red banner.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "← Characters" }).getAttribute("href")).toBe(base);
  fireEvent.click(screen.getByRole("link", { name: "← Characters" }));
  expect(nav.push).toHaveBeenCalledWith(base, { scroll: false });
  expect(screen.queryByRole("link", { name: "Wardrobe" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Kits" })).toBeNull();
  const figure = screen.getByAltText("Hazel's skin");
  expect(figure.getAttribute("src")).toContain("/admin/players/p-1/characters/c1/figure?realm_id=main");
  expect(characterFigure).not.toHaveBeenCalled();
  fireEvent.error(figure);
  expect(screen.queryByAltText("Hazel's skin")).toBeNull();
  expect(document.querySelector("img")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1");
});

it("keeps staff cards and sheets read only when the roster carries a living will", () => {
  const withWill = {
    ...profile,
    characters: [{ ...profile.characters[0], will: { heir_id: "heir", heir_name: "Kira", revision: 3 } }],
  };
  const { rerender } = render(<PlayerCharacters profile={withWill} active />);
  expect(screen.getByRole("link", { name: /Hazel Human/ })).toBeTruthy();
  expect(screen.queryByText("Kira")).toBeNull();
  expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  nav.query = "tab=characters&character=c1&realm=main";
  rerender(<PlayerCharacters profile={withWill} active />);
  expect(screen.getByRole("heading", { name: "Hazel", level: 2 })).toBeTruthy();
  expect(screen.getByText("A traveller in green.")).toBeTruthy();
  expect(screen.queryByText("Kira")).toBeNull();
  expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Wardrobe" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Kits" })).toBeNull();
  expect(characterFigure).not.toHaveBeenCalled();
});

it("keeps characters with the same id in different realms separate when navigating", () => {
  nav.query = "tab=characters&character=c1&realm=main";
  const { rerender } = render(<PlayerCharacters profile={profile} active />);
  nav.query = "tab=characters&character=c1&realm=tutorial";
  rerender(<PlayerCharacters profile={profile} active />);
  expect(screen.getByRole("heading", { name: "Tutorial Hazel" })).toBeTruthy();
  expect(screen.queryByText("A traveller in green.")).toBeNull();
  expect(screen.getByAltText("Tutorial Hazel's skin").getAttribute("src")).toContain("realm_id=tutorial");
  nav.query = "tab=characters";
  rerender(<PlayerCharacters profile={profile} active />);
  expect(screen.getByRole("link", { name: /Tutorial Hazel/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Hazel Human/ })).toBeTruthy();
});

it("falls back from a missing character portrait to the player's head", () => {
  render(<PlayerCharacters profile={profile} active />);
  const card = screen.getByRole("link", { name: /Tutorial Hazel/ });
  fireEvent.error(card.querySelector("img")!);
  expect(card.querySelector("img")?.getAttribute("src")).toContain("/account/minecraft/head?u=p-1");
  fireEvent.error(card.querySelector("img")!);
  expect(card.querySelector("img")).toBeNull();
});

it("shows empty and stale character links without switching to a different character", () => {
  const { rerender } = render(<PlayerCharacters profile={{ ...profile, characters: [] }} active />);
  expect(screen.getByText("No characters.")).toBeTruthy();
  nav.query = "tab=characters&character=gone&realm=main";
  rerender(<PlayerCharacters profile={profile} active />);
  expect(screen.getByRole("status").textContent).toBe("Character no longer available.");
  expect(screen.getByRole("link", { name: "← Characters" }).getAttribute("href")).toBe(base);
  expect(screen.queryByRole("heading", { name: "Hazel" })).toBeNull();
  expect(nav.push).not.toHaveBeenCalled();
});
