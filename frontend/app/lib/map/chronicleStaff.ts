import { mapBaseHref } from "./chronicleDayRoute";
import type { MapId } from "@/app/components/map/types";

/**
 * Pure logic behind `/map/{map}/chronicle/staff` — the wipe / backups / restore
 * console.
 *
 * The backend (`backend/src/api/chronicle_staff_routes.py`) traded "you need
 * shell access on the server" for "you need the `tfmc.map.staff` permission
 * *and* you typed the map id on purpose". This module owns the frontend half of
 * that bargain: the confirmation predicate, the error-code vocabulary and the
 * shapes the three routes speak. Everything here is deliberately free of React
 * so it can be tested — vitest runs node-env over `app/**\/*.test.ts`, so the
 * page component itself is untestable and must stay a thin shell over this.
 */

/** Longest `reason` the backend accepts before answering 400. */
export const CHRONICLE_WIPE_REASON_MAX_LENGTH = 500;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** One row of `GET /{map}/chronicle/backups`. */
export type ChronicleBackupRow = {
  id: number;
  map_id: string;
  /** UNIX **seconds** (also the backup directory stamp), never milliseconds. */
  wiped_at: number;
  wiped_by: string;
  day_count: number;
  backup_path: string | null;
  reason: string | null;
  /** UNIX seconds, or null while this wipe has never been restored. */
  restored_at: number | null;
  restored_by: string | null;
  restored: boolean;
  /** False once the backup directory is gone from disk — unrestorable. */
  backup_exists: boolean;
};

export type ChronicleBackupsResponse = {
  map: string;
  count: number;
  backups: ChronicleBackupRow[];
};

/**
 * `POST /{map}/chronicle/wipe`.
 *
 * Two different 200s share this shape. `performed: true` archived days and
 * wrote an audit row; `performed: false` means the map had no chronicle at all,
 * so nothing moved and no row exists to restore. The second is an outcome, not
 * a failure — see `isNothingToWipe`.
 */
export type ChronicleWipeResponse = {
  ok: true;
  map: string;
  performed: boolean;
  wipe_id: number | null;
  day_count: number;
  backup_path: string | null;
  wiped_at: number | null;
  wiped_by: string;
  reason?: string;
  message?: string;
};

export type ChronicleRestoreResponse = {
  ok: true;
  map: string;
  backup_id: number;
  merge: boolean;
  restored_days: string[];
  restored_day_count: number;
  skipped_days: string[];
  restored_rows: number;
  restored_at: number;
  restored_by: string;
};

/** The `{ok: false, code, detail}` body the restore route answers errors with. */
export type ChronicleStaffErrorBody = {
  ok?: false;
  code?: string;
  detail?: string;
};

export type ChronicleWipeRequest = { confirm: string; reason: string };

export type ChronicleRestoreRequest = {
  confirm: string;
  backup_id: number;
  merge: boolean;
};

export type ChronicleArchiveRequest = {
  dest_id: string;
  display_name: string;
  confirm: string;
  reason: string;
  replace: boolean;
  allow_unknown: boolean;
};

export type ChronicleArchiveResponse = {
  ok: true;
  source: string;
  dest: string;
  display_name: string;
  days: string[];
};

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

export function chronicleWipePath(mapId: MapId): string {
  return `/${mapId}/chronicle/wipe`;
}

export function chronicleBackupsPath(mapId: MapId): string {
  return `/${mapId}/chronicle/backups`;
}

export function chronicleRestorePath(mapId: MapId): string {
  return `/${mapId}/chronicle/restore`;
}

export function chronicleArchivePath(mapId: MapId): string {
  return `/${mapId}/chronicle/archive`;
}

/** `/map/{map}/chronicle/staff` — the page these helpers back. */
export function chronicleStaffHref(mapId: MapId): string {
  return `${mapBaseHref(mapId)}/chronicle/staff`;
}

// ---------------------------------------------------------------------------
// The typed confirmation
// ---------------------------------------------------------------------------

/**
 * Whether what a human typed may be sent as `confirm`.
 *
 * Byte-for-byte equality with the map id: **no trimming and no case folding**,
 * matching `_require_confirmation` on the backend. Softening either side here
 * would only move the 400 from the server to a surprise — and the point of the
 * field is that somebody typed this specific map's name on purpose, which a
 * value that needed cleaning up did not.
 */
export function chronicleConfirmMatches(
  typed: string,
  mapId: MapId | string
): boolean {
  return typed === mapId;
}

/** A reason the backend will accept: non-blank and within the length cap. */
export function chronicleReasonIsValid(reason: string): boolean {
  const trimmed = reason.trim();
  return trimmed.length > 0 && trimmed.length <= CHRONICLE_WIPE_REASON_MAX_LENGTH;
}

