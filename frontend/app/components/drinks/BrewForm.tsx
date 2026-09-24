"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createSubmission,
  getCatalog,
  getPlayerMeta,
  getTextures,
  DrinksApiError,
  type DrinkCatalog,
  type DrinkIngredient,
  type DrinkTexture,
} from "../../../lib/drinks/api";
import {
  COMMON_EFFECTS,
  EXPECTED_PNG_SIZE,
  MAX_PNG_BYTES,
  WOOD_OPTIONS,
  effectLabel,
} from "../../../lib/drinks/constants";
import RankName from "../wiki/RankName";
import {
  setLastSubmissionId,
  setSession,
  type DrinksSession,
} from "../../../lib/drinks/session";
import NameColourPicker from "../shared/NameColourPicker";
import LoreLinesEditor from "../shared/LoreLinesEditor";
import ModelPreview from "../skins/ModelPreview";
import AppearancePicker, { type AppearanceMode } from "./AppearancePicker";
import EffectPickerModal from "./EffectPickerModal";
import FancyCheckbox from "./FancyCheckbox";
import IngredientPickerModal from "./IngredientPickerModal";

type IngredientRow = { id: string; amount: number };
type EffectRow = { type: string; level: number; duration: number };

type Props = {
  session: DrinksSession;
};

const fieldClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)] disabled:opacity-60";

const btnGhost =
  "text-xs text-[var(--tfmc-accent)] hover:underline disabled:opacity-50";
const btnDanger = "text-xs text-[#e8a0a0] hover:underline";

