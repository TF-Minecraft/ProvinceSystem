/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import JoinServer from "./JoinServer";

const getGameServer = vi.hoisted(() => vi.fn());
vi.mock("@/lib/diagnostic/api", () => ({ getGameServer }));

afterEach(() => {
  cleanup();
  getGameServer.mockReset();
});

it("shows the address without the default port and the player count", async () => {
  getGameServer.mockResolvedValue({
    address: "play.tfminecraft.net:25565",
    online: true,
    players_online: 18,
    players_max: 100,
    game_version: "1.21.10",
  });
  render(<JoinServer />);
  expect(await screen.findByText("18 players online")).toBeTruthy();
  expect(screen.getByText("play.tfminecraft.net")).toBeTruthy();
  expect(screen.getByText("Java 1.21.10")).toBeTruthy();
});

it("says the server is offline when the ping fails", async () => {
  getGameServer.mockRejectedValue(new Error("HTTP 502"));
  render(<JoinServer />);
  expect(await screen.findByText("Offline")).toBeTruthy();
  expect(screen.getByText("play.tfminecraft.net")).toBeTruthy();
});

it("says online without a count when the ping has none", async () => {
  getGameServer.mockResolvedValue({
    address: "play.tfminecraft.net:25565",
    online: true,
    players_online: null,
    players_max: null,
    game_version: "1.21.10",
  });
  render(<JoinServer />);
  expect(await screen.findByText("Online")).toBeTruthy();
});

it("keeps a non-default port in the address", async () => {
  getGameServer.mockResolvedValue({
    address: "play.tfminecraft.net:25570",
    online: true,
    players_online: 0,
    players_max: 100,
    game_version: "1.21.10",
  });
  render(<JoinServer />);
  expect(await screen.findByText("0 players online")).toBeTruthy();
  expect(screen.getByText("play.tfminecraft.net:25570")).toBeTruthy();
});

it("selects the address when the clipboard refuses", async () => {
  getGameServer.mockReturnValue(new Promise(() => {}));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  render(<JoinServer />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByRole("button", { name: "Copy by hand" })).toBeTruthy();
  expect(window.getSelection()?.toString()).toBe("play.tfminecraft.net");
});

it("selects the address when there is no clipboard", async () => {
  getGameServer.mockReturnValue(new Promise(() => {}));
  Object.assign(navigator, { clipboard: undefined });
  render(<JoinServer />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(await screen.findByRole("button", { name: "Copy by hand" })).toBeTruthy();
});

it("stops polling once unmounted", async () => {
  vi.useFakeTimers();
  try {
    getGameServer.mockResolvedValue({
      address: "play.tfminecraft.net:25565",
      online: true,
      players_online: 1,
      players_max: 100,
      game_version: "1.21.10",
    });
    const { unmount } = render(<JoinServer />);
    expect(getGameServer).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(getGameServer).toHaveBeenCalledTimes(2);
    unmount();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(getGameServer).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it("copies the address", async () => {
  getGameServer.mockReturnValue(new Promise(() => {}));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
  render(<JoinServer />);
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  expect(writeText).toHaveBeenCalledWith("play.tfminecraft.net");
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});
