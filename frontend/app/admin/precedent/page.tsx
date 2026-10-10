"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import AdminColumn from "@/app/components/admin/AdminColumn";
import { StaffGateMessage, gateKind, type GateKind } from "@/app/components/admin/StaffGate";
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

const inputClass =
  "w-full rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_22%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] px-3 py-2 text-sm text-[var(--tfmc-cream)] placeholder:text-[var(--tfmc-stone)] focus:border-[var(--tfmc-accent)] focus:outline-none";

export default function AdminPrecedentPage() {
  const [gate, setGate] = useState<GateKind | null>(null);
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

  if (gate) {
    return (
      <AdminColumn>
        <StaffGateMessage kind={gate} />
      </AdminColumn>
    );
  }

  return (
    <AdminColumn>
      <p className="mt-6 text-sm text-[var(--tfmc-mist)]">
        Every logged moderation case, as the Discord bot&rsquo;s /precedent searches them.
      </p>

      <div className="mt-8">
        <PrecedentSearchPanel />
      </div>

      <section className="mt-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]">
            All cases
          </h2>
          <button
            type="button"
            onClick={() => {
              setEditing(null);
              setSaveError(null);
              setModalOpen(true);
            }}
            className="rounded-sm bg-[var(--tfmc-moss)] px-3 py-2 text-sm text-[var(--tfmc-cream)] disabled:opacity-50"
          >
            Log case
          </button>
        </div>

        <div className="mt-3">
          <input
            className={inputClass}
            value={filter}
            placeholder="Filter loaded cases by text"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        {loadError ? (
          <p className="mt-3 text-xs text-[#e8a0a0]">{loadError}</p>
        ) : null}

        <div className="mt-4">
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
        </div>
      </section>

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
