import { SeeAlso, StationLink, StatGrid, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { gunPartRecipes, gunAmmoRecipes } from "../data/guns";

export default function GunsPage(){return <WikiPage lastModified="2026-09-27" title="Guns & Gunsmithing" intro="Musketeers assemble rifles, pistols, shotguns and launchers from a barrel, loader, chamber, action and, where required, a stock." width="lg">
<WikiSectionHeading id="build">Build and fire a gun</WikiSectionHeading><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]"><li>Craft the <StationLink name="Gunsmithing Station" /> in a vanilla table: Copper–Iron–Copper on top, then Oak Planks–empty–Oak Planks for both lower rows.</li><li>As a Musketeer, right-click the placed station without sneaking and choose Rifle, Pistol, Shotgun or Launcher.</li><li>Fill the part slots in order: barrel, loader, chamber, action and stock. Pistols and launchers omit the stock. Click the output slot to build the gun.</li><li>Hold the gun in your main hand with matching ammunition in inventory. Right-click to reload, stand still until complete, then right-click once per shot.</li></ol>
<StatGrid className="mt-4" stats={[{label:"Gun types",value:"4"},{label:"Parts",value:"21",note:"6 barrels · 2 loaders · 4 chambers · 5 actions · 4 stocks"},{label:"Skins",value:"9",note:"chosen automatically from parts"},{label:"Ammo types",value:"24",note:"shot · spreadshot · rocket in iron, steel, bronze and mythril, each also powered"}]}/>
<WikiSectionHeading id="parts">All gun parts</WikiSectionHeading><div className="mt-4 grid gap-4 xl:grid-cols-2">{gunPartRecipes.map(recipe=><CraftingGrid key={recipe.key} recipe={recipe}/>)}</div>
<WikiSectionHeading id="ammo">Ammunition</WikiSectionHeading><div className="mt-4 grid gap-4 xl:grid-cols-2">{gunAmmoRecipes.map(recipe=><CraftingGrid key={recipe.key} recipe={recipe}/>)}</div>
<SeeAlso hrefs={["/wiki/classes","/wiki/advanced-crafting"]}/>
</WikiPage>}
