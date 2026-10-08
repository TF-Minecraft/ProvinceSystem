"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { useCharacterSessionToken } from "../../hooks/useCharacterSessionToken";
import {
  MapAccessError,
  fetchMapApi,
  fetchMapJson,
  isAbortError,
  staffMapAccessReason,
} from "@/lib/map/api";
import MapAccessGate, { type MapAccessGateReason } from "../map/MapAccessGate";
import { mapDisplayName, type MapId } from "../map/types";
import { isArchivedMap } from "@/app/lib/map/archiveMaps";
import { invalidateAccessibleMaps, useAccessibleMaps } from "../../hooks/useAccessibleMaps";
import { chronicleStudioHref } from "../../lib/map/chronicleDayRoute";
import {
  CHRONICLE_WIPE_REASON_MAX_LENGTH,
  backupFileName,
  buildChronicleArchiveRequest,
  buildChronicleRestoreRequest,
  buildChronicleWipeRequest,
  canRestoreBackup,
  canSubmitChronicleArchive,
  canSubmitChronicleRestore,
  canSubmitChronicleWipe,
  chronicleArchivePath,
  chronicleBackupsPath,
  chronicleConfirmMatches,
  chronicleRestorePath,
  chronicleStaffFailure,
  chronicleWipePath,
  describeRestoreOutcome,
  describeRestoreState,
  formatDayCount,
  formatUnixSeconds,
  isNothingToWipe,
  type ChronicleArchiveResponse,
  type ChronicleBackupRow,
  type ChronicleBackupsResponse,
  type ChronicleRestoreResponse,
  type ChronicleStaffFailure,
  type ChronicleWipeResponse,
} from "../../lib/map/chronicleStaff";
import {
  SectionHeading,
  chroniclePanelClass,
  primaryButtonClass,
  quietButtonClass,
} from "./ChroniclePanels";

/**
 * `/map/{map}/chronicle/staff` — wipe, list backups, restore.
 *
 * Everything with a rule behind it (the confirmation predicate, the error-code
 * vocabulary, unix-seconds formatting) lives in `lib/map/chronicleStaff.ts` and
 * is tested there; this file is the shell that renders it, because vitest runs
 * node-env and cannot mount a component.
 *
 * The tone is deliberately flat. These two buttons move a live map's whole
 * history around, and the page should read like a form somebody has to mean.
 */

const inputClass =
  "w-full rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_45%,var(--tfmc-forest-deep))] px-2 py-1.5 text-sm text-[var(--tfmc-cream)] placeholder:text-[color-mix(in_srgb,var(--tfmc-stone)_70%,transparent)]";

const dangerButtonClass =
  "rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,#7f1d1d_70%,var(--tfmc-forest-deep))] px-3 py-2 text-sm font-medium text-[var(--tfmc-cream)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

const cellClass = "px-3 py-2 align-top text-sm text-[var(--tfmc-cream)]";
const headCellClass =
  "px-3 py-2 text-left text-xs font-medium uppercase tracking-widest text-[var(--tfmc-mist)]";

type StaffRequestFailure = {
  status: number;
  detail: string;
  code: string | null;
};

/**
 * The mutation routes answer errors as `{ok: false, code, detail}`, and the
 * `code` is the part that makes a message actionable — so these go through
 * `fetchMapApi` (which still carries the bearer header) rather than
 * `fetchMapJson`, whose `MapAccessError` keeps only the detail string.
 */
