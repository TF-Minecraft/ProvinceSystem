import {
  Callout,
  CommandTable,
  SeeAlso,
  WikiPage,
  WikiSectionHeading,
} from "@/app/components/wiki";
import { cardBackTexture, cardSuits, gamesCommands, playingCards } from "../data/games";
import { WikiItemLink } from "@/app/components/wiki";

export default function GamesPage() {
  return (
    <WikiPage
      lastModified="2026-09-12"
      title="Games"
      intro={
        <>
          Games turns any block into a card table. Place a deck, pick a game from a GUI, and bet real
          denars against other players (or the house) at Blackjack, Tenceur Hold&apos;em, Five-Draw, or
          a no-rules Free play table. Cards float in front of you as 3-D displays that only nearby
          players can see, and money actually changes hands: winnings are taxed like any other
          income.
        </>
      }

    >
      <WikiSectionHeading id="starting" intro="Place a table and invite other players to join.">
        Placing a table
      </WikiSectionHeading>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Hold a <WikiItemLink name="Deck of Cards" />.</li>
        <li>Right-click a block. A game-select GUI opens with four icons.</li>
        <li>
          Pick a game. Blackjack opens a table-options GUI (min bet, max bet, house settings) first;
          Poker, Five-Draw and Free play go straight to placing the table.
        </li>
        <li>Click the spot to place the table. Sneak to cancel.</li>
        <li>Picking the table back up drops the <WikiItemLink name="Deck of Cards" /> where the table was.</li>
      </ol>
      <WikiSectionHeading id="playing" intro="Rules shared by every table, whichever game you pick.">
        Playing at a table
      </WikiSectionHeading>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Your cards fan out in front of you, visible only within 48 blocks.</li>
        <li>
          Left-click a card in your fan to inspect it. Press your swap-hands key (F) to flip your
          whole hand face-up for the table.
        </li>
        <li>Right-click the shoe (the deck sitting on the table) to draw, deal, or act.</li>
        <li>Right-click the felt while holding coins to bet.</li>
        <li>
          Walk more than 6 blocks from the table and your cards return. This round&apos;s stake comes
          back with them.
        </li>
        <li>Only whole denars go on a table; silver bits are refused.</li>
        <li>Winnings are subject to the usual citizen tax, same as any other income.</li>
      </ul>

      <WikiSectionHeading id="card-catalogue" intro="The full 52-card deck, using familiar rank names.">
        Cards
      </WikiSectionHeading>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cardBackTexture} alt="Card back" width={16} height={16} className="h-20 w-20 object-contain [image-rendering:pixelated]" />
        <span className="text-sm font-semibold text-[var(--tfmc-cream)]">Card back</span>
      </div>
      <div className="mt-5 space-y-6">
        {cardSuits.map((suit) => (
          <section key={suit} aria-labelledby={`cards-${suit.toLowerCase()}`}>
            <h3 id={`cards-${suit.toLowerCase()}`} className="font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">{suit}</h3>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2">
              {playingCards.filter((card) => card.suit === suit).map((card) => (
                <figure key={card.id} className="flex min-w-0 flex-col items-center rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={card.texture}
                    alt={`${card.rankLabel} of ${card.suit}`}
                    width={16}
                    height={16}
                    loading="lazy"
                    className="h-24 w-24 max-w-full object-contain [image-rendering:pixelated]"
                  />
                  <figcaption className="mt-1 leading-tight">
                    <span className="block text-sm font-semibold text-[var(--tfmc-cream)]">{card.rankLabel}</span>
                    <span className="block text-xs text-[var(--tfmc-stone)]">{card.suit}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
      </div>

      <WikiSectionHeading id="blackjack">
        Blackjack
      </WikiSectionHeading>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>While betting is open, right-click your own box on the felt holding coins. Click again to add more.</li>
        <li>
          When your name comes up, right-click the shoe for a card, or type <code className="text-[var(--tfmc-accent)]">hit</code>,{" "}
          <code className="text-[var(--tfmc-accent)]">stand</code>, <code className="text-[var(--tfmc-accent)]">double</code>, or <code className="text-[var(--tfmc-accent)]">split</code> in chat. Those words only
          register on your turn. <code className="text-[var(--tfmc-accent)]">/games bet hit</code> does the same thing.
        </li>
        <li>The dealer reveals and draws to 17. This house does not hit soft 17.</li>
        <li>A win returns double your bet; a natural 21 on the first two cards pays 3:2; a push returns your bet.</li>
        <li>No insurance and no surrender are offered.</li>
        <li>
          To deal by hand, stand at the dealer&apos;s spot and right-click the shoe; right-click again
          to hand it over. A dealer runs <code className="text-[var(--tfmc-accent)]">/games bet min &lt;n&gt;</code>,{" "}
          <code className="text-[var(--tfmc-accent)]">/games bet max &lt;n&gt;</code>, <code className="text-[var(--tfmc-accent)]">/games bet open</code>,{" "}
          <code className="text-[var(--tfmc-accent)]">/games bet close</code>, then right-clicks the shoe. Some tables deal themselves :
          betting opens automatically once the first real bet lands.
        </li>
      </ol>

      <WikiSectionHeading id="holdem" intro="Tenceur Hold'em and Five-Draw share the same seating and betting flow.">
        Tenceur Hold&apos;em / Five-Draw
      </WikiSectionHeading>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>
          Right-click the felt with coins to sit down. Once two players are seated, anyone at the
          table can right-click the shoe to deal.
        </li>
        <li>
          Bet by pushing coins onto the felt first, then saying the word in chat: <code className="text-[var(--tfmc-accent)]">check</code>,{" "}
          <code className="text-[var(--tfmc-accent)]">call</code>, <code className="text-[var(--tfmc-accent)]">raise</code>, <code className="text-[var(--tfmc-accent)]">fold</code>. The table reads how many coins you
          actually put out, so saying &quot;raise&quot; with nothing on the felt does nothing.
        </li>
        <li>
          The dealer button shown above the table moves one seat after every hand; it sets who acts
          first.
        </li>
        <li>
          Five-Draw only: on your draw turn, click the cards you want to discard, then right-click the
          shoe for that many replacements. To stand pat, type <code className="text-[var(--tfmc-accent)]">draw</code> in chat: chat only,
          there is no <code className="text-[var(--tfmc-accent)]">/games bet draw</code>.
        </li>
        <li>
          Calling with less than you need puts you in for what you could manage: side pots are
          created and you can only win what you matched.
        </li>
        <li>Walking off forfeits this round&apos;s stake; earlier rounds&apos; stakes do not return.</li>
      </ul>
      <Callout variant="warning" className="mt-4">
        The blinds shown above a Hold&apos;em or Five-Draw table are advisory only. Nothing is taken
        from you automatically: whoever owes a blind has to put the coins out themselves.
      </Callout>

      <WikiSectionHeading id="freeplay" intro="No rules, no turns, no dealer.">
        Free play
      </WikiSectionHeading>
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--tfmc-mist)]">
        <li>Right-click the shoe empty-handed for a card. Click cards then right-click the shoe to discard them. No limit on how many you hold.</li>
        <li>Right-click the felt with coins to add to the middle.</li>
      </ul>
      <Callout variant="warning">
        Sneak + right-clicking the shoe picks up the entire pot. Play with people you trust.
      </Callout>

      <WikiSectionHeading id="wagering-items" intro="Betting something other than coins.">
        Wagering non-coin items
      </WikiSectionHeading>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Hold the item, type <code className="text-[var(--tfmc-accent)]">/wager &lt;amount&gt;</code>, and the table votes on whether it
        counts (a 30-second window). If accepted, you have 10 seconds to click the felt with that same
        item. With only one other player at the table, a wager auto-accepts if nobody else has bought
        in.
      </p>

      <Callout variant="note">
        The deck is themed to server lore: the four suits are cerrith, mitlan, oseni and seithr,
        rather than hearts, clubs, diamonds and spades.
      </Callout>

      <WikiSectionHeading id="commands">Commands</WikiSectionHeading>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Everything else at a table: placing it, dealing, betting coins, drawing, discarding,
        revealing, taking the free-play pot: is clicks and chat words, not commands. The chat words a
        table recognises, only on your turn, are <code className="text-[var(--tfmc-accent)]">hit</code>, <code className="text-[var(--tfmc-accent)]">stand</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">double</code>, <code className="text-[var(--tfmc-accent)]">split</code>, <code className="text-[var(--tfmc-accent)]">check</code>, <code className="text-[var(--tfmc-accent)]">call</code>,{" "}
        <code className="text-[var(--tfmc-accent)]">raise</code>, <code className="text-[var(--tfmc-accent)]">fold</code>, and <code className="text-[var(--tfmc-accent)]">draw</code> (Five-Draw stand-pat only).
      </p>
      <CommandTable
        commands={gamesCommands.commands}
        showAliases={false}
        showNotes={false}
      />

      <SeeAlso hrefs={["/wiki/materials", "/wiki/commands"]} />
    </WikiPage>
  );
}
