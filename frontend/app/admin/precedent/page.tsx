"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminColumn from "@/app/components/admin/AdminColumn";
import { StaffGateMessage, gateKind, type GateKind } from "@/app/components/admin/StaffGate";
import { buttonClass, errorClass, headingClass, inputClass, mutedClass, panelClass } from "@/app/components/admin/ui";
import ConfirmDeleteDialog from "@/app/components/precedent/ConfirmDeleteDialog";
import PrecedentCaseModal from "@/app/components/precedent/PrecedentCaseModal";
import PrecedentSearchPanel from "@/app/components/precedent/PrecedentSearchPanel";
import PrecedentTable from "@/app/components/precedent/PrecedentTable";
import { adminErrorMessage } from "@/lib/admin/api";
import {
  createCase,
  deleteCase,
  listCases,
  updateCase,
  type CaseInput,
  type PrecedentCase,
} from "@/lib/precedent/api";
import { filterCases } from "@/lib/precedent/filter";
import { collectKnownPlayers } from "@/lib/precedent/playerSuggest";

export default function AdminPrecedentPage() {
  // Nothing renders until the first list proves access.
  const [gate, setGate] = useState<GateKind | "checking" | "ready">("checking");
  const [cases, setCases] = useState<PrecedentCase[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PrecedentCase | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<PrecedentCase | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listCases();
      setCases(data.cases);
      setTotal(data.total);
      setGate("ready");
    } catch (err) {
      const kind = gateKind(err);
      if (kind === "error") setLoadError(adminErrorMessage(err));
      else setGate(kind);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const visible = useMemo(() => filterCases(cases, filter), [cases, filter]);
  // Autocomplete source: every name already in the corpus. Derived from the
  // rows we have loaded, so it costs no extra request.
  const knownPlayers = useMemo(() => collectKnownPlayers(cases), [cases]);

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
      await reload();
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
      await reload();
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
            <p className={`mt-6 ${errorClass}`} role="alert">{loadError}</p>
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

        <section className={`${panelClass} lg:col-start-1 lg:row-start-1`} aria-label="Cases">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className={headingClass}>
              Cases
              {total ? <span className="ml-2 font-sans text-sm text-[var(--tfmc-stone)]">{total.toLocaleString()}</span> : null}
            </h2>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setSaveError(null);
                setModalOpen(true);
              }}
              className={buttonClass}
            >
              Log case
            </button>
          </div>
          <p className={`mt-1 ${mutedClass}`}>Every logged moderation case, newest first.</p>

          <label className="sr-only" htmlFor="precedent-filter">
            Filter cases
          </label>
          <input
            id="precedent-filter"
            className={`${inputClass} mt-3 w-full`}
            value={filter}
            placeholder="Filter by text, rule or player"
            autoComplete="off"
            onChange={(e) => setFilter(e.target.value)}
          />

          {loadError ? (
            <p className={`mt-3 ${errorClass}`} role="alert">
              {loadError}
            </p>
          ) : null}

          <PrecedentTable
            cases={visible}
            total={total}
            loading={loading}
            onEdit={(row) => {
              setEditing(row);
              setSaveError(null);
              setModalOpen(true);
            }}
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
