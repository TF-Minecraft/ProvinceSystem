/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import WikiNavigation from "./WikiNavigation";

let pathname = "/wiki";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));
afterEach(() => {
  cleanup();
  pathname = "/wiki";
});

const content = <a href="#crafting">Crafting</a>;

it("collapses mobile navigation initially and toggles it accessibly", () => {
  render(<WikiNavigation>{content}</WikiNavigation>);
  const toggle = screen.getByRole("button", { name: "Browse guide" });
  const panel = document.getElementById(toggle.getAttribute("aria-controls")!)!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(panel.classList.contains("hidden")).toBe(true);
  expect(panel.classList.contains("lg:flex")).toBe(true);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel.classList.contains("hidden")).toBe(false);
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("closes on a link selection, including same-page anchors", () => {
  render(<WikiNavigation>{content}</WikiNavigation>);
  const toggle = screen.getByRole("button");
  fireEvent.click(toggle);
  fireEvent.click(screen.getByText("Crafting"));
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});

it("closes on navigation and returns keyboard focus on Escape", () => {
  const view = render(<WikiNavigation>{content}</WikiNavigation>);
  const toggle = screen.getByRole("button");
  fireEvent.click(toggle);
  screen.getByText("Crafting").focus();
  fireEvent.keyDown(screen.getByText("Crafting"), { key: "Escape" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(document.activeElement).toBe(toggle);
  fireEvent.click(toggle);
  pathname = "/wiki/cooking";
  view.rerender(<WikiNavigation>{content}</WikiNavigation>);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
