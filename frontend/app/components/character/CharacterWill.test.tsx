// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CharactersApiError, requestWill, searchHeirs, type CharacterListItem } from "../../../lib/characters/api";
import CharacterWill from "./CharacterWill";

vi.mock("../../../lib/characters/api", async (original) => ({
  ...(await original<typeof import("../../../lib/characters/api")>()),
  requestWill: vi.fn(),
  searchHeirs: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function character(extra: Partial<CharacterListItem> = {}): CharacterListItem {
  return {
    id: "c-ana",
    name: "Ana",
    status: "ALIVE",
    will: { heir_id: "c-kira", heir_name: "Kira", revision: 3 },
    ...extra,
  };
}

it("shows the heir with Change and Revoke, and revokes against the shown revision", async () => {
  vi.mocked(requestWill).mockResolvedValue({} as never);
  const changed = vi.fn();
  render(<CharacterWill character={character()} sessionToken="t" onChanged={changed} />);
  expect(screen.getByText("Kira")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(requestWill).toHaveBeenCalledWith("t", "c-ana", null, 3);
});

it("says No will and offers no Revoke", () => {
  render(
    <CharacterWill
      character={character({ will: { heir_id: null, heir_name: null, revision: 0 } })}
      sessionToken="t"
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByText("No will")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
});

it("searches from three letters and names the picked heir", async () => {
  vi.mocked(searchHeirs).mockResolvedValue([
    { id: "c-mara-1234", short_id: "c-mara-1", name: "Mara", race: "Elf", own: true },
  ]);
  vi.mocked(requestWill).mockResolvedValue({} as never);
  const changed = vi.fn();
  render(<CharacterWill character={character()} sessionToken="t" onChanged={changed} />);
  fireEvent.click(screen.getByRole("button", { name: "Change" }));
  const input = screen.getByPlaceholderText("Heir’s name");
  fireEvent.change(input, { target: { value: "ma" } });
  await new Promise((r) => setTimeout(r, 400));
  expect(searchHeirs).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "mar" } });
  const pick = await screen.findByRole("button", { name: /Mara/ });
  expect(pick.textContent).toContain("Elf · c-mara-1 · yours");
  expect(searchHeirs).toHaveBeenCalledWith("t", "mar", "c-ana");
  fireEvent.click(pick);
  await waitFor(() => expect(changed).toHaveBeenCalled());
  expect(requestWill).toHaveBeenCalledWith("t", "c-ana", "c-mara-1234", 3);
});

it("shows a waiting change instead of the buttons", () => {
  render(
    <CharacterWill
      character={character({
        will_request: {
          id: "r1",
          heir_character_id: "c-mara",
          heir_name: "Mara",
          base_revision: 3,
          status: "pending",
          result: null,
          created_at: "2026-10-13T12:00:00Z",
          acked_at: null,
        },
      })}
      sessionToken="t"
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("Pending: Mara");
  expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
});

it("shows why the server refused the last change", () => {
  render(
    <CharacterWill
      character={character({
        will_request: {
          id: "r1",
          heir_character_id: "c-mara",
          heir_name: "Mara",
          base_revision: 2,
          status: "acked",
          result: "stale",
          created_at: "2026-10-13T12:00:00Z",
          acked_at: "2026-10-13T12:00:15Z",
        },
      })}
      sessionToken="t"
      onChanged={vi.fn()}
    />,
  );
  expect(screen.getByText("Not saved: the will changed in game.")).toBeTruthy();
});

it("words the site's refusals", async () => {
  vi.mocked(requestWill).mockRejectedValue(new CharactersApiError("request_pending", 409));
  render(<CharacterWill character={character()} sessionToken="t" onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
  expect((await screen.findByRole("alert")).textContent).toBe("A change is already waiting for the server.");
});
