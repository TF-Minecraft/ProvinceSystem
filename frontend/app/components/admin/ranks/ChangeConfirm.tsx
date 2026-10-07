"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import {
  lpErrorMessage,
  lpRequestMessage,
  STATUS_LABELS,
  submitLpChange,
  waitForChange,
  type LpChange,
  type LpOp,
  type LpTargetType,
} from "../../../../lib/admin/luckperms";
import { buttonClass, errorClass, inputClass, mutedClass, quietButtonClass, warnClass } from "./ui";

/**
 * Asks for a reason, queues the change, then follows it until the server has
 * applied it. onDone runs once it is settled, whatever the outcome.
 */
export default function ChangeConfirm({
  summary,
  warning,
  targetType,
  target,
  ops,
  confirmLabel = "Apply",
  onDone,
  onCancel,
}: {
  summary: ReactNode;
  warning?: ReactNode;
  targetType: LpTargetType;
  target: string;
  ops: LpOp[];
  confirmLabel?: string;
  onDone: (change: LpChange | null) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [change, setChange] = useState<LpChange | null>(null);
  const aborter = useRef<AbortController | null>(null);

  useEffect(() => () => aborter.current?.abort(), []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const queued = await submitLpChange(targetType, target, ops, reason);
      setChange(queued);
      aborter.current = new AbortController();
      const settled = await waitForChange(queued.id, { signal: aborter.current.signal });
      setChange(settled);
      if (settled.status === "applied") onDone(settled);
    } catch (err) {
      setError(lpRequestMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (change && change.status !== "applied") {
    const settled = change.status !== "pending" && change.status !== "sent";
    return (
      <div className="mt-3 flex flex-col gap-2" role="status">
        <p className={settled ? (change.status === "failed" ? errorClass : warnClass) : mutedClass}>
          {STATUS_LABELS[change.status]}
          {change.error ? `: ${lpErrorMessage(change.error)}` : "…"}
          {change.status === "unknown" ? " Check the player before trying again." : ""}
          {!settled && !busy ? " Reload the page later to see whether it applied." : ""}
        </p>
        {settled || !busy ? (
          <button type="button" className={`${quietButtonClass} self-start`} onClick={() => onDone(change)}>
            Close
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-accent)_35%,transparent)] p-3">
      <div className="text-sm text-[var(--tfmc-cream)]">{summary}</div>
      {warning ? <p className={warnClass}>{warning}</p> : null}
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
        <p className={errorClass} role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-4">
        <button type="submit" disabled={busy || reason.trim().length < 3} className={buttonClass}>
          {busy ? (change ? "Applying…" : "Saving…") : confirmLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={quietButtonClass}>
          Cancel
        </button>
      </div>
    </form>
  );
}
