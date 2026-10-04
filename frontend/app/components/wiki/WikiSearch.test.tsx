/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WikiSearchEntry } from "@/lib/wikiSearch";

import WikiSearch, { highlightSearchText } from "./WikiSearch";

const entries: WikiSearchEntry[] = [
  { href: "/wiki/materials#steel", pageTitle: "Materials", sectionTitle: "Steel Ingot", text: "A forged crafting material." },
  { href: "/wiki/commands#pets", pageTitle: "Pets", sectionTitle: "Commands", text: "/pets opens the pet menu." },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function successfulFetch(index = entries) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => index }));
}

describe("WikiSearch", () => {
  it("stays quiet for an empty query, then links matching items and commands", async () => {
    successfulFetch();
    render(<WikiSearch />);
    const input = screen.getByRole("combobox", { name: "Search the gameplay guide" });
    expect(screen.queryByRole("listbox")).toBeNull();

    fireEvent.change(input, { target: { value: "STEEL ingot" } });
    const item = await screen.findByRole("option", { name: /Steel Ingot/ });
    expect(item.getAttribute("href")).toBe("/wiki/materials#steel");

    fireEvent.change(input, { target: { value: "/pets" } });
    const command = await screen.findByRole("option", { name: /Commands/ });
    expect(command.getAttribute("href")).toBe("/wiki/commands#pets");
  });

  it("supports arrow selection, Enter activation and Escape clearing", async () => {
    successfulFetch();
    render(<WikiSearch />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "a" } });
    const options = await screen.findAllByRole("option");
    await waitFor(() => expect(options[0].getAttribute("aria-selected")).toBe("true"));

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    const activated = vi.fn((event: Event) => event.preventDefault());
    options[1].addEventListener("click", activated);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(activated).toHaveBeenCalledOnce();

    fireEvent.keyDown(input, { key: "Escape" });
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("shows loading, no-result and load-failure states without hanging", async () => {
    let resolveFetch!: (value: { ok: boolean; json: () => Promise<WikiSearchEntry[]> }) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const view = render(<WikiSearch />);
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "missing" } });
    expect(screen.getByText("Loading search...")).toBeTruthy();
    resolveFetch({ ok: true, json: async () => [] });
    expect(await screen.findByText("No guide results found.")).toBeTruthy();

    view.unmount();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<WikiSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "anything" } });
    await waitFor(() => expect(screen.getByText("Search is unavailable right now.")).toBeTruthy());
  });

  it("renders repeated hrefs without duplicate React key warnings", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    successfulFetch([
      { href: "/wiki/materials/steel-ingot", pageTitle: "Steel Ingot", sectionTitle: "How to acquire", text: "Steel recipe" },
      { href: "/wiki/materials/steel-ingot", pageTitle: "Steel Ingot", sectionTitle: "Used in", text: "Steel tools" },
    ]);
    render(<WikiSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "steel" } });

    expect(await screen.findAllByRole("option")).toHaveLength(2);
    expect(consoleError.mock.calls.flat().join(" ")).not.toContain("same key");
    consoleError.mockRestore();
  });

  it("bolds each partial query token in result descriptions without changing their text", async () => {
    successfulFetch([
      {
        href: "/wiki/items/mythril-pickaxe",
        pageTitle: "Mythril Pickaxe",
        text: "Mine MYTHRIL ore, then craft a Mythril Pickaxe safely.",
      },
    ]);
    render(<WikiSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "mythril pic" } });

    const option = await screen.findByRole("option", { name: /Mythril Pickaxe/ });
    const snippet = option.querySelector("span:last-child")!;
    expect(snippet.textContent).toBe("Mine MYTHRIL ore, then craft a Mythril Pickaxe safely.");
    expect([...snippet.querySelectorAll("strong")].map((match) => match.textContent)).toEqual([
      "MYTHRIL",
      "Mythril",
      "Pic",
    ]);
  });

  it("keeps unmatched descriptions and literal punctuation intact for special-character queries", async () => {
    successfulFetch([
      {
        href: "/wiki/items/mythril-pickaxe",
        pageTitle: "Mythril Pickaxe",
        text: "Reliable tool: 100% safe [when repaired].",
      },
    ]);
    render(<WikiSearch />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "[MYTHRIL]*" } });

    const option = await screen.findByRole("option", { name: /Mythril Pickaxe/ });
    const snippet = option.querySelector("span:last-child")!;
    expect(snippet.textContent).toBe("Reliable tool: 100% safe [when repaired].");
    expect(snippet.querySelector("strong")).toBeNull();
  });

  it("keeps decomposed accents attached and merges overlapping matches", () => {
    const text = "Cafe\u0301s and banana.";
    const { container } = render(<p>{highlightSearchText(text, "cafes ana")}</p>);
    expect(container.textContent).toBe(text);
    expect([...container.querySelectorAll("strong")].map((match) => match.textContent)).toEqual([
      "Cafe\u0301s",
      "anana",
    ]);
  });
});
