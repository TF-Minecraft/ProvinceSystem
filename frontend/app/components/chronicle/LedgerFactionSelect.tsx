"use client";

import { useEffect, useId, useRef, useState } from "react";
import { parseNameRuns } from "../../../lib/characters/lorePreview";
import type { LedgerFactionOption } from "../../lib/map/ledgerSeries";
import FormattedMcRuns from "../shared/FormattedMcRuns";
import { selectClass } from "./ChroniclePanels";

export default function LedgerFactionSelect({
  options,
  selectedKey,
  onSelect,
  label,
}: {
  options: LedgerFactionOption[];
  selectedKey: string;
  onSelect: (key: string) => void;
  label: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const selected = options.findIndex((option) => option.name === selectedKey);
  const activeIndex = Math.min(active, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(`${id}-${activeIndex}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex, id]);

  function choose(index: number) {
    const option = options[index];
    if (option) onSelect(option.name);
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <div
      ref={root}
      className="relative mt-1 min-w-0"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && options.length ? `${id}-${activeIndex}` : undefined}
        className={`${selectClass} flex items-center justify-between gap-2 text-left`}
        onClick={() => {
          setActive(Math.max(0, selected));
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setOpen(false);
            return;
          }
          if (event.key === "Tab") {
            setOpen(false);
            return;
          }
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const current = open ? activeIndex : Math.max(0, selected);
            setActive(
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? options.length - 1
                  : Math.max(0, Math.min(options.length - 1, current + (event.key === "ArrowDown" ? 1 : -1))),
            );
            setOpen(true);
          } else if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) choose(activeIndex);
            else {
              setActive(Math.max(0, selected));
              setOpen(true);
            }
          } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = Date.now();
            search.current = {
              text: (now - search.current.time < 700 ? search.current.text : "") + event.key.toLowerCase(),
              time: now,
            };
            const match = options.findIndex((option) => option.label.toLowerCase().startsWith(search.current.text));
            if (match >= 0) {
              setActive(match);
              setOpen(true);
            }
          }
        }}
      >
        <span className="min-w-0 truncate">
          {options[selected] && <FormattedMcRuns runs={parseNameRuns(options[selected].name)} />}
        </span>
        <span aria-hidden="true">⌄</span>
      </button>
      {open && (
        <ul
          id={id}
          role="listbox"
          aria-label={label}
          className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded border border-[var(--tfmc-moss)] bg-[var(--tfmc-forest-deep)] p-1 shadow-lg"
        >
          {options.map((option, index) => (
            <li
              key={option.name}
              id={`${id}-${index}`}
              role="option"
              aria-selected={option.name === selectedKey}
              aria-label={option.label}
              title={option.label}
              className={`cursor-pointer break-words rounded px-2 py-1.5 text-sm ${index === activeIndex ? "bg-white/10 outline outline-1 outline-white/30" : ""}`}
              onPointerMove={() => setActive(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              <FormattedMcRuns runs={parseNameRuns(option.name)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
