"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  coreProtectMessage,
  defaultOrder,
  getPlayers,
  isStaffRole,
  roleLabel,
  type CharacterRow,
  type PlayerDirectory,
  type PlayerListing,
  type PlayerSort,
  type PlayerSummary,
  type PlayerView,
  type SortOrder,
} from "../../../lib/admin/api";
import { formatAgo, formatEpoch } from "../../../lib/admin/time";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";

const VIEWS: { key: PlayerView; label: string }[] = [
  { key: "minecraft", label: "Minecraft" },
  { key: "discord", label: "Discord" },
  { key: "character", label: "Character" },
];
const SEARCH_DELAY_MS = 250;
const PANEL_ID = "players-panel";

const inputClass =
  "w-full appearance-none rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] py-3 pl-10 pr-11 text-base text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_70%,transparent)] focus:border-[var(--tfmc-accent)] [&::-webkit-search-cancel-button]:hidden";
const pagerClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] px-3 py-1.5 text-sm text-[var(--tfmc-cream)] hover:border-[var(--tfmc-accent)] disabled:opacity-40";
// The view's subject, in each row's first column.
const leadClass =
  "text-base font-semibold text-[var(--tfmc-cream)] underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline sm:text-lg";
const nameLinkClass =
  "font-semibold text-[var(--tfmc-cream)] underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline";
// Fixed column widths, so sorting or paging never shifts the columns about.
const headClass = "py-2 pr-3 font-semibold";
const charactersHeadClass = `hidden w-56 md:table-cell ${headClass}`;
const lastSeenHeadClass = "w-36 py-2 font-semibold";
const cellClass = "break-words py-2.5 pr-3 align-top";
const smallClass = "block text-xs text-[var(--tfmc-stone)]";

type Props = { initialQuery: string; initialListing: PlayerListing; initialPage: number };

type Sorting = { sort: PlayerSort; order: SortOrder; onSort: (sort: PlayerSort) => void };

type Load =
  | { kind: "loading" }
  | { kind: GateKind }
  | { kind: "failed"; message: string }
  | { kind: "ready"; data: PlayerDirectory };

function profileHref(player: PlayerSummary): string {
  return `/admin/players/${player.uuid}`;
}

/** `@handle · Server nickname`, whichever of the two is known. */
function discordLabel(player: PlayerSummary): string {
  return [player.discord_username ? `@${player.discord_username}` : null, player.discord_nickname]
    .filter(Boolean)
    .join(" · ") || "Linked";
}

function titleCase(text: string): string {
  return text.toLowerCase().replace(/(^|[\s_-])\p{L}/gu, (s) => s.toUpperCase()).replace(/_/g, " ");
}

function MinecraftName({ player }: { player: PlayerSummary }) {
  return player.minecraft_name ?? <span className="font-mono text-xs">{player.uuid}</span>;
}

function RoleTag({ player }: { player: PlayerSummary }) {
  return isStaffRole(player.site_role) ? (
    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
      {roleLabel(player.site_role ?? "")}
    </span>
  ) : null;
}

function Discord({ player }: { player: PlayerSummary }) {
  if (!player.discord_user_id) return <span className="text-[var(--tfmc-stone)]">Not linked</span>;
  return <>{discordLabel(player)}</>;
}

function Characters({ player }: { player: PlayerSummary }) {
  return <>{player.characters.join(", ") || <span className="text-[var(--tfmc-stone)]">None</span>}</>;
}

/** When the player was last on the server. Without CoreProtect, "never" can't be known. */
function LastSeen({ player, known }: { player: PlayerSummary; known: boolean }) {
  if (player.online) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[#9fd8a4]">
        <span aria-hidden className="h-2 w-2 rounded-full bg-[#6cc072]" />
        Seen just now
      </span>
    );
  }
  return <>{player.last_seen === null && !known ? "Unknown" : formatAgo(player.last_seen)}</>;
}

