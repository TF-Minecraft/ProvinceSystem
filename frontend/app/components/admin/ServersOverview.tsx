"use client";

import LoadingSkeleton from "@/app/components/shared/LoadingSkeleton";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import {
  counts,
  flags,
  getServers,
  severity,
  waiting,
  type PluginCopy,
  type ServerInfo,
  type ServerPlugin,
  type ServersOverview as Overview,
  type Tone,
} from "@/lib/admin/servers";
import { formatLocal } from "@/lib/skins/formatTime";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";
import { ControlDialog, ControlNotice, ServerActions, useServerControls } from "./ServerControls";
import { badgeClass, inputClass, mutedClass, panelClass, quietButtonClass, warnClass } from "./ui";

const TONE: Record<Tone, string> = {
  bad: "bg-[#5a2a2a] text-[#f0c0c0]",
  warn: "bg-[#5a4a2a] text-[#f0e0b0]",
  test: "bg-[#3d3352] text-[#d6c8f2]",
  none: "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-mist)]",
};

type View = "look" | "all" | "others";

// Written out in full so Tailwind finds them: one column per readable server, after the plugin
// name and (for TFMC plugins) its latest release.
const COLUMNS: Record<number, string> = {
  1: "grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)]",
  2: "grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_minmax(0,1fr)]",
};
const RELEASE_COLUMNS: Record<number, string> = {
  1: "grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(10rem,14rem)_6rem_minmax(0,1fr)]",
  2: "grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-[minmax(10rem,14rem)_6rem_minmax(0,1fr)_minmax(0,1fr)]",
};

const versionClass = "break-all font-mono text-xs text-[var(--tfmc-cream)]";
// A copy that matches the latest release has nothing to say, so it sits back.
const currentClass = "break-all font-mono text-xs text-[var(--tfmc-mist)]";
const captionClass = "text-xs text-[var(--tfmc-mist)]";
const labelClass = "text-[11px] font-semibold uppercase tracking-wider text-[var(--tfmc-mist)]";

const STARTUP: Record<string, [string, string]> = {
  true: ["Running", "bg-[var(--tfmc-accent)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--tfmc-accent)_25%,transparent)]"],
  false: ["Starting", "animate-pulse bg-[#f0d090]"],
  null: ["No startup in the logs", "bg-[var(--tfmc-mist)]"],
};
const STAT_TONE: Record<Tone, string> = {
  bad: "text-[#f0a0a0]",
  warn: "text-[#f0d090]",
  test: "text-[#d6c8f2]",
  none: "text-[var(--tfmc-mist)]",
};
// Written out in full so Tailwind finds them: one stat cell per column.
const STAT_COLUMNS: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };
const hairline = "border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]";
const cardClass = `flex flex-col overflow-hidden rounded-md border ${hairline} bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)]`;

