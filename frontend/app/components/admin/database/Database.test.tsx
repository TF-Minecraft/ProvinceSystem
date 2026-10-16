/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import DatabaseList from "./DatabaseList";
import DatabaseStudio from "./DatabaseStudio";
import { AccountApiError } from "../../../../lib/account/api";
import {
  browseTable,
  formatBytes,
  formatCount,
  getDatabases,
  getSchema,
  runQuery,
  toCsv,
  type DatabaseInfo,
  type QueryResult,
  type Table,
} from "../../../../lib/admin/database";

vi.mock("../../../../lib/admin/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/admin/database")>()),
  getDatabases: vi.fn(),
  getSchema: vi.fn(),
  runQuery: vi.fn(),
  browseTable: vi.fn(),
}));

const site: DatabaseInfo = {
  id: "site",
  name: "Site",
  engine: "sqlite",
  writable: true,
  detail: "province.db",
  queries: 12,
  available: true,
  tables: 40,
  size_bytes: 52_400_000,
};
const coreprotect: DatabaseInfo = {
  ...site,
  id: "coreprotect",
  name: "CoreProtect · Main",
  writable: false,
  detail: "Blocks and chat",
  queries: 3,
  tables: 20,
  size_bytes: 10_300_000_000,
};

const tables: Table[] = [
  {
    name: "users",
    kind: "table",
    rows: 1234,
    columns: [
      { name: "id", type: "INTEGER", notnull: false, pk: true },
      { name: "role", type: "TEXT", notnull: true, pk: false },
    ],
  },
  { name: "recent", kind: "view", rows: null, columns: [{ name: "id", type: "", notnull: false, pk: false }] },
];

const result = (over: Partial<QueryResult> = {}): QueryResult => ({
  columns: ["id", "role", "meta"],
  rows: [
    [1, "root", null],
    [2, "player", { blob: 2, hex: "00ff" }],
  ],
  truncated: false,
  changes: null,
  elapsed_ms: 7,
  limit: 1000,
  ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.mocked(getDatabases).mockReset();
  vi.mocked(getSchema).mockReset();
  vi.mocked(runQuery).mockReset();
  vi.mocked(browseTable).mockReset();
});

it("lists databases with size, access and links, and sorts and filters them", async () => {
  vi.mocked(getDatabases).mockResolvedValue({ databases: [site, coreprotect] });
  render(<DatabaseList />);
  const link = await screen.findByRole("link", { name: "Site" });
  expect(link.getAttribute("href")).toBe("/admin/database/site");
  expect(screen.getByText("10.3 GB")).toBeTruthy();
  expect(screen.getByText("Read only")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Size/ }));
  const names = () => screen.getAllByRole("link").map((l) => l.textContent);
  expect(names()).toEqual(["CoreProtect · Main", "Site"]);
  fireEvent.change(screen.getByRole("searchbox", { name: "Search databases" }), { target: { value: "province" } });
  expect(names()).toEqual(["Site"]);
});

it("tells non-owners the studio is for the owner", async () => {
  vi.mocked(getDatabases).mockRejectedValue(new AccountApiError("forbidden", 403));
  render(<DatabaseList />);
  await screen.findByText("The database studio is for the owner.");
});

it("opens a table, sorts it on the server and pages through it", async () => {
  vi.mocked(getSchema).mockResolvedValue({ tables, database: site });
  vi.mocked(browseTable).mockResolvedValue(
    result({ sql: 'SELECT * FROM "users" LIMIT 100 OFFSET 0', rows: Array(100).fill([1, "root", null]) }),
  );
  render(<DatabaseStudio id="site" />);
  expect(await screen.findByText("1.2k")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "users" }));
  await waitFor(() =>
    expect(browseTable).toHaveBeenLastCalledWith("site", {
      table: "users",
      offset: 0,
      limit: 100,
      order: null,
      descending: false,
      where: "",
    }),
  );
  expect(await screen.findByText('SELECT * FROM "users" LIMIT 100 OFFSET 0')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^role/ }));
  await waitFor(() =>
    expect(vi.mocked(browseTable).mock.lastCall?.[1]).toMatchObject({ order: "role", descending: false }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Next page" }));
  await waitFor(() => expect(vi.mocked(browseTable).mock.lastCall?.[1]).toMatchObject({ offset: 100, order: "role" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Filter rows" }), { target: { value: "role = 'root'" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply" }));
  await waitFor(() =>
    expect(vi.mocked(browseTable).mock.lastCall?.[1]).toMatchObject({ offset: 0, where: "role = 'root'" }),
  );
});

