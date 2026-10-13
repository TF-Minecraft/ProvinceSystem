/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { AccessibleMapEntry } from "@/lib/map/api";
import MapArchiveMenu from "./MapArchiveMenu";

afterEach(cleanup);

describe("MapArchiveMenu", () => {
  it("makes archived chapter links available without opening a nested menu", () => {
    const maps: AccessibleMapEntry[] = [
      { id: "main", display_name: "Vardera", public: true, archived: false },
      { id: "dev", display_name: "Dev", public: false, archived: true },
      { id: "calavorn", display_name: "Calavorn", public: true, archived: true },
    ];
    render(<MapArchiveMenu maps={maps} linkClass="" />);
    const chapters = screen.getByRole("navigation", { name: "Earlier chapters" });
    const links = within(chapters).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].textContent).toBe("Calavorn");
    expect(links[0].getAttribute("href")).toBe("/map/calavorn");
    expect(within(chapters).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("shows the existing empty state without requiring a click", () => {
    render(<MapArchiveMenu maps={[]} linkClass="" />);
    expect(screen.getByText("No archived chapters yet.")).toBeTruthy();
  });
});
