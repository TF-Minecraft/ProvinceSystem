import { Callout, SeeAlso, StatGrid, WikiPage, WikiSectionHeading } from "@/app/components/wiki";

export default function EquipmentSlotsPage() {
  return (
    <WikiPage lastModified="2026-09-11" title="Equipment Slots" intro="Equip one Ring, one Amulet and two Artifacts in the extra slots inside your normal inventory.">
      <WikiSectionHeading id="equip">Equip an accessory</WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]"><li>Press E to open your normal inventory.</li><li>Drag and click a matching accessory into the matching accessory slot.</li><li>Keep accessories unstacked; stacked items cannot be equipped.</li></ol>
      <StatGrid className="mt-4" columns={2} stats={[{label:"Accessories",value:"10 rings · 9 amulets · 11 artifacts"}]} />
      <Callout variant="warning" className="mt-4">These slots replace four ordinary storage spaces.</Callout>
      <SeeAlso hrefs={["/wiki/classes","/wiki/advanced-crafting"]} />
    </WikiPage>
  );
}
