"use client";

import { useEffect, useRef, useState } from "react";
import {
  confirmationCopy,
  confirmationToken,
  finishPatreonLink,
  getPatreonLinkedResult,
  getPendingPatreonLink,
  type PatreonLinkedResult,
  type PendingPatreonLink,
} from "../../../lib/profile/patreonLinked";

type State =
  | { kind: "loading" }
  | { kind: "pending"; link: PendingPatreonLink }
  | { kind: "result"; result: PatreonLinkedResult };

export default function PatreonLinkConfirmation({ fallback }: { fallback: PatreonLinkedResult }) {
  const token = useRef<string | null | undefined>(undefined);
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    if (token.current === undefined) {
      token.current = confirmationToken(window.location.hash);
      if (token.current !== null) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      }
    }
    if (token.current === null) {
      setState({ kind: "result", result: fallback });
    } else {
      void getPendingPatreonLink(token.current).then((link) => {
        if (active) setState(link ? { kind: "pending", link } : { kind: "result", result: getPatreonLinkedResult("expired", null) });
      }).catch(() => {
        if (active) setState({ kind: "result", result: getPatreonLinkedResult("error", null) });
      });
    }
    return () => { active = false; };
  }, [fallback]);

  async function finish(action: "confirm" | "cancel") {
    if (busy || token.current == null) return;
    setBusy(true);
    try {
      const result = await finishPatreonLink(action, token.current);
      token.current = null;
      setState({ kind: "result", result });
    } catch {
      setState({ kind: "result", result: getPatreonLinkedResult("error", null) });
    } finally {
      setBusy(false);
    }
  }

  const title = state.kind === "pending" ? confirmationCopy.title : state.kind === "result" ? state.result.title : "Checking Patreon link…";
  return (
    <div aria-live="polite">
      <h1 className="font-[family-name:var(--font-fraunces)] text-3xl text-[var(--tfmc-cream)]">{title}</h1>
      {state.kind === "result" ? <p className="mt-3 text-sm text-[var(--tfmc-mist)]">{state.result.message}</p> : null}
      {state.kind === "pending" ? (
        <div className="mt-3 text-sm text-[var(--tfmc-mist)]">
          <p>Patreon account: <strong>{state.link.patreon_name}</strong></p>
          <p className="mt-2">{state.link.target_kind === "discord" ? "Discord" : "Minecraft"} account: <strong>{state.link.target_name}</strong></p>
          <p className="mt-4">{confirmationCopy.warning}</p>
          <div className="mt-4 flex gap-3">
            <button type="button" disabled={busy} onClick={() => void finish("confirm")} className="rounded-sm bg-[var(--tfmc-accent)] px-4 py-2 font-semibold text-[var(--tfmc-forest-deep)] disabled:opacity-50">Confirm</button>
            <button type="button" disabled={busy} onClick={() => void finish("cancel")} className="rounded-sm border px-4 py-2 text-[var(--tfmc-cream)] disabled:opacity-50">Cancel</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
