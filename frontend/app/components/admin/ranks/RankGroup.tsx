"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AccountApiError } from "../../../../lib/account/api";
import { adminErrorMessage } from "../../../../lib/admin/api";
import {
  contextLabel,
  expiryLabel,
  getLpGroup,
  getLpPlayers,
  lpRequestMessage,
  STATUS_LABELS,
  type LpGroupDetail,
  type LpNode,
  type LpOp,
  type LpPlayerPage,
  type LpShownNode,
} from "../../../../lib/admin/luckperms";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import ChangeConfirm from "./ChangeConfirm";
import McText from "./McText";
import { ChangeHistory, GroupChip, StatusLine } from "./parts";
import { PlayerResults } from "./RanksOverview";
import { SERVERS } from "./RankPlayer";
import { badgeClass, buttonClass, headingClass, inputClass, mutedClass, panelClass, quietButtonClass, rowClass, warnClass } from "./ui";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "failed"; message: string } | { kind: "ready"; data: LpGroupDetail };
type Pending = { key: string; summary: ReactNode; ops: LpOp[]; label?: string; warning?: string };

function plain(node: LpShownNode): LpNode {
  return { key: node.key, value: node.value, contexts: node.contexts, expiry: node.expiry };
}

function nodeKey(node: LpNode): string {
  return `${node.key}|${node.value}|${contextLabel(node.contexts)}|${node.expiry}`;
}

export default function RankGroup({ name }: { name: string }) {
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [pending, setPending] = useState<Pending | null>(null);
  const [members, setMembers] = useState<LpPlayerPage | null>(null);
  const [membersBusy, setMembersBusy] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await getLpGroup(name);
      setLoad({ kind: "ready", data });
      setMembers(data.members);
    } catch (err) {
      const status = err instanceof AccountApiError ? err.status : 0;
      setLoad(status === 400 || status === 404 ? { kind: "failed", message: lpRequestMessage(err) } : { kind: gateKind(err) });
    }
  }, [name]);

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
  const { group, rights } = data;
  const canEdit = rights.edit_definitions && data.status.applying && !data.pending;
  const weightNode = group.nodes.find((n) => n.key.startsWith("weight.") && !Object.keys(n.contexts).length);
  const prefixNode = group.nodes.find((n) => n.key.startsWith("prefix.") && !Object.keys(n.contexts).length);

  const confirm = (key: string) =>
    pending?.key === key ? (
      <ChangeConfirm
        summary={pending.summary}
        warning={pending.warning}
        targetType="group"
        target={group.name}
        ops={pending.ops}
        confirmLabel={pending.label}
        onDone={() => {
          setPending(null);
          if (pending.key === "delete") router.push("/admin/ranks");
          else void refresh();
        }}
        onCancel={() => setPending(null)}
      />
    ) : null;

  return (
    <>
      <header className="mt-6">
        <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">
          {group.name}
          {group.min_role === "root" ? <span className={`${badgeClass} ml-3 bg-[#5a2a2a] align-middle text-[#f0c0c0]`}>Owner only</span> : null}
          {group.patreon ? <span className={`${badgeClass} ml-2 bg-[#4a3a1a] align-middle text-[#f0d79a]`}>Patreon</span> : null}
        </h2>
        <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
          {group.prefix ? (
            <>
              Prefix <McText text={group.prefix} /> ·{" "}
            </>
          ) : null}
          Weight {group.weight ?? "none"} · {group.members.toLocaleString()} players hold it directly
          {group.tracks.length ? ` · on track ${group.tracks.join(", ")}` : ""}
        </p>
        <StatusLine status={data.status} rights={rights} />
        {data.pending ? (
          <p className={`mt-2 ${warnClass}`} role="status">
            {STATUS_LABELS[data.pending.status]}: <span className="font-mono text-xs">{data.pending.description}</span>.
          </p>
        ) : null}
      </header>

      <section className={panelClass} aria-label="Inheritance">
        <h3 className={headingClass}>Inheritance</h3>
        <p className={`mt-2 ${mutedClass}`}>
          Inherits:{" "}
          {group.inherits.length ? group.inherits.map((g) => <GroupChip key={g} name={g} />) : "nothing"}
        </p>
        <p className={`mt-2 ${mutedClass}`}>
          Inherited by: {group.children.length ? group.children.map((g) => <GroupChip key={g} name={g} />) : "no other group"}
        </p>
      </section>

      {canEdit ? (
        <section className={panelClass} aria-label="Settings">
          <h3 className={headingClass}>Settings</h3>
          <p className={`mt-1 ${warnClass}`}>Changes here affect everyone in {group.name} and every group that inherits it.</p>
          <SettingsForm
            group={group.name}
            weightNode={weightNode}
            prefixNode={prefixNode}
            onAsk={setPending}
          />
          {confirm("settings")}
        </section>
      ) : null}

      <NodesPanel
        group={group.name}
        nodes={group.nodes}
        allGroups={data.all_groups.filter((g) => g !== group.name)}
        canEdit={canEdit}
        onAsk={setPending}
        confirm={pending && pending.key !== "settings" && pending.key !== "delete" ? confirm(pending.key) : null}
      />

      <section className={panelClass} aria-label="Members" id="members">
        <h3 className={headingClass}>
          Players in {group.name}{" "}
          <span className="whitespace-nowrap text-[var(--tfmc-mist)]">· {(members?.total ?? group.members).toLocaleString()}</span>
        </h3>
        <p className={`mt-1 ${mutedClass}`}>Direct members only. Chips show their other groups.</p>
        {members ? (
          <PlayerResults
            page={members}
            membershipGroup={group.name}
            busy={membersBusy}
            error={membersError}
            onPage={(page) => {
              setMembersBusy(true);
              setMembersError(null);
              void getLpPlayers({ group: group.name, page })
                .then(setMembers)
                .catch((err) => setMembersError(adminErrorMessage(err)))
                .finally(() => setMembersBusy(false));
            }}
          />
        ) : null}
      </section>

      <section className={panelClass} aria-label="Changes">
        <h3 className={headingClass}>Changes from the website</h3>
        <ChangeHistory changes={data.changes} />
      </section>

      {canEdit && group.name !== "default" ? (
        <section className={panelClass} aria-label="Delete">
          <h3 className={headingClass}>Delete group</h3>
          {pending?.key === "delete" ? (
            confirm("delete")
          ) : (
            <button
              type="button"
              className={`${quietButtonClass} mt-2`}
              onClick={() =>
                setPending({
                  key: "delete",
                  summary: (
                    <>
                      Delete <strong>{group.name}</strong>.
                    </>
                  ),
                  warning: `${group.members} players hold it directly and ${group.children.length} groups inherit it. Remove it from tracks first.`,
                  ops: [{ op: "delete_group" }],
                  label: "Delete group",
                })
              }
            >
              Delete {group.name}…
            </button>
          )}
        </section>
      ) : null}
    </>
  );
}

