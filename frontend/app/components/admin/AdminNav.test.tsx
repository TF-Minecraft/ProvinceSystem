/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import AdminNav, { adminSection } from "./AdminNav";

const pathname = vi.hoisted(() => ({ current: "/admin" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

it("puts each staff path under its tab, sub-pages included", () => {
  expect(adminSection("/admin")).toBe("accounts");
  expect(adminSection("/admin/players")).toBe("players");
  expect(adminSection("/admin/players/0448bccd-c55c-49b4-aed0-1def08302dd8")).toBe("players");
  expect(adminSection("/admin/players/0448bccd-c55c-49b4-aed0-1def08302dd8/movement")).toBe("players");
  expect(adminSection("/admin/movement")).toBe("movement");
  expect(adminSection("/admin/rail")).toBe("rail");
  expect(adminSection("/admin/ranks/groups/staff")).toBe("ranks");
  expect(adminSection("/admin/precedent")).toBe("precedent");
  expect(adminSection("/admin/codes")).toBe("codes");
  expect(adminSection("/admin/railway")).toBe("accounts");
  expect(adminSection("/map")).toBeNull();
});

it("marks the tab for the current path", () => {
  pathname.current = "/admin/ranks/players/abc";
  render(<AdminNav />);
  expect(screen.getByRole("link", { name: "Ranks" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Accounts" }).getAttribute("aria-current")).toBeNull();
});
