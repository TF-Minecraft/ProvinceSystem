"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import FancyCheckbox from "../skins/FancyCheckbox";
import ModelPreview from "../skins/ModelPreview";
import NameColourPicker from "../shared/NameColourPicker";
import LoreLinesEditor from "../shared/LoreLinesEditor";
import FormattedMcRuns from "../shared/FormattedMcRuns";
import {
  authHeaders,
  loreItemDefaultTextureUrl,
  loreItemSkinModelUrl,
  loreItemSkinTextureUrl,
  type LoreItemRow,
} from "../../../lib/characters/api";
import {
  hasInlineFormatCodes,
  parseLoreRuns,
  parseNameRuns,
} from "../../../lib/characters/lorePreview";
import {
  DISPLAY_NAME_HINT,
  displayNameError,
} from "../../../lib/textValidation";
import {
  NAME_STYLES,
  previewColourStopRuns,
  type NameStyle,
} from "../../../lib/skins/namePreview";
import {
  getPlayerMeta,
} from "../../../lib/skins/api";
import { DEV_CATALOG_ENTITLEMENTS } from "../../../lib/skins/entitlementsDev";
import { isCharacterUiDev } from "../../../lib/characters/uiDev";
import {
  loreItemDraftSyncKey,
  resolveInitialSkinMode,
  type LoreSkinMode,
} from "../../../lib/characters/loreSkinMode";
import {
  assert3dPairBudgets,
  assertFileSize,
  expectedSizeForField,
  isModel3dKind,
  pairBudgetHint,
  type SkinKind,
} from "../../../lib/skins/sizes";
import { assertVanillaJavaBlockModelFile } from "../../../lib/skins/javaModel";

const DISPLAY_NAME_MAX = 24;

const KNOWN_SKIN_KINDS = new Set<string>([
  "armor_set",
  "handheld",
  "large_handheld",
  "bow",
  "large_bow",
  "crossbow",
  "item_3d",
  "shield",
  "helmet_3d",
  "mask",
  "gun",
  "book",
]);

function asSkinKind(raw: string | null | undefined, fallback: SkinKind): SkinKind {
  const k = String(raw || "").trim();
  if (KNOWN_SKIN_KINDS.has(k)) return k as SkinKind;
  return fallback;
}

const FILE_INPUT_CLASS =
  "text-sm text-[var(--tfmc-mist)] file:mr-3 file:rounded-sm file:border-0 file:bg-[var(--tfmc-moss)] file:px-3 file:py-1.5 file:text-[var(--tfmc-cream)]";

type Props = {
  item: LoreItemRow;
  sessionToken: string;
  nameColourStops?: number;
  max3dPairBytes?: number;
  submitting?: boolean;
  refreshing?: boolean;
  deleting?: boolean;
  error?: string | null;
  successMessage?: string | null;
  onSubmit: (input: {
    displayName: string;
    lore: string[];
    existingSkinId?: string | null;
    textureFile?: File | null;
    unsignedFile?: File | null;
    signedFile?: File | null;
    modelFile?: File | null;
    use3d?: boolean;
    nameColours?: string[];
    nameStyles?: NameStyle[];
  }) => void | Promise<void>;
  onRefreshStatus?: () => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
};

function parseDraftStyles(raw: unknown): NameStyle[] {
  if (!Array.isArray(raw)) return [];
  const allowed = new Set<string>(NAME_STYLES);
  const out: NameStyle[] = [];
  for (const item of raw) {
    const s = String(item || "")
      .trim()
      .toLowerCase();
    if (allowed.has(s) && !out.includes(s as NameStyle)) {
      out.push(s as NameStyle);
    }
  }
  return out;
}

