/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SiteHeader from "./SiteHeader";

let pathname = "/map";
let accountRole: string | null = null;
let viewingAs: { staff_name: string; expires_at: string } | null = null;
const leaveView = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/lib/account/api", () => ({
  getAccount: () =>
    Promise.resolve(
      accountRole
        ? {
            user: { role: accountRole, discord_global_name: "Steve", discord_username: "steve" },
            viewing_as: viewingAs,
          }
        : null,
    ),
}));
const leaveExpiredView = vi.fn();
vi.mock("@/lib/account/viewAs", () => ({
  leaveView: () => leaveView(),
  leaveExpiredView: (expiresAt: string) => leaveExpiredView(expiresAt),
  onViewSwitch: () => () => undefined,
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
});
afterEach(() => {
  cleanup();
  pathname = "/map";
  accountRole = null;
  viewingAs = null;
  leaveView.mockReset();
  leaveExpiredView.mockReset();
});

function openMenu() {
  const toggle = screen.getByRole("button", { name: "Menu" });
  fireEvent.click(toggle);
  const menu = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  return { toggle, menu };
}

it("opens the menu, locks page scroll and focuses the first link", () => {
  render(<SiteHeader />);
  const toggle = screen.getByRole("button", { name: "Menu" });
  const menu = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(menu.hasAttribute("inert")).toBe(true);

  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(menu.hasAttribute("inert")).toBe(false);
  expect(document.documentElement.classList.contains("scroll-locked")).toBe(true);
  expect(document.activeElement?.closest(`#${CSS.escape(menu.id)}`)).toBe(menu);

  fireEvent.click(toggle);
  expect(document.documentElement.classList.contains("scroll-locked")).toBe(false);
});

it("closes on a link, the backdrop, Escape and navigation", () => {
  const view = render(<SiteHeader />);
  let { toggle, menu } = openMenu();
  // jsdom cannot follow a link, so keep the click on this page.
  document.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(menu.querySelector('a[href="/profile"]')!);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");

  ({ toggle, menu } = openMenu());
  fireEvent.click(menu.previousElementSibling!);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);

  ({ toggle } = openMenu());
  fireEvent.keyDown(document, { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);

  openMenu();
  pathname = "/wiki";
  view.rerender(<SiteHeader />);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);
});

it("keeps Tab and Shift+Tab inside the open menu", () => {
  render(<SiteHeader />);
  const { menu } = openMenu();
  const items = menu.querySelectorAll<HTMLElement>("a[href]");
  const first = items[0];
  const last = items[items.length - 1];
  expect(document.activeElement).toBe(first);
  fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(last);
  fireEvent.keyDown(last, { key: "Tab" });
  expect(document.activeElement).toBe(first);
});

it("marks the current section and adds the staff panel for staff accounts", async () => {
  pathname = "/map/main/chronicle";
  accountRole = "mod";
  render(<SiteHeader />);
  const { menu } = openMenu();
  expect(menu.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/map");
  await waitFor(() => expect(menu.querySelector('a[href="/admin"]')).not.toBeNull());
  // Staff tools sit inside the panel, not in the site header.
  expect(menu.querySelector('a[href="/precedent"], a[href="/inspect"]')).toBeNull();
});

it("shows a bar back to the admin's account while viewing as a player", async () => {
  accountRole = "player";
  viewingAs = { staff_name: "boss", expires_at: new Date(Date.now() + 60_000).toISOString() };
  leaveView.mockResolvedValue(undefined);
  render(<SiteHeader />);
  const bar = await screen.findByRole("status");
  expect(bar.textContent).toContain("Viewing as Steve · view only");
  fireEvent.click(screen.getByRole("button", { name: "Back to my account" }));
  expect(leaveView).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Switching back…" })).toBeTruthy();
});

it("switches back by itself when the view runs out", async () => {
  accountRole = "player";
  viewingAs = { staff_name: "boss", expires_at: new Date(Date.now() - 1000).toISOString() };
  leaveExpiredView.mockResolvedValue(undefined);
  render(<SiteHeader />);
  await screen.findByRole("status");
  await waitFor(() => expect(leaveExpiredView).toHaveBeenCalledWith(viewingAs!.expires_at));
  expect(leaveView).not.toHaveBeenCalled();
});

it("shows no bar for a player's own sign-in", async () => {
  accountRole = "player";
  render(<SiteHeader />);
  await Promise.resolve();
  await Promise.resolve();
  expect(screen.queryByRole("status")).toBeNull();
});
