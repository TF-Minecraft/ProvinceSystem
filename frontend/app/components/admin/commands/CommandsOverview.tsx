"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import LoadingSkeleton from "@/app/components/shared/LoadingSkeleton";
import {
  commandsUrl,
  getCommands,
  parseCommandsState,
  totalCommands,
  type CommandsSnapshot,
  type CommandsUrlState,
} from "@/lib/admin/commands";
import { formatAgo, formatEpoch } from "@/lib/admin/time";
import { writeUrl } from "@/lib/admin/urlState";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import { headingClass, inputClass, quietButtonClass, warnClass } from "../ui";
import CommandMatrix from "./CommandMatrix";
import CommandRoles from "./CommandRoles";
import { Icon, StateMark, commandPanelClass, focusClass, lineClass } from "./parts";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "ready"; data: CommandsSnapshot };
const defaultState = () => parseCommandsState(new URLSearchParams());
const phoneQuery = "(max-width: 767px)";
const phoneSnapshot = () => window.matchMedia?.(phoneQuery).matches ?? false;
function subscribePhone(onChange: () => void) {
  const media = window.matchMedia?.(phoneQuery);
  media?.addEventListener?.("change", onChange);
  return () => media?.removeEventListener?.("change", onChange);
}

const STALE_SECONDS = 30 * 60;

