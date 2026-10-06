/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SiteHeader from "./SiteHeader";

let pathname = "/map";
let staffState = "unauthenticated";
let accountRole: string | null = null;
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
vi.mock("@/app/hooks/useSiteStaffAccess", () => ({
  useSiteStaffAccess: () => ({ state: staffState, retry: () => {} }),
}));
vi.mock("@/lib/account/api", () => ({
  getAccount: () => Promise.resolve(accountRole ? { user: { role: accountRole } } : null),
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
  staffState = "unauthenticated";
  accountRole = null;
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
  expect(document.documentElement.classList.contains("overflow-hidden")).toBe(true);
  expect(document.activeElement?.closest(`#${CSS.escape(menu.id)}`)).toBe(menu);

  fireEvent.click(toggle);
  expect(document.documentElement.classList.contains("overflow-hidden")).toBe(false);
});

it("closes on a link, the backdrop, Escape and navigation", () => {
  const view = render(<SiteHeader />);
  let { toggle, menu } = openMenu();
  // jsdom cannot follow a link, so keep the click on this page.
  document.addEventListener("click", (event) => event.preventDefault(), { once: true });
  fireEvent.click(menu.querySelector('a[href="/skins"]')!);
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

it("marks the current section and adds staff and admin links", async () => {
  pathname = "/map/main/chronicle";
  staffState = "staff";
  accountRole = "admin";
  render(<SiteHeader />);
  const { menu } = openMenu();
  expect(menu.querySelector('a[aria-current="page"]')?.getAttribute("href")).toBe("/map");
  expect(menu.querySelector('a[href="/inspect"]')).not.toBeNull();
  await waitFor(() => expect(menu.querySelector('a[href="/admin"]')).not.toBeNull());
});
