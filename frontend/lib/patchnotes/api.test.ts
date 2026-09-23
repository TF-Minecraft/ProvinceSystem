import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPublishedNotes } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadPublishedNotes", () => {
  it("keeps approved lines and drops review rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("/patchnotes/weeks")) {
          return new Response(JSON.stringify({ weeks: ["2026-W39", "nope"] }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            week: "2026-W39",
            bullets: [
              { id: "1", section: "new", body: "Visible", status: "approved" },
              { id: "2", section: "fixed", body: "Still pending", status: "pending" },
              { id: "3", section: "adjusted", body: "Rejected", deny_reason: "spoilers" },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const notes = await loadPublishedNotes();
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    expect(notes.weeks).toHaveLength(1);
    expect(notes.weeks[0].bullets.map((bullet) => bullet.body)).toEqual(["Visible"]);
    expect(JSON.stringify(notes.weeks)).not.toContain("spoilers");
    expect(JSON.stringify(notes.weeks)).not.toContain("Still pending");
  });

  it("reports the page unavailable when the API fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    const notes = await loadPublishedNotes();
    expect(notes).toEqual({ ok: false });
  });
});