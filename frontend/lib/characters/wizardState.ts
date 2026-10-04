import type {
  AttributeModifierDto,
  CatalogStage,
  CatalogTrait,
  CreateCharacterBody,
  CreationCatalog,
  ExperienceModifierDto,
} from "./api";
import {
  birthdayFromAge,
  resolvedBirthdayIso,
} from "./fantasyCalendar";
import { emptyRanks, isExactSpend } from "./pointBuy";
import {
  isValidDisplayName,
  isValidProse,
  optionalDisplayNameError,
  proseError,
} from "../textValidation";

export type WizardDraft = {
  client_request_id: string;
  name: string;
  age: string;
  /** Fantasy ISO birthday override; null means derive from age + salt. */
  birthday: string | null;
  /** Player 18+ attestation (real life); null until answered. */
  eighteen: boolean | null;
  description: string;
  gender: string;
  race_id: string;
  class_id: string;
  attributes: Record<string, number>;
  /** trait id → selected */
  traitIds: string[];
  clues: string[];
  /** Separate from name; hex/§ tokens for persona NameColour. */
  name_colours: string[];
};

export type StageCopy = {
  title: string | null;
  bodyLines: string[];
};

const INTERACTIVE_TYPES = new Set([
  "setter",
  "selection",
  "attributes",
  "clue",
  "summary",
  "wardrobe",
]);

export function newDraft(catalog: CreationCatalog): WizardDraft {
  const attrs = catalog.attribute_point_buy?.attributes ?? [];
  return {
    client_request_id: crypto.randomUUID(),
    name: "",
    age: "",
    birthday: null,
    eighteen: null,
    description: "",
    gender: "",
    race_id: "",
    class_id: "",
    attributes: emptyRanks(attrs),
    traitIds: [],
    clues: [],
    name_colours: [],
  };
}

export function isRealAgeStage(stage: CatalogStage): boolean {
  const id = String(stage.id || "").toLowerCase();
  if (id === "age_stage" || id === "creation_age_set_stage") return true;
  const type = String(stage.type || "").toLowerCase();
  const target = String(stage.target || "").toLowerCase();
  return type === "setter" && target === "real_age";
}

export type PlayableStageOpts = {
  skipRealAge?: boolean;
  /** Prefer list.evil_unlocked when known. */
  evilUnlocked?: boolean;
  accountAgeSeconds?: number;
  selectedTraitIds?: string[];
};

function asHours(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Match Stage.passesAccountAgeGate (max is exclusive). */
export function passesAccountAgeGate(
  stage: CatalogStage,
  opts?: Pick<PlayableStageOpts, "evilUnlocked" | "accountAgeSeconds">
): boolean {
  const min = asHours(stage.require_account_age_hours_min);
  const max = asHours(stage.require_account_age_hours_max);
  if (min === null && max === null) return true;

  if (typeof opts?.evilUnlocked === "boolean") {
    if (min !== null && !opts.evilUnlocked) return false;
    if (max !== null && opts.evilUnlocked) return false;
    return true;
  }

  const ageSec = Math.max(0, Number(opts?.accountAgeSeconds ?? 0) || 0);
  if (min !== null && ageSec < min * 3600) return false;
  if (max !== null && ageSec >= max * 3600) return false;
  return true;
}

/** Trait dependency parity with RPCharacters Dependency.check (trait modes). */
export function passesTraitDependency(
  stage: CatalogStage,
  selectedTraitIds: string[] | undefined
): boolean {
  const dep = stage.dependency;
  if (!dep || typeof dep !== "object") return true;
  const type = String(dep.type || "").toLowerCase();
  if (type !== "trait") return true;
  const mode = String(dep.mode || "").toLowerCase();
  const dependsOn = Array.isArray(dep.depends_on)
    ? dep.depends_on.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!dependsOn.length) return true;
  const selected = new Set(
    (selectedTraitIds || []).map((id) => String(id || "").trim()).filter(Boolean)
  );
  if (mode === "all") {
    return dependsOn.every((id) => selected.has(id));
  }
  if (mode === "one-or-more") {
    return dependsOn.some((id) => selected.has(id));
  }
  return true;
}

