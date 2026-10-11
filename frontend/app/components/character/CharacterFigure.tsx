"use client";

import { useEffect, useRef, useState } from "react";
import { minecraftHeadUrl } from "../../../lib/account/api";
import { characterSkin } from "../../../lib/characters/api";
import { FRONT_HEIGHT, FRONT_WIDTH, skinFront } from "../../../lib/characters/skinFront";

type Props = {
  characterId: string;
  name: string;
  /** Null in UI dev, and for characters with no wardrobe yet: the player's head shows. */
  sessionToken: string | null;
  playerUuid?: string | null;
};

/** Loading, the skin's front, or the player's head when there's no usable skin. */
type Shown = { kind: "loading" } | { kind: "skin"; pixels: Uint8ClampedArray } | { kind: "head" };

async function readFront(blob: Blob): Promise<Uint8ClampedArray | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return skinFront(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
}

/** The character standing in the skin it wears, drawn flat as pixel art. */
export default function CharacterFigure({ characterId, name, sessionToken, playerUuid }: Props) {
  const [shown, setShown] = useState<Shown>(sessionToken ? { kind: "loading" } : { kind: "head" });
  const [headFailed, setHeadFailed] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let live = true;
    characterSkin(sessionToken, characterId)
      .then((blob) => (blob ? readFront(blob) : null))
      .catch(() => null)
      .then((pixels) => live && setShown(pixels ? { kind: "skin", pixels } : { kind: "head" }));
    return () => {
      live = false;
    };
  }, [characterId, sessionToken]);

  useEffect(() => {
    if (shown.kind !== "skin") return;
    const ctx = canvasRef.current?.getContext("2d");
    ctx?.putImageData(new ImageData(new Uint8ClampedArray(shown.pixels), FRONT_WIDTH, FRONT_HEIGHT), 0, 0);
  }, [shown]);

  return (
    <div className="grid h-36 w-24 shrink-0 place-items-center rounded-sm bg-[radial-gradient(circle_at_50%_45%,color-mix(in_srgb,var(--tfmc-moss)_88%,var(--tfmc-cream)),color-mix(in_srgb,var(--tfmc-forest-deep)_85%,var(--tfmc-forest))_72%)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] sm:h-[216px] sm:w-[150px]">
      {shown.kind === "skin" ? (
        <canvas
          ref={canvasRef}
          width={FRONT_WIDTH}
          height={FRONT_HEIGHT}
          role="img"
          aria-label={`${name}'s skin`}
          className="h-32 w-16 [image-rendering:pixelated] drop-shadow-[0_4px_4px_rgba(0,0,0,0.35)] sm:h-48 sm:w-24"
        />
      ) : shown.kind === "head" && playerUuid && !headFailed ? (
        /* Our own API; next/image adds nothing for an 8×8 head. */
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
