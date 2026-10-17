/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import CaseTags from "./CaseTags";

afterEach(cleanup);
const empty = { rule: "", ruling: "", punishment: "", players: [] };

it("links a Discord-only participant even when the legacy player list is empty", () => {
  render(
    <CaseTags row={{ ...empty, participants: [{ discord_user_id: "500000000000000001", name: "Discord person" }] }} />,
  );
  expect(screen.getByRole("link", { name: "Discord person" }).getAttribute("href")).toBe(
    "/admin/people/discord/500000000000000001",
  );
});

it("links a Minecraft-only participant by UUID", () => {
  const uuid = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
  render(<CaseTags row={{ ...empty, participants: [{ player_uuid: uuid, name: "Minecraft person" }] }} />);
  expect(screen.getByRole("link", { name: "Minecraft person" }).getAttribute("href")).toBe(
    `/admin/players/${uuid}?tab=cases`,
  );
});

it("shows legacy labels without guessing an account link", () => {
  render(<CaseTags row={{ ...empty, players: ["OldName"] }} />);
  expect(screen.getByText("OldName")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});
