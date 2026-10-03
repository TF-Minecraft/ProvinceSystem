/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import SupporterPanel from "./SupporterPanel";
import { getPatreonStatus, startPatreonLink } from "../../../lib/profile/patreon";

vi.mock("../../../lib/profile/patreon", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../../lib/profile/patreon")>(),
  getPatreonStatus: vi.fn(),
  startPatreonLink: vi.fn(),
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows a failed Connect action in the not-linked state", async () => {
  vi.mocked(getPatreonStatus).mockResolvedValue({ linked: false });
  vi.mocked(startPatreonLink).mockRejectedValue(new Error("patreon_client_unconfigured"));
  render(<SupporterPanel sessionToken="session" />);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Patreon" }));
  expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t open Patreon just now. Please try again.");
  expect((screen.getByRole("button", { name: "Connect Patreon" }) as HTMLButtonElement).disabled).toBe(false);
});
