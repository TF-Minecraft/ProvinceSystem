"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import AdminColumn from "@/app/components/admin/AdminColumn";
import { StaffGateMessage, gateKind, type GateKind } from "@/app/components/admin/StaffGate";
import {
  buttonClass,
  errorClass,
  headingClass,
  inputClass,
  mutedClass,
  panelClass,
  quietButtonClass,
} from "@/app/components/admin/ui";
import ConfirmDeleteDialog from "@/app/components/precedent/ConfirmDeleteDialog";
import PrecedentCaseModal from "@/app/components/precedent/PrecedentCaseModal";
import PrecedentSearchPanel from "@/app/components/precedent/PrecedentSearchPanel";
import PrecedentTable from "@/app/components/precedent/PrecedentTable";
import { adminErrorMessage } from "@/lib/admin/api";
import {
  createCase,
  deleteCase,
  listCases,
  listKnownPlayers,
  updateCase,
  type CaseInput,
  type PrecedentCase,
} from "@/lib/precedent/api";

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 250;

type Shown = { cases: PrecedentCase[]; total: number; search: string; page: number };

/** A failed load, with a retry: a failed page turn leaves nothing else to click. */
function LoadFailed({ message, onRetry, className }: { message: string; onRetry: () => void; className: string }) {
  return (
    <p className={`${className} ${errorClass}`} role="alert">
      {message}{" "}
      <button type="button" className={quietButtonClass} onClick={onRetry}>
        Try again
      </button>
    </p>
  );
}

export default function AdminPrecedentPage() {
  // Nothing renders until the first list proves access.
  const [gate, setGate] = useState<GateKind | "checking" | "ready">("checking");
  // The page on screen, kept with the search and page it answers so the count never mixes two searches.
  const [shown, setShown] = useState<Shown>({ cases: [], total: 0, search: "", page: 1 });
  const [loadError, setLoadError] = useState<string | null>(null);
  // `filter` follows the box; `search` follows it after a pause and drives the request.
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [reloads, setReloads] = useState(0);
  // Loading until the request for the current search, page and reload has answered.
  const wanted = `${search}\n${page}\n${reloads}`;
  const [answered, setAnswered] = useState<string | null>(null);
  const loading = answered !== wanted;
  const request = useRef(0);
  const casesRef = useRef<HTMLElement>(null);

  // Autocomplete source: every name already in the corpus, fetched when the form first opens.
  const [knownPlayers, setKnownPlayers] = useState<string[]>([]);
  const playersFetched = useRef(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PrecedentCase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PrecedentCase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      const next = filter.trim();
      if (next === search) return;
      // One render, so a new search fetches its first page once. The reload count makes it a
      // fresh request even when it returns to a search whose answer is already on record.
      setSearch(next);
      setPage(1);
      setReloads((n) => n + 1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [filter, search]);

  // The server pages and searches every case; this page only ever holds one page of them.
  useEffect(() => {
    const id = ++request.current;
    const key = `${search}\n${page}\n${reloads}`;
    listCases({ query: search, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE })
      .then((data) => {
        if (id !== request.current) return;
        const last = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        // A delete can empty the last page; step back to the new last one.
        if (page > last) {
          setPage(last);
          setReloads((n) => n + 1);
          return;
        }
        setShown({ cases: data.cases, total: data.total, search, page });
        setLoadError(null);
        setGate("ready");
        setAnswered(key);
      })
      .catch((err) => {
        if (id !== request.current) return;
        const kind = gateKind(err);
        if (kind === "error") setLoadError(adminErrorMessage(err));
        else setGate(kind);
        setAnswered(key);
      });
  }, [search, page, reloads]);

  const reload = useCallback(() => setReloads((n) => n + 1), []);

  const loadKnownPlayers = useCallback(() => {
    playersFetched.current = true;
    listKnownPlayers()
      .then((data) => setKnownPlayers(data.players))
      // Suggestions are a convenience; the form works without them.
      .catch(() => {
        playersFetched.current = false;
      });
  }, []);

  function openModal(row: PrecedentCase | null) {
    setEditing(row);
    setSaveError(null);
    setModalOpen(true);
    if (!playersFetched.current) loadKnownPlayers();
  }

  function goToPage(next: number) {
    // After a failed turn the page asked for is already `page`; ask for it again.
    if (next === page) reload();
    else setPage(next);
    // The pager sits under the list, so bring the top of the new page into view.
    const top = casesRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) casesRef.current?.scrollIntoView({ block: "start" });
  }

  async function handleSave(input: CaseInput) {
    setSaving(true);
    setSaveError(null);
    try {
      if (editing) {
        await updateCase(editing.id, input);
      } else {
        await createCase(input);
      }
      setModalOpen(false);
      setEditing(null);
      reload();
      loadKnownPlayers();
    } catch (err) {
      setSaveError(adminErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteCase(deleteTarget.id);
      setDeleteTarget(null);
      reload();
    } catch (err) {
      setDeleteError(adminErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  }

  if (gate !== "ready") {
    return (
      <AdminColumn>
        {gate === "checking" ? (
          loadError ? (
            <LoadFailed message={loadError} onRetry={reload} className="mt-6" />
          ) : (
            <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>
          )
        ) : (
          <StaffGateMessage kind={gate} />
        )}
      </AdminColumn>
    );
  }

  return (
    <AdminColumn>
      {/* The cases beside the search on wide screens, as Accounts lays out its roster; the search comes first on phones. */}
      <div className="grid gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <PrecedentSearchPanel className="lg:col-start-2 lg:row-start-1" />

        <section
          ref={casesRef}
          // Clear of the pinned site header and staff tabs when a new page scrolls it into view.
          className={`${panelClass} scroll-mt-[calc(var(--tfmc-sticky-top)+5rem)] lg:col-start-1 lg:row-start-1`}
          aria-label="Cases"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={headingClass}>
              Cases
              {shown.total && !shown.search ? (
                <span className="ml-2 font-sans text-sm text-[var(--tfmc-stone)]">{shown.total.toLocaleString()}</span>
              ) : null}
            </h2>
            <button type="button" onClick={() => openModal(null)} className={buttonClass}>
              Log case
            </button>
          </div>
          <p className={`mt-1 ${mutedClass}`}>Every logged moderation case, newest first.</p>

          <label className="sr-only" htmlFor="precedent-filter">
            Search cases
          </label>
          <input
            id="precedent-filter"
            type="search"
            className={`${inputClass} mt-3 w-full`}
            value={filter}
            placeholder="Search every case by text, rule or player"
            maxLength={200}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setFilter(e.target.value)}
          />

          {loadError ? <LoadFailed message={loadError} onRetry={reload} className="mt-3" /> : null}

          <PrecedentTable
            cases={shown.cases}
            total={shown.total}
            searching={shown.search !== ""}
            loading={loading}
            page={shown.page}
            pages={Math.max(1, Math.ceil(shown.total / PAGE_SIZE))}
            onPage={goToPage}
            onEdit={(row) => openModal(row)}
            onDelete={(row) => {
              setDeleteTarget(row);
              setDeleteError(null);
            }}
          />
        </section>
      </div>

      <PrecedentCaseModal
        open={modalOpen}
        initial={editing}
        knownPlayers={knownPlayers}
        saving={saving}
        error={saveError}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onSave={(input) => void handleSave(input)}
      />

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        summary={deleteTarget?.summary ?? ""}
        deleting={deleting}
        error={deleteError}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </AdminColumn>
  );
}
