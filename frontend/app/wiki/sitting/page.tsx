import {
  CommandTable,
  DataTable,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { sittingCommands } from "../data/sitting";

export default function SittingPage() {
  return (
    <WikiPage
      lastModified="2026-09-11"
      title="Sitting, Crawling & Posing"
      intro={
        <>
          Sit on furniture, lie down, crawl, or strike a pose: small physical touches that make a
          scene feel real. It&apos;s free for every player; nothing here needs a rank.
        </>
      }
    >
      <WikiSectionHeading id="sitting" intro="The easiest way in: just right-click.">
        Sitting
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Right-click a stair, slab, carpet or snow layer with an <strong>empty main hand</strong>{" "}
        and you sit down, snapped neatly to the block. You must be within 3 blocks to sit by
        clicking. Only the{" "}
        <strong>bottom half</strong> of stairs and slabs works: a top slab or an upside-down stair
        won&apos;t seat you. You can also just type{" "}
        <code className="text-[var(--tfmc-accent)]">/sit</code>.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        To get up, press <strong>Sneak/Shift</strong>. Taking damage will not knock you out of a
        seat, but breaking the block underneath you will. If click-to-sit ever annoys you (e.g. you
        keep accidentally sitting on stairs while building), turn it off with{" "}
        <code className="text-[var(--tfmc-accent)]">/sit toggle</code>: typing{" "}
        <code className="text-[var(--tfmc-accent)]">/sit</code> still works to sit on command.
      </p>

      <div className="mt-4">
        <DataTable
          columns={[{ header: "Works on" }, { header: "Doesn't work on" }]}
          rows={[
            ["Stairs (bottom half)", "Top-half / upside-down stairs and slabs"],
            ["Slabs (bottom half)", "Lava"],
            ["Carpets (wool and moss)", "Anything while holding an item"],
            ["Snow layers", "—"],
          ]}
        />
      </div>

      <WikiSectionHeading id="poses">
        Lying down and poses
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        <code className="text-[var(--tfmc-accent)]">/lay</code> puts you on your back facing up.{" "}
        <code className="text-[var(--tfmc-accent)]">/layback</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">/bellyflop</code> and{" "}
        <code className="text-[var(--tfmc-accent)]">/spin</code> are other poses. While posed you
        cannot interact with blocks, items or other players, so it&apos;s meant for a still moment,
        not mid-fight. Sneak to get back up.
      </p>
      <WikiSectionHeading id="crawling" intro="Go prone without needing a low ceiling.">
        Crawling
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Type <code className="text-[var(--tfmc-accent)]">/crawl</code> to drop to a prone,
        crawling stance; sneak to stand back up. Double-tapping sneak to start crawling is turned
        off on this server, so the command is the only way in.
      </p>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={sittingCommands.commands}
        excludedStaffCommands={sittingCommands.excludedStaffCommands}
      />

      <SeeAlso hrefs={["/wiki/characters", "/wiki/server-features"]} />
    </WikiPage>
  );
}
