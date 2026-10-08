import { DataTable, SeeAlso, WikiItemLink, WikiPage, WikiSectionHeading, WoodworkingGallery } from "@/app/components/wiki";
import { woodworkingActions, woodworkingCategories, woodworkingMaterials, woodworkingProjects, woodworkingQualities } from "../data/woodworking";

export default function WoodworkingPage() {
  return (
    <WikiPage
      lastModified="2026-09-18"
      title="Woodworking Furniture"
      intro={`Woodworkers build decorative furniture at the Woodworking Station: ${woodworkingProjects.length} pieces in ${woodworkingCategories.length} styles.`}
      width="lg"
    >
      <WikiSectionHeading id="catalogue">Furniture pieces</WikiSectionHeading>
      <WoodworkingGallery categories={woodworkingCategories} projects={woodworkingProjects} />

      <WikiSectionHeading id="materials" intro="Every piece is made from these five materials.">Materials</WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        {woodworkingMaterials.map((name, i) => (
          <span key={name}>{i ? ", " : ""}<WikiItemLink name={name}>{name}</WikiItemLink></span>
        ))}.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        All five drop from logs you chop (spruce, oak, birch, jungle, dark oak, acacia, cherry, mangrove or pale oak) once you have the
        Herborist profession perk Tree Gatherer III. A Forestry resource node set to the Rare Wood Forestry production focus also produces them.
      </p>

      <WikiSectionHeading id="tools" intro="Pieces are shaped with artisan tools. Hold the matching tool in your main hand for each action.">Tool work</WikiSectionHeading>
      <DataTable columns={[{ header: "Action" }, { header: "Tool" }, { header: "Type" }]} rows={woodworkingActions.map((row) => [row.action, <WikiItemLink key={row.tool} name={row.tool}>{row.tool}</WikiItemLink>, row.group])} />

      <WikiSectionHeading id="quality" intro="The more accurate your tool work, the better the finished piece.">Quality</WikiSectionHeading>
      <DataTable columns={[{ header: "Quality" }, { header: "Accuracy needed", align: "right" }]} rows={woodworkingQualities.map((row) => [row.name, row.accuracy])} />

      <SeeAlso hrefs={["/wiki/furniture", "/wiki/advanced-crafting", "/wiki/stations"]} />
    </WikiPage>
  );
}
