"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSubmission, checkSubmissionConflict, getCatalog, SkinsApiError } from "../../../lib/skins/api";
import type { SkinsCatalog } from "../../../lib/skins/catalog";
import { filterStaffCategories } from "../../../lib/skins/catalog";
import { DEV_CATALOG_ENTITLEMENTS, DEV_SESSION_SKIN_KINDS } from "../../../lib/skins/entitlementsDev";
import { setLastSubmissionId } from "../../../lib/skins/session";
import {
  ARMOR_TIERS,
  baseSetLabel,
  baseSetPickerTitle,
  baseSetsForKind,
  defaultBaseSet,
} from "../../../lib/skins/baseSets";
import {
  assert3dPairBudgets,
  assertFileSize,
  expectedSizeForField,
  fileFieldsForKind,
  isBowFrameKind,
  isBookKind,
  isLargeTextureKind,
  isModel3dKind,
  isGunKind,
  pairBudgetHint,
  ARMOR_BODY_FIELDS,
  type SkinKind,
} from "../../../lib/skins/sizes";
import {
  NAME_STYLES,
  normalizePreviewHex,
  type NameStyle,
} from "../../../lib/skins/namePreview";
import FancyCheckbox from "./FancyCheckbox";
import KindPicker from "./KindPicker";
import ModelPreview from "./ModelPreview";
import ArmorPreview from "./ArmorPreview";
import NameColourPicker from "../shared/NameColourPicker";
import {
  DISPLAY_NAME_HINT,
  displayNameError,
} from "../../../lib/textValidation";
import {
  GRIP_Y_DEFAULT,
  GRIP_Y_MAX,
  GRIP_Y_MIN,
} from "../../../lib/skins/flatItemDisplay";
import { assertVanillaJavaBlockModelFile } from "../../../lib/skins/javaModel";

const MAX_TIERS = ARMOR_TIERS.length;

function isFlatPreviewKind(kind: SkinKind): boolean {
  return (
    kind === "handheld" ||
    kind === "large_handheld" ||
    kind === "bow" ||
    kind === "large_bow" ||
    kind === "crossbow"
  );
}

function resolveModelPreviewFiles(
  kind: SkinKind,
  files: Record<string, File | null>
): { model: File | null; texture: File | null } {
  if (isModel3dKind(kind)) {
    return {
      model: files.model ?? null,
      texture: files.texture ?? null,
    };
  }
  if (isGunKind(kind) || isFlatPreviewKind(kind)) {
    return {
      model: null,
      texture: files.texture ?? null,
    };
  }
  return { model: null, texture: null };
}

type Props = {
  sessionToken: string;
  /** Staff curated lane — category/scroll required. */
  staff?: boolean;
  /** From redeem / player meta (fallback: catalog defaults). */
  nameColourStops?: number;
  max3dPairBytes?: number;
  skinKinds?: string[] | null;
  allowArmor3dHelmet?: boolean;
  /** Override locked colour picker message (e.g. meta not synced yet). */
  colourLockedMessage?: string;
};

type TierEntry = {
  tier: string;
  /** Display suffix for this tier (default Iron/Steel/…). */
  alias: string;
  /** When true, helmet is model+texture instead of 16×16 icon. */
  helmet3d: boolean;
  /** Staff only: scroll id for this tier. */
  scroll: string;
  files: Record<string, File | null>;
};

const fieldLabel: Record<string, string> = {
  helmet: "Helmet (16×16)",
  helmet_texture: "Helmet texture (PNG)",
  helmet_model: "Helmet model (JSON)",
  chestplate: "Chestplate (16×16)",
  leggings: "Leggings (16×16)",
  boots: "Boots (16×16)",
  layer_1: "Layer 1 (64×32)",
  layer_2: "Layer 2 (64×32)",
  texture: "Texture (PNG)",
  model: "Model (JSON)",
  carry_model: "Carry model (JSON)",
  reload_model: "Reload model (JSON)",
  aim_model: "Aim model (JSON)",
  pull_0: "Pull 0",
  pull_1: "Pull 1",
  pull_2: "Pull 2",
  charged: "Charged",
  unsigned: "Unsigned cover (16×16)",
  signed: "Signed cover (16×16)",
};

