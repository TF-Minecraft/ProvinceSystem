import Link from "next/link";
import {
  Callout,
  CommandTable,
  DataTable,
  ItemChip,
  ItemGallery,
  SeeAlso,
  StationLink,
  StatGrid,
  WikiPage,
  WikiItemLink,
  WikiSectionHeading,
} from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import {
  advancedCraftingCommands,
  alloyForgeRecipe,
  armorRecipeTemplates,
  bowRecipeTemplates,
  ingredientConverterRecipe,
  ingredientTypes,
  weaponRecipeTemplates,
  weaponStationRecipe,
} from "../data/advanced-crafting";
import type { StationRecipeTemplate, TemplateIngredient } from "../data/advanced-crafting";
import { T, V } from "../data/helpers";

const qualityTiers = [
  ["0%", "Rusted", "None"],
  ["50%", "Tempered", "Basic Gemstone"],
  ["75%", "Polished", "Polished Gemstone"],
  ["90%", "Gleaming", "Radiant Gemstone"],
  ["100%", "Masterwork", "Mythical Gemstone"],
];

/**
 * A recipe output name as the config stores it: `%material%` is a placeholder
 * the plugin fills in at craft time with a generated material name.
 */
function TemplateName({ name }: { name: string }) {
  const [before, after = ""] = name.split("%material%");
  return (
    <span>
      {before}
      <span className="italic text-[var(--tfmc-accent)]">Material</span>
      {after}
    </span>
  );
}

