"use client";

import { useEffect, useState } from "react";

import { getSession, isSessionValid } from "@/lib/characters/session";
import { isCharacterUiDev, UI_DEV_SESSION_TOKEN } from "@/lib/characters/uiDev";

export function useCharacterSessionToken(): string | null {
  const [sessionToken, setSessionToken] = useState<string | null>(() =>
    isCharacterUiDev() ? UI_DEV_SESSION_TOKEN : null,
  );

  useEffect(() => {
    if (isCharacterUiDev()) {
      setSessionToken(UI_DEV_SESSION_TOKEN);
      return;
    }

    const syncSession = () => {
      const session = getSession();
      setSessionToken(isSessionValid(session) ? (session?.session_token ?? null) : null);
    };

    syncSession();
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, []);

  return sessionToken;
}
