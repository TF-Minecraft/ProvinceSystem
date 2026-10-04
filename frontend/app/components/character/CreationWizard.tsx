"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AgeStepper from "./AgeStepper";
import AttributeSheet from "./AttributeSheet";
import ClueStageFields from "./ClueStageFields";
import SelectableOption from "./SelectableOption";
import {
  CharactersApiError,
  createCharacter,
  uploadPendingCreateWardrobe,
  wardrobeSlotLabel,
  type CatalogStage,
  type CreationCatalog,
} from "../../../lib/characters/api";
import {
  assertWardrobeSkinPng,
  friendlyWardrobeUploadError,
} from "../../../lib/characters/wardrobeSkin";
import WardrobeEditor, {
  type WardrobeDraftFiles,
  type WardrobeDraftModels,
  type WardrobeDraftNames,
} from "./WardrobeEditor";
import { armModelToWardrobeModel } from "../../../lib/characters/wardrobeRanks";
import {
  ageFromBirthday,
  fictionalBirthdayLabel,
  parseBirthdayInput,
  resolveCalendarConfig,
} from "../../../lib/characters/fantasyCalendar";
import {
  clueContinueBlockReason,
  clueLengthBounds,
  cluesRequired,
  draftModifierTotals,
  filledClues,
  interactiveProgress,
  newDraft,
  optionAttributeDescriptionLines,
  optionDescriptionLines,
  optionModifierPreview,
  parseStageCopy,
  playableStages,
  resolveMutuallyExclusiveNames,
  resolveTraitDependencyNames,
  selectedTraitsForKey,
  setTraitsForKey,
  stageCanContinue,
  stageDisplayTitle,
  toCreateBody,
  traitCost,
  traitExclusiveBlocked,
  traitPlaytimeBlocked,
  traitPlaytimeReason,
  traitPointsRemaining,
  traitsForStage,
  type WizardDraft,
} from "../../../lib/characters/wizardState";
import {
  DISPLAY_NAME_HINT,
  displayNameError,
  optionalDisplayNameError,
  proseError,
} from "../../../lib/textValidation";
import NameColourPicker from "../shared/NameColourPicker";

type Props = {
  catalog: CreationCatalog;
  sessionToken: string;
  onLogout: () => void;
  loggingOut?: boolean;
  uiDev?: boolean;
  /** Skip age_stage + creation_age_set_stage when player already attested. */
  skipRealAge?: boolean;
  /** Account age meets evil unlock threshold (from list / UI-dev). */
  evilUnlocked?: boolean;
  accountAgeSeconds?: number;
  /** Rank perk: max name colour stops (0 = locked / donators only). */
  nameColourStops?: number;
  /** Swappable wardrobe skins (1–3). */
  wardrobeSkinSlots?: number;
};

function displayName(row: { id: string; name?: string }): string {
  return (row.name && String(row.name).trim()) || row.id;
}

