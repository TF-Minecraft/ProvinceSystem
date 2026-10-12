"use client";

import { useEffect, useState } from "react";
import { getCatalog, type DrinkLoreLine, type DrinkSubmissionPublic } from "../../../lib/drinks/api";
import { effectLabel, WOOD_OPTIONS } from "../../../lib/drinks/constants";
import { previewColourStopRuns } from "../../../lib/skins/namePreview";
import { DrinkPicture } from "./WardrobePictures";
import {
  Facts,
  formatDay,
  Heading,
  plainName,
  quietActionClass,
  Showcase,
  StagePicture,
  StatusBlock,
  Tooltip,
} from "./ItemShowcase";

function statusMessage(status: string): string {
  switch (status) {
    case "pending":
      return "Waiting for staff review. Discord tells you when it’s decided.";
    case "pending_pack":
      return "Approved. Its icon goes live soon.";
    case "approved":
      return "Approved. You can brew it in game soon.";
    case "applied":
      return "Live. Brew it in game.";
    case "denied":
    case "rejected":
      return "Denied.";
    default:
      return status;
  }
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type Ingredient = { id: string; amount: number };

function ingredientsOf(recipe: Record<string, unknown>): Ingredient[] {
  const raw = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  return raw
    .map((row) => (row && typeof row === "object" ? (row as Record<string, unknown>) : {}))
    .map((row) => ({ id: String(row.id ?? ""), amount: Math.max(1, num(row.amount)) }))
    .filter((row) => row.id);
}

function effectsOf(recipe: Record<string, unknown>): string[] {
  const raw = Array.isArray(recipe.effects) ? recipe.effects : [];
  return raw
    .map((effect) => {
      if (typeof effect === "string") return effectLabel(effect.split("/")[0] ?? effect);
      if (effect && typeof effect === "object" && "type" in effect) {
        const { type, level } = effect as { type: unknown; level?: unknown };
        const lvl = num(level);
        return `${effectLabel(String(type))}${lvl > 1 ? ` ${lvl}` : ""}`;
      }
      return "";
    })
    .filter(Boolean);
}

function loreOf(recipe: Record<string, unknown>): string[] {
  const raw = Array.isArray(recipe.lore) ? recipe.lore : [];
  return raw
    .map((line) => (typeof line === "string" ? line : String((line as DrinkLoreLine)?.text ?? "")))
    .filter((line) => line.trim());
}

/** Cook, distil, age: the steps a brewer follows, in order. */
function brewingSteps(recipe: Record<string, unknown>): string[] {
  const steps: string[] = [];
  const cook = num(recipe.cooking_time);
  if (cook) steps.push(`Cook for ${plural(cook, "minute")}`);
  const runs = num(recipe.distill_runs);
  if (runs) steps.push(`Distil ${runs === 1 ? "once" : `${runs} times`}`);
  const age = num(recipe.age);
  if (age) {
    // Older recipes store the wood's name, newer ones its BreweryX index.
    const raw = String(recipe.wood ?? "").toLowerCase();
    const wood = WOOD_OPTIONS.find((w) => w.id === raw || w.label.toLowerCase().replace(/ /g, "_") === raw);
    const barrel = wood && wood.id !== "0" ? `${wood.label.toLowerCase()} barrel` : "barrel";
    steps.push(`Age ${plural(age, "year")} in ${/^[aeiou]/.test(barrel) ? "an" : "a"} ${barrel}`);
  }
  return steps;
}

/** Ingredient names from the brewing catalogue, once it has loaded. */
function useIngredientLabels(): Record<string, string> {
  const [labels, setLabels] = useState<Record<string, string>>({});
  useEffect(() => {
    let live = true;
    getCatalog()
      .then((catalog) => {
        if (!live) return;
        setLabels(Object.fromEntries(catalog.ingredients.map((i) => [i.id, i.label || i.id])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return labels;
}

function prettyId(id: string): string {
  const bare = id.includes(":") ? id.slice(id.indexOf(":") + 1) : id;
  const words = bare.replace(/[_-]+/g, " ").trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

export default function DrinkShowcase({
  row,
  sessionToken,
  onRefresh,
}: {
  row: DrinkSubmissionPublic;
  /** The owner's drinks or Profile session. */
  sessionToken: string;
  onRefresh: () => void;
}) {
  const recipe = row.recipe || {};
  const color = typeof recipe.color === "string" ? recipe.color : null;
  const labels = useIngredientLabels();
  const colours = Array.isArray(recipe.name_colours) ? recipe.name_colours.map(String) : [];
  const name = colours.length ? previewColourStopRuns(row.display_name, colours) : plainName(row.display_name);
  const ingredients = ingredientsOf(recipe);
  const steps = brewingSteps(recipe);
  const effects = effectsOf(recipe);
  const alcohol = num(recipe.alcohol);
  const difficulty = num(recipe.difficulty);
  const waiting = ["pending", "pending_pack", "approved"].includes(row.status);

  return (
    <Showcase
      stage={
        <StagePicture>
          <div className="h-full max-h-80 w-full max-w-80">
            <DrinkPicture id={row.id} color={color} sessionToken={sessionToken} />
          </div>
        </StagePicture>
      }
    >
      <Heading
        title={row.display_name || "Drink"}
        detail={[alcohol ? `${alcohol}% alcohol` : "No alcohol", difficulty ? `difficulty ${difficulty} of 10` : null]
          .filter(Boolean)
          .join(" · ")}
      />
      <StatusBlock
        status={row.status}
        message={statusMessage(row.status)}
        reason={
          row.status === "denied" || row.status === "rejected" ? row.deny_reason?.trim() || "No reason given." : null
        }
        action={
          waiting ? (
            <button type="button" onClick={onRefresh} className={quietActionClass}>
              Check again
            </button>
          ) : null
        }
      />
      <Tooltip name={name} lore={loreOf(recipe)} />
      <Facts
        facts={[
          ingredients.length
            ? {
                label: "Ingredients",
                value: (
                  <ul className="space-y-0.5">
                    {ingredients.map((i) => (
                      <li key={i.id}>
                        <span className="text-[var(--tfmc-mist)]">{i.amount} ×</span> {labels[i.id] || prettyId(i.id)}
                      </li>
                    ))}
                  </ul>
                ),
              }
            : null,
          steps.length
            ? {
                label: "Brewing",
                value: (
                  <ol className="space-y-0.5">
                    {steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                ),
              }
            : null,
          effects.length ? { label: "Effects", value: effects.join(", ") } : null,
          color
            ? {
                label: "Colour",
                value: (
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3.5 w-3.5 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_30%,transparent)]"
                      style={{ backgroundColor: color }}
                    />
                    <span className="font-mono text-xs uppercase">{color}</span>
                  </span>
                ),
              }
            : null,
          formatDay(row.created_at) ? { label: "Made", value: formatDay(row.created_at) } : null,
          formatDay(row.reviewed_at) ? { label: "Reviewed", value: formatDay(row.reviewed_at) } : null,
          formatDay(row.applied_at) ? { label: "Live since", value: formatDay(row.applied_at) } : null,
        ]}
      />
    </Showcase>
  );
}
