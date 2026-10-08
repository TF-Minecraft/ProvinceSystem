import type { WikiCommandSet, WikiSection } from "./types";

// ---------- RPCharacters ----------

export const charactersCommands: WikiCommandSet = {
  system: "Characters",
  href: "/wiki/characters",
  commands: [
    {
      command: "/rpcharacter create",
      description: "Starts the staged character creator.",
      notes: "Requires a free character slot (10 max, see the numbers below).",
    },
    {
      command: "/rpcharacter next",
      description: "Moves to the next stage of an in-progress creator.",
      notes: "Also /rpcharacter back, help, cancel for navigation.",
    },
    {
      command: "/rpcharacter edit [entry]",
      description: "Re-opens the creation editor, or jumps to one entry of it.",
    },
    {
      command: "/rpcharacter menu",
      description: "Opens your character menu: switch characters, see who's dead.",
    },
    {
      command: "/rpcharacter kit <id>",
      description: "Claims a kit, e.g. /rpcharacter kit starter.",
      notes: "Starter kit: 48 hour cooldown, once per character.",
    },
    {
      command: "/rpcharacter clues",
      description: "Opens your active character's clue list.",
    },
    {
      command: "/rpcharacter wardrobe [slot]",
      description: "Opens the wardrobe menu, or equips a slot directly (base, extra_1, extra_2, or a saved name).",
    },
    {
      command: "/rpcharacter party create <name> | invite <player> | join | leave | kick <player> | info",
      description: "Temporary RP party chat groups. Not the dungeon /party command.",
    },
    {
      command: "/rpcharacter injure <player>",
      description: "Starts a consensual roleplay injury on another player. They must confirm it.",
      notes: "10-block range, 30-second confirmation timeout.",
    },
    {
      command: "/rpcharacter alias <name>",
      description: "Sets a display alias for your character (or /rpcharacter alias clear).",
      access: "permission",
      permission: "rpchar.persona.set",
      notes: "Undeclared permission node: access assumed but not verified against the live server.",
    },
    {
      command: "/rpcharacter namecolour <#hex...>",
      description: "Sets your character's name colour, or a gradient across several colours.",
      notes: "How many colours you can use depends on your rank.",
    },
    {
      command: "/rpcharacter gender <Male/Female/Other>",
      description: "Sets your character's gender.",
    },
    {
      command: "/rpcharacter description <text>",
      description: "Sets your character's description (or /rpcharacter description clear).",
      notes: "32 to 256 characters.",
    },
    {
      command: "/rpcharacter birthday <DD.MM.YYYY>",
      description: "Sets your character's birthday on the in-fiction calendar (or clear).",
      notes: "Checked against your race's maximum age and the calendar's 18-year minimum.",
    },
    {
      command: "/rpcharacter profile [player]",
      description: "Shows a character's profile card.",
      access: "permission",
      permission: "rpchar.profile",
      notes: "Undeclared/op-default node; an external player grant is assumed but unverified.",
    },
    {
      command: "/rpcharacter dismisspdwarning",
      description: "Permanently hides the permadeath tutorial popup.",
    },
    {
      command: "/rpcharacter tempalias <name>",
      description: "Sets a session-only alias (or /rpcharacter tempalias clear).",
      access: "permission",
      permission: "rpchar.tempalias",
      notes: "Undeclared/op-default node; an external player grant is assumed but unverified.",
    },
    {
      command: "/rpcharacter sethidden <slug> [clear]",
      description: "Hides one of your characters from TAB and character lists.",
      access: "permission",
      permission: "rpchar.character.hidden",
      notes: "Undeclared/op-default node; an external player grant is assumed but unverified.",
    },
    {
      command: "/roll [max or attribute] [+/-mod]",
      description: "Rolls dice and broadcasts the result to nearby players.",
      notes: "Bare /roll is 1 to 100; attribute rolls use a d20 plus the modifier.",
    },
    {
      command: "/profession",
      description: "Opens the profession menu (Crafter, Forager, Herborist).",
    },
    {
      command: "/profession top <profession>",
      description: "Shows the leaderboard for one profession.",
    },
    {
      command: "/pvp start",
      description: "Broadcasts a 10-second PvP countdown to everyone within 16 blocks.",
    },
    {
      command: "/pvp lethal",
      description: "Sets your active character's PvP mode to lethal.",
    },
    {
      command: "/pvp nonlethal",
      description: "Sets your active character's PvP mode to non-lethal.",
    },
    {
      command: "/channel [id]",
      description: "Sets your default chat channel, or shows the current one with no argument.",
      notes: "rp, ooc, looc, whisper, shout, yell, action.",
    },
    {
      command: "/channeltoggle <id>",
      description: "Shows or hides one chat channel in your own view.",
      notes: "looc, ooc, helper, admin.",
    },
    {
      command: "/rp <message>",
      description: "In-character speech.",
      notes: "15-block range.",
    },
    {
      command: "/shout <message>",
      description: "Louder in-character speech.",
      notes: "24-block range.",
    },
    {
      command: "/yell <message>",
      aliases: ["/y"],
      description: "Your loudest in-character shout: renders bold red.",
      notes: "48-block range.",
    },
    {
      command: "/whisper <message>",
      aliases: ["/wh"],
      description: "Quiet in-character speech only those right next to you hear.",
      notes: "2-block range, italic.",
    },
    {
      command: "/looc <message>",
      description: "Local out-of-character chat.",
      notes: "20-block range.",
    },
    {
      command: "/ooc <message>",
      description: "Global out-of-character chat.",
      notes: "Works even with no active character.",
    },
    {
      command: "/me <message>",
      description: "An emote or action, shown as narration rather than speech.",
      notes: "20-block range.",
    },
    {
      command: "/scene <message>",
      description: "Scene-setting narration, like /me but without a speech bubble.",
      notes: "20-block range.",
    },
  ],
  excludedStaffCommands: [
    "/rpcharacter admin injure|permakill",
    "/rpcharacter reload",
    "/rpcharacter catalog sync",
    "/rpcharacter pending sync",
    "/rpcharacter wipe",
    "/rpcharacter reclaimkit",
    "/rpcharacter resetkit",
    "/rpcharacter stage preview",
    "/rpcharacter setclass",
    "/rpcharacter seteighteen",
    "/rpcharacter skipcooldown",
    "/rpcharacter addtrait",
    "/rpcharacter removetrait",
    "/rpcharacter placeclue",
    "/rpcharacter clearclues",
    "/rpcharacter adminmode",
    "/rpcharacter discordgate",
    "/rpcharacter setworldspawn",
    "/rpcharacter override <player> <field> <value>",
    "/rpcharacter menu <player>",
    "/rpcharacter clues <player>",
    "/profession reload|givepoints|removeupgrade|reset",
    "/admin, /helper, /dm chat channels",
  ],
};

export const charactersSection: WikiSection = {
  nav: {
    href: "/wiki/characters",
    label: "Characters",
    category: "character",
    blurb: "Create your character and learn how in-character chat, clues and injuries work.",
  },
  commands: charactersCommands,
};