function SettingsForm({
  group,
  weightNode,
  prefixNode,
  onAsk,
}: {
  group: string;
  weightNode?: LpShownNode;
  prefixNode?: LpShownNode;
  onAsk: (pending: Pending) => void;
}) {
  const currentWeight = weightNode ? weightNode.key.slice("weight.".length) : "";
  const prefixParts = prefixNode ? prefixNode.key.split(".") : [];
  const currentPriority = prefixParts[1] ?? "";
  const currentPrefix = prefixNode ? prefixParts.slice(2).join(".") : "";
  const [weight, setWeight] = useState(currentWeight);
  const [prefix, setPrefix] = useState(currentPrefix);
  const [priority, setPriority] = useState(currentPriority || currentWeight || "0");
  // A priority on its own is not a change: it only counts with a prefix.
  const prefixChanged = prefix !== currentPrefix || (Boolean(prefix) && priority !== currentPriority);

  function save() {
    const ops: LpOp[] = [];
    if (weight !== currentWeight) {
      if (weightNode) ops.push({ op: "remove_node", node: plain(weightNode) });
      if (weight) ops.push({ op: "add_node", node: { key: `weight.${weight}` } });
    }
    if (prefixChanged) {
      if (prefixNode) ops.push({ op: "remove_node", node: plain(prefixNode) });
      if (prefix) ops.push({ op: "add_node", node: { key: `prefix.${priority || "0"}.${prefix}` } });
    }
    if (!ops.length) return;
    onAsk({
      key: "settings",
      summary: (
        <>
          {weight !== currentWeight ? <>Weight {currentWeight || "none"} → {weight || "none"}. </> : null}
          {prefixChanged ? (
            <>
              Prefix {currentPrefix ? <McText text={currentPrefix} /> : "none"} → {prefix ? <McText text={prefix} /> : "none"}
              {prefix ? ` (priority ${priority || 0})` : ""}.
            </>
          ) : null}
        </>
      ),
      ops,
      label: `Save ${group}`,
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="flex w-28 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Weight
        <input value={weight} onChange={(e) => setWeight(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
      </label>
      <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Prefix (&amp; colour codes)
        <input value={prefix} onChange={(e) => setPrefix(e.target.value)} spellCheck={false} className={`${inputClass} font-mono`} />
      </label>
      <label className="flex w-28 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Priority
        <input value={priority} onChange={(e) => setPriority(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" className={inputClass} />
      </label>
      {prefix ? (
        <span className="pb-2 text-sm">
          Preview <McText text={prefix} />
        </span>
      ) : null}
      <button type="button" className={buttonClass} onClick={save} disabled={weight === currentWeight && !prefixChanged}>
        Save
      </button>
    </div>
  );
}

function NodesPanel({
  group,
  nodes,
  allGroups,
  canEdit,
  onAsk,
  confirm,
}: {
  group: string;
  nodes: LpShownNode[];
  allGroups: string[];
  canEdit: boolean;
  onAsk: (pending: Pending) => void;
  confirm: ReactNode;
}) {
  const [filter, setFilter] = useState("");
  const [key, setKey] = useState("");
  const [value, setValue] = useState(true);
  const [server, setServer] = useState("");
  const [parent, setParent] = useState("");
  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return text ? nodes.filter((n) => n.key.toLowerCase().includes(text)) : nodes;
  }, [nodes, filter]);

  function addNode(node: Partial<LpNode> & { key: string }, words: ReactNode) {
    onAsk({ key: "add", summary: words, ops: [{ op: "add_node", node }], label: "Add" });
  }

  return (
    <section className={panelClass} aria-label="Permissions">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h3 className={headingClass}>Permissions and settings</h3>
        <span className="text-xs text-[var(--tfmc-stone)]">{nodes.length} nodes</span>
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
      <ul className={`mt-2 max-h-[32rem] overflow-y-auto ${rowClass}`}>
        {shown.map((node) => (
          <li key={nodeKey(node)} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
            {node.kind === "group" ? (
              <span className="text-[var(--tfmc-mist)]">
                inherits <GroupChip name={node.group ?? ""} />
              </span>
            ) : (
              <span className={`font-mono text-xs ${node.value ? "text-[var(--tfmc-cream)]" : "text-[#e8a0a0] line-through"}`}>
                {node.kind === "meta" ? <McText text={node.key} /> : node.key}
              </span>
            )}
            {!node.value ? <span className="text-xs text-[#e8a0a0]">false</span> : null}
            {contextLabel(node.contexts) ? <span className="text-xs text-[var(--tfmc-stone)]">{contextLabel(node.contexts)}</span> : null}
            {node.expiry ? <span className="text-xs text-[#e8c48a]">{expiryLabel(node.expiry)}</span> : null}
            {canEdit ? (
              <button
                type="button"
                className={`${quietButtonClass} ml-auto`}
                onClick={() =>
                  onAsk({
                    key: nodeKey(node),
                    summary: (
                      <>
                        Remove <span className="font-mono">{node.key}</span> from {group}.
                      </>
                    ),
                    ops: [{ op: "remove_node", node: plain(node) }],
                    label: "Remove",
                  })
                }
              >
                Remove
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <div className="mt-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Inherit a group
              <select value={parent} onChange={(e) => setParent(e.target.value)} className={inputClass}>
                <option value="">Choose…</option>
                {allGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={buttonClass}
              disabled={!parent}
              onClick={() =>
                addNode({ key: `group.${parent}` }, (
                  <>
                    Make {group} inherit <strong>{parent}</strong>.
                  </>
                ))
              }
            >
              Add
            </button>
          </div>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const contexts: Record<string, string[]> = server ? { server: [server] } : {};
              const node = { key, value, contexts };
              addNode(node, (
                <>
                  Set <span className="font-mono">{node.key}</span> to {String(value)} on {group}
                  {server ? ` (${server} only)` : ""}.
                </>
              ));
            }}
          >
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Set permission
              <input value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoCapitalize="none" className={`${inputClass} font-mono`} />
            </label>
            <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
              Value
              <select value={String(value)} onChange={(e) => setValue(e.target.value === "true")} className={inputClass}>
                <option value="true">true</option>
                <option value="false">false</option>
              </select>
            </label>
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
            <button type="submit" className={buttonClass} disabled={!key.trim()}>
              Set
            </button>
          </form>
        </div>
      ) : null}
      {confirm}
    </section>
  );
}