it("runs a read query with Ctrl + Enter and shows NULLs, blobs and errors", async () => {
  vi.mocked(getSchema).mockResolvedValue({ tables, database: site });
  vi.mocked(runQuery)
    .mockResolvedValueOnce(result())
    .mockRejectedValueOnce(new AccountApiError("no such column: nope", 400));
  render(<DatabaseStudio id="site" />);
  const editor = await screen.findByRole("textbox", { name: "Query 1 SQL" });
  fireEvent.change(editor, { target: { value: "SELECT * FROM users" } });
  fireEvent.keyDown(editor, { key: "Enter", ctrlKey: true });
  await waitFor(() => expect(runQuery).toHaveBeenCalledWith("site", "SELECT * FROM users", false));
  expect(await screen.findByText("NULL")).toBeTruthy();
  expect(screen.getByText(/blob 2 B/)).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("2 rows");
  fireEvent.click(screen.getByText("player"));
  expect(screen.getByRole("button", { name: "Copy value" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Run$/ }));
  expect((await screen.findByRole("alert")).textContent).toBe("no such column: nope");
});

it("asks before running an edit and sends it as a write", async () => {
  vi.mocked(getSchema).mockResolvedValue({ tables, database: site });
  vi.mocked(runQuery).mockResolvedValue(result({ columns: [], rows: [], changes: 3 }));
  render(<DatabaseStudio id="site" />);
  const editor = await screen.findByRole("textbox", { name: "Query 1 SQL" });
  fireEvent.change(editor, { target: { value: "UPDATE users SET role = 'player'" } });
  fireEvent.click(screen.getByRole("radio", { name: "Edit" }));
  fireEvent.click(screen.getByRole("button", { name: /Run edit/ }));
  let dialog = screen.getByRole("dialog", { name: "Change data in Site?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(runQuery).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /Run edit/ }));
  dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("UPDATE users SET role = 'player'")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Run edit" }));
  await waitFor(() => expect(runQuery).toHaveBeenCalledWith("site", "UPDATE users SET role = 'player'", true));
  expect((await screen.findByRole("status")).textContent).toContain("3 rows changed");
  // An edit can change tables, so the list is read again.
  expect(getSchema).toHaveBeenCalledTimes(2);
});

it("offers no edit mode on a read-only database and inserts column names into the query", async () => {
  vi.mocked(getSchema).mockResolvedValue({ tables, database: coreprotect });
  render(<DatabaseStudio id="coreprotect" />);
  const editor = (await screen.findByRole("textbox", { name: "Query 1 SQL" })) as HTMLTextAreaElement;
  expect(screen.queryByRole("radio", { name: "Edit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show columns of users" }));
  fireEvent.click(screen.getByRole("button", { name: /^role/ }));
  await waitFor(() => expect(editor.value).toBe('"role"'));
});

it("keeps query tabs across reloads", async () => {
  vi.mocked(getSchema).mockResolvedValue({ tables, database: site });
  const first = render(<DatabaseStudio id="site" />);
  fireEvent.change(await screen.findByRole("textbox", { name: "Query 1 SQL" }), { target: { value: "SELECT 42" } });
  first.unmount();
  render(<DatabaseStudio id="site" />);
  expect(((await screen.findByRole("textbox", { name: "Query 1 SQL" })) as HTMLTextAreaElement).value).toBe(
    "SELECT 42",
  );
});

it("formats sizes, counts and CSV", () => {
  expect(formatBytes(925_700)).toBe("925.7 kB");
  expect(formatBytes(null)).toBe("—");
  expect(formatCount(950)).toBe("950");
  expect(formatCount(12_400)).toBe("12k");
  expect(formatCount(3_100_000)).toBe("3.1M");
  expect(
    toCsv(
      ["a", "b"],
      [
        ["x,y", null],
        [1, { blob: 2, hex: "00ff" }],
      ],
    ),
  ).toBe("a,b\n\"x,y\",\n1,x'00ff'");
});
