// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CraftingGrid from "../../components/wiki/CraftingGrid";
import { allRecipes, getRecipesForStation, getStationAcquisitionVisual, navItems, stationRecipes, stations, stationsSection } from "../data";
import { getRecipeItemHref } from "../data/items";
import StationsPage from "./page";
import StationDetailPage, { generateStaticParams } from "./[slug]/page";
import StationGallery from "./StationGallery";

const publicPath = (url: string) => join(process.cwd(), "public", url);

describe("station registry and source coverage", () => {
  it("registers 24 unique station routes, including both engineering stations", () => {
    expect(stations).toHaveLength(24);
    expect(new Set(stations.map((station) => station.slug)).size).toBe(stations.length);
    expect(stations.map((station) => station.slug)).toContain("engineer-station");
    expect(stations.map((station) => station.slug)).toContain("engineering-table");
    const forgingStation = stations.find((station) => station.slug === "weapon-station");
    expect(forgingStation?.name).toBe("Forging Station");
    expect(forgingStation?.craftRecipe?.title).toBe("Forging Station");
    expect(forgingStation?.craftRecipe?.output.name).toBe("Forging Station");
    expect(generateStaticParams()).toEqual(stations.map(({ slug }) => ({ slug })));
  });

  it("registers the Stations sidebar entry and generated recipes exactly once", () => {
    expect(navItems.filter((item) => item.href === "/wiki/stations")).toHaveLength(1);
    expect(stationsSection.recipes).toEqual(expect.arrayContaining(stationRecipes));
    for (const recipe of stationRecipes) {
      expect(allRecipes.filter((candidate) => candidate === recipe), recipe.key).toHaveLength(1);
    }
    expect(new Set(allRecipes.map((recipe) => recipe.key)).size).toBe(allRecipes.length);
  });

  it("assigns each recipe source to its correct station detail page", () => {
    const expectedCounts: Record<string, number> = {
      "alchemy-station": 53, "animal-station": 44, "archeology-station": 12,
      "block-station": 133, "copper-station": 119, "engineer-station": 17,
      "engineering-table": 16, "fishing-station": 25, "forester-station": 117,
      "gunsmithing-station": 21, "ingot-station": 71, "instrument-station": 9,
      "magic-station": 10, "meal-prep-station": 22, "medicine-station": 42,
      dockyard: 5, "research-station": 36, "tool-station": 57,
    };
    for (const [slug, count] of Object.entries(expectedCounts)) {
      const station = stations.find((candidate) => candidate.slug === slug)!;
      expect(getRecipesForStation(station.name), slug).toHaveLength(count);
    }
  });

  it("uses concise verified interactions for every station", () => {
    const expectedBlocks = {
      "alchemy-station": "Brewing Stand",
      "block-station": "Stonecutter",
      "copper-station": "Grindstone",
      "forester-station": "Fletching Table",
      "ingot-station": "Blast Furnace",
      "instrument-station": "Jukebox",
      "research-station": "Cartography Table",
      "tool-station": "Crafting Table",
    } as const;
    for (const [slug, block] of Object.entries(expectedBlocks)) {
      const station = stations.find((candidate) => candidate.slug === slug)!;
      expect(station.vanillaBlock?.name, slug).toBe(block);
    }

    const shiftClickStations = new Set([
      "block-station",
      "copper-station",
      "ingot-station",
      "instrument-station",
      "research-station",
      "tool-station",
    ]);
    for (const station of stations) {
      expect(station.interaction, station.slug).toBe(
        shiftClickStations.has(station.slug) ? "Shift + Right click" : "Right click",
      );
    }
  });

  it("provides the complete vanilla crafting grid for every vanilla-block station", () => {
    const expectedPatterns: Record<string, string[]> = {
      "alchemy-station": ["", "blaze_rod", "", "#stone_crafting_materials", "#stone_crafting_materials", "#stone_crafting_materials", "", "", ""],
      "block-station": ["", "iron_ingot", "", "stone", "stone", "stone", "", "", ""],
      "copper-station": ["stick", "stone_slab", "stick", "#planks", "", "#planks", "", "", ""],
      "forester-station": ["flint", "flint", "", "#planks", "#planks", "", "#planks", "#planks", ""],
      "ingot-station": ["iron_ingot", "iron_ingot", "iron_ingot", "iron_ingot", "furnace", "iron_ingot", "smooth_stone", "smooth_stone", "smooth_stone"],
      "instrument-station": ["#planks", "#planks", "#planks", "#planks", "diamond", "#planks", "#planks", "#planks", "#planks"],
      "research-station": ["paper", "paper", "", "#planks", "#planks", "", "#planks", "#planks", ""],
      "tool-station": ["#planks", "#planks", "", "#planks", "#planks", "", "", "", ""],
    };
    for (const station of stations.filter((candidate) => candidate.vanillaBlock)) {
      const recipe = station.vanillaBlock!.recipe;
      expect(recipe.ingredients, station.slug).toHaveLength(9);
      expect(recipe.ingredients.map((slot) => slot.sourceId?.replace("vanilla:", "") ?? ""), station.slug).toEqual(expectedPatterns[station.slug]);
      expect(recipe.output.name, station.slug).toBe(station.vanillaBlock!.name);
      expect(recipe.output.qty, station.slug).toBe(1);
      expect(recipe.output.sourceId, station.slug).toMatch(/^vanilla:/);
      expect(recipe.output.texture, station.slug).toMatch(/^\/wiki\/textures\/vanilla\//);
      expect(existsSync(publicPath(recipe.output.texture!)), `${station.slug}: ${recipe.output.texture}`).toBe(true);
      for (const ingredient of recipe.ingredients.filter((slot) => slot.name)) {
        expect(ingredient.qty, `${station.slug}: ${ingredient.name}`).toBe(1);
        expect(ingredient.sourceId, `${station.slug}: ${ingredient.name}`).toMatch(/^vanilla:/);
        expect(ingredient.texture, `${station.slug}: ${ingredient.name}`).toMatch(/^\/wiki\/textures\/vanilla\//);
        expect(existsSync(publicPath(ingredient.texture!)), `${station.slug}: ${ingredient.texture}`).toBe(true);
      }
    }
  });

  it("maps every vanilla station to its official block model and textures", () => {
    const expectedModels = {
      "alchemy-station": ["/wiki/models/vanilla/brewing_stand.json", ["base", "stand"]],
      "block-station": ["/wiki/models/vanilla/stonecutter.json", ["bottom", "saw", "side", "top"]],
      "copper-station": ["/wiki/models/vanilla/grindstone.json", ["leg", "pivot", "round", "side"]],
    } as const;
    for (const [slug, [url, textureKeys]] of Object.entries(expectedModels)) {
      const station = stations.find((candidate) => candidate.slug === slug)!;
      expect(station.model?.url, slug).toBe(url);
      expect(Object.keys(station.model?.textures ?? {}).sort(), slug).toEqual([...textureKeys]);
      expect(station.cubeFaces, slug).toBeUndefined();
    }

    const expectedCubes = {
      "forester-station": {
        up: "/wiki/textures/vanilla/fletching_table_top.png", down: "/wiki/textures/vanilla/birch_planks.png",
        north: "/wiki/textures/vanilla/fletching_table_front.png", south: "/wiki/textures/vanilla/fletching_table_front.png",
        east: "/wiki/textures/vanilla/fletching_table_side.png", west: "/wiki/textures/vanilla/fletching_table_side.png",
      },
      "tool-station": {
        up: "/wiki/textures/vanilla/crafting_table_top.png", down: "/wiki/textures/vanilla/oak_planks.png",
        north: "/wiki/textures/vanilla/crafting_table_front.png", south: "/wiki/textures/vanilla/crafting_table_side.png",
        east: "/wiki/textures/vanilla/crafting_table_side.png", west: "/wiki/textures/vanilla/crafting_table_front.png",
      },
      "research-station": {
        up: "/wiki/textures/vanilla/cartography_table_top.png", down: "/wiki/textures/vanilla/dark_oak_planks.png",
        north: "/wiki/textures/vanilla/cartography_table_side3.png", south: "/wiki/textures/vanilla/cartography_table_side1.png",
        east: "/wiki/textures/vanilla/cartography_table_side3.png", west: "/wiki/textures/vanilla/cartography_table_side2.png",
      },
      "ingot-station": {
        up: "/wiki/textures/vanilla/blast_furnace_top.png", down: "/wiki/textures/vanilla/blast_furnace_top.png",
        north: "/wiki/textures/vanilla/blast_furnace_front.png", south: "/wiki/textures/vanilla/blast_furnace_side.png",
        east: "/wiki/textures/vanilla/blast_furnace_side.png", west: "/wiki/textures/vanilla/blast_furnace_side.png",
      },
      "instrument-station": {
        up: "/wiki/textures/vanilla/jukebox_top.png", down: "/wiki/textures/vanilla/jukebox_side.png",
        north: "/wiki/textures/vanilla/jukebox_side.png", south: "/wiki/textures/vanilla/jukebox_side.png",
        east: "/wiki/textures/vanilla/jukebox_side.png", west: "/wiki/textures/vanilla/jukebox_side.png",
      },
    } as const;
    for (const [slug, faces] of Object.entries(expectedCubes)) {
      const station = stations.find((candidate) => candidate.slug === slug)!;
      expect(station.cubeFaces, slug).toEqual(faces);
      expect(station.model, slug).toBeUndefined();
    }

    const modelElementCounts = {
      "alchemy-station": 7,
      "block-station": 2,
      "copper-station": 5,
    } as const;
    for (const [slug, count] of Object.entries(modelElementCounts)) {
      const station = stations.find((candidate) => candidate.slug === slug)!;
      const model = JSON.parse(readFileSync(publicPath(station.model!.url), "utf8")) as { elements: unknown[] };
      expect(model.elements, slug).toHaveLength(count);
    }

    const saw = readFileSync(publicPath("/wiki/textures/vanilla/stonecutter_saw.png"));
    expect(saw.readUInt32BE(16)).toBe(16);
    expect(saw.readUInt32BE(20)).toBe(16);
  });

  it("resolves every station preview and recipe asset", () => {
    for (const station of stations) {
      expect(existsSync(publicPath(station.icon)), station.icon).toBe(true);
      if (station.fallbackTexture) expect(existsSync(publicPath(station.fallbackTexture)), station.fallbackTexture).toBe(true);
      if (station.model) {
        expect(existsSync(publicPath(station.model.url)), station.model.url).toBe(true);
        if (station.model.texture) expect(existsSync(publicPath(station.model.texture)), station.model.texture).toBe(true);
        for (const texture of Object.values(station.model.textures ?? {})) expect(existsSync(publicPath(texture)), texture).toBe(true);
      }
      for (const texture of Object.values(station.cubeFaces ?? {})) expect(existsSync(publicPath(texture)), texture).toBe(true);
    }
    for (const recipe of allRecipes) {
      for (const slot of [...recipe.ingredients, recipe.output]) {
        if (slot.texture) expect(existsSync(publicPath(slot.texture)), `${recipe.key}: ${slot.texture}`).toBe(true);
      }
    }
  });
});

describe("station routes", () => {
  it("lists every station while mounting only the selected preview", () => {
    const html = renderToStaticMarkup(<StationsPage />);
    expect(html.match(/aria-pressed=/g) ?? []).toHaveLength(stations.length);
    expect(html.match(/View station details/g) ?? []).toHaveLength(1);
    for (const station of stations) expect(html).toContain(`>${station.name}</button>`);
  });

  it("renders one real block preview in the gallery and detail hero for every vanilla station", async () => {
    for (const stationInfo of stations.filter((candidate) => candidate.vanillaBlock)) {
      const ordered = [stationInfo, ...stations.filter((candidate) => candidate !== stationInfo)];
      const galleryHtml = renderToStaticMarkup(<StationGallery stations={ordered} />);
      expect(galleryHtml.match(/aria-label="3D preview of /g), stationInfo.slug).toHaveLength(1);
      expect(galleryHtml, stationInfo.slug).toContain(`aria-label="3D preview of ${stationInfo.name}"`);
      expect(galleryHtml, stationInfo.slug).not.toContain("standard block appearance");

      const detail = await StationDetailPage({ params: Promise.resolve({ slug: stationInfo.slug }) });
      const detailHtml = renderToStaticMarkup(detail);
      expect(detailHtml, stationInfo.slug).toContain(`aria-label="3D preview of ${stationInfo.name}"`);
    }
  });

  it("renders obtaining instructions and the recipes assigned to a detail page", async () => {
    const station = await StationDetailPage({ params: Promise.resolve({ slug: "engineering-table" }) });
    const html = renderToStaticMarkup(station);
    expect(html).toContain("How to obtain it");
    expect(html).toContain("16 recipes use this station");
    expect(html).toContain("Right click");
  });

  it("uses the station's rendered thumbnail for model-backed acquisition outputs", async () => {
    const station = await StationDetailPage({ params: Promise.resolve({ slug: "medicine-station" }) });
    const html = renderToStaticMarkup(station);
    expect(html).toContain('src="/wiki/thumbnails/stations/medicine-station.webp"');
    expect(html).toContain('aria-label="View Medicine Station"');
    expect(html).not.toContain('src="/wiki/textures/vanilla/paper.png"');
  });

  it("resolves every station acquisition output by source identity to a static 3D thumbnail", () => {
    const acquisitionStations = stations.filter((station) => station.craftRecipe || station.vanillaBlock?.recipe);
    expect(acquisitionStations).toHaveLength(24);
    const sourceIds = acquisitionStations.map((station) => (station.craftRecipe ?? station.vanillaBlock!.recipe).output.sourceId);
    expect(sourceIds.every(Boolean)).toBe(true);
    expect(new Set(sourceIds).size).toBe(24);

    for (const station of acquisitionStations) {
      const recipe = station.craftRecipe ?? station.vanillaBlock!.recipe;
      const visual = getStationAcquisitionVisual(recipe.output.sourceId);
      expect(visual, station.slug).toEqual({
        slug: station.slug,
        thumbnail: `/wiki/thumbnails/stations/${station.slug}.webp`,
      });
      expect(existsSync(publicPath(visual!.thumbnail)), visual!.thumbnail).toBe(true);

      const html = renderToStaticMarkup(<CraftingGrid recipe={recipe} />);
      expect(html, station.slug).toContain(`src="${visual!.thumbnail}"`);
      if (!recipe.output.sourceId!.startsWith("vanilla:")) {
        expect(getRecipeItemHref(recipe.output), station.slug).toBe(`/wiki/stations/${station.slug}`);
        expect(html, station.slug).toContain(`aria-label="View ${recipe.output.name}"`);
      }
    }
  });

  it("does not replace a station item when it appears in an ingredient slot", () => {
    const engineeringRecipe = stations.find((station) => station.slug === "engineering-table")!.craftRecipe!;
    const html = renderToStaticMarkup(<CraftingGrid recipe={{
      key: "station-as-ingredient",
      title: "Station as ingredient",
      station: "Crafting Table",
      ingredients: [engineeringRecipe.output],
      output: { name: "Stone", qty: 1, sourceId: "vanilla:stone", texture: "/wiki/textures/vanilla/stone.png" },
    }} />);
    expect(html).toContain('src="/wiki/textures/vehicle-stations/engineering_table/front.png"');
    expect(html).not.toContain('/wiki/thumbnails/stations/engineering-table.webp');
  });

  it("groups large catalogues and removes unavailable implementation placeholders", async () => {
    const station = await StationDetailPage({ params: Promise.resolve({ slug: "block-station" }) });
    const html = renderToStaticMarkup(station);
    expect(html).toContain("133 recipes use this station");
    expect(html).toContain("<details");
    expect(html).toContain("Stonecutter");
    expect(html).not.toMatch(/Not documented|No 3D model|NPC or command|TEMPORARILY DISABLED/i);
  });

  it("shows only the concise interaction in the use section", async () => {
    for (const slug of ["block-station", "bird-mailbox"]) {
      const station = await StationDetailPage({ params: Promise.resolve({ slug }) });
      const html = renderToStaticMarkup(station);
      expect(html).toMatch(/How to use it<\/h2><p[^>]*>(?:Right click|Shift \+ Right click)<\/p>/);
      expect(html).not.toMatch(/The action that opens|Stand still|without sneaking|holding a written Letter|normal right-click|placed station/i);
    }
  });

  it("renders vanilla station acquisition as a recipe grid without explanatory copy", async () => {
    for (const stationInfo of stations.filter((candidate) => candidate.vanillaBlock)) {
      const station = await StationDetailPage({ params: Promise.resolve({ slug: stationInfo.slug }) });
      const html = renderToStaticMarkup(station);
      expect(html, stationInfo.slug).toContain("How to obtain it");
      expect(html, stationInfo.slug).toContain(`title="${stationInfo.vanillaBlock!.name}"`);
      expect(html, stationInfo.slug).not.toContain(`aria-label="View ${stationInfo.vanillaBlock!.name}"`);
      expect(html, stationInfo.slug).not.toMatch(/The block or recipe you need|Craft and place a normal/i);
    }
  });

  it("returns the Next.js 404 signal for an unknown station", async () => {
    await expect(StationDetailPage({ params: Promise.resolve({ slug: "not-a-station" }) })).rejects.toThrow("404");
  });

  it("links recipe station labels to their registered detail pages", () => {
    const recipe = getRecipesForStation("Alchemy Station")[0];
    const html = renderToStaticMarkup(<CraftingGrid recipe={recipe} />);
    expect(html).toContain('href="/wiki/stations/alchemy-station"');
  });

  it("contains no disabled route files or temporary station comments", () => {
    expect(existsSync(join(process.cwd(), "app/wiki/stations/page.disabled.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "app/wiki/stations/[slug]/page.disabled.tsx"))).toBe(false);
    for (const file of ["app/wiki/data/registry.ts", "app/components/wiki/CraftingGrid.tsx"]) {
      expect(readFileSync(join(process.cwd(), file), "utf8")).not.toContain("TEMPORARILY DISABLED");
    }
  });
});
