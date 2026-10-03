/** @vitest-environment jsdom */
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PatreonLinkConfirmation from "./PatreonLinkConfirmation";
import { getPatreonLinkedResult } from "../../../lib/profile/patreonLinked";

const fallback = getPatreonLinkedResult("denied", null);
const fetchMock = vi.fn();
const pending = { target_kind: "discord", target_name: "AttackerDiscord", patreon_name: "Paying Supporter" };
function response(body: unknown) {
  return { ok: true, json: async () => body };
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.invalid");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  window.history.replaceState({}, "", "/patreon/linked#confirm=secret-token");
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("removes the fragment, names both accounts, and waits for an explicit confirmation", async () => {
  fetchMock.mockResolvedValueOnce(response(pending)).mockResolvedValueOnce(response({ status: "ok", tier: "noble" }));
  render(<PatreonLinkConfirmation fallback={fallback} />);
  expect(window.location.hash).toBe("");
  expect(await screen.findByText("AttackerDiscord")).toBeTruthy();
  expect(screen.getByText("Paying Supporter")).toBeTruthy();
  expect(screen.getByText(/Continue only if.*account is yours/)).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).not.toContain("secret-token");
  expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ token: "secret-token" }) });
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Your Patreon is linked and your Noble supporter perks are ready.")).toBeTruthy();
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/link\/confirm$/);
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
});

it("cancels without calling confirm and displays fixed cancellation copy", async () => {
  fetchMock.mockResolvedValueOnce(response({ ...pending, target_kind: "minecraft", target_name: "AttackerSteve" }))
    .mockResolvedValueOnce(response({ status: "ok" }));
  render(<PatreonLinkConfirmation fallback={fallback} />);
  expect(await screen.findByText("AttackerSteve")).toBeTruthy();
  expect(screen.getByText(/Minecraft account:/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByText("Link not completed")).toBeTruthy();
  expect(fetchMock.mock.calls[1][0]).toMatch(/\/link\/cancel$/);
});

it.each(["ok", "not_a_member", "already_linked", "relink_cooldown", "expired", "error"])("shows fixed copy for confirmation status %s", async (status) => {
  fetchMock.mockResolvedValueOnce(response(pending)).mockResolvedValueOnce(response({ status, tier: "" }));
  render(<PatreonLinkConfirmation fallback={fallback} />);
  fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));
  expect(await screen.findByText(getPatreonLinkedResult(status, null).title)).toBeTruthy();
});

it("uses query result copy when there is no confirmation fragment", async () => {
  window.history.replaceState({}, "", "/patreon/linked?status=denied");
  render(<PatreonLinkConfirmation fallback={fallback} />);
  expect(await screen.findByText("Link not completed")).toBeTruthy();
  expect(fetchMock).not.toHaveBeenCalled();
});

it("prioritizes confirmation over query status and renders API names as text", async () => {
  window.history.replaceState({}, "", "/patreon/linked?status=ok#confirm=secret-token");
  const name = '<img src="x" onerror="alert(1)">';
  fetchMock.mockResolvedValue(response({ ...pending, target_name: name }));
  const { container } = render(<PatreonLinkConfirmation fallback={getPatreonLinkedResult("ok", null)} />);
  expect(await screen.findByText(name)).toBeTruthy();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.queryByText("You’re all set")).toBeNull();
});

it("shows expired for an invalid token with no confirmation controls", async () => {
  fetchMock.mockResolvedValue(response({ status: "expired" }));
  render(<PatreonLinkConfirmation fallback={fallback} />);
  expect(await screen.findByText("Link expired")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});

it("shows fixed error copy on a network failure", async () => {
  fetchMock.mockRejectedValue(new Error("sensitive server detail"));
  render(<PatreonLinkConfirmation fallback={fallback} />);
  expect(await screen.findByText("Something went wrong")).toBeTruthy();
  expect(screen.queryByText(/sensitive/)).toBeNull();
});

it("keeps the token through StrictMode effect replay", async () => {
  fetchMock.mockResolvedValue(response(pending));
  render(<StrictMode><PatreonLinkConfirmation fallback={fallback} /></StrictMode>);
  expect(await screen.findByText("AttackerDiscord")).toBeTruthy();
  await waitFor(() => expect(fetchMock.mock.calls.every((call) => call[1].body === JSON.stringify({ token: "secret-token" }))).toBe(true));
  expect(window.location.hash).toBe("");
});
