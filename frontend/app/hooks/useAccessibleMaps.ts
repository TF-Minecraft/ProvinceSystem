"use client";

import { useEffect, useState } from "react";

import {
  fetchAccessibleMaps,
  type AccessibleMapEntry,
} from "@/lib/map/api";
import { getSession, isSessionValid } from "@/lib/characters/session";
import {
  isCharacterUiDev,
  UI_DEV_SESSION_TOKEN,
} from "@/lib/characters/uiDev";

type AccessibleMapsState = {
  maps: AccessibleMapEntry[];
  loading: boolean;
  error: string | null;
};

// Images, navigation and the viewer all need the same access list. Keep one
// answer for the current auth context, including while its request is pending.
// Changing accounts drops the old answer rather than retaining private lists.
let shared: {
  token: string | null;
  request: ReturnType<typeof fetchAccessibleMaps>;
} | null = null;

function loadMaps(token: string | null) {
  if (shared?.token === token) return shared.request;
  const request = fetchAccessibleMaps(token);
  shared = { token, request };
  void request.catch(() => {
    // A later mount can retry a failed request without an automatic retry loop.
    if (shared?.request === request) shared = null;
  });
  return request;
}

export function useAccessibleMaps(): AccessibleMapsState {
  const [state, setState] = useState<AccessibleMapsState>({
    maps: [],
    loading: true,
    error: null,
  });

  useEffect(() => {
    let generation = 0;
    const load = async () => {
      const current = ++generation;
      const token = isCharacterUiDev()
        ? UI_DEV_SESSION_TOKEN
        : (() => {
            const session = getSession();
            return isSessionValid(session) ? session?.session_token ?? null : null;
          })();
      setState({ maps: [], loading: true, error: null });
      try {
        const data = await loadMaps(token);
        if (generation === current) {
          setState({ maps: data.maps, loading: false, error: null });
        }
      } catch {
        if (generation === current) {
          setState({ maps: [], loading: false, error: "Failed to load maps" });
        }
      }
    };
    void load();
    const onStorage = (event: StorageEvent) => {
      // A cleared store or a keyless session notification must also discard
      // the previous account's access list.
      if (
        !event.key ||
        event.key === "tfmc_profile_session" ||
        event.key === "tfmc_character_session"
      ) {
        void load();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      generation += 1;
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return state;
}
