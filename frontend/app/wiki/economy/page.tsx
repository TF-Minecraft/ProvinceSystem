import {
  Callout,
  CommandTable,
  ItemGallery,
  SeeAlso,
  StatGrid,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { denarCoins, denarCommands } from "../data/economy";
import { WikiItemLink } from "@/app/components/wiki";

export default function EconomyPage() {
  return (
    <WikiPage
      lastModified="2026-09-12"
      title="Denar Economy"
      intro={
        <>
          Denars are the server&apos;s money. You carry them as a <strong>pouch</strong> balance or as physical gold and
          silver coin items, and you can also stash them safely in your faction&apos;s <strong>bank</strong>. Every
          trade at a <WikiItemLink name="Market Block" />, every coin you find mining or farming, and every faction wage
          or tax runs through this system.
        </>
      }
    >
      <WikiSectionHeading id="accounts" intro="Every player has two separate balances.">
        Pouch and bank
      </WikiSectionHeading>
      <StatGrid
        stats={[
          { label: "Pouch", value: "Carried money", note: "Dropped in full on death unless you keep your inventory" },
          { label: "Bank", value: "Stored money", note: "Safe on death: requires a faction bank chunk to use" },
        ]}
      />
      <Callout variant="warning">
        Your pouch is <strong>not safe on death</strong>. Unless you have the faction &quot;keep pouch&quot; perk or
        keep-inventory is on, dying zeroes your entire pouch and drops it as coins where you died. Your bank balance is
        never touched by death.
      </Callout>

      <WikiSectionHeading
        id="coins"
        intro="Coins are real, tradeable items: picking one up credits your pouch automatically."
      >
        Currency denominations
      </WikiSectionHeading>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        1 <WikiItemLink name="Gold Denar" /> = 100 <WikiItemLink name="Silver Denar">Silver Denars</WikiItemLink>.
      </p>
      <ItemGallery
        centeredSelectors
        items={denarCoins.map((coin) => ({
          name: coin.displayName,
          image: `/wiki/textures/currency/${coin.item.toLowerCase().replaceAll(" ", "-")}.png`,
          detail: `${coin.value.toFixed(2)} d · ${coin.withdrawable ? "Withdrawable" : "Pickup only"}`,
        }))}
      />
      <Callout variant="note">
        A vanilla Gold Ingot picked up off the ground is worth 1 denar automatically, but you can never convert your
        balance back into a Gold Ingot with <code className="text-[var(--tfmc-accent)]">/deco toitem</code>. That
        command only produces the dedicated coin items.
      </Callout>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable commands={denarCommands.commands} />

      <SeeAlso hrefs={["/wiki/market-blocks", "/wiki/factions", "/wiki/commands"]} />
    </WikiPage>
  );
}
