"use client";

import { useCallback, useEffect, useState } from "react";
import { ProfileApiError, type ProfileDrinkSubmission, type ProfileSkinSubmission } from "../../../lib/profile/api";
import { getCodeWardrobe, type CodeWardrobe as CodeWardrobeData } from "../../../lib/profile/codes";
import { drinkPath, skinPath } from "../../../lib/profile/paths";
import type { StartAllowance } from "../../../lib/profile/start";
import { redeemCode, startSkinFromProfile } from "../../../lib/skins/api";
import {
  clearSession as clearSkinsSession,
  setSession as setSkinsSession,
  skinsSessionFrom,
} from "../../../lib/skins/session";
import { redeemDrink, startDrinkFromProfile } from "../../../lib/drinks/api";
import {
  clearSession as clearDrinksSession,
  drinksSessionFrom,
  setSession as setDrinksSession,
} from "../../../lib/drinks/session";
import CodeRedeemForm from "../shared/CodeRedeemForm";
import { kindLabel } from "../skins/KindPicker";
import Wardrobe from "./Wardrobe";
import { DrinkPicture, SkinPicture } from "./WardrobePictures";

type Props<Row> = {
  rows: Row[];
  allowance?: StartAllowance;
  sessionToken: string;
  /** An in-game code's own session: New opens the editor with it rather than starting another. */
  codeSession?: boolean;
  /** Opens the editor ("new") or one item inside the tab. */
  onOpen: (id: string) => void;
};

const PENDING_POLL_MS = 10_000;

export function SkinWardrobe({
  rows,
  allowance,
  sessionToken,
  codeSession = false,
  onOpen,
}: Props<ProfileSkinSubmission>) {
  return (
    <Wardrobe
      noun="skin"
      allowance={allowance}
      onOpen={onOpen}
      onStart={async () => {
        if (!codeSession) {
          const result = await startSkinFromProfile(sessionToken);
          setSkinsSession({ ...skinsSessionFrom(result), from_profile: true });
        }
        onOpen("new");
      }}
      codeForm={
        <CodeRedeemForm
          redeem={redeemCode}
          toSession={skinsSessionFrom}
          saveSession={setSkinsSession}
          onRedeemed={() => onOpen("new")}
          label="Skin code"
        />
      }
      items={rows.map((row) => ({
        id: row.id,
        href: skinPath(row.id),
        name: row.display_name || "Untitled skin",
        detail: kindLabel(row.kind),
        status: row.status,
        denyReason: row.deny_reason,
        picture: <SkinPicture id={row.id} sessionToken={sessionToken} />,
      }))}
    />
  );
}

export function DrinkWardrobe({
  rows,
  allowance,
  sessionToken,
  codeSession = false,
  onOpen,
}: Props<ProfileDrinkSubmission>) {
  return (
    <Wardrobe
      noun="drink"
      allowance={allowance}
      onOpen={onOpen}
      onStart={async () => {
        if (!codeSession) {
          const result = await startDrinkFromProfile(sessionToken);
          setDrinksSession({ ...drinksSessionFrom(result), from_profile: true });
        }
        onOpen("new");
      }}
      codeForm={
        <CodeRedeemForm
          redeem={redeemDrink}
          toSession={drinksSessionFrom}
          saveSession={setDrinksSession}
          onRedeemed={() => onOpen("new")}
          label="Drink code"
        />
      }
      items={rows.map((row) => ({
        id: row.id,
        href: drinkPath(row.id),
        name: row.display_name || "Untitled drink",
        detail: "Drink",
        status: row.status,
        denyReason: row.deny_reason,
        picture: <DrinkPicture id={row.id} color={row.recipe?.color ?? null} sessionToken={sessionToken} />,
      }))}
    />
  );
}

/**
 * The one wardrobe a skin or drink code opens, loaded with that code's session; key it by the
 * session so a new code starts afresh. Calls onEnded when the session has expired, after clearing it.
 */
export function CodeWardrobe({
  noun,
  sessionToken,
  onEnded,
  onOpen,
}: {
  noun: "skin" | "drink";
  sessionToken: string;
  onEnded: () => void;
  onOpen: (id: string) => void;
}) {
  const [data, setData] = useState<CodeWardrobeData<ProfileSkinSubmission | ProfileDrinkSubmission> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getCodeWardrobe(sessionToken));
      setError(null);
    } catch (err) {
      if (err instanceof ProfileApiError && err.status === 401) {
        if (noun === "skin") clearSkinsSession();
        else clearDrinksSession();
        onEnded();
        return;
      }
      setError(err instanceof Error ? err.message : "Couldn’t load your wardrobe. Please try again.");
    }
  }, [noun, onEnded, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const pending = Boolean(data?.items.some((row) => row.status === "pending"));
  useEffect(() => {
    if (!pending) return;
    const id = window.setInterval(() => void load(), PENDING_POLL_MS);
    return () => window.clearInterval(id);
  }, [load, pending]);

  if (error && !data) return <p className="text-sm text-[#e8a0a0]">{error}</p>;
  if (!data) return <p className="text-sm text-[var(--tfmc-mist)]">Loading…</p>;
  return noun === "skin" ? (
    <SkinWardrobe
      rows={data.items as ProfileSkinSubmission[]}
      allowance={data.can_start}
      sessionToken={sessionToken}
      codeSession
      onOpen={onOpen}
    />
  ) : (
    <DrinkWardrobe
      rows={data.items as ProfileDrinkSubmission[]}
      allowance={data.can_start}
      sessionToken={sessionToken}
      codeSession
      onOpen={onOpen}
    />
  );
}
