"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import PendingServerBanner from "../../components/character/PendingServerBanner";
import { listCharacters } from "../../../lib/characters/api";
import { getSession, isSessionValid } from "../../../lib/characters/session";
import { isCharacterUiDev } from "../../../lib/characters/uiDev";
import { characterPath } from "../../../lib/profile/paths";

type Props = {
  children: React.ReactNode;
};

export default function CharacterIdLayoutClient({ children }: Props) {
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!characterId || uiDev) {
      setStatus("");
      return;
    }
    const session = getSession();
    if (!session || !isSessionValid(session) || session.scope !== "profile") {
      setStatus("");
      return;
    }
    let cancelled = false;
    void listCharacters(session.session_token)
      .then((list) => {
        if (cancelled) return;
        const row = list.characters.find((c) => c.id === characterId) || null;
        setStatus(String(row?.status || "").toUpperCase());
      })
      .catch(() => {
        if (!cancelled) setStatus("");
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, uiDev]);

  // Wardrobe and kits are for the living; the site refuses changes to the dead too.
  if (status === "DEAD" || status === "MISSING") {
    return (
      <p className="text-sm text-[var(--tfmc-mist)]">
        {status === "DEAD" ? "This character has died." : "This character is missing."}{" "}
        <Link
          href={characterPath(characterId)}
          className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline"
        >
          Back to the character
        </Link>
      </p>
    );
  }

  return (
    <>
      {status === "PENDING" ? <PendingServerBanner className="mb-6" /> : null}
      {children}
    </>
  );
}
