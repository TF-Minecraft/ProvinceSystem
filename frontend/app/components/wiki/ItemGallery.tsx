"use client";

import { useState, type KeyboardEvent } from "react";

export type ItemGalleryItem = { name: string; image: string; detail?: string };

export default function ItemGallery({
  items,
  centeredSelectors = false,
  selectorColumns = 3,
  widePreview = false,
}: {
  items: ItemGalleryItem[];
  centeredSelectors?: boolean;
  selectorColumns?: 2 | 3;
  widePreview?: boolean;
}) {
  const [selectedName, setSelectedName] = useState(items[0]?.name ?? "");
  const selected = items.find((item) => item.name === selectedName) ?? items[0];
  // Reserve the detail slot for the whole gallery, not just the selected item, so the
  // panel keeps one height no matter which item is selected (or whether it has a detail).
  const hasDetail = items.some((item) => item.detail);
  if (!selected) return null;

  const selectWithKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | undefined;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % items.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    setSelectedName(items[nextIndex].name);
    const buttons = event.currentTarget.closest("ul")?.querySelectorAll<HTMLButtonElement>("button");
    buttons?.[nextIndex]?.focus();
  };

  // The preview column is a fixed 20rem so a one-line `detail` fits without wrapping;
  // the selector grid takes whatever is left.
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <ul
        className={`grid self-start auto-rows-fr grid-cols-2 gap-2 ${
          selectorColumns === 2 ? "sm:grid-cols-2" : "sm:grid-cols-3"
        }`}
      >
        {items.map((item, index) => (
          <li key={item.name}>
            <button
              type="button"
              aria-pressed={item.name === selected.name}
              onClick={() => setSelectedName(item.name)}
              onKeyDown={(event) => selectWithKeyboard(event, index)}
              className={`min-h-12 h-full w-full rounded border px-2 py-2 text-sm transition-colors ${
                centeredSelectors ? "flex items-center justify-center text-center" : "text-left"
              } ${
                item.name === selected.name
                  ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] text-[var(--tfmc-cream)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-accent)_55%,transparent)] hover:text-[var(--tfmc-cream)]"
              }`}
            >
              {item.name}
            </button>
          </li>
        ))}
      </ul>
      <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] p-5 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={selected.image}
          src={selected.image}
          alt={selected.name}
          className="h-32 w-32 [image-rendering:pixelated]"
        />
        <h3
          className={`mt-4 max-w-full font-[family-name:var(--font-fraunces)] text-[var(--tfmc-cream)] ${
            widePreview ? "whitespace-nowrap text-lg sm:text-xl" : "text-xl"
          }`}
        >
          {selected.name}
        </h3>
        {hasDetail ? (
          <p className="mt-2 flex min-h-10 items-center text-sm leading-5 text-[var(--tfmc-mist)]">
            {selected.detail ?? ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
