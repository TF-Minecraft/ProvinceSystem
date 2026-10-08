import { Callout, ItemGallery, SeeAlso, StatGrid, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { gemInfusionTables, goldMaterials, goldTools, jewelleryProjects } from "../data/gem-infusion";

const gemTables = gemInfusionTables.slice(1, 5);
const jewelleryTextures: Record<string, string> = {
  gold_ring: "gold_ring", jeweled_gold_ring: "jeweled_gold_ring", purple_ring: "purple_ring", red_ring: "red_ring", green_ring: "green_ring",
  red_necklace: "red_necklace", purple_necklace: "purple_necklace", dark_necklace: "dark_necklace", pendant: "pendant",
  green_medal: "green_medal", blue_medal: "blue_medal", mirror: "mirror", chalice: "chalice", bracelet: "bracelet",
};
function gemTexture(name: string) {
  const filename = name === "Direstone (key firestone)" ? "firestone" : name.toLowerCase().replaceAll("'", "").replaceAll(" ", "_");
  return `/wiki/textures/gems/${filename}.png`;
}
const goldsmithToolTextures: Record<string, string> = {
  "Goldsmith Branding Tool": "branding_tool",
  "Goldsmith Hammer": "smith_hammer",
  "Small Goldsmith Hammer": "small_smith_hammer",
  "Goldsmith Tinker Tool": "smith_tinker_tool",
};
export default function GemInfusionPage() {
  return <WikiPage lastModified="2026-09-12" title="Gem Infusion" width="lg" intro="Turn blank gemstones into stat-bearing Infused Gemstones at an Enchanting Table. Goldsmiths can then build jewellery around one infused gem at a Smithing Table.">
    <WikiSectionHeading id="infusion">Infuse a batch</WikiSectionHeading>
    <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-[var(--tfmc-mist)]">
      <li>Bring a Blank Gemstone from the 40-entry catalogue and an <WikiItemLink name="Infusion Ticket" /> to any Enchanting Table. An ordinary vanilla jewel will not work.</li>
      <li>Hold a blank gem and right-click the table to deposit one. Repeat up to 10 gems. Deposited gems leave your hand.</li>
      <li>Hold the <WikiItemLink name="Infusion Ticket" /> and left-click the table five times. After the first hit, the batch is locked and cannot accept more gems.</li>
      <li>The fifth hit consumes one Infusion Ticket for the entire batch. Collect every infused gem that drops above the table. A Legendary result is announced server-wide.</li>
    </ol>
    <StatGrid stats={[{label:"Batch size",value:"1-10 gems"},{label:"Finish",value:"5 left-clicks"},{label:"Infusion Tickets",value:"1 per completed batch"}]}/>
    <WikiSectionHeading id="stats">Read the gemstone correctly</WikiSectionHeading>
    <p className="mt-4 text-sm text-[var(--tfmc-mist)]">Basic, Polished, Radiant and Mythical are socket types, with ten gems in each. Common, Rare, Epic and Legendary are independently rolled rarities. The resulting name is, for example, Legendary Infused Ruby. Match the Gemstone Type to the receiving socket. Names, lore and rarity are restored when the gem is unsocketed.</p>
    {gemTables.map((table,index)=><section key={table.title}><WikiSectionHeading id={`gems-${index}`}>{table.title}</WikiSectionHeading><ItemGallery items={table.rows.map(row => ({name:row[0],image:gemTexture(row[0])}))}/></section>)}
    <WikiSectionHeading id="goldsmithing">Make jewellery</WikiSectionHeading>
    <Callout title="Goldsmith profession required">Any player can infuse gems. Crafting jewellery requires the Goldsmith profession.</Callout>
    <ol className="mt-4 list-decimal space-y-3 pl-6 text-sm text-[var(--tfmc-mist)]">
      <li>Right-click an empty Smithing Table and choose one of the 14 projects.</li><li>Right-click with each required gold material to deposit one item per click. Follow the exact recipe.</li><li>Right-click with one Infused Gemstone. Every project requires exactly one. Any of the 40 infused gems is accepted.</li><li>Left-click with the <WikiItemLink name="Goldsmith Hammer" />, <WikiItemLink name="Small Goldsmith Hammer" /> and <WikiItemLink name="Goldsmith Tinker Tool">Tinker Tool</WikiItemLink> to fill their respective counters.</li><li>Right-click with the <WikiItemLink name="Branding Tool" /> to inspect material, gem and hit progress. When every requirement is exactly complete, left-click with it to finish and collect the jewellery dropped on the bench.</li><li>To cancel, shift-left-click with the <WikiItemLink name="Branding Tool" />. Materials and the gem return to inventory; overflow drops at your feet.</li>
    </ol>
    <Callout variant="warning">Finishing requires exact ingredients and exact hit counts. Breaking a bench refunds deposits to the person who breaks it.</Callout>
    <section><WikiSectionHeading id="gold-0">Gold materials</WikiSectionHeading><ItemGallery items={goldMaterials.rows.map(row=>({name:row[1],image:`/wiki/textures/materials/${row[0]}.png`}))}/></section>
    <section><WikiSectionHeading id="gold-1">Goldsmithing tools</WikiSectionHeading><ItemGallery items={goldTools.rows.map(row=>({name:row[0],image:`/wiki/textures/goldsmith-tools/${goldsmithToolTextures[row[0]]}.png`,detail:`Produces: ${row[2]}`}))}/></section>
    <section><WikiSectionHeading id="gold-2">Jewellery</WikiSectionHeading><ItemGallery items={jewelleryProjects.rows.map(row=>({name:row[1],image:`/wiki/textures/jewellery/${jewelleryTextures[row[0]]}.png`}))}/></section>
    <SeeAlso hrefs={["/wiki/research","/wiki/magic","/wiki/materials","/wiki/stations"]}/>
  </WikiPage>;
}
