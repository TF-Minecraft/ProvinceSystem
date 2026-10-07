"use client";

import { FormEvent, useState } from "react";
import {
  adminErrorMessage,
  changeRole,
  revokeSessions,
  roleLabel,
  type AdminAccount,
  type AdminMe,
  type StaffRole,
} from "../../../lib/admin/api";

const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-3 py-1.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const quietButtonClass =
  "text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline disabled:opacity-50";
const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2 text-base text-[var(--tfmc-cream)] outline-none focus:border-[var(--tfmc-accent)] sm:text-sm";

type Mode = null | "role" | "sessions";

export default function AccountActions({
  me,
  account,
  onChanged,
}: {
  me: AdminMe;
  account: AdminAccount;
  onChanged: () => Promise<void>;
}) {
  const choices = me.assignable_roles.filter((role) => role !== account.role);
  const [mode, setMode] = useState<Mode>(null);
  const [role, setRole] = useState<StaffRole | "">(choices[0] ?? "");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = account.discord_username ? `@${account.discord_username}` : account.discord_user_id;

  function open(next: Mode) {
    setMode(next);
    // The account may have changed role since this form last opened.
    setRole(choices[0] ?? "");
    setReason("");
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "role" && role) await changeRole(account.user_id, role, reason);
      if (mode === "sessions") await revokeSessions(account.user_id, reason);
      setMode(null);
      await onChanged();
    } catch (err) {
      setError(adminErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!mode) {
    return (
      <div className="mt-2 flex flex-wrap gap-4 pl-11">
        {me.capabilities.includes("change_role") && choices.length ? (
          <button type="button" className={quietButtonClass} onClick={() => open("role")}>
            Change role
          </button>
        ) : null}
        {me.capabilities.includes("revoke_sessions") ? (
          <button type="button" className={quietButtonClass} onClick={() => open("sessions")}>
            Sign out everywhere
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3 pl-11">
      {mode === "role" ? (
        <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
          New role for {name}
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as StaffRole)}
            disabled={busy}
            className={inputClass}
          >
            {choices.map((choice) => (
              <option key={choice} value={choice}>
                {roleLabel(choice)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="text-sm text-[var(--tfmc-mist)]">Sign {name} out of the website on every device.</p>
      )}
      <label className="flex flex-col gap-1 text-sm text-[var(--tfmc-stone)]">
        Reason (recorded)
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
          rows={2}
          maxLength={500}
          required
          minLength={3}
          className={inputClass}
        />
      </label>
      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy || reason.trim().length < 3} className={buttonClass}>
          {busy ? "Saving…" : mode === "role" ? `Make ${role ? roleLabel(role) : "…"}` : "Sign out everywhere"}
        </button>
        <button type="button" onClick={() => setMode(null)} disabled={busy} className={quietButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