/** Both gates on the wipe button: exact confirmation *and* a usable reason. */
export function canSubmitChronicleWipe(
  typed: string,
  reason: string,
  mapId: MapId | string
): boolean {
  return chronicleConfirmMatches(typed, mapId) && chronicleReasonIsValid(reason);
}

const LIVE_ARCHIVE_DEST = new Set(["main", "dev"]);

export type ChronicleArchiveSubmitInput = {
  destId: string;
  confirm: string;
  displayName: string;
  reason: string;
  allowUnknown: boolean;
  replace: boolean;
  destExists: boolean;
};

/** Dest confirm (not source), extra flags for unknown / existing dest. */
export function canSubmitChronicleArchive(
  input: ChronicleArchiveSubmitInput
): boolean {
  const dest = input.destId;
  if (!dest || LIVE_ARCHIVE_DEST.has(dest)) return false;
  if (!chronicleConfirmMatches(input.confirm, dest)) return false;
  if (!input.displayName.trim()) return false;
  if (!chronicleReasonIsValid(input.reason)) return false;
  if (dest === "unknown" && !input.allowUnknown) return false;
  if (input.destExists && !input.replace) return false;
  return true;
}

/**
 * A row is restorable only while its bytes are still on disk. `restored: true`
 * does not disqualify it — a wipe can be restored again after a later wipe —
 * but `backup_exists: false` does: there is nothing left to move back.
 */
export function canRestoreBackup(row: ChronicleBackupRow): boolean {
  return row.backup_exists;
}

/**
 * Every gate on actually firing a restore, in one predicate: the row's bytes
 * are still there *and* somebody typed the map id exactly.
 *
 * The `canRestoreBackup` half is deliberately duplicated from the button's own
 * `disabled` — a disabled button is a rendering detail, and the submit path
 * must not depend on the row it was opened from still being restorable by the
 * time it runs (the backups list reloads underneath it). The server answers
 * `nothing_to_restore` either way; this keeps the request from being made.
 */
export function canSubmitChronicleRestore(
  row: ChronicleBackupRow,
  typed: string,
  mapId: MapId | string
): boolean {
  return canRestoreBackup(row) && chronicleConfirmMatches(typed, mapId);
}

/**
 * The backup file as it should be named to an operator: the bare file name,
 * never a server-absolute path. The backend now sends a basename, so this is
 * normally a pass-through — it strips any leading directory anyway so an older
 * backend (or a future one that regresses) cannot leak the server's on-disk
 * layout into the page. `null`/blank means "say nothing", not "say `null`".
 */
export function backupFileName(backupPath: string | null | undefined): string | null {
  if (!backupPath) return null;
  const name = backupPath.split(/[\\/]/).pop()?.trim();
  return name ? name : null;
}

export function buildChronicleWipeRequest(
  mapId: MapId,
  reason: string
): ChronicleWipeRequest {
  return { confirm: mapId, reason: reason.trim() };
}

export function buildChronicleRestoreRequest(
  mapId: MapId,
  backupId: number,
  merge: boolean
): ChronicleRestoreRequest {
  return { confirm: mapId, backup_id: backupId, merge };
}

export function buildChronicleArchiveRequest(input: {
  destId: string;
  displayName: string;
  reason: string;
  replace: boolean;
  allowUnknown: boolean;
}): ChronicleArchiveRequest {
  return {
    dest_id: input.destId,
    display_name: input.displayName.trim(),
    confirm: input.destId,
    reason: input.reason.trim(),
    replace: input.replace,
    allow_unknown: input.allowUnknown,
  };
}

