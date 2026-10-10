"use client";

import { useEffect, useState } from "react";
import { getSkinThumbnail } from "../../../lib/skins/api";
import { composeTintedPotionCanvas, loadDrinkAssetImages } from "../../../lib/drinks/potionTint";
import { HangerGlyph } from "./Wardrobe";

function Picture({ src, small }: { src: string; small: boolean }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- object and data URLs
    <img
      src={src}
      alt=""
      className={`h-full w-full object-contain [image-rendering:pixelated] ${small ? "p-[22%]" : ""}`}
    />
  );
}

/** The rendered preview, or the flat texture scaled up, or a hanger. */
export function SkinPicture({ id, sessionToken }: { id: string; sessionToken: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [small, setSmall] = useState(false);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    getSkinThumbnail(id, sessionToken)
      .then((next) => {
        if (!live) {
          if (next) URL.revokeObjectURL(next);
          return;
        }
        url = next;
        if (!next) {
          setMissing(true);
          return;
        }
        // Flat textures are 16 to 32 px; give them room rather than filling the card.
        const probe = new Image();
        probe.onload = () => {
          if (live) setSmall(probe.naturalWidth <= 64);
          if (live) setSrc(next);
        };
        probe.onerror = () => live && setMissing(true);
        probe.src = next;
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [id, sessionToken]);

  if (src) return <Picture src={src} small={small} />;
  return missing ? <HangerGlyph /> : null;
}

/** The vanilla potion in the drink's colour. */
export function DrinkPicture({ color }: { color: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(!color);

  useEffect(() => {
    if (!color) return;
    let live = true;
    loadDrinkAssetImages()
      .then((assets) => {
        const canvas = composeTintedPotionCanvas(color, assets);
        if (!live) return;
        if (canvas) setSrc(canvas.toDataURL("image/png"));
        else setMissing(true);
      })
      .catch(() => live && setMissing(true));
    return () => {
      live = false;
    };
  }, [color]);

  if (src) return <Picture src={src} small />;
  return missing ? <HangerGlyph /> : null;
}