/** "4 × Metal · 2 × Leather · ...": ingredient *types*, not specific items. */
function IngredientTypeList({ ingredients }: { ingredients: TemplateIngredient[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
      {ingredients.map((ingredient) => (
        <span key={ingredient.type} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/40"
            style={{ backgroundColor: ingredientTypes[ingredient.type].color }}
          />
          {ingredient.qty} × {ingredientTypes[ingredient.type].label}
        </span>
      ))}
    </span>
  );
}

const socketTrackLabel: Record<StationRecipeTemplate["socketGroup"], string> = {
  gemstones: "Gemstone",
  mage_armor_runes: "Armor Rune",
};

const smithingTools = [
  { name: "Hammer Tool", image: "/wiki/textures/smithing-tools/hammer-tool.png", detail: "Metal tool · Performs a regular hammer hit." },
  { name: "Small Hammer Tool", image: "/wiki/textures/smithing-tools/small-hammer-tool.png", detail: "Metal tool · Performs a small hammer hit." },
  { name: "Etching Tool", image: "/wiki/textures/smithing-tools/etching-tool.png", detail: "Artisan tool · Performs an etching hit." },
  { name: "Whittling Tool", image: "/wiki/textures/smithing-tools/whittling-tool.png", detail: "Artisan tool · Performs a whittling hit." },
  { name: "Engraving Tool", image: "/wiki/textures/smithing-tools/engraving-tool.png", detail: "Artisan tool · Performs an engraving hit." },
  { name: "Sewing Needle", image: "/wiki/textures/smithing-tools/sewing-needle.png", detail: "Artisan tool · Performs a sewing hit." },
];

const baseMetalsAndWoods = [
  ["Iron Ingot", "Metal", 1, 2, "Hit ×4, Small Hit ×1"],
  ["Steel Ingot", "Metal", 2, 4, "Hit ×5, Small Hit ×2"],
  ["Bronze Ingot", "Metal", 2, 6, "Hit ×1, Small Hit ×5"],
  ["Abyssalite Ingot", "Metal", 3, 8, "Hit ×6, Small Hit ×2"],
  ["Mythril Ingot", "Metal", 4, 10, "Hit ×3, Small Hit ×5"],
  ["Refined Barkwood", "Wood", 1, 2, "Etch ×2, Whittle ×1, Engrave ×1"],
  ["Refined Maplewood", "Wood", 2, 4, "Etch ×1, Whittle ×2, Engrave ×1"],
  ["Refined Elderwood", "Wood", 3, 8, "Etch ×1, Whittle ×1, Engrave ×2"],
  ["Refined Demonwood", "Wood", 4, 10, "Etch ×2, Whittle ×1, Engrave ×3"],
];

const gemstones: [string, number, string][] = [
  ["Agate", 1, "Hit ×3"],
  ["Jasper", 1, "Small Hit ×1"],
  ["Onyx", 1, "Etch ×1"],
  ["Tourmaline", 1, "Whittle ×3"],
  ["Pearl", 1, "Engrave ×2"],
  ["Coral", 1, "Sew ×1"],
  ["Chrysoprase", 1, "Hit ×1"],
  ["Larimar", 1, "Small Hit ×3"],
  ["Rhodonite", 1, "Etch ×3"],
  ["Vesuvianite", 1, "Whittle ×1"],
  ["Turquoise", 2, "Hit ×3, Small Hit ×2"],
  ["Peridot", 2, "Hit ×1, Etch ×1"],
  ["Malachite", 2, "Hit ×1, Whittle ×1"],
  ["Zircon", 2, "Hit ×1, Engrave ×3"],
  ["Apatite", 2, "Hit ×3, Sew ×1"],
  ["Carnelian", 2, "Small Hit ×3, Etch ×1"],
  ["Labradorite", 2, "Small Hit ×3, Whittle ×3"],
  ["Sardonyx", 2, "Small Hit ×3, Engrave ×3"],
  ["Variscite", 2, "Small Hit ×2, Sew ×1"],
  ["Wulfenite", 2, "Etch ×2, Whittle ×3"],
  ["Aquamarine", 3, "Hit ×2, Small Hit ×1, Etch ×1"],
  ["Garnet", 3, "Hit ×2, Small Hit ×2, Whittle ×2"],
  ["Opal", 3, "Hit ×1, Small Hit ×1, Engrave ×2"],
  ["Tanzanite", 3, "Hit ×1, Small Hit ×1, Sew ×2"],
  ["Moonstone", 3, "Hit ×1, Etch ×2, Whittle ×2"],
  ["Sunstone", 3, "Hit ×2, Etch ×1, Engrave ×2"],
  ["Spinel", 3, "Hit ×1, Etch ×2, Sew ×1"],
  ["Alexandrite", 3, "Hit ×2, Whittle ×2, Engrave ×1"],
  ["Firestone", 3, "Hit ×1, Whittle ×1, Sew ×1"],
  ["Cloudstone", 3, "Hit ×2, Engrave ×1, Sew ×1"],
  ["Ruby", 4, "Hit ×1, Small Hit ×2, Etch ×2, Whittle ×2"],
  ["Sapphire", 4, "Hit ×2, Small Hit ×1, Etch ×2, Engrave ×2"],
  ["Topaz", 4, "Hit ×1, Small Hit ×2, Etch ×1, Sew ×1"],
  ["Citrine", 4, "Hit ×1, Small Hit ×1, Whittle ×2, Engrave ×2"],
  ["Morganite", 4, "Hit ×2, Small Hit ×1, Whittle ×2, Sew ×1"],
  ["Crystallite", 4, "Hit ×1, Small Hit ×1, Engrave ×2, Sew ×2"],
  ["Tiger's Eye", 4, "Hit ×2, Etch ×1, Whittle ×1, Engrave ×2"],
  ["Serpent's Eye", 4, "Hit ×1, Etch ×2, Whittle ×2, Sew ×2"],
  ["Musgravite", 4, "Hit ×1, Etch ×2, Engrave ×1, Sew ×1"],
  ["Taaffeite", 4, "Hit ×2, Whittle ×2, Engrave ×2, Sew ×2"],
];

function gemstoneTexture(name: string) {
  const filename = name
    .replace("Tiger's", "Tigers")
    .replace("Serpent's", "Serpents")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/(^_|_$)/g, "");
  return T(`gems/${filename}.png`);
}

const otherCatalysts = [
  ["Ignitium", 3, "Small Hit ×2, Engrave ×3, Sew ×2"],
  ["Raw Tin", 4, "Hit ×6, Engrave ×4"],
  ["Abyssalite Fragment", 4, "Hit ×4, Small Hit ×3, Etch ×1, Whittle ×3, Engrave ×2, Sew ×2"],
  ["Mythril Fragment", 4, "Hit ×2, Small Hit ×4, Etch ×2, Whittle ×2, Engrave ×3, Sew ×3"],
];

