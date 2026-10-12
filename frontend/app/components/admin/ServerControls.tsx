"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AccountApiError } from "@/lib/account/api";
import { adminErrorMessage } from "@/lib/admin/api";
import {
  CONTROL_MESSAGES,
  getControl,
  planServer,
  serverAction,
  type ControlStatus,
  type ServerJob,
  type ServerPlan,
} from "@/lib/admin/serverControl";
import type { ServerKey } from "@/lib/admin/servers";
import { formatLocal } from "@/lib/skins/formatTime";
import { buttonClass, errorClass, headingClass, inputClass, mutedClass, panelClass, quietButtonClass } from "./ui";

const LABEL = { main: "Main", dev: "Dev" };
const PHASE: Record<ServerJob["phase"], string> = {
  countdown: "Restart countdown",
  installing: "Saving and installing",
  restarting: "Restarting",
  checking: "Checking startup",
  reopening: "Reopening",
  complete: "Restart complete",
  cancelled: "Restart cancelled",
  failed: "Needs attention",
  awaiting_review: "Startup passed · check the changed features before reopening",
  resolved: "Failure handled by staff",
};
const SKIPPED: Record<string, string> = {
  test_or_unknown_build: "test or unrecognised build",
  not_a_newer_version: "no newer version",
  not_verified_on_dev: "not verified on Dev",
};
type Action = "cancel" | "reopen" | "resolve";

function message(err: unknown): string {
  return err instanceof AccountApiError && CONTROL_MESSAGES[err.message]
    ? CONTROL_MESSAGES[err.message]
    : adminErrorMessage(err);
}

