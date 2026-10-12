"use client";

import { useEffect, useState } from "react";
import { getSkinThumbnail } from "../../../lib/skins/api";
import { getDrinkTexture } from "../../../lib/drinks/api";
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

/** The vanilla potion in the drink's colour, else the drink's own texture. */
export function DrinkPicture({ id, color, sessionToken }: { id: string; color: string | null; sessionToken: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    const done = (next: string | null) => {
      if (!live) return;
      if (next) setSrc(next);
      else setMissing(true);
    };
    if (color) {
      loadDrinkAssetImages()
        .then((assets) => done(composeTintedPotionCanvas(color, assets)?.toDataURL("image/png") ?? null))
        .catch(() => done(null));
    } else {
      getDrinkTexture(id, sessionToken)
        .then((next) => {
          url = next;
          if (!live && next) URL.revokeObjectURL(next);
          done(next);
        })
        .catch(() => done(null));
    }
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [color, id, sessionToken]);

  if (src) return <Picture src={src} small />;
  return missing ? <HangerGlyph /> : null;
}
