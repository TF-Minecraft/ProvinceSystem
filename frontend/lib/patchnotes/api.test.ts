import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPublishedNotes, loadPublishedWeek } from "./api";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("loadPublishedNotes", () => {
  it("loads every approved week in one request and drops review rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          weeks: [
            {
              week: "2026-W39",
              bullets: [
                { id: "1", section: "new", body: "Visible", status: "approved" },
                { id: "2", section: "fixed", body: "Still pending", status: "pending" },
                { id: "3", section: "adjusted", body: "Rejected", deny_reason: "spoilers" },
              ],
            },
          ],
          has_more: true,
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const notes = await loadPublishedNotes({ limit: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/patchnotes?limit=1",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    expect(notes.hasMore).toBe(true);
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

describe("loadPublishedWeek", () => {
  it("loads one approved week and drops review rows", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          week: "2026-W39",
          bullets: [
            { id: "1", section: "new", body: "Visible", status: "approved" },
            { id: "2", section: "fixed", body: "Still pending", status: "pending" },
          ],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const notes = await loadPublishedWeek("2026-W39");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://api.test/patchnotes/weeks/2026-W39",
      expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
    );
    expect(notes.ok).toBe(true);
    if (!notes.ok) return;
    expect(notes.week.bullets.map((bullet) => bullet.body)).toEqual(["Visible"]);
  });

  it("treats an unknown week as missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 400 })));
    expect(await loadPublishedWeek("2026-W39")).toEqual({ ok: false, missing: true });
    expect(await loadPublishedWeek("nope")).toEqual({ ok: false, missing: true });
  });

  it("reports the page unavailable when the API fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 502 })));
    expect(await loadPublishedWeek("2026-W39")).toEqual({ ok: false, missing: false });
  });
});