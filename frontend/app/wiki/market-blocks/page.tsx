import { SeeAlso, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import { marketBlockRecipe } from "../data/market-blocks";

export default function MarketBlocksPage() {
  return (
    <WikiPage lastModified="2026-09-27" title="Market Block" intro={<>A Market Block is a shop you place yourself: right-click it and sell raw materials for denars. It only buys: there is no way to purchase items back from it. The more of one material the block has already absorbed, the less it pays for the next bundle, and that price slowly recovers if you leave it alone.</>} width="lg">
      <WikiSectionHeading id="how-to">How it works</WikiSectionHeading>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Craft a Market Block (recipe below) and place it.</li>
        <li>Right-click it to open <strong>Market Categories</strong>: Metal, Mineral, Stone, Wood, Farm, Fish, Alchemy.</li>
        <li>Click a category to see its trades, each showing the item, its current price, and a demand bar.</li>
        <li>Click a trade to sell a full bundle of that item for denars, paid straight into your pouch.</li>
      </ol>
      <div className="mt-4"><CraftingGrid recipe={marketBlockRecipe} /></div>
      <SeeAlso hrefs={["/wiki/economy", "/wiki/materials", "/wiki/stations", "/wiki/commands"]} />
    </WikiPage>
  );
}
