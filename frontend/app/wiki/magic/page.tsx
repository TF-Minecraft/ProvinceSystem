import {
  Callout,
  CommandTable,
  DataTable,
  SeeAlso,
  StationLink,
  StatGrid,
  WikiItemLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import CraftingGrid from "@/app/components/wiki/CraftingGrid";
import {
  armorRunestoneRecipes,
  enchantedChargeRecipes,
  magicCommands,
  magicStationRecipe,
  runeStationRecipe,
  runestoneRecipes,
} from "../data/magic";

export default function MagicPage() {
  return (
    <WikiPage
      lastModified="2026-09-18"
      title="Magic"
      width="lg"
      intro={
        <>
          Magic is the mage path. You build a staff, wand or blade out of parts at a <StationLink name="Magic Station" />,
          slot <strong>spell runes</strong> into it, and then <strong>attune</strong> it to one of ten
          elements by feeding it magical energy you gathered from a shrine. Your character also
          carries a personal <strong>Resonance</strong> score in every element, and a weapon will
          simply refuse to fire if your Resonance is too low for what it holds.
        </>
      }

    >
      <WikiSectionHeading id="vocabulary" intro="Five words you need before anything else makes sense.">
        The words
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Term", nowrap: true, width: "11rem" }, { header: "What it means" }]}
        rows={[
          [
            "Element",
            "One of ten flavours of magic: Cerrith, Oseni, Seithr, Mitlan, Bloodmagic, Spirit, Arcanum, Illusion, Necromancy, Shadowmancy.",
          ],
          [
            "Resonance",
            "A 0-100 score your character holds in each element separately. It decides whether a weapon will accept a charge, and it scales the mana cost, damage and cooldown of your spells.",
          ],
          [
            "Aura",
            "The physical resource. It lives inside artifacts and charges, is gathered from shrines, and is spent to attune a weapon. Aura in an artifact never decays.",
          ],
          [
            "Socket",
            "A hole in a finished weapon that one spell rune fits into. Sockets come in four sizes: Minor, Lesser, Greater and Ascendant, and a socket takes a rune of its own size or smaller.",
          ],
          [
            "Attunement",
            "Locking an element into a weapon by spending a charge on it. Until you do, the weapon holds no element and refuses to cast.",
          ],
        ]}
      />

      <Callout variant="note" title="It is per character, not per account">
        Resonance and Equilibrium are stored against your active RP character. A second character
        starts from zero. <code className="text-[var(--tfmc-accent)]">/resonance</code> refuses to
        open at all without an active character.
      </Callout>

      <WikiSectionHeading id="loop">
        The loop
      </WikiSectionHeading>
      <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          <strong>Be a Mage.</strong> Only Mages can use Mage Staffs, Mage Wands, Mage Blades and
          Mage Armor. Its own description warns that mages are expensive to gear.
        </li>
        <li>
          <strong>Open <code className="text-[var(--tfmc-accent)]">/resonance</code></strong> and
          pick a cast mode: Surge (&quot;Power now. Corruption later.&quot;) or Flow (&quot;Slow
          start. Stronger at depth.&quot;). Flow is the default.
        </li>
        <li>
          <strong>Craft and place a <StationLink name="Magic Station" /></strong>, then interact with it to open the
          assembly menu and build a weapon out of parts.
        </li>
        <li>
          <strong>Slot runes</strong> into the weapon&apos;s sockets. This is where spells come
          from; a weapon with no runes casts nothing.
        </li>
        <li>
          <strong>Build a shrine</strong> and put an artifact on a <WikiItemLink name="Pedestal">pedestal</WikiItemLink> in it to soak up aura.
        </li>
        <li>
          <strong>Imprint and fill a charge</strong> on that same <WikiItemLink name="Pedestal">pedestal</WikiItemLink>.
        </li>
        <li>
          <strong>Spend the charge on the weapon at the station</strong>, which starts the orb
          minigame that decides how much of the charge actually sticks.
        </li>
        <li>
          <strong>Hold the weapon and use the rune&apos;s casting key</strong> to cast. The default is right-click.
        </li>
      </ol>

      <WikiSectionHeading id="station" intro="A plain vanilla 3x3 craft. Anyone can make one.">
        The <StationLink name="Magic Station" />
      </WikiSectionHeading>
      <div className="mt-4">
        <CraftingGrid recipe={magicStationRecipe} />
      </div>
      <WikiSectionHeading id="rune-station" intro="A second vanilla 3x3 craft: the Magic Station pattern without the Amethyst Shard. Anyone can make one.">
        The <StationLink name="Rune Station" />
      </WikiSectionHeading>
      <div className="mt-4">
        <CraftingGrid recipe={runeStationRecipe} />
      </div>
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        The Rune Station turns <WikiItemLink name="Enchanted Dust">Enchanted Dust</WikiItemLink> into blank runestones,
        armor runestones and Enchanted Charges. Every recipe takes 10 seconds and needs nothing but dust.
      </p>
      <DataTable
        columns={[{ header: "Tier" }, { header: "Runestone", align: "right" }, { header: "Armor Runestone", align: "right" }, { header: "Enchanted Charge", align: "right" }]}
        rows={["Minor", "Lesser", "Greater", "Ascendant"].map((tier, i) => [
          tier,
          `${runestoneRecipes[i].ingredients[0].qty}x Enchanted Dust`,
          `${armorRunestoneRecipes[i].ingredients[0].qty}x Enchanted Dust`,
          `${enchantedChargeRecipes[i].ingredients[0].qty}x Enchanted Dust`,
        ])}
      />
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[...runestoneRecipes, ...armorRunestoneRecipes].map(recipe => <CraftingGrid key={recipe.key} recipe={recipe} />)}
      </div>

      <WikiSectionHeading id="rune-fit" intro="A socket takes a rune of its own tier or any tier below it. It never takes a bigger one.">
        Which rune fits which gear
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Craft quality of the gear" }, { header: "Socket it gets" }, { header: "Rune that fits" }]}
        rows={[
          ["Rusted", "None", "Nothing"],
          ["Tempered", "Minor", "Minor"],
          ["Polished", "Lesser", "Minor, Lesser"],
          ["Gleaming", "Greater", "Minor, Lesser, Greater"],
          ["Masterwork", "Ascendant", "Any tier"],
        ]}
      />
      <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          <strong>The socket comes from how well the piece was crafted, not from its material.</strong> Iron Mage armour
          can take an Ascendant Armor Rune, but only if that piece came out Masterwork. A Tempered iron piece has a Minor
          socket, so a Minor Armor Rune is the most it will ever hold.
        </li>
        <li>Armor runes go on Mage armour only. Every other armour piece has a Gemstone socket instead, and an armor rune will not fit it.</li>
        <li>Armor runes and weapon runes are separate: an armor rune never fits a staff, wand or blade, and a spell rune never fits armour.</li>
        <li>A smaller rune in a bigger socket works, but it uses that socket up. If a piece has several sockets, the rune goes into the smallest one that can hold it.</li>
        <li>Check the socket line in the item&apos;s lore before you spend the dust. It names the biggest size the piece accepts.</li>
      </ul>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Quality is decided while smithing, see <a href="/wiki/advanced-crafting#quality" className="text-[var(--tfmc-accent)] underline underline-offset-2">Advanced Crafting</a>.
      </p>

      <WikiSectionHeading id="archetypes" intro="Three weapon shapes, each wanting a different set of parts.">
        Archetypes
      </WikiSectionHeading>
      <DataTable
        columns={[
          { header: "Archetype", nowrap: true },
          { header: "In-game name" },
          { header: "Melee", nowrap: true },
          { header: "Parts it needs" },
        ]}
        rows={[
          ["Staff", "Mage Staff", "No", "Core, Handle, Tome x3"],
          ["Wand", "Wand", "No", "Core, Handle, Tome"],
          ["Sword", "Mage Blade", "Yes", "Core, Handle, Tome"],
        ]}
      />

      <WikiSectionHeading
        id="charges"
        intro="A charge is a consumable, not an artifact. Put it on a pedestal in a shrine and it is imprinted with every element that shrine scores, then filled from it."
      >
        Enchanted Charges
      </WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Charges are crafted at the <StationLink name="Rune Station" /> from Enchanted Dust: 4, 8, 12 and 16 dust for tiers I to IV.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {enchantedChargeRecipes.map(recipe => <CraftingGrid key={recipe.key} recipe={recipe} />)}
      </div>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        A weak shrine cannot fill a high-tier charge. The band printed on a
        charge (&quot;Cerrith II&quot;) is just a readout of how much aura it holds: under 10 shows
        a dash, 10 is I, 40 is II, 75 is III, 110 is IV.
      </p>
      <WikiSectionHeading
        id="orbs"
        intro="Applying a charge to a weapon starts a timed minigame. The charge is spent up front, win or lose."
      >
        The orb minigame
      </WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Orbs circle you. <strong>Pale blue orbs are good</strong>: hit enough of them before the
        window closes and the weapon settles, holding a percentage of the charge.{" "}
        <strong>Rust-orange orbs tear the weapon</strong>: each one you hit adds{" "}
        <strong>+5 persistent Rift</strong>, capped at 100. Missing a good orb costs 8% of the run.
        Disconnecting mid-run ends it with whatever you had.
      </p>
      <Callout title="A charge can exceed your Resonance">
        Right-click the prepared weapon on its station with the charge to start. If the charge
        demands more Resonance than you have, a warning lists each shortfall and
        asks you to right-click again to commit anyway. That second click spends the charge.
      </Callout>
      <StatGrid
        className="mt-4"
        columns={2}
        stats={[
          { label: "Rift per bad orb", value: "+5", note: "capped at 100" },
          { label: "Rift removed per later recharge", value: "10", note: "never on the first charge" },
        ]}
      />
      <Callout variant="warning" title="Rift persists until reduced by a later recharge">
        Rift is the percentage chance a cast simply fails. A failed cast still spends the mana and
        still starts the cooldown. You can only ever grind it back down 10 points at a time, and
        only on a <em>later</em> successful charge.
      </Callout>

      <WikiSectionHeading id="casting" intro="Hold the weapon and use the rune's casting key. The default is right-click.">
        Casting
      </WikiSectionHeading>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        To change a rune&apos;s casting key, hold the rune and use{" "}
        <code className="text-[var(--tfmc-accent)]">/magic rune keybind</code>.
      </p>
      <DataTable
        columns={[
          { header: "What you see", nowrap: true },
          { header: "Why" },
          { header: "What it costs you" },
        ]}
        rows={[
          [
            "*Whiff*",
            "Your Rift rolled against you (or the rarer \"Too many staffs\" message).",
            "Mana and the cooldown, both already spent.",
          ],
          [
            "*Refused*",
            "Your Resonance is below what the weapon asks, or the weapon holds no element at all.",
            "Nothing.",
          ],
          [
            "*Damaged*",
            "The weapon holds runes that no longer fit.",
            "Nothing, but the weapon will not cast until you reclaim its runes.",
          ],
        ]}
      />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        A refusal explains itself in chat, for example <em>&quot;This spell needs Cerrith 40. You carry
        25.&quot;</em>, but only once every 30 seconds per weapon and element, so do not
        expect a message on every click. To fix a <em>Damaged</em> weapon, right-click an{" "}
        <strong>empty</strong> <StationLink name="Magic Station" />: it works the loose runes free and hands them back.
      </p>

      <WikiSectionHeading
        id="meditation"
        intro="Shrines do not only fill artifacts. Standing in one and meditating is how you raise your own Resonance."
      >
        Meditation and Mental Points
      </WikiSectionHeading>
      <StatGrid
        columns={4}
        stats={[
          { label: "Resonance per orb hit", value: "4.0" },
          { label: "Mental Point cost per hit", value: "1" },
          { label: "Mental Point pool", value: "150", note: "shared with Research" },
          { label: "Regeneration", value: "+10 / hour", note: "offline too" },
        ]}
      />
      <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
        Mental Points (also called Focus) are a shared pool spent by both Magic meditation and
        Research experiments. Wisdom adds +0.5 per hour per point and Intelligence +0.25. A full
        pool of 150 takes fifteen real hours to refill and buys 150 orb hits. That is{" "}
        <strong>600 potential Resonance</strong> before element caps, shared-artifact division and session limits.
      </p>
      <Callout variant="warning" title="Resonance bleeds, and artifacts get tired of you">
        Resonance decays at -0.02 per real hour, so a mage who stops meditating slowly slides back.
        Worse, an artifact you meditate on gets <strong>muffled</strong>: it gives less and less
        over 24 hours of use, and takes a full 7 days to recover. If several people are attuned to
        one artifact, the yield is <em>divided</em> between them.
        <br />
        <strong>Storing an artifact in a chest raises its muffle, silently.</strong> Safe places are
        your own inventory, a <WikiItemLink name="Pedestal">pedestal</WikiItemLink>, an <WikiItemLink name="Artifact Display">artifact display</WikiItemLink>, or an item frame.
      </Callout>

      <WikiSectionHeading id="commands" intro="View your Resonance profile and change a rune's casting key.">
        Commands
      </WikiSectionHeading>
      <CommandTable
        commands={magicCommands.commands}
        showNotes={false}
      />

      <SeeAlso
        hrefs={[
          "/wiki/research",
          "/wiki/codex",
          "/wiki/gem-infusion",
          "/wiki/materials",
          "/wiki/stations",
          "/wiki/commands",
        ]}
      />
    </WikiPage>
  );
}
