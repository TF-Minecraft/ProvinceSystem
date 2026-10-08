"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  adminErrorMessage,
  coreProtectMessage,
  getPlayerActivity,
  type ActivityEntry,
} from "../../../lib/admin/api";
import { groupActivity, placeName, targetName, type ActivityRow, type WorldNames } from "../../../lib/admin/activity";
import { formatClock } from "../../../lib/admin/movement";
import { formatEpoch } from "../../../lib/admin/time";
import {
  Retry,
  dayHeadingClass,
  dividerClass,
  headingClass,
  moreClass,
  mutedClass,
  panelClass,
  type Failure,
} from "./profileParts";

export const KIND_LABELS: Record<string, string> = {
  block: "Blocks",
  click: "Clicks",
  kill: "Kills",
  spawn: "Spawns",
  container: "Containers",
  item: "Items",
  entity: "Entities",
  sign: "Signs",
  skill: "Skills",
  command: "Commands",
  session: "Logins",
  chat: "Chat",
};

const SOURCE_LABELS: Record<string, string> = { mmoitems: "MMOItems", mythicmobs: "MythicMobs" };

// Each channel in the colour its in-game tag uses (RPCharacters' chat.yml).
const CHANNEL_COLOURS: Record<string, string> = {
  LOOC: "#55c455", OOC: "#7f8cff", GOOC: "#ffaa00", FOOC: "#55e0e0", POOC: "#ff77ff", ROOC: "#ff77ff",
  Admin: "#ff6b6b", Helper: "#ff77ff", Shout: "#ffaa00", Yell: "#ff6b6b", Whisper: "#55aaff", Emote: "#ff77ff",
};

function ChannelTag({ channel, inferred = false }: { channel: string; inferred?: boolean }) {
  const colour = CHANNEL_COLOURS[channel] ?? "var(--tfmc-mist)";
  return (
    <span
      title={inferred ? "Probably their channel at the time" : undefined}
      className="mr-1.5 inline-block rounded-full border px-1.5 align-[1px] text-[10px] font-semibold uppercase tracking-wide"
      style={{ color: colour, borderColor: `color-mix(in srgb, ${colour} 45%, transparent)` }}
    >
      {channel}
    </span>
  );
}

const strongClass = "font-semibold text-[var(--tfmc-cream)]";
const badgeClass =
  "ml-1.5 inline-block rounded-full border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] px-1.5 align-[1px] text-[10px] font-medium uppercase tracking-wide text-[var(--tfmc-stone)]";

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Clock({ at }: { at: number }) {
  return (
    <time
      dateTime={new Date(at * 1000).toISOString()}
      title={formatEpoch(at)}
      className="pt-px text-xs tabular-nums text-[var(--tfmc-stone)]"
    >
      {formatClock(at)}
    </time>
  );
}

/** The thing a row names, with a custom item's or mob's plugin, or an anvil name over the vanilla one. */
function Thing({ entry, count }: { entry: ActivityEntry; count: number }) {
  const info = entry.target_info;
  const name = targetName(entry) ?? "";
  const amount = count > 1 ? `${count} × ` : entry.amount && entry.amount > 1 ? `${entry.amount} × ` : "";
  if (entry.victim?.uuid) {
    return (
      <Link
        href={`/admin/players/${entry.victim.uuid}`}
        className={`${strongClass} underline-offset-2 hover:text-[var(--tfmc-accent)] hover:underline`}
      >
        {name}
      </Link>
    );
  }
  if (info?.custom_name) {
    return (
      <>
        <span className={`break-words ${strongClass}`}>{`${amount}“${info.custom_name}”`}</span>
        <span className="text-[var(--tfmc-stone)]"> · {name}</span>
      </>
    );
  }
  return (
    <>
      <span className={`break-words ${strongClass}`}>{`${amount}${name}`}</span>
      {info && SOURCE_LABELS[info.source] ? <span className={badgeClass}>{SOURCE_LABELS[info.source]}</span> : null}
    </>
  );
}

function Sentence({ entry, count }: { entry: ActivityEntry; count: number }) {
  const verb = capital(entry.verb);
  if (entry.kind === "command" && entry.channel) {
    // A moderator's view of channel chat: where they spoke, not what.
    return (
      <>
        Spoke in <ChannelTag channel={entry.channel} />
      </>
    );
  }
  if (entry.kind === "command") {
    return (
      <>
        {verb}{" "}
        <code className="break-all font-mono text-[0.8125rem] text-[var(--tfmc-cream)]">{entry.target}</code>
      </>
    );
  }
  if (entry.kind === "sign") return <>{verb} a sign</>;
  return (
    <>
      {verb} <Thing entry={entry} count={count} />
    </>
  );
}

