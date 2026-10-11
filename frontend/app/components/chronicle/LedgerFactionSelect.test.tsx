/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import LedgerFactionSelect from "./LedgerFactionSelect";

afterEach(cleanup);
const options = [
  { name: "§x§a§3§a§1§8§4Prospero", label: "Prospero", keys: ["p"], foundedAt: ["2026-08-01"] },
  { name: "§cRed §lClan", label: "Red Clan", keys: ["r"], foundedAt: ["2026-08-01"] },
];

it("renders the exact hex colour in the selected name and menu, and retains formatting", () => {
  const onSelect = vi.fn();
  const { container } = render(
    <LedgerFactionSelect options={options} selectedKey={options[0].name} onSelect={onSelect} label="Wealth nation" />,
  );
  expect(screen.getByText("Prospero").style.color).toBe("rgb(163, 161, 132)");
  fireEvent.click(screen.getByRole("combobox"));
  expect(screen.getAllByText("Prospero").every((el) => el.style.color === "rgb(163, 161, 132)")).toBe(true);
  expect(screen.getByText("Clan").style.fontWeight).toBe("700");
  expect(container.textContent).not.toContain("§");
  fireEvent.click(screen.getByRole("option", { name: "Red Clan" }));
  expect(onSelect).toHaveBeenCalledWith(options[1].name);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("supports keyboard selection, typeahead and dismissing without a selection", () => {
  const onSelect = vi.fn();
  render(
    <LedgerFactionSelect options={options} selectedKey={options[0].name} onSelect={onSelect} label="Wealth nation" />,
  );
  const trigger = screen.getByRole("combobox");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  fireEvent.keyDown(trigger, { key: "Enter" });
  expect(onSelect).toHaveBeenCalledWith(options[1].name);
  onSelect.mockClear();
  fireEvent.keyDown(trigger, { key: "r" });
  expect(trigger.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Red Clan" }).id);
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onSelect).not.toHaveBeenCalled();
});
