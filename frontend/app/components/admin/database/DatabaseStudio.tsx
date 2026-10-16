"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { AccountApiError } from "@/lib/account/api";
import {
  browseTable,
  formatCount,
  getSchema,
  runQuery,
  type Browse,
  type DatabaseInfo,
  type QueryResult,
  type Table,
} from "@/lib/admin/database";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import { badgeClass, errorClass, mutedClass } from "../ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  PlayIcon,
  PlusIcon,
  QueryIcon,
  RefreshIcon,
  TableIcon,
  ViewIcon,
} from "./icons";
import ResultGrid from "./ResultGrid";
import SqlEditor, { type SqlEditorHandle } from "./SqlEditor";
import {
  editBadge,
  editRunButton,
  fieldClass,
  hairline,
  readBadge,
  runButton,
  sunken,
  surface,
  toolButton,
} from "./studioStyles";

type Outcome = { result?: QueryResult; error?: string; running?: boolean };
type QueryTab = Outcome & { id: string; kind: "query"; title: string; sql: string; mode: "read" | "edit" };
// A preview tab (italic) is reused by the next table opened with one click, as in VS Code;
// a double click, or paging, sorting or filtering in it, keeps it.
type TableTab = Outcome & { id: string; kind: "table"; title: string; browse: Browse; preview: boolean };
type Tab = QueryTab | TableTab;

const PAGE_SIZES = [50, 100, 250, 500];

const MESSAGES: Record<string, string> = {
  unknown_database: "This database isn’t available on this site.",
  unknown_table: "That table no longer exists. Refresh the table list.",
  unknown_column: "That column isn’t in this table.",
  empty_query: "Write a query first.",
  query_too_long: "That query is too long.",
  read_only_database: "This database is read-only.",
  database_unavailable: "The database can’t be reached right now.",
  forbidden: "Only the owner can use the database studio.",
};

function message(err: unknown): string {
  if (err instanceof AccountApiError) return MESSAGES[err.message] ?? err.message;
  return "The request failed. Try again.";
}

function storageKey(id: string) {
  return `tfmc-db-studio:${id}`;
}

function newQuery(n: number, sql = ""): QueryTab {
  return { id: `q${Date.now()}-${n}`, kind: "query", title: `Query ${n}`, sql, mode: "read" };
}

/** Saved query tabs for one database, without results. */
function loadQueries(id: string): QueryTab[] {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(id)) ?? "[]") as { title: string; sql: string }[];
    return saved.map((q, i) => ({ ...newQuery(i + 1, q.sql), title: q.title }));
  } catch {
    return [];
  }
}

function quoteName(name: string) {
  return `"${name.replace(/"/g, '""')}"`;
}