function draftHasCustomise(item: LoreItemRow): boolean {
  const d = item.draft;
  const state = String(d.state || "").toLowerCase();
  if (
    state === "pending_skin" ||
    state === "ready" ||
    state === "denied" ||
    state === "applied"
  ) {
    return true;
  }
  if (String(d.display_name || "").trim()) return true;
  if (Array.isArray(d.lore) && d.lore.some((l) => String(l || "").trim())) {
    return true;
  }
  if (d.existing_skin_id || d.submission_id || d.skin_slug) return true;
  return false;
}

const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-accent)] focus:outline-none";

function SkinThumb({
  id,
  baseSet,
  token,
}: {
  id: string;
  baseSet: string;
  token: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let objectUrl: string | null = null;
    void (async () => {
      try {
        const res = await fetch(loreItemSkinTextureUrl(id, baseSet), {
          headers: authHeaders(token),
        });
        if (!res.ok) return;
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!dead) setSrc(objectUrl);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      dead = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, baseSet, token]);
  if (!src) {
    return (
      <span className="inline-block h-8 w-8 rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]" />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      className="h-8 w-8 image-rendering-pixelated rounded-sm"
      style={{ imageRendering: "pixelated" }}
    />
  );
}

export default function LoreItemEditor({
  item,
  sessionToken,
  nameColourStops = 0,
  max3dPairBytes,
  submitting = false,
  refreshing = false,
  deleting = false,
  error = null,
  successMessage = null,
  onSubmit,
  onRefreshStatus,
  onDelete,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const modelRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState(
    item.draft.display_name || ""
  );
  const [colours, setColours] = useState<string[]>(
    Array.isArray(item.draft.name_colours)
      ? [...item.draft.name_colours]
      : []
  );
  const [styles, setStyles] = useState<NameStyle[]>(() =>
    parseDraftStyles(item.draft.name_styles)
  );
  const [lore, setLore] = useState<string[]>(
    item.draft.lore.length > 0 ? [...item.draft.lore] : []
  );
  const [skinMode, setSkinMode] = useState<LoreSkinMode>(() =>
    resolveInitialSkinMode(item)
  );
  const [textureFile, setTextureFile] = useState<File | null>(null);
  const [unsignedFile, setUnsignedFile] = useState<File | null>(null);
  const [signedFile, setSignedFile] = useState<File | null>(null);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [use3d, setUse3d] = useState(false);
  const [pickedSkinId, setPickedSkinId] = useState<string>(
    item.draft.existing_skin_id || ""
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const [previewTexture, setPreviewTexture] = useState<File | null>(null);
  const [previewTextureSigned, setPreviewTextureSigned] = useState<File | null>(
    null
  );
  const [previewModelFile, setPreviewModelFile] = useState<File | null>(null);
  const [bookPreviewUrls, setBookPreviewUrls] = useState<{
    unsigned: string | null;
    signed: string | null;
  }>({ unsigned: null, signed: null });
  const [metaPairBytes, setMetaPairBytes] = useState<number>(0);

  const resolvedPairBytes =
    max3dPairBytes !== undefined && max3dPairBytes > 0
      ? max3dPairBytes
      : metaPairBytes > 0
        ? metaPairBytes
        : isCharacterUiDev()
          ? DEV_CATALOG_ENTITLEMENTS.defaults.max_3d_pair_bytes
          : 0;
  const pairHint = pairBudgetHint(resolvedPairBytes);

  const baseline = useMemo(
    () => ({
      displayName: item.draft.display_name || "",
      lore: (item.draft.lore || []).map(String),
      colours: Array.isArray(item.draft.name_colours)
        ? item.draft.name_colours.map(String)
        : [],
      styles: parseDraftStyles(item.draft.name_styles),
      skinMode: resolveInitialSkinMode(item),
      pickedSkinId: item.draft.existing_skin_id || "",
      use3d: false,
    }),
    [item]
  );

  const flatKind = asSkinKind(item["2d_template"], "handheld");
  const isBook = flatKind === "book";
  const threeDKindRaw = String(item["3d_template"] || "").trim();
  const allows3d = Boolean(threeDKindRaw) && !isBook;
  const threeDKind = allows3d ? asSkinKind(threeDKindRaw, "item_3d") : null;

  const pickedSkin = useMemo(
    () => item.pickable_skins.find((skin) => skin.id === pickedSkinId),
    [item.pickable_skins, pickedSkinId]
  );
  const pickedIs3d = Boolean(
    skinMode === "pick" &&
      pickedSkin &&
      isModel3dKind(asSkinKind(pickedSkin.kind, "item_3d"))
  );

  const isDirty = useMemo(() => {
    if (displayName.trim() !== baseline.displayName.trim()) return true;
    if (lore.length !== baseline.lore.length) return true;
    if (lore.some((line, i) => line !== baseline.lore[i])) return true;
    if (colours.length !== baseline.colours.length) return true;
    if (colours.some((c, i) => c !== baseline.colours[i])) return true;
    if (styles.length !== baseline.styles.length) return true;
    if (styles.some((s, i) => s !== baseline.styles[i])) return true;
    if (skinMode !== baseline.skinMode) return true;
    if (skinMode === "pick" && pickedSkinId !== baseline.pickedSkinId) {
      return true;
    }
    if (textureFile || unsignedFile || signedFile || modelFile) return true;
    if (use3d !== baseline.use3d) return true;
    return false;
  }, [
    baseline,
    colours,
    displayName,
    lore,
    modelFile,
    pickedSkinId,
    signedFile,
    skinMode,
    styles,
    textureFile,
    unsignedFile,
    use3d,
  ]);

  const showDelete = Boolean(onDelete) && draftHasCustomise(item);

  const draftSyncKey = loreItemDraftSyncKey(item);

  useEffect(() => {
    setSkinMode(resolveInitialSkinMode(item));
    setPickedSkinId(item.draft.existing_skin_id || "");
    setTextureFile(null);
    setUnsignedFile(null);
    setSignedFile(null);
    setModelFile(null);
    setUse3d(false);
    if (fileRef.current) fileRef.current.value = "";
    if (modelRef.current) modelRef.current.value = "";
  }, [draftSyncKey, item]);

  useEffect(() => {
    if (!allows3d && use3d) {
      setUse3d(false);
      setModelFile(null);
      if (modelRef.current) modelRef.current.value = "";
    }
  }, [allows3d, use3d]);

  useEffect(() => {
    let cancelled = false;
    async function loadMeta() {
      const token = sessionToken.trim();
      if (!token) return;
      try {
        const meta = await getPlayerMeta(token);
        if (cancelled) return;
        const pair = Math.max(0, Math.floor(meta.max_3d_pair_bytes ?? 0));
        if (pair > 0) setMetaPairBytes(pair);
      } catch {
        // Keep prop or dev fallback if refresh fails.
      }
    }
    void loadMeta();
    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  useEffect(() => {
    const unsigned = unsignedFile
      ? URL.createObjectURL(unsignedFile)
      : null;
    const signed = signedFile ? URL.createObjectURL(signedFile) : null;
    setBookPreviewUrls({ unsigned, signed });
    return () => {
      if (unsigned) URL.revokeObjectURL(unsigned);
      if (signed) URL.revokeObjectURL(signed);
    };
  }, [unsignedFile, signedFile]);

  const isDenied =
    String(item.draft.state || "").toLowerCase() === "denied" ||
    String(item.draft.submission_status || "").toLowerCase() === "denied";
  const denyReason = String(item.draft.deny_reason || "").trim();

  const hasNewSkin =
    (skinMode === "upload" &&
      (isBook
        ? Boolean(unsignedFile && signedFile)
        : Boolean(textureFile))) ||
    (skinMode === "pick" && Boolean(pickedSkinId.trim()));
  const submitBlocked = isDenied && !hasNewSkin;

  useEffect(() => {
    let dead = false;

    async function fetchAsFile(
      url: string,
      filename: string
    ): Promise<File | null> {
      const res = await fetch(url, { headers: authHeaders(sessionToken) });
      if (!res.ok) return null;
      const blob = await res.blob();
      return new File([blob], filename, {
        type: blob.type || "image/png",
      });
    }

    async function loadPreview() {
      try {
        if (skinMode === "upload" && isBook) {
          if (!dead) {
            setPreviewTexture(unsignedFile);
            setPreviewTextureSigned(signedFile);
            setPreviewModelFile(null);
          }
          if (unsignedFile && signedFile) return;
          if (!unsignedFile && (item.skin_png || item.kit_key)) {
            const file = await fetchAsFile(
              loreItemDefaultTextureUrl(item.kit_key),
              `${String(item.skin_png || item.kit_key).trim() || "default"}.png`
            );
            if (!dead && !unsignedFile) setPreviewTexture(file);
          }
          if (!signedFile && item.kit_key) {
            const file = await fetchAsFile(
              loreItemDefaultTextureUrl(item.kit_key, "signed"),
              `${String(item.skin_png_signed || "journal_skin_signed").trim()}.png`
            );
            if (!dead && !signedFile) setPreviewTextureSigned(file);
          }
          return;
        }
        if (skinMode === "upload" && textureFile) {
          if (!dead) {
            setPreviewTexture(textureFile);
            setPreviewTextureSigned(null);
            setPreviewModelFile(null);
          }
          return;
        }
        let url: string | null = null;
        let filename = "preview.png";
        if (skinMode === "pick" && pickedSkinId.trim()) {
          if (isBook) {
            const unsignedUrl = loreItemSkinTextureUrl(
              pickedSkinId,
              item.base_set
            );
            const signedUrl = loreItemSkinTextureUrl(
              pickedSkinId,
              item.base_set,
              "signed"
            );
            const [unsignedFile, signedFile] = await Promise.all([
              fetchAsFile(unsignedUrl, `${pickedSkinId.trim()}_unsigned.png`),
              fetchAsFile(signedUrl, `${pickedSkinId.trim()}_signed.png`),
            ]);
            if (!dead) {
              setPreviewTexture(unsignedFile);
              setPreviewTextureSigned(signedFile);
              setPreviewModelFile(null);
            }
            return;
          }
          url = loreItemSkinTextureUrl(pickedSkinId, item.base_set);
          filename = `${pickedSkinId.trim()}.png`;
        } else if (item.skin_png || item.kit_key) {
          url = loreItemDefaultTextureUrl(item.kit_key);
          filename = `${String(item.skin_png || item.kit_key).trim() || "default"}.png`;
        }
        if (!url) {
          if (!dead) {
            setPreviewTexture(null);
            setPreviewTextureSigned(null);
            setPreviewModelFile(null);
          }
          return;
        }
        const file = await fetchAsFile(url, filename);
        let modelFile: File | null = null;
        if (
          skinMode === "pick" &&
          pickedSkin &&
          isModel3dKind(asSkinKind(pickedSkin.kind, "item_3d"))
        ) {
          modelFile = await fetchAsFile(
            loreItemSkinModelUrl(pickedSkinId, item.base_set),
            `${pickedSkinId.trim()}.json`
          );
        }
        if (!dead) {
          setPreviewTexture(file);
          setPreviewTextureSigned(null);
          setPreviewModelFile(modelFile);
        }
      } catch {
        if (!dead) {
          setPreviewTexture(null);
          setPreviewTextureSigned(null);
          setPreviewModelFile(null);
        }
      }
    }

    void loadPreview();
    return () => {
      dead = true;
    };
  }, [
    skinMode,
    isBook,
    textureFile,
    unsignedFile,
    signedFile,
    pickedSkinId,
    item.kit_key,
    item.skin_png,
    item.skin_png_signed,
    item.base_set,
    item.pickable_skins,
    sessionToken,
  ]);

  const nameErr = displayName
    ? displayNameError(displayName, {
        minLen: 1,
        maxLen: DISPLAY_NAME_MAX,
        field: "display name",
      })
    : null;

  const previewName = displayName.trim() || item.base_preview.display_name || "Preview";
  const nameHasInline = useMemo(
    () => hasInlineFormatCodes(previewName),
    [previewName]
  );
  const namePreviewRuns = useMemo(() => {
    if (nameHasInline) {
      const styleSet = new Set(styles.map((s) => s.toLowerCase()));
      return parseNameRuns(previewName).map((run) => ({
        ...run,
        bold: run.bold || styleSet.has("bold") || undefined,
        italic: run.italic || styleSet.has("italic") || undefined,
        underline:
          run.underline ||
          styleSet.has("underline") ||
          styleSet.has("underlined") ||
          undefined,
        strike:
          run.strike ||
          styleSet.has("strikethrough") ||
          styleSet.has("strike") ||
          undefined,
      }));
    }
    return previewColourStopRuns(previewName, colours, styles);
  }, [nameHasInline, previewName, colours, styles]);
  const previewLore = useMemo(() => {
    const base = item.base_preview.lore || [];
    const custom = lore.map((l) => l.trim()).filter(Boolean);
    if (custom.length === 0) return base;
    if (base.length === 0) return custom;
    // Match in-game: MI/base lore, blank spacer, then custom lines
    return [...base, " ", ...custom];
  }, [item.base_preview.lore, lore]);

  function toggleStyle(style: NameStyle) {
    setStyles((prev) =>
      prev.includes(style) ? prev.filter((s) => s !== style) : [...prev, style]
    );
  }

  async function onPickFile(file: File | null) {
    setLocalError(null);
    if (!file) {
      setTextureFile(null);
      return;
    }
    try {
      const sizeKind =
        use3d && threeDKind ? threeDKind : flatKind;
      const expected = expectedSizeForField(sizeKind, "texture");
      if (expected) {
        await assertFileSize(file, expected, "Texture");
      }
      setTextureFile(file);
      setSkinMode("upload");
      setPickedSkinId("");
    } catch (err) {
      setTextureFile(null);
      if (fileRef.current) fileRef.current.value = "";
      setLocalError(err instanceof Error ? err.message : "Invalid texture");
    }
  }

  async function onPickBookFile(
    field: "unsigned" | "signed",
    file: File | null
  ) {
    setLocalError(null);
    if (!file) {
      if (field === "unsigned") setUnsignedFile(null);
      else setSignedFile(null);
      return;
    }
    try {
      const expected = expectedSizeForField("book", field);
      if (expected) {
        await assertFileSize(
          file,
          expected,
          field === "unsigned" ? "Unsigned cover" : "Signed cover"
        );
      }
      if (field === "unsigned") setUnsignedFile(file);
      else setSignedFile(file);
      setSkinMode("upload");
      setPickedSkinId("");
    } catch (err) {
      if (field === "unsigned") setUnsignedFile(null);
      else setSignedFile(null);
      setLocalError(err instanceof Error ? err.message : "Invalid cover");
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (nameErr) {
      setLocalError(nameErr);
      return;
    }
    if (!displayName.trim()) {
      setLocalError("Display name is required");
      return;
    }
    if (submitBlocked) {
      setLocalError(
        "Skin was denied. Choose a different skin (upload or pick) and submit again."
      );
      return;
    }
    if (!isDirty) {
      setLocalError("No changes to submit");
      return;
    }
    if (skinMode === "upload" && isBook) {
      if (!unsignedFile || !signedFile) {
        setLocalError("Book customise requires unsigned and signed covers");
        return;
      }
    }
    if (skinMode === "upload" && allows3d && use3d && !modelFile) {
      setLocalError("3D upload requires a model JSON file");
      return;
    }
    const effective3d = skinMode === "upload" && allows3d && use3d;
    if (effective3d && threeDKind && textureFile && modelFile) {
      try {
        assert3dPairBudgets(
          threeDKind,
          { texture: textureFile, model: modelFile },
          resolvedPairBytes
        );
        await assertVanillaJavaBlockModelFile(modelFile);
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : "Invalid 3D files");
        return;
      }
    }
    await onSubmit({
      displayName: displayName.trim(),
      lore,
      nameColours: colours,
      nameStyles: styles,
      existingSkinId:
        skinMode === "pick" ? pickedSkinId || null : undefined,
      textureFile: skinMode === "upload" && !isBook ? textureFile : null,
      unsignedFile: skinMode === "upload" && isBook ? unsignedFile : null,
      signedFile: skinMode === "upload" && isBook ? signedFile : null,
      modelFile: effective3d ? modelFile : null,
      use3d: effective3d,
    });
  }

  const showError = localError || error;

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-10">
      {successMessage ? (
        <p className="whitespace-pre-wrap text-sm text-[var(--tfmc-mist)]">
          {successMessage}
        </p>
      ) : null}
      {isDenied ? (
        <p className="rounded-sm border border-[color-mix(in_srgb,#e8a0a0_35%,transparent)] bg-[color-mix(in_srgb,#e8a0a0_10%,transparent)] px-3 py-2 text-sm text-[#e8a0a0]">
          Your custom skin was denied
          {denyReason ? `: ${denyReason}` : "."} Name and lore are kept.
          Choose a different skin (upload a new texture or pick an applied one)
          and submit again. The kit is not ready to claim until a new skin is
          accepted.
        </p>
      ) : null}

      <section>
        <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
          Name
        </h2>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          {DISPLAY_NAME_HINT}. Colour stops use your rank perk. You can also use
          inline §l / &amp;l (bold), §o (italic), §n (underline), §m (strike) in
          the name - preview shows them like lore.
        </p>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          maxLength={DISPLAY_NAME_MAX}
          className={`${inputClass} mt-3`}
          autoComplete="off"
        />
        {nameErr ? (
          <p className="mt-2 text-xs text-[#e8a0a0]">{nameErr}</p>
        ) : null}
        <fieldset className="mt-4 flex flex-col gap-4 border-0 p-0">
          <legend className="sr-only">Name colours and styles</legend>
          <NameColourPicker
            colours={colours}
            onChange={setColours}
            previewText={previewName}
            maxStops={nameColourStops}
            lockedMessage="Name colours unlock with your rank perk"
            previewStyles={styles}
            onError={setLocalError}
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
                    onChange={() => toggleStyle(s)}
                    className="mt-0"
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>
        </fieldset>
      </section>

      <section>
        <LoreLinesEditor
          lines={lore}
          onChange={setLore}
          heading="section"
          showPreview={false}
        />
      </section>

      <section>
        <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
          Preview
        </h2>
        <div className="mt-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[#1a1a1a] px-4 py-3 font-mono text-sm">
          <p className="leading-relaxed">
            <FormattedMcRuns runs={namePreviewRuns} />
          </p>
          <ul className="mt-2 space-y-1">
            {previewLore.map((line, li) => (
              <li key={`${li}-${line.slice(0, 16)}`}>
                {line === " " || line === "" ? (
                  <span className="inline-block min-h-[1em]">{"\u00A0"}</span>
                ) : (
                  <FormattedMcRuns runs={parseLoreRuns(line)} />
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section>
        <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
          Skin
        </h2>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          {isBook
            ? "Pick an applied book skin from your account (works on any character), or upload new unsigned and signed covers for this kit item."
            : "Pick an applied skin from your account (works on any character), or upload a new texture for this kit item."}
        </p>
        <div className="mt-4 flex flex-wrap gap-4 text-sm">
          <button
            type="button"
            onClick={() => {
              setSkinMode("upload");
              setPickedSkinId("");
            }}
            className={
              skinMode === "upload"
                ? "text-[var(--tfmc-cream)] underline underline-offset-2"
                : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
            }
          >
            Upload new skin
          </button>
          <button
            type="button"
            onClick={() => {
              setSkinMode("pick");
              setTextureFile(null);
              setUnsignedFile(null);
              setSignedFile(null);
              setModelFile(null);
              setUse3d(false);
              if (fileRef.current) fileRef.current.value = "";
              if (modelRef.current) modelRef.current.value = "";
            }}
            className={
              skinMode === "pick"
                ? "text-[var(--tfmc-cream)] underline underline-offset-2"
                : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
            }
          >
            Use existing skin
          </button>
        </div>

        {skinMode === "upload" ? (
          <div className="mt-4 flex flex-col gap-4">
            {isBook ? (
              <>
                <label className="flex flex-col gap-2 text-left">
                  <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                    Unsigned cover (16×16)
                  </span>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(e) =>
                      void onPickBookFile(
                        "unsigned",
                        e.target.files?.[0] ?? null
                      )
                    }
                    className={FILE_INPUT_CLASS}
                  />
                  {unsignedFile ? (
                    <span className="text-xs text-[var(--tfmc-cream)]">
                      Selected: {unsignedFile.name}
                    </span>
                  ) : null}
                </label>
                <label className="flex flex-col gap-2 text-left">
                  <span className="text-sm font-medium text-[var(--tfmc-stone)]">
                    Signed cover (16×16)
                  </span>
                  <input
                    type="file"
                    accept="image/png"
                    onChange={(e) =>
                      void onPickBookFile(
                        "signed",
                        e.target.files?.[0] ?? null
                      )
                    }
                    className={FILE_INPUT_CLASS}
                  />
                  {signedFile ? (
                    <span className="text-xs text-[var(--tfmc-cream)]">
                      Selected: {signedFile.name}
                    </span>
                  ) : null}
                </label>
                <div className="flex flex-wrap gap-4">
                  {(
                    [
                      ["Unsigned", bookPreviewUrls.unsigned],
                      ["Signed", bookPreviewUrls.signed],
                    ] as const
                  ).map(([label, url]) => (
                    <div key={label} className="flex flex-col gap-1.5">
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
              </>
            ) : (
              <>
                {allows3d ? (
                  <label className="flex cursor-pointer items-center gap-2.5 text-sm text-[var(--tfmc-cream)]">
                    <FancyCheckbox
                      checked={use3d}
                      onChange={(checked) => {
                        setUse3d(checked);
                        if (!checked) {
                          setModelFile(null);
                          if (modelRef.current) modelRef.current.value = "";
                        }
                      }}
                      className="mt-0"
                    />
                    3D model
                  </label>
                ) : null}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                  className={FILE_INPUT_CLASS}
                />
                {textureFile ? (
                  <span className="text-xs text-[var(--tfmc-cream)]">
                    Selected: {textureFile.name}
                  </span>
                ) : null}
                {allows3d && use3d ? (
                  <>
                    {pairHint ? (
                      <p className="text-xs text-[var(--tfmc-stone)]">
                        {pairHint}
                      </p>
                    ) : null}
                    <input
                      ref={modelRef}
                      type="file"
                      accept="application/json,.json"
                      onChange={(e) =>
                        setModelFile(e.target.files?.[0] ?? null)
                      }
                      className={FILE_INPUT_CLASS}
                    />
                    {modelFile ? (
                      <span className="text-xs text-[var(--tfmc-cream)]">
                        Selected: {modelFile.name}
                      </span>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </div>
        ) : item.pickable_skins.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
            No applied skins for this base set yet. Upload one here; after staff
            approval you can reuse it on other characters.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm font-medium text-[var(--tfmc-stone)]">
              Your skins ({item.pickable_skins.length}) — usable on any
              character
            </p>
            <ul className="mt-2 flex flex-col gap-2">
            {item.pickable_skins.map((skin) => {
              const selected = pickedSkinId === skin.id;
              return (
                <li key={skin.id}>
                  <button
                    type="button"
                    onClick={() => setPickedSkinId(skin.id)}
                    className={`flex w-full items-center gap-3 rounded-sm border px-3 py-2 text-left text-sm transition-colors ${
                      selected
                        ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] text-[var(--tfmc-cream)]"
                        : "border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] text-[var(--tfmc-mist)] hover:border-[color-mix(in_srgb,var(--tfmc-cream)_28%,transparent)]"
                    }`}
                  >
                    <SkinThumb
                      id={skin.id}
                      baseSet={item.base_set}
                      token={sessionToken}
                    />
                    <span>
                      {skin.display_name || skin.id}
                      {isModel3dKind(asSkinKind(skin.kind, "handheld")) ? (
                        <span className="ml-2 text-xs text-[var(--tfmc-stone)]">
                          3D
                        </span>
                      ) : null}
                      {skin.staff ? (
                        <span className="ml-2 text-xs text-[var(--tfmc-stone)]">
                          staff
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          </>
        )}

        {isBook ? (
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
                Unsigned (writable)
              </p>
              {previewTexture ? (
                <ModelPreview kind="book" textureFile={previewTexture} />
              ) : (
                <p className="text-sm text-[var(--tfmc-mist)]">
                  Unsigned cover preview unavailable.
                </p>
              )}
            </div>
            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
                Signed (written)
              </p>
              {previewTextureSigned ? (
                <ModelPreview kind="book" textureFile={previewTextureSigned} />
              ) : (
                <p className="text-sm text-[var(--tfmc-mist)]">
                  Signed cover preview unavailable.
                </p>
              )}
            </div>
          </div>
        ) : previewTexture ? (
          <div className="mt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--tfmc-stone)]">
              {skinMode === "upload" && textureFile
                ? "Upload preview"
                : skinMode === "pick" && pickedSkinId
                  ? "Selected skin"
                  : "Default skin"}
            </p>
            <ModelPreview
              kind={
                pickedIs3d
                  ? asSkinKind(pickedSkin!.kind, "item_3d")
                  : skinMode === "upload" && allows3d && use3d && modelFile
                    ? threeDKind || "item_3d"
                    : flatKind
              }
              modelFile={
                pickedIs3d
                  ? previewModelFile
                  : skinMode === "upload" && allows3d && use3d && modelFile
                    ? modelFile
                    : null
              }
              textureFile={previewTexture}
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-[var(--tfmc-mist)]">
            Default skin preview unavailable.
          </p>
        )}
      </section>

      <div className="flex flex-col gap-3">
        {showError ? (
          <p className="text-sm text-[#e8a0a0]">{showError}</p>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={submitting || deleting || submitBlocked || !isDirty}
            className="rounded-sm bg-[var(--tfmc-moss)] px-4 py-2 text-sm text-[var(--tfmc-cream)] disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit item"}
          </button>
          {showDelete ? (
            <button
              type="button"
              onClick={() => {
                if (
                  typeof window !== "undefined" &&
                  !window.confirm(
                    "Reset this item to the kit default? Your uploaded skin stays in Player skins."
                  )
                ) {
                  return;
                }
                void onDelete?.();
              }}
              disabled={submitting || deleting}
              className="rounded-sm border border-[color-mix(in_srgb,#e8a0a0_55%,transparent)] px-4 py-2 text-sm text-[#e8a0a0] disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Delete customise"}
            </button>
          ) : null}
          {onRefreshStatus ? (
            <button
              type="button"
              onClick={() => void onRefreshStatus()}
              disabled={refreshing || submitting || deleting}
              className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
            >
              {refreshing ? "Refreshing…" : "Refresh status"}
            </button>
          ) : null}
        </div>
      </div>
    </form>
  );
}
