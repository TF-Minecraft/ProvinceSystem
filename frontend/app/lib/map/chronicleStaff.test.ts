import { describe, expect, it } from "vitest";

import {
  backupFileName,
  buildChronicleRestoreRequest,
  buildChronicleWipeRequest,
  canRestoreBackup,
  canSubmitChronicleArchive,
  canSubmitChronicleRestore,
  canSubmitChronicleWipe,
  chronicleArchivePath,
  chronicleBackupsPath,
  chronicleConfirmMatches,
  chronicleReasonIsValid,
  chronicleRestorePath,
  chronicleStaffFailure,
  chronicleStaffHref,
  chronicleWipePath,
  describeRestoreOutcome,
  describeRestoreState,
  formatDayCount,
  formatUnixSeconds,
  isNothingToWipe,
  type ChronicleBackupRow,
  type ChronicleRestoreResponse,
  type ChronicleWipeResponse,
} from "./chronicleStaff";

function backupRow(overrides: Partial<ChronicleBackupRow> = {}): ChronicleBackupRow {
  return {
    id: 7,
    map_id: "main",
    wiped_at: 1_700_000_000,
    wiped_by: "uuid-1",
    day_count: 3,
    backup_path: "/data/main/chronicle.bak.1700000000",
    reason: "season reset",
    restored_at: null,
    restored_by: null,
    restored: false,
    backup_exists: true,
    ...overrides,
  };
}

describe("chronicleConfirmMatches", () => {
  it("accepts only a byte-for-byte match", () => {
    expect(chronicleConfirmMatches("main", "main")).toBe(true);
    expect(chronicleConfirmMatches("dev", "dev")).toBe(true);
  });

  it("rejects surrounding whitespace rather than trimming it", () => {
    expect(chronicleConfirmMatches(" main", "main")).toBe(false);
    expect(chronicleConfirmMatches("main ", "main")).toBe(false);
    expect(chronicleConfirmMatches("\tmain\n", "main")).toBe(false);
  });

  it("rejects a case mismatch rather than folding it", () => {
    expect(chronicleConfirmMatches("Main", "main")).toBe(false);
    expect(chronicleConfirmMatches("DEV", "dev")).toBe(false);
  });

  it("rejects the empty string and the wrong map", () => {
    expect(chronicleConfirmMatches("", "main")).toBe(false);
    expect(chronicleConfirmMatches("dev", "main")).toBe(false);
  });
});

describe("chronicleReasonIsValid", () => {
  it("requires non-blank text", () => {
    expect(chronicleReasonIsValid("")).toBe(false);
    expect(chronicleReasonIsValid("   \n\t ")).toBe(false);
    expect(chronicleReasonIsValid("x")).toBe(true);
  });

  it("caps at the backend's 500 characters, measured after trimming", () => {
    expect(chronicleReasonIsValid("a".repeat(500))).toBe(true);
    expect(chronicleReasonIsValid("a".repeat(501))).toBe(false);
    expect(chronicleReasonIsValid(`  ${"a".repeat(500)}  `)).toBe(true);
  });
});

describe("canSubmitChronicleWipe", () => {
  it("needs both the exact confirmation and a reason", () => {
    expect(canSubmitChronicleWipe("main", "reset", "main")).toBe(true);
    expect(canSubmitChronicleWipe("main", "  ", "main")).toBe(false);
    expect(canSubmitChronicleWipe("Main", "reset", "main")).toBe(false);
    expect(canSubmitChronicleWipe("", "", "main")).toBe(false);
  });
});

describe("canRestoreBackup", () => {
  it("blocks a row whose backup directory is gone", () => {
    expect(canRestoreBackup(backupRow({ backup_exists: false }))).toBe(false);
  });

  it("allows an already-restored row whose bytes are still present", () => {
    expect(canRestoreBackup(backupRow({ restored: true, restored_at: 1_700_000_500, backup_exists: true }))).toBe(true);
  });
});

describe("request bodies", () => {
  it("sends the map id as the confirmation and a trimmed reason", () => {
    expect(buildChronicleWipeRequest("dev", "  season reset  ")).toEqual({
      confirm: "dev",
      reason: "season reset",
    });
  });

  it("defaults nothing about merge — it is passed through explicitly", () => {
    expect(buildChronicleRestoreRequest("main", 4, false)).toEqual({
      confirm: "main",
      backup_id: 4,
      merge: false,
    });
    expect(buildChronicleRestoreRequest("main", 4, true).merge).toBe(true);
  });
});

