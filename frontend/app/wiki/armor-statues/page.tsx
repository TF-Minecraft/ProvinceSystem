import {
  Callout,
  CommandTable,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { armorStatuesCommands } from "../data/armor-statues";

export default function ArmorStatuesPage() {
  return (
    <WikiPage
      lastModified="2026-09-19"
      title="Armor Statues"
      intro={
        <>
          Pose and configure armor stands with clicks instead of commands: arms, base plate,
          size, visibility, gravity, and precise rotation and positioning, all from one book.
        </>
      }
    >
      <WikiSectionHeading id="getting-the-book">
        Getting the book
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Type <code className="text-[var(--tfmc-accent)]">/tfmc statues</code> to receive the
        Armor Statues book. It&apos;s free and available to every player.
      </p>

      <WikiSectionHeading id="using-it" intro="Stand near what you want to change.">
        Using it
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Place an armor stand, then open the book and click an option: the nearest armor stand is
        what gets edited. Work your way through the book&apos;s pages to change its arms, base
        plate, size, visibility, gravity, and its exact rotation and position.
      </p>

      <Callout variant="note" title="Full showcase">
        For a walkthrough of everything the book can do, watch{" "}
        <a
          href="https://www.youtube.com/watch?v=nV9-_RacnoI"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--tfmc-accent)] underline"
        >
          &quot;Full Showcase&quot;
        </a>{" "}
        by ZombieCleo.
      </Callout>

      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        This is the{" "}
        <a
          href="https://modrinth.com/datapack/armor-statues-datapack"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--tfmc-accent)] underline"
        >
          Armor Statues datapack
        </a>
        .
      </p>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={armorStatuesCommands.commands}
        excludedStaffCommands={armorStatuesCommands.excludedStaffCommands}
      />

      <SeeAlso hrefs={["/wiki/sitting", "/wiki/server-features"]} />
    </WikiPage>
  );
}
