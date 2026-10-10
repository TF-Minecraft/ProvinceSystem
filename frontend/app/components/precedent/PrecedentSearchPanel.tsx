"use client";

import { useState } from "react";

import { AccountApiError } from "@/lib/account/api";
import { adminErrorMessage } from "@/lib/admin/api";
import { searchPrecedent, type PrecedentSearchResult } from "@/lib/precedent/api";
import {
  cleanSynthesis,
  punishmentTone,
  rulingTone,
  visibleRuling,
} from "@/lib/precedent/filter";
import {
  playerChipClass,
  rulePillClass,
  toneClass,
} from "./caseFieldStyles";

const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-accent)] focus:outline-none";

export default function PrecedentSearchPanel() {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrecedentSearchResult | null>(null);

  async function run() {
    const q = query.trim();
    if (!q || running) return;
    setRunning(true);
    setError(null);
    try {
      setResult(await searchPrecedent(q));
    } catch (err) {
      setResult(null);
      if (err instanceof AccountApiError && err.status === 429) {
        setError("Too many searches. Wait a minute and try again.");
      } else {
        setError(adminErrorMessage(err));
      }
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-4">
      <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
        Find precedent
      </h2>
      <p className="mt-1 text-sm text-[var(--tfmc-mist)]">
        Same as <code className="text-xs">/precedent</code> in Discord.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className={inputClass}
          value={query}
          disabled={running}
          placeholder="Describe the incident"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void run();
          }}
        />
        <button
          type="button"
          disabled={running || query.trim().length === 0}
          onClick={() => void run()}
          className="shrink-0 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] disabled:opacity-50"
        >
          {running ? "Searching…" : "Search"}
        </button>
      </div>

      {error ? <p className="mt-3 text-xs text-[#e8a0a0]">{error}</p> : null}

      {result ? (
        <div className="mt-4">
          {result.matches.length === 0 ? (
            <p className="text-sm text-[var(--tfmc-mist)]">
              No relevant precedent found.
            </p>
          ) : (
            <>
              {/* No similarity score is shown, by design. A number next to a
                  case anchors the reader before they have read it, and the
                  ranking is only a retrieval artefact, not a judgement about
                  which precedent should govern. */}
              <p className="mb-3 text-xs font-medium uppercase tracking-widest text-[var(--tfmc-stone)]">
                Similar cases
              </p>
              <ul className="space-y-2">
              {result.matches.map((m) => {
                return (
                  <li
                    key={m.id}
                    className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] px-3 py-2"
                  >
                    <p className="font-medium text-[var(--tfmc-cream)]">
                      {m.summary}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {m.rule ? (
                        <span className={rulePillClass}>{m.rule}</span>
                      ) : null}
                      {visibleRuling(m.ruling) ? (
                        <span
                          className={`font-medium ${
                            toneClass[rulingTone(m.ruling)]
                          }`}
                        >
                          {visibleRuling(m.ruling)}
                        </span>
                      ) : null}
                      {m.punishment ? (
                        <span
                          className={`font-medium ${
                            toneClass[punishmentTone(m.punishment)]
                          }`}
                        >
                          {m.punishment}
                        </span>
                      ) : null}
                      {(m.players || []).map((p) => (
                        <span key={p} className={playerChipClass}>
                          {p}
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
              </ul>
            </>
          )}

          {result.synthesis ? (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-widest text-[var(--tfmc-stone)]">
                What precedent suggests
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--tfmc-cream)]">
                {cleanSynthesis(result.synthesis)}
              </p>
              <p className="mt-2 text-xs text-[var(--tfmc-mist)]">
                Advisory only. Staff decide the punishment.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
