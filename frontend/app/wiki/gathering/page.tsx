import { SeeAlso, StatGrid, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";


export default function GatheringPage() {
  return (
    <WikiPage
      lastModified="2026-09-15"
      title="Gathering"
      intro={
        <>
          Gathering spots spawn hidden in the wild. Your character notices one when you walk close
          enough: a message tells you something is nearby, and a faint particle ring marks the
          spot. Right-click it to harvest whatever loot it rolls.
        </>
      }

    >
      <WikiSectionHeading id="loop" intro="Discovery is tracked per roleplay character, not per account.">
        The loop
      </WikiSectionHeading>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Spots spawn on their own on eligible blocks, invisible until discovered.</li>
        <li>
          Every 12 seconds, every player within 6 blocks of a spot has a chance to notice it. On a
          success: <em>&quot;You notice something glinting nearby...&quot;</em>
        </li>
        <li>A discovered spot shows a small particle ring so you can find it again.</li>
        <li>
          Right-click the spot to gather. Loot is rolled and the items pop out with a little
          velocity. If the roll comes up empty: &quot;Nothing to gather here.&quot;
        </li>
        <li>The spot is consumed: gathering it once uses it up, and its chunk goes on cooldown.</li>
      </ol>

      <WikiSectionHeading id="discovery">
        Discovery chance
      </WikiSectionHeading>
      <StatGrid
        stats={[
          { label: "Detection range", value: "6 blocks" },
          { label: "Wisdom bonus", value: "+2%", note: "per point of Wisdom" },
          { label: "Intelligence bonus", value: "+1.5%", note: "per point of Intelligence" },
          { label: "Herborist bonus", value: "+1%", note: "per level of the Herborist profession" },
        ]}
        columns={3}
      />

      <WikiSectionHeading id="loot">
        Loot
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        A forest-herbs spot gives 1–2 loot rolls, and every roll currently comes from the same
        pool: 2–4 <WikiItemLink name="Stack of Gold Denars" /> (worth 10 denars each, so 20–40 denars per roll).
      </p>

      <SeeAlso hrefs={["/wiki/materials", "/wiki/commands", "/wiki/advanced-crafting"]} />
    </WikiPage>
  );
}
