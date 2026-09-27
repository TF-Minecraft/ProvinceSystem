import Link from "next/link";
import { notFound } from "next/navigation";
import { Callout, DataTable, StationLink, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { getVehicleBySlug, vehicles } from "../../data/vehicles";
import VehiclePreview from "../VehiclePreview";

export function generateStaticParams() {
  return vehicles.map(({ slug }) => ({ slug }));
}

export default async function VehicleDetail({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const vehicle = getVehicleBySlug(slug);
  if (!vehicle) notFound();
  return (
    <WikiPage lastModified="2026-09-27" title={vehicle.name} intro={vehicle.kind}>
      <Link href="/wiki/vehicles" className="text-sm text-[var(--tfmc-accent)] underline">All vehicles and operating guide</Link>
      <VehiclePreview skins={vehicle.skins} />
      <WikiSectionHeading id="blueprint">Build blueprint</WikiSectionHeading>
      <DataTable columns={[{ header: "Requirement" }, { header: "Details" }]} rows={[
        ["Construction station", <StationLink key="station" name={vehicle.station} />], ["Category", vehicle.kind],
        ["Profession", vehicle.requirement], ["Build time", vehicle.buildTime],
      ]} />
      <DataTable className="mt-4" columns={[{ header: "Material" }, { header: "Quantity", align: "right" }]}
        rows={vehicle.inputs.split(", ").map((input) => { const [qty, ...name] = input.split(" "); const itemName = name.join(" "); return [<WikiItemLink key={input} name={itemName} />, qty]; })} />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">Select this blueprint at the station, then left-click the spawn point within 12 blocks before the 30-second selection timer expires. Inputs are consumed at placement. Stay within 96 blocks when construction finishes, then right-click to claim and select a seat. Breaking the station during construction cancels the build and drops the inputs at the station.</p>
      <WikiSectionHeading id="specifications">Specifications</WikiSectionHeading>
      <DataTable columns={[{ header: "Feature" }, { header: "Details" }]} rows={[
        ["Seats: captain / mechanic / passenger", vehicle.seats], ["Components and HP", vehicle.components.replaceAll("_", " ")],
        
        ["Fuel", <WikiItemLink key="fuel" name={vehicle.fuel} />], ["Mounted weapons", vehicle.weapons], ["Cargo", vehicle.cargo],
      ]} />
      {vehicle.fuelStats ? <>
        <WikiSectionHeading id="fuel">Fuel tank</WikiSectionHeading>
        <DataTable columns={[{ header: "Capacity" }, { header: "Burn / second" }, { header: "Items to fill" }, { header: "Full-tank runtime" }]}
          rows={[[vehicle.fuelStats.capacity, vehicle.fuelStats.burn, vehicle.fuelStats.items, vehicle.fuelStats.runtime]]} />
        <Callout>Each fuel item supplies 100 units. Hold <WikiItemLink name={vehicle.fuel} /> and right-click once per item. {vehicle.fuel === "Arcane Fuel" ? <>Stop the engine before adding <WikiItemLink name="Arcane Fuel" />.</>: "Coal Blocks can be added while the engine runs."} Fuel burn is flat whenever the engine runs at nonzero throttle; using 20% throttle does not save fuel.</Callout>
      </>: <Callout>This vehicle has no fuel tank to fill. {vehicle.fuel.includes("wind") ? "Its sails use wind.": "See its movement type above; train cars and emplacements have no independent engine."}</Callout>}
      {vehicle.category === "train" ? <Callout variant="warning">Build this vehicle on custom <WikiItemLink name="Train Track">train tracks</WikiItemLink>. See the <Link href="/wiki/vehicles#tracks" className="underline">train-track guide</Link>.</Callout>: null}
      {vehicle.id === "small_car" ? <Callout>Start the engine before driving and use the gears to increase speed. Space toggles headlights; left-click sounds the horn. Run <code className="text-[var(--tfmc-accent)]">/vf keybinds</code> while seated for the driving controls.</Callout> : null}
      <WikiSectionHeading id="operating">Operate and maintain</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Right-click to select a seat. Only the captain steers; run <code className="text-[var(--tfmc-accent)]">/vf keybinds</code> while seated for this vehicle’s current controls. Shift reopens seat selection. Use <Link href="/wiki/vehicles#repair" className="underline">Vehicle Repair</Link> from outside while stationary and grounded, or from a mechanic seat.</p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">Newly claimed vehicles are owner-only until their whitelist is changed. Ownership Settings controls passenger access and tickets. Unloading beyond 160 blocks is storage, not destruction; use <code className="text-[var(--tfmc-accent)]">/vf findvehicles</code> to locate your vehicles.</p>
      <Link href="/wiki/vehicles#operation" className="mt-4 inline-block text-[var(--tfmc-accent)] underline">Full driving, weapons, repair, storage and ownership instructions</Link>
    </WikiPage>
  );
}