const clothAndAnimal = [
  ["Leather", "Leather", 1, "Etch ×1, Whittle ×2, Sew ×2"],
  ["Rare Leather", "Leather", 2, "Etch ×3, Whittle ×2, Sew ×1"],
  ["Epic Leather", "Leather", 3, "Etch ×2, Whittle ×1, Sew ×3"],
  ["Legendary Leather", "Leather", 4, "Etch ×2, Whittle ×2, Sew ×3"],
  ["Feather", "Feather", 1, "Etch ×2, Whittle ×1, Sew ×1"],
  ["Rare Feather", "Feather", 2, "Etch ×2, Whittle ×1, Sew ×1"],
  ["Epic Feather", "Feather", 3, "Etch ×1, Whittle ×3, Sew ×2"],
  ["Legendary Feather", "Feather", 4, "Etch ×2, Whittle ×3, Sew ×1"],
  ["Wool", "Wool", 1, "Etch ×1, Whittle ×2, Sew ×3"],
  ["Rare Wool", "Wool", 2, "Etch ×2, Whittle ×2, Sew ×2"],
  ["Epic Wool", "Wool", 3, "Etch ×1, Whittle ×1, Sew ×3"],
  ["Legendary Wool", "Wool", 4, "Etch ×2, Whittle ×1, Sew ×4"],
  ["Paper", "Paper", 1, "Sew ×1"],
  ["Enchanted Dust", "Enchanted Dust", 1, "Sew ×1"],
];

const catalystTextures: Record<string, string> = {
  Ignitium: T("materials/ignitium.png"),
  "Raw Tin": T("materials/raw_tin.png"),
  "Abyssalite Fragment": T("materials/abyssalite.png"),
  "Mythril Fragment": T("materials/mythril_fragment.png"),
};

const clothTextures: Record<string, string> = {
  Leather: V("leather.png"),
  "Rare Leather": T("pets/rareleather.png"),
  "Epic Leather": T("pets/epicleather.png"),
  "Legendary Leather": T("pets/legendaryleather.png"),
  Feather: V("feather.png"),
  "Rare Feather": T("pets/rarefeather.png"),
  "Epic Feather": T("pets/epicfeather.png"),
  "Legendary Feather": T("pets/legendaryfeather.png"),
  Wool: V("white_wool.png"),
  "Rare Wool": T("pets/rarewool.png"),
  "Epic Wool": T("pets/epicwool.png"),
  "Legendary Wool": T("pets/legendarywool.png"),
  Paper: V("paper.png"),
  "Enchanted Dust": T("magic_crafting/enchanted_dust.png"),
};

