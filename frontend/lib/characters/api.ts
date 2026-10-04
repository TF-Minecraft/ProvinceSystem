import { getApiBase, detailMessage, parseJson, authHeaders } from "../site/api";

export class CharactersApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CharactersApiError";
    this.status = status;
  }
}

async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error("Request failed. Please try again.");
  }
}

export type RedeemResult = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  scope?: string;
  realm_id?: string;
  remember_me?: boolean;
};

export async function redeemProfile(
  code: string,
  rememberMe = false
): Promise<RedeemResult> {
  const res = await apiFetch(`${getApiBase()}/skins/profile/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: code.trim(),
      remember_me: rememberMe,
    }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Redeem failed (${res.status})`),
      res.status
    );
  }
  const body = data as Partial<RedeemResult>;
  if (!body.session_token || !body.player_uuid || !body.expires_at) {
    throw new CharactersApiError("Invalid redeem response from API", res.status);
  }
  return {
    session_token: body.session_token,
    player_uuid: body.player_uuid,
    expires_at: body.expires_at,
    scope: typeof body.scope === "string" ? body.scope : "profile",
    ...(typeof body.realm_id === "string" && body.realm_id.trim()
      ? { realm_id: body.realm_id.trim().toLowerCase() }
      : {}),
    remember_me: body.remember_me === true || rememberMe,
  };
}

export async function logoutCharacter(sessionToken: string): Promise<void> {
  const res = await apiFetch(`${getApiBase()}/characters/logout`, {
    method: "POST",
    headers: authHeaders(sessionToken),
  });
  if (!res.ok && res.status !== 401) {
    const data = await parseJson(res);
    throw new CharactersApiError(
      detailMessage(data, `Logout failed (${res.status})`),
      res.status
    );
  }
}

export type EditableKitPreview = {
  display_name: string;
  lore: string[];
  material: string;
  custom_model_data?: number;
};

export type EditableKitRow = {
  kit_key: string;
  path: string;
  amount: number;
  skin_png: string;
  skin_png_signed?: string;
  base_set: string;
  kit_id?: string;
  preview?: EditableKitPreview;
};

export type CatalogKitItem = {
  path: string;
  amount: number;
  editable?: boolean;
  display_name?: string;
};

export type CatalogKit = {
  id: string;
  display_name: string;
  cooldown_hours: number;
  once_per_character: boolean;
  items: CatalogKitItem[];
};

export type CreationCatalog = {
  stages: CatalogStage[];
  attribute_point_buy: AttributePointBuy | null;
  races: CatalogIdRow[];
  traits: CatalogTrait[];
  classes: CatalogIdRow[];
  validation: CatalogValidation;
  slot_limits: SlotLimits;
  editable_kit?: EditableKitRow[];
  kits?: CatalogKit[];
  updated_at: string | null;
};

export type CatalogStage = {
  id: string;
  type: string;
  order?: number;
  target?: string;
  key?: string;
  filter?: string;
  min_select?: number;
  max_select?: number;
  points?: number;
  max_rank?: number;
  messages?: string[];
  /** Website-specific info copy; preferred over messages when present. */
  web_messages?: string[];
  message?: string;
  entries?: unknown;
  require_account_age_hours_min?: number;
  require_account_age_hours_max?: number;
  /** both (default) | web | game — creation client filter */
  platform?: "both" | "web" | "game" | string;
  dependency?: {
    type?: string;
    mode?: string;
    depends_on?: string[];
  };
  [key: string]: unknown;
};

export type AttributePointBuy = {
  pool: number;
  max_rank: number;
  cost_for_rank: number[];
  attributes: string[];
  abbreviations?: Record<string, string>;
  trait_id_pattern?: string;
};

export type AttributeModifierDto = {
  type: string;
  amount: number;
};

export type ExperienceModifierDto = {
  profession: string;
  alias: string;
  amount: number;
};

