"use client";

import { FormEvent, useState } from "react";

type Props<Result, Session> = {
  redeem: (code: string) => Promise<Result>;
  toSession: (result: Result) => Session;
  saveSession: (session: Session) => void;
  onRedeemed: (session: Session) => void;
  /** Field label; the compact form uses it as the input's aria-label. */
  label: string;
  /** One line under Profile's "Use a code", rather than the full page form. */
  compact?: boolean;
};

const inputClass =
  "rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60";
const buttonClass =
  "inline-flex items-center justify-center rounded-sm bg-[var(--tfmc-accent)] px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-forest-deep)] transition-opacity hover:opacity-90 disabled:opacity-50";

/** Redeems an in-game skin or drink code and stores the session it opens. */
export default function CodeRedeemForm<Result, Session>({
  redeem,
  toSession,
  saveSession,
  onRedeemed,
  label,
  compact = false,
}: Props<Result, Session>) {
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = code.trim();
    if (!trimmed) {
      setError("Enter a code");
      return;
    }

    setLoading(true);
    try {
      const session = toSession(await redeem(trimmed));
      saveSession(session);
      onRedeemed(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Redeem failed");
    } finally {
      setLoading(false);
    }
  }

  if (compact) {
    return (
      <form onSubmit={onSubmit} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            name="code"
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={loading}
            placeholder="e.g. ABCD-1234"
            className={`${inputClass} min-w-0 flex-1 py-2 text-sm`}
          />
          <button type="submit" disabled={loading} className={`${buttonClass} py-2`}>
            {loading ? "Opening…" : "Open"}
          </button>
        </div>
        {error ? (
          <p className="text-sm text-[#e8a0a0]" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 flex w-full flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-[var(--tfmc-stone)]">{label}</span>
        <input
          type="text"
          name="code"
          autoComplete="off"
          spellCheck={false}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={loading}
          placeholder="e.g. ABCD-1234"
          className={inputClass}
        />
      </label>

      {error ? (
        <p className="text-sm text-[#e8a0a0]" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={loading} className={buttonClass}>
        {loading ? "Redeeming…" : "Redeem"}
      </button>
    </form>
  );
}
