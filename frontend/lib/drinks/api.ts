import { getApiBase, detailMessage, parseJson } from "../site/api";

export class DrinksApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "DrinksApiError";
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

export type DrinkRedeemResult = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  code_id: number;
  scope?: string;
  realm_id?: string;
  allow_drink_texture?: boolean;
  allow_drink_message?: boolean;
  name_colour_stops?: number;
};

/** Fresh web entitlements from GET /characters/player-meta. */
export type PlayerMeta = {
  name_colour_stops: number;
  allow_drink_texture: boolean;
  allow_drink_message: boolean;
  max_alive_characters: number | null;
  wardrobe_skin_slots: number;
  max_3d_pair_bytes: number;
  skin_token_cooldown_days: number;
  skin_kinds: string[];
  allow_armor_3d_helmet: boolean;
  permission_flags: Record<string, boolean>;
  meta_synced: boolean;
};

export async function getPlayerMeta(sessionToken: string): Promise<PlayerMeta> {
  const res = await apiFetch(`${getApiBase()}/characters/player-meta`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Player meta failed (${res.status})`),
      res.status
    );
  }
  const body = (data || {}) as Record<string, unknown>;
  const stops = Number(body.name_colour_stops);
  const pair = Number(body.max_3d_pair_bytes);
  const cooldown = Number(body.skin_token_cooldown_days);
  const wardrobe = Number(body.wardrobe_skin_slots);
  const maxAliveRaw = body.max_alive_characters;
  let maxAlive: number | null = null;
  if (maxAliveRaw !== null && maxAliveRaw !== undefined) {
    const n = Number(maxAliveRaw);
    if (Number.isFinite(n) && n >= 1) maxAlive = Math.floor(n);
  }
  const kinds: string[] = [];
  if (Array.isArray(body.skin_kinds)) {
    const seen = new Set<string>();
    for (const item of body.skin_kinds) {
      const kind = String(item || "")
        .trim()
        .toLowerCase();
      if (!kind || seen.has(kind)) continue;
      seen.add(kind);
      kinds.push(kind);
    }
  }
  const flags: Record<string, boolean> = {};
  if (body.permission_flags && typeof body.permission_flags === "object") {
    for (const [k, v] of Object.entries(
      body.permission_flags as Record<string, unknown>
    )) {
      if (!k.trim()) continue;
      flags[k] = v === true;
    }
  }
  return {
    name_colour_stops:
      Number.isFinite(stops) && stops >= 0 ? Math.floor(stops) : 0,
    allow_drink_texture: body.allow_drink_texture === true,
    allow_drink_message: body.allow_drink_message === true,
    max_alive_characters: maxAlive,
    wardrobe_skin_slots:
      Number.isFinite(wardrobe) && wardrobe >= 1 ? Math.floor(wardrobe) : 1,
    max_3d_pair_bytes:
      Number.isFinite(pair) && pair >= 0 ? Math.floor(pair) : 0,
    skin_token_cooldown_days:
      Number.isFinite(cooldown) && cooldown >= -1 ? Math.floor(cooldown) : -1,
    skin_kinds: kinds,
    allow_armor_3d_helmet: body.allow_armor_3d_helmet === true,
    permission_flags: flags,
    meta_synced: body.meta_synced !== false,
  };
}

export type DrinkIngredient = {
  id: string;
  brewery_token?: string;
  label?: string;
  category?: string;
  type?: string | null;
};

export type DrinkCatalog = {
  ingredients: DrinkIngredient[];
  categories: Record<string, string>;
  effects_blacklist: string[];
  version: number;
};

export type DrinkTexture = {
  id: string;
  cmd: number | null;
  ia_item_id: string | null;
  refcount: number;
  created_at: string;
  applied: boolean;
};

export type DrinkSubmissionPublic = {
  id: string;
  player_uuid: string;
  code_id: number;
  slug: string;
  display_name: string;
  recipe: Record<string, unknown>;
  status: string;
  deny_reason: string | null;
  texture_id: string | null;
  new_texture: boolean;
  discord_user_id: string | null;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
};

export type DrinkLoreLine = {
  text: string;
  colours?: string[];
};

export type DrinkRecipeInput = {
  name: string;
  names?: string[] | string;
  name_colours?: string[];
  name_bad_colours?: string[];
  name_good_colours?: string[];
  ingredients: Array<{ id: string; amount: number }>;
  cooking_time?: number;
  distill_runs?: number;
  distill_time?: number;
  wood?: string | number | null;
  age?: number;
  difficulty?: number;
  alcohol?: number;
  effects?: Array<string | { type: string; level?: number; duration?: number }>;
  color?: string | null;
  lore?: Array<string | DrinkLoreLine>;
  drink_message?: string | null;
  drink_title?: string | null;
  drink_message_colours?: string[];
  drink_title_colours?: string[];
  glint?: boolean;
};

export async function redeemDrink(code: string): Promise<DrinkRedeemResult> {
  const res = await apiFetch(`${getApiBase()}/drinks/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Redeem failed (${res.status})`),
      res.status
    );
  }
  const body = data as Partial<DrinkRedeemResult>;
  if (!body.session_token || !body.player_uuid || !body.expires_at) {
    throw new DrinksApiError("Invalid redeem response from API", res.status);
  }
  return {
    session_token: body.session_token,
    player_uuid: body.player_uuid,
    expires_at: body.expires_at,
    code_id: Number(body.code_id),
    ...(typeof body.scope === "string" ? { scope: body.scope } : {}),
    ...(typeof body.realm_id === "string" && body.realm_id.trim()
      ? { realm_id: body.realm_id.trim().toLowerCase() }
      : {}),
    ...(typeof body.allow_drink_texture === "boolean"
      ? { allow_drink_texture: body.allow_drink_texture }
      : {}),
    ...(typeof body.allow_drink_message === "boolean"
      ? { allow_drink_message: body.allow_drink_message }
      : {}),
    ...(typeof body.name_colour_stops === "number"
      ? { name_colour_stops: Math.max(0, Math.floor(body.name_colour_stops)) }
      : {}),
  };
}

export async function getCatalog(): Promise<DrinkCatalog> {
  const res = await apiFetch(`${getApiBase()}/drinks/catalog`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Catalog failed (${res.status})`),
      res.status
    );
  }
  const body = data as { catalog?: Partial<DrinkCatalog> };
  const catalog = body.catalog || {};
  const categoriesRaw = catalog.categories;
  const categories: Record<string, string> = {};
  if (categoriesRaw && typeof categoriesRaw === "object") {
    for (const [key, label] of Object.entries(categoriesRaw)) {
      const id = String(key || "").trim().toLowerCase();
      if (!id) continue;
      categories[id] = String(label || id).trim() || id;
    }
  }
  return {
    ingredients: Array.isArray(catalog.ingredients) ? catalog.ingredients : [],
    categories,
    effects_blacklist: Array.isArray(catalog.effects_blacklist)
      ? catalog.effects_blacklist.map((e) => String(e).toLowerCase())
      : [],
    version: Number(catalog.version) || 0,
  };
}

