"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  CharactersApiError,
  fetchMaskedTemplateBlob,
} from "../../../lib/characters/api";
import { composeMaskedFromBase } from "../../../lib/characters/maskedCompose";
import {
  assertWardrobeSkinPng,
  WARDROBE_INVALID_PNG_MESSAGE,
} from "../../../lib/characters/wardrobeSkin";
import type { ArmModel } from "../../../lib/skins/steveMannequin";
import { inferArmModel } from "../../../lib/skins/steveMannequin";
import FancyCheckbox from "../skins/FancyCheckbox";
import SkinMannequinPreview from "./SkinMannequinPreview";

type Props = {
  open: boolean;
  slotLabel: string;
  slotId: string;
  filled: boolean;
  canEquip: boolean;
  defaultEquipOnSave: boolean;
  /** Base slot only: offer create-masked checkbox. */
  canCreateMasked?: boolean;
  /** Default for create-masked (true when masked empty). */
  defaultCreateMasked?: boolean;
  /** Stored arm model when slot already filled (wide = default). */
  defaultArmModel?: ArmModel;
  /** Needed to load masked template for live preview. */
  sessionToken?: string | null;
  existingTextureSrc: string | null;
  /** Current custom/default name shown in the field */
  initialDisplayName: string;
  /** Placeholder when field empty (defaults to slot default label) */
  namePlaceholder: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: {
    file: File | null;
    equip: boolean;
    displayName: string | null;
    createMasked: boolean;
    armModel: ArmModel;
  }) => void;
  onClear?: () => void;
};

const NAME_MAX = 24;