export type CatalogIdRow = {
  id: string;
  name?: string;
  description?: string | string[];
  age_max?: number;
  attribute_modifiers?: AttributeModifierDto[];
  experience_modifiers?: ExperienceModifierDto[];
  attribute_description?: string[];
  [key: string]: unknown;
};

export type CatalogTrait = {
  id: string;
  name?: string;
  key?: string;
  description?: string | string[];
  cost?: number;
  attribute_modifiers?: AttributeModifierDto[];
  experience_modifiers?: ExperienceModifierDto[];
  mutually_exclusive?: string[];
  dependency?: {
    type?: string;
    mode?: string;
    depends_on?: string[];
  };
  required_account_playtime_hours?: number;
  has_duration?: boolean;
  fuel_disclaimer?: boolean;
  icon?: string;
  replaces_injury?: string;
  [key: string]: unknown;
};

export type CatalogValidation = {
  name?: { min_length?: number; max_length?: number };
  age?: { minimum?: number };
  calendar?: { year_offset?: number; era_suffix?: string };
  description?: { min_length?: number; max_length?: number };
  clues?: {
    default_required?: number;
    evil_required?: number;
    evil_min_account_age_hours?: number;
    min_length?: number;
    max_length?: number;
    max_clues?: number;
  };
};

export type SlotLimits = {
  hard_cap?: number;
  defaults?: {
    max_alive_characters?: number;
    name_colour_stops?: number;
    wardrobe_skin_slots?: number;
  };
  groups?: Array<{
    id?: string;
    permission?: string;
    display_name?: string;
    tier?: number;
    visible?: boolean;
    max_alive_characters?: number;
    name_colour_stops?: number;
    wardrobe_skin_slots?: number;
    [key: string]: unknown;
  }>;
};

