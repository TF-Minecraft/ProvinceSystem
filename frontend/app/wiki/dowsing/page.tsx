import { Callout, DataTable, SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import StationModelViewer from "@/app/components/wiki/StationModelViewer";
import { generalNodeModel, generalNodeRecipe, nodeLevels, nodeTypes } from "../data/dowsing";

export default function DowsingPage() {
  return (
    <WikiPage
      lastModified="2026-09-18"
      title="Resource Nodes"
      intro="A node is a guild-owned production site. Place one in a chunk, choose what kind of operation it is, fit it out, feed it materials, and it produces resources on a repeating cycle."
      width="lg"
    >
      <WikiSectionHeading id="node" intro="Crafted at a plain Crafting Table. Anyone can make one.">
        The General Node
      </WikiSectionHeading>
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <CraftingGrid recipe={generalNodeRecipe} />
        <StationModelViewer modelUrl={generalNodeModel.url} textureUrls={generalNodeModel.textures} />
      </div>

      <WikiSectionHeading id="setup" intro="You must belong to a guild; a one-person guild is enough.">
        Set up a node
      </WikiSectionHeading>
      <Callout variant="note" className="mt-4">
        Each guild can own only one node.
      </Callout>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Place the General Node on the floor. Each chunk can hold only one node.</li>
        <li>Right-click the node to open its menu, then pick a node type.</li>
        <li>
          Choose a production focus and the node&apos;s fittings, such as tools, a refinery, lighting or irrigation.
        </li>
        <li>
          Put a Barrel directly under the node and stock it. Fittings that have a running cost take their materials from
          that barrel every cycle.
        </li>
        <li>
          Put a Hopper directly above the node to catch what it produces. Without one, the output drops on top of the
          node.
        </li>
        <li>Activate the node. The menu shows its efficiency and what the last cycle extracted.</li>
      </ol>
      <Callout variant="note" className="mt-4">
        Deactivate the node before you change its type, focus or fittings, upgrade or downgrade it, or delete it.
        Deactivating resets the current cycle and refunds that cycle&apos;s cost.
      </Callout>

      <WikiSectionHeading
        id="types"
        intro="A General Node can run any one of these. The focus decides what the node produces."
      >
        Node types
      </WikiSectionHeading>
      <DataTable
        columns={[
          { header: "Type" },
          { header: "Production focus" },
          { header: "Fittings" },
          { header: "Base cycle", align: "right" },
        ]}
        rows={nodeTypes.map((type) => [type.name, type.focuses.join(", "), type.fittings.join(", "), type.cycle])}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Better tools, refineries and the other fittings raise what a node yields, and a higher node level shortens its
        cycle.
      </p>

      <WikiSectionHeading
        id="levels"
        intro="Upgrades are paid from the guild bank and are the same for every node type."
      >
        Node levels
      </WikiSectionHeading>
      <ol className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {nodeLevels.map((row) => (
          <li
            key={row.level}
            className="rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] px-3 py-2.5 text-center"
          >
            <p className="text-xs uppercase tracking-wide text-[var(--tfmc-mist)]">Level {row.level}</p>
            <p className="mt-1 text-base font-semibold tabular-nums text-[var(--tfmc-cream)]">
              {row.level === 1 ? "Starting level" : row.cost}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Each figure is the cost of upgrading to that level from the one before it.
      </p>

      <WikiSectionHeading id="manage">Transfer or remove a node</WikiSectionHeading>
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          <strong>Transfer Node</strong> marks the node as claimable. The next guild leader who interacts with it claims
          it for their guild.
        </li>
        <li>
          <strong>Delete Node</strong> cannot be undone. Only the node block is refunded; its level and fittings are
          lost.
        </li>
        <li>Only members of the owning guild can change a node.</li>
      </ul>

      <SeeAlso hrefs={["/wiki/factions", "/wiki/gathering", "/wiki/woodworking"]} />
    </WikiPage>
  );
}
