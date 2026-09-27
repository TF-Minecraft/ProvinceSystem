import CraftingGrid from "../../components/wiki/CraftingGrid";
import { StationLink, WikiItemLink, WikiPage } from "@/app/components/wiki";
import { detectorRecipes, signalTable } from "../data/detector";

export default function ArcaneTraceDetectorPage() {
  return (
    <WikiPage lastModified="2026-09-27" title="Arcane Trace Detector" intro={<>
        In-game item id: <code className="text-[var(--tfmc-accent)]">GEIGER_COUNTER</code>. Somewhere in the
        world, at all times, there is a single hidden source of Arcane Radiation. The Arcane Trace
        Detector senses where it is: hold it and it shows glowing particle rings and starts clicking,
        faster and faster as you get closer. The moment you claim it, the source vanishes and reappears
        somewhere else entirely. It is a serverwide loot race: there is only ever one source, and
        whoever reaches it first gets to collect it.
      </>}>

      <h2 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Step 1: Get a detector
      </h2>
      <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
        Everything here is crafted at the <StationLink name="Engineer Station" />. The recharging step needs no profession, so you can trade or buy the
        detector and fuel from other players and keep recharging it yourself.
      </p>
      <div className="mt-4 flex flex-col gap-4">
        {detectorRecipes.map((r) => (
          <CraftingGrid key={r.key} recipe={r} />
        ))}
      </div>

      <h2 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Step 2: Hunt
      </h2>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Hold the detector in your main hand.</li>
        <li>Particle rings appear around you and the device begins clicking (only you can hear it).</li>
        <li>Walk and watch the rings and clicking speed. That is your compass.</li>
        <li>Within about 20 blocks of the source, it is collected automatically.</li>
        <li>Your detector then runs out of charge and the source respawns to a new location.</li>
      </ul>

      <h2 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Step 3: Read the signal
      </h2>
      <div className="mt-2 overflow-x-auto rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color-mix(in_srgb,var(--tfmc-forest)_60%,transparent)] text-[var(--tfmc-cream)]">
            <tr>
              <th className="px-3 py-2 font-medium">What you see or hear</th>
              <th className="px-3 py-2 font-medium">What it means</th>
            </tr>
          </thead>
          <tbody>
            {signalTable.map((row) => (
              <tr key={row.signal} className="border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]">
                <td className="px-3 py-2 text-[var(--tfmc-cream)]">{row.signal}</td>
                <td className="px-3 py-2 text-[var(--tfmc-mist)]">{row.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Step 4: Recharge and go again
      </h2>
      <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
        Claiming the source turns your detector into an <WikiItemLink name="Unpowered Trace Detector" />:
        <br />
        <code className="text-[var(--tfmc-accent)]">&quot;Your Trace Detector has run out of fuel...&quot;</code>
        <br />
        You do not need to re-craft the detector: combine it with a single <WikiItemLink name="Arcane Fuel" /> at the
        <StationLink name="Engineer Station" /> to power it back up. You can collect 1 source per rolling 24 hours.
      </p>

      <h2 className="mt-8 font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">FAQ</h2>
      <dl className="mt-2 space-y-3 text-sm">
        <div>
          <dt className="text-[var(--tfmc-cream)]">&quot;My detector shows nothing.&quot;</dt>
          <dd className="text-[var(--tfmc-mist)]">
            Check that it&apos;s the Arcane Trace Detector and not the greyed-out <WikiItemLink name="Unpowered Trace Detector">Unpowered version</WikiItemLink>.
            If unpowered, recharge it with one <WikiItemLink name="Arcane Fuel" /> at the <StationLink name="Engineer Station" />.
          </dd>
        </div>
        <div>
          <dt className="text-[var(--tfmc-cream)]">&quot;Somebody else collected the source before me.&quot;</dt>
          <dd className="text-[var(--tfmc-mist)]">
            That happens: there is only one, and it&apos;s a race. It has already relocated, so keep
            hunting; the reading you get now is completely fresh.
          </dd>
        </div>
        <div>
          <dt className="text-[var(--tfmc-cream)]">&quot;I walked right over the source and nothing happened.&quot;</dt>
          <dd className="text-[var(--tfmc-mist)]">
            You&apos;re probably at your limit of 1 claim per rolling 24 hours. The source is untouched and
            still there for someone else.
          </dd>
        </div>
        <div>
          <dt className="text-[var(--tfmc-cream)]">&quot;Can I keep my detector after claiming?&quot;</dt>
          <dd className="text-[var(--tfmc-mist)]">
            Yes. It just runs out of charge. One <WikiItemLink name="Arcane Fuel" /> at the <StationLink name="Engineer Station" /> recharges it
            to full power, so carry spare fuel.
          </dd>
        </div>
      </dl>
    </WikiPage>
  );
}
