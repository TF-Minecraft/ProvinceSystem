"use client";

import { useEffect, useMemo, useState } from "react";
import { effectLabel } from "../../../lib/drinks/constants";

type EffectRow = { type: string; level: number; duration: number };

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (row: EffectRow) => void;
  effectChoices: string[];
  initial?: EffectRow | null;
  title: string;
};

const fieldClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)]";

export default function EffectPickerModal({ open, onClose, onSave, effectChoices, initial, title }: Props) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState(initial?.type || effectChoices[0] || "");
  const [level, setLevel] = useState(initial?.level || 1);
  const [duration, setDuration] = useState(initial?.duration || 20);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setType(initial?.type || effectChoices[0] || "");
    setLevel(initial?.level || 1);
    setDuration(initial?.duration || 20);
  }, [open, initial, effectChoices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return effectChoices.filter((id) => {
      if (!q) return true;
      return id.includes(q) || effectLabel(id).toLowerCase().includes(q);
    });
  }, [effectChoices, search]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col gap-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[var(--tfmc-forest-deep)] p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-[var(--tfmc-stone)]">{title}</h3>
          <button
            type="button"
            className="text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <input
          className={fieldClass}
          placeholder="Search effects…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="min-h-0 max-h-56 flex-1 overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
          {filtered.length === 0 ? (
            <p className="p-3 text-sm text-[var(--tfmc-mist)]">No matches.</p>
          ) : (
            <ul className="flex flex-col">
              {filtered.map((id) => {
                const selected = type === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setType(id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                        selected
                          ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,transparent)] text-[var(--tfmc-cream)]"
                          : "text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                      }`}
                    >
                      <span>{effectLabel(id)}</span>
                      {selected ? <span className="text-xs text-[var(--tfmc-accent)]">Selected</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--tfmc-mist)]">Level</span>
            <input
              type="number"
              min={1}
              className={fieldClass}
              value={level}
              onChange={(e) => setLevel(Number(e.target.value))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--tfmc-mist)]">Duration (seconds)</span>
            <input
              type="number"
              min={1}
              className={fieldClass}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded-sm px-3 py-2 text-sm text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!type.trim() || level < 1 || duration < 1}
            className="rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-50"
            onClick={() => {
              if (!type.trim()) return;
              onSave({
                type: type.trim().toLowerCase(),
                level: Math.max(1, Math.floor(level)),
                duration: Math.max(1, Math.floor(duration)),
              });
              onClose();
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
