"use client";

import { useEffect, useRef, useState } from "react";
import SimpleCubeViewer, { type CubeFaces } from "./SimpleCubeViewer";
import StationModelViewer from "./StationModelViewer";
import type { Slot } from "../../wiki/data";

const PREVIEW =
  "pointer-events-none absolute left-1/2 top-1/2 block h-8 w-8 -translate-x-1/2 -translate-y-1/2 overflow-hidden transition-[width,height,background-color,box-shadow] duration-200 group-hover:h-44 group-hover:w-44 group-hover:rounded-md group-hover:border group-hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] group-hover:bg-[var(--tfmc-forest)] group-hover:shadow-2xl group-focus-visible:h-44 group-focus-visible:w-44 group-focus-visible:rounded-md group-focus-visible:bg-[var(--tfmc-forest)] group-focus-visible:shadow-2xl motion-reduce:transition-none sm:h-10 sm:w-10";

/**
 * Station recipe output: a static thumbnail at rest (no WebGL context per slot),
 * swapped for the rotating 3D model (or textured cube, for vanilla blocks) the first time the slot is hovered or focused.
 */
export default function StationOutputPreview({
  thumbnail,
  alt,
  model,
  cubeFaces,
}: {
  thumbnail: string;
  alt: string;
  model?: Slot["model"];
  cubeFaces?: CubeFaces;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    const slot = ref.current?.closest(".group");
    if (!slot || (!model && !cubeFaces)) return;
    const activate = () => setActive(true);
    slot.addEventListener("pointerenter", activate);
    slot.addEventListener("focusin", activate);
    return () => {
      slot.removeEventListener("pointerenter", activate);
      slot.removeEventListener("focusin", activate);
    };
  }, [model, cubeFaces]);

  return (
    <>
      <span ref={ref} className={PREVIEW}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnail} alt={alt} loading="lazy" className="block h-full w-full object-contain" />
      </span>
      {active && model ? (
        <StationModelViewer
          modelUrl={model.url}
          textureUrl={model.texture}
          textureUrls={model.textures}
          textureAnimationUrl={model.textureAnimationUrl}
          variant="thumb"
        />
      ) : active && cubeFaces ? (
        <SimpleCubeViewer faces={cubeFaces} variant="thumb" />
      ) : null}
    </>
  );
}