export function playableStages(
  catalog: CreationCatalog,
  opts?: PlayableStageOpts
): CatalogStage[] {
  const stages = [...(catalog.stages || [])];
  stages.sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  return stages.filter((s) => {
    const t = String(s.type || "").toLowerCase();
    if (!t) return false;
    const platform = String(s.platform || "both").toLowerCase();
    if (platform === "game") return false;
    if (opts?.skipRealAge && isRealAgeStage(s)) return false;
    if (!passesTraitDependency(s, opts?.selectedTraitIds)) return false;
    if (!passesAccountAgeGate(s, opts)) return false;
    return true;
  });
}

export function isInteractiveStage(stage: CatalogStage): boolean {
  return INTERACTIVE_TYPES.has(String(stage.type || "").toLowerCase());
}

export function interactiveStageCount(stages: CatalogStage[]): number {
  return stages.filter(isInteractiveStage).length;
}

/** Interactive step index (1-based) for progress, or null for info cards. */
export function interactiveProgress(
  stages: CatalogStage[],
  index: number
): { current: number; total: number } | null {
  const stage = stages[index];
  if (!stage || !isInteractiveStage(stage)) return null;
  const total = interactiveStageCount(stages);
  let current = 0;
  for (let i = 0; i <= index; i++) {
    if (isInteractiveStage(stages[i]!)) current += 1;
  }
  return { current, total };
}

function stripColors(raw: string): string {
  return raw
    .replace(/§[0-9a-fk-or]/gi, "")
    .replace(/#[0-9a-fA-F]{6}/g, "")
    .trim();
}

function unwrapMinecraftLine(raw: string): { kind: "title" | "body" | "plain"; text: string } {
  const s = String(raw || "").trim();
  const title = s.match(/^title\((.*)\)$/i);
  if (title) {
    return { kind: "title", text: stripColors(title[1] || "") };
  }
  const subtitle = s.match(/^subtitle\((.*)\)$/i);
  if (subtitle) {
    return { kind: "body", text: stripColors(subtitle[1] || "") };
  }
  return { kind: "plain", text: stripColors(s) };
}

function isInGameOnlyLine(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  // Drop any line that mentions the in-game advance command.
  if (t.includes("/rpcharacter next") || t.includes("rpcharacter next")) {
    return true;
  }
  return false;
}

/** Rewrite in-game chat prompts for the web. */
export function webifyPrompt(text: string): string {
  let s = String(text || "").trim();
  if (!s) return s;
  s = s.replace(/\bAre you 18\+ in real life\? Yes\/No in chat\b/gi, "Are you 18+ in real life?");
  s = s.replace(/\bYes\/No in chat\b/gi, "Yes or No");
  s = s.replace(/\bin chat next\b/gi, "next");
  s = s.replace(/\bin chat\b/gi, "");
  s = s.replace(/\bType the name next\.?/gi, "Enter your character name.");
  s = s.replace(/\bType your character name\b/gi, "Enter your character name");
  s = s.replace(/\bType your character age\b/gi, "Enter your character age");
  s = s.replace(
    /\bType your character description\b/gi,
    "Write your character description"
  );
  s = s.replace(/\bType clue\b/gi, "Enter clue");
  s = s.replace(/\s{2,}/g, " ").trim();
  s = s.replace(/\s+([.!?])/g, "$1");
  return s;
}

export function parseStageCopy(stage: CatalogStage): StageCopy {
  const webMessages = Array.isArray(stage.web_messages)
    ? stage.web_messages
    : null;
  const messages =
    webMessages && webMessages.length > 0
      ? webMessages
      : Array.isArray(stage.messages)
        ? stage.messages
        : stage.message
          ? [String(stage.message)]
          : [];

  let title: string | null = null;
  const bodyLines: string[] = [];

  for (const raw of messages) {
    const { kind, text } = unwrapMinecraftLine(String(raw));
    if (isInGameOnlyLine(text)) continue;
    const cleaned = webifyPrompt(text);
    if (!cleaned) continue;
    if (kind === "title" && !title) {
      title = cleaned;
    } else {
      bodyLines.push(cleaned);
    }
  }

  return { title, bodyLines };
}

export function stageDisplayTitle(stage: CatalogStage): string {
  const copy = parseStageCopy(stage);
  if (copy.title) return copy.title;

  const type = String(stage.type || "").toLowerCase();
  const target = String(stage.target || "").toLowerCase();
  if (type === "setter" && target) {
    if (target === "real_age") return "Age verification";
    return target.charAt(0).toUpperCase() + target.slice(1);
  }
  if (type === "selection" && target === "class") return "Class";
  if (type === "selection" && target === "race") return "Race";
  if (type === "selection" && target === "trait") {
    const sid = String(stage.id || "").toLowerCase();
    if (sid.includes("permanent_injury")) return "Backstory Injuries";
    if (sid.includes("prosthetic")) return "Backstory Prosthetic";
    const key = String(stage.key || "Traits");
    return key.charAt(0).toUpperCase() + key.slice(1);
  }
  if (type === "attributes") return "Attributes";
  if (type === "clue") return "Clues";
  if (type === "summary") return "Summary";
  if (type === "info") return "Continue";
  return stage.id;
}

export function traitsForKey(
  catalog: CreationCatalog,
  key: string
): CatalogTrait[] {
  const k = key.trim().toLowerCase();
  return (catalog.traits || []).filter(
    (t) => String(t.key || "").trim().toLowerCase() === k
  );
}

export function traitsForStage(
  catalog: CreationCatalog,
  stage: CatalogStage
): CatalogTrait[] {
  const key = String(stage.key || "").trim();
  if (!key) return [];
  let list = traitsForKey(catalog, key);
  if (String(stage.filter || "").trim().toLowerCase() === "permanent-only") {
    list = list.filter((t) => !t.has_duration);
  }
  return list;
}

/** Normalize catalog description fields to display lines. */
export function optionDescriptionLines(row: {
  description?: string | string[] | unknown;
}): string[] {
  const raw = row.description;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((line) => String(line || "").trim())
      .filter(Boolean);
  }
  const s = String(raw).trim();
  return s ? [s] : [];
}