export async function getCreationCatalog(
  sessionToken: string
): Promise<CreationCatalog> {
  const res = await apiFetch(`${getApiBase()}/characters/creation-catalog`, {
    headers: authHeaders(sessionToken),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Catalog failed (${res.status})`),
      res.status
    );
  }
  return data as CreationCatalog;
}

export type CharacterSheetTrait = {
  id: string;
  name: string;
  key?: string;
  duration_remaining_ms?: number;
  fuel_percent?: number;
};

export type CharacterListItem = {
  id: string;
  name: string;
  status: string;
  race?: string | null;
  class?: string | null;
  created_at?: string | null;
  source?: string;
  create_id?: string;
  /** Present when status is rejected (e.g. no free character slot). */
  error?: string | null;
  /** Starter kit status: eligible | granted | ineligible, synced from RPC. */
  kit_status?: string | null;
  /** Per-kit status map from roster sync. */
  kit_statuses?: Record<string, string> | null;
  /** Display name from roster sheet sync (prefer over race id). */
  race_name?: string | null;
  class_name?: string | null;
  age?: string | null;
  birthday?: string | null;
  gender?: string | null;
  description?: string | null;
  /** Writable-book trait lore (background-trait-types), stripped. */
  background?: string | null;
  attributes?: Record<string, number> | null;
  experience_modifiers?: ExperienceModifierDto[] | null;
  traits?: CharacterSheetTrait[] | null;
  clues?: string[] | null;
};

export type CharacterListResponse = {
  characters: CharacterListItem[];
  player_uuid: string;
  max_alive_characters?: number;
  alive_count?: number;
  /** Player already answered the 18+ attestation (Yes or No). */
  real_age_set?: boolean;
  eighteen?: boolean;
  /** Wall-clock seconds since Minecraft account created_at. */
  account_age_seconds?: number;
  /** True when account age meets evil_min_account_age_hours. */
  evil_unlocked?: boolean;
  /** Rank perk: max name colour stops (0 = locked). */
  name_colour_stops?: number;
  /** Swappable wardrobe skins (1–3). */
  wardrobe_skin_slots?: number;
  /** Snapshot seconds remaining until next kit grant is allowed. */
  kit_cooldown_seconds_remaining?: number;
  /** Config echo of kit cooldown length in hours. */
  kit_cooldown_hours?: number;
  kit_cooldowns?: Record<
    string,
    { seconds_remaining?: number; hours?: number }
  > | null;
  web_creator_allowed?: boolean;
  web_creator_min_tier?: number;
  web_creator_min_group_id?: string;
  web_creator_min_group_display?: string;
  donator_tier?: number;
};

export async function listCharacters(
  sessionToken: string
): Promise<CharacterListResponse> {
  const res = await apiFetch(`${getApiBase()}/characters`, {
    headers: authHeaders(sessionToken),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `List failed (${res.status})`),
      res.status
    );
  }
  const body = data as CharacterListResponse;
  return {
    characters: Array.isArray(body.characters) ? body.characters : [],
    player_uuid: body.player_uuid || "",
    max_alive_characters:
      typeof body.max_alive_characters === "number"
        ? body.max_alive_characters
        : undefined,
    alive_count:
      typeof body.alive_count === "number" ? body.alive_count : undefined,
    real_age_set: Boolean(body.real_age_set),
    eighteen:
      typeof body.eighteen === "boolean" ? body.eighteen : undefined,
    account_age_seconds:
      typeof body.account_age_seconds === "number"
        ? body.account_age_seconds
        : undefined,
    evil_unlocked:
      typeof body.evil_unlocked === "boolean" ? body.evil_unlocked : undefined,
    name_colour_stops:
      typeof body.name_colour_stops === "number"
        ? Math.max(0, body.name_colour_stops)
        : 0,
    wardrobe_skin_slots: Math.max(
      1,
      Math.min(
        3,
        typeof body.wardrobe_skin_slots === "number"
          ? body.wardrobe_skin_slots
          : 1
      )
    ),
    kit_cooldown_seconds_remaining:
      typeof body.kit_cooldown_seconds_remaining === "number"
        ? Math.max(0, body.kit_cooldown_seconds_remaining)
        : 0,
    kit_cooldown_hours:
      typeof body.kit_cooldown_hours === "number"
        ? Math.max(0, body.kit_cooldown_hours)
        : undefined,
    web_creator_allowed:
      typeof body.web_creator_allowed === "boolean"
        ? body.web_creator_allowed
        : true,
    web_creator_min_tier:
      typeof body.web_creator_min_tier === "number"
        ? body.web_creator_min_tier
        : 0,
    web_creator_min_group_id:
      typeof body.web_creator_min_group_id === "string"
        ? body.web_creator_min_group_id
        : "",
    web_creator_min_group_display:
      typeof body.web_creator_min_group_display === "string"
        ? body.web_creator_min_group_display
        : "",
    donator_tier:
      typeof body.donator_tier === "number" ? Math.max(0, body.donator_tier) : 0,
  };
}

export type CreateCharacterBody = {
  client_request_id?: string;
  name: string;
  age: number;
  /** Fantasy ISO birthday (YYYY-MM-DD); salted from client_request_id + age. */
  birthday?: string;
  /** Real-life 18+ attestation from creation_age_set_stage. */
  eighteen?: boolean;
  description: string;
  gender: string;
  race_id: string;
  class_id: string;
  attributes: Record<string, number>;
  traits: string[];
  clues: string[];
  /** Persona name colours (separate from name string). */
  name_colours?: string[];
};

export type CreateCharacterResult = {
  ok: boolean;
  id: string;
  status: string;
  client_request_id?: string | null;
  created_at?: string;
};

export async function createCharacter(
  sessionToken: string,
  body: CreateCharacterBody
): Promise<CreateCharacterResult> {
  const res = await apiFetch(`${getApiBase()}/characters`, {
    method: "POST",
    headers: {
      ...authHeaders(sessionToken),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Create failed (${res.status})`),
      res.status
    );
  }
  return data as CreateCharacterResult;
}

export function maxAliveSlots(slotLimits: SlotLimits | undefined): number {
  const hard = Number(slotLimits?.hard_cap ?? 10) || 10;
  const soft = Number(slotLimits?.defaults?.max_alive_characters ?? 3) || 3;
  return Math.min(soft, hard);
}

