import Link from "next/link";

import {
  Callout,
  CommandTable,
  DataTable,
  RankName,
  SeeAlso,
  StationLink,
  StatGrid,
  WikiItemLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { letterRecipe, serverFeaturesCommands } from "../data/server-features";
import { stationRecipe } from "../data/station-recipes";

const stoneRecipes = [
  stationRecipe("gen-tool-station-lorestone"),
  stationRecipe("gen-tool-station-namestone"),
];

export default function ServerFeaturesPage() {
  return (
    <WikiPage
      lastModified="2026-10-02"
      title="Server Features & Website Link"
    >
      <WikiSectionHeading id="sealed-letters">
        Sealed letters
      </WikiSectionHeading>
      <div className="mt-4">
        <CraftingGrid recipe={letterRecipe} />
      </div>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Craft four Paper in a square to make a <WikiItemLink name="Letter" />. Write your message in it and click &quot;Sign.&quot; It
        becomes a sealed letter instead of a normal written book. Anyone who right-clicks it reads
        it, and the letter is then marked opened. Right-clicking it onto a lectern or a chiselled
        bookshelf does not break the seal, so you can use those as regular storage without
        accidentally reading someone&apos;s letter.
      </p>
      <Callout variant="note">
        This is not{" "}
        <Link href="/wiki/bird-mail" className="text-[var(--tfmc-accent)] hover:underline">
          Bird Mail
        </Link>
        , which delivers letters to a specific character over real time via a bird coop. A sealed
        letter is just an item: sending it anywhere is still up to you.
      </Callout>

      <WikiSectionHeading id="lorestones" intro="Add a permanent line of lore or a new name to an item.">
        <WikiItemLink name="Lorestone">Lore stones</WikiItemLink> and <WikiItemLink name="Namestone">name stones</WikiItemLink>
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Craft a <WikiItemLink name="Lorestone" /> or <WikiItemLink name="Namestone" /> at the <StationLink name="Tool Station" /> using the recipes below. Pick up
        a <WikiItemLink name="Lorestone" /> or <WikiItemLink name="Namestone" /> on your cursor, then click it onto a single item in your
        own inventory (it must not be stacked). A chat prompt appears: type the text within{" "}
        <strong>60 seconds</strong>, or type <code className="text-[var(--tfmc-accent)]">cancel</code>.
        A <WikiItemLink name="Lorestone" /> adds a line of lore; a <WikiItemLink name="Namestone" /> renames the item instead. If anything goes
        wrong the stone is refunded rather than wasted.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {stoneRecipes.map((recipe) => <CraftingGrid key={recipe.key} recipe={recipe} />)}
      </div>
      <StatGrid
        columns={3}
        stats={[
          { label: "Prompt timeout", value: "60 seconds" },
          { label: "Max line length", value: "100 characters", note: "colour codes count" },
          { label: "Max lore lines per item", value: "10" },
        ]}
      />

      <WikiSectionHeading id="animal-limit">
        Animal limit
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Each player can own at most <strong>15 animals</strong>. Every animal counts towards it, horses and other
        mounts included, so you cannot keep a large flock of one kind, such as 50 chickens for eggs. Plan your
        livestock around the 15 slots.
      </p>

      <WikiSectionHeading id="whistle" intro="Right-click it to find your mount.">
        <WikiItemLink name="Mount Whistle">Animal whistle</WikiItemLink>
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Right click an <StationLink name="Animal Station" /> to craft an <WikiItemLink name="Mount Whistle">Animal Whistle</WikiItemLink>. Right-click while
        holding the <WikiItemLink name="Mount Whistle">animal whistle</WikiItemLink> and every horse, donkey, mule, llama or
        trader llama within range glows so you can spot it through walls.
      </p>
      <StatGrid
        columns={3}
        stats={[
          { label: "Detection range", value: "64 blocks" },
          { label: "Glow duration", value: "5 seconds" },
          { label: "Cooldown", value: "3 seconds" },
        ]}
      />

      <WikiSectionHeading id="crafting-stations" intro="Ordinary-looking blocks open custom crafting menus.">
        Crafting stations
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Right-click (or shift-right-click, depending on the block) a station block, for
        example, a brewing stand for the <StationLink name="Alchemy Station">alchemy station</StationLink>, and a custom crafting-station GUI
        opens instead of the vanilla menu. See the{" "}
        <Link href="/wiki/stations" className="text-[var(--tfmc-accent)] hover:underline">
          Crafting Stations guide
        </Link>{" "}
        for the full list of stations and what each one crafts.
      </p>

      <WikiSectionHeading id="website-link" intro="Your in-game account and the TFMC website are separate until you link Discord.">
        Linking Discord and the website
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Type <code className="text-[var(--tfmc-accent)]">/linkdiscord</code> and the server prints
        a click-to-copy code with instructions. Run <code className="text-[var(--tfmc-accent)]">
        /linkdiscord &lt;code&gt;</code> in the Discord server, and within about a second the
        game confirms the link and opens access to Survival.{" "}
        <code className="text-[var(--tfmc-accent)]">/unlinkdiscord</code> removes the link again.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        <code className="text-[var(--tfmc-accent)]">/token create profile</code> creates a code to
        sign into your website profile.{" "}
        <code className="text-[var(--tfmc-accent)]">/token create skin</code> and{" "}
        <code className="text-[var(--tfmc-accent)]">/token create drink</code> create codes for
        uploading a custom skin or a custom drink, but these two share one cooldown, and how
        often you can create one depends on your rank.
      </p>
      <div className="mt-4">
        <DataTable
          columns={[
            { header: "Rank", nowrap: true },
            { header: "Skin/drink code cooldown", align: "right" },
          ]}
          rows={[
            [<RankName key="commoner" rank="Commoner" />, "Not available"],
            [<RankName key="legacy" rank="Legacy" />, "7 days"],
            [<RankName key="ascended" rank="Ascended" />, "14 days"],
            [<RankName key="gilded" rank="Gilded" />, "21 days"],
            [<RankName key="noble" rank="Noble" />, "28 days"],
          ]}
        />
      </div>
      <Callout variant="note" className="mt-4">Bird-mail arrivals are forwarded to your Discord messages when your account is linked. The message does not reveal the sender or the letter&apos;s contents.</Callout>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={serverFeaturesCommands.commands}
        excludedStaffCommands={serverFeaturesCommands.excludedStaffCommands}
        showAliases={false}
      />

      <WikiSectionHeading id="companion-pets" intro="Hatch a companion, care for it and teach it tricks.">
        Companion pets
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Use a pet egg, name your companion in chat and look after its food, mood, rest,
        cleanliness and health. A shelter keeps your pets safe between outings. See the{" "}
        <Link href="/wiki/companion-pets" className="text-[var(--tfmc-accent)] hover:underline">
          Companion Pets guide
        </Link>{" "}
        for care supplies, shelter controls, playing fetch and teaching your own words for tricks.
      </p>

      <SeeAlso hrefs={["/wiki/stations", "/wiki/bird-mail", "/wiki/characters", "/wiki/companion-pets"]} />
    </WikiPage>
  );
}