describe("canSubmitChronicleArchive", () => {
  const ready = {
    destId: "ch01",
    confirm: "ch01",
    displayName: "Chapter One",
    reason: "close season",
    allowUnknown: false,
    replace: false,
    destExists: false,
  };

  it("accepts a new dest that was typed exactly", () => {
    expect(canSubmitChronicleArchive(ready)).toBe(true);
  });

  it("never submits dest main or dest dev", () => {
    expect(canSubmitChronicleArchive({ ...ready, destId: "main", confirm: "main" })).toBe(false);
    expect(canSubmitChronicleArchive({ ...ready, destId: "dev", confirm: "dev" })).toBe(false);
  });

  it("requires extra confirm for unknown and for an existing dest", () => {
    expect(
      canSubmitChronicleArchive({
        ...ready,
        destId: "unknown",
        confirm: "unknown",
        allowUnknown: false,
      }),
    ).toBe(false);
    expect(
      canSubmitChronicleArchive({
        ...ready,
        destId: "unknown",
        confirm: "unknown",
        allowUnknown: true,
      }),
    ).toBe(true);
    expect(canSubmitChronicleArchive({ ...ready, destExists: true, replace: false })).toBe(false);
    expect(canSubmitChronicleArchive({ ...ready, destExists: true, replace: true })).toBe(true);
  });
});

describe("paths", () => {
  it("addresses the API by map id and the page by route segment", () => {
    expect(chronicleWipePath("dev")).toBe("/dev/chronicle/wipe");
    expect(chronicleArchivePath("chsrc")).toBe("/chsrc/chronicle/archive");
    expect(chronicleBackupsPath("main")).toBe("/main/chronicle/backups");
    expect(chronicleRestorePath("dev")).toBe("/dev/chronicle/restore");
    expect(chronicleStaffHref("dev")).toBe("/map/r3b1rth/chronicle/staff");
    expect(chronicleStaffHref("main")).toBe("/map/main/chronicle/staff");
    expect(chronicleStaffHref("calavorn")).toBe("/map/calavorn/chronicle/staff");
  });
});

describe("isNothingToWipe", () => {
  const base: ChronicleWipeResponse = {
    ok: true,
    map: "main",
    performed: false,
    wipe_id: null,
    day_count: 0,
    backup_path: null,
    wiped_at: null,
    wiped_by: "uuid-1",
    message: "Nothing to wipe for map 'main'.",
  };

  it("separates the empty-map 200 from a real wipe", () => {
    expect(isNothingToWipe(base)).toBe(true);
    expect(isNothingToWipe({ ...base, performed: true, wipe_id: 3, day_count: 3 })).toBe(false);
  });
});