export type LoreItemPreview = {
  display_name: string;
  lore: string[];
  material: string;
  custom_model_data?: number;
};

export type LoreItemDraft = {
  display_name: string;
  lore: string[];
  existing_skin_id: string | null;
  submission_id: string | null;
  submission_status: string | null;
  deny_reason?: string | null;
  state?: string;
  skin_slug?: string | null;
  name_colours?: string[] | null;
  name_styles?: string[] | null;
  ia_namespace?: string | null;
};

export type LoreItemPickableSkin = {
  id: string;
  display_name: string;
  kind: string;
  ia_namespace?: string;
  staff?: boolean;
};

export type LoreItemRow = {
  kit_key: string;
  path: string;
  skin_png: string;
  skin_png_signed?: string;
  base_set: string;
  /** Flat upload skin kind from kits.yml (e.g. handheld). */
  "2d_template"?: string;
  /** Optional 3D kind; absent/null = no 3D upload. */
  "3d_template"?: string | null;
  eligible: boolean;
  base_preview: LoreItemPreview;
  preview: LoreItemPreview;
  draft: LoreItemDraft;
  pickable_skins: LoreItemPickableSkin[];
  state?: string;
  skin_slug?: string | null;
};

export type LoreItemsResponse = {
  character_id: string;
  items: LoreItemRow[];
};

export type CharacterKitItem = {
  path: string;
  amount: number;
  editable: boolean;
  display_name?: string;
  kit_key?: string;
  preview?: EditableKitPreview;
  skin_png?: string;
  skin_png_signed?: string;
  base_set?: string;
  customise?: LoreItemDraft;
};

export type CharacterKit = {
  id: string;
  display_name: string;
  cooldown_hours: number;
  once_per_character: boolean;
  status: string;
  claimable: boolean;
  cooldown?: { seconds_remaining: number; hours: number } | null;
  items: CharacterKitItem[];
};

export type CharacterKitsResponse = {
  character_id: string;
  kits: CharacterKit[];
};

export async function listCharacterKits(
  sessionToken: string,
  characterId: string
): Promise<CharacterKitsResponse> {
  const cid = encodeURIComponent(characterId.trim());
  const res = await apiFetch(
    `${getApiBase()}/characters/kits?character_id=${cid}`,
    { headers: authHeaders(sessionToken) }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Kits failed (${res.status})`),
      res.status
    );
  }
  const body = data as CharacterKitsResponse;
  return {
    character_id: String(body.character_id || characterId),
    kits: Array.isArray(body.kits) ? body.kits : [],
  };
}

export type CustomiseLoreItemInput = {
  displayName: string;
  lore: string[];
  existingSkinId?: string | null;
  /** When set, sends multipart; do not also set existingSkinId. */
  textureFile?: File | null;
  /** Book kind: unsigned + signed covers (multipart). */
  unsignedFile?: File | null;
  signedFile?: File | null;
  modelFile?: File | null;
  use3d?: boolean;
  nameColours?: string[];
  nameStyles?: string[];
};

export type CustomiseLoreItemResult = LoreItemRow & { ok: boolean };

export function loreItemSkinTextureUrl(
  submissionId: string,
  baseSet?: string,
  variant?: "unsigned" | "signed"
): string {
  const id = encodeURIComponent(submissionId.trim());
  const params = new URLSearchParams();
  if (baseSet?.trim()) {
    params.set("base_set", baseSet.trim());
  }
  if (variant === "signed") {
    params.set("variant", "signed");
  }
  const qs = params.toString();
  return `${getApiBase()}/characters/lore-items/skins/${id}/texture${qs ? `?${qs}` : ""}`;
}

export function loreItemSkinModelUrl(
  submissionId: string,
  baseSet?: string
): string {
  const id = encodeURIComponent(submissionId.trim());
  const params = new URLSearchParams();
  if (baseSet?.trim()) {
    params.set("base_set", baseSet.trim());
  }
  const qs = params.toString();
  return `${getApiBase()}/characters/lore-items/skins/${id}/model${qs ? `?${qs}` : ""}`;
}

export function loreItemDefaultTextureUrl(
  kitKey: string,
  variant?: "unsigned" | "signed"
): string {
  const key = encodeURIComponent(kitKey.trim());
  const qs =
    variant === "signed" ? "?variant=signed" : "";
  return `${getApiBase()}/characters/lore-items/${key}/default-texture${qs}`;
}

export async function listLoreItems(
  sessionToken: string,
  characterId: string,
  kitId = "starter"
): Promise<LoreItemsResponse> {
  const cid = encodeURIComponent(characterId.trim());
  const kid = encodeURIComponent(kitId.trim() || "starter");
  const res = await apiFetch(
    `${getApiBase()}/characters/lore-items?character_id=${cid}&kit_id=${kid}`,
    { headers: authHeaders(sessionToken) }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Lore items failed (${res.status})`),
      res.status
    );
  }
  const body = data as LoreItemsResponse;
  return {
    character_id: String(body.character_id || characterId),
    items: Array.isArray(body.items) ? body.items : [],
  };
}

