/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), token: null as string | null }));
vi.mock("@/lib/map/api", () => ({ fetchAccessibleMaps: mocks.fetch }));
vi.mock("@/lib/characters/session", () => ({
  getSession: () => mocks.token ? { session_token: mocks.token } : null,
  isSessionValid: (session: unknown) => Boolean(session),
}));
vi.mock("@/lib/characters/uiDev", () => ({ isCharacterUiDev: () => false }));
beforeEach(() => { vi.resetModules(); mocks.fetch.mockReset(); mocks.token = null; });
afterEach(cleanup);

function deferred() {
  let resolve!: (value: { maps: { id: string }[] }) => void;
  const promise = new Promise<{ maps: { id: string }[] }>((done) => { resolve = done; });
  return { promise, resolve };
}
function sessionChanged(token: string | null, key: string | null = "tfmc_profile_session") {
  act(() => {
    mocks.token = token;
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
}

describe("useAccessibleMaps", () => {
  it("shares pending and completed requests across consumers and Strict Mode mounts", async () => {
    const pending = deferred();
    mocks.fetch.mockReturnValue(pending.promise);
    const { useAccessibleMaps } = await import("./useAccessibleMaps");
    const first = renderHook(useAccessibleMaps, { wrapper: StrictMode });
    const second = renderHook(useAccessibleMaps);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ maps: [{ id: "main" }] }));
    const third = renderHook(useAccessibleMaps);
    await act(async () => {});
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    for (const hook of [first, second, third]) {
      expect(hook.result.current).toEqual({ maps: [{ id: "main" }], loading: false, error: null });
    }
  });
  it("shares each new auth request and ignores an earlier account's late response", async () => {
    const anonymous = deferred();
    const signedIn = deferred();
    mocks.fetch.mockReturnValueOnce(anonymous.promise).mockReturnValueOnce(signedIn.promise);
    const { useAccessibleMaps } = await import("./useAccessibleMaps");
    const first = renderHook(useAccessibleMaps);
    const second = renderHook(useAccessibleMaps);
    sessionChanged("staff-token");
    expect(mocks.fetch.mock.calls).toEqual([[null], ["staff-token"]]);
    await act(async () => signedIn.resolve({ maps: [{ id: "dev" }] }));
    await act(async () => anonymous.resolve({ maps: [{ id: "main" }] }));
    expect(first.result.current.maps).toEqual([{ id: "dev" }]);
    expect(second.result.current.maps).toEqual([{ id: "dev" }]);
    const signedOut = deferred();
    mocks.fetch.mockReturnValueOnce(signedOut.promise);
    sessionChanged(null, null);
    expect(first.result.current.maps).toEqual([]);
    expect(second.result.current.loading).toBe(true);
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    await act(async () => signedOut.resolve({ maps: [{ id: "main" }] }));
    expect(first.result.current.maps).toEqual([{ id: "main" }]);
  });
  it("refreshes all consumers once after an archive and ignores the old pending answer", async () => {
    const stale = deferred();
    const fresh = deferred();
    mocks.fetch.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise);
    const { useAccessibleMaps, invalidateAccessibleMaps } = await import("./useAccessibleMaps");
    const first = renderHook(useAccessibleMaps);
    const second = renderHook(useAccessibleMaps);
    act(() => invalidateAccessibleMaps());
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    await act(async () => fresh.resolve({ maps: [{ id: "main" }, { id: "archive" }] }));
    await act(async () => stale.resolve({ maps: [{ id: "main" }] }));
    const later = renderHook(useAccessibleMaps);
    await act(async () => {});
    for (const hook of [first, second, later]) {
      expect(hook.result.current.maps).toEqual([{ id: "main" }, { id: "archive" }]);
    }
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("allows a later mount to retry a failed request", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("offline"));
    const { useAccessibleMaps } = await import("./useAccessibleMaps");
    const first = renderHook(useAccessibleMaps);
    await act(async () => {});
    expect(first.result.current.error).toBe("Failed to load maps");
    first.unmount();
    mocks.fetch.mockResolvedValueOnce({ maps: [{ id: "main" }] });
    const second = renderHook(useAccessibleMaps);
    await act(async () => {});
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(second.result.current.error).toBeNull();
  });
});
