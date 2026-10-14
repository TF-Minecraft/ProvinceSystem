import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildWikiSearchIndex, extractSearchEntries } from "./build-wiki-search-index.mjs";

const temporaryDirectories = [];
afterEach(async () =>
  Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))),
);

describe("guide search index generation", () => {
  it("indexes article sections and strips navigation, footer and private callouts", () => {
    const entries = extractSearchEntries(
      `<!doctype html><main><aside>Hidden nav</aside><article>
      <h1>Alchemy</h1><p>Turn herbs into useful potions.</p>
      <div data-variant="staff">Permission node alchemy.admin and source diagnostics.</div>
      <h2 id="recipes">Potion recipes</h2><p>Mix Moonwort with a glass bottle.</p>
      <div data-variant="bug">Known bug report.</div>
      <h2 id="commands">Commands</h2><p><code>/alchemy recipes</code> lists recipes.</p>
    </article></main><footer>Draft source notes</footer>`,
      "/wiki/alchemy",
    );

    expect(entries.map((entry) => entry.href)).toEqual([
      "/wiki/alchemy",
      "/wiki/alchemy#recipes",
      "/wiki/alchemy#commands",
    ]);
    const serialized = JSON.stringify(entries);
    expect(serialized).toContain("Moonwort");
    expect(serialized).toContain("/alchemy recipes");
    expect(serialized).not.toMatch(/Hidden nav|Permission node|source diagnostics|Known bug|Draft source/i);
  });

  it("reads the article Next streams after a loading skeleton", () => {
    const entries = extractSearchEntries(
      `<main><div role="status"><span>Loading guide…</span></div></main><footer>Site footer</footer>
      <div hidden id="S:1"><article><h1>Classes</h1><h2 id="skills">Skill reference</h2><p>Fireball.</p></article></div>`,
      "/wiki/classes",
    );

    expect(entries).toEqual([
      { href: "/wiki/classes#skills", pageTitle: "Classes", sectionTitle: "Skill reference", text: "Fireball." },
    ]);
  });

  it("separates structural text while preserving per-letter rank spans", () => {
    const entries = extractSearchEntries(
      `<main><article><h1>Ranks</h1><h2 id="benefits">Benefits</h2>
      <ul><li>First benefit</li><li>Second benefit</li></ul>
      <table><tbody><tr><td><span>N</span><span>o</span><span>b</span><span>l</span><span>e</span></td><td>10 days</td></tr></tbody></table>
      <label>Preview skin<select><option>Sloop</option><option>Sloop Black</option></select></label>
    </article></main>`,
      "/wiki/ranks",
    );

    expect(entries[0].text).toContain("First benefit Second benefit");
    expect(entries[0].text).toContain("Noble 10 days");
    expect(entries[0].text).toContain("Preview skin Sloop Sloop Black");
  });

  it("keeps unanchored sections searchable without emitting duplicate destinations", () => {
    const entries = extractSearchEntries(
      `<main><article><h1>Steel Ingot</h1>
      <h2>How to acquire</h2><p>Smelted at the Ingot Station.</p>
      <h2>What can be crafted</h2><p>Used for a wrench.</p>
    </article></main>`,
      "/wiki/materials/steel-ingot",
    );

    expect(entries).toEqual([
      {
        href: "/wiki/materials/steel-ingot",
        pageTitle: "Steel Ingot",
        text: "How to acquire Smelted at the Ingot Station. What can be crafted Used for a wrench.",
      },
    ]);
  });

  it("indexes meaningful image alternatives without repeating adjacent visible labels", () => {
    const entries = extractSearchEntries(
      `<main><article><h1>Steel Ingot</h1>
      <div><img alt="Steel Ingot"><span>Steel Ingot</span></div>
      <h2 id="recipe">Recipe</h2><div><img alt="Iron Ingot"><span>2</span><img alt=""><span>→</span><img alt="Steel Ingot"></div>
    </article></main>`,
      "/wiki/materials/steel-ingot",
    );

    expect(entries[0].text).toBe("Steel Ingot");
    expect(entries[1].text).toContain("Iron Ingot");
    expect(entries[1].text).toContain("Steel Ingot");
    expect(entries[1].text.match(/Iron Ingot/g)).toHaveLength(1);
  });

  it("walks rendered dynamic pages and writes a deterministic public index", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wiki-search-"));
    temporaryDirectories.push(root);
    const wikiRoot = path.join(root, ".next", "server", "app", "wiki");
    const outputFile = path.join(root, "public", "wiki", "search-index.json");
    await mkdir(path.join(wikiRoot, "materials"), { recursive: true });
    await mkdir(path.join(wikiRoot, "vehicles"), { recursive: true });
    await writeFile(`${wikiRoot}.html`, "<main><article><h1>Guide</h1><p>Start here.</p></article></main>");
    await writeFile(
      path.join(wikiRoot, "materials", "mythril.html"),
      "<main><article><h1>Mythril</h1><p>A rare metal.</p></article></main>",
    );
    await writeFile(
      path.join(wikiRoot, "vehicles", "sloop.html"),
      "<main><article><h1>Sloop</h1><h2 id=blueprint>Blueprint</h2><p>Oak planks.</p></article></main>",
    );

    const entries = await buildWikiSearchIndex({ wikiRoot, outputFile });
    expect(entries.map((entry) => entry.href)).toEqual([
      "/wiki",
      "/wiki/materials/mythril",
      "/wiki/vehicles/sloop#blueprint",
    ]);
    expect(JSON.parse(await readFile(outputFile, "utf8"))).toEqual(entries);
  });
});
