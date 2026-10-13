import { expect, it } from "vitest";
import type { CharacterEstate } from "./api";
import { estateMoved, estateStatusLine, formatDay, recipientLabel, willErrorMessage, willResultMessage } from "./wills";

function estate(extra: Partial<CharacterEstate> = {}): CharacterEstate {
  return {
    death_id: "d",
    status: "OPEN",
    revision: 0,
    due_at: "2026-10-14T12:00:00Z",
    decided_at: null,
    heir_name: null,
    recipients: {},
    money_moved_cents: null,
    participants: {},
    ...extra,
  };
}

it("words each estate state", () => {
  expect(estateStatusLine(estate())).toBe("Passes on 14 Oct 2026");
  expect(estateStatusLine(estate({ due_at: null }))).toBe("Not passed on yet");
  expect(estateStatusLine(estate({ status: "HELD" }))).toBe("Held by staff");
  expect(estateStatusLine(estate({ status: "CANCELLED" }))).toBe("Cancelled: brought back to life");
  expect(estateStatusLine(estate({ status: "DECIDED", decided_at: "2026-10-15T00:30:00Z" }))).toBe(
    "Passed on 15 Oct 2026",
  );
  expect(estateStatusLine(estate({ status: "REVERTED" }))).toBe("Stopped by staff");
});

it("names recipients, and staff or waiting parts by what happens to them", () => {
  expect(recipientLabel({ kind: "CHARACTER", name: "Kira" })).toBe("Kira");
  expect(recipientLabel({ kind: "GUILD", name: "Rat Hill" })).toBe("Rat Hill");
  expect(recipientLabel({ kind: "FROZEN", name: null })).toBe("Held by staff");
  expect(recipientLabel({ kind: "WAITING", name: null })).toBe("Waiting for a guild leader");
  expect(recipientLabel({ kind: "SENDER", name: null })).toBe("Returned to senders");
  expect(recipientLabel({ kind: "CHARACTER", name: null })).toBeNull();
  expect(recipientLabel(undefined)).toBeNull();
});

it("sums what each part of the server moved", () => {
  const moved = estateMoved(
    estate({
      participants: {
        thievery: { outcome: "DONE", revision: 0, counts: { locks: 290, doors: 0 } },
        "thievery-furniture": { outcome: "DONE", revision: 0, counts: { locks: 7 } },
        "simplefactions-vehicles": { outcome: "RETRY", revision: 0, counts: { vehicles: 2 } },
      },
    }),
  );
  expect(moved).toBe("297 locks, 2 vehicles");
  expect(estateMoved(estate())).toBeNull();
  const one = estateMoved(
    estate({ participants: { bartershops: { outcome: "DONE", revision: 0, counts: { shops: 1 } } } }),
  );
  expect(one).toBe("1 shop");
});

it("words will results and refusals", () => {
  expect(willResultMessage("applied")).toBeNull();
  expect(willResultMessage("invalid heir")).toBe("Not saved: that heir can’t inherit.");
  expect(willErrorMessage("will_changed")).toBe("The will changed in game. Refresh and try again.");
  expect(willErrorMessage("Something else")).toBe("Something else");
  expect(formatDay("nonsense")).toBeNull();
});
