import {
  DataTable,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";

export default function HarvestingPage() {
  return (
    <WikiPage lastModified="2026-09-11" title="Crop Harvesting">
      <WikiSectionHeading id="loop" intro="Right-click to harvest; some hoes can also plant.">
        How it works
      </WikiSectionHeading>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-[var(--tfmc-mist)]">
        <li>1. Right-click (break) a mature vanilla crop with a hoe. Every mature crop within the hoe&apos;s radius harvests at once, drops go straight into your inventory, and each spot is auto-replanted after a short delay.</li>
        <li>2. With a hoe that can plant, you can also plant seeds across every empty patch of farmland inside the radius in one action. This never damages the tool.</li>
        <li>3. Immature crops are never touched by an area-harvest.</li>
        <li>4. Unbreaking still saves durability normally.</li>
      </ol>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        The only crops this affects: Wheat, Potatoes, Carrots, Beetroots, and Nether Wart.
      </p>

      <WikiSectionHeading id="radius">
        Hoe harvest areas
      </WikiSectionHeading>
      <DataTable
        className="mt-4"
        columns={[
          { header: "Hoe" },
          { header: "Efficiency", align: "center" },
          { header: "Harvest area", align: "center" },
        ]}
        rows={[
          ["Iron", "II", "1 block"],
          ["Steel", "III", "3×3"],
          ["Abyssalite", "IV", "5×5"],
          ["Mythril", "V", "7×7"],
        ]}
      />

      <SeeAlso hrefs={["/wiki/farming", "/wiki/cooking", "/wiki/brewing", "/wiki/commands"]} />
    </WikiPage>
  );
}
