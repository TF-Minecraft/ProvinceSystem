import Link from "next/link";

import {
  CommandTable,
  DataTable,
  RankName,
  SeeAlso,
  StatGrid,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { brewingCommands } from "../data/brewing";

export default function BrewingPage() {
  return (
    <WikiPage
      lastModified="2026-09-11"
      title="Brewing"
      width="lg"
    >
      <WikiSectionHeading id="loop" intro="Ferment, then optionally distil, then optionally age.">
        The brewing loop
      </WikiSectionHeading>
      <ol className="mt-4 flex flex-col gap-2 text-sm text-[var(--tfmc-mist)]">
        <li>1. <strong>Ferment.</strong> Place a cauldron over a fire or campfire, fill it with water, then right-click it in your main hand with ingredients to throw them in. Right-click with a clock/watch to read the current cook time.</li>
        <li>2. <strong>Bottle.</strong> Right-click the cauldron with a glass bottle to draw off one brew.</li>
        <li>3. <strong>Distil (optional).</strong> Put the bottle in a Brewing Stand with glowstone dust; it runs the recipe&apos;s configured number of distill runs.</li>
        <li>4. <strong>Age (optional).</strong> Build a barrel: vanilla barrels work too, up to 6 brews at once, and right-click it to open. Signs on custom barrels must contain the barrel keyword.</li>
        <li>5. <strong>Seal (optional).</strong> A Sealing Table (a re-skinned Smoker) strips a brew down for selling in shops.</li>
        <li>6. <strong>Drink.</strong> The label always shows quality; the exact alcohol number is hidden but an indicator is shown, and drinking prints a status message.</li>
      </ol>

      <WikiSectionHeading
        id="drink-builder"
        intro={
          <>
            Donator ranks can add a custom drink through the{" "}
            <Link href="/wiki/drink-builder" className="underline decoration-dotted">
              DrinkBuilder guide
            </Link>
            . Each submission uses one creation token, whose cooldown is shared with custom skin
            creation.
          </>
        }
      >
        Donator DrinkBuilder perks
      </WikiSectionHeading>
      <DataTable
        className="mt-4"
        minWidth="38rem"
        columns={[
          { header: "Rank", width: "9rem" },
          { header: "Creation interval" },
          { header: "Drink customisation" },
        ]}
        rows={[
          [<RankName key="noble" rank="Noble" />, "Every 28 days", "1 name colour; standard bottle and message"],
          [<RankName key="gilded" rank="Gilded" />, "Every 21 days", "2 name colours; custom bottle texture"],
          [<RankName key="ascended" rank="Ascended" />, "Every 14 days", "Up to 8 name colours; custom bottle texture and message"],
          [<RankName key="legacy" rank="Legacy" />, "Every 7 days", "Up to 8 name colours; custom bottle texture and message"],
        ]}
      />

      <WikiSectionHeading id="numbers">Numbers that matter</WikiSectionHeading>
      <StatGrid
        stats={[
          { label: "1 barrel year", value: "20 real minutes" },
          { label: "Hangover length", value: "up to 7 days" },
          { label: "Large barrel size", value: "3 inventory rows" },
          { label: "Small barrel size", value: "1 inventory row" },        ]}
      />


      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={brewingCommands.commands}

      />



      <SeeAlso hrefs={["/wiki/drink-builder", "/wiki/materials", "/wiki/commands"]} />
    </WikiPage>
  );
}
