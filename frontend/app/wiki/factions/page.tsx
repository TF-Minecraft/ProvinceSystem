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
      lastModified="2026-10-03"
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
        Halls, Workshops, Storehouses, Supply Lines). The faction leader runs the &quot;base guild&quot; automatically.
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
          { header: "Hub slots", align: "right" },
        ]}
        rows={installations.map((i) => [i.type, `${i.radius} blocks`, `${i.upkeepPerDay} d`, i.buildTime, i.slots, i.hubSlots])}
      />
      <Callout variant="note">
        Trains are not stored at train stations. Berthing a vehicle requires the vehicle&apos;s owner to be online and consent. An unpaid vehicle (see{" "}
        <code className="text-[var(--tfmc-accent)]">/faction vehicle maintenance pay</code>)
        cannot be repaired. The upkeep column is for a newly built installation. A train station at level 2 costs 35 denars a day (3-day build, 2 hub slots, 3 static emplacements). Level 3 costs 100 denars a day (5-day build, 4 hub slots, 4 static emplacements).
      </Callout>

      <WikiSectionHeading id="supply-hubs" intro="Guilds place hubs so trade and production can move between provinces.">
        Supply hubs, agreements, and infrastructure
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        A hub sits on a port, airport, or train station that still has an open hub slot. Forts have none. Once two of a guild&apos;s hubs are active, railway track can join any two of them, whatever kind they are. Ports can also link across the sea, and airports through the air. Trade starts at the capital, so the first hub is most useful there, and the second where that trade should arrive. On the map, rail is a solid line, sea a dashed line, and air a dotted line.
      </p>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Each link passes on part of the guild&apos;s trade and production. The shares below are before distance. Every 1,000 blocks then keeps 90% of a rail link, 85% of a sea link, and 80% of an air link. Rail follows the track. Sea and air are straight-line distances. No link passes on more than 95%. Supply Lines on the guild that owns the hubs raises this by 5% more trade and 8% more production per level. The realm guild&apos;s Infrastructure branch does the same for hubs that guild owns.
      </p>
      <DataTable
        columns={[
          { header: "Link" },
          { header: "Trade", align: "right" },
          { header: "Production", align: "right" },
          { header: "Reach" },
        ]}
        rows={[
          ["Rail", "40%", "80%", "Along the track"],
          ["Sea", "30%", "70%", "4,000 blocks"],
          ["Air", "20%", "50%", "2,500 blocks"],
        ]}
      />
      <p className="text-sm text-[var(--tfmc-mist)]">
        The guild leader opens the guild menu, then Supply Hubs, and chooses Propose a hub. Ready now can be built at once when the installation is in your own realm. In another realm, that click opens a negotiation. Worth building means a station has to be built there first, with <code className="text-[var(--tfmc-accent)]">/faction construct</code>. The Supply Hubs screen shows how many hubs the guild can have. Supply Lines raises that limit.
      </p>
      <p className="text-sm text-[var(--tfmc-mist)]">
        A hub in another realm needs an agreement, and the host has to allow a hub tax in its laws. The host sets a tax on the hub&apos;s trade, inside the range those laws allow, and a daily fee up to the allowed maximum. The term is 14 days. A new agreement renews on both sides until one side turns renewal off. If renewal is off, both sides are told during the last 3 days. An offer nobody answers lapses after 7 days. The guild leader offers, accepts, declines, or withdraws. The host&apos;s council, including the faction leader, answers from the faction menu under Hub offers. You can accept only terms the other side sent. The screen shows about how much each side would gain or lose, and a break-even tax rate for the host: the rate where the host&apos;s gain, tax, and fee come out even. A higher fee lowers that rate.
      </p>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Each hub has a daily upkeep from the guild bank, starting at 1 denar and rising by half a denar for each level of Supply Lines. The realm guild&apos;s Infrastructure branch raises upkeep the same way for its own hubs. If the bank cannot cover the upkeep and any fees, hubs are removed, newest first, until the bank can cover what remains. Removing a hub yourself is a choice in the Supply Hubs menu. A hub marked dormant still owes its fee for as long as the agreement stands, and the guild leader is told once. Removing the hub stops the fee. If the installation is transferred into another realm, the agreement ends and the hub is removed, and the guild leader and both councils are told. A transfer into the guild&apos;s own realm ends the agreement and keeps the hub. If the hub and the guild end up in the same realm some other way, the agreement ends at the next daily check and the hub stays.
      </p>
      <Callout variant="note">
        The figures say &quot;about&quot;, and they are worked out once a day. Until that pass has run, the list says estimates are not ready yet. Where there is no railway yet, the estimate assumes a straight line of track and says how long that line would be.
      </Callout>
      <p className="text-sm text-[var(--tfmc-mist)]">
        The realm guild&apos;s Infrastructure branch improves poor land for every guild in the realm, starting at the capital. Each level costs 1 denar a day. Upgrading or downgrading it shows Estimated Realm Income Change, for the whole realm. The faction menu states about how much that infrastructure is worth each day, once the daily figure is ready. Stations, ports, airports, and railway track add infrastructure in the provinces they occupy. Forts add none. Before <code className="text-[var(--tfmc-accent)]">/faction construct</code> starts a build, the confirmation shows the infrastructure it would add here, about how much that is worth to the realm each day, and the upkeep. You can confirm while that figure is still being worked out.
      </p>
      <p className="text-sm text-[var(--tfmc-mist)]">
        On the web map, the Infrastructure view colours each province from light red (the poorest land) through purple to dark blue (the best land). Hovering a province shows the land type, how much of the infrastructure fill it has, and what the owning guilds count it as. For example: Bog 0.40, infrastructure 60%, counts as 0.61.
      </p>

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
