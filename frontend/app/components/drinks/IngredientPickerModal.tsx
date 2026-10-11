"use client";

import { useEffect, useMemo, useState } from "react";
import type { DrinkIngredient } from "../../../lib/drinks/api";

type Props = {
  open: boolean;
  onClose: () => void;
  onSave: (row: { id: string; amount: number }) => void;
  ingredients: DrinkIngredient[];
  categories: Record<string, string>;
  initial?: { id: string; amount: number } | null;
  title: string;
};

const fieldClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)]";

export default function IngredientPickerModal({
  open,
  onClose,
  onSave,
  ingredients,
  categories,
  initial,
  title,
}: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState(initial?.id || "");
  const [amount, setAmount] = useState(initial?.amount || 1);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setSelectedId(initial?.id || "");
    setAmount(initial?.amount || 1);
  }, [open, initial]);

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const map = new Map<string, DrinkIngredient[]>();
    for (const item of ingredients) {
      const label = (item.label || item.id).toLowerCase();
      const id = item.id.toLowerCase();
      if (q && !label.includes(q) && !id.includes(q)) continue;
      const cat = (item.category || "other").trim() || "other";
      const list = map.get(cat) || [];
      list.push(item);
      map.set(cat, list);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const la = categories[a] || a;
      const lb = categories[b] || b;
      return la.localeCompare(lb);
    });
  }, [ingredients, categories, search]);

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
          placeholder="Search ingredients…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
        <div className="min-h-0 flex-1 overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)]">
          {grouped.length === 0 ? (
            <p className="p-3 text-sm text-[var(--tfmc-mist)]">No matches.</p>
          ) : (
            grouped.map(([cat, items]) => (
              <div
                key={cat}
                className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] last:border-b-0"
              >
                <div className="sticky top-0 bg-[color-mix(in_srgb,var(--tfmc-forest)_90%,black)] px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-mist)]">
                  {categories[cat] || cat}
                </div>
                <ul className="flex flex-col">
                  {items.map((item) => {
                    const selected = selectedId === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(item.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition ${
                            selected
                              ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_18%,transparent)] text-[var(--tfmc-cream)]"
                              : "text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                          }`}
                        >
                          <span>{item.label || item.id}</span>
                          {selected ? <span className="text-xs text-[var(--tfmc-accent)]">Selected</span> : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--tfmc-mist)]">Amount</span>
          <input
            type="number"
            min={1}
            className={`${fieldClass} w-28`}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
        </label>
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
            disabled={!selectedId.trim() || !Number.isFinite(amount) || amount < 1}
            className="rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-50"
            onClick={() => {
              if (!selectedId.trim()) return;
              onSave({ id: selectedId.trim(), amount: Math.floor(amount) });
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