export function optionAttributeDescriptionLines(row: {
  attribute_description?: string | string[] | unknown;
}): string[] {
  const raw = row.attribute_description;
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((line) => String(line || "").trim())
      .filter(Boolean);
  }
  const s = String(raw).trim();
  return s ? [s] : [];
}

function asModifierList<T>(raw: unknown): T[] {
  return Array.isArray(raw) ? (raw as T[]) : [];
}

function rowAttributeMods(row: {
  attribute_modifiers?: AttributeModifierDto[] | unknown;
}): AttributeModifierDto[] {
  return asModifierList<AttributeModifierDto>(row.attribute_modifiers).filter(
    (m) => m && String(m.type || "").trim() && Number(m.amount) !== 0
  );
}

function rowExperienceMods(row: {
  experience_modifiers?: ExperienceModifierDto[] | unknown;
}): ExperienceModifierDto[] {
  return asModifierList<ExperienceModifierDto>(row.experience_modifiers).filter(
    (m) => m && String(m.profession || "").trim() && Number(m.amount) !== 0
  );
}

export type DraftModifierTotals = {
  attributes: Record<string, number>;
  experience: Record<string, { alias: string; amount: number }>;
};

function capitalizeLabel(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function findCatalogRow(
  catalog: CreationCatalog,
  id: string
):
  | { attribute_modifiers?: unknown; experience_modifiers?: unknown; name?: string }
  | undefined {
  const needle = id.trim().toLowerCase();
  if (!needle) return undefined;
  const race = (catalog.races || []).find(
    (r) => String(r.id || "").toLowerCase() === needle
  );
  if (race) return race;
  return (catalog.traits || []).find(
    (t) => String(t.id || "").toLowerCase() === needle
  );
}

/** Sum race + selected traits attr/XP mods (MC tempData merge idea). */
export function draftModifierTotals(
  draft: WizardDraft,
  catalog: CreationCatalog
): DraftModifierTotals {
  const attributes: Record<string, number> = {};
  const experience: Record<string, { alias: string; amount: number }> = {};

  const ids = [
    draft.race_id,
    ...draft.traitIds,
  ].filter(Boolean);

  for (const id of ids) {
    const row = findCatalogRow(catalog, id);
    if (!row) continue;
    for (const m of rowAttributeMods(row)) {
      const type = String(m.type).trim().toLowerCase();
      attributes[type] = (attributes[type] || 0) + Number(m.amount);
    }
    for (const m of rowExperienceMods(row)) {
      const profession = String(m.profession).trim().toLowerCase();
      const alias =
        String(m.alias || "").trim() || capitalizeLabel(profession);
      const prev = experience[profession];
      experience[profession] = {
        alias: prev?.alias || alias,
        amount: (prev?.amount || 0) + Number(m.amount),
      };
    }
  }

  return { attributes, experience };
}

export type ModifierPreviewLine = {
  label: string;
  current: number;
  delta: number;
  kind: "attribute" | "experience";
};

/**
 * Preview lines for option O: current from draft totals, delta from O's own mods.
 * When O is selected, totals already include O; when not, they exclude O.
 */
export function optionModifierPreview(
  totals: DraftModifierTotals,
  optionMods: {
    attribute_modifiers?: AttributeModifierDto[] | unknown;
    experience_modifiers?: ExperienceModifierDto[] | unknown;
  },
  catalog?: CreationCatalog
): ModifierPreviewLine[] {
  const attrMods = rowAttributeMods(optionMods);
  const xpMods = rowExperienceMods(optionMods);
  if (!attrMods.length && !xpMods.length) return [];

  const lines: ModifierPreviewLine[] = [];
  const attrKeys = new Set<string>();
  for (const a of catalog?.attribute_point_buy?.attributes || []) {
    const k = String(a || "").trim().toLowerCase();
    if (k) attrKeys.add(k);
  }
  for (const k of Object.keys(totals.attributes)) attrKeys.add(k);
  for (const m of attrMods) attrKeys.add(String(m.type).trim().toLowerCase());

  const deltaAttr: Record<string, number> = {};
  for (const m of attrMods) {
    const type = String(m.type).trim().toLowerCase();
    deltaAttr[type] = (deltaAttr[type] || 0) + Number(m.amount);
  }

  const orderedAttrs =
    (catalog?.attribute_point_buy?.attributes || [])
      .map((a) => String(a || "").trim().toLowerCase())
      .filter(Boolean);
  const attrOrder =
    orderedAttrs.length > 0
      ? [
          ...orderedAttrs,
          ...[...attrKeys].filter((k) => !orderedAttrs.includes(k)).sort(),
        ]
      : [...attrKeys].sort();

  for (const type of attrOrder) {
    if (!attrKeys.has(type)) continue;
    lines.push({
      label: capitalizeLabel(type),
      current: Math.max(0, totals.attributes[type] || 0),
      delta: deltaAttr[type] || 0,
      kind: "attribute",
    });
  }

  const deltaXp: Record<string, { alias: string; amount: number }> = {};
  for (const m of xpMods) {
    const profession = String(m.profession).trim().toLowerCase();
    const alias =
      String(m.alias || "").trim() || capitalizeLabel(profession);
    const prev = deltaXp[profession];
    deltaXp[profession] = {
      alias: prev?.alias || alias,
      amount: (prev?.amount || 0) + Number(m.amount),
    };
  }

  const xpKeys = new Set([
    ...Object.keys(totals.experience),
    ...Object.keys(deltaXp),
  ]);
  for (const profession of [...xpKeys].sort()) {
    const current = totals.experience[profession];
    const delta = deltaXp[profession];
    lines.push({
      label: capitalizeLabel(
        current?.alias || delta?.alias || profession
      ),
      current: Math.max(0, current?.amount || 0),
      delta: delta?.amount || 0,
      kind: "experience",
    });
  }

  return lines;
}

export function resolveTraitDependencyNames(
  trait: CatalogTrait,
  catalog: CreationCatalog
): { mode: string; names: string[] } | null {
  const dep = trait.dependency;
  if (!dep || typeof dep !== "object") return null;
  const ids = Array.isArray(dep.depends_on) ? dep.depends_on : [];
  if (!ids.length) return null;
  const mode = String(dep.mode || "").trim().toLowerCase();
  const names = ids.map((raw) => {
    const id = String(raw || "").trim();
    if (!id) return "";
    const row =
      findCatalogRow(catalog, id) ||
      (catalog.traits || []).find(
        (t) => String(t.id || "").toLowerCase() === id.toLowerCase()
      );
    const name = row && "name" in row ? String(row.name || "").trim() : "";
    return name || capitalizeLabel(id);
  }).filter(Boolean);
  if (!names.length) return null;
  return { mode, names };
}

export function resolveMutuallyExclusiveNames(
  trait: CatalogTrait,
  catalog: CreationCatalog
): string[] {
  const raw = trait.mutually_exclusive;
  if (!Array.isArray(raw) || !raw.length) return [];
  return raw
    .map((id) => {
      const key = String(id || "").trim();
      if (!key) return "";
      const row = findCatalogRow(catalog, key);
      const name = row && "name" in row ? String(row.name || "").trim() : "";
      return name || capitalizeLabel(key);
    })
    .filter(Boolean);
}

function exclusiveIdList(trait: CatalogTrait): string[] {
  const raw = trait.mutually_exclusive;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((id) => String(id || "").trim().toLowerCase())
    .filter(Boolean);
}

/** Bidirectional exclusivity (A lists B or B lists A). */
export function traitsAreExclusive(
  a: CatalogTrait,
  b: CatalogTrait
): boolean {
  const aId = String(a.id || "").trim().toLowerCase();
  const bId = String(b.id || "").trim().toLowerCase();
  if (!aId || !bId || aId === bId) return false;
  return (
    exclusiveIdList(a).includes(bId) || exclusiveIdList(b).includes(aId)
  );
}

/**
 * True when selecting `trait` would conflict with any id in `selectedIds`
 * (typically other selected traits; exclude `trait.id` yourself).
 */
export function traitExclusiveBlocked(
  trait: CatalogTrait,
  selectedIds: string[],
  catalog: CreationCatalog
): boolean {
  const byId = new Map(
    (catalog.traits || []).map((t) => [
      String(t.id || "").trim().toLowerCase(),
      t,
    ])
  );
  for (const raw of selectedIds) {
    const id = String(raw || "").trim().toLowerCase();
    if (!id || id === String(trait.id || "").trim().toLowerCase()) continue;
    const other = byId.get(id);
    if (other && traitsAreExclusive(trait, other)) return true;
  }
  return false;
}

export function traitPlaytimeBlocked(
  trait: CatalogTrait,
  accountAgeSeconds: number
): boolean {
  const hours = Number(trait.required_account_playtime_hours);
  if (!Number.isFinite(hours) || hours <= 0) return false;
  const age = Math.max(0, Number(accountAgeSeconds) || 0);
  return age < hours * 3600;
}

export function traitPlaytimeReason(trait: CatalogTrait): string | null {
  const hours = Number(trait.required_account_playtime_hours);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const label = hours === 1 ? "1 hour" : `${hours} hours`;
  return `Requires ${label} account age`;
}

export function traitCost(trait: CatalogTrait): number {
  const n = Number(trait.cost);
  return Number.isFinite(n) ? n : 0;
}

/** Net points spent for selected traits in a key (negative costs refund). */
export function traitPointsSpent(
  draft: WizardDraft,
  catalog: CreationCatalog,
  key: string
): number {
  const selected = new Set(selectedTraitsForKey(draft, catalog, key));
  let spent = 0;
  for (const t of traitsForKey(catalog, key)) {
    if (selected.has(t.id)) spent += traitCost(t);
  }
  return spent;
}

/** Remaining pool after current selections (can exceed stage budget via negative costs). */
export function traitPointsRemaining(
  draft: WizardDraft,
  catalog: CreationCatalog,
  key: string,
  budget: number
): number {
  return budget - traitPointsSpent(draft, catalog, key);
}

export function selectedTraitsForKey(
  draft: WizardDraft,
  catalog: CreationCatalog,
  key: string
): string[] {
  const allowed = new Set(traitsForKey(catalog, key).map((t) => t.id));
  return draft.traitIds.filter((id) => allowed.has(id));
}

/** Drop permanent injuries superseded by a selected prosthetic. */
export function stripInjuriesReplacedByProsthetics(
  traitIds: string[],
  catalog: CreationCatalog
): string[] {
  const injuriesToRemove = new Set<string>();
  for (const id of traitIds) {
    const trait = (catalog.traits || []).find(
      (t) =>
        String(t.id || "").toLowerCase() === String(id || "").toLowerCase()
    );
    if (!trait || String(trait.key || "").trim().toLowerCase() !== "prosthetic") {
      continue;
    }
    const replaces = String(trait.replaces_injury || "").trim().toLowerCase();
    if (replaces) {
      injuriesToRemove.add(replaces);
    }
  }
  if (injuriesToRemove.size === 0) {
    return traitIds;
  }
  return traitIds.filter(
    (id) => !injuriesToRemove.has(String(id || "").toLowerCase())
  );
}

export function setTraitsForKey(
  draft: WizardDraft,
  catalog: CreationCatalog,
  key: string,
  selected: string[]
): WizardDraft {
  const allowed = new Set(traitsForKey(catalog, key).map((t) => t.id));
  const kept = draft.traitIds.filter((id) => !allowed.has(id));
  const traitIds = stripInjuriesReplacedByProsthetics(
    [...kept, ...selected],
    catalog
  );
  return { ...draft, traitIds };
}

export function draftHasEvilTrait(
  draft: WizardDraft,
  catalog: CreationCatalog
): boolean {
  for (const id of draft.traitIds) {
    const trait = (catalog.traits || []).find(
      (t) => String(t.id || "").toLowerCase() === String(id || "").toLowerCase()
    );
    if (trait && String(trait.key || "").trim().toLowerCase() === "evil") {
      return true;
    }
  }
  return false;
}

/** Match RPCharacter.getCluesNeeded (default vs evil, capped by max). */
export function cluesRequired(
  draft: WizardDraft,
  catalog: CreationCatalog
): number {
  const cfg = catalog.validation?.clues || {};
  let needed = Number(cfg.default_required ?? 0);
  if (!Number.isFinite(needed) || needed < 0) needed = 0;
  if (draftHasEvilTrait(draft, catalog)) {
    const evil = Number(cfg.evil_required ?? 0);
    if (Number.isFinite(evil) && evil > needed) needed = evil;
  }
  const maxClues = Number(cfg.max_clues ?? 20);
  const cap = Number.isFinite(maxClues) && maxClues > 0 ? maxClues : 20;
  return Math.min(needed, cap);
}

export function filledClues(draft: WizardDraft): string[] {
  return draft.clues.map((c) => c.trim()).filter(Boolean);
}

function asBoundInt(raw: unknown, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.trunc(n);
}

export function clueLengthBounds(catalog: CreationCatalog): {
  minLen: number;
  maxLen: number;
  maxClues: number;
} {
  const cfg = catalog.validation?.clues || {};
  return {
    minLen: asBoundInt(cfg.min_length, 1),
    maxLen: asBoundInt(cfg.max_length, 48),
    maxClues: asBoundInt(cfg.max_clues, 20),
  };
}

/** Human-readable reason Next is blocked on the clue stage, or null if ok. */
export function clueContinueBlockReason(
  draft: WizardDraft,
  catalog: CreationCatalog
): string | null {
  const required = cluesRequired(draft, catalog);
  const { minLen, maxLen, maxClues } = clueLengthBounds(catalog);
  const clues = filledClues(draft);
  if (clues.length < required) {
    return `Enter at least ${required} clue${required === 1 ? "" : "s"} (${clues.length}/${required})`;
  }
  if (clues.length > maxClues) {
    return `At most ${maxClues} clues allowed`;
  }
  for (let i = 0; i < clues.length; i++) {
    const n = clues[i]!.length;
    if (n < minLen) {
      return `Clue ${i + 1} is too short (${n}/${minLen} min)`;
    }
    if (n > maxLen) {
      return `Clue ${i + 1} is too long (${n}/${maxLen} max)`;
    }
    const charset = proseError(clues[i], {
      minLen,
      maxLen,
      field: `clue ${i + 1}`,
    });
    if (charset) return charset;
  }
  return null;
}

export function stageCanContinue(
  stage: CatalogStage,
  draft: WizardDraft,
  catalog: CreationCatalog
): boolean {
  const type = String(stage.type || "").toLowerCase();
  const target = String(stage.target || "").toLowerCase();

  if (type === "info" || type === "summary" || type === "wardrobe") return true;

  if (type === "setter") {
    if (target === "real_age") {
      return draft.eighteen === true || draft.eighteen === false;
    }
    if (target === "name") {
      const min = catalog.validation?.name?.min_length ?? 1;
      const max = catalog.validation?.name?.max_length ?? 32;
      return isValidDisplayName(draft.name, {
        minLen: min,
        maxLen: max,
        field: "name",
      });
    }
    if (target === "age") {
      const age = Number(draft.age);
      const min = catalog.validation?.age?.minimum ?? 1;
      return Number.isFinite(age) && age >= min;
    }
    if (target === "description") {
      const min = catalog.validation?.description?.min_length ?? 1;
      const max = catalog.validation?.description?.max_length ?? 2000;
      if (
        !isValidProse(draft.description, {
          minLen: min,
          maxLen: max,
          field: "description",
        })
      ) {
        return false;
      }
      if (
        optionalDisplayNameError(draft.gender, {
          maxLen: 24,
          field: "gender",
        }) !== null
      ) {
        return false;
      }
      return true;
    }
    return true;
  }

  if (type === "selection") {
    if (target === "class") return Boolean(draft.class_id);
    if (target === "race") return Boolean(draft.race_id);
    if (target === "trait") {
      const key = String(stage.key || "").trim();
      if (!key) return true;
      const min = Number(stage.min_select ?? 0);
      const max = Number(stage.max_select ?? 99);
      const count = selectedTraitsForKey(draft, catalog, key).length;
      if (count < min || count > max) return false;
      const budget = Number(stage.points ?? 0);
      if (budget > 0) {
        const spent = traitPointsSpent(draft, catalog, key);
        if (spent > budget) return false;
      }
      return true;
    }
  }

  if (type === "attributes") {
    const apb = catalog.attribute_point_buy;
    if (!apb) return false;
    return isExactSpend(draft.attributes, apb);
  }

  if (type === "clue") {
    return clueContinueBlockReason(draft, catalog) === null;
  }

  return true;
}

export function toCreateBody(
  draft: WizardDraft,
  opts?: { nameColourStops?: number; catalog?: CreationCatalog }
): CreateCharacterBody {
  const clues = draft.clues.map((c) => c.trim()).filter(Boolean);
  const gender = draft.gender.trim() || "unspecified";
  const age = Number(draft.age);
  const traitIds = opts?.catalog
    ? stripInjuriesReplacedByProsthetics(draft.traitIds, opts.catalog)
    : [...draft.traitIds];
  const body: CreateCharacterBody = {
    client_request_id: draft.client_request_id,
    name: draft.name.trim(),
    age,
    description: draft.description.trim(),
    gender,
    race_id: draft.race_id,
    class_id: draft.class_id,
    attributes: { ...draft.attributes },
    traits: traitIds,
    clues,
  };
  const birthday =
    resolvedBirthdayIso(
      String(age),
      draft.client_request_id || "default",
      draft.birthday,
      undefined
    ) || birthdayFromAge(age, draft.client_request_id || "default");
  if (birthday) {
    body.birthday = birthday;
  }
  if (draft.eighteen === true || draft.eighteen === false) {
    body.eighteen = draft.eighteen;
  }
  const cap = Math.max(0, Math.min(8, Number(opts?.nameColourStops) || 0));
  if (cap > 0 && draft.name_colours.length > 0) {
    body.name_colours = draft.name_colours.slice(0, cap);
  }
  return body;
}
