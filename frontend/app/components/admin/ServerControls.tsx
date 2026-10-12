"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
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
import { buttonClass, errorClass, headingClass, inputClass, mutedClass, pagerClass, quietButtonClass } from "./ui";

const LABEL = { main: "Main", dev: "Dev" };
const ACTIVE: ServerJob["phase"][] = ["countdown", "installing", "restarting", "checking", "reopening"];
const STEPS: [ServerJob["phase"], string][] = [
  ["countdown", "Warning players"],
  ["installing", "Saving and installing"],
  ["restarting", "Restarting"],
  ["checking", "Checking startup"],
  ["reopening", "Reopening"],
];
const DONE: Partial<Record<ServerJob["phase"], [string, string]>> = {
  complete: ["Last restart finished.", "text-[var(--tfmc-accent)]"],
  cancelled: ["Last restart was cancelled.", "text-[var(--tfmc-mist)]"],
  resolved: ["Last failure was handled by staff.", "text-[var(--tfmc-mist)]"],
};
const SKIPPED: Record<string, string> = {
  test_or_unknown_build: "test or unrecognised build",
  not_a_newer_version: "no newer version",
  not_verified_on_dev: "not run on Dev yet",
  test_build_kept: "test build kept",
};
const dividerClass = "mt-4 border-t border-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] pt-4";
const sectionLabel = "text-[11px] font-semibold uppercase tracking-wider text-[var(--tfmc-mist)]";
const versionClass = "font-mono text-xs text-[var(--tfmc-cream)]";
const dangerButtonClass =
  "inline-flex items-center justify-center rounded-sm bg-[#e8a0a0] px-3 py-1.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
const calloutClass = {
  warn: "rounded-sm border border-[#e8c48a]/40 bg-[#5a4a2a]/30 p-3",
  bad: "rounded-sm border border-[#e8a0a0]/40 bg-[#5a2a2a]/30 p-3",
};

type Action = "cancel" | "reopen" | "resolve";
type Dialog = { kind: "plan"; plan: ServerPlan } | { kind: "job"; job: ServerJob; action: Action };