export async function customiseLoreItem(
  sessionToken: string,
  characterId: string,
  kitKey: string,
  input: CustomiseLoreItemInput,
  kitId = "starter"
): Promise<CustomiseLoreItemResult> {
  const cid = encodeURIComponent(characterId.trim());
  const key = encodeURIComponent(kitKey.trim());
  const kid = encodeURIComponent(kitId.trim() || "starter");
  const url = `${getApiBase()}/characters/lore-items/${key}/customise?character_id=${cid}&kit_id=${kid}`;
  const needsMultipart = Boolean(
    input.textureFile ||
      input.modelFile ||
      input.unsignedFile ||
      input.signedFile
  );

  let res: Response;
  if (needsMultipart) {
    const form = new FormData();
    form.append("display_name", input.displayName);
    form.append("lore", JSON.stringify(input.lore));
    if (input.nameColours?.length) {
      form.append("name_colours", JSON.stringify(input.nameColours));
    }
    if (input.nameStyles?.length) {
      form.append("name_styles", JSON.stringify(input.nameStyles));
    }
    if (input.use3d) {
      form.append("use_3d", "true");
    }
    if (input.textureFile) {
      form.append("texture", input.textureFile);
    }
    if (input.unsignedFile) {
      form.append("unsigned", input.unsignedFile);
    }
    if (input.signedFile) {
      form.append("signed", input.signedFile);
    }
    if (input.modelFile) {
      form.append("model", input.modelFile);
    }
    if (input.existingSkinId) {
      form.append("existing_skin_id", input.existingSkinId);
    }
    const uploadHeaders: HeadersInit = {
      ...authHeaders(sessionToken),
    };
    res = await apiFetch(url, {
      method: "POST",
      headers: uploadHeaders,
      body: form,
    });
  } else {
    const body: Record<string, unknown> = {
      display_name: input.displayName,
      lore: input.lore,
    };
    if (input.existingSkinId !== undefined) {
      body.existing_skin_id = input.existingSkinId;
    }
    if (input.nameColours?.length) {
      body.name_colours = input.nameColours;
    }
    if (input.nameStyles?.length) {
      body.name_styles = input.nameStyles;
    }
    res = await apiFetch(url, {
      method: "POST",
      headers: {
        ...authHeaders(sessionToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Customise failed (${res.status})`),
      res.status
    );
  }
  return data as CustomiseLoreItemResult;
}

export type DeleteLoreItemCustomiseResult = {
  ok: boolean;
  character_id: string;
  kit_id: string;
  kit_key: string;
  deleted: number;
};

export async function deleteLoreItemCustomise(
  sessionToken: string,
  characterId: string,
  kitKey: string,
  kitId = "starter"
): Promise<DeleteLoreItemCustomiseResult> {
  const cid = encodeURIComponent(characterId.trim());
  const key = encodeURIComponent(kitKey.trim());
  const kid = encodeURIComponent(kitId.trim() || "starter");
  const res = await apiFetch(
    `${getApiBase()}/characters/lore-items/${key}/customise?character_id=${cid}&kit_id=${kid}`,
    {
      method: "DELETE",
      headers: authHeaders(sessionToken),
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Delete customise failed (${res.status})`),
      res.status
    );
  }
  return data as DeleteLoreItemCustomiseResult;
}

/* --- Character skin wardrobe (Phase 4) --- */

export type WardrobeSlotId = "base" | "extra_1" | "extra_2" | "masked";

export type WardrobeSlot = {
  slot: WardrobeSlotId | string;
  unlocked: boolean;
  filled: boolean;
  model?: string | null;
  display_name?: string | null;
  custom_name?: boolean;
  apply_pending?: boolean;
  has_signature?: boolean;
  signed?: boolean;
  /** Used to bust browser cache on texture preview fetches. */
  updated_at?: string | number | null;
  texture_url?: string | null;
};

export type WardrobeResponse = {
  character_id: string;
  active_slot: WardrobeSlotId | string | null;
  swappable_slots: number;
  slots: WardrobeSlot[];
  uploaded_slot?: string;
  signed?: boolean;
};

export const WARDROBE_DEFAULT_LABELS: Record<string, string> = {
  base: "Base",
  extra_1: "Skin 2",
  extra_2: "Skin 3",
  masked: "Masked",
};

export function wardrobeSlotLabel(
  slot: string,
  displayName?: string | null
): string {
  const custom = String(displayName || "").trim();
  if (custom) return custom;
  return WARDROBE_DEFAULT_LABELS[slot] || slot;
}

export async function getWardrobe(
  sessionToken: string,
  characterId: string
): Promise<WardrobeResponse> {
  const id = encodeURIComponent(characterId.trim());
  const res = await apiFetch(`${getApiBase()}/characters/${id}/wardrobe`, {
    headers: authHeaders(sessionToken),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Wardrobe failed (${res.status})`),
      res.status
    );
  }
  const body = data as WardrobeResponse;
  return {
    character_id: String(body.character_id || characterId),
    active_slot: body.active_slot ?? null,
    swappable_slots: Math.max(1, Number(body.swappable_slots) || 1),
    slots: Array.isArray(body.slots) ? body.slots : [],
  };
}

export async function uploadWardrobeSlot(
  sessionToken: string,
  characterId: string,
  slot: string,
  file: File,
  displayName?: string | null,
  opts?: { createMasked?: boolean; model?: "classic" | "slim" }
): Promise<WardrobeResponse> {
  const id = encodeURIComponent(characterId.trim());
  const s = encodeURIComponent(slot.trim());
  const form = new FormData();
  form.append("texture", file, file.name || "skin.png");
  if (displayName !== undefined) {
    form.append("display_name", displayName == null ? "" : String(displayName));
  }
  if (opts?.createMasked) {
    form.append("create_masked", "true");
  }
  if (opts?.model) {
    form.append("model", opts.model);
  }
  const res = await apiFetch(
    `${getApiBase()}/characters/${id}/wardrobe/${s}`,
    {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: form,
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Upload failed (${res.status})`),
      res.status
    );
  }
  return data as WardrobeResponse;
}

export async function renameWardrobeSlot(
  sessionToken: string,
  characterId: string,
  slot: string,
  displayName: string | null
): Promise<WardrobeResponse> {
  const id = encodeURIComponent(characterId.trim());
  const s = encodeURIComponent(slot.trim());
  const res = await apiFetch(
    `${getApiBase()}/characters/${id}/wardrobe/${s}/name`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(sessionToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ display_name: displayName }),
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Rename failed (${res.status})`),
      res.status
    );
  }
  return data as WardrobeResponse;
}

export async function clearWardrobeSlot(
  sessionToken: string,
  characterId: string,
  slot: string
): Promise<WardrobeResponse> {
  const id = encodeURIComponent(characterId.trim());
  const s = encodeURIComponent(slot.trim());
  const res = await apiFetch(
    `${getApiBase()}/characters/${id}/wardrobe/${s}`,
    {
      method: "DELETE",
      headers: authHeaders(sessionToken),
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Clear slot failed (${res.status})`),
      res.status
    );
  }
  return data as WardrobeResponse;
}

