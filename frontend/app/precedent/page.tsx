"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import ConfirmDeleteDialog from "@/app/components/precedent/ConfirmDeleteDialog";
import PrecedentCaseModal from "@/app/components/precedent/PrecedentCaseModal";
import PrecedentSearchPanel from "@/app/components/precedent/PrecedentSearchPanel";
import PrecedentTable from "@/app/components/precedent/PrecedentTable";
import { useSiteStaffAccess } from "@/app/hooks/useSiteStaffAccess";
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

export default function PrecedentPage() {
  const router = useRouter();
  const { state } = useSiteStaffAccess({ enabled: true });

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

  useEffect(() => {
    if (state === "unauthenticated" || state === "denied") {
      router.replace("/");
    }
  }, [state, router]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await listCases();
      setCases(data.cases);
      setTotal(data.total);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Could not load precedent cases"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (state !== "staff") return;
    void reload();
  }, [state, reload]);

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
      setSaveError(err instanceof Error ? err.message : "Could not save the case");
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
      setDeleteError(
        err instanceof Error ? err.message : "Could not delete the case"
      );
    } finally {
      setDeleting(false);
    }
  }

  if (state === "loading") {
    return (
      <main className="mx-auto w-full max-w-md px-6 py-10">
        <p className="text-sm text-[var(--tfmc-mist)]">Checking access…</p>
      </main>
    );
  }

  if (state !== "staff") {
    return null;
  }

  return (
    <main className="relative mx-auto w-full max-w-5xl px-6 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-80"
        style={{
          background:
            "radial-gradient(ellipse 70% 50% at 50% 0%, color-mix(in srgb, var(--tfmc-moss) 35%, transparent), transparent 65%)",
        }}
      />

      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)] sm:text-4xl">
        Precedent
      </h1>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Every logged moderation case.
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
    </main>
  );
}