function lastSeenCell(player: PlayerSummary, known: boolean) {
  return (
    <td className="whitespace-nowrap py-2.5 align-top text-[var(--tfmc-mist)]" title={formatEpoch(player.last_seen)}>
      <LastSeen player={player} known={known} />
    </td>
  );
}

function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full table-fixed text-left text-sm">
        <thead className="text-xs uppercase tracking-wider text-[var(--tfmc-stone)]">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]">{children}</tbody>
      </table>
    </div>
  );
}

/** A column heading that sorts the whole list, every page of it; choosing it again reverses it. */
function SortHeader({ column, label, sorting, className }: {
  column: PlayerSort;
  label: string;
  sorting: Sorting;
  className: string;
}) {
  const active = sorting.sort === column;
  // The arrow shows the order now, or on hover the order a click would give.
  const shown = active ? sorting.order : defaultOrder(column);
  return (
    <th scope="col" className={className} aria-sort={active ? (sorting.order === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        onClick={() => sorting.onSort(column)}
        className="group inline-flex items-center gap-1 uppercase tracking-wider hover:text-[var(--tfmc-cream)]"
      >
        {label}
        <span aria-hidden className={active ? "text-[var(--tfmc-accent)]" : "opacity-0 group-hover:opacity-60"}>
          {shown === "asc" ? "↑" : "↓"}
        </span>
      </button>
    </th>
  );
}

function DiscordTable({ rows, known, sorting }: { rows: PlayerSummary[]; known: boolean; sorting: Sorting }) {
  return (
    <Table
      head={
        <>
          <SortHeader column="name" label="Discord" sorting={sorting} className={headClass} />
          <th scope="col" className={`hidden sm:table-cell ${headClass}`}>Minecraft</th>
          <th scope="col" className={charactersHeadClass}>Characters</th>
          <SortHeader column="last_seen" label="Last seen" sorting={sorting} className={lastSeenHeadClass} />
        </>
      }
    >
      {rows.map((player) => {
        const lead = player.discord_username ? `@${player.discord_username}` : player.discord_nickname ?? "Linked";
        return (
          <tr key={player.uuid}>
            <td className={cellClass}>
              <Link href={profileHref(player)} className={leadClass}>
                {lead}
              </Link>
              {player.discord_username && player.discord_nickname ? (
                <span className="block text-sm text-[var(--tfmc-mist)]">{player.discord_nickname}</span>
              ) : null}
              <span className={`${smallClass} sm:hidden`}>
                <MinecraftName player={player} />
              </span>
              {player.characters.length ? (
                <span className={`${smallClass} md:hidden`}>{player.characters.join(", ")}</span>
              ) : null}
            </td>
            <td className={`hidden text-[var(--tfmc-mist)] sm:table-cell ${cellClass}`}>
              <MinecraftName player={player} />
              <RoleTag player={player} />
            </td>
            <td className={`hidden text-[var(--tfmc-mist)] md:table-cell ${cellClass}`}>
              <Characters player={player} />
            </td>
            {lastSeenCell(player, known)}
          </tr>
        );
      })}
    </Table>
  );
}

function MinecraftTable({ rows, known, sorting }: { rows: PlayerSummary[]; known: boolean; sorting: Sorting }) {
  return (
    <Table
      head={
        <>
          <SortHeader column="name" label="Minecraft" sorting={sorting} className={headClass} />
          <th scope="col" className={`hidden sm:table-cell ${headClass}`}>Discord</th>
          <th scope="col" className={charactersHeadClass}>Characters</th>
          <SortHeader column="last_seen" label="Last seen" sorting={sorting} className={lastSeenHeadClass} />
        </>
      }
    >
      {rows.map((player) => (
        <tr key={player.uuid}>
          <td className={cellClass}>
            <Link href={profileHref(player)} className={leadClass}>
              <MinecraftName player={player} />
            </Link>
            <RoleTag player={player} />
            {player.aliases.length ? (
              <span className="block text-xs text-[var(--tfmc-mist)]">Also {player.aliases.join(", ")}</span>
            ) : null}
            {player.discord_user_id ? <span className={`${smallClass} sm:hidden`}>{discordLabel(player)}</span> : null}
            {player.characters.length ? (
              <span className={`${smallClass} md:hidden`}>{player.characters.join(", ")}</span>
            ) : null}
          </td>
          <td className={`hidden text-[var(--tfmc-mist)] sm:table-cell ${cellClass}`}>
            <Discord player={player} />
          </td>
          <td className={`hidden text-[var(--tfmc-mist)] md:table-cell ${cellClass}`}>
            <Characters player={player} />
          </td>
          {lastSeenCell(player, known)}
        </tr>
      ))}
    </Table>
  );
}

function CharacterTable({ rows, known, sorting }: { rows: CharacterRow[]; known: boolean; sorting: Sorting }) {
  return (
    <Table
      head={
        <>
          <SortHeader column="name" label="Character" sorting={sorting} className={`sm:w-[45%] ${headClass}`} />
          <th scope="col" className={`hidden sm:table-cell ${headClass}`}>Player</th>
          <SortHeader column="last_seen" label="Player last seen" sorting={sorting} className={lastSeenHeadClass} />
        </>
      }
    >
      {rows.map(({ character, player }) => {
        const details = [character.race, character.class].filter((v): v is string => Boolean(v)).map(titleCase);
        return (
          <tr key={`${player.uuid}:${character.character_id}`}>
            <td className={cellClass}>
              <Link href={profileHref(player)} className={leadClass}>
                {character.name}
              </Link>
              {character.status === "dead" ? (
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-[#e8a0a0]">Dead</span>
              ) : null}
              {details.length ? <span className="block text-xs text-[var(--tfmc-mist)]">{details.join(" · ")}</span> : null}
              <span className={`${smallClass} sm:hidden`}>
                <MinecraftName player={player} />
                {player.discord_user_id ? ` · ${discordLabel(player)}` : ""}
              </span>
            </td>
            <td className={`hidden sm:table-cell ${cellClass}`}>
              <Link href={profileHref(player)} className={nameLinkClass}>
                <MinecraftName player={player} />
              </Link>
              <RoleTag player={player} />
              {player.discord_user_id ? <span className={smallClass}>{discordLabel(player)}</span> : null}
            </td>
            {lastSeenCell(player, known)}
          </tr>
        );
      })}
    </Table>
  );
}

function countLine(data: PlayerDirectory): string {
  const n = data.total;
  const counted =
    data.view === "character" ? (n === 1 ? "1 character" : `${n} characters`)
      : data.view === "discord" ? (n === 1 ? "1 linked player" : `${n} linked players`)
        : n === 1 ? "1 player" : `${n} players`;
  const source = data.coreprotect.server_label;
  if (!source) return counted;
  return data.view === "character" ? `${counted} on ${source}` : counted;
}

export default function PlayersDirectory({ initialQuery, initialListing, initialPage }: Props) {
  const [query, setQuery] = useState(initialQuery);
  const [search, setSearch] = useState(initialQuery);
  const [view, setView] = useState<PlayerView>(initialListing.view);
  const [sort, setSort] = useState<PlayerSort>(initialListing.sort);
  const [order, setOrder] = useState<SortOrder>(initialListing.order);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const request = useRef(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const id = ++request.current;
    const url = new URL(window.location.href);
    const params = [
      ["q", search.trim()],
      ["view", view === "minecraft" ? "" : view],
      ["sort", sort === "name" ? "" : sort],
      ["order", order === defaultOrder(sort) ? "" : order],
      ["page", page > 1 ? String(page) : ""],
    ];
    // Cleared first, so the address keeps this order however the choices were made.
    for (const [key] of params) url.searchParams.delete(key);
    for (const [key, value] of params) if (value) url.searchParams.set(key, value);
    window.history.replaceState(null, "", url);
    getPlayers({ q: search, view, sort, order, page })
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
  }, [search, view, sort, order, page]);

  function choose(next: PlayerView) {
    if (next === view) return;
    setView(next);
    setPage(1);
  }

  // The server sorts the whole list, so the order runs across every page, not just this one.
  function sortBy(next: PlayerSort) {
    setOrder(next === sort ? (order === "asc" ? "desc" : "asc") : defaultOrder(next));
    setSort(next);
    setPage(1);
  }

  // Arrow keys move between tabs; Enter or Space opens one, as each opens a fresh list.
  function onTabKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = VIEWS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
        : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
          : event.key === "Home" ? 0
            : event.key === "End" ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    tabs.current[target]?.focus();
  }

  if (load.kind === "signed_out" || load.kind === "forbidden" || load.kind === "unavailable" || load.kind === "error") {
    return <StaffGateMessage kind={load.kind} />;
  }

  // Rows from another view (still arriving after a switch) never show under this view's table.
  const data = load.kind === "ready" && load.data.view === view ? load.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const notice = data ? coreProtectMessage(data.coreprotect) : null;
  const known = data?.coreprotect.status === "available";
  const sorting: Sorting = { sort, order, onSort: sortBy };

  return (
    <section aria-label="Players" className="mt-6">
      {/* Search and the view tabs share a row on wide screens; the tabs move under it before they squeeze it. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="sr-only" htmlFor="player-search">
          Search players
        </label>
        <div className="relative min-w-0 flex-1">
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
            placeholder="Minecraft, Discord or character name"
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

        <div
          role="tablist"
          aria-label="Player views"
          className="grid shrink-0 grid-cols-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] p-0.5 sm:self-start lg:self-auto"
        >
          {VIEWS.map((option, index) => (
            <button
              key={option.key}
              ref={(el) => {
                tabs.current[index] = el;
              }}
              id={`players-tab-${option.key}`}
              type="button"
              role="tab"
              aria-selected={view === option.key}
              aria-controls={PANEL_ID}
              tabIndex={view === option.key ? 0 : -1}
              onClick={() => choose(option.key)}
              onKeyDown={(event) => onTabKey(event, index)}
              className={`min-h-11 rounded-sm px-2 text-sm transition-colors sm:min-h-9 sm:px-4 ${
                view === option.key
                  ? "bg-[var(--tfmc-accent)] font-semibold text-[var(--tfmc-forest-deep)]"
                  : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div id={PANEL_ID} role="tabpanel" aria-labelledby={`players-tab-${view}`}>
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
            <p className="mt-3 text-xs text-[var(--tfmc-stone)]">{countLine(data)}</p>
            {data.rows.length === 0 ? (
              <p className="mt-4 text-sm text-[var(--tfmc-mist)]">No {data.view === "character" ? "characters" : "players"} match that.</p>
            ) : data.view === "character" ? (
              <CharacterTable rows={data.rows} known={known} sorting={sorting} />
            ) : data.view === "discord" ? (
              <DiscordTable rows={data.rows} known={known} sorting={sorting} />
            ) : (
              <MinecraftTable rows={data.rows} known={known} sorting={sorting} />
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
            {data.omitted ? (
              <p className="mt-4 text-xs text-[var(--tfmc-stone)]">
                {data.view === "discord" ? (
                  <>
                    {data.omitted === 1 ? "1 player without a Discord link isn’t" : `${data.omitted} players without a Discord link aren’t`}{" "}
                    listed here.{" "}
                    <button type="button" className="underline underline-offset-2 hover:text-[var(--tfmc-cream)]" onClick={() => choose("minecraft")}>
                      See everyone under Minecraft
                    </button>
                  </>
                ) : (
                  `${data.omitted === 1 ? "1 player has" : `${data.omitted} players have`} no character${
                    data.coreprotect.server_label ? ` on ${data.coreprotect.server_label}` : ""
                  }.`
                )}
              </p>
            ) : null}
          </>
        ) : load.kind === "loading" || load.kind === "ready" ? (
          <p className="mt-4 text-[var(--tfmc-mist)]">Loading…</p>
        ) : null}
      </div>
    </section>
  );
}
