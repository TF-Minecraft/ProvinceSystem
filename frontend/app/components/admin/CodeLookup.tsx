"use client";

import { FormEvent, useState } from "react";

import { adminErrorMessage } from "@/lib/admin/api";
import { inspectCode, type InspectCodeResult } from "@/lib/skins/api";

function boolLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

function InspectResultPanel({ result }: { result: InspectCodeResult }) {
  if (!result.valid) {
    return (
      <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
        {result.error}
      </p>
    );
  }

  const kinds = result.entitlements.skin_kinds;
  const kindsText =
    kinds.length === 0
      ? "None"
      : kinds.length > 8
        ? `${kinds.slice(0, 8).join(", ")} (+${kinds.length - 8} more)`
        : kinds.join(", ");

  return (
    <div className="mt-4 rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_18%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_35%,transparent)] px-3 py-3 text-left text-sm text-[var(--tfmc-mist)]">
      <p className="font-medium text-[var(--tfmc-cream)]">
        Status: {result.status}
      </p>
      <dl className="mt-3 flex flex-col gap-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Scope</dt>
          <dd className="text-[var(--tfmc-cream)]">{result.scope}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Realm</dt>
          <dd className="text-[var(--tfmc-cream)]">{result.realm_id}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Skin staff scope</dt>
          <dd className="text-[var(--tfmc-cream)]">{boolLabel(result.staff)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Player</dt>
          <dd className="text-[var(--tfmc-cream)]">
            {result.player_uuid_masked || "-"}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Expires</dt>
          <dd className="text-[var(--tfmc-cream)]">{result.expires_at}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Site staff (tfmc.map.staff)</dt>
          <dd className="text-[var(--tfmc-cream)]">
            {boolLabel(result.site_staff_access)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Mint token (tfmcweb.token.create)</dt>
          <dd className="text-[var(--tfmc-cream)]">
            {boolLabel(result.staff_token_perms["tfmcweb.token.create"])}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">
            Mint staff token (tfmcweb.token.create.staff)
          </dt>
          <dd className="text-[var(--tfmc-cream)]">
            {boolLabel(result.staff_token_perms["tfmcweb.token.create.staff"])}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Meta synced</dt>
          <dd className="text-[var(--tfmc-cream)]">
            {boolLabel(result.entitlements.meta_synced)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-[var(--tfmc-stone)]">Max 3D pair bytes</dt>
          <dd className="text-[var(--tfmc-cream)]">
            {result.entitlements.max_3d_pair_bytes}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--tfmc-stone)]">Skin kinds</dt>
          <dd className="mt-1 text-[var(--tfmc-cream)]">{kindsText}</dd>
        </div>
      </dl>
    </div>
  );
}

/** Staff panel lookup of a skin or drink code: what it is and what it unlocks. */
export default function CodeLookup() {
  const [inspectCodeInput, setInspectCodeInput] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [inspectResult, setInspectResult] = useState<InspectCodeResult | null>(
    null
  );
  const [inspectError, setInspectError] = useState<string | null>(null);

  async function onInspectSubmit(e: FormEvent) {
    e.preventDefault();
    setInspectError(null);
    setInspectResult(null);

    const trimmed = inspectCodeInput.trim();
    if (!trimmed) {
      setInspectError("Enter a code");
      return;
    }

    setInspecting(true);
    try {
      const result = await inspectCode(trimmed);
      setInspectResult(result);
      if (!result.valid) {
        setInspectError(result.error);
      }
    } catch (err) {
      setInspectError(adminErrorMessage(err));
    } finally {
      setInspecting(false);
    }
  }

  return (
    <div className="max-w-md">
      {inspecting ? (
        <p className="mt-6 text-sm text-[var(--tfmc-mist)]">Looking up…</p>
      ) : (
        <form
          onSubmit={onInspectSubmit}
          className="mt-6 flex w-full flex-col gap-4"
        >
          <label className="flex flex-col gap-2 text-left">
            <span className="text-sm font-medium text-[var(--tfmc-stone)]">
              Code
            </span>
            <input
              type="text"
              name="inspect_code"
              autoComplete="off"
              spellCheck={false}
              value={inspectCodeInput}
              onChange={(e) => setInspectCodeInput(e.target.value)}
              disabled={inspecting}
              placeholder="e.g. ABCD-1234"
              className="rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_25%,transparent)] bg-[color-mix(in_srgb,var(--tfmc-forest)_40%,transparent)] px-3 py-2.5 text-[var(--tfmc-cream)] outline-none placeholder:text-[color-mix(in_srgb,var(--tfmc-mist)_60%,transparent)] focus:border-[var(--tfmc-accent)] disabled:opacity-60"
            />
          </label>

          <button
            type="submit"
            disabled={inspecting}
            className="inline-flex items-center justify-center rounded-sm border border-[color-mix(in_srgb,var(--tfmc-cream)_35%,transparent)] bg-transparent px-5 py-2.5 text-sm font-semibold text-[var(--tfmc-cream)] transition-colors hover:border-[var(--tfmc-cream)] hover:bg-[color-mix(in_srgb,var(--tfmc-cream)_8%,transparent)] disabled:opacity-50"
          >
            Look up
          </button>
        </form>
      )}

      {inspectError ? (
        <p className="mt-3 text-sm text-[#e8a0a0]" role="alert">
          {inspectError}
        </p>
      ) : null}
      {inspectResult?.valid ? (
        <InspectResultPanel result={inspectResult} />
      ) : null}
    </div>
  );
}
