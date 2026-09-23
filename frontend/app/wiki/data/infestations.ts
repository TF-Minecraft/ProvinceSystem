import type { WikiCommandSet, WikiSection } from "./types";

// ---------- Infestations ----------
//
// Sourced from https://github.com/TF-Minecraft/Docs/blob/main/projects/ProvinceSystem/docs/wiki-research/e-adventure.md, "Infestations" section.
// Jar: infestations-0.1.0.jar. No player commands exist; the whole feature is
// played with the Lure item and by walking into a province.

export type InfestationMob = {
  /** MythicMobs internal ID. */
  id: string;
  /** Display name used in this table when the dossier gives one. */
  display?: string;
  /** Spawn weight for the swamp_mobs group (the common configuration). */
  weightSwampMobs: number;
  /** Spawn weight for the swamp_mobs_hill group, where it differs. */
  weightSwampMobsHill?: number;
};

/**
 * Both configured infestation groups share this roster; only `greentroll`'s
 * weight differs between them (rare vs. common). HP figures are not given in
 * the Infestations section of the dossier: the mobs are defined by MythicMobs,
 * whose stats were not researched here.
 */
export const infestationMobs: InfestationMob[] = [
  { id: "SwampGhoul", weightSwampMobs: 0.5 },
  { id: "parasitic_worm", weightSwampMobs: 1.0 },
  { id: "butterfly_zombie", weightSwampMobs: 1.0 },
  { id: "dragonfly_zombie", weightSwampMobs: 1.0 },
  { id: "frog_zombie", weightSwampMobs: 1.0 },
  { id: "mantis_zombie", weightSwampMobs: 1.0 },
  { id: "rpg_rat", weightSwampMobs: 1.0 },
  { id: "rpg_rat_undead", weightSwampMobs: 1.0 },
  { id: "rpg_poison_slime_cube", weightSwampMobs: 1.0 },
  { id: "rpg_slime_cube", weightSwampMobs: 1.0 },
  { id: "rpg_skeleton", weightSwampMobs: 1.0 },
  { id: "rpg_skeleton_crossbow", weightSwampMobs: 1.0 },
  { id: "greentroll", weightSwampMobs: 0.05, weightSwampMobsHill: 1.0 },
];

export type InfestationSeverity = {
  severity: string;
  ambientCap: number;
  ambientInterval: string;
  ambientRing: string;
  lureWaveSize: number;
  lureDuration: string;
};

/** Per-severity numbers, identical for both configured groups. */
export const infestationSeverities: InfestationSeverity[] = [
  { severity: "Mild", ambientCap: 8, ambientInterval: "40 ticks (2 s)", ambientRing: "10-22 blocks", lureWaveSize: 20, lureDuration: "120 s" },
  { severity: "Worrying", ambientCap: 16, ambientInterval: "40 ticks (2 s)", ambientRing: "10-20 blocks", lureWaveSize: 40, lureDuration: "120 s" },
  { severity: "Severe", ambientCap: 28, ambientInterval: "30 ticks (1.5 s)", ambientRing: "9-19 blocks", lureWaveSize: 60, lureDuration: "120 s" },
  { severity: "Extreme", ambientCap: 40, ambientInterval: "20 ticks (1 s)", ambientRing: "8-18 blocks", lureWaveSize: 80, lureDuration: "120 s" },
];

export type InfestationSeverityCount = { severity: string; group: string; provinceCount: number };

/** Live infestations on this server, from MapAPI/infestation_data.json. */
export const infestationLiveCounts: InfestationSeverityCount[] = [
  { group: "swamp_mobs", severity: "Mild", provinceCount: 3 },
  { group: "swamp_mobs", severity: "Worrying", provinceCount: 24 },
  { group: "swamp_mobs", severity: "Severe", provinceCount: 36 },
  { group: "swamp_mobs", severity: "Extreme", provinceCount: 22 },
  { group: "swamp_mobs_hill", severity: "Extreme", provinceCount: 3 },
];

/**
 * No player commands exist. infestations-0.1.0.jar declares exactly one
 * command, `/infestation` (alias `/infestations`), and it is
 * `infestations.admin`/op-only end to end: there is nothing here for a player
 * to type.
 */
export const infestationsCommands: WikiCommandSet = {
  system: "Infestations",
  href: "/wiki/infestations",
  commands: [],
  excludedStaffCommands: [
    "/infestation reload",
    "/infestation set",
    "/infestation clear",
    "/infestation list",
  ],
};

export const infestationsSection: WikiSection = {
  nav: {
    href: "/wiki/infestations",
    label: "Infestations",
    category: "combat",
    blurb: "Swamp provinces overrun by Bog Monsters: fight the ambient spawns or clear the whole thing with a Lure.",
    draft: true,
  },
  commands: infestationsCommands,
};
