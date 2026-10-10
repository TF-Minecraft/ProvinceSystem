"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccountApiError } from "../../../../lib/account/api";
import { roleLabel } from "../../../../lib/admin/api";
import {
  contextLabel,
  DURATIONS,
  expiryLabel,
  getLpPlayer,
  lpRequestMessage,
  STATUS_LABELS,
  type LpNode,
  type LpOp,
  type LpPlayer,
  type LpShownNode,
} from "../../../../lib/admin/luckperms";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import ChangeConfirm from "./ChangeConfirm";
import McText from "./McText";
import { ChangeHistory, GroupChip, StatusLine } from "./parts";
import { buttonClass, chipClass, headingClass, inputClass, mutedClass, panelClass, quietButtonClass, rowClass, warnClass } from "../ui";

/** Servers that share this LuckPerms storage; a node may apply to just one. */
export const SERVERS = ["main", "dev", "tutorial"] as const;
const PATREON_NOTE =
  "For linked patrons, Patreon may reset permanent all-server changes to this group within 30 minutes.";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "failed"; message: string } | { kind: "ready"; data: LpPlayer };

type Pending = { key: string; summary: ReactNode; ops: LpOp[]; warning?: string; label?: string };

export default function RankPlayer({ uuid }: { uuid: string }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [pending, setPending] = useState<Pending | null>(null);

  const refresh = useCallback(async () => {
    try {
      setLoad({ kind: "ready", data: await getLpPlayer(uuid) });
    } catch (err) {
      const status = err instanceof AccountApiError ? err.status : 0;
      setLoad(status === 400 || status === 404 ? { kind: "failed", message: lpRequestMessage(err) } : { kind: gateKind(err) });
    }
  }, [uuid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (load.kind === "loading") return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;
  if (load.kind === "failed") {
    return (
      <p className="mt-6 text-[var(--tfmc-mist)]" role="alert">
        {load.message}
      </p>
    );
  }
  if (load.kind !== "ready") return <StaffGateMessage kind={load.kind} />;

  const { data } = load;
  const { player, rights } = data;
  const canChange = rights.change_this_player && data.status.applying && !data.pending;
  const name = player.name ?? "this player";

  function ask(next: Pending) {
    setPending(next);
  }

  function confirmFor(key: string) {
    if (!pending || pending.key !== key) return null;
    return (
      <ChangeConfirm
        summary={pending.summary}
        warning={pending.warning}
        targetType="user"
        target={player.uuid}
        ops={pending.ops}
        confirmLabel={pending.label}
        onDone={() => {
          setPending(null);
          void refresh();
        }}
        onCancel={() => setPending(null)}
      />
    );
  }

  const groupNodes = player.nodes.filter((n) => n.kind === "group");
  const otherNodes = player.nodes.filter((n) => n.kind !== "group");

  return (
    <>
      <header className="mt-6">
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          {player.rank_prefix ? (
            <>
              <McText text={player.rank_prefix} className="mr-2 text-xl" />{" "}
            </>
          ) : null}
          {player.name ?? "Unknown name"}
        </h2>
        <p className="mt-1 font-mono text-xs text-[var(--tfmc-stone)]">{player.uuid}</p>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          Rank {player.rank ?? "default"}
          {player.account?.discord_username ? ` · Discord @${player.account.discord_username}` : " · No Discord link"}
          {player.account?.role && player.account.role !== "player" ? ` · Website ${roleLabel(player.account.role)}` : ""}
          {" · "}
          <Link href={`/admin/players/${player.uuid}`} className="text-[var(--tfmc-accent)] underline-offset-2 hover:underline">
            Player profile
          </Link>
        </p>
        <StatusLine status={data.status} rights={rights} />
        {data.pending ? (
          <p className={`mt-2 ${warnClass}`} role="status">
            {STATUS_LABELS[data.pending.status]}: <span className="font-mono text-xs">{data.pending.description}</span>.{" "}
            <button type="button" className={quietButtonClass} onClick={() => void refresh()}>
              Refresh
            </button>
          </p>
        ) : null}
        {rights.change_players && !rights.change_this_player && !rights.read_only ? (
          <p className={`mt-2 ${mutedClass}`}>
            You can view {name}’s ranks but not change them: they are you, website staff at or above your role, or in-game staff.
          </p>
        ) : null}
      </header>

      {player.tracks.length ? (
        <section className={panelClass} aria-label="Tracks">
          <h3 className={headingClass}>Tracks</h3>
          <ul className={`mt-2 ${rowClass}`}>
            {player.tracks.map((track) => (
              <li key={track.name} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-2 w-20 font-semibold text-[var(--tfmc-cream)]">{track.name}</span>
                  {track.groups.map((group, index) => (
                    <span key={group} className="flex items-center gap-2">
                      {index ? <span className="text-[var(--tfmc-stone)]">→</span> : null}
                      <span
                        className={`${chipClass} ${index === track.position ? "border-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-accent)_25%,transparent)] font-semibold" : "opacity-60"}`}
                        aria-current={index === track.position ? "step" : undefined}
                      >
                        {group}
                      </span>
                    </span>
                  ))}
                  {canChange && (track.can_promote || track.can_demote) ? (
                    <span className="ml-auto flex gap-3">
                      {track.can_demote ? (
                        <button
                          type="button"
                          className={quietButtonClass}
                          onClick={() =>
                            ask({
                              key: `track-${track.name}`,
                              summary: (
                                <>
                                  Demote {name} on <strong>{track.name}</strong>
                                  {track.position === 0 ? `, off the track` : ` to ${track.groups[(track.position ?? 1) - 1]}`}.
                                </>
                              ),
                              ops: [{ op: "demote", track: track.name }],
                              label: "Demote",
                            })
                          }
                        >
                          Demote
                        </button>
                      ) : null}
                      {track.can_promote ? (
                        <button
                          type="button"
                          className={quietButtonClass}
                          onClick={() =>
                            ask({
                              key: `track-${track.name}`,
                              summary: (
                                <>
                                  Promote {name} on <strong>{track.name}</strong> to{" "}
                                  {track.groups[track.position === null ? 0 : track.position + 1]}.
                                </>
                              ),
                              ops: [{ op: "promote", track: track.name }],
                              label: "Promote",
                            })
                          }
                        >
                          Promote
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                </div>
                {track.ambiguous ? <p className={`mt-1 ${warnClass}`}>Holds more than one group on this track.</p> : null}
                {confirmFor(`track-${track.name}`)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={panelClass} aria-label="Groups">
        <h3 className={headingClass}>Groups</h3>
        {player.inherits.length ? (
          <p className={`mt-1 ${mutedClass}`}>Across all servers, including inherited: {player.inherits.join(", ")}.</p>
        ) : null}
        {groupNodes.length ? (
          <ul className={`mt-2 ${rowClass}`}>
            {groupNodes.map((node) => (
              <NodeRow
                key={nodeKey(node)}
                node={node}
                canChange={canChange}
                onRemove={() =>
                  ask({
                    key: nodeKey(node),
                    summary: (
                      <>
                        Remove {name} from <strong>{node.group}</strong>
                        {describeScope(node)}.
                      </>
                    ),
                    ops: [{ op: "remove_node", node: plain(node) }],
                    warning: data.groups.find((g) => g.name === node.group)?.patreon ? PATREON_NOTE : undefined,
                    label: "Remove",
                  })
                }
              >
                <GroupChip name={node.group ?? node.key} />
                {!node.value ? <span className={warnClass}>denied</span> : null}
              </NodeRow>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${mutedClass}`}>No groups of their own: they have the default rank.</p>
        )}
        {pending && groupNodes.some((n) => nodeKey(n) === pending.key) ? confirmFor(pending.key) : null}
        {canChange ? (
          <AddForm
            kind="group"
            groups={data.groups.filter((g) => g.addable).map((g) => g.name)}
            patreon={data.groups.filter((g) => g.patreon).map((g) => g.name)}
            name={name}
            onAsk={ask}
          />
        ) : null}
        {pending?.key === "add-group" ? confirmFor("add-group") : null}
      </section>

      <PermissionsPanel
        nodes={otherNodes}
        canChange={canChange}
        name={name}
        adminPermissions={rights.edit_definitions ? null : rights.admin_permissions}
        onAsk={ask}
        confirm={pending && (pending.key === "add-permission" || otherNodes.some((n) => nodeKey(n) === pending.key)) ? confirmFor(pending.key) : null}
      />

      <section className={panelClass} aria-label="Changes">
        <h3 className={headingClass}>Changes from the website</h3>
        <ChangeHistory changes={data.changes} />
      </section>
    </>
  );
}

function nodeKey(node: LpNode): string {
  return `${node.key}|${node.value}|${contextLabel(node.contexts)}|${node.expiry}`;
}

function plain(node: LpShownNode): LpNode {
  return { key: node.key, value: node.value, contexts: node.contexts, expiry: node.expiry };
}

function describeScope(node: LpNode): string {
  const parts = [contextLabel(node.contexts) ? `on ${contextLabel(node.contexts)}` : "", expiryLabel(node.expiry).toLowerCase()];
  const text = parts.filter(Boolean).join(", ");
  return text ? ` (${text})` : "";
}

function NodeRow({
  node,
  canChange,
  onRemove,
  children,
}: {
  node: LpShownNode;
  canChange: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
      {children}
      {contextLabel(node.contexts) ? <span className="text-xs text-[var(--tfmc-stone)]">{contextLabel(node.contexts)}</span> : null}
      {node.expiry ? <span className="text-xs text-[#e8c48a]">{expiryLabel(node.expiry)}</span> : null}
      {canChange && node.editable ? (
        <button type="button" className={`${quietButtonClass} ml-auto`} onClick={onRemove}>
          Remove
        </button>
      ) : null}
    </li>
  );
}

function scopeFields(server: string, duration: number): Pick<LpNode, "contexts" | "expiry"> {
  return {
    contexts: server ? { server: [server] } : {},
    expiry: duration ? Math.floor(Date.now() / 1000) + duration : 0,
  };
}

function ScopeInputs({
  server,
  setServer,
  duration,
  setDuration,
}: {
  server: string;
  setServer: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
}) {
  return (
    <>
      <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Where
        <select value={server} onChange={(e) => setServer(e.target.value)} className={inputClass}>
          <option value="">All servers</option>
          {SERVERS.map((s) => (
            <option key={s} value={s}>
              {s} only
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        For
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={inputClass}>
          {DURATIONS.map((d) => (
            <option key={d.seconds} value={d.seconds}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function AddForm({
  kind,
  groups,
  patreon,
  name,
  onAsk,
}: {
  kind: "group";
  groups: string[];
  patreon: string[];
  name: string;
  onAsk: (pending: Pending) => void;
}) {
  const [group, setGroup] = useState("");
  const [server, setServer] = useState("");
  const [duration, setDuration] = useState(0);
  if (!groups.length) return null;
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Add to group
        <select value={group} onChange={(e) => setGroup(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          {groups.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </label>
      <ScopeInputs server={server} setServer={setServer} duration={duration} setDuration={setDuration} />
      <button
        type="button"
        className={buttonClass}
        disabled={!group}
        onClick={() => {
          const node = { key: `group.${group}`, value: true, ...scopeFields(server, duration) };
          onAsk({
            key: `add-${kind}`,
            summary: (
              <>
                Add {name} to <strong>{group}</strong>
                {describeScope(node)}.
              </>
            ),
            ops: [{ op: "add_node", node }],
            warning: patreon.includes(group) ? PATREON_NOTE : undefined,
            label: "Add",
          });
        }}
      >
        Add
      </button>
    </div>
  );
}

function PermissionsPanel({
  nodes,
  canChange,
  name,
  adminPermissions,
  onAsk,
  confirm,
}: {
  nodes: LpShownNode[];
  canChange: boolean;
  name: string;
  adminPermissions: string[] | null;
  onAsk: (pending: Pending) => void;
  confirm: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState(true);
  const [server, setServer] = useState("");
  const [duration, setDuration] = useState(0);
  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return text ? nodes.filter((n) => n.key.toLowerCase().includes(text)) : nodes;
  }, [nodes, filter]);

  return (
    <section className={panelClass} aria-label="Permissions">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className={headingClass}>Permissions</h3>
        <span className="text-xs text-[var(--tfmc-stone)]">{nodes.length} set directly</span>
      </div>
      {nodes.length > 8 ? (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter"
          aria-label="Filter permissions"
          spellCheck={false}
          className={`${inputClass} mt-3 w-full`}
        />
      ) : null}
      {shown.length ? (
        <ul className={`mt-2 max-h-[28rem] overflow-y-auto ${rowClass}`}>
          {shown.map((node) => (
            <NodeRow
              key={nodeKey(node)}
              node={node}
              canChange={canChange}
              onRemove={() =>
                onAsk({
                  key: nodeKey(node),
                  summary: (
                    <>
                      Unset <span className="font-mono">{node.key}</span> for {name}
                      {describeScope(node)}.
                    </>
                  ),
                  ops: [{ op: "remove_node", node: plain(node) }],
                  label: "Unset",
                })
              }
            >
              <span className={`font-mono text-xs ${node.value ? "text-[var(--tfmc-cream)]" : "text-[#e8a0a0] line-through"}`}>
                {node.kind === "meta" ? <McText text={node.key} /> : node.key}
              </span>
              {!node.value ? <span className="text-xs text-[#e8a0a0]">false</span> : null}
            </NodeRow>
          ))}
        </ul>
      ) : (
        <p className={`mt-2 ${mutedClass}`}>{nodes.length ? "Nothing matches." : "None of their own."}</p>
      )}
      {canChange ? (
        <form
          className="mt-4 flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const node = { key, value, ...scopeFields(server, duration) };
            onAsk({
              key: "add-permission",
              summary: (
                <>
                  Set <span className="font-mono">{node.key}</span> to {String(value)} for {name}
                  {describeScope(node)}.
                </>
              ),
              ops: [{ op: "add_node", node }],
              label: "Set",
            });
          }}
        >
          <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
            Set permission
            <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="professions.chef_1" spellCheck={false} autoCapitalize="none" className={`${inputClass} font-mono`} />
          </label>
          <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
            Value
            <select value={String(value)} onChange={(e) => setValue(e.target.value === "true")} className={inputClass}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
          <ScopeInputs server={server} setServer={setServer} duration={duration} setDuration={setDuration} />
          <button type="submit" className={buttonClass} disabled={!key.trim()}>
            Set
          </button>
        </form>
      ) : null}
      {canChange && adminPermissions ? (
        <p className="mt-2 text-xs text-[var(--tfmc-stone)]">Admins may set {adminPermissions.join(", ")}. Anything else needs the owner.</p>
      ) : null}
      {confirm}
    </section>
  );
}