describe("formatUnixSeconds", () => {
  it("reads the value as seconds, not milliseconds", () => {
    // 1700000000s is 2023-11-14 UTC; read as ms it would land in 1970.
    const text = formatUnixSeconds(1_700_000_000, "en-GB");
    expect(text).toContain("2023");
    expect(text).not.toContain("1970");
  });

  it("renders an em dash for a missing or unusable stamp", () => {
    expect(formatUnixSeconds(null)).toBe("—");
    expect(formatUnixSeconds(undefined)).toBe("—");
    expect(formatUnixSeconds(Number.NaN)).toBe("—");
    expect(formatUnixSeconds(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("still formats the epoch itself rather than treating 0 as absent", () => {
    expect(formatUnixSeconds(0, "en-GB")).toContain("1970");
  });
});

describe("describeRestoreState", () => {
  it("says so when a wipe has never been restored", () => {
    expect(describeRestoreState(backupRow())).toBe("Not restored");
  });

  it("names who restored it and when", () => {
    const text = describeRestoreState(
      backupRow({ restored: true, restored_at: 1_700_000_500, restored_by: "uuid-2" }),
      "en-GB",
    );
    expect(text).toContain("uuid-2");
    expect(text).toContain("2023");
  });
});

describe("formatDayCount", () => {
  it("is plural-safe", () => {
    expect(formatDayCount(1)).toBe("1 day");
    expect(formatDayCount(0)).toBe("0 days");
    expect(formatDayCount(4)).toBe("4 days");
  });
});

describe("chronicleStaffFailure", () => {
  it("explains live_data as a refusal with a way out, not a generic failure", () => {
    const failure = chronicleStaffFailure(409, "conflict", "live_data", "restore");
    expect(failure.title).toContain("already has chronicle data");
    expect(failure.message).toContain("Wipe this map first");
    expect(failure.message).toContain("merge");
    expect(failure.message).not.toBe("conflict");
  });

  it("maps bad_backup_path to a path problem an admin must fix", () => {
    const failure = chronicleStaffFailure(400, "bad path", "bad_backup_path", "restore");
    expect(failure.title).toContain("backup path");
    expect(failure.message).toContain("nothing was touched");
  });

  it("maps nothing_to_restore to an empty backup directory", () => {
    const failure = chronicleStaffFailure(404, "empty", "nothing_to_restore", "restore");
    expect(failure.title).toBe("Nothing to restore");
  });

  it("lets a code win over an ambiguous status", () => {
    // 404 is both "unknown map" and "nothing to restore"; the code decides.
    expect(chronicleStaffFailure(404, "", "nothing_to_restore").title).toBe("Nothing to restore");
    expect(chronicleStaffFailure(404, "no map", undefined, "load").title).toBe("Map not found");
  });

  it("names the permission node on 403", () => {
    const failure = chronicleStaffFailure(403, "Staff map permission required");
    expect(failure.title).toBe("Staff permission required");
    expect(failure.message).toContain("tfmc.map.staff");
  });

  it("explains 400 as a confirmation or reason problem", () => {
    const failure = chronicleStaffFailure(400, "Confirmation must be exactly 'main'");
    expect(failure.message).toContain("Confirmation must be exactly 'main'");
    expect(failure.message).toContain("exactly");
  });

  it("explains 429 as a serialised concurrent operation", () => {
    expect(chronicleStaffFailure(429, "busy").title).toContain("already running");
  });

  it("distinguishes a 404 backup id from a 404 map", () => {
    expect(chronicleStaffFailure(404, "Backup not found", null, "restore").title).toBe("Backup not found");
  });

  it("reports a transport failure without implying a change happened", () => {
    const failure = chronicleStaffFailure(0, "Request failed. Please try again.");
    expect(failure.message).toContain("nothing was changed");
  });

  it("falls back to the server detail for an unexpected status", () => {
    const failure = chronicleStaffFailure(500, "boom", undefined, "wipe");
    expect(failure.title).toBe("Wipe failed");
    expect(failure.message).toBe("boom");
  });
});

describe("describeRestoreOutcome", () => {
  const base: ChronicleRestoreResponse = {
    ok: true,
    map: "main",
    backup_id: 7,
    merge: false,
    restored_days: ["2026-01-01", "2026-01-02"],
    restored_day_count: 2,
    skipped_days: [],
    restored_rows: 12,
    restored_at: 1_700_000_500,
    restored_by: "uuid-2",
  };

  it("reports the day and row counts", () => {
    expect(describeRestoreOutcome(base)).toBe("Restored 2 days (12 index rows).");
  });

  it("names the live days a merge left alone", () => {
    const text = describeRestoreOutcome({ ...base, merge: true, skipped_days: ["2026-01-03"] });
    expect(text).toContain("1 day already existed live");
    expect(text).toContain("2026-01-03");
  });
});

describe("canSubmitChronicleRestore", () => {
  it("refuses a row whose backup file is gone even with a perfect confirmation", () => {
    // The gap: `runRestore` gated on the token, busy flag and confirmation
    // only, so the destructive POST was one disabled-button bypass away.
    expect(canSubmitChronicleRestore(backupRow({ backup_exists: false }), "main", "main")).toBe(false);
  });

  it("refuses a restorable row when the confirmation does not match exactly", () => {
    expect(canSubmitChronicleRestore(backupRow(), "Main", "main")).toBe(false);
    expect(canSubmitChronicleRestore(backupRow(), "", "main")).toBe(false);
  });

  it("allows a restorable row with an exact confirmation", () => {
    expect(canSubmitChronicleRestore(backupRow(), "main", "main")).toBe(true);
  });

  it("still allows an already-restored row whose file is present", () => {
    expect(canSubmitChronicleRestore(backupRow({ restored: true }), "main", "main")).toBe(true);
  });
});

describe("backupFileName", () => {
  it("passes a basename through unchanged", () => {
    expect(backupFileName("chronicle.bak.1700000000")).toBe("chronicle.bak.1700000000");
  });

  it("keeps a server-absolute path from reaching the page", () => {
    expect(backupFileName("/srv/provinces/data/main/chronicle.bak.170")).toBe("chronicle.bak.170");
    expect(backupFileName("C:\\data\\main\\chronicle.bak.170")).toBe("chronicle.bak.170");
  });

  it("says nothing rather than `null` when there is no backup file", () => {
    expect(backupFileName(null)).toBe(null);
    expect(backupFileName("")).toBe(null);
    expect(backupFileName("/data/main/")).toBe(null);
  });
});