export async function setWardrobeActive(
  sessionToken: string,
  characterId: string,
  slot: string | null
): Promise<WardrobeResponse> {
  const id = encodeURIComponent(characterId.trim());
  const res = await apiFetch(
    `${getApiBase()}/characters/${id}/wardrobe/active`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(sessionToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slot }),
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Set active failed (${res.status})`),
      res.status
    );
  }
  return data as WardrobeResponse;
}

export async function uploadPendingCreateWardrobe(
  sessionToken: string,
  createId: string,
  slot: string,
  file: File,
  displayName?: string | null,
  opts?: { createMasked?: boolean; model?: "classic" | "slim" }
): Promise<{ ok: boolean; create_id: string; slot: string; signed?: boolean }> {
  const cid = encodeURIComponent(createId.trim());
  const s = encodeURIComponent(slot.trim());
  const form = new FormData();
  form.append("texture", file, file.name || "skin.png");
  if (displayName !== undefined) {
    form.append("display_name", displayName == null ? "" : String(displayName));
  }
  if (opts?.createMasked) {
    form.append("create_masked", "true");
  }
  if (opts?.model) {
    form.append("model", opts.model);
  }
  const res = await apiFetch(
    `${getApiBase()}/characters/creates/${cid}/wardrobe/${s}`,
    {
      method: "POST",
      headers: authHeaders(sessionToken),
      body: form,
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Pending wardrobe upload failed (${res.status})`),
      res.status
    );
  }
  return data as {
    ok: boolean;
    create_id: string;
    slot: string;
    signed?: boolean;
  };
}

