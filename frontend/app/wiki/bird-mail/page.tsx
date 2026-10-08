import {
  Callout,
  SeeAlso,
  StationLink,
  StatGrid,
  WikiItemLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import StationModelViewer from "@/app/components/wiki/StationModelViewer";

export default function BirdMailPage() {
  return (
    <WikiPage
      lastModified="2026-09-19"
      title="Bird Mail"
    >
      <WikiSectionHeading id="how-it-works" intro="There is no /mail command.">
        Sending a letter
      </WikiSectionHeading>
      <div className="mt-4 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
          <li>Get a <WikiItemLink name="Letter" /> item and write your message in it, same as writing a normal book.</li>
          <li>
            Find a <strong><StationLink name="Bird Mailbox">bird mailbox</StationLink></strong> and right-click it: standing still, not
            sneaking. Sneak-right-clicking does nothing.
          </li>
          <li>
            A small &quot;Bird Messenger&quot; window opens with one open slot. Place your letter
            into it, or shift-click it in. Anything that isn&apos;t a <WikiItemLink name="Letter" /> is rejected.
          </li>
          <li>
            Closing that window with a valid letter in it opens a &quot;Send letter&quot; screen: a
            page of player-head icons, one per character (your own characters are filtered out: you
            can&apos;t mail yourself).
          </li>
          <li>Click the head of the character you want to send to, then hit Confirm.</li>
          <li>
            The letter leaves your inventory immediately and a bird flies off with it. If you close
            the picker without confirming, you get your letter back.
          </li>
        </ol>
        <aside className="min-w-0 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_55%,transparent)] p-4">
          <div className="h-72 w-full overflow-hidden rounded border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,transparent)] sm:h-80" aria-label="Interactive 3D preview of Bird Mailbox">
            <StationModelViewer modelUrl="/wiki/models/bird-mailbox.json" textureUrl="/wiki/textures/bird-mail/mailbox.png" />
          </div>
          <h3 className="mt-3 font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]"><StationLink name="Bird Mailbox" /></h3>
          <p className="text-sm text-[var(--tfmc-mist)]">Right-click the mailbox to send a written <WikiItemLink name="Letter" />.</p>
        </aside>
      </div>

      <WikiSectionHeading id="delivery" intro="Delivery time depends on how far away the recipient's character last was.">
        How long delivery takes
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        The bird&apos;s flight time is based on the distance from where you sent it to the
        recipient character&apos;s last known location: roughly a quarter of a second per block.
      </p>
      <StatGrid
        columns={3}
        stats={[
          { label: "Minimum flight time", value: "30 seconds", note: "even at zero distance" },
          { label: "Maximum flight time", value: "10 minutes", note: "any distance past ~2,400 blocks" },
          { label: "Cost", value: "Free" },
        ]}
      />
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        If the recipient is online and actively playing that exact character when the bird
        arrives, they get the letter immediately with a message that a bird has landed at their
        feet. Otherwise your letter waits, for that character to be played, or for that player to
        log in: with no expiry. You&apos;ll be told your letter is waiting rather than delivered.
      </p>

      <Callout variant="warning">
        A letter can only be delivered within the same world the recipient character&apos;s last
        location was in. If they&apos;re in a different world, the bird can&apos;t reach them and
        your letter bounces back as undeliverable.
      </Callout>

      <Callout variant="note">
        This is a different system from sealed letters (the writable-book item you
        sign and hand to someone in person). Bird Mail is specifically for sending a letter to a
        character who isn&apos;t there to hand it to directly, and it can also forward a Discord DM
        notification (without revealing the sender or the letter&apos;s contents) if the recipient
        has linked their account.
      </Callout>

      <SeeAlso hrefs={["/wiki/server-features", "/wiki/characters"]} />
    </WikiPage>
  );
}
