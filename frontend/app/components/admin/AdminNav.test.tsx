/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import AdminNav, { adminSection } from "./AdminNav";
import { getAdminMe, type AdminMe } from "../../../lib/admin/api";

vi.mock("../../../lib/admin/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/admin/api")>()),
  getAdminMe: vi.fn(() => Promise.reject(new Error("signed out"))),
}));

const pathname = vi.hoisted(() => ({ current: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

it("puts each staff path under its tab, sub-pages included", () => {
  expect(adminSection("/admin")).toBe("accounts");
  expect(adminSection("/admin/players")).toBe("players");
  expect(adminSection("/admin/people/discord/422545450919526411")).toBe("players");
  expect(adminSection("/admin/players/0448bccd-c55c-49b4-aed0-1def08302dd8")).toBe("players");
  expect(adminSection("/admin/players/0448bccd-c55c-49b4-aed0-1def08302dd8/movement")).toBe("players");
  expect(adminSection("/admin/movement")).toBe("movement");
  expect(adminSection("/admin/rail")).toBe("rail");
  expect(adminSection("/admin/ranks/groups/staff")).toBe("ranks");
  expect(adminSection("/admin/commands")).toBe("commands");
  expect(adminSection("/admin/precedent")).toBe("precedent");
  expect(adminSection("/admin/codes")).toBe("codes");
  expect(adminSection("/admin/servers")).toBe("servers");
  expect(adminSection("/admin/diagnostics")).toBe("diagnostics");
  expect(adminSection("/admin/database/coreprotect")).toBe("database");
  expect(adminSection("/admin/railway")).toBe("accounts");
  expect(adminSection("/map")).toBeNull();
});

it("marks the tab for the current path", () => {
  pathname.current = "/admin/ranks/players/abc";
  render(<AdminNav />);
  expect(screen.getByRole("link", { name: "Ranks" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Accounts" }).getAttribute("aria-current")).toBeNull();
});

it("places Commands after Ranks and marks it current", () => {
  pathname.current = "/admin/commands";
  render(<AdminNav />);
  const links = screen.getAllByRole("link");
  const ranksIndex = links.findIndex((link) => link.textContent === "Ranks");
  expect(links[ranksIndex + 1].textContent).toBe("Commands");
  expect(links[ranksIndex + 1].getAttribute("aria-current")).toBe("page");
});

it("shows the Database tab only to roles that can use it", async () => {
  pathname.current = "/admin";
  render(<AdminNav />);
  await Promise.resolve();
  expect(screen.queryByRole("link", { name: "Database" })).toBeNull();
  cleanup();
  vi.mocked(getAdminMe).mockResolvedValueOnce({ capabilities: ["view_admin", "use_database"] } as AdminMe);
  render(<AdminNav />);
  expect((await screen.findByRole("link", { name: "Database" })).getAttribute("href")).toBe("/admin/database");
});
