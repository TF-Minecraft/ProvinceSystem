import { authHeaders, getApiBase, parseJson } from "../site/api";
import type { CharacterListItem } from "../characters/api";

export class ProfileApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ProfileApiError";
    this.status = status;
  }
}

function detailMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "detail" in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
  }
  return fallback;
}

export type ProfileSkinSubmission = {
  id: string;
  kind: string;
  slug: string;
  display_name: string;
  status: string;
  deny_reason?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  applied_at?: string | null;
};

export type ProfileDrinkSubmission = {
  id: string;
  slug: string;
  display_name: string;
  status: string;
  deny_reason?: string | null;
  created_at: string;
  reviewed_at?: string | null;
  applied_at?: string | null;
};

export type ProfileCustomItem = {
  character_id: string;
  character_name: string;
  kit_key: string;
  display_name: string;
  state: string;
  submission_id?: string | null;
  submission_status?: string | null;
  deny_reason?: string | null;
  skin_slug?: string | null;
  updated_at?: string | null;
  ready_at?: string | null;
  applied_at?: string | null;
};

export type ProfileDashboard = {
  characters: CharacterListItem[];
  max_alive_characters?: number;
  skins: ProfileSkinSubmission[];
  drinks: ProfileDrinkSubmission[];
  custom_items: ProfileCustomItem[];
};

export async function getProfileDashboard(
  sessionToken: string
): Promise<ProfileDashboard> {
  const res = await fetch(`${getApiBase()}/profile`, {
    headers: authHeaders(sessionToken),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ProfileApiError(
      detailMessage(data, `Profile load failed (${res.status})`),
      res.status
    );
  }
  const body = (data || {}) as Partial<ProfileDashboard>;
  return {
    characters: Array.isArray(body.characters) ? body.characters : [],
    max_alive_characters:
      typeof body.max_alive_characters === "number"
        ? body.max_alive_characters
        : undefined,
    skins: Array.isArray(body.skins) ? body.skins : [],
    drinks: Array.isArray(body.drinks) ? body.drinks : [],
    custom_items: Array.isArray(body.custom_items) ? body.custom_items : [],
  };
}
