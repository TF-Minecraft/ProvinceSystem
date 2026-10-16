"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { formatBytes, getDatabases, type DatabaseInfo } from "@/lib/admin/database";
import { StaffGateMessage, gateKind, type GateKind } from "../StaffGate";
import { badgeClass, errorClass, inputClass, mutedClass } from "../ui";
import { divideHairline, editBadge, hairline, readBadge } from "./studioStyles";

type SortKey = "name" | "engine" | "tables" | "queries" | "size_bytes";

const COLUMNS: [SortKey, string, string][] = [
  ["name", "Name", "text-left"],
  ["engine", "Engine", "text-left"],
  ["tables", "Tables", "text-right"],
  ["queries", "Queries", "text-right"],
  ["size_bytes", "Size", "text-right"],
];

const ENGINE: Record<DatabaseInfo["engine"], string> = { sqlite: "SQLite", postgres: "Postgres" };

/** Root's list of the site's databases; each opens in the studio. */
export default function DatabaseList() {
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null);
  const [gate, setGate] = useState<GateKind | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "name", descending: false });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDatabases((await getDatabases()).databases);
      setGate(null);
    } catch (err) {
      setGate(gateKind(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const rows = (databases ?? []).filter(
      (d) => !needle || d.name.toLowerCase().includes(needle) || d.detail.toLowerCase().includes(needle),
    );
    const value = (d: DatabaseInfo) => d[sort.key] ?? -1;
    rows.sort((a, b) => {
      const [x, y] = [value(a), value(b)];
      const order = typeof x === "string" && typeof y === "string" ? x.localeCompare(y) : Number(x) - Number(y);
      return sort.descending ? -order : order;
    });
    return rows;
  }, [databases, search, sort]);

  if (gate === "forbidden")
    return <p className="mt-6 text-[var(--tfmc-mist)]">The database studio is for the owner.</p>;
  if (gate) return <StaffGateMessage kind={gate} />;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-fraunces)] text-2xl text-[var(--tfmc-cream)]">Databases</h2>
          <p className={`mt-1 ${mutedClass}`}>
            Browse and query the site’s data. Every query is written to the audit log.
          </p>
        </div>
      </div>

      <div className={`mt-5 flex items-center gap-2 rounded-md border ${hairline} p-1.5`}>
        <input
          type="search"
          aria-label="Search databases"
          placeholder="Search databases"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${inputClass} w-full border-transparent bg-transparent`}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          aria-label="Refresh"
          title="Refresh"
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-sm border ${hairline} text-[var(--tfmc-stone)] hover:text-[var(--tfmc-cream)] disabled:opacity-50`}
        >
          <span aria-hidden className={loading ? "motion-safe:animate-spin" : ""}>
            ↻
          </span>
        </button>
      </div>

      <div className={`mt-4 overflow-x-auto rounded-md border ${hairline}`}>
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className={`border-b ${hairline} text-[var(--tfmc-mist)]`}>
              {COLUMNS.map(([key, label, align]) => (
                <th key={key} scope="col" className={`px-4 py-2.5 font-semibold ${align}`}>
                  <button
                    type="button"
                    onClick={() =>
                      setSort((s) => ({
                        key,
                        descending: s.key === key ? !s.descending : key !== "name" && key !== "engine",
                      }))
                    }
                    className="inline-flex items-center gap-1 hover:text-[var(--tfmc-cream)]"
                  >
                    {label}
                    <span aria-hidden className="text-[10px] opacity-70">
                      {sort.key === key ? (sort.descending ? "▼" : "▲") : "↕"}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-2.5 text-left font-semibold">
                Access
              </th>
            </tr>
          </thead>
          <tbody className={`divide-y ${divideHairline}`}>
            {databases === null ? (
              <tr>
                <td colSpan={6} className={`px-4 py-6 ${mutedClass}`}>
                  Loading…
                </td>
              </tr>
            ) : shown.length === 0 ? (
              <tr>
                <td colSpan={6} className={`px-4 py-6 ${mutedClass}`}>
                  No databases match.
                </td>
              </tr>
            ) : (
              shown.map((d) => (
                <tr key={d.id} className="hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_4%,transparent)]">
                  <td className="px-4 py-3">
                    {d.available ? (
                      <Link
                        href={`/admin/database/${d.id}`}
                        className="font-semibold text-[var(--tfmc-cream)] underline decoration-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] underline-offset-4 hover:decoration-[var(--tfmc-accent)]"
                      >
                        {d.name}
                      </Link>
                    ) : (
                      <span className="font-semibold text-[var(--tfmc-mist)]">{d.name}</span>
                    )}
                    <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">
                      {d.available ? d.detail : <span className={errorClass}>Can’t be read right now.</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[var(--tfmc-stone)]">{ENGINE[d.engine]}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--tfmc-cream)]">{d.tables ?? "—"}</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--tfmc-cream)]">
                    {d.queries.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--tfmc-cream)]">
                    {formatBytes(d.size_bytes)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`${badgeClass} ${d.writable ? editBadge : readBadge}`}>
                      {d.writable ? "Read & edit" : "Read only"}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {databases ? (
        <p className={`mt-3 ${mutedClass}`}>
          Showing {shown.length} of {databases.length}
        </p>
      ) : null}
    </section>
  );
}