export default function ServerControls({ onComplete }: { onComplete: () => void }) {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [plan, setPlan] = useState<ServerPlan | null>(null);
  const [pending, setPending] = useState<{ job: ServerJob; action: Action } | null>(null);
  const [reason, setReason] = useState("");
  const [backupRef, setBackupRef] = useState("");
  const [emergencyOverride, setEmergencyOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const previous = useRef<Record<string, string>>({});

  const refresh = useCallback(async () => {
    try {
      const next = await getControl();
      if (
        next.jobs.some(
          (job) => job.phase === "complete" && previous.current[job.id] && previous.current[job.id] !== "complete",
        )
      )
        onComplete();
      previous.current = Object.fromEntries(next.jobs.map((j) => [j.id, j.phase]));
      setStatus(next);
    } catch {
      setStatus({ status: "control_unavailable", jobs: [] });
    }
  }, [onComplete]);

  useEffect(() => {
    const start = setTimeout(() => {
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    const clock = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
      clearInterval(clock);
    };
  }, [refresh]);

  const active = status?.jobs.some((j) =>
    ["countdown", "installing", "restarting", "checking", "reopening"].includes(j.phase),
  );

  async function review(server: ServerKey, mode: ServerPlan["mode"]) {
    setBusy(true);
    setError(null);
    try {
      setPlan(await planServer(server, mode));
      setPending(null);
      setReason("");
      setBackupRef("");
      setEmergencyOverride(false);
      setNow(Date.now() / 1000);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function ask(job: ServerJob, action: Action) {
    setPending({ job, action });
    setPlan(null);
    setReason("");
  }

  async function act(server: ServerKey, action: "start" | Action, id: string) {
    setBusy(true);
    setError(null);
    try {
      await serverAction(
        server,
        action,
        id,
        reason,
        backupRef,
        action === "start" && server === "main" && emergencyOverride,
      );
      setPlan(null);
      setPending(null);
      await refresh();
    } catch (err) {
      setError(message(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;
  return (
    <section className={panelClass} aria-label="Server controls">
      <h3 className={headingClass}>Server controls</h3>
      {status.status !== "available" ? (
        <p className={`mt-2 ${mutedClass}`}>
          {CONTROL_MESSAGES[status.status] ?? CONTROL_MESSAGES.control_unavailable}
        </p>
      ) : (
        <>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {(status.allowed_servers ?? ["main", "dev"]).map((server) => {
              const job = status.jobs.find((j) => j.server === server);
              const blocked = active || job?.phase === "failed" || job?.phase === "awaiting_review";
              const remaining = job ? Math.max(0, Math.ceil(job.deadline - now)) : 0;
              return (
                <div key={server}>
                  <p className="font-semibold text-[var(--tfmc-cream)]">{LABEL[server]}</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    <button
                      type="button"
                      className={buttonClass}
                      disabled={busy || blocked}
                      onClick={() => void review(server, "restart")}
                    >
                      Restart {LABEL[server]}
                    </button>
                    <button
                      type="button"
                      className={quietButtonClass}
                      disabled={busy || blocked}
                      onClick={() => void review(server, "latest")}
                    >
                      Use latest releases and restart {LABEL[server]}
                    </button>
                  </div>
                  {job ? (
                    <div className={`mt-2 ${mutedClass}`} role="status">
                      <p>
                        {PHASE[job.phase]}
                        {job.emergency_override ? " · emergency override" : ""}
                        {job.phase === "countdown" && now
                          ? ` · ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`
                          : ""}
                      </p>
                      {job.error ? (
                        <p className={errorClass}>
                          {CONTROL_MESSAGES[job.error] ?? "The operation failed. Check the server."}
                        </p>
                      ) : null}
                      {job.phase === "countdown" || (job.phase === "failed" && !job.maintenance_started) ? (
                        <button
                          type="button"
                          className={quietButtonClass}
                          disabled={busy}
                          onClick={() => ask(job, "cancel")}
                        >
                          Cancel {LABEL[server]} restart
                        </button>
                      ) : null}
                      {(job.phase === "failed" && job.maintenance_started) || job.phase === "awaiting_review" ? (
                        <button
                          type="button"
                          className={quietButtonClass}
                          disabled={busy}
                          onClick={() => ask(job, "reopen")}
                        >
                          Recheck and reopen {LABEL[server]}
                        </button>
                      ) : null}
                      {job.phase === "failed" ? (
                        <button
                          type="button"
                          className={`${quietButtonClass} ml-3`}
                          disabled={busy}
                          onClick={() => ask(job, "resolve")}
                        >
                          Mark failure handled
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <p className={`mt-3 ${mutedClass}`}>
            Main gives players five minutes and can be cancelled during the countdown. Dev restarts immediately after
            confirmation.
          </p>
        </>
      )}
      {error ? (
        <p className={`mt-3 ${errorClass}`} role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <div className={`${panelClass} !mt-4`} role="dialog" aria-label={`Confirm ${LABEL[plan.server]} restart`}>
          <h4 className={headingClass}>
            {LABEL[plan.server]} · {plan.mode === "latest" ? "Latest releases and restart" : "Restart"}
          </h4>
          <p className={`mt-2 ${mutedClass}`}>
            {plan.server === "main"
              ? emergencyOverride
                ? "This restarts Main immediately after confirmation."
                : "This starts a five-minute countdown on Main."
              : "This restarts Dev immediately after confirmation."}{" "}
            Check the changes and the restart window before confirming.
          </p>
          {plan.mode === "latest" ? (
            <p className={`mt-2 ${mutedClass}`}>
              Test builds and unrecognised files are skipped. Main upgrades require the release files to have run on
              Dev.
            </p>
          ) : null}
          {plan.changes.length ? (
            <ul className={`mt-3 ${mutedClass}`}>
              {plan.changes.map((c) => (
                <li key={c.repo}>
                  {c.repo}: {c.old_version} → {c.version}
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-3 ${mutedClass}`}>No release files will change.</p>
          )}
          {plan.activation.length ? (
            <>
              <p className={`mt-3 ${mutedClass}`}>Files already waiting for activation:</p>
              <ul className={mutedClass}>
                {plan.activation.map((a) => (
                  <li key={a.name}>
                    {a.name}: {a.loaded ?? "not running"} → {a.version}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {plan.skipped.length ? (
            <>
              <p className={`mt-3 ${mutedClass}`}>Skipped:</p>
              <ul className={mutedClass}>
                {plan.skipped.map((s) => (
                  <li key={s.repo}>
                    {s.repo}: {SKIPPED[s.reason] ?? s.reason}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <label className={`mt-3 block ${mutedClass}`}>
            Reason
            <input
              className={`${inputClass} mt-1 block w-full`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          {plan.server === "main" ? (
            <p className={`mt-3 ${mutedClass}`}>
              Last AMP backup:{" "}
              {plan.last_backup_at ? formatLocal(new Date(plan.last_backup_at * 1000).toISOString()) : "not recorded"}.
              Prepare consistent data and migration backups for these changes.
            </p>
          ) : null}
          {plan.server === "main" ? (
            <label className={`mt-3 block ${mutedClass}`}>
              Backup prepared for this restart
              <input
                className={`${inputClass} mt-1 block w-full`}
                value={backupRef}
                maxLength={500}
                onChange={(e) => setBackupRef(e.target.value)}
                placeholder="Backup name or location"
              />
            </label>
          ) : null}
          {plan.server === "main" && (plan.changes.length || plan.activation.length) ? (
            <p className={`mt-3 ${mutedClass}`}>
              Main stays in maintenance after startup so you can check the changed features, then press Recheck and
              reopen.
            </p>
          ) : null}
          {plan.server === "main" ? (
            <label className="mt-4 flex items-start gap-2 text-sm text-[#e8c48a]">
              <input
                type="checkbox"
                className="mt-1 accent-[var(--tfmc-accent)]"
                checked={emergencyOverride}
                onChange={(e) => setEmergencyOverride(e.target.checked)}
              />
              <span>
                OVERRIDE: restart immediately for an emergency. Players will be disconnected without a countdown.
              </span>
            </label>
          ) : null}
          <div className="mt-3 flex gap-4">
            <button
              type="button"
              className={buttonClass}
              disabled={
                busy ||
                reason.trim().length < 3 ||
                (plan.server === "main" && backupRef.trim().length < 3) ||
                now >= plan.expires_at
              }
              onClick={() => void act(plan.server, "start", plan.id)}
            >
              {plan.server === "main"
                ? emergencyOverride
                  ? "Restart Main now"
                  : "Start Main countdown"
                : "Restart Dev now"}
            </button>
            <button type="button" className={quietButtonClass} disabled={busy} onClick={() => setPlan(null)}>
              Close
            </button>
          </div>
          {now >= plan.expires_at ? (
            <p className={`mt-2 ${errorClass}`}>This plan expired. Close it and review again.</p>
          ) : null}
        </div>
      ) : null}
      {pending ? (
        <div
          className={`${panelClass} !mt-4`}
          role="dialog"
          aria-label={`${pending.action} ${LABEL[pending.job.server]}`}
        >
          <p className={mutedClass}>
            {pending.action === "resolve"
              ? "Mark this failure as handled after checking the server manually. This does not change maintenance or plugin files."
              : pending.action === "reopen"
                ? "Confirm that you checked the changed features. Startup and file checks will run again before maintenance is disabled."
                : "Cancel the pending restart countdown."}
          </p>
          <label className={`mt-3 block ${mutedClass}`}>
            Reason
            <input
              className={`${inputClass} mt-1 block w-full`}
              value={reason}
              maxLength={500}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="mt-3 flex gap-4">
            <button
              type="button"
              className={buttonClass}
              disabled={busy || reason.trim().length < 3}
              onClick={() => void act(pending.job.server, pending.action, pending.job.id)}
            >
              Confirm {pending.action}
            </button>
            <button type="button" className={quietButtonClass} disabled={busy} onClick={() => setPending(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}
      {busy ? (
        <p className={`mt-2 ${mutedClass}`} role="status">
          Preparing…
        </p>
      ) : null}
    </section>
  );
}
