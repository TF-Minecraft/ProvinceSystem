"use client";

import { Fragment, useState } from "react";
import {
  GROUP_SECTIONS,
  commandCounts,
  commandLabel,
  commandState,
  filterPlugins,
  groupLabel,
  matchesCommand,
  matchesFilter,
  totalCommands,
  type CommandFilter,
  type CommandsSnapshot,
  type CommandsUrlState,
} from "@/lib/admin/commands";
import { inputClass, quietButtonClass } from "../ui";
import {
  Caret,
  CommandDetail,
  EmptyResults,
  Legend,
  StateMark,
  commandPanelClass,
  focusClass,
  footnote,
  lineClass,
} from "./parts";

const FILTERS: { id: CommandFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "player", label: "Player allowed" },
  { id: "staff", label: "Staff only" },
  { id: "open", label: "No permission set" },
];

export default function CommandMatrix({
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openRow, setOpenRow] = useState<string | null>(null);
  const sections = GROUP_SECTIONS.map((section) => ({
    ...section,
    groups: data.groups
      .map((group, index) => ({ group, index }))
      .filter(({ group }) => group.kind === section.kind && (state.steps || group.kind !== "step")),
  })).filter((section) => section.groups.length);
  const columns = sections.flatMap((section) => section.groups);
  const base = filterPlugins(
    data.plugins,
    (command, plugin) => (!state.plugin || plugin.name === state.plugin) && matchesCommand(command, plugin, state.q),
  );
  const list = filterPlugins(base, (command) => matchesFilter(command, data.groups, state.filter));
  const isOpen = (name: string) => expanded[name] ?? Boolean(state.q.trim() || state.plugin === name);
  const allOpen = list.every((plugin) => isOpen(plugin.name));
  const count = totalCommands(list);
  const filtered = Boolean(state.q || state.filter !== "all" || state.plugin);
  const boundary = (index: number) =>
    index > 0 && columns[index].group.kind !== columns[index - 1].group.kind ? `border-l ${lineClass}` : "";

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div aria-label="Command filters" className="flex flex-wrap gap-1">
          {FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              aria-label={`${filter.label} ${totalCommands(filterPlugins(base, (command) => matchesFilter(command, data.groups, filter.id)))}`}
              aria-pressed={state.filter === filter.id}
              onClick={() => onChange({ filter: filter.id })}
              className={`${focusClass} flex min-h-8 items-center gap-2 rounded-sm border px-2 text-xs ${state.filter === filter.id ? `border-[var(--tfmc-accent)]/20 bg-[var(--tfmc-moss)] text-[var(--tfmc-cream)]` : "border-transparent text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"}`}
            >
              {filter.label}
              <span className="text-[11px] tabular-nums opacity-70">
                {totalCommands(filterPlugins(base, (command) => matchesFilter(command, data.groups, filter.id)))}
              </span>
            </button>
          ))}
        </div>
        <Legend />
      </div>
      <section aria-label="Commands by role" className={commandPanelClass}>
        <div
          className={`flex min-h-[49px] flex-wrap items-center justify-between gap-3 border-b ${lineClass} px-3.5 py-2`}
        >
          <p role="status" className="text-xs tabular-nums text-[var(--tfmc-mist)]">
            <strong className="font-medium text-[var(--tfmc-cream)]">{count}</strong>{" "}
            {filtered ? `of ${totalCommands(data.plugins)} ` : ""}commands · {list.length}{" "}
            {list.length === 1 ? "plugin" : "plugins"}
          </p>
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs text-[var(--tfmc-mist)]">
              <span className="sr-only sm:not-sr-only">Plugin</span>
              <select
                aria-label="Plugin"
                value={state.plugin}
                onChange={(event) => {
                  setExpanded({});
                  onChange({ plugin: event.target.value });
                }}
                className={`${inputClass} max-w-44 !py-1 !text-xs`}
              >
                <option value="">All plugins</option>
                {data.plugins.map((plugin) => (
                  <option key={plugin.name} value={plugin.name}>
                    {plugin.name}
                  </option>
                ))}
              </select>
            </label>
            {list.length > 0 ? (
              <button
                type="button"
                className={`${quietButtonClass} ${focusClass} min-h-8 !text-xs`}
                onClick={() => setExpanded(Object.fromEntries(list.map((plugin) => [plugin.name, !allOpen])))}
              >
                {allOpen ? "Collapse all" : "Expand all"}
              </button>
            ) : null}
          </div>
        </div>
        {!list.length ? (
          <EmptyResults onReset={onReset} />
        ) : (
          <>
            <div
              className={`flex justify-between border-b ${lineClass} px-3 py-2 text-[10px] text-[var(--tfmc-mist)] sm:hidden`}
            >
              <span>Command column stays fixed</span>
              <span>Scroll ranks →</span>
            </div>
            <div
              tabIndex={0}
              aria-label="Command permission matrix. Scroll for more commands and ranks."
              className={`${focusClass} max-h-[560px] overflow-auto overscroll-contain [scrollbar-color:var(--tfmc-moss)_transparent] [scrollbar-width:thin] sm:max-h-[652px]`}
            >
              <table
                className="w-full table-fixed border-separate border-spacing-0 text-center text-xs [&_td]:border-b [&_td]:border-[color-mix(in_srgb,var(--tfmc-cream)_7.5%,transparent)] [&_th]:border-b [&_th]:border-[color-mix(in_srgb,var(--tfmc-cream)_7.5%,transparent)] [&_th]:font-normal"
                style={{ minWidth: Math.max(1000, 400 + columns.length * 80) }}
              >
                <caption className="sr-only">
                  Commands grouped by plugin, with command permission results for each role.
                </caption>
                <colgroup>
                  <col className="w-[240px] sm:w-[400px]" />
                  {columns.map(({ group }) => (
                    <col key={group.name} />
                  ))}
                </colgroup>
                <thead>
                  <tr>
                    <th
                      scope="col"
                      rowSpan={2}
                      className={`sticky left-0 top-0 z-20 bg-[#1a2c23] px-4 pb-3.5 text-left align-bottom text-[11px] text-[var(--tfmc-mist)]`}
                    >
                      Plugin / command
                    </th>
                    {sections.map((section, index) => (
                      <th
                        key={section.kind}
                        scope="colgroup"
                        colSpan={section.groups.length}
                        className={`sticky top-0 z-10 h-6 bg-[#1a2c23] pt-1.5 text-[9px] uppercase tracking-widest text-[var(--tfmc-mist)] ${index ? `border-l ${lineClass}` : ""}`}
                      >
                        {section.label}
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {columns.map(({ group }, index) => (
                      <th
                        scope="col"
                        aria-label={`${groupLabel(group)} ${group.members} members`}
                        key={group.name}
                        className={`sticky top-6 z-10 h-12 break-words bg-[#1a2c23] px-1 text-[var(--tfmc-stone)] ${boundary(index)}`}
                      >
                        {groupLabel(group)}
                        <small className="mb-1.5 mt-0.5 block text-[10px] text-[var(--tfmc-mist)]">
                          {group.members} {group.members === 1 ? "member" : "members"}
                        </small>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.map((plugin) => (
                    <Fragment key={plugin.name}>
                      <tr>
                        <th scope="row" className="sticky left-0 z-[2] bg-[#1b2f25] text-left">
                          <button
                            type="button"
                            aria-label={`${plugin.name} ${plugin.commands.length} commands`}
                            aria-expanded={isOpen(plugin.name)}
                            onClick={() =>
                              setExpanded((previous) => ({ ...previous, [plugin.name]: !isOpen(plugin.name) }))
                            }
                            className={`${focusClass} flex min-h-[42px] w-full items-center gap-2 px-3.5 py-2 text-left`}
                          >
                            <Caret open={isOpen(plugin.name)} />
                            <span className="truncate text-[13px] font-semibold">{plugin.name}</span>
                            <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-[var(--tfmc-mist)]">
                              {plugin.commands.length} commands
                            </span>
                          </button>
                        </th>
                        {columns.map(({ group, index }, column) => {
                          const counts = commandCounts(plugin.commands, index);
                          const uniform = (["y", "n", "o"] as const).find(
                            (state) => counts[state] === plugin.commands.length,
                          );
                          return (
                            <td
                              key={group.name}
                              className={`bg-[#1b2f25] text-[11px] tabular-nums ${boundary(column)}`}
                            >
                              {uniform ? (
                                <StateMark state={uniform} />
                              ) : (
                                <span title={`${counts.y} allowed of ${plugin.commands.length} commands`}>
                                  {counts.y}
                                  <small className="text-[10px] text-[var(--tfmc-mist)]">
                                    {" "}
                                    / {plugin.commands.length}
                                  </small>
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      {isOpen(plugin.name)
                        ? plugin.commands.map((command) => {
                            const id = `${plugin.name}/${command.name}`;
                            const open = openRow === id;
                            return (
                              <Fragment key={id}>
                                <tr className={`group ${open ? "bg-[#263e30]" : ""}`}>
                                  <th
                                    scope="row"
                                    className={`sticky left-0 z-[2] text-left group-hover:bg-[#20372a] ${open ? "bg-[#263e30]" : "bg-[#15261d]"}`}
                                  >
                                    <button
                                      type="button"
                                      aria-label={commandLabel(command, plugin)}
                                      aria-expanded={open}
                                      title={command.description ?? undefined}
                                      onClick={() => setOpenRow(open ? null : id)}
                                      className={`${focusClass} flex min-h-[35px] w-full items-center gap-2 px-4 py-1.5 text-left sm:pl-8`}
                                    >
                                      <Caret open={open} />
                                      <code
                                        className={`truncate text-[11px] ${command.shadowed ? "text-[var(--tfmc-mist)]" : ""}`}
                                      >
                                        {commandLabel(command, plugin)}
                                      </code>
                                      {command.aliases.length ? (
                                        <span className="ml-auto hidden whitespace-nowrap text-[10px] text-[var(--tfmc-mist)] sm:inline">
                                          {command.aliases.length} {command.aliases.length === 1 ? "alias" : "aliases"}
                                        </span>
                                      ) : null}
                                    </button>
                                  </th>
                                  {columns.map(({ group, index }, column) => (
                                    <td key={group.name} className={`group-hover:bg-[#20372a] ${boundary(column)}`}>
                                      <StateMark state={commandState(command, index)} />
                                    </td>
                                  ))}
                                </tr>
                                {open ? (
                                  <tr>
                                    <td colSpan={columns.length + 1}>
                                      <div className="sticky left-0 w-fit sm:w-full">
                                        <CommandDetail command={command} plugin={plugin} groups={data.groups} />
                                      </div>
                                    </td>
                                  </tr>
                                ) : null}
                              </Fragment>
                            );
                          })
                        : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div
          className={`flex justify-between gap-5 border-t ${lineClass} px-3.5 py-2.5 text-[11px] text-[var(--tfmc-mist)]`}
        >
          <span>{footnote}</span>
          <span className="hidden sm:inline">Plugin counts show allowed / total.</span>
        </div>
      </section>
    </>
  );
}