/** Fetch synced masked body template as a Blob (for client compose preview). */
export async function fetchMaskedTemplateBlob(
  sessionToken: string
): Promise<Blob> {
  const res = await apiFetch(
    `${getApiBase()}/characters/wardrobe-template/masked`,
    { headers: authHeaders(sessionToken) }
  );
  if (!res.ok) {
    const data = await parseJson(res);
    throw new CharactersApiError(
      detailMessage(data, `Masked template failed (${res.status})`),
      res.status
    );
  }
  return res.blob();
}

export async function deletePendingCreate(
  sessionToken: string,
  createId: string
): Promise<{ ok: boolean; deleted: string }> {
  const cid = encodeURIComponent(createId.trim());
  const res = await apiFetch(`${getApiBase()}/characters/creates/${cid}`, {
    method: "DELETE",
    headers: authHeaders(sessionToken),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new CharactersApiError(
      detailMessage(data, `Cancel submission failed (${res.status})`),
      res.status
    );
  }
  return data as { ok: boolean; deleted: string };
}

export async function fetchWardrobeTextureBlob(
  sessionToken: string,
  characterId: string,
  slot: string,
  /** Optional bust token (e.g. slot updated_at); defaults to now. */
  cacheBust?: string | number | null
): Promise<string> {
  const id = encodeURIComponent(characterId.trim());
  const s = encodeURIComponent(slot.trim());
  const bust = encodeURIComponent(
    String(cacheBust != null && cacheBust !== "" ? cacheBust : Date.now())
  );
  const res = await apiFetch(
    `${getApiBase()}/characters/${id}/wardrobe/${s}/texture?v=${bust}`,
    { headers: authHeaders(sessionToken), cache: "no-store" }
  );
  if (!res.ok) {
    const data = await parseJson(res);
    throw new CharactersApiError(
      detailMessage(data, `Texture failed (${res.status})`),
      res.status
    );
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
