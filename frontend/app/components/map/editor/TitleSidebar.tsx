"use client";

import { useState } from "react";

import type { EditorTier } from "@/lib/map/api";

import { rgbStringToHex } from "../../../lib/map/titleRgb";
import { nextTitleId } from "../../../lib/map/editorIds";
import { getChildTierConfig } from "../../../lib/map/editor/editorTierConfig";
import type { EditorTitleEntry, TitleDraft } from "../../../hooks/useEditorDraft";
import TitleRgbPicker from "./TitleRgbPicker";

const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60";

const buttonClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] transition hover:brightness-110 hover:border-[var(--tfmc-accent)] active:scale-[0.98] disabled:opacity-60";

type TitleSidebarProps = {
  tier: EditorTier;
  draft: TitleDraft;
  selectedId: string | null;
  validationErrors?: string[];
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<EditorTitleEntry>) => void;
  onAdd: (id: string, entry: EditorTitleEntry) => void;
  onRemove: (id: string) => void;
};

export default function TitleSidebar({
  tier,
  draft,
  selectedId,
  validationErrors = [],
  onSelect,
  onUpdate,
  onAdd,
  onRemove,
}: TitleSidebarProps) {
  const [search, setSearch] = useState("");
  const [colourError, setColourError] = useState<string | null>(null);

  const isCountyTier = tier === "county";
  const childTierConfig = getChildTierConfig(tier);

  const filteredIds = Object.keys(draft)
    .filter((id) => {
      const name = draft[id]?.name ?? "";
      return name.toLowerCase().includes(search.trim().toLowerCase());
    })
    .sort((a, b) => {
      const nameA = draft[a]?.name ?? a;
      const nameB = draft[b]?.name ?? b;
      return nameA.localeCompare(nameB);
    });

  const selected = selectedId ? draft[selectedId] : null;
  const usedRgbs = Object.entries(draft)
    .filter(([id]) => id !== selectedId)
    .map(([, entry]) => entry.rgb);

  function handleNew() {
    const id = nextTitleId(tier, draft);
    const entry: EditorTitleEntry = {
      name: id,
      rgb: "128,128,128",
      ...(tier === "county" ? { provinces: [] } : { titles: [] }),
    };
    onAdd(id, entry);
  }

  function handleDelete() {
    if (!selectedId || !selected) return;
    const label = isCountyTier ? "county" : (childTierConfig?.deleteConfirmLabel ?? "title");
    const confirmed = window.confirm(`Delete ${label} "${selected.name}"?`);
    if (!confirmed) return;
    onRemove(selectedId);
  }

  const emptyStateText = isCountyTier
    ? "Select a county or create new."
    : (childTierConfig?.sidebarEmptyState ?? "Select a title or create a new one.");

  const newButtonLabel = isCountyTier ? "New county" : (childTierConfig?.newButtonLabel ?? "New title");

  const memberCountText =
    selected && childTierConfig ? childTierConfig.memberCountLabel(selected.titles?.length ?? 0) : null;

  return (
    <aside className="flex h-full min-h-[28rem] w-full flex-col gap-4 rounded-lg border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_35%,var(--tfmc-forest-deep))] p-4 shadow-lg">
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-[var(--tfmc-stone)]">Search titles</label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by name"
          className={inputClass}
        />
      </div>

      <div className="flex gap-2">
        <button type="button" className={buttonClass} onClick={handleNew}>
          {newButtonLabel}
        </button>
        <button type="button" className={buttonClass} onClick={handleDelete} disabled={!selectedId}>
          Delete
        </button>
      </div>

      {validationErrors.length > 0 ? (
        <div className="rounded-sm border border-[#e8a0a0]/40 bg-[#e8a0a0]/10 px-3 py-2">
          <p className="text-sm font-medium text-[#e8a0a0]">Save blocked:</p>
          <ul className="mt-1 list-inside list-disc text-sm text-[#e8a0a0]">
            {validationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul
        className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] p-1"
        role="listbox"
        aria-label="Titles"
      >
        {filteredIds.length === 0 ? (
          <li className="px-2 py-3 text-sm text-[var(--tfmc-mist)]">No titles match.</li>
        ) : (
          filteredIds.map((id) => {
            const entry = draft[id]!;
            const hex = rgbStringToHex(entry.rgb) ?? "#808080";
            const active = id === selectedId;
            return (
              <li key={id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onSelect(id)}
                  className={`flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition ${
                    active
                      ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_25%,transparent)] text-[var(--tfmc-cream)]"
                      : "text-[var(--tfmc-stone)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]"
                  }`}
                >
                  <span
                    className="inline-block h-4 w-4 shrink-0 rounded-sm border border-black/40"
                    style={{ backgroundColor: hex }}
                    aria-hidden
                  />
                  <span className="truncate">{entry.name}</span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      {selected && selectedId ? (
        <div className="flex flex-col gap-4 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pt-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-[var(--tfmc-stone)]" htmlFor="title-name-input">
              Name
            </label>
            <input
              id="title-name-input"
              type="text"
              value={selected.name}
              onChange={(e) => onUpdate(selectedId, { name: e.target.value })}
              className={inputClass}
            />
          </div>
          <TitleRgbPicker
            rgb={selected.rgb}
            onChange={(rgb) => onUpdate(selectedId, { rgb })}
            usedRgbs={usedRgbs}
            onError={setColourError}
          />
          {isCountyTier ? (
            <p className="text-sm text-[var(--tfmc-mist)]">{selected.provinces?.length ?? 0} provinces</p>
          ) : null}
          {memberCountText ? <p className="text-sm text-[var(--tfmc-mist)]">{memberCountText}</p> : null}
          {colourError ? (
            <p className="text-sm text-[#e8a0a0]" role="status">
              {colourError}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--tfmc-mist)]">{emptyStateText}</p>
      )}
    </aside>
  );
}
