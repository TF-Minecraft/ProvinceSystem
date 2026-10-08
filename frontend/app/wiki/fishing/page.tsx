import { DataTable, SeeAlso, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { rodRecipes } from "../data/fishing";



export default function FishingPage() {
  return (
    <WikiPage
      lastModified="2026-09-12"
      title="Fishing"
      width="lg"
      intro={
        <>
          When something bites, you play a timing minigame. What you catch depends on your rod
          tier, the biome you&apos;re fishing in, and any hook and bait you have equipped. Win the
          minigame and you get the loot; lose it and the fish gets away.
        </>
      }
    >
      <WikiSectionHeading id="loop">The basic loop</WikiSectionHeading>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-[var(--tfmc-mist)]">
        <li>1. Get a rod: there are four tiers (below).</li>
        <li>2. Optionally right-click the rod while holding a hook to attach it; right-click the rod again to remove it. Its remaining uses show in the rod&apos;s lore.</li>
        <li>3. Optionally put bait in your off-hand.</li>
        <li>4. Cast normally. The wait for a bite is 5–30 seconds base, and never less than 2.5 s or more than 60 s after every modifier is applied.</li>
        <li>5. When it bites, one of 17 minigames fires, at a difficulty set by your rod tier.</li>
      </ol>

      <WikiSectionHeading
        id="tiers"
        intro="Each rod pairs with one hook. The hook adds durability and shaves time off the wait."
      >
        Rod and hook tiers
      </WikiSectionHeading>
      <DataTable
        className="mt-4"
        minWidth="40rem"
        columns={[
          { header: "Rod", width: "10rem" },
          { header: "Hook" },
          { header: "Hook durability", align: "right" },
          { header: "Wait-time ×", align: "right" },
          { header: "Minigame tier" },
        ]}
        rows={[
          ["Fishing Rod", <WikiItemLink key="iron-hook" name="Iron Hook" />, "250 uses", "0.9", "Easy"],
          [<WikiItemLink key="steel-rod" name="Steel Rod" />, <WikiItemLink key="steel-hook" name="Steel Hook" />, "500 uses", "0.8", "Normal"],
          [<WikiItemLink key="abyssalite-rod" name="Abyssalite Rod" />, <WikiItemLink key="abyssalite-hook" name="Abyssalite Hook" />, "1000 uses", "0.7", "Hard"],
          [<WikiItemLink key="mythril-rod" name="Mythril Rod" />, <WikiItemLink key="mythril-hook" name="Mythril Hook" />, "1500 uses", "0.6", "Very hard"],
        ]}
      />
      <div className="mt-4 grid gap-4 xl:grid-cols-2">{rodRecipes.map(recipe=><CraftingGrid key={recipe.key} recipe={recipe}/>)}</div>

      <SeeAlso hrefs={["/wiki/cooking", "/wiki/materials", "/wiki/commands"]} />
    </WikiPage>
  );
}
