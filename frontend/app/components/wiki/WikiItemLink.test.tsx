// @vitest-environment node

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import WikiItemLink, { WikiItemText } from "./WikiItemLink";
import GamesPage from "@/app/wiki/games/page";
import FishingPage from "@/app/wiki/fishing/page";
import MaterialDetailPage from "@/app/wiki/materials/[slug]/page";

describe("WikiItemLink", () => {
  it("links canonical materials and recipe items", () => {
    expect(renderToStaticMarkup(<WikiItemLink name="Enchanted Dust" />)).toContain(
      'href="/wiki/materials/enchanted-dust"',
    );
    expect(renderToStaticMarkup(<WikiItemLink name="Deck of Cards" />)).toContain(
      'href="/wiki/items/deck-of-cards"',
    );
  });

  it("prefers a canonical material route for an exact item alias", () => {
    expect(
      renderToStaticMarkup(
        <WikiItemLink name="Raw Tin" sourceId="mmoitem:MATERIALS:RAW_TIN" />,
      ),
    ).toContain('href="/wiki/materials/tin"');
  });

  it("uses exact provenance to disambiguate same-name items", () => {
    expect(renderToStaticMarkup(<WikiItemLink name="Research Paper" />)).toBe("Research Paper");
    expect(
      renderToStaticMarkup(
        <WikiItemLink name="Research Paper" sourceId="mmoitem:RESEARCH:R_ABYSSALITE" />,
      ),
    ).toContain('href="/wiki/items/research-paper--');
  });

  it("leaves missing and vanilla-only targets as plain text", () => {
    expect(renderToStaticMarkup(<WikiItemLink name="Stick" sourceId="vanilla:stick" />)).toBe("Stick");
    expect(renderToStaticMarkup(<WikiItemLink name="Unknown Relic" />)).toBe("Unknown Relic");
  });

  it("links longest names and plurals only inside explicit text boundaries", () => {
    const html = renderToStaticMarkup(
      <WikiItemText text="Steel Ingots sit beside a Stack of Gold Denars and Gold Denars." />,
    );
    expect(html).toContain('href="/wiki/materials/steel-ingot">Steel Ingots</a>');
    expect(html).toContain('href="/wiki/items/stack-of-gold-denars">Stack of Gold Denars</a>');
    expect(html).toContain('href="/wiki/items/gold-denar">Gold Denars</a>');
  });

  it("gives station names their station guide while retaining material links", () => {
    const html = renderToStaticMarkup(
      <WikiItemText text="Use the Animal Station and Engineering Tables with a Steel Ingot." />,
    );
    expect(html).toContain('href="/wiki/stations/animal-station">Animal Station</a>');
    expect(html).toContain('href="/wiki/stations/engineering-table">Engineering Tables</a>');
    expect(html).toContain('href="/wiki/materials/steel-ingot">Steel Ingot</a>');
    expect(html).not.toContain('href="/wiki/items/animal-station"');
  });

  it("prefers a case-varied parenthetical item over its shorter namesake", () => {
    const html = renderToStaticMarkup(
      <WikiItemText text="Use a Single Shot (launcher) or Smoothbore Barrel (Short)." />,
    );
    expect(html).toContain(
      'href="/wiki/items/single-shot-launcher">Single Shot (launcher)</a>',
    );
    expect(html).toContain(
      'href="/wiki/items/smoothbore-barrel-short">Smoothbore Barrel (Short)</a>',
    );
    expect(html).not.toContain('href="/wiki/items/single-shot"');
  });

  it("can suppress a detail page's self-link", () => {
    expect(
      renderToStaticMarkup(
        <WikiItemText text="Arcane Fuel powers an Arcane Trace Detector." excludeHref="/wiki/items/arcane-fuel" />,
      ),
    ).toBe(
      'Arcane Fuel powers an <a class="underline decoration-dotted underline-offset-2 hover:text-[var(--tfmc-accent)]" href="/wiki/items/arcane-trace-detector">Arcane Trace Detector</a>.',
    );
  });

  it("links real guide tables and prose without nesting anchors", () => {
    const html = `${renderToStaticMarkup(<GamesPage />)}${renderToStaticMarkup(<FishingPage />)}`;
    expect(html).toContain('href="/wiki/items/deck-of-cards"');
    expect(html).toContain('href="/wiki/items/mythril-hook"');
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });

  it("links another material from a dynamic material description", async () => {
    const html = renderToStaticMarkup(
      await MaterialDetailPage({ params: Promise.resolve({ slug: "ignitium" }) }),
    );
    expect(html).toContain('href="/wiki/materials/coke">Coke</a>');
    expect(html).not.toMatch(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*<a\b/);
  });
});
