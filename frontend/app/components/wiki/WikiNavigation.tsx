"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

export default function WikiNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  return (
    <aside className="relative z-30 shrink-0 lg:sticky lg:top-[calc(var(--tfmc-sticky-top)+2.5rem)] lg:flex lg:max-h-[calc(100dvh-var(--tfmc-header-h)-5rem)] lg:w-56 lg:self-start lg:flex-col">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] px-4 py-3 text-sm font-semibold text-[var(--tfmc-cream)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tfmc-accent)] lg:hidden"
      >
        Browse guide
        <svg
          aria-hidden="true"
          viewBox="0 0 20 20"
          fill="none"
          className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path
            d="m5 7.5 5 5 5-5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div
        id={panelId}
        className={`${open ? "flex" : "hidden"} max-h-[65dvh] min-h-0 flex-col overflow-y-auto overscroll-contain rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] p-3 lg:flex lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:p-0`}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open && !event.defaultPrevented) {
            setOpen(false);
            toggleRef.current?.focus();
          }
        }}
      >
        {children}
      </div>
    </aside>
  );
}
