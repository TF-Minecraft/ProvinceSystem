// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CraftingGrid from "./CraftingGrid";
import { vehicleRecipes } from "../../wiki/data";

vi.mock("./StationModelViewer", () => ({ default: () => <div data-testid="station-model" /> }));
afterEach(cleanup);

describe("material vehicle links", () => {
  it("links all catalogue vehicle outputs to their canonical slug", () => {
    render(
      <>
        {vehicleRecipes.map((recipe) => (
          <CraftingGrid key={recipe.key} recipe={recipe} />
        ))}
      </>,
    );

    expect(vehicleRecipes).toHaveLength(21);
    for (const recipe of vehicleRecipes) {
      const link = screen.getByRole("link", { name: `View ${recipe.output.name} in vehicle catalogue` });
      expect(link.getAttribute("href")).toBe(`/wiki/vehicles?vehicle=${recipe.key.replace(/^vehicle-/, "")}#catalogue`);
      expect(link.querySelector("img")?.getAttribute("src")).toBe(
        recipe.output.model!.url.replace("/models/vehicles/", "/thumbnails/vehicles/").replace(/\.json$/, ".webp"),
      );
      expect(link.textContent).not.toContain("3D");
    }
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps non-catalogue station models as station previews", () => {
    const stationModels = [
      { name: "Engineering Table", url: "/wiki/models/vehicles/ammunition_station.json" },
      { name: "Dockyard", url: "/wiki/models/vehicles/dockyard.json" },
    ];
    render(
      <>
        {stationModels.map(({ name, url }) => (
          <CraftingGrid
            key={name}
            recipe={{
              key: name,
              title: name,
              station: "Crafting Table",
              ingredients: [],
              output: { name, qty: 1, model: { url } },
            }}
          />
        ))}
      </>,
    );

    expect(screen.getAllByTestId("station-model")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /vehicle catalogue/ })).toBeNull();
  });
});
