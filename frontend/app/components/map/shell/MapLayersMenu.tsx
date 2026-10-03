"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { LayersIcon } from "./MapIcons";

export type MapLayerToggle = {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
};

type MapLayersMenuProps = {
  toggles: MapLayerToggle[];
  /** Opens upwards from a bottom-anchored button, downwards otherwise. */
  placement?: "up" | "down";
  /** Extra rows under the toggles: history and archive links. */
  footer?: ReactNode;
  /** Class for the trigger, so mobile can make it round. */
  triggerClassName?: string;
  /** Which edge of the trigger the popover lines up with. */
  align?: "left" | "right";
  /** Just the icon, as Google Maps' phone app does; the word stays for screen readers. */
  iconOnly?: boolean;
};

/**
 * Google Maps' "Layers" button: the overlays and tools that sit on top of
 * whichever map mode is chosen. It absorbs what used to be the Controls
 * legend's checkboxes and the always-open paint-mode panel.
 */
export default function MapLayersMenu({
  toggles,
  placement = "up",
  footer,
  triggerClassName = "h-10 px-3 text-sm",
  align = "left",
  iconOnly = false,
}: MapLayersMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (toggles.length === 0 && !footer) return null;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        className={`map-control ${triggerClassName}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={iconOnly ? "Layers" : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <LayersIcon size={18} />
        <span className={iconOnly ? "sr-only" : undefined}>Layers</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Map layers"
          className={`map-frame absolute z-30 w-64 p-3 ${align === "left" ? "left-0" : "right-0"} ${
            placement === "up" ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {toggles.length > 0 ? (
            <>
              <p className="map-rule mb-2">Show on map</p>
              <ul className="space-y-1">
                {toggles.map((toggle) => (
                  <li key={toggle.id}>
                    <label className="flex cursor-pointer items-start gap-2.5 rounded px-1.5 py-1.5 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)]">
                      <input
                        type="checkbox"
                        checked={toggle.checked}
                        onChange={(event) => toggle.onChange(event.target.checked)}
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--tfmc-accent)]"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm text-[var(--tfmc-cream)]">
                          {toggle.label}
                        </span>
                        {toggle.hint ? (
                          <span className="block text-xs leading-snug text-[var(--tfmc-stone)]">
                            {toggle.hint}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {footer ? (
            <div className={toggles.length > 0 ? "mt-3 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pt-3" : ""}>
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
