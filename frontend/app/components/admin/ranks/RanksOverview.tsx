"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { adminErrorMessage } from "../../../../lib/admin/api";
import {
  expiryLabel,
  getLpPlayers,
  getLuckPerms,
  shortContextLabel,
  type LpGroupSummary,
  type LpOverview,
  type LpPlayerPage,
  type LpPlayerRow,
  type LpTrack,
} from "../../../../lib/admin/luckperms";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import ChangeConfirm from "./ChangeConfirm";
import { ChangeHistory, GroupChip, StatusLine } from "./parts";
import McText from "./McText";
import { badgeClass, buttonClass, errorClass, headingClass, inputClass, mutedClass, panelClass, quietButtonClass, rowClass } from "./ui";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "ready"; data: LpOverview };

export default function RanksOverview({ initialQuery = "" }: { initialQuery?: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: "ready", data: await getLuckPerms() });
    } catch (err) {
      setLoad({ kind: gateKind(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind === "loading") return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;
  if (load.kind !== "ready") return <StaffGateMessage kind={load.kind} />;
  const { data } = load;

  return (
    <>
      <StatusLine status={data.status} rights={data.rights} />
      <PlayerSearch initialQuery={initialQuery} total={data.players} />
      <GroupsPanel data={data} onChanged={refresh} />
      {/* Side by side on wide screens: neither needs the full width. */}
      <div className="grid gap-x-6 lg:grid-cols-2">
        <TracksPanel data={data} onChanged={refresh} />
        <section className={panelClass} aria-label="Recent changes">
          <h2 className={headingClass}>Recent changes</h2>
          <ChangeHistory changes={data.recent} showTarget />
        </section>
      </div>
    </>
  );
}

function PlayerSearch({ initialQuery, total }: { initialQuery: string; total: number }) {
  const [query, setQuery] = useState(initialQuery);
  const [page, setPage] = useState<LpPlayerPage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The search the shown results belong to, for paging; and the newest request, so older answers drop.
  const [searched, setSearched] = useState("");
  const latest = useRef(0);

  const search = useCallback(async (text: string, pageNumber = 1) => {
    if (!text.trim()) return;
    const request = ++latest.current;
    setBusy(true);
    setError(null);
    try {
      const result = await getLpPlayers({ q: text, page: pageNumber });
      if (request !== latest.current) return;
      setPage(result);
      setSearched(text);
      const url = new URL(window.location.href);
      url.searchParams.set("q", text.trim());
      window.history.replaceState(null, "", url);
    } catch (err) {
      if (request === latest.current) setError(adminErrorMessage(err));
    } finally {
      if (request === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (initialQuery.trim()) void search(initialQuery);
  }, [initialQuery, search]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void search(query);
  }

  return (
    <section className="mt-6" aria-label="Find a player">
      <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="sr-only" htmlFor="ranks-search">
          Minecraft name or UUID
        </label>
        <input
          id="ranks-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a player: Minecraft name or UUID"
          autoComplete="off"
          spellCheck={false}
          className={`${inputClass} min-w-0 flex-1 basis-64`}
        />
        <button type="submit" disabled={busy} className={buttonClass}>
          {busy ? "Searching…" : "Find"}
        </button>
        <p className="text-xs text-[var(--tfmc-stone)]">
          {total.toLocaleString()} players have something set in LuckPerms. Part of a name is enough.
        </p>
      </form>
      {error ? (
        <p className={`mt-3 ${errorClass}`} role="alert">
          {error}
        </p>
      ) : null}
      {page ? <PlayerResults page={page} busy={busy} onPage={(n) => void search(searched, n)} /> : null}
    </section>
  );
}

type Grant = LpPlayerRow["groups"][number];

const MEMBER_COLUMNS = "lg:grid-cols-[12rem_minmax(12rem,1fr)_minmax(0,2fr)]";
const SEARCH_COLUMNS = "lg:grid-cols-[12rem_minmax(0,1fr)]";
const pageButtonClass = `${quietButtonClass} inline-flex min-h-11 items-center px-2`;

/** How a player holds the viewed group. One global permanent grant is the usual case, so phones skip it. */
function Assignment({ grants }: { grants: Grant[] }) {
  if (!grants.length) return <div className="hidden lg:block" />;
  const [only] = grants;
  if (grants.length === 1 && !shortContextLabel(only.contexts) && !only.expiry) {
    return <div className="hidden text-sm text-[var(--tfmc-stone)] lg:block">Permanent</div>;
  }
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-sm text-[var(--tfmc-mist)] lg:flex-col">
      {grants.map((grant, index) => (
        <li key={index}>
          {shortContextLabel(grant.contexts) || "Global"} · {expiryLabel(grant.expiry) || "Permanent"}
        </li>
      ))}
    </ul>
  );
}

/** Player rows for a search, or for a group's members when membershipGroup is set. */
export function PlayerResults({
  page,
  onPage,
  membershipGroup,
  busy = false,
  error = null,
}: {
  page: LpPlayerPage;
  onPage: (page: number) => void;
  membershipGroup?: string;
  busy?: boolean;
  error?: string | null;
}) {
  if (!page.rows.length) return <p className={`mt-3 ${mutedClass}`}>No players match.</p>;
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));
  const columns = membershipGroup ? MEMBER_COLUMNS : SEARCH_COLUMNS;
  return (
    <>
      {membershipGroup ? (
        <div className={`mt-4 hidden gap-x-4 text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)] lg:grid ${columns}`}>
          <span>Player</span>
          <span>Assignment</span>
          <span>Other groups</span>
        </div>
      ) : null}
      <ul className={`mt-3 lg:mt-1 ${rowClass}`}>
        {page.rows.map((row) => {
          const own = membershipGroup ? row.groups.filter((group) => group.name === membershipGroup) : [];
          const others = membershipGroup
            ? row.groups.filter((group) => group.name !== membershipGroup).sort((a, b) => a.name.localeCompare(b.name))
            : row.groups;
          return (
            <li key={row.uuid} className={`grid grid-cols-1 gap-1 pb-3 lg:items-center lg:gap-x-4 lg:py-1 ${columns}`}>
              <Link
                href={`/admin/ranks/players/${row.uuid}`}
                className="flex min-h-11 items-center font-semibold text-[var(--tfmc-cream)] hover:text-[var(--tfmc-accent)]"
              >
                {row.name ?? <span className="break-all font-mono text-xs">{row.uuid}</span>}
              </Link>
              {membershipGroup ? <Assignment grants={own} /> : null}
              {others.length ? (
                <div className="flex flex-wrap gap-1">
                  {others.map((group, index) => (
                    <GroupChip
                      key={`${group.name}-${index}`}
                      name={group.name}
                      contexts={group.contexts}
                      expiry={group.expiry}
                      muted={group.name === "default"}
                    />
                  ))}
                </div>
              ) : (
                <div className="hidden text-sm text-[var(--tfmc-stone)] lg:block">—</div>
              )}
            </li>
          );
        })}
      </ul>
      {pages > 1 ? (
        <nav aria-label="Pages" className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-[var(--tfmc-stone)]">
          <button type="button" className={pageButtonClass} disabled={busy || page.page <= 1} onClick={() => onPage(page.page - 1)}>
            ← Previous
          </button>
          <span className="px-2" aria-current="page">{busy ? "Loading…" : `Page ${page.page} of ${pages}`}</span>
          <button type="button" className={pageButtonClass} disabled={busy || page.page >= pages} onClick={() => onPage(page.page + 1)}>
            Next →
          </button>
        </nav>
      ) : null}
      {error ? (
        <p className={`mt-2 ${errorClass}`} role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

function groupHref(name: string): string {
  return `/admin/ranks/groups/${encodeURIComponent(name)}`;
}

function playerCount(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "player" : "players"}`;
}

function GroupBadges({ group }: { group: LpGroupSummary }) {
  return (
    <>
      {group.min_role === "root" ? <span className={`${badgeClass} bg-[#5a2a2a] text-[#f0c0c0]`}>Owner only</span> : null}
      {group.patreon ? <span className={`${badgeClass} bg-[#4a3a1a] text-[#f0d79a]`}>Patreon</span> : null}
    </>
  );
}

function GroupsPanel({ data, onChanged }: { data: LpOverview; onChanged: () => Promise<void> }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [inherit, setInherit] = useState("default");
  const [weight, setWeight] = useState("");
  const clean = name.trim().toLowerCase();
  const weightNumber = Number.parseInt(weight, 10);

  return (
    <section className={panelClass} aria-label="Groups">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className={headingClass}>Groups</h2>
        {data.rights.edit_definitions && !creating ? (
          <button type="button" className={quietButtonClass} onClick={() => setCreating(true)}>
            New group
          </button>
        ) : null}
      </div>
      <p className={`mt-1 ${mutedClass}`}>
        Heaviest first: a player shows the rank of the heaviest group they inherit. Player counts are direct assignments only.
      </p>
      {creating ? (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} spellCheck={false} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Inherits
              <select value={inherit} onChange={(e) => setInherit(e.target.value)} className={inputClass}>
                <option value="">Nothing</option>
                {data.groups.map((group) => (
                  <option key={group.name} value={group.name}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-28 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Weight
              <input value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
            </label>
          </div>
          {clean ? (
            <ChangeConfirm
              summary={
                <>
                  Create group <strong>{clean}</strong>
                  {inherit ? ` inheriting ${inherit}` : ""}
                  {Number.isFinite(weightNumber) ? `, weight ${weightNumber}` : ""}.
                </>
              }
              targetType="group"
              target={clean}
              ops={[
                { op: "create_group" },
                ...(inherit ? [{ op: "add_node" as const, node: { key: `group.${inherit}` } }] : []),
                ...(Number.isFinite(weightNumber) ? [{ op: "add_node" as const, node: { key: `weight.${weightNumber}` } }] : []),
              ]}
              confirmLabel="Create group"
              onDone={() => {
                setCreating(false);
                setName("");
                void onChanged();
              }}
              onCancel={() => setCreating(false)}
            />
          ) : (
            <button type="button" className={`${quietButtonClass} self-start`} onClick={() => setCreating(false)}>
              Cancel
            </button>
          )}
        </div>
      ) : null}
      {/* Phones and narrow windows get a list; the table needs the width for five columns. */}
      <ul className={`mt-3 lg:hidden ${rowClass}`} aria-label="Groups list">
        {data.groups.map((group) => (
          <li key={group.name} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 pb-3">
            <Link href={groupHref(group.name)} className="flex min-h-11 items-center break-words font-semibold text-[var(--tfmc-cream)] hover:text-[var(--tfmc-accent)]">
              {group.name}
            </Link>
            <Link href={`${groupHref(group.name)}#members`} className="flex min-h-11 items-center tabular-nums text-sm text-[var(--tfmc-mist)] hover:text-[var(--tfmc-accent)]">
              {playerCount(group.members)}
            </Link>
            <p className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <GroupBadges group={group} />
              {group.prefix ? <McText text={group.prefix} /> : null}
              {group.weight !== null ? <span className="tabular-nums text-[var(--tfmc-mist)]">Weight {group.weight}</span> : null}
            </p>
            {group.parents.length ? (
              <p className="col-span-2 mt-1 break-words text-sm text-[var(--tfmc-mist)]">Inherits: {group.parents.join(", ")}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <table className="mt-3 hidden w-full text-left text-sm lg:table">
        <thead className="text-xs uppercase tracking-wider text-[var(--tfmc-stone)]">
          <tr>
            <th className="py-2 pr-3 font-semibold">Group</th>
            <th className="py-2 pr-3 font-semibold">Prefix</th>
            <th className="py-2 pr-6 text-right font-semibold">Weight</th>
            <th className="py-2 pr-3 font-semibold">Inherits</th>
            <th className="py-2 text-right font-semibold">Players</th>
          </tr>
        </thead>
        <tbody className={rowClass}>
          {data.groups.map((group) => (
            <tr key={group.name} className="align-top">
              <td className="py-2 pr-3">
                <Link href={groupHref(group.name)} className="font-semibold text-[var(--tfmc-cream)] hover:text-[var(--tfmc-accent)]">
                  {group.name}
                </Link>
                {group.min_role === "root" || group.patreon ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    <GroupBadges group={group} />
                  </div>
                ) : null}
              </td>
              <td className="py-2 pr-3">{group.prefix ? <McText text={group.prefix} /> : <span className="text-[var(--tfmc-stone)]">—</span>}</td>
              <td className="py-2 pr-6 text-right tabular-nums text-[var(--tfmc-mist)]">{group.weight ?? "—"}</td>
              <td className="break-words py-2 pr-3 text-[var(--tfmc-mist)]">{group.parents.join(", ") || "—"}</td>
              <td className="py-2 text-right tabular-nums">
                <Link href={`${groupHref(group.name)}#members`} className="text-[var(--tfmc-mist)] hover:text-[var(--tfmc-accent)]">
                  {group.members.toLocaleString()}
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function TracksPanel({ data, onChanged }: { data: LpOverview; onChanged: () => Promise<void> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  return (
    <section className={panelClass} aria-label="Tracks">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className={headingClass}>Tracks</h2>
        {data.rights.edit_definitions && !creating ? (
          <button type="button" className={quietButtonClass} onClick={() => setCreating(true)}>
            New track
          </button>
        ) : null}
      </div>
      <p className={`mt-1 ${mutedClass}`}>Ladders players are promoted and demoted along, lowest first.</p>
      {creating ? (
        <TrackEditor
          track={{ name: "", groups: [] }}
          allGroups={data.groups.map((g) => g.name)}
          isNew
          onDone={() => {
            setCreating(false);
            void onChanged();
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}
      {data.tracks.length ? (
        <ul className={`mt-3 ${rowClass}`}>
          {data.tracks.map((track) => (
            <li key={track.name} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="mr-2 font-semibold text-[var(--tfmc-cream)]">{track.name}</span>
                {track.groups.map((group, index) => (
                  <span key={group} className="flex items-center gap-2">
                    {index ? <span className="text-[var(--tfmc-stone)]">→</span> : null}
                    <GroupChip name={group} />
                  </span>
                ))}
                {data.rights.edit_definitions && editing !== track.name ? (
                  <button type="button" className={`${quietButtonClass} ml-auto`} onClick={() => setEditing(track.name)}>
                    Edit
                  </button>
                ) : null}
              </div>
              {editing === track.name ? (
                <TrackEditor
                  track={track}
                  allGroups={data.groups.map((g) => g.name)}
                  onDone={() => {
                    setEditing(null);
                    void onChanged();
                  }}
                  onCancel={() => setEditing(null)}
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className={`mt-3 ${mutedClass}`}>No tracks.</p>
      )}
    </section>
  );
}

function TrackEditor({
  track,
  allGroups,
  isNew = false,
  onDone,
  onCancel,
}: {
  track: LpTrack;
  allGroups: string[];
  isNew?: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(track.name);
  const [groups, setGroups] = useState<string[]>(track.groups);
  const [adding, setAdding] = useState("");
  const [confirm, setConfirm] = useState<null | "save" | "delete">(null);
  const clean = name.trim().toLowerCase();
  const unused = allGroups.filter((g) => !groups.includes(g));

  function move(index: number, by: number) {
    const next = [...groups];
    const [item] = next.splice(index, 1);
    next.splice(index + by, 0, item);
    setGroups(next);
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      {isNew ? (
        <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
          Track name
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} spellCheck={false} />
        </label>
      ) : null}
      <ol className="flex flex-col gap-1">
        {groups.map((group, index) => (
          <li key={group} className="flex items-center gap-3 text-sm text-[var(--tfmc-cream)]">
            <span className="w-5 text-right tabular-nums text-[var(--tfmc-stone)]">{index + 1}</span>
            <span className="flex-1">{group}</span>
            <button type="button" aria-label={`Move ${group} earlier`} className={quietButtonClass} disabled={index === 0} onClick={() => move(index, -1)}>
              ↑
            </button>
            <button type="button" aria-label={`Move ${group} later`} className={quietButtonClass} disabled={index === groups.length - 1} onClick={() => move(index, 1)}>
              ↓
            </button>
            <button type="button" className={quietButtonClass} onClick={() => setGroups(groups.filter((g) => g !== group))}>
              Remove
            </button>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <select value={adding} onChange={(e) => setAdding(e.target.value)} className={inputClass} aria-label="Group to add">
          <option value="">Add a group…</option>
          {unused.map((group) => (
            <option key={group} value={group}>
              {group}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={quietButtonClass}
          disabled={!adding}
          onClick={() => {
            setGroups([...groups, adding]);
            setAdding("");
          }}
        >
          Add to the top
        </button>
      </div>
      {confirm ? (
        <ChangeConfirm
          summary={
            confirm === "delete" ? (
              <>Delete track <strong>{track.name}</strong>. Players keep their groups.</>
            ) : (
              <>
                {isNew ? "Create" : "Save"} track <strong>{clean}</strong>: {groups.join(" → ") || "no groups"}.
              </>
            )
          }
          targetType="track"
          target={isNew ? clean : track.name}
          ops={
            confirm === "delete"
              ? [{ op: "delete_track" }]
              : [...(isNew ? [{ op: "create_track" as const }] : []), { op: "set_groups", groups }]
          }
          confirmLabel={confirm === "delete" ? "Delete track" : "Save track"}
          onDone={onDone}
          onCancel={() => setConfirm(null)}
        />
      ) : (
        <div className="flex flex-wrap gap-4">
          <button type="button" className={buttonClass} disabled={isNew && !clean} onClick={() => setConfirm("save")}>
            {isNew ? "Create track" : "Save track"}
          </button>
          {!isNew ? (
            <button type="button" className={quietButtonClass} onClick={() => setConfirm("delete")}>
              Delete track
            </button>
          ) : null}
          <button type="button" className={quietButtonClass} onClick={onCancel}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