export default function DatabaseStudio({ id }: { id: string }) {
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [tables, setTables] = useState<Table[] | null>(null);
  const [gate, setGate] = useState<GateKind | null>(null);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editorHeight, setEditorHeight] = useState(240);
  const editor = useRef<SqlEditorHandle>(null);
  const counter = useRef(1);
  const tableIds = useRef(1);

  const loadSchema = useCallback(async () => {
    setRefreshing(true);
    try {
      const schema = await getSchema(id);
      setDatabase(schema.database);
      setTables(schema.tables);
      setSchemaError(null);
      setGate(null);
    } catch (err) {
      const kind = gateKind(err);
      if (kind === "error") setSchemaError(message(err));
      else setGate(kind);
    } finally {
      setRefreshing(false);
    }
  }, [id]);

  useEffect(() => {
    void loadSchema();
    const saved = loadQueries(id);
    const first = saved.length ? saved : [newQuery(1)];
    counter.current = first.length + 1;
    setTabs(first);
    setActive(first[0].id);
  }, [id, loadSchema]);

  // Query tabs survive a reload; results do not.
  useEffect(() => {
    if (!tabs.length) return;
    const queries = tabs.filter((t): t is QueryTab => t.kind === "query").map((t) => ({ title: t.title, sql: t.sql }));
    localStorage.setItem(storageKey(id), JSON.stringify(queries));
  }, [id, tabs]);

  const update = useCallback((tabId: string, change: Partial<Tab>) => {
    setTabs((all) => all.map((t) => (t.id === tabId ? ({ ...t, ...change } as Tab) : t)));
  }, []);

  const current = tabs.find((t) => t.id === active) ?? null;
  const types = useMemo(() => {
    if (current?.kind !== "table" || !tables) return undefined;
    const table = tables.find((t) => t.name === current.browse.table);
    return table ? Object.fromEntries(table.columns.map((c) => [c.name, c.type])) : undefined;
  }, [current, tables]);

  const shownTables = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!tables || !needle) return tables ?? [];
    return tables.filter(
      (t) => t.name.toLowerCase().includes(needle) || t.columns.some((c) => c.name.toLowerCase().includes(needle)),
    );
  }, [tables, search]);

  async function execute(tab: QueryTab, write: boolean) {
    update(tab.id, { running: true, error: undefined });
    try {
      const result = await runQuery(id, tab.sql, write);
      update(tab.id, { result, running: false });
      if (write) void loadSchema();
    } catch (err) {
      update(tab.id, { error: message(err), running: false, result: undefined });
    }
  }

  async function load(tab: TableTab, browse: Browse, keep = true) {
    update(tab.id, { browse, running: true, error: undefined, ...(keep ? { preview: false } : {}) } as Partial<Tab>);
    try {
      update(tab.id, { result: await browseTable(id, browse), running: false });
    } catch (err) {
      update(tab.id, { error: message(err), running: false });
    }
  }

  function run(tab: QueryTab) {
    if (!tab.sql.trim() || tab.running) return;
    if (tab.mode === "edit") setConfirming(tab.id);
    else void execute(tab, false);
  }

  function openTable(name: string, keep = false) {
    const existing = tabs.find((t): t is TableTab => t.kind === "table" && t.browse.table === name);
    if (existing) {
      if (keep && existing.preview) update(existing.id, { preview: false });
      return setActive(existing.id);
    }
    const tab: TableTab = {
      id: `t${tableIds.current++}`,
      kind: "table",
      title: name,
      preview: !keep,
      browse: { table: name, offset: 0, limit: 100, order: null, descending: false, where: "" },
    };
    const reused = tabs.find((t) => t.kind === "table" && t.preview);
    setTabs((all) => (reused ? all.map((t) => (t.id === reused.id ? tab : t)) : [...all, tab]));
    setActive(tab.id);
    void load(tab, tab.browse, false);
  }

  function addQuery(sql = "") {
    const tab = newQuery(counter.current++, sql);
    setTabs((all) => [...all, tab]);
    setActive(tab.id);
  }

  function close(tabId: string) {
    const index = tabs.findIndex((t) => t.id === tabId);
    const others = tabs.filter((t) => t.id !== tabId);
    const remaining = others.length ? others : [newQuery(counter.current++)];
    setTabs(remaining);
    if (active === tabId) setActive(remaining[Math.max(0, index - 1)].id);
  }

  function startResize(e: ReactPointerEvent<HTMLDivElement>) {
    const startY = e.clientY;
    const startHeight = editorHeight;
    const move = (ev: PointerEvent) => setEditorHeight(Math.min(600, Math.max(120, startHeight + ev.clientY - startY)));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }

  if (gate === "forbidden")
    return <p className="mt-6 text-[var(--tfmc-mist)]">The database studio is for the owner.</p>;
  if (gate) return <StaffGateMessage kind={gate} />;

  const confirmTab = tabs.find((t): t is QueryTab => t.id === confirming && t.kind === "query");

  return (
    <div className="mt-4 flex flex-col">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/database" className="text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]">
          Databases
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-[var(--tfmc-mist)]" />
        <span className="font-semibold text-[var(--tfmc-cream)]">{database?.name ?? id}</span>
        {database ? (
          <span className={`${badgeClass} ${database.writable ? editBadge : readBadge}`}>
            {database.writable ? "Read & edit" : "Read only"}
          </span>
        ) : null}
      </nav>

      <div
        className={`mt-3 grid min-h-[34rem] overflow-hidden rounded-md border ${hairline} ${surface} lg:h-[calc(100dvh-var(--tfmc-header-h)-69px-6.5rem)] lg:grid-cols-[17rem_minmax(0,1fr)]`}
      >
        {/* Tables */}
        <aside
          className={`flex max-h-80 min-h-0 flex-col border-b ${hairline} lg:max-h-none lg:border-b-0 lg:border-r`}
        >
          <div className="flex gap-1.5 p-2">
            <input
              type="search"
              aria-label="Search tables and columns"
              placeholder="Search…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${fieldClass} min-w-0 flex-1 font-sans`}
            />
            <button
              type="button"
              className={toolButton}
              onClick={() => void loadSchema()}
              disabled={refreshing}
              aria-label="Refresh tables"
              title="Refresh tables"
            >
              <RefreshIcon className={refreshing ? "h-3.5 w-3.5 motion-safe:animate-spin" : "h-3.5 w-3.5"} />
            </button>
            <button type="button" className={toolButton} onClick={() => addQuery()} title="New query">
              <PlusIcon /> New
            </button>
          </div>
          {schemaError ? <p className={`px-3 pb-2 ${errorClass}`}>{schemaError}</p> : null}
          <ul className="min-h-0 flex-1 overflow-y-auto pb-2 text-[13px]" aria-label="Tables">
            {tables === null && !schemaError ? <li className={`px-3 py-2 ${mutedClass}`}>Loading tables…</li> : null}
            {shownTables.map((table) => {
              const expanded = open.has(table.name) || (search.trim() !== "" && !table.name.includes(search.trim()));
              return (
                <li key={table.name}>
                  <div className="group flex items-center pr-2 hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_5%,transparent)]">
                    <button
                      type="button"
                      aria-label={`${expanded ? "Hide" : "Show"} columns of ${table.name}`}
                      aria-expanded={expanded}
                      onClick={() =>
                        setOpen((s) => {
                          const next = new Set(s);
                          if (next.has(table.name)) next.delete(table.name);
                          else next.add(table.name);
                          return next;
                        })
                      }
                      className="grid h-7 w-7 shrink-0 place-items-center text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
                    >
                      <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
                    </button>
                    <button
                      type="button"
                      onClick={() => openTable(table.name)}
                      onDoubleClick={() => openTable(table.name, true)}
                      title="Click to preview, double-click to keep open"
                      className={`flex min-w-0 flex-1 items-center gap-2 py-1 text-left ${
                        current?.kind === "table" && current.browse.table === table.name
                          ? "text-[var(--tfmc-accent)]"
                          : "text-[var(--tfmc-cream)]"
                      }`}
                    >
                      {table.kind === "view" ? (
                        <ViewIcon className="h-3.5 w-3.5 text-[var(--tfmc-mist)]" />
                      ) : (
                        <TableIcon className="h-3.5 w-3.5 text-[var(--tfmc-mist)]" />
                      )}
                      <span className="truncate">{table.name}</span>
                    </button>
                    <span
                      className="ml-2 shrink-0 font-mono text-[10px] text-[var(--tfmc-mist)]"
                      title="Approximate rows"
                    >
                      {formatCount(table.rows)}
                    </span>
                  </div>
                  {expanded ? (
                    <ul className="pb-1 pl-9 pr-2">
                      {table.columns.map((column) => (
                        <li key={column.name}>
                          <button
                            type="button"
                            title={current?.kind === "query" ? "Insert into the query" : undefined}
                            onClick={() => current?.kind === "query" && editor.current?.insert(quoteName(column.name))}
                            className="flex w-full items-center gap-2 py-0.5 text-left text-xs text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)]"
                          >
                            <span className="truncate font-mono">{column.name}</span>
                            {column.pk ? (
                              <span className="text-[9px] font-semibold uppercase text-[var(--tfmc-accent)]">pk</span>
                            ) : null}
                            <span className="ml-auto shrink-0 font-mono text-[10px] lowercase text-[var(--tfmc-mist)]">
                              {column.type}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
            {tables && shownTables.length === 0 ? (
              <li className={`px-3 py-2 ${mutedClass}`}>No tables match.</li>
            ) : null}
          </ul>
        </aside>

        {/* Tabs and the active tab */}
        <section className="flex min-h-[30rem] min-w-0 flex-col">
          <div
            role="tablist"
            aria-label="Open queries and tables"
            className={`flex overflow-x-auto border-b ${hairline}`}
          >
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className={`group flex shrink-0 items-center border-r ${hairline} ${
                  tab.id === active ? `${sunken} text-[var(--tfmc-cream)]` : "text-[var(--tfmc-stone)]"
                }`}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab.id === active}
                  onClick={() => setActive(tab.id)}
                  onDoubleClick={() => tab.kind === "table" && tab.preview && update(tab.id, { preview: false })}
                  title={tab.kind === "table" && tab.preview ? "Preview: double-click to keep open" : undefined}
                  className={`flex items-center gap-2 py-2 pl-3 pr-1 text-xs font-semibold ${
                    tab.id === active ? "shadow-[inset_0_2px_0_var(--tfmc-accent)]" : "hover:text-[var(--tfmc-cream)]"
                  }`}
                >
                  {tab.kind === "table" ? (
                    <TableIcon className="h-3.5 w-3.5 text-[var(--tfmc-mist)]" />
                  ) : (
                    <QueryIcon className="h-3.5 w-3.5 text-[var(--tfmc-mist)]" />
                  )}
                  <span
                    className={`max-w-[12rem] truncate ${tab.kind === "table" && tab.preview ? "pr-0.5 italic font-normal" : ""}`}
                  >
                    {tab.title}
                  </span>
                  {tab.running ? (
                    <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--tfmc-accent)]" />
                  ) : null}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => close(tab.id)}
                  className="grid h-full place-items-center px-2 text-[var(--tfmc-mist)] opacity-60 hover:text-[var(--tfmc-cream)] hover:opacity-100"
                >
                  <CloseIcon className="h-3 w-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => addQuery()}
              className="flex shrink-0 items-center gap-1 px-3 text-xs text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
            >
              <PlusIcon className="h-3 w-3" /> New
            </button>
          </div>

          {current?.kind === "query" ? (
            <>
              <div style={{ height: editorHeight }} className={`flex shrink-0 flex-col ${sunken}`}>
                <SqlEditor
                  ref={editor}
                  label={`${current.title} SQL`}
                  value={current.sql}
                  onChange={(sql) => update(current.id, { sql })}
                  onRun={() => run(current)}
                  footer={
                    <div className="ml-auto flex items-center gap-2">
                      {database?.writable ? (
                        <div
                          role="radiogroup"
                          aria-label="Query mode"
                          className={`flex rounded-sm border ${hairline} p-0.5`}
                        >
                          {(["read", "edit"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              role="radio"
                              aria-checked={current.mode === mode}
                              onClick={() => update(current.id, { mode })}
                              className={`rounded-[2px] px-2.5 py-1 text-xs font-semibold ${
                                current.mode === mode
                                  ? mode === "edit"
                                    ? "bg-[#5a2a2a] text-[#f0c0c0]"
                                    : "bg-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] text-[var(--tfmc-cream)]"
                                  : "text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]"
                              }`}
                            >
                              {mode === "read" ? "Read" : "Edit"}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <span className="hidden text-[11px] text-[var(--tfmc-mist)] sm:inline">Ctrl + Enter</span>
                      <button
                        type="button"
                        className={current.mode === "edit" ? editRunButton : runButton}
                        disabled={!current.sql.trim() || current.running}
                        onClick={() => run(current)}
                      >
                        <PlayIcon />
                        {current.running ? "Running…" : current.mode === "edit" ? "Run edit" : "Run"}
                      </button>
                    </div>
                  }
                />
              </div>
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize the editor"
                onPointerDown={startResize}
                className={`h-1.5 shrink-0 cursor-row-resize border-y ${hairline} hover:bg-[color-mix(in_srgb,var(--tfmc-accent)_40%,transparent)]`}
              />
              <TabResult tab={current} fileName={current.title} />
            </>
          ) : current?.kind === "table" ? (
            <TablePane
              tab={current}
              types={types}
              onBrowse={(browse) => void load(current, browse)}
              onOpenAsQuery={(sql) => addQuery(sql)}
            />
          ) : null}
        </section>
      </div>

      {confirmTab ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="db-edit-title"
            className={`w-full max-w-xl rounded-md border ${hairline} bg-[var(--tfmc-forest-deep)] p-5`}
          >
            <h2 id="db-edit-title" className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
              Change data in {database?.name}?
            </h2>
            <p className={`mt-1 ${mutedClass}`}>This edit runs straight away and is written to the audit log.</p>
            <pre
              className={`mt-3 max-h-60 overflow-auto rounded-sm border ${hairline} ${sunken} p-3 font-mono text-xs text-[var(--tfmc-cream)]`}
            >
              {confirmTab.sql}
            </pre>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={toolButton} onClick={() => setConfirming(null)} autoFocus>
                Cancel
              </button>
              <button
                type="button"
                className={editRunButton}
                onClick={() => {
                  setConfirming(null);
                  void execute(confirmTab, true);
                }}
              >
                Run edit
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabResult({
  tab,
  types,
  fileName,
  serverSort,
  firstRow,
}: {
  tab: Outcome;
  types?: Record<string, string>;
  fileName: string;
  serverSort?: Parameters<typeof ResultGrid>[0]["serverSort"];
  firstRow?: number;
}) {
  if (tab.error)
    return (
      <div className="p-3">
        <p
          role="alert"
          className="whitespace-pre-wrap rounded-sm border border-[#7a3a3a] bg-[#3a1f1f] p-3 font-mono text-xs text-[#f0c0c0]"
        >
          {tab.error}
        </p>
      </div>
    );
  if (tab.result)
    return (
      <ResultGrid result={tab.result} types={types} fileName={fileName} serverSort={serverSort} firstRow={firstRow} />
    );
  return <p className={`p-4 ${mutedClass}`}>{tab.running ? "Running…" : "Run a query to see its results here."}</p>;
}

function TablePane({
  tab,
  types,
  onBrowse,
  onOpenAsQuery,
}: {
  tab: TableTab;
  types?: Record<string, string>;
  onBrowse: (browse: Browse) => void;
  onOpenAsQuery: (sql: string) => void;
}) {
  const { browse } = tab;
  const [where, setWhere] = useState(browse.where);
  const rows = tab.result?.rows.length ?? 0;
  const more = rows === browse.limit;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={`flex flex-wrap items-center gap-2 border-b ${hairline} px-3 py-2`}>
        <form
          className="flex min-w-[14rem] flex-1 items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            onBrowse({ ...browse, where, offset: 0 });
          }}
        >
          <span className="font-mono text-xs text-[var(--tfmc-mist)]">WHERE</span>
          <input
            aria-label="Filter rows"
            placeholder="user = 3 AND time > 1760000000"
            value={where}
            onChange={(e) => setWhere(e.target.value)}
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button type="submit" className={toolButton}>
            Apply
          </button>
        </form>
        <label className="flex items-center gap-1.5 text-xs text-[var(--tfmc-mist)]">
          Rows
          <select
            value={browse.limit}
            onChange={(e) => onBrowse({ ...browse, limit: Number(e.target.value), offset: 0 })}
            className={`${fieldClass} font-sans`}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={toolButton}
            aria-label="Previous page"
            disabled={browse.offset === 0 || tab.running}
            onClick={() => onBrowse({ ...browse, offset: Math.max(0, browse.offset - browse.limit) })}
          >
            <ChevronLeftIcon />
          </button>
          <span className="min-w-[7rem] text-center font-mono text-xs text-[var(--tfmc-stone)]">
            {rows ? `${(browse.offset + 1).toLocaleString()}–${(browse.offset + rows).toLocaleString()}` : "—"}
          </span>
          <button
            type="button"
            className={toolButton}
            aria-label="Next page"
            disabled={!more || tab.running}
            onClick={() => onBrowse({ ...browse, offset: browse.offset + browse.limit })}
          >
            <ChevronRightIcon />
          </button>
        </div>
        {tab.result?.sql ? (
          <button type="button" className={toolButton} onClick={() => onOpenAsQuery(tab.result!.sql!)}>
            Open as query
          </button>
        ) : null}
      </div>
      {tab.result?.sql ? (
        <p
          className={`truncate border-b ${hairline} px-3 py-1.5 font-mono text-[11px] text-[var(--tfmc-mist)]`}
          title={tab.result.sql}
        >
          {tab.result.sql}
        </p>
      ) : null}
      <TabResult
        tab={tab}
        types={types}
        fileName={browse.table}
        firstRow={browse.offset + 1}
        serverSort={{
          order: browse.order,
          descending: browse.descending,
          onSort: (column) =>
            onBrowse({
              ...browse,
              offset: 0,
              order: browse.order === column && browse.descending ? null : column,
              descending: browse.order === column ? !browse.descending : false,
            }),
        }}
      />
    </div>
  );
}
