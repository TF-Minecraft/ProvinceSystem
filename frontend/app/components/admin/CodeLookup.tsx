"use client";

import { FormEvent, type ReactNode, useState } from "react";

import { adminErrorMessage } from "@/lib/admin/api";
import { inspectCode, type InspectCodeResult } from "@/lib/skins/api";
import { badgeClass, buttonClass, chipClass, errorClass, headingClass, inputClass, mutedClass, panelClass, rowClass } from "./ui";

type Found = Extract<InspectCodeResult, { valid: true }>;

const STATUS_TONE: Record<string, string> = {
  active: "bg-[#2a4a2e] text-[#b8e0b0]",
  consumed: "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-mist)]",
  expired: "bg-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] text-[var(--tfmc-mist)]",
  revoked: "bg-[#5a2a2a] text-[#f0c0c0]",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  consumed: "Used",
  expired: "Expired",
  revoked: "Revoked",
};

function when(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso || "—";
  return new Date(parsed).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function yesNo(value: boolean): ReactNode {
  return value ? "Yes" : <span className="text-[var(--tfmc-stone)]">No</span>;
}

/** A label and value per row, the label muted, as the profile pages lay them out. */
function Facts({ title, rows }: { title: string; rows: [ReactNode, ReactNode][] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">{title}</h3>
      <dl className={`mt-1 ${rowClass}`}>
        {rows.map(([label, value], index) => (
          <div key={index} className="flex justify-between gap-4 py-2 text-sm">
            <dt className="text-[var(--tfmc-mist)]">{label}</dt>
            <dd className="text-right text-[var(--tfmc-cream)]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Permission({ text, node }: { text: string; node: string }) {
  return (
    <>
      {text}
      <span className="block font-mono text-[11px] text-[var(--tfmc-stone)]">{node}</span>
    </>
  );
}

function CodeDetails({ code, result }: { code: string; result: Found }) {
  const { entitlements: unlocks, staff_token_perms: perms } = result;
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className={`${headingClass} font-mono`}>{code}</h2>
        <span className={`${badgeClass} ${STATUS_TONE[result.status] ?? STATUS_TONE.expired}`}>
          {STATUS_LABEL[result.status] ?? result.status}
        </span>
      </div>
      <div className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        <Facts
          title="Code"
          rows={[
            ["Kind", result.scope || "—"],
            ["Realm", result.realm_id || "—"],
            ["Player", <span key="p" className="font-mono text-xs">{result.player_uuid_masked || "—"}</span>],
            ["Made", when(result.created_at)],
            ["Expires", when(result.expires_at)],
          ]}
        />
        <Facts
          title="Access"
          rows={[
            ["Staff skin code", yesNo(result.staff)],
            [<Permission key="s" text="Site staff" node="tfmc.map.staff" />, yesNo(result.site_staff_access)],
            [<Permission key="t" text="Can make codes" node="tfmcweb.token.create" />, yesNo(perms["tfmcweb.token.create"])],
            [<Permission key="st" text="Can make staff codes" node="tfmcweb.token.create.staff" />, yesNo(perms["tfmcweb.token.create.staff"])],
          ]}
        />
      </div>
      <div className="mt-5">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--tfmc-stone)]">Unlocks</h3>
        {unlocks.skin_kinds.length ? (
          <ul className="mt-2 flex flex-wrap gap-1">
            {unlocks.skin_kinds.map((kind) => (
              <li key={kind} className={chipClass}>
                {kind}
              </li>
            ))}
          </ul>
        ) : (
          <p className={`mt-2 ${mutedClass}`}>No skin kinds.</p>
        )}
        <p className="mt-3 text-xs text-[var(--tfmc-stone)]">
          Ranks {unlocks.meta_synced ? "synced from the server" : "not synced from the server yet"} · 3D pairs up to{" "}
          {Math.round(unlocks.max_3d_pair_bytes / 1024).toLocaleString()} KB
        </p>
      </div>
    </>
  );
}

/** Staff panel lookup of a skin or drink code: what it is and what it unlocks. */
export default function CodeLookup() {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState<{ code: string; result: Found } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const code = input.trim();
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      const result = await inspectCode(code);
      if (result.valid) {
        setFound({ code, result });
      } else {
        setFound(null);
        setError(result.error);
      }
    } catch (err) {
      setFound(null);
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    // The lookup beside its answer on wide screens, as Accounts lays out its search.
    <div className="grid gap-x-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
      <section className={panelClass} aria-label="Look up a code">
        <h2 className={headingClass}>Look up a code</h2>
        <form onSubmit={onSubmit} className="mt-3 flex flex-wrap gap-3">
          <label className="sr-only" htmlFor="code-lookup">
            Skin or drink code
          </label>
          <input
            id="code-lookup"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="e.g. ABCD-1234"
            autoComplete="off"
            spellCheck={false}
            className={`${inputClass} min-w-0 flex-1 font-mono`}
          />
          <button type="submit" disabled={busy || !input.trim()} className={buttonClass}>
            {busy ? "Looking up…" : "Look up"}
          </button>
        </form>
        <p className="mt-2 text-xs text-[var(--tfmc-stone)]">
          A skin or drink code. Looking it up does not use it.
        </p>
        {error ? (
          <p className={`mt-3 ${errorClass}`} role="alert">
            {error}
          </p>
        ) : null}
      </section>

      {found ? (
        <section className={panelClass} aria-label="Code details">
          <CodeDetails code={found.code} result={found.result} />
        </section>
      ) : null}
    </div>
  );
}