/** What a row can say beyond its sentence: plugin and Minecraft ids, the item under a custom one. */
function identity(entry: ActivityEntry): string[] {
  const info = entry.target_info;
  if (!info || info.source === "player") return [];
  const lines: string[] = [];
  if (info.source_id) lines.push(`${SOURCE_LABELS[info.source] ?? info.source} id ${info.source_id}`);
  if (info.vanilla_name && info.vanilla_name !== info.name) lines.push(`Based on ${info.vanilla_name}`);
  if (info.source === "unknown" && info.id) lines.push(`Recorded as ${info.id}`);
  return lines;
}

function coords(entry: ActivityEntry): string {
  return `${entry.x}, ${entry.y}, ${entry.z}`;
}

function Row({ row, names }: { row: ActivityRow; names: WorldNames }) {
  const [open, setOpen] = useState(false);
  const entry = row.entries[0];
  const count = row.entries.length;
  const where = entry.world ? placeName(entry.world, names) : null;

  if (entry.kind === "session") {
    const login = entry.verb === "logged in";
    return (
      <li className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 py-2">
        <Clock at={entry.time} />
        <span className="flex items-center gap-2 text-xs text-[var(--tfmc-stone)]">
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${login ? "bg-[var(--tfmc-accent)]" : "bg-[var(--tfmc-stone)]"}`}
          />
          {capital(entry.verb)}
          {entry.rolled_back ? <Rollback text={entry.rolled_back} /> : null}
        </span>
      </li>
    );
  }

  const extra = identity(entry);
  const expandable = count > 1 || extra.length > 0;
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)] gap-x-3 py-2.5">
      <Clock at={entry.time} />
      <div className="min-w-0">
        {entry.kind === "chat" ? (
          <p className="break-words border-l-2 border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] pl-2.5 text-[var(--tfmc-cream)]">
            <span className="sr-only">Said </span>
            {entry.channel ? <ChannelTag channel={entry.channel} inferred={entry.channel_inferred} /> : null}
            <span>{entry.message}</span>
            {entry.truncated ? <span className="text-[var(--tfmc-stone)]"> (cut short)</span> : null}
          </p>
        ) : (
          <p className="break-words text-[var(--tfmc-mist)]">
            <Sentence entry={entry} count={count} />
            {entry.truncated ? <span className="text-[var(--tfmc-stone)]"> (cut short)</span> : null}
            {entry.rolled_back ? <Rollback text={entry.rolled_back} /> : null}
          </p>
        )}
        <p className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs text-[var(--tfmc-stone)]">
          {where ? (
            <span>
              {where}
              {count === 1 ? <span className="tabular-nums"> · {coords(entry)}</span> : null}
            </span>
          ) : null}
          {expandable ? (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="rounded-sm text-[var(--tfmc-mist)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--tfmc-accent)]"
            >
              {where ? "· " : ""}
              {count > 1 ? `${count} places` : "Details"} <span aria-hidden="true">{open ? "▴" : "▾"}</span>
            </button>
          ) : null}
        </p>
        {open ? (
          <ul className="mt-1.5 space-y-0.5 border-l border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] pl-2.5 text-xs text-[var(--tfmc-stone)]">
            {extra.map((line) => (
              <li key={line} className="break-all">
                {line}
              </li>
            ))}
            {count > 1
              ? row.entries.map((one) => (
                  <li key={one.id} className="tabular-nums">
                    {formatClock(one.time, true)} · {coords(one)}
                  </li>
                ))
              : null}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function Rollback({ text }: { text: string }) {
  return (
    <span className="ml-1.5 inline-block rounded-full bg-[color-mix(in_srgb,#e8c48a_16%,transparent)] px-1.5 align-[1px] text-[10px] font-medium text-[#e8c48a]">
      {text}
    </span>
  );
}

export default function PlayerActivity({ uuid }: { uuid: string }) {
  const [kinds, setKinds] = useState<string[]>([]);
  // Until the server says which kinds this viewer may filter by, offer only the ones everyone may.
  const [available, setAvailable] = useState<string[]>(Object.keys(KIND_LABELS).filter((kind) => kind !== "chat"));
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [searchedTo, setSearchedTo] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "more">("loading");
  const [failure, setFailure] = useState<Failure | null>(null);
  const [showsMessages, setShowsMessages] = useState(false);
  const [names, setNames] = useState<WorldNames>({});
  const request = useRef(0);
  const strip = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [hold, setHold] = useState<number | null>(null);

  const fetchPage = useCallback(
    async (before: string | null) => {
      const id = ++request.current;
      setState(before ? "more" : "loading");
      setFailure(null);
      try {
        const page = await getPlayerActivity(uuid, { before, kinds: kinds.length ? kinds : undefined });
        if (id !== request.current) return;
        if (page.kinds.length) setAvailable(page.kinds);
        setShowsMessages(page.shows_messages);
        setNames({ serverLabel: page.coreprotect.server_label, mapWorld: page.coreprotect.map_world });
        const notice = coreProtectMessage(page.coreprotect);
        if (notice) {
          setFailure({ message: notice, before });
          return;
        }
        setEntries((old) => (before ? [...old, ...page.entries] : page.entries));
        setNext(page.next);
        setSearchedTo(page.searched_to);
      } catch (err) {
        if (id === request.current) setFailure({ message: adminErrorMessage(err), before });
      } finally {
        if (id === request.current) setState("ready");
      }
    },
    [uuid, kinds]
  );

  useEffect(() => {
    void fetchPage(null);
  }, [fetchPage]);

  function choose(next: string[]) {
    // The list is the bottom of the page: emptied, the page would shrink and the browser would
    // pull it up under the finger. Keep it as tall as the screen below the filters was showing.
    const bottom = strip.current?.getBoundingClientRect().bottom;
    if (bottom !== undefined && list.current) {
      setHold(Math.max(0, Math.min(list.current.offsetHeight, window.innerHeight - bottom)));
    }
    // The old filter's rows and cursor must not be paged into the new one.
    setNext(null);
    setSearchedTo(null);
    setEntries([]);
    setFailure(null);
    setKinds(next);
  }

  function toggle(kind: string) {
    choose(kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind]);
  }

  const chip = (active: boolean) =>
    `shrink-0 rounded-full border px-3 py-1 text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tfmc-accent)] ${
      active
        ? "border-[var(--tfmc-accent)] bg-[var(--tfmc-accent)] font-semibold text-[var(--tfmc-forest-deep)]"
        : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)] text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
    }`;

  const days = groupActivity(entries, Date.now() / 1000);
  const empty = kinds.length ? "No matching activity recorded." : "No activity recorded.";

  return (
    <section className={panelClass} aria-label="Recent activity">
      <h3 className={headingClass}>Recent activity</h3>
      <p className="mt-1 text-xs text-[var(--tfmc-stone)]">
        {showsMessages ? "Includes chat and full commands. Views are logged." : "Chat and command details are hidden."}
      </p>
      {/* One row that scrolls sideways on a phone; wraps where there is room. */}
      <div
        ref={strip}
        role="group"
        aria-label="Show"
        className="scroll-strip mt-3 flex gap-1.5 overflow-x-auto overscroll-x-contain py-1 sm:flex-wrap sm:overflow-visible"
      >
        <button type="button" aria-pressed={!kinds.length} className={chip(!kinds.length)} onClick={() => choose([])}>
          All
        </button>
        {available.map((kind) => (
          <button key={kind} type="button" aria-pressed={kinds.includes(kind)} className={chip(kinds.includes(kind))} onClick={() => toggle(kind)}>
            {KIND_LABELS[kind] ?? kind}
          </button>
        ))}
      </div>
      <div ref={list} style={hold ? { minHeight: hold } : undefined}>
        {kinds.length ? (
          <p className="mt-1 text-xs text-[var(--tfmc-stone)] sm:hidden">
            Showing {kinds.map((kind) => (KIND_LABELS[kind] ?? kind).toLowerCase()).join(", ")}
          </p>
        ) : null}
        {state === "loading" ? <p className={`mt-3 ${mutedClass}`}>Loading…</p> : null}
        {state !== "loading" && !entries.length && !failure ? (
          <p className={`mt-3 ${mutedClass}`}>{searchedTo ? "No matching activity in the period searched." : empty}</p>
        ) : null}
        {days.length ? (
          <div className="mt-4 space-y-4">
            {days.map((day) => (
              <div key={day.key}>
                <h4 className={dayHeadingClass}>{day.label}</h4>
                <ul aria-label={day.label} className={`mt-1 text-sm ${dividerClass}`}>
                  {day.rows.map((row) => (
                    <Row key={row.key} row={row} names={names} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : null}
        {searchedTo && next && !failure ? (
          <p className="mt-3 text-xs text-[var(--tfmc-stone)]">Searched back to {formatEpoch(searchedTo)}.</p>
        ) : null}
        {failure ? (
          <Retry failure={failure} busy={state !== "ready"} onRetry={() => void fetchPage(failure.before)} />
        ) : next ? (
          <button type="button" className={moreClass} disabled={state !== "ready"} onClick={() => void fetchPage(next)}>
            {state === "more" ? "Loading…" : searchedTo ? "Search further back" : "Load more"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