/** The `performed: false` 200 — "there was no chronicle here to begin with". */
export function isNothingToWipe(result: ChronicleWipeResponse): boolean {
  return result.performed === false;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Render a `wiped_at` / `restored_at` for a reader.
 *
 * The backend deals in UNIX **seconds**; `Date` wants milliseconds, and getting
 * that wrong silently prints 1970 rather than throwing. Null (never restored)
 * and non-finite values render as an em dash instead of "Invalid Date".
 */
export function formatUnixSeconds(
  seconds: number | null | undefined,
  locale?: string
): string {
  if (seconds === null || seconds === undefined) return "—";
  if (!Number.isFinite(seconds)) return "—";
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(locale, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "Restored 12 Mar 2026, 14:03 by …" / "Not restored", for the table cell. */
export function describeRestoreState(
  row: ChronicleBackupRow,
  locale?: string
): string {
  if (!row.restored) return "Not restored";
  const when = formatUnixSeconds(row.restored_at, locale);
  const who = row.restored_by?.trim();
  return who ? `Restored ${when} by ${who}` : `Restored ${when}`;
}

/** Plural-safe "1 day" / "3 days", used in several outcome lines. */
export function formatDayCount(count: number): string {
  return `${count} ${count === 1 ? "day" : "days"}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type ChronicleStaffFailure = {
  /** Heading — what happened. */
  title: string;
  /** Body — why, and what the operator can do about it. */
  message: string;
};

/**
 * Turn a failed staff request into something an operator can act on.
 *
 * Documented `code`s win over the HTTP status, because the status alone is
 * ambiguous (404 is both "unknown map" and "nothing to restore"; 400 is both
 * "you mistyped the confirmation" and "the backup path no longer validates").
 * `live_data` is the one that must never degrade into a generic failure: it is
 * a *refusal by design*, and the operator needs to be told the way out — wipe
 * first, which itself takes a backup — rather than being left to retry.
 */
export function chronicleStaffFailure(
  status: number,
  detail: string,
  code?: string | null,
  action: "wipe" | "restore" | "load" | "archive" = "load"
): ChronicleStaffFailure {
  const fallback = detail?.trim() || "The request failed.";

  switch (code) {
    case "dest_live_socket":
      return {
        title: "Archive dest cannot be the live socket",
        message:
          "Dest main and dest dev are refused. Archive copies onto a frozen chapter id, not onto the live upload folder.",
      };
    case "dest_unknown":
      return {
        title: "Archive dest is unknown",
        message:
          "The chapter slug is unknown. Tick the extra confirm if you really mean to archive as unknown — that dest is easy to overwrite later.",
      };
    case "dest_exists":
      return {
        title: "That dest already exists",
        message:
          "Archiving again replaces the frozen chapter. Tick replace and type the dest id if that is what you intend.",
      };
    case "source_archived":
      return {
        title: "This map is already archived",
        message: "Archive copies a live map. Frozen chapters cannot be forked from this form.",
      };
    case "live_data":
      return {
        title: "Restore refused — this map already has chronicle data",
        message:
          "Restoring on top of a live chronicle would mix two histories: the days captured since the wipe plus the days from before it. Wipe this map first — the wipe archives the current days into a new backup of their own — and then restore. Or tick “merge” to keep every live day as it is and fill in only the missing ones; the conflicting backup days are skipped and listed for you.",
      };
    case "bad_backup_path":
      return {
        title: "Restore refused — the backup path did not validate",
        message:
          "The path recorded on this audit row no longer resolves inside this map's own chronicle directory, so nothing was touched. The backup may have been moved or renamed on the server; an administrator has to put it back before this row can be restored.",
      };
    case "nothing_to_restore":
      return {
        title: "Nothing to restore",
        message:
          "The backup directory for this row is empty or gone, so there are no day folders to move back. Check the backups list — rows marked “backup missing” cannot be restored.",
      };
    default:
      break;
  }

  switch (status) {
    case 0:
      return {
        title: "Could not reach the server",
        message:
          "The request never completed. Check your connection and try again; nothing was changed.",
      };
    case 400:
      return {
        title: "Request rejected",
        message: `${fallback} The confirmation must be the map id exactly — no extra spaces, matching case — and a wipe reason is required.`,
      };
    case 403:
      return {
        title: "Staff permission required",
        message:
          "You do not have staff permission for this map. The tfmc.map.staff node is what gates these operations; ask an operator to grant it, then reload.",
      };
    case 404:
      return {
        title: action === "restore" ? "Backup not found" : "Map not found",
        message:
          action === "restore"
            ? "No backup with that id belongs to this map. It may have been listed for a different map, or the list is stale — reload the backups and try again."
            : `${fallback} This map id is not one the server knows about.`,
      };
    case 429:
      return {
        title: "Another operation is already running",
        message:
          "A wipe or restore for this map is still in flight. They are serialised on purpose — two at once would interleave a directory move with a row delete. Wait for it to finish, then reload the backups.",
      };
    default:
      return {
        title:
          action === "wipe"
            ? "Wipe failed"
            : action === "restore"
              ? "Restore failed"
              : action === "archive"
                ? "Archive failed"
                : "Could not load backups",
        message: fallback,
      };
  }
}

/** "Restored 4 days" plus, when relevant, what merge left alone. */
export function describeRestoreOutcome(
  result: ChronicleRestoreResponse
): string {
  const restored = `Restored ${formatDayCount(result.restored_day_count)} (${result.restored_rows} index rows).`;
  if (result.skipped_days.length === 0) return restored;
  return `${restored} ${formatDayCount(result.skipped_days.length)} already existed live and were kept as they are: ${result.skipped_days.join(", ")}.`;
}
