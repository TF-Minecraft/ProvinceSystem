"use client";

import { useEffect, useState } from "react";
import { minecraftHeadUrl } from "../../../lib/account/api";
import { characterFigure } from "../../../lib/characters/api";

type Props = {
  characterId: string;
  name: string;
  /** Null in UI dev, and for characters with no wardrobe yet: the player's head shows. */
  sessionToken: string | null;
  playerUuid?: string | null;
};

/** The character standing in the skin it wears, drawn flat as pixel art; else the player's head. */
export default function CharacterFigure({ characterId, name, sessionToken, playerUuid }: Props) {
  // Undefined while loading, null when there's no figure to show.
  const [figure, setFigure] = useState<string | null | undefined>(sessionToken ? undefined : null);
  const [headFailed, setHeadFailed] = useState(false);

  useEffect(() => {
    if (!sessionToken) return;
    let live = true;
    characterFigure(sessionToken, characterId)
      .catch(() => null)
      .then((next) => live && setFigure(next));
    return () => {
      live = false;
    };
  }, [characterId, sessionToken]);

  const head = figure === null && playerUuid && !headFailed;
  return (
    <div className="grid h-36 w-24 shrink-0 place-items-center rounded-sm bg-[radial-gradient(circle_at_50%_45%,color-mix(in_srgb,var(--tfmc-moss)_88%,var(--tfmc-cream)),color-mix(in_srgb,var(--tfmc-forest-deep)_85%,var(--tfmc-forest))_72%)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] sm:h-[216px] sm:w-[150px]">
      {/* A data URL or our own API; next/image adds nothing for pixel art this small. */}
      {figure ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={figure}
          alt={`${name}'s skin`}
          width={96}
          height={192}
          className="h-32 w-16 [image-rendering:pixelated] drop-shadow-[0_4px_4px_rgba(0,0,0,0.35)] sm:h-48 sm:w-24"
        />
      ) : head ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`${minecraftHeadUrl()}?u=${encodeURIComponent(playerUuid)}`}
          alt=""
          width={80}
          height={80}
          onError={() => setHeadFailed(true)}
          className="h-14 w-14 rounded-[3px] [image-rendering:pixelated] shadow-[0_0_0_1px_color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] sm:h-20 sm:w-20"
        />
      ) : null}
    </div>
  );
}