export default function WardrobeSlotModal({
  open,
  slotLabel,
  slotId,
  filled,
  canEquip,
  defaultEquipOnSave,
  canCreateMasked = false,
  defaultCreateMasked = false,
  defaultArmModel = "default",
  sessionToken = null,
  existingTextureSrc,
  initialDisplayName,
  namePlaceholder,
  saving,
  error,
  onClose,
  onSave,
  onClear,
}: Props) {
  const titleId = useId();
  const switchId = useId();
  const armSwitchId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [armModel, setArmModel] = useState<ArmModel>("default");
  const [equipOnSave, setEquipOnSave] = useState(defaultEquipOnSave);
  const [createMasked, setCreateMasked] = useState(defaultCreateMasked);
  const [previewMode, setPreviewMode] = useState<"base" | "masked">("base");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [maskedPreviewUrl, setMaskedPreviewUrl] = useState<string | null>(null);
  const [maskedPreviewBusy, setMaskedPreviewBusy] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName);

  useEffect(() => {
    if (!open) return;
    setFile(null);
    setLocalErr(null);
    setArmModel(defaultArmModel);
    setEquipOnSave(defaultEquipOnSave);
    setCreateMasked(defaultCreateMasked);
    setPreviewMode("base");
    setPreviewUrl(null);
    setMaskedPreviewUrl(null);
    setMaskedPreviewBusy(false);
    setDisplayName(initialDisplayName);
    const t = window.setTimeout(() => inputRef.current?.focus(), 20);
    return () => window.clearTimeout(t);
  }, [
    open,
    defaultEquipOnSave,
    defaultCreateMasked,
    defaultArmModel,
    slotId,
    initialDisplayName,
  ]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Live compose masked preview when checkbox + file are ready
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    async function run() {
      if (!createMasked || !file || !canCreateMasked || !sessionToken) {
        setMaskedPreviewUrl(null);
        setMaskedPreviewBusy(false);
        if (!createMasked) setPreviewMode("base");
        return;
      }
      setMaskedPreviewBusy(true);
      try {
        const template = await fetchMaskedTemplateBlob(sessionToken);
        if (cancelled) return;
        const composed = await composeMaskedFromBase(file, template);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(composed);
        setMaskedPreviewUrl(objectUrl);
      } catch (err) {
        if (cancelled) return;
        setMaskedPreviewUrl(null);
        setPreviewMode("base");
        const msg =
          err instanceof CharactersApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not preview masked skin";
        setLocalErr(msg);
      } finally {
        if (!cancelled) setMaskedPreviewBusy(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [createMasked, file, canCreateMasked, sessionToken]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const showMaskedToggle =
    canCreateMasked && createMasked && Boolean(file);
  const previewSource =
    showMaskedToggle && previewMode === "masked" && maskedPreviewUrl
      ? maskedPreviewUrl
      : previewUrl || existingTextureSrc;
  const trimmedName = displayName.trim();
  const nameChanged =
    trimmedName !== String(initialDisplayName || "").trim();
  const canSave =
    !localErr &&
    !saving &&
    (Boolean(file) || (filled && (nameChanged || armModel !== defaultArmModel)));

  async function onPick(f: File | null) {
    setLocalErr(null);
    setFile(null);
    setPreviewMode("base");
    if (!f) return;
    try {
      await assertWardrobeSkinPng(f);
    } catch (err) {
      setLocalErr(
        err instanceof Error ? err.message : WARDROBE_INVALID_PNG_MESSAGE
      );
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    setFile(f);
    // Detect once for a new upload; preview reloads must preserve manual choices.
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      setArmModel(inferArmModel(img));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_72%,black)]/80 p-4 backdrop-blur-[2px] sm:items-center"
      role="presentation"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[var(--tfmc-forest)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-[family-name:var(--font-display)] text-xl text-[var(--tfmc-cream)]"
        >
          {slotLabel}
        </h2>
        <p className="mt-1 text-sm text-[var(--tfmc-mist)]">64×64 PNG skin.</p>
        {slotId === "masked" ? (
          <p className="mt-2 text-sm text-[var(--tfmc-stone)]">
            Tip: match your Base skin&apos;s head.
          </p>
        ) : null}

        <div className="mt-4 flex justify-center">
          <div className="relative h-56 w-36 overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)]">
            <SkinMannequinPreview
              source={previewSource}
              armModel={armModel}
              className="h-full w-full"
              downloadFilename={
                previewSource
                  ? showMaskedToggle && previewMode === "masked"
                    ? `wardrobe-${slotId}-masked.png`
                    : `wardrobe-${slotId}.png`
                  : null
              }
            />
            {showMaskedToggle && maskedPreviewBusy ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,black)]/50 text-xs text-[var(--tfmc-mist)]">
                Loading…
              </div>
            ) : null}
          </div>
        </div>
        {showMaskedToggle ? (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <span
              className={
                previewMode === "base"
                  ? "text-[var(--tfmc-cream)]"
                  : "text-[var(--tfmc-stone)]"
              }
            >
              Base
            </span>
            <button
              type="button"
              id={switchId}
              role="switch"
              aria-checked={previewMode === "masked"}
              aria-label="Preview masked version"
              disabled={maskedPreviewBusy || !maskedPreviewUrl}
              onClick={() =>
                setPreviewMode((m) => (m === "base" ? "masked" : "base"))
              }
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
                previewMode === "masked"
                  ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,black)]"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 left-0.5 rounded-full bg-[var(--tfmc-cream)] shadow transition-transform ${
                  previewMode === "masked" ? "translate-x-5" : "translate-x-0"
                }`}
                style={{ height: "1.125rem", width: "1.125rem" }}
              />
            </button>
            <span
              className={
                previewMode === "masked"
                  ? "text-[var(--tfmc-cream)]"
                  : "text-[var(--tfmc-stone)]"
              }
            >
              Masked
            </span>
          </div>
        ) : null}
        {previewSource ? (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <span
              className={
                armModel === "default"
                  ? "text-[var(--tfmc-cream)]"
                  : "text-[var(--tfmc-stone)]"
              }
            >
              Wide
            </span>
            <button
              type="button"
              id={armSwitchId}
              role="switch"
              aria-checked={armModel === "slim"}
              aria-label="Slim arms"
              disabled={saving}
              onClick={() =>
                setArmModel((m) => (m === "slim" ? "default" : "slim"))
              }
              className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40 ${
                armModel === "slim"
                  ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)]"
                  : "border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_80%,black)]"
              }`}
            >
              <span
                aria-hidden
                className={`absolute top-0.5 left-0.5 rounded-full bg-[var(--tfmc-cream)] shadow transition-transform ${
                  armModel === "slim" ? "translate-x-5" : "translate-x-0"
                }`}
                style={{ height: "1.125rem", width: "1.125rem" }}
              />
            </button>
            <span
              className={
                armModel === "slim"
                  ? "text-[var(--tfmc-cream)]"
                  : "text-[var(--tfmc-stone)]"
              }
            >
              Slim
            </span>
          </div>
        ) : null}

        <label className="mt-4 flex flex-col gap-1.5 text-sm text-[var(--tfmc-cream)]">
          Name{" "}
          <span className="font-normal text-[var(--tfmc-stone)]">(optional)</span>
          <input
            type="text"
            maxLength={NAME_MAX}
            value={displayName}
            disabled={saving}
            placeholder={namePlaceholder}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,black)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)]"
            onChange={(e) => setDisplayName(e.target.value.slice(0, NAME_MAX))}
          />
        </label>

        <label className="mt-4 flex flex-col gap-1.5 text-sm text-[var(--tfmc-cream)]">
          Skin file
          <input
            ref={inputRef}
            type="file"
            accept="image/png,.png"
            disabled={saving}
            className="text-xs text-[var(--tfmc-mist)] file:mr-3 file:rounded-sm file:border-0 file:bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] file:px-3 file:py-1.5 file:text-[var(--tfmc-cream)]"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void onPick(f);
              e.target.value = "";
            }}
          />
        </label>

        {canEquip ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-[var(--tfmc-cream)]">
            <FancyCheckbox
              checked={equipOnSave}
              disabled={saving || !file}
              onChange={setEquipOnSave}
            />
            <span>Equip on save</span>
          </label>
        ) : null}

        {canCreateMasked ? (
          <label className="mt-3 flex cursor-pointer items-start gap-2.5 text-sm text-[var(--tfmc-cream)]">
            <FancyCheckbox
              checked={createMasked}
              disabled={saving || !file}
              onChange={(checked) => {
                setCreateMasked(checked);
                if (!checked) setPreviewMode("base");
              }}
            />
            <span>
              Also make a Masked skin from this
              {defaultCreateMasked ? null : (
                <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">
                  (replaces your current Masked skin)
                </span>
              )}
            </span>
          </label>
        ) : null}

        {(localErr || error) && (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {localErr || error}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          {filled && onClear ? (
            <button
              type="button"
              disabled={saving}
              onClick={onClear}
              className="mr-auto rounded-sm border border-red-900/50 px-3 py-2 text-sm text-red-200 transition-colors hover:bg-red-950/40 disabled:opacity-50"
            >
              Clear
            </button>
          ) : null}
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-mist)] transition-colors hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return;
              const name =
                trimmedName.length === 0
                  ? null
                  : trimmedName.slice(0, NAME_MAX);
              onSave({
                file,
                equip: Boolean(file) && canEquip && equipOnSave,
                displayName: name,
                createMasked: Boolean(file) && canCreateMasked && createMasked,
                armModel,
              });
            }}
            className="inline-flex min-w-[7rem] items-center justify-center gap-2 rounded-sm bg-[var(--tfmc-accent)] px-3 py-2 text-sm font-medium text-[var(--tfmc-ink)] transition-opacity disabled:opacity-50"
          >
            {saving ? (
              <>
                <span
                  className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--tfmc-ink)] border-t-transparent"
                  aria-hidden
                />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
