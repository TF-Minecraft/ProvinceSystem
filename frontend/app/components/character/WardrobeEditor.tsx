"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CharactersApiError,
  clearWardrobeSlot,
  fetchMaskedTemplateBlob,
  fetchWardrobeTextureBlob,
  getWardrobe,
  renameWardrobeSlot,
  setWardrobeActive,
  uploadWardrobeSlot,
  wardrobeSlotLabel,
  WARDROBE_DEFAULT_LABELS,
  type SlotLimits,
  type WardrobeResponse,
  type WardrobeSlot,
} from "../../../lib/characters/api";
import { composeMaskedFromBase } from "../../../lib/characters/maskedCompose";
import {
  armModelToWardrobeModel,
  lockLabelForSlot,
  wardrobeSlotToArmModel,
} from "../../../lib/characters/wardrobeRanks";
import type { ArmModel } from "../../../lib/skins/steveMannequin";
import WardrobeSlotFrame from "./WardrobeSlotFrame";
import WardrobeSlotModal from "./WardrobeSlotModal";

const SLOT_ORDER = ["base", "extra_1", "extra_2", "masked"] as const;

export type WardrobeDraftFiles = Partial<
  Record<(typeof SLOT_ORDER)[number], File | null>
>;

export type WardrobeDraftNames = Partial<
  Record<(typeof SLOT_ORDER)[number], string>
>;

export type WardrobeDraftModels = Partial<
  Record<(typeof SLOT_ORDER)[number], ArmModel>
>;

type LiveProps = {
  mode: "live";
  characterId: string;
  sessionToken: string;
  slotLimits?: SlotLimits;
  /** When true, skip API and show empty slots. */
  uiDev?: boolean;
  /** UI-dev: how many swappable slots are unlocked (1–3). Always shows 3 frames. */
  uiDevSwappableSlots?: number;
};

type DraftProps = {
  mode: "draft";
  slotLimits?: SlotLimits;
  /** Player swappable slot count (1–3). */
  swappableSlots?: number;
  /** For fetching masked template during auto-compose. */
  sessionToken?: string;
  draftFiles: WardrobeDraftFiles;
  draftNames: WardrobeDraftNames;
  draftModels: WardrobeDraftModels;
  onDraftFilesChange: (next: WardrobeDraftFiles) => void;
  onDraftNamesChange: (next: WardrobeDraftNames) => void;
  onDraftModelsChange: (next: WardrobeDraftModels) => void;
  /** True when last base save used create-masked (for pending upload flag). */
  onAutoMaskedChange?: (value: boolean) => void;
};

export type WardrobeEditorProps = LiveProps | DraftProps;

function slotUnlocked(slot: string, swappable: number): boolean {
  if (slot === "base" || slot === "masked") return true;
  if (slot === "extra_1") return swappable >= 2;
  if (slot === "extra_2") return swappable >= 3;
  return false;
}

/** Swappable fill order: Skin 2 needs Base, Skin 3 needs Skin 2. */
function fillOrderOk(
  slot: string,
  filled: (id: string) => boolean
): { ok: boolean; message?: string } {
  if (slot === "extra_1" && !filled("base")) {
    return { ok: false, message: "Upload Base before Skin 2" };
  }
  if (slot === "extra_2" && !filled("extra_1")) {
    return { ok: false, message: "Upload Skin 2 before Skin 3" };
  }
  return { ok: true };
}

const SWAPPABLE_ORDER = ["base", "extra_1", "extra_2"] as const;

