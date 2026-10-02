import { afterEach, describe, expect, it, vi } from "vitest";

import { listReviewWeeks, loadReviewWeek, patchReviewBullet, readReviewPayload, sortReviewWeek, submitReviewFeedback } from "./review";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

const bullet = { id: "b1", section: "new", body: "A new ferry route opened.", status: "pending", topic: null, highlight: false };
const job = { id: "j1", week: "2026-W40", kind: "sort", status: "queued", error: null, changed: null, feedback: null, created_at: "2026-10-01T00:00:00Z", finished_at: null };

describe("review payload parsing", () => {
  it("parses open and removed lines and drops malformed entries", () => {
    expect(readReviewPayload({ week: "2026-W40", postponed: true, deferred_to: null, bullets: [bullet, { id: "bad" }], removed: [], job })).toEqual({
      week: "2026-W40", postponed: true, deferredTo: null,
      bullets: [{ id: "b1", section: "new", body: "A new ferry route opened.", topic: null, highlight: false, status: "pending", deny_reason: null, warning: null }], removed: [], job,
    });
    expect(readReviewPayload({ week: "bad", bullets: [], removed: [] })).toBeNull();
  });
});

describe("review requests", () => {
  it("parses the week index defensively", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test/");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ current: "2026-W41", weeks: [
      { week: "2026-W40", pending: 2, approved: 3, denied: 1, postponed: false }, { week: "bad", pending: "x" },
    ] }), { status: 200 })));
    expect(await listReviewWeeks("staff-token")).toEqual({ current: "2026-W41", weeks: [{ week: "2026-W40", label: "Week of 28 September 2026", pending: 2, approved: 3, denied: 1, postponed: false }] });
  });

  it("uses staff auth and the review route", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ week: "2026-W40", bullets: [bullet], removed: [], postponed: false, job: null }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await loadReviewWeek("staff-token", "2026-W40");
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/patchnotes/staff/weeks/2026-W40/review", expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer staff-token" }) }));
  });

  it("sends patch, feedback and sort request bodies", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (String(_url).endsWith("/feedback") || String(_url).endsWith("/sort")) return new Response(JSON.stringify({ job }), { status: 202 });
      return new Response(JSON.stringify({ ...bullet, section: "fixed" }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await patchReviewBullet("t", "b1", { section: "fixed" });
    await submitReviewFeedback("t", "2026-W40", "Please clarify");
    await sortReviewWeek("t", "2026-W40");
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method, init?.body])).toEqual([
      ["http://api.test/patchnotes/staff/bullets/b1", "PATCH", JSON.stringify({ section: "fixed" })],
      ["http://api.test/patchnotes/staff/weeks/2026-W40/feedback", "POST", JSON.stringify({ feedback: "Please clarify" })],
      ["http://api.test/patchnotes/staff/weeks/2026-W40/sort", "POST", undefined],
    ]);
  });

  it("surfaces API detail messages", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://api.test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ detail: "Bullet is not open" }), { status: 409 })));
    await expect(loadReviewWeek("t", "2026-W40")).rejects.toThrow("Bullet is not open");
  });
});
