import { DataTable, FurnitureGallery, SeeAlso, StationLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { furniture, furnitureRecipes } from "../data/furniture";
export default function FurniturePage() {
  return (
    <WikiPage
      lastModified="2026-09-20"
      title="Interactive Furniture"
      intro="Furniture gives cooking tools and display pieces a physical place in the world. Pieces can rotate, hold items, and in some cases be carried."
      width="lg"
    >
      <WikiSectionHeading id="use">Place and use furniture</WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Hold the furniture and right-click a valid floor or wall. Rotating pieces face you when placed.</li>
        <li>Right-click a slot with an accepted item to insert it; right-click again to retrieve it.</li>
        <li>For carry-enabled cookware, sneak-right-click to lift it, then right-click a surface to set it down.</li>
        <li>
          To pick up a piece, empty its slots and your main hand, then right-click it. Punching it or breaking its
          support also removes it.
        </li>
      </ol>
      <WikiSectionHeading id="catalogue">Furniture pieces</WikiSectionHeading>
      <FurnitureGallery pieces={furniture.map(({ name, id }) => ({ name, id }))} />
      <WikiSectionHeading id="crafting">Recipes</WikiSectionHeading>
      <DataTable
        columns={[{ header: "Pieces" }, { header: "Station" }, { header: "Cost" }, { header: "Time" }]}
        rows={furnitureRecipes.map((x) => [x.pieces, <StationLink key={x.station} name={x.station} />, x.cost, x.time])}
      />
      <SeeAlso hrefs={["/wiki/cooking", "/wiki/advanced-crafting", "/wiki/stations"]} />
    </WikiPage>
  );
}