function StageBody({
  stage,
  draft,
  catalog,
  setDraft,
  onJump,
  skipRealAge = false,
  accountAgeSeconds = 0,
  nameColourStops = 0,
  wardrobeDraft,
  onWardrobeDraftChange,
  wardrobeDraftNames,
  onWardrobeDraftNamesChange,
  wardrobeDraftModels,
  onWardrobeDraftModelsChange,
  wardrobeSkinSlots = 1,
  sessionToken,
  onWardrobeAutoMaskedChange,
}: {
  stage: CatalogStage;
  draft: WizardDraft;
  catalog: CreationCatalog;
  setDraft: (d: WizardDraft) => void;
  onJump: (stageId: string) => void;
  skipRealAge?: boolean;
  accountAgeSeconds?: number;
  nameColourStops?: number;
  wardrobeDraft: WardrobeDraftFiles;
  onWardrobeDraftChange: (next: WardrobeDraftFiles) => void;
  wardrobeDraftNames: WardrobeDraftNames;
  onWardrobeDraftNamesChange: (next: WardrobeDraftNames) => void;
  wardrobeDraftModels: WardrobeDraftModels;
  onWardrobeDraftModelsChange: (next: WardrobeDraftModels) => void;
  wardrobeSkinSlots?: number;
  sessionToken: string;
  onWardrobeAutoMaskedChange: (value: boolean) => void;
}) {
  const type = String(stage.type || "").toLowerCase();
  const target = String(stage.target || "").toLowerCase();
  const copy = parseStageCopy(stage);
  const modifierTotals = draftModifierTotals(draft, catalog);

  if (type === "wardrobe") {
    return (
      <div className="flex flex-col gap-4">
        {copy.bodyLines.map((line, i) => (
          <p
            key={`${stage.id}-body-${i}`}
            className="text-sm leading-relaxed text-[var(--tfmc-mist)]"
          >
            {line}
          </p>
        ))}
        <WardrobeEditor
          mode="draft"
          slotLimits={catalog.slot_limits}
          swappableSlots={wardrobeSkinSlots}
          sessionToken={sessionToken}
          draftFiles={wardrobeDraft}
          draftNames={wardrobeDraftNames}
          draftModels={wardrobeDraftModels}
          onDraftFilesChange={onWardrobeDraftChange}
          onDraftNamesChange={onWardrobeDraftNamesChange}
          onDraftModelsChange={onWardrobeDraftModelsChange}
          onAutoMaskedChange={onWardrobeAutoMaskedChange}
        />
      </div>
    );
  }

  if (type === "info") {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="font-[family-name:var(--font-fraunces)] text-3xl leading-tight text-[var(--tfmc-cream)] sm:text-4xl">
          {copy.title || stageDisplayTitle(stage)}
        </h2>
        {copy.bodyLines.map((line, i) => (
          <p
            key={`${stage.id}-body-${i}`}
            className="text-base leading-relaxed text-[var(--tfmc-mist)]"
          >
            {line}
          </p>
        ))}
      </div>
    );
  }

  if (type === "setter" && target === "real_age") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-[var(--tfmc-mist)]">
          Are you 18+ in real life?
        </p>
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Yes", value: true },
            { label: "No", value: false },
          ].map((opt) => {
            const on = draft.eighteen === opt.value;
            return (
              <button
                key={opt.label}
                type="button"
                onClick={() => setDraft({ ...draft, eighteen: opt.value })}
                className={`rounded-sm border px-3 py-3 text-center font-medium transition ${
                  on
                    ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_15%,transparent)] text-[var(--tfmc-cream)]"
                    : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-cream)] hover:border-[color-mix(in_srgb,var(--tfmc-cream)_40%,transparent)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-[var(--tfmc-stone)]">
          Lying about this results in a permanent ban with no appeal.
        </p>
      </div>
    );
  }

  if (type === "setter" && target === "name") {
    const min = catalog.validation?.name?.min_length ?? 1;
    const max = catalog.validation?.name?.max_length ?? 32;
    const nameErr =
      draft.name.trim().length > 0
        ? displayNameError(draft.name, { minLen: min, maxLen: max, field: "name" })
        : null;
    const colourCap = Math.max(0, Math.min(8, nameColourStops));
    return (
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-[var(--tfmc-stone)]">Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Character name"
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)]"
          />
          <span className="text-xs text-[var(--tfmc-mist)]">
            Allowed: {DISPLAY_NAME_HINT}
          </span>
          {nameErr ? (
            <span className="text-xs text-[#e8a0a0]">{nameErr}</span>
          ) : null}
        </label>
        <NameColourPicker
          colours={draft.name_colours}
          onChange={(name_colours) => setDraft({ ...draft, name_colours })}
          previewText={draft.name.trim() || "Preview"}
          maxStops={colourCap}
          lockedMessage="Only for donators"
        />
      </div>
    );
  }

  if (type === "setter" && target === "age") {
    const min = Number(catalog.validation?.age?.minimum ?? 1) || 1;
    const race = (catalog.races || []).find((r) => r.id === draft.race_id);
    const raceMax = Number(race?.age_max);
    const max =
      Number.isFinite(raceMax) && raceMax > 0 ? raceMax : 200;
    const cal = catalog.validation?.calendar;
    const ageForBirthday =
      String(draft.age || "").trim() || String(min);
    const birthdayLabel =
      fictionalBirthdayLabel(
        ageForBirthday,
        draft.client_request_id,
        cal,
        draft.birthday
      ) || "";
    const { eraSuffix } = resolveCalendarConfig(cal);

    return (
      <AgeStepper
        value={draft.age}
        min={min}
        max={max}
        birthdayValue={birthdayLabel}
        birthdayHint={`DD/MM/YYYY${eraSuffix ? ` ${eraSuffix}` : ""}`}
        onChange={(age) =>
          setDraft({ ...draft, age, birthday: null })
        }
        onBirthdayApply={(raw) => {
          const iso = parseBirthdayInput(raw, cal);
          if (!iso) {
            return `Use ${eraSuffix ? `DD/MM/YYYY ${eraSuffix}` : "DD/MM/YYYY"}`;
          }
          const years = ageFromBirthday(iso, cal);
          if (years === null) {
            return "Invalid birthday";
          }
          if (years < min || years > max) {
            return `Age must be between ${min} and ${max} for your race`;
          }
          setDraft({
            ...draft,
            birthday: iso,
            age: String(years),
          });
          return null;
        }}
      />
    );
  }

  if (type === "setter" && target === "description") {
    const descMin = catalog.validation?.description?.min_length ?? 1;
    const descMax = catalog.validation?.description?.max_length ?? 2000;
    const descErr =
      draft.description.trim().length > 0
        ? proseError(draft.description, {
            minLen: descMin,
            maxLen: descMax,
            field: "description",
          })
        : null;
    const genderErr = optionalDisplayNameError(draft.gender, {
      maxLen: 24,
      field: "gender",
    });
    return (
      <div className="flex flex-col gap-4">
        {copy.bodyLines[0] ? (
          <p className="text-sm text-[var(--tfmc-mist)]">{copy.bodyLines[0]}</p>
        ) : null}
        <label className="flex flex-col gap-2">
          <span className="text-sm text-[var(--tfmc-stone)]">Description</span>
          <textarea
            rows={5}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)]"
          />
          {descErr ? (
            <span className="text-xs text-[#e8a0a0]">{descErr}</span>
          ) : null}
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-sm text-[var(--tfmc-stone)]">
            Gender (optional)
          </span>
          <input
            value={draft.gender}
            onChange={(e) => setDraft({ ...draft, gender: e.target.value })}
            placeholder="unspecified"
            className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)]"
          />
          {genderErr ? (
            <span className="text-xs text-[#e8a0a0]">{genderErr}</span>
          ) : null}
        </label>
      </div>
    );
  }

  if (type === "selection" && target === "class") {
    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {(catalog.classes || []).map((c) => {
          const selected = draft.class_id === c.id;
          return (
            <li key={c.id}>
              <SelectableOption
                title={displayName(c)}
                selected={selected}
                descriptionLines={optionDescriptionLines(c)}
                attributeDescriptionLines={optionAttributeDescriptionLines(c)}
                onSelect={() =>
                  setDraft({
                    ...draft,
                    class_id: selected ? "" : c.id,
                  })
                }
              />
            </li>
          );
        })}
      </ul>
    );
  }

  if (type === "selection" && target === "race") {
    return (
      <ul className="grid gap-2 sm:grid-cols-2">
        {(catalog.races || []).map((r) => {
          const selected = draft.race_id === r.id;
          return (
            <li key={r.id}>
              <SelectableOption
                title={displayName(r)}
                selected={selected}
                descriptionLines={optionDescriptionLines(r)}
                modifierLines={optionModifierPreview(
                  modifierTotals,
                  r,
                  catalog
                )}
                onSelect={() =>
                  setDraft({
                    ...draft,
                    race_id: selected ? "" : r.id,
                  })
                }
              />
            </li>
          );
        })}
      </ul>
    );
  }

  if (type === "selection" && target === "trait") {
    const key = String(stage.key || "").trim();
    const options = traitsForStage(catalog, stage);
    const selected = selectedTraitsForKey(draft, catalog, key);
    const max = Number(stage.max_select ?? 1);
    const min = Number(stage.min_select ?? 0);
    const budget = Number(stage.points ?? 0);
    const hasBudget = budget > 0;
    const remaining = hasBudget
      ? traitPointsRemaining(draft, catalog, key, budget)
      : 0;

    function toggle(id: string) {
      const set = new Set(selected);
      if (set.has(id)) {
        set.delete(id);
      } else {
        const trait = options.find((t) => t.id === id);
        if (!trait) return;
        if (traitPlaytimeBlocked(trait, accountAgeSeconds)) return;
        const cost = traitCost(trait);
        const outsideKey = draft.traitIds.filter(
          (tid) => !options.some((o) => o.id === tid)
        );
        let nextInKey: string[];
        if (max <= 1) {
          nextInKey = [id];
          const nextRemaining = budget - cost;
          if (hasBudget && cost > budget) return;
          if (hasBudget && nextRemaining < 0) return;
        } else {
          if (set.size >= max) return;
          if (hasBudget && cost > remaining) return;
          nextInKey = [...selected, id];
        }
        const others = [...outsideKey, ...nextInKey.filter((x) => x !== id)];
        if (traitExclusiveBlocked(trait, others, catalog)) return;
        set.clear();
        for (const x of nextInKey) set.add(x);
      }
      setDraft(setTraitsForKey(draft, catalog, key, [...set]));
    }

    const countLabel =
      min === max
        ? `Selected ${selected.length}/${max}`
        : [
            `Selected ${selected.length}`,
            `(${[
              min > 1 ? `Min ${min}` : null,
              `Max ${max}`,
            ]
              .filter(Boolean)
              .join(", ")})`,
          ].join(" ");

    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-[var(--tfmc-stone)]">
          {countLabel}
          {hasBudget ? ` · Points remaining ${remaining}` : null}
        </p>
        <ul className="grid max-h-[42vh] gap-2 overflow-y-auto pr-1">
          {options.map((t) => {
            const on = selected.includes(t.id);
            const cost = traitCost(t);
            const playtimeBlocked = traitPlaytimeBlocked(t, accountAgeSeconds);
            const wouldOverSelect = !on && max > 1 && selected.length >= max;
            const wouldOverSpend =
              !on && hasBudget && cost > remaining && !(max <= 1);
            const singleTooExpensive =
              !on && max <= 1 && hasBudget && cost > budget;
            const outsideKey = draft.traitIds.filter(
              (tid) => !options.some((o) => o.id === tid)
            );
            const exclusivePeers =
              max <= 1
                ? outsideKey
                : [...outsideKey, ...selected.filter((id) => id !== t.id)];
            const exclusiveConflict =
              !on && traitExclusiveBlocked(t, exclusivePeers, catalog);
            const blocked =
              playtimeBlocked ||
              wouldOverSelect ||
              wouldOverSpend ||
              singleTooExpensive;
            return (
              <li key={t.id}>
                <SelectableOption
                  title={displayName(t)}
                  selected={on}
                  cost={cost !== 0 ? cost : null}
                  showCostInBody={cost !== 0}
                  descriptionLines={[
                    ...optionDescriptionLines(t),
                    ...(t.fuel_disclaimer
                      ? ["Requires arcane fuel to stay powered."]
                      : []),
                  ]}
                  dependency={resolveTraitDependencyNames(t, catalog)}
                  mutuallyExclusive={resolveMutuallyExclusiveNames(t, catalog)}
                  modifierLines={optionModifierPreview(
                    modifierTotals,
                    t,
                    catalog
                  )}
                  disabled={blocked}
                  exclusiveConflict={exclusiveConflict}
                  disabledReason={
                    playtimeBlocked ? traitPlaytimeReason(t) : null
                  }
                  onSelect={() => toggle(t.id)}
                />
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  if (type === "attributes" && catalog.attribute_point_buy) {
    return (
      <AttributeSheet
        ranks={draft.attributes}
        apb={catalog.attribute_point_buy}
        onChange={(attributes) => setDraft({ ...draft, attributes })}
      />
    );
  }

  if (type === "clue") {
    const required = cluesRequired(draft, catalog);
    const { minLen, maxLen, maxClues } = clueLengthBounds(catalog);
    return (
      <ClueStageFields
        clues={filledClues(draft)}
        required={required}
        minLen={minLen}
        maxLen={maxLen}
        maxClues={maxClues}
        onChange={(clues) => setDraft({ ...draft, clues })}
      />
    );
  }

  if (type === "summary") {
    const race = catalog.races.find((r) => r.id === draft.race_id);
    const klass = catalog.classes.find((c) => c.id === draft.class_id);
    const traitNames = draft.traitIds.map((id) => {
      const t = catalog.traits.find((x) => x.id === id);
      return t ? displayName(t) : id;
    });

    return (
      <div className="flex max-h-[50vh] flex-col gap-4 overflow-y-auto pr-1 text-sm text-[var(--tfmc-mist)]">
        <SummaryLine
          label="Name"
          value={draft.name}
          onEdit={() => onJump("name")}
        />
        {!skipRealAge ? (
          <SummaryLine
            label="18+"
            value={
              draft.eighteen === true
                ? "Yes"
                : draft.eighteen === false
                  ? "No"
                  : "-"
            }
            onEdit={() => onJump("real_age")}
          />
        ) : null}
        <SummaryLine
          label="Age"
          value={draft.age}
          onEdit={() => onJump("age")}
        />
        <SummaryLine
          label="Race"
          value={race ? displayName(race) : draft.race_id}
          onEdit={() => onJump("race")}
        />
        <SummaryLine
          label="Class"
          value={klass ? displayName(klass) : draft.class_id}
          onEdit={() => onJump("class")}
        />
        <SummaryLine
          label="Attributes"
          value={Object.entries(draft.attributes)
            .map(([k, v]) => `${k} +${v}`)
            .join(", ")}
          onEdit={() => onJump("attributes")}
        />
        <SummaryLine
          label="Traits"
          value={traitNames.join(", ") || "-"}
          onEdit={() => onJump("trait")}
        />
        <SummaryLine
          label="Description"
          value={draft.description}
          onEdit={() => onJump("description")}
        />
        <SummaryLine
          label="Clues"
          value={draft.clues.filter((c) => c.trim()).join(" · ") || "-"}
          onEdit={() => onJump("clue")}
        />
      </div>
    );
  }

  return (
    <p className="text-[var(--tfmc-mist)]">
      Unsupported stage type “{type}”. Continue to skip.
    </p>
  );
}

function SummaryLine({
  label,
  value,
  onEdit,
}: {
  label: string;
  value: string;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pb-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-[var(--tfmc-stone)]">
          {label}
        </p>
        <p className="mt-1 text-[var(--tfmc-cream)]">{value || "-"}</p>
      </div>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-xs text-[var(--tfmc-accent)] hover:underline"
      >
        Edit
      </button>
    </div>
  );
}

function PeekCard({
  stage,
  position,
}: {
  stage: CatalogStage;
  position: "prev" | "next";
}) {
  const title = stageDisplayTitle(stage);
  return (
    <div
      className={`char-deck-peek char-deck-peek-${position}`}
      aria-hidden
    >
      <div className="char-deck-peek-inner">
        <p className="truncate font-[family-name:var(--font-fraunces)] text-lg text-[var(--tfmc-cream)]">
          {title}
        </p>
      </div>
    </div>
  );
}

export default function CreationWizard({
  catalog,
  sessionToken,
  onLogout,
  loggingOut = false,
  uiDev = false,
  skipRealAge = false,
  evilUnlocked = false,
  accountAgeSeconds = 0,
  nameColourStops = 0,
  wardrobeSkinSlots = 1,
}: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => newDraft(catalog));
  const [wardrobeDraft, setWardrobeDraft] = useState<WardrobeDraftFiles>({});
  const [wardrobeDraftNames, setWardrobeDraftNames] =
    useState<WardrobeDraftNames>({});
  const [wardrobeDraftModels, setWardrobeDraftModels] =
    useState<WardrobeDraftModels>({});
  const [wardrobeAutoMasked, setWardrobeAutoMasked] = useState(false);
  const [pendingCreateId, setPendingCreateId] = useState<string | null>(null);
  const stages = useMemo(
    () =>
      playableStages(catalog, {
        skipRealAge,
        evilUnlocked,
        accountAgeSeconds,
        selectedTraitIds: draft.traitIds,
      }),
    [catalog, skipRealAge, evilUnlocked, accountAgeSeconds, draft.traitIds]
  );
  const [index, setIndex] = useState(0);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uiDevDone, setUiDevDone] = useState(false);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, stages.length - 1)));
  }, [stages]);

  useEffect(() => {
    const cap = Math.max(0, Math.min(8, nameColourStops));
    setDraft((d) => {
      if (cap <= 0 && d.name_colours.length) {
        return { ...d, name_colours: [] };
      }
      if (cap > 0 && d.name_colours.length > cap) {
        return { ...d, name_colours: d.name_colours.slice(0, cap) };
      }
      return d;
    });
  }, [nameColourStops]);

  const stage = stages[index];
  const prevStage = index > 0 ? stages[index - 1] : null;
  const nextStage = index < stages.length - 1 ? stages[index + 1] : null;
  const isLast = index >= stages.length - 1;
  const canNext = stage
    ? stageCanContinue(stage, draft, catalog)
    : false;
  const clueBlockReason =
    stage && String(stage.type || "").toLowerCase() === "clue"
      ? clueContinueBlockReason(draft, catalog)
      : null;
  const progress = interactiveProgress(stages, index);

  function go(to: number) {
    if (to === index) return;
    setDir(to > index ? "forward" : "back");
    setIndex(to);
  }

  function jumpToKind(kind: string) {
    const k = kind.toLowerCase();
    const i = stages.findIndex((s) => {
      const t = String(s.type || "").toLowerCase();
      const target = String(s.target || "").toLowerCase();
      if (k === "name" || k === "age" || k === "description" || k === "real_age") {
        return t === "setter" && target === k;
      }
      if (k === "race" || k === "class") {
        return t === "selection" && target === k;
      }
      if (k === "trait") {
        return t === "selection" && target === "trait";
      }
      if (k === "attributes") return t === "attributes";
      if (k === "clue") return t === "clue";
      return s.id === k;
    });
    if (i >= 0) go(i);
  }

  async function onSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      if (uiDev) {
        // eslint-disable-next-line no-console
        console.info("[character UI-dev] create draft", {
          body: toCreateBody(draft, { nameColourStops, catalog }),
          wardrobeDraft,
        });
        setUiDevDone(true);
        return;
      }
      let createId = pendingCreateId;
      if (!createId) {
        const created = await createCharacter(
          sessionToken,
          toCreateBody(draft, { nameColourStops, catalog })
        );
        createId = String(created.id || "").trim();
        if (!createId) {
          throw new Error("Create succeeded but no id returned");
        }
        setPendingCreateId(createId);
      }

      const slots = Object.entries(wardrobeDraft).filter(
        ([, file]) => file instanceof File
      ) as [string, File][];
      const order = ["base", "extra_1", "extra_2", "masked"] as const;
      slots.sort(
        (a, b) =>
          order.indexOf(a[0] as (typeof order)[number]) -
          order.indexOf(b[0] as (typeof order)[number])
      );
      for (const [slot, file] of slots) {
        if (slot === "masked" && wardrobeAutoMasked) {
          // Server composes masked from base when create_masked is set
          continue;
        }
        try {
          await assertWardrobeSkinPng(file);
        } catch (err) {
          const detail =
            err instanceof Error ? err.message : "Invalid skin file";
          throw new Error(`${wardrobeSlotLabel(slot)}: ${detail}`);
        }
      }
      for (const [slot, file] of slots) {
        if (slot === "masked" && wardrobeAutoMasked) {
          // Server composes masked from base when create_masked is set
          continue;
        }
        setError(`Signing skin (${slot})…`);
        await uploadPendingCreateWardrobe(
          sessionToken,
          createId,
          slot,
          file,
          wardrobeDraftNames[slot as keyof WardrobeDraftNames] ?? null,
          {
            createMasked:
              slot === "base" && wardrobeAutoMasked,
            model: armModelToWardrobeModel(
              wardrobeDraftModels[slot as keyof WardrobeDraftModels] ?? "default"
            ),
          }
        );
      }
      setError(null);
      router.replace("/character");
    } catch (err) {
      const raw =
        err instanceof CharactersApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Create failed";
      setError(friendlyWardrobeUploadError(raw));
    } finally {
      setSubmitting(false);
    }
  }

  if (!stage) {
    return (
      <p className="mt-8 text-[var(--tfmc-mist)]">
        Creation catalog has no stages.
      </p>
    );
  }

  const type = String(stage.type || "").toLowerCase();
  const isSummary = type === "summary";
  const isInfo = type === "info";
  const showSubmit = isSummary || isLast;
  const title = stageDisplayTitle(stage);

  return (
    <div className="mt-4 flex flex-1 flex-col">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs tabular-nums text-[var(--tfmc-stone)]">
          {progress
            ? `Step ${progress.current} / ${progress.total}`
            : "Info"}
        </p>
        <button
          type="button"
          onClick={onLogout}
          disabled={loggingOut}
          className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
        >
          {loggingOut ? "Logging out…" : uiDev ? "Exit" : "Log out"}
        </button>
      </div>

      <div className="char-deck relative flex min-h-[min(62vh,520px)] flex-1 flex-col">
        {prevStage ? <PeekCard stage={prevStage} position="prev" /> : (
          <div className="char-deck-peek-spacer" aria-hidden />
        )}

        <div
          key={`${stage.id}-${dir}`}
          className={`char-deck-active char-deck-slide-${dir}`}
        >
          <div className="char-deck-card">
            {!isInfo ? (
              <h2 className="mb-4 font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)] sm:text-3xl">
                {title}
              </h2>
            ) : null}
            <StageBody
              stage={stage}
              draft={draft}
              catalog={catalog}
              setDraft={setDraft}
              onJump={jumpToKind}
              skipRealAge={skipRealAge}
              accountAgeSeconds={accountAgeSeconds}
              nameColourStops={nameColourStops}
              wardrobeDraft={wardrobeDraft}
              onWardrobeDraftChange={setWardrobeDraft}
              wardrobeDraftNames={wardrobeDraftNames}
              onWardrobeDraftNamesChange={setWardrobeDraftNames}
              wardrobeDraftModels={wardrobeDraftModels}
              onWardrobeDraftModelsChange={setWardrobeDraftModels}
              wardrobeSkinSlots={wardrobeSkinSlots}
              sessionToken={sessionToken}
              onWardrobeAutoMaskedChange={setWardrobeAutoMasked}
            />
          </div>
        </div>

        {nextStage ? <PeekCard stage={nextStage} position="next" /> : (
          <div className="char-deck-peek-spacer" aria-hidden />
        )}
      </div>

      {error ? (
        <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      {clueBlockReason && !canNext ? (
        <p className="mt-3 text-sm text-[#e8a0a0]" role="status">
          {clueBlockReason}
        </p>
      ) : null}
      {uiDevDone ? (
        <p className="mt-3 text-sm text-[var(--tfmc-accent)]" role="status">
          Created (UI-dev) - draft logged to console.
        </p>
      ) : null}

      <div className="sticky bottom-0 z-10 mt-4 flex gap-3 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_92%,transparent)] py-4 backdrop-blur-sm">
        <button
          type="button"
          disabled={index === 0 || submitting}
          onClick={() => go(Math.max(0, index - 1))}
          className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)] px-4 py-2.5 text-sm font-semibold text-[var(--tfmc-cream)] disabled:opacity-40"
        >
          Back
        </button>
        {showSubmit ? (
          <button
            type="button"
            disabled={!canNext || submitting}
            onClick={() => void onSubmit()}
            className="flex-1 rounded-sm bg-[var(--tfmc-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-50"
          >
            {submitting
              ? "Creating…"
              : uiDev
                ? "Create (UI-dev)"
                : "Create character"}
          </button>
        ) : (
          <button
            type="button"
            disabled={!canNext || submitting}
            onClick={() => go(Math.min(stages.length - 1, index + 1))}
            className="flex-1 rounded-sm bg-[var(--tfmc-accent)] px-4 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-50"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
