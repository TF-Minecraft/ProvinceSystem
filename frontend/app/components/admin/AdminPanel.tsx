"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { AccountApiError } from "../../../lib/account/api";
import {
  adminErrorMessage,
  canManage,
  getAdminMe,
  getStaff,
  lookupAccounts,
  roleLabel,
  type AdminAccount,
  type AdminMe,
} from "../../../lib/admin/api";
import AccountActions from "./AccountActions";
import { StaffGateMessage, gateKind, type GateKind } from "./StaffGate";

const panelClass =
  "mt-6 rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_55%,transparent)] p-5 sm:p-6";
const headingClass = "font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]";
const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)]";

type Load = { kind: "loading" } | { kind: GateKind } | { kind: "ready"; me: AdminMe; staff: AdminAccount[] };

export default function AdminPanel() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminAccount[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [me, staff] = await Promise.all([getAdminMe(), getStaff()]);
      setLoad({ kind: "ready", me, staff });
    } catch (err) {
      setLoad({ kind: gateKind(err) });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await lookupAccounts(query));
    } catch (err) {
      setResults(null);
      if (err instanceof AccountApiError && (err.status === 401 || err.status === 403)) {
        await refresh();
      } else {
        setSearchError(adminErrorMessage(err));
      }
    } finally {
      setSearching(false);
    }
  }

  async function afterChange() {
    await refresh();
    if (results && query.trim()) {
      try {
        setResults(await lookupAccounts(query));
      } catch {
        setResults(null);
      }
    }
  }

  if (load.kind === "loading") return <p className="mt-6 text-[var(--tfmc-mist)]">Loading…</p>;
  if (load.kind !== "ready") return <StaffGateMessage kind={load.kind} />;

  const { me, staff } = load;

  return (
    <>
      <p className="mt-2 text-sm text-[var(--tfmc-mist)]">
        Signed in as {me.discord_username ? `@${me.discord_username}` : "staff"} · {roleLabel(me.role)}. Changes and reasons are recorded.
      </p>

      {/* The roster beside the lookup on wide screens; stacked below that. */}
      <div className="grid gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <section className={panelClass} aria-label="Staff">
          <h2 className={headingClass}>Staff</h2>
          <AccountTable accounts={staff} me={me} onChanged={afterChange} empty="No staff yet." />
        </section>

        <section className={panelClass} aria-label="Find an account">
          <h2 className={headingClass}>Find an account</h2>
          <form onSubmit={onSearch} className="mt-3 flex flex-wrap gap-3">
            <label className="sr-only" htmlFor="admin-lookup">
              Discord username, display name or ID
            </label>
            <input
              id="admin-lookup"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Discord username, display name or ID"
              autoComplete="off"
              spellCheck={false}
              className={`${inputClass} min-w-0 flex-1`}
            />
            <button type="submit" disabled={searching} className={buttonClass}>
              {searching ? "Searching…" : "Find"}
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
            Exact matches only. People appear once they have signed in to the website.
          </p>
          {searchError ? (
            <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
              {searchError}
            </p>
          ) : null}
          {results ? (
            <AccountTable accounts={results} me={me} onChanged={afterChange} empty="No account matches that." />
          ) : null}
        </section>
      </div>
    </>
  );
}

function AccountTable({
  accounts,
  me,
  onChanged,
  empty,
}: {
  accounts: AdminAccount[];
  me: AdminMe;
  onChanged: () => Promise<void>;
  empty: string;
}) {
  if (!accounts.length) return <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)]">
      {accounts.map((account) => (
        <li key={account.user_id} className="py-3" aria-label={account.discord_username || account.discord_user_id}>
          <div className="flex flex-wrap items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={account.avatar_url} alt="" width={32} height={32} className="rounded-full" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold text-[var(--tfmc-cream)]">
                {account.discord_global_name || account.discord_username || account.discord_user_id}
                {account.user_id === me.user_id ? <span className="text-[var(--tfmc-stone)]"> (you)</span> : null}
              </p>
              <p className="truncate text-xs text-[var(--tfmc-stone)]">
                {account.discord_username ? `@${account.discord_username} · ` : ""}
                {account.minecraft_name ? `Minecraft ${account.minecraft_name}` : "No Minecraft link"}
              </p>
            </div>
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-accent)]">
              {roleLabel(account.role)}
            </span>
          </div>
          {canManage(me, account) ? <AccountActions me={me} account={account} onChanged={onChanged} /> : null}
        </li>
      ))}
    </ul>
  );
}
