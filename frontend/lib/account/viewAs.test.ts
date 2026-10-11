/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { getSession, setSession } from "../profile/session";
import { getAccount, stopViewingAs } from "./api";
import { endLinkedProfileSession } from "./profileSession";
import { leaveExpiredView, leaveView, onViewSwitch } from "./viewAs";

vi.mock("./api", () => ({ getAccount: vi.fn(), stopViewingAs: vi.fn() }));
vi.mock("./profileSession", () => ({ endLinkedProfileSession: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../admin/api", () => ({ startViewingAs: vi.fn() }));

const assign = vi.fn();
const reload = vi.fn();
beforeEach(() => {
  Object.defineProperty(window, "location", { value: { assign, reload }, configurable: true });
});
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

const VIEW = { viewing_as: { staff_name: "boss", expires_at: "2026-10-11T00:30:00Z" } };

it("leaves the view a page shows once it runs out, and tells other tabs", async () => {
  vi.mocked(getAccount).mockResolvedValue(VIEW as never);
  vi.mocked(stopViewingAs).mockResolvedValue("/admin/players/x");
  await leaveExpiredView("2026-10-11T00:30:00Z");
  expect(stopViewingAs).toHaveBeenCalledTimes(1);
  expect(assign).toHaveBeenCalledWith("/admin/players/x");
  expect(localStorage.getItem("tfmc_view_switch")).not.toBeNull();
});

it("never ends a newer view or a switch made elsewhere; it reloads instead", async () => {
  for (const account of [{ viewing_as: { staff_name: "boss", expires_at: "2026-10-11T01:00:00Z" } }, { viewing_as: null }, null]) {
    vi.mocked(getAccount).mockResolvedValue(account as never);
    await leaveExpiredView("2026-10-11T00:30:00Z");
  }
  expect(stopViewingAs).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledTimes(3);
});

it("hears switches from other tabs only, dropping just this tab's own sessions", async () => {
  vi.mocked(stopViewingAs).mockResolvedValue("/account");
  setSession({ session_token: "previous-player", player_uuid: "p-1", expires_at: "2999-01-01T00:00:00Z" });
  // The switching tab has already stored the new account's shared session; a late event must keep it.
  const shared = { session_token: "new-account", player_uuid: "p-2", expires_at: "2999-01-01T00:00:00Z" };
  localStorage.setItem("tfmc_profile_session", JSON.stringify(shared));
  const heard = vi.fn();
  const stop = onViewSwitch(heard);
  window.dispatchEvent(new StorageEvent("storage", { key: "something_else" }));
  expect(heard).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent("storage", { key: "tfmc_view_switch" }));
  expect(heard).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem("tfmc_profile_session")).toBeNull();
  expect(getSession()?.session_token).toBe("new-account");
  expect(endLinkedProfileSession).not.toHaveBeenCalled();
  stop();
  await leaveView();
  window.dispatchEvent(new StorageEvent("storage", { key: "tfmc_view_switch" }));
  expect(heard).toHaveBeenCalledTimes(1);
});
