"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

import { searchMap, type MapSearchEntry } from "@/app/lib/map/mapSearch";

import { CloseIcon, PinIcon, SearchIcon } from "./MapIcons";

type MapSearchProps = {
  entries: MapSearchEntry[];
  placeholder: string;
  onSelect: (entry: MapSearchEntry) => void;
};

/**
 * The omnibox: type a realm, title or place and pick it to fly there. Results
 * come from data the map already holds, so this costs no request.
 */
export default function MapSearch({ entries, placeholder, onSelect }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const results = useMemo(() => searchMap(entries, query), [entries, query]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // "/" jumps to the search box from anywhere on the map, as on most map sites.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function choose(entry: MapSearchEntry) {
    onSelect(entry);
    setQuery("");
    setOpen(false);
    inputRef.current?.blur();
  }

  const showList = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] px-2.5 focus-within:border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)]">
        <SearchIcon size={16} className="shrink-0 text-[var(--tfmc-stone)]" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-keyshortcuts="/"
          aria-activedescendant={showList && results[active] ? `${listId}-${active}` : undefined}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, Math.max(results.length - 1, 0)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter") {
              const entry = results[active];
              if (entry) {
                event.preventDefault();
                choose(entry);
              }
            } else if (event.key === "Escape") {
              setQuery("");
              setOpen(false);
              inputRef.current?.blur();
            }
          }}
          // 16 px on phones: Safari zooms the page into any smaller field.
          className="h-10 min-w-0 flex-1 bg-transparent text-base text-[var(--tfmc-cream)] md:text-sm placeholder:text-[var(--tfmc-stone)]/70 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="shrink-0 rounded p-1 text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
          >
            <CloseIcon size={14} />
          </button>
        ) : null}
      </div>

      {showList ? (
        <ul
          id={listId}
          role="listbox"
          className="map-frame absolute left-0 right-0 top-full z-40 mt-1.5 max-h-80 overflow-y-auto p-1"
        >
          {results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-[var(--tfmc-stone)]">
              Nothing on this map matches “{query.trim()}”.
            </li>
          ) : (
            results.map((entry, index) => (
              <li
                key={entry.key}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(entry)}
                onMouseEnter={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2.5 rounded px-2.5 py-2 ${
                  index === active ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]" : ""
                }`}
              >
                {entry.kind !== "place" ? (
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 rounded-sm ring-1 ring-black/60"
                    style={{ backgroundColor: entry.rgb ? `rgb(${entry.rgb})` : "#555" }}
                  />
                ) : (
                  <PinIcon size={15} className="shrink-0 text-[var(--tfmc-stone)]" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-[var(--tfmc-cream)]">
                    {entry.label}
                  </span>
                  <span className="block truncate text-xs text-[var(--tfmc-stone)]">
                    {entry.detail}
                  </span>
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
