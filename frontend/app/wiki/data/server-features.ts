import { V, empty } from "./helpers";
import type { Recipe, WikiCommandSet, WikiSection } from "./types";

// ---------- TFMCCore + TFMCWeb ----------

export const letterRecipe: Recipe = {
  key: "craft-letter",
  title: "Letter",
  station: "Crafting Table",
  requirement: "None",
  ingredients: [
    { name: "Paper", qty: 1, texture: V("paper.png") },
    { name: "Paper", qty: 1, texture: V("paper.png") },
    empty,
    { name: "Paper", qty: 1, texture: V("paper.png") },
    { name: "Paper", qty: 1, texture: V("paper.png") },
    empty,
    empty,
    empty,
    empty,
  ],
  output: { name: "Letter", qty: 1, texture: "/wiki/textures/items/letters/letter.png" },
  note: "Write in the Letter and sign it to seal it.",
};

export const serverFeaturesCommands: WikiCommandSet = {
  system: "TFMCCore + TFMCWeb",
  href: "/wiki/server-features",
  commands: [
    {
      command: "/linkdiscord",
      description: "Requests a one-time Discord link code and prints it click-to-copy in chat.",
      notes: "Run /linkdiscord <code> in the Discord server to finish linking, usually within about a second.",
    },
    {
      command: "/unlinkdiscord",
      description: "Removes your Discord link.",
      notes: "You'll need to link again to play Survival.",
    },
    {
      command: "/token",
      description: "Shows the token actions available to you.",
    },
    {
      command: "/token create <skin|drink|profile>",
      description: "Creates a one-time website code to redeem for a skin upload, a drink upload, or your profile page.",
      access: "permission",
      permission: "tfmcweb.token.create",
      notes: "Skin and drink codes share one cooldown, gated by rank (28 days down to 7 days). This is a rank perk, not something every player has.",
    },
  ],
  excludedStaffCommands: [
    "/tcore stats <category> <player>",
    "/tcore reload [all|config|drops|stations|stats|focus|whistle|letters|lorestones]",
    "/tcore focus restore <player>",
    "/tcore stones give <lorestone|namestone> [player] [amount]",
    "/token create skin staff",
    "/token resetcooldowns <player>",
    "/warning <player> <reason>",
    "/web status|reload|lookup|unlink|reconcile|syncmeta",
  ],
};

export const serverFeaturesSection: WikiSection = {
  nav: {
    href: "/wiki/server-features",
    label: "Server Features & Website Link",
    category: "character",
    blurb: "Letters, lorestones, the animal whistle, and linking your account to the website.",
  },
  recipes: [letterRecipe],
  commands: serverFeaturesCommands,
};
