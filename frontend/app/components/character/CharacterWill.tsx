"use client";

import { useEffect, useId, useState } from "react";
import {
  CharactersApiError,
  requestWill,
  searchHeirs,
  type CharacterListItem,
  type HeirMatch,
} from "../../../lib/characters/api";
import { willErrorMessage, willResultMessage } from "../../../lib/characters/wills";

type Props = {
  character: CharacterListItem;
  sessionToken: string;
  /** After a change is sent, so the list shows it waiting. */
  onChanged: () => void;
};

const SEARCH_MIN = 3;
const SEARCH_DELAY_MS = 300;

const buttonClass =
  "min-h-9 rounded-sm px-2 text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-cream)] disabled:opacity-50";
const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_70%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-cream)]";
const matchClass =
  "flex w-full min-h-11 items-center gap-2 rounded-sm px-2 text-left text-sm text-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_6%,transparent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-cream)] disabled:opacity-50";

function message(e: unknown): string {
  return e instanceof CharactersApiError ? willErrorMessage(e.message) : "Couldn’t reach the site. Try again.";
}

/** Searches living characters by name once three letters are typed. */
function useHeirSearch(sessionToken: string, characterId: string, query: string) {
  const [state, setState] = useState<{ query: string; matches: HeirMatch[]; error: string | null } | null>(null);
  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed.length < SEARCH_MIN) return;
    let live = true;
    const timer = window.setTimeout(() => {
      searchHeirs(sessionToken, trimmed, characterId)
        .then((matches) => live && setState({ query: trimmed, matches, error: null }))
        .catch((e) => live && setState({ query: trimmed, matches: [], error: message(e) }));
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [sessionToken, characterId, trimmed]);
  return trimmed.length >= SEARCH_MIN && state?.query === trimmed ? state : null;
}

/** A living character's will on its Profile card: the heir, or none, with Change and Revoke. */
export default function CharacterWill({ character, sessionToken, onChanged }: Props) {
  const will = character.will;
  const request = character.will_request;
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useHeirSearch(sessionToken, character.id, picking ? query : "");
  const inputId = useId();
  if (!will) return null;
  const pending = request?.status === "pending";
  const refused = request?.status === "acked" ? willResultMessage(request.result) : null;

  async function send(heirId: string | null) {
    if (!will || sending) return;
    setSending(true);
    setError(null);
    try {
      await requestWill(sessionToken, character.id, heirId, will.revision);
      setPicking(false);
      setQuery("");
      onChanged();
    } catch (e) {
      setError(message(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex-1 rounded-b-sm border border-t-0 border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_35%,transparent)] px-3 py-1.5 text-sm">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-x-3">
        <p className="min-w-0 truncate text-[var(--tfmc-mist)]">
          {will.heir_id ? (
            <>
              Heir: <span className="text-[var(--tfmc-cream)]">{will.heir_name || will.heir_id.slice(0, 8)}</span>
            </>
          ) : (
            "No will"
          )}
        </p>
        {pending ? (
          <p className="text-[var(--tfmc-stone)]" role="status">
            {request.heir_character_id ? `Pending: ${request.heir_name || "new heir"}` : "Pending: no will"}
          </p>
        ) : (
          <span className="flex gap-1">
            <button
              type="button"
              className={buttonClass}
              aria-expanded={picking}
              aria-controls={picking ? inputId : undefined}
              onClick={() => {
                setPicking((p) => !p);
                setError(null);
              }}
            >
              {picking ? "Cancel" : "Change"}
            </button>
            {will.heir_id ? (
              <button type="button" className={buttonClass} disabled={sending} onClick={() => void send(null)}>
                Revoke
              </button>
            ) : null}
          </span>
        )}
      </div>
      {refused && !picking ? <p className="pb-1 text-xs text-[#e8a0a0]">{refused}</p> : null}
      {error ? (
        <p className="pb-1 text-xs text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      {picking && !pending ? (
        <div className="pb-2 pt-1">
          <label htmlFor={inputId} className="sr-only">
            Heir’s name
          </label>
          <input
            id={inputId}
            type="search"
            autoFocus
            autoComplete="off"
            maxLength={64}
            placeholder="Heir’s name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className={inputClass}
          />
          {search?.error ? <p className="mt-1 text-xs text-[#e8a0a0]">{search.error}</p> : null}
          {search && !search.error && !search.matches.length ? (
            <p className="mt-1 text-xs text-[var(--tfmc-stone)]">No living character by that name.</p>
          ) : null}
          {search?.matches.length ? (
            <ul className="mt-1">
              {search.matches.map((m) => (
                <li key={m.id}>
                  <button type="button" className={matchClass} disabled={sending} onClick={() => void send(m.id)}>
                    <span className="min-w-0 truncate">{m.name}</span>
                    <span className="truncate text-[var(--tfmc-stone)]">
                      {[m.race, m.short_id, m.own ? "yours" : null].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
