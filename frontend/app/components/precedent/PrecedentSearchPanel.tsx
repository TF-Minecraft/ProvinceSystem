"use client";

import { FormEvent, useState } from "react";

import { buttonClass, errorClass, headingClass, inputClass, mutedClass, panelClass, rowClass } from "@/app/components/admin/ui";
import { AccountApiError } from "@/lib/account/api";
import { adminErrorMessage } from "@/lib/admin/api";
import { searchPrecedent, type PrecedentSearchResult } from "@/lib/precedent/api";
import { cleanSynthesis } from "@/lib/precedent/filter";
import CaseTags from "./CaseTags";

const subheadClass = "text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]";

export default function PrecedentSearchPanel({ className = "" }: { className?: string }) {
  const [query, setQuery] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PrecedentSearchResult | null>(null);

  async function run(e: FormEvent) {
    e.preventDefault();
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
    <section className={`${panelClass} ${className}`} aria-label="Find precedent">
      <h2 className={headingClass}>Find precedent</h2>
      <form onSubmit={run} className="mt-3 flex flex-wrap gap-3">
        <label className="sr-only" htmlFor="precedent-search">
          Describe the incident
        </label>
        <input
          id="precedent-search"
          className={`${inputClass} min-w-0 flex-1 basis-48`}
          value={query}
          disabled={running}
          placeholder="Describe the incident"
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="submit" disabled={running || query.trim().length === 0} className={buttonClass}>
          {running ? "Searching…" : "Search"}
        </button>
      </form>
      <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
        Same as <code>/precedent</code> in Discord.
      </p>

      {error ? (
        <p className={`mt-3 ${errorClass}`} role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5">
          {result.matches.length === 0 ? (
            <p className={mutedClass}>No relevant precedent found.</p>
          ) : (
            <>
              {/* No similarity score is shown, by design. A number next to a
                  case anchors the reader before they have read it, and the
                  ranking is only a retrieval artefact, not a judgement about
                  which precedent should govern. */}
              <h3 className={subheadClass}>Similar cases</h3>
              <ul className={`mt-1 ${rowClass}`}>
                {result.matches.map((m) => (
                  <li key={m.id} className="py-2.5">
                    <p className="text-sm font-semibold text-[var(--tfmc-cream)]">{m.summary}</p>
                    <CaseTags row={m} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {result.synthesis ? (
            <div className="mt-4 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pt-4">
              <h3 className={subheadClass}>What precedent suggests</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--tfmc-cream)]">
                {cleanSynthesis(result.synthesis)}
              </p>
              <p className="mt-2 text-xs text-[var(--tfmc-stone)]">Advisory only. Staff decide the punishment.</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