function compactDraftSwappable(
  files: WardrobeDraftFiles,
  names: WardrobeDraftNames,
  models: WardrobeDraftModels,
  cleared: string
): {
  files: WardrobeDraftFiles;
  names: WardrobeDraftNames;
  models: WardrobeDraftModels;
} {
  if (cleared === "masked") {
    const nextFiles = { ...files, masked: null };
    const nextNames = { ...names };
    const nextModels = { ...models };
    delete nextNames.masked;
    delete nextModels.masked;
    return { files: nextFiles, names: nextNames, models: nextModels };
  }
  const packed: { id: string; file: File; name?: string; model?: ArmModel }[] =
    [];
  for (const id of SWAPPABLE_ORDER) {
    if (id === cleared) continue;
    const f = files[id];
    if (f instanceof File) {
      packed.push({
        id,
        file: f,
        name: names[id],
        model: models[id],
      });
    }
  }
  const nextFiles: WardrobeDraftFiles = {
    ...files,
    base: null,
    extra_1: null,
    extra_2: null,
  };
  const nextNames: WardrobeDraftNames = { ...names };
  const nextModels: WardrobeDraftModels = { ...models };
  delete nextNames.base;
  delete nextNames.extra_1;
  delete nextNames.extra_2;
  delete nextModels.base;
  delete nextModels.extra_1;
  delete nextModels.extra_2;
  packed.forEach((entry, i) => {
    const dest = SWAPPABLE_ORDER[i];
    nextFiles[dest] = entry.file;
    if (entry.name) nextNames[dest] = entry.name;
    if (entry.model) nextModels[dest] = entry.model;
  });
  return { files: nextFiles, names: nextNames, models: nextModels };
}

function emptySlots(swappable: number): WardrobeSlot[] {
  return SLOT_ORDER.map((slot) => ({
    slot,
    unlocked: slotUnlocked(slot, swappable),
    filled: false,
    display_name: WARDROBE_DEFAULT_LABELS[slot],
    apply_pending: false,
  }));
}

function hasPendingSlots(data: WardrobeResponse | null): boolean {
  if (!data) return false;
  return data.slots.some(
    (s) => s.filled && s.unlocked && Boolean(s.apply_pending)
  );
}

