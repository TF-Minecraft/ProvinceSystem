import { CommandTable, DataTable, SeeAlso, StationLink, WikiItemLink, WikiItemText, WikiPage, WikiSectionHeading } from "@/app/components/wiki";
import { thieveryCommandSet, thieveryKeyCopies } from "../data/thievery";

export default function ThieveryPage() {
  return (
    <WikiPage
      lastModified="2026-09-27"
      title="Thievery"
      intro={
        <>
          Thievery is the server&apos;s in-house crime system. You can lock your own doors and
          chests with keys, and you can break into other people&apos;s doors, chests, display
          furniture and graves with lockpicks, pickpocket players, or hold someone up in a
          consensual timed robbery. Almost everything you do here can leave a{" "}
          <strong>clue</strong> pointing back at your character.
        </>
      }
    >

      <WikiSectionHeading id="locking" intro="Protecting your own doors and containers.">
        Locking your own stuff
      </WikiSectionHeading>
      <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          <strong>Doors</strong>: hold a key (<WikiItemLink name="Iron Key" /> or Gold Key) and sneak + right-click the
          door to lock it. Sneak + right-click again with the same key to unlock it; a wrong key is
          rejected. While locked, a door will not open (and cannot be broken) without the matching
          key.
        </li>
        <li>
          <strong>Containers</strong>: you automatically own any container you place. Sneak +
          left-click a container you own to cycle its lock state: Private → Guild → Faction → Public → back to
          Private. Ender chests are excluded from the whole system.
        </li>
      </ul>

      <WikiSectionHeading id="keys" intro="Copying a key costs no crafting bench, just your own inventory.">
        Copying keys
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Drag one item onto another directly in your inventory:
      </p>
      <div className="mt-4">
        <DataTable
          columns={[
            { header: "Pick up (cursor)", nowrap: true },
            { header: "Click onto" },
            { header: "Result" },
          ]}
          rows={thieveryKeyCopies.map((c) => [
            <WikiItemText key={`${c.pickUp}-pickup`} text={c.pickUp} />,
            <WikiItemText key={`${c.clickOnto}-target`} text={c.clickOnto} />,
            <WikiItemText key={`${c.result}-result`} text={c.result} />,
          ])}
          caption="Copying a key to paper is on a 240-minute (4 hour) per-player, per-key cooldown."
        />
      </div>


      <WikiSectionHeading id="lockpicking" intro="The offensive loop: breaking into someone else's stuff.">
        Lockpicking
      </WikiSectionHeading>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Hold a lockpick (the <WikiItemLink name="Basic Lockpick">Basic Lockpick</WikiItemLink> or the stronger <WikiItemLink name="Strong Lockpick">Strong Lockpick</WikiItemLink>, both made at the <StationLink name="Tool Station" />) and right-click a closed, locked door within 3 blocks: or a lockable container, display furniture (<WikiItemLink name="Artifact Display">artifact display</WikiItemLink>, <WikiItemLink name="Pedestal">pedestal</WikiItemLink>), or entity (armor stand, item frame, glow item frame).</li>
        <li>
          Doing this requires the &quot;thief&quot; character trait; without it you are told you
          lack the needed trait(s).
        </li>
        <li>
          A minigame starts: a 20-slot bar scrolls alongside your current risk. Right-click the
          door/container again to strike: land on a success slot (up to 3 wide) and avoid the
          break slots.
        </li>
        <li>
          <strong>Doors</strong> that are successfully picked enter a 60-minute unlock window during
          which anyone can open them.
        </li>
        <li>
          <strong>Containers and furniture</strong> do not hand you the contents directly on a
          success: you get a Steal GUI instead. You click slots to probe them; each probe risks
          breaking your lockpick, and each item you take costs budget points from your loadout.
        </li>
        <li>
          <strong>Graves</strong> work the same way as containers: right-clicking another player&apos;s
          grave opens the Steal GUI with a 10-point budget.
        </li>
      </ol>

      <WikiSectionHeading id="pickpocket-robbery" intro="Taking directly from another player.">
        Pickpocketing and robbery
      </WikiSectionHeading>
      <ul className="list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          <strong>Pickpocketing</strong>: <code className="text-[var(--tfmc-accent)]">/pickpocket start</code>,
          then right-click a target within 4 blocks. A Steal GUI of their inventory opens with a
          10-point budget. The victim sees a warning subtitle (a rarer &quot;critical&quot; version
          names your character directly). Moving too far away ends it.
        </li>
        <li>
          <strong>Robbery</strong> is opt-in: <code className="text-[var(--tfmc-accent)]">/robbery start</code> on
          a target, who must run <code className="text-[var(--tfmc-accent)]">/robbery accept</code> within 30
          seconds or the request times out. Once accepted, the victim is frozen and cannot move; you
          get 120 seconds and a 30-point budget. Clicking their coin pouch takes 10 denar per click,
          shift-click 100.
        </li>
      </ul>


      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={thieveryCommandSet.commands}

      />

      <SeeAlso hrefs={["/wiki/infestations", "/wiki/materials"]} />
    </WikiPage>
  );
}
