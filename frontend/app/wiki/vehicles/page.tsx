import Link from "next/link";
import { Callout, CommandTable, DataTable, RankName, SeeAlso, StationLink, StatGrid, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { vehicleAmmunition, vehicleCommands, vehicleTrackItems, vehicles, vehicleWeapons } from "../data/vehicles";
import VehicleGallery from "./VehicleGallery";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { constructionStations } from "../data/vehicle-construction";

const linkClass = "text-[var(--tfmc-accent)] underline";
const ammoName = (name: string) => {
  if (name.includes("cannonball") && name.includes("clusterbomb")) {
    return <><WikiItemLink name="Cannonball" /> (+ <WikiItemLink name="Clusterbomb" /> on some)</>;
  }
  const display = name.replaceAll("flak_bullet", "Flak Shells").replaceAll("bullet", "Bullet Box").replaceAll("cannonball", "Cannonball").replaceAll("clusterbomb", "Clusterbomb");
  return <WikiItemLink name={display} />;
};

const ammunitionName = (name: string) => {
  const display = name === "Bullets" ? "Bullet Box" : name;
  const canonical = name === "Small Bomb (rack)" ? "Small Bomb Rack" : display;
  return <WikiItemLink name={canonical}>{display}</WikiItemLink>;
};


export default function VehiclesPage() {
  return (
    <WikiPage lastModified="2026-09-27" title="Vehicles & Construction" width="lg" intro="Build a cart, crew a ship or fly an airship. Choose a vehicle below for its materials, build time, fuel and 3D preview.">
      <StatGrid stats={[{ label: "Vehicles", value: 21 }, { label: "Construction", value: "2 hours to 3 days" }, { label: "Air vehicle unlock", value: "6 Crafter points total" }]} />
      <WikiSectionHeading id="catalogue">Choose a vehicle</WikiSectionHeading>
      <VehicleGallery vehicles={vehicles} />
      <WikiSectionHeading id="construction">Build your first vehicle</WikiSectionHeading>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Open <code className="text-[var(--tfmc-accent)]">/professions</code> and buy Engineer ranks in the <Link href="/wiki/characters" className={linkClass}>Crafter profession</Link>. Engineer I costs 1 point for ground vehicles. Engineer II requires I and costs 2 more points for ships. Engineer III requires II and costs 3 more points for aircraft.</li>
        <li>Craft and place an <StationLink name="Engineering Table" /> for land vehicles, fixed guns and aircraft, or a <StationLink name="Dockyard" /> for ships. Use the crafting-table patterns below.</li>
        <li>Right-click the station, choose a category and select a blueprint that your Engineer rank unlocks. Gather its listed materials before selecting the building spot.</li>
        <li>Left-click the intended spawn point within 12 blocks of the station. Choose it within 30 seconds of selecting the blueprint. The materials are consumed when you choose the spot.</li>
        <li>Wait for the build to finish. Stay within 96 blocks so the completed vehicle can appear, then right-click it to claim it and select a seat.</li>
      </ol>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">{constructionStations.map(recipe=><CraftingGrid key={recipe.key} recipe={recipe}/>)}</div>
      <Callout title="A cargo cart to start with">The <Link href="/wiki/vehicles/wooden-cart" className={linkClass}>Wooden Cart</Link> needs Engineer I, 64 Oak Logs, 16 Iron Ingots and 16 Sticks. It takes two hours to build and carries 54 cargo slots.</Callout>
      <Callout variant="warning">Breaking the construction station during a build cancels construction and drops the materials at the station. Collect them before they despawn.</Callout>
      <WikiSectionHeading id="operation">Enter, drive, refuel and tow</WikiSectionHeading>
      <ol className="list-decimal space-y-3 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li><strong>Enter:</strong> right-click the vehicle and choose a seat. Shift reopens seat selection while aboard. Only the captain steers.</li>
        <li><strong>Drive:</strong> run <code className="text-[var(--tfmc-accent)]">/vf keybinds</code> while seated to see the controls for your vehicle. W/S commonly adjusts throttle and A/D steers. Controls can change between ground, flight and water.</li>
        <li><strong>Refuel:</strong> hold the fuel listed on the vehicle page and right-click once per item. Each Coal Block or <WikiItemLink name="Arcane Fuel" /> adds 100 fuel units. Stop an <WikiItemLink name="Arcane Fuel" /> engine before refuelling; Coal Blocks can be added while an engine runs.</li>
        <li><strong>Carry cargo:</strong> right-click a vehicle with storage to open its containers. Wooden Cart and Cloudskimmer each hold 54 slots. Behemoth has four 54-slot holds. Coal Car holds 27 slots of Coal Blocks.</li>
        <li><strong>Tow:</strong> sneak-right-click a Wooden Cart or Field Artillery, then sneak-right-click a Horse Cart to connect it. Repeat on the towing vehicle to detach. Stay within eight blocks while making the connection.</li>
      </ol>
      <Callout title="Save fuel by stopping the engine">Fuel burns at the same rate at any throttle above or below zero; zero throttle uses none. Locomotive overdrive above 100% burns more. A damaged engine also limits maximum throttle, so repair it to restore power.</Callout>
      <WikiSectionHeading id="ownership">Ownership and passengers</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Claim a new vehicle by right-clicking it. A claimed vehicle starts with an owner-only whitelist. Open Ownership Settings in Select Seat to allow other players, add a player by name or enable passenger tickets. With tickets enabled, hold Paper and right-click your vehicle to make matching tickets for passengers. Reset Owner releases ownership. Clicking an occupied yellow seat ejects its passenger and prevents re-entry for 60 seconds.</p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">Use <code className="text-[var(--tfmc-accent)]">/vf findvehicles</code> to locate your vehicles. Vehicles more than 160 blocks from players unload into storage; they are not destroyed.</p>
      <WikiSectionHeading id="repair">Repair and repaint</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Hold Vehicle Repair and right-click a grounded, stationary vehicle, or use a mechanic seat to repair while aboard. Use the Repair Tool in the menu to fix components and the Water Bucket for fires. Keep the menu open and stay nearby until repair finishes. Hold <WikiItemLink name="Vehicle Paint" /> and right-click to open Select Skin.</p>
      <DataTable className="mt-4" columns={[{ header: <><StationLink name="Engineer Station" /> tool</> }, { header: "Materials" }, { header: "Time" }, { header: "Requirement" }]}
        rows={[["Vehicle Repair", "4 Iron Ingots", "5 seconds", "Vehicle Mechanic profession"], [<WikiItemLink key="paint" name="Vehicle Paint" />, <>1 <WikiItemLink name="Common Item Skin Scroll" /></>, "5 seconds", <>Vehicle Mechanic and <RankName rank="Gilded" /> rank or higher</>]]} />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">Vehicle Mechanic costs two Crafter profession points. Keep ship pumps repaired to control flooding. Repair damaged engines and wings to recover performance.</p>
      <WikiSectionHeading id="skins">Preview skins</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Choose a vehicle above, then select one of its available skins beside the preview. In game, use <WikiItemLink name="Vehicle Paint" /> to choose from the skins available to you.</p>
      <WikiSectionHeading id="weapons">Mounted weapons and ammunition</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Choose the seat assigned to a weapon. Hold its ammunition and right-click to reload, then use Space to fire. W/S adjusts elevation and A/D traverses; mounted rifles aim toward your cursor. Check <code className="text-[var(--tfmc-accent)]">/vf keybinds</code> for the controls of your current seat.</p>
      <DataTable className="mt-4" columns={[{ header: "Weapon" }, { header: "Reload" }, { header: "Ammunition" }]}
        rows={vehicleWeapons.map((row) => [row[1], row[2], ammoName(row[4])])} />
      <DataTable className="mt-4" columns={[{ header: "Ammunition" }, { header: "Rounds per item" }]}
        rows={vehicleAmmunition.map((row) => [ammunitionName(row[0]), row[3]])} />
      <Callout>Each barrel receives a load of ammunition. One Bullet Box loads 200 rounds into the Biplane's two-barrel Front Rifles. <WikiItemLink name="Small Bomb Rack">Small Bomb Racks</WikiItemLink> supply eight bombs per load. Mounted weapons use vehicle ammunition from the <StationLink name="Engineer Station" />.</Callout>
      <Callout variant="warning"><WikiItemLink name="Cannonball">Cannonballs</WikiItemLink> and bombs can damage terrain. <WikiItemLink name="Cannonball">Cannonballs</WikiItemLink> can also start fires and apply Poison for ten seconds.</Callout>
      <WikiSectionHeading id="tracks">Train tracks</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">Build trains on custom <WikiItemLink name="Train Track">train tracks</WikiItemLink>. Craft <WikiItemLink name="Train Track" /> in batches of 64 at the <StationLink name="Block Station" />. Leave room for wide bends and gentle slopes: turns have a 35-degree limit, and slopes have a 10-degree maximum.</p>
      <DataTable className="mt-4" columns={[{ header: "Track item" }, { header: "Use" }]}
        rows={vehicleTrackItems.slice(0, 5).map((row) => [<WikiItemLink key={row[0]} name={row[0]} />, row[0] === "Train Track" ? <>the track piece itself (64 per craft at the <StationLink name="Block Station" />)</> : row[2]])} />
      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable commands={vehicleCommands.commands} />
      <SeeAlso hrefs={["/wiki/characters", "/wiki/materials", "/wiki/stations", "/wiki/commands"]} />
    </WikiPage>
  );
}
