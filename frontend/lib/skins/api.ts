import { getApiBase, detailMessage, parseJson } from "../site/api";
import { adminRequest } from "../admin/api";
import type { SkinsCatalog } from "./catalog";
import { EMPTY_ENTITLEMENTS, parseEntitlements } from "./catalog";
import { readStartRefusal } from "../profile/start";

export type { CatalogCategory, CatalogScroll, SkinsCatalog } from "./catalog";

export class SkinsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "SkinsApiError";
    this.status = status;
  }
}

/** fetch with a clearer error when the API is unreachable. */
async function apiFetch(
  input: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new Error("Upload failed. Please try again.");
  }
}

export type RedeemResult = {
  session_token: string;
  player_uuid: string;
  expires_at: string;
  code_id: number;
  scope?: string;
  realm_id?: string;
  staff?: boolean;
  name_colour_stops?: number;
  max_3d_pair_bytes?: number;
  skin_token_cooldown_days?: number;
  skin_kinds?: string[];
  allow_armor_3d_helmet?: boolean;
};

export async function redeemCode(code: string): Promise<RedeemResult> {
  const res = await apiFetch(`${getApiBase()}/skins/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: code.trim() }),
  });

  const data = await parseJson(res);

  if (!res.ok) {
    throw new SkinsApiError(
      detailMessage(data, `Redeem failed (${res.status})`),
      res.status
    );
  }
  return readRedeemResult(res, data);
}

/** A skin upload session from Profile, under the same cooldown as /token create skin. */
export async function startSkinFromProfile(profileToken: string): Promise<RedeemResult> {
  const res = await apiFetch(`${getApiBase()}/profile/skins/start`, {
    method: "POST",
    headers: { Authorization: `Bearer ${profileToken}` },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw (
      readStartRefusal(res.status, data) ??
      new SkinsApiError(detailMessage(data, "Couldn’t start a skin. Please try again."), res.status)
    );
  }
  return readRedeemResult(res, data);
}

function readRedeemResult(res: Response, data: unknown): RedeemResult {
  const body = data as Partial<RedeemResult> & Record<string, unknown>;
  if (!body.session_token || !body.player_uuid || !body.expires_at) {
    throw new SkinsApiError("Invalid redeem response from API", res.status);
  }

  const out: RedeemResult = {
    session_token: body.session_token,
    player_uuid: body.player_uuid,
    expires_at: body.expires_at,
    code_id: Number(body.code_id),
  };
  if (typeof body.scope === "string" && body.scope.trim()) {
    out.scope = body.scope.trim();
  }
  if (typeof body.realm_id === "string" && body.realm_id.trim()) {
    out.realm_id = body.realm_id.trim().toLowerCase();
  }
  const staffRaw = (data as Record<string, unknown> | null)?.staff;
  if (staffRaw === true || staffRaw === "true") {
    out.staff = true;
  }
  const stops = Number(body.name_colour_stops);
  if (Number.isFinite(stops) && stops >= 0) {
    out.name_colour_stops = Math.floor(stops);
  }
  const pair = Number(body.max_3d_pair_bytes);
  if (Number.isFinite(pair) && pair >= 0) {
    out.max_3d_pair_bytes = Math.floor(pair);
  }
  const cooldown = Number(body.skin_token_cooldown_days);
  if (Number.isFinite(cooldown) && cooldown >= -1) {
    out.skin_token_cooldown_days = Math.floor(cooldown);
  }
  if (Array.isArray(body.skin_kinds)) {
    const kinds: string[] = [];
    const seen = new Set<string>();
    for (const item of body.skin_kinds) {
      const kind = String(item || "")
        .trim()
        .toLowerCase();
      if (!kind || seen.has(kind)) continue;
      seen.add(kind);
      kinds.push(kind);
    }
    out.skin_kinds = kinds;
  }
  if (typeof body.allow_armor_3d_helmet === "boolean") {
    out.allow_armor_3d_helmet = body.allow_armor_3d_helmet;
  }
  return out;
}

export type InspectCodeEntitlements = {
  meta_synced: boolean;
  max_3d_pair_bytes: number;
  skin_kinds: string[];
  name_colour_stops: number;
  allow_armor_3d_helmet: boolean;
};

export type InspectCodeStaffTokenPerms = {
  "tfmcweb.token.create": boolean;
  "tfmcweb.token.create.staff": boolean;
};

export type InspectCodeResult =
  | { valid: false; error: string }
  | {
      valid: true;
      status: string;
      scope: string;
      realm_id: string;
      staff: boolean;
      created_at: string;
      expires_at: string;
      revoked: boolean;
      consumed: boolean;
      expired: boolean;
      player_uuid_masked: string;
      site_staff_access: boolean;
      staff_token_perms: InspectCodeStaffTokenPerms;
      entitlements: InspectCodeEntitlements;
    };

/** Staff panel lookup, signed in by the Discord session cookie; failures throw AccountApiError. */
export async function inspectCode(code: string): Promise<InspectCodeResult> {
  const body = await adminRequest<Record<string, unknown>>("/skins/codes/inspect", {
    method: "POST",
    body: JSON.stringify({ code: code.trim() }),
  });
  if (body.valid === false) {
    return {
      valid: false,
      error: typeof body.error === "string" ? body.error : "Invalid code",
    };
  }

  if (body.valid !== true) {
    throw new Error("Invalid inspect response from API");
  }

  const entRaw =
    body.entitlements && typeof body.entitlements === "object"
      ? (body.entitlements as Record<string, unknown>)
      : {};
  const skinKindsRaw = entRaw.skin_kinds;
  const skinKinds: string[] = Array.isArray(skinKindsRaw)
    ? skinKindsRaw.map((k) => String(k))
    : [];

  const permsRaw =
    body.staff_token_perms && typeof body.staff_token_perms === "object"
      ? (body.staff_token_perms as Record<string, unknown>)
      : {};

  return {
    valid: true,
    status: String(body.status || "unknown"),
    scope: String(body.scope || ""),
    realm_id: String(body.realm_id || ""),
    staff: body.staff === true,
    created_at: String(body.created_at || ""),
    expires_at: String(body.expires_at || ""),
    revoked: body.revoked === true,
    consumed: body.consumed === true,
    expired: body.expired === true,
    player_uuid_masked: String(body.player_uuid_masked || ""),
    site_staff_access: body.site_staff_access === true,
    staff_token_perms: {
      "tfmcweb.token.create": permsRaw["tfmcweb.token.create"] === true,
      "tfmcweb.token.create.staff":
        permsRaw["tfmcweb.token.create.staff"] === true,
    },
    entitlements: {
      meta_synced: entRaw.meta_synced === true,
      max_3d_pair_bytes: Math.max(
        0,
        Math.floor(Number(entRaw.max_3d_pair_bytes) || 0)
      ),
      skin_kinds: skinKinds,
      name_colour_stops: Math.max(
        0,
        Math.floor(Number(entRaw.name_colour_stops) || 0)
      ),
      allow_armor_3d_helmet: entRaw.allow_armor_3d_helmet === true,
    },
  };
}

/** Fresh web entitlements from GET /characters/player-meta. */
export type PlayerMeta = {
  name_colour_stops: number;
  allow_drink_texture: boolean;
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
    throw new SkinsApiError(
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

export type SubmissionPublic = {
  id: string;
  kind: string;
  slug: string;
  display_name: string;
  grip_preset: string | null;
  base_set: string | null;
  tiers?: string[];
  tier_aliases?: Record<string, string>;
  add_name?: boolean;
  name_colours?: string[];
  name_styles?: string[];
  status: string;
  deny_reason: string | null;
  created_at: string;
  reviewed_at: string | null;
  applied_at: string | null;
  upload_source?: "kit" | "skins";
  staff?: boolean;
  category?: string | null;
  scroll?: string | null;
  tier_scrolls?: Record<string, string> | null;
};

export type SubmissionCheckResult = {
  ok: boolean;
  conflicts: Array<{
    id: string;
    slug: string;
    display_name: string;
    status: string;
    kind: string;
    reasons: string[];
  }>;
};

export type CreateSubmissionInput = {
  sessionToken: string;
  kind: string;
  display_name: string;
  base_set?: string | null;
  tiers?: string[];
  tier_aliases?: Record<string, string>;
  helmet_3d_tiers?: string[];
  grip_preset?: string | null;
  add_name?: boolean;
  name_colours?: string[];
  name_styles?: string[];
  category?: string | null;
  scroll?: string | null;
  tier_scrolls?: Record<string, string> | null;
  files: Record<string, File>;
};

export async function checkSubmissionConflict(input: {
  sessionToken: string;
  display_name: string;
}): Promise<SubmissionCheckResult> {
  const params = new URLSearchParams();
  if (input.display_name.trim()) {
    params.set("display_name", input.display_name.trim());
  }
  const res = await apiFetch(
    `${getApiBase()}/skins/submissions/check?${params.toString()}`,
    {
      headers: { Authorization: `Bearer ${input.sessionToken}` },
    }
  );
  const data = await parseJson(res);
  if (!res.ok) {
    throw new SkinsApiError(
      detailMessage(data, `Conflict check failed (${res.status})`),
      res.status
    );
  }
  return data as SubmissionCheckResult;
}

export async function createSubmission(
  input: CreateSubmissionInput
): Promise<SubmissionPublic> {
  const form = new FormData();
  form.append("kind", input.kind);
  form.append("display_name", input.display_name);
  if (input.base_set) {
    form.append("base_set", input.base_set);
  }
  if (input.tiers?.length) {
    form.append("tiers", JSON.stringify(input.tiers));
  }
  if (input.tier_aliases && Object.keys(input.tier_aliases).length) {
    form.append("tier_aliases", JSON.stringify(input.tier_aliases));
  }
  if (input.helmet_3d_tiers?.length) {
    form.append("helmet_3d_tiers", JSON.stringify(input.helmet_3d_tiers));
  }
  if (input.grip_preset) {
    form.append("grip_preset", input.grip_preset);
  }
  if (input.add_name) {
    form.append("add_name", "true");
  }
  if (input.name_colours?.length) {
    form.append("name_colours", JSON.stringify(input.name_colours));
  }
  if (input.name_styles?.length) {
    form.append("name_styles", JSON.stringify(input.name_styles));
  }
  if (input.category) {
    form.append("category", input.category);
  }
  if (input.scroll) {
    form.append("scroll", input.scroll);
  }
  if (input.tier_scrolls && Object.keys(input.tier_scrolls).length) {
    form.append("tier_scrolls", JSON.stringify(input.tier_scrolls));
  }
  for (const [name, file] of Object.entries(input.files)) {
    form.append(name, file, file.name);
  }

  const res = await apiFetch(`${getApiBase()}/skins/submissions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.sessionToken}` },
    body: form,
  });

  const data = await parseJson(res);
  if (!res.ok) {
    throw new SkinsApiError(
      detailMessage(data, `Upload failed (${res.status})`),
      res.status
    );
  }
  return data as SubmissionPublic;
}

export async function getCatalog(): Promise<SkinsCatalog> {
  const res = await apiFetch(`${getApiBase()}/skins/catalog`);
  const data = await parseJson(res);
  if (!res.ok) {
    throw new SkinsApiError(
      detailMessage(data, `Catalog failed (${res.status})`),
      res.status
    );
  }
  const body = (data || {}) as Partial<SkinsCatalog>;
  return {
    categories: Array.isArray(body.categories) ? body.categories : [],
    scrolls: Array.isArray(body.scrolls) ? body.scrolls : [],
    entitlements: body.entitlements
      ? parseEntitlements(body.entitlements)
      : EMPTY_ENTITLEMENTS,
    updated_at:
      typeof body.updated_at === "string" ? body.updated_at : null,
  };
}

export async function getReviewSheet(
  id: string,
  sessionToken: string
): Promise<string> {
  const res = await apiFetch(
    `${getApiBase()}/skins/submissions/${id}/review-sheet`,
    {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }
  );
  if (!res.ok) {
    const data = await parseJson(res);
    throw new SkinsApiError(
      detailMessage(data, `Could not load review sheet (${res.status})`),
      res.status
    );
  }
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

/** Object URL of the owner's wardrobe picture, or null when there is none yet. */
export async function getSkinThumbnail(
  id: string,
  sessionToken: string
): Promise<string | null> {
  const res = await apiFetch(
    `${getApiBase()}/skins/submissions/${encodeURIComponent(id)}/thumbnail`,
    { headers: { Authorization: `Bearer ${sessionToken}` } }
  );
  if (!res.ok) return null;
  return URL.createObjectURL(await res.blob());
}

export async function getSubmission(
  id: string,
  sessionToken: string
): Promise<SubmissionPublic> {
  const res = await apiFetch(`${getApiBase()}/skins/submissions/${id}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new SkinsApiError(
      detailMessage(data, `Could not load submission (${res.status})`),
      res.status
    );
  }
  return data as SubmissionPublic;
}