export default function AdvancedCraftingPage() {
  return (
    <WikiPage
      lastModified="2026-09-27"
      title="AdvancedCrafting"
      intro={
        <>
          Hands-on blacksmithing: pick a recipe at a <strong><StationLink name="Forging Station" /></strong>, feed it raw
          materials, then physically hammer, carve, etch or sew it with smithing tools. Every
          ingredient you load adds a number of required hits per tool, and you work the station
          until each tool&apos;s counter is full: it refuses extra hits with a tool that is already
          done, and refuses to finish while any counter is short. The finished item has a quality
          grade, stats and socket slots. A second station, the <strong><StationLink name="Alloy Forge" /></strong>, lets you invent and
          name your own metal alloys, which anyone can then use as an ingredient.
        </>
      }

    >
      <Callout variant="note" title="Material ranks matter">
        Metals and woods unlock as you advance through the matching crafting profession. If a
        station refuses a material, continue that profession until you reach its required rank.
      </Callout>

      <WikiSectionHeading id="crafting-a-weapon" intro={<>The loop at the <StationLink name="Forging Station" />.</>}>
        Crafting a weapon or piece of armor
      </WikiSectionHeading>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Place a <StationLink name="Forging Station" />. Recipe below.</li>
        <li>
          Right-click it. A <strong>Select Category</strong> menu opens (Armor / Weapons / Bows),
          then a <strong>Select Recipe</strong> menu. Pick one: a station can only hold one
          recipe at a time.
        </li>
        <li>
          Right-click the station while holding each required ingredient to load it in. A recipe
          asks for ingredient <em>types</em> and counts (e.g. &quot;metal ×4&quot;), so you choose
          which specific metal or wood to use.
        </li>
        <li>
          Right-click the station while holding each required smithing tool to apply hits. Every
          ingredient you loaded adds its own number of required hits per tool; an on-screen title
          tracks current/needed for each.
        </li>
        <li>Finish the craft once every ingredient is loaded and every hit is completed.</li>
      </ol>
      <Callout variant="warning">
        Breaking the station mid-craft cancels the project and drops everything you had already
        inserted.
      </Callout>

      <WikiSectionHeading
        id="recipes"
        intro={<>All 35 recipes the <StationLink name="Forging Station" /> offers, in the order its category menu lists them.</>}
      >
        <StationLink name="Forging Station" /> recipes
      </WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Every one of these is a <strong>template</strong>, not a fixed recipe. The listed
        quantities are ingredient <em>types</em>, so &quot;4 × Metal&quot; means any four metal
        ingredients: four Iron Ingots, four <WikiItemLink name="Mythril Ingot">Mythril Ingots</WikiItemLink>, a mix, or your own alloy. Which ones
        you pick is what changes the finished item. The name is generated at craft time, so the{" "}
        <span className="italic text-[var(--tfmc-accent)]">Material</span> part of each output
        name below is a placeholder rather than a literal word. None of the 35 has a crafting
        time, a cost or a level requirement.
      </p>

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">
        Armor · 20 recipes
      </h3>
      <DataTable
        columns={[
          { header: "Class", nowrap: true },
          { header: "Item" },
          { header: "Ingredients" },
          { header: "Socket track", nowrap: true },
        ]}
        rows={armorRecipeTemplates.map((recipe) => [
          recipe.group,
          <TemplateName key={recipe.id} name={recipe.name} />,
          <IngredientTypeList key={recipe.id} ingredients={recipe.ingredients} />,
          socketTrackLabel[recipe.socketGroup],
        ])}
        rowKey={(_row, index) => armorRecipeTemplates[index].id}
        minWidth="40rem"
      />

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">
        Weapons · 12 recipes
      </h3>
      <DataTable
        columns={[{ header: "Item" }, { header: "Ingredients" }]}
        rows={weaponRecipeTemplates.map((recipe) => [
          <TemplateName key={recipe.id} name={recipe.name} />,
          <IngredientTypeList key={recipe.id} ingredients={recipe.ingredients} />,
        ])}
        rowKey={(_row, index) => weaponRecipeTemplates[index].id}
      />

      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">
        Bows · 3 recipes
      </h3>
      <DataTable
        columns={[{ header: "Item" }, { header: "Ingredients" }]}
        rows={bowRecipeTemplates.map((recipe) => [
          <TemplateName key={recipe.id} name={recipe.name} />,
          <IngredientTypeList key={recipe.id} ingredients={recipe.ingredients} />,
        ])}
        rowKey={(_row, index) => bowRecipeTemplates[index].id}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Every weapon and bow, and all armor except Mage armor, takes Gemstone sockets. Mage armor
        is the only recipe group on the Armor Rune track.
      </p>
      <WikiSectionHeading
        id="quality"
        intro="Every finished craft lands on one of five grades, which decides the socket it gets."
      >
        Quality
      </WikiSectionHeading>
      <DataTable
        className="mt-4"
        columns={[
          { header: "Threshold", align: "right", nowrap: true },
          { header: "Quality" },
          { header: "Socket granted" },
        ]}
        rows={qualityTiers}
      />
      <Callout variant="note" className="mt-4">
        Mage armor uses a separate socket track instead of the Gemstone track above: Minor /
        Lesser / Greater / Ascendant Armor Rune, at the same thresholds. In both tracks the
        lowest grade, Rusted, grants no socket at all, so only the top four grades give you one.
      </Callout>
      <WikiSectionHeading id="tools" intro="Right-click the station while holding one of these.">
        Smithing tools
      </WikiSectionHeading>
      <ItemGallery items={smithingTools} centeredSelectors />

      <WikiSectionHeading id="stations" intro="Built on a vanilla crafting table.">
        Building the stations
      </WikiSectionHeading>
      <div className="mt-4 grid grid-cols-1 gap-4">
        <CraftingGrid recipe={weaponStationRecipe} />
        <CraftingGrid recipe={ingredientConverterRecipe} />
        <CraftingGrid recipe={alloyForgeRecipe} />
      </div>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        The <strong><StationLink name="Ingredient Converter" /></strong> turns a raw material into an AdvancedCrafting
        ingredient: right-click it holding a listed material and it opens a{" "}
        <strong>Stat Preview</strong> showing what stats that ingredient contributes. Holding
        something with no matching stats gives &quot;This item has no stats matching any
        template.&quot;
      </p>

      <WikiSectionHeading
        id="ingredients"
        intro="What you load into a recipe slot decides the finished item's stats, and how many hits of each tool it demands."
      >
        Ingredients
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Base metals and woods: the only ingredients that can be an alloy's base.</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {[{ label: "Metals", type: "Metal" }, { label: "Woods", type: "Wood" }].map(({ label, type }) => (
          <section
            key={type}
            className="rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-3"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">{label}</h3>
            <ul className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
              {baseMetalsAndWoods.filter(([, itemType]) => itemType === type).map(([name]) => (
                <li key={name as string} className="text-sm">
                  <ItemChip
                    name={name as string}
                    texture={name === "Iron Ingot" ? V("iron_ingot.png") : undefined}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <p className="mt-6 text-sm text-[var(--tfmc-mist)]">Gemstone catalysts.</p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {gemstones.map(([name]) => (
          <li
            key={name}
            className="rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] px-3 py-2 text-sm"
          >
            <ItemChip name={name} texture={gemstoneTexture(name)} />
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-[var(--tfmc-mist)]">Other crystal catalysts.</p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {otherCatalysts.map(([name]) => (
          <li
            key={name}
            className="rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] px-3 py-2 text-sm"
          >
            {name === "Raw Tin" ? (
              <Link href="/wiki/materials/tin" className="underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline">
                <ItemChip name={name} texture={catalystTextures[name]} link={false} />
              </Link>
            ) : <ItemChip name={name as string} texture={catalystTextures[name as string]} />}
          </li>
        ))}
      </ul>

      <p className="mt-6 text-sm text-[var(--tfmc-mist)]"><WikiItemLink name="Leather" />, feather, wool, paper and dust.</p>
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {["Leather", "Feather", "Wool", "Paper", "Enchanted Dust"].map((type) => (
          <section
            key={type}
            className="rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-3"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">{type}</h3>
            <ul className="mt-2 space-y-2 text-sm">
              {clothAndAnimal.filter(([, itemType]) => itemType === type).map(([name]) => (
                <li key={name as string}>
                  <ItemChip name={name as string} texture={clothTextures[name as string]} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <WikiSectionHeading id="alloy-forge" intro={<>Invent your own named metal at the <StationLink name="Alloy Forge" />.</>}>
        Inventing an alloy
      </WikiSectionHeading>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Place an <StationLink name="Alloy Forge" /> (recipe above).</li>
        <li>Right-click the forge holding ingredients to load them.</li>
        <li>
          The forge tracks one Base: only a metal or wood ingredient can fill it. The only
          catalysts a metal or wood base accepts are <strong>crystal</strong> ingredients: the
          gemstones and other crystals listed above. <WikiItemLink name="Leather" />, feather, wool, paper and <WikiItemLink name="Enchanted Dust">enchanted dust</WikiItemLink>{" "}
          are not valid alloy catalysts (<code>config.yml:47-51</code>).
        </li>
        <li>Forge it. You need at least 2 ingredients total (a base plus at least one catalyst).</li>
        <li>
          If the resulting alloy is new, you get a 60-second naming prompt: run{" "}
          <code className="text-[var(--tfmc-accent)]">/alloy name &lt;NewName&gt;</code> (letters
          and underscores only; underscores render as spaces).
        </li>
        <li>
          Once named, the alloy is stored server-wide and anyone can use it as a crafting
          ingredient.
        </li>
      </ol>
      <StatGrid
        className="mt-4"
        columns={2}
        stats={[
          { label: "Alloy naming prompt", value: "60 seconds" },
          { label: "Minimum ingredients", value: "2", note: "1 base + at least 1 catalyst" },
        ]}
      />

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={advancedCraftingCommands.commands}
        showAliases={false}
      />

      <SeeAlso hrefs={["/wiki/materials", "/wiki/stations", "/wiki/commands", "/wiki/recycler"]} />
    </WikiPage>
  );
}
