"use client";

import { useEffect, useState } from "react";
import {
  getPatreonStatus,
  selectSupporterPanelState,
  startPatreonLink,
  unlinkPatreon,
  type PatreonStatus,
} from "../../../lib/profile/patreon";

const PATREON_URL = "https://www.patreon.com/c/tfmcrp";

function formatGraceDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "the date shown";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export default function SupporterPanel({ sessionToken }: { sessionToken: string }) {
  const [status, setStatus] = useState<PatreonStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function refresh() {
    try {
      const next = await getPatreonStatus(sessionToken);
      setStatus(next);
    } catch {
      // Patreon may be disabled or temporarily unavailable. Keep this panel quiet.
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // A profile session is fixed for this mounted panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken]);

  async function connect() {
    setBusy(true);
    setActionError(null);
    try {
      const authorizeUrl = await startPatreonLink(sessionToken);
      window.location.assign(authorizeUrl);
    } catch {
      setActionError("We couldn’t open Patreon just now. Please try again.");
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setActionError(null);
    try {
      await unlinkPatreon(sessionToken);
      setConfirmDisconnect(false);
      await refresh();
    } catch {
      setActionError("We couldn’t disconnect Patreon just now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !status) return null;

  const state = selectSupporterPanelState(status);
  const panelClass =
    "mt-6 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_28%,transparent)] p-5";
  const buttonClass =
    "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";
  const secondaryButtonClass =
    "inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] px-4 py-2 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] disabled:opacity-50";

  return (
    <section className={panelClass} aria-labelledby="supporter-heading">
      <h2
        id="supporter-heading"
        className="font-[family-name:var(--font-fraunces)] text-xl text-[var(--tfmc-cream)]"
      >
        Supporter
      </h2>

      {state === "not_linked" ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--tfmc-mist)]">
            Connect Patreon to bring your supporter perks to your player.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <button type="button" onClick={() => void connect()} disabled={busy} className={buttonClass}>
              {busy ? "Opening Patreon…" : "Connect Patreon"}
            </button>
            <a
              href={PATREON_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline"
            >
              Become a supporter
            </a>
          </div>
          {actionError ? <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">{actionError}</p> : null}
        </div>
      ) : null}

      {state === "linked_tier" ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--tfmc-mist)]">
            Linked with <span className="font-semibold text-[var(--tfmc-cream)]">{status.tier_name || "an active supporter tier"}</span>.
          </p>
          {status.is_gifted ? (
            <p className="mt-1 text-sm text-[var(--tfmc-stone)]">
              This tier was gifted to you. Your perks are active.
            </p>
          ) : null}
          <DisconnectControls
            confirm={confirmDisconnect}
            busy={busy}
            error={actionError}
            buttonClass={buttonClass}
            secondaryButtonClass={secondaryButtonClass}
            onBegin={() => setConfirmDisconnect(true)}
            onCancel={() => setConfirmDisconnect(false)}
            onConfirm={() => void disconnect()}
          />
        </div>
      ) : null}

      {state === "linked_no_tier" ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--tfmc-mist)]">
            Patreon is linked, but there’s no active supporter tier on this account.
          </p>
          <DisconnectControls
            confirm={confirmDisconnect}
            busy={busy}
            error={actionError}
            buttonClass={buttonClass}
            secondaryButtonClass={secondaryButtonClass}
            onBegin={() => setConfirmDisconnect(true)}
            onCancel={() => setConfirmDisconnect(false)}
            onConfirm={() => void disconnect()}
          />
        </div>
      ) : null}

      {state === "grace" ? (
        <div className="mt-2">
          <p className="text-sm text-[var(--tfmc-mist)]">
            Patreon couldn’t process your payment. Your perks end on {formatGraceDate(status.grace_until!)}.
          </p>
          {status.tier_name ? (
            <p className="mt-1 text-sm text-[var(--tfmc-stone)]">Current tier: {status.tier_name}.</p>
          ) : null}
          {status.is_gifted ? (
            <p className="mt-1 text-sm text-[var(--tfmc-stone)]">This tier was gifted to you.</p>
          ) : null}
          <DisconnectControls
            confirm={confirmDisconnect}
            busy={busy}
            error={actionError}
            buttonClass={buttonClass}
            secondaryButtonClass={secondaryButtonClass}
            onBegin={() => setConfirmDisconnect(true)}
            onCancel={() => setConfirmDisconnect(false)}
            onConfirm={() => void disconnect()}
          />
        </div>
      ) : null}
    </section>
  );
}

function DisconnectControls({
  confirm,
  busy,
  error,
  buttonClass,
  secondaryButtonClass,
  onBegin,
  onCancel,
  onConfirm,
}: {
  confirm: boolean;
  busy: boolean;
  error: string | null;
  buttonClass: string;
  secondaryButtonClass: string;
  onBegin: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="mt-4">
      {confirm ? (
        <div>
          <p className="text-sm text-[var(--tfmc-stone)]">
            Disconnect Patreon? Your supporter perks will be removed.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={onConfirm} disabled={busy} className={buttonClass}>
              {busy ? "Disconnecting…" : "Yes, disconnect"}
            </button>
            <button type="button" onClick={onCancel} disabled={busy} className={secondaryButtonClass}>
              Keep linked
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={onBegin} className="text-sm text-[var(--tfmc-stone)] underline-offset-2 hover:text-[var(--tfmc-cream)] hover:underline">
          Disconnect
        </button>
      )}
      {error ? <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">{error}</p> : null}
    </div>
  );
}
