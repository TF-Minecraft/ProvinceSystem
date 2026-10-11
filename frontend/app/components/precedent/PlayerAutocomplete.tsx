"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { applySuggestion, suggestPlayers } from "@/lib/precedent/playerSuggest";

type Props = {
  id?: string;
  value: string;
  known: string[];
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  onChange: (value: string) => void;
};

/**
 * Comma-separated player field with completion from names already in the
 * corpus. A plain <datalist> cannot do this: it matches the whole input value,
 * not the token after the last comma.
 */
export default function PlayerAutocomplete({ id, value, known, disabled, placeholder, className, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => suggestPlayers(value, known), [value, known]);

  // Reset the highlight whenever the candidate list changes underneath it.
  useEffect(() => {
    setActive(0);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const visible = open && matches.length > 0;

  function pick(name: string) {
    onChange(applySuggestion(value, name));
    setOpen(false);
    setActive(0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!visible) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter would otherwise submit; Tab would leave the field half-typed.
      e.preventDefault();
      pick(matches[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={id}
        className={className}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {visible ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-10 mt-1 max-h-48 overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[var(--tfmc-forest)] shadow-lg"
        >
          {matches.map((name, i) => (
            <li key={name}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                className={`block w-full px-3 py-1.5 text-left text-sm ${
                  i === active
                    ? "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-cream)]"
                    : "text-[var(--tfmc-stone)]"
                }`}
                // mousedown fires before the input's blur, so the click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(name);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
