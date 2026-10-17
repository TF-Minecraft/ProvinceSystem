/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PersonCases from "./PersonCases";
import { getPersonCases, type PersonCasePage } from "@/lib/precedent/people";
import { createCase, updateCase } from "@/lib/precedent/api";

vi.mock("@/lib/precedent/people", async (original) => ({
  ...(await original<typeof import("@/lib/precedent/people")>()),
  getPersonCases: vi.fn(),
}));
vi.mock("@/lib/precedent/api", () => ({ createCase: vi.fn(), updateCase: vi.fn() }));

const DISCORD = "422545450919526411";
const UUID = "0615a817-8cb4-4aef-95f7-f6c9bf7611b8";
const PAGE: PersonCasePage = {
  person: {
    player_uuid: null,
    discord_user_id: DISCORD,
    minecraft_name: null,
    discord_username: "discord_only",
    name: "discord_only",
    legacy_names_complete: true,
  },
  entries: [
    {
      id: "case:case-1",
      case_id: "case-1",
      kind: "case",
      logged_by: "Moderator",
      players: ["OldHandle"],
      participants: [{ discord_user_id: DISCORD, name: "OldHandle" }],
      summary: "Discord harassment",
      rule: "1.1",
      ruling: "Evidence reviewed",
      punishment: "Warning",
      created_at: "2026-10-17T10:00:00Z",
      matched_by: "account",
    },
  ],
  total: 1,
  limit: 25,
  offset: 0,
};

beforeEach(() => {
  vi.mocked(getPersonCases).mockResolvedValue(PAGE);
  vi.mocked(createCase).mockResolvedValue({ id: "new-case" });
  vi.mocked(updateCase).mockResolvedValue({ updated: true, id: "case-1" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows a Discord-only account and its full case without a Minecraft link", async () => {
  render(<PersonCases subject={{ discordId: DISCORD }} standalone />);
  expect(await screen.findByRole("heading", { name: "@discord_only" })).toBeTruthy();
  expect(screen.getByText(/No Minecraft account linked/)).toBeTruthy();
  expect(screen.getByText("Discord harassment")).toBeTruthy();
  fireEvent.click(screen.getByText("Details"));
  expect(screen.getByText("Evidence reviewed")).toBeTruthy();
  expect(screen.getByText("Rule: 1.1")).toBeTruthy();
  expect(screen.getByText(`OldHandle: Discord ${DISCORD}`)).toBeTruthy();
  expect(screen.queryByText("Older name match")).toBeNull();
});

it("logs a case directly against the account without typing a player name", async () => {
  render(<PersonCases subject={{ discordId: DISCORD }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Log case" }));
  expect(screen.queryByLabelText("Players")).toBeNull();
  expect(screen.getByText("Account links: discord_only")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "A new incident" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(createCase).toHaveBeenCalledOnce());
  const payload = vi.mocked(createCase).mock.calls[0][0];
  expect(payload.players).toEqual(["discord_only"]);
  expect(payload.participants).toEqual([
    { name: "discord_only", discord_user_id: DISCORD, player_uuid: null, discord_username: "discord_only" },
  ]);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(getPersonCases).toHaveBeenCalledTimes(2);
});

it("keeps the account IDs when editing an existing case", async () => {
  render(<PersonCases subject={{ discordId: DISCORD }} />);
  await screen.findByText("Discord harassment");
  fireEvent.click(screen.getByText("Details"));
  fireEvent.click(screen.getByRole("button", { name: "Edit case" }));
  fireEvent.change(screen.getByLabelText("Summary"), { target: { value: "Corrected summary" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(updateCase).toHaveBeenCalledOnce());
  expect(vi.mocked(updateCase).mock.calls[0][1].participants).toEqual(PAGE.entries[0].participants);
});

it("labels old name matches and warns when name history is incomplete", async () => {
  vi.mocked(getPersonCases).mockResolvedValue({
    ...PAGE,
    person: { ...PAGE.person, player_uuid: UUID, legacy_names_complete: false },
    entries: [{ ...PAGE.entries[0], matched_by: "name", participants: [] }],
  });
  render(<PersonCases subject={{ playerUuid: UUID }} />);
  expect(await screen.findByText("Older name match")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("Some older name-only cases may be missing");
});

it("paginates every record for the same account", async () => {
  vi.mocked(getPersonCases)
    .mockResolvedValueOnce({ ...PAGE, total: 26 })
    .mockResolvedValueOnce({ ...PAGE, total: 26, offset: 25, entries: [{ ...PAGE.entries[0], summary: "Last case" }] });
  render(<PersonCases subject={{ discordId: DISCORD }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Next" }));
  expect(await screen.findByText("Last case")).toBeTruthy();
  expect(getPersonCases).toHaveBeenLastCalledWith({ discordId: DISCORD }, 25);
  expect(screen.getByText("Page 2 of 2")).toBeTruthy();
});

it("offers a retry for a failed load and does not claim there are no cases", async () => {
  vi.mocked(getPersonCases).mockRejectedValueOnce(new Error("Network failure"));
  render(<PersonCases subject={{ discordId: DISCORD }} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(screen.queryByText("No cases recorded for this account.")).toBeNull();
  expect(await screen.findByText("Discord harassment")).toBeTruthy();
});

it("renders an empty account without requiring Minecraft or a previous case", async () => {
  vi.mocked(getPersonCases).mockResolvedValue({ ...PAGE, entries: [], total: 0 });
  render(<PersonCases subject={{ discordId: DISCORD }} standalone />);
  expect(await screen.findByText("No cases recorded for this account.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Log case" })).toBeTruthy();
});
