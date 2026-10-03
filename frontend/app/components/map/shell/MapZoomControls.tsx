"use client";

import { MAP_ZOOM_STEP } from "@/app/lib/mapGestures";

import { FitIcon, MinusIcon, PlusIcon } from "./MapIcons";

type MapZoomControlsProps = {
  onZoom: (factor: number) => void;
  onReset: () => void;
};

/** Google Maps' zoom stack: in, out, and back to the whole map. */
export default function MapZoomControls({ onZoom, onReset }: MapZoomControlsProps) {
  const buttonClass = "map-control h-10 w-10 rounded-none border-0 shadow-none";
  return (
    <div className="map-frame flex flex-col overflow-hidden p-0" role="group" aria-label="Zoom">
      <button
        type="button"
        className={`${buttonClass} rounded-t-[9px]`}
        aria-label="Zoom in"
        title="Zoom in (+)"
        onClick={() => onZoom(MAP_ZOOM_STEP)}
      >
        <PlusIcon size={18} />
      </button>
      <span aria-hidden className="mx-2 h-px bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
      <button
        type="button"
        className={buttonClass}
        aria-label="Zoom out"
        title="Zoom out (−)"
        onClick={() => onZoom(1 / MAP_ZOOM_STEP)}
      >
        <MinusIcon size={18} />
      </button>
      <span aria-hidden className="mx-2 h-px bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]" />
      <button
        type="button"
        className={`${buttonClass} rounded-b-[9px]`}
        aria-label="Show the whole map"
        title="Show the whole map"
        onClick={onReset}
      >
        <FitIcon size={18} />
      </button>
    </div>
  );
}