export default function BrewForm({ session }: Props) {
  const router = useRouter();
  const [allowTexture, setAllowTexture] = useState(
    session.allow_drink_texture === true
  );
  const [allowDrinkMessage, setAllowDrinkMessage] = useState(
    session.allow_drink_message === true
  );
  const [colourStops, setColourStops] = useState(
    Math.max(0, Math.floor(session.name_colour_stops ?? 0))
  );
  const [metaSynced, setMetaSynced] = useState(true);

  const [catalog, setCatalog] = useState<DrinkCatalog | null>(null);
  const [textures, setTextures] = useState<DrinkTexture[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  const [name, setName] = useState("");
  const [nameColours, setNameColours] = useState<string[]>([]);
  const [nameBad, setNameBad] = useState("");
  const [nameGood, setNameGood] = useState("");
  const [ingredients, setIngredients] = useState<IngredientRow[]>([]);
  const [cookingTime, setCookingTime] = useState(5);
  const [distillEnabled, setDistillEnabled] = useState(false);
  const [distillRuns, setDistillRuns] = useState(1);
  const [distillTime, setDistillTime] = useState(40);
  const [wood, setWood] = useState("2");
  const [age, setAge] = useState(0);
  const [difficulty, setDifficulty] = useState(3);
  const [alcohol, setAlcohol] = useState(0);
  const [loreLines, setLoreLines] = useState<string[]>([]);
  const [drinkMessage, setDrinkMessage] = useState("");
  const [drinkMessageColours, setDrinkMessageColours] = useState<string[]>([]);
  const [messageEnabled, setMessageEnabled] = useState(false);
  const [glint, setGlint] = useState(false);
  const [effects, setEffects] = useState<EffectRow[]>([]);
  const [appearance, setAppearance] = useState<AppearanceMode>("color");
  const [color, setColor] = useState("#C45A12");
  const [textureFile, setTextureFile] = useState<File | null>(null);
  const [existingTextureId, setExistingTextureId] = useState("");
  const [previewFile, setPreviewFile] = useState<File | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ingredientModal, setIngredientModal] = useState<{
    open: boolean;
    editIndex: number | null;
  }>({ open: false, editIndex: null });
  const [effectModal, setEffectModal] = useState<{
    open: boolean;
    editIndex: number | null;
  }>({ open: false, editIndex: null });

  useEffect(() => {
    let cancelled = false;
    async function refreshMeta() {
      try {
        const meta = await getPlayerMeta(session.session_token);
        if (cancelled) return;
        setAllowTexture(meta.allow_drink_texture === true);
        setAllowDrinkMessage(meta.allow_drink_message === true);
        setColourStops(Math.max(0, Math.floor(meta.name_colour_stops)));
        setMetaSynced(meta.meta_synced !== false);
        setSession({
          ...session,
          allow_drink_texture: meta.allow_drink_texture === true,
          allow_drink_message: meta.allow_drink_message === true,
          name_colour_stops: Math.max(0, Math.floor(meta.name_colour_stops)),
        });
      } catch {
        // Keep redeem-time session snapshot if refresh fails.
      }
    }
    void refreshMeta();
    return () => {
      cancelled = true;
    };
  }, [session.session_token]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingCatalog(true);
      setLoadError(null);
      try {
        const cat = await getCatalog();
        if (cancelled) return;
        setCatalog(cat);
        if (allowTexture) {
          const tex = await getTextures(session.session_token);
          if (!cancelled) setTextures(tex);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(
          err instanceof DrinksApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Failed to load catalog"
        );
      } finally {
        if (!cancelled) setLoadingCatalog(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [allowTexture, session.session_token]);

  useEffect(() => {
    if (appearance === "upload" && textureFile) {
      setPreviewFile(textureFile);
      setPreviewError(null);
      return;
    }
    setPreviewFile(null);
    if (appearance !== "color") {
      setPreviewError(null);
    }
  }, [appearance, textureFile]);

  const ingredientById = useMemo(() => {
    const map = new Map<string, DrinkIngredient>();
    for (const item of catalog?.ingredients || []) {
      map.set(item.id, item);
    }
    return map;
  }, [catalog]);

  const effectChoices = useMemo(() => {
    const blacklist = new Set(
      (catalog?.effects_blacklist || []).map((e) => e.toLowerCase())
    );
    return COMMON_EFFECTS.filter((e) => !blacklist.has(e));
  }, [catalog]);

  function validateClient(): string | null {
    if (!name.trim()) return "Enter a drink name";
    if (!catalog || catalog.ingredients.length === 0) {
      return "Ingredient catalog is empty. Ask staff to sync DrinkBuilder.";
    }
    if (ingredients.length === 0) return "Add at least one ingredient";
    for (const row of ingredients) {
      if (!Number.isFinite(row.amount) || row.amount < 1) {
        return "Ingredient amounts must be at least 1";
      }
    }
    if (appearance === "color") {
      if (!/^#[0-9A-Fa-f]{6}$/.test(color.trim())) {
        return "Color must be #RRGGBB";
      }
    } else if (!allowTexture) {
      return "Your rank cannot use custom textures";
    } else if (appearance === "upload") {
      if (!textureFile) return "Choose a PNG texture";
      if (textureFile.size > MAX_PNG_BYTES) {
        return `PNG must be under ${MAX_PNG_BYTES} bytes`;
      }
      if (!textureFile.name.toLowerCase().endsWith(".png")) {
        return "Texture must be a PNG";
      }
    } else if (appearance === "reuse") {
      if (!existingTextureId.trim()) return "Pick an existing texture";
    }
    return null;
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const clientError = validateClient();
    if (clientError) {
      setError(clientError);
      return;
    }
    if (!catalog) return;

    const names =
      nameBad.trim() || nameGood.trim()
        ? [
            nameBad.trim() || name.trim(),
            name.trim(),
            nameGood.trim() || name.trim(),
          ]
        : undefined;

    const recipe = {
      name: name.trim(),
      ...(names ? { names } : {}),
      ...(nameColours.length ? { name_colours: nameColours } : {}),
      ingredients: ingredients.map((r) => ({
        id: r.id.trim(),
        amount: Math.floor(r.amount),
      })),
      cooking_time: Math.max(0, Math.floor(cookingTime)),
      distill_runs: distillEnabled ? Math.max(0, Math.floor(distillRuns)) : 0,
      distill_time: distillEnabled ? Math.max(0, Math.floor(distillTime)) : 0,
      wood: wood || null,
      age: Math.max(0, Math.floor(age)),
      difficulty: Math.min(10, Math.max(1, Math.floor(difficulty))),
      alcohol: Math.min(100, Math.max(0, Math.floor(alcohol))),
      effects: effects
        .filter((ef) => ef.type.trim())
        .map((ef) => ({
          type: ef.type.trim().toLowerCase(),
          level: Math.max(1, Math.floor(ef.level || 1)),
          duration: Math.max(1, Math.floor(ef.duration || 1)),
        })),
      lore: loreLines.map((line) => line.trim()).filter(Boolean),
      ...(messageEnabled && allowDrinkMessage
        ? {
            drink_message: drinkMessage.trim() || null,
            ...(drinkMessageColours.length
              ? { drink_message_colours: drinkMessageColours }
              : {}),
          }
        : {}),
      glint,
      color: appearance === "color" ? color.trim() : null,
    };

    if (appearance === "upload" && textureFile) {
      const ok = await checkPngSize(textureFile);
      if (!ok) {
        setError(`PNG must be ${EXPECTED_PNG_SIZE}×${EXPECTED_PNG_SIZE}`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const created = await createSubmission({
        sessionToken: session.session_token,
        recipe,
        texture: appearance === "upload" ? textureFile : null,
        existingTextureId:
          appearance === "reuse" ? existingTextureId.trim() : null,
      });
      setLastSubmissionId(created.id);
      router.push(`/drinks/${created.id}`);
    } catch (err) {
      setError(
        err instanceof DrinksApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Submit failed"
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingCatalog) {
    return (
      <p className="mt-8 text-sm text-[var(--tfmc-mist)]">Loading catalog…</p>
    );
  }

  if (loadError) {
    return (
      <p className="mt-8 text-sm text-[#e8a0a0]" role="alert">
        {loadError}
      </p>
    );
  }

  if (!catalog || catalog.ingredients.length === 0) {
    return (
      <div className="mt-8 space-y-2">
        <p className="text-[var(--tfmc-cream)]">Ingredient catalog is empty.</p>
        <p className="text-sm text-[var(--tfmc-mist)]">
          Staff need to run{" "}
          <code className="text-[var(--tfmc-accent)]">
            /drinkbuilder catalog sync
          </code>{" "}
          on the server before drinks can be submitted.
        </p>
      </div>
    );
  }

  const categories = catalog.categories || {};
  const editingIngredient =
    ingredientModal.editIndex != null
      ? ingredients[ingredientModal.editIndex] || null
      : null;
  const editingEffect =
    effectModal.editIndex != null
      ? effects[effectModal.editIndex] || null
      : null;

  return (
    <form onSubmit={onSubmit} className="mt-8 flex w-full flex-col gap-8">
      <section className="space-y-4">
        <h2 className="text-sm font-medium text-[var(--tfmc-stone)]">Names</h2>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-[var(--tfmc-mist)]">
            Drink name (normal quality)
          </span>
          <input
            className={fieldClass}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={48}
            required
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--tfmc-mist)]">
              Bad quality name (optional)
            </span>
            <input
              className={fieldClass}
              value={nameBad}
              onChange={(e) => setNameBad(e.target.value)}
              maxLength={48}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--tfmc-mist)]">
              Good quality name (optional)
            </span>
            <input
              className={fieldClass}
              value={nameGood}
              onChange={(e) => setNameGood(e.target.value)}
              maxLength={48}
            />
          </label>
        </div>
        <NameColourPicker
          colours={nameColours}
          onChange={setNameColours}
          previewText={name.trim() || "Preview"}
          maxStops={colourStops}
          lockedMessage={
            !metaSynced && colourStops <= 0
              ? "Join the server once to sync rank perks"
              : "Name colours require a donator rank"
          }
        />
        <p className="text-xs text-[var(--tfmc-mist)]">
          Same colours apply to normal, bad, and good quality names.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--tfmc-stone)]">
          Ingredients
        </h2>
        {ingredients.length === 0 ? (
          <p className="text-xs text-[var(--tfmc-mist)]">No ingredients yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {ingredients.map((row, idx) => {
              const item = ingredientById.get(row.id);
              const cat = item?.category || "other";
              return (
                <li
                  key={`${row.id}-${idx}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_35%,transparent)] px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-[var(--tfmc-cream)]">
                      {item?.label || row.id}{" "}
                      <span className="text-[var(--tfmc-mist)]">×{row.amount}</span>
                    </p>
                    <p className="text-xs text-[var(--tfmc-mist)]">
                      {categories[cat] || cat}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      className={btnGhost}
                      onClick={() =>
                        setIngredientModal({ open: true, editIndex: idx })
                      }
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className={btnDanger}
                      onClick={() =>
                        setIngredients((rows) => rows.filter((_, i) => i !== idx))
                      }
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)]"
          onClick={() => setIngredientModal({ open: true, editIndex: null })}
        >
          Add ingredient
        </button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <NumberField
          label="Cooking time (minutes)"
          value={cookingTime}
          onChange={setCookingTime}
          min={0}
        />
        <NumberField label="Age (years)" value={age} onChange={setAge} min={0} />
        <NumberField
          label="Difficulty (1–10)"
          value={difficulty}
          onChange={setDifficulty}
          min={1}
          max={10}
        />
        <NumberField
          label="Alcohol (0–100)"
          value={alcohol}
          onChange={setAlcohol}
          min={0}
          max={100}
        />
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-xs text-[var(--tfmc-mist)]">Barrel wood</span>
          <select
            className={fieldClass}
            value={wood}
            onChange={(e) => setWood(e.target.value)}
          >
            {WOOD_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <div className="sm:col-span-2 space-y-3">
          <FancyCheckbox
            checked={distillEnabled}
            onChange={setDistillEnabled}
            label="Distill"
            description="Enable distillation runs for this recipe"
          />
          {distillEnabled ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Distill runs"
                value={distillRuns}
                onChange={setDistillRuns}
                min={1}
              />
              <NumberField
                label="Distill time"
                value={distillTime}
                onChange={setDistillTime}
                min={0}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-[var(--tfmc-stone)]">Effects</h2>
        {effects.length === 0 ? (
          <p className="text-xs text-[var(--tfmc-mist)]">No effects (optional).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {effects.map((ef, idx) => (
              <li
                key={`${ef.type}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_35%,transparent)] px-3 py-2"
              >
                <p className="text-sm text-[var(--tfmc-cream)]">
                  {effectLabel(ef.type)}{" "}
                  <span className="text-[var(--tfmc-mist)]">
                    Lv{ef.level} · {ef.duration}s
                  </span>
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    className={btnGhost}
                    onClick={() =>
                      setEffectModal({ open: true, editIndex: idx })
                    }
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className={btnDanger}
                    onClick={() =>
                      setEffects((rows) => rows.filter((_, i) => i !== idx))
                    }
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_50%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-accent)] hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_12%,transparent)] disabled:opacity-50"
          onClick={() => setEffectModal({ open: true, editIndex: null })}
          disabled={effectChoices.length === 0}
        >
          Add potion effect
        </button>
      </section>

      <section className="space-y-4">
        <AppearancePicker
          value={appearance}
          onChange={setAppearance}
          allowTexture={allowTexture}
          reuseDisabled={textures.length === 0}
        />
        {appearance === "color" ? (
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--tfmc-mist)]">#RRGGBB</span>
            <div className="flex gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-14 cursor-pointer rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-transparent"
              />
              <input
                className={`${fieldClass} flex-1`}
                value={color}
                onChange={(e) => setColor(e.target.value)}
                maxLength={7}
              />
            </div>
          </label>
        ) : null}
        {appearance === "upload" ? (
          <div className="flex flex-col gap-2">
            <span className="text-xs text-[var(--tfmc-mist)]">
              {EXPECTED_PNG_SIZE}×{EXPECTED_PNG_SIZE} PNG potion icon (max{" "}
              {Math.floor(MAX_PNG_BYTES / 1024)} KB)
            </span>
            <label className="inline-flex w-fit cursor-pointer items-center justify-center rounded-sm bg-[var(--tfmc-moss)] px-4 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition hover:brightness-110">
              {textureFile ? "Change file" : "Choose PNG file"}
              <input
                type="file"
                accept="image/png,.png"
                className="sr-only"
                onChange={(e) => setTextureFile(e.target.files?.[0] || null)}
              />
            </label>
            {textureFile ? (
              <p className="text-xs text-[var(--tfmc-mist)]">{textureFile.name}</p>
            ) : null}
          </div>
        ) : null}
        {appearance === "reuse" ? (
          textures.length === 0 ? (
            <p className="text-sm text-[var(--tfmc-mist)]">
              You have no applied textures to reuse yet.
            </p>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--tfmc-mist)]">
                Applied textures you own
              </span>
              <select
                className={fieldClass}
                value={existingTextureId}
                onChange={(e) => setExistingTextureId(e.target.value)}
              >
                <option value="">Select…</option>
                {textures.map((tex) => {
                  const label =
                    (tex.ia_item_id && tex.ia_item_id.trim()) ||
                    tex.id.slice(0, 12);
                  return (
                    <option key={tex.id} value={tex.id}>
                      {label} (CMD {tex.cmd})
                    </option>
                  );
                })}
              </select>
            </label>
          )
        ) : null}
        {appearance === "color" || previewFile ? (
          <div className="space-y-2">
            <span className="text-xs text-[var(--tfmc-mist)]">Preview</span>
            <ModelPreview
              kind="handheld"
              flatDisplayPreset="generated"
              potionTintColor={appearance === "color" ? color : null}
              flatTextureFile={previewFile}
              textureFile={previewFile}
              onPreviewError={setPreviewError}
            />
          </div>
        ) : previewError ? (
          <p className="text-sm text-[var(--tfmc-mist)]">{previewError}</p>
        ) : null}
      </section>

      <section className="space-y-4">
        <LoreLinesEditor
          lines={loreLines}
          onChange={setLoreLines}
          heading="compact"
          emptyMessage="No lore (optional)."
        />
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-medium text-[var(--tfmc-stone)]">Extras</h2>

        <FancyCheckbox
          checked={messageEnabled}
          onChange={setMessageEnabled}
          locked={!allowDrinkMessage}
          label="Drink message"
          description="Show a short message when someone drinks your brew"
          lockedDescription="Requires an eligible supporter rank"
        />
        {!allowDrinkMessage ? (
          <p className="text-xs text-[var(--tfmc-mist)]">Custom drink messages require <RankName rank="Ascended" /> rank.</p>
        ) : null}
        {messageEnabled && allowDrinkMessage ? (
          <>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-[var(--tfmc-mist)]">Message text</span>
              <input
                className={fieldClass}
                value={drinkMessage}
                onChange={(e) => setDrinkMessage(e.target.value)}
                maxLength={120}
              />
            </label>
            <NameColourPicker
              colours={drinkMessageColours}
              onChange={setDrinkMessageColours}
              previewText={drinkMessage.trim() || "Drink message"}
              maxStops={colourStops}
              lockedMessage={
                !metaSynced && colourStops <= 0
                  ? "Join the server once to sync rank perks"
                  : "Message colours require a donator rank"
              }
            />
          </>
        ) : null}

        <FancyCheckbox
          checked={glint}
          onChange={setGlint}
          label="Enchantment glint"
          description="Shiny enchanted look on the finished drink"
        />
      </section>

      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit drink"}
      </button>

      <IngredientPickerModal
        open={ingredientModal.open}
        onClose={() => setIngredientModal({ open: false, editIndex: null })}
        title={
          ingredientModal.editIndex != null ? "Edit ingredient" : "Add ingredient"
        }
        ingredients={catalog.ingredients}
        categories={categories}
        initial={editingIngredient}
        onSave={(row) => {
          setIngredients((rows) => {
            if (ingredientModal.editIndex != null) {
              return rows.map((r, i) =>
                i === ingredientModal.editIndex ? row : r
              );
            }
            return [...rows, row];
          });
        }}
      />
      <EffectPickerModal
        open={effectModal.open}
        onClose={() => setEffectModal({ open: false, editIndex: null })}
        title={
          effectModal.editIndex != null ? "Edit potion effect" : "Add potion effect"
        }
        effectChoices={[...effectChoices]}
        initial={editingEffect}
        onSave={(row) => {
          setEffects((rows) => {
            if (effectModal.editIndex != null) {
              return rows.map((r, i) =>
                i === effectModal.editIndex ? row : r
              );
            }
            return [...rows, row];
          });
        }}
      />
    </form>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs text-[var(--tfmc-mist)]">{label}</span>
      <input
        type="number"
        className={fieldClass}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function checkPngSize(file: File): Promise<boolean> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img.width === EXPECTED_PNG_SIZE && img.height === EXPECTED_PNG_SIZE);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(false);
    };
    img.src = url;
  });
}