function slotLabel(kind: SkinKind, field: string): string {
  if (kind === "armor_set") {
    return fieldLabel[field] || field;
  }
  if (isModel3dKind(kind) || isGunKind(kind) || isBookKind(kind)) {
    return fieldLabel[field] || field;
  }
  const size = isLargeTextureKind(kind) ? "32×32" : "16×16";
  const base = fieldLabel[field] || field;
  if (field === "texture") {
    return isBowFrameKind(kind)
      ? `Standby texture (${size})`
      : `Texture (${size})`;
  }
  if (isBowFrameKind(kind)) {
    return `${base} (${size})`;
  }
  return `Texture (${size})`;
}

function acceptForField(field: string): string {
  if (
    field === "model" ||
    field.endsWith("_model") ||
    field === "helmet_model" ||
    field === "carry_model" ||
    field === "reload_model" ||
    field === "aim_model"
  ) {
    return "application/json,.json";
  }
  return "image/png,.png";
}

export default function UploadForm({
  sessionToken,
  staff = false,
  nameColourStops,
  max3dPairBytes,
  skinKinds,
  allowArmor3dHelmet = false,
  colourLockedMessage,
}: Props) {
  const router = useRouter();
  const resolvedKinds =
    skinKinds != null
      ? skinKinds
      : staff
        ? null
        : DEV_SESSION_SKIN_KINDS;
  const initialKind = (
    resolvedKinds == null
      ? "armor_set"
      : resolvedKinds.includes("armor_set")
        ? "armor_set"
        : resolvedKinds[0] || "handheld"
  ) as SkinKind;
  const [kind, setKind] = useState<SkinKind>(initialKind);
  const [baseSet, setBaseSet] = useState(defaultBaseSet(initialKind));
  const canUseArmor3dHelmet = staff || allowArmor3dHelmet;
  const [tiers, setTiers] = useState<TierEntry[]>([]);
  const [tierToAdd, setTierToAdd] = useState<string>("");
  /** Which added tier the armor mannequin preview shows. */
  const [previewArmorTier, setPreviewArmorTier] = useState<string>("");
  const [itemName, setItemName] = useState("");
  const [applyName, setApplyName] = useState(true);
  const [colours, setColours] = useState<string[]>(["#ffffff"]);
  const [styles, setStyles] = useState<NameStyle[]>([]);
  const [gripY, setGripY] = useState(GRIP_Y_DEFAULT);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<SkinsCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [scroll, setScroll] = useState("");
  const [bookPreviewUrls, setBookPreviewUrls] = useState<{
    unsigned: string | null;
    signed: string | null;
  }>({ unsigned: null, signed: null });

  useEffect(() => {
    setTiers([]);
    setTierToAdd("");
    setError(null);
    setBaseSet(defaultBaseSet(kind));
    setFiles({});
    setCategory("");
    setScroll("");
  }, [kind]);

  useEffect(() => {
    if (canUseArmor3dHelmet) return;
    setTiers((prev) => {
      if (!prev.some((t) => t.helmet3d)) return prev;
      return prev.map((t) => {
        if (!t.helmet3d) return t;
        const files = { ...t.files };
        delete files.helmet_model;
        delete files.helmet_texture;
        return { ...t, helmet3d: false, files };
      });
    });
  }, [canUseArmor3dHelmet]);

  useEffect(() => {
    const unsigned = files.unsigned
      ? URL.createObjectURL(files.unsigned)
      : null;
    const signed = files.signed ? URL.createObjectURL(files.signed) : null;
    setBookPreviewUrls({ unsigned, signed });
    return () => {
      if (unsigned) URL.revokeObjectURL(unsigned);
      if (signed) URL.revokeObjectURL(signed);
    };
  }, [files.unsigned, files.signed]);

  useEffect(() => {
    let cancelled = false;
    setCatalogError(null);
    void getCatalog()
      .then((data) => {
        if (!cancelled) setCatalog(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setCatalog(null);
        setCatalogError(
          err instanceof SkinsApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Could not load catalog"
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalogDefaults = catalog?.entitlements?.defaults;
  const resolvedColourStops =
    nameColourStops !== undefined
      ? nameColourStops
      : catalogDefaults?.name_colour_stops ?? 0;
  const resolvedPairBytes =
    max3dPairBytes !== undefined && max3dPairBytes > 0
      ? max3dPairBytes
      : catalogDefaults?.max_3d_pair_bytes &&
          catalogDefaults.max_3d_pair_bytes > 0
        ? catalogDefaults.max_3d_pair_bytes
        : process.env.NEXT_PUBLIC_CHARACTER_UI_DEV === "1"
          ? DEV_CATALOG_ENTITLEMENTS.defaults.max_3d_pair_bytes
          : 0;
  const pairHint = pairBudgetHint(resolvedPairBytes);

  const fileFields = fileFieldsForKind(kind);
  const baseOptions = baseSetsForKind(kind);
  const isArmor = kind === "armor_set";
  const staffCategories = catalog
    ? filterStaffCategories(catalog.categories, kind)
    : [];
  const staffScrolls = catalog?.scrolls ?? [];
  const previewFiles = resolveModelPreviewFiles(kind, files);

  const remainingTiers: string[] = ARMOR_TIERS.filter(
    (t) => !tiers.some((entry) => entry.tier === t)
  );
  const effectiveTierToAdd = remainingTiers.includes(tierToAdd)
    ? tierToAdd
    : remainingTiers[0] ?? "";

  const previewTierEntry =
    tiers.find((e) => e.tier === previewArmorTier) ?? tiers[0] ?? null;

  useEffect(() => {
    if (!isArmor) {
      setPreviewArmorTier("");
      return;
    }
    if (tiers.length === 0) {
      setPreviewArmorTier("");
      return;
    }
    if (!tiers.some((e) => e.tier === previewArmorTier)) {
      setPreviewArmorTier(tiers[0]!.tier);
    }
  }, [isArmor, tiers, previewArmorTier]);

  function setFile(field: string, file: File | null) {
    setFiles((prev) => ({ ...prev, [field]: file }));
  }

  /** Ignore cancel / empty picker so an existing selection is kept. */
  function onPickedFile(
    fileList: FileList | null,
    apply: (file: File) => void
  ) {
    const file = fileList?.[0];
    if (file) apply(file);
  }

  function addTier(tier: string) {
    if (!tier || tiers.some((entry) => entry.tier === tier)) return;
    if (tiers.length >= MAX_TIERS) return;
    setTiers((prev) => [
      ...prev,
      {
        tier,
        alias: baseSetLabel(tier),
        helmet3d: false,
        scroll: "",
        files: {},
      },
    ]);
    setTierToAdd("");
    setError(null);
  }

  function removeTier(tier: string) {
    setTiers((prev) => prev.filter((entry) => entry.tier !== tier));
  }

  function setTierAlias(tier: string, alias: string) {
    setTiers((prev) =>
      prev.map((entry) =>
        entry.tier === tier ? { ...entry, alias } : entry
      )
    );
  }

  function setTierScroll(tier: string, scrollId: string) {
    setTiers((prev) =>
      prev.map((entry) =>
        entry.tier === tier ? { ...entry, scroll: scrollId } : entry
      )
    );
  }

  function setTierHelmet3d(tier: string, helmet3d: boolean) {
    setTiers((prev) =>
      prev.map((entry) => {
        if (entry.tier !== tier) return entry;
        const files = { ...entry.files };
        if (helmet3d) {
          delete files.helmet;
        } else {
          delete files.helmet_model;
          delete files.helmet_texture;
        }
        return { ...entry, helmet3d, files };
      })
    );
  }

  function setTierFile(tier: string, field: string, file: File | null) {
    setTiers((prev) =>
      prev.map((entry) =>
        entry.tier === tier
          ? { ...entry, files: { ...entry.files, [field]: file } }
          : entry
      )
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const name = itemName.trim();
    if (!name) {
      setError("Enter an item name.");
      return;
    }
    const nameErr = displayNameError(name, {
      minLen: 1,
      maxLen: 24,
      field: "item name",
    });
    if (nameErr) {
      setError(nameErr);
      return;
    }

    if (isArmor) {
      for (const entry of tiers) {
        const alias = entry.alias.trim();
        if (!alias) continue;
        const aliasErr = displayNameError(alias, {
          minLen: 1,
          maxLen: 32,
          field: `tier alias for ${baseSetLabel(entry.tier)}`,
        });
        if (aliasErr) {
          setError(aliasErr);
          return;
        }
      }
    }

    if (!isArmor && (!baseSet || !baseOptions.includes(baseSet))) {
      setError(`Choose a ${baseSetPickerTitle(kind).toLowerCase()}`);
      return;
    }

    if (isArmor && tiers.length < 1) {
      setError("Add at least 1 armour tier");
      return;
    }

    if (staff) {
      if (!category.trim()) {
        setError("Choose a shop category");
        return;
      }
      if (catalogError || !catalog) {
        setError(catalogError || "Catalog not loaded - wait or refresh");
        return;
      }
      if (staffCategories.length < 1) {
        setError("No matching shop categories in catalog for this kind");
        return;
      }
      if (isArmor) {
        const missing = tiers.filter((e) => !e.scroll.trim());
        if (missing.length) {
          setError(
            `Choose a scroll for each armor tier (${missing
              .map((e) => baseSetLabel(e.tier))
              .join(", ")})`
          );
          return;
        }
      } else if (!scroll.trim()) {
        setError("Choose a scroll");
        return;
      }
    }

    if (kind === "large_handheld") {
      if (
        !Number.isFinite(gripY) ||
        gripY < GRIP_Y_MIN ||
        gripY > GRIP_Y_MAX
      ) {
        setError(`Grip must be between ${GRIP_Y_MIN} and ${GRIP_Y_MAX}`);
        return;
      }
    }

    const uploadFiles: Record<string, File> = {};

    if (isArmor) {
      try {
        for (const entry of tiers) {
          const tierLabel = baseSetLabel(entry.tier);
          const helmetFields = entry.helmet3d
            ? (["helmet_model", "helmet_texture"] as const)
            : (["helmet"] as const);
          const fields = [...helmetFields, ...ARMOR_BODY_FIELDS];
          for (const field of fields) {
            const file = entry.files[field];
            const label = fieldLabel[field] || field;
            if (!file) {
              throw new Error(`Missing ${label} for the ${tierLabel} tier`);
            }
            const expected = expectedSizeForField(kind, field);
            if (expected) {
              await assertFileSize(file, expected, `${tierLabel} ${label}`);
            }
            if (field === "helmet_model") {
              await assertVanillaJavaBlockModelFile(file);
            }
            uploadFiles[`${entry.tier}_${field}`] = file;
          }
        }
        const h3d = tiers.filter((t) => t.helmet3d).map((t) => t.tier);
        assert3dPairBudgets(kind, uploadFiles, resolvedPairBytes, h3d);
      } catch (err) {
        setError(err instanceof Error ? err.message : "File validation failed");
        return;
      }
    } else {
      try {
        for (const field of fileFields) {
          const file = files[field];
          if (!file) {
            throw new Error(`Missing file: ${fieldLabel[field] || field}`);
          }
          const expected = expectedSizeForField(kind, field);
          if (expected) {
            await assertFileSize(file, expected, fieldLabel[field] || field);
          }
          if (field === "model" || field.endsWith("_model")) {
            await assertVanillaJavaBlockModelFile(file);
          }
          uploadFiles[field] = file;
        }
        assert3dPairBudgets(kind, uploadFiles, resolvedPairBytes);
      } catch (err) {
        setError(err instanceof Error ? err.message : "File validation failed");
        return;
      }
    }

    if (colours.length > 0) {
      const normalized = colours
        .map((c) => normalizePreviewHex(c))
        .filter((c): c is string => Boolean(c));
      if (normalized.length !== colours.length) {
        setError("Each colour must be #RRGGBB or a legacy § code");
        return;
      }
    }

    setLoading(true);
    try {
      const check = await checkSubmissionConflict({
        sessionToken,
        display_name: name,
      });
      if (!check.ok) {
        const reasons = new Set(
          check.conflicts.flatMap((c) => c.reasons || [])
        );
        if (reasons.has("display_name")) {
          setError(
            `You already have an active skin named "${name}". Choose a different item name.`
          );
        } else {
          setError(
            "You already have an active skin that conflicts with this one. Choose a different item name."
          );
        }
        setLoading(false);
        return;
      }

      const result = await createSubmission({
        sessionToken,
        kind,
        display_name: name,
        base_set: isArmor ? null : baseSet,
        tiers: isArmor ? tiers.map((entry) => entry.tier) : undefined,
        tier_aliases: isArmor
          ? Object.fromEntries(
              tiers.map((entry) => [
                entry.tier,
                entry.alias.trim() || baseSetLabel(entry.tier),
              ])
            )
          : undefined,
        helmet_3d_tiers: isArmor
          ? tiers.filter((e) => e.helmet3d).map((e) => e.tier)
          : undefined,
        grip_preset: kind === "large_handheld" ? gripY.toFixed(1) : null,
        add_name: applyName,
        name_colours: colours.length ? colours : undefined,
        name_styles: styles.length ? styles : undefined,
        category: staff ? category.trim() : undefined,
        scroll: staff && !isArmor ? scroll.trim() : undefined,
        tier_scrolls:
          staff && isArmor
            ? Object.fromEntries(
                tiers.map((entry) => [entry.tier, entry.scroll.trim()])
              )
            : undefined,
        files: uploadFiles,
      });
      setLastSubmissionId(result.id);
      router.push(`/skins/${result.id}`);
    } catch (err) {
      const message =
        err instanceof SkinsApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Upload failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60";

  function toggleStyle(style: NameStyle) {
    setStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  return (
    <div className="relative">
      {loading ? (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-forest)_92%,transparent)] px-6 py-16"
          role="status"
          aria-live="polite"
        >
          <div
            className="h-10 w-10 animate-spin rounded-full border-2 border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] border-t-[var(--tfmc-accent)]"
            aria-hidden
          />
          <p className="text-lg text-[var(--tfmc-cream)]">Submitting…</p>
        </div>
      ) : null}
    <form onSubmit={onSubmit} className="mt-8 flex w-full flex-col gap-6">
      <KindPicker
        value={kind}
        onChange={setKind}
        disabled={loading}
        allowedKinds={resolvedKinds}
      />

      {pairHint &&
      (isModel3dKind(kind) || isGunKind(kind) || kind === "armor_set") ? (
        <p className="text-sm text-[var(--tfmc-mist)]">{pairHint}</p>
      ) : null}

      {staff ? (
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="text-sm font-medium text-[var(--tfmc-stone)]">
            Shop landing
          </legend>
          {catalogError ? (
            <p className="text-sm text-[#e8a0a0]" role="alert">
              {catalogError}
            </p>
          ) : !catalog ? (
            <p className="text-xs text-[var(--tfmc-mist)]">Loading catalog…</p>
          ) : (
            <>
              <label className="flex flex-col gap-2 text-left">
                <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                  Category
                </span>
                <select
                  value={category}
                  disabled={loading || staffCategories.length < 1}
                  onChange={(e) => setCategory(e.target.value)}
                  className={inputClass}
                  required
                >
                  <option value="">Select category…</option>
                  {staffCategories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name || c.id}
                    </option>
                  ))}
                </select>
                {staffCategories.length < 1 ? (
                  <span className="text-xs text-[#e8a0a0]">
                    No categories for this kind (catalog may be empty or only
                    ps_*).
                  </span>
                ) : null}
              </label>
              {!isArmor ? (
                <label className="flex flex-col gap-2 text-left">
                  <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                    Scroll
                  </span>
                  <select
                    value={scroll}
                    disabled={loading || staffScrolls.length < 1}
                    onChange={(e) => setScroll(e.target.value)}
                    className={inputClass}
                    required
                  >
                    <option value="">Select scroll…</option>
                    {staffScrolls.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label || s.id}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="text-xs text-[var(--tfmc-mist)]">
                  Choose a scroll on each armor tier below.
                </p>
              )}
            </>
          )}
        </fieldset>
      ) : null}

      {!isArmor ? (
        <label className="flex flex-col gap-2 text-left">
          <span className="text-sm font-medium text-[var(--tfmc-stone)]">
            {baseSetPickerTitle(kind)}
          </span>
          <select
            value={baseSet}
            disabled={loading}
            onChange={(e) => setBaseSet(e.target.value)}
            className={inputClass}
            required
          >
            {baseOptions.map((id) => (
              <option key={id} value={id}>
                {baseSetLabel(id)}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
          Item name
        </span>
        <span className="text-xs text-[var(--tfmc-mist)]">
          {isArmor
            ? "Base name before the tier label (e.g. Norain becomes Norain Iron). Spaces and capitals are fine."
            : "Shown in the armour shop."}{" "}
          Allowed: {DISPLAY_NAME_HINT}.
        </span>
        <input
          type="text"
          value={itemName}
          disabled={loading}
          onChange={(e) => setItemName(e.target.value)}
          className={inputClass}
          maxLength={24}
          placeholder="Blue Knight"
        />
        {itemName.trim() &&
        displayNameError(itemName, {
          minLen: 1,
          maxLen: 24,
          field: "item name",
        }) ? (
          <span className="text-xs text-[#e8a0a0]">
            {displayNameError(itemName, {
              minLen: 1,
              maxLen: 24,
              field: "item name",
            })}
          </span>
        ) : null}
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--tfmc-cream)]">
        <FancyCheckbox
          checked={applyName}
          disabled={loading}
          onChange={setApplyName}
        />
        <span>
          Rename the item to this name
          <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">
            When off, the item keeps its own name.
          </span>
        </span>
      </label>

      <fieldset className="flex flex-col gap-4 border-0 p-0">
        <legend className="sr-only">Name colours and styles</legend>

        <NameColourPicker
          colours={colours}
          onChange={setColours}
          previewText={itemName.trim() || "Preview"}
          maxStops={resolvedColourStops}
          disabled={loading}
          previewStyles={styles}
          onError={setError}
          lockedMessage={
            colourLockedMessage || "Name colours require a donator rank"
          }
        />

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium text-[var(--tfmc-stone)]">
            Styles
          </span>
          <div className="flex flex-wrap gap-3">
            {NAME_STYLES.map((s) => (
              <label
                key={s}
                className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--tfmc-cream)]"
              >
                <FancyCheckbox
                  checked={styles.includes(s)}
                  disabled={loading}
                  onChange={() => toggleStyle(s)}
                  className="mt-0"
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      </fieldset>

      {kind === "large_handheld" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-[var(--tfmc-stone)]">
            Grip height
          </legend>
          <label className="flex items-center gap-3 text-sm text-[var(--tfmc-cream)]">
            <span className="shrink-0 text-xs text-[var(--tfmc-mist)]">Low</span>
            <input
              type="range"
              min={GRIP_Y_MIN}
              max={GRIP_Y_MAX}
              step={0.1}
              value={gripY}
              disabled={loading}
              onChange={(e) => setGripY(Number(e.target.value))}
              className="min-w-0 flex-1 accent-[var(--tfmc-accent)]"
              aria-label="Grip height"
            />
            <span className="shrink-0 text-xs text-[var(--tfmc-mist)]">High</span>
            <span className="w-10 shrink-0 tabular-nums text-xs text-[var(--tfmc-cream)]">
              {gripY.toFixed(1)}
            </span>
          </label>
        </fieldset>
      ) : null}

      {isArmor ? (
        <fieldset className="flex flex-col gap-4 border-0 p-0">
          <legend className="text-sm font-medium text-[var(--tfmc-stone)]">
            Armour tiers
          </legend>
          <p className="text-xs text-[var(--tfmc-mist)]">
            Add up to {MAX_TIERS} tiers. Each needs a helmet, chestplate,
            leggings, boots and both layers.
          </p>

          {tiers.length > 0 ? (
            <div className="flex flex-col gap-4">
              {tiers.map((entry) => {
                const helmetFields = entry.helmet3d
                  ? (["helmet_model", "helmet_texture"] as const)
                  : (["helmet"] as const);
                const tierFields = [...helmetFields, ...ARMOR_BODY_FIELDS];
                return (
                <div
                  key={entry.tier}
                  className="flex flex-col gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-[var(--tfmc-cream)]">
                      {baseSetLabel(entry.tier)}
                    </span>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => removeTier(entry.tier)}
                      className="text-xs text-[#e8a0a0] hover:underline"
                    >
                      Remove tier
                    </button>
                  </div>
                  <label className="flex flex-col gap-2 text-left">
                    <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                      Tier name (optional)
                    </span>
                    <input
                      type="text"
                      value={entry.alias}
                      disabled={loading}
                      maxLength={32}
                      placeholder={baseSetLabel(entry.tier)}
                      onChange={(e) =>
                        setTierAlias(entry.tier, e.target.value)
                      }
                      className={inputClass}
                    />
                    <span className="text-xs text-[var(--tfmc-mist)]">
                      In-game:{" "}
                      {(itemName.trim() || "Name") +
                        " " +
                        (entry.alias.trim() || baseSetLabel(entry.tier))}{" "}
                      Chestplate
                    </span>
                    {entry.alias.trim() &&
                    displayNameError(entry.alias, {
                      minLen: 1,
                      maxLen: 32,
                      field: "tier alias",
                    }) ? (
                      <span className="text-xs text-[#e8a0a0]">
                        {displayNameError(entry.alias, {
                          minLen: 1,
                          maxLen: 32,
                          field: "tier alias",
                        })}
                      </span>
                    ) : null}
                  </label>
                  {staff ? (
                    <label className="flex flex-col gap-2 text-left">
                      <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                        Scroll
                      </span>
                      <select
                        value={entry.scroll}
                        disabled={loading || staffScrolls.length < 1}
                        onChange={(e) =>
                          setTierScroll(entry.tier, e.target.value)
                        }
                        className={inputClass}
                        required
                      >
                        <option value="">Select scroll…</option>
                        {staffScrolls.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.label || s.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {canUseArmor3dHelmet ? (
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--tfmc-cream)]">
                    <FancyCheckbox
                      checked={entry.helmet3d}
                      disabled={loading}
                      onChange={(checked) =>
                        setTierHelmet3d(entry.tier, checked)
                      }
                      className="mt-0"
                    />
                    3D Helmet
                  </label>
                  ) : null}
                  <div className="flex flex-col gap-4">
                    {tierFields.map((field) => (
                      <label key={field} className="flex flex-col gap-2 text-left">
                        <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                          {slotLabel(kind, field)}
                        </span>
                        <input
                          type="file"
                          accept={acceptForField(field)}
                          disabled={loading}
                          onChange={(e) =>
                            onPickedFile(e.target.files, (file) =>
                              setTierFile(entry.tier, field, file)
                            )
                          }
                          className="text-sm text-[var(--tfmc-mist)] file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--tfmc-moss)] file:px-3 file:py-1.5 file:text-[var(--tfmc-cream)]"
                        />
                        {entry.files[field] ? (
                          <span className="text-xs text-[var(--tfmc-cream)]">
                            Selected: {entry.files[field]!.name}
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>
                );
              })}
              {previewTierEntry ? (
                <div className="flex flex-col gap-2 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] p-4">
                  <label className="flex flex-col gap-1 text-left sm:max-w-xs">
                    <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                      Preview tier
                    </span>
                    <select
                      value={previewTierEntry.tier}
                      disabled={loading}
                      onChange={(e) => setPreviewArmorTier(e.target.value)}
                      className={inputClass}
                    >
                      {tiers.map((e) => (
                        <option key={e.tier} value={e.tier}>
                          {baseSetLabel(e.tier)}
                          {e.alias.trim() && e.alias.trim() !== baseSetLabel(e.tier)
                            ? ` (${e.alias.trim()})`
                            : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <ArmorPreview
                    layer1File={previewTierEntry.files.layer_1 ?? null}
                    layer2File={previewTierEntry.files.layer_2 ?? null}
                    helmet3d={previewTierEntry.helmet3d}
                    helmetModelFile={previewTierEntry.files.helmet_model ?? null}
                    helmetTextureFile={
                      previewTierEntry.files.helmet_texture ?? null
                    }
                  />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-[var(--tfmc-mist)]">
              No tiers added yet.
            </p>
          )}

          {remainingTiers.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={effectiveTierToAdd}
                disabled={loading}
                onChange={(e) => setTierToAdd(e.target.value)}
                className={inputClass}
              >
                {remainingTiers.map((t) => (
                  <option key={t} value={t}>
                    {baseSetLabel(t)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={loading}
                onClick={() => addTier(effectiveTierToAdd)}
                className="rounded-sm bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)]"
              >
                Add tier
              </button>
            </div>
          ) : (
            <p className="text-xs text-[var(--tfmc-mist)]">
              All {MAX_TIERS} tiers added.
            </p>
          )}
        </fieldset>
      ) : (
        <div className="flex flex-col gap-4">
          {fileFields.map((field) => (
            <label key={field} className="flex flex-col gap-2 text-left">
              <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                {slotLabel(kind, field)}
              </span>
              <input
                type="file"
                accept={acceptForField(field)}
                disabled={loading}
                onChange={(e) =>
                  onPickedFile(e.target.files, (file) => setFile(field, file))
                }
                className="text-sm text-[var(--tfmc-mist)] file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--tfmc-moss)] file:px-3 file:py-1.5 file:text-[var(--tfmc-cream)]"
              />
              {files[field] ? (
                <span className="text-xs text-[var(--tfmc-cream)]">
                  Selected: {files[field]!.name}
                </span>
              ) : null}
            </label>
          ))}
          {isBookKind(kind) ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-4">
                {(
                  [
                    ["unsigned", "Unsigned", bookPreviewUrls.unsigned],
                    ["signed", "Signed", bookPreviewUrls.signed],
                  ] as const
                ).map(([key, label, url]) => (
                  <div key={key} className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[var(--tfmc-stone)]">
                      {label}
                    </span>
                    <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_70%,black)]">
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={url}
                          alt={`${label} cover preview`}
                          className="h-full w-full object-contain"
                          style={{ imageRendering: "pixelated" }}
                        />
                      ) : (
                        <span className="px-2 text-center text-[10px] text-[var(--tfmc-mist)]">
                          No file
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-6 sm:grid-cols-2">
                {files.unsigned ? (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
                      Unsigned 3D
                    </p>
                    <ModelPreview kind="book" textureFile={files.unsigned} />
                  </div>
                ) : null}
                {files.signed ? (
                  <div>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
                      Signed 3D
                    </p>
                    <ModelPreview kind="book" textureFile={files.signed} />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
          {isModel3dKind(kind) || isGunKind(kind) || isFlatPreviewKind(kind) ? (
            <ModelPreview
              modelFile={previewFiles.model}
              textureFile={previewFiles.texture}
              gunModels={
                isGunKind(kind)
                  ? {
                      carry: files.carry_model ?? null,
                      reload: files.reload_model ?? null,
                      aim: files.aim_model ?? null,
                    }
                  : undefined
              }
              flatTextureFile={
                isFlatPreviewKind(kind) ? (files.texture ?? null) : null
              }
              flatFrames={
                isFlatPreviewKind(kind)
                  ? {
                      texture: files.texture ?? null,
                      pull_0: files.pull_0 ?? null,
                      pull_1: files.pull_1 ?? null,
                      pull_2: files.pull_2 ?? null,
                      charged: files.charged ?? null,
                    }
                  : undefined
              }
              gripY={kind === "large_handheld" ? gripY : null}
              kind={kind}
            />
          ) : null}
        </div>
      )}

      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}

      <p className="text-sm text-[var(--tfmc-mist)]">
        {staff
          ? "Staff uploads auto-approve and land in the curated shop pack (no Discord review)."
          : "You'll get a Discord DM once it's in review."}
      </p>

      <button
        type="submit"
        disabled={loading}
        className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {loading ? "Uploading…" : "Submit"}
      </button>
    </form>
    </div>
  );
}
