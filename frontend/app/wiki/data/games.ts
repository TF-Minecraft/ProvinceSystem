import { T } from "./helpers";
import type { WikiCommandSet, WikiSection } from "./types";

export const cardSuits = ["Cerrith", "Mitlan", "Oseni", "Seithr"] as const;
export const cardRankLabels = [
  "Ace", "2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King",
] as const;

export type PlayingCard = {
  id: string;
  suit: (typeof cardSuits)[number];
  rank: number;
  rankLabel: (typeof cardRankLabels)[number];
  texture: string;
};

/** Exact 52-card set from Games/cards.yml and ItemsAdder tfmc_games/contents/items.yml. */
export const playingCards: PlayingCard[] = cardSuits.flatMap((suit) =>
  cardRankLabels.map((rankLabel, index) => {
    const rank = index + 1;
    const id = `${suit.toLowerCase()}_${rank}`;
    return { id, suit, rank, rankLabel, texture: T(`cards/${id}.png`) };
  }),
);

export const cardBackTexture = T("cards/card_back.png");

/**
 * Three permissions cover every player-facing command, and all three are
 * default: true in the plugin's plugin.yml: granted to everyone. Everything
 * else at the table (placing, dealing, betting coins, drawing, discarding,
 * revealing, taking the free-play pot) is clicks and chat words, not commands.
 */
export const gamesCommands: WikiCommandSet = {
  system: "Games",
  href: "/wiki/games",
  commands: [
    {
      command: "/games",
      description: "Prints the usage line appropriate to your permissions.",
    },
    {
      command: "/games help",
      description: 'Opens the "Table games" index book.',
      notes: "games.help, default true for everyone.",
    },
    {
      command: "/games help <blackjack|poker|draw|freeplay>",
      description: "Opens that game's rule book.",
      notes: "games.help, default true for everyone.",
    },
    {
      command: "/games bet min <n>",
      description: "Sets the table minimum, as the dealer standing at the shoe.",
      notes: "games.bet, default true for everyone.",
    },
    {
      command: "/games bet max <n>",
      description: "Sets the table maximum.",
      notes: "games.bet, default true for everyone.",
    },
    {
      command: "/games bet open",
      description: "Opens betting for a round.",
      notes: "games.bet, default true for everyone.",
    },
    {
      command: "/games bet close",
      description: "Closes betting.",
      notes: "games.bet, default true for everyone.",
    },
    {
      command: "/games bet hit | stand | double | split",
      description: "Blackjack action on your turn.",
      notes: "games.bet, default true. Identical to typing the word in chat on your turn.",
    },
    {
      command: "/games bet check | call | fold | raise",
      description: "Tenceur Hold'em / Five-Draw action on your turn.",
      notes:
        "games.bet, default true. Put coins on the felt before using raise: the table only reads coins actually on the felt.",
    },
    {
      command: "/wager <amount>",
      description: "Proposes the item you are currently holding as a stake; the table votes on it.",
      notes: "games.wager, default true.",
    },
    {
      command: "/wager accept",
      description: "Votes yes on a proposed wager.",
      notes: "games.wager, default true.",
    },
    {
      command: "/wager decline",
      description: "Votes no on a proposed wager.",
      notes: "games.wager, default true.",
    },
  ],
  excludedStaffCommands: [
    "/games reload",
    "/games deck",
    "/games deck test",
    "/games display",
    "/games place [poker|draw|blackjack|freeplay]",
    "/games payout [player]",
    "/games session start|stop",
    "/games deal",
    "/games deal table",
  ],
};

export const gamesSection: WikiSection = {
  nav: {
    href: "/wiki/games",
    label: "Games",
    category: "combat",
    blurb: "Place a table with a Deck of Cards and bet real denars at Blackjack, Hold'em, Five-Draw, or Free play.",
  },
  commands: gamesCommands,
};