async function postStaffJson<T>(
  path: string,
  body: unknown,
  sessionToken: string
): Promise<T> {
  let res: Response;
  try {
    res = await fetchMapApi(path, {
      method: "POST",
      sessionToken,
      cache: "no-store",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof MapAccessError) {
      throw { status: err.status, detail: err.detail, code: null } as StaffRequestFailure;
    }
    throw err;
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (res.ok) return data as T;

  const record = (data ?? {}) as { code?: unknown; detail?: unknown };
  throw {
    status: res.status,
    detail: typeof record.detail === "string" ? record.detail : res.statusText,
    code: typeof record.code === "string" ? record.code : null,
  } as StaffRequestFailure;
}

function asFailure(
  err: unknown,
  action: "wipe" | "restore" | "load" | "archive"
): ChronicleStaffFailure {
  if (err instanceof MapAccessError) {
    return chronicleStaffFailure(err.status, err.detail, null, action);
  }
  if (err && typeof err === "object" && "status" in err) {
    const failure = err as StaffRequestFailure;
    return chronicleStaffFailure(failure.status, failure.detail, failure.code, action);
  }
  return chronicleStaffFailure(
    -1,
    err instanceof Error ? err.message : "The request failed.",
    null,
    action
  );
}

function FailureNotice({ failure }: { failure: ChronicleStaffFailure }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-[color-mix(in_srgb,#f87171_45%,transparent)] bg-[color-mix(in_srgb,#7f1d1d_30%,transparent)] px-3 py-2"
    >
      <p className="text-sm font-medium text-[var(--tfmc-cream)]">{failure.title}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--tfmc-stone)]">
        {failure.message}
      </p>
    </div>
  );
}

function Notice({ tone, children }: { tone: "ok" | "info"; children: ReactNode }) {
  const border =
    tone === "ok"
      ? "border-[color-mix(in_srgb,var(--tfmc-moss)_55%,transparent)]"
      : "border-[color-mix(in_srgb,var(--tfmc-cream)_20%,transparent)]";
  return (
    <div
      role="status"
      className={`rounded-md border ${border} bg-[color-mix(in_srgb,var(--tfmc-forest)_35%,transparent)] px-3 py-2 text-xs leading-relaxed text-[var(--tfmc-cream)]`}
    >
      {children}
    </div>
  );
}

export default function ChronicleStaffConsole({ mapId }: { mapId: MapId }) {
  const sessionToken = useCharacterSessionToken();
  const { maps } = useAccessibleMaps();
  const displayName = mapDisplayName(mapId, maps);

  // `useCharacterSessionToken` starts at null and fills in from an effect, so
  // "no token yet" and "signed out" look identical on the first paint. Without
  // this the page would flash the sign-in gate at every signed-in operator.
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => setSessionChecked(true), []);

  const [gateReason, setGateReason] = useState<MapAccessGateReason | null>(null);
  const [backups, setBackups] = useState<ChronicleBackupRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailure, setLoadFailure] = useState<ChronicleStaffFailure | null>(null);

  // Wipe form.
  const [wipeConfirm, setWipeConfirm] = useState("");
  const [wipeReason, setWipeReason] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const [wipeFailure, setWipeFailure] = useState<ChronicleStaffFailure | null>(null);
  const [wipeResult, setWipeResult] = useState<ChronicleWipeResponse | null>(null);

  const [archiveDest, setArchiveDest] = useState("");
  const [archiveName, setArchiveName] = useState("");
  const [archiveConfirm, setArchiveConfirm] = useState("");
  const [archiveReason, setArchiveReason] = useState("");
  const [archiveAllowUnknown, setArchiveAllowUnknown] = useState(false);
  const [archiveReplace, setArchiveReplace] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveFailure, setArchiveFailure] = useState<ChronicleStaffFailure | null>(
    null
  );
  const [archiveResult, setArchiveResult] = useState<ChronicleArchiveResponse | null>(
    null
  );

  // Restore form — one row at a time, opened from the table.
  const [restoreId, setRestoreId] = useState<number | null>(null);
  const [restoreConfirm, setRestoreConfirm] = useState("");
  const [restoreMerge, setRestoreMerge] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreFailure, setRestoreFailure] = useState<ChronicleStaffFailure | null>(
    null
  );
  const [restoreResult, setRestoreResult] = useState<ChronicleRestoreResponse | null>(
    null
  );

  const loadBackups = useCallback(async () => {
    if (!sessionToken) return;
    setLoading(true);
    setLoadFailure(null);
    try {
      const data = await fetchMapJson<ChronicleBackupsResponse>(
        chronicleBackupsPath(mapId),
        { sessionToken, cache: "no-store" }
      );
      setBackups(data.backups ?? []);
      setGateReason(null);
    } catch (err) {
      if (isAbortError(err)) return;
      if (err instanceof MapAccessError && err.status === 403) {
        // A 403 here is the whole answer for the page: render the gate rather
        // than an empty table with an error stuck to it.
        const reason = staffMapAccessReason(err);
        setGateReason(reason === "unknown" ? "permission" : reason);
        setBackups(null);
        return;
      }
      setLoadFailure(asFailure(err, "load"));
    } finally {
      setLoading(false);
    }
  }, [mapId, sessionToken]);

  useEffect(() => {
    if (sessionToken === null) return;
    void loadBackups();
  }, [loadBackups, sessionToken]);

  const wipeReady = canSubmitChronicleWipe(wipeConfirm, wipeReason, mapId);
  const archived = isArchivedMap(mapId, maps);
  const destExists = maps.some(
    (entry) => entry.id === archiveDest && entry.id !== mapId
  );
  const archiveReady = canSubmitChronicleArchive({
    destId: archiveDest,
    confirm: archiveConfirm,
    displayName: archiveName,
    reason: archiveReason,
    allowUnknown: archiveAllowUnknown,
    replace: archiveReplace,
    destExists,
  });

  useEffect(() => {
    const live = maps.find((entry) => entry.id === mapId);
    if (!live) return;
    setArchiveDest((current) => current || live.chapter_id || "");
    setArchiveName((current) => current || live.chapter_name || "");
  }, [mapId, maps]);

  const runWipe = useCallback(async () => {
    if (!sessionToken || !wipeReady || wipeBusy) return;
    setWipeBusy(true);
    setWipeFailure(null);
    setWipeResult(null);
    try {
      const result = await postStaffJson<ChronicleWipeResponse>(
        chronicleWipePath(mapId),
        buildChronicleWipeRequest(mapId, wipeReason),
        sessionToken
      );
      setWipeResult(result);
      // The typed confirmation is per-action: never carry it to the next one.
      setWipeConfirm("");
      setWipeReason("");
      await loadBackups();
    } catch (err) {
      setWipeFailure(asFailure(err, "wipe"));
    } finally {
      setWipeBusy(false);
    }
  }, [loadBackups, mapId, sessionToken, wipeBusy, wipeReady, wipeReason]);

  const runArchive = useCallback(async () => {
    if (!sessionToken || !archiveReady || archiveBusy || archived) return;
    setArchiveBusy(true);
    setArchiveFailure(null);
    setArchiveResult(null);
    try {
      const result = await postStaffJson<ChronicleArchiveResponse>(
        chronicleArchivePath(mapId),
        buildChronicleArchiveRequest({
          destId: archiveDest,
          displayName: archiveName,
          reason: archiveReason,
          replace: archiveReplace,
          allowUnknown: archiveAllowUnknown,
        }),
        sessionToken
      );
      invalidateAccessibleMaps();
      setArchiveResult(result);
      setArchiveConfirm("");
      setArchiveReason("");
      setArchiveReplace(false);
      setArchiveAllowUnknown(false);
    } catch (err) {
      setArchiveFailure(asFailure(err, "archive"));
    } finally {
      setArchiveBusy(false);
    }
  }, [
    archiveAllowUnknown,
    archiveBusy,
    archiveDest,
    archiveName,
    archiveReady,
    archiveReason,
    archiveReplace,
    archived,
    mapId,
    sessionToken,
  ]);

  const openRestore = useCallback(
    (row: ChronicleBackupRow) => {
      setRestoreId((current) => (current === row.id ? null : row.id));
      setRestoreConfirm("");
      setRestoreMerge(false);
      setRestoreFailure(null);
      setRestoreResult(null);
    },
    []
  );

  const runRestore = useCallback(
    async (row: ChronicleBackupRow) => {
      if (!sessionToken || restoreBusy) return;
      // Re-checks `canRestoreBackup(row)` as well as the typed confirmation:
      // only the button's `disabled` enforced the former, and a disabled
      // button is not a gate.
      if (!canSubmitChronicleRestore(row, restoreConfirm, mapId)) return;
      setRestoreBusy(true);
      setRestoreFailure(null);
      setRestoreResult(null);
      try {
        const result = await postStaffJson<ChronicleRestoreResponse>(
          chronicleRestorePath(mapId),
          buildChronicleRestoreRequest(mapId, row.id, restoreMerge),
          sessionToken
        );
        setRestoreResult(result);
        setRestoreConfirm("");
        setRestoreMerge(false);
        await loadBackups();
      } catch (err) {
        setRestoreFailure(asFailure(err, "restore"));
      } finally {
        setRestoreBusy(false);
      }
    },
    [loadBackups, mapId, restoreBusy, restoreConfirm, restoreMerge, sessionToken]
  );

  if (!sessionChecked) {
    return (
      <main className="min-h-[calc(100dvh-var(--tfmc-header-h))] bg-[var(--tfmc-forest-deep)] px-4 py-8" />
    );
  }
  if (!sessionToken) {
    return <MapAccessGate reason="login" mapDisplayName={displayName} />;
  }
  if (gateReason) {
    return <MapAccessGate reason={gateReason} mapDisplayName={displayName} />;
  }

  return (
    <main className="min-h-[calc(100dvh-var(--tfmc-header-h))] bg-[var(--tfmc-forest-deep)] px-4 py-8 sm:px-8">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <header>
          <p className="text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Staff operations · {displayName}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-fraunces)] text-2xl font-medium text-[var(--tfmc-cream)]">
            Chronicle wipe and restore
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[var(--tfmc-stone)]">
            A wipe moves days into a backup you can restore below. Both actions
            are logged against your profile with your reason.
          </p>
          <Link
            href={chronicleStudioHref(mapId)}
            className={`${quietButtonClass} mt-3 inline-flex`}
          >
            Back to the timelapse studio
          </Link>
        </header>

        {/* ------------------------------------------------------------- */}
        <section className={`${chroniclePanelClass} p-4`}>
          <SectionHeading title="Wipe this map's chronicle" />
          <p className="mt-2 text-sm leading-relaxed text-[var(--tfmc-stone)]">
            Type the map id <code className="text-[var(--tfmc-cream)]">{mapId}</code>{" "}
            exactly — no surrounding spaces, matching case — and give a reason.
          </p>

          <label className="mt-4 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Confirm map id
            <input
              className={`${inputClass} mt-1`}
              value={wipeConfirm}
              autoComplete="off"
              spellCheck={false}
              placeholder="type the map id"
              onChange={(event) => setWipeConfirm(event.target.value)}
            />
          </label>
          {wipeConfirm.length > 0 && !chronicleConfirmMatches(wipeConfirm, mapId) && (
            <p className="mt-1 text-xs text-[color-mix(in_srgb,#fca5a5_85%,transparent)]">
              Does not match “{mapId}” exactly.
            </p>
          )}

          <label className="mt-3 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Reason (required, up to {CHRONICLE_WIPE_REASON_MAX_LENGTH} characters)
            <textarea
              className={`${inputClass} mt-1 h-20 resize-y`}
              value={wipeReason}
              maxLength={CHRONICLE_WIPE_REASON_MAX_LENGTH}
              placeholder="why this map's chronicle is being set aside"
              onChange={(event) => setWipeReason(event.target.value)}
            />
          </label>

          <button
            type="button"
            className={`${dangerButtonClass} mt-3`}
            disabled={!wipeReady || wipeBusy}
            onClick={() => void runWipe()}
          >
            {wipeBusy ? "Wiping…" : `Wipe the ${mapId} chronicle`}
          </button>

          {wipeResult && (
            <div className="mt-3">
              {isNothingToWipe(wipeResult) ? (
                <Notice tone="info">
                  <span className="font-medium">Nothing to wipe.</span> This map
                  has no stored chronicle days, so nothing was moved and no
                  backup or audit row was written.
                </Notice>
              ) : (
                <Notice tone="ok">
                  <span className="font-medium">
                    Wiped {formatDayCount(wipeResult.day_count)}.
                  </span>{" "}
                  Backup #{wipeResult.wipe_id} taken at{" "}
                  {formatUnixSeconds(wipeResult.wiped_at)}
                  {/* A file name, not a path — the backend sends a basename
                      and `backupFileName` strips a directory if one ever
                      shows up, so this never echoes the server's layout. */}
                  {backupFileName(wipeResult.backup_path)
                    ? `, saved as ${backupFileName(wipeResult.backup_path)}.`
                    : "."}{" "}
                  It is listed below and can be restored.
                </Notice>
              )}
            </div>
          )}
          {wipeFailure && (
            <div className="mt-3">
              <FailureNotice failure={wipeFailure} />
            </div>
          )}
        </section>

        {!archived && (
        <section className={`${chroniclePanelClass} p-4`}>
          <SectionHeading title="Archive as…" />
          <p className="mt-2 text-sm leading-relaxed text-[var(--tfmc-stone)]">
            Copy this live map onto a frozen chapter id. Type the destination id
            exactly. Extra confirm if the destination already exists or is
            unknown. Do not use this on production this season.
          </p>

          <label className="mt-3 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Destination id
            <input
              className={`${inputClass} mt-1`}
              value={archiveDest}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setArchiveDest(event.target.value)}
            />
          </label>
          <label className="mt-3 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Display name
            <input
              className={`${inputClass} mt-1`}
              value={archiveName}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setArchiveName(event.target.value)}
            />
          </label>
          <label className="mt-3 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Type the destination id to confirm
            <input
              className={`${inputClass} mt-1`}
              value={archiveConfirm}
              autoComplete="off"
              spellCheck={false}
              placeholder="type the destination id"
              onChange={(event) => setArchiveConfirm(event.target.value)}
            />
          </label>
          {archiveConfirm.length > 0 &&
            !chronicleConfirmMatches(archiveConfirm, archiveDest) && (
              <p className="mt-1 text-xs text-[color-mix(in_srgb,#fca5a5_85%,transparent)]">
                Does not match “{archiveDest}” exactly.
              </p>
            )}

          <label className="mt-3 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
            Reason (required, up to {CHRONICLE_WIPE_REASON_MAX_LENGTH} characters)
            <textarea
              className={`${inputClass} mt-1 h-20 resize-y`}
              value={archiveReason}
              maxLength={CHRONICLE_WIPE_REASON_MAX_LENGTH}
              placeholder="why this live map is being copied to a frozen id"
              onChange={(event) => setArchiveReason(event.target.value)}
            />
          </label>

          {archiveDest === "unknown" && (
            <label className="mt-3 flex items-start gap-2 text-sm text-[var(--tfmc-cream)]">
              <input
                type="checkbox"
                className="mt-1"
                checked={archiveAllowUnknown}
                onChange={(event) => setArchiveAllowUnknown(event.target.checked)}
              />
              Dest is unknown — extra confirm (overwrite hazard)
            </label>
          )}
          {destExists && (
            <label className="mt-3 flex items-start gap-2 text-sm text-[var(--tfmc-cream)]">
              <input
                type="checkbox"
                className="mt-1"
                checked={archiveReplace}
                onChange={(event) => setArchiveReplace(event.target.checked)}
              />
              Dest already exists — replace that chapter
            </label>
          )}

          <button
            type="button"
            className={`${dangerButtonClass} mt-3`}
            disabled={!archiveReady || archiveBusy}
            onClick={() => void runArchive()}
          >
            {archiveBusy ? "Archiving…" : `Archive as ${archiveDest || "…"}`}
          </button>

          {archiveResult && (
            <div className="mt-3">
              <Notice tone="ok">
                <span className="font-medium">
                  Copied {mapId} → {archiveResult.dest}.
                </span>{" "}
                {formatDayCount(archiveResult.days.length)} indexed. Source was
                not wiped.
              </Notice>
            </div>
          )}
          {archiveFailure && (
            <div className="mt-3">
              <FailureNotice failure={archiveFailure} />
            </div>
          )}
        </section>
        )}

        {/* ------------------------------------------------------------- */}
        <section className={`${chroniclePanelClass} p-4`}>
          <div className="flex items-center justify-between gap-3">
            <SectionHeading title="Backups" />
            <button
              type="button"
              className={quietButtonClass}
              disabled={loading}
              onClick={() => void loadBackups()}
            >
              {loading ? "Loading…" : "Reload"}
            </button>
          </div>

          {loadFailure && (
            <div className="mt-3">
              <FailureNotice failure={loadFailure} />
            </div>
          )}

          {!loadFailure && backups !== null && backups.length === 0 && (
            <p className="mt-3 text-sm text-[var(--tfmc-stone)]">
              No wipes have ever been recorded for this map.
            </p>
          )}

          {backups !== null && backups.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)]">
                    <th className={headCellClass}>Wiped</th>
                    <th className={headCellClass}>By</th>
                    <th className={headCellClass}>Days</th>
                    <th className={headCellClass}>Reason</th>
                    <th className={headCellClass}>Restore state</th>
                    <th className={headCellClass} />
                  </tr>
                </thead>
                <tbody>
                  {backups.map((row) => {
                    const restorable = canRestoreBackup(row);
                    const open = restoreId === row.id;
                    return (
                      <tr
                        key={row.id}
                        className="border-b border-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] align-top"
                      >
                        <td className={cellClass}>
                          {formatUnixSeconds(row.wiped_at)}
                          <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">
                            #{row.id}
                          </span>
                        </td>
                        <td className={cellClass}>{row.wiped_by}</td>
                        <td className={cellClass}>{row.day_count}</td>
                        <td className={`${cellClass} max-w-[18rem]`}>
                          <span className="block break-words text-[var(--tfmc-stone)]">
                            {row.reason || "—"}
                          </span>
                        </td>
                        <td className={cellClass}>
                          <span className="text-[var(--tfmc-stone)]">
                            {describeRestoreState(row)}
                          </span>
                          {!restorable && (
                            <span className="mt-1 block rounded border border-[color-mix(in_srgb,#f87171_50%,transparent)] px-1.5 py-0.5 text-center text-xs font-medium text-[color-mix(in_srgb,#fca5a5_90%,transparent)]">
                              Backup missing from disk — cannot be restored
                            </span>
                          )}
                        </td>
                        <td className={cellClass}>
                          <button
                            type="button"
                            className={quietButtonClass}
                            disabled={!restorable}
                            onClick={() => openRestore(row)}
                          >
                            {open ? "Cancel" : "Restore…"}
                          </button>
                          {open && restorable && (
                            <div className="mt-2 w-[min(22rem,70vw)] rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_15%,transparent)] p-3">
                              <p className="text-xs leading-relaxed text-[var(--tfmc-stone)]">
                                Restoring moves backup #{row.id} (
                                {formatDayCount(row.day_count)}) back into the
                                live chronicle. If this map already has days
                                stored, the restore is refused unless you opt
                                into merge.
                              </p>
                              <label className="mt-2 flex items-start gap-2 text-xs text-[var(--tfmc-cream)]">
                                <input
                                  type="checkbox"
                                  className="mt-0.5"
                                  checked={restoreMerge}
                                  onChange={(event) =>
                                    setRestoreMerge(event.target.checked)
                                  }
                                />
                                <span>
                                  Merge into the live chronicle. Live days win:
                                  any day that already exists is kept exactly as
                                  it is, its backup copy is left in the backup
                                  directory, and it is listed as skipped. Nothing
                                  live is overwritten.
                                </span>
                              </label>
                              <label className="mt-2 block text-xs uppercase tracking-widest text-[var(--tfmc-mist)]">
                                Confirm map id
                                <input
                                  className={`${inputClass} mt-1`}
                                  value={restoreConfirm}
                                  autoComplete="off"
                                  spellCheck={false}
                                  placeholder="type the map id"
                                  onChange={(event) =>
                                    setRestoreConfirm(event.target.value)
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className={`${primaryButtonClass} mt-2 w-full`}
                                disabled={
                                  restoreBusy ||
                                  !chronicleConfirmMatches(restoreConfirm, mapId)
                                }
                                onClick={() => void runRestore(row)}
                              >
                                {restoreBusy
                                  ? "Restoring…"
                                  : restoreMerge
                                    ? "Restore (merge)"
                                    : "Restore"}
                              </button>
                              {restoreResult && restoreResult.backup_id === row.id && (
                                <div className="mt-2">
                                  <Notice tone="ok">
                                    {describeRestoreOutcome(restoreResult)}
                                    {restoreResult.skipped_days.length === 0 &&
                                      restoreResult.merge &&
                                      " No live days conflicted."}
                                  </Notice>
                                </div>
                              )}
                              {restoreFailure && (
                                <div className="mt-2">
                                  <FailureNotice failure={restoreFailure} />
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
