"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PendingServerBanner from "../../components/character/PendingServerBanner";
import { listCharacters } from "../../../lib/characters/api";
import { getSession, isSessionValid } from "../../../lib/characters/session";
import { isCharacterUiDev } from "../../../lib/characters/uiDev";

type Props = {
  children: React.ReactNode;
};

export default function CharacterIdLayoutClient({ children }: Props) {
  const params = useParams();
  const characterId = String(params?.id || "").trim();
  const uiDev = isCharacterUiDev();
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (!characterId || uiDev) {
      setIsPending(false);
      return;
    }
    const session = getSession();
    if (!session || !isSessionValid(session) || session.scope !== "profile") {
      setIsPending(false);
      return;
    }
    let cancelled = false;
    void listCharacters(session.session_token)
      .then((list) => {
        if (cancelled) return;
        const row = list.characters.find((c) => c.id === characterId) || null;
        setIsPending(String(row?.status || "").toLowerCase() === "pending");
      })
      .catch(() => {
        if (!cancelled) setIsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [characterId, uiDev]);

  return (
    <>
      {isPending ? <PendingServerBanner className="mb-6" /> : null}
      {children}
    </>
  );
}