export default function WardrobeEditor(props: WardrobeEditorProps) {
  const isDraft = props.mode === "draft";
  const slotLimits = props.slotLimits;
  const swappable = isDraft
    ? Math.max(1, Math.min(3, props.swappableSlots ?? 1))
    : 1;

  const [wardrobe, setWardrobe] = useState<WardrobeResponse | null>(null);
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [modalSlot, setModalSlot] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [equipping, setEquipping] = useState<string | null>(null);

  const revokeTextures = useCallback((map: Record<string, string>) => {
    for (const url of Object.values(map)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    }
  }, []);

  const loadTextures = useCallback(
    async (token: string, characterId: string, data: WardrobeResponse) => {
      const next: Record<string, string> = {};
      await Promise.all(
        data.slots
          .filter((s) => s.filled)
          .map(async (s) => {
            try {
              next[s.slot] = await fetchWardrobeTextureBlob(
                token,
                characterId,
                s.slot,
                s.updated_at ?? Date.now()
              );
            } catch {
              /* leave empty */
            }
          })
      );
      setTextures((prev) => {
        revokeTextures(prev);
        return next;
      });
    },
    [revokeTextures]
  );

  // Live load
  useEffect(() => {
    if (isDraft) return;
    const { characterId, sessionToken, uiDev } = props;
    const uiDevUnlocked = Math.max(
      1,
      Math.min(3, Number(props.uiDevSwappableSlots) || 1)
    );
    let cancelled = false;
    setError(null);
    void (async () => {
      try {
        if (uiDev) {
          if (!cancelled) {
            setWardrobe({
              character_id: characterId,
              active_slot: null,
              swappable_slots: uiDevUnlocked,
              slots: emptySlots(uiDevUnlocked),
            });
          }
          return;
        }
        const w = await getWardrobe(sessionToken, characterId);
        if (cancelled) return;
        setWardrobe(w);
        await loadTextures(sessionToken, characterId, w);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof CharactersApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load wardrobe"
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDraft,
    isDraft ? null : props.characterId,
    isDraft ? null : props.sessionToken,
    isDraft ? null : props.uiDev,
    isDraft ? null : props.uiDevSwappableSlots,
  ]);

  // Poll while any slot is apply-pending
  useEffect(() => {
    if (isDraft || props.mode !== "live" || props.uiDev) return;
    if (!hasPendingSlots(wardrobe)) return;
    const { characterId, sessionToken } = props;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const w = await getWardrobe(sessionToken, characterId);
          if (cancelled) return;
          setWardrobe(w);
          if (!hasPendingSlots(w)) {
            await loadTextures(sessionToken, characterId, w);
          }
        } catch {
          /* keep last good state */
        }
      })();
    }, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isDraft,
    wardrobe,
    isDraft ? null : props.mode === "live" ? props.characterId : null,
    isDraft ? null : props.mode === "live" ? props.sessionToken : null,
  ]);

  // Draft texture blobs from files
  useEffect(() => {
    if (!isDraft) return;
    const files = props.draftFiles;
    const next: Record<string, string> = {};
    for (const id of SLOT_ORDER) {
      const f = files[id];
      if (f) next[id] = URL.createObjectURL(f);
    }
    setTextures((prev) => {
      revokeTextures(prev);
      return next;
    });
    return () => revokeTextures(next);
  }, [isDraft, isDraft ? props.draftFiles : null, revokeTextures]);

  useEffect(() => {
    return () => {
      revokeTextures(textures);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const liveSwappable = wardrobe?.swappable_slots ?? swappable;

  const slotsById = useMemo(() => {
    const map = new Map<string, WardrobeSlot>();
    if (isDraft) {
      for (const id of SLOT_ORDER) {
        const file = props.draftFiles[id];
        const name = props.draftNames[id];
        map.set(id, {
          slot: id,
          unlocked: slotUnlocked(id, swappable),
          filled: Boolean(file),
          model: armModelToWardrobeModel(props.draftModels[id] ?? "default"),
          display_name: wardrobeSlotLabel(id, name),
          custom_name: Boolean(String(name || "").trim()),
          apply_pending: false,
        });
      }
      return map;
    }
    for (const s of wardrobe?.slots || []) {
      map.set(String(s.slot), s);
    }
    for (const id of SLOT_ORDER) {
      if (!map.has(id)) {
        map.set(id, {
          slot: id,
          unlocked: slotUnlocked(id, liveSwappable),
          filled: false,
          display_name: WARDROBE_DEFAULT_LABELS[id],
          apply_pending: false,
        });
      }
    }
    return map;
  }, [
    isDraft,
    isDraft ? props.draftFiles : null,
    isDraft ? props.draftNames : null,
    isDraft ? props.draftModels : null,
    wardrobe,
    swappable,
    liveSwappable,
  ]);

  const activeSlot =
    !isDraft && wardrobe?.active_slot ? String(wardrobe.active_slot) : null;
  const modalData = modalSlot ? slotsById.get(modalSlot) : null;
  const swappableIds = SLOT_ORDER.filter((s) => s !== "masked");

  async function handleSave(input: {
    file: File | null;
    equip: boolean;
    displayName: string | null;
    createMasked: boolean;
    armModel: ArmModel;
  }) {
    if (!modalSlot) return;
    if (isDraft) {
      const order = fillOrderOk(modalSlot, (id) =>
        Boolean(props.draftFiles[id as keyof WardrobeDraftFiles])
      );
      if (input.file && !order.ok) {
        setModalError(order.message || "Upload earlier skins first");
        return;
      }
      let nextFiles = { ...props.draftFiles };
      if (input.file) {
        nextFiles = { ...nextFiles, [modalSlot]: input.file };
        if (modalSlot === "base" && input.createMasked) {
          const token = props.sessionToken;
          if (!token) {
            setModalError("Please log in again.");
            return;
          }
          try {
            setSaving(true);
            const template = await fetchMaskedTemplateBlob(token);
            const maskedFile = await composeMaskedFromBase(
              input.file,
              template
            );
            nextFiles = { ...nextFiles, masked: maskedFile };
            props.onAutoMaskedChange?.(true);
          } catch (err) {
            setModalError(
              err instanceof CharactersApiError
                ? err.message
                : err instanceof Error
                  ? err.message
                  : "Could not create masked skin"
            );
            setSaving(false);
            return;
          } finally {
            setSaving(false);
          }
        } else if (modalSlot === "base" && !input.createMasked) {
          props.onAutoMaskedChange?.(false);
        } else if (modalSlot === "masked") {
          props.onAutoMaskedChange?.(false);
        }
      }
      props.onDraftFilesChange(nextFiles);
      const nextNames = { ...props.draftNames };
      if (input.displayName) {
        nextNames[modalSlot as keyof WardrobeDraftNames] = input.displayName;
      } else {
        delete nextNames[modalSlot as keyof WardrobeDraftNames];
      }
      props.onDraftNamesChange(nextNames);
      if (nextFiles[modalSlot as keyof WardrobeDraftFiles]) {
        const nextModels = { ...props.draftModels };
        nextModels[modalSlot as keyof WardrobeDraftModels] = input.armModel;
        props.onDraftModelsChange(nextModels);
      }
      setModalSlot(null);
      setModalError(null);
      return;
    }
    const { characterId, sessionToken, uiDev } = props;
    if (uiDev) {
      setModalError("UI dev mode cannot upload.");
      return;
    }
    const order = fillOrderOk(modalSlot, (id) =>
      Boolean(slotsById.get(id)?.filled)
    );
    if (input.file && !order.ok) {
      setModalError(order.message || "Upload earlier skins first");
      return;
    }
    setSaving(true);
    setModalError(null);
    try {
      let uploadFile = input.file;
      if (!uploadFile && input.armModel !== wardrobeSlotToArmModel(modalData?.model)) {
        // Changing arm geometry requires a newly signed texture, even for the same PNG.
        const url = await fetchWardrobeTextureBlob(sessionToken, characterId, modalSlot);
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error("Could not load existing skin");
          uploadFile = new File([await response.blob()], "skin.png", { type: "image/png" });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      let w: WardrobeResponse;
      if (uploadFile) {
        w = await uploadWardrobeSlot(
          sessionToken,
          characterId,
          modalSlot,
          uploadFile,
          input.displayName,
          {
            createMasked: input.createMasked,
            model: armModelToWardrobeModel(input.armModel),
          }
        );
        if (input.equip && modalSlot !== "masked") {
          w = await setWardrobeActive(sessionToken, characterId, modalSlot);
        }
      } else {
        w = await renameWardrobeSlot(
          sessionToken,
          characterId,
          modalSlot,
          input.displayName
        );
      }
      setWardrobe(w);
      if (uploadFile) {
        await loadTextures(sessionToken, characterId, w);
      }
      setModalSlot(null);
    } catch (err) {
      setModalError(
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleClear() {
    if (!modalSlot) return;
    if (isDraft) {
      const compacted = compactDraftSwappable(
        props.draftFiles,
        props.draftNames,
        props.draftModels,
        modalSlot
      );
      props.onDraftFilesChange(compacted.files);
      props.onDraftNamesChange(compacted.names);
      props.onDraftModelsChange(compacted.models);
      if (modalSlot === "base" || modalSlot === "masked") {
        props.onAutoMaskedChange?.(false);
      }
      setModalSlot(null);
      return;
    }
    const { characterId, sessionToken, uiDev } = props;
    if (uiDev) return;
    setSaving(true);
    setModalError(null);
    try {
      const w = await clearWardrobeSlot(sessionToken, characterId, modalSlot);
      setWardrobe(w);
      await loadTextures(sessionToken, characterId, w);
      setModalSlot(null);
    } catch (err) {
      setModalError(
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Clear failed"
      );
    } finally {
      setSaving(false);
    }
  }

  function tryOpenSlot(id: string) {
    setModalError(null);
    if (!slotUnlocked(id, isDraft ? swappable : liveSwappable)) {
      setModalSlot(id);
      return;
    }
    const filled = (sid: string) =>
      isDraft
        ? Boolean(props.draftFiles[sid as keyof WardrobeDraftFiles])
        : Boolean(slotsById.get(sid)?.filled);
    // Opening empty extra out of order → block; opening filled is ok (edit/clear)
    if (!filled(id)) {
      const order = fillOrderOk(id, filled);
      if (!order.ok) {
        setError(order.message || "Upload earlier skins first");
        return;
      }
    }
    setError(null);
    setModalSlot(id);
  }

  async function handleEquip(slot: string) {
    if (isDraft || slot === "masked") return;
    const data = slotsById.get(slot);
    if (data?.apply_pending) return;
    const { characterId, sessionToken, uiDev } = props;
    if (uiDev) return;
    setEquipping(slot);
    setError(null);
    try {
      const w = await setWardrobeActive(sessionToken, characterId, slot);
      setWardrobe(w);
    } catch (err) {
      setError(
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Equip failed"
      );
    } finally {
      setEquipping(null);
    }
  }

  function labelFor(id: string, slot: WardrobeSlot): string {
    return wardrobeSlotLabel(id, slot.display_name);
  }

  return (
    <div className="flex flex-col gap-6">
      {error ? (
        <p className="text-sm text-red-300" role="alert">
          {error}
        </p>
      ) : null}

      <section>
        {!isDraft ? (
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
            Skins
          </h2>
        ) : null}
        <div className="flex flex-wrap gap-4">
          {swappableIds.map((id) => {
            const slot = slotsById.get(id)!;
            const lock = !slot.unlocked
              ? lockLabelForSlot(id, slotLimits)
              : null;
            return (
              <WardrobeSlotFrame
                key={id}
                slot={slot}
                label={labelFor(id, slot)}
                active={!isDraft && activeSlot === id}
                textureSrc={textures[id] || null}
                lockRuns={lock?.runs}
                lockPlain={lock?.plain}
                onOpen={() => tryOpenSlot(id)}
                onEquip={
                  !isDraft &&
                  slot.filled &&
                  slot.unlocked &&
                  !slot.apply_pending
                    ? () => void handleEquip(id)
                    : undefined
                }
                equipping={equipping === id}
              />
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
          Masked
        </h2>
        <p className="mb-3 text-sm text-[var(--tfmc-mist)]">
          Worn automatically while you wear a mask.
        </p>
        {(() => {
          const slot = slotsById.get("masked")!;
          return (
            <WardrobeSlotFrame
              slot={slot}
              label={labelFor("masked", slot)}
              active={false}
              textureSrc={textures.masked || null}
              onOpen={() => {
                setModalError(null);
                setModalSlot("masked");
              }}
            />
          );
        })()}
      </section>

      <WardrobeSlotModal
        open={Boolean(modalSlot && modalData)}
        slotId={modalSlot || ""}
        slotLabel={
          modalSlot && modalData
            ? labelFor(modalSlot, modalData)
            : "Skin"
        }
        filled={Boolean(modalData?.filled)}
        canEquip={!isDraft && modalSlot !== "masked"}
        defaultEquipOnSave={
          !isDraft &&
          modalSlot !== "masked" &&
          (!activeSlot || activeSlot === modalSlot)
        }
        canCreateMasked={modalSlot === "base"}
        defaultCreateMasked={
          modalSlot === "base" && !Boolean(slotsById.get("masked")?.filled)
        }
        defaultArmModel={
          isDraft && modalSlot
            ? props.draftModels[modalSlot as keyof WardrobeDraftModels] ??
              "default"
            : wardrobeSlotToArmModel(modalData?.model)
        }
        sessionToken={
          isDraft
            ? props.sessionToken
            : props.mode === "live"
              ? props.sessionToken
              : null
        }
        existingTextureSrc={modalSlot ? textures[modalSlot] || null : null}
        initialDisplayName={
          modalSlot && modalData?.custom_name
            ? String(modalData.display_name || "")
            : isDraft && modalSlot
              ? String(props.draftNames[modalSlot as keyof WardrobeDraftNames] || "")
              : ""
        }
        namePlaceholder={
          modalSlot
            ? WARDROBE_DEFAULT_LABELS[modalSlot] || "Skin"
            : "Skin"
        }
        saving={saving}
        error={modalError}
        onClose={() => {
          if (!saving) {
            setModalSlot(null);
            setModalError(null);
          }
        }}
        onSave={(input) => void handleSave(input)}
        onClear={modalData?.filled ? () => void handleClear() : undefined}
      />
    </div>
  );
}
