"use client";

import { Fragment, useState } from "react";
import {
  GROUP_SECTIONS,
  commandCounts,
  commandLabel,
  commandState,
  filterPlugins,
  groupLabel,
  inheritanceChain,
  isNewCommand,
  matchesCommand,
  previousGroup,
  totalCommands,
  type CommandGroup,
  type CommandsSnapshot,
  type CommandsUrlState,
} from "@/lib/admin/commands";
import { expiryLabel, shortContextLabel, type LpNode } from "@/lib/admin/luckperms";
import { formatEpoch } from "@/lib/admin/time";
import { badgeClass, headingClass, inputClass, rowClass } from "../ui";
import {
  Caret,
  CommandDetail,
  EmptyResults,
  GroupLink,
  NewBadge,
  StateMark,
  commandPanelClass,
  focusClass,
  footnote,
  lineClass,
  stateLabels,
} from "./parts";

export default function CommandRoles({
  data,
  state,
  onChange,
  onReset,
}: {
  data: CommandsSnapshot;
  state: CommandsUrlState;
  onChange: (patch: Partial<CommandsUrlState>) => void;
  onReset: () => void;
}) {
  const [openRow, setOpenRow] = useState<string | null>(null);
  const sections = GROUP_SECTIONS.map((section) => ({
    ...section,
    groups: data.groups.filter((group) => group.kind === section.kind && (state.steps || group.kind !== "step")),
  })).filter((section) => section.groups.length);
  const visible = sections.flatMap((section) => section.groups);
  const group = visible.find((item) => item.name === state.role) ?? visible[0];
  if (!group) return <p className="py-8 text-sm text-[var(--tfmc-mist)]">No roles in this command list.</p>;
  const index = data.groups.indexOf(group);
  const previous = previousGroup(data.groups, group);
  const previousIndex = previous ? data.groups.indexOf(previous) : -1;
  const commands = data.plugins.flatMap((plugin) => plugin.commands);
  const counts = commandCounts(commands, index);
  const added = commands.filter((command) => isNewCommand(command, index, previousIndex)).length;
  const chain = inheritanceChain(group, data.groups);
  const list = filterPlugins(
    data.plugins,
    (command, plugin) =>
      commandState(command, index) === state.state &&
      (!state.onlyNew || isNewCommand(command, index, previousIndex)) &&
      matchesCommand(command, plugin, state.q),
  );
  const selectRole = (role: string) => {
    setOpenRow(null);
    onChange({ role, onlyNew: false });
  };

  return (
    <div className="grid items-start gap-7 md:grid-cols-[192px_minmax(0,1fr)]">
      <aside aria-label="Roles" className={`hidden border-r ${lineClass} pr-[18px] md:block`}>
        <div className="mx-2 mb-3 flex justify-between text-[10px] uppercase tracking-widest text-[var(--tfmc-mist)]">
          <span>Role</span>
          <span>Members</span>
        </div>
        {sections.map((section) => (
          <div key={section.kind} className="mb-5">
            <h3 className="mx-2 mb-2 text-[10px] uppercase tracking-widest text-[var(--tfmc-mist)]">{section.label}</h3>
            {section.groups.map((item) => (
              <button
                key={item.name}
                type="button"
                aria-label={`${groupLabel(item)} ${item.members} members`}
                aria-pressed={item.name === group.name}
                onClick={() => selectRole(item.name)}
                className={`${focusClass} flex min-h-[37px] w-full items-center justify-between gap-2 rounded-sm border-l-2 px-2 py-1.5 text-left text-[13px] ${item.name === group.name ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-moss)] text-[var(--tfmc-cream)]" : "border-transparent text-[var(--tfmc-stone)] hover:bg-[var(--tfmc-forest)]"}`}
              >
                <span>{groupLabel(item)}</span>
                <small
                  className="text-[11px] tabular-nums text-[var(--tfmc-mist)]"
                  aria-label={`${item.members} members`}
                >
                  {item.members}
                </small>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <section aria-label={`${groupLabel(group)} commands`} className="min-w-0">
        <label className="mb-[18px] flex items-center justify-between gap-3 text-xs text-[var(--tfmc-mist)] md:hidden">
          Role
          <select
            aria-label="Role"
            value={group.name}
            onChange={(event) => selectRole(event.target.value)}
            className={`${inputClass} w-[230px] max-w-[80%]`}
          >
            {sections.map((section) => (
              <optgroup key={section.kind} label={section.label}>
                {section.groups.map((item) => (
                  <option key={item.name} value={item.name}>
                    {groupLabel(item)} · {item.members} members
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={`${headingClass} !text-[25px]`}>
            <GroupLink group={group} />
            <span className="ml-2 font-[family-name:var(--font-source-sans)] text-xs text-[var(--tfmc-mist)]">
              {group.members} {group.members === 1 ? "member" : "members"}
            </span>
          </h3>
          {previous ? (
            <span className="text-xs text-[var(--tfmc-mist)]">
              <span className="text-[#a0bb91]">+{added}</span> vs {groupLabel(previous)}
            </span>
          ) : null}
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-1.5 text-xs text-[var(--tfmc-stone)]">
          <span className="mr-0.5 text-[var(--tfmc-mist)]">Inheritance</span>
          {chain.length ? (
            chain.map((name, i) => {
              const parent = data.groups.find((item) => item.name === name);
              return (
                <Fragment key={name}>
                  {i > 0 ? (
                    <span aria-hidden="true" className="text-[var(--tfmc-mist)]">
                      ›
                    </span>
                  ) : null}
                  {parent ? <GroupLink group={parent} /> : <span>{name}</span>}
                </Fragment>
              );
            })
          ) : (
            <span>None</span>
          )}
        </div>
        <div aria-label="Command permission states" className={`${commandPanelClass} mb-5 grid grid-cols-3`}>
          {(["y", "n", "o"] as const).map((value, i) => (
            <button
              key={value}
              type="button"
              aria-pressed={state.state === value}
              onClick={() => onChange({ state: value, onlyNew: false })}
              className={`${focusClass} border-b-2 px-2 py-3 text-left sm:px-4 ${i ? `border-l ${lineClass}` : ""} ${state.state === value ? "border-b-[var(--tfmc-accent)] bg-[color-mix(in_srgb,var(--tfmc-moss)_30%,transparent)]" : "border-b-transparent"}`}
            >
              <span className="mb-1 flex items-center gap-2 text-[23px] leading-tight tabular-nums">
                <StateMark state={value} />
                {counts[value]}
              </span>
              <span className="text-[10px] text-[var(--tfmc-mist)] sm:text-xs">{stateLabels[value]}</span>
            </button>
          ))}
        </div>
        <div className="mb-3 flex min-h-6 flex-wrap items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold">
            {state.q || state.onlyNew
              ? `${totalCommands(list)} commands`
              : state.state === "y"
                ? "Allowed commands"
                : state.state === "n"
                  ? "Hidden commands"
                  : "No permission set"}
          </h4>
          {state.state === "y" && previous ? (
            <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--tfmc-mist)] sm:text-xs">
              <input
                type="checkbox"
                checked={state.onlyNew}
                onChange={(event) => onChange({ onlyNew: event.target.checked })}
                className={`${focusClass} accent-[var(--tfmc-accent)] [color-scheme:dark]`}
              />
              Only new at this rank <span className="text-[#a0bb91]">+{added}</span>
            </label>
          ) : (
            <span className="text-[11px] text-[var(--tfmc-mist)]">{totalCommands(list)} commands</span>
          )}
        </div>
        <div className={commandPanelClass}>
          {!list.length ? (
            <EmptyResults onReset={onReset} />
          ) : (
            list.map((plugin) => {
              const newCount =
                state.state === "y"
                  ? plugin.commands.filter((command) => isNewCommand(command, index, previousIndex)).length
                  : 0;
              return (
                <details
                  key={`${group.name}/${state.state}/${state.q}/${state.onlyNew}/${plugin.name}`}
                  open={Boolean(
                    state.q.trim() || state.onlyNew || plugin.name === "Essentials" || plugin.name === "ItemsAdder",
                  )}
                  className={`group border-t ${lineClass} first:border-t-0`}
                >
                  <summary
                    className={`${focusClass} flex min-h-[41px] cursor-pointer list-none items-center gap-2 px-3.5 py-2 [&::-webkit-details-marker]:hidden`}
                  >
                    <span className="group-open:rotate-90">
                      <Caret />
                    </span>
                    <span className="truncate text-xs font-semibold">{plugin.name}</span>
                    <span className="hidden truncate text-[10px] text-[var(--tfmc-mist)] sm:inline">
                      {plugin.version}
                    </span>
                    <span className="ml-auto text-[11px] tabular-nums text-[var(--tfmc-mist)]">
                      {plugin.commands.length}
                    </span>
                    {newCount > 0 ? <NewBadge>+{newCount} new</NewBadge> : null}
                  </summary>
                  {plugin.commands.map((command) => {
                    const id = `${group.name}/${plugin.name}/${command.name}`;
                    const open = openRow === id;
                    const isNew = state.state === "y" && isNewCommand(command, index, previousIndex);
                    return (
                      <Fragment key={command.name}>
                        <div
                          className={`flex min-h-[35px] flex-wrap items-center gap-x-3 gap-y-1 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_7.5%,transparent)] py-2 pl-7 pr-3.5 text-xs sm:flex-nowrap sm:pl-9 ${isNew ? "bg-[color-mix(in_srgb,var(--tfmc-accent)_4%,transparent)]" : ""}`}
                        >
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() => setOpenRow(open ? null : id)}
                            className={`${focusClass} flex min-w-0 flex-1 basis-40 items-center gap-2 text-left sm:flex-none sm:basis-[235px]`}
                          >
                            <StateMark state={commandState(command, index)} />
                            <code
                              className={`truncate text-[11px] ${command.shadowed ? "text-[var(--tfmc-mist)]" : ""}`}
                            >
                              {commandLabel(command, plugin)}
                            </code>
                          </button>
                          <span className="order-3 w-full truncate pl-5 text-[11px] text-[var(--tfmc-mist)] sm:order-none sm:w-auto sm:pl-0 sm:text-xs">
                            {command.description}
                          </span>
                          {isNew ? (
                            <span className="ml-auto">
                              <NewBadge>New</NewBadge>
                            </span>
                          ) : null}
                        </div>
                        {open ? <CommandDetail command={command} plugin={plugin} groups={data.groups} /> : null}
                      </Fragment>
                    );
                  })}
                </details>
              );
            })
          )}
          <p className={`border-t ${lineClass} px-3.5 py-2.5 text-[11px] text-[var(--tfmc-mist)]`}>{footnote}</p>
        </div>
        <OwnPermissions key={group.name} group={group} />
      </section>
    </div>
  );
}

function OwnPermissions({ group }: { group: CommandGroup }) {
  const granted = group.nodes.filter((node) => node.value);
  const denied = group.nodes.filter((node) => !node.value);
  return (
    <details className={`${commandPanelClass} group mt-5!`}>
      <summary
        className={`${focusClass} flex min-h-[46px] cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-[13px] [&::-webkit-details-marker]:hidden`}
      >
        <span className="group-open:rotate-90">
          <Caret />
        </span>
        Own permissions
        <small className="ml-auto text-[10px] text-[var(--tfmc-mist)] sm:text-[11px]">
          {granted.length} granted · {denied.length} denied
        </small>
      </summary>
      <div className={`border-t ${lineClass} p-3.5`}>
        <p className="mb-3 text-[11px] text-[var(--tfmc-mist)]">
          Set directly on {groupLabel(group)}. Inherited permissions are shown on their source roles.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          {[
            { label: "Granted", nodes: granted },
            { label: "Denied", nodes: denied },
          ].map(({ label, nodes }) => (
            <div key={label}>
              <h5 className="mb-1.5 text-[11px] text-[var(--tfmc-mist)]">
                {label} · {nodes.length}
              </h5>
              <NodeList nodes={nodes} />
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function NodeList({ nodes }: { nodes: LpNode[] }) {
  if (!nodes.length) return <p className="text-xs text-[var(--tfmc-mist)]">None</p>;
  return (
    <ul className={rowClass}>
      {nodes.map((node, index) => (
        <li key={index} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[11px]">
          <code className={`min-w-0 break-all ${node.value ? "" : "text-[#e8a0a0]"}`}>{node.key}</code>
          <span className="flex flex-wrap gap-1">
            {Object.entries(node.contexts).flatMap(([key, values]) =>
              values.map((value) => (
                <span
                  key={`${key}=${value}`}
                  title={`${key}=${value}`}
                  className={`${badgeClass} !text-[9px] !normal-case !tracking-normal bg-[var(--tfmc-forest-deep)] text-[var(--tfmc-mist)]`}
                >
                  {shortContextLabel({ [key]: [value] })}
                </span>
              )),
            )}
            {node.expiry ? (
              <span title={formatEpoch(node.expiry)} className="text-[10px] text-[var(--tfmc-mist)]">
                {expiryLabel(node.expiry)}
              </span>
            ) : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
