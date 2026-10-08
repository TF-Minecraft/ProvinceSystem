import { Callout, SeeAlso, WikiItemLink, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
export default function InfestationsPage() {
  return (
    <WikiPage
      lastModified="2026-09-27"
      title="Infestations"
      intro={
        <>
          Whole map provinces can get overrun by monsters: on this server, every infestation you
          will meet is swamp-flavoured and shown on the map as <strong>&quot;Bog Monsters&quot;</strong>.
          Walk into one and it spawns ambient enemies around you on its own; place a{" "}
          <WikiItemLink name="Lure"><strong>Lure</strong></WikiItemLink> and you can fight a single big wave that, if you win, clears the
          province outright.
        </>
      }
    >
      <WikiSectionHeading id="why-care" intro="Two reasons to seek an infestation out rather than avoid it.">
        Why bother
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        An infested province is simply more dangerous ground. It keeps spawning monsters around
        you for as long as you stand in it, day or night. That is a steady stream of kills if you want
        one. Committing to a <WikiItemLink name="Lure" /> raises the stakes further: a single scripted wave sized to the
        province&apos;s severity, fought to a clean win-or-lose result, with the province&apos;s
        infestation lifted entirely if you clear it.
      </p>

      <WikiSectionHeading id="where">
        Where to find one
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Infested provinces are shown on the server&apos;s web map with a severity label. Ambient
        spawning and <WikiItemLink name="Lure" /> waves run at <strong>any time of day</strong>.
      </p>

      <WikiSectionHeading id="loop">
        The loop
      </WikiSectionHeading>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Walk into an infested province. Ambient monsters spawn in a ring around you, up to a cap, on a fixed interval: both scale with severity.</li>
        <li>
          To go further, place a <WikiItemLink name="Lure"><strong>Lure</strong></WikiItemLink>. This opens a 20-second join window: leave
          the province, or right-click the <WikiItemLink name="Lure" /> to commit to the fight.
        </li>
        <li>
          If you neither join nor leave, the lure starts without you and you take{" "}
          <strong>2 deserter damage per check</strong> for staying nearby uncommitted.
        </li>
        <li>
          Clear every mob and the infestation is cleared outright; dying, running
          out the timer, or leaving means the infestation remains. After the fight
          starts, right-click the <WikiItemLink name="Lure" /> to outline remaining wave mobs for 10 seconds.
        </li>
        <li>
          Logging out mid-<WikiItemLink name="Lure" /> does not save you: there is only a 300-second grace period, after
          which you are marked to die on your next login.
        </li>
      </ol>
      <Callout variant="note" className="mt-4">
        Placing a <WikiItemLink name="Lure" /> in a clean (non-infested) province does nothing. Only one <WikiItemLink name="Lure" /> can be active
        in a province at a time.
      </Callout>

      <SeeAlso hrefs={["/wiki/thievery", "/wiki/stations"]} />
    </WikiPage>
  );
}
