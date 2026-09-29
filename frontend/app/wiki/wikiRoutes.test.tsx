// @vitest-environment node
/// <reference types="vite/client" />

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import * as wikiComponents from "@/app/components/wiki";
import WikiOverviewPage from "./page";
import { navItems, overviewNavItem, wikiSections } from "./data";

type PageModule = { default: () => React.ReactNode | Promise<React.ReactNode> };

const pageModules = import.meta.glob("./*/page.tsx", { eager: true }) as Record<string, PageModule>;

function hrefForModule(modulePath: string) {
  const slug = modulePath.match(/^\.\/([^/]+)\/page\.tsx$/)?.[1];
  if (!slug) throw new Error(`Unexpected wiki page module path: ${modulePath}`);
  return `/wiki/${slug}`;
}

const discoveredPages = Object.entries(pageModules)
  .map(([modulePath, module]) => ({ href: hrefForModule(modulePath), module }))
  .sort((a, b) => a.href.localeCompare(b.href));

describe("public wiki route discovery", () => {
  it("registers every top-level page exactly once and no route-less sections", () => {
    const discoveredHrefs = discoveredPages.map(({ href }) => href);
    const registeredHrefs = wikiSections.map(({ nav }) => nav.href).sort();

    expect(registeredHrefs).toEqual(discoveredHrefs);
    expect(new Set(registeredHrefs).size).toBe(registeredHrefs.length);
  });

  it("derives the public navigation from every discovered page", () => {
    expect(navItems.map(({ href }) => href).sort()).toEqual(
      discoveredPages.map(({ href }) => href)
    );
  });
});

describe("public wiki page entry points", () => {
  it.each(discoveredPages)("server-renders $href with valid wiki links", async ({ href, module }) => {
    expect(module.default, `${href} must have a default page export`).toBeTypeOf("function");

    const html = renderToStaticMarkup(await module.default());
    expect(html, `${href} rendered no heading`).toMatch(/<h1\b/);
    expect(html.match(/Last modified:/g), `${href} must show one revision date`).toHaveLength(1);
    expect(html, `${href} must expose a valid machine-readable revision date`).toMatch(
      /<time dateTime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/
    );

    const publicRoutes = new Set([overviewNavItem.href, ...discoveredPages.map((page) => page.href)]);
    const links = [...html.matchAll(/href="(\/wiki(?:\/[^":#]*):)/g)].map((match) => match[1]);
    for (const target of links) {
      const normalized = target.replace(/\/$/, "");
      const isPublicAsset = ["/wiki/models/", "/wiki/textures/", "/wiki/sounds/"]
        .some((prefix) => normalized.startsWith(prefix));
      const isKnownDetailRoute = ["/wiki/materials/", "/wiki/musical-instruments/", "/wiki/stations/", "/wiki/vehicles/"]
        .some((prefix) => normalized.startsWith(prefix));
      expect(publicRoutes.has(normalized) || isKnownDetailRoute || isPublicAsset, `${href} links to missing route ${target}`).toBe(true);
    }

    const assets = [...html.matchAll(/(?:src|href)="(\/wiki\/(?:models|textures|sounds)\/[^":#]+)"/g)]
      .map((match) => match[1]);
    for (const asset of assets) {
      expect(existsSync(join(process.cwd(), "public", asset)), `${href} references missing asset ${asset}`).toBe(true);
    }
  });

  it("renders the overview through the same dated frame", () => {
    const html = renderToStaticMarkup(<WikiOverviewPage />);
    expect(html.match(/Last modified:/g)).toHaveLength(1);
    expect(html).toMatch(/<time dateTime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/);
  });

  it("keeps every static and dynamic wiki entry point on the dated frame", () => {
    const wikiRoot = join(process.cwd(), "app", "wiki");
    const pageFiles = [
      join(wikiRoot, "page.tsx"),
      ...Object.keys(import.meta.glob("./**/page.tsx", { eager: false }))
        .map((modulePath) => join(wikiRoot, modulePath.slice(2))),
    ];

    expect(pageFiles.length).toBeGreaterThan(1);
    for (const pageFile of pageFiles) {
      const source = readFileSync(pageFile, "utf8");
      expect(source, `${pageFile} must use WikiPage`).toMatch(/<WikiPage\b/);
    }
  });

  it("keeps top-level pages on the shared component barrel", () => {
    const deliberateDirectImports = new Set([
      "CraftingGrid",
      "InstrumentKeyboard",
      "SimpleCubeViewer",
      "StationModelViewer",
      "WikiModelViewer",
    ]);

    for (const { href } of discoveredPages) {
      const source = readFileSync(join(process.cwd(), "app", href.slice(1), "page.tsx"), "utf8");
      const directImports = [...source.matchAll(/from\s+["']@\/app\/components\/wiki\/([^"']+)["']/g)]
        .map((match) => match[1]);
      expect(
        directImports.filter((component) => !deliberateDirectImports.has(component)),
        `${href} bypasses the shared wiki component barrel`
      ).toEqual([]);
    }

    expect(wikiComponents.WikiPage).toBeTypeOf("function");
    expect(wikiComponents.SeeAlso).toBeTypeOf("function");
  });
});
