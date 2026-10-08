import { DataTable, SeeAlso, StationLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { recyclingStationRecipe } from "../data/recycler";

const providers = [
  ["Weapons and armour", "Returns some of the original ingredients or alloy components, depending on condition."],
  ["Guns", "Refunds materials according to the weapon recipe and its remaining durability."],
  ["Items with a dedicated recycling recipe", "Returns materials from its recycling recipe."],
];

export default function RecyclerPage() {
  return (
    <WikiPage
      lastModified="2026-09-12"
      title="Recycler"
      intro={
        <>
          The <StationLink name="Recycling Station" /> breaks a crafted item back down into a share of the materials it
          took to make it. A pristine item gives back the most; a worn-down one gives back less,
          and a fully broken item gives back nothing at all.
        </>
      }

    >
      <WikiSectionHeading id="building" intro="Built on a vanilla crafting table.">
        Building the station
      </WikiSectionHeading>
      <div className="mt-4">
        <CraftingGrid recipe={recyclingStationRecipe} />
      </div>

      <WikiSectionHeading id="loop" intro="Right-click the placed station to open it.">
        The loop
      </WikiSectionHeading>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Right-click the <StationLink name="Recycling Station" />.</li>
        <li>
          Drop the item you want to break down into the input slot. An item that cannot be
          recycled at all is rejected with &quot;That item cannot be recycled here.&quot;
        </li>
        <li>
          The middle columns of the menu preview exactly what you would get back. If recycling it
          would return nothing, the preview says so and the confirm button is blocked.
        </li>
        <li>Click confirm. The materials pop out of the station, and you get &quot;Recycling complete.&quot;</li>
        <li>If you close the menu with an item still sitting in the input slot, it is returned to you.</li>
      </ol>

      <WikiSectionHeading id="what-recycles">
        What can be recycled
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Item" }, { header: "What you get back" }]}
        rows={providers}
      />

      <SeeAlso hrefs={["/wiki/materials", "/wiki/stations", "/wiki/commands", "/wiki/advanced-crafting"]} />
    </WikiPage>
  );
}
