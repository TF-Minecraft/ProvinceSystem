import { describe, expect, it } from "vitest";

import { readStaffPreview } from "./preview";

describe("readStaffPreview", () => {
  it("keeps the note and drops a line that carries a deny reason", () => {
    const preview = readStaffPreview({
      week: "2026-W39",
      expires_at: "2026-09-24T02:00:00+00:00",
      bullets: [
        { id: "1", section: "new", body: "Added a station" },
        { id: "2", section: "fixed", body: "Hidden", deny_reason: "spoilers" },
      ],
    });
    expect(preview?.week).toBe("2026-W39");
    expect(preview?.bullets.map((bullet) => bullet.body)).toEqual(["Added a station"]);
    expect(preview?.expiresAt).toBe("2026-09-24T02:00:00+00:00");
  });

  it("rejects a preview with nothing left to show", () => {
    expect(readStaffPreview({ week: "2026-W39", expires_at: "soon", bullets: [] })).toBeNull();
  });
});