export async function getTextures(
  sessionToken: string
): Promise<DrinkTexture[]> {
  const res = await apiFetch(`${getApiBase()}/drinks/textures`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Textures failed (${res.status})`),
      res.status
    );
  }
  const body = data as { textures?: DrinkTexture[] };
  const list = Array.isArray(body.textures) ? body.textures : [];
  // Belt-and-suspenders: API returns applied-only; still filter client-side.
  return list.filter(
    (t) => t && t.applied !== false && t.cmd != null && Number(t.cmd) > 0
  );
}

export async function createSubmission(input: {
  sessionToken: string;
  recipe: DrinkRecipeInput;
  texture?: File | null;
  existingTextureId?: string | null;
}): Promise<DrinkSubmissionPublic> {
  const form = new FormData();
  form.append("recipe", JSON.stringify(input.recipe));
  if (input.existingTextureId?.trim()) {
    form.append("existing_texture_id", input.existingTextureId.trim());
  }
  if (input.texture) {
    form.append("texture", input.texture, input.texture.name || "texture.png");
  }
  const res = await apiFetch(`${getApiBase()}/drinks/submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.sessionToken}` },
    body: form,
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Submit failed (${res.status})`),
      res.status
    );
  }
  return data as DrinkSubmissionPublic;
}

export async function getSubmission(
  id: string,
  sessionToken: string
): Promise<DrinkSubmissionPublic> {
  const res = await apiFetch(
    `${getApiBase()}/drinks/submissions/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${sessionToken}` } }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new DrinksApiError(
      detailMessage(data, `Load failed (${res.status})`),
      res.status
    );
  }
  return data as DrinkSubmissionPublic;
}
