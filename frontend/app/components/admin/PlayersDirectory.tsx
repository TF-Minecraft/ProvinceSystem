"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  coreProtectMessage,
  getPlayers,
  isStaffRole,
  roleLabel,
  type PlayerDirectory,
  type PlayerSort,
} from "../../../lib/admin/api";
import { formatAgo, formatEpoch } from "../../../lib/admin/time";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";

const SORTS: { key: PlayerSort; label: string }[] = [
  { key: "last_seen", label: "Last seen" },
  { key: "minecraft", label: "Minecraft name" },
  { key: "discord", label: "Discord name" },
  { key: "character", label: "Character name" },
];
const SEARCH_DELAY_MS = 250;

const inputClass =
  "w-full appearance-none rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] py-3 pl-10 pr-11 text-base text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_70%,transparent)] focus:border-[var(--tfmc-accent)] [&::-webkit-search-cancel-button]:hidden";
const pagerClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-3 py-1.5 text-sm text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)] disabled:opacity-40";

type Props = { initialQuery: string; initialSort: PlayerSort; initialPage: number };

type Load =
  | { kind: "loading" }
  | { kind: GateKind }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: PlayerDirectory };

export default function PlayersDirectory({ initialQuery, initialSort, initialPage }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const [sort, setSort] = useState<PlayerSort>(initialSort);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const request = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const id = ++request.current;
    const url = new URL(window.location.href);
    for (const [key, value] of [["q", search.trim()], ["sort", sort === "last_seen" ? "" : sort], ["page", page > 1 ? String(page) : ""]]) {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    }
    window.history.replaceState(null, "", url);
    getPlayers({ q: search, sort, page })
      .then((data) => {
        if (id === request.current) setLoad({ kind: "ready", data });
      })
      .catch((err) => {
        if (id !== request.current) return;
        const status = err instanceof AccountApiError ? err.status : 0;
        setLoad(status === 400 || (status === 503 && err.message === "directory_busy")
          ? { kind: "failed", message: adminErrorMessage(err) }
          : { kind: gateKind(err) });
      });
  }, [search, sort, page]);

  if (load.kind === "signed_out" || load.kind === "forbidden" || load.kind === "unavailable" || load.kind === "error") {
    return <StaffGateMessage kind={load.kind} />;
  }

  const data = load.kind === "ready" ? load.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const notice = data ? coreProtectMessage(data.coreprotect) : null;

  return (
    <section aria-label="Players" className="mt-6">
      {/* Search gets a row of its own, so the sort buttons never squeeze it. */}
      <label className="sr-only" htmlFor="player-search">
        Search players
      </label>
      <div className="relative">
        <svg
          aria-hidden
          viewBox="0 0 20 20"
          className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[var(--tfmc-stone)]"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="8.5" cy="8.5" r="5.5" />
          <path d="M13 13l4 4" strokeLinecap="round" />
        </svg>
        <input
          id="player-search"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search by Minecraft, Discord or character name, or UUID"
          autoComplete="off"
          spellCheck={false}
          className={inputClass}
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQuery("");
              setSearch("");
              setPage(1);
            }}
            className="absolute right-0 top-0 flex h-full w-11 items-center justify-center text-xl text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
          >
            ×
          </button>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm text-[var(--tfmc-stone)]">Sort by</span>
        <div role="group" aria-label="Sort by" className="flex flex-wrap gap-1">
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={sort === option.key}
              onClick={() => {
                setSort(option.key);
                setPage(1);
              }}
              className={`min-h-11 rounded-sm px-3 py-1.5 text-sm transition-colors sm:min-h-9 ${
                sort === option.key
                  ? "bg-[var(--tfmc-accent)] font-semibold text-[var(--tfmc-forest-deep)]"
                  : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {notice ? (
        <p className="mt-3 text-sm text-[#e8c48a]" role="status">
          {notice} Only linked players and characters are listed.
        </p>
      ) : null}
      {load.kind === "failed" ? (
        <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
          {load.message}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="mt-3 text-xs text-[var(--tfmc-stone)]">
            {data.total === 1 ? "1 player" : `${data.total} players`}
            {data.coreprotect.server_label ? ` · activity from ${data.coreprotect.server_label}` : ""}
          </p>
          {data.players.length ? (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wider text-[var(--tfmc-stone)]">
                  <tr>
                    <th scope="col" className="py-2 pr-3 font-semibold">Minecraft</th>
                    <th scope="col" className="hidden py-2 pr-3 font-semibold sm:table-cell">Discord</th>
                    <th scope="col" className="hidden py-2 pr-3 font-semibold md:table-cell">Characters</th>
                    <th scope="col" className="py-2 font-semibold">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]">
                  {data.players.map((player) => (
                    <tr key={player.uuid}>
                      <td className="py-2.5 pr-3">
                        <Link
                          href={`/admin/players/${player.uuid}`}
                          className="font-semibold text-[var(--tfmc-cream)] underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline"
                        >
                          {player.minecraft_name ?? <span className="font-mono text-xs">{player.uuid}</span>}
                        </Link>
                        {isStaffRole(player.site_role) ? (
                          <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
                            {roleLabel(player.site_role ?? "")}
                          </span>
                        ) : null}
                        {player.discord_username ? (
                          <span className="block text-xs text-[var(--tfmc-stone)] sm:hidden">@{player.discord_username}</span>
                        ) : null}
                        {player.characters.length ? (
                          <span className="block text-xs text-[var(--tfmc-mist)] md:hidden">{player.characters.join(", ")}</span>
                        ) : null}
                      </td>
                      <td className="hidden py-2.5 pr-3 text-[var(--tfmc-mist)] sm:table-cell">
                        {player.discord_username ? `@${player.discord_username}` : <span className="text-[var(--tfmc-stone)]">Not linked</span>}
                      </td>
                      <td className="hidden max-w-[14rem] truncate py-2.5 pr-3 text-[var(--tfmc-mist)] md:table-cell" title={player.characters.join(", ")}>
                        {player.characters.join(", ") || <span className="text-[var(--tfmc-stone)]">None</span>}
                      </td>
                      <td className="whitespace-nowrap py-2.5 text-[var(--tfmc-mist)]" title={formatEpoch(player.last_seen)}>
                        {player.online ? (
                          <span className="inline-flex items-center gap-1.5 text-[#9fd8a4]">
                            <span aria-hidden className="h-2 w-2 rounded-full bg-[#6cc072]" />
                            Seen just now
                          </span>
                        ) : (
                          formatAgo(player.last_seen)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[var(--tfmc-mist)]">No players match that.</p>
          )}
          {pages > 1 ? (
            <div className="mt-4 flex items-center gap-3 text-sm text-[var(--tfmc-stone)]">
              <button type="button" className={pagerClass} disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span>
                Page {data.page} of {pages}
              </span>
              <button type="button" className={pagerClass} disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          ) : null}
        </>
      ) : load.kind === "loading" ? (
        <p className="mt-4 text-[var(--tfmc-mist)]">Loading…</p>
      ) : null}
    </section>
  );
}
