import {
  Callout,
  CommandTable,
  DataTable,
  SeeAlso,
  StatGrid,
  WikiItemLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import Link from "next/link";
import { factionRanks, factionTiers, factionsCommands, installations } from "../data/factions";

export default function FactionsPage() {
  return (
    <WikiPage
      lastModified="2026-09-18"
      title="Factions"
      width="lg"
    >
      <WikiSectionHeading id="getting-started" intro="The first few steps every faction goes through.">
        Founding a faction
      </WikiSectionHeading>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li><code className="text-[var(--tfmc-accent)]">/faction create &lt;name&gt;</code> founds your faction and makes you its leader.</li>
        <li>Stand in a province and run <code className="text-[var(--tfmc-accent)]">/faction setcapital &lt;name&gt;</code>. This is required before you can claim anything else.</li>
        <li>
          Stand in a province adjacent to land you already own and run{" "}
          <code className="text-[var(--tfmc-accent)]">/faction claim</code> (leader only).
        </li>
        <li>Invite others with <code className="text-[var(--tfmc-accent)]">/faction invite &lt;player&gt;</code>; they accept with <code className="text-[var(--tfmc-accent)]">/faction join &lt;name&gt;</code>.</li>
      </ol>
      <Callout variant="note">
        Untitled land is capped at 5 provinces. Claim a 6th and you&apos;re told to form a County
        first: see the tier table below.
      </Callout>

      <WikiSectionHeading id="tiers" intro="Prestige unlocks the next title tier, each with its own province-forming cost.">
        Titles and tiers
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Tier" }, { header: "Prestige needed", align: "right" }, { header: "Form cost", align: "right" }]}
        rows={factionTiers.map((t) => [t.tier, t.prestige, t.formCost])}
      />

      <WikiSectionHeading id="ranks" intro="Prestige rank is separate from title tier. It lowers the de-jure requirement for annexing land as you climb.">
        Prestige ranks
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Rank" }, { header: "Prestige", align: "right" }]}
        rows={factionRanks.map((r) => [r.rank, r.prestige])}
      />

      <WikiSectionHeading id="banking" intro="Banking needs a claimed bank chunk.">
        Money and banking
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        The leader places a faction bank block, then anyone standing in that bank chunk can{" "}
        <code className="text-[var(--tfmc-accent)]">/faction deposit &lt;amount&gt;</code>; only the
        leader can <code className="text-[var(--tfmc-accent)]">/faction withdraw &lt;amount&gt;</code>.
        Guilds work the same way with their own bank chunk. Every deposit and withdrawal moves
        denars: see the Denar Economy page for how the currency itself works.
      </p>
      <StatGrid
        stats={[
          { label: "Province cost", value: "50 prestige" },
          { label: "Max members", value: "64 per faction" },
          { label: "Untitled province cap", value: "5" },
        ]}
      />

      <WikiSectionHeading id="guilds" intro="A guild is a sub-organisation inside your faction, useful for trade income.">
        Guilds and government
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Any non-leader member can <code className="text-[var(--tfmc-accent)]">/guild create &lt;name&gt;</code> to
        start a sub-guild with its own bank, leadership, and trade branches (Bureaucracy, Guild
        Halls, Workshops, Storehouses). The faction leader runs the &quot;base guild&quot; automatically.
        From <code className="text-[var(--tfmc-accent)]">/faction menu</code> you can also open
        government, laws, taxes, council and elections: under a democracy the leader can&apos;t be
        set directly; players vote at <WikiItemLink name="Voting Booth">voting booths</WikiItemLink> instead.
      </p>
      <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-[var(--tfmc-mist)]">Resource nodes</h3>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Guilds also own <Link href="/wiki/dowsing" className="text-[var(--tfmc-accent)] underline underline-offset-2">resource nodes</Link>:
        production sites that turn out ores, crops, wood or stone on a repeating cycle. You must be in a guild to place one,
        and a one-person guild is enough.
      </p>
      <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Craft a <WikiItemLink name="General Node">General Node</WikiItemLink> and place it. A guild can own only one node, and each chunk holds only one.</li>
        <li>Run it as an Ore Mine, Magical Mine, Farm, Plantation, Forestry or Quarry, then pick what it focuses on.</li>
        <li>Upgrades from level 1 to 10 are paid from the guild bank, so the guild needs a bank with funds in it.</li>
        <li>Only members of the owning guild can change a node. A guild leader can claim a node that another guild has marked for transfer.</li>
      </ul>

      <WikiSectionHeading id="war" intro="Battles are scheduled events, not spontaneous fights.">
        War and battles
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        When a war has been declared, check <code className="text-[var(--tfmc-accent)]">/war list</code>. Form a squad
        with <code className="text-[var(--tfmc-accent)]">/warband create &lt;name&gt;</code>, then
        join a scheduled fight with <code className="text-[var(--tfmc-accent)]">/battle join &lt;battleId&gt;</code>{" "}
        when its window opens, or a campaign raid with{" "}
        <code className="text-[var(--tfmc-accent)]">/raid join</code> during its 60-second muster.
        Retreating a warband mid-battle is locked for the first 20 minutes.
      </p>

      <WikiSectionHeading id="installations" intro="Built by a faction leader with /faction construct, in an owned, non-water province.">
        Installations
      </WikiSectionHeading>
      <DataTable
        columns={[
          { header: "Type" },
          { header: "Radius", align: "right" },
          { header: "Upkeep / day", align: "right" },
          { header: "Build time", align: "right" },
          { header: "Vehicle slots" },
        ]}
        rows={installations.map((i) => [i.type, `${i.radius} blocks`, `${i.upkeepPerDay} d`, i.buildTime, i.slots])}
      />
      <Callout variant="note">
        Trains are not stored at train stations. Berthing a vehicle requires the vehicle&apos;s owner to be online and consent. An unpaid vehicle (see{" "}
        <code className="text-[var(--tfmc-accent)]">/faction vehicle maintenance pay</code>)
        cannot be repaired.
      </Callout>

      <WikiSectionHeading id="mercenaries" intro="A guild can found a mercenary company and hire it out to other factions.">
        Mercenaries
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Inside a guild, <code className="text-[var(--tfmc-accent)]">/company found &lt;name&gt;</code> buys
        a charter; the company leader invites recruits and drafts a contract with{" "}
        <code className="text-[var(--tfmc-accent)]">/company draft</code>, then sends it to a buyer
        faction with <code className="text-[var(--tfmc-accent)]">/company offer &lt;faction&gt;</code>.
        Buyers browse the market with <code className="text-[var(--tfmc-accent)]">/mercenaries</code>{" "}
        and hire with <code className="text-[var(--tfmc-accent)]">/mercenaries hire &lt;company&gt;</code>.
      </p>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <Callout variant="note">Some actions require a leadership role within your faction, guild, or warband. Check the Notes column before planning a group action.</Callout>
      <CommandTable commands={factionsCommands.commands} excludedStaffCommands={factionsCommands.excludedStaffCommands} />

      <SeeAlso hrefs={["/wiki/economy", "/wiki/commands"]} />
    </WikiPage>
  );
}
