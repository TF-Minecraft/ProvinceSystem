/** Opening Profile with an in-game code: a profile code opens all of it, a skin or drink code that wardrobe. */
import { authHeaders, detailMessage, getApiBase, parseJson } from "../site/api";
import { readDrinkRedeemResult } from "../drinks/api";
import {
  drinksSessionFrom,
  getSession as getDrinksSession,
  isSessionValid as isDrinksSessionValid,
  setSession as setDrinksSession,
  type DrinksSession,
} from "../drinks/session";
import { readRedeemResult } from "../skins/api";
import {
  getSession as getSkinsSession,
  isSessionValid as isSkinsSessionValid,
  setSession as setSkinsSession,
  skinsSessionFrom,
  type SkinsSession,
} from "../skins/session";
import { ProfileApiError } from "./api";
import { setSession, type ProfileSession } from "./session";
import { readAllowance, type StartAllowance } from "./start";

/** What a sign-in code opened: Profile itself, or one wardrobe. */
export type SignIn = { tab: null; profile: ProfileSession } | { tab: "skins" | "drinks"; profile: null };

const SKIN_SCOPES = ["skin", "skin_staff"];

async function postCode(code: string): Promise<{ res: Response; data: unknown }> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/profile/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code.trim() }),
    });
  } catch {
    throw new Error("Request failed. Please try again.");
  }
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ProfileApiError(detailMessage(data, "Couldn’t log in. Check the code and try again."), res.status);
  }
  return { res, data };
}

/** Redeems a /token create profile, skin or drink code and stores the session it opens. */
export async function signInWithCode(code: string): Promise<SignIn> {
  const { res, data } = await postCode(code);
  const scope = String((data as { scope?: unknown } | null)?.scope ?? "");
  if (SKIN_SCOPES.includes(scope)) {
    setSkinsSession(skinsSessionFrom(readRedeemResult(res, data)));
    return { tab: "skins", profile: null };
  }
  if (scope === "drink") {
    setDrinksSession(drinksSessionFrom(readDrinkRedeemResult(res, data)));
    return { tab: "drinks", profile: null };
  }
  const body = (data || {}) as Partial<ProfileSession>;
  if (!body.session_token || !body.player_uuid || !body.expires_at) {
    throw new ProfileApiError("Couldn’t log in. Please try again.", res.status);
  }
  const profile: ProfileSession = {
    session_token: body.session_token,
    player_uuid: body.player_uuid,
    expires_at: body.expires_at,
    scope: "profile",
    ...(typeof body.realm_id === "string" && body.realm_id.trim() ? { realm_id: body.realm_id.trim() } : {}),
    remember_me: false,
  };
  setSession(profile);
  return { tab: null, profile };
}

/** Skin and drink sessions from in-game codes; those Profile started belong to its own session. */
export type CodeSessions = { skins: SkinsSession | null; drinks: DrinksSession | null };

export const NO_CODE_SESSIONS: CodeSessions = { skins: null, drinks: null };

export function readCodeSessions(): CodeSessions {
  const skins = getSkinsSession();
  const drinks = getDrinksSession();
  return {
    skins: skins && !skins.from_profile && isSkinsSessionValid(skins) ? skins : null,
    drinks: drinks && !drinks.from_profile && isDrinksSessionValid(drinks) ? drinks : null,
  };
}

/** A code's wardrobe; can_start is false once the code has made its skin or drink. */
export type CodeWardrobe<Row> = { items: Row[]; can_start: StartAllowance };

export async function getCodeWardrobe<Row>(sessionToken: string): Promise<CodeWardrobe<Row>> {
  let res: Response;
  try {
    res = await fetch(`${getApiBase()}/profile/wardrobe`, { headers: authHeaders(sessionToken) });
  } catch {
    throw new Error("Request failed. Please try again.");
  }
  const data = await parseJson(res);
  if (!res.ok) {
    throw new ProfileApiError(detailMessage(data, "Couldn’t load your wardrobe. Please try again."), res.status);
  }
  const body = (data || {}) as { items?: unknown; can_start?: unknown };
  return {
    items: Array.isArray(body.items) ? (body.items as Row[]) : [],
    can_start: readAllowance(body.can_start) ?? { can_start: false, reason: null, next_at: null },
  };
}