function ServerCard({ server, plugins, actions }: { server: ServerInfo; plugins: ServerPlugin[]; actions: ReactNode }) {
  const available = server.status === "available";
  const [startup, dot] = STARTUP[String(server.started)];
  const c = counts(plugins, server.key);
  const stats: [number, string, Tone][] = [
    server.releases_only ? [c.notReleases, "Not releases", "bad"] : [c.notReleases, "Test builds", "test"],
    [c.waiting, "Need a restart", "warn"],
    [c.older, "Older releases", "warn"],
  ];
  // Rare, so it only shows when something failed to start.
  if (c.didNotStart) stats.push([c.didNotStart, "Didn’t start", "bad"]);
  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5">
        <div className="flex items-center gap-3">
          <h3 className="font-[family-name:var(--font-fraunces)] text-lg leading-none text-[var(--tfmc-cream)]">
            {server.label}
          </h3>
          {available ? (
            <span className="flex items-center gap-1.5 text-xs text-[var(--tfmc-stone)]">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${dot}`} />
              {startup}
            </span>
          ) : null}
        </div>
        {available ? (
          <span className="font-mono text-[11px] text-[var(--tfmc-mist)]">
            Paper {server.paper?.split("-ver")[0] ?? "unknown"}
          </span>
        ) : null}
      </div>
      {available ? (
        <div
          className={`grid border-y ${hairline} ${STAT_COLUMNS[stats.length]} divide-x divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]`}
        >
          {stats.map(([n, text, tone]) => (
            <div key={text} className="px-5 py-3">
              <p
                className={`text-2xl font-semibold leading-none tabular-nums ${n ? STAT_TONE[tone] : "text-[var(--tfmc-mist)] opacity-50"}`}
              >
                {n}
              </p>
              <p className="mt-1.5 text-xs text-[var(--tfmc-mist)]">{text}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className={`border-y ${hairline} px-5 py-4 ${mutedClass}`}>
          {server.status === "missing"
            ? "The site can’t find this server’s plugins folder."
            : "The site isn’t set up to read this server’s files."}
        </p>
      )}
      <div className="flex flex-1 flex-col justify-center bg-[color-mix(in_srgb,var(--tfmc-forest-deep)_45%,transparent)] px-5 py-3.5">
        {actions}
      </div>
    </section>
  );
}

/** Just the time when the check ran today. */
function checkedAt(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.toDateString() !== new Date().toDateString()) return formatLocal(iso);
  return at.toLocaleTimeString(undefined, { timeStyle: "short" });
}

function CopyCell({ copy, label, latest }: { copy: PluginCopy | undefined; label: string; latest: string }) {
  if (!copy) return <div />;
  const found = flags(copy);
  const pending = waiting(copy);
  const shown = copy.version ?? copy.files[0] ?? "";
  const current = !found.length && shown === latest;
  return (
    <div className="min-w-0">
      <p className={`${labelClass} sm:hidden`}>{label}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1" title={copy.files.join(", ")}>
        {copy.state === "missing" ? null : pending && copy.loaded ? (
          <span className={versionClass}>
            {copy.loaded} <span className="text-[#f0d090]">→ {shown}</span>
          </span>
        ) : (
          <span className={current ? currentClass : versionClass}>{copy.loaded ?? shown}</span>
        )}
        {found.map((flag) => (
          <span key={flag.label} className={`${badgeClass} ${TONE[flag.tone]}`}>
            {flag.label}
          </span>
        ))}
      </p>
      {copy.duplicate ? <p className={`${captionClass} mt-1 break-all`}>{copy.files.join(", ")}</p> : null}
    </div>
  );
}

export default function ServersOverview() {
  const [data, setData] = useState<Overview | null>(null);
  const [gate, setGate] = useState<GateKind | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("look");
  const [query, setQuery] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    getServers()
      .then((overview) => {
        setData(overview);
        setGate(null);
      })
      .catch((err) => setGate(gateKind(err)))
      .finally(() => setLoading(false));
  }, []);

  const control = useServerControls(load);

  useEffect(() => {
    const start = setTimeout(load, 0);
    return () => clearTimeout(start);
  }, [load]);

  const readable = useMemo(() => data?.servers.filter((s) => s.status === "available") ?? [], [data]);
  const needsLook = useMemo(() => {
    const list = (data?.plugins ?? []).filter((p) => severity(p) !== null);
    return list.sort((a, b) => (severity(a) ?? 9) - (severity(b) ?? 9) || a.repo.localeCompare(b.repo));
  }, [data]);

  if (gate && !data) return <StaffGateMessage kind={gate} />;
  if (!data) return <LoadingSkeleton variant="table" className="mt-6" />;

  const needle = query.trim().toLowerCase();
  const rows = (view === "look" ? needsLook : data.plugins).filter((p) => p.repo.toLowerCase().includes(needle));
  const others = data.others.filter((o) => o.name.toLowerCase().includes(needle));
  const columns = COLUMNS[readable.length] ?? COLUMNS[2];
  const releaseColumns = RELEASE_COLUMNS[readable.length] ?? RELEASE_COLUMNS[2];
  const tabs: [View, string, number][] = [
    ["look", "Needs a look", needsLook.length],
    ["all", "TFMC", data.plugins.length],
    ["others", "Other", data.others.length],
  ];

  return (
    <>
      <p className={`mt-6 text-right ${captionClass}`}>
        Checked {checkedAt(data.checked_at)} ·{" "}
        <button type="button" className={quietButtonClass} onClick={load} disabled={loading}>
          {loading ? "Checking…" : "Check again"}
        </button>
      </p>

      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {data.servers.map((server) => (
          <ServerCard
            key={server.key}
            server={server}
            plugins={data.plugins}
            actions={<ServerActions control={control} server={server.key} />}
          />
        ))}
      </div>
      <ControlNotice control={control} />
      <ControlDialog control={control} />

      {data.github.status === "unavailable" ? (
        <p className={`mt-4 ${warnClass}`} role="alert">
          GitHub didn’t answer, so releases can’t be compared. Try again in a minute.
        </p>
      ) : data.github.stale ? (
        <p className={`mt-4 ${warnClass}`}>
          GitHub didn’t answer; releases are from {formatLocal(data.github.checked_at)}.
        </p>
      ) : null}

      {readable.length ? (
        <section className={panelClass}>
          <div className="flex flex-wrap items-center gap-3">
            <div className={`flex w-full overflow-hidden rounded-sm border sm:inline-flex sm:w-auto ${hairline}`}>
              {tabs.map(([key, text, n]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={view === key}
                  aria-label={`${text}${key === "look" ? "" : " plugins"}, ${n}`}
                  onClick={() => setView(key)}
                  className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap border-l px-3 py-1.5 text-xs first:border-l-0 ${hairline} ${
                    view === key
                      ? "bg-[var(--tfmc-moss)] text-[var(--tfmc-cream)]"
                      : "text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
                  }`}
                >
                  <span>
                    {text}
                    {key === "look" ? null : <span className="hidden sm:inline"> plugins</span>}
                  </span>
                  <span className="tabular-nums text-[var(--tfmc-mist)]">{n}</span>
                </button>
              ))}
            </div>
            <input
              className={`${inputClass} ml-auto w-full sm:w-56`}
              placeholder="Find a plugin"
              aria-label="Find a plugin"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          {view === "others" ? (
            <ul className="mt-4">
              <li
                className={`${columns} hidden border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pb-2 sm:grid`}
              >
                <span className={labelClass}>Plugin</span>
                {readable.map((s) => (
                  <span key={s.key} className={labelClass}>
                    {s.label}
                  </span>
                ))}
              </li>
              {others.map((other) => (
                <li
                  key={other.name}
                  className={`${columns} items-baseline border-b border-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] py-2.5`}
                >
                  <p className="col-span-2 text-sm font-semibold text-[var(--tfmc-cream)] sm:col-span-1">
                    {other.name}
                    {other.differs ? (
                      <span className={`${badgeClass} ${TONE.warn} ml-2 align-middle`}>Differs</span>
                    ) : null}
                  </p>
                  {readable.map((s) => {
                    const found = other.servers[s.key];
                    return (
                      <div key={s.key} className="min-w-0">
                        <p className={`${labelClass} sm:hidden`}>{s.label}</p>
                        {found ? (
                          <p className={versionClass}>{found.version ?? found.file}</p>
                        ) : (
                          <span className={`${badgeClass} ${TONE.none}`}>Not installed</span>
                        )}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          ) : (
            <ul className="mt-4">
              <li
                className={`${releaseColumns} hidden border-b border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pb-2 sm:grid`}
              >
                <span className={labelClass}>Plugin</span>
                <span className={labelClass}>Latest</span>
                {readable.map((s) => (
                  <span key={s.key} className={labelClass}>
                    {s.label}
                  </span>
                ))}
              </li>
              {rows.map((plugin) => (
                <li
                  key={plugin.repo}
                  className={`${releaseColumns} items-baseline border-b border-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] py-2.5`}
                >
                  <div className="col-span-2 flex items-baseline justify-between gap-2 sm:contents">
                    <p className="text-sm font-semibold text-[var(--tfmc-cream)]">{plugin.repo}</p>
                    <a
                      href={plugin.latest.url}
                      target="_blank"
                      rel="noreferrer"
                      className="self-baseline font-mono text-xs text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)] hover:underline sm:justify-self-start"
                    >
                      {plugin.latest.version}
                    </a>
                  </div>
                  {readable.map((s) => (
                    <CopyCell key={s.key} copy={plugin.servers[s.key]} label={s.label} latest={plugin.latest.version} />
                  ))}
                </li>
              ))}
              {!rows.length ? (
                <li className={`py-6 text-center ${mutedClass}`}>
                  {view === "look" && !needle
                    ? "Every server runs the latest release of every plugin."
                    : "No plugins match."}
                </li>
              ) : null}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