export default function CommandsOverview({ initialState = defaultState() }: { initialState?: CommandsUrlState }) {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [state, setState] = useState(initialState);
  const phone = useSyncExternalStore(subscribePhone, phoneSnapshot, () => false);
  const view = state.view ?? (phone ? "roles" : "matrix");
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    let active = true;
    getCommands()
      .then((data) => {
        if (active) setLoad({ kind: "ready", data });
      })
      .catch((error) => {
        if (active) setLoad({ kind: gateKind(error) });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onPopState = () => setState(parseCommandsState(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPopState);
    const timer = setInterval(() => setNow(Date.now() / 1000), 60_000);
    return () => {
      window.removeEventListener("popstate", onPopState);
      clearInterval(timer);
    };
  }, []);

  function change(patch: Partial<CommandsUrlState>) {
    const next = { ...state, view, ...patch };
    setState(next);
    writeUrl(commandsUrl(new URL(window.location.href), next), true);
  }
  const reset = () => change({ q: "", filter: "all", plugin: "", onlyNew: false, state: "y" });

  if (load.kind === "loading") return <LoadingSkeleton variant="content" className="mt-6" />;
  if (load.kind !== "ready") return <StaffGateMessage kind={load.kind} />;
  const { data } = load;
  const status = data.status;
  const age = status
    ? now - status.generated_at >= 30 * 86400
      ? `${Math.floor((now - status.generated_at) / 86400)} d ago`
      : formatAgo(status.generated_at, now).toLowerCase()
    : "";
  // The server resends at least every ten minutes; 30 minutes without one means the list may be out of date.
  const stale = status ? !status.fresh || now - Date.parse(status.received_at) / 1000 > STALE_SECONDS : false;
  const noPermission = data.plugins
    .flatMap((plugin) => plugin.commands)
    .filter((command) => command.access === null).length;

  return (
    <div className="py-6 text-[var(--tfmc-cream)] sm:pt-7">
      <header className="mb-5 sm:mb-6">
        <h2 className={`${headingClass} !text-[27px] sm:!text-3xl`}>Commands</h2>
        {status ? (
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1 text-xs text-[var(--tfmc-mist)] sm:text-[13px]">
            <span>
              {totalCommands(data.plugins)} commands · {data.plugins.length} plugins
            </span>
            <span>
              · <span className="capitalize">{status.server}</span> · Published{" "}
              <time
                dateTime={new Date(status.generated_at * 1000).toISOString()}
                title={formatEpoch(status.generated_at)}
              >
                {age}
              </time>
            </span>
          </p>
        ) : null}
      </header>
      {!status ? (
        <p className="text-sm text-[var(--tfmc-mist)]">
          No command list yet. TFMCWeb publishes it when the LuckPerms bridge is on.
        </p>
      ) : (
        <>
          {stale ? (
            <p role="status" className={`mb-4 ${warnClass}`}>
              Command list is stale · published {age}.
            </p>
          ) : null}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
              <div
                aria-label="Command views"
                className={`inline-flex w-fit gap-1 rounded-md border ${lineClass} bg-[color-mix(in_srgb,var(--tfmc-forest)_35%,transparent)] p-[3px]`}
              >
                {(["matrix", "roles"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={view === value}
                    onClick={() => change({ view: value })}
                    className={`${focusClass} flex min-h-[30px] items-center justify-center gap-2 rounded-sm px-3.5 py-1 text-[13px] ${view === value ? "bg-[var(--tfmc-moss)] text-[var(--tfmc-cream)]" : "text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"}`}
                  >
                    <Icon kind={value} />
                    {value === "matrix" ? "By command" : "By role"}
                  </button>
                ))}
              </div>
              {data.groups.some((group) => group.kind === "step") ? (
                <label className="inline-flex items-center gap-1.5 text-xs text-[var(--tfmc-mist)]">
                  <input
                    type="checkbox"
                    checked={state.steps}
                    onChange={(event) => {
                      const steps = event.target.checked;
                      const hidingRole =
                        !steps && data.groups.find((group) => group.name === state.role)?.kind === "step";
                      change(
                        hidingRole
                          ? {
                              steps,
                              role: data.groups.find((group) => group.kind !== "step")?.name ?? "",
                              onlyNew: false,
                            }
                          : { steps },
                      );
                    }}
                    className={`${focusClass} accent-[var(--tfmc-accent)] [color-scheme:dark]`}
                  />
                  Show track steps
                </label>
              ) : null}
            </div>
            <div className="relative flex w-full items-center sm:max-w-[464px] sm:flex-1">
              <Icon kind="search" className="pointer-events-none absolute left-3 text-[var(--tfmc-mist)]" />
              <label htmlFor="commands-search" className="sr-only">
                Search commands, aliases, plugins or permissions
              </label>
              <input
                id="commands-search"
                type="search"
                value={state.q}
                onChange={(event) => change({ q: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === "Escape") change({ q: "" });
                }}
                autoComplete="off"
                spellCheck={false}
                placeholder="Search commands, aliases or permissions…"
                className={`${inputClass} h-10 w-full !rounded-md !pl-9 !pr-10 !text-[13px] sm:h-[38px] [&::-webkit-search-cancel-button]:appearance-none`}
              />
              {state.q ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  className={`${focusClass} absolute right-1 grid h-8 w-8 place-items-center text-lg text-[var(--tfmc-mist)]`}
                  onClick={() => change({ q: "" })}
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
          {noPermission > 0 ? (
            <div
              className={`${commandPanelClass} mb-5 flex items-center gap-2.5 !px-3 !py-2.5 text-xs text-[var(--tfmc-mist)] sm:mb-[22px] sm:text-[13px]`}
            >
              <StateMark state="o" />
              <p className="flex-1">
                <span className="text-[var(--tfmc-stone)]">{noPermission} commands have no permission set.</span>
                <span className="hidden sm:inline"> Players are offered them unless the plugin hides them itself.</span>
              </p>
              <button
                type="button"
                className={`${quietButtonClass} ${focusClass} inline-flex min-h-6 items-center gap-1.5 !text-xs`}
                onClick={() => change({ view: "matrix", filter: "open", plugin: "", q: "", onlyNew: false })}
              >
                Review
                <Icon kind="arrow" className="hidden sm:block" />
              </button>
            </div>
          ) : null}
          {view === "matrix" ? (
            <CommandMatrix
              key={`${state.q}/${state.plugin}`}
              data={data}
              state={state}
              onChange={change}
              onReset={reset}
            />
          ) : (
            <CommandRoles data={data} state={state} onChange={change} onReset={reset} />
          )}
        </>
      )}
    </div>
  );
}
