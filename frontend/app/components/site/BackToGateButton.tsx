"use client";

import { clearSession } from "@/lib/profile/session";
import { isCharacterUiDev } from "@/lib/characters/uiDev";
import { isSiteDevGateEnabled } from "@/lib/site/config";

import { hubOutlineButtonClass } from "./HubAtmosphere";

export default function BackToGateButton() {
  if (!isSiteDevGateEnabled() || isCharacterUiDev()) {
    return null;
  }

  function returnToGate() {
    clearSession();
    window.location.assign("/");
  }

  return (
    <button type="button" onClick={returnToGate} className={hubOutlineButtonClass}>
      Back to gate
    </button>
  );
}