function message(err: unknown): string {
  return err instanceof AccountApiError && CONTROL_MESSAGES[err.message]
    ? CONTROL_MESSAGES[err.message]
    : adminErrorMessage(err);
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Polls the host helper and owns the one confirmation dialog the Servers page can show. */
export function useServerControls(onComplete: () => void) {
  const [status, setStatus] = useState<ControlStatus | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
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
      setNow(Date.now() / 1000);
      void refresh();
    }, 0);
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    const tick = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => {
      clearTimeout(start);
      clearInterval(timer);
      clearInterval(tick);
    };
  }, [refresh]);

  async function review(server: ServerKey, mode: ServerPlan["mode"]) {
    setBusy(true);
    setError(null);
    try {
      const plan = await planServer(server, mode);
      setNow(Date.now() / 1000);
      setDialog({ kind: "plan", plan });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  function ask(job: ServerJob, action: Action) {
    setError(null);
    setDialog({ job, action, kind: "job" });
  }

  const close = useCallback(() => {
    setDialog(null);
    setError(null);
  }, []);

  async function act(
    server: ServerKey,
    action: "start" | Action,
    id: string,
    reason: string,
    backupRef = "",
    override = false,
    replace: string[] = [],
  ) {
    setBusy(true);
    setError(null);
    try {
      const start = action === "start";
      await serverAction(
        server,
        action,
        id,
        reason,
        backupRef,
        start && server === "main" && override,
        start ? replace : [],
      );
      setDialog(null);
      await refresh();
    } catch (err) {
      setError(message(err));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = status?.jobs.some((j) => ACTIVE.includes(j.phase)) ?? false;
  return { status, dialog, busy, error, now, active, review, ask, close, act };
}

export type ServerControl = ReturnType<typeof useServerControls>;

/** Explains why the controls are missing, or shows an error raised outside the dialog. */
export function ControlNotice({ control }: { control: ServerControl }) {
  const { status, error, dialog } = control;
  if (!status) return null;
  if (status.status !== "available") {
    return (
      <p className={`mt-3 ${mutedClass}`}>{CONTROL_MESSAGES[status.status] ?? CONTROL_MESSAGES.control_unavailable}</p>
    );
  }
  return error && !dialog ? (
    <p className={`mt-3 ${errorClass}`} role="alert">
      {error}
    </p>
  ) : null;
}

function Steps({ job }: { job: ServerJob }) {
  const steps = job.server === "main" && !job.emergency_override ? STEPS : STEPS.slice(1);
  const at = steps.findIndex(([phase]) => phase === job.phase);
  return (
    <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
      {steps.map(([phase, text], i) => (
        <li
          key={phase}
          className={`flex items-center gap-1.5 ${
            i < at
              ? "text-[var(--tfmc-accent)]"
              : i === at
                ? "font-semibold text-[var(--tfmc-cream)]"
                : "text-[var(--tfmc-mist)] opacity-60"
          }`}
          aria-current={i === at ? "step" : undefined}
        >
          <span
            aria-hidden
            className={`h-1.5 w-1.5 rounded-full ${i <= at ? "bg-current" : "border border-current"} ${i === at ? "animate-pulse" : ""}`}
          />
          {text}
        </li>
      ))}
    </ol>
  );
}

function ReleaseList({ changes }: { changes: ServerJob["changes"] }) {
  return changes.length ? (
    <p className="mt-2 flex flex-wrap gap-1.5">
      {changes.map((c) => (
        <span
          key={c.repo}
          className="rounded-sm bg-[color-mix(in_srgb,var(--tfmc-cream)_10%,transparent)] px-1.5 py-0.5 text-xs text-[var(--tfmc-cream)]"
        >
          {c.repo} <span className="ml-0.5 font-mono">{c.version}</span>
        </span>
      ))}
    </p>
  ) : null;
}

/** The restart buttons and live progress for one server, shown inside its card. */
export function ServerActions({ control, server }: { control: ServerControl; server: ServerKey }) {
  const { status, busy, now, active } = control;
  if (!status || status.status !== "available") return null;
  const name = LABEL[server];
  if (!(status.allowed_servers ?? ["main", "dev"]).includes(server)) {
    return <p className={`${dividerClass} ${mutedClass}`}>This site can’t restart {name}.</p>;
  }
  const job = status.jobs.find((j) => j.server === server);
  const other = status.jobs.find((j) => j.server !== server && ACTIVE.includes(j.phase));
  const running = job && ACTIVE.includes(job.phase);
  const stuck = job?.phase === "failed" || job?.phase === "awaiting_review";
  const blocked = busy || active || stuck;

  let state: ReactNode = null;
  if (job && running) {
    state = (
      <div role="status">
        <p className="text-sm font-semibold text-[var(--tfmc-cream)]">
          {job.phase === "countdown" ? (
            <>
              Restarting in <span className="font-mono text-base">{now ? clock(job.deadline - now) : "…"}</span>
            </>
          ) : (
            `${STEPS.find(([phase]) => phase === job.phase)?.[1]}…`
          )}
          {job.emergency_override ? (
            <span className="ml-2 text-xs font-normal text-[#e8a0a0]">Emergency restart</span>
          ) : null}
        </p>
        <Steps job={job} />
        {job.phase === "countdown" ? (
          <button
            type="button"
            className={`${pagerClass} mt-3`}
            disabled={busy}
            onClick={() => control.ask(job, "cancel")}
          >
            Cancel {name} restart
          </button>
        ) : null}
      </div>
    );
  } else if (job?.phase === "awaiting_review") {
    state = (
      <div className={calloutClass.warn} role="status">
        <p className="text-sm font-semibold text-[#f0e0b0]">{name} is up with maintenance on</p>
        <p className={`mt-1 ${mutedClass}`}>Check the changed plugins in game, then reopen {name} to players.</p>
        <ReleaseList changes={job.changes} />
        <button
          type="button"
          className={`${buttonClass} mt-3`}
          disabled={busy}
          onClick={() => control.ask(job, "reopen")}
        >
          Recheck and reopen {name}
        </button>
      </div>
    );
  } else if (job?.phase === "failed") {
    state = (
      <div className={calloutClass.bad} role="status">
        <p className="text-sm font-semibold text-[#f0c0c0]">The {name} restart needs attention</p>
        <p className={`mt-1 ${mutedClass}`}>
          {(job.error && CONTROL_MESSAGES[job.error]) ?? "The operation failed. Check the server."}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {job.maintenance_started ? (
            <button type="button" className={buttonClass} disabled={busy} onClick={() => control.ask(job, "reopen")}>
              Recheck and reopen {name}
            </button>
          ) : (
            <button type="button" className={pagerClass} disabled={busy} onClick={() => control.ask(job, "cancel")}>
              Cancel {name} restart
            </button>
          )}
          <button
            type="button"
            className={quietButtonClass}
            disabled={busy}
            onClick={() => control.ask(job, "resolve")}
          >
            Mark failure handled
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={dividerClass}>
      {state}
      {running || stuck ? null : (
        <>
          {job && DONE[job.phase] ? (
            <p className={`mb-3 text-xs ${DONE[job.phase]?.[1]}`}>{DONE[job.phase]?.[0]}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={buttonClass}
              aria-label={`Update and restart ${name}`}
              disabled={blocked}
              onClick={() => void control.review(server, "latest")}
            >
              Update and restart
            </button>
            <button
              type="button"
              className={pagerClass}
              aria-label={`Restart ${name}`}
              disabled={blocked}
              onClick={() => void control.review(server, "restart")}
            >
              Restart only
            </button>
          </div>
          <p className="mt-2 text-xs text-[var(--tfmc-mist)]">
            {other
              ? `Wait for the ${LABEL[other.server]} restart to finish.`
              : server === "main"
                ? "Players get five minutes’ warning. You can cancel during it."
                : "Dev restarts as soon as you confirm."}
          </p>
        </>
      )}
    </div>
  );
}

function Rows({ label, rows }: { label: string; rows: [string, ReactNode][] }) {
  return (
    <div className="mt-4">
      <p className={sectionLabel}>
        {label} · {rows.length}
      </p>
      <ul className="mt-1 divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]">
        {rows.map(([name, value]) => (
          <li key={name} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
            <span className="text-[var(--tfmc-cream)]">{name}</span>
            <span className="text-right">{value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Upgrade({ from, to }: { from: string | null; to: string }) {
  return (
    <span className={versionClass}>
      <span className="text-[var(--tfmc-mist)]">{from ?? "not running"}</span> → {to}
    </span>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="mt-4 block">
      <span className="text-sm font-semibold text-[var(--tfmc-cream)]">{label}</span>
      {hint ? <span className="mt-0.5 block text-xs text-[var(--tfmc-mist)]">{hint}</span> : null}
      {children}
    </label>
  );
}

function TestBuilds({
  tests,
  replace,
  onChange,
}: {
  tests: ServerPlan["changes"];
  replace: string[];
  onChange: (next: string[]) => void;
}) {
  const all = replace.length === tests.length;
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className={sectionLabel}>Test builds · {tests.length}</p>
        <button
          type="button"
          className={quietButtonClass}
          onClick={() => onChange(all ? [] : tests.map((c) => c.repo))}
        >
          {all ? "Keep all" : "Replace all"}
        </button>
      </div>
      <p className="mt-0.5 text-xs text-[var(--tfmc-mist)]">
        Ticked plugins get the latest release in place of the test build.
      </p>
      <ul className="mt-1 divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]">
        {tests.map((c) => (
          <li key={c.repo}>
            <label className="flex cursor-pointer items-baseline gap-2.5 py-1.5 text-sm">
              <input
                type="checkbox"
                className="translate-y-0.5 accent-[var(--tfmc-accent)]"
                checked={replace.includes(c.repo)}
                onChange={(e) =>
                  onChange(e.target.checked ? [...replace, c.repo] : replace.filter((repo) => repo !== c.repo))
                }
              />
              <span className="text-[var(--tfmc-cream)]">{c.repo}</span>
              <span className="ml-auto text-right">
                <Upgrade from={c.old_version} to={c.version} />
                {c.newer_test ? (
                  <span className="block text-xs text-[#e8c48a]">The test build reports a newer version.</span>
                ) : null}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanBody({
  plan,
  now,
  override,
  replace,
  onReplace,
}: {
  plan: ServerPlan;
  now: number;
  override: boolean;
  replace: string[];
  onReplace: (next: string[]) => void;
}) {
  const main = plan.server === "main";
  const releases = plan.changes.filter((c) => !c.test_build);
  const tests = plan.changes.filter((c) => c.test_build);
  const changed = releases.length + replace.length + plan.activation.length > 0;
  return (
    <>
      <p className={`mt-2 ${mutedClass}`}>
        {main
          ? override
            ? "Players are disconnected straight away, with no warning."
            : "Players get a five-minute warning, and you can cancel during it."
          : "Dev restarts as soon as you confirm."}
      </p>
      {releases.length ? (
        <Rows
          label="Installs"
          rows={releases.map((c) => [c.repo, <Upgrade key={c.repo} from={c.old_version} to={c.version} />])}
        />
      ) : null}
      {tests.length ? <TestBuilds tests={tests} replace={replace} onChange={onReplace} /> : null}
      {plan.activation.length ? (
        <Rows
          label="Already installed, starts on restart"
          rows={plan.activation.map((a) => [a.name, <Upgrade key={a.name} from={a.loaded} to={a.version} />])}
        />
      ) : null}
      {!changed && !tests.length ? (
        <p className={`mt-4 ${mutedClass}`}>
          {plan.mode === "latest"
            ? "Every release is already installed, so this is a plain restart."
            : "No plugin files change."}
        </p>
      ) : null}
      {plan.skipped.length ? (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-[var(--tfmc-mist)] hover:text-[var(--tfmc-cream)]">
            {plan.skipped.length} {plan.skipped.length === 1 ? "plugin" : "plugins"} left as they are
          </summary>
          <p className="mt-2 text-xs text-[var(--tfmc-mist)]">Main only takes releases that have already run on Dev.</p>
          <ul className="mt-1 divide-y divide-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)]">
            {plan.skipped.map((s) => (
              <li key={s.repo} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="text-[var(--tfmc-cream)]">{s.repo}</span>
                <span className="text-xs text-[var(--tfmc-mist)]">{SKIPPED[s.reason] ?? s.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {main && changed ? (
        <p className={`mt-4 ${calloutClass.warn} text-sm text-[#f0e0b0]`}>
          Main stays in maintenance after startup so you can check these plugins. Reopen it from this page when you’re
          done.
        </p>
      ) : null}
      {now >= plan.expires_at ? (
        <p className={`mt-4 ${errorClass}`}>This plan expired. Close it and review again.</p>
      ) : null}
    </>
  );
}

/** The confirmation for starting, cancelling, reopening or resolving a restart. */
export function ControlDialog({ control }: { control: ServerControl }) {
  const { dialog, busy, error, now } = control;
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [reason, setReason] = useState("");
  const [backupRef, setBackupRef] = useState("");
  const [override, setOverride] = useState(false);
  const [replace, setReplace] = useState<string[]>([]);
  const [shown, setShown] = useState<Dialog | null>(null);

  // A new dialog starts with empty fields.
  if (dialog !== shown) {
    setShown(dialog);
    setReason("");
    setBackupRef("");
    setOverride(false);
    // Main should only run releases; Dev test builds are often someone's work in progress.
    setReplace(
      dialog?.kind === "plan" && dialog.plan.server === "main"
        ? dialog.plan.changes.filter((c) => c.test_build).map((c) => c.repo)
        : [],
    );
  }

  const { close } = control;
  useEffect(() => {
    if (dialog) box.current?.focus();
  }, [dialog]);
  useEffect(() => {
    if (!dialog) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [dialog, busy, close]);

  if (!dialog) return null;
  const server = dialog.kind === "plan" ? dialog.plan.server : dialog.job.server;
  const name = LABEL[server];
  const main = server === "main";
  const ready = reason.trim().length >= 3;

  let title: string;
  let body: ReactNode;
  let confirm: string;
  let danger = false;
  let submit: () => void;
  let blocked = busy || !ready;
  if (dialog.kind === "plan") {
    const { plan } = dialog;
    title = plan.mode === "latest" ? `Update and restart ${name}?` : `Restart ${name}?`;
    body = <PlanBody plan={plan} now={now} override={override} replace={replace} onReplace={setReplace} />;
    confirm = main ? (override ? "Restart Main now" : "Start Main countdown") : "Restart Dev now";
    danger = main && override;
    blocked ||= (main && backupRef.trim().length < 3) || now >= plan.expires_at;
    submit = () => void control.act(server, "start", plan.id, reason, backupRef, override, replace);
  } else {
    const { job, action } = dialog;
    title = {
      cancel: `Cancel the ${name} restart?`,
      reopen: `Reopen ${name}?`,
      resolve: "Mark the failure handled?",
    }[action];
    body = (
      <p className={`mt-2 ${mutedClass}`}>
        {
          {
            cancel:
              job.phase === "countdown"
                ? "The countdown stops and players are told the restart is off. Nothing is installed."
                : "This clears the failed restart. Nothing was installed.",
            reopen:
              "Confirm that you checked the changed features. Startup and file checks run again before maintenance is turned off.",
            resolve: "Use this after fixing the server by hand. It doesn’t change maintenance or plugin files.",
          }[action]
        }
      </p>
    );
    confirm = { cancel: "Cancel restart", reopen: `Reopen ${name}`, resolve: "Mark handled" }[action];
    submit = () => void control.act(server, action, job.id, reason);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[color-mix(in_srgb,var(--tfmc-forest)_72%,black)]/80 p-4 backdrop-blur-[2px] pt-[calc(var(--tfmc-header-h)+1rem)] sm:items-center"
      role="presentation"
    >
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[calc(100dvh-var(--tfmc-header-h)-2rem)] w-full max-w-lg overflow-y-auto rounded-md border border-[color-mix(in_srgb,var(--tfmc-cream)_14%,transparent)] bg-[var(--tfmc-forest-deep)] p-5 shadow-lg outline-none sm:p-6"
      >
        <h2 id={titleId} className={headingClass}>
          {title}
        </h2>
        {body}

        {dialog.kind === "plan" && main ? (
          <Field
            label="Backup for this restart"
            hint={`Last AMP backup: ${
              dialog.plan.last_backup_at
                ? formatLocal(new Date(dialog.plan.last_backup_at * 1000).toISOString())
                : "not recorded"
            }. Make sure data and migration backups cover these changes.`}
          >
            <input
              className={`${inputClass} mt-1.5 block w-full`}
              value={backupRef}
              maxLength={500}
              onChange={(e) => setBackupRef(e.target.value)}
              placeholder="Backup name or location"
            />
          </Field>
        ) : null}
        <Field label="Reason" hint="Saved in the staff audit log.">
          <input
            className={`${inputClass} mt-1.5 block w-full`}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            placeholder={dialog.kind === "plan" ? "What is this restart for?" : undefined}
          />
        </Field>
        {dialog.kind === "plan" && main ? (
          <label
            className={`mt-4 flex items-start gap-2.5 ${override ? calloutClass.bad : "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_12%,transparent)] p-3"}`}
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-[#e8a0a0]"
              checked={override}
              onChange={(e) => setOverride(e.target.checked)}
            />
            <span className="text-sm">
              <span className="font-semibold text-[#f0c0c0]">Emergency: skip the countdown</span>
              <span className="block text-xs text-[var(--tfmc-mist)]">
                Players are disconnected straight away. Only use this when waiting would do more harm.
              </span>
            </span>
          </label>
        ) : null}

        {error ? (
          <p className={`mt-4 ${errorClass}`} role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          {dialog.kind === "plan" && now < dialog.plan.expires_at ? (
            <span className="mr-auto text-xs text-[var(--tfmc-mist)]">
              Plan valid for {clock(dialog.plan.expires_at - now)}
            </span>
          ) : null}
          <button type="button" className={quietButtonClass} disabled={busy} onClick={control.close}>
            Back
          </button>
          <button
            type="button"
            className={danger ? dangerButtonClass : buttonClass}
            disabled={blocked}
            onClick={submit}
          >
            {busy ? "Working…" : confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
