"use client";

import { useCallback, useEffect, useState } from "react";

import { getSession, isSessionValid } from "@/lib/characters/session";
import { isCharacterUiDev } from "@/lib/characters/uiDev";
import { hasSiteStaffAccess } from "@/lib/site/staffAccess";

export type SiteStaffAccessState = "loading" | "unauthenticated" | "staff" | "denied";

type Options = {
  enabled?: boolean;
};

export function useSiteStaffAccess(opts?: Options): {
  state: SiteStaffAccessState;
  retry: () => void;
} {
  const enabled = opts?.enabled !== false;
  const [state, setState] = useState<SiteStaffAccessState>(() => {
    if (!enabled || isCharacterUiDev()) return "staff";
    return "loading";
  });
  const [tick, setTick] = useState(0);

  const retry = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!enabled || isCharacterUiDev()) {
      setState("staff");
      return;
    }

    let cancelled = false;

    async function probe() {
      setState("loading");

      const session = getSession();
      if (!isSessionValid(session)) {
        if (!cancelled) setState("unauthenticated");
        return;
      }

      const token = session?.session_token ?? "";
      try {
        const staff = await hasSiteStaffAccess(token);
        if (cancelled) return;
        setState(staff ? "staff" : "denied");
      } catch {
        if (!cancelled) setState("denied");
      }
    }

    void probe();

    const onStorage = () => {
      void probe();
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, tick]);

  return { state, retry };
}
