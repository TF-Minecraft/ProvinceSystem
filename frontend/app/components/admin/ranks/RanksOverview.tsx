"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { adminErrorMessage } from "../../../../lib/admin/api";
import {
  getLpPlayers,
  getLuckPerms,
  type LpOverview,
  type LpPlayerPage,
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
      {page ? <PlayerResults page={page} onPage={(n) => void search(searched, n)} /> : null}
    </section>
  );
}

export function PlayerResults({ page, onPage }: { page: LpPlayerPage; onPage: (page: number) => void }) {
  if (!page.rows.length) return <p className={`mt-3 ${mutedClass}`}>No players match.</p>;
  const pages = Math.max(1, Math.ceil(page.total / page.page_size));
  return (
    <>
      <ul className={`mt-3 ${rowClass}`}>
        {page.rows.map((row) => (
          <li key={row.uuid} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
            <Link
              href={`/admin/ranks/players/${row.uuid}`}
              className="min-w-[8rem] font-semibold text-[var(--tfmc-cream)] hover:text-[var(--tfmc-accent)]"
            >
              {row.name ?? <span className="font-mono text-xs">{row.uuid}</span>}
            </Link>
            <span className="flex flex-wrap gap-1">
              {row.groups.map((group, index) => (
                <GroupChip key={`${group.name}-${index}`} name={group.name} contexts={group.contexts} expiry={group.expiry} />
              ))}
            </span>
          </li>
        ))}
      </ul>
      {pages > 1 ? (
        <div className="mt-3 flex items-center gap-4 text-sm text-[var(--tfmc-stone)]">
          <button type="button" className={quietButtonClass} disabled={page.page <= 1} onClick={() => onPage(page.page - 1)}>
            ← Previous
          </button>
          <span>
            Page {page.page} of {pages}
          </span>
          <button type="button" className={quietButtonClass} disabled={page.page >= pages} onClick={() => onPage(page.page + 1)}>
            Next →
          </button>
        </div>
      ) : null}
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
      <p className={`mt-1 ${mutedClass}`}>Heaviest first: a player shows the rank of the heaviest group they inherit.</p>
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
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-[var(--tfmc-stone)]">
            <tr>
              <th className="py-2 pr-3 font-semibold">Group</th>
              <th className="py-2 pr-3 font-semibold">Prefix</th>
              <th className="py-2 pr-6 text-right font-semibold">Weight</th>
              <th className="w-1/3 py-2 pr-3 font-semibold">Inherits</th>
              <th className="py-2 text-right font-semibold">Players</th>
            </tr>
          </thead>
          <tbody className={rowClass}>
            {data.groups.map((group) => (
              <tr key={group.name}>
                <td className="py-2 pr-3">
                  <Link href={`/admin/ranks/groups/${encodeURIComponent(group.name)}`} className="font-semibold text-[var(--tfmc-cream)] hover:text-[var(--tfmc-accent)]">
                    {group.name}
                  </Link>
                  {group.min_role === "root" ? <span className={`${badgeClass} ml-2 bg-[#5a2a2a] text-[#f0c0c0]`}>Owner only</span> : null}
                  {group.patreon ? <span className={`${badgeClass} ml-2 bg-[#4a3a1a] text-[#f0d79a]`}>Patreon</span> : null}
                </td>
                <td className="py-2 pr-3">{group.prefix ? <McText text={group.prefix} /> : <span className="text-[var(--tfmc-stone)]">—</span>}</td>
                <td className="py-2 pr-6 text-right tabular-nums text-[var(--tfmc-mist)]">{group.weight ?? "—"}</td>
                <td className="py-2 pr-3 text-[var(--tfmc-mist)]">{group.parents.join(", ") || "—"}</td>
                <td className="py-2 text-right tabular-nums">
                  <Link href={`/admin/ranks/groups/${encodeURIComponent(group.name)}#members`} className="text-[var(--tfmc-mist)] hover:text-[var(--tfmc-accent)]">
                    {group.members.toLocaleString()}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
