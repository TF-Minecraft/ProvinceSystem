import {
  Callout,
  CommandTable,
  DataTable,
  RankName,
  SeeAlso,
  StatGrid,
  WikiItemLink,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { charactersCommands } from "../data/characters";

export default function CharactersPage() {
  return (
    <WikiPage
      lastModified="2026-09-15"
      title="Characters"
      intro={
        <>
          Your character is who you <em>are</em> on this server. Your roleplay chat, injuries and
          deaths belong to a character you create, not to your Minecraft
          account directly. In Survival, you cannot do much of anything until you have one.
        </>
      }
    >
      <Callout variant="warning">
        With no active character, almost every command is blocked: you can still run{" "}
        <code className="mx-1 text-[var(--tfmc-accent)]">/rpcharacter ...</code>, <code className="mx-1 text-[var(--tfmc-accent)]">/roll</code>,
        and the chat-channel commands, and nothing else. Making a character is not optional.
      </Callout>

      <WikiSectionHeading
        id="creating"
        intro="One command starts a long guided creator: expect to spend real time on this."
      >
        Creating a character
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Type <code className="text-[var(--tfmc-accent)]">/rpcharacter create</code> to begin. You
        will be walked stage by stage through: an out-of-character age gate (18+), your
        character&apos;s name (typed in chat), class information and selection, race selection,
        character age, a set of trait choices (homeland, cataclysm, reclamation, motivation, gift,
        virtue, combat, physical, celestial), attribute allocation, personality, an optional evil
        archetype, a permanent injury roll, an optional prosthetic, a written description, an
        opening clue, and finally your wardrobe. Use{" "}
        <code className="text-[var(--tfmc-accent)]">/rpcharacter next</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">back</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">help</code> and{" "}
        <code className="text-[var(--tfmc-accent)]">cancel</code> to move through it.
      </p>
      <p className="mt-3 text-sm text-[var(--tfmc-mist)]">
        Once you have a character, <code className="text-[var(--tfmc-accent)]">/rpcharacter menu</code>{" "}
        opens a menu of your characters so you can switch between them (on a cooldown: see
        below), and <code className="text-[var(--tfmc-accent)]">/rpcharacter kit starter</code>{" "}
        claims your starting supplies: an <WikiItemLink name="Iron Hunting Knife">iron hunting knife</WikiItemLink>, 32 gold coins, 256 bread, a
        writable book, a bundle and a brown bed. The starter kit can only be claimed once per
        character, with a 48-hour cooldown.
      </p>

      <StatGrid
        columns={4}
        stats={[
          { label: "Max character slots", value: "10", note: "hard cap for every rank" },
          { label: <><RankName rank="Commoner" /> alive characters</>, value: "3", note: "higher for donator ranks" },
          { label: "Switch cooldown", value: "14 days", note: <><RankName rank="Commoner" /> rank; shorter for higher ranks</> },
          { label: "Minimum age", value: "18 years", note: "in-fiction calendar" },
        ]}
      />
      <WikiSectionHeading id="rank-benefits" intro="Ranks change character limits and customisation options.">
        Rank benefits
      </WikiSectionHeading>
      <DataTable
        columns={[{ header: "Rank" }, { header: "Switch cooldown" }, { header: "Alive characters" }, { header: "Name colours" }, { header: "Wardrobe slots" }]}
        rows={[
          [<RankName key="commoner" rank="Commoner" />, "14 days", 3, 0, 1],
          [<RankName key="noble" rank="Noble" />, "10 days", 3, 1, 1],
          [<RankName key="gilded" rank="Gilded" />, "7 days", 4, 2, 2],
          [<RankName key="ascended" rank="Ascended" />, "5 days", 5, 20, 3],
          [<RankName key="legacy" rank="Legacy" />, "5 days", 5, 20, 3],
        ]}
      />

      <WikiSectionHeading id="looking-at-someone" intro="A quiet way to check who you're talking to.">
        Reading a character card
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Sneak, hold nothing in your hand, and right-click a player to print their character card :
        name and whatever they have chosen to show. It only works with an empty hand while
        sneaking, so it will not fire by accident.
      </p>

      <WikiSectionHeading id="chat" intro="Plain typing talks in-character. Everything else is a command.">
        Chat channels
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Whatever you type without a command goes to your <strong>default channel</strong>, which
        starts as regular in-character speech (<code className="text-[var(--tfmc-accent)]">rp</code>).
        Change your default with <code className="text-[var(--tfmc-accent)]">/channel &lt;id&gt;</code>{" "}
        (bare <code className="text-[var(--tfmc-accent)]">/channel</code> shows your current one),
        and hide or show a channel in your own view with{" "}
        <code className="text-[var(--tfmc-accent)]">/channeltoggle &lt;id&gt;</code>.
      </p>
      <div className="mt-4">
        <DataTable
          columns={[
            { header: "Channel", nowrap: true },
            { header: "Command" },
            { header: "Range" },
            { header: "What it's for" },
          ]}
          rows={[
            ["In-character speech", "/rp", "15 blocks", "Normal talking as your character"],
            ["Shout", "/shout", "24 blocks", "Raised voice"],
            ["Yell", "/yell (/y)", "48 blocks", "Shouting at the top of your lungs: bold red"],
            ["Whisper", "/whisper (/wh)", "2 blocks", "Quiet, only for someone right next to you"],
            ["Local OOC", "/looc", "20 blocks", "Out-of-character chatter with people nearby"],
            ["Global OOC", "/ooc", "Unlimited", "Server-wide out-of-character chat: works with no character"],
            ["Action", "/me", "20 blocks", "Emotes and actions, shown as narration"],
            ["Scene", "/scene", "20 blocks", "Scene-setting narration, no speech bubble"],
          ]}
        />
      </div>
      <Callout variant="warning" className="mt-4">
        Speech is also affected by walls and distance: muffled or distant speakers can appear
        partly garbled, or show up simply as{" "}
        <code className="text-[var(--tfmc-accent)]">:::</code> if you are too far to make them out
        clearly.
      </Callout>

      <WikiSectionHeading id="rolling">Rolling dice</WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        <code className="text-[var(--tfmc-accent)]">/roll</code> rolls from 1 to 100.{" "}
        <code className="text-[var(--tfmc-accent)]">/roll &lt;max&gt;</code> uses a custom maximum, and{" "}
        <code className="text-[var(--tfmc-accent)]">/roll &lt;attribute&gt;</code> rolls a d20 plus that
        attribute&apos;s modifier. Results are shown to players within 20 blocks.
      </p>

      <WikiSectionHeading id="injuries-graves" intro="Death and injury are part of the roleplay, not just a stat penalty.">
        Injury, death, and graves
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Injuries can be healing (temporary) or permanent, and range from a broken arm to full
        blindness: each comes with real stat penalties while it lasts. Two players can arrange a
        consensual roleplay injury with{" "}
        <code className="text-[var(--tfmc-accent)]">/rpcharacter injure &lt;player&gt;</code>: you
        pick the injury from a GUI, then the target has to confirm it within 30 seconds. If your
        character dies, a grave chest appears with a hologram showing who killed you: right-click
        it to recover your things (or let someone else rob it). Graves never expire on their own.
        A <strong>Grave Insurance</strong> item, if you have one,
        recovers your newest grave from anywhere.
      </p>

      <StatGrid
        stats={[
          { label: "Healing injury duration", value: "72 hours" },
          { label: "Consensual injury range", value: "10 blocks", note: "with a 30s confirm timeout" },
          { label: "Grave hologram radius", value: "32 blocks" },
        ]}
      />

      <WikiSectionHeading id="clues" intro="Investigation is passive by default, active if you want it faster.">
        Clues
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        Characters can leave 2-10 personal clues around the world, plus every character
        automatically leaves a subtle racial tell. Clues are found passively over time just by
        being nearby, or actively by holding a magnifying glass (four tiers exist, better ones see
        further and find things faster) and right-clicking to search. Clue potency fades over
        time, so an old clue is harder to read than a fresh one.{" "}
        <code className="mx-1 text-[var(--tfmc-accent)]">/rpcharacter clues</code> opens your own
        clue list.
      </p>

      <WikiSectionHeading id="persona" intro="Small touches you can set once your character exists.">
        Customising your character
      </WikiSectionHeading>
      <p className="text-sm text-[var(--tfmc-mist)]">
        <code className="text-[var(--tfmc-accent)]">/rpcharacter namecolour</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">gender</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">description</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">birthday</code> let you fill in and adjust who
        your character is after creation. Descriptions must contain 32 to 256 characters. The
        name-colour tool supports the number of name colours listed for your rank above. Players
        with <RankName rank="Noble" />, <RankName rank="Gilded" />, <RankName rank="Ascended" />,
        or <RankName rank="Legacy" /> rank can use colour codes.
      </p>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <CommandTable
        commands={charactersCommands.commands}
        showAliases={false}
        excludedStaffCommands={charactersCommands.excludedStaffCommands}
      />

      <SeeAlso hrefs={["/wiki/classes", "/wiki/server-features", "/wiki/bird-mail"]} />
    </WikiPage>
  );
}
