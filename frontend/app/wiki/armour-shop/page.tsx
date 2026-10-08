import {
  Callout,
  CommandTable,
  DataTable,
  ItemGallery,
  RankName,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import {
  armourShopCommands,
  donatorTiers,
  scrollTiers,
} from "../data/armour-shop";

export default function ArmourShopPage() {
  return (
    <WikiPage
      lastModified="2026-09-11"
      title="Armour Shop"
      intro={
        <>
          The Armour Shop is a cosmetic wardrobe. Open it, spend a Skin Scroll, and restyle the
          armour or weapon you&apos;re holding: the stats never change, only the appearance (and
          sometimes the item&apos;s display name).
        </>
      }
      width="lg"
    >
      <WikiSectionHeading id="how-to">
        How to use it
      </WikiSectionHeading>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Run <code className="text-[var(--tfmc-accent)]">/armourshop</code> and pick Armour skins or Item skins.</li>
        <li>
          Pick a category. The menu shows the categories available to you.
        </li>
        <li>Browse the skins available in that category.</li>
        <li>
          Click a skin to apply it. If it needs a scroll, the shop checks your inventory for it and
          for the first item that matches the skin&apos;s base set (e.g. a steel chestplate for a
          steel-tier skin). Missing either one cancels with an error and a sound: nothing is
          consumed.
        </li>
        <li>Applying a skin consumes exactly 1 scroll and restyles your item, keeping its stats.</li>
        <li>
          To go back, use the free <strong>Reset to Default</strong> category. It covers leather,
          iron, steel, abyssalite, mythril, mage and infantry base sets.
        </li>
      </ol>
      <Callout variant="note">
        Player-forged &quot;custom&quot; gear from the crafting system is skinnable too: every base
        set&apos;s skin list also accepts the equivalent custom-crafted items.
      </Callout>

      <WikiSectionHeading id="scrolls">
        Scroll tiers
      </WikiSectionHeading>
      <ItemGallery centeredSelectors selectorColumns={2} widePreview items={scrollTiers.map((scroll) => ({
        name: scroll.scroll,
        image: `/wiki/textures/skin-scrolls/${scroll.scroll.split(" ")[0].toLowerCase()}.png`,
      }))} />

      <WikiSectionHeading id="donator-tiers" intro="For uploading your own skin on the website.">
        Custom skin perks by rank
      </WikiSectionHeading>
      <DataTable
        columns={[
          { header: "Rank" },
          { header: "Token cooldown", align: "right" },
          { header: "3D helmet" },
          { header: "Skin kinds unlocked" },
        ]}
        rows={donatorTiers.map((t) => [
          t.group === "Noble" || t.group === "Gilded" || t.group === "Ascended" || t.group === "Legacy" ? <RankName key={t.group} rank={t.group} /> : t.group,
          t.tokenCooldown,
          t.armour3d ? "Yes": "No",
          t.skinKindsUnlocked,
        ])}
      />

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable commands={armourShopCommands.commands} excludedStaffCommands={armourShopCommands.excludedStaffCommands} />

      <SeeAlso hrefs={["/wiki/advanced-crafting", "/wiki/economy", "/wiki/commands"]} />
    </WikiPage>
  );
}
