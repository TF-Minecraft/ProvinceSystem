import { adminRequest } from "./api";

export type DatabaseInfo = {
  id: string;
  name: string;
  engine: "sqlite" | "postgres";
  writable: boolean;
  detail: string;
  /** Audited reads and edits so far. */
  queries: number;
  available: boolean;
  tables: number | null;
  size_bytes: number | null;
  error?: string;
};

export type Column = { name: string; type: string; notnull: boolean; pk: boolean };
export type Table = { name: string; kind: "table" | "view"; rows: number | null; columns: Column[] };
export type Blob = { blob: number; hex: string };
export type Cell = string | number | boolean | null | Blob;

export type QueryResult = {
  columns: string[];
  rows: Cell[][];
  truncated: boolean;
  /** Rows changed by an edit; null for reads. */
  changes: number | null;
  elapsed_ms: number;
  limit: number;
  /** The SELECT a table browse ran. */
  sql?: string;
};

export type Browse = {
  table: string;
  offset: number;
  limit: number;
  order: string | null;
  descending: boolean;
  where: string;
};

export function getDatabases(): Promise<{ databases: DatabaseInfo[] }> {
  return adminRequest("/admin/database");
}

export function getSchema(id: string): Promise<{ tables: Table[]; database: DatabaseInfo }> {
  return adminRequest(`/admin/database/${encodeURIComponent(id)}/schema`);
}

export function runQuery(id: string, sql: string, write = false): Promise<QueryResult> {
  return adminRequest(`/admin/database/${encodeURIComponent(id)}/query`, {
    method: "POST",
    body: JSON.stringify({ sql, write }),
  });
}

export function browseTable(id: string, browse: Browse): Promise<QueryResult> {
  return adminRequest(`/admin/database/${encodeURIComponent(id)}/browse`, {
    method: "POST",
    body: JSON.stringify(browse),
  });
}

export function isBlob(cell: Cell): cell is Blob {
  return typeof cell === "object" && cell !== null;
}

/** A cell as plain text, for copying and CSV. */
export function cellText(cell: Cell): string {
  if (cell === null) return "";
  if (isBlob(cell)) return `x'${cell.hex}${cell.blob > cell.hex.length / 2 ? "…" : ""}'`;
  return String(cell);
}

/** Text a spreadsheet would run as a formula; players write some of it (chat, commands, names). */
const FORMULA = /^[=+\-@\t\r]/;

export function toCsv(columns: string[], rows: Cell[][]): string {
  const field = (text: string) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);
  const text = (cell: Cell) => (typeof cell === "string" && FORMULA.test(cell) ? `'${cell}` : cellText(cell));
  return [columns, ...rows.map((row) => row.map(text))].map((line) => line.map(field).join(",")).join("\n");
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(value < 10 ? 2 : 1)} ${units[unit]}`;
}

/** Row estimates in the sidebar: 950, 12.4k, 3.1M. */
export function formatCount(count: number | null): string {
  if (count === null) return "";
  if (count < 1000) return String(count);
  if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 1 : 0)}M`;
}
