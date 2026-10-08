"use client";

import { useEffect, useId, useState } from "react";

import type { CaseInput, PrecedentCase } from "@/lib/precedent/api";
import { parsePlayers } from "@/lib/precedent/filter";
import PlayerAutocomplete from "./PlayerAutocomplete";

type Props = {
  open: boolean;
  /** null opens the modal empty for a new case. */
  initial: PrecedentCase | null;
  /** Names already in the corpus, for player autocomplete. */
  knownPlayers: string[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (input: CaseInput) => void;
};

// Mirrors the server-side caps in LogCaseBody (precedent_routes.py).
const MAX = {
  logged_by: 200,
  summary: 1000,
  rule: 200,
  ruling: 500,
  punishment: 200,
};

const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-accent)] focus:outline-none";

const labelClass =
  "text-xs font-medium uppercase tracking-widest text-[var(--tfmc-stone)]";

export default function PrecedentCaseModal({
  open,
  initial,
  knownPlayers,
  saving,
  error,
  onClose,
  onSave,
}: Props) {
  const titleId = useId();
  const [summary, setSummary] = useState("");
  const [rule, setRule] = useState("");
  const [ruling, setRuling] = useState("");
  const [punishment, setPunishment] = useState("");
  const [players, setPlayers] = useState("");

  // Reset the form whenever a different case (or "new") is opened.
  useEffect(() => {
    if (!open) return;
    setSummary(initial?.summary ?? "");
    setRule(initial?.rule ?? "");
    setRuling(initial?.ruling ?? "");
    setPunishment(initial?.punishment ?? "");
    setPlayers((initial?.players ?? []).join(", "));
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const canSave = summary.trim().length > 0 && !saving;

  function submit() {
    if (!canSave) return;
    onSave({
      // Overridden server-side with the signed-in staff member's name; sent
      // only so the payload matches the shared LogCaseBody shape.
      logged_by: initial?.logged_by || "website",
      players: parsePlayers(players),
      summary: summary.trim(),
      rule: rule.trim(),
      ruling: ruling.trim(),
      punishment: punishment.trim(),
    });
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
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[var(--tfmc-forest)] p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id={titleId}
          className="font-[family-name:var(--font-display)] text-xl text-[var(--tfmc-cream)]"
        >
          {initial ? "Edit case" : "Log case"}
        </h2>
        {initial ? null : (
          <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
            Logged against your account.
          </p>
        )}

        <div className="mt-4 space-y-3">
          <div>
            <label className={labelClass} htmlFor={`${titleId}-summary`}>
              Summary
            </label>
            <textarea
              id={`${titleId}-summary`}
              className={`${inputClass} mt-1 min-h-24 resize-y`}
              maxLength={MAX.summary}
              value={summary}
              disabled={saving}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What happened"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={labelClass} htmlFor={`${titleId}-rule`}>
                Rule
              </label>
              <input
                id={`${titleId}-rule`}
                className={`${inputClass} mt-1`}
                maxLength={MAX.rule}
                value={rule}
                disabled={saving}
                onChange={(e) => setRule(e.target.value)}
                placeholder="4.8"
              />
            </div>
            <div>
              <label className={labelClass} htmlFor={`${titleId}-punishment`}>
                Punishment
              </label>
              <input
                id={`${titleId}-punishment`}
                className={`${inputClass} mt-1`}
                maxLength={MAX.punishment}
                value={punishment}
                disabled={saving}
                onChange={(e) => setPunishment(e.target.value)}
                placeholder="10y"
              />
            </div>
          </div>

          <div>
            <label className={labelClass} htmlFor={`${titleId}-ruling`}>
              Ruling
            </label>
            <textarea
              id={`${titleId}-ruling`}
              className={`${inputClass} mt-1 min-h-16 resize-y`}
              maxLength={MAX.ruling}
              value={ruling}
              disabled={saving}
              onChange={(e) => setRuling(e.target.value)}
              placeholder="Upheld"
            />
          </div>

          <div>
            <label className={labelClass} htmlFor={`${titleId}-players`}>
              Players
            </label>
            <div className="mt-1">
              <PlayerAutocomplete
                id={`${titleId}-players`}
                className={inputClass}
                value={players}
                known={knownPlayers}
                disabled={saving}
                onChange={setPlayers}
                placeholder="Comma separated"
              />
            </div>
          </div>
        </div>

        {error ? (
          <p className="mt-3 text-xs text-[#e8a0a0]">{error}</p>
        ) : null}

        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={onClose}
            className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={submit}
            className="rounded-sm bg-[var(--tfmc-moss)] px-4 py-2 text-sm text-[var(--tfmc-cream)] disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
